import { Exercise, Workout } from '../models';

export interface ExerciseBreakdownEntry {
  name: string;
  /** First-seen displayName for this exercise name, if any content entry set one — display-only, never used for grouping/routing. */
  displayName?: string;
  totalReps: number;
  volumeKg: number;
  /**
   * Total distance for a distance-based exercise (e.g. Front Rack Carry),
   * summed the same way totalReps is (once per section, or × totalRounds
   * for the flat/repeating list) — `undefined` for a normal rep-based
   * exercise, never 0-as-a-stand-in for "not applicable". Same unit
   * `Exercise.targetDistanceFt` already uses everywhere else in the app
   * (MonsterDetailScreen/HuntOverviewScreen/ActiveHuntScreen all display
   * it as "X ft") — kept consistent here rather than inventing a new
   * "steps" unit.
   */
  totalDistanceFt?: number;
  /**
   * The actual weight(s) used for THIS exercise specifically — not
   * necessarily both of the hunt's bells. Resolved via the same
   * `usesGearCount` rule `resolveExerciseWeightKg` already applies, so a
   * single-bell exercise embedded in a gearCount:2 workout correctly
   * shows one weight, not a fabricated pair. `weightBKg` is `null` for a
   * single-bell exercise; feed both into `formatWeightPair` (weight.ts)
   * for display, exactly like the rest of the app already does — never
   * reformat these manually.
   */
  weightAKg: number;
  weightBKg: number | null;
}

/**
 * Kettlebell weight audit: the actual weight-per-rep for ONE specific
 * exercise, not the workout as a whole. A workout's `gearCount` is a
 * per-workout default, not a guarantee every exercise in it uses both
 * bells — some (e.g. Chimera's "Snatch / Thruster", "Alternating Swing")
 * are genuinely single-bell movements embedded in an otherwise
 * `gearCount: 2` workout (see `Exercise.usesGearCount`). `weightBKg` is
 * the SECOND bell's real weight, never assumed equal to `weightAKg` —
 * 16kg + 18kg sums to 34kg, not 32kg. Falls back to `weightAKg` if a
 * double exercise's B weight genuinely isn't known (defensive only; every
 * real caller in this codebase always supplies both once gearCount is 2).
 */
export function resolveExerciseWeightKg(
  exercise: Exercise,
  workoutGearCount: 1 | 2,
  weightAKg: number,
  weightBKg: number | null
): number {
  const effectiveGearCount = exercise.usesGearCount ?? workoutGearCount;
  if (effectiveGearCount === 2) {
    return weightAKg + (weightBKg ?? weightAKg);
  }
  return weightAKg;
}

/**
 * Per-exercise reps/volume actually performed in a completed Hunt,
 * derived entirely from the workout's own content (its exercises, or its
 * per-round sections) plus the weight/gearCount/rounds already recorded
 * in HuntSummary — no new storage, same reps × weight building block the
 * existing total Volume figure already uses. The same exercise name
 * appearing more than once (repeated every round, or appearing several
 * times within one round/section) is summed together under that one
 * name, in first-seen order.
 *
 * Distance/duration-based exercises (no targetReps — e.g. a carry) are
 * now included via `totalDistanceFt` instead of being silently dropped;
 * their `totalReps` stays a genuine 0 (never fabricated), and only an
 * exercise with neither real reps nor real distance is left out.
 *
 * Kettlebell weight audit: `weightAKg`/`weightBKg` are the two bells'
 * REAL, independently-set weights (e.g. 16kg + 18kg) — each exercise's
 * own volume uses `resolveExerciseWeightKg` above rather than blindly
 * multiplying `weightAKg * gearCount`, so a single-bell exercise embedded
 * in a double-bell workout is no longer over-counted, and an
 * intentionally-mismatched pair of bells is never silently averaged into
 * `weightAKg * 2`.
 */
export function getExerciseBreakdown(
  workout: Workout,
  totalRounds: number,
  weightAKg: number,
  gearCount: number,
  weightBKg: number | null = null
): ExerciseBreakdownEntry[] {
  const repsByName = new Map<string, number>();
  const volumeByName = new Map<string, number>();
  const distanceByName = new Map<string, number>();
  const displayNameByName = new Map<string, string | undefined>();
  const weightAByName = new Map<string, number>();
  const weightBByName = new Map<string, number | null>();
  const order: string[] = [];

  function addExercise(exercise: Exercise, repsMultiplier: number) {
    const name = exercise.name;
    if (!repsByName.has(name)) {
      repsByName.set(name, 0);
      volumeByName.set(name, 0);
      distanceByName.set(name, 0);
      displayNameByName.set(name, exercise.displayName);
      order.push(name);

      // Resolved once per exercise NAME (first occurrence) — every
      // occurrence of the same exercise across rounds/sections uses the
      // same weight configuration, so there's nothing to accumulate here,
      // just record it.
      const effectiveGearCount = exercise.usesGearCount ?? (gearCount === 2 ? 2 : 1);
      weightAByName.set(name, weightAKg);
      weightBByName.set(name, effectiveGearCount === 2 ? weightBKg ?? weightAKg : null);
    }
    const reps = (exercise.targetReps ?? 0) * repsMultiplier;
    const distanceFt = (exercise.targetDistanceFt ?? 0) * repsMultiplier;
    const weightPerRepKg = resolveExerciseWeightKg(exercise, gearCount === 2 ? 2 : 1, weightAKg, weightBKg);
    repsByName.set(name, repsByName.get(name)! + reps);
    volumeByName.set(name, volumeByName.get(name)! + reps * weightPerRepKg);
    distanceByName.set(name, distanceByName.get(name)! + distanceFt);
  }

  if (workout.sections) {
    // Each section is one round's worth of exercises, already distinct
    // per round — no rounds multiplier, every section is one pass.
    workout.sections.forEach((section) => {
      section.exercises.forEach((exercise) => addExercise(exercise, 1));
    });
  } else {
    // The same exercise list repeats every round.
    workout.exercises.forEach((exercise) => addExercise(exercise, totalRounds));
  }

  return order
    .map((name) => {
      const totalDistanceFt = distanceByName.get(name)!;
      return {
        name,
        displayName: displayNameByName.get(name),
        totalReps: repsByName.get(name)!,
        volumeKg: volumeByName.get(name)!,
        // A rep-based exercise gets no distance field at all (undefined,
        // not 0) so callers can tell "not distance-based" apart from
        // "distance-based but somehow zero".
        totalDistanceFt: totalDistanceFt > 0 ? totalDistanceFt : undefined,
        weightAKg: weightAByName.get(name)!,
        weightBKg: weightBByName.get(name)!,
      };
    })
    // Previously filtered out any distance-only exercise (e.g. Front Rack
    // Carry has no targetReps) entirely, rather than show a fabricated
    // "0 reps" line — that hid it completely instead. Now kept whenever
    // it has real reps OR real distance; only a genuinely empty entry
    // (neither) is dropped.
    .filter((entry) => entry.totalReps > 0 || (entry.totalDistanceFt ?? 0) > 0);
}
