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

// Shrink the cap so the "real bytes over the limit" test doesn't allocate 200MB.
process.env.MAX_UPLOAD_BYTES = "1000000";

const { MAX_UPLOAD_BYTES, STORAGE_BUCKET, createQueuedJob, downloadJobFile, processUpload, validateUpload } =
  await import("./upload");
const { jobs } = await import("@/db/schema");

async function* stream(...parts: Uint8Array[]) {
  for (const p of parts) yield p;
}

it("accepts a valid .gcode file under the size limit", () => {
  const res = validateUpload("benchy.gcode", 5 * 1024);
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

// T19/T20: valid upload -> one jobs row; invalid (T18-rejected) -> no row. Uses the
// real DB like db/seed.ts: insert an auth.users row so handle_new_user() provisions
// the org + profile.
const sql = postgres(process.env.DIRECT_URL!);
const rawDb = drizzle(sql);
const orgName = `t19-test-org-${randomUUID().slice(0, 8)}`;
const userId = randomUUID();
const uploadedPaths: string[] = [];

afterAll(async () => {
  if (uploadedPaths.length && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const { supabaseAdmin } = await import("@/lib/supabaseAdmin");
    for (const p of uploadedPaths) {
      const slash = p.indexOf("/");
      await supabaseAdmin().storage.from(p.slice(0, slash)).remove([p.slice(slash + 1)]);
    }
  }
  await sql`delete from notifications where user_id = ${userId}`; // T25 'job_waiting'
  await sql`delete from jobs where user_id = ${userId}`;
  await sql`delete from user_profiles where id = ${userId}`;
  await sql`delete from auth.users where id = ${userId}`;
  await sql`delete from organizations where name = ${orgName}`;
  await sql.end();
});

it("creates one queued jobs row with the right data for a valid upload", async () => {
  await sql`
    insert into auth.users (id, aud, role, email, raw_user_meta_data)
    values (${userId}, 'authenticated', 'authenticated', ${`${userId}@tec.mx`},
            jsonb_build_object('organization_name', ${orgName}::text))
  `;
  const [org] = await sql`select id from organizations where name = ${orgName}`;

  const res = await createQueuedJob(userId, "benchy.gcode", `${STORAGE_BUCKET}/benchy-fixed.gcode`);
  expect(res.status).toBe(201);

  const rows = await rawDb.select().from(jobs).where(eq(jobs.userId, userId));
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    userId,
    organizationId: org.id,
    fileName: "benchy.gcode",
    filePath: `${STORAGE_BUCKET}/benchy-fixed.gcode`,
    // 'queued' if some printer is free, 'waiting' if none is (T25): the fleet is shared
    // with proxy.test.mts, which flips printers around concurrently, so the branch
    // itself is verified there under a controlled fleet.
    status: expect.stringMatching(/^(queued|waiting)$/),
    printerId: null,
  });
});

it("does not create a jobs row when T18 validation rejects the file", async () => {
  expect(validateUpload("virus.exe", 1024).status).toBe(400);
  const rows = await rawDb.select().from(jobs).where(eq(jobs.userId, userId));
  expect(rows).toHaveLength(1); // still just the one from the valid upload above
});

// T20: real byte cap is enforced while writing, not from the declared Content-Length.
// This path returns before any storage call, so it needs no service-role key.
it("cuts off the upload when real bytes exceed the cap despite a small Content-Length, and creates no job", async () => {
  const before = await rawDb.select().from(jobs).where(eq(jobs.userId, userId));
  const half = new Uint8Array(MAX_UPLOAD_BYTES); // two of these => 2x over the cap
  const res = await processUpload(userId, "sneaky.gcode", 10, stream(half, half));
  expect(res.status).toBe(413);
  const after = await rawDb.select().from(jobs).where(eq(jobs.userId, userId));
  expect(after).toHaveLength(before.length);
});

// T20: round-trip through the private bucket. Needs SUPABASE_SERVICE_ROLE_KEY + the
// `print-files` bucket (pnpm db:push applies db/sql/002_storage_bucket.sql).
const storageIt = process.env.SUPABASE_SERVICE_ROLE_KEY ? it : it.skip;
storageIt("stores the upload in the private bucket and links a retrievable file_path", async () => {
  const content = Buffer.from("G28 ; home\nG1 X10 Y10 F3000\nG1 Z0.2\n");
  const res = await processUpload(userId, "cube.gcode", content.byteLength, stream(content));
  expect(res.status).toBe(201);

  const filePath = (res.body as { filePath: string }).filePath;
  uploadedPaths.push(filePath);
  expect(filePath.startsWith(`${STORAGE_BUCKET}/`)).toBe(true);

  const { data, error } = await downloadJobFile(filePath);
  expect(error).toBeNull();
  const back = Buffer.from(await data!.arrayBuffer());
  expect(back.equals(content)).toBe(true);
});
