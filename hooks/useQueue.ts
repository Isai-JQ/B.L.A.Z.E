import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { QueueEntry } from "@/pages/api/jobs/queue";

export type { QueueEntry };

const POLL_MS = 5000;

// T32: short-poll GET /api/jobs/queue so the "Cola" view tracks the queue without a
// reload — same plain-interval pattern as useFleet (T30) / useNotifications (T29),
// no Realtime channel. refetch() forces an immediate reload; AddJobModal's onCreated
// calls it so a new upload shows up without waiting for the next tick.
// ponytail: swap for supabase.channel() realtime if the polling load ever matters.
export function useQueue(pollMs = POLL_MS) {
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;
      try {
        const res = await fetch("/api/jobs/queue", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(`GET /api/jobs/queue ${res.status}`);
        const rows = (await res.json()) as QueueEntry[];
        if (!cancelled) {
          setQueue(rows);
          setUpdatedAt(new Date());
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
  }, [pollMs, nonce]);

  return { queue, error, updatedAt, refetch: () => setNonce((n) => n + 1) };
}
