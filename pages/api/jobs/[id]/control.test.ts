import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterAll, beforeAll, expect, it } from "vitest";

// Hits the real Supabase project from .env (like reorder.test.ts). Load env before
// importing lib/db.ts, which builds its connection at module load.
for (const line of readFileSync(".env", "utf8").split("\n")) {
  const match = line.match(/^([A-Z_]+)=(.*)$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^"|"$/g, "");
}

const { controlJob } = await import("./control");
const { db } = await import("@/lib/db");
const { sql } = await import("drizzle-orm");
// proxy.cjs is CommonJS: required, not imported.
const proxy = createRequire(import.meta.url)("../../../../proxy.cjs");
const { sendControlCommand, watched } = proxy;

const owner = randomUUID();
const admin = randomUUID();
const stranger = randomUUID();
const orgName = `t27-test-org-${randomUUID().slice(0, 8)}`;
const serial = `T27-${randomUUID().slice(0, 8)}`;
const jobId = randomUUID();
let printerId: string;

// Fake per-serial MQTT client, stashed in the gateway's `watched` map exactly where
// syncPrinters would put the real one. Every publish is recorded.
type Sent = { topic: string; payload: string; opts: unknown };
const sent: Sent[] = [];
const fakeClient = {
  connected: true,
  publish: (topic: string, payload: string, opts: unknown, cb: (e?: Error) => void) => {
    sent.push({ topic, payload, opts });
    cb();
  },
};

// In production the API posts to the gateway over HTTP; here we skip that hop and call
// the gateway function directly, so the test still exercises the real per-serial publish.
const dispatch = (pid: string, s: string, action: string) =>
  sendControlCommand({ id: pid, serial_number: s }, action);

const lastPayload = () => JSON.parse(sent[sent.length - 1].payload);

beforeAll(async () => {
  await db.execute(sql`
    insert into auth.users (id, aud, role, email, raw_user_meta_data)
    values (${owner}, 'authenticated', 'authenticated', ${`${owner}@tec.mx`},
            jsonb_build_object('organization_name', ${orgName}::text))
  `);
  const [org] = await db.execute(sql`select id from organizations where name = ${orgName}`);
  const [printer] = await db.execute(sql`
    insert into printers (serial_number, name, ip_address, access_code, status)
    values (${serial}, ${serial}, '10.0.0.227', 'dddd4444', 'printing') returning id
  `);
  printerId = printer.id as string;
  watched.set(printerId, fakeClient);
  await db.execute(sql`
    insert into jobs (id, user_id, organization_id, printer_id, file_name, file_path, status)
    values (${jobId}, ${owner}, ${org.id}, ${printerId}, 'c.gcode', 'pending://t27', 'printing')
  `);
});

afterAll(async () => {
  watched.delete(printerId);
  await db.execute(sql`delete from jobs where id = ${jobId}`);
  await db.execute(sql`delete from printers where serial_number = ${serial}`);
  await db.execute(sql`delete from user_profiles where id = ${owner}`);
  await db.execute(sql`delete from auth.users where id = ${owner}`);
  await db.execute(sql`delete from organizations where name = ${orgName}`);
});

it("lets the job owner pause, resume and stop, firing the right MQTT message each time", async () => {
  for (const action of ["pause", "resume", "stop"] as const) {
    sent.length = 0;
    const res = await controlJob(owner, "member", jobId, action, dispatch);
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0].topic).toBe(`device/${serial}/request`);
    expect(lastPayload()).toEqual({ print: { sequence_id: "0", command: action, param: "" } });
  }
});

it("lets an admin control someone else's job", async () => {
  sent.length = 0;
  const res = await controlJob(admin, "admin", jobId, "pause", dispatch);
  expect(res.status).toBe(200);
  expect(sent).toHaveLength(1);
  expect(sent[0].topic).toBe(`device/${serial}/request`);
});

it("rejects a third user with 403 and sends nothing", async () => {
  sent.length = 0;
  const res = await controlJob(stranger, "member", jobId, "pause", dispatch);
  expect(res.status).toBe(403);
  expect(sent).toEqual([]);
});

it("rejects an unknown action with 400 and sends nothing", async () => {
  sent.length = 0;
  const res = await controlJob(owner, "member", jobId, "restart", dispatch);
  expect(res.status).toBe(400);
  expect(sent).toEqual([]);
});

it("returns 404 for an unknown job and sends nothing", async () => {
  sent.length = 0;
  const res = await controlJob(owner, "member", randomUUID(), "pause", dispatch);
  expect(res.status).toBe(404);
  expect(sent).toEqual([]);
});
