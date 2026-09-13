import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

// Hits the real Supabase project from .env (like db/printers-rls.integration.test.ts) — no mocks.
for (const line of readFileSync(".env", "utf8").split("\n")) {
  const match = line.match(/^([A-Z_]+)=(.*)$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^"|"$/g, "");
}

const sql = postgres(process.env.DIRECT_URL!);

// Same DB-layer sign-up simulation as db/rls.integration.test.ts (avoids the Auth API
// email-confirmation rate limit): insert into auth.users, let handle_new_user() provision.
async function createAuthUser(email: string, organizationName: string): Promise<string> {
  const id = randomUUID();
  await sql`
    insert into auth.users (id, aud, role, email, raw_user_meta_data)
    values (${id}, 'authenticated', 'authenticated', ${email}, jsonb_build_object('organization_name', ${organizationName}::text))
  `;
  return id;
}

// Impersonates a logged-in user the way PostgREST does: SET ROLE authenticated + the JWT
// `sub` claim over DIRECT_URL — exactly what a direct call to Supabase's REST API for
// `jobs`/`notifications` would hit (not going through /api/jobs/* or the server's
// DATABASE_URL role).
async function asUser<T>(userId: string, fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`set local role authenticated`;
    await tx`select set_config('request.jwt.claim.sub', ${userId}, true)`;
    return fn(tx);
  });
}

describe("jobs & notifications RLS: deny-all from the client (live Supabase)", () => {
  const suffix = randomUUID().slice(0, 8);
  const ownerOrgName = `jn-rls-owner-org-${suffix}`;
  const otherOrgName = `jn-rls-other-org-${suffix}`;
  let ownerId: string;
  let otherUserId: string;
  let jobId: string;
  let notificationId: string;

  afterAll(async () => {
    if (jobId) await sql`delete from notifications where job_id = ${jobId}`;
    if (jobId) await sql`delete from jobs where id = ${jobId}`;
    for (const id of [ownerId, otherUserId].filter(Boolean)) {
      await sql`delete from user_profiles where id = ${id}`;
      await sql`delete from auth.users where id = ${id}`;
    }
    await sql`delete from organizations where name in ${sql([ownerOrgName, otherOrgName])}`;
    await sql.end();
  });

  it("blocks another org's user from reading a job or notification they don't own", async () => {
    ownerId = await createAuthUser(`jn-rls-${suffix}-owner@tec.mx`, ownerOrgName);
    otherUserId = await createAuthUser(`jn-rls-${suffix}-other@tec.mx`, otherOrgName);
    const [org] = await sql`select id from organizations where name = ${ownerOrgName}`;

    // Server (table owner via DIRECT_URL, not subject to RLS) inserts real rows, the
    // same way pages/api/jobs/upload.ts and the gateway do.
    const [job] = await sql`
      insert into jobs (user_id, organization_id, file_name, file_path)
      values (${ownerId}, ${org.id}, 'test.gcode', 'print-files/test.gcode')
      returning id
    `;
    jobId = job.id;
    const [notification] = await sql`
      insert into notifications (user_id, job_id, type, message)
      values (${ownerId}, ${jobId}, 'job_waiting', 'test notification')
      returning id
    `;
    notificationId = notification.id;

    expect(await asUser(otherUserId, (tx) => tx`select * from jobs where id = ${jobId}`)).toHaveLength(0);
    expect(
      await asUser(otherUserId, (tx) => tx`select * from notifications where id = ${notificationId}`),
    ).toHaveLength(0);
  });

  it("blocks another org's user from patching a job or notification they don't own", async () => {
    await expect(
      asUser(otherUserId, (tx) => tx`update jobs set status = 'failed' where id = ${jobId}`),
    ).resolves.toHaveLength(0); // matches no visible row rather than erroring, same as printers
    await expect(
      asUser(otherUserId, (tx) => tx`update notifications set read_at = now() where id = ${notificationId}`),
    ).resolves.toHaveLength(0);

    const [jobRow] = await sql`select status from jobs where id = ${jobId}`;
    expect(jobRow!.status).toBe("queued");
    const [notifRow] = await sql`select read_at from notifications where id = ${notificationId}`;
    expect(notifRow!.read_at).toBeNull();
  });

  it("blocks another org's user from deleting a job or notification they don't own", async () => {
    await asUser(otherUserId, (tx) => tx`delete from notifications where id = ${notificationId}`);
    await asUser(otherUserId, (tx) => tx`delete from jobs where id = ${jobId}`);

    expect(await sql`select id from jobs where id = ${jobId}`).toHaveLength(1);
    expect(await sql`select id from notifications where id = ${notificationId}`).toHaveLength(1);
  });

  // True deny-all (mirrors db/printers-rls.integration.test.ts): the owner's own JWT
  // session is blocked too, not just a non-owner's. All legitimate access goes through
  // pages/api/jobs/**, pages/api/notifications/** and the gateway (owner-role DATABASE_URL
  // connection, RLS-exempt) — the client never talks to these tables directly.
  it("blocks the owner's own session from reading, patching or deleting via REST", async () => {
    expect(await asUser(ownerId, (tx) => tx`select * from jobs where id = ${jobId}`)).toHaveLength(0);
    expect(
      await asUser(ownerId, (tx) => tx`select * from notifications where id = ${notificationId}`),
    ).toHaveLength(0);

    await expect(
      asUser(ownerId, (tx) => tx`update jobs set status = 'failed' where id = ${jobId}`),
    ).resolves.toHaveLength(0);
    await expect(
      asUser(ownerId, (tx) => tx`update notifications set read_at = now() where id = ${notificationId}`),
    ).resolves.toHaveLength(0);

    await asUser(ownerId, (tx) => tx`delete from notifications where id = ${notificationId}`);
    await asUser(ownerId, (tx) => tx`delete from jobs where id = ${jobId}`);

    const [jobRow] = await sql`select status from jobs where id = ${jobId}`;
    expect(jobRow!.status).toBe("queued");
    const [notifRow] = await sql`select read_at from notifications where id = ${notificationId}`;
    expect(notifRow!.read_at).toBeNull();
  });
});
