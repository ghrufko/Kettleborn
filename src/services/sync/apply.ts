import { RECORD_TYPES, type EntityType } from './recordTypes';
import { decodeToRow, type Payload } from './encoding';
import type { QueueConnection } from './outbox';
import { rebuildTotals } from '../projections/rebuild';
import { loadProjectionInput } from '../projections/load';

/**
 * Cloud Save P7 — writing server state into the local database.
 *
 * Rules (decisions D4, D5, D6, D9, D14):
 * - Additive only: rows are inserted or updated by their sync identity;
 *   nothing is ever deleted. "Removed from current progress" is always a
 *   marker (voided_at / deleted_at), never a deletion.
 * - An item with an unsent local change is left alone: its own upload is
 *   judged by the server (accepted, or stale → conflict record).
 * - Facts never change after insert, except a hunt's notes / RPE.
 * - Afterwards the stored totals are rewritten from the rebuild (baseline +
 *   facts). Confirmed XP may only go down when a campaign reset was applied
 *   in the same step; otherwise the whole step is rolled back.
 */

const CONFLICT_TARGET: Readonly<Record<EntityType, string>> = {
  baseline: 'uuid',
  custom_workout: 'uuid',
  timer_preset: 'uuid',
  equipment: 'user_id, sync_key',
  custom_hunt_preset: 'user_id, workout_id',
  settings_account: 'user_id',
  hunt_result: 'uuid',
  custom_workout_result: 'uuid',
  timer_result: 'uuid',
  stopwatch_result: 'uuid',
  progress_reset: 'uuid',
  first_clear_claim: 'user_id, stage_key, epoch',
  achievement: 'user_id, milestone_type',
};

export class SyncGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SyncGuardError';
  }
}

export interface PulledItem {
  server_seq: number;
  entity_type: EntityType;
  entity_key: string;
  payload: Payload;
}

export async function setItemVersion(db: QueueConnection, type: string, key: string, field: string | null, seq: number) {
  await db.runAsync(
    `INSERT INTO sync_item_version (entity_type, entity_key, field, server_seq) VALUES (?, ?, ?, ?)
     ON CONFLICT (entity_type, entity_key, field) DO UPDATE SET server_seq = MAX(server_seq, excluded.server_seq);`,
    type,
    key,
    field ?? '',
    seq
  );
}

export async function getItemVersion(db: QueueConnection, type: string, key: string, field: string | null): Promise<number | null> {
  const row = await db.getFirstAsync<{ server_seq: number }>(
    'SELECT server_seq FROM sync_item_version WHERE entity_type = ? AND entity_key = ? AND field = ?;',
    type,
    key,
    field ?? ''
  );
  return row ? row.server_seq : null;
}

async function hasPendingChange(db: QueueConnection, type: string, key: string, field: string | null): Promise<boolean> {
  const row = await db.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM sync_outbox WHERE entity_type = ? AND entity_key = ? AND field IS ? AND state <> 'quarantined';",
    type,
    key,
    field
  );
  return (row?.n ?? 0) > 0;
}

/** Inserts or updates one record locally by its sync identity. Never deletes. */
export async function upsertLocal(db: QueueConnection, userId: string, type: EntityType, payload: Payload): Promise<void> {
  const spec = RECORD_TYPES[type];
  const row = decodeToRow(type, payload, userId);
  if (type === 'first_clear_claim' && row.status === 'pending') {
    // A claim stored on the server is an accepted claim: the status a device
    // uploaded it with ('pending') means 'confirmed' once it is there (D2/D3).
    row.status = 'confirmed';
  }
  const columns = Object.keys(row);
  const placeholders = columns.map(() => '?').join(', ');
  const target = CONFLICT_TARGET[type];
  const targetCols = target.split(',').map((c) => c.trim());
  let onConflict: string;
  if (type === 'first_clear_claim') {
    // D2: the server's claim for this stage/epoch is the one that holds.
    onConflict = 'DO UPDATE SET result_uuid = excluded.result_uuid, status = excluded.status, claimed_at = excluded.claimed_at';
  } else if (type === 'achievement') {
    onConflict = 'DO UPDATE SET unlocked_at = MIN(unlocked_at, excluded.unlocked_at)';
  } else if (spec.kind === 'record') {
    const updates = columns.filter((c) => !targetCols.includes(c) && c !== 'user_id' && c !== 'id');
    onConflict = updates.length > 0 ? `DO UPDATE SET ${updates.map((c) => `${c} = excluded.${c}`).join(', ')}` : 'DO NOTHING';
  } else {
    onConflict = 'DO NOTHING'; // facts never change; hunt notes/RPE are applied separately
  }
  await db.runAsync(
    `INSERT INTO ${spec.table} (${columns.join(', ')}) VALUES (${placeholders}) ON CONFLICT (${target}) ${onConflict};`,
    ...columns.map((c) => row[c])
  );
  if (type === 'baseline' && Array.isArray(payload.monsters)) {
    for (const m of payload.monsters as any[]) {
      await db.runAsync(
        `INSERT OR IGNORE INTO progress_baseline_monster
           (baseline_uuid, monster_id, hunts_completed, hunts_total, defeated, monster_reset_count) VALUES (?, ?, ?, ?, ?, ?);`,
        payload.uuid,
        m.monster_id,
        m.hunts_completed,
        m.hunts_total,
        m.defeated,
        m.monster_reset_count
      );
    }
  }
}

