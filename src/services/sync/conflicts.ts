import { runInTransaction } from '../db/transaction';
import { newUuid } from '../../utils/uuid';
import { enqueue, type QueueConnection } from './outbox';
import { setItemVersion, upsertLocal } from './apply';
import type { EntityType } from './recordTypes';

/**
 * Cloud Save D9 — resolving a conflict the player was shown.
 * - keep_server: the other device's version stays; the local one is
 *   released only now, by the player's choice.
 * - use_local: the local version becomes a NEW edit against the newest
 *   server version (so it can itself be judged again). A deleted custom
 *   workout is never undeleted: the local version is saved as a copy.
 */
export interface ConflictView {
  conflictUuid: string;
  entityType: EntityType;
  entityKey: string;
  field: string | null;
  localValue: any;
  serverValue: any;
  detectedAt: string;
}

export async function listOpenConflicts(db: QueueConnection): Promise<ConflictView[]> {
  const rows = await db.getAllAsync<any>("SELECT * FROM sync_conflict WHERE status = 'open' ORDER BY detected_at;");
  return rows.map((r) => ({
    conflictUuid: r.conflict_uuid,
    entityType: r.entity_type,
    entityKey: r.entity_key,
    field: r.field,
    localValue: JSON.parse(r.local_value_json),
    serverValue: r.server_value_json ? JSON.parse(r.server_value_json) : null,
    detectedAt: r.detected_at,
  }));
}

export async function resolveConflict(
  db: QueueConnection,
  userId: string,
  conflictUuid: string,
  choice: 'keep_server' | 'use_local'
): Promise<void> {
  await runInTransaction(db, async () => {
    const c = await db.getFirstAsync<any>("SELECT * FROM sync_conflict WHERE conflict_uuid = ? AND status = 'open';", conflictUuid);
    if (!c) return;
    if (choice === 'keep_server') {
      await db.runAsync("UPDATE sync_conflict SET status = 'kept_server' WHERE conflict_uuid = ?;", conflictUuid);
      return;
    }
    const local = JSON.parse(c.local_value_json);
    const server = c.server_value_json ? JSON.parse(c.server_value_json) : null;
    // The new edit is based on the newest server version the device knows.
    await setItemVersion(db, c.entity_type, c.entity_key, c.field, c.server_seq ?? 0);

    if (c.field === 'notes' || c.field === 'rpe') {
      await db.runAsync(`UPDATE workout_result SET ${c.field} = ? WHERE uuid = ?;`, local.value ?? null, c.entity_key);
      await enqueue(db, { entityType: 'hunt_result', entityKey: c.entity_key, field: c.field, op: 'update', payload: { value: local.value ?? null } });
    } else if (c.entity_type === 'custom_workout' && server && server.deleted_at) {
      // Deleted elsewhere: the original stays deleted; the local version is saved as a new workout.
      const copyUuid = newUuid();
      const copy = { ...local, uuid: copyUuid, id: `custom-workout-${Date.now()}`, deleted_at: null };
      await upsertLocal(db, userId, 'custom_workout', copy);
      await enqueue(db, { entityType: 'custom_workout', entityKey: copyUuid, op: 'insert', payload: copy });
    } else {
      await upsertLocal(db, userId, c.entity_type, local);
      await enqueue(db, { entityType: c.entity_type, entityKey: c.entity_key, op: local.deleted_at ? 'delete' : 'update', payload: local });
    }
    await db.runAsync("UPDATE sync_conflict SET status = 'restored_local' WHERE conflict_uuid = ?;", conflictUuid);
  });
}
