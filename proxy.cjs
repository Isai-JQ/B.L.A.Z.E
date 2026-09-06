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
// T22: when a printer reports itself free, the highest-priority queued job (order from
// lib/queueOrder.ts) is assigned to it. That import is why this runs under tsx, not node.
//
// T23: assigning also *sends* the job: the stored file (jobs.file_path, T20) goes to the
// printer over implicit FTPS and the print is started over MQTT, ported from
// bambulabs_api (ftp_client.py / mqtt_client.start_print_3mf), which the reference repo
// drove from src/scripts/add_job.py. If sending fails for any reason the assignment is
// reverted and the next free printer of the fleet is tried.
//
// T25: jobs the upload left as 'waiting' (no printer was free at enqueue time) sit in
// the same queue as 'queued' ones; the two statuses only differ in what the user was
// told, the engine treats them as one set.
//
// Usage: pnpm gateway   (= tsx proxy.cjs)
//        WS_PORT=9001 (default) serves both the WebSocket bridge and GET /printers.

const fs = require("node:fs");
const http = require("node:http");
const tls = require("node:tls");
const mqtt = require("mqtt");
const { WebSocketServer } = require("ws");
const { drizzle } = require("drizzle-orm/postgres-js");
const { sql } = require("drizzle-orm");
const postgres = require("postgres");
const { Readable } = require("node:stream");
const ftp = require("basic-ftp");
const { calculateQueueOrder } = require("./lib/queueOrder.ts");
const { supabaseAdmin } = require("./lib/supabaseAdmin.ts");

const PRINTER_PORT = 8883;
const PRINTER_FTP_PORT = 990;
const PRINTERS_RELOAD_MS = 30_000;
const OFFLINE_CHECK_MS = 15_000;
const OFFLINE_AFTER_SECONDS = 45;

// serial -> last known state. T15 also mirrors `status` / `last_seen_at` back to the DB row.
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

// gcode_state values that mean "printer is free". Everything else (RUNNING, PAUSE,
// PREPARE, …) leaves a job occupying the bed, so it counts as 'printing'.
// ponytail: FINISH is 'idle' only until the Raspberry Pi phase adds bed-cleared confirmation.
const IDLE_GCODE_STATES = new Set(["IDLE", "FINISH"]);

// Mirrors a merged report onto the printer's DB row: `status` is 'printing' while the
// printer is still busy with a job, 'idle' when it is free; `last_seen_at` = now. (T15)
// A free printer also pulls the next queued job (T22).
async function persistReport(db, state) {
  const status = IDLE_GCODE_STATES.has(state.gcodeState) ? "idle" : "printing";
  const [row] = await db.execute(
    sql`update printers set status = ${status}, last_seen_at = now()
        where serial_number = ${state.serial} returning id`,
  );
  if (status === "idle" && row) await assignNextJob(db, row.id);
}

// Uploads the job file to the printer and starts the print (T23). Port of the reference
// flow (add_job.py → bambulabs_api): implicit FTPS on 990 as `bblp` / access code with
// PROT P, `STOR <file_name>`, then a `project_file` command on device/<serial>/request.
// Throws on any failure (FTP unreachable, login rejected, MQTT client down), which is
// what assignNextJob uses to fall back to another printer.
async function sendJob(printer, job) {
  const slash = job.file_path.indexOf("/");
  const { data, error } = await supabaseAdmin()
    .storage.from(job.file_path.slice(0, slash))
    .download(job.file_path.slice(slash + 1));
  if (error) throw new Error(`download ${job.file_path}: ${error.message}`);

  const client = new ftp.Client();
  try {
    await client.access({
      host: printer.ip_address,
      port: PRINTER_FTP_PORT,
      user: "bblp",
      password: printer.access_code,
      secure: "implicit",
      secureOptions: { rejectUnauthorized: false }, // self-signed, like the MQTT side
    });
    await client.uploadFrom(Readable.from(Buffer.from(await data.arrayBuffer())), job.file_name);
  } finally {
    client.close();
  }

  const mqttClient = watched.get(printer.id);
  if (!mqttClient?.connected) throw new Error("printer MQTT client is not connected");
  // Same payload as bambulabs_api.start_print(filename, plate_number=1).
  // ponytail: plate 1 / textured plate / AMS slot 0 hard-coded, as in the reference
  // add_job.py; make them job fields when the upload form asks for them.
  const command = {
    print: {
      command: "project_file",
      param: "Metadata/plate_1.gcode",
      file: job.file_name,
      bed_leveling: true,
      bed_type: "textured_plate",
      flow_cali: true,
      vibration_cali: true,
      url: `ftp:///${job.file_name}`,
      layer_inspect: false,
      sequence_id: "10000000",
      use_ams: true,
      ams_mapping: [0],
      skip_objects: null,
    },
  };
  await new Promise((resolve, reject) =>
    mqttClient.publish(`device/${printer.serial_number}/request`, JSON.stringify(command), { qos: 0 }, (e) =>
      e ? reject(e) : resolve(),
    ),
  );
}