/** A hunt's editable field, from the server (pull or a stale answer). */
async function applyHuntField(db: QueueConnection, key: string, field: 'notes' | 'rpe', value: unknown) {
  await db.runAsync(`UPDATE workout_result SET ${field} = ? WHERE uuid = ?;`, value ?? null, key);
}

/** Applies a page of pulled changes. Must run inside the caller's transaction. */
export async function applyPulledItems(db: QueueConnection, userId: string, items: PulledItem[]) {
  let campaignResets = 0;
  let latestCampaignResetAt: string | null = null;
  const thisDevice = (await db.getFirstAsync<{ device_uuid: string }>('SELECT device_uuid FROM sync_state WHERE id = 1;'))!.device_uuid;
  let foreignHunts = 0;
  for (const item of items) {
    const { entity_type: type, entity_key: key, payload } = item;
    if (!RECORD_TYPES[type]) continue; // a type this app version does not know: ignored, never fatal
    if (type === 'hunt_result') {
      const existed = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM workout_result WHERE uuid = ?;', key);
      if (!existed?.n) {
        await upsertLocal(db, userId, type, payload);
        if (payload.origin_device_uuid !== thisDevice) foreignHunts += 1;
      }
      await setItemVersion(db, type, key, null, item.server_seq);
      for (const field of ['notes', 'rpe'] as const) {
        const fieldSeq = Number(payload[`${field}_seq`] ?? item.server_seq);
        if (await hasPendingChange(db, type, key, field)) continue;
        await applyHuntField(db, key, field, payload[field]);
        await setItemVersion(db, type, key, field, fieldSeq);
      }
      continue;
    }
    if (await hasPendingChange(db, type, key, null)) continue; // resolved by its own upload
    if (type === 'progress_reset') {
      const existed = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM progress_reset WHERE uuid = ?;', key);
      if (!existed?.n && payload.scope === 'campaign') {
        campaignResets += 1;
        const at = String(payload.reset_at ?? '');
        if (!latestCampaignResetAt || at > latestCampaignResetAt) latestCampaignResetAt = at;
      }
    }
    await upsertLocal(db, userId, type, payload);
    await setItemVersion(db, type, key, null, item.server_seq);
  }
  return { campaignResets, foreignHunts, latestCampaignResetAt };
}

/**
 * After applying server state: the campaign epoch, void markers, cached
 * custom-workout-result hiding, then the stored totals (guarded).
 * Must run inside the caller's transaction.
 */
export async function reconcileLocalState(
  db: QueueConnection,
  userId: string,
  huntsTotalByMonster: Record<string, number>,
  options: { campaignResetsApplied: number }
) {
  // D5: the current epoch is the highest any campaign reset reached.
  const epochRow = await db.getFirstAsync<{ e: number | null }>(
    "SELECT MAX(to_epoch) AS e FROM progress_reset WHERE user_id = ? AND scope = 'campaign';",
    userId
  );
  const user = await db.getFirstAsync<{ progression_epoch: number; total_xp: number }>(
    'SELECT progression_epoch, total_xp FROM user WHERE id = ?;',
    userId
  );
  if (!user) return { voidedByOtherDevices: 0 };
  if (epochRow?.e !== null && epochRow?.e !== undefined && epochRow.e > user.progression_epoch) {
    await db.runAsync('UPDATE user SET progression_epoch = ? WHERE id = ?;', epochRow.e, userId);
  }
  const E = Math.max(user.progression_epoch, epochRow?.e ?? 0);

  // D5/D6: a result stays active only in the current epoch and its monster's current reset era.
  // Inactive results get the marker of the reset that ended their era — kept, never deleted.
  const thisDevice = (await db.getFirstAsync<{ device_uuid: string }>('SELECT device_uuid FROM sync_state WHERE id = 1;'))!.device_uuid;
  const stale = await db.getAllAsync<any>(
    `SELECT r.uuid, r.monster_id, r.progression_epoch, r.monster_reset_count, r.origin_device_uuid FROM workout_result r
     WHERE r.user_id = ? AND r.voided_at IS NULL AND r.progression_epoch IS NOT NULL AND (
       r.progression_epoch < ? OR (r.monster_reset_count IS NOT NULL AND r.monster_reset_count < COALESCE(
         (SELECT MAX(p.count_after) FROM progress_reset p
          WHERE p.user_id = r.user_id AND p.scope = 'monster' AND p.monster_id = r.monster_id AND p.epoch = ?), 0)))`,
    userId,
    E,
    E
  );
  let voidedByOtherDevices = 0;
  for (const r of stale) {
    const reset =
      r.progression_epoch < E
        ? await db.getFirstAsync<{ uuid: string; reset_at: string }>(
            "SELECT uuid, reset_at FROM progress_reset WHERE user_id = ? AND scope = 'campaign' AND epoch = ?;",
            userId,
            r.progression_epoch
          )
        : await db.getFirstAsync<{ uuid: string; reset_at: string }>(
            "SELECT uuid, reset_at FROM progress_reset WHERE user_id = ? AND scope = 'monster' AND monster_id = ? AND epoch = ? AND count_before = ?;",
            userId,
            r.monster_id,
            r.progression_epoch,
            r.monster_reset_count
          );
    if (!reset) continue; // the ending reset hasn't arrived yet: leave it as it is
    await db.runAsync(
      'UPDATE workout_result SET voided_at = ?, void_reset_uuid = ? WHERE uuid = ? AND voided_at IS NULL;',
      reset.reset_at,
      reset.uuid,
      r.uuid
    );
    if (r.origin_device_uuid === thisDevice && r.progression_epoch < E) voidedByOtherDevices += 1;
  }

  // D9: a custom-workout result is hidden exactly when its parent workout is deleted.
  await db.runAsync(
    `UPDATE custom_workout_result SET deleted_at = (SELECT w.deleted_at FROM custom_workout w WHERE w.uuid = custom_workout_result.custom_workout_uuid)
     WHERE custom_workout_uuid IS NOT NULL AND user_id = ?
       AND deleted_at IS NOT (SELECT w.deleted_at FROM custom_workout w WHERE w.uuid = custom_workout_result.custom_workout_uuid);`,
    userId
  );

  await writeStoredTotals(db, userId, huntsTotalByMonster, { allowXpDecrease: options.campaignResetsApplied > 0 });
  return { voidedByOtherDevices };
}

