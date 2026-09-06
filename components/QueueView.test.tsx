import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import QueueView from "./QueueView";
import type { QueueEntry } from "@/hooks/useQueue";

const queue: QueueEntry[] = [
  { id: "11111111-1111-1111-1111-111111111111", position: 1, organization: "FrED", status: "printing", fileName: "a.gcode" },
  { id: "22222222-2222-2222-2222-222222222222", position: 2, organization: "FrED", status: "queued", fileName: "b.gcode" },
  { id: "33333333-3333-3333-3333-333333333333", position: 3, organization: "ACME", status: "queued", fileName: "c.gcode" },
];

it("T33: a member sees no reorder controls at all", () => {
  render(<QueueView queue={queue} />);
  expect(screen.queryByLabelText("Subir en la cola")).toBeNull();
  expect(screen.queryByLabelText("Bajar en la cola")).toBeNull();
});

it("T33: an admin can move a job up/down, with the ends disabled", () => {
  const onMove = vi.fn();
  render(<QueueView queue={queue} isAdmin onMove={onMove} />);

  const ups = screen.getAllByLabelText("Subir en la cola");
  const downs = screen.getAllByLabelText("Bajar en la cola");
  expect(ups).toHaveLength(3);
  expect(ups[0]).toBeDisabled(); // first row can't go up
  expect(downs[2]).toBeDisabled(); // last row can't go down

  fireEvent.click(downs[0]);
  fireEvent.click(ups[2]);
  expect(onMove.mock.calls).toEqual([
    [0, "down"],
    [2, "up"],
  ]);
});
