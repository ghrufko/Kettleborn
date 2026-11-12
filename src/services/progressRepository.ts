import { getDatabase } from './db';
import type { MonsterProgress, CampaignProgress } from '../models';

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
   * Campaign Reset (Settings): returns every monster's hunt/defeated state
   * to a never-fought state. Rows are zeroed, not deleted — the reset's
   * snapshot (progress_reset) keeps their previous values.
   */
  async zeroAllMonsterProgress(userId: string): Promise<void> {
    const db = await getDatabase();
    await db.runAsync(
      'UPDATE monster_progress SET hunts_completed = 0, defeated = 0 WHERE user_id = ?;',
      userId
    );
  },

  /** Campaign Reset (Settings): zeroes campaign-level completion records (nothing writes this table today; kept consistent anyway). */
  async zeroAllCampaignProgress(userId: string): Promise<void> {
    const db = await getDatabase();
    await db.runAsync('UPDATE campaign_progress SET hunts_completed = 0 WHERE user_id = ?;', userId);
  },

  /**
   * D6: how many times this monster has been reset in the given epoch (its
   * reset "era" number). null when migration 19 could not reconstruct the
   * reset history for this install (C1) — then the count is unknown and is
   * recorded as NULL rather than guessed.
   */
  async getMonsterResetCount(userId: string, monsterId: string, epoch: number): Promise<number | null> {
    const db = await getDatabase();
    const blocked = await db.getFirstAsync<{ reason: string | null }>(
      'SELECT sync_blocked_reason AS reason FROM sync_state WHERE id = 1;'
    );
    if (!blocked || blocked.reason !== null) {
      return null;
    }
    const row = await db.getFirstAsync<{ n: number | null }>(
      `SELECT MAX(count_after) AS n FROM progress_reset
       WHERE user_id = ? AND scope = 'monster' AND monster_id = ? AND epoch = ?;`,
      userId,
      monsterId,
      epoch
    );
    return row?.n ?? 0;
  },

  async getAllCampaignProgress(userId: string): Promise<CampaignProgress[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<CampaignProgressRow>(
      'SELECT * FROM campaign_progress WHERE user_id = ?;',
      userId
    );
    return rows.map(toCampaignProgress);
  },
};
