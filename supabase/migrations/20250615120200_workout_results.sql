-- Phase 1: Accounts + Cloud Sync + Leaderboards — workout_results
--
-- The cloud counterpart of the local WorkoutResult row (src/models/
-- WorkoutResult.ts, written exclusively by workoutSlice.completeHunt()).
-- Nothing in the local app writes here yet — Phase 1 is backend-only —
-- but the shape matches what Phase 4 (cloud sync) will eventually push.
--
-- Security model: user_id, completed_at, monster_id and rank are never
-- trusted from the client. A BEFORE INSERT trigger (below) forcibly
-- overwrites them regardless of what's submitted, before RLS's WITH
-- CHECK is evaluated — so even a maliciously crafted insert ends up
-- with server-computed values, not just a rejected one.
--
-- Immutability: there is deliberately no UPDATE policy and no UPDATE
-- grant on this table for any role but the migration owner. A result is
-- correct forever or it doesn't exist — matching how the local
-- `workout_result` table already works (saveResult/updateRPE/updateNotes
-- only ever touch specific narrow columns, never the row wholesale, and
-- RPE/notes aren't leaderboard-relevant fields anyway).

create table public.workout_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Never trusted from the client — always overwritten from
  -- content_hunts.monster_id by the trigger below, derived from hunt_id.
  monster_id text not null,
  workout_id text not null references public.content_workouts (workout_id),
  hunt_id text not null references public.content_hunts (hunt_id),
  -- 60kg ceiling matches the app's own existing Hunt Overview weight
  -- input validation (positive, <= 60kg) — an absolute sanity bound,
  -- deliberately looser than content_workouts' per-workout min/max_weight_kg
  -- range (the highest canonical gearWeightKg in current content is 20kg,
  -- so even its 1.5x band tops out at 30kg — this ceiling never
  -- constrains a legitimate submission, it only catches nonsense like a
  -- 500kg claim before it reaches history at all). A NULL weight_b_kg
  -- (single-bell result) satisfies this CHECK automatically — Postgres
  -- treats a NULL operand as passing a CHECK constraint, not failing it.
  canonical_weight_kg numeric not null check (canonical_weight_kg > 0 and canonical_weight_kg <= 60),
  -- Second bell's real weight, independent from canonical_weight_kg —
  -- same "16kg + 18kg is valid" reasoning as the local
  -- WorkoutResult.weightValueB / the Kettlebell Weight Audit work.
  -- Same 60kg ceiling as canonical_weight_kg; NULL (single-bell) passes.
  weight_b_kg numeric check (weight_b_kg > 0 and weight_b_kg <= 60),
  gear_count smallint not null check (gear_count in (1, 2)),
  elapsed_seconds integer not null check (elapsed_seconds > 0),
  -- Server-computed by the trigger below — never accepted from the client.
  rank text not null,
  is_custom_hunt boolean not null default false,
  app_version text,
  content_version text,
  -- Reserved for Phase 4 (cloud sync): will carry the local
  -- WorkoutResult.id so the sync layer can upsert idempotently instead
  -- of guessing. Unused and unconstrained in Phase 1.
  client_result_id text,
  -- Server-derived — the trigger overwrites whatever the client sends.
  completed_at timestamptz not null default now()
);

comment on table public.workout_results is
  'Cloud leaderboard-eligible history, one row per completed canonical or custom hunt. Immutable after insert. user_id/monster_id/rank/completed_at are server-controlled regardless of client input — see workout_results_before_insert().';

