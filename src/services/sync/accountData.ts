import { runInTransaction } from '../db/transaction';
import { RECORD_TYPES, SEED_ORDER } from './recordTypes';
import { encodeRow } from './encoding';
import type { QueueConnection } from './outbox';
import { writeStoredTotals } from './apply';

/**
 * Cloud Save P10 — the player's own data: export, and what this install
 * does after its cloud account is deleted. Local progress is never deleted.
 */

/** Everything this install holds for the player, as JSON: every synced record (deleted and voided ones included), the totals, and this device's settings. */
export async function buildDataExport(db: QueueConnection, userId: string) {
  const records: Record<string, unknown[]> = {};
  for (const type of SEED_ORDER) {
    const rows = await db.getAllAsync<any>(RECORD_TYPES[type].selectAll, userId);
    records[type] = [];
    for (const row of rows) records[type].push(await encodeRow(db, type, row));
  }
  const one = (sql: string) => db.getFirstAsync<any>(sql, userId);
  return {
    format: 'kettleborn-export',
    version: 1,
    exportedAt: new Date().toISOString(),
    deviceUuid: (await db.getFirstAsync<{ device_uuid: string }>('SELECT device_uuid FROM sync_state WHERE id = 1;'))?.device_uuid ?? null,
    player: await one('SELECT display_name, created_at, level, total_xp, progression_epoch FROM user WHERE id = ?;'),
    chronicle: await one('SELECT * FROM chronicle WHERE user_id = ?;'),
    monsterProgress: await db.getAllAsync('SELECT monster_id, hunts_completed, hunts_total, defeated FROM monster_progress WHERE user_id = ? ORDER BY monster_id;', userId),
    deviceSettings: await one('SELECT * FROM settings WHERE user_id = ?;'),
    records,
  };
}

/**
 * After the cloud account is deleted: this install becomes local-only
 * again. Its progress stays. Pending first-clear bonuses become final (D3:
 * no other device can share the account any more). Queued uploads are
 * dropped — there is no account to deliver them to; the records themselves
 * stay in their tables.
 */
export async function unlinkAfterAccountDeletion(
  db: QueueConnection,
  userId: string,
  huntsTotalByMonster: Record<string, number>
): Promise<void> {
  await runInTransaction(db, async () => {
    await db.runAsync("UPDATE first_clear_claim SET status = 'local_final' WHERE status = 'pending';");
    // The now-final bonuses join confirmed XP (it can only go up here).
    await writeStoredTotals(db, userId, huntsTotalByMonster, { allowXpDecrease: false });
    await db.runAsync('DELETE FROM sync_outbox;');
    await db.runAsync('DELETE FROM sync_item_version;');
    await db.runAsync(
      'UPDATE sync_state SET sync_enabled = 0, linked_user_id = NULL, linked_at = NULL, pull_cursor = NULL, last_sync_at = NULL WHERE id = 1;'
    );
  });
}
