-- Phase 1: Accounts + Cloud Sync + Leaderboards — leaderboard_entries
--
-- The ONLY path into this table is the trigger below, running as
-- SECURITY DEFINER after a workout_results insert. No policy grants
-- INSERT/UPDATE/DELETE to `authenticated` at all — not "restricted",
-- genuinely absent, so the only way to get a row into this table is
-- through public.sync_leaderboard_entry() reacting to a validated
-- workout_results row. A client cannot place itself on the leaderboard
-- by inserting here directly, cannot edit an existing entry, and cannot
-- remove a competitor's entry.
--
-- One row per (user_id, workout_id): the player's personal best for that
-- canonical workout. This is the "Monster leaderboard" from the Phase 0
-- architecture doc — monster_id is carried alongside workout_id purely
-- so the leaderboard UI (a later phase) can query by monster without a
-- join back to content_hunts every time.

create table public.leaderboard_entries (
  user_id uuid not null references auth.users (id) on delete cascade,
  workout_id text not null references public.content_workouts (workout_id),
  monster_id text not null,
  best_result_id uuid not null references public.workout_results (id) on delete cascade,
  elapsed_seconds integer not null,
  rank text not null,
  achieved_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, workout_id)
);

comment on table public.leaderboard_entries is
  'Server-derived best canonical time per (user, workout) — see sync_leaderboard_entry(). Never directly writable by clients; read-only to all authenticated users.';

alter table public.leaderboard_entries enable row level security;

create policy "leaderboard_entries_select_all"
  on public.leaderboard_entries
  for select
  to authenticated
  using (true);

-- No insert/update/delete policy for `authenticated` at all.

grant select on public.leaderboard_entries to authenticated;

-- Eligibility + derivation. Fires after every workout_results insert
-- (which is itself already validated/normalized by
-- workout_results_before_insert in the previous migration — this
-- function trusts NEW's monster_id/rank/completed_at because that
-- trigger already forced them, not because it re-trusts the client).
--
-- Design choice carried over from the Phase 0 architecture doc: an
-- ineligible result (custom hunt, implausible time, out-of-range weight)
-- is still saved to workout_results (it's the player's own real
-- history), it just never gets promoted to the leaderboard. Nothing is
-- rejected at this stage — rejection for genuinely invalid
-- workout/hunt/user data (including the structural gear_count/weight_b_kg
-- contradictions) already happened one trigger earlier, in
-- workout_results_before_insert — see that function's comment for the
-- reject-vs-exclude rationale.
--
-- Audit finding C2 (plausibility half): canonical_weight_kg was the only
-- weight checked; a 2-bell result's weight_b_kg was never validated at
-- all. Now both bells are range-checked when gear_count=2.
--
-- Audit finding (three-valued logic): the original v_eligible computation
-- was a plain boolean AND-chain. If any sub-expression evaluated to NULL
-- (e.g. a NULL weight_b_kg compared with >=), the whole chain could
-- collapse to NULL instead of false — and `if not v_eligible` on a NULL
-- is itself NULL, which plpgsql treats as "condition not true" and so
-- does NOT take the `return new` early-exit, falling through to INSERT
-- as if eligible. Fixed by wrapping the entire computation in
-- coalesce(..., false): any NULL anywhere in the expression now
-- fails closed (excluded from the leaderboard) instead of silently
-- passing through.
--
-- Phase 1.3 correction, found by actually running this trigger against
-- real Postgres (PGlite), not by static review: workout_results_before_insert
-- now rejects a gear_count=2 row with a NULL weight_b_kg outright (a
-- structural contradiction, not a plausibility question — see that
-- function's own comment), so weight_b_kg is guaranteed non-null here
-- whenever gear_count=2. The `weight_b_kg is not null` check below is
-- kept anyway as defense-in-depth against that invariant ever being
-- weakened by a future edit — if it is, this still fails closed
-- (excluded) rather than silently admitting a NULL.
--
-- search_path hardened to '' — same rationale as
-- workout_results_before_insert; every reference below is already
-- schema-qualified. Ownership: same note as that function — confirm
-- against the actual migration-applying role once a project exists.
create function public.sync_leaderboard_entry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workout record;
  v_eligible boolean;
begin
  if new.is_custom_hunt then
    return new;
  end if;

  select min_elapsed_seconds, min_weight_kg, max_weight_kg
    into v_workout
    from public.content_workouts
    where workout_id = new.workout_id;

  if v_workout is null then
    -- Defensive only — the FK on workout_results.workout_id already
    -- makes this unreachable in practice.
    return new;
  end if;

  v_eligible := coalesce(
    new.elapsed_seconds >= v_workout.min_elapsed_seconds
    and new.canonical_weight_kg >= v_workout.min_weight_kg
    and new.canonical_weight_kg <= v_workout.max_weight_kg
    and (
      new.gear_count = 1
      or (
        new.weight_b_kg is not null
        and new.weight_b_kg >= v_workout.min_weight_kg
        and new.weight_b_kg <= v_workout.max_weight_kg
      )
    ),
    false
  );

  if not v_eligible then
    return new;
  end if;

  insert into public.leaderboard_entries
    (user_id, workout_id, monster_id, best_result_id, elapsed_seconds, rank, achieved_at)
  values
    (new.user_id, new.workout_id, new.monster_id, new.id, new.elapsed_seconds, new.rank, new.completed_at)
  on conflict (user_id, workout_id) do update set
    best_result_id = excluded.best_result_id,
    elapsed_seconds = excluded.elapsed_seconds,
    rank = excluded.rank,
    achieved_at = excluded.achieved_at,
    updated_at = now()
  where excluded.elapsed_seconds < public.leaderboard_entries.elapsed_seconds;

  return new;
end;
$$;

create trigger workout_results_sync_leaderboard
  after insert on public.workout_results
  for each row execute function public.sync_leaderboard_entry();

-- Read-side convenience indexes for the two query shapes the Phase 0
-- doc's leaderboard types need: "fastest time for monster X" and
-- "all of this user's best times."
create index leaderboard_entries_monster_rank_idx
  on public.leaderboard_entries (monster_id, elapsed_seconds);

create index leaderboard_entries_user_idx
  on public.leaderboard_entries (user_id);
