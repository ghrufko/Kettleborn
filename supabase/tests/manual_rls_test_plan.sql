-- Manual RLS / validation test plan — Phase 1
--
-- HOW TO RUN: paste into the Supabase Dashboard's SQL Editor (or `psql`
-- against the project, or `supabase db start` + `psql` locally once
-- Docker is available) AFTER the migrations in supabase/migrations/ have
-- been applied. Runs as the `postgres` role by default there, which
-- bypasses RLS — each scenario below explicitly switches to the
-- `authenticated` role and sets a fake JWT claim to simulate a specific
-- signed-in user, which is the standard documented way to exercise RLS
-- policies from raw SQL without a real auth session:
--   https://supabase.com/docs/guides/database/postgres/row-level-security#testing-policies
--
-- This script was written but NOT executed against a real Supabase
-- project — there is no live Supabase project in this environment to
-- run it against (no CLI auth, no Docker for a local instance).
-- Everything below is ready to run as-is once a project exists; see
-- supabase/README.md for exact setup steps.
--
-- Phase 1.3 update: every scenario in this file (A-R) HAS been executed
-- — not against real Supabase, but against a real embedded PostgreSQL
-- instance (PGlite) using a hand-built auth.uid()/auth.users stand-in.
-- See supabase/tests/pglite/ (run_suite.mjs mirrors A-O plus P/Q/R below,
-- run_edge.mjs covers weight/time boundaries and exact rank cutoffs) and
-- supabase/VALIDATION_REPORT.md for exactly what that does and does not
-- prove relative to a real Supabase project. Scenarios P, Q, R were
-- added to this file in that same pass, ported back from run_suite.mjs
-- where they were originally written.
--
-- CAVEAT on the fixture insert directly below: Supabase's auth.users
-- schema has evolved across versions and may require columns beyond the
-- ones listed here (instance_id, aud, encrypted_password, etc.) on your
-- project's exact version. If this INSERT fails, create the two test
-- users the robust way instead — Dashboard -> Authentication -> Add
-- user (or supabase.auth.admin.createUser() via the service role key) —
-- then replace the two UUIDs used throughout this file with the real
-- ones it generates.
--
-- Each scenario is wrapped in its own begin/rollback so running the
-- whole file leaves no permanent test data behind, and scenarios can be
-- re-run independently and repeatedly.

-- ---------------------------------------------------------------------
-- Fixtures: two fake auth users. Inserting directly into auth.users only
-- works with elevated (postgres/service_role) access, which is exactly
-- what the SQL Editor / a direct psql connection has — this bypasses
-- Supabase's normal signup flow deliberately, for test setup only.
-- ---------------------------------------------------------------------
begin;

insert into auth.users (id, email, raw_user_meta_data, created_at, updated_at, aud, role)
values
  ('11111111-1111-1111-1111-111111111111', 'hunter.a@test.kettleborn', '{"display_name":"HunterA"}', now(), now(), 'authenticated', 'authenticated'),
  ('22222222-2222-2222-2222-222222222222', 'hunter.b@test.kettleborn', '{"display_name":"HunterB"}', now(), now(), 'authenticated', 'authenticated')
on conflict (id) do nothing;

-- handle_new_auth_user() should have fired automatically; confirm both
-- profiles exist before continuing.
select id, display_name, total_xp, level from public.profiles
where id in ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222');
-- EXPECT: 2 rows, total_xp=0, level=1 for both.

commit;

-- =======================================================================
-- A. Valid canonical workout result -> accepted, ranked, on the leaderboard
-- =======================================================================
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

insert into public.workout_results
  (user_id, monster_id, workout_id, hunt_id, canonical_weight_kg, gear_count, elapsed_seconds, is_custom_hunt, app_version, content_version)
values
  ('00000000-0000-0000-0000-000000000000', -- deliberately wrong — must be overwritten, see assertion below
   'wrong-monster', 'everlasting-cycle', 'hydra-first-encounter', 16, 2, 900, false, '0.1.0', 'v1')
