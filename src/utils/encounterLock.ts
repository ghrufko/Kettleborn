import { Hunt, Workout, WorkoutResult } from '../models';

/**
 * ENCOUNTER LOCK (merged with Custom Hunt) — see PROJECT_CONTEXT.md §16/§17.
 *
 * A monster's first three Hunts ("Encounter 1/2/3" — same `Hunt.order`
 * concept as "Level 1/2/3" elsewhere in this codebase) form a locked
 * progression chain:
 *
 *  - Encounter 1 offers a real choice: Canonical Hunt (content exactly
 *    as authored) OR Custom Hunt (the existing weight/gearCount/rest/
 *    structural-value/reps-overrides system, fully available — see
 *    src/models/CustomHuntPreset.ts + customWorkoutStructure.ts). The
 *    first-ever successful result — whichever mode — becomes the
 *    player's baseline for this monster, and the EXACT configuration
 *    used (not just the time) is what matters going forward.
 *  - Encounter 2/3 are not a choice at all: every parameter is locked to
 *    the exact configuration of the encounter immediately before them,
 *    reconstructed from that encounter's own saved WorkoutResult — never
 *    from the player's CURRENT CustomHuntPreset, which can change later
 *    (see reconstructEncounterConfig below). They only "count" if the
 *    attempt is faster than the target.
 *
 * Everything here is re-derived from `Hunt` content + `WorkoutResult`
 * history at read time — no separate "current encounter state" is
 * persisted. The one piece of real, new persistence this needed is the
 * three snapshot columns on `WorkoutResult` (migration11) that let a
 * Custom Hunt result's exact rest/structural-value/reps-overrides be
 * reconstructed later; see `isExact` throughout this file for how
 * pre-migration ("legacy") data is handled instead of silently
 * mis-trusted.
 */

export interface EncounterConfig {
  weightKg: number;
  /**
   * Kettlebell weight audit: the second bell's weight when `gearCount`
   * is 2 — genuinely independent from `weightKg` (16kg + 18kg is valid),
   * never assumed equal to it. `null` whenever `gearCount` is 1.
   */
  weightBKg: number | null;
  gearCount: 1 | 2;
  restSeconds: number;
  /** Task 2's structural control value (rounds/max rung/cycles), or null for canonical structure. */
  structuralValue: number | null;
  /** Per-exercise rep overrides, or null for canonical reps. */
  repsOverrides: Record<string, number> | null;
  isCustomHunt: boolean;
}

/** hunt.order this rule governs — a range, not "every Hunt", so a future order-4+ Hunt isn't silently swept in; the brief only ever defines Encounter 1/2/3. */
const LOCKED_ENCOUNTER_ORDERS = [1, 2, 3];

export function isEncounterLocked(hunt: Hunt): boolean {
  return LOCKED_ENCOUNTER_ORDERS.includes(hunt.order);
}

/** The canonical, content-defined configuration for `hunt` — what Encounter 1's "Canonical Hunt" option uses, and the fallback for anything a legacy row can't reconstruct. Canonical always starts both bells at the same recommended weight — the player can still dial in two different real weights before ever completing it, same as Custom Hunt. */
export function getCanonicalEncounterConfig(hunt: Hunt, workout: Workout): EncounterConfig {
  return {
    weightKg: workout.gearWeightKg,
    weightBKg: workout.gearCount === 2 ? workout.gearWeightKg : null,
    gearCount: workout.gearCount,
    restSeconds: hunt.restSecondsOverride ?? workout.restSeconds,
    structuralValue: null,
    repsOverrides: null,
    isCustomHunt: false,
  };
}

export interface ReconstructedConfig {
  config: EncounterConfig;
  /**
   * true = every field is trustworthy, reconstructed from data that was
   * actually recorded for this specific result. false = LEGACY: `result`
   * is a Custom Hunt row saved before migration11 (or missing the rest
   * snapshot for any other reason) — weight/gearCount are still exact
   * (always stored), but rest/structuralValue/repsOverrides could not be
   * recovered and were defaulted to canonical as a best-effort fallback.
   * Never silently treated as exact — every caller that locks a later
   * encounter to this config, or displays it, is expected to surface
   * `isExact === false` rather than hide it (see HuntOverviewScreen).
   */
  isExact: boolean;
}

