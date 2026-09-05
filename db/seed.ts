import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { organizations } from "./schema";

for (const line of readFileSync(".env", "utf8").split("\n")) {
  const match = line.match(/^([A-Z_]+)=(.*)$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^"|"$/g, "");
}

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");

const seedOrgs = [
  { name: "FrED-Factory", priorityTier: 1 },
  { name: "RoBorregos", priorityTier: 2 },
  { name: "VantTec", priorityTier: 2 },
];

async function main() {
  const sql = postgres(process.env.DATABASE_URL!);
  const db = drizzle(sql);

  for (const org of seedOrgs) {
    const existing = await db.select().from(organizations).where(eq(organizations.name, org.name));
    if (existing.length === 0) {
      await db.insert(organizations).values(org);
      console.log(`inserted ${org.name} (tier ${org.priorityTier})`);
    } else {
      console.log(`skipped ${org.name}, already exists`);
    }
  }

  await sql.end();
}

main();
