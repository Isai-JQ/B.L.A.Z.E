import type { QueueEntry } from "@/pages/api/jobs/queue";

// T33: an admin moves a job one slot up or down in the "Cola" view. We persist
// manual_rank on *only* the two jobs that trade places — every other job keeps
// whatever it had (null for jobs that were never reordered). calculateQueueOrder
// (T21) puts any explicitly ranked job ahead of the rest, then falls back to
// tier/FIFO, so an untouched queue keeps ordering as before and a later
// higher-tier upload still slots ahead of the unranked jobs (only behind the two
// that carry an explicit rank).
//
// Both swapped jobs get manual_rank = their queue position (1-based) after the
// swap; the moves the UI allows are always adjacent, so the two ranks are the
// consecutive integers the pair already occupied.
// Returns the { job_id, manual_rank } pairs for PATCH /api/jobs/reorder (T26), or
// null when the move runs off either end of the list.
export type RankUpdate = { job_id: string; manual_rank: number };

export function swapRanks(
  queue: QueueEntry[],
  index: number,
  direction: "up" | "down",
): RankUpdate[] | null {
  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= queue.length) return null;

  const next = [...queue];
  [next[index], next[target]] = [next[target], next[index]];

  return [Math.min(index, target), Math.max(index, target)].map((i) => ({
    job_id: next[i].id,
    manual_rank: i + 1,
  }));
}
