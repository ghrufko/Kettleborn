/**
 * Cloud Save P5 — what the upload queue can carry, and exactly which local
 * columns each record type sends. Record-type names are PROVISIONAL (D1
 * acknowledged for local use only; D1 itself is decided before P6).
 *
 * Every column of every seeded table is listed explicitly — either in
 * `fields` (sent) or in `localOnly` (never sent, with the reason). The
 * inventory test fails when a table or column appears that is not
 * classified here, so nothing can be added and silently left out.
 */

export type EntityType =
  | 'baseline'
  | 'custom_workout'
  | 'timer_preset'
  | 'equipment'
  | 'custom_hunt_preset'
  | 'settings_account'
  | 'hunt_result'
  | 'custom_workout_result'
  | 'timer_result'
  | 'stopwatch_result'
  | 'progress_reset'
  | 'first_clear_claim'
  | 'achievement';

export interface RecordTypeSpec {
  table: string;
  /** How the stable identity (entity_key) is formed from a row. */
  key: (row: any) => string;
  /** SQL that selects rows of this type for one user, in creation (rowid) order. */
  selectAll: string;
  /** SQL that selects one row of this type by its entity_key. */
  selectOne: string;
  /** Columns sent, as payload keys of the same name. */
  fields: readonly string[];
  /** Columns never sent, with why. */
  localOnly: Readonly<Record<string, string>>;
  /** fact = insert-only; record = editable with tombstones; baseline = one-time snapshot. */
  kind: 'fact' | 'record' | 'baseline';
}

const OWNER = 'owner — the server sets it from the signed-in account';

