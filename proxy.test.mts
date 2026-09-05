import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { Server } from "node:http";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, expect, it } from "vitest";

// proxy.cjs is CommonJS and runs outside Next.js (plain `node proxy.cjs`), so it is
// required rather than imported.
const { start, syncPrinters, sweepOffline, handleReport, printers } =
  createRequire(import.meta.url)("./proxy.cjs");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const SERIAL = "01P00A123456789";
const report = (serial: string, print: Record<string, unknown>) =>
  handleReport(`device/${serial}/report`, Buffer.from(JSON.stringify({ print })));

const server: Server = start(0, "127.0.0.1");
afterAll(() => void server.close());

const port = () => (server.address() as { port: number }).port;
const getPrinters = async () =>
  (await fetch(`http://127.0.0.1:${port()}/printers`)).json() as Promise<
    Array<Record<string, unknown> & { serial: string }>
  >;

it("keeps simulated printer state in memory and exposes it over HTTP", async () => {
  if (!server.listening) await new Promise((resolve) => server.once("listening", resolve));

  // Simulated printer: a P1S sends one full report and then partial deltas.
  report(SERIAL, {
    gcode_state: "RUNNING",
    nozzle_temper: 219.7,
    bed_temper: 60,
    mc_percent: 42,
    layer_num: 12,
    total_layer_num: 300,
    mc_remaining_time: 51,
    gcode_file: "/data/Metadata/fred.gcode",
  });
  report(SERIAL, { mc_percent: 43, layer_num: 13, nozzle_temper: 220.1 });

  // Junk is ignored instead of clobbering the state.
  expect(handleReport(`device/${SERIAL}/report`, Buffer.from("not json"))).toBeNull();
  expect(handleReport("device//report", Buffer.from("{}"))).toBeNull();

  const body = await getPrinters();
  expect(body).toHaveLength(1);
  expect(body[0]).toMatchObject({
    serial: SERIAL,
    gcodeState: "RUNNING",
    nozzleTemp: 220.1,
    bedTemp: 60,
    printPercent: 43,
    layerNum: 13,
    // Untouched by the delta report, so it must survive from the first one.
    totalLayerNum: 300,
    remainingTime: 51,
    gcodeFile: "/data/Metadata/fred.gcode",
  });
  expect(Date.parse(body[0].lastReportAt as string)).not.toBeNaN();
  expect(printers.size).toBe(1);
});

// ---------------------------------------------------------------------------
// T14b: fleet is read from the `printers` table, one MQTT client per row, and
// GET /printers serves the combined state. Uses the live Supabase project from
// .env (like db/rls.integration.test.ts); MQTT is stubbed for both printers.
// ---------------------------------------------------------------------------

