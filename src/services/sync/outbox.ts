import { runInTransaction } from '../db/transaction';
import { newUuid } from '../../utils/uuid';
import { RECORD_TYPES, SEED_ORDER, type EntityType } from './recordTypes';
import { encodeRow, readRecord, type Payload, type ReadConnection } from './encoding';
import { applyServerValue, getItemVersion, setItemVersion, upsertLocal } from './apply';
import { nextClaimStatus } from './claimStatus';
import { LOCAL_USER_ID } from '../../constants/localUser';

/**
 * Cloud Save P5 — the local upload queue (sync_outbox, migration 19).
 *
 * INACTIVE while sync_state.sync_enabled = 0, which is every install until
 * account linking exists: enqueue() then does nothing. There is no network
 * code here; takeBatch()/applyAck() are the local state transitions a
 * future transport will drive (tests drive them with a fake).
 *
 * Every enqueue() runs inside the caller's transaction (runInTransaction),
 * together with the change it records — both commit or neither does.
 *
 * Per item (entity_type, entity_key, field) there is at most ONE in-flight
 * row (R) and at most ONE queued row (S). New changes fold into S; R is
 * never modified, because a retry must resend exactly what was sent.
 */

export type Op = 'insert' | 'update' | 'delete';

export interface QueueConnection extends ReadConnection {
  runAsync(sql: string, ...params: unknown[]): Promise<{ changes: number; lastInsertRowId: number }>;
  execAsync(source: string): Promise<void>;
}

export interface OutboxRow {
  device_seq: number;
  entity_type: EntityType;
  entity_key: string;
  field: string | null;
  op: Op;
  payload_json: string;
  base_seq: number | null;
  state: 'queued' | 'in_flight' | 'quarantined';
  attempts: number;
}

export type AckOutcome =
  | { status: 'accepted' | 'duplicate'; serverSeq: number }
  | { status: 'stale'; serverSeq: number; serverValue: unknown }
  | { status: 'claimed_elsewhere'; serverSeq: number; serverValue: unknown }
  | { status: 'invalid'; error: string };

export class SyncBlockedError extends Error {
  constructor(reason: string) {
    super(`Sync is blocked on this install: ${reason}`);
    this.name = 'SyncBlockedError';
  }
}

async function isEnabled(db: QueueConnection): Promise<boolean> {
  const row = await db.getFirstAsync<{ sync_enabled: number }>('SELECT sync_enabled FROM sync_state WHERE id = 1;');
  return row?.sync_enabled === 1;
}

const SAME_ITEM = 'entity_type = ? AND entity_key = ? AND field IS ?';

/**
 * Folding a new change into a queued row (2.0.8 table). The payload is
 * always the latest full state; device_seq and base_seq are kept.
 */
export function foldOps(queued: Op, next: Op): Op {
  if (queued === 'insert') return 'insert'; // a never-sent record: still one insert, carrying the latest state (and tombstone)
  if (next === 'insert') return 'update'; // the record exists on the server already
  return next; // update→update, update→delete, delete→update (restore), delete→delete
}

