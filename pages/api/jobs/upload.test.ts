import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, expect, it } from "vitest";

// upload.ts imports lib/supabase.ts + lib/db.ts, which build from env at module load.
for (const line of readFileSync(".env", "utf8").split("\n")) {
  const match = line.match(/^([A-Z_]+)=(.*)$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^"|"$/g, "");
}

const { MAX_UPLOAD_BYTES, PENDING_FILE_PATH, createQueuedJob, validateUpload } = await import(
  "./upload"
);
const { jobs } = await import("@/db/schema");

it("accepts a valid .gcode file under the size limit", () => {
  const res = validateUpload("benchy.gcode", 5 * 1024 * 1024);
  expect(res.status).toBe(200);
});

it("accepts a valid .3mf file (case-insensitive extension)", () => {
  expect(validateUpload("part.3MF", 1024).status).toBe(200);
});

it("rejects a wrong extension with a clear 400", () => {
  const res = validateUpload("virus.exe", 1024);
  expect(res.status).toBe(400);
  expect((res.body as { error: string }).error).toContain(".gcode, .3mf");
});

it("rejects a file over the size limit with a clear 400", () => {
  const res = validateUpload("huge.gcode", MAX_UPLOAD_BYTES + 1);
  expect(res.status).toBe(400);
  expect((res.body as { error: string }).error).toContain("too large");
});

it("rejects a missing / zero size", () => {
  expect(validateUpload("a.gcode", 0).status).toBe(400);
  expect(validateUpload("a.gcode", NaN).status).toBe(400);
});

// T19: a valid upload inserts one jobs row; an invalid one (T18-rejected) never
// reaches createQueuedJob, so no row is created. Uses the real DB like db/seed.ts:
// insert an auth.users row so handle_new_user() provisions the org + profile.
const sql = postgres(process.env.DIRECT_URL!);
const rawDb = drizzle(sql);
const orgName = `t19-test-org-${randomUUID().slice(0, 8)}`;
const userId = randomUUID();

afterAll(async () => {
  await sql`delete from jobs where user_id = ${userId}`;
  await sql`delete from user_profiles where id = ${userId}`;
  await sql`delete from auth.users where id = ${userId}`;
  await sql`delete from organizations where name = ${orgName}`;
  await sql.end();
});

it("creates one queued jobs row with the right data for a valid upload", async () => {
  await sql`
    insert into auth.users (id, aud, role, email, raw_user_meta_data)
    values (${userId}, 'authenticated', 'authenticated', ${`${userId}@blaze.test`},
            jsonb_build_object('organization_name', ${orgName}::text))
  `;
  const [org] = await sql`select id from organizations where name = ${orgName}`;

  const res = await createQueuedJob(userId, "benchy.gcode");
  expect(res.status).toBe(201);

  const rows = await rawDb.select().from(jobs).where(eq(jobs.userId, userId));
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    userId,
    organizationId: org.id,
    fileName: "benchy.gcode",
    filePath: PENDING_FILE_PATH,
    status: "queued",
    printerId: null,
  });
});

it("does not create a jobs row when T18 validation rejects the file", async () => {
  expect(validateUpload("virus.exe", 1024).status).toBe(400);
  const rows = await rawDb.select().from(jobs).where(eq(jobs.userId, userId));
  expect(rows).toHaveLength(1); // still just the one from the valid upload above
});
