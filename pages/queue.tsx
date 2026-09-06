import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useQueue } from "@/hooks/useQueue";
import { swapRanks } from "@/lib/reorderRanks";
import Sidebar from "@/components/Sidebar";
import Topbar from "@/components/Topbar";
import QueueView from "@/components/QueueView";
import AddJobModal from "@/components/AddJobModal";

// T32: "Cola" view (RF-12). useQueue short-polls GET /api/jobs/queue; the list shows
// every active job in the order calculateQueueOrder (T21) computed server-side.
// AddJobModal's onCreated calls refetch() so a new upload lands in the list without
// waiting for the next poll (T31 was pending on this).
// T33: admins get up/down controls on each row. Moving a job PATCHes /api/jobs/reorder
// (T26) with manual_rank on *only* the two jobs that trade places (see swapRanks),
// then refetches so the persisted order shows immediately. Members never see the
// controls; the endpoint also rejects them with 403.
export default function QueuePage() {
  const { queue, error, updatedAt, refetch } = useQueue();
  const [email, setEmail] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [reorderError, setReorderError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      const user = data.session?.user;
      setEmail(user?.email ?? null);
      if (!user) return;
      const { data: profile } = await supabase
        .from("user_profiles")
        .select("role")
        .eq("id", user.id)
        .single();
      setIsAdmin(profile?.role === "admin");
    });
  }, []);

  const handleMove = async (index: number, direction: "up" | "down") => {
    const updates = swapRanks(queue, index, direction);
    if (!updates) return;

    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;

    setReorderError(null);
    try {
      const res = await fetch("/api/jobs/reorder", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error(`PATCH /api/jobs/reorder ${res.status}`);
    } catch (e) {
      setReorderError((e as Error).message);
    }
    refetch();
  };

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
          {reorderError && (
            <p className="text-sm text-red-400">No se pudo reordenar la cola: {reorderError}</p>
          )}
          <QueueView queue={queue} isAdmin={isAdmin} onMove={handleMove} />
        </main>
      </div>
      <AddJobModal open={modalOpen} onClose={() => setModalOpen(false)} onCreated={() => refetch()} />
    </div>
  );
}
