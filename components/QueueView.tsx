import type { QueueEntry } from "@/hooks/useQueue";

// T32: renders the queue in the order the server already computed (calculateQueueOrder,
// T21) — this component does not sort, it just lists. Same dark card/table styling as
// the fleet dashboard (T30).
// T33: when isAdmin, each row gets up/down controls that call onMove(index, dir); the
// parent turns that into a PATCH /api/jobs/reorder (T26) and refetches. Members never
// get the extra column.
const STATUS_LABEL: Record<QueueEntry["status"], string> = {
  queued: "En cola",
  waiting: "En espera",
  assigned: "Asignado",
  printing: "Imprimiendo",
};

const STATUS_STYLE: Record<QueueEntry["status"], string> = {
  queued: "bg-gray-700 text-gray-200",
  waiting: "bg-amber-900 text-amber-300",
  assigned: "bg-blue-900 text-blue-300",
  printing: "bg-green-900 text-green-300",
};

type Props = {
  queue: QueueEntry[];
  isAdmin?: boolean;
  onMove?: (index: number, direction: "up" | "down") => void;
};

export default function QueueView({ queue, isAdmin = false, onMove }: Props) {
  if (queue.length === 0) {
    return <p className="text-sm text-gray-500">No hay trabajos en la cola.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-800">
      <table className="w-full text-left text-sm">
        <thead className="bg-gray-900 text-xs uppercase tracking-wider text-gray-400">
          <tr>
            <th className="w-16 px-4 py-3">#</th>
            <th className="px-4 py-3">Archivo</th>
            <th className="px-4 py-3">Organización</th>
            <th className="px-4 py-3">Estado</th>
            {isAdmin && <th className="w-24 px-4 py-3">Orden</th>}
          </tr>
        </thead>
        <tbody>
          {queue.map((j, i) => (
            <tr key={j.id} className="border-t border-gray-800">
              <td className="px-4 py-3 font-bold text-gray-100">{j.position}</td>
              <td className="px-4 py-3 text-gray-200">{j.fileName}</td>
              <td className="px-4 py-3 text-gray-400">{j.organization}</td>
              <td className="px-4 py-3">
                <span
                  className={`rounded px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[j.status] ?? "bg-gray-700 text-gray-200"}`}
                >
                  {STATUS_LABEL[j.status] ?? j.status}
                </span>
              </td>
              {isAdmin && (
                <td className="px-4 py-3">
                  <div className="flex gap-1">
                    <button
                      type="button"
                      aria-label="Subir en la cola"
                      disabled={i === 0}
                      onClick={() => onMove?.(i, "up")}
                      className="rounded bg-gray-800 px-2 py-1 text-gray-200 hover:bg-gray-700 disabled:opacity-30"
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      aria-label="Bajar en la cola"
                      disabled={i === queue.length - 1}
                      onClick={() => onMove?.(i, "down")}
                      className="rounded bg-gray-800 px-2 py-1 text-gray-200 hover:bg-gray-700 disabled:opacity-30"
                    >
                      ▼
                    </button>
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
