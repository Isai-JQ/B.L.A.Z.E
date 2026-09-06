import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useQueue } from "@/hooks/useQueue";
import Sidebar from "@/components/Sidebar";
import Topbar from "@/components/Topbar";
import QueueView from "@/components/QueueView";
import AddJobModal from "@/components/AddJobModal";

// T32: "Cola" view (RF-12). useQueue short-polls GET /api/jobs/queue; the list shows
// every active job in the order calculateQueueOrder (T21) computed server-side.
// AddJobModal's onCreated calls refetch() so a new upload lands in the list without
// waiting for the next poll (T31 was pending on this).
export default function QueuePage() {
  const { queue, error, updatedAt, refetch } = useQueue();
  const [email, setEmail] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setEmail(data.session?.user.email ?? null));
  }, []);

  return (
    <div className="flex min-h-screen bg-gray-950 text-gray-100">
      <Sidebar email={email} active="/queue" />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          title="Cola de trabajos"
          subtitle="Orden por tier de organización, FIFO y rango manual"
          updatedAt={updatedAt}
          error={error}
        />
        <main className="flex flex-col gap-5 p-8">
          <div className="flex justify-end">
            <button
              onClick={() => setModalOpen(true)}
              className="rounded bg-blue-600 px-4 py-2 text-sm font-bold text-white transition-opacity hover:opacity-90"
            >
              Nuevo trabajo
            </button>
          </div>
          {error && <p className="text-sm text-red-400">No se pudo leer la cola: {error}</p>}
          <QueueView queue={queue} />
        </main>
      </div>
      <AddJobModal open={modalOpen} onClose={() => setModalOpen(false)} onCreated={() => refetch()} />
    </div>
  );
}
