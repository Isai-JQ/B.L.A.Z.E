import { renderHook, waitFor } from "@testing-library/react";
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

  it("does not fetch until there is a session token", async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    renderHook(() => useNotifications(10));

    await waitFor(() => expect(getSession).toHaveBeenCalled());
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
