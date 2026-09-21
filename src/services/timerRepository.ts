import { getDatabase } from './db';
import { TimerPreset, TimerResult, TimerRound } from '../models';

interface TimerPresetRow {
  id: string;
  user_id: string;
  name: string;
  rounds_json: string;
  created_at: string;
  linked_workout_id: string | null;
  randomize_exercises: number;
}

interface TimerResultRow {
  id: string;
  user_id: string;
  preset_id: string;
  preset_name: string;
  total_duration_seconds: number;
  completed_at: string;
  weight_kg: number | null;
  app_version: string;
}

function toTimerPreset(row: TimerPresetRow): TimerPreset {
  return {
    id: row.id,
    name: row.name,
    rounds: JSON.parse(row.rounds_json) as TimerRound[],
    isBuiltIn: false,
    linkedWorkoutId: row.linked_workout_id ?? undefined,
    randomizeExercises: row.randomize_exercises === 1,
  };
}

function toTimerResult(row: TimerResultRow): TimerResult {
  return {
    id: row.id,
    userId: row.user_id,
    presetId: row.preset_id,
    presetName: row.preset_name,
    totalDurationSeconds: row.total_duration_seconds,
    completedAt: row.completed_at,
    weightKg: row.weight_kg,
    appVersion: row.app_version,
  };
}

export const TimerRepository = {
  async getPresetsForUser(userId: string): Promise<TimerPreset[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<TimerPresetRow>(
      'SELECT * FROM timer_preset WHERE user_id = ? ORDER BY created_at DESC;',
      userId
    );
    return rows.map(toTimerPreset);
  },

  async savePreset(userId: string, preset: Omit<TimerPreset, 'isBuiltIn'>): Promise<void> {
    const db = await getDatabase();
    await db.runAsync(
      `INSERT INTO timer_preset (id, user_id, name, rounds_json, created_at, linked_workout_id, randomize_exercises)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         name = excluded.name,
         rounds_json = excluded.rounds_json,
         linked_workout_id = excluded.linked_workout_id,
         randomize_exercises = excluded.randomize_exercises;`,
      preset.id,
      userId,
      preset.name,
      JSON.stringify(preset.rounds),
      new Date().toISOString(),
      preset.linkedWorkoutId ?? null,
      preset.randomizeExercises ? 1 : 0
    );
  },

  async deletePreset(presetId: string): Promise<void> {
    const db = await getDatabase();
    await db.runAsync('DELETE FROM timer_preset WHERE id = ?;', presetId);
  },

  async saveResult(result: TimerResult): Promise<void> {
    const db = await getDatabase();
    await db.runAsync(
      `INSERT INTO timer_result
        (id, user_id, preset_id, preset_name, total_duration_seconds, completed_at, weight_kg, app_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
      result.id,
      result.userId,
      result.presetId,
      result.presetName,
      result.totalDurationSeconds,
      result.completedAt,
      result.weightKg,
      result.appVersion
    );
  },
};