/**
 * What configuration a specific past `result` actually used — the thing
 * a later locked encounter has to reproduce. Deliberately reads only
 * `result` (+ static Hunt/Workout content), never CustomHuntPreset — the
 * player's current preset is a live, editable preference, not history
 * (see PROJECT_CONTEXT.md §17's "do not depend on the current preset"
 * decision).
 */
export function reconstructEncounterConfig(
  hunt: Hunt,
  workout: Workout,
  result: WorkoutResult
): ReconstructedConfig {
  const gearCount: 1 | 2 = result.weightValueB !== null ? 2 : 1;
  // Kettlebell weight audit: weightValueB is now the actually-used second
  // bell's weight (may differ from weightValueA — see completeHunt), not
  // a mirror of weightValueA — reconstruction just reads it straight.

  if (!result.isCustomHunt) {
    // Canonical is always fully deterministic from content alone —
    // there is nothing to reconstruct and nothing that can be "legacy."
    return {
      config: {
        weightKg: result.weightValueA,
        weightBKg: result.weightValueB,
        gearCount,
        restSeconds: hunt.restSecondsOverride ?? workout.restSeconds,
        structuralValue: null,
        repsOverrides: null,
        isCustomHunt: false,
      },
      isExact: true,
    };
  }

  // Custom Hunt: restSecondsUsed is the migration11 marker — null means
  // this row predates it, so rest/structuralValue/repsOverrides are
  // unknown, not "canonical" (a real assumption, not a fact). weight and
  // gearCount are unaffected — those were always stored, migration11 or not.
  const isExact = result.restSecondsUsed !== null;
  return {
    config: {
      weightKg: result.weightValueA,
      weightBKg: result.weightValueB,
      gearCount,
      restSeconds: result.restSecondsUsed ?? (hunt.restSecondsOverride ?? workout.restSeconds),
      structuralValue: isExact ? result.structuralValueUsed : null,
      repsOverrides: isExact ? result.repsOverridesUsed : null,
      isCustomHunt: true,
    },
    isExact,
  };
}

export interface EncounterLockState {
  /** The time (seconds) this encounter's attempt must beat. null for Encounter 1, or before the previous encounter has any result. */
  targetSeconds: number | null;
  /**
   * The completed-round count this encounter's attempt must beat, for an
   * EMOM-style workout (workout.emomSeconds set) only — null for every
   * other workout, where `targetSeconds` (time) is the real metric. Read
   * from the previous encounter's own `rungLaps.length`, the same
   * per-round history array ladder workouts already use — nothing new
   * stored.
   */
  targetRounds: number | null;
  /** The configuration this encounter is locked to. null exactly when targetSeconds is null. */
  lockedConfig: EncounterConfig | null;
  /** false when lockedConfig is a best-effort fallback from legacy data (see ReconstructedConfig.isExact) — always true when lockedConfig is null. */
  isExact: boolean;
}

/**
 * The full lock state for `hunt` (order >= 2), derived from the PREVIOUS
 * encounter's (`hunt.order - 1`) own result history — never stored.
 *
 * - Encounter 2's lock is Encounter 1's BASELINE — the first-ever
 *   (chronologically earliest) result for Encounter 1, and ITS exact
 *   configuration. Fixed forever: a later, faster Encounter 1 replay
 *   never moves the baseline (matches the brief's literal "the first
 *   successful result becomes the baseline", not "the best").
 * - Encounter 3's lock is the LATEST successful result of Encounter 2 —
 *   and any later replay of an already-passed Encounter 2/3 locks to the
 *   latest successful result of the encounter before it too. Because an
 *   unsuccessful attempt is never saved (see isEncounterAttemptSuccessful
 *   + the pre-completeHunt gate in ActiveHuntScreen), every saved result
 *   for order >= 2 already beat its own target when recorded, so results
 *   only ever get faster over time — "latest" and "best" coincide going
 *   forward. (Pre-existing rows aren't guaranteed monotonic — see the
 *   completion report's noted limitation.)
 */
export function getEncounterLockState(
  previousHunt: Hunt | undefined,
  previousWorkout: Workout | undefined,
  previousHuntResults: WorkoutResult[]
): EncounterLockState {
  if (!previousHunt || !previousWorkout || previousHuntResults.length === 0) {
    return { targetSeconds: null, targetRounds: null, lockedConfig: null, isExact: true };
  }
  const sorted = [...previousHuntResults].sort(
    (a, b) => new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime()
  );
  const chosen = previousHunt.order === 1 ? sorted[0] : sorted[sorted.length - 1];
  const { config, isExact } = reconstructEncounterConfig(previousHunt, previousWorkout, chosen);
  return {
    targetSeconds: chosen.timeMinutes * 60 + chosen.timeSeconds,
    targetRounds: chosen.rungLaps?.length ?? null,
    lockedConfig: config,
    isExact,
  };
}

