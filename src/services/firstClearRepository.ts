import { getDatabase } from './db';

/**
 * A "progression stage" for first-clear purposes is a workoutId — the same
 * scope today's rule already used (the bonus went to the first result in a
 * workoutId's history, shared by that monster's Level 1/2/3 encounters).
 * Prefixed so other stage kinds can be added later without colliding.
 */
export function firstClearStageKey(workoutId: string): string {
  return `workout:${workoutId}`;
}

/**
 * first_clear_claim (migration 18): at most one row per (player, stage,
 * progression epoch), enforced by its PRIMARY KEY. A row means "this
 * stage's first-clear bonus has been granted in this epoch, to this
 * result". A future Supabase table with the same key enforces the same
 * rule across devices: the second device's claim is rejected, and its
 * result's recorded firstClearBonusXp is the exact amount to reconcile.
 */
export const FirstClearRepository = {
  async hasClaim(userId: string, stageKey: string, epoch: number): Promise<boolean> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<{ found: number }>(
      'SELECT 1 AS found FROM first_clear_claim WHERE user_id = ? AND stage_key = ? AND epoch = ?;',
      userId,
      stageKey,
      epoch
    );
    return row !== null;
  },

  /**
   * Plain INSERT, deliberately not INSERT OR IGNORE: called inside the
   * hunt-completion transaction, so if a claim somehow already exists the
   * constraint error rolls the whole completion back rather than letting a
   * second bonus through.
   */
  async claim(
    userId: string,
    stageKey: string,
    epoch: number,
    resultUuid: string,
    claimedAt: string,
    status: 'local_final' | 'pending' = 'local_final'
  ): Promise<void> {
    const db = await getDatabase();
    await db.runAsync(
      'INSERT INTO first_clear_claim (user_id, stage_key, epoch, result_uuid, claimed_at, status) VALUES (?, ?, ?, ?, ?, ?);',
      userId,
      stageKey,
      epoch,
      resultUuid,
      claimedAt,
      status
    );
  },
};
