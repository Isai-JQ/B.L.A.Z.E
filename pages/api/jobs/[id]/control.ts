import type { NextApiRequest, NextApiResponse } from "next";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { supabase } from "@/lib/supabase";
import { jobs, printers, userProfiles } from "@/db/schema";

// T27: POST /api/jobs/:id/control  { action: 'pause' | 'resume' | 'stop' }.
// Only the job's owner (user_id) or an admin may control it; anyone else gets 403 and no
// command is sent. On success the matching Bambu command goes out over MQTT to the job's
// assigned printer through the per-serial client the gateway keeps (T14b/T23) — reached
// via the gateway's /control HTTP hook, never the browser WS<->TLS bridge.
// controlJob is exported so tests can drive it without minting a JWT; the default export
// is the thin HTTP layer that resolves the caller and their role.

const ACTIONS = new Set(["pause", "resume", "stop"]);
type Result = { status: number; body: unknown };
type Dispatch = (printerId: string, serial: string, action: string) => Promise<unknown>;

// The live MQTT clients live in the gateway process, so reach it over HTTP. Same var the
// browser bridge uses, ws:// -> http://. ponytail: add a dedicated GATEWAY_URL only if
// the two ever need to differ.
const postToGateway: Dispatch = async (printerId, serial, action) => {
  const base = (process.env.NEXT_PUBLIC_WS_PROXY_URL ?? "ws://localhost:9001").replace(/^ws/, "http");
  const r = await fetch(`${base}/control`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ printerId, serial, action }),
  });
  if (!r.ok) throw new Error(`gateway control returned ${r.status}`);
};

export async function controlJob(
  userId: string,
  role: string | undefined,
  jobId: string,
  action: unknown,
  dispatch: Dispatch = postToGateway,
): Promise<Result> {
  if (typeof action !== "string" || !ACTIONS.has(action)) {
    return { status: 400, body: { error: `action must be one of ${[...ACTIONS].join(", ")}` } };
  }

  const [row] = await db
    .select({ ownerId: jobs.userId, printerId: jobs.printerId, serial: printers.serialNumber })
    .from(jobs)
    .leftJoin(printers, eq(printers.id, jobs.printerId))
    .where(eq(jobs.id, jobId));

  if (!row) return { status: 404, body: { error: "job not found" } };
  if (row.ownerId !== userId && role !== "admin") {
    return { status: 403, body: { error: "only the job owner or an admin can control this job" } };
  }
  if (!row.printerId || !row.serial) {
    return { status: 409, body: { error: "job has no assigned printer" } };
  }

  await dispatch(row.printerId, row.serial, action);
  return { status: 200, body: { ok: true, action } };
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

  const jobId = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  try {
    const result = await controlJob(data.user.id, profile?.role, jobId ?? "", req.body?.action);
    return res.status(result.status).json(result.body);
  } catch (e) {
    return res.status(502).json({ error: `could not reach printer: ${(e as Error).message}` });
  }
}