for (const line of readFileSync(".env", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

const sql = postgres(process.env.DATABASE_URL!);
const db = drizzle(sql);

const suffix = randomUUID().slice(0, 8);
const fleet = [
  { serial: `T14B-A-${suffix}`, ip: "10.0.0.201", code: "aaaa1111" },
  { serial: `T14B-B-${suffix}`, ip: "10.0.0.202", code: "bbbb2222" },
];

// Stub MQTT client: records the connect args and lets the test push messages
// through the same `on("message")` path a real broker would drive.
interface Stub {
  url: string;
  password: string;
  emit(ev: string, ...a: unknown[]): void;
  on(ev: string, fn: (...a: unknown[]) => void): void;
  subscribe(): void;
  publish(): void;
  end(): void;
}
const stubs: Stub[] = [];
const fakeConnect = (url: string, opts: { password: string }): Stub => {
  const handlers: Record<string, (...a: unknown[]) => void> = {};
  const stub: Stub = {
    url,
    password: opts.password,
    emit: (ev, ...a) => handlers[ev]?.(...a),
    on: (ev, fn) => void (handlers[ev] = fn),
    subscribe: () => {},
    publish: () => {},
    end: () => {},
  };
  stubs.push(stub);
  return stub;
};

beforeAll(async () => {
  for (const p of fleet) {
    await sql`
      insert into printers (serial_number, name, ip_address, access_code, status)
      values (${p.serial}, ${p.serial}, ${p.ip}, ${p.code}, 'offline')
    `;
  }
  printers.clear();
});

afterAll(async () => {
  await sql`delete from printers where serial_number = any(${fleet.map((p) => p.serial)})`;
  await sql.end();
});

it("watches every registered printer and serves their combined state", async () => {
  const rows = (await syncPrinters(db, fakeConnect)) as Array<{ serial_number: string }>;
  const mine = rows.filter(
    (r) => r.serial_number.startsWith("T14B-") && r.serial_number.endsWith(suffix),
  );
  expect(mine).toHaveLength(2);

  // One MQTT client opened per row, dialed with the row's access_code.
  const opened = stubs.filter((s) => s.url.includes("10.0.0.20"));
  expect(opened).toHaveLength(2);
  expect(opened.map((s) => s.password).sort()).toEqual(["aaaa1111", "bbbb2222"]);

  // Each printer reports over its own client; state lands in the shared map.
  opened
    .find((s) => s.url.includes("10.0.0.201"))!
    .emit(
      "message",
      `device/${fleet[0].serial}/report`,
      Buffer.from(JSON.stringify({ print: { gcode_state: "RUNNING", mc_percent: 10 } })),
    );
  opened
    .find((s) => s.url.includes("10.0.0.202"))!
    .emit(
      "message",
      `device/${fleet[1].serial}/report`,
      Buffer.from(JSON.stringify({ print: { gcode_state: "IDLE", mc_percent: 0 } })),
    );

  const bySerial = Object.fromEntries((await getPrinters()).map((s) => [s.serial, s]));
  expect(bySerial[fleet[0].serial]).toMatchObject({ gcodeState: "RUNNING", printPercent: 10 });
  expect(bySerial[fleet[1].serial]).toMatchObject({ gcodeState: "IDLE", printPercent: 0 });

  // A second sync is a no-op for rows already watched: no extra clients.
  await syncPrinters(db, fakeConnect);
  expect(stubs.filter((s) => s.url.includes("10.0.0.20"))).toHaveLength(2);
});

// ---------------------------------------------------------------------------
// T15: every merged report also writes `status` / `last_seen_at` back to the
// printer's row. Same T14b stub path: emit a message on a printer's client and
// then read the row straight from Supabase.
// ---------------------------------------------------------------------------

const rowFor = async (serial: string) =>
  (
    await sql<{ status: string; last_seen_at: string | null }[]>`
      select status, last_seen_at from printers where serial_number = ${serial}
    `
  )[0];

const waitForStatus = async (serial: string, want: string) => {
  for (let i = 0; i < 40; i++) {
    const row = await rowFor(serial);
    if (row.status === want) return row;
    await sleep(25);
  }
  throw new Error(`timeout: ${serial} never reached status=${want}`);
};

it("writes status and last_seen_at back to the printers row on each report", async () => {
  await syncPrinters(db, fakeConnect);
  const client = stubs.find((s) => s.url.includes("10.0.0.201"))!;
  const emit = (print: Record<string, unknown>) =>
    client.emit(
      "message",
      `device/${fleet[0].serial}/report`,
      Buffer.from(JSON.stringify({ print })),
    );

  emit({ gcode_state: "RUNNING", mc_percent: 5 });
  const printing = await waitForStatus(fleet[0].serial, "printing");
  expect(Date.parse(printing.last_seen_at as string)).not.toBeNaN();

  emit({ gcode_state: "IDLE" });
  await waitForStatus(fleet[0].serial, "idle");

  // A paused print still occupies the bed: the printer is busy, not free.
  emit({ gcode_state: "PAUSE" });
  await waitForStatus(fleet[0].serial, "printing");
});

// ---------------------------------------------------------------------------
// T17: a periodic sweep marks a printer 'offline' once its last report is older
// than the threshold, and leaves printers that are still reporting alone. A
// later report brings it back via the T15 path.
// ---------------------------------------------------------------------------

it("marks a stale printer offline on sweep without touching the others (T17)", async () => {
  await syncPrinters(db, fakeConnect);
  const emit = (ip: string, serial: string, print: Record<string, unknown>) =>
    stubs
      .find((s) => s.url.includes(ip))!
      .emit("message", `device/${serial}/report`, Buffer.from(JSON.stringify({ print })));

  emit("10.0.0.201", fleet[0].serial, { gcode_state: "RUNNING", mc_percent: 5 });
  emit("10.0.0.202", fleet[1].serial, { gcode_state: "IDLE" });
  await waitForStatus(fleet[0].serial, "printing");
  await waitForStatus(fleet[1].serial, "idle");

  // fleet[0] stops reporting: age its last_seen_at past the threshold. fleet[1] stays fresh.
  await sql`update printers set last_seen_at = now() - interval '90 seconds' where serial_number = ${fleet[0].serial}`;
  await sweepOffline(db, 30);

  expect((await rowFor(fleet[0].serial)).status).toBe("offline");
  expect((await rowFor(fleet[1].serial)).status).toBe("idle");

  // It reports again → back to a live status.
  emit("10.0.0.201", fleet[0].serial, { gcode_state: "RUNNING", mc_percent: 6 });
  await waitForStatus(fleet[0].serial, "printing");
});