// T27: pause / resume / stop the job running on a printer. Publishes the Bambu print
// control command (same shape as bambulabs_api's PAUSE/RESUME/STOP) to
// device/<serial>/request through the per-serial MQTT client this process already keeps
// for that printer (T14b/T23) — sent from the server, not the browser WS<->TLS bridge.
// Throws if the action is unknown or the printer has no connected client, which is what
// the /control HTTP hook turns into a non-2xx for the API route.
const CONTROL_ACTIONS = new Set(["pause", "resume", "stop"]);

async function sendControlCommand(printer, action) {
  if (!CONTROL_ACTIONS.has(action)) throw new Error(`unknown control action: ${action}`);
  const client = watched.get(printer.id);
  if (!client?.connected) {
    throw new Error(`no connected MQTT client for printer ${printer.serial_number}`);
  }
  const payload = JSON.stringify({ print: { sequence_id: "0", command: action, param: "" } });
  await new Promise((resolve, reject) =>
    client.publish(`device/${printer.serial_number}/request`, payload, { qos: 0 }, (e) =>
      e ? reject(e) : resolve(),
    ),
  );
}

// First job of the calculated queue that `printerId` could take, or undefined. Nothing is
// offered to a printer that already holds a job 'assigned'/'printing' (idempotent, T22).
// 'waiting' jobs (T25) compete on equal terms with 'queued' ones.
// ponytail: one SELECT per idle report per printer; if that ever shows on the DB, gate
// it on the idle transition + an enqueue-time trigger instead.
async function nextQueuedJob(db, printerId) {
  const rows = await db.execute(
    sql`select j.id, j.manual_rank, j.created_at, o.priority_tier
        from jobs j join organizations o on o.id = j.organization_id
        where j.status in ('queued', 'waiting')
          and not exists (select 1 from jobs b
                          where b.printer_id = ${printerId}
                            and b.status in ('assigned', 'printing'))`,
  );
  return calculateQueueOrder(
    rows.map((r) => ({
      id: r.id,
      priorityTier: r.priority_tier,
      createdAt: new Date(r.created_at),
      manualRank: r.manual_rank,
    })),
  )[0];
}

// A free printer of the fleet not in `exclude`: 'idle' in the DB and holding no job.
async function nextFreePrinter(db, exclude) {
  const [row] = await db.execute(
    sql`select id from printers p
        where p.status = 'idle' and p.id not in ${exclude}
          and not exists (select 1 from jobs b
                          where b.printer_id = p.id and b.status in ('assigned', 'printing'))
        limit 1`,
  );
  return row?.id ?? null;
}

