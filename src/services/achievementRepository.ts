import { getDatabase } from './db';
import { Achievement, AchievementMilestoneType } from '../models';

interface AchievementRow {
  user_id: string;
  milestone_type: string;
  unlocked_at: string;
}

function toAchievement(row: AchievementRow): Achievement {
  return {
    userId: row.user_id,
    milestoneType: row.milestone_type as AchievementMilestoneType,
    unlockedAt: row.unlocked_at,
  };
}

export const AchievementRepository = {
  async getAllForUser(userId: string): Promise<Achievement[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<AchievementRow>(
      'SELECT user_id, milestone_type, unlocked_at FROM achievement WHERE user_id = ?;',
      userId
    );
    return rows.map(toAchievement);
  },

  /**
   * Idempotent via the (user_id, milestone_type) PRIMARY KEY — `INSERT OR
   * IGNORE` is a silent no-op when this milestone type is already
   * unlocked for this user, never a duplicate row and never an
   * overwritten (and therefore wrong) original unlock timestamp.
   */
  async unlock(userId: string, milestoneType: AchievementMilestoneType, unlockedAt: string): Promise<void> {
    const db = await getDatabase();
    await db.runAsync(
      'INSERT OR IGNORE INTO achievement (user_id, milestone_type, unlocked_at) VALUES (?, ?, ?);',
      userId,
      milestoneType,
      unlockedAt
    );
  },
};
