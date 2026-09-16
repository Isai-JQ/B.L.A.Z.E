import Link from "next/link";

// T30/T32: static nav; the active route is passed in by the page (no router context
// needed in tests). Admin reordering (T33) lives inside /queue, so it has no entry here.
const NAV = [
  { label: "Fleet", href: "/" },
  { label: "Cola de trabajos", href: "/queue" },
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
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold ${
              item.href === active
                ? "bg-gray-800 text-white shadow-[inset_3px_0_0_#2E5AD6]"
                : "text-gray-400"
            }`}
          >
            {item.label}
          </Link>
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
