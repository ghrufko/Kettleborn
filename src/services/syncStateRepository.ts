import { getDatabase } from './db';

interface SyncStateRow {
  device_uuid: string;
  linked_user_id: string | null;
  sync_enabled: number;
  next_origin_order: number;
  sync_blocked_reason: string | null;
}

/**
 * sync_state (migration 19): this install's identity and sync switches —
 * one row. Nothing here talks to a network; sync_enabled stays 0 until
 * account linking exists.
 */
export const SyncStateRepository = {
  async get(): Promise<SyncStateRow> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<SyncStateRow>(
      'SELECT device_uuid, linked_user_id, sync_enabled, next_origin_order, sync_blocked_reason FROM sync_state WHERE id = 1;'
    );
    if (!row) {
      throw new Error('sync_state row missing (migration 19 not applied)');
    }
    return row;
  },

  /**
   * C1: when migration 19 found an inconsistent reset history, values that
   * depend on the reset order are unknown (NULL) for this install, and are
   * recorded as NULL from then on rather than guessed.
   */
  async isResetHistoryBlocked(): Promise<boolean> {
    return (await this.get()).sync_blocked_reason !== null;
  },

  /** D3/D10: an install that has ever linked to an account (signed in or not). */
  async isLinked(): Promise<boolean> {
    return (await this.get()).linked_user_id !== null;
  },

  /**
   * Claims the next origin_order for a record this install creates. Must
   * run inside the caller's transaction so the counter and the record
   * commit (or roll back) together.
   */
  async takeOrigin(): Promise<{ deviceUuid: string; order: number }> {
    const db = await getDatabase();
    const state = await this.get();
    await db.runAsync('UPDATE sync_state SET next_origin_order = next_origin_order + 1 WHERE id = 1;');
    return { deviceUuid: state.device_uuid, order: state.next_origin_order };
  },
};