/** Records one change in the queue. Must be called inside the caller's runInTransaction. No-op while sync is off. */
export async function enqueue(
  db: QueueConnection,
  item: { entityType: EntityType; entityKey: string; field?: string | null; op: Op; payload: Payload }
): Promise<void> {
  if (!(await isEnabled(db))) return;
  const field = item.field ?? null;
  const now = new Date().toISOString();

  if (field !== null && RECORD_TYPES[item.entityType].kind === 'fact') {
    // A field edit (notes / RPE) on a fact whose own insert hasn't been sent yet folds into that insert.
    const insert = await db.getFirstAsync<OutboxRow>(
      `SELECT * FROM sync_outbox WHERE ${SAME_ITEM} AND state = 'queued' AND attempts = 0 AND op = 'insert';`,
      item.entityType,
      item.entityKey,
      null
    );
    if (insert) {
      const payload = JSON.parse(insert.payload_json);
      payload[field] = item.payload.value;
      await db.runAsync('UPDATE sync_outbox SET payload_json = ? WHERE device_seq = ?;', JSON.stringify(payload), insert.device_seq);
      return;
    }
  }

  const rows = await db.getAllAsync<OutboxRow>(
    `SELECT * FROM sync_outbox WHERE ${SAME_ITEM} ORDER BY device_seq;`,
    item.entityType,
    item.entityKey,
    field
  );
  // Only a row that has never been sent can absorb a new change. A row that
  // was sent and then returned to the queue (resetInFlight) must be resent
  // exactly as it was, so it counts as "in flight" here.
  const queued = rows.find((r) => r.state === 'queued' && r.attempts === 0);
  if (queued) {
    await db.runAsync(
      'UPDATE sync_outbox SET op = ?, payload_json = ? WHERE device_seq = ?;',
      foldOps(queued.op, item.op),
      JSON.stringify(item.payload),
      queued.device_seq
    );
    return;
  }
  const inFlight = rows.find((r) => r.state === 'in_flight' || (r.state === 'queued' && r.attempts > 0));
  if (inFlight && inFlight.op === 'delete' && item.op === 'delete') {
    return; // deleting what is already being deleted changes nothing
  }
  const waiting = inFlight || rows.some((r) => r.state === 'quarantined');
  // A change made against a known server version carries it as its base;
  // one queued behind an unanswered row gets its base from that answer.
  const base = waiting || item.op === 'insert' ? null : await getItemVersion(db, item.entityType, item.entityKey, field);
  await db.runAsync(
    `INSERT INTO sync_outbox (entity_type, entity_key, field, op, payload_json, base_seq, state, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'queued', ?);`,
    item.entityType,
    item.entityKey,
    field,
    waiting ? (item.op === 'insert' ? 'update' : item.op) : item.op,
    JSON.stringify(item.payload),
    base,
    now
  );
}

/** Encodes the record's current local state and enqueues it (records and facts). */
export async function enqueueRecord(
  db: QueueConnection,
  userId: string,
  type: EntityType,
  key: string,
  op: Op
): Promise<void> {
  if (!(await isEnabled(db))) return;
  const payload = await readRecord(db, userId, type, key);
  if (!payload) {
    throw new Error(`enqueueRecord: ${type} ${key} not found locally`);
  }
  await enqueue(db, { entityType: type, entityKey: key, op, payload });
}

/**
 * Marks the next rows to send as in flight, in device_seq order, skipping
 * any item that already has a row in flight or quarantined (its queued
 * successor waits for that outcome).
 */
export async function takeBatch(db: QueueConnection, limit: number): Promise<OutboxRow[]> {
  let batch: OutboxRow[] = [];
  await runInTransaction(db, async () => {
    const queued = await db.getAllAsync<OutboxRow>(
      `SELECT * FROM sync_outbox q WHERE q.state = 'queued'
         AND NOT EXISTS (SELECT 1 FROM sync_outbox o WHERE o.entity_type = q.entity_type AND o.entity_key = q.entity_key
                         AND o.field IS q.field AND o.device_seq < q.device_seq)
       ORDER BY q.device_seq LIMIT ?;`,
      limit
    );
    const now = new Date().toISOString();
    for (const row of queued) {
      await db.runAsync(
        "UPDATE sync_outbox SET state = 'in_flight', attempts = attempts + 1, last_attempt_at = ? WHERE device_seq = ?;",
        now,
        row.device_seq
      );
    }
    batch = queued.map((r) => ({ ...r, state: 'in_flight', attempts: r.attempts + 1 }));
  });
  return batch;
}

