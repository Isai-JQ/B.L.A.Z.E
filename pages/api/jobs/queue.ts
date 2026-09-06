import type { NextApiRequest, NextApiResponse } from "next";
import { inArray, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { supabase } from "@/lib/supabase";
import { jobs, organizations } from "@/db/schema";
import { calculateQueueOrder } from "@/lib/queueOrder";

// T32: GET /api/jobs/queue — every active job in the order calculateQueueOrder (T21)
// computes (org tier -> FIFO by created_at -> manual_rank). Any authenticated user
// sees the whole queue, not just their own jobs (RF-12).
// The response carries only what RF-12 asks for — position, organization, status,
// file name. file_path and every other jobs column stay server-side.
// Exported so tests can call it without minting a JWT; the default export is the
// thin HTTP layer.

const QUEUE_STATUSES = ["queued", "waiting", "assigned", "printing"] as const;

export type QueueEntry = {
  position: number;
  organization: string;
  status: (typeof QUEUE_STATUSES)[number];
  fileName: string;
};

export async function listQueue(): Promise<QueueEntry[]> {
  const rows = await db
    .select({
      fileName: jobs.fileName,
      status: jobs.status,
      organization: organizations.name,
      priorityTier: organizations.priorityTier,
      createdAt: jobs.createdAt,
      manualRank: jobs.manualRank,
    })
    .from(jobs)
    .innerJoin(organizations, eq(organizations.id, jobs.organizationId))
    .where(inArray(jobs.status, [...QUEUE_STATUSES]));

  return calculateQueueOrder(rows).map((r, i) => ({
    position: i + 1,
    organization: r.organization,
    status: r.status as QueueEntry["status"],
    fileName: r.fileName,
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

  return res.status(200).json(await listQueue());
}
