import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { Server } from "node:http";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, expect, it } from "vitest";

// proxy.cjs is CommonJS and runs outside Next.js (plain `node proxy.cjs`), so it is
// required rather than imported.
const proxy = createRequire(import.meta.url)("./proxy.cjs");
const { start, syncPrinters, sweepOffline, handleReport, printers } = proxy;

// T23: fake FTP/MQTT leg. Printers whose IP is in `unreachable` behave like a P1S that
// the DB still lists as idle but does not answer: the send throws, as basic-ftp would.
const unreachable = new Set<string>();
const sent: Array<{ ip: string; jobId: string }> = [];
proxy.sendJob = async (printer: { ip_address: string }, job: { id: string }) => {
  sent.push({ ip: printer.ip_address, jobId: job.id });
  if (unreachable.has(printer.ip_address)) throw new Error(`connect ETIMEDOUT ${printer.ip_address}:990`);
};

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

// ---------------------------------------------------------------------------
// T22: a printer that reports itself free pulls the first job of the calculated
// queue (tier → FIFO → manual_rank) and gets it as `assigned`; since T23 the
// send then moves it to `printing`. Two orgs: the trigger-provisioned one (tier 2)
// and a tier-1 one inserted by hand, so the later, higher-priority job must win.
// A printer holding a job takes nothing more; the next free printer takes what
// is left.
// ---------------------------------------------------------------------------

const t22 = {
  userId: randomUUID(),
  orgName: `t22-test-org-${suffix}`,
  topOrgName: `t22-test-top-org-${suffix}`,
  jobLow: randomUUID(),
  jobTop: randomUUID(),
  jobT23: randomUUID(),
};

// Registered after the T14b afterAll, so with vitest's default "stack" hook order
// this cleanup runs first — before that hook calls sql.end().
afterAll(async () => {
  await sql`delete from notifications where user_id = ${t22.userId}`;
  await sql`delete from jobs where user_id = ${t22.userId}`;
  await sql`delete from user_profiles where id = ${t22.userId}`;
  await sql`delete from auth.users where id = ${t22.userId}`;
  await sql`delete from organizations where name in (${t22.orgName}, ${t22.topOrgName})`;
});

const jobRow = async (id: string) =>
  (
    await sql<{ status: string; printer_id: string | null }[]>`
      select status, printer_id from jobs where id = ${id}
    `
  )[0];

const waitForJobStatus = async (id: string, want: string) => {
  for (let i = 0; i < 40; i++) {
    const row = await jobRow(id);
    if (row.status === want) return row;
    await sleep(25);
  }
  throw new Error(`timeout: job ${id} never reached status=${want}`);
};

const until = async (cond: () => boolean | Promise<boolean>, what: string) => {
  for (let i = 0; i < 80; i++) {
    if (await cond()) return;
    await sleep(25);
  }
  throw new Error(`timeout: ${what}`);
};

