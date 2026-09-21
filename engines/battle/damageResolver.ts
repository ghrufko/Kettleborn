import { Exercise } from '../../src/models';

/**
 * Resolves the damage a single exercise completion deals, using only the
 * exercise's content-authored damage fields. This function — not the
 * Battle Engine reducer — is the one place that reads damageCoefficient/
 * damageType, keeping the reducer itself free of per-exercise math.
 */
export function resolveExerciseDamage(exercise: Exercise, repsCompleted: number): number {
  switch (exercise.damageType) {
    case 'flat':
      return exercise.damageCoefficient;
    case 'per_rep':
      return exercise.damageCoefficient * repsCompleted;
    case 'per_second':
    case 'over_time':
      return exercise.damageCoefficient * (exercise.durationSeconds ?? 0);
    default:
      return exercise.damageCoefficient;
  }
}
