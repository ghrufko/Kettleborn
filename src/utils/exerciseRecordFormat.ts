import type { ExerciseStats } from './exerciseStats';

/**
 * Exercise Records value text: "100 reps — 2,400 kg done".
 *
 * The kg figure is the exercise's accumulated training volume (reps ×
 * the external load actually lifted for each rep, both bells for a
 * double-kettlebell movement — see resolveExerciseWeightKg), never the
 * weight of one bell. It is shown only when there is real volume: a
 * bodyweight movement (burpees, push-ups, pull-ups) lifts no external
 * load under the app's volume convention, and a carry is measured in
 * steps/distance — neither gets a fabricated "0 kg done".
 */
export function formatExerciseRecord(
  stat: Pick<ExerciseStats, 'totalReps' | 'totalVolumeKg' | 'totalDistanceFt' | 'totalSteps'>,
  toDisplayWeight: (kg: number) => number,
  unit: string
): string {
  const amount =
    stat.totalReps > 0
      ? `${stat.totalReps.toLocaleString()} reps`
      : stat.totalDistanceFt > 0
        ? `${stat.totalDistanceFt.toLocaleString()} ft`
        : `${stat.totalSteps.toLocaleString()} steps`;
  const volume = toDisplayWeight(stat.totalVolumeKg);
  return volume > 0 ? `${amount} — ${volume.toLocaleString()} ${unit} done` : amount;
}
