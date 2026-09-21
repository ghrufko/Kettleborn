import { getDatabase } from './db';
import { User } from '../models';

interface UserRow {
  id: string;
  display_name: string;
  created_at: string;
  level: number;
  total_xp: number;
  unit_preference: string;
  active_campaign_id: string | null;
}

function toUser(row: UserRow): User {
  return {
    id: row.id,
    displayName: row.display_name,
    createdAt: row.created_at,
    level: row.level,
    totalXP: row.total_xp,
    unitPreference: row.unit_preference === 'lb' ? 'lb' : 'kg',
    activeCampaignId: row.active_campaign_id,
  };
}

export const UserRepository = {
  async getById(userId: string): Promise<User | null> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<UserRow>('SELECT * FROM user WHERE id = ?;', userId);
    return row ? toUser(row) : null;
  },

  async createIfNotExists(user: User): Promise<User> {
    const existing = await this.getById(user.id);
    if (existing) {
      return existing;
    }
    const db = await getDatabase();
    await db.runAsync(
      `INSERT INTO user (id, display_name, created_at, level, total_xp, unit_preference, active_campaign_id)
       VALUES (?, ?, ?, ?, ?, ?, ?);`,
      user.id,
      user.displayName,
      user.createdAt,
      user.level,
      user.totalXP,
      user.unitPreference,
      user.activeCampaignId
    );
    return user;
  },

  /**
   * Adds XP and sets the resulting level in one write. The level itself is
   * always computed by the Progression Engine (engines/progress) — this
   * repository just persists whatever level the caller already derived,
   * the same division of responsibility every other repository follows
   * (DB access only, no business logic).
   */
  async addXPAndSetLevel(userId: string, xpAmount: number, level: number): Promise<User | null> {
    const db = await getDatabase();
    await db.runAsync(
      'UPDATE user SET total_xp = total_xp + ?, level = ? WHERE id = ?;',
      xpAmount,
      level,
      userId
    );
    return this.getById(userId);
  },

  /**
   * Campaign Reset (Settings): returns level/XP to a new-player state.
   * Does not touch display_name, unit_preference, or any other user setting.
   */
  async resetProgression(userId: string): Promise<User | null> {
    const db = await getDatabase();
    await db.runAsync('UPDATE user SET level = 1, total_xp = 0 WHERE id = ?;', userId);
    return this.getById(userId);
  },
};
