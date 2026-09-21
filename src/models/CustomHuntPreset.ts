/**
 * "Custom Hunt" — a player-owned equipment override for a specific
 * workout, so a player without the exact canonical kettlebell(s) can
 * still run the Monster with their own weight/gear count/rest.
 *
 * Deliberately keyed by workoutId, NOT huntId. A monster's Levels 1/2/3
 * normally share one workoutId (verified in content, see
 * PROJECT_CONTEXT.md §1/§9) — keying here means one saved preset is
 * automatically read by every Level of that monster with zero explicit
 * propagation code. Weaver (single Hunt, no Levels) just gets a normal
 * one-off preset for its one workoutId.
 *
 * V1 scope: weight, gear count, rest — these never touch damage/HP
 * calibration (see damageResolver.ts + Monster.battle.hp).
 *
 * Task 2 extends this with one further, optional field:
 * customStructureValue. Unlike weight/gear/rest, a structural change
 * (round count, ladder depth, cycle count) DOES change achievable
 * damage/duration, so it's handled differently downstream — see
 * src/utils/customWorkoutStructure.ts for how a canonical Workout +
 * BattleConfig get proportionally rebuilt from this single number, and
 * workoutSlice.completeHunt for why a structurally-customized clear is
 * deliberately never PR/first-clear eligible (protects the canonical
 * workoutId's PR pool from being compared against a different amount of
 * work). Canonical Hunts never read this field at all.
 */
export interface CustomHuntPreset {
  userId: string;
  workoutId: string;
  /** Always stored in kg — same convention as WorkoutResult.weightValueA and Workout.gearWeightKg. */
  weightKg: number;
  /** Kettlebell weight audit: the second bell's weight when gearCount is 2 — independent from weightKg (16kg + 18kg is valid), never assumed equal. null when gearCount is 1, or for a preset saved before this field existed (falls back to mirroring weightKg). */
  weightBKg?: number | null;
  gearCount: 1 | 2;
  restSeconds: number;
  /**
   * Meaning depends on this workoutId's own structure (re-derived via
   * classifyWorkoutStructure, never stored redundantly):
   *  - flat round-based workout  -> custom round count
   *  - ladder workout (stepLabel 'Rung') -> custom max rung
   *  - cyclical-sectioned workout -> custom cycle count
   *  - fixed-sectioned workout (no safe structural parameter) -> never set
   * null/undefined = no structural customization saved; canonical
   * structure. Every preset saved before this field existed reads back
   * as null automatically (additive migration, no backfill needed).
   */
  customStructureValue?: number | null;
  /**
   * Per-exercise rep overrides for a FLAT workout only (see
   * getRepsCustomizableTemplate in customWorkoutStructure.ts) — keyed by
   * the template exercise's own stable id. null/undefined/missing key =
   * that exercise uses its canonical reps. Never applies to ladder/
   * sectioned workouts; canonical Hunts never read this field at all.
   */
  repsOverrides?: Record<string, number> | null;
  updatedAt: string;
}
