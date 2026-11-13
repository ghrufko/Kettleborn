import type { Exercise, Monster, Workout } from '../models';

/**
 * The one place that decides how many kettlebells a workout uses.
 *
 * - Fixed: the workout is authored for exactly `workout.gearCount` bells
 *   (The Fallen, The Unbroken, The Risen, The Crooked, The Wraith: one;
 *   Minotaur, Leviathan, Hydra, Mammoth, Arachne, Basilisk, The Sovereign,
 *   The Judge, The Colossus, The Two-Faced, The Rite, The Breaking, The
 *   Descent, The Ravager: two). Custom Hunt can't change it.
 * - Flexible (`workout.flexibleGearCount`): Behemoth and The Duelist can be
 *   done with one or two bells. Their double-bell steps name a one-bell
 *   variant (Exercise.singleBellVariant), so picking one bell changes the
 *   movements, not just a label.
 *
 * Read by Custom Hunt (Hunt Overview), the hunt itself (Active Hunt),
 * completion (completeHunt), statistics (resultWorkout) and the Hunts
 * screen's equipment icon — never re-derived per screen.
 */
export type EquipmentRule =
  | { kind: 'fixed'; gearCount: 1 | 2 }
  | { kind: 'flexible'; defaultGearCount: 1 | 2 };

export function getEquipmentRule(workout: Pick<Workout, 'gearCount' | 'flexibleGearCount'>): EquipmentRule {
  return workout.flexibleGearCount
    ? { kind: 'flexible', defaultGearCount: workout.gearCount }
    : { kind: 'fixed', gearCount: workout.gearCount };
}

/** The bell count a hunt actually uses: the fixed count, or the player's choice for a flexible workout. */
export function resolveGearCount(
  workout: Pick<Workout, 'gearCount' | 'flexibleGearCount'>,
  requested: 1 | 2 | null | undefined
): 1 | 2 {
  const rule = getEquipmentRule(workout);
  if (rule.kind === 'fixed') return rule.gearCount;
  return requested === 1 || requested === 2 ? requested : rule.defaultGearCount;
}

function toSingleBell(exercise: Exercise, asOf: string | null): Exercise {
  const variant = exercise.singleBellVariant;
  if (!variant || (asOf !== null && asOf < variant.since)) return exercise;
  return {
    ...exercise,
    name: variant.name,
    libraryExerciseId: variant.libraryExerciseId,
    displayName: variant.displayName ?? variant.name,
    usesGearCount: 1,
    singleBellVariant: undefined,
    previousVersion: undefined,
  };
}

/**
 * The workout as performed with `gearCount` bells: for a flexible workout
 * done with one bell, every double-bell step becomes its one-bell variant.
 * Unchanged otherwise. `asOf` (a result's completedAt) keeps results
 * recorded before a variant existed exactly as they were read before.
 */
export function applyGearVariants(workout: Workout, gearCount: 1 | 2, asOf: string | null = null): Workout {
  if (!workout.flexibleGearCount || gearCount !== 1) return workout;
  const swap = (exercises: Exercise[]) => exercises.map((exercise) => toSingleBell(exercise, asOf));
  return {
    ...workout,
    exercises: swap(workout.exercises),
    sections: workout.sections?.map((section) => {
      const exercises = swap(section.exercises);
      const changed = exercises.some((exercise, i) => exercise !== section.exercises[i]);
      // The section's own label names its equipment ("Two Kettlebells"), so
      // it switches with the movements — never left contradicting them.
      return {
        ...section,
        label: changed && section.singleBellLabel ? section.singleBellLabel : section.label,
        exercises,
      };
    }),
  };
}

/** A monster's equipment rule — every Encounter of a monster shares one workout. */
export function getMonsterEquipmentRule(
  monster: Pick<Monster, 'hunts'>,
  getWorkout: (workoutId: string) => Workout | undefined
): EquipmentRule | null {
  const workoutId = monster.hunts.find((hunt) => hunt.workoutId)?.workoutId;
  const workout = workoutId ? getWorkout(workoutId) : undefined;
  return workout ? getEquipmentRule(workout) : null;
}
