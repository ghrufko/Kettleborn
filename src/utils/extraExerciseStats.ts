import type { WorkoutResult, ExtraExerciseId } from '../models';

export interface ExtraExerciseStats {
  exerciseId: ExtraExerciseId;
  totalReps: number;
  totalSets: number;
  lastPerformedAt: string | null;
}

/**
 * Lifetime per-exercise totals for the optional post-Hunt extra
 * exercises — entirely derived from already-persisted WorkoutResult rows'
 * `extraSets`, no separate storage table. `getAllExerciseStats`
 * (exerciseStats.ts) already counts these reps in each exercise's overall
 * totals; this is the extra-set share of them plus the set count, shown
 * on Exercise Detail. An extra set carries no weight, so there's no
 * volume figure here — never fabricated to match the main-exercise stats
 * shape.
 */
export function getAllExtraExerciseStats(results: WorkoutResult[]): ExtraExerciseStats[] {
  const statsById = new Map<ExtraExerciseId, ExtraExerciseStats>();

  results.forEach((result) => {
    if (!result.extraSets) {
      return;
    }
    result.extraSets.forEach((set) => {
      const existing: ExtraExerciseStats = statsById.get(set.exerciseId) ?? {
        exerciseId: set.exerciseId,
        totalReps: 0,
        totalSets: 0,
        lastPerformedAt: null,
      };
      existing.totalReps += set.reps;
      existing.totalSets += 1;
      if (!existing.lastPerformedAt || result.completedAt > existing.lastPerformedAt) {
        existing.lastPerformedAt = result.completedAt;
      }
      statsById.set(set.exerciseId, existing);
    });
  });

  return Array.from(statsById.values()).sort((a, b) => b.totalSets - a.totalSets);
}

export function findExtraExerciseStats(
  stats: ExtraExerciseStats[],
  exerciseId: string
): ExtraExerciseStats | null {
  return stats.find((s) => s.exerciseId === exerciseId) ?? null;
}
