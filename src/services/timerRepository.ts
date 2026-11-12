import { getDatabase } from './db';
import type { TimerPreset, TimerResult, TimerRound } from '../models';
import { newUuid } from '../utils/uuid';
import { runInTransaction } from './db/transaction';
import { enqueueRecord } from './sync/outbox';

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
      'SELECT * FROM timer_preset WHERE user_id = ? AND deleted_at IS NULL ORDER BY created_at DESC;',
      userId
    );
    return rows.map(toTimerPreset);
  },

  /** New rows get a fresh uuid; an update keeps the existing one and stamps updated_at. */
  async savePreset(userId: string, preset: Omit<TimerPreset, 'isBuiltIn'>): Promise<void> {
    const db = await getDatabase();
    const now = new Date().toISOString();
    await runInTransaction(db, async () => {
    const existing = await db.getFirstAsync<{ uuid: string }>('SELECT uuid FROM timer_preset WHERE id = ?;', preset.id);
    const uuid = existing?.uuid ?? newUuid();
    await db.runAsync(
      `INSERT INTO timer_preset
        (id, user_id, name, rounds_json, created_at, linked_workout_id, randomize_exercises, uuid, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         name = excluded.name,
         rounds_json = excluded.rounds_json,
         linked_workout_id = excluded.linked_workout_id,
         randomize_exercises = excluded.randomize_exercises,
         updated_at = excluded.updated_at;`,
      preset.id,
      userId,
      preset.name,
      JSON.stringify(preset.rounds),
      now,
      preset.linkedWorkoutId ?? null,
      preset.randomizeExercises ? 1 : 0,
      uuid,
      now
    );
    await enqueueRecord(db, userId, 'timer_preset', uuid, existing ? 'update' : 'insert');
    });
  },

  /** Marks the preset deleted (migration 18) rather than removing it; timer results that reference it are untouched, as before. */
  async deletePreset(presetId: string): Promise<void> {
    const db = await getDatabase();
    const now = new Date().toISOString();
    await runInTransaction(db, async () => {
      const { changes } = await db.runAsync(
        'UPDATE timer_preset SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL;',
        now,
        now,
        presetId
      );
      const row = await db.getFirstAsync<{ user_id: string; uuid: string }>('SELECT user_id, uuid FROM timer_preset WHERE id = ?;', presetId);
      if (changes > 0 && row) {
        await enqueueRecord(db, row.user_id, 'timer_preset', row.uuid, 'delete');
      }
    });
  },

  async saveResult(result: TimerResult): Promise<void> {
    const db = await getDatabase();
    const uuid = newUuid();
    await runInTransaction(db, async () => {
    await db.runAsync(
      `INSERT INTO timer_result
        (id, user_id, preset_id, preset_name, total_duration_seconds, completed_at, weight_kg, app_version, uuid, preset_uuid)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT p.uuid FROM timer_preset p WHERE p.id = ?));`,
      result.id,
      result.userId,
      result.presetId,
      result.presetName,
      result.totalDurationSeconds,
      result.completedAt,
      result.weightKg,
      result.appVersion,
      uuid,
      result.presetId
    );
    await enqueueRecord(db, result.userId, 'timer_result', uuid, 'insert');
    });
  },
};
