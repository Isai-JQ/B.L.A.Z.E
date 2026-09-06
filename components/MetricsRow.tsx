import { fleetTally, type PrinterState } from "@/hooks/useFleet";

// T30: adapted from the reference repo's MetricsRow. Counts are derived from the
// same live states the grid renders, so the row updates on every poll too.
export default function MetricsRow({ printers }: { printers: PrinterState[] }) {
  const t = fleetTally(printers);
  return (
    <div className="flex flex-wrap gap-x-2 text-sm text-gray-400">
      <span>
        <b className="text-gray-100">{t.total}</b> impresoras
      </span>
      <span className="text-gray-700">·</span>
      <span>
        <b className="text-gray-100">{t.printing}</b> imprimiendo
      </span>
      <span className="text-gray-700">·</span>
      <span>
        <b className="text-gray-100">{t.free}</b> libres
      </span>
      <span className="text-gray-700">·</span>
      <span>
        <b className="text-gray-100">{t.offline}</b> offline
      </span>
    </div>
  );
}
