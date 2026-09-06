import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

// PrinterDetail pulls in useFleet -> lib/supabase, which needs env at import time.
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

import PrinterDetail from "./PrinterDetail";
import type { PrinterState } from "@/hooks/useFleet";
import type { ActiveJob } from "@/pages/api/jobs/active";

const printing: PrinterState = {
  serial: "P1S-01",
  name: "P1S 01",
  gcodeState: "RUNNING",
  printPercent: 42,
  lastReportAt: new Date().toISOString(),
};

const free: PrinterState = {
  serial: "P1S-02",
  name: "P1S 02",
  gcodeState: "IDLE",
  lastReportAt: new Date().toISOString(),
};

const ownedJob: ActiveJob = { jobId: "job-1", printerSerial: "P1S-01", canControl: true };
const strangersJob: ActiveJob = { jobId: "job-1", printerSerial: "P1S-01", canControl: false };

const CONTROL_LABELS = ["Pausar", "Reanudar", "Detener"];

it("T35: the job owner sees the buttons and pressing them calls onControl with the action", () => {
  const onControl = vi.fn();
  render(<PrinterDetail printer={printing} job={ownedJob} onControl={onControl} />);

  for (const label of CONTROL_LABELS) fireEvent.click(screen.getByText(label));
  expect(onControl.mock.calls).toEqual([
    ["job-1", "pause"],
    ["job-1", "resume"],
    ["job-1", "stop"],
  ]);
});

it("T35: an admin sees the buttons on someone else's job (canControl is decided server-side)", () => {
  render(<PrinterDetail printer={printing} job={ownedJob} onControl={vi.fn()} />);
  for (const label of CONTROL_LABELS) expect(screen.getByText(label)).toBeInTheDocument();
});

it("T35: a third user (not owner, not admin) sees no buttons at all", () => {
  render(<PrinterDetail printer={printing} job={strangersJob} onControl={vi.fn()} />);
  for (const label of CONTROL_LABELS) expect(screen.queryByText(label)).toBeNull();
});

it("T35: a free printer with no job in progress shows no buttons", () => {
  render(<PrinterDetail printer={free} onControl={vi.fn()} />);
  for (const label of CONTROL_LABELS) expect(screen.queryByText(label)).toBeNull();
});
