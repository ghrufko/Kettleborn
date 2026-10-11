import type { WorkoutResult, Workout } from '../models';

export interface DurationTrendPoint {
  resultId: string;
  completedAt: string;
  seconds: number;
  /** Was this the fastest clear seen SO FAR in chronological order, not the all-time fastest among points shown later in the series. */
  isPersonalBestAtTime: boolean;
}

/**
 * Phase 2.9: a chronological (oldest -> newest) completion-time series for
 * one workout, built entirely from already-persisted WorkoutResult rows —
 * no new storage, no recomputation of volume/XP/damage. Deliberately
 * excludes two categories of result that would make "elapsed seconds"
 * meaningless or incomparable to the rest of the series, rather than
 * silently plotting a misleading trend:
 *
 *  - EMOM/open-ended workouts (`workout.emomSeconds` set) — elapsed time
 *    there is a fixed window by design (the player stops at the buzzer,
 *    not at a finish line), not a performance signal. Rounds completed
 *    IS the real performance metric for those — see
 *    `getRoundsTrendSeries` below (Phase 2.10), the dedicated series for
 *    exactly this case.
 *  - Structurally-customized Custom Hunt results (`structuralValueUsed`
 *    set, or `repsOverridesUsed` non-empty) — a different round/rep
 *    count did genuinely different work, so comparing its elapsed time
 *    against the rest of the series would compare apples to oranges. A
 *    weight/rest/gear-count-only Custom Hunt (same work, different
 *    equipment) is still included — fully comparable.
 */
export function getDurationTrendSeries(
  results: WorkoutResult[],
  workout: Workout | undefined
): DurationTrendPoint[] {
  if (!workout || workout.emomSeconds) {
    return [];
  }
  const comparable = results.filter(
    (result) =>
      result.workoutId === workout.id &&
      result.structuralValueUsed === null &&
      (result.repsOverridesUsed === null || Object.keys(result.repsOverridesUsed).length === 0)
  );
  const chronological = [...comparable].sort(
    (a, b) => new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime()
  );
  let bestSoFar: number | null = null;
  return chronological.map((result) => {
    const seconds = result.timeMinutes * 60 + result.timeSeconds;
    const isPersonalBestAtTime = bestSoFar === null || seconds < bestSoFar;
    if (bestSoFar === null || seconds < bestSoFar) {
      bestSoFar = seconds;
    }
    return { resultId: result.id, completedAt: result.completedAt, seconds, isPersonalBestAtTime };
  });
}

export interface RoundsTrendPoint {
  resultId: string;
  completedAt: string;
  rounds: number;
  /** Was this the MOST rounds completed so far, chronologically — the opposite direction from DurationTrendPoint's "fastest," since more rounds is the better outcome here. */
  isPersonalBestAtTime: boolean;
}

/**
 * Phase 2.10: a chronological (oldest -> newest) rounds-completed series
 * for one EMOM/open-ended workout — the companion to
 * `getDurationTrendSeries` above for the exact case that function
 * excludes. Verified against the actual session/completion code before
 * writing this, not assumed:
 *
 *  - `ActiveHuntScreen`'s `capturesRoundLaps = isRungWorkout ||
 *    !!workout.emomSeconds` confirms `rungLaps` is genuinely populated
 *    for an EMOM workout (it's a dual-purpose field — also used by the
 *    unrelated Minotaur-style fixed-round ladder — so this function
 *    gates on `workout.emomSeconds`, never on "rungLaps happens to be
 *    present," to never mix the two).
 *  - `useWorkoutSession`'s `completeRound` only ever pushes a lap AFTER
 *    a round is genuinely completed (an in-progress round is never
 *    recorded), and `encounterLock.ts` already relies on
 *    `rungLaps.length` as "rounds completed" for its own EMOM
 *    target-beating logic — so this reuses an already-established
 *    semantic, not a new assumption.
 *
 * A result with `rungLaps` missing, empty, or otherwise not a usable
 * array is skipped entirely — never counted as 0 rounds, which would be
 * a fabricated data point indistinguishable from a real 0-round attempt.
 */
export function getRoundsTrendSeries(
  results: WorkoutResult[],
  workout: Workout | undefined
): RoundsTrendPoint[] {
  if (!workout || !workout.emomSeconds) {
    return [];
  }
  const comparable = results.filter(
    (result) =>
      result.workoutId === workout.id &&
      result.structuralValueUsed === null &&
      (result.repsOverridesUsed === null || Object.keys(result.repsOverridesUsed).length === 0) &&
      Array.isArray(result.rungLaps) &&
      result.rungLaps.length > 0
  );
  const chronological = [...comparable].sort(
    (a, b) => new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime()
  );
  let bestSoFar: number | null = null;
  return chronological.map((result) => {
    const rounds = result.rungLaps!.length;
    const isPersonalBestAtTime = bestSoFar === null || rounds > bestSoFar;
    if (bestSoFar === null || rounds > bestSoFar) {
      bestSoFar = rounds;
    }
    return { resultId: result.id, completedAt: result.completedAt, rounds, isPersonalBestAtTime };
  });
}

/**
 * Newest-first ordering for a plain history list — every completed result
 * kept (a monster can be replayed, and repeated same-day attempts are
 * each a meaningful record, never deduplicated or dropped).
 */
export function getMonsterHistoryEntries(results: WorkoutResult[]): WorkoutResult[] {
  return [...results].sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime());
}