// Assigns the first job of the calculated queue to a free printer (T22) and sends it
// (T23). Returns the job id, or null if nothing was assigned. The UPDATE re-checks
// status in ('queued', 'waiting') so two printers freeing up at once cannot both take the same job
// (the loser just retries on its next idle report, which is also what picks up a job
// queued while it sat idle). If sending fails — the printer's DB status said 'idle' but
// it does not answer, FTP rejects the file, MQTT is down — the assignment is reverted
// and the next free printer is tried, until one takes it or none are left (the job
// goes back to 'queued' and waits for the next idle report). A successful send moves
// the job to 'printing'. `send` is injectable so tests can fake the FTP/MQTT leg.
async function assignNextJob(db, printerId, send = module.exports.sendJob) {
  const next = await nextQueuedJob(db, printerId);
  if (!next) return null;

  const tried = [];
  for (let printer = printerId; printer; printer = await nextFreePrinter(db, tried)) {
    tried.push(printer);
    const [job] = await db.execute(
      sql`update jobs set printer_id = ${printer}, status = 'assigned'
          where id = ${next.id} and status in ('queued', 'waiting') returning id, file_name, file_path`,
    );
    if (!job) return null; // another printer claimed it first
    console.log(`→ Job ${job.id} assigned to printer ${printer}`);

    const [row] = await db.execute(
      sql`select id, ip_address, access_code, serial_number from printers where id = ${printer}`,
    );
    try {
      await send(row, job);
    } catch (e) {
      console.error(`→ Job ${job.id}: send to printer ${printer} failed (${e.message}), retrying elsewhere`);
      await db.execute(
        sql`update jobs set printer_id = null, status = 'queued' where id = ${job.id}`,
      );
      continue;
    }
    await db.execute(
      sql`update jobs set status = 'printing', started_at = now() where id = ${job.id}`,
    );
    console.log(`→ Job ${job.id} printing on printer ${printer}`);
    return job.id;
  }
  return null;
}

// Persistent MQTT client to one printer. mqtt.js handles reconnection on its own.
// `connect` is injectable so tests can supply a stub instead of a real broker.
// `db`, when given, receives status / last_seen_at writes on every report (T15).
function watchPrinter(ip, accessCode, serial, connect = mqtt.connect, db = null) {
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
    if (db) {
      persistReport(db, state).catch((e) =>
        console.error("printers persist failed:", e.message),
      );
    }
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

// Flips any printer whose last report is older than `thresholdSeconds` to 'offline'.
// The next report brings it back to 'idle'/'printing' via persistReport (T15). Runs on
// an interval so a printer that just stops talking is caught without a report. (T17)
// A job that was 'printing' on a printer that just went offline is lost: it becomes
// 'failed' with the disconnection as failure_reason, and its owner gets a 'job_failed'
// notification (T24). One statement, so the three writes land or roll back together.
async function sweepOffline(db, thresholdSeconds = OFFLINE_AFTER_SECONDS) {
  const failed = await db.execute(
    sql`with gone as (
          update printers set status = 'offline'
          where status <> 'offline'
            and (last_seen_at is null
                 or last_seen_at < now() - make_interval(secs => ${thresholdSeconds}))
          returning id, name
        ), failed as (
          update jobs j
          set status = 'failed', finished_at = now(),
              failure_reason = 'Printer ' || g.name || ' disconnected while printing'
          from gone g
          where j.printer_id = g.id and j.status = 'printing'
          returning j.id, j.user_id, j.failure_reason
        )
        insert into notifications (user_id, job_id, type, message)
        select user_id, id, 'job_failed', failure_reason from failed
        returning job_id`,
  );
  for (const row of failed) console.log(`→ Job ${row.job_id} failed: printer went offline`);
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
      watchPrinter(row.ip_address, row.access_code, row.serial_number, connect, db),
    );
    bridgeHost ??= row.ip_address;
  }
  return rows;
}

// HTTP + WebSocket on one port: upgrades go to the bridge, plain GETs to the state API.
// `printerIp` is an optional override for the WS bridge target (defaults to bridgeHost).
function start(port, printerIp) {
  const server = http.createServer((req, res) => {
    // T27: the API route (pages/api/jobs/[id]/control.ts) checks permissions, then posts
    // { printerId, serial, action } here so the command goes out over the per-serial
    // client this process owns.
    if (req.method === "POST" && req.url === "/control") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", async () => {
        try {
          const { printerId, serial, action } = JSON.parse(body || "{}");
          await sendControlCommand({ id: printerId, serial_number: serial }, action);
          res.writeHead(204).end();
        } catch (e) {
          console.error("→ /control failed:", e.message);
          res.writeHead(502, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }
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

  const sweep = () =>
    sweepOffline(db).catch((e) => console.error("offline sweep failed:", e.message));
  sweep();
  setInterval(sweep, OFFLINE_CHECK_MS).unref();
}

module.exports = {
  start,
  watchPrinter,
  syncPrinters,
  sweepOffline,
  handleReport,
  persistReport,
  assignNextJob,
  sendJob,
  sendControlCommand,
  printers,
  watched,
};
