import { WorkoutResult, Monster, Workout } from '../models';
import { computeHistoricalRanks } from './rankHistory';

/**
 * The longest gap, in whole days, between two consecutive completed
 * Hunts — "the longest silence" in the Hunter's Journal framing. Needs at
 * least two results to mean anything.
 */
export function getLongestSilenceDays(results: WorkoutResult[]): number | null {
  if (results.length < 2) {
    return null;
  }
  const sorted = [...results].sort(
    (a, b) => new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime()
  );
  let longestGapMs = 0;
  for (let i = 1; i < sorted.length; i += 1) {
    const gap = new Date(sorted[i].completedAt).getTime() - new Date(sorted[i - 1].completedAt).getTime();
    if (gap > longestGapMs) {
      longestGapMs = gap;
    }
  }
  return Math.floor(longestGapMs / (24 * 60 * 60 * 1000));
}

export interface DangerousOpponent {
  monsterId: string;
  monsterName: string;
  /** Average rank position, 0 (all C) to 3 (all S) — lower means it gave the player more trouble. */
  averageRankScore: number;
}

const RANK_SCORE: Record<string, number> = { C: 0, B: 1, A: 2, S: 3 };

/**
 * "Most dangerous opponent" — the monster whose Hunts have the lowest
 * average rank across every attempt. A monster the player has beaten
 * quickly and cleanly scores high (safe); one that consistently produces
 * B/C ranks scores low (dangerous). Requires at least one result.
 */
export function getMostDangerousOpponent(
  results: WorkoutResult[],
  getMonster: (monsterId: string) => Monster | undefined,
  getWorkout: (workoutId: string) => Workout | undefined
): DangerousOpponent | null {
  if (results.length === 0) {
    return null;
  }
  const ranked = computeHistoricalRanks(results, getWorkout);

  const scoresByMonster = new Map<string, number[]>();
  ranked.forEach(({ result, rank }) => {
    const list = scoresByMonster.get(result.monsterId) ?? [];
    list.push(RANK_SCORE[rank] ?? 0);
    scoresByMonster.set(result.monsterId, list);
  });

  let worstMonsterId: string | null = null;
  let worstScore = Infinity;
  scoresByMonster.forEach((scores, monsterId) => {
    const average = scores.reduce((sum, s) => sum + s, 0) / scores.length;
    if (average < worstScore) {
      worstScore = average;
      worstMonsterId = monsterId;
    }
  });

  if (!worstMonsterId) {
    return null;
  }
  const monster = getMonster(worstMonsterId);
  return {
    monsterId: worstMonsterId,
    monsterName: monster?.name ?? 'Unknown',
    averageRankScore: worstScore,
  };
}