returning id, user_id, monster_id, rank, completed_at;
-- EXPECT: user_id = 11111111-..., monster_id = 'hydra' (NOT 'wrong-monster'),
-- rank computed (target_time_seconds for everlasting-cycle is 1080s;
-- 900 <= 1080*0.85=918, so rank should be 'S'), completed_at ~ now().

select * from public.leaderboard_entries
where user_id = '11111111-1111-1111-1111-111111111111' and workout_id = 'everlasting-cycle';
-- EXPECT: 1 row, elapsed_seconds = 900, rank = 'S'.

rollback;

-- =======================================================================
-- B. Custom hunt -> stored in workout_results, excluded from leaderboard
-- =======================================================================
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

insert into public.workout_results
  (user_id, monster_id, workout_id, hunt_id, canonical_weight_kg, gear_count, elapsed_seconds, is_custom_hunt)
values
  ('11111111-1111-1111-1111-111111111111', 'hydra', 'everlasting-cycle', 'hydra-first-encounter', 16, 2, 500, true)
returning id;
-- EXPECT: insert succeeds (row 1 saved).

select count(*) from public.leaderboard_entries
where user_id = '11111111-1111-1111-1111-111111111111' and workout_id = 'everlasting-cycle';
-- EXPECT: 0. AUDIT FIX (comment accuracy, not a logic bug): this scenario
-- runs in its own rolled-back transaction, so scenario A's row does NOT
-- actually exist here to compare against — the original comment's "a
-- faster time than scenario A's 900s" overclaimed a comparison that
-- isn't really happening. What this genuinely proves: a fast
-- (500s), otherwise-eligible-looking result with is_custom_hunt=true
-- produces zero leaderboard rows, full stop — not "didn't beat an
-- existing entry," just "never eligible at all."

rollback;

-- =======================================================================
-- C. Fake user_id -> ignored, replaced by auth.uid()
-- =======================================================================
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

insert into public.workout_results
  (user_id, monster_id, workout_id, hunt_id, canonical_weight_kg, gear_count, elapsed_seconds, is_custom_hunt)
values
  ('22222222-2222-2222-2222-222222222222', -- HunterB's id — attempting to submit as someone else
   'hydra', 'everlasting-cycle', 'hydra-first-encounter', 16, 2, 950, false)
returning user_id;
-- EXPECT: returned user_id = '11111111-1111-1111-1111-111111111111'
-- (the REAL authenticated caller), not the submitted 22222222-....

rollback;

-- =======================================================================
-- D. Fake rank -> server does not trust it
-- =======================================================================
-- AUDIT FIX: the original version of this scenario used elapsed_seconds
-- = 1200 and claimed it should rank 'C'. That was wrong — 1080 * 1.15 =
-- 1242, and 1200 <= 1242, so 1200 actually falls inside the 'B' band
-- (11.1% over target is still within the 15% B threshold). The bug was
-- in this test's own arithmetic, not in the trigger. Changed to 1300
-- (20.4% over target, unambiguously past 115%) so this scenario
-- genuinely exercises the 'C' fallthrough instead of silently asserting
-- the wrong expected value.
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

insert into public.workout_results
  (user_id, monster_id, workout_id, hunt_id, canonical_weight_kg, gear_count, elapsed_seconds, rank, is_custom_hunt)
values
  ('11111111-1111-1111-1111-111111111111', 'hydra', 'everlasting-cycle', 'hydra-first-encounter', 16, 2, 1300, 'S', false)
  -- 1300s is 20.4% OVER target_time_seconds (1080; 1080*1.15=1242, and
  -- 1300 > 1242) -> should rank 'C', not the submitted 'S'.
returning rank;
-- EXPECT: 'C', not 'S'.

rollback;