/**
 * Whether a just-finished attempt at `hunt` counts as a success. Encounter
 * 1 always succeeds (no time requirement — its role is just to establish
 * the baseline on first completion, in whichever mode was chosen).
 * Encounter 2/3 succeed only by beating `targetSeconds` strictly — the
 * configuration itself is never compared here because it's not a choice
 * for order >= 2 to begin with (the UI/session never offers anything but
 * the locked config — see ActiveHuntScreen), so a different configuration
 * physically cannot produce a "faster result" under this rule.
 */
export function isEncounterAttemptSuccessful(
  hunt: Hunt,
  elapsedSeconds: number,
  targetSeconds: number | null
): boolean {
  if (hunt.order === 1) {
    return true;
  }
  if (targetSeconds === null) {
    // Shouldn't happen in practice — reaching a locked order>=2 encounter
    // already requires the previous one completed — but fail safe rather
    // than silently award a pass with nothing to beat.
    return false;
  }
  return elapsedSeconds < targetSeconds;
}

/**
 * The EMOM equivalent of isEncounterAttemptSuccessful, for a workout
 * where the performance metric is completed rounds, not time (e.g. The
 * Breaking: "Encounter 2 = 14 rounds beats Encounter 1 = 13 rounds").
 * Deliberately a separate function — never touches the time-based one
 * above, so no other monster's progression can be affected by this.
 * Only ever called by the caller when `workout.emomSeconds` is set.
 */
export function isEmomEncounterAttemptSuccessful(
  hunt: Hunt,
  roundsCompleted: number,
  targetRounds: number | null
): boolean {
  if (hunt.order === 1) {
    return true;
  }
  if (targetRounds === null) {
    return false;
  }
  return roundsCompleted > targetRounds;
}

export type EncounterOutcome = 'baseline-established' | 'target-beaten' | null;

/**
 * Purely for HuntSummary/Victory display — never affects success/save
 * logic above, and only ever called for a completion that already
 * happened (i.e. after isEncounterAttemptSuccessful already gated it).
 * `isFirstResultForThisHunt` distinguishes Encounter 1's true first-ever
 * clear (worth the "Baseline Established" badge) from a later replay of
 * an already-baselined Encounter 1 (just a normal completion, no badge —
 * replaying Encounter 1 never changes the stored baseline).
 */
export function getEncounterOutcome(
  hunt: Hunt,
  targetSeconds: number | null,
  isFirstResultForThisHunt: boolean
): EncounterOutcome {
  if (!isEncounterLocked(hunt)) {
    return null;
  }
  if (hunt.order === 1) {
    return isFirstResultForThisHunt ? 'baseline-established' : null;
  }
  return targetSeconds !== null ? 'target-beaten' : null;
}

function repsOverridesEqual(
  a: Record<string, number> | null,
  b: Record<string, number> | null
): boolean {
  const an = a ?? {};
  const bn = b ?? {};
  const keys = new Set([...Object.keys(an), ...Object.keys(bn)]);
  for (const key of keys) {
    if ((an[key] ?? null) !== (bn[key] ?? null)) {
      return false;
    }
  }
  return true;
}

/**
 * Exact-configuration equality — used by the Victory-screen "Better/
 * Slower Than Last Time" comparison (Task 7) so that, per this feature's
 * own brief, "a result with different weight/rest/reps/rounds/etc. must
 * never be treated as the same configuration." Every field matters,
 * including isCustomHunt itself (a canonical and a custom result can
 * coincidentally share weight/gear/rest and still not be "the same
 * configuration" — one is content-authored, the other player-chosen).
 */
export function encounterConfigsMatch(a: EncounterConfig, b: EncounterConfig): boolean {
  return (
    a.isCustomHunt === b.isCustomHunt &&
    a.weightKg === b.weightKg &&
    a.weightBKg === b.weightBKg &&
    a.gearCount === b.gearCount &&
    a.restSeconds === b.restSeconds &&
    (a.structuralValue ?? null) === (b.structuralValue ?? null) &&
    repsOverridesEqual(a.repsOverrides, b.repsOverrides)
  );
}
