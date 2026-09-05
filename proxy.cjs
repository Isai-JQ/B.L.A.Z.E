// Bambu Lab MQTT gateway — B.L.A.Z.E v2 (T14, T14b)
//
// Adapted from `proxy.cjs` of Automatize-3D-printers, which was only a WS<->TLS byte
// bridge for the browser. This version keeps that bridge (the dashboard still speaks MQTT
// over WebSocket) and adds its own MQTT client to each printer, so fleet state is tracked
// in this process and survives with no browser open.
//
// T14b: instead of one printer passed on the CLI, the fleet is read from the `printers`
// table (DATABASE_URL) on startup and re-read every PRINTERS_RELOAD_MS, opening one
// independent MQTT client per registered printer. Combined state for the whole fleet is
// served at GET /printers, each entry keyed by its serial (and DB id when known).
//
// Usage: node proxy.cjs
//        WS_PORT=9001 (default) serves both the WebSocket bridge and GET /printers.

const fs = require("node:fs");
const http = require("node:http");
const tls = require("node:tls");
const mqtt = require("mqtt");
const { WebSocketServer } = require("ws");
const { drizzle } = require("drizzle-orm/postgres-js");
const { sql } = require("drizzle-orm");
const postgres = require("postgres");

const PRINTER_PORT = 8883;
const PRINTERS_RELOAD_MS = 30_000;

// serial -> last known state. Memory only: writing it back to the `printers` table is T15.
const printers = new Map();
// DB printer id -> its MQTT client, so a reload only opens clients for new rows.
const watched = new Map();
// Host the WS<->TLS bridge dials. ponytail: first registered printer wins; add ?host= or
// per-serial routing once the dashboard is actually multi-printer (T30).
let bridgeHost = null;

// Bambu report field -> our state field. Reports are partial deltas, so a message only
// updates the keys it carries; everything else keeps its previous value.
const FIELDS = {
  gcode_state: "gcodeState",
  nozzle_temper: "nozzleTemp",
  nozzle_target_temper: "nozzleTempTarget",
  bed_temper: "bedTemp",
  bed_target_temper: "bedTempTarget",
  chamber_temper: "chamberTemp",
  mc_percent: "printPercent",
  layer_num: "layerNum",
  total_layer_num: "totalLayerNum",
  mc_remaining_time: "remainingTime",
  spd_lvl: "speed",
  gcode_file: "gcodeFile",
  wifi_signal: "wifiSignal",
};

// Loads `.env` the same way db/seed.ts and scripts/db-push.mjs do (no dotenv dependency).
function loadEnv() {
  let text;
  try {
    text = fs.readFileSync(".env", "utf8");
  } catch {
    return; // vars may already be in the real environment
  }
  for (const line of text.split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}

// Merges one `device/{serial}/report` message into the in-memory state.
// Returns the updated state, or null if the message is not a usable print report.
function handleReport(topic, message) {
  const serial = String(topic).split("/")[1];
  if (!serial) return null;

  let print;
  try {
    print = JSON.parse(message.toString()).print;
  } catch {
    return null;
  }
  if (!print || typeof print !== "object") return null;

  const state = printers.get(serial) ?? { serial };
  for (const [from, to] of Object.entries(FIELDS)) {
    if (print[from] !== undefined) state[to] = print[from];
  }
  state.lastReportAt = new Date().toISOString();
  printers.set(serial, state);
  return state;
}

// Persistent MQTT client to one printer. mqtt.js handles reconnection on its own.
// `connect` is injectable so tests can supply a stub instead of a real broker.
function watchPrinter(ip, accessCode, serial, connect = mqtt.connect) {
  const client = connect(`mqtts://${ip}:${PRINTER_PORT}`, {
    username: "bblp",
    password: accessCode,
    clientId: `blaze-gateway-${Date.now()}`,
    rejectUnauthorized: false, // printers serve a self-signed cert
    reconnectPeriod: 5000,
  });

  // Without a serial we listen to every device the printer's broker exposes.
  const topic = `device/${serial || "+"}/report`;

  client.on("connect", () => {
    console.log(`→ Printer MQTT connected ✓  SUB ${topic}`);
    client.subscribe(topic, { qos: 0 });
  });

  client.on("message", (msgTopic, message) => {
    const known = printers.has(String(msgTopic).split("/")[1]);
    const state = handleReport(msgTopic, message);
    if (!state) return;
    if (!known) {
      // First sighting: ongoing reports are deltas, so ask for one full dump.
      console.log(`→ Tracking printer ${state.serial}`);
      client.publish(
        `device/${state.serial}/request`,
        JSON.stringify({ pushing: { sequence_id: "0", command: "pushall" } }),
        { qos: 0 },
      );
    }
  });

  client.on("error", (e) => console.error("Printer MQTT error:", e.message));
  return client;
}

// Reads the `printers` table and opens an MQTT client for every row not already watched.
// Safe to call repeatedly (startup + interval): existing clients are left untouched.
async function syncPrinters(db, connect = mqtt.connect) {
  const rows = await db.execute(
    sql`select id, serial_number, ip_address, access_code from printers`,
  );
  for (const row of rows) {
    if (watched.has(row.id)) continue;
    console.log(`→ Watching printer ${row.serial_number} @ ${row.ip_address}`);
    watched.set(
      row.id,
      watchPrinter(row.ip_address, row.access_code, row.serial_number, connect),
    );
    bridgeHost ??= row.ip_address;
  }
  return rows;
}

// HTTP + WebSocket on one port: upgrades go to the bridge, plain GETs to the state API.
// `printerIp` is an optional override for the WS bridge target (defaults to bridgeHost).
function start(port, printerIp) {
  const server = http.createServer((req, res) => {
    if (req.url !== "/printers") {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify([...printers.values()]));
  });

  const wss = new WebSocketServer({ server });
  wss.on("connection", (ws) => {
    const host = printerIp || bridgeHost;
    if (!host) {
      console.error("→ Dashboard connected but no printer is registered yet");
      ws.close();
      return;
    }
    console.log("→ Dashboard connected");
    const tcp = tls.connect({ host, port: PRINTER_PORT, rejectUnauthorized: false });

    tcp.on("secureConnect", () => console.log("→ Printer TLS connected ✓"));
    tcp.on("error", (e) => {
      console.error("Printer error:", e.message);
      ws.close();
    });
    tcp.on("close", () => ws.close());
    tcp.on("data", (data) => {
      if (ws.readyState === ws.OPEN) ws.send(data);
    });

    ws.on("message", (data) => tcp.write(data));
    ws.on("close", () => {
      console.log("→ Dashboard disconnected");
      tcp.destroy();
    });
    ws.on("error", (e) => {
      console.error("WS error:", e.message);
      tcp.destroy();
    });
  });

  server.listen(port);
  return server;
}

if (require.main === module) {
  loadEnv();
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }

  const port = Number(process.env.WS_PORT) || 9001;
  const db = drizzle(postgres(process.env.DATABASE_URL));

  start(port).on("listening", () => {
    console.log(`\n🖨  B.L.A.Z.E MQTT gateway`);
    console.log(`   WebSocket: ws://localhost:${port}`);
    console.log(`   State    : http://localhost:${port}/printers\n`);
  });

  const reload = () =>
    syncPrinters(db).catch((e) => console.error("printers reload failed:", e.message));
  reload();
  setInterval(reload, PRINTERS_RELOAD_MS).unref();
}

module.exports = { start, watchPrinter, syncPrinters, handleReport, printers, watched };