-- =======================================================================
-- E. Impossible elapsed time -> saved to history, excluded from leaderboard
-- =======================================================================
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

insert into public.workout_results
  (user_id, monster_id, workout_id, hunt_id, canonical_weight_kg, gear_count, elapsed_seconds, is_custom_hunt)
values
  ('11111111-1111-1111-1111-111111111111', 'hydra', 'everlasting-cycle', 'hydra-first-encounter', 16, 2, 5, false)
  -- everlasting-cycle's min_elapsed_seconds is 324 (30% of 1080) — 5s is not plausible.
returning id;
-- EXPECT: insert still succeeds (it's real history / not a reason to
-- lose the player's row), but:

select count(*) from public.leaderboard_entries
where user_id = '11111111-1111-1111-1111-111111111111' and workout_id = 'everlasting-cycle';
-- EXPECT: 0 — excluded from the leaderboard.

rollback;

-- =======================================================================
-- F. Invalid workout/hunt combination -> rejected outright
-- =======================================================================
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

-- F1: hunt_id that doesn't exist at all.
do $$
begin
  insert into public.workout_results
    (user_id, monster_id, workout_id, hunt_id, canonical_weight_kg, gear_count, elapsed_seconds, is_custom_hunt)
  values
    ('11111111-1111-1111-1111-111111111111', 'hydra', 'everlasting-cycle', 'not-a-real-hunt-id', 16, 2, 900, false);
  raise exception 'TEST FAILED: insert should have been rejected';
exception
  when others then
    raise notice 'F1 EXPECTED rejection: %', sqlerrm;
end $$;

-- F2: hunt_id is real, but workout_id doesn't match that hunt's actual workout.
do $$
begin
  insert into public.workout_results
    (user_id, monster_id, workout_id, hunt_id, canonical_weight_kg, gear_count, elapsed_seconds, is_custom_hunt)
  values
    ('11111111-1111-1111-1111-111111111111', 'hydra', 'abyss-carry', -- wrong workout for this hunt
     'hydra-first-encounter', -- real hunt_id, actually belongs to 'everlasting-cycle'
     16, 2, 900, false);
  raise exception 'TEST FAILED: insert should have been rejected';
exception
  when others then
    raise notice 'F2 EXPECTED rejection: %', sqlerrm;
end $$;

rollback;

-- =======================================================================
-- G. Attempt to INSERT leaderboard_entries directly -> rejected by RLS
-- =======================================================================
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

do $$
begin
  insert into public.leaderboard_entries
    (user_id, workout_id, monster_id, best_result_id, elapsed_seconds, rank, achieved_at)
  values
    ('11111111-1111-1111-1111-111111111111', 'everlasting-cycle', 'hydra',
     gen_random_uuid(), 1, 'S', now());
  raise exception 'TEST FAILED: direct insert should have been rejected';
exception
  when others then
    raise notice 'G EXPECTED rejection: %', sqlerrm;
end $$;

rollback;

-- =======================================================================
-- H. Attempt to UPDATE leaderboard_entries -> rejected
-- =======================================================================
-- AUDIT FIX: the original version of this scenario expected "0 rows
-- affected" as a silent no-op. That was wrong about the mechanism —
-- `authenticated` has no UPDATE grant AT ALL on leaderboard_entries
-- (only SELECT was granted). A missing table-level privilege is checked
-- by Postgres BEFORE row-level security / row-matching even applies, so
-- this statement does not run-and-match-zero-rows — it throws
-- "permission denied for table leaderboard_entries" immediately. Wrapped
-- in the same exception-catching pattern as F/G so the script can assert
-- that outcome instead of just asserting an affected-row count that was
-- never going to be reached.
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

do $$
begin
  update public.leaderboard_entries
  set elapsed_seconds = 1
  where user_id = '11111111-1111-1111-1111-111111111111';
  raise exception 'TEST FAILED: UPDATE should have been rejected with permission denied';
exception
  when insufficient_privilege then
    raise notice 'H EXPECTED rejection (permission denied): %', sqlerrm;
  when others then
    raise notice 'H rejected, but with an unexpected error class — verify this is still permission denied: %', sqlerrm;
end $$;

rollback;

-- =======================================================================
-- I. Attempt to modify another user's workout result -> rejected
-- =======================================================================
begin;
-- Seed a result as HunterB first (service-role bypasses RLS for setup).
reset role;
insert into public.workout_results
  (user_id, monster_id, workout_id, hunt_id, canonical_weight_kg, gear_count, elapsed_seconds, is_custom_hunt)
values
  ('22222222-2222-2222-2222-222222222222', 'hydra', 'everlasting-cycle', 'hydra-first-encounter', 16, 2, 950, false);

-- Now act as HunterA and try to read/update/delete HunterB's row.
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

select count(*) from public.workout_results where user_id = '22222222-2222-2222-2222-222222222222';
-- EXPECT: 0 — HunterA cannot even SELECT HunterB's rows (select_own
-- policy). This one IS a genuine silent-filter case: `authenticated` DOES
-- hold a base SELECT grant on workout_results, so RLS row-matching is
-- what applies here, correctly returning zero matching rows rather than
-- throwing — unlike the UPDATE/DELETE below.

