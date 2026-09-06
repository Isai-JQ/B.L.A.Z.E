import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export type Notification = {
  id: string;
  jobId: string;
  type: "job_failed" | "job_waiting";
  message: string;
  readAt: string | null;
  createdAt: string;
};

const POLL_MS = 8000;

// T29: short-poll GET /api/notifications?unread=1 (T28) so notifications the gateway
// inserts straight into the DB (T24/T25) surface in the UI without a reload. A plain
// interval is enough at fleet scale — no Realtime channel.
// ponytail: swap for supabase.channel() realtime if the polling load ever matters.
export function useNotifications(pollMs = POLL_MS) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;
      try {
        const res = await fetch("/api/notifications?unread=1", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(`GET /api/notifications ${res.status}`);
        const rows = (await res.json()) as Notification[];
        if (!cancelled) {
          setNotifications(rows);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    };

    tick();
    const id = setInterval(tick, pollMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [pollMs]);

  // T34: mark one notification read via PATCH /api/notifications/:id/read (T28) and drop
  // it from the list optimistically — the list is unread-only, so the badge count falls
  // right away; the next poll reconciles.
  const markRead = useCallback(async (id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;
    await fetch(`/api/notifications/${id}/read`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}` },
    });
  }, []);

  return { notifications, error, markRead };
}
