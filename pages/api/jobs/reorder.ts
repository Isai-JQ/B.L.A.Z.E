import type { NextApiRequest, NextApiResponse } from "next";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { supabase } from "@/lib/supabase";
import { jobs, userProfiles } from "@/db/schema";

// T26: an admin sets manual_rank on one or more jobs. calculateQueueOrder (T21) puts
// ranked jobs ahead of the automatic tier/FIFO order, so this is the whole feature.
// The updates run in one transaction: all rows change or none. assignNextJob
// (proxy.cjs) reads the ranks in its own SELECT and claims the job with a single
// UPDATE, so a reorder racing an assignment either lands before that SELECT or is
// picked up on the next idle report — never half-applied.
// Exported so tests can exercise it without minting a JWT; the default export is the
// thin HTTP layer that resolves the caller's role.

type Item = { job_id: string; manual_rank: number | null };
type Result = { status: number; body: unknown };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseItems(body: unknown): Item[] | null {
  if (!Array.isArray(body) || body.length === 0) return null;
  const items: Item[] = [];
  for (const raw of body) {
    const { job_id, manual_rank } = (raw ?? {}) as Record<string, unknown>;
    if (typeof job_id !== "string" || !UUID.test(job_id)) return null;
    if (manual_rank !== null && !Number.isInteger(manual_rank)) return null;
    items.push({ job_id, manual_rank: manual_rank as number | null });
  }
  return items;
}

class NotFound extends Error {}

export async function reorderJobs(role: string | undefined, body: unknown): Promise<Result> {
  if (role !== "admin") return { status: 403, body: { error: "admin role required" } };

  const items = parseItems(body);
  if (!items) {
    return {
      status: 400,
      body: { error: "body must be a non-empty array of { job_id: uuid, manual_rank: integer | null }" },
    };
  }

  try {
    await db.transaction(async (tx) => {
      for (const { job_id, manual_rank } of items) {
        const [row] = await tx
          .update(jobs)
          .set({ manualRank: manual_rank })
          .where(eq(jobs.id, job_id))
          .returning({ id: jobs.id });
        if (!row) throw new NotFound(job_id);
      }
    });
  } catch (e) {
    if (e instanceof NotFound) return { status: 404, body: { error: `job not found: ${e.message}` } };
    throw e;
  }
  return { status: 200, body: { ok: true, updated: items.length } };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "PATCH") {
    res.setHeader("Allow", "PATCH");
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

  const result = await reorderJobs(profile?.role, req.body);
  return res.status(result.status).json(result.body);
}
