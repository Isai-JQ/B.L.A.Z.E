import { useState } from "react";
import { useNotifications } from "@/hooks/useNotifications";

// T34: bell + unread badge + dropdown, fed by useNotifications (T29). Clicking a row
// PATCHes /api/notifications/:id/read (T28) through the hook, which drops it from the
// unread-only list so the badge count falls in step (RF-7/RF-10).
export default function NotificationsBell() {
  const { notifications, error, markRead } = useNotifications();
  const [open, setOpen] = useState(false);
  const count = notifications.length;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={`Notificaciones${count ? ` (${count} sin leer)` : ""}`}
        className="relative flex h-7 w-7 items-center justify-center rounded text-base text-gray-400 hover:text-white"
      >
        <span aria-hidden>🔔</span>
        {count > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-10 mt-2 w-72 rounded border border-gray-800 bg-gray-900 py-1 text-left shadow-lg">
          {error && <p className="px-3 py-2 text-xs text-red-400">{error}</p>}
          {count === 0 ? (
            <p className="px-3 py-2 text-xs text-gray-500">Sin notificaciones nuevas</p>
          ) : (
            notifications.map((n) => (
              <button
                key={n.id}
                onClick={() => markRead(n.id)}
                className="block w-full px-3 py-2 text-left text-xs text-gray-300 hover:bg-gray-800"
              >
                {n.message}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
