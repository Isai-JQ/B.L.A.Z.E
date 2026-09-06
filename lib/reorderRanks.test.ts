import { expect, it } from "vitest";
import { swapRanks } from "./reorderRanks";
import { calculateQueueOrder } from "./queueOrder";
import type { QueueEntry } from "@/pages/api/jobs/queue";

const q = (ids: string[]): QueueEntry[] =>
  ids.map((id, i) => ({
    id,
    position: i + 1,
    organization: "org",
    status: "queued",
    fileName: `${id}.gcode`,
  }));

it("ranks only the two swapped jobs, never the rest", () => {
  const down = swapRanks(q(["a", "b", "c", "d"]), 1, "down"); // b <-> c
  const up = swapRanks(q(["a", "b", "c", "d"]), 2, "up"); // same end state

  expect(down).toEqual([
    { job_id: "c", manual_rank: 2 },
    { job_id: "b", manual_rank: 3 },
  ]);
  expect(up).toEqual(down);
  expect(down!.map((u) => u.job_id).sort()).toEqual(["b", "c"]); // a and d untouched -> stay null
});

it("returns null when the move runs off either end", () => {
  expect(swapRanks(q(["a", "b"]), 0, "up")).toBeNull();
  expect(swapRanks(q(["a", "b"]), 1, "down")).toBeNull();
});

it("a sparse reorder does not contaminate the rest of the queue", () => {
  // Queue before: all tier 2, FIFO order a,b,c,d — none ranked.
  const mkJob = (id: string, tier: number, createdAt: string, manualRank: number | null) => ({
    id,
    priorityTier: tier,
    createdAt: new Date(createdAt),
    manualRank,
  });
  const ranks = new Map<string, number>(
    swapRanks(q(["a", "b", "c", "d"]), 1, "down")!.map((u) => [u.job_id, u.manual_rank]),
  );

  const applied = ["a", "b", "c", "d"].map((id, i) =>
    mkJob(id, 2, `2026-01-01T0${i}:00:00Z`, ranks.get(id) ?? null),
  );

  // Only c and b carry a rank; a and d are still null.
  expect(applied.filter((j) => j.manualRank !== null).map((j) => j.id).sort()).toEqual(["b", "c"]);

  // c and b sit in the swapped order up front; a and d keep FIFO behind them.
  expect(calculateQueueOrder(applied).map((j) => j.id)).toEqual(["c", "b", "a", "d"]);

  // A job uploaded *after* the reorder, higher tier than the untouched jobs, slots
  // ahead of a and d — only behind the two that carry an explicit manual_rank.
  const withNew = [...applied, mkJob("new-hi", 1, "2026-01-01T09:00:00Z", null)];
  expect(calculateQueueOrder(withNew).map((j) => j.id)).toEqual(["c", "b", "new-hi", "a", "d"]);
});
