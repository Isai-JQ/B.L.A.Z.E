import { defineConfig } from "vitest/config";

// T41: the full-flow E2E spec runs `next dev` and a real Chromium (Playwright), so it
// gets its own config — Node env, no jsdom, long timeouts, and kept out of `pnpm test`.
// Run with `pnpm test:e2e`.
export default defineConfig({
  resolve: { alias: { "@": import.meta.dirname } },
  test: {
    include: ["e2e.*.test.mts"],
    environment: "node",
    testTimeout: 180_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
});
