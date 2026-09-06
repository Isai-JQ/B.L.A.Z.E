import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

// One printer's in-memory state as the gateway serves it at GET /printers (proxy.cjs
// FIELDS map). Reports are partial deltas, so any field can be missing.
export type PrinterState = {
  serial: string;
  name?: string;
  gcodeState?: string;
  nozzleTemp?: number;
  nozzleTempTarget?: number;
  bedTemp?: number;
  bedTempTarget?: number;
  chamberTemp?: number;
  printPercent?: number;
  layerNum?: number;
  totalLayerNum?: number;
  remainingTime?: number;
  gcodeFile?: string;
  lastReportAt?: string;
};

export type FleetStatus = "printing" | "free" | "offline";

// Same threshold the gateway's offline sweep uses (proxy.cjs OFFLINE_AFTER_SECONDS).
export const OFFLINE_AFTER_MS = 45_000;
const POLL_MS = 4000;

// A printer with no fresh report is offline; IDLE/FINISH means the bed is free;
// anything else (RUNNING, PAUSE, PREPARE, …) is holding a job.
export function fleetStatus(p: PrinterState, now = Date.now()): FleetStatus {
  const last = p.lastReportAt ? Date.parse(p.lastReportAt) : NaN;
  if (Number.isNaN(last) || now - last > OFFLINE_AFTER_MS) return "offline";
  return p.gcodeState === "IDLE" || p.gcodeState === "FINISH" ? "free" : "printing";
}

export function fleetTally(printers: PrinterState[], now = Date.now()) {
  const t = { total: printers.length, printing: 0, free: 0, offline: 0 };
  for (const p of printers) t[fleetStatus(p, now)]++;
  return t;
}

// T30: short-poll GET /api/fleet (proxy for the gateway's GET /printers) so the
// dashboard shows live MQTT telemetry without a reload. Same shape as
// useNotifications (T29): a plain interval, no Realtime channel.
// ponytail: swap for a WS push off the existing bridge if 4 s ever feels slow.
export function useFleet(pollMs = POLL_MS) {
  const [printers, setPrinters] = useState<PrinterState[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;
      try {
        const res = await fetch("/api/fleet", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(`GET /api/fleet ${res.status}`);
        const rows = (await res.json()) as PrinterState[];
        if (!cancelled) {
          setPrinters(rows);
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
  }, [pollMs]);

  return { printers, error, updatedAt };
}
