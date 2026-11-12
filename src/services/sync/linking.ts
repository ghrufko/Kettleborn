import type { QueueConnection } from './outbox';
import type { SyncTransport } from './engine';

/**
 * Cloud Save P8 — what happens when a signed-in account meets this install
 * (decisions D4, D10). Sync never deletes or replaces local progress.
 *
 * - resume:        this install already belongs to this account.
 * - other_account: it belongs to a different account → no sync.
 * - blocked:       its history could not be reconstructed (C1) → no sync.
 * - offer_link:    account empty, device has progress → ask to back it up.
 * - auto_link:     both empty → link quietly (nothing to lose either way).
 * - offer_restore: device has no progress, account has data → ask to restore.
 * - refused:       both have progress → they can't be combined; no sync.
 */
export type LinkDecision = 'resume' | 'other_account' | 'blocked' | 'offer_link' | 'auto_link' | 'offer_restore' | 'refused';

/** Tables whose rows mean "this install has progress" (default bells and settings don't). */
const PROGRESS_TABLES = [
  'progress_baseline',
  'workout_result',
  'custom_workout',
  'custom_workout_result',
  'timer_preset',
  'timer_result',
  'stopwatch_result',
  'achievement',
  'custom_hunt_preset',
  'progress_reset',
];

export async function localHasProgress(db: QueueConnection, userId: string): Promise<boolean> {
  for (const table of PROGRESS_TABLES) {
    const row = await db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?;`, userId);
    if ((row?.n ?? 0) > 0) return true;
  }
  return false;
}

export async function decideLink(
  db: QueueConnection,
  transport: SyncTransport,
  userId: string,
  authUserId: string
): Promise<LinkDecision> {
  const state = await db.getFirstAsync<{ linked_user_id: string | null; sync_blocked_reason: string | null }>(
    'SELECT linked_user_id, sync_blocked_reason FROM sync_state WHERE id = 1;'
  );
  if (!state) throw new Error('sync_state row missing');
  if (state.linked_user_id === authUserId) return 'resume';
  if (state.linked_user_id !== null) return 'other_account';
  if (state.sync_blocked_reason !== null) return 'blocked';
  const local = await localHasProgress(db, userId);
  const remote = (await transport.accountStatus()).has_data;
  if (!remote) return local ? 'offer_link' : 'auto_link';
  return local ? 'refused' : 'offer_restore';
}
