import { getDatabase } from './db';
import { Settings, Equipment } from '../models';

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

  async upsert(settings: Settings): Promise<void> {
    const db = await getDatabase();
    await db.runAsync(
      `INSERT INTO settings
        (user_id, unit_preference, sound_enabled, haptics_enabled, reduce_motion, notifications_enabled, keep_screen_awake)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET
         unit_preference = excluded.unit_preference,
         sound_enabled = excluded.sound_enabled,
         haptics_enabled = excluded.haptics_enabled,
         reduce_motion = excluded.reduce_motion,
         notifications_enabled = excluded.notifications_enabled,
         keep_screen_awake = excluded.keep_screen_awake;`,
      settings.userId,
      settings.unitPreference,
      settings.soundEnabled ? 1 : 0,
      settings.hapticsEnabled ? 1 : 0,
      settings.reduceMotion ? 1 : 0,
      settings.notificationsEnabled ? 1 : 0,
      settings.keepScreenAwake ? 1 : 0
    );
  },

  async getEquipmentForUser(userId: string): Promise<Equipment[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<EquipmentRow>(
      'SELECT * FROM equipment WHERE user_id = ?;',
      userId
    );
    return rows.map(toEquipment);
  },

  async upsertEquipment(equipment: Equipment): Promise<void> {
    const db = await getDatabase();
    await db.runAsync(
      `INSERT INTO equipment (id, user_id, type, weight, unit, label, owned)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         type = excluded.type,
         weight = excluded.weight,
         unit = excluded.unit,
         label = excluded.label,
         owned = excluded.owned;`,
      equipment.id,
      equipment.userId,
      equipment.type,
      equipment.weight,
      equipment.unit,
      equipment.label,
      equipment.owned ? 1 : 0
    );
  },
};
