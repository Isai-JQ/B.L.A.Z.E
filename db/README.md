# db/

Schema (`schema.ts`, via `drizzle-kit push`) + hand-written RLS policies/triggers
(`sql/*.sql`, reapplied automatically by `pnpm db:push` — see `scripts/db-push.mjs`).

## Default role on registration

The `handle_new_user()` trigger (`sql/001_auth_triggers.sql`) inserts every new
profile with `role = 'member'`. There is no UI to change it yet.

## Promoting a user to `admin` (manual, T12)

`prevent_role_change()` only blocks role edits made **as the `authenticated`
role** (i.e. from the client through PostgREST). The Supabase **SQL Editor** runs
as `postgres`, so a direct `UPDATE` there is not blocked.

1. Supabase dashboard → **SQL Editor**.
2. Run (replace the email):

   ```sql
   update public.user_profiles
   set role = 'admin'
   where email = 'someone@example.com';
   ```

3. Verify:

   ```sql
   select id, email, role from public.user_profiles
   where email = 'someone@example.com';
   ```

Same thing works over `psql "$DIRECT_URL"` — that connection is also `postgres`,
not `authenticated`.
