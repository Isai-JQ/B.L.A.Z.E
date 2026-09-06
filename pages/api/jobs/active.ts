import type { NextApiRequest, NextApiResponse } from "next";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { supabase } from "@/lib/supabase";
import { jobs, printers, userProfiles } from "@/db/schema";

// T35: GET /api/jobs/active — the jobs currently printing, keyed to their assigned
// printer's serial, each with a `canControl` flag the dashboard uses to decide
// whether to show the pause/resume/stop buttons on that PrinterDetail card (RF-8):
// true only for the job's owner or an admin. The buttons then POST to
// /api/jobs/:id/control (T27), which re-checks the exact same rule server-side.

export type ActiveJob = { jobId: string; printerSerial: string; canControl: boolean };

export async function listActiveJobs(
  userId: string,
  role: string | undefined,
): Promise<ActiveJob[]> {
  const rows = await db
    .select({ jobId: jobs.id, ownerId: jobs.userId, printerSerial: printers.serialNumber })
    .from(jobs)
    .innerJoin(printers, eq(printers.id, jobs.printerId))
    .where(eq(jobs.status, "printing"));

  return rows.map((r) => ({
    jobId: r.jobId,
    printerSerial: r.printerSerial,
    canControl: r.ownerId === userId || role === "admin",
  }));
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
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

  return res.status(200).json(await listActiveJobs(data.user.id, profile?.role));
}