/** Applies the server's answer for one in-flight row (2.0.9 §2). */
export async function applyAck(db: QueueConnection, deviceSeq: number, outcome: AckOutcome): Promise<void> {
  await runInTransaction(db, async () => {
    const inFlight = await db.getFirstAsync<OutboxRow>(
      "SELECT * FROM sync_outbox WHERE device_seq = ? AND state = 'in_flight';",
      deviceSeq
    );
    if (!inFlight) return; // already applied (a repeated acknowledgement)
    const successor = await db.getFirstAsync<OutboxRow>(
      `SELECT * FROM sync_outbox WHERE ${SAME_ITEM} AND state = 'queued' AND device_seq > ? ORDER BY device_seq LIMIT 1;`,
      inFlight.entity_type,
      inFlight.entity_key,
      inFlight.field,
      deviceSeq
    );
    if (outcome.status === 'accepted' || outcome.status === 'duplicate') {
      await db.runAsync('DELETE FROM sync_outbox WHERE device_seq = ?;', deviceSeq);
      await setItemVersion(db, inFlight.entity_type, inFlight.entity_key, inFlight.field, outcome.serverSeq);
      if (successor) {
        await db.runAsync('UPDATE sync_outbox SET base_seq = ? WHERE device_seq = ?;', outcome.serverSeq, successor.device_seq);
      }
      if (inFlight.entity_type === 'first_clear_claim') {
        // D2/D3: the server accepted this claim first — a pending bonus is now confirmed.
        const [stage, epoch] = splitClaimKey(inFlight.entity_key);
        const claim = await db.getFirstAsync<{ status: any }>(
          'SELECT status FROM first_clear_claim WHERE user_id = ? AND stage_key = ? AND epoch = ?;',
          LOCAL_USER_ID,
          stage,
          epoch
        );
        if (claim) {
          await db.runAsync(
            'UPDATE first_clear_claim SET status = ? WHERE user_id = ? AND stage_key = ? AND epoch = ?;',
            nextClaimStatus(claim.status, 'server_accepted'),
            LOCAL_USER_ID,
            stage,
            epoch
          );
          if (claim.status === 'pending') {
            await addBonusNotice(db, 'bonus_confirmed', JSON.parse(inFlight.payload_json).result_uuid);
          }
        }
      }
      return;
    }
    if (outcome.status === 'claimed_elsewhere') {
      // D2: another device's claim for this stage/epoch was accepted first. Its claim is the one
      // stored here from now on; this device's result keeps its record but its bonus never counts.
      await db.runAsync('DELETE FROM sync_outbox WHERE device_seq = ?;', deviceSeq);
      const [stage, epoch] = splitClaimKey(inFlight.entity_key);
      const mine = await db.getFirstAsync<{ status: string; result_uuid: string }>(
        'SELECT status, result_uuid FROM first_clear_claim WHERE user_id = ? AND stage_key = ? AND epoch = ?;',
        LOCAL_USER_ID,
        stage,
        epoch
      );
      if (mine?.status === 'pending') {
        await addBonusNotice(db, 'bonus_lost', mine.result_uuid);
      }
      if (outcome.serverValue && typeof outcome.serverValue === 'object') {
        await upsertLocal(db, LOCAL_USER_ID, 'first_clear_claim', outcome.serverValue as Payload);
      }
      await setItemVersion(db, inFlight.entity_type, inFlight.entity_key, null, outcome.serverSeq);
      return;
    }
    if (outcome.status === 'stale') {
      // The newest local state goes into the conflict record — the successor's if there is one.
      const newest = successor ?? inFlight;
      await db.runAsync(
        `INSERT INTO sync_conflict (conflict_uuid, entity_type, entity_key, field, local_value_json, local_device_seq,
           base_seq, server_value_json, server_seq, detected_at, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open');`,
        newUuid(),
        inFlight.entity_type,
        inFlight.entity_key,
        inFlight.field,
        newest.payload_json,
        newest.device_seq,
        inFlight.base_seq,
        JSON.stringify(outcome.serverValue ?? null),
        outcome.serverSeq,
        new Date().toISOString()
      );
      await db.runAsync('DELETE FROM sync_outbox WHERE device_seq IN (?, ?);', deviceSeq, successor?.device_seq ?? -1);
      // The player sees the server version; theirs stays in the conflict record until they choose.
      await applyServerValue(db, LOCAL_USER_ID, inFlight.entity_type, inFlight.entity_key, inFlight.field, outcome.serverValue, outcome.serverSeq);
      return;
    }
    if (outcome.status === 'invalid') {
      // Kept, never dropped; its queued successor (if any) waits behind it.
      await db.runAsync(
        "UPDATE sync_outbox SET state = 'quarantined', last_error = ? WHERE device_seq = ?;",
        outcome.error,
        deviceSeq
      );
    }
  });
}

