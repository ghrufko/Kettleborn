import { Monster, MonsterProgress, WorkoutResult, Workout } from '../models';
import { HuntRank } from './huntRank';
import { computeHistoricalRanks, bestRank } from './rankHistory';

export interface BestiaryStats {
  firstDefeatedAt: string | null;
  /** How many times the monster's final Hunt has been completed — each clear counts as a defeat, including replays. */
  timesDefeated: number;
  fastestVictorySeconds: number | null;
  personalBestRank: HuntRank | null;
  favoriteHuntName: string | null;
  completionPercent: number;
}

/**
 * Everything the Bestiary entry needs about one monster, derived from
 * results already filtered to that monster plus its persisted progress
 * row — no new storage. "Defeated" is tied to the monster's final Hunt
 * (highest `order`) specifically, since MonsterProgress.defeated only
 * ever flips true once that Hunt is first cleared.
 */
export function getBestiaryStats(
  monster: Monster,
  progress: MonsterProgress | undefined,
  monsterResults: WorkoutResult[],
  getWorkout: (workoutId: string) => Workout | undefined
): BestiaryStats {
  const huntsTotal = progress?.huntsTotal ?? monster.hunts.length;
  const huntsCompleted = progress?.huntsCompleted ?? 0;
  const completionPercent = huntsTotal > 0 ? Math.round((huntsCompleted / huntsTotal) * 100) : 0;

  const finalHunt = [...monster.hunts].sort((a, b) => b.order - a.order)[0];
  const finalHuntResults = finalHunt ? monsterResults.filter((r) => r.huntId === finalHunt.id) : [];

  const timesDefeated = finalHuntResults.length;
  const firstDefeatedAt = finalHuntResults.length
    ? finalHuntResults.reduce(
        (earliest, r) => (r.completedAt < earliest ? r.completedAt : earliest),
        finalHuntResults[0].completedAt
      )
    : null;
  const fastestVictorySeconds = finalHuntResults.length
    ? Math.min(...finalHuntResults.map((r) => r.timeMinutes * 60 + r.timeSeconds))
    : null;

  const ranked = computeHistoricalRanks(monsterResults, getWorkout);
  const personalBestRank = bestRank(ranked);

  const huntCounts = new Map<string, number>();
  monsterResults.forEach((r) => huntCounts.set(r.huntId, (huntCounts.get(r.huntId) ?? 0) + 1));
  let favoriteHuntId: string | null = null;
  let favoriteCount = 0;
  huntCounts.forEach((count, huntId) => {
    if (count > favoriteCount) {
      favoriteCount = count;
      favoriteHuntId = huntId;
    }
  });
  const favoriteHuntName = favoriteHuntId
    ? monster.hunts.find((h) => h.id === favoriteHuntId)?.name ?? null
    : null;

  return {
    firstDefeatedAt,
    timesDefeated,
    fastestVictorySeconds,
    personalBestRank,
    favoriteHuntName,
    completionPercent,
  };
}
