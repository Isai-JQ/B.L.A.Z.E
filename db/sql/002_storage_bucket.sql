-- T20: private bucket for uploaded print files. `public = false` — objects are only
-- reachable with the service-role key (used by pages/api/jobs/upload.ts) or a signed
-- URL, never straight from the browser. No storage.objects policies for
-- anon/authenticated on purpose: the client never touches this bucket directly.
-- Idempotent, safe to re-run (applied automatically by `pnpm db:push`).
insert into storage.buckets (id, name, public)
values ('print-files', 'print-files', false)
on conflict (id) do update set public = excluded.public;
