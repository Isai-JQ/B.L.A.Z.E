export type QueueJob = {
  priorityTier: number; // lower = higher priority
  createdAt: Date;
  manualRank?: number | null;
};

// Pure: returns a new array, input untouched.
// Manually ranked jobs go first (by rank); the rest by tier, then FIFO.
export function calculateQueueOrder<T extends QueueJob>(jobs: readonly T[]): T[] {
  return [...jobs].sort((a, b) => {
    const ra = a.manualRank ?? null;
    const rb = b.manualRank ?? null;
    if (ra !== null && rb !== null) return ra - rb;
    if (ra !== null) return -1;
    if (rb !== null) return 1;
    return a.priorityTier - b.priorityTier || a.createdAt.getTime() - b.createdAt.getTime();
  });
}
