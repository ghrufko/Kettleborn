import { WorkoutResult, Workout, ExerciseLibraryEntry } from '../models';
import { resolveExerciseWeightKg } from './exerciseBreakdown';

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
 * estimate. Distance-based exercises (e.g. Farmer Carry) contribute 0
 * reps/volume but a real totalDistanceFt, and still count as a session —
 * no reps are fabricated for them, and no distance is fabricated for a
 * rep-based exercise either.
 *
 * Resolvers are passed in rather than importing the Content Engine
 * directly, keeping this util pure/testable like huntState.ts and
 * campaignState.ts — callers (workoutSlice) supply contentEngine's
 * lookups.
 */
export function getAllExerciseStats(
  results: WorkoutResult[],
  getWorkout: WorkoutResolver,
  getLibraryEntry: LibraryResolver
): ExerciseStats[] {
  const statsById = new Map<string, ExerciseStats>();

  results.forEach((result) => {
    const workout = getWorkout(result.workoutId);
    if (!workout) {
      return;
    }
    const weightAKg = result.weightValueA;
    const weightBKg = result.weightValueB;

    // Sections carry a distinct exercise list per round (e.g. Behemoth's
    // three phases) — the same canonical source Hunt Brief, Active Hunt,
    // and Exercise Breakdown already read from. A workout without sections
    // still resolves to exactly one group (the flat list), so unsectioned
    // workouts' stats are unchanged.
    const exerciseGroups = workout.sections
      ? workout.sections.map((section) => section.exercises)
      : [workout.exercises];

    exerciseGroups.forEach((exerciseList) => {
      exerciseList.forEach((exercise) => {
        const entry = getLibraryEntry(exercise.name);
        if (!entry) {
          return;
        }

        // Sprint 27 (Aggregate Volume fix): a section is already one
        // round's worth of exercises (no multiplier needed), but the flat
        // fallback list is only ever written once in content and repeats
        // every round — same distinction getExerciseBreakdown already
        // makes, kept consistent here rather than reusing that helper
        // directly, since this function's per-occurrence session-counting
        // (including 0-rep distance exercises still counting as a
        // session) is intentionally different from getExerciseBreakdown's
        // reps-only, zero-filtered output.
        // Task 3 (EMOM): an open-ended workout's actual round count can
        // differ from workout.rounds (a reference value only for those,
        // never a cap) — this result's own rungLaps.length is what
        // actually happened. For every other workout (no rungLaps saved)
        // this is unchanged; for a ladder workout the two already
        // coincide, so this changes nothing there either.
        const actualRounds = result.rungLaps?.length ?? workout.rounds;
        const reps = (exercise.targetReps ?? 0) * (workout.sections ? 1 : actualRounds);
        const distanceFt = (exercise.targetDistanceFt ?? 0) * (workout.sections ? 1 : actualRounds);
        // Kettlebell weight audit: resolveExerciseWeightKg (shared with
        // getExerciseBreakdown, see that file) — a single-bell exercise
        // embedded in an otherwise gearCount:2 workout (e.g. Chimera's
        // "Snatch / Thruster") no longer gets credited with both bells'
        // combined weight, and two genuinely different bell weights
        // (16kg + 18kg) are summed exactly, never assumed equal.
        const weightPerRepKg = resolveExerciseWeightKg(
          exercise,
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
        };

        existing.totalReps += reps;
        existing.totalVolumeKg += reps * weightPerRepKg;
        existing.totalDistanceFt += distanceFt;
        existing.totalSessions += 1;
        if (!existing.lastPerformedAt || result.completedAt > existing.lastPerformedAt) {
          existing.lastPerformedAt = result.completedAt;
        }
        statsById.set(entry.id, existing);
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
