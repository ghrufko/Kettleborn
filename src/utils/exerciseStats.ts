import { WorkoutResult, Workout, ExerciseLibraryEntry } from '../models';
import { getExerciseMovements, resolveExerciseWeightKg } from './exerciseBreakdown';
import { getWorkoutRoundExercises } from './workoutPresentation';

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
 * WorkoutResult rows plus the fixed exercise list each Workout carries in
 * content — no separate per-exercise storage table. A completed hunt
 * always means the workout's exact prescribed exercises/reps were
 * finished (Sprint 6: victory is bound to finishing the prescribed
 * workout, not partial credit), so this reconstruction is exact, not an
 * estimate. Distance- and step-based carries preserve their real unit
 * totals without fabricating reps or volume.
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
    const workout = getWorkout(result.workoutId);
    if (!workout) {
      return;
    }
    const weightAKg = result.weightValueA;
    const weightBKg = result.weightValueB;
    const exerciseIdsThisSession = new Set<string>();

    // Sections carry a distinct exercise list per round (e.g. Behemoth's
    // three phases) — the same canonical source Hunt Brief, Active Hunt,
    // and Exercise Breakdown already read from. A workout without sections
    // is resolved per round via getWorkoutRoundExercises (statistics
    // audit): correct for an ordinary flat workout (same full list every
    // round, same final totals as the old flat-list-times-rounds math)
    // AND for a workout using the "legacy repeated Chain stored as
    // consecutive blocks" fallback (e.g. Atlas), which the old blind
    // multiply double-counted. Task 3 (EMOM): an open-ended workout's
    // actual round count can differ from workout.rounds (a reference
    // value only for those, never a cap) — this result's own
    // rungLaps.length is what actually happened.
    const actualRounds = result.rungLaps?.length ?? workout.rounds;
    const exerciseGroups = workout.sections
      ? workout.sections.map((section) => section.exercises)
      : Array.from({ length: actualRounds }, (_, i) => getWorkoutRoundExercises(workout, i + 1));

    exerciseGroups.forEach((exerciseList) => {
      exerciseList.forEach((exercise) => {
        // Each group above is already exactly one round's worth of
        // exercises (a section, or one resolved round block) — no further
        // multiplier needed here.
        const reps = exercise.targetReps ?? 0;
        const distanceFt = exercise.targetDistanceFt ?? 0;
        const steps = exercise.targetSteps ?? 0;
        getExerciseMovements(exercise, getLibraryEntryById).forEach((movement) => {
          const entry = movement.libraryExerciseId
            ? getLibraryEntryById?.(movement.libraryExerciseId) ?? getLibraryEntry(movement.name)
            : getLibraryEntry(movement.name);
          if (!entry) return;

          // Each combination component is credited as its own canonical
          // movement and uses its own kettlebell count. The combo step's
          // target reps apply once to every constituent movement.
          const weightPerRepKg = resolveExerciseWeightKg(
            { ...exercise, usesGearCount: movement.usesGearCount },
            workout.gearCount,
            weightAKg,
            weightBKg
          );
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

          existing.totalReps += reps;
          existing.totalVolumeKg += reps * weightPerRepKg;
          existing.totalDistanceFt += distanceFt;
          existing.totalSteps += steps;
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
