import { getDatabase } from './db';
import type { Settings, Equipment } from '../models';
import { newUuid } from '../utils/uuid';
import { DEFAULT_EQUIPMENT_SYNC_KEYS } from './db/schema';
import { runInTransaction } from './db/transaction';
import { enqueueRecord } from './sync/outbox';

interface SettingsRow {
  user_id: string;
  unit_preference: string;
  sound_enabled: number;
  haptics_enabled: number;
  reduce_motion: number;
  notifications_enabled: number;
  keep_screen_awake: number;
}

interface EquipmentRow {
  id: string;
  user_id: string;
  type: string;
  weight: number;
  unit: string;
  label: string;
  owned: number;
}

function toSettings(row: SettingsRow): Settings {
  return {
    userId: row.user_id,
    unitPreference: row.unit_preference === 'lb' ? 'lb' : 'kg',
    soundEnabled: row.sound_enabled === 1,
    hapticsEnabled: row.haptics_enabled === 1,
    reduceMotion: row.reduce_motion === 1,
    notificationsEnabled: row.notifications_enabled === 1,
    keepScreenAwake: row.keep_screen_awake === 1,
  };
}

function defaultSettings(userId: string): Settings {
  return {
    userId,
    unitPreference: 'kg',
    soundEnabled: true,
    hapticsEnabled: true,
    reduceMotion: false,
    notificationsEnabled: true,
    keepScreenAwake: false,
  };
}

function toEquipment(row: EquipmentRow): Equipment {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type === 'other' ? 'other' : 'kettlebell',
    weight: row.weight,
    unit: row.unit === 'lb' ? 'lb' : 'kg',
    label: row.label,
    owned: row.owned === 1,
  };
}

export const SettingsRepository = {
  async getByUserId(userId: string): Promise<Settings | null> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<SettingsRow>(
      'SELECT * FROM settings WHERE user_id = ?;',
      userId
    );
    return row ? toSettings(row) : null;
  },

  async createIfNotExists(userId: string): Promise<Settings> {
    const existing = await this.getByUserId(userId);
    if (existing) {
      return existing;
    }
    const settings = defaultSettings(userId);
    await this.upsert(settings);
    return settings;
  },

  /** Only the account-wide unit is queued for sync (D7); the device preferences never are. */
  async upsert(settings: Settings): Promise<void> {
    const db = await getDatabase();
    await runInTransaction(db, async () => {
    const before = await db.getFirstAsync<{ unit_preference: string }>(
      'SELECT unit_preference FROM settings WHERE user_id = ?;',
      settings.userId
    );
    await db.runAsync(
      `INSERT INTO settings
        (user_id, unit_preference, sound_enabled, haptics_enabled, reduce_motion, notifications_enabled, keep_screen_awake, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET
         unit_preference = excluded.unit_preference,
         sound_enabled = excluded.sound_enabled,
         haptics_enabled = excluded.haptics_enabled,
         reduce_motion = excluded.reduce_motion,
         notifications_enabled = excluded.notifications_enabled,
         keep_screen_awake = excluded.keep_screen_awake,
         updated_at = excluded.updated_at;`,
      settings.userId,
      settings.unitPreference,
      settings.soundEnabled ? 1 : 0,
      settings.hapticsEnabled ? 1 : 0,
      settings.reduceMotion ? 1 : 0,
      settings.notificationsEnabled ? 1 : 0,
      settings.keepScreenAwake ? 1 : 0,
      new Date().toISOString()
    );
    if (!before || before.unit_preference !== settings.unitPreference) {
      await enqueueRecord(db, settings.userId, 'settings_account', 'account', before ? 'update' : 'insert');
    }
    });
  },

  async getEquipmentForUser(userId: string): Promise<Equipment[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<EquipmentRow>(
      'SELECT * FROM equipment WHERE user_id = ? AND deleted_at IS NULL;',
      userId
    );
    return rows.map(toEquipment);
  },

  /**
   * New rows get a fresh uuid; an update keeps the existing one. Saving an
   * id that was previously deleted restores it (clears deleted_at) — this
   * is what keeps loadEquipment's "re-seed the defaults when the list is
   * empty" behaviour identical now that deletion is a marker: the default
   * kettlebells have fixed ids, so re-seeding them brings the same rows
   * (and uuids) back.
   */
  async upsertEquipment(equipment: Equipment): Promise<void> {
    const db = await getDatabase();
    const uuid = newUuid();
    // D8: the default bells share one well-known sync identity on every
    // install; any other bell's sync_key is its own uuid. Set once on
    // insert and never changed by the ON CONFLICT branch.
    const syncKey = DEFAULT_EQUIPMENT_SYNC_KEYS[equipment.id] ?? uuid;
    await runInTransaction(db, async () => {
    const existing = await db.getFirstAsync<{ sync_key: string }>('SELECT sync_key FROM equipment WHERE id = ?;', equipment.id);
    await db.runAsync(
      `INSERT INTO equipment (id, user_id, type, weight, unit, label, owned, uuid, updated_at, sync_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         type = excluded.type,
         weight = excluded.weight,
         unit = excluded.unit,
         label = excluded.label,
         owned = excluded.owned,
         updated_at = excluded.updated_at,
         deleted_at = NULL;`,
      equipment.id,
      equipment.userId,
      equipment.type,
      equipment.weight,
      equipment.unit,
      equipment.label,
      equipment.owned ? 1 : 0,
      uuid,
      new Date().toISOString(),
      syncKey
    );
    // An existing row (including one restored from deletion) keeps its sync_key.
    await enqueueRecord(db, equipment.userId, 'equipment', existing?.sync_key ?? syncKey, existing ? 'update' : 'insert');
    });
  },

  /** Marks the item deleted (migration 18) instead of removing the row — the Forge list hides it exactly as before. */
  async deleteEquipment(id: string): Promise<void> {
    const db = await getDatabase();
    const now = new Date().toISOString();
    await runInTransaction(db, async () => {
      const { changes } = await db.runAsync(
        'UPDATE equipment SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL;',
        now,
        now,
        id
      );
      const row = await db.getFirstAsync<{ user_id: string; sync_key: string }>(
        'SELECT user_id, sync_key FROM equipment WHERE id = ?;',
        id
      );
      if (changes > 0 && row) {
        await enqueueRecord(db, row.user_id, 'equipment', row.sync_key, 'delete');
      }
    });
  },
};
