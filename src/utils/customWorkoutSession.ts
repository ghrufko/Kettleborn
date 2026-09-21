import { CustomWorkout, Exercise, Workout } from '../models';
import { contentEngine } from '../../engines/content';

/**
 * Converts a CustomWorkout into the existing `Workout` domain shape at
 * session-start time only — never persisted, never registered with
 * ContentEngine, never treated as content. useWorkoutSession reads
 * exercise.name/targetReps and workout.rounds/exercises/restSeconds for
 * its round/rest flow; it never reads damage fields, so those are inert
 * placeholders here (damageType 'flat', damageCoefficient 0) rather than
 * anything meaningful — there is no Battle Engine call anywhere in the
 * Custom Workout session flow for them to feed into. Exercise `name`
 * comes from the real Exercise Library entry (never duplicated/invented)
 * so Journal lifetime-stat aggregation, which keys off `name`, still
 * routes correctly if this workout's completions are ever surfaced
 * there.
 */
export function customWorkoutToWorkout(customWorkout: CustomWorkout): Workout {
  const exercises: Exercise[] = customWorkout.exercises
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((e, index) => {
      const entry = contentEngine.getExerciseLibraryEntry(e.exerciseId);
      return {
        id: `${customWorkout.id}-ex-${index}`,
        name: entry?.name ?? e.exerciseId,
        targetReps: e.reps,
        damageCoefficient: 0,
        damageType: 'flat',
      };
    });

  return {
    id: customWorkout.id,
    name: customWorkout.name,
    difficulty: 1,
    estimatedMinutesRange: [1, 60],
    gearWeightKg: customWorkout.weightKg,
    gearCount: customWorkout.gearCount,
    rounds: customWorkout.rounds,
    restSeconds: customWorkout.restSeconds,
    roundBonusDamage: 0,
    targetTimeSeconds: 0,
    focus: [],
    exercises,
    finisher: { name: customWorkout.name, scheme: `${customWorkout.rounds} Rounds` },
  };
}
