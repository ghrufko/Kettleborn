import { WorkoutResult, Workout } from '../models';
import { HuntRank, getHuntRank } from './huntRank';

export interface RankedResult {
  result: WorkoutResult;
  rank: HuntRank;
}

/**
 * Rank isn't persisted on WorkoutResult (it's computed at completion time
 * from elapsed time + whether it was a PR at that moment). To answer
 * questions like "what's the best rank ever earned on this monster" or
 * "has the player ever hit an S rank before", we have to walk the whole
 * history chronologically and recompute each result's rank the same way
 * completeHunt did when it happened — same PR-at-the-time logic as
 * src/utils/timeline.ts, just also keeping the rank instead of only the
 * PR flag.
 */
export function computeHistoricalRanks(
  results: WorkoutResult[],
  getWorkout: (workoutId: string) => Workout | undefined
): RankedResult[] {
  const chronological = [...results].sort(
    (a, b) => new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime()
  );

  const bestSoFar = new Map<string, number>();
  return chronological.map((result) => {
    const seconds = result.timeMinutes * 60 + result.timeSeconds;
    const previousBest = bestSoFar.get(result.workoutId);
    const wasPersonalRecord = previousBest !== undefined && seconds < previousBest;
    if (previousBest === undefined || seconds < previousBest) {
      bestSoFar.set(result.workoutId, seconds);
    }

    const workout = getWorkout(result.workoutId);
    const rank: HuntRank = workout ? getHuntRank(seconds, workout.targetTimeSeconds, wasPersonalRecord) : 'C';
    return { result, rank };
  });
}

const RANK_ORDER: HuntRank[] = ['C', 'B', 'A', 'S'];

/** The best (highest) rank among a set of ranked results, or null if empty. */
export function bestRank(ranked: RankedResult[]): HuntRank | null {
  if (ranked.length === 0) {
    return null;
  }
  return ranked.reduce<HuntRank>(
    (best, current) => (RANK_ORDER.indexOf(current.rank) > RANK_ORDER.indexOf(best) ? current.rank : best),
    'C'
  );
}

/** How many times each rank has been earned across a set of ranked results — a simple tally, not a new rank computation. */
export function rankDistribution(ranked: RankedResult[]): Record<HuntRank, number> {
  const counts: Record<HuntRank, number> = { S: 0, A: 0, B: 0, C: 0 };
  ranked.forEach(({ rank }) => {
    counts[rank] += 1;
  });
  return counts;
}
