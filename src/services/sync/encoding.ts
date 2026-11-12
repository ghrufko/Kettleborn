import { BASELINE_MONSTER_FIELDS, RECORD_TYPES, type EntityType } from './recordTypes';

/** Minimal connection surface the encoders need (the app's SQLite connection). */
export interface ReadConnection {
  getAllAsync<T>(sql: string, ...params: unknown[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, ...params: unknown[]): Promise<T | null>;
}

export type Payload = Record<string, unknown>;

/**
 * One local row → its upload payload: exactly the columns listed in
 * RECORD_TYPES[type].fields, under the same names, values unchanged (JSON
 * columns stay strings, so nothing is re-serialized).
 */
export async function encodeRow(db: ReadConnection, type: EntityType, row: any): Promise<Payload> {
  const spec = RECORD_TYPES[type];
  const payload: Payload = {};
  for (const field of spec.fields) {
    payload[field] = row[field] === undefined ? null : row[field];
  }
  if (type === 'custom_workout_result' && row.custom_workout_uuid === null) {
    // Orphan result: its own deletion marker is authoritative (D9), sent once with the insert.
    payload.deleted_at = row.deleted_at ?? null;
  }
  if (type === 'baseline') {
    const monsters = await db.getAllAsync<any>(
      'SELECT * FROM progress_baseline_monster WHERE baseline_uuid = ? ORDER BY monster_id;',
      row.uuid
    );
    payload.monsters = monsters.map((m) => Object.fromEntries(BASELINE_MONSTER_FIELDS.map((f) => [f, m[f]])));
  }
  return payload;
}

/** Reads and encodes one record by its entity_key; null when it doesn't exist locally. */
export async function readRecord(
  db: ReadConnection,
  userId: string,
  type: EntityType,
  key: string
): Promise<Payload | null> {
  const row = await db.getFirstAsync<any>(RECORD_TYPES[type].selectOne, userId, key);
  return row ? encodeRow(db, type, row) : null;
}

/**
 * The inverse mapping, for the apply step (P7) and the independent
 * round-trip test: a payload back to the local row it describes. Only the
 * listed fields are taken; the owner is added locally.
 */
export function decodeToRow(type: EntityType, payload: Payload, userId: string): Record<string, unknown> {
  const spec = RECORD_TYPES[type];
  const row: Record<string, unknown> = { user_id: userId };
  for (const field of spec.fields) {
    row[field] = payload[field] === undefined ? null : payload[field];
  }
  if (type === 'custom_workout_result' && payload.custom_workout_uuid === null) {
    row.deleted_at = payload.deleted_at ?? null;
  }
  return row;
}
