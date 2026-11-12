import type { WorkoutResult, Workout, ExerciseLibraryEntry } from '../models';
import { getResultExerciseBreakdown } from './resultWorkout';

export interface ExerciseStats {
  exerciseId: string;
  exerciseName: string;
  totalReps: number;
  totalVolumeKg: number;
  totalSessions: number;
  lastPerformedAt: string | null;
  /**
   * Lifetime total distance for a distance-based exercise (e.g. Front
   * Rack Carry) — same `Exercise.targetDistanceFt` unit the rest of the
   * app already displays as "X ft". Stays 0 for every rep-based exercise
   * (never populated for them), same as totalReps stays 0 for a
   * distance-based one — neither is fabricated for the other's type.
   */
  totalDistanceFt: number;
  totalSteps: number;
}

type WorkoutResolver = (workoutId: string) => Workout | undefined;
type LibraryResolver = (exerciseName: string) => ExerciseLibraryEntry | undefined;

/**
 * Lifetime per-exercise totals, entirely derived from already-persisted
 * WorkoutResult rows — no separate per-exercise storage table. Each
 * result contributes exactly its own Exercise Breakdown
 * (getResultExerciseBreakdown): the workout it actually performed, so a
 * Custom Hunt's rounds/ladder depth/reps/carry steps, the real round
 * count of a ladder or EMOM attempt, and the post-hunt extra sets
 * (push-ups, pull-ups) all count — the same numbers the Victory screen
 * showed for that hunt, never the canonical template's. Distance- and
 * step-based carries keep their own units without fabricating reps or
 * volume.
 *
 * Resolvers are passed in rather than importing the Content Engine
 * directly, keeping this util pure/testable like huntState.ts and
 * campaignState.ts — callers (workoutSlice) supply contentEngine's
 * lookups.
 */
export function getAllExerciseStats(
  results: WorkoutResult[],
  getWorkout: WorkoutResolver,
  getLibraryEntry: LibraryResolver,
  getLibraryEntryById?: (id: string) => ExerciseLibraryEntry | undefined
): ExerciseStats[] {
  const statsById = new Map<string, ExerciseStats>();

  results.forEach((result) => {
    const breakdown = getResultExerciseBreakdown(result, getWorkout, getLibraryEntryById);
    if (!breakdown) {
      return;
    }
    const exerciseIdsThisSession = new Set<string>();
    breakdown.forEach((item) => {
      const entry = item.exerciseId
        ? getLibraryEntryById?.(item.exerciseId) ?? getLibraryEntry(item.name)
        : getLibraryEntry(item.name);
      if (!entry) return;

      const existing: ExerciseStats = statsById.get(entry.id) ?? {
        exerciseId: entry.id,
        exerciseName: entry.name,
        totalReps: 0,
        totalVolumeKg: 0,
        totalSessions: 0,
        lastPerformedAt: null,
        totalDistanceFt: 0,
        totalSteps: 0,
      };
      existing.totalReps += item.totalReps;
      existing.totalVolumeKg += item.volumeKg;
      existing.totalDistanceFt += item.totalDistanceFt ?? 0;
      existing.totalSteps += item.totalSteps ?? 0;
      if (!exerciseIdsThisSession.has(entry.id)) {
        existing.totalSessions += 1;
        exerciseIdsThisSession.add(entry.id);
      }
      if (!existing.lastPerformedAt || result.completedAt > existing.lastPerformedAt) {
        existing.lastPerformedAt = result.completedAt;
      }
      statsById.set(entry.id, existing);
    });
  });

  return Array.from(statsById.values()).sort((a, b) => b.totalSessions - a.totalSessions);
}

export function findExerciseStats(stats: ExerciseStats[], exerciseId: string): ExerciseStats | null {
  return stats.find((s) => s.exerciseId === exerciseId) ?? null;
}

export interface WeaknessProfile {
  /** Highest lifetime volume — the movement carrying the most total load. */
  strongest: ExerciseStats | null;
  /** Lowest lifetime volume among exercises actually trained at least once. */
  weakest: ExerciseStats | null;
  /** Fewest sessions among exercises actually trained at least once. */
  leastTrained: ExerciseStats | null;
}

/**
 * Simple derived signal — no AI, no model, just sorting already-derived
 * ExerciseStats three ways. An exercise never attempted isn't a
 * "weakness", it's just unseen, so all three fields are null until at
 * least one exercise has been trained.
 */
export function getWeaknessProfile(stats: ExerciseStats[]): WeaknessProfile {
  if (stats.length === 0) {
    return { strongest: null, weakest: null, leastTrained: null };
  }
  const byVolumeDesc = [...stats].sort((a, b) => b.totalVolumeKg - a.totalVolumeKg);
  const bySessionsAsc = [...stats].sort((a, b) => a.totalSessions - b.totalSessions);
  return {
    strongest: byVolumeDesc[0],
    weakest: byVolumeDesc[byVolumeDesc.length - 1],
    leastTrained: bySessionsAsc[0],
  };
}
