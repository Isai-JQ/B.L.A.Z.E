import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

// Pooled connection for Next.js API routes (mirrors proxy.cjs / db/seed.ts).
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");

export const db = drizzle(postgres(process.env.DATABASE_URL));
