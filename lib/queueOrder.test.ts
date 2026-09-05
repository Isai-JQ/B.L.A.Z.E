import { expect, it } from "vitest";
import { calculateQueueOrder } from "./queueOrder";

const job = (id: string, priorityTier: number, createdAt: string, manualRank?: number) => ({
  id,
  priorityTier,
  createdAt: new Date(createdAt),
  manualRank,
});
const ids = (jobs: { id: string }[]) => jobs.map((j) => j.id);

it("same tier: FIFO by created_at", () => {
  const out = calculateQueueOrder([
    job("late", 2, "2026-01-01T10:00:00Z"),
    job("early", 2, "2026-01-01T09:00:00Z"),
  ]);
  expect(ids(out)).toEqual(["early", "late"]);
});

it("lower tier wins even if created later", () => {
  const out = calculateQueueOrder([
    job("student", 2, "2026-01-01T09:00:00Z"),
    job("fred", 1, "2026-01-01T10:00:00Z"),
  ]);
  expect(ids(out)).toEqual(["fred", "student"]);
});

it("manual_rank overrides tier and FIFO", () => {
  const input = [
    job("fred", 1, "2026-01-01T09:00:00Z"),
    job("student-old", 2, "2026-01-01T08:00:00Z"),
    job("student-new", 2, "2026-01-01T11:00:00Z", 1),
  ];
  const out = calculateQueueOrder(input);
  expect(ids(out)).toEqual(["student-new", "fred", "student-old"]);
  expect(ids(input)).toEqual(["fred", "student-old", "student-new"]); // pure
});

it("multiple manual ranks are ordered among themselves", () => {
  const out = calculateQueueOrder([
    job("a", 1, "2026-01-01T09:00:00Z"),
    job("b", 2, "2026-01-01T09:00:00Z", 2),
    job("c", 2, "2026-01-01T09:00:00Z", 1),
  ]);
  expect(ids(out)).toEqual(["c", "b", "a"]);
});
