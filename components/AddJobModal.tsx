import { useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

// T31: adapted from the reference repo's AddJobModal. Uploads one print file to
// POST /api/jobs/upload (T18-T20) and shows the result inline — no page reload.
// The server re-validates extension and size (T18); ALLOWED_EXT here mirrors it
// only so an obviously wrong file fails instantly without a wasted upload.
const ALLOWED_EXT = [".gcode", ".3mf"];

type Job = { id: string; fileName: string; status: string };

function extOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
}

export default function AddJobModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated?: (job: Job) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  const close = () => {
    setFile(null);
    setError("");
    setSubmitting(false);
    if (inputRef.current) inputRef.current.value = "";
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!file) {
      setError("Error: elige un archivo .gcode o .3mf.");
      return;
    }
    if (!ALLOWED_EXT.includes(extOf(file.name))) {
      setError(`Error: extensión no permitida. Usa ${ALLOWED_EXT.join(" o ")}.`);
      return;
    }

    setSubmitting(true);
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      setError("Error: tu sesión expiró, vuelve a iniciar sesión.");
      setSubmitting(false);
      return;
    }

    try {
      const res = await fetch("/api/jobs/upload", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "x-file-name": file.name },
        body: file,
      });
      const body = await res.json().catch(() => ({}) as Record<string, string>);
      if (!res.ok) {
        setError(`Error: ${body.error ?? `la subida falló (${res.status})`}`);
        setSubmitting(false);
        return;
      }
      onCreated?.(body as Job);
      close();
    } catch (err) {
      setError(`Error: ${(err as Error).message}`);
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/80 p-4"
      onClick={close}
    >
      <div
        className="w-full max-w-md rounded-lg border border-gray-800 bg-gray-900 p-8 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-6 flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-blue-800 text-sm font-extrabold text-white">
            B
          </span>
          <span className="text-sm font-extrabold tracking-widest text-white">B.L.A.Z.E</span>
        </div>
        <h2 className="mb-6 text-2xl font-bold text-white">Nuevo trabajo de impresión</h2>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label
              htmlFor="job-file"
              className="mb-1 block text-xs uppercase tracking-wider text-gray-400"
            >
              Archivo (.gcode o .3mf)
            </label>
            <input
              id="job-file"
              ref={inputRef}
              type="file"
              accept=".gcode,.3mf"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setError("");
              }}
              className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white outline-none transition-colors file:mr-3 file:rounded file:border-0 file:bg-gray-700 file:px-3 file:py-1 file:text-white focus:border-blue-500"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="mt-2 rounded bg-blue-600 px-4 py-2 font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? "Subiendo…" : "Subir a la cola"}
          </button>

          {error && <p className="mt-1 text-sm text-red-400">{error}</p>}
        </form>

        <div className="mt-6 text-center">
          <button
            onClick={close}
            className="text-sm text-gray-400 transition-colors hover:text-blue-400"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
