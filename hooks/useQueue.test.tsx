import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useQueue } from "./useQueue";

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { auth: { getSession } } }));

describe("useQueue", () => {
  beforeEach(() => {
    getSession.mockResolvedValue({ data: { session: { access_token: "tok" } } });
  });
  afterEach(() => vi.restoreAllMocks());

  it("shows a newly uploaded job on the next polling cycle without a reload", async () => {
    const base = [{ position: 1, organization: "FrED", status: "printing", fileName: "a.gcode" }];
    let rows = base;
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => rows }));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useQueue(10));

    await waitFor(() => expect(result.current.queue).toEqual(base));
    expect(fetchMock).toHaveBeenCalledWith("/api/jobs/queue", {
      headers: { Authorization: "Bearer tok" },
    });

    // simulate an upload adding a job the queue endpoint now returns
    rows = [...base, { position: 2, organization: "FrED", status: "queued", fileName: "b.gcode" }];
    await waitFor(() => expect(result.current.queue.map((j) => j.fileName)).toEqual(["a.gcode", "b.gcode"]));
  });

  it("refetch() forces an immediate reload (AddJobModal onCreated)", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => [] }));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useQueue(100_000));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    result.current.refetch();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it("does not fetch until there is a session token", async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    renderHook(() => useQueue(10));

    await waitFor(() => expect(getSession).toHaveBeenCalled());
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
