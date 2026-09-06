import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useFleet } from "@/hooks/useFleet";
import Sidebar from "@/components/Sidebar";
import Topbar from "@/components/Topbar";
import MetricsRow from "@/components/MetricsRow";
import PrinterDetail from "@/components/PrinterDetail";

// T30: fleet dashboard. Sidebar + Topbar + MetricsRow + a PrinterDetail grid, all
// fed by useFleet's short poll of GET /api/fleet, so the whole page tracks live
// MQTT telemetry without a reload (RF-1).
export default function Home() {
  const { printers, error, updatedAt } = useFleet();
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setEmail(data.session?.user.email ?? null));
  }, []);

  return (
    <div className="flex min-h-screen bg-gray-950 text-gray-100">
      <Sidebar email={email} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          title="Fleet en tiempo real"
          subtitle="Telemetría MQTT directa de cada impresora Bambu Lab P1S"
          updatedAt={updatedAt}
          error={error}
        />
        <main className="flex flex-col gap-5 p-8">
          <MetricsRow printers={printers} />
          {error && <p className="text-sm text-red-400">No se pudo leer el gateway: {error}</p>}
          {printers.length === 0 ? (
            <p className="text-sm text-gray-500">
              Sin impresoras reportando todavía. Inicia el gateway con <code>pnpm gateway</code>.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {printers.map((p) => (
                <PrinterDetail key={p.serial} printer={p} />
              ))}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
