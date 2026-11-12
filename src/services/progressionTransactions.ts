import { getDatabase } from './db';
import { runInTransaction } from './db/transaction';
import { WorkoutRepository } from './workoutRepository';
import { ProgressRepository } from './progressRepository';
import { ChronicleRepository } from './chronicleRepository';
import { UserRepository } from './userRepository';
import { FirstClearRepository } from './firstClearRepository';
import { SyncStateRepository } from './syncStateRepository';
import { enqueueRecord } from './sync/outbox';
import type { Chronicle, MonsterProgress, User, WorkoutResult } from '../models';
import { newUuid } from '../utils/uuid';

/**
 * The multi-table writes that must happen all together or not at all.
 * Each function runs inside ONE SQLite transaction: if any statement
 * throws, every write in it is rolled back and the error propagates to the
 * caller, which must not update in-memory state (see workoutSlice /
 * progressSlice, which only `set()` after these resolve).
 *
 * Repository calls inside the transaction share the app's single database
 * connection (getDatabase is memoized), which is how the transaction
 * includes them. runInTransaction queues transactions on that connection
 * so two of them can never overlap (see db/transaction.ts).
 */

async function inTransaction<T>(work: () => Promise<T>): Promise<T> {
  return runInTransaction(await getDatabase(), work);
}

export interface HuntCompletionWrite {
  /** Must carry its uuid — the first-clear claim references it. */
  result: WorkoutResult & { uuid: string };
  monsterProgress: MonsterProgress;
  chronicle: Chronicle;
  xpGained: number;
  newLevel: number;
  /** Present only when this result is the stage's first clear in the current epoch. 'pending' on account-linked installs (D3). */
  firstClear: { stageKey: string; epoch: number; status?: 'local_final' | 'pending' } | null;
}

/**
 * Hunt completion: workout result + monster progression + Chronicle +
 * XP/level (+ the first-clear claim when one is granted). Returns the
 * updated user row and the origin (this install + its creation order,
 * migration 19) the result was stamped with inside the same transaction.
 */
export async function persistHuntCompletion(
  write: HuntCompletionWrite
): Promise<{ user: User | null; origin: { deviceUuid: string; order: number } }> {
  return inTransaction(async () => {
    const origin = await SyncStateRepository.takeOrigin();
    const result = { ...write.result, originDeviceUuid: origin.deviceUuid, originOrder: origin.order };
    const db = await getDatabase();
    await WorkoutRepository.saveResult(result);
    await enqueueRecord(db, result.userId, 'hunt_result', result.uuid, 'insert');
    if (write.firstClear) {
      await FirstClearRepository.claim(
        result.userId,
        write.firstClear.stageKey,
        write.firstClear.epoch,
        result.uuid,
        result.completedAt,
        write.firstClear.status ?? 'local_final'
      );
      // After the result: the server only accepts a claim whose result it already has.
      await enqueueRecord(db, result.userId, 'first_clear_claim', `${write.firstClear.stageKey}@${write.firstClear.epoch}`, 'insert');
    }
    await ProgressRepository.upsertMonsterProgress(write.monsterProgress);
    await ChronicleRepository.upsert(write.chronicle);
    const user = await UserRepository.addXPAndSetLevel(result.userId, write.xpGained, write.newLevel);
    return { user, origin };
  });
}

async function insertResetLog(entry: {
  uuid: string;
  userId: string;
  scope: 'campaign' | 'monster';
  monsterId: string | null;
  resetAt: string;
  voidedResultCount: number;
  snapshot: unknown;
  /** Migration 19: the epoch in effect when the reset happened. */
  epoch: number;
  /** Campaign reset only: the epoch it starts. */
  toEpoch: number | null;
  /** Monster reset only: the monster's reset count before/after (null when unknown — C1). */
  countBefore: number | null;
  countAfter: number | null;
}): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO progress_reset (uuid, user_id, scope, monster_id, reset_at, voided_result_count, snapshot_json,
       epoch, to_epoch, count_before, count_after)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    entry.uuid,
    entry.userId,
    entry.scope,
    entry.monsterId,
    entry.resetAt,
    entry.voidedResultCount,
    JSON.stringify(entry.snapshot),
    entry.epoch,
    entry.toEpoch,
    entry.countBefore,
    entry.countAfter
  );
  await enqueueRecord(db, entry.userId, 'progress_reset', entry.uuid, 'insert');
}

