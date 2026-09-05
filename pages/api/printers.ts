import type { NextApiRequest, NextApiResponse } from "next";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { supabase } from "@/lib/supabase";
import { printers, userProfiles } from "@/db/schema";

const REQUIRED = ["serial_number", "ip_address", "access_code", "name"] as const;

type Result = { status: number; body: unknown };

// T16: register a new printer. Admin-only, validates required fields and a unique
// serial. Exported so tests can exercise the DB logic without minting a real JWT;
// the default export is the thin HTTP layer that resolves the caller's role.
export async function registerPrinter(
  role: string | undefined,
  body: Record<string, unknown>,
): Promise<Result> {
  if (role !== "admin") return { status: 403, body: { error: "admin role required" } };

  const missing = REQUIRED.filter(
    (k) => typeof body[k] !== "string" || (body[k] as string).trim() === "",
  );
  if (missing.length > 0) {
    return { status: 400, body: { error: `missing or empty fields: ${missing.join(", ")}` } };
  }

  const serialNumber = (body.serial_number as string).trim();
  const clash = await db
    .select({ id: printers.id })
    .from(printers)
    .where(eq(printers.serialNumber, serialNumber));
  if (clash.length > 0) {
    return { status: 409, body: { error: "serial_number already registered" } };
  }

  const [row] = await db
    .insert(printers)
    .values({
      serialNumber,
      ipAddress: (body.ip_address as string).trim(),
      accessCode: (body.access_code as string).trim(),
      name: (body.name as string).trim(),
    })
    .returning();
  return { status: 201, body: row };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method not allowed" });
  }

  const token = req.headers.authorization?.replace(/^Bearer /i, "");
  const { data, error } = token
    ? await supabase.auth.getUser(token)
    : { data: { user: null }, error: new Error("no token") };
  if (error || !data.user) return res.status(401).json({ error: "authentication required" });

  const [profile] = await db
    .select({ role: userProfiles.role })
    .from(userProfiles)
    .where(eq(userProfiles.id, data.user.id));

  const result = await registerPrinter(profile?.role, (req.body ?? {}) as Record<string, unknown>);
  return res.status(result.status).json(result.body);
}
