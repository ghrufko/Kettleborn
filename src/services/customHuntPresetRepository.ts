import { getDatabase } from './db';
import { runInTransaction } from './db/transaction';
import { enqueueRecord } from './sync/outbox';
import type { CustomHuntPreset } from '../models';

interface CustomHuntPresetRow {
  user_id: string;
  workout_id: string;
  weight_kg: number;
  weight_b_kg: number | null;
  gear_count: number;
  rest_seconds: number;
  custom_structure_value: number | null;
  reps_overrides_json: string | null;
  updated_at: string;
}

function toCustomHuntPreset(row: CustomHuntPresetRow): CustomHuntPreset {
  return {
    userId: row.user_id,
    workoutId: row.workout_id,
    weightKg: row.weight_kg,
    weightBKg: row.weight_b_kg,
    gearCount: row.gear_count === 1 ? 1 : 2,
    restSeconds: row.rest_seconds,
    customStructureValue: row.custom_structure_value,
    repsOverrides: row.reps_overrides_json ? JSON.parse(row.reps_overrides_json) : null,
    updatedAt: row.updated_at,
  };
}

export const CustomHuntPresetRepository = {
  async getByWorkoutId(userId: string, workoutId: string): Promise<CustomHuntPreset | null> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<CustomHuntPresetRow>(
      'SELECT * FROM custom_hunt_preset WHERE user_id = ? AND workout_id = ?;',
      userId,
      workoutId
    );
    return row ? toCustomHuntPreset(row) : null;
  },

  async upsert(preset: CustomHuntPreset): Promise<void> {
    const db = await getDatabase();
    await runInTransaction(db, async () => {
    const existing = await db.getFirstAsync<{ found: number }>(
      'SELECT 1 AS found FROM custom_hunt_preset WHERE user_id = ? AND workout_id = ?;',
      preset.userId,
      preset.workoutId
    );
    await db.runAsync(
      `INSERT INTO custom_hunt_preset
        (user_id, workout_id, weight_kg, weight_b_kg, gear_count, rest_seconds, custom_structure_value, reps_overrides_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id, workout_id) DO UPDATE SET
         weight_kg = excluded.weight_kg,
         weight_b_kg = excluded.weight_b_kg,
         gear_count = excluded.gear_count,
         rest_seconds = excluded.rest_seconds,
         custom_structure_value = excluded.custom_structure_value,
         reps_overrides_json = excluded.reps_overrides_json,
         updated_at = excluded.updated_at;`,
      preset.userId,
      preset.workoutId,
      preset.weightKg,
      preset.weightBKg ?? null,
      preset.gearCount,
      preset.restSeconds,
      preset.customStructureValue ?? null,
      preset.repsOverrides && Object.keys(preset.repsOverrides).length > 0
        ? JSON.stringify(preset.repsOverrides)
        : null,
      preset.updatedAt
    );
    await enqueueRecord(db, preset.userId, 'custom_hunt_preset', preset.workoutId, existing ? 'update' : 'insert');
    });
  },
};
