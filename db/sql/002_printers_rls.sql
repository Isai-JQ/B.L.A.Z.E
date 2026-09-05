-- T16b: RLS on printers, deny-all from the client.
-- No policy for anon/authenticated, so RLS blocks every client read and write.
-- The table owner (DATABASE_URL role) is not subject to RLS, so the server keeps
-- full access; anything that needs printers in the browser must go through a
-- server route that omits access_code.
-- Reapplied automatically by `pnpm db:push` (scripts/db-push.mjs). Idempotent.

alter table public.printers enable row level security;
