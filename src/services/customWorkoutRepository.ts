import { getDatabase } from './db';
import { CustomWorkout, CustomWorkoutExercise, CustomWorkoutResult } from '../models';

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
      'SELECT * FROM custom_workout WHERE user_id = ? ORDER BY updated_at DESC;',
      userId
    );
    return rows.map(toCustomWorkout);
  },

  async getById(id: string): Promise<CustomWorkout | null> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<CustomWorkoutRow>('SELECT * FROM custom_workout WHERE id = ?;', id);
    return row ? toCustomWorkout(row) : null;
  },

  async upsert(userId: string, workout: CustomWorkout): Promise<void> {
    const db = await getDatabase();
    await db.runAsync(
      `INSERT INTO custom_workout
        (id, user_id, name, exercises_json, weight_kg, weight_b_kg, gear_count, rounds, rest_seconds, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      workout.updatedAt
    );
  },

  async delete(id: string): Promise<void> {
    const db = await getDatabase();
    await db.runAsync('DELETE FROM custom_workout WHERE id = ?;', id);
    await db.runAsync('DELETE FROM custom_workout_result WHERE custom_workout_id = ?;', id);
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
    await db.runAsync(
      `INSERT INTO custom_workout_result
        (id, custom_workout_id, completed_at, elapsed_seconds, weight_kg, weight_b_kg, gear_count,
         user_id, workout_name, rounds, rest_seconds, total_reps, exercise_breakdown_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
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
      result.exerciseBreakdown ? JSON.stringify(result.exerciseBreakdown) : null
    );
  },

  async getResultsFor(customWorkoutId: string): Promise<CustomWorkoutResult[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<CustomWorkoutResultRow>(
      'SELECT * FROM custom_workout_result WHERE custom_workout_id = ? ORDER BY completed_at DESC;',
      customWorkoutId
    );
    return rows.map(toCustomWorkoutResult);
  },

  /** Journal integration (§9): every Custom Workout result for this user, newest first — for the Journal/Statistics "Training Sessions" list. Never joined with monster/Hunt data; this table has no notion of either. */
  async getAllForUser(userId: string): Promise<CustomWorkoutResult[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<CustomWorkoutResultRow>(
      'SELECT * FROM custom_workout_result WHERE user_id = ? ORDER BY completed_at DESC;',
      userId
    );
    return rows.map(toCustomWorkoutResult);
  },
};
