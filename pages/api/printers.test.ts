import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { afterAll, expect, it } from "vitest";

// Hits the real Supabase project from .env (like db/seed.ts). Load env before
// importing lib/db.ts, which builds its connection at module load.
for (const line of readFileSync(".env", "utf8").split("\n")) {
  const match = line.match(/^([A-Z_]+)=(.*)$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^"|"$/g, "");
}

const { registerPrinter } = await import("./printers");
const { db } = await import("@/lib/db");
const { printers } = await import("@/db/schema");

const serial = `TEST-${randomUUID()}`;
const valid = { serial_number: serial, ip_address: "10.0.0.9", access_code: "12345678", name: "P1S" };
const countRows = () => db.select().from(printers).where(eq(printers.serialNumber, serial));

afterAll(() => db.delete(printers).where(eq(printers.serialNumber, serial)));

it("rejects a non-admin caller without inserting", async () => {
  const res = await registerPrinter("member", valid);
  expect(res.status).toBe(403);
  expect(await countRows()).toHaveLength(0);
});

it("rejects missing required fields without inserting", async () => {
  const res = await registerPrinter("admin", { serial_number: serial, name: "P1S" });
  expect(res.status).toBe(400);
  expect(await countRows()).toHaveLength(0);
});

it("creates the printer for an admin, then rejects a duplicate serial", async () => {
  const ok = await registerPrinter("admin", valid);
  expect(ok.status).toBe(201);
  expect(await countRows()).toHaveLength(1);

  const dup = await registerPrinter("admin", { ...valid, ip_address: "10.0.0.10", name: "Dup" });
  expect(dup.status).toBe(409);
  expect(await countRows()).toHaveLength(1);
});
