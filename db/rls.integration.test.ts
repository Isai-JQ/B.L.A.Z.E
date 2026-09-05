import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { organizations, userProfiles } from "./schema";

// Hits the real Supabase project from .env (like db/seed.ts) — no mocks.
for (const line of readFileSync(".env", "utf8").split("\n")) {
  const match = line.match(/^([A-Z_]+)=(.*)$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^"|"$/g, "");
}

const sql = postgres(process.env.DIRECT_URL!);
const db = drizzle(sql);

// Simulates what Supabase Auth's signUp() does at the DB layer (insert into auth.users),
// instead of calling the real Auth API: its confirmation email has a strict send-rate
// limit (a couple of sign-ups/hour on this project) that made a signUp()-based test fail
// on any rerun. This still runs the real handle_new_user() trigger end to end.
async function createAuthUser(email: string, organizationName: string): Promise<string> {
  const id = randomUUID();
  await sql`
    insert into auth.users (id, aud, role, email, raw_user_meta_data)
    values (${id}, 'authenticated', 'authenticated', ${email}, jsonb_build_object('organization_name', ${organizationName}::text))
  `;
  return id;
}

// Impersonates a logged-in user the way PostgREST does: SET ROLE authenticated plus the
// JWT's `sub` claim, over the same DIRECT_URL connection — exactly what `to:
// authenticatedRole` policies and auth.uid() check, so this exercises the real policies.
// (A real per-user session isn't available here for the same email-confirmation/rate-limit
// reason as above: this project requires confirming an email before a session exists.)
async function asUser<T>(userId: string, fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`set local role authenticated`;
    await tx`select set_config('request.jwt.claim.sub', ${userId}, true)`;
    return fn(tx);
  });
}

describe("T11b RLS policies (live Supabase)", () => {
  const suffix = randomUUID().slice(0, 8);
  const orgName = `rls-test-org-${suffix}`;
  const userIds: string[] = [];

  afterAll(async () => {
    if (userIds.length > 0) {
      await sql`delete from user_profiles where id = any(${userIds})`;
      await sql`delete from auth.users where id = any(${userIds})`;
    }
    await sql`delete from organizations where name = ${orgName}`;
    await sql.end();
  });

  it("handle_new_user trigger provisions the organization and profile", async () => {
    const email = `rls-test-${suffix}-a@blaze.test`;
    const userAId = await createAuthUser(email, orgName);
    userIds.push(userAId);

    const [org] = await db.select().from(organizations).where(eq(organizations.name, orgName));
    expect(org?.priorityTier).toBe(2);

    const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.id, userAId));
    expect(profile).toMatchObject({ email, organizationId: org!.id, role: "member" });
  });

  it("blocks a user from reading another user's profile", async () => {
    const userAId = userIds[0]!;
    const userBId = await createAuthUser(`rls-test-${suffix}-b@blaze.test`, orgName);
    userIds.push(userBId);

    const otherRows = await asUser(userAId, (tx) => tx`select * from user_profiles where id = ${userBId}`);
    expect(otherRows).toHaveLength(0);

    const ownRows = await asUser(userAId, (tx) => tx`select * from user_profiles where id = ${userAId}`);
    expect(ownRows).toHaveLength(1);
  });

  it("blocks a user from changing their own role", async () => {
    const userAId = userIds[0]!;
    await expect(
      asUser(userAId, (tx) => tx`update user_profiles set role = 'admin' where id = ${userAId}`),
    ).rejects.toThrow();

    const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.id, userAId));
    expect(profile!.role).toBe("member");
  });
});
