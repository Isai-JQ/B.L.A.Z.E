import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, it } from "vitest";

// Hits the real Supabase project from .env (like control.test.ts). Load env before
// importing lib/db.ts, which builds its connection at module load.
for (const line of readFileSync(".env", "utf8").split("\n")) {
  const match = line.match(/^([A-Z_]+)=(.*)$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^"|"$/g, "");
}

const { listNotifications } = await import("./index");
const { markRead } = await import("./[id]/read");
const { db } = await import("@/lib/db");
const { sql } = await import("drizzle-orm");

const owner = randomUUID();
const stranger = randomUUID();
const orgName = `t28-org-${randomUUID().slice(0, 8)}`;
const strangerOrg = `t28-org-${randomUUID().slice(0, 8)}`;
const jobId = randomUUID();
const ownerUnread = randomUUID();
const ownerRead = randomUUID();
const strangerNotif = randomUUID();

beforeAll(async () => {
  for (const [id, org] of [
    [owner, orgName],
    [stranger, strangerOrg],
  ] as const) {
    await db.execute(sql`
      insert into auth.users (id, aud, role, email, raw_user_meta_data)
      values (${id}, 'authenticated', 'authenticated', ${`${id}@blaze.test`},
              jsonb_build_object('organization_name', ${org}::text))
    `);
  }
  const [orgRow] = await db.execute(sql`select id from organizations where name = ${orgName}`);
  await db.execute(sql`
    insert into jobs (id, user_id, organization_id, file_name, file_path, status)
    values (${jobId}, ${owner}, ${orgRow.id}, 'a.gcode', 'pending://t28', 'failed')
  `);
  await db.execute(sql`
    insert into notifications (id, user_id, job_id, type, message, read_at) values
      (${ownerUnread}, ${owner}, ${jobId}, 'job_failed', 'yours, unread', null),
      (${ownerRead}, ${owner}, ${jobId}, 'job_waiting', 'yours, read', now()),
      (${strangerNotif}, ${stranger}, ${jobId}, 'job_failed', 'not yours', null)
  `);
});

afterAll(async () => {
  await db.execute(sql`delete from notifications where id in (${ownerUnread}, ${ownerRead}, ${strangerNotif})`);
  await db.execute(sql`delete from jobs where id = ${jobId}`);
  await db.execute(sql`delete from user_profiles where id in (${owner}, ${stranger})`);
  await db.execute(sql`delete from auth.users where id in (${owner}, ${stranger})`);
  await db.execute(sql`delete from organizations where name in (${orgName}, ${strangerOrg})`);
});

it("returns only the caller's own notifications", async () => {
  const rows = await listNotifications(owner, false);
  const ids = rows.map((r) => r.id);
  expect(ids).toContain(ownerUnread);
  expect(ids).toContain(ownerRead);
  expect(ids).not.toContain(strangerNotif);
});

it("can narrow to unread only", async () => {
  const rows = await listNotifications(owner, true);
  const ids = rows.map((r) => r.id);
  expect(ids).toContain(ownerUnread);
  expect(ids).not.toContain(ownerRead);
});

it("lets the owner mark their own notification read", async () => {
  const res = await markRead(owner, ownerUnread);
  expect(res.status).toBe(200);
  const [row] = await db.execute(sql`select read_at from notifications where id = ${ownerUnread}`);
  expect(row.read_at).not.toBeNull();
});

it("refuses to mark someone else's notification read (403) and does not touch it", async () => {
  const res = await markRead(owner, strangerNotif);
  expect(res.status).toBe(403);
  const [row] = await db.execute(sql`select read_at from notifications where id = ${strangerNotif}`);
  expect(row.read_at).toBeNull();
});

it("returns 404 for an unknown notification", async () => {
  const res = await markRead(owner, randomUUID());
  expect(res.status).toBe(404);
});
