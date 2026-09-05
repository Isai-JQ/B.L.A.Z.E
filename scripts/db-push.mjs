// T11c: after `drizzle-kit push`, reapply every db/sql/*.sql file (in order) so
// hand-written RLS policies/triggers (which drizzle-kit can't push, see db/schema.ts)
// never depend on someone remembering to run them by hand.
import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import postgres from "postgres";

for (const line of readFileSync(".env", "utf8").split("\n")) {
  const match = line.match(/^([A-Z_]+)=(.*)$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^"|"$/g, "");
}

if (!process.env.DIRECT_URL) throw new Error("DIRECT_URL is not set");

execFileSync("drizzle-kit", ["push"], { stdio: "inherit" });

const dir = "db/sql";
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

const sql = postgres(process.env.DIRECT_URL);
for (const file of files) {
  console.log(`applying ${file}`);
  await sql.file(`${dir}/${file}`);
}
await sql.end();
