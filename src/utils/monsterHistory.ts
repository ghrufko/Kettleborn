import { WorkoutResult, Workout } from '../models';
import { HuntRank } from './huntRank';
import { computeHistoricalRanks } from './rankHistory';

export interface MonsterHistoryEntry {
  completedAt: string;
  monsterId: string;
  weightKg: number;
  /** Kettlebell weight audit: the second bell's real weight when gearCount is 2 — independent from weightKg. null for a single-bell result. */
  weightBKg: number | null;
  gearCount: 1 | 2;
  timeSeconds: number;
  rank: HuntRank;
  /** Post-Hunt RPE (1 Easy – 4 Brutal), or null if not set for this result. */
  rpe: number | null;
}

/**
 * Monster Performance History: the latest N completed results for one
 * monster, newest first. Read-only — derives everything from data that
 * already exists (WorkoutResult rows) via the existing helpers, rather
 * than introducing a new calculation:
 * - rank is computed the same way Journal/Hunter already do, via
 *   `computeHistoricalRanks` (same PR-at-the-time chronological walk
 *   `rankHistory.ts` already uses) — not reimplemented here.
 * - `results` should be the player's FULL result history (e.g. from
 *   `getAllResults()`), not pre-filtered to this monster, so PR
 *   determination for each result still sees its complete prior history
 *   before this function filters down to just this monster's rows.
 *
 * No new storage, no new write path, no UI — a pure function over
 * already-persisted data.
 */
export function getMonsterHistory(
  results: WorkoutResult[],
  getWorkout: (workoutId: string) => Workout | undefined,
  monsterId: string,
  limit = 5
): MonsterHistoryEntry[] {
  const ranked = computeHistoricalRanks(results, getWorkout);

  return ranked
    .filter(({ result }) => result.monsterId === monsterId)
    .sort((a, b) => new Date(b.result.completedAt).getTime() - new Date(a.result.completedAt).getTime())
    .slice(0, limit)
    .map(({ result, rank }) => ({
      completedAt: result.completedAt,
      monsterId: result.monsterId,
      weightKg: result.weightValueA,
      weightBKg: result.weightValueB,
      gearCount: result.weightValueB ? 2 : 1,
      timeSeconds: result.timeMinutes * 60 + result.timeSeconds,
      rank,
      rpe: result.rpe,
    }));
}
