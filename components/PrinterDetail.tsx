import { fleetStatus, type PrinterState } from "@/hooks/useFleet";
import type { ActiveJob } from "@/pages/api/jobs/active";

type ControlAction = "pause" | "resume" | "stop";
const CONTROLS: { action: ControlAction; label: string; cls: string }[] = [
  { action: "pause", label: "Pausar", cls: "bg-amber-600 hover:bg-amber-500" },
  { action: "resume", label: "Reanudar", cls: "bg-green-600 hover:bg-green-500" },
  { action: "stop", label: "Detener", cls: "bg-red-600 hover:bg-red-500" },
];

const BADGE: Record<string, { label: string; cls: string }> = {
  printing: { label: "Imprimiendo", cls: "bg-blue-500/15 text-blue-300 border-blue-500/40" },
  free: { label: "Libre", cls: "bg-green-500/15 text-green-300 border-green-500/40" },
  offline: { label: "Offline", cls: "bg-red-500/15 text-red-300 border-red-500/40" },
};

const deg = (n?: number) => (n == null ? "—" : `${Math.round(n)}°`);

function Temp({ label, value, target }: { label: string; value?: number; target?: number }) {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-950 px-2 py-2 text-center">
      <div className="text-sm font-bold text-gray-200">
        {deg(value)}
        {target != null && target > 0 && <span className="text-[10px] text-gray-500"> / {deg(target)}</span>}
      </div>
      <div className="mt-0.5 text-[9px] uppercase tracking-wide text-gray-400">{label}</div>
    </div>
  );
}

// T30: adapted from the reference repo's PrinterDetail. One card per printer showing
// the RF-1 telemetry: nozzle/bed/chamber temp, progress %, current layer, g-code
// state and remaining time. Re-rendered on every useFleet poll.
// T35: when the card has a job printing on it AND this user owns that job or is an
// admin (canControl, decided server-side in /api/jobs/active per RF-8), show
// pause/resume/stop buttons that POST to /api/jobs/:id/control (T27). Anyone else
// sees no buttons at all, and a free printer has no job so shows none either.
export default function PrinterDetail({
  printer,
  job,
  onControl,
}: {
  printer: PrinterState;
  job?: ActiveJob;
  onControl?: (jobId: string, action: ControlAction) => void;
}) {
  const status = fleetStatus(printer);
  const badge = BADGE[status];
  const pct = Math.max(0, Math.min(100, Math.round(printer.printPercent ?? 0)));
  const printing = status === "printing";
  const showControls = Boolean(job?.canControl && onControl);

  return (
    <div className={`flex flex-col rounded-xl border border-gray-800 bg-gray-900 p-4 ${status === "offline" ? "opacity-60" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-bold text-white">{printer.name ?? printer.serial}</div>
          <div className="mt-0.5 font-mono text-[11px] text-gray-500">{printer.serial}</div>
        </div>
        <span className={`rounded-full border px-2 py-1 text-[11px] font-extrabold ${badge.cls}`}>
          {badge.label}
        </span>
      </div>

      <div className="mt-4">
        <div className="flex items-baseline justify-between">
          <span className="text-xl font-extrabold text-white">{printing ? `${pct}%` : "—"}</span>
          <span className="text-xs text-gray-400">
            {printing && printer.totalLayerNum
              ? `Capa ${printer.layerNum ?? 0} / ${printer.totalLayerNum}`
              : "Sin trabajo activo"}
          </span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-800">
          <div className="h-full rounded-full bg-blue-600" style={{ width: `${printing ? pct : 0}%` }} />
        </div>
      </div>

      {printer.gcodeFile && (
        <div className="mt-3 truncate font-mono text-xs text-gray-300">{printer.gcodeFile}</div>
      )}

      <div className="mt-3 grid grid-cols-3 gap-2">
        <Temp label="Nozzle" value={printer.nozzleTemp} target={printer.nozzleTempTarget} />
        <Temp label="Cama" value={printer.bedTemp} target={printer.bedTempTarget} />
        <Temp label="Cámara" value={printer.chamberTemp} />
      </div>

      <div className="mt-3 flex items-center justify-between">
        <span className="rounded bg-gray-800 px-2 py-1 text-[10px] font-extrabold tracking-wide text-gray-400">
          {printer.gcodeState ?? "—"}
        </span>
        <span className="text-xs text-gray-400">
          {printing && printer.remainingTime != null
            ? `~${printer.remainingTime} min restantes`
            : printer.lastReportAt
              ? `Última señal ${new Date(printer.lastReportAt).toLocaleTimeString()}`
              : "Sin telemetría"}
        </span>
      </div>

      {showControls && (
        <div className="mt-4 flex gap-2">
          {CONTROLS.map((c) => (
            <button
              key={c.action}
              onClick={() => onControl!(job!.jobId, c.action)}
              className={`flex-1 rounded px-2 py-1.5 text-xs font-bold text-white transition-colors ${c.cls}`}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
