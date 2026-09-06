import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fleetStatus, fleetTally, useFleet, OFFLINE_AFTER_MS } from "./useFleet";

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { auth: { getSession } } }));

describe("fleetStatus", () => {
  const fresh = new Date().toISOString();
  it("is offline without a recent report", () => {
    expect(fleetStatus({ serial: "x" })).toBe("offline");
    const old = new Date(Date.now() - OFFLINE_AFTER_MS - 1000).toISOString();
    expect(fleetStatus({ serial: "x", gcodeState: "RUNNING", lastReportAt: old })).toBe("offline");
  });
  it("is free on IDLE/FINISH, printing otherwise", () => {
    expect(fleetStatus({ serial: "x", gcodeState: "IDLE", lastReportAt: fresh })).toBe("free");
    expect(fleetStatus({ serial: "x", gcodeState: "FINISH", lastReportAt: fresh })).toBe("free");
    expect(fleetStatus({ serial: "x", gcodeState: "RUNNING", lastReportAt: fresh })).toBe("printing");
  });
  it("tallies the fleet by status", () => {
    const t = fleetTally([
      { serial: "a", gcodeState: "RUNNING", lastReportAt: fresh },
      { serial: "b", gcodeState: "IDLE", lastReportAt: fresh },
      { serial: "c" },
    ]);
    expect(t).toEqual({ total: 3, printing: 1, free: 1, offline: 1 });
  });
});

describe("useFleet", () => {
  beforeEach(() => {
    getSession.mockResolvedValue({ data: { session: { access_token: "tok" } } });
  });
  afterEach(() => vi.restoreAllMocks());

  it("reflects new telemetry on the next polling cycle without a reload", async () => {
    let percent = 40;
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => [
        {
          serial: "01P00SIM0000001",
          gcodeState: "RUNNING",
          nozzleTemp: 221,
          printPercent: percent,
          layerNum: 198,
          totalLayerNum: 320,
          lastReportAt: new Date().toISOString(),
        },
      ],
    }));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useFleet(10));

    await waitFor(() => expect(result.current.printers[0]?.printPercent).toBe(40));
    expect(fetchMock).toHaveBeenCalledWith("/api/fleet", {
      headers: { Authorization: "Bearer tok" },
    });
    expect(result.current.updatedAt).toBeInstanceOf(Date);

    // gateway merges a fresh MQTT delta — the UI picks it up on the next tick
    percent = 41;
    await waitFor(() => expect(result.current.printers[0]?.printPercent).toBe(41));
  });

  it("does not fetch until there is a session token", async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    renderHook(() => useFleet(10));

    await waitFor(() => expect(getSession).toHaveBeenCalled());
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
