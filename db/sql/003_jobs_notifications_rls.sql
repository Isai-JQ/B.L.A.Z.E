-- Security fix: RLS on jobs and notifications, deny-all from the client (same pattern as
-- printers, 002_printers_rls.sql). These two tables were the only ones in schema.ts
-- without .enableRLS() — with RLS off, Supabase's default grants to `anon`/`authenticated`
-- made every job and notification readable/writable by any authenticated user directly via
-- PostgREST, bypassing the ownership/role checks in pages/api/jobs/** and
-- pages/api/notifications/**.
-- No policy for anon/authenticated, so RLS blocks every client read and write. The table
-- owner (DATABASE_URL role) is not subject to RLS, so the server (pages/api/**) and the
-- gateway keep full access.
-- Reapplied automatically by `pnpm db:push` (scripts/db-push.mjs). Idempotent.

alter table public.jobs enable row level security;
alter table public.notifications enable row level security;
