import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterAll, beforeAll, expect, it } from "vitest";

// Hits the real Supabase project from .env (like upload.test.ts). Load env before
// importing lib/db.ts, which builds its connection at module load.
for (const line of readFileSync(".env", "utf8").split("\n")) {
  const match = line.match(/^([A-Z_]+)=(.*)$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^"|"$/g, "");
}

const { reorderJobs } = await import("./reorder");
const { db } = await import("@/lib/db");
const { calculateQueueOrder } = await import("@/lib/queueOrder");
const { sql } = await import("drizzle-orm");
// proxy.cjs is CommonJS: required, not imported.
const { assignNextJob } = createRequire(import.meta.url)("../../../proxy.cjs");

const userId = randomUUID();
const orgName = `t26-test-org-${randomUUID().slice(0, 8)}`;
const printerSerial = `T26-${randomUUID().slice(0, 8)}`;
const jobA = randomUUID();
const jobB = randomUUID();

type Row = { id: string; status: string; printer_id: string | null; manual_rank: number | null };
const rows = async (): Promise<Row[]> =>
  db.execute(sql`select id, status, printer_id, manual_rank from jobs where user_id = ${userId} order by file_name`);
const ranks = async () => Object.fromEntries((await rows()).map((r) => [r.id, r.manual_rank]));

// Same shape nextQueuedJob (proxy.cjs) feeds calculateQueueOrder with.
const queued = async () =>
  calculateQueueOrder(
    (await db.execute(sql`select j.id, j.manual_rank, j.created_at, o.priority_tier
        from jobs j join organizations o on o.id = j.organization_id
        where j.user_id = ${userId}`)).map((r) => ({
      id: r.id as string,
      priorityTier: r.priority_tier as number,
      createdAt: new Date(r.created_at as string),
      manualRank: r.manual_rank as number | null,
    })),
  ).map((j) => j.id);

beforeAll(async () => {
  await db.execute(sql`
    insert into auth.users (id, aud, role, email, raw_user_meta_data)
    values (${userId}, 'authenticated', 'authenticated', ${`${userId}@blaze.test`},
            jsonb_build_object('organization_name', ${orgName}::text))
  `);
  const [org] = await db.execute(sql`select id from organizations where name = ${orgName}`);
  // A is older, so FIFO puts it first until a rank says otherwise.
  await db.execute(sql`
    insert into jobs (id, user_id, organization_id, file_name, file_path, status, created_at)
    values (${jobA}, ${userId}, ${org.id}, 'a.gcode', 'pending://t26', 'queued', now() - interval '1 minute'),
           (${jobB}, ${userId}, ${org.id}, 'b.gcode', 'pending://t26', 'queued', now())
  `);
});

afterAll(async () => {
  await db.execute(sql`delete from jobs where user_id = ${userId}`);
  await db.execute(sql`delete from printers where serial_number = ${printerSerial}`);
  await db.execute(sql`delete from user_profiles where id = ${userId}`);
  await db.execute(sql`delete from auth.users where id = ${userId}`);
  await db.execute(sql`delete from organizations where name = ${orgName}`);
});

it("rejects a member with 403 and changes no manual_rank", async () => {
  const res = await reorderJobs("member", [
    { job_id: jobB, manual_rank: 1 },
    { job_id: jobA, manual_rank: 2 },
  ]);
  expect(res.status).toBe(403);
  expect(await ranks()).toEqual({ [jobA]: null, [jobB]: null });
  expect(await queued()).toEqual([jobA, jobB]);
});

it("rejects a malformed body with 400", async () => {
  expect((await reorderJobs("admin", [])).status).toBe(400);
  expect((await reorderJobs("admin", [{ job_id: "nope", manual_rank: 1 }])).status).toBe(400);
  expect((await reorderJobs("admin", [{ job_id: jobA, manual_rank: 1.5 }])).status).toBe(400);
  expect(await ranks()).toEqual({ [jobA]: null, [jobB]: null });
});

it("lets an admin reorder two jobs and the calculated queue reflects it", async () => {
  const res = await reorderJobs("admin", [
    { job_id: jobB, manual_rank: 1 },
    { job_id: jobA, manual_rank: 2 },
  ]);
  expect(res.status).toBe(200);
  expect(await ranks()).toEqual({ [jobA]: 2, [jobB]: 1 });
  expect(await queued()).toEqual([jobB, jobA]);
});

it("rolls the whole batch back when one job id does not exist", async () => {
  const res = await reorderJobs("admin", [
    { job_id: jobA, manual_rank: 1 },
    { job_id: randomUUID(), manual_rank: 2 },
  ]);
  expect(res.status).toBe(404);
  expect(await ranks()).toEqual({ [jobA]: 2, [jobB]: 1 }); // untouched by the failed batch
});

// Reorder racing assignNextJob over the same two jobs. Both are single statements /
// one transaction on the DB, so whichever lands first wins cleanly: either the printer
// took the job that was first *before* the swap (A) or *after* it (B). Either way the
// ranks are exactly what the admin asked for, exactly one job holds the printer, and
// the other is still queued with no printer — the swap is never half-applied.
it("keeps data consistent when a reorder runs concurrently with assignNextJob", async () => {
  const [{ id: printerId }] = await db.execute(sql`
    insert into printers (serial_number, name, ip_address, access_code, status)
    values (${printerSerial}, ${printerSerial}, '10.0.0.226', 'cccc3333', 'idle') returning id
  `);
  const sent: string[] = [];
  const fakeSend = async (_p: unknown, job: { id: string }) => void sent.push(job.id);

  // Current order is B, A (from the test above); the admin swaps it back to A, B.
  const [assigned, reorder] = await Promise.all([
    assignNextJob(db, printerId, fakeSend),
    reorderJobs("admin", [
      { job_id: jobA, manual_rank: 1 },
      { job_id: jobB, manual_rank: 2 },
    ]),
  ]);

  expect(reorder.status).toBe(200);
  expect([jobA, jobB]).toContain(assigned);
  expect(sent).toEqual([assigned]);
  expect(await ranks()).toEqual({ [jobA]: 1, [jobB]: 2 });

  const after = await rows();
  const printing = after.filter((r) => r.status === "printing");
  expect(printing).toHaveLength(1);
  expect(printing[0]).toMatchObject({ id: assigned, printer_id: printerId });
  const other = after.find((r) => r.id !== assigned)!;
  expect(other).toMatchObject({ status: "queued", printer_id: null });

  // The printer holds one job now, so a second cycle assigns nothing more — the
  // reorder's effect shows up on the next free printer, not mid-assignment.
  expect(await assignNextJob(db, printerId, fakeSend)).toBeNull();
});
