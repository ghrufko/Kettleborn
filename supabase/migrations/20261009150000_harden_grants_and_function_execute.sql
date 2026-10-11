-- Phase 2.3.4: Security hardening — narrow table grants to the
-- intended least-privilege matrix, and lock down the three
-- trigger-only SECURITY DEFINER functions against direct execution.
--
-- Found via live, read-only inspection of the real `kettleborn-dev`
-- project after the first four migrations were applied (not visible
-- under PGlite, which has no Supabase platform layer and no default
-- new-table privilege behavior to reproduce):
--
-- 1. Every new table created in the `public` schema received
--    Supabase's own platform-level default privileges for
--    `anon`/`authenticated` (SELECT/INSERT/UPDATE/DELETE/TRUNCATE/
--    REFERENCES/TRIGGER on all five tables), layered underneath this
--    repo's own GRANT/REVOKE statements rather than replaced by them.
--    Confirmed live and NOT currently exploitable: as the real `anon`
--    role, `select count(*) from content_workouts` returned 0 rows
--    (RLS's default-deny already blocks it), and an `anon` insert into
--    `workout_results` was rejected by `workout_results_before_insert`'s
--    own `auth.uid() is null` check. This migration removes the
--    redundant grant surface anyway, so RLS is no longer the *only*
--    layer protecting these tables — matching the least-privilege
--    matrix documented in supabase/PHASE_2_1_MIGRATION_AUDIT.md's RLS
--    table, which this migration restores rather than redesigns.
-- 2. `supabase db advisors --linked --type security` flagged all three
--    SECURITY DEFINER trigger functions (`handle_new_auth_user`,
--    `workout_results_before_insert`, `sync_leaderboard_entry`) as
--    directly callable by `anon`/`authenticated` via PostgREST RPC
--    (e.g. `/rest/v1/rpc/handle_new_auth_user`) — a side effect of
--    Postgres's own default "grant EXECUTE on every new function to
--    PUBLIC," never explicitly revoked by the original migrations.
--    Also flagged: `set_updated_at` has a mutable `search_path` (it
--    was never hardened like the three SECURITY DEFINER functions
--    were in their own migrations).
--
-- Trigger execution is unaffected by any REVOKE below. A trigger
-- function is invoked internally by Postgres's trigger machinery as
-- part of statement execution (via the trigger manager's own internal
-- call path), not through the same EXECUTE-privilege check that gates
-- a direct SQL call (`select fn()`) or a PostgREST RPC request —
-- `REVOKE EXECUTE` only removes that latter, direct-call path, and
-- does not touch how `CREATE TRIGGER ... EXECUTE FUNCTION ...` fires.
-- This is exactly why Supabase's own lint remediation for this finding
-- recommends `REVOKE EXECUTE` as a safe, standard fix specifically for
-- a trigger function (the other suggested fix, `SECURITY INVOKER`,
-- would NOT be safe here — these functions deliberately need the
-- elevated privileges of their owner to look up `content_hunts`/
-- `content_workouts` and to validate/insert across tables the calling
-- role has no direct access to).
--
-- Also unaffected: every SECURITY DEFINER function's internal table
-- access (e.g. workout_results_before_insert() reading
-- content_hunts/content_workouts, sync_leaderboard_entry() inserting
-- into leaderboard_entries) — SECURITY DEFINER functions run with the
-- privileges of their OWNER for everything inside the function body,
-- never the calling role's own GRANTs, which is the entire point of
-- marking them SECURITY DEFINER in the first place. The REVOKE/GRANT
-- statements below only change what `anon`/`authenticated` can do
-- directly, as themselves — never what these three functions can do
-- internally.
--
-- Intended least-privilege matrix this migration restores:
--   profiles             : authenticated SELECT (all rows, RLS) + UPDATE (display_name column only); anon none.
--   content_workouts      : authenticated SELECT (all rows, RLS); anon none.
--   content_hunts         : authenticated SELECT (all rows, RLS); anon none.
--   workout_results       : authenticated SELECT + INSERT (own rows, RLS+trigger); anon none.
--   leaderboard_entries   : authenticated SELECT (all rows, RLS); anon none — all writes happen only
--                           via sync_leaderboard_entry(), which runs as its owner, not as
--                           `authenticated`, so revoking authenticated's/anon's own table grants
--                           here does not affect that trigger's ability to write.

-- ---------------------------------------------------------------------
-- 1. anon: remove the platform-default grant entirely on all five
--    tables. anon was never intended to have any access to any of
--    them — RLS already enforces this with no `anon`-scoped policy
--    anywhere (verified live, see header) — this closes the redundant
--    grant rather than relying on RLS alone to cover for it.
-- ---------------------------------------------------------------------
revoke all on public.profiles from anon;
revoke all on public.content_workouts from anon;
revoke all on public.content_hunts from anon;
revoke all on public.workout_results from anon;
revoke all on public.leaderboard_entries from anon;

-- ---------------------------------------------------------------------
-- 2. authenticated: revoke the platform-default ALL grant on every
--    table, then re-grant exactly the operations each table's RLS
--    policies and the existing application code actually use.
-- ---------------------------------------------------------------------
revoke all on public.profiles from authenticated;
grant select on public.profiles to authenticated;
-- Re-applies the same column-scoped UPDATE migration
-- 20250615120000_profiles.sql originally granted — `revoke all` above
-- removes every privilege including that column grant, so it is
-- re-stated here rather than left implicitly gone. Same column-level
-- lockdown as the original design, unchanged.
grant update (display_name) on public.profiles to authenticated;

revoke all on public.content_workouts from authenticated;
grant select on public.content_workouts to authenticated;

revoke all on public.content_hunts from authenticated;
grant select on public.content_hunts to authenticated;

revoke all on public.workout_results from authenticated;
grant select, insert on public.workout_results to authenticated;

revoke all on public.leaderboard_entries from authenticated;
grant select on public.leaderboard_entries to authenticated;

-- ---------------------------------------------------------------------
-- 3. Lock down the three trigger-only SECURITY DEFINER functions
--    against direct execution (PostgREST RPC or a plain SQL call) by
--    anon/authenticated/PUBLIC. See header comment for why trigger
--    firing itself is unaffected.
-- ---------------------------------------------------------------------
revoke execute on function public.handle_new_auth_user() from public, anon, authenticated;
revoke execute on function public.workout_results_before_insert() from public, anon, authenticated;
revoke execute on function public.sync_leaderboard_entry() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. set_updated_at: harden search_path the same way the three
--    SECURITY DEFINER functions already were in their own migrations.
--    Not SECURITY DEFINER itself, but the Security Advisor still flags
--    any function with a mutable search_path as a best-practice gap.
--    Safe: the function's entire body is `new.updated_at = now();
--    return new;` — zero schema-qualified or unqualified object
--    references, so an empty search_path changes nothing about its
--    behavior (re-confirmed by re-reading the function body in
--    20250615120000_profiles.sql before writing this statement).
-- ---------------------------------------------------------------------
alter function public.set_updated_at() set search_path = '';