it("assigns the highest-priority queued job to a printer that becomes free (T22)", async () => {
  await sql`
    insert into auth.users (id, aud, role, email, raw_user_meta_data)
    values (${t22.userId}, 'authenticated', 'authenticated', ${`${t22.userId}@blaze.test`},
            jsonb_build_object('organization_name', ${t22.orgName}::text))
  `;
  const [lowOrg] = await sql`select id from organizations where name = ${t22.orgName}`;
  const [topOrg] = await sql`
    insert into organizations (name, priority_tier) values (${t22.topOrgName}, 1) returning id
  `;
  // Tier-2 job queued first, tier-1 job queued a minute later: tier beats FIFO.
  await sql`
    insert into jobs (id, user_id, organization_id, file_name, file_path, status, created_at)
    values (${t22.jobLow}, ${t22.userId}, ${lowOrg.id}, 'low.gcode', 'pending://t22', 'queued', now() - interval '1 minute'),
           (${t22.jobTop}, ${t22.userId}, ${topOrg.id}, 'top.gcode', 'pending://t22', 'queued', now())
  `;
  const [{ id: printerB }] = await sql`select id from printers where serial_number = ${fleet[1].serial}`;
  const [{ id: printerA }] = await sql`select id from printers where serial_number = ${fleet[0].serial}`;

  await syncPrinters(db, fakeConnect);
  const emit = (ip: string, serial: string, print: Record<string, unknown>) =>
    stubs
      .find((s) => s.url.includes(ip))!
      .emit("message", `device/${serial}/report`, Buffer.from(JSON.stringify({ print })));

  // Printer B finishes its print → free → takes the tier-1 job, not the older tier-2 one.
  emit("10.0.0.202", fleet[1].serial, { gcode_state: "FINISH" });
  expect(await waitForJobStatus(t22.jobTop, "printing")).toMatchObject({ printer_id: printerB });
  expect(sent).toContainEqual({ ip: "10.0.0.202", jobId: t22.jobTop });
  expect(await jobRow(t22.jobLow)).toMatchObject({ status: "queued", printer_id: null });

  // B keeps reporting idle while it holds an assigned job: it must not grab a second one.
  emit("10.0.0.202", fleet[1].serial, { gcode_state: "IDLE" });
  await waitForStatus(fleet[1].serial, "idle");
  await sleep(200);
  expect(await jobRow(t22.jobLow)).toMatchObject({ status: "queued", printer_id: null });

  // Printer A frees up → takes the remaining job.
  emit("10.0.0.201", fleet[0].serial, { gcode_state: "IDLE" });
  expect(await waitForJobStatus(t22.jobLow, "printing")).toMatchObject({ printer_id: printerA });
});

// ---------------------------------------------------------------------------
// T23: the printer that frees up is 'idle' in the DB but does not answer when
// the job is sent (FTP/MQTT fake throws). The assignment is reverted and the
// job ends up printing on the other free printer. With no printer answering,
// the job goes back to 'queued' with no printer, waiting for the next report.
// ---------------------------------------------------------------------------

it("falls back to the next free printer when the send fails (T23)", async () => {
  // Both printers are free again: the T22 jobs are done.
  await sql`update jobs set status = 'completed' where user_id = ${t22.userId}`;
  const [lowOrg] = await sql`select id from organizations where name = ${t22.orgName}`;
  await sql`
    insert into jobs (id, user_id, organization_id, file_name, file_path, status)
    values (${t22.jobT23}, ${t22.userId}, ${lowOrg.id}, 't23.3mf', 'pending://t23', 'queued')
  `;
  const [{ id: printerA }] = await sql`select id from printers where serial_number = ${fleet[0].serial}`;
  const [{ id: printerB }] = await sql`select id from printers where serial_number = ${fleet[1].serial}`;
  await sql`update printers set status = 'idle' where id in (${printerA}, ${printerB})`;

  await syncPrinters(db, fakeConnect);
  const emit = (ip: string, serial: string, print: Record<string, unknown>) =>
    stubs
      .find((s) => s.url.includes(ip))!
      .emit("message", `device/${serial}/report`, Buffer.from(JSON.stringify({ print })));

  // Nobody answers: the job is tried on B, then A, and returns to the queue unassigned.
  unreachable.add("10.0.0.202").add("10.0.0.201");
  sent.length = 0;
  emit("10.0.0.202", fleet[1].serial, { gcode_state: "IDLE" });
  await until(() => sent.length === 2, "job tried on both printers");
  expect(sent.map((s) => s.ip)).toEqual(["10.0.0.202", "10.0.0.201"]);
  await until(async () => (await jobRow(t22.jobT23)).printer_id === null, "assignment reverted");
  expect(await jobRow(t22.jobT23)).toMatchObject({ status: "queued", printer_id: null });

  // B reports idle again but still does not answer; A does → the job prints on A.
  unreachable.delete("10.0.0.201");
  sent.length = 0;
  emit("10.0.0.202", fleet[1].serial, { gcode_state: "IDLE" });
  expect(await waitForJobStatus(t22.jobT23, "printing")).toMatchObject({ printer_id: printerA });
  expect(sent.map((s) => s.ip)).toEqual(["10.0.0.202", "10.0.0.201"]);
  expect(Date.parse((await sql`select started_at from jobs where id = ${t22.jobT23}`)[0].started_at)).not.toBeNaN();
});

