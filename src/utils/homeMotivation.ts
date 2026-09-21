import { Chronicle } from '../models';

export interface HomeMotivationInput {
  chronicle: Chronicle | null;
  hasTrainedToday: boolean;
  levelProgress: number; // 0-1
  nextLevel: number;
  lastMonsterName: string | null;
  nextMonsterName: string | null;
}

/**
 * One honest, data-backed line for "why train today" — never a generic
 * motivational quote. Priority order: an at-risk streak is the most
 * time-sensitive and compelling signal, then how close the player is to
 * leveling up, then which monster is next relative to what they last
 * fought. Returns null when none of the signals apply (e.g. brand new
 * player with no history yet) — Home already has other content to show
 * in that case, so this isn't forced.
 */
export function getHomeMotivation(input: HomeMotivationInput): string | null {
  const { chronicle, hasTrainedToday, levelProgress, nextLevel, lastMonsterName, nextMonsterName } = input;

  if (chronicle && chronicle.currentStreakDays > 0 && !hasTrainedToday) {
    return `Your ${chronicle.currentStreakDays}-day streak is still alive — one Hunt keeps it that way.`;
  }

  if (levelProgress >= 0.8) {
    return `Level ${nextLevel} is close. One good Hunt could close the gap.`;
  }

  if (lastMonsterName && nextMonsterName && lastMonsterName !== nextMonsterName) {
    return `Last time you fought ${lastMonsterName}. ${nextMonsterName} is still waiting.`;
  }

  return null;
}
