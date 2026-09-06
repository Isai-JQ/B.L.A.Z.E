import type { NextApiRequest, NextApiResponse } from "next";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { supabase } from "@/lib/supabase";
import { notifications } from "@/db/schema";

// T28: PATCH /api/notifications/:id/read — mark one notification read. Only its owner may:
// 404 if it doesn't exist, 403 if it belongs to someone else. Idempotent (readAt keeps its
// first value). Exported for tests; the default export is the thin HTTP layer.

type Result = { status: number; body: unknown };

export async function markRead(userId: string, notifId: string): Promise<Result> {
  const [row] = await db
    .select({ ownerId: notifications.userId, readAt: notifications.readAt })
    .from(notifications)
    .where(eq(notifications.id, notifId));

  if (!row) return { status: 404, body: { error: "notification not found" } };
  if (row.ownerId !== userId) return { status: 403, body: { error: "not your notification" } };

  const readAt = row.readAt ?? new Date();
  if (!row.readAt) {
    await db.update(notifications).set({ readAt }).where(eq(notifications.id, notifId));
  }
  return { status: 200, body: { ok: true, readAt } };
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

  const notifId = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  const result = await markRead(data.user.id, notifId ?? "");
  return res.status(result.status).json(result.body);
}