-- AUDIT FIX: the UPDATE and DELETE below originally expected "0 rows
-- affected" as a silent no-op, same wrong-mechanism bug as scenario H —
-- `authenticated` has no UPDATE or DELETE grant at all on
-- workout_results (only SELECT, INSERT), so both throw permission
-- denied immediately rather than running and matching zero rows.
do $$
begin
  update public.workout_results set elapsed_seconds = 1 where user_id = '22222222-2222-2222-2222-222222222222';
  raise exception 'TEST FAILED: UPDATE should have been rejected with permission denied';
exception
  when insufficient_privilege then
    raise notice 'I (update) EXPECTED rejection (permission denied): %', sqlerrm;
  when others then
    raise notice 'I (update) rejected, but with an unexpected error class: %', sqlerrm;
end $$;

do $$
begin
  delete from public.workout_results where user_id = '22222222-2222-2222-2222-222222222222';
  raise exception 'TEST FAILED: DELETE should have been rejected with permission denied';
exception
  when insufficient_privilege then
    raise notice 'I (delete) EXPECTED rejection (permission denied): %', sqlerrm;
  when others then
    raise notice 'I (delete) rejected, but with an unexpected error class: %', sqlerrm;
end $$;

rollback;

-- =======================================================================
-- J. Two valid results, same user + workout -> leaderboard shows the
--    fastest
-- =======================================================================
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

insert into public.workout_results
  (user_id, monster_id, workout_id, hunt_id, canonical_weight_kg, gear_count, elapsed_seconds, is_custom_hunt)
values
  ('11111111-1111-1111-1111-111111111111', 'hydra', 'everlasting-cycle', 'hydra-first-encounter', 16, 2, 1000, false);

insert into public.workout_results
  (user_id, monster_id, workout_id, hunt_id, canonical_weight_kg, gear_count, elapsed_seconds, is_custom_hunt)
values
  ('11111111-1111-1111-1111-111111111111', 'hydra', 'everlasting-cycle', 'hydra-first-encounter', 16, 2, 850, false); -- faster

select elapsed_seconds from public.leaderboard_entries
where user_id = '11111111-1111-1111-1111-111111111111' and workout_id = 'everlasting-cycle';
-- EXPECT: 850 (the faster one), not 1000.

insert into public.workout_results
  (user_id, monster_id, workout_id, hunt_id, canonical_weight_kg, gear_count, elapsed_seconds, is_custom_hunt)
values
  ('11111111-1111-1111-1111-111111111111', 'hydra', 'everlasting-cycle', 'hydra-first-encounter', 16, 2, 999, false); -- slower than 850

