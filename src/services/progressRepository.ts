import { getDatabase } from './db';
import { MonsterProgress, CampaignProgress } from '../models';

interface MonsterProgressRow {
  user_id: string;
  monster_id: string;
  hunts_completed: number;
  hunts_total: number;
  defeated: number;
}

interface CampaignProgressRow {
  user_id: string;
  campaign_id: string;
  hunts_completed: number;
  hunts_total: number;
}

function toMonsterProgress(row: MonsterProgressRow): MonsterProgress {
  return {
    userId: row.user_id,
    monsterId: row.monster_id,
    huntsCompleted: row.hunts_completed,
    huntsTotal: row.hunts_total,
    defeated: row.defeated === 1,
  };
}

function toCampaignProgress(row: CampaignProgressRow): CampaignProgress {
  return {
    userId: row.user_id,
    campaignId: row.campaign_id,
    huntsCompleted: row.hunts_completed,
    huntsTotal: row.hunts_total,
  };
}

export const ProgressRepository = {
  async getMonsterProgress(userId: string, monsterId: string): Promise<MonsterProgress | null> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<MonsterProgressRow>(
      'SELECT * FROM monster_progress WHERE user_id = ? AND monster_id = ?;',
      userId,
      monsterId
    );
    return row ? toMonsterProgress(row) : null;
  },

  async getAllMonsterProgress(userId: string): Promise<MonsterProgress[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<MonsterProgressRow>(
      'SELECT * FROM monster_progress WHERE user_id = ?;',
      userId
    );
    return rows.map(toMonsterProgress);
  },

  async upsertMonsterProgress(progress: MonsterProgress): Promise<void> {
    const db = await getDatabase();
    await db.runAsync(
      `INSERT INTO monster_progress (user_id, monster_id, hunts_completed, hunts_total, defeated)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (user_id, monster_id) DO UPDATE SET
         hunts_completed = excluded.hunts_completed,
         hunts_total = excluded.hunts_total,
         defeated = excluded.defeated;`,
      progress.userId,
      progress.monsterId,
      progress.huntsCompleted,
      progress.huntsTotal,
      progress.defeated ? 1 : 0
    );
  },

  async getCampaignProgress(userId: string, campaignId: string): Promise<CampaignProgress | null> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<CampaignProgressRow>(
      'SELECT * FROM campaign_progress WHERE user_id = ? AND campaign_id = ?;',
      userId,
      campaignId
    );
    return row ? toCampaignProgress(row) : null;
  },

  async upsertCampaignProgress(progress: CampaignProgress): Promise<void> {
    const db = await getDatabase();
    await db.runAsync(
      `INSERT INTO campaign_progress (user_id, campaign_id, hunts_completed, hunts_total)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id, campaign_id) DO UPDATE SET
         hunts_completed = excluded.hunts_completed,
         hunts_total = excluded.hunts_total;`,
      progress.userId,
      progress.campaignId,
      progress.huntsCompleted,
      progress.huntsTotal
    );
  },

  /**
   * Campaign Reset (Settings): wipes per-monster hunt/defeated state so the
   * caller can rebuild fresh rows via loadAllMonsterProgress, same as a new
   * player's first launch.
   */
  async clearMonsterProgress(userId: string): Promise<void> {
    const db = await getDatabase();
    await db.runAsync('DELETE FROM monster_progress WHERE user_id = ?;', userId);
  },

  /** Campaign Reset (Settings): wipes campaign-level completion records. */
  async clearCampaignProgress(userId: string): Promise<void> {
    const db = await getDatabase();
    await db.runAsync('DELETE FROM campaign_progress WHERE user_id = ?;', userId);
  },
};