// ---------------------------------------------------------------------------
// T24: the printer running a job stops reporting. The T17 sweep flips it to
// 'offline' and, in the same statement, fails the job it was printing and
// notifies its owner. The other printer and its queued job are untouched.
// ---------------------------------------------------------------------------

it("fails the printing job and notifies its owner when its printer goes offline (T24)", async () => {
  // Leaves T23 with jobT23 printing on A. Give B a queued job it has not taken.
  const [lowOrg] = await sql`select id from organizations where name = ${t22.orgName}`;
  const queued = randomUUID();
  await sql`
    insert into jobs (id, user_id, organization_id, file_name, file_path, status)
    values (${queued}, ${t22.userId}, ${lowOrg.id}, 't24.gcode', 'pending://t24', 'queued')
  `;
  await sql`update printers set status = 'printing', last_seen_at = now() - interval '90 seconds'
            where serial_number = ${fleet[0].serial}`;
  await sql`update printers set status = 'printing', last_seen_at = now() where serial_number = ${fleet[1].serial}`;

  await sweepOffline(db, 30);

  expect((await rowFor(fleet[0].serial)).status).toBe("offline");
  expect(await jobRow(t22.jobT23)).toMatchObject({ status: "failed" });
  const [job] = await sql`select failure_reason, finished_at from jobs where id = ${t22.jobT23}`;
  expect(job.failure_reason).toMatch(/disconnected/);
  expect(job.finished_at).not.toBeNull();
  const notes = await sql`select user_id, type, message from notifications where job_id = ${t22.jobT23}`;
  expect(notes).toHaveLength(1);
  expect(notes[0]).toMatchObject({ user_id: t22.userId, type: "job_failed", message: job.failure_reason });

  // Untouched: the live printer and the job that was only queued.
  expect((await rowFor(fleet[1].serial)).status).toBe("printing");
  expect(await jobRow(queued)).toMatchObject({ status: "queued", printer_id: null });

  // A second sweep does not fail it twice or notify again.
  await sweepOffline(db, 30);
  expect(await sql`select 1 from notifications where job_id = ${t22.jobT23}`).toHaveLength(1);
});

// ---------------------------------------------------------------------------
// T25: a job uploaded while no printer is free (A offline, B printing after T24)
// is created as 'waiting' and its owner is notified. When B later frees up, the
// waiting job is assigned and sent exactly like a queued one would be.
// ---------------------------------------------------------------------------

it("leaves a new job waiting with a notification when no printer is free, then assigns it once one frees up (T25)", async () => {
  // Nothing else in the queue, so the waiting job is the next one when B frees up.
  await sql`update jobs set status = 'completed' where user_id = ${t22.userId} and status = 'queued'`;
  expect((await rowFor(fleet[0].serial)).status).toBe("offline");
  expect((await rowFor(fleet[1].serial)).status).toBe("printing");

  const { createQueuedJob } = await import("./pages/api/jobs/upload");
  const res = await createQueuedJob(t22.userId, "t25.gcode", "pending://t25");
  expect(res.status).toBe(201);
  const jobId = (res.body as { id: string }).id;
  expect(await jobRow(jobId)).toMatchObject({ status: "waiting", printer_id: null });
  const notes = await sql`select user_id, type, message from notifications where job_id = ${jobId}`;
  expect(notes).toHaveLength(1);
  expect(notes[0]).toMatchObject({ user_id: t22.userId, type: "job_waiting" });
  expect(notes[0].message).toMatch(/waiting/);

  // B finishes its print and answers again → it takes the waiting job like a queued one.
  unreachable.delete("10.0.0.202");
  const [{ id: printerB }] = await sql`select id from printers where serial_number = ${fleet[1].serial}`;
  await syncPrinters(db, fakeConnect);
  stubs
    .find((s) => s.url.includes("10.0.0.202"))!
    .emit("message", `device/${fleet[1].serial}/report`, Buffer.from(JSON.stringify({ print: { gcode_state: "FINISH" } })));
  expect(await waitForJobStatus(jobId, "printing")).toMatchObject({ printer_id: printerB });
  expect(sent).toContainEqual({ ip: "10.0.0.202", jobId });
});