select elapsed_seconds from public.leaderboard_entries
where user_id = '11111111-1111-1111-1111-111111111111' and workout_id = 'everlasting-cycle';
-- EXPECT: still 850 — a slower result must never overwrite a faster one.

rollback;

-- =======================================================================
-- K. Two different users -> both appear independently
-- =======================================================================
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
insert into public.workout_results
  (user_id, monster_id, workout_id, hunt_id, canonical_weight_kg, gear_count, elapsed_seconds, is_custom_hunt)
values
  ('11111111-1111-1111-1111-111111111111', 'hydra', 'everlasting-cycle', 'hydra-first-encounter', 16, 2, 900, false);

set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';
insert into public.workout_results
  (user_id, monster_id, workout_id, hunt_id, canonical_weight_kg, gear_count, elapsed_seconds, is_custom_hunt)
values
  ('22222222-2222-2222-2222-222222222222', 'hydra', 'everlasting-cycle', 'hydra-first-encounter', 16, 2, 800, false);

reset role;
select user_id, elapsed_seconds from public.leaderboard_entries
where workout_id = 'everlasting-cycle'
order by elapsed_seconds asc;
-- EXPECT: 2 rows — HunterB (800s) then HunterA (900s), both present,
-- neither overwrote the other (different user_id = different PK).

rollback;

-- =======================================================================
-- L. PR-specific S-rank, isolated from the ordinary time threshold
-- =======================================================================
-- Added by the security audit follow-up: every existing S-ranked
-- scenario (A, D's 'S' claim, etc.) happens to also satisfy the 85%
-- time threshold on its own, so a bug that broke the PR branch
-- specifically (v_is_pr) would have passed every prior test undetected.
-- This isolates it: first result ranks 'A' (exactly 100% of target, not
-- fast enough for 'S' by time), second result is faster than the first
-- but STILL not fast enough for 'S' by the time threshold alone (it's
-- between 85% and 100%) — it must be marked 'S' via the PR path or this
-- test fails.
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

insert into public.workout_results
  (user_id, monster_id, workout_id, hunt_id, canonical_weight_kg, gear_count, elapsed_seconds, is_custom_hunt)
values
  ('11111111-1111-1111-1111-111111111111', 'hydra', 'everlasting-cycle', 'hydra-first-encounter', 16, 2, 1080, false)
returning rank;
-- EXPECT: 'A' (1080 <= 1080*1.00, but 1080 > 1080*0.85=918).

insert into public.workout_results
  (user_id, monster_id, workout_id, hunt_id, canonical_weight_kg, gear_count, elapsed_seconds, is_custom_hunt)
values
  ('11111111-1111-1111-1111-111111111111', 'hydra', 'everlasting-cycle', 'hydra-first-encounter', 16, 2, 1000, false)
returning rank;
-- EXPECT: 'S'. By time alone, 1000 > 918 would only earn 'A' — this
-- must come from v_is_pr (1000 < the prior best of 1080), not the time
-- threshold. If this returns 'A' instead, the PR branch is broken.

rollback;

-- =======================================================================
-- M. Canonical gear-count mismatch -> rejected (security audit fix C1)
-- =======================================================================
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

-- everlasting-cycle's canonical gear_count is 2 (see content_workouts
-- seed data) — submitting gear_count=1 while claiming is_custom_hunt=false
-- is a structural contradiction and must be rejected outright, not
-- merely excluded from the leaderboard.
do $$
begin
  insert into public.workout_results
    (user_id, monster_id, workout_id, hunt_id, canonical_weight_kg, gear_count, elapsed_seconds, is_custom_hunt)
  values
    ('11111111-1111-1111-1111-111111111111', 'hydra', 'everlasting-cycle', 'hydra-first-encounter', 16, 1, 900, false);
  raise exception 'TEST FAILED: gear_count mismatch on a canonical claim should have been rejected';
