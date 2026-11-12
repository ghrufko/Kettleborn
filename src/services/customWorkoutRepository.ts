import { getDatabase } from './db';
import { runInTransaction } from './db/transaction';
import type { CustomWorkout, CustomWorkoutExercise, CustomWorkoutResult } from '../models';
import { newUuid } from '../utils/uuid';
import { enqueueRecord } from './sync/outbox';

/** Deleted rows (migration 18 deletion markers) are invisible to every read — the same set the UI saw when deletion was physical. */
const NOT_DELETED = 'deleted_at IS NULL';

interface CustomWorkoutRow {
  id: string;
  user_id: string;
  name: string;
  exercises_json: string;
  weight_kg: number;
  weight_b_kg: number | null;
  gear_count: number;
  rounds: number;
  rest_seconds: number;
  created_at: string;
  updated_at: string;
}

function toCustomWorkout(row: CustomWorkoutRow): CustomWorkout {
  return {
    id: row.id,
    name: row.name,
    exercises: JSON.parse(row.exercises_json) as CustomWorkoutExercise[],
    weightKg: row.weight_kg,
    weightBKg: row.weight_b_kg,
    gearCount: row.gear_count === 1 ? 1 : 2,
    rounds: row.rounds,
    restSeconds: row.rest_seconds,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface CustomWorkoutResultRow {
  id: string;
  custom_workout_id: string;
  completed_at: string;
  elapsed_seconds: number;
  weight_kg: number;
  weight_b_kg: number | null;
  gear_count: number;
  user_id: string;
  workout_name: string | null;
  rounds: number | null;
  rest_seconds: number | null;
  total_reps: number | null;
  exercise_breakdown_json: string | null;
}

function toCustomWorkoutResult(row: CustomWorkoutResultRow): CustomWorkoutResult {
  return {
    id: row.id,
    customWorkoutId: row.custom_workout_id,
    completedAt: row.completed_at,
    elapsedSeconds: row.elapsed_seconds,
    weightKg: row.weight_kg,
    weightBKg: row.weight_b_kg,
    gearCount: row.gear_count === 1 ? 1 : 2,
    workoutName: row.workout_name,
    rounds: row.rounds,
    restSeconds: row.rest_seconds,
    totalReps: row.total_reps,
    exerciseBreakdown: row.exercise_breakdown_json ? JSON.parse(row.exercise_breakdown_json) : null,
  };
}

export const CustomWorkoutRepository = {
  async getAll(userId: string): Promise<CustomWorkout[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<CustomWorkoutRow>(
      `SELECT * FROM custom_workout WHERE user_id = ? AND ${NOT_DELETED} ORDER BY updated_at DESC;`,
      userId
    );
    return rows.map(toCustomWorkout);
  },

  async getById(id: string): Promise<CustomWorkout | null> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<CustomWorkoutRow>(
      `SELECT * FROM custom_workout WHERE id = ? AND ${NOT_DELETED};`,
      id
    );
    return row ? toCustomWorkout(row) : null;
  },

  /** A new row gets a fresh uuid; an existing row keeps the one it has (the ON CONFLICT branch never touches uuid). */
  async upsert(userId: string, workout: CustomWorkout): Promise<void> {
    const db = await getDatabase();
    await runInTransaction(db, async () => {
    const existing = await db.getFirstAsync<{ uuid: string }>('SELECT uuid FROM custom_workout WHERE id = ?;', workout.id);
    const uuid = existing?.uuid ?? newUuid();
    await db.runAsync(
      `INSERT INTO custom_workout
        (id, user_id, name, exercises_json, weight_kg, weight_b_kg, gear_count, rounds, rest_seconds, created_at, updated_at, uuid)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         name = excluded.name,
         exercises_json = excluded.exercises_json,
         weight_kg = excluded.weight_kg,
         weight_b_kg = excluded.weight_b_kg,
         gear_count = excluded.gear_count,
         rounds = excluded.rounds,
         rest_seconds = excluded.rest_seconds,
         updated_at = excluded.updated_at;`,
      workout.id,
      userId,
      workout.name,
      JSON.stringify(workout.exercises),
      workout.weightKg,
      workout.weightBKg ?? null,
      workout.gearCount,
      workout.rounds,
      workout.restSeconds,
      workout.createdAt,
      workout.updatedAt,
      uuid
    );
    await enqueueRecord(db, userId, 'custom_workout', uuid, existing ? 'update' : 'insert');
    });
  },

  /**
   * Marks the workout and its results deleted (migration 18) instead of
   * removing them — the UI hides both exactly as before, but completed
   * training history is never physically destroyed. One transaction, so
   * the workout and its results can't end up half-deleted (queued behind
   * any other transaction on the connection — see db/transaction.ts).
   */
  async delete(id: string): Promise<void> {
    const db = await getDatabase();
    const now = new Date().toISOString();
    await runInTransaction(db, async () => {
      const { changes } = await db.runAsync(
        `UPDATE custom_workout SET deleted_at = ?, updated_at = ? WHERE id = ? AND ${NOT_DELETED};`,
        now,
        now,
        id
      );
      // Results' deleted_at is a local cache of the parent's tombstone (D9):
      // only the workout's deletion is queued; results are never re-sent.
      await db.runAsync(
        `UPDATE custom_workout_result SET deleted_at = ? WHERE custom_workout_id = ? AND ${NOT_DELETED};`,
        now,
        id
      );
      const row = await db.getFirstAsync<{ user_id: string; uuid: string }>('SELECT user_id, uuid FROM custom_workout WHERE id = ?;', id);
      if (changes > 0 && row) {
        await enqueueRecord(db, row.user_id, 'custom_workout', row.uuid, 'delete');
      }
    });
  },

  /**
   * Journal integration (§9): userId is now required (migration12 added
   * the column) so results are queryable per-user directly (see
   * getAllForUser) without joining through custom_workout, which a
   * deleted CustomWorkout would break anyway — this table already needs
   * to stand on its own for history purposes.
   */
  async saveResult(userId: string, result: CustomWorkoutResult): Promise<void> {
    const db = await getDatabase();
    const uuid = newUuid();
    await runInTransaction(db, async () => {
    await db.runAsync(
      `INSERT INTO custom_workout_result
        (id, custom_workout_id, completed_at, elapsed_seconds, weight_kg, weight_b_kg, gear_count,
         user_id, workout_name, rounds, rest_seconds, total_reps, exercise_breakdown_json, uuid, custom_workout_uuid)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
               (SELECT w.uuid FROM custom_workout w WHERE w.id = ?));`,
      result.id,
      result.customWorkoutId,
      result.completedAt,
      result.elapsedSeconds,
      result.weightKg,
      result.weightBKg ?? null,
      result.gearCount,
      userId,
      result.workoutName,
      result.rounds,
      result.restSeconds,
      result.totalReps,
      result.exerciseBreakdown ? JSON.stringify(result.exerciseBreakdown) : null,
      uuid,
      result.customWorkoutId
    );
    await enqueueRecord(db, userId, 'custom_workout_result', uuid, 'insert');
    });
  },

  async getResultsFor(customWorkoutId: string): Promise<CustomWorkoutResult[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<CustomWorkoutResultRow>(
      `SELECT * FROM custom_workout_result WHERE custom_workout_id = ? AND ${NOT_DELETED} ORDER BY completed_at DESC;`,
      customWorkoutId
    );
    return rows.map(toCustomWorkoutResult);
  },

  /** Journal integration (§9): every Custom Workout result for this user, newest first — for the Journal/Statistics "Training Sessions" list. Never joined with monster/Hunt data; this table has no notion of either. */
  async getAllForUser(userId: string): Promise<CustomWorkoutResult[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<CustomWorkoutResultRow>(
      `SELECT * FROM custom_workout_result WHERE user_id = ? AND ${NOT_DELETED} ORDER BY completed_at DESC;`,
      userId
    );
    return rows.map(toCustomWorkoutResult);
  },
};
