import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

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
  },
});