exception
  when others then
    raise notice 'M EXPECTED rejection: %', sqlerrm;
end $$;

-- The same gear_count=1 submission with is_custom_hunt=true must be
-- accepted without issue — the C1 check only applies to canonical
-- (is_custom_hunt=false) claims, by design (a genuinely custom session
-- can legitimately use different equipment).
insert into public.workout_results
  (user_id, monster_id, workout_id, hunt_id, canonical_weight_kg, gear_count, elapsed_seconds, is_custom_hunt)
values
  ('11111111-1111-1111-1111-111111111111', 'hydra', 'everlasting-cycle', 'hydra-first-encounter', 16, 1, 900, true)
returning id;
-- EXPECT: insert succeeds.

rollback;

-- =======================================================================
-- N. Second kettlebell weight outside the allowed range -> saved to
--    history, excluded from the leaderboard (security audit fix C2)
-- =======================================================================
-- weight_b_kg = 50 passes the table-level 60kg absolute ceiling (added
-- in this same fix — see the column definition in
-- 20250615120200_workout_results.sql) but is still far outside
-- everlasting-cycle's content-specific [8, 24] plausibility range. This
-- is deliberately the in-range-of-the-ceiling-but-outside-content-bounds
-- case, so it genuinely exercises sync_leaderboard_entry()'s NULL-safe
-- eligibility check rather than just tripping the blunter table CHECK
-- (a weight_b_kg of, say, 500 would fail at the CHECK constraint before
-- ever reaching that function, which would prove less).
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

insert into public.workout_results
  (user_id, monster_id, workout_id, hunt_id, canonical_weight_kg, weight_b_kg, gear_count, elapsed_seconds, is_custom_hunt)
values
  ('11111111-1111-1111-1111-111111111111', 'hydra', 'everlasting-cycle', 'hydra-first-encounter', 16, 50, 2, 900, false)
returning id;
-- EXPECT: insert succeeds (50 <= 60, and nothing structurally rejects it).

select count(*) from public.leaderboard_entries
where user_id = '11111111-1111-1111-1111-111111111111' and workout_id = 'everlasting-cycle';
-- EXPECT: 0 — weight_b_kg=50 is outside [8, 24], so this must be
-- excluded even though canonical_weight_kg alone was fine.

rollback;

-- =======================================================================
-- O. Single-kettlebell result with a non-null second weight -> rejected
--    (security audit fix C2, structural half)
-- =======================================================================
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

-- iron-descent (Moloch/The Risen) is canonically gear_count=1. Claiming
-- gear_count=1 while also reporting a weight_b_kg is self-contradictory
-- — a single-bell result has no second bell to report a weight for.
do $$
begin
  insert into public.workout_results
    (user_id, monster_id, workout_id, hunt_id, canonical_weight_kg, weight_b_kg, gear_count, elapsed_seconds, is_custom_hunt)
  values
    ('11111111-1111-1111-1111-111111111111', 'moloch', 'iron-descent', 'moloch-first-encounter', 20, 16, 1, 300, false);
  raise exception 'TEST FAILED: gear_count=1 with a non-null weight_b_kg should have been rejected';
exception
  when others then
    raise notice 'O EXPECTED rejection: %', sqlerrm;
end $$;

-- The same submission with weight_b_kg omitted (NULL) must succeed —
-- confirms the rejection above is specifically about the contradiction,
-- not about iron-descent/gear_count=1 submissions in general.
insert into public.workout_results
  (user_id, monster_id, workout_id, hunt_id, canonical_weight_kg, weight_b_kg, gear_count, elapsed_seconds, is_custom_hunt)
values
  ('11111111-1111-1111-1111-111111111111', 'moloch', 'iron-descent', 'moloch-first-encounter', 20, null, 1, 300, false)
returning id;
-- EXPECT: insert succeeds.

