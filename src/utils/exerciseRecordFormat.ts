import type { ExerciseStats } from './exerciseStats';

/**
 * One Exercise Records entry, split for display: the amount performed
 * (reps, or a carry's distance/steps) and the accumulated external load.
 *
 * The load is the exercise's training volume — reps × the load actually
 * lifted for each rep, both bells for a double-kettlebell movement (see
 * resolveExerciseWeightKg) — never the weight of one bell. It is null
 * when there is no real external load: a bodyweight movement (burpees,
 * push-ups, pull-ups) lifts none under the app's volume convention, and a
 * carry is measured in steps/distance; neither gets a fabricated "0 kg".
 */
export interface ExerciseRecordParts {
  amount: number;
  amountUnit: 'reps' | 'ft' | 'steps';
  /** Accumulated load in the display unit, or null when none is calculated. */
  load: number | null;
  /** True for a rep-based movement that lifts no external load. */
  isBodyweight: boolean;
}

export function getExerciseRecordParts(
  stat: Pick<ExerciseStats, 'totalReps' | 'totalVolumeKg' | 'totalDistanceFt' | 'totalSteps'>,
  toDisplayWeight: (kg: number) => number
): ExerciseRecordParts {
  const amount =
    stat.totalReps > 0
      ? { amount: stat.totalReps, amountUnit: 'reps' as const }
      : stat.totalDistanceFt > 0
        ? { amount: stat.totalDistanceFt, amountUnit: 'ft' as const }
        : { amount: stat.totalSteps, amountUnit: 'steps' as const };
  const load = toDisplayWeight(stat.totalVolumeKg);
  return {
    ...amount,
    load: load > 0 ? load : null,
    isBodyweight: amount.amountUnit === 'reps' && !(load > 0),
  };
}

/** Plain-text form, e.g. "100 reps · 2,400 kg" (reps only when there is no external load). */
export function formatExerciseRecord(
  stat: Pick<ExerciseStats, 'totalReps' | 'totalVolumeKg' | 'totalDistanceFt' | 'totalSteps'>,
  toDisplayWeight: (kg: number) => number,
  unit: string
): string {
  const parts = getExerciseRecordParts(stat, toDisplayWeight);
  const amount = `${parts.amount.toLocaleString()} ${parts.amountUnit}`;
  return parts.load !== null ? `${amount} · ${parts.load.toLocaleString()} ${unit}` : amount;
}
