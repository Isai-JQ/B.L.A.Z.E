import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import Home from "./index";

const { getSession, useFleet } = vi.hoisted(() => ({
  getSession: vi.fn().mockResolvedValue({ data: { session: { user: { email: "a@tec.mx" } } } }),
  useFleet: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({ supabase: { auth: { getSession } } }));
vi.mock("@/hooks/useFleet", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useFleet")>();
  return { ...actual, useFleet };
});

const simPrinter = {
  serial: "01P00SIM0000001",
  gcodeState: "RUNNING",
  nozzleTemp: 221,
  nozzleTempTarget: 220,
  bedTemp: 60,
  chamberTemp: 34,
  printPercent: 62,
  layerNum: 198,
  totalLayerNum: 320,
  remainingTime: 48,
  lastReportAt: new Date().toISOString(),
};

describe("Fleet dashboard", () => {
  it("shows temperature, progress, current layer and state of a simulated printer", () => {
    useFleet.mockReturnValue({ printers: [simPrinter], error: null, updatedAt: new Date() });

    render(<Home />);

    expect(screen.getByText("62%")).toBeInTheDocument();
    expect(screen.getByText("Capa 198 / 320")).toBeInTheDocument();
    expect(screen.getByText(/221°/)).toBeInTheDocument();
    expect(screen.getByText("RUNNING")).toBeInTheDocument();
    expect(screen.getByText("Imprimiendo")).toBeInTheDocument();
    expect(screen.getByText("imprimiendo").closest("span")).toHaveTextContent("1 imprimiendo");
  });

  it("re-renders with new telemetry when the poll returns fresh data (no reload)", () => {
    useFleet.mockReturnValue({ printers: [simPrinter], error: null, updatedAt: new Date() });
    const { rerender } = render(<Home />);
    expect(screen.getByText("62%")).toBeInTheDocument();

    useFleet.mockReturnValue({
      printers: [{ ...simPrinter, printPercent: 63 }],
      error: null,
      updatedAt: new Date(),
    });
    rerender(<Home />);
    expect(screen.getByText("63%")).toBeInTheDocument();
  });

  it("shows an empty state when no printer is reporting", () => {
    useFleet.mockReturnValue({ printers: [], error: null, updatedAt: null });

    render(<Home />);

    expect(screen.getByText(/Sin impresoras reportando/)).toBeInTheDocument();
  });
});
