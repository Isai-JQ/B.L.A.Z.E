import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AddJobModal from "./AddJobModal";

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { auth: { getSession } } }));

function pick(name: string) {
  fireEvent.change(screen.getByLabelText(/Archivo/i), {
    target: { files: [new File(["x"], name)] },
  });
}

const submit = () => fireEvent.click(screen.getByRole("button", { name: "Subir a la cola" }));

describe("AddJobModal", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    getSession.mockResolvedValue({ data: { session: { access_token: "tok" } } });
  });

  it("rejects an invalid extension in the UI without calling the API", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<AddJobModal open onClose={vi.fn()} />);

    pick("virus.exe");
    submit();

    await screen.findByText(/extensión no permitida/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("shows the API error message when the upload is rejected, without closing the modal", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "file too large: 999 bytes exceeds max 10 bytes" }), {
        status: 400,
      }),
    );
    const onClose = vi.fn();
    render(<AddJobModal open onClose={onClose} />);

    pick("huge.gcode");
    submit();

    await screen.findByText(/file too large/i);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes the modal and reports the created job on a valid upload", async () => {
    const job = { id: "j1", fileName: "benchy.gcode", status: "queued" };
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify(job), { status: 201 }));
    const onClose = vi.fn();
    const onCreated = vi.fn();
    render(<AddJobModal open onClose={onClose} onCreated={onCreated} />);

    pick("benchy.gcode");
    submit();

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(job));
    expect(onClose).toHaveBeenCalled();

    const [url, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/jobs/upload");
    expect(opts.method).toBe("POST");
    expect((opts.headers as Record<string, string>)["x-file-name"]).toBe("benchy.gcode");
    expect((opts.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });
});