export const RECORD_TYPES: Readonly<Record<EntityType, RecordTypeSpec>> = {
  baseline: {
    table: 'progress_baseline',
    key: (r) => r.uuid,
    selectAll: 'SELECT * FROM progress_baseline WHERE user_id = ? ORDER BY rowid;',
    selectOne: 'SELECT * FROM progress_baseline WHERE user_id = ? AND uuid = ?;',
    fields: [
      'uuid', 'origin_device_uuid', 'epoch', 'created_at', 'total_xp', 'level', 'total_workouts',
      'total_hunts_completed', 'total_monsters_defeated', 'total_volume_kg', 'total_training_minutes',
      'current_streak_days', 'longest_streak_days', 'chronicle_updated_at',
    ],
    localOnly: { user_id: OWNER },
    kind: 'baseline',
  },
  custom_workout: {
    table: 'custom_workout',
    key: (r) => r.uuid,
    selectAll: 'SELECT * FROM custom_workout WHERE user_id = ? ORDER BY rowid;',
    selectOne: 'SELECT * FROM custom_workout WHERE user_id = ? AND uuid = ?;',
    fields: [
      'id', 'name', 'exercises_json', 'weight_kg', 'weight_b_kg', 'gear_count', 'rounds', 'rest_seconds',
      'created_at', 'updated_at', 'uuid', 'deleted_at',
    ],
    localOnly: { user_id: OWNER },
    kind: 'record',
  },
  timer_preset: {
    table: 'timer_preset',
    key: (r) => r.uuid,
    selectAll: 'SELECT * FROM timer_preset WHERE user_id = ? ORDER BY rowid;',
    selectOne: 'SELECT * FROM timer_preset WHERE user_id = ? AND uuid = ?;',
    fields: ['id', 'name', 'rounds_json', 'created_at', 'linked_workout_id', 'randomize_exercises', 'uuid', 'updated_at', 'deleted_at'],
    localOnly: { user_id: OWNER },
    kind: 'record',
  },
  equipment: {
    table: 'equipment',
    key: (r) => r.sync_key,
    selectAll: 'SELECT * FROM equipment WHERE user_id = ? ORDER BY rowid;',
    selectOne: 'SELECT * FROM equipment WHERE user_id = ? AND sync_key = ?;',
    fields: ['id', 'type', 'weight', 'unit', 'label', 'owned', 'uuid', 'updated_at', 'deleted_at', 'sync_key'],
    localOnly: { user_id: OWNER },
    kind: 'record',
  },
  custom_hunt_preset: {
    table: 'custom_hunt_preset',
    key: (r) => r.workout_id,
    selectAll: 'SELECT * FROM custom_hunt_preset WHERE user_id = ? ORDER BY rowid;',
    selectOne: 'SELECT * FROM custom_hunt_preset WHERE user_id = ? AND workout_id = ?;',
    fields: [
      'workout_id', 'weight_kg', 'weight_b_kg', 'gear_count', 'rest_seconds', 'custom_structure_value',
      'reps_overrides_json', 'updated_at',
    ],
    localOnly: { user_id: OWNER },
    kind: 'record',
  },
  settings_account: {
    table: 'settings',
    key: () => 'account',
    selectAll: 'SELECT * FROM settings WHERE user_id = ? ORDER BY rowid;',
    selectOne: "SELECT * FROM settings WHERE user_id = ? AND 'account' = ?;",
    fields: ['unit_preference'],
    localOnly: {
      user_id: OWNER,
      sound_enabled: 'device preference (D7)',
      haptics_enabled: 'device preference (D7)',
      reduce_motion: 'device preference (D7), unused',
      notifications_enabled: 'device preference (D7), unused',
      keep_screen_awake: 'device preference (D7)',
      updated_at: 'covers device fields too; sync uses server versions, not this timestamp',
    },
    kind: 'record',
  },
  hunt_result: {
    table: 'workout_result',
    key: (r) => r.uuid,
    selectAll: 'SELECT * FROM workout_result WHERE user_id = ? ORDER BY rowid;',
    selectOne: 'SELECT * FROM workout_result WHERE user_id = ? AND uuid = ?;',
    fields: [
      'id', 'workout_id', 'monster_id', 'hunt_id', 'completed_at', 'time_minutes', 'time_seconds',
      'weight_value_a', 'weight_value_b', 'weight_unit', 'notes', 'xp_awarded', 'difficulty', 'app_version',
      'rung_times_json', 'rpe', 'is_custom_hunt', 'rest_seconds_used', 'structural_value_used',
      'reps_overrides_used_json', 'extra_sets_json', 'uuid', 'updated_at', 'voided_at', 'void_reset_uuid',
      'first_clear_bonus_xp', 'progression_epoch', 'monster_reset_count', 'volume_kg', 'training_minutes',
      'origin_device_uuid', 'origin_order', 'streak_after', 'tz_offset_minutes', 'pr_bonus_xp',
      'repeat_multiplier', 'prior_clears_seen',
    ],
    localOnly: { user_id: OWNER },
    kind: 'fact',
  },
  custom_workout_result: {
    table: 'custom_workout_result',
    key: (r) => r.uuid,
    selectAll: 'SELECT * FROM custom_workout_result WHERE user_id = ? ORDER BY rowid;',
    selectOne: 'SELECT * FROM custom_workout_result WHERE user_id = ? AND uuid = ?;',
    fields: [
      'id', 'custom_workout_id', 'completed_at', 'elapsed_seconds', 'weight_kg', 'weight_b_kg', 'gear_count',
      'workout_name', 'rounds', 'rest_seconds', 'total_reps', 'exercise_breakdown_json', 'uuid', 'custom_workout_uuid',
    ],
    localOnly: {
      user_id: OWNER,
      deleted_at:
        'derived from the parent custom workout (D9); sent only for an orphan result (custom_workout_uuid NULL), as part of its insert',
    },
    kind: 'fact',
  },
  timer_result: {
    table: 'timer_result',
    key: (r) => r.uuid,
    selectAll: 'SELECT * FROM timer_result WHERE user_id = ? ORDER BY rowid;',
    selectOne: 'SELECT * FROM timer_result WHERE user_id = ? AND uuid = ?;',
    fields: ['id', 'preset_id', 'preset_name', 'total_duration_seconds', 'completed_at', 'weight_kg', 'app_version', 'uuid', 'preset_uuid'],
    localOnly: { user_id: OWNER },
    kind: 'fact',
  },
  stopwatch_result: {
    table: 'stopwatch_result',
    key: (r) => r.uuid,
    selectAll: 'SELECT * FROM stopwatch_result WHERE user_id = ? ORDER BY rowid;',
    selectOne: 'SELECT * FROM stopwatch_result WHERE user_id = ? AND uuid = ?;',
    fields: ['id', 'completed_at', 'elapsed_seconds', 'lap_seconds_json', 'note', 'uuid'],
    localOnly: { user_id: OWNER },
    kind: 'fact',
  },
  progress_reset: {
    table: 'progress_reset',
    key: (r) => r.uuid,
    selectAll: 'SELECT * FROM progress_reset WHERE user_id = ? ORDER BY rowid;',
    selectOne: 'SELECT * FROM progress_reset WHERE user_id = ? AND uuid = ?;',
    fields: [
      'uuid', 'scope', 'monster_id', 'reset_at', 'voided_result_count', 'snapshot_json', 'epoch', 'to_epoch',
      'count_before', 'count_after',
    ],
    localOnly: { user_id: OWNER },
    kind: 'fact',
  },
  first_clear_claim: {
    table: 'first_clear_claim',
    key: (r) => `${r.stage_key}@${r.epoch}`,
    selectAll: 'SELECT * FROM first_clear_claim WHERE user_id = ? ORDER BY rowid;',
    selectOne: "SELECT * FROM first_clear_claim WHERE user_id = ? AND stage_key || '@' || epoch = ?;",
    fields: ['stage_key', 'epoch', 'result_uuid', 'claimed_at', 'status'],
    localOnly: { user_id: OWNER },
    kind: 'fact',
  },
  achievement: {
    table: 'achievement',
    key: (r) => r.milestone_type,
    selectAll: 'SELECT * FROM achievement WHERE user_id = ? ORDER BY rowid;',
    selectOne: 'SELECT * FROM achievement WHERE user_id = ? AND milestone_type = ?;',
    fields: ['milestone_type', 'unlocked_at'],
    localOnly: { user_id: OWNER },
    kind: 'fact',
  },
};

