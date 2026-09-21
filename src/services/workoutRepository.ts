import { getDatabase } from './db';
import { WorkoutResult } from '../models';

interface WorkoutResultRow {
  id: string;
  user_id: string;
  workout_id: string;
  monster_id: string;
  hunt_id: string;
  completed_at: string;
  time_minutes: number;
  time_seconds: number;
  weight_value_a: number;
  weight_value_b: number | null;
  weight_unit: string;
  notes: string | null;
  xp_awarded: number;
  difficulty: number;
  app_version: string;
  rung_times_json: string | null;
  rpe: number | null;
  is_custom_hunt: number;
  rest_seconds_used: number | null;
  structural_value_used: number | null;
  reps_overrides_used_json: string | null;
}

function toWorkoutResult(row: WorkoutResultRow): WorkoutResult {
  return {
    id: row.id,
    userId: row.user_id,
    workoutId: row.workout_id,
    monsterId: row.monster_id,
    huntId: row.hunt_id,
    completedAt: row.completed_at,
    timeMinutes: row.time_minutes,
    timeSeconds: row.time_seconds,
    weightValueA: row.weight_value_a,
    weightValueB: row.weight_value_b,
    weightUnit: row.weight_unit === 'lb' ? 'lb' : 'kg',
    notes: row.notes,
    xpAwarded: row.xp_awarded,
    difficulty: row.difficulty,
    appVersion: row.app_version,
    rungLaps: row.rung_times_json ? JSON.parse(row.rung_times_json) : null,
    rpe: row.rpe,
    isCustomHunt: row.is_custom_hunt === 1,
    restSecondsUsed: row.rest_seconds_used,
    structuralValueUsed: row.structural_value_used,
    repsOverridesUsed: row.reps_overrides_used_json ? JSON.parse(row.reps_overrides_used_json) : null,
  };
}

export const WorkoutRepository = {
  async saveResult(result: WorkoutResult): Promise<void> {
    const db = await getDatabase();
    await db.runAsync(
      `INSERT INTO workout_result
        (id, user_id, workout_id, monster_id, hunt_id, completed_at, time_minutes, time_seconds,
         weight_value_a, weight_value_b, weight_unit, notes, xp_awarded, difficulty, app_version, rung_times_json, rpe, is_custom_hunt,
         rest_seconds_used, structural_value_used, reps_overrides_used_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      result.id,
      result.userId,
      result.workoutId,
      result.monsterId,
      result.huntId,
      result.completedAt,
      result.timeMinutes,
      result.timeSeconds,
      result.weightValueA,
      result.weightValueB,
      result.weightUnit,
      result.notes,
      result.xpAwarded,
      result.difficulty,
      result.appVersion,
      result.rungLaps ? JSON.stringify(result.rungLaps) : null,
      result.rpe,
      result.isCustomHunt ? 1 : 0,
      result.restSecondsUsed,
      result.structuralValueUsed,
      result.repsOverridesUsed ? JSON.stringify(result.repsOverridesUsed) : null
    );
  },

  /** Post-Hunt RPE, set after the row already exists — see WorkoutResult.rpe. */
  async updateRPE(resultId: string, rpe: number): Promise<void> {
    const db = await getDatabase();
    await db.runAsync('UPDATE workout_result SET rpe = ? WHERE id = ?;', rpe, resultId);
  },

  /**
   * Task 10 (Training Notes): mirrors updateRPE exactly — set after the
   * row already exists, once the player has actually seen their result
   * on the Hunt Complete screen. The `notes` column already existed
   * (migration 1) and was already read/written by saveResult/
   * toWorkoutResult; it just had no UI writing anything into it until
   * now. No new migration needed. Pass null (not '') to clear/skip a
   * note — optional by construction.
   */
  async updateNotes(resultId: string, notes: string | null): Promise<void> {
    const db = await getDatabase();
    await db.runAsync('UPDATE workout_result SET notes = ? WHERE id = ?;', notes, resultId);
  },

  async getResultsForUser(userId: string): Promise<WorkoutResult[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<WorkoutResultRow>(
      'SELECT * FROM workout_result WHERE user_id = ? ORDER BY completed_at DESC;',
      userId
    );
    return rows.map(toWorkoutResult);
  },

  async getResultsForWorkout(userId: string, workoutId: string): Promise<WorkoutResult[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<WorkoutResultRow>(
      'SELECT * FROM workout_result WHERE user_id = ? AND workout_id = ? ORDER BY completed_at DESC;',
      userId,
      workoutId
    );
    return rows.map(toWorkoutResult);
  },

  /**
   * Encounter Lock: results for one specific Hunt (encounter), not just a
   * shared workoutId — needed because a monster's Level 1/2/3 share one
   * workoutId but are distinct encounters with their own result history.
   * Same shape/ordering as getResultsForWorkout.
   */
  async getResultsForHunt(userId: string, huntId: string): Promise<WorkoutResult[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<WorkoutResultRow>(
      'SELECT * FROM workout_result WHERE user_id = ? AND hunt_id = ? ORDER BY completed_at DESC;',
      userId,
      huntId
    );
    return rows.map(toWorkoutResult);
  },

  /**
   * Campaign Reset (Settings): wipes workout history for the user — this is
   * the sole source Personal Best times are derived from (see
   * workoutSlice.getBestTimeSeconds), so clearing it clears PBs too.
   */
  async deleteAllForUser(userId: string): Promise<void> {
    const db = await getDatabase();
    await db.runAsync('DELETE FROM workout_result WHERE user_id = ?;', userId);
  },

  /**
   * Reset Progress (per-monster): wipes this one monster's Encounter
   * results only — every WorkoutResult row is already scoped by
   * monster_id (set at save time from the Hunt it belongs to), so this
   * can't touch any other monster's history, Custom Workout results
   * (a fully separate table, see migration10), or Timer results.
   */
  async deleteResultsForMonster(userId: string, monsterId: string): Promise<void> {
    const db = await getDatabase();
    await db.runAsync(
      'DELETE FROM workout_result WHERE user_id = ? AND monster_id = ?;',
      userId,
      monsterId
    );
  },
};
