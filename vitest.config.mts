import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": import.meta.dirname,
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.mts"],
    // The integration tests share one live Supabase project: run files one at a time so
    // the gateway test's printers cannot grab jobs the upload test is asserting on.
    fileParallelism: false,
    // T41's E2E spec spawns `next dev` + a real Chromium; it's slow and timing-sensitive,
    // so it runs on its own via `pnpm test:e2e` (vitest.e2e.config.mts), not in `pnpm test`.
    exclude: [...configDefaults.exclude, "e2e.*.test.mts"],
  },
});
