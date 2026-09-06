import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, it } from "vitest";

// Hits the real Supabase project from .env (like reorder.test.ts). Load env before
// importing lib/db.ts, which builds its connection at module load.
for (const line of readFileSync(".env", "utf8").split("\n")) {
  const match = line.match(/^([A-Z_]+)=(.*)$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^"|"$/g, "");
}

const { listQueue } = await import("./queue");
const { db } = await import("@/lib/db");
const { sql } = await import("drizzle-orm");

const tier1User = randomUUID();
const tier2User = randomUUID();
const tier1Org = `t32-tier1-${randomUUID().slice(0, 8)}`;
const tier2Org = `t32-tier2-${randomUUID().slice(0, 8)}`;

const jManual = randomUUID(); // tier 2, newest, manual_rank 1 -> jumps to the front
const jHiOld = randomUUID(); // tier 1, older
const jHiNew = randomUUID(); // tier 1, newer
const jLoOld = randomUUID(); // tier 2, oldest overall but lower tier
const jDone = randomUUID(); // completed -> excluded from the queue

const names = new Set(["manual.gcode", "hi-old.gcode", "hi-new.gcode", "lo-old.gcode", "done.gcode"]);

beforeAll(async () => {
  for (const [id, org] of [
    [tier1User, tier1Org],
    [tier2User, tier2Org],
  ] as const) {
    await db.execute(sql`
      insert into auth.users (id, aud, role, email, raw_user_meta_data)
      values (${id}, 'authenticated', 'authenticated', ${`${id}@tec.mx`},
              jsonb_build_object('organization_name', ${org}::text))
    `);
  }
  await db.execute(sql`update organizations set priority_tier = 1 where name = ${tier1Org}`);
  const [o1] = await db.execute(sql`select id from organizations where name = ${tier1Org}`);
  const [o2] = await db.execute(sql`select id from organizations where name = ${tier2Org}`);

  await db.execute(sql`
    insert into jobs (id, user_id, organization_id, file_name, file_path, status, manual_rank, created_at) values
      (${jLoOld},  ${tier2User}, ${o2.id}, 'lo-old.gcode', 'print-files/secret/lo-old.gcode', 'queued',    null, now() - interval '10 minute'),
      (${jHiOld},  ${tier1User}, ${o1.id}, 'hi-old.gcode', 'print-files/secret/hi-old.gcode', 'printing',  null, now() - interval '5 minute'),
      (${jHiNew},  ${tier1User}, ${o1.id}, 'hi-new.gcode', 'print-files/secret/hi-new.gcode', 'assigned',  null, now() - interval '2 minute'),
      (${jManual}, ${tier2User}, ${o2.id}, 'manual.gcode', 'print-files/secret/manual.gcode', 'waiting',   1,    now()),
      (${jDone},   ${tier1User}, ${o1.id}, 'done.gcode',   'print-files/secret/done.gcode',   'completed', null, now() - interval '1 minute')
  `);
});

afterAll(async () => {
  await db.execute(sql`delete from jobs where id in (${jLoOld}, ${jHiOld}, ${jHiNew}, ${jManual}, ${jDone})`);
  await db.execute(sql`delete from user_profiles where id in (${tier1User}, ${tier2User})`);
  await db.execute(sql`delete from auth.users where id in (${tier1User}, ${tier2User})`);
  await db.execute(sql`delete from organizations where name in (${tier1Org}, ${tier2Org})`);
});

it("orders by manual_rank, then tier, then FIFO — and drops finished jobs", async () => {
  const mine = (await listQueue()).filter((e) => names.has(e.fileName));

  expect(mine.map((e) => e.fileName)).toEqual([
    "manual.gcode", // manual_rank 1 -> front, regardless of tier/age
    "hi-old.gcode", // tier 1, older
    "hi-new.gcode", // tier 1, newer
    "lo-old.gcode", // tier 2, no rank — after tier 1 even though it's the oldest
  ]);
  // 'done.gcode' (status 'completed') is not a queue status
  expect(mine.some((e) => e.fileName === "done.gcode")).toBe(false);
  // positions are the global queue index, so they only need to be strictly ascending here
  expect(mine.map((e) => e.position)).toEqual([...mine.map((e) => e.position)].sort((a, b) => a - b));
});

it("exposes only id / position / organization / status / fileName — never file_path", async () => {
  const [entry] = (await listQueue()).filter((e) => e.fileName === "manual.gcode");
  expect(Object.keys(entry).sort()).toEqual(["fileName", "id", "organization", "position", "status"]);
  expect(entry.organization).toBe(tier2Org);
  expect(entry.status).toBe("waiting");
});
