import NotificationsBell from "@/components/NotificationsBell";

// T30: adapted from the reference repo's Topbar. The "EN VIVO" pill plus the
// "actualizado hace N s" label are the visible proof that the fleet grid is
// polling itself (useFleet, T29 pattern) — no reload.
function agoLabel(updatedAt: Date | null): string {
  if (!updatedAt) return "esperando telemetría…";
  const s = Math.max(0, Math.round((Date.now() - updatedAt.getTime()) / 1000));
  return s < 60 ? `Actualizado hace ${s} s` : `Actualizado hace ${Math.round(s / 60)} min`;
}

export default function Topbar({
  title,
  subtitle,
  updatedAt,
  error,
}: {
  title: string;
  subtitle: string;
  updatedAt: Date | null;
  error: string | null;
}) {
  return (
    <header className="flex items-start justify-between border-b border-gray-800 px-8 py-4">
      <div>
        <h1 className="text-xl font-bold text-white">{title}</h1>
        <p className="mt-1 text-sm text-gray-400">{subtitle}</p>
      </div>
      <div className="flex items-center gap-4 pt-0.5 text-xs">
        {error ? (
          <span className="flex items-center gap-2 font-bold text-red-400">
            <span className="h-2 w-2 rounded-full bg-red-500" />
            SIN CONEXIÓN
          </span>
        ) : (
          <span className="flex items-center gap-2 font-bold text-green-400">
            <span className="h-2 w-2 animate-pulse rounded-full bg-green-500" />
            EN VIVO
          </span>
        )}
        <span className="text-gray-500">{agoLabel(updatedAt)}</span>
        <NotificationsBell />
      </div>
    </header>
  );
}
