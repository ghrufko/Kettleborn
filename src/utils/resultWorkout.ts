import type { Exercise, ExerciseLibraryEntry, ExtraExerciseSet, Workout, WorkoutResult } from '../models';
import { buildCustomWorkout, getStructuralControlConfig } from './customWorkoutStructure';
import { getExerciseBreakdown } from './exerciseBreakdown';
import type { ExerciseBreakdownEntry } from './exerciseBreakdown';

/**
 * The single source of truth for "what did this completed hunt actually
 * contain" — every statistic derived from saved results (Exercise
 * Records, weekly/monthly volume, Training Balance, per-encounter
 * configuration) reads it from here.
 *
 * A saved result stores the configuration it was performed with
 * (weights, Custom Hunt structural value and per-step overrides, the
 * real round count for ladders/EMOM via rungLaps, extra sets), never the
 * exercise list itself. Rebuilding that list from the CANONICAL workout —
 * what the statistics used to do — reported a 5-rung Custom Minotaur
 * ladder as the full 10-rung ladder (100 reps per movement instead of
 * 25). The Victory screen's Exercise Breakdown was right because it was
 * computed from the workout the session actually ran; this rebuilds that
 * same workout from the result, with the same builder the session used
 * (buildCustomWorkout), so every screen agrees with it.
 */

/** A step as it was when the result was recorded — see Exercise.previousVersion. */
export function exerciseAsOf(exercise: Exercise, completedAt: string): Exercise {
  const previous = exercise.previousVersion;
  if (!previous || completedAt >= previous.before) {
    return exercise;
  }
  return {
    ...exercise,
    name: previous.name,
    libraryExerciseId: previous.libraryExerciseId,
    displayName: previous.displayName,
    usesGearCount: previous.usesGearCount,
    previousVersion: undefined,
  };
}

/** The canonical workout as it was authored when `completedAt` happened. */
export function workoutAsOf(workout: Workout, completedAt: string): Workout {
  const hasRevision = (exercises: Exercise[] | undefined) => !!exercises?.some((exercise) => exercise.previousVersion);
  if (!hasRevision(workout.exercises) && !workout.sections?.some((section) => hasRevision(section.exercises))) {
    return workout;
  }
  return {
    ...workout,
    exercises: workout.exercises.map((exercise) => exerciseAsOf(exercise, completedAt)),
    sections: workout.sections?.map((section) => ({
      ...section,
      exercises: section.exercises.map((exercise) => exerciseAsOf(exercise, completedAt)),
    })),
  };
}

/**
 * The workout this result performed: the canonical workout (as of the
 * result's date), rebuilt with its own Custom Hunt structural value and
 * per-step overrides when it has any. A canonical result, or a legacy
 * Custom Hunt row saved before those snapshots existed, is the canonical
 * workout — the same fallback encounterLock.ts already documents.
 */
export function getPerformedWorkout(result: WorkoutResult, canonicalWorkout: Workout): Workout {
  const base = workoutAsOf(canonicalWorkout, result.completedAt);
  if (!result.isCustomHunt) {
    return base;
  }
  const structuralValue = result.structuralValueUsed ?? null;
  const overrides = result.repsOverridesUsed ?? null;
  const hasOverrides = !!overrides && Object.keys(overrides).length > 0;
  if (structuralValue === null && !hasOverrides) {
    return base;
  }
  const control = getStructuralControlConfig(base);
  return buildCustomWorkout(base, structuralValue ?? control?.canonical ?? 0, overrides ?? undefined);
}

/** Rounds actually completed: the per-round lap history when the session kept one (ladders, EMOM), else the workout's own round count. */
export function getPerformedRounds(result: Pick<WorkoutResult, 'rungLaps'>, performedWorkout: Workout): number {
  return result.rungLaps && result.rungLaps.length > 0 ? result.rungLaps.length : performedWorkout.rounds;
}

/**
 * Optional post-hunt sets (push-ups, pull-ups) as breakdown entries. They
 * are bodyweight movements, so under the app's volume convention (a
 * bodyweight step lifts 0 kg — see Exercise.usesGearCount) they add reps
 * and no volume. Sets of the same exercise are summed; an entry already
 * present in `entries` (the same library movement in the main workout)
 * gets the reps added to it instead of a second row.
 */
export function addExtraSetsToBreakdown(
  entries: ExerciseBreakdownEntry[],
  extraSets: ExtraExerciseSet[] | null | undefined,
  getLibraryEntryById?: (id: string) => ExerciseLibraryEntry | undefined
): ExerciseBreakdownEntry[] {
  if (!extraSets || extraSets.length === 0) {
    return entries;
  }
  const merged = entries.map((entry) => ({ ...entry }));
  for (const set of extraSets) {
    if (!(set.reps > 0)) continue;
    const existing = merged.find((entry) => entry.exerciseId === set.exerciseId);
    if (existing) {
      existing.totalReps += set.reps;
      existing.extraReps = (existing.extraReps ?? 0) + set.reps;
      continue;
    }
    merged.push({
      exerciseId: set.exerciseId,
      name: getLibraryEntryById?.(set.exerciseId)?.name ?? set.exerciseId,
      totalReps: set.reps,
      volumeKg: 0,
      weightAKg: 0,
      weightBKg: null,
      extraReps: set.reps,
    });
  }
  return merged;
}

/**
 * Per-exercise reps/volume for one saved result, extra sets included —
 * the same figures the Victory screen showed when it was completed.
 * Returns null when the result's workout no longer exists in content (its
 * exercises can't be known, so nothing is fabricated).
 */
export function getResultExerciseBreakdown(
  result: WorkoutResult,
  getWorkout: (workoutId: string) => Workout | undefined,
  getLibraryEntryById?: (id: string) => ExerciseLibraryEntry | undefined
): ExerciseBreakdownEntry[] | null {
  const canonicalWorkout = getWorkout(result.workoutId);
  if (!canonicalWorkout) {
    return null;
  }
  const workout = getPerformedWorkout(result, canonicalWorkout);
  const breakdown = getExerciseBreakdown(
    workout,
    getPerformedRounds(result, workout),
    result.weightValueA,
    result.weightValueB !== null ? 2 : 1,
    result.weightValueB,
    getLibraryEntryById
  );
  return addExtraSetsToBreakdown(breakdown, result.extraSets, getLibraryEntryById);
}

/**
 * Training volume (kg) of one saved result. The volume completeHunt
 * recorded on the result (migration 19's `volumeKg` — exactly what that
 * hunt added to the lifetime Chronicle total) is preferred; older rows
 * without it are rebuilt from the performed workout. Null only when
 * neither is possible.
 */
export function getResultVolumeKg(
  result: WorkoutResult,
  getWorkout: (workoutId: string) => Workout | undefined,
  getLibraryEntryById?: (id: string) => ExerciseLibraryEntry | undefined
): number | null {
  if (typeof result.volumeKg === 'number' && Number.isFinite(result.volumeKg)) {
    return result.volumeKg;
  }
  const breakdown = getResultExerciseBreakdown(result, getWorkout, getLibraryEntryById);
  return breakdown ? breakdown.reduce((sum, entry) => sum + entry.volumeKg, 0) : null;
}
