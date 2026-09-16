-- T11b: RLS policies + provisioning/role-immutability triggers.
-- Drizzle (drizzle-kit push) enables RLS via schema.ts's enableRLS() fine, but it
-- silently drops USING/WITH CHECK expressions on `pgPolicy(...)` (creates the policy
-- with a null qual, which blocks every row) — so the actual policies, the trigger
-- functions, and the `auth` schema trigger all live here instead.
-- Run separately: `psql "$DIRECT_URL" -f db/sql/001_auth_triggers.sql`
-- (or paste into the Supabase SQL editor). Idempotent, safe to re-run.

-- organizations: read-only from the client, for anyone — the registration form
-- (AuthScreen) lists them before a session exists, so `anon` needs the read as well as
-- `authenticated`. No INSERT/UPDATE/DELETE policy — rows are created only by the
-- handle_new_user() trigger below (SECURITY DEFINER, bypasses RLS).
drop policy if exists organizations_select_authenticated on public.organizations;
drop policy if exists organizations_select_public on public.organizations;
create policy organizations_select_public on public.organizations
  for select to anon, authenticated
  using (true);

-- user_profiles: each user can only see/update their own row. No INSERT policy — rows
-- are created only by the handle_new_user() trigger below.
drop policy if exists user_profiles_select_own on public.user_profiles;
create policy user_profiles_select_own on public.user_profiles
  for select to authenticated
  using (id = auth.uid());

-- `role` itself can't be changed this way: prevent_role_change() trigger blocks it.
drop policy if exists user_profiles_update_own on public.user_profiles;
create policy user_profiles_update_own on public.user_profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Provisions organization + user_profiles when a new auth.users row is created,
-- so registration works even before email confirmation grants a session (RLS-safe:
-- SECURITY DEFINER bypasses RLS instead of requiring an INSERT policy for anon).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  org_name text := new.raw_user_meta_data ->> 'organization_name';
  org_id uuid;
begin
  -- Domain restriction, enforced here too so it can't be bypassed by calling
  -- supabase.auth.signUp() directly (skipping the AuthScreen client check).
  if new.email !~* '@tec\.mx$' then
    raise exception 'registration is restricted to @tec.mx emails';
  end if;

  select id into org_id from public.organizations where name = org_name;

  if org_id is null then
    insert into public.organizations (name, priority_tier)
    values (org_name, 2)
    returning id into org_id;
  end if;

  insert into public.user_profiles (id, email, organization_id, role)
  values (new.id, new.email, org_id, 'member');

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Blocks a logged-in user from changing their own `role` or `organization_id` through
-- PostgREST (current_user = 'authenticated'); direct/service-role updates (T12 admin
-- promotion, org transfers) are unaffected. organization_id is guarded here too: the
-- update_own policy above only checks row ownership, not which columns change, so
-- without this a user could self-reassign into a higher-priority-tier organization
-- (calculateQueueOrder sorts by the org's priority_tier) and jump the shared queue.
create or replace function public.prevent_role_change()
returns trigger
language plpgsql
as $$
begin
  if current_user = 'authenticated' and new.role is distinct from old.role then
    raise exception 'role cannot be changed by the user';
  end if;
  if current_user = 'authenticated' and new.organization_id is distinct from old.organization_id then
    raise exception 'organization_id cannot be changed by the user';
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_role_change on public.user_profiles;
create trigger prevent_role_change
  before update on public.user_profiles
  for each row execute function public.prevent_role_change();
