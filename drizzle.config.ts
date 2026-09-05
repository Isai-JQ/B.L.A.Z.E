import { defineConfig } from "drizzle-kit";

if (!process.env.DIRECT_URL) {
  throw new Error("DIRECT_URL is not set");
}

export default defineConfig({
  out: "./drizzle",
  schema: "./db/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DIRECT_URL,
  },
});
