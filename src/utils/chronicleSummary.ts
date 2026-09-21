import { WorkoutResult } from '../models';
import { contentEngine } from '../../engines/content';
import { getExerciseBreakdown } from './exerciseBreakdown';

export interface PeriodSummary {
  workouts: number;
  totalMinutes: number;
  totalVolumeKg: number;
}

/**
 * Sprint 27 (Aggregate Volume fix): previously `result.weightValueA +
 * (result.weightValueB ?? 0)` — that's just the weight used, with zero
 * reps factored in at all (not even a flat/undercounted rep figure, no
 * reps whatsoever). Reuses the same authoritative, sections+rounds-aware
 * `getExerciseBreakdown` helper the aggregate `HuntSummary.volumeKg` fix
 * and the Victory screen's "Exercise Breakdown" card already use — one
 * volume formula, not three different interpretations of how much work a
 * Hunt represents.
 */
function volumeForResult(result: WorkoutResult): number {
  const workout = contentEngine.getWorkout(result.workoutId);
  if (!workout) {
    // Content for this workoutId no longer exists (e.g. removed/renamed
    // workout) — fall back to the old weight-only approximation rather
    // than throwing or silently dropping this result from the totals.
    return result.weightValueA + (result.weightValueB ?? 0);
  }
  const gearCount = result.weightValueB !== null ? 2 : 1;
  // Kettlebell weight audit: weightValueB is passed through as its own
  // real value now (was missing entirely here — getExerciseBreakdown
  // would have silently fallen back to weightValueA * 2 for every
  // double-bell exercise, wrong whenever the two bells actually differ).
  return getExerciseBreakdown(
    workout,
    workout.rounds,
    result.weightValueA,
    gearCount,
    result.weightValueB
  ).reduce((sum, entry) => sum + entry.volumeKg, 0);
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
