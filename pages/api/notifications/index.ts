import type { NextApiRequest, NextApiResponse } from "next";
import { desc, eq, isNull, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { supabase } from "@/lib/supabase";
import { notifications } from "@/db/schema";

// T28: GET /api/notifications — the authenticated user's own notifications, newest first.
// ?unread=1 narrows to the ones still unread (RF-7/RF-10 acceptance). The user_id filter is
// the whole access story here: you only ever see your own rows.
// Exported so tests can call it without minting a JWT; the default export resolves the caller.

export async function listNotifications(userId: string, unreadOnly: boolean) {
  const where = unreadOnly
    ? and(eq(notifications.userId, userId), isNull(notifications.readAt))
    : eq(notifications.userId, userId);
  return db.select().from(notifications).where(where).orderBy(desc(notifications.createdAt));
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

  const rows = await listNotifications(data.user.id, req.query.unread != null);
  return res.status(200).json(rows);
}