/**
 * Campaign Reset (Settings). Same visible outcome as before — progress,
 * personal bests, Chronicle and XP/level back to a new-player state — but
 * nothing is deleted:
 * - every active workout_result is voided (kept, with its xp_awarded);
 * - monster/campaign progress rows are zeroed, then the fresh per-monster
 *   rows the caller passes are written (as before);
 * - Chronicle and XP/level are reset, and a new progression epoch starts;
 * - everything that was zeroed is snapshotted into progress_reset first,
 *   so the previous XP, level and Chronicle totals are never lost.
 */
export async function resetCampaignProgressAtomically(input: {
  userId: string;
  freshMonsterProgress: MonsterProgress[];
}): Promise<{ resetUuid: string; voidedResultCount: number; chronicle: Chronicle; user: User | null }> {
  const { userId } = input;
  return inTransaction(async () => {
    const resetUuid = newUuid();
    const resetAt = new Date().toISOString();
    const snapshot = {
      user: await UserRepository.getById(userId),
      chronicle: await ChronicleRepository.getByUserId(userId),
      monsterProgress: await ProgressRepository.getAllMonsterProgress(userId),
      campaignProgress: await ProgressRepository.getAllCampaignProgress(userId),
    };
    const voidedResultCount = await WorkoutRepository.voidAllForUser(userId, resetUuid, resetAt);
    await ProgressRepository.zeroAllMonsterProgress(userId);
    await ProgressRepository.zeroAllCampaignProgress(userId);
    const chronicle = await ChronicleRepository.reset(userId);
    const user = await UserRepository.resetProgression(userId);
    for (const progress of input.freshMonsterProgress) {
      await ProgressRepository.upsertMonsterProgress(progress);
    }
    await insertResetLog({
      uuid: resetUuid,
      userId,
      scope: 'campaign',
      monsterId: null,
      resetAt,
      voidedResultCount,
      snapshot,
      epoch: snapshot.user?.progressionEpoch ?? 0,
      toEpoch: (snapshot.user?.progressionEpoch ?? 0) + 1,
      countBefore: null,
      countAfter: null,
    });
    return { resetUuid, voidedResultCount, chronicle, user };
  });
}

/**
 * Per-monster Reset Progress (Monster Detail). Same visible outcome as
 * before — this monster's encounter history, baseline/targets and progress
 * return to a never-fought state; Chronicle and XP are deliberately left
 * as they were (unchanged behaviour). Its results are voided, not deleted,
 * and the progression epoch does NOT advance, so this monster's
 * first-clear bonus cannot be earned a second time by resetting it.
 */
export async function resetMonsterProgressAtomically(input: {
  userId: string;
  monsterId: string;
  resetProgress: MonsterProgress;
}): Promise<{ resetUuid: string; voidedResultCount: number }> {
  const { userId, monsterId } = input;
  return inTransaction(async () => {
    const resetUuid = newUuid();
    const resetAt = new Date().toISOString();
    const snapshot = { monsterProgress: await ProgressRepository.getMonsterProgress(userId, monsterId) };
    const epoch = (await UserRepository.getById(userId))?.progressionEpoch ?? 0;
    const countBefore = await ProgressRepository.getMonsterResetCount(userId, monsterId, epoch);
    const voidedResultCount = await WorkoutRepository.voidResultsForMonster(userId, monsterId, resetUuid, resetAt);
    await ProgressRepository.upsertMonsterProgress(input.resetProgress);
    await insertResetLog({
      uuid: resetUuid,
      userId,
      scope: 'monster',
      monsterId,
      resetAt,
      voidedResultCount,
      snapshot,
      epoch,
      toEpoch: null,
      countBefore,
      countAfter: countBefore === null ? null : countBefore + 1,
    });
    return { resetUuid, voidedResultCount };
  });
}
