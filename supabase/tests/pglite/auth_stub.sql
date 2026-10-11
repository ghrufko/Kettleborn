-- Minimal hand-built stand-in for the parts of Supabase's platform that
-- are NOT part of vanilla PostgreSQL (GoTrue, the real auth schema).
-- This is NOT Supabase — it exists only so the migrations' auth.users FK
-- references and auth.uid() calls have something real to resolve against
-- inside plain Postgres (via PGlite). Mirrors Supabase's actual auth.uid()
-- implementation pattern (reads the request.jwt.claims GUC).
create schema if not exists auth;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  aud text,
  role text
);

create or replace function auth.uid() returns uuid
language sql stable
as $$
  select (nullif(current_setting('request.jwt.claims', true), '')::json->>'sub')::uuid
$$;

create role authenticated;
grant usage on schema auth to authenticated;
grant usage on schema public to authenticated;

-- Added Phase 2.3.4: real Supabase projects always have an `anon` role
-- too (the role PostgREST uses for a request with no/invalid JWT) —
-- omitted until now because no migration needed to reference it
-- directly. Needed now because the new hardening migration explicitly
-- revokes privileges from `anon` by name, which errors against a role
-- that doesn't exist. No table/column grants are given to it here
-- (matching this stub's existing minimalism) — the real project's
-- platform-level default grants are a separate, already-documented
-- behavior this stub was never trying to reproduce; it only needs to
-- exist so REVOKE statements naming it don't fail.
create role anon;
grant usage on schema auth to anon;
grant usage on schema public to anon;
