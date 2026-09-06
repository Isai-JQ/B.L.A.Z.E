// T30: adapted from the reference repo's Sidebar. Static nav for now — the Cola /
// Reordenar views (T32/T33) don't exist yet, so those items are inert.
const NAV = [
  { label: "Fleet", active: true },
  { label: "Cola de trabajos", active: false },
  { label: "Reordenar cola", active: false, locked: true },
];

export default function Sidebar({ email }: { email: string | null }) {
  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-gray-800 bg-gray-900 p-4">
      <div className="flex items-center gap-2 px-1 pb-5">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-blue-800 text-sm font-extrabold text-white">
          B
        </span>
        <span className="text-sm font-extrabold tracking-widest text-white">B.L.A.Z.E</span>
      </div>
      <nav className="flex flex-col gap-1">
        {NAV.map((item) => (
          <div
            key={item.label}
            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold ${
              item.active
                ? "bg-gray-800 text-white shadow-[inset_3px_0_0_#2E5AD6]"
                : "text-gray-400"
            }`}
          >
            {item.label}
            {item.locked && <span className="ml-auto text-xs text-gray-600">🔒</span>}
          </div>
        ))}
      </nav>
      <div className="flex-1" />
      <div className="flex items-center gap-2 rounded-lg border border-gray-800 bg-gray-950 p-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-700 text-xs font-bold">
          {(email ?? "?").slice(0, 2).toUpperCase()}
        </span>
        <span className="min-w-0 truncate text-xs text-gray-200">{email ?? "Sin sesión"}</span>
      </div>
    </aside>
  );
}