rollback;

-- =======================================================================
-- P. gear_count=2 with a NULL weight_b_kg -> rejected (Phase 1.3 fix)
-- =======================================================================
-- Found by actually executing workout_results_before_insert() against
-- real Postgres (PGlite), not by static review: before this fix, a
-- gear_count=2 submission that simply omitted weight_b_kg was NOT
-- rejected here — it inserted successfully and was then silently
-- excluded from the leaderboard by sync_leaderboard_entry()'s NULL-safe
-- eligibility check, with no error telling anyone why. Symmetric with
-- scenario O (gear_count=1 + non-null weight_b_kg): both are structural
-- contradictions, now both rejected at insert. See the trigger's own
-- comment in 20250615120200_workout_results.sql for the full rationale.
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

do $$
begin
  insert into public.workout_results
    (user_id, monster_id, workout_id, hunt_id, canonical_weight_kg, gear_count, elapsed_seconds, is_custom_hunt)
  values
    ('11111111-1111-1111-1111-111111111111', 'hydra', 'everlasting-cycle', 'hydra-first-encounter', 16, 2, 900, false);
  raise exception 'TEST FAILED: gear_count=2 with a NULL weight_b_kg should have been rejected';
exception
  when others then
    raise notice 'P EXPECTED rejection: %', sqlerrm;
end $$;

rollback;

-- =======================================================================
-- Q. profiles: total_xp/level are column-locked; display_name is not
-- =======================================================================
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

do $$
begin
  update public.profiles set total_xp = 99999 where id = '11111111-1111-1111-1111-111111111111';
  raise exception 'TEST FAILED: writing total_xp directly should have been rejected with permission denied';
exception
  when insufficient_privilege then
    raise notice 'Q1 EXPECTED rejection (permission denied, column privilege): %', sqlerrm;
  when others then
    raise notice 'Q1 rejected, but with an unexpected error class: %', sqlerrm;
end $$;

update public.profiles set display_name = 'NewName' where id = '11111111-1111-1111-1111-111111111111';
select display_name from public.profiles where id = '11111111-1111-1111-1111-111111111111';
-- EXPECT: 'NewName' — display_name has no REVOKE, unlike total_xp/level.

-- Attempting to update another user's profile matches zero rows under
-- RLS (profiles_update_own) rather than throwing — this is the
-- SELECT-grant-exists, RLS-filters-rows case, like scenario I1, not the
-- no-grant-at-all case like Q1 above.
update public.profiles set display_name = 'Hacked' where id = '22222222-2222-2222-2222-222222222222';
select display_name from public.profiles where id = '22222222-2222-2222-2222-222222222222';
-- EXPECT: 'HunterB' (unchanged) — 0 rows matched, not an error.

rollback;

-- =======================================================================
-- R. Unauthenticated insert (no JWT claim set at all) -> rejected
-- =======================================================================
begin;
set local role authenticated;
-- Deliberately no `set local request.jwt.claims ...` — auth.uid() must
-- resolve to NULL here, exactly as it would for a request with no valid
-- session token.

do $$
begin
  insert into public.workout_results
    (user_id, monster_id, workout_id, hunt_id, canonical_weight_kg, gear_count, elapsed_seconds, is_custom_hunt)
  values
    (null, 'hydra', 'everlasting-cycle', 'hydra-first-encounter', 16, 2, 900, false);
  raise exception 'TEST FAILED: an unauthenticated insert should have been rejected';
exception
  when others then
    raise notice 'R EXPECTED rejection: %', sqlerrm;
end $$;

rollback;

-- ---------------------------------------------------------------------
-- Cleanup: remove the two fake auth users (cascades to any committed
-- profiles/workout_results/leaderboard_entries — none should exist if
-- every scenario above was rolled back as written).
-- ---------------------------------------------------------------------
begin;
reset role;
delete from auth.users where id in (
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222'
);
commit;