/** First-link seed order (2.0.9 §5): parents before children, results before the claims that need them. */
export const SEED_ORDER: readonly EntityType[] = [
  'baseline',
  'custom_workout',
  'timer_preset',
  'equipment',
  'custom_hunt_preset',
  'settings_account',
  'hunt_result',
  'custom_workout_result',
  'timer_result',
  'stopwatch_result',
  'progress_reset',
  'first_clear_claim',
  'achievement',
];

/** Columns of progress_baseline_monster sent inside the baseline payload (`monsters`). */
export const BASELINE_MONSTER_FIELDS = ['monster_id', 'hunts_completed', 'hunts_total', 'defeated', 'monster_reset_count'] as const;

/**
 * Every table in the local database, classified. A table missing from
 * this map fails the inventory test.
 */
export const TABLE_CLASSIFICATION: Readonly<Record<string, string>> = {
  progress_baseline: 'seeded: baseline',
  progress_baseline_monster: 'seeded inside the baseline payload',
  custom_workout: 'seeded: custom_workout',
  timer_preset: 'seeded: timer_preset',
  equipment: 'seeded: equipment',
  custom_hunt_preset: 'seeded: custom_hunt_preset',
  settings: 'seeded: settings_account (unit only); the rest is device-only',
  workout_result: 'seeded: hunt_result',
  custom_workout_result: 'seeded: custom_workout_result',
  timer_result: 'seeded: timer_result',
  stopwatch_result: 'seeded: stopwatch_result',
  progress_reset: 'seeded: progress_reset',
  first_clear_claim: 'seeded: first_clear_claim',
  achievement: 'seeded: achievement',
  user: 'rebuilt (XP, level, epoch) / not synced (display name, legacy unit, unused campaign id)',
  chronicle: 'rebuilt from baseline + results',
  monster_progress: 'rebuilt from baseline + results',
  campaign_progress: 'unused (no writer)',
  schema_migrations: 'system',
  sync_state: 'system (device identity)',
  sync_outbox: 'system (the queue itself)',
  sync_conflict: 'system (local conflict records)',
  sync_item_version: 'system (last known server version per item)',
  sync_notice: 'system (player notices produced by sync)',
  sqlite_sequence: 'system (SQLite AUTOINCREMENT bookkeeping)',
};
