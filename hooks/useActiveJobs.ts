import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { ActiveJob } from "@/pages/api/jobs/active";

const POLL_MS = 4000;

// T35: short-poll GET /api/jobs/active so each PrinterDetail card knows the job
// currently printing on its printer and whether this user may control it. Same
// plain-interval shape as useFleet/useNotifications, no Realtime channel.
export function useActiveJobs(pollMs = POLL_MS) {
  const [bySerial, setBySerial] = useState<Record<string, ActiveJob>>({});

  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;
      try {
        const res = await fetch("/api/jobs/active", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(`GET /api/jobs/active ${res.status}`);
        const rows = (await res.json()) as ActiveJob[];
        if (!cancelled) {
          setBySerial(Object.fromEntries(rows.map((r) => [r.printerSerial, r])));
        }
      } catch {
        // Non-fatal: the buttons just stay hidden until the next poll succeeds.
      }
    };

    tick();
    const id = setInterval(tick, pollMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [pollMs]);

  // POST /api/jobs/:id/control (T27) with the pressed action. The server re-checks
  // owner-or-admin, so this stays a thin fire-and-forget call.
  const control = useCallback(async (jobId: string, action: "pause" | "resume" | "stop") => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;
    await fetch(`/api/jobs/${jobId}/control`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action }),
    });
  }, []);

  return { activeJobs: bySerial, control };
}
