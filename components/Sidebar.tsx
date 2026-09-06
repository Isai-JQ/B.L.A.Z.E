import Link from "next/link";

// T30/T32: static nav. "Fleet" and "Cola de trabajos" are real routes now; the
// active one is passed in by the page (no router context needed in tests).
// "Reordenar cola" (T33) doesn't exist yet, so it stays inert.
const NAV = [
  { label: "Fleet", href: "/" },
  { label: "Cola de trabajos", href: "/queue" },
  { label: "Reordenar cola", href: null, locked: true },
];

export default function Sidebar({ email, active }: { email: string | null; active?: string }) {
  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-gray-800 bg-gray-900 p-4">
      <div className="flex items-center gap-2 px-1 pb-5">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-blue-800 text-sm font-extrabold text-white">
          B
        </span>
        <span className="text-sm font-extrabold tracking-widest text-white">B.L.A.Z.E</span>
      </div>
      <nav className="flex flex-col gap-1">
        {NAV.map((item) => {
          const cls = `flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold ${
            item.href && item.href === active
              ? "bg-gray-800 text-white shadow-[inset_3px_0_0_#2E5AD6]"
              : "text-gray-400"
          }`;
          return item.href ? (
            <Link key={item.label} href={item.href} className={cls}>
              {item.label}
            </Link>
          ) : (
            <div key={item.label} className={cls}>
              {item.label}
              <span className="ml-auto text-xs text-gray-600">🔒</span>
            </div>
          );
        })}
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
