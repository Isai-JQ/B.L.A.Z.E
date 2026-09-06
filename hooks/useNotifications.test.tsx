import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNotifications } from "./useNotifications";

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { auth: { getSession } } }));

describe("useNotifications", () => {
  beforeEach(() => {
    getSession.mockResolvedValue({ data: { session: { access_token: "tok" } } });
  });
  afterEach(() => vi.restoreAllMocks());

  it("reflects a notification inserted in the DB on the next polling cycle", async () => {
    const row = {
      id: "n1",
      jobId: "j1",
      type: "job_failed" as const,
      message: "printer offline",
      readAt: null,
      createdAt: "2026-09-05T00:00:00Z",
    };
    let hasRow = false;
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => (hasRow ? [row] : []) }));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useNotifications(10));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(result.current.notifications).toEqual([]);
    expect(fetchMock).toHaveBeenCalledWith("/api/notifications?unread=1", {
      headers: { Authorization: "Bearer tok" },
    });

    // simulate the gateway inserting a notification straight into the DB
    hasRow = true;
    await waitFor(() => expect(result.current.notifications).toEqual([row]));
  });

  it("markRead PATCHes the id and drops it from the unread list (badge falls)", async () => {
    const rows = [
      { id: "n1", jobId: "j1", type: "job_failed" as const, message: "a", readAt: null, createdAt: "2026-09-05T00:00:00Z" },
      { id: "n2", jobId: "j2", type: "job_waiting" as const, message: "b", readAt: null, createdAt: "2026-09-05T00:01:00Z" },
    ];
    const read = new Set<string>();
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        read.add(url.split("/")[3]);
        return { ok: true, json: async () => ({ ok: true }) };
      }
      return { ok: true, json: async () => rows.filter((r) => !read.has(r.id)) };
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useNotifications(10));
    await waitFor(() => expect(result.current.notifications).toHaveLength(2));

    await act(() => result.current.markRead("n1"));

    expect(fetchMock).toHaveBeenCalledWith("/api/notifications/n1/read", {
      method: "PATCH",
      headers: { Authorization: "Bearer tok" },
    });
    expect(result.current.notifications.map((n) => n.id)).toEqual(["n2"]);
  });

  it("does not fetch until there is a session token", async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    renderHook(() => useNotifications(10));

    await waitFor(() => expect(getSession).toHaveBeenCalled());
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
