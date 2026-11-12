import type { WorkoutResult } from '../models';
import { contentEngine } from '../../engines/content';
import { getResultVolumeKg } from './resultWorkout';

export interface PeriodSummary {
  workouts: number;
  totalMinutes: number;
  totalVolumeKg: number;
}

/**
 * The volume one hunt contributes to the weekly/monthly totals — the same
 * figure it added to the lifetime Chronicle total and showed on its
 * Victory screen (see getResultVolumeKg). This used to rebuild every
 * result from the CANONICAL workout with its canonical round count, so a
 * Custom Hunt was counted as the full default workout (a 5-rung Custom
 * Minotaur ladder at 2 × 24 kg read as 9,600 kg instead of 2,400 kg).
 */
function volumeForResult(result: WorkoutResult): number {
  // A result whose workout no longer exists in content and that predates
  // stored volume can't be measured — it adds nothing rather than a
  // fabricated weight-only figure.
  return (
    getResultVolumeKg(
      result,
      (workoutId) => contentEngine.getWorkout(workoutId),
      (exerciseId) => contentEngine.getExerciseLibraryEntry(exerciseId)
    ) ?? 0
  );
}

function isSameCalendarWeek(a: Date, b: Date): boolean {
  const dayMs = 24 * 60 * 60 * 1000;
  const startOfWeek = (date: Date) => {
    const d = new Date(date);
    const day = d.getDay(); // 0 = Sunday
    d.setHours(0, 0, 0, 0);
    d.setTime(d.getTime() - day * dayMs);
    return d.getTime();
  };
  return startOfWeek(a) === startOfWeek(b);
}

/**
 * All results within the current calendar week (Sunday-start). Purely
 * derived from already-persisted WorkoutResult rows — no new table, same
 * "derive, don't re-store" principle as huntState/campaignState.
 */
export function getWeeklySummary(results: WorkoutResult[], now: Date = new Date()): PeriodSummary {
  const weekResults = results.filter((r) => isSameCalendarWeek(new Date(r.completedAt), now));
  return {
    workouts: weekResults.length,
    totalMinutes: weekResults.reduce((sum, r) => sum + r.timeMinutes + r.timeSeconds / 60, 0) | 0,
    totalVolumeKg: weekResults.reduce((sum, r) => sum + volumeForResult(r), 0),
  };
}

/** All results within the current calendar month. */
export function getMonthlySummary(results: WorkoutResult[], now: Date = new Date()): PeriodSummary {
  const monthResults = results.filter((r) => {
    const d = new Date(r.completedAt);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  });
  return {
    workouts: monthResults.length,
    totalMinutes: monthResults.reduce((sum, r) => sum + r.timeMinutes + r.timeSeconds / 60, 0) | 0,
    totalVolumeKg: monthResults.reduce((sum, r) => sum + volumeForResult(r), 0),
  };
}

export interface CalendarDay {
  date: number; // day of month, 1-based
  trained: boolean;
  isToday: boolean;
}

/**
 * A simple day-by-day grid for the current calendar month, marking which
 * days had at least one completed hunt — the "Training Calendar" the
 * brief asks for, built from the same WorkoutResult rows Chronicle already
 * reads for its timeline.
 */
export function getTrainingCalendar(results: WorkoutResult[], now: Date = new Date()): CalendarDay[] {
  const year = now.getFullYear();
  const month = now.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = now.getDate();

  const trainedDays = new Set<number>();
  results.forEach((r) => {
    const d = new Date(r.completedAt);
    if (d.getFullYear() === year && d.getMonth() === month) {
      trainedDays.add(d.getDate());
    }
  });

  return Array.from({ length: daysInMonth }, (_, i) => {
    const date = i + 1;
    return { date, trained: trainedDays.has(date), isToday: date === today };
  });
}