-- Derives monster_id (never trusted from the client) and validates that
-- the submitted workout_id actually matches hunt_id's real workout —
-- closes the "valid hunt_id + valid-but-mismatched workout_id" spoofing
-- gap a plain foreign key alone wouldn't catch. Also computes rank
-- server-side, mirroring src/utils/huntRank.ts's getHuntRank() exactly:
-- S on a personal record OR <=85% of target time, A <=100%, B <=115%,
-- else C. "Personal record" here means strictly faster than this user's
-- prior best for this workout_id — a first-ever attempt is never a PR,
-- matching huntRank.ts's own documented behavior.
--
-- Security audit fix (C1 + part of C2): two more structural-contradiction
-- checks, same "reject outright" treatment as the hunt/workout mismatch
-- above, not a soft leaderboard-eligibility exclusion. Rationale for
-- reject-vs-exclude, same split applied consistently across this
-- function and sync_leaderboard_entry() below:
--   - a STRUCTURAL claim about what was done (which hunt, which
--     workout, how many bells, whether a second bell even applies) that
--     contradicts itself or content is invalid data, not merely
--     suspicious performance — rejected here, at insert.
--   - a PERFORMANCE plausibility question (is this time/weight
--     realistic) stays a soft leaderboard-only exclusion in
--     sync_leaderboard_entry(), because an unusual-but-real performance
--     is still legitimate history even when it shouldn't rank.
-- Audit finding C1: is_custom_hunt=false previously let a client submit
-- any gear_count at all — e.g. claiming a canonical clear with 1 bell on
-- a workout whose canonical gear_count is 2. content_workouts.gear_count
-- already existed and was simply never read. Now enforced: a canonical
-- (non-custom) result must match the workout's own gear_count exactly.
-- Audit finding C2 (structural half): gear_count=1 with a non-null
-- weight_b_kg is self-contradictory (claiming one bell while also
-- reporting a second bell's weight) — rejected here. The NULL-safe
-- range-validation half of C2 (both bells' weights, with gear_count=2
-- requiring a non-null weight_b_kg) lives in sync_leaderboard_entry()
-- below, as a soft exclusion — see that function's own comment for why.
--
-- search_path hardened to '' (was 'public') per the audit: every
-- reference below was already fully schema-qualified (public.*, auth.*),
-- so this was not exploitable as written, but '' makes any future
-- accidental unqualified reference fail loudly instead of silently
-- resolving against whatever search_path would otherwise apply —
-- standard current Postgres/Supabase hardening guidance. Ownership:
-- this function is owned by whichever role applies the migration
-- (the Supabase project's standard migration role) — not explicitly
-- reassigned here, since hardcoding an owner role name is itself fragile
-- across environments; confirm actual ownership once applied to a real
-- project (see supabase/README.md).
create function public.workout_results_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hunt record;
  v_prior_best integer;
  v_is_pr boolean;
begin
  new.user_id := auth.uid();
  new.completed_at := now();

  if new.user_id is null then
    raise exception 'workout_results: no authenticated user';
  end if;

  select h.workout_id, h.monster_id, w.target_time_seconds, w.gear_count
    into v_hunt
    from public.content_hunts h
    join public.content_workouts w on w.workout_id = h.workout_id
    where h.hunt_id = new.hunt_id;

  if v_hunt is null then
    raise exception 'workout_results: unknown hunt_id %', new.hunt_id;
  end if;

  if new.workout_id is distinct from v_hunt.workout_id then
    raise exception 'workout_results: workout_id % does not match hunt_id %', new.workout_id, new.hunt_id;
  end if;

  if not new.is_custom_hunt and new.gear_count is distinct from v_hunt.gear_count then
    raise exception 'workout_results: canonical result for % must use gear_count % (got %)',
      new.workout_id, v_hunt.gear_count, new.gear_count;
  end if;

  if new.gear_count = 1 and new.weight_b_kg is not null then
    raise exception 'workout_results: gear_count=1 cannot carry a weight_b_kg';
  end if;

  -- Found by actually executing this trigger against real Postgres
  -- (PGlite), not by static review: without this check, a perfectly
  -- normal gear_count=2 submission that simply omits weight_b_kg was
  -- being silently excluded from the leaderboard by
  -- sync_leaderboard_entry()'s NULL-safe eligibility check — correctly
  -- failing closed per that function's own design, but with no error
  -- telling anyone why a legitimate-looking result never appeared. The
  -- real local app (workoutSlice.ts) always populates weightValueB when
  -- gearCount===2 (falling back to weightValueA if no distinct second
  -- weight was entered) — a gear_count=2 row with a NULL weight_b_kg
  -- should never come from a correctly-behaving client. Symmetric with
  -- the gear_count=1 check above: this is a structural contradiction
  -- (claiming two bells, reporting one weight), rejected at insert
  -- rather than silently and confusingly excluded later.
  if new.gear_count = 2 and new.weight_b_kg is null then
    raise exception 'workout_results: gear_count=2 requires a weight_b_kg';
  end if;

  new.monster_id := v_hunt.monster_id;

  select min(elapsed_seconds)
    into v_prior_best
    from public.workout_results
    where user_id = new.user_id
      and workout_id = new.workout_id;

  v_is_pr := v_prior_best is not null and new.elapsed_seconds < v_prior_best;

  new.rank := case
    when v_is_pr then 'S'
    when new.elapsed_seconds <= v_hunt.target_time_seconds * 0.85 then 'S'
    when new.elapsed_seconds <= v_hunt.target_time_seconds * 1.00 then 'A'
    when new.elapsed_seconds <= v_hunt.target_time_seconds * 1.15 then 'B'
    else 'C'
  end;

  return new;
end;
$$;

create trigger workout_results_before_insert
  before insert on public.workout_results
  for each row execute function public.workout_results_before_insert();

alter table public.workout_results enable row level security;

create policy "workout_results_insert_own"
  on public.workout_results
  for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "workout_results_select_own"
  on public.workout_results
  for select
  to authenticated
  using (user_id = auth.uid());

-- No update policy, no delete policy — immutable, and a player cannot
-- even delete their own history in Phase 1. (The Phase 0 architecture
-- doc floated player-initiated deletion as a possible later addition;
-- deliberately not included here — revisit explicitly if wanted.)

grant select, insert on public.workout_results to authenticated;

create index workout_results_user_workout_idx
  on public.workout_results (user_id, workout_id, elapsed_seconds);
