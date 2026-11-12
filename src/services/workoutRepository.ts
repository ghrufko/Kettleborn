import { getDatabase } from './db';
import type { WorkoutResult } from '../models';
import { newUuid } from '../utils/uuid';
import { runInTransaction } from './db/transaction';
import { enqueue } from './sync/outbox';

/**
 * Every read used for progression, personal bests, encounter locks and the
 * existing history screens excludes voided rows — exactly the set of rows
 * those screens saw before resets stopped deleting. Voided rows are only
 * returned by getAllResultsIncludingVoided().
 */
const ACTIVE = 'voided_at IS NULL';

interface WorkoutResultRow {
  id: string;
  uuid: string | null;
  updated_at: string | null;
  voided_at: string | null;
  void_reset_uuid: string | null;
  first_clear_bonus_xp: number | null;
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
  extra_sets_json: string | null;
  progression_epoch: number | null;
  monster_reset_count: number | null;
  volume_kg: number | null;
  training_minutes: number | null;
  streak_after: number | null;
  tz_offset_minutes: number | null;
  origin_device_uuid: string | null;
  origin_order: number | null;
  pr_bonus_xp: number | null;
  repeat_multiplier: number | null;
  prior_clears_seen: number | null;
}

function toWorkoutResult(row: WorkoutResultRow): WorkoutResult {
  return {
    id: row.id,
    uuid: row.uuid ?? undefined,
    firstClearBonusXp: row.first_clear_bonus_xp,
    voidedAt: row.voided_at,
    progressionEpoch: row.progression_epoch,
    monsterResetCount: row.monster_reset_count,
    volumeKg: row.volume_kg,
    trainingMinutes: row.training_minutes,
    streakAfter: row.streak_after,
    tzOffsetMinutes: row.tz_offset_minutes,
    originDeviceUuid: row.origin_device_uuid,
    originOrder: row.origin_order,
    prBonusXp: row.pr_bonus_xp,
    repeatMultiplier: row.repeat_multiplier,
    priorClearsSeen: row.prior_clears_seen,
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
    extraSets: row.extra_sets_json ? JSON.parse(row.extra_sets_json) : null,
  };
}

/**
 * RPE / notes edit: the field and its upload-queue entry (Cloud Save P5,
 * inactive until sync is enabled) in one transaction. Never called from
 * inside another transaction (runInTransaction is not re-entrant).
 */
async function updateResultField(resultId: string, field: 'rpe' | 'notes', value: number | string | null): Promise<void> {
  const db = await getDatabase();
  await runInTransaction(db, async () => {
    await db.runAsync(
      `UPDATE workout_result SET ${field} = ?, updated_at = ? WHERE id = ?;`,
      value,
      new Date().toISOString(),
      resultId
    );
    const row = await db.getFirstAsync<{ uuid: string }>('SELECT uuid FROM workout_result WHERE id = ?;', resultId);
    if (row) {
      await enqueue(db, { entityType: 'hunt_result', entityKey: row.uuid, field, op: 'update', payload: { value } });
    }
  });
}

export const WorkoutRepository = {
  async saveResult(result: WorkoutResult): Promise<void> {
    const db = await getDatabase();
    await db.runAsync(
      `INSERT INTO workout_result
        (id, user_id, workout_id, monster_id, hunt_id, completed_at, time_minutes, time_seconds,
         weight_value_a, weight_value_b, weight_unit, notes, xp_awarded, difficulty, app_version, rung_times_json, rpe, is_custom_hunt,
         rest_seconds_used, structural_value_used, reps_overrides_used_json, extra_sets_json,
         uuid, updated_at, first_clear_bonus_xp,
         progression_epoch, monster_reset_count, volume_kg, training_minutes, streak_after, tz_offset_minutes,
         origin_device_uuid, origin_order, pr_bonus_xp, repeat_multiplier, prior_clears_seen)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
               ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
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
      result.repsOverridesUsed ? JSON.stringify(result.repsOverridesUsed) : null,
      result.extraSets && result.extraSets.length > 0 ? JSON.stringify(result.extraSets) : null,
      result.uuid ?? newUuid(),
      result.completedAt,
      result.firstClearBonusXp ?? 0,
      result.progressionEpoch ?? null,
      result.monsterResetCount ?? null,
      result.volumeKg ?? null,
      result.trainingMinutes ?? null,
      result.streakAfter ?? null,
      result.tzOffsetMinutes ?? null,
      result.originDeviceUuid ?? null,
      result.originOrder ?? null,
      result.prBonusXp ?? null,
      result.repeatMultiplier ?? null,
      result.priorClearsSeen ?? null
    );
  },

  /** Post-Hunt RPE, set after the row already exists — see WorkoutResult.rpe. */
  async updateRPE(resultId: string, rpe: number): Promise<void> {
    await updateResultField(resultId, 'rpe', rpe);
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
    await updateResultField(resultId, 'notes', notes);
  },

  async getResultsForUser(userId: string): Promise<WorkoutResult[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<WorkoutResultRow>(
      `SELECT * FROM workout_result WHERE user_id = ? AND ${ACTIVE} ORDER BY completed_at DESC;`,
      userId
    );
    return rows.map(toWorkoutResult);
  },

  /**
   * Full history, including results a progress reset voided — for future
   * sync and any historical-records view. Nothing in the current UI calls
   * it, so the current screens look exactly as they did when resets
   * deleted.
   */
  async getAllResultsIncludingVoided(userId: string): Promise<WorkoutResult[]> {
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
      `SELECT * FROM workout_result WHERE user_id = ? AND workout_id = ? AND ${ACTIVE} ORDER BY completed_at DESC;`,
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
      `SELECT * FROM workout_result WHERE user_id = ? AND hunt_id = ? AND ${ACTIVE} ORDER BY completed_at DESC;`,
      userId,
      huntId
    );
    return rows.map(toWorkoutResult);
  },

  /**
   * Campaign Reset (Settings): voids — never deletes — every active result
   * for the user. Personal bests are derived only from active results, so
   * they clear exactly as before; the rows themselves, with their
   * xp_awarded, stay in the database tagged with the reset that voided
   * them. Returns how many rows were voided.
   */
  async voidAllForUser(userId: string, resetUuid: string, voidedAt: string): Promise<number> {
    const db = await getDatabase();
    const { changes } = await db.runAsync(
      `UPDATE workout_result SET voided_at = ?, void_reset_uuid = ?, updated_at = ?
       WHERE user_id = ? AND ${ACTIVE};`,
      voidedAt,
      resetUuid,
      voidedAt,
      userId
    );
    return changes;
  },

  /**
   * Reset Progress (per-monster): voids this one monster's active results
   * only — scoped by monster_id, so no other monster's history, Custom
   * Workout results or Timer results are touched. Returns how many rows
   * were voided.
   */
  async voidResultsForMonster(userId: string, monsterId: string, resetUuid: string, voidedAt: string): Promise<number> {
    const db = await getDatabase();
    const { changes } = await db.runAsync(
      `UPDATE workout_result SET voided_at = ?, void_reset_uuid = ?, updated_at = ?
       WHERE user_id = ? AND monster_id = ? AND ${ACTIVE};`,
      voidedAt,
      resetUuid,
      voidedAt,
      userId,
      monsterId
    );
    return changes;
  },
};
