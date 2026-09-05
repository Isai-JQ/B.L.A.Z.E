// Bambu Lab MQTT gateway — B.L.A.Z.E v2 (T14)
//
// Adapted from `proxy.cjs` of Automatize-3D-printers, which was only a WS<->TLS byte
// bridge for the browser. This version keeps that bridge (the dashboard still speaks MQTT
// over WebSocket) and adds its own MQTT client to the printer, so fleet state is tracked
// in this process and survives with no browser open.
//
// Usage: node proxy.cjs <printer-ip> <access-code> [serial]
//        WS_PORT=9001 (default) serves both the WebSocket bridge and GET /printers.

const http = require("node:http");
const tls = require("node:tls");
const mqtt = require("mqtt");
const { WebSocketServer } = require("ws");

const PRINTER_PORT = 8883;

// serial -> last known state. Memory only: writing it back to the `printers` table is T15.
const printers = new Map();

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
function watchPrinter(ip, accessCode, serial) {
  const client = mqtt.connect(`mqtts://${ip}:${PRINTER_PORT}`, {
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
    if (state && !known) {
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

// HTTP + WebSocket on one port: upgrades go to the bridge, plain GETs to the state API.
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
    console.log("→ Dashboard connected");
    const tcp = tls.connect({ host: printerIp, port: PRINTER_PORT, rejectUnauthorized: false });

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
  const [ip, accessCode, serial] = process.argv.slice(2);
  if (!ip || !accessCode) {
    console.error("Usage: node proxy.cjs <printer-ip> <access-code> [serial]");
    process.exit(1);
  }

  const port = Number(process.env.WS_PORT) || 9001;
  start(port, ip).on("listening", () => {
    console.log(`\n🖨  B.L.A.Z.E MQTT gateway`);
    console.log(`   Printer  : ${ip}:${PRINTER_PORT}`);
    console.log(`   WebSocket: ws://localhost:${port}`);
    console.log(`   State    : http://localhost:${port}/printers\n`);
  });
  watchPrinter(ip, accessCode, serial);
}

module.exports = { start, watchPrinter, handleReport, printers };
