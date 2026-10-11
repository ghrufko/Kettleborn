-- Phase 1: Accounts + Cloud Sync + Leaderboards — profiles
--
-- One row per Supabase auth user. Deliberately NOT a mirror of the local
-- `User` model (src/models/User.ts) — only what the cloud layer actually
-- needs: enough to display on a leaderboard, plus a home for
-- server-controlled aggregate XP/level once sync (a later phase) starts
-- writing them. unitPreference/activeCampaignId etc. stay local-only
-- forever; they have no cross-device or leaderboard value.
--
-- total_xp/level exist now so the column shape is settled, but nothing
-- in this phase writes to them — that's Phase 4 (cloud sync). For now
-- they simply sit at their defaults. Client write access to them is
-- revoked below regardless, so there is no path (now or later) for a
-- client to set its own XP/level directly.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default 'Hunter',
  total_xp integer not null default 0,
  level integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is
  'One row per auth user. display_name is client-editable; total_xp/level are server-controlled (see column GRANTs below) and unused until Phase 4 cloud sync starts writing them.';

-- Auto-create a profile row the moment a new auth user is created, so the
-- app never has to "remember" to call an initializer — mirrors how
-- bootstrapApp() unconditionally calls initializeUser() today, just on
-- the server side instead.
--
-- Security audit: no error handling around the INSERT. This trigger
-- fires inside the same transaction Supabase Auth uses to create the
-- user — if a future migration adds a constraint this INSERT doesn't
-- satisfy (e.g. a NOT NULL column on profiles with no default), the
-- exception propagates and the entire signup transaction rolls back,
-- not just profile creation. Not fixed here (no failure exists today,
-- and swallowing the exception would silently leave a user with no
-- profile row, trading one failure mode for a worse one) — documented
-- as a standing risk: review this function's error behavior before ever
-- adding a new NOT-NULL/constrained column to profiles.
--
-- search_path hardened to '' (was 'public') — the one reference below
-- (public.profiles) was already schema-qualified, so this was not
-- exploitable as written; '' makes any future accidental unqualified
-- reference fail loudly instead of silently resolving elsewhere.
-- Ownership: this function is owned by whichever role applies the
-- migration (the Supabase project's standard migration role) — confirm
-- against the actual role once applied to a real project.
create function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', 'Hunter'));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- Generic updated_at bump, reused by every table in this schema that has
-- the column (see later migrations).
create function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;

-- Every authenticated user can read every profile's public fields —
-- there is nothing sensitive in this table (email lives in auth.users,
-- which clients can never query directly). This is what lets a
-- leaderboard display "Hunter_42 — Minotaur — 12:03" without a second
-- round trip or a security-definer view.
create policy "profiles_select_all_authenticated"
  on public.profiles
  for select
  to authenticated
  using (true);

-- A user may update only their own row.
create policy "profiles_update_own"
  on public.profiles
  for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- No insert policy for `authenticated` — rows are created exclusively by
-- the handle_new_auth_user trigger (SECURITY DEFINER, bypasses RLS).
-- No delete policy — profile deletion happens via auth.users cascade
-- (account deletion flow, a later phase), never as a standalone action.

-- Column-level lockdown: even though the UPDATE policy above lets a user
-- update their own row, revoke table-wide UPDATE and grant it back only
-- for display_name. This is enforced by Postgres itself, independently
-- of RLS — a client cannot set its own total_xp/level no matter what
-- request it crafts, now or after any future policy change.
revoke update on public.profiles from authenticated;
grant update (display_name) on public.profiles to authenticated;

-- Base table grants (Supabase does not auto-grant on new tables without
-- auto_expose_new_tables; being explicit here rather than relying on a
-- project-level default). INSERT is intentionally not granted — nothing
-- in this schema ever INSERTs into profiles except the trigger above,
-- which runs as SECURITY DEFINER and is unaffected by these GRANTs.
grant select on public.profiles to authenticated;
