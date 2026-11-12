import { getDatabase } from '../db';
import type { BaselineFacts, ClaimStatus, ProjectionInput, ResetFact, ResultFact } from './rebuild';

/** Reads everything rebuildTotals needs for one player from SQLite. Read-only. */
export async function loadProjectionInput(
  userId: string,
  huntsTotalByMonster: Record<string, number>
): Promise<ProjectionInput> {
  const db = await getDatabase();
  const user = await db.getFirstAsync<{ progression_epoch: number }>('SELECT progression_epoch FROM user WHERE id = ?;', userId);

  const b = await db.getFirstAsync<any>('SELECT * FROM progress_baseline WHERE user_id = ?;', userId);
  let baseline: BaselineFacts | null = null;
  if (b) {
    const monsters = await db.getAllAsync<any>('SELECT * FROM progress_baseline_monster WHERE baseline_uuid = ?;', b.uuid);
    baseline = {
      uuid: b.uuid,
      originDeviceUuid: b.origin_device_uuid,
      epoch: b.epoch,
      totalXP: b.total_xp,
      level: b.level,
      totalWorkouts: b.total_workouts,
      totalHuntsCompleted: b.total_hunts_completed,
      totalMonstersDefeated: b.total_monsters_defeated,
      totalVolumeKg: b.total_volume_kg,
      totalTrainingMinutes: b.total_training_minutes,
      currentStreakDays: b.current_streak_days,
      longestStreakDays: b.longest_streak_days,
      chronicleUpdatedAt: b.chronicle_updated_at,
      monsters: Object.fromEntries(
        monsters.map((m: any) => [
          m.monster_id,
          {
            huntsCompleted: m.hunts_completed,
            huntsTotal: m.hunts_total,
            defeated: m.defeated === 1,
            monsterResetCount: m.monster_reset_count,
          },
        ])
      ),
    };
  }

  const results: ResultFact[] = (
    await db.getAllAsync<any>('SELECT * FROM workout_result WHERE user_id = ?;', userId)
  ).map((r: any) => ({
    uuid: r.uuid,
    monsterId: r.monster_id,
    workoutId: r.workout_id,
    completedAt: r.completed_at,
    xpAwarded: r.xp_awarded,
    firstClearBonusXp: r.first_clear_bonus_xp,
    progressionEpoch: r.progression_epoch,
    monsterResetCount: r.monster_reset_count,
    volumeKg: r.volume_kg,
    trainingMinutes: r.training_minutes,
    streakAfter: r.streak_after,
    originDeviceUuid: r.origin_device_uuid,
    originOrder: r.origin_order,
  }));

  const resets: ResetFact[] = (
    await db.getAllAsync<any>('SELECT scope, monster_id, epoch, count_after FROM progress_reset WHERE user_id = ?;', userId)
  ).map((r: any) => ({ scope: r.scope, monsterId: r.monster_id, epoch: r.epoch, countAfter: r.count_after }));

  const claims = await db.getAllAsync<any>(
    'SELECT stage_key, epoch, result_uuid, status FROM first_clear_claim WHERE user_id = ?;',
    userId
  );
  const claimStatusByResult: Record<string, ClaimStatus> = Object.fromEntries(
    claims.map((c: any) => [c.result_uuid, c.status as ClaimStatus])
  );
  const claimsByStage = Object.fromEntries(
    claims.map((c: any) => [`${c.stage_key}@${c.epoch}`, { resultUuid: c.result_uuid, status: c.status as ClaimStatus }])
  );

  return {
    currentEpoch: user?.progression_epoch ?? 0,
    baseline,
    results,
    resets,
    claimStatusByResult,
    claimsByStage,
    huntsTotalByMonster,
  };
}