/** D3 notices: a pending first-clear bonus was confirmed, or another device's claim came first. */
async function addBonusNotice(db: QueueConnection, kind: 'bonus_confirmed' | 'bonus_lost', resultUuid: string) {
  const row = await db.getFirstAsync<{ bonus: number | null }>(
    'SELECT first_clear_bonus_xp AS bonus FROM workout_result WHERE uuid = ?;',
    resultUuid
  );
  await db.runAsync(
    'INSERT INTO sync_notice (kind, data_json, created_at) VALUES (?, ?, ?);',
    kind,
    JSON.stringify({ xp: row?.bonus ?? 0, resultUuid }),
    new Date().toISOString()
  );
}

function splitClaimKey(key: string): [string, number] {
  const at = key.lastIndexOf('@');
  return [key.slice(0, at), Number(key.slice(at + 1))];
}

/**
 * Restore (D4: a device with no progress joins an account that has data):
 * turns sync on WITHOUT seeding anything — the account's data is downloaded instead.
 */
export async function enableForRestore(db: QueueConnection, linkedUserId: string): Promise<void> {
  await runInTransaction(db, async () => {
    const state = await db.getFirstAsync<{ sync_enabled: number; sync_blocked_reason: string | null }>(
      'SELECT sync_enabled, sync_blocked_reason FROM sync_state WHERE id = 1;'
    );
    if (!state) throw new Error('sync_state row missing');
    if (state.sync_blocked_reason !== null) throw new SyncBlockedError(state.sync_blocked_reason);
    if (state.sync_enabled === 1) throw new Error('Sync is already enabled on this install');
    await db.runAsync(
      'UPDATE sync_state SET sync_enabled = 1, linked_user_id = ?, linked_at = ? WHERE id = 1;',
      linkedUserId,
      new Date().toISOString()
    );
  });
}

/** After a network failure or an app restart: rows left in flight go back to the queue unchanged (resent with the same identity). */
export async function resetInFlight(db: QueueConnection): Promise<void> {
  await runInTransaction(db, async () => {
    await db.runAsync("UPDATE sync_outbox SET state = 'queued' WHERE state = 'in_flight';");
  });
}

/**
 * First link (called by account linking, which does not exist yet — P8):
 * turns the queue on and queues every syncable record, in SEED_ORDER, in
 * ONE transaction. Every syncable write runs through runInTransaction, so
 * a write is either in this snapshot or queued by itself afterwards —
 * never both, never neither.
 */
export async function enableAndSeed(db: QueueConnection, userId: string, linkedUserId: string): Promise<number> {
  let seeded = 0;
  await runInTransaction(db, async () => {
    const state = await db.getFirstAsync<{ sync_enabled: number; sync_blocked_reason: string | null }>(
      'SELECT sync_enabled, sync_blocked_reason FROM sync_state WHERE id = 1;'
    );
    if (!state) throw new Error('sync_state row missing');
    if (state.sync_blocked_reason !== null) throw new SyncBlockedError(state.sync_blocked_reason);
    if (state.sync_enabled === 1) throw new Error('Sync is already enabled on this install');
    await db.runAsync(
      'UPDATE sync_state SET sync_enabled = 1, linked_user_id = ?, linked_at = ? WHERE id = 1;',
      linkedUserId,
      new Date().toISOString()
    );
    for (const type of SEED_ORDER) {
      const spec = RECORD_TYPES[type];
      const rows = await db.getAllAsync<any>(spec.selectAll, userId);
      for (const row of rows) {
        await enqueue(db, { entityType: type, entityKey: spec.key(row), op: 'insert', payload: await encodeRow(db, type, row) });
        seeded += 1;
      }
    }
  });
  return seeded;
}