/**
 * D14 switch-over: the stored totals the app shows are written from the
 * rebuild. Guard: confirmed XP never decreases unless a campaign reset was
 * applied in this same step — otherwise SyncGuardError rolls everything back.
 */
export async function writeStoredTotals(
  db: QueueConnection,
  userId: string,
  huntsTotalByMonster: Record<string, number>,
  options: { allowXpDecrease: boolean }
) {
  const user = await db.getFirstAsync<{ total_xp: number }>('SELECT total_xp FROM user WHERE id = ?;', userId);
  if (!user) return;
  const p = rebuildTotals(await loadProjectionInput(userId, huntsTotalByMonster));
  if (p.confirmedXP < user.total_xp && !options.allowXpDecrease) {
    throw new SyncGuardError(
      `sync would lower confirmed XP from ${user.total_xp} to ${p.confirmedXP} without a campaign reset; nothing was applied`
    );
  }
  await db.runAsync('UPDATE user SET total_xp = ?, level = ? WHERE id = ?;', p.confirmedXP, p.level, userId);
  const c = p.chronicle;
  const lastActivity = await db.getFirstAsync<{ t: string | null }>(
    `SELECT MAX(completed_at) AS t FROM workout_result WHERE user_id = ? AND progression_epoch = (SELECT progression_epoch FROM user WHERE id = ?);`,
    userId,
    userId
  );
  await db.runAsync(
    `UPDATE chronicle SET total_workouts = ?, total_hunts_completed = ?, total_monsters_defeated = ?, total_volume_kg = ?,
       total_training_minutes = ?, current_streak_days = ?, longest_streak_days = ?,
       updated_at = CASE WHEN ? IS NOT NULL AND ? > updated_at THEN ? ELSE updated_at END
     WHERE user_id = ?;`,
    c.totalWorkouts,
    c.totalHuntsCompleted,
    c.totalMonstersDefeated,
    c.totalVolumeKg,
    c.totalTrainingMinutes,
    c.currentStreakDays,
    c.longestStreakDays,
    lastActivity?.t ?? null,
    lastActivity?.t ?? null,
    lastActivity?.t ?? null,
    userId
  );
  if (p.monsterProgress) {
    for (const [monsterId, m] of Object.entries(p.monsterProgress)) {
      await db.runAsync(
        `INSERT INTO monster_progress (user_id, monster_id, hunts_completed, hunts_total, defeated) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (user_id, monster_id) DO UPDATE SET hunts_completed = excluded.hunts_completed, defeated = excluded.defeated;`,
        userId,
        monsterId,
        m.huntsCompleted,
        huntsTotalByMonster[monsterId] ?? 0,
        m.defeated ? 1 : 0
      );
    }
  }
  return p;
}

/** Applies a stale answer's server value locally (the player sees the server version; theirs is in the conflict record). */
export async function applyServerValue(
  db: QueueConnection,
  userId: string,
  type: EntityType,
  key: string,
  field: string | null,
  serverValue: unknown,
  serverSeq: number
) {
  if (field === 'notes' || field === 'rpe') {
    await applyHuntField(db, key, field, serverValue);
  } else if (serverValue && typeof serverValue === 'object' && RECORD_TYPES[type].key(serverValue) === key) {
    // Only a server value that is this item's own row is applied; anything else is ignored
    // (the conflict record still holds the local version either way).
    await upsertLocal(db, userId, type, serverValue as Payload);
  }
  await setItemVersion(db, type, key, field, serverSeq);
}
