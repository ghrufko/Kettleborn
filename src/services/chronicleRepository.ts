import { getDatabase } from './db';
import { Chronicle } from '../models';

interface ChronicleRow {
  user_id: string;
  total_workouts: number;
  total_hunts_completed: number;
  total_monsters_defeated: number;
  total_volume_kg: number;
  total_training_minutes: number;
  longest_streak_days: number;
  current_streak_days: number;
  updated_at: string;
}

function toChronicle(row: ChronicleRow): Chronicle {
  return {
    userId: row.user_id,
    totalWorkouts: row.total_workouts,
    totalHuntsCompleted: row.total_hunts_completed,
    totalMonstersDefeated: row.total_monsters_defeated,
    totalVolumeKg: row.total_volume_kg,
    totalTrainingMinutes: row.total_training_minutes,
    longestStreakDays: row.longest_streak_days,
    currentStreakDays: row.current_streak_days,
    updatedAt: row.updated_at,
  };
}

function emptyChronicle(userId: string): Chronicle {
  return {
    userId,
    totalWorkouts: 0,
    totalHuntsCompleted: 0,
    totalMonstersDefeated: 0,
    totalVolumeKg: 0,
    totalTrainingMinutes: 0,
    longestStreakDays: 0,
    currentStreakDays: 0,
    updatedAt: new Date().toISOString(),
  };
}

export const ChronicleRepository = {
  async getByUserId(userId: string): Promise<Chronicle | null> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<ChronicleRow>(
      'SELECT * FROM chronicle WHERE user_id = ?;',
      userId
    );
    return row ? toChronicle(row) : null;
  },

  async createIfNotExists(userId: string): Promise<Chronicle> {
    const existing = await this.getByUserId(userId);
    if (existing) {
      return existing;
    }
    const chronicle = emptyChronicle(userId);
    await this.upsert(chronicle);
    return chronicle;
  },

  async upsert(chronicle: Chronicle): Promise<void> {
    const db = await getDatabase();
    await db.runAsync(
      `INSERT INTO chronicle
        (user_id, total_workouts, total_hunts_completed, total_monsters_defeated,
         total_volume_kg, total_training_minutes, longest_streak_days, current_streak_days, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET
         total_workouts = excluded.total_workouts,
         total_hunts_completed = excluded.total_hunts_completed,
         total_monsters_defeated = excluded.total_monsters_defeated,
         total_volume_kg = excluded.total_volume_kg,
         total_training_minutes = excluded.total_training_minutes,
         longest_streak_days = excluded.longest_streak_days,
         current_streak_days = excluded.current_streak_days,
         updated_at = excluded.updated_at;`,
      chronicle.userId,
      chronicle.totalWorkouts,
      chronicle.totalHuntsCompleted,
      chronicle.totalMonstersDefeated,
      chronicle.totalVolumeKg,
      chronicle.totalTrainingMinutes,
      chronicle.longestStreakDays,
      chronicle.currentStreakDays,
      chronicle.updatedAt
    );
  },

  /** Campaign Reset (Settings): returns lifetime stats/streaks to zero. */
  async reset(userId: string): Promise<Chronicle> {
    const chronicle = emptyChronicle(userId);
    await this.upsert(chronicle);
    return chronicle;
  },
};
