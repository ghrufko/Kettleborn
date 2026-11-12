export interface Migration {
  version: number;
  statements: string[];
}

/**
 * Migration 1: initial schema for User, MonsterProgress, CampaignProgress,
 * WorkoutResult, Chronicle, Settings, Equipment.
 */
const migration1: Migration = {
  version: 1,
  statements: [
    `CREATE TABLE IF NOT EXISTS user (
      id TEXT PRIMARY KEY NOT NULL,
      display_name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      level INTEGER NOT NULL DEFAULT 1,
      total_xp INTEGER NOT NULL DEFAULT 0,
      unit_preference TEXT NOT NULL DEFAULT 'kg',
      active_campaign_id TEXT
    );`,
    `CREATE TABLE IF NOT EXISTS monster_progress (
      user_id TEXT NOT NULL,
      monster_id TEXT NOT NULL,
      hunts_completed INTEGER NOT NULL DEFAULT 0,
      hunts_total INTEGER NOT NULL DEFAULT 0,
      defeated INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, monster_id)
    );`,
    `CREATE TABLE IF NOT EXISTS campaign_progress (
      user_id TEXT NOT NULL,
      campaign_id TEXT NOT NULL,
      hunts_completed INTEGER NOT NULL DEFAULT 0,
      hunts_total INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, campaign_id)
    );`,
    `CREATE TABLE IF NOT EXISTS workout_result (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      workout_id TEXT NOT NULL,
      monster_id TEXT NOT NULL,
      hunt_id TEXT NOT NULL,
      completed_at TEXT NOT NULL,
      time_minutes INTEGER NOT NULL,
      time_seconds INTEGER NOT NULL,
      weight_value_a REAL NOT NULL,
      weight_value_b REAL,
      weight_unit TEXT NOT NULL,
      notes TEXT,
      xp_awarded INTEGER NOT NULL DEFAULT 0
    );`,
    `CREATE TABLE IF NOT EXISTS chronicle (
      user_id TEXT PRIMARY KEY NOT NULL,
      total_workouts INTEGER NOT NULL DEFAULT 0,
      total_hunts_completed INTEGER NOT NULL DEFAULT 0,
      total_monsters_defeated INTEGER NOT NULL DEFAULT 0,
      total_volume_kg REAL NOT NULL DEFAULT 0,
      total_training_minutes INTEGER NOT NULL DEFAULT 0,
      longest_streak_days INTEGER NOT NULL DEFAULT 0,
      current_streak_days INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );`,
    `CREATE TABLE IF NOT EXISTS settings (
      user_id TEXT PRIMARY KEY NOT NULL,
      unit_preference TEXT NOT NULL DEFAULT 'kg',
      sound_enabled INTEGER NOT NULL DEFAULT 1,
      haptics_enabled INTEGER NOT NULL DEFAULT 1,
      reduce_motion INTEGER NOT NULL DEFAULT 0,
      notifications_enabled INTEGER NOT NULL DEFAULT 1
    );`,
    `CREATE TABLE IF NOT EXISTS equipment (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      weight REAL NOT NULL,
      unit TEXT NOT NULL,
      label TEXT NOT NULL,
      owned INTEGER NOT NULL DEFAULT 1
    );`,
  ],
};

/**
 * Migration 2 (Sprint 11): Timer subsystem tables, plus two columns on
 * workout_result so future leaderboards have what they need snapshotted
 * at completion time rather than re-derived from (possibly changed) content.
 */
const migration2: Migration = {
  version: 2,
  statements: [
    `CREATE TABLE IF NOT EXISTS timer_preset (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      rounds_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );`,
    `CREATE TABLE IF NOT EXISTS timer_result (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      preset_id TEXT NOT NULL,
      preset_name TEXT NOT NULL,
      total_duration_seconds INTEGER NOT NULL,
      completed_at TEXT NOT NULL,
      weight_kg REAL,
      app_version TEXT NOT NULL
    );`,
    `ALTER TABLE workout_result ADD COLUMN difficulty INTEGER NOT NULL DEFAULT 1;`,
    `ALTER TABLE workout_result ADD COLUMN app_version TEXT NOT NULL DEFAULT '0.0.0';`,
  ],
};

/**
 * Migration 3 (Sprint 12): a real, functional keep-screen-awake setting.
 */
const migration3: Migration = {
  version: 3,
  statements: [
    `ALTER TABLE settings ADD COLUMN keep_screen_awake INTEGER NOT NULL DEFAULT 0;`,
  ],
};

/**
 * Migration 4 (Sprint 12): exercise-linkage columns for timer presets that
 * reuse an existing Hunt workout's exercise list.
 */
const migration4: Migration = {
  version: 4,
  statements: [
    `ALTER TABLE timer_preset ADD COLUMN linked_workout_id TEXT;`,
    `ALTER TABLE timer_preset ADD COLUMN randomize_exercises INTEGER NOT NULL DEFAULT 0;`,
  ],
};

/**
 * Migration 5 (Sprint 24): per-round/rung lap timing for workouts that want
 * it (currently only the Minotaur ladder). Nullable, additive — every
 * existing row and every non-ladder completion going forward just gets
 * NULL here; nothing about existing data changes. Same
 * `ALTER TABLE ... ADD COLUMN` shape as migration2/migration3/migration4.
 */
const migration5: Migration = {
  version: 5,
  statements: [`ALTER TABLE workout_result ADD COLUMN rung_times_json TEXT;`],
};

/**
 * Migration 6: post-Hunt perceived effort (RPE), 1–4. Nullable, additive —
 * same shape as migration5. Set after the row already exists (via a
 * separate UPDATE, not at insert time), since the player picks it on
 * Victory after seeing their result.
 */
const migration6: Migration = {
  version: 6,
  statements: [`ALTER TABLE workout_result ADD COLUMN rpe INTEGER;`],
};

/**
 * Migration 7: Custom Hunt — a per-(user, workout) equipment override
 * (weight/gearCount/rest) the player can set from Hunt Overview, plus a
 * flag on workout_result recording whether a given result used it.
 * Both additive, same shape as every migration before it:
 * - custom_hunt_preset is a brand-new table (CREATE TABLE IF NOT EXISTS),
 *   composite-keyed by (user_id, workout_id) — same pattern already used
 *   by monster_progress/campaign_progress, not a new convention.
 * - is_custom_hunt is a NOT NULL DEFAULT 0 column on the existing
 *   workout_result table, same shape as migration2's difficulty/
 *   app_version columns — every existing row reads as 0 (canonical),
 *   which is the correct interpretation since Custom Hunt didn't exist
 *   when those rows were written.
 */
const migration7: Migration = {
  version: 7,
  statements: [
    `CREATE TABLE IF NOT EXISTS custom_hunt_preset (
      user_id TEXT NOT NULL,
      workout_id TEXT NOT NULL,
      weight_kg REAL NOT NULL,
      gear_count INTEGER NOT NULL DEFAULT 2,
      rest_seconds INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, workout_id)
    );`,
    `ALTER TABLE workout_result ADD COLUMN is_custom_hunt INTEGER NOT NULL DEFAULT 0;`,
  ],
};

/**
 * Task 2 (Custom Training structural parameters — rounds/ladder depth/
 * cycle count). One new nullable column, no NOT NULL/DEFAULT needed:
 * SQLite's ALTER TABLE ADD COLUMN defaults every existing row to NULL
 * automatically, and NULL is exactly the correct meaning here — "no
 * structural customization saved," i.e. canonical structure — so every
 * preset saved before this migration reads back unchanged.
 *
 * One column, not three (customRounds/customLadderMaxRung/
 * customCycleCount): a given workoutId only ever belongs to one
 * structural category (flat XOR ladder XOR cyclical-sectioned), so at
 * most one of those three would ever be non-null for any single preset
 * row — three mostly-empty columns would be exactly the "meaningless
 * null settings" the brief asks to avoid. custom_structure_value's
 * meaning is re-derived from the workout's own structure (see
 * src/utils/customWorkoutStructure.ts) every time it's read, not stored
 * redundantly.
 */
const migration8: Migration = {
  version: 8,
  statements: [`ALTER TABLE custom_hunt_preset ADD COLUMN custom_structure_value INTEGER;`],
};

/**
 * Custom per-exercise rep overrides (weight/kettlebell task). A single
 * nullable JSON-text column, same convention as workout_result's
 * rung_times_json (migration 5) — a variable-shaped map (exerciseId ->
 * custom reps), not a fixed set of scalar columns, since the number of
 * exercises varies per workout. NULL for every row saved before this
 * migration and for any preset that never touched this control, meaning
 * "no rep overrides, use canonical reps."
 */
const migration9: Migration = {
  version: 9,
  statements: [`ALTER TABLE custom_hunt_preset ADD COLUMN reps_overrides_json TEXT;`],
};

/**
 * Custom Workout Builder — two new tables, deliberately separate from
 * workout_result/custom_hunt_preset (see src/models/CustomWorkout.ts for
 * the full reasoning): a user-authored workout has no monster/campaign
 * identity, so it doesn't belong in tables keyed around that concept.
 * exercises_json is a JSON array (id/reps/order per row) — variable
 * length per workout, same "JSON blob for variable-shaped data" pattern
 * as rung_times_json (migration 5) and reps_overrides_json above.
 */
const migration10: Migration = {
  version: 10,
  statements: [
    `CREATE TABLE IF NOT EXISTS custom_workout (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      exercises_json TEXT NOT NULL,
      weight_kg REAL NOT NULL,
      gear_count INTEGER NOT NULL DEFAULT 2,
      rounds INTEGER NOT NULL,
      rest_seconds INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );`,
    `CREATE TABLE IF NOT EXISTS custom_workout_result (
      id TEXT PRIMARY KEY,
      custom_workout_id TEXT NOT NULL,
      completed_at TEXT NOT NULL,
      elapsed_seconds INTEGER NOT NULL,
      weight_kg REAL NOT NULL,
      gear_count INTEGER NOT NULL DEFAULT 2
    );`,
  ],
};

/**
 * Encounter Lock — Custom Hunt merge. Encounter 1 can now be won with
 * either Canonical or Custom Hunt, and Encounter 2/3 must lock to
 * whichever exact configuration Encounter 1 (or the encounter right
 * before them) actually used — including a Custom Hunt's rest/
 * structural-value/reps-overrides, none of which workout_result
 * persisted before now (only CustomHuntPreset did, and that's the
 * player's CURRENT preference, not immutable historical data — see
 * PROJECT_CONTEXT.md §16/§17 and WorkoutResult.ts's own field comments).
 * Three new nullable columns, same additive shape as every migration
 * before it. NULL on every row saved before this migration (canonical
 * AND Custom Hunt alike) — for a canonical result this is simply
 * correct (canonical config is always re-derivable from content, never
 * needed storage), but for a pre-existing CUSTOM Hunt result it means
 * "legacy — exact rest/structure/reps unknown," handled explicitly as
 * such by encounterLock.ts's `isExact` flag rather than silently
 * assumed to be canonical or guessed at.
 */
const migration11: Migration = {
  version: 11,
  statements: [
    `ALTER TABLE workout_result ADD COLUMN rest_seconds_used INTEGER;`,
    `ALTER TABLE workout_result ADD COLUMN structural_value_used INTEGER;`,
    `ALTER TABLE workout_result ADD COLUMN reps_overrides_used_json TEXT;`,
  ],
};

/**
 * Custom Workout results now need to (a) be queryable per-user directly
 * (custom_workout_result had no user_id — every prior read went through
 * getResultsFor(customWorkoutId), which was fine when nothing needed
 * "every Custom Workout result for this user," but the new Journal
 * section does) and (b) carry enough of a snapshot to display in the
 * Journal even if the source CustomWorkout is later edited or deleted —
 * same "snapshot at completion time" reasoning as migration11 above.
 * user_id backfills every existing row to LOCAL_USER_ID (this app is
 * single-local-user only — see src/constants/localUser.ts — so this is
 * exact, not a guess) via DEFAULT, which SQLite applies to existing rows
 * on ADD COLUMN. The rest are nullable: an existing pre-migration result
 * simply displays without a name/breakdown rather than a fabricated one.
 */
const migration12: Migration = {
  version: 12,
  statements: [
    `ALTER TABLE custom_workout_result ADD COLUMN user_id TEXT NOT NULL DEFAULT 'local-hunter';`,
    `ALTER TABLE custom_workout_result ADD COLUMN workout_name TEXT;`,
    `ALTER TABLE custom_workout_result ADD COLUMN rounds INTEGER;`,
    `ALTER TABLE custom_workout_result ADD COLUMN rest_seconds INTEGER;`,
    `ALTER TABLE custom_workout_result ADD COLUMN total_reps INTEGER;`,
    `ALTER TABLE custom_workout_result ADD COLUMN exercise_breakdown_json TEXT;`,
  ],
};

/**
 * Kettlebell weight audit: a Custom Hunt preset's second bell can now be
 * a genuinely different weight from the first (16kg + 18kg), saved and
 * reloaded exactly like weight_kg always was. Nullable/additive, same
 * shape as every migration before it — an existing preset reads back
 * with weight_b_kg = null, meaning "no second-bell preference saved yet"
 * (HuntOverviewScreen falls back to mirroring the first bell's weight
 * the same way it always effectively did before this column existed).
 */
const migration13: Migration = {
  version: 13,
  statements: [`ALTER TABLE custom_hunt_preset ADD COLUMN weight_b_kg REAL;`],
};

/**
 * Kettlebell weight audit: Custom Workout Builder gains the same
 * independent-second-bell support Custom Hunt already has — a single
 * `weightKg` was always treated as "both bells, same weight" whenever
 * `gearCount` was 2. Nullable/additive on both the workout itself
 * (the player's current setting) and its results (a snapshot of what was
 * actually used, same "snapshot at completion time" reasoning as
 * migration12's other Custom Workout Result columns — survives a later
 * edit to the workout's own weight).
 */
const migration14: Migration = {
  version: 14,
  statements: [
    `ALTER TABLE custom_workout ADD COLUMN weight_b_kg REAL;`,
    `ALTER TABLE custom_workout_result ADD COLUMN weight_b_kg REAL;`,
  ],
};

/**
 * Stopwatch (Timer tab, new mode): a freeform running-clock session with
 * laps and an optional note — deliberately its own table, not layered
 * onto custom_workout_result, since a Stopwatch session has no linked
 * CustomWorkout/exercises/weight at all, just elapsed time + laps + a
 * note. Same additive-migration shape as everything before it.
 * lap_seconds_json is a JSON array of cumulative elapsed-seconds-at-lap
 * (not per-lap deltas) — matches how the UI itself timestamps a lap, and
 * per-lap duration is trivially derivable (this lap minus the previous
 * one) whenever it's needed for display, so nothing is stored twice.
 */
const migration15: Migration = {
  version: 15,
  statements: [
    `CREATE TABLE IF NOT EXISTS stopwatch_result (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      completed_at TEXT NOT NULL,
      elapsed_seconds INTEGER NOT NULL,
      lap_seconds_json TEXT,
      note TEXT
    );`,
  ],
};

/**
 * Phase 2.11: persistent achievements. One row per milestone type ever
 * unlocked for this user — `PRIMARY KEY (user_id, milestone_type)` is
 * what makes unlocking idempotent at the schema level: an `INSERT OR
 * IGNORE` for a milestone type that's already unlocked is a silent
 * no-op, never a duplicate row or an overwritten (and therefore wrong)
 * original unlock timestamp. No new concept otherwise — same
 * per-user-scoped small table shape as monster_progress/
 * campaign_progress (migration1).
 */
const migration16: Migration = {
  version: 16,
  statements: [
    `CREATE TABLE IF NOT EXISTS achievement (
      user_id TEXT NOT NULL,
      milestone_type TEXT NOT NULL,
      unlocked_at TEXT NOT NULL,
      PRIMARY KEY (user_id, milestone_type)
    );`,
  ],
};

/**
 * Optional post-Hunt exercises: a nullable JSON-array column, same
 * "JSON blob for variable-shaped, optional data on a result" convention
 * already used by rung_times_json (migration5), reps_overrides_used_json
 * (migration11), and exercise_breakdown_json (migration12) — a variable
 * number of {id, exerciseId, reps} sets, not a fixed set of scalar
 * columns. NULL for every row saved before this migration and for any
 * result the player didn't add extras to; never written as an empty
 * array (see WorkoutResult.extraSets). Does not touch duration, rounds,
 * XP, rank, or any existing column — purely additive.
 */
const migration17: Migration = {
  version: 17,
  statements: [`ALTER TABLE workout_result ADD COLUMN extra_sets_json TEXT;`],
};

/**
 * SQL that evaluates to a fresh RFC 4122 v4 UUID (lowercase, 8-4-4-4-12)
 * per row, built from SQLite's own randomblob() — used only to backfill
 * rows that existed before migration 18. New rows get their UUID from
 * expo-crypto instead (src/utils/uuid.ts). The 13th hex digit is the
 * version (4) and the 17th the variant (8, 9, a or b).
 */
const SQL_UUID_V4 = `(lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
  substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) ||
  substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))))`;

/**
 * Migration 18 (Cloud Save Phase 1): the local data foundation future sync
 * needs. Purely additive — no existing column, value or row is changed or
 * removed (only NULL columns added and then filled), so every pre-existing
 * workout, XP total and progress row reads back exactly as before.
 *
 * Runs inside the runner's single per-migration transaction
 * (database.ts runMigrations): if any statement fails, the whole
 * migration rolls back and the database stays at version 17.
 *
 * 1. Permanent identity: a `uuid` column (unique index) on every table
 *    whose rows are their own records — workout_result, custom_workout,
 *    custom_workout_result, timer_preset, timer_result, stopwatch_result,
 *    equipment. Existing rows are backfilled with a random v4 UUID. Tables
 *    keyed by a natural per-player key (settings, achievement,
 *    custom_hunt_preset, chronicle, monster/campaign_progress, user) don't
 *    get one: two devices must agree on their identity by that key.
 * 2. Change tracking: `updated_at` where rows are edited in place
 *    (workout_result rpe/notes, timer_preset, equipment, settings),
 *    backfilled from the best existing timestamp.
 * 3. Reversible removal: `deleted_at` on records the player can delete
 *    (custom_workout and its results, timer_preset, equipment), and
 *    `voided_at` + `void_reset_uuid` on workout_result, which a progress
 *    reset now marks instead of deleting.
 * 4. First-clear claims (first_clear_claim): one row per (player, stage,
 *    progression epoch) — the record that a stage's first-clear bonus was
 *    granted, so it can never be granted twice for the same epoch. A
 *    future Supabase table can enforce the same primary key across
 *    devices. Backfilled from existing history: every workout already
 *    cleared is claimed (epoch 0) by its earliest result, exactly matching
 *    today's rule that only an empty history earns the bonus.
 *    user.progression_epoch starts at 0; only a full campaign reset (which
 *    also resets XP to 0) advances it.
 * 5. Reset log (progress_reset): one row per reset, with a JSON snapshot of
 *    everything the reset zeroed (XP/level, Chronicle, monster/campaign
 *    progress), so no total silently disappears and a reset is reversible
 *    from data.
 */
const migration18: Migration = {
  version: 18,
  statements: [
    // workout_result
    `ALTER TABLE workout_result ADD COLUMN uuid TEXT;`,
    `ALTER TABLE workout_result ADD COLUMN updated_at TEXT;`,
    `ALTER TABLE workout_result ADD COLUMN voided_at TEXT;`,
    `ALTER TABLE workout_result ADD COLUMN void_reset_uuid TEXT;`,
    `ALTER TABLE workout_result ADD COLUMN first_clear_bonus_xp INTEGER;`,
    `UPDATE workout_result SET uuid = ${SQL_UUID_V4} WHERE uuid IS NULL;`,
    `UPDATE workout_result SET updated_at = completed_at WHERE updated_at IS NULL;`,
    `CREATE UNIQUE INDEX IF NOT EXISTS workout_result_uuid_idx ON workout_result (uuid);`,
    `CREATE INDEX IF NOT EXISTS workout_result_user_active_idx ON workout_result (user_id, voided_at);`,

    // custom_workout (already has updated_at)
    `ALTER TABLE custom_workout ADD COLUMN uuid TEXT;`,
    `ALTER TABLE custom_workout ADD COLUMN deleted_at TEXT;`,
    `UPDATE custom_workout SET uuid = ${SQL_UUID_V4} WHERE uuid IS NULL;`,
    `CREATE UNIQUE INDEX IF NOT EXISTS custom_workout_uuid_idx ON custom_workout (uuid);`,

    // custom_workout_result
    `ALTER TABLE custom_workout_result ADD COLUMN uuid TEXT;`,
    `ALTER TABLE custom_workout_result ADD COLUMN deleted_at TEXT;`,
    `UPDATE custom_workout_result SET uuid = ${SQL_UUID_V4} WHERE uuid IS NULL;`,
    `CREATE UNIQUE INDEX IF NOT EXISTS custom_workout_result_uuid_idx ON custom_workout_result (uuid);`,

    // timer_preset
    `ALTER TABLE timer_preset ADD COLUMN uuid TEXT;`,
    `ALTER TABLE timer_preset ADD COLUMN updated_at TEXT;`,
    `ALTER TABLE timer_preset ADD COLUMN deleted_at TEXT;`,
    `UPDATE timer_preset SET uuid = ${SQL_UUID_V4} WHERE uuid IS NULL;`,
    `UPDATE timer_preset SET updated_at = created_at WHERE updated_at IS NULL;`,
    `CREATE UNIQUE INDEX IF NOT EXISTS timer_preset_uuid_idx ON timer_preset (uuid);`,

    // timer_result
    `ALTER TABLE timer_result ADD COLUMN uuid TEXT;`,
    `UPDATE timer_result SET uuid = ${SQL_UUID_V4} WHERE uuid IS NULL;`,
    `CREATE UNIQUE INDEX IF NOT EXISTS timer_result_uuid_idx ON timer_result (uuid);`,

    // stopwatch_result
    `ALTER TABLE stopwatch_result ADD COLUMN uuid TEXT;`,
    `UPDATE stopwatch_result SET uuid = ${SQL_UUID_V4} WHERE uuid IS NULL;`,
    `CREATE UNIQUE INDEX IF NOT EXISTS stopwatch_result_uuid_idx ON stopwatch_result (uuid);`,

    // equipment (no existing timestamp — the migration time is the best known)
    `ALTER TABLE equipment ADD COLUMN uuid TEXT;`,
    `ALTER TABLE equipment ADD COLUMN updated_at TEXT;`,
    `ALTER TABLE equipment ADD COLUMN deleted_at TEXT;`,
    `UPDATE equipment SET uuid = ${SQL_UUID_V4} WHERE uuid IS NULL;`,
    `UPDATE equipment SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE updated_at IS NULL;`,
    `CREATE UNIQUE INDEX IF NOT EXISTS equipment_uuid_idx ON equipment (uuid);`,

    // settings
    `ALTER TABLE settings ADD COLUMN updated_at TEXT;`,
    `UPDATE settings SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE updated_at IS NULL;`,

    // progression epoch
    `ALTER TABLE user ADD COLUMN progression_epoch INTEGER NOT NULL DEFAULT 0;`,

    // first-clear claims
    `CREATE TABLE IF NOT EXISTS first_clear_claim (
      user_id TEXT NOT NULL,
      stage_key TEXT NOT NULL,
      epoch INTEGER NOT NULL,
      result_uuid TEXT NOT NULL,
      claimed_at TEXT NOT NULL,
      PRIMARY KEY (user_id, stage_key, epoch)
    );`,
    `INSERT OR IGNORE INTO first_clear_claim (user_id, stage_key, epoch, result_uuid, claimed_at)
     SELECT r.user_id, 'workout:' || r.workout_id, 0, r.uuid, r.completed_at
     FROM workout_result r
     WHERE r.completed_at = (
       SELECT MIN(r2.completed_at) FROM workout_result r2
       WHERE r2.user_id = r.user_id AND r2.workout_id = r.workout_id
     )
     ORDER BY r.completed_at, r.id;`,

    // reset log
    `CREATE TABLE IF NOT EXISTS progress_reset (
      uuid TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      scope TEXT NOT NULL,
      monster_id TEXT,
      reset_at TEXT NOT NULL,
      voided_result_count INTEGER NOT NULL,
      snapshot_json TEXT NOT NULL
    );`,
  ],
};

/**
 * Cloud Save P2 (decision D8): the two default kettlebells (kb-1/kb-2,
 * seeded identically on every install by settingsSlice.loadEquipment) get
 * the same well-known sync identity everywhere, so they never sync as
 * duplicates. Valid v4 UUIDs ("6b62" is "kb" in hex). Every other bell's
 * sync_key is its own uuid.
 */
export const DEFAULT_EQUIPMENT_SYNC_KEYS: Readonly<Record<string, string>> = {
  'kb-1': '6b620001-0000-4000-8000-000000000001',
  'kb-2': '6b620002-0000-4000-8000-000000000002',
};

/** Users whose reset history failed a consistency check (filled during migration 19 only). */
const L19_ANOMALOUS = 'SELECT user_id FROM l19_anomaly';

/**
 * Migration 19 (Cloud Save P2): the local metadata future sync needs.
 * Purely additive — new nullable columns and new tables; no existing value
 * is changed. Decisions D3 (schema only), D5, D6, D8, D9, D14 and C1.
 *
 * 1. Device identity and the (inactive) upload queue: sync_state (one row,
 *    sync_enabled = 0), sync_outbox, sync_conflict.
 * 2. Per-result facts recorded from now on (NULL on older rows):
 *    contributions, streak decision, origin, XP breakdown. Plus two
 *    backfilled columns: progression_epoch and monster_reset_count.
 * 3. Reset history: progress_reset gains epoch / to_epoch (campaign) and
 *    count_before / count_after (monster), backfilled in rowid order —
 *    the order the rows were written on this one device (the app never
 *    deletes from progress_reset and never runs VACUUM).
 * 4. first_clear_claim.status — every existing claim is 'local_final'.
 * 5. uuid references from custom-workout results and timer results to
 *    their parents; equipment.sync_key (D8).
 * 6. progress_baseline (+ per-monster rows): an exact snapshot of every
 *    stored counter, created only when the install has any progress.
 *
 * C1: an inconsistent reset history never stops the app. Each check that
 * fails records a reason; for that user every value that depends on the
 * reset order is set to NULL (never guessed), and
 * sync_state.sync_blocked_reason records why. Active results' epoch is
 * kept — every active result belongs to the current epoch by definition.
 * A genuine SQL error still rolls the whole migration back (runner).
 */
const migration19: Migration = {
  version: 19,
  statements: [
    // 1. device identity, queue, conflicts
    `CREATE TABLE IF NOT EXISTS sync_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      device_uuid TEXT NOT NULL,
      linked_user_id TEXT,
      sync_enabled INTEGER NOT NULL DEFAULT 0,
      next_origin_order INTEGER NOT NULL DEFAULT 1,
      pull_cursor INTEGER,
      linked_at TEXT,
      last_sync_at TEXT,
      sync_blocked_reason TEXT
    );`,
    `INSERT OR IGNORE INTO sync_state (id, device_uuid) VALUES (1, ${SQL_UUID_V4});`,
    `CREATE TABLE IF NOT EXISTS sync_outbox (
      device_seq INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL,
      entity_key TEXT NOT NULL,
      field TEXT,
      op TEXT NOT NULL CHECK (op IN ('insert', 'update', 'delete')),
      payload_json TEXT NOT NULL,
      base_seq INTEGER,
      state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'in_flight', 'quarantined')),
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      last_attempt_at TEXT,
      last_error TEXT
    );`,
    `CREATE INDEX IF NOT EXISTS sync_outbox_item_idx ON sync_outbox (entity_type, entity_key, field, state);`,
    `CREATE TABLE IF NOT EXISTS sync_conflict (
      conflict_uuid TEXT PRIMARY KEY NOT NULL,
      entity_type TEXT NOT NULL,
      entity_key TEXT NOT NULL,
      field TEXT,
      local_value_json TEXT NOT NULL,
      local_device_seq INTEGER NOT NULL,
      base_seq INTEGER,
      server_value_json TEXT,
      server_seq INTEGER,
      detected_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'kept_server', 'restored_local'))
    );`,

    // 2. per-result columns
    `ALTER TABLE workout_result ADD COLUMN progression_epoch INTEGER;`,
    `ALTER TABLE workout_result ADD COLUMN monster_reset_count INTEGER;`,
    `ALTER TABLE workout_result ADD COLUMN volume_kg REAL;`,
    `ALTER TABLE workout_result ADD COLUMN training_minutes INTEGER;`,
    `ALTER TABLE workout_result ADD COLUMN origin_device_uuid TEXT;`,
    `ALTER TABLE workout_result ADD COLUMN origin_order INTEGER;`,
    `ALTER TABLE workout_result ADD COLUMN streak_after INTEGER;`,
    `ALTER TABLE workout_result ADD COLUMN tz_offset_minutes INTEGER;`,
    `ALTER TABLE workout_result ADD COLUMN pr_bonus_xp INTEGER;`,
    `ALTER TABLE workout_result ADD COLUMN repeat_multiplier REAL;`,
    `ALTER TABLE workout_result ADD COLUMN prior_clears_seen INTEGER;`,

    // 3. reset history columns
    `ALTER TABLE progress_reset ADD COLUMN epoch INTEGER;`,
    `ALTER TABLE progress_reset ADD COLUMN to_epoch INTEGER;`,
    `ALTER TABLE progress_reset ADD COLUMN count_before INTEGER;`,
    `ALTER TABLE progress_reset ADD COLUMN count_after INTEGER;`,

    // 4. claim status
    `ALTER TABLE first_clear_claim ADD COLUMN status TEXT NOT NULL DEFAULT 'local_final';`,

    // 5. references and equipment identity
    `ALTER TABLE custom_workout_result ADD COLUMN custom_workout_uuid TEXT;`,
    `UPDATE custom_workout_result SET custom_workout_uuid =
       (SELECT w.uuid FROM custom_workout w WHERE w.id = custom_workout_result.custom_workout_id);`,
    `ALTER TABLE timer_result ADD COLUMN preset_uuid TEXT;`,
    `UPDATE timer_result SET preset_uuid = (SELECT p.uuid FROM timer_preset p WHERE p.id = timer_result.preset_id);`,
    `ALTER TABLE equipment ADD COLUMN sync_key TEXT;`,
    `UPDATE equipment SET sync_key = CASE id
       WHEN 'kb-1' THEN '${DEFAULT_EQUIPMENT_SYNC_KEYS['kb-1']}'
       WHEN 'kb-2' THEN '${DEFAULT_EQUIPMENT_SYNC_KEYS['kb-2']}'
       ELSE uuid END;`,
    `CREATE UNIQUE INDEX IF NOT EXISTS equipment_sync_key_idx ON equipment (user_id, sync_key);`,

    // Reset order: rowid = write order on this device. epoch_at = number of
    // campaign resets written before this row (= the epoch in effect).
    `CREATE TEMP TABLE l19_reset AS
       SELECT r.rowid AS rid, r.uuid, r.user_id, r.scope, r.monster_id, r.reset_at FROM progress_reset r;`,
    `CREATE TEMP TABLE l19_reset_calc AS
       SELECT r.*,
         (SELECT COUNT(*) FROM l19_reset c WHERE c.user_id = r.user_id AND c.scope = 'campaign' AND c.rid < r.rid) AS epoch_at
       FROM l19_reset r;`,
    `CREATE TEMP TABLE l19_reset_final AS
       SELECT c.*,
         CASE WHEN c.scope = 'monster' THEN
           (SELECT COUNT(*) FROM l19_reset_calc m
            WHERE m.user_id = c.user_id AND m.scope = 'monster' AND m.monster_id = c.monster_id
              AND m.epoch_at = c.epoch_at AND m.rid < c.rid)
         END AS count_before
       FROM l19_reset_calc c;`,

    `UPDATE progress_reset SET
       epoch = (SELECT f.epoch_at FROM l19_reset_final f WHERE f.uuid = progress_reset.uuid),
       to_epoch = (SELECT CASE WHEN f.scope = 'campaign' THEN f.epoch_at + 1 END FROM l19_reset_final f WHERE f.uuid = progress_reset.uuid),
       count_before = (SELECT f.count_before FROM l19_reset_final f WHERE f.uuid = progress_reset.uuid),
       count_after = (SELECT f.count_before + 1 FROM l19_reset_final f WHERE f.uuid = progress_reset.uuid);`,

    // Active results: the current epoch, and the monster's reset count now.
    `UPDATE workout_result SET
       progression_epoch = (SELECT u.progression_epoch FROM user u WHERE u.id = workout_result.user_id),
       monster_reset_count = (SELECT COUNT(*) FROM l19_reset_final f
         WHERE f.user_id = workout_result.user_id AND f.scope = 'monster' AND f.monster_id = workout_result.monster_id
           AND f.epoch_at = (SELECT u.progression_epoch FROM user u WHERE u.id = workout_result.user_id))
     WHERE voided_at IS NULL AND EXISTS (SELECT 1 FROM user u WHERE u.id = workout_result.user_id);`,
    // Voided by a campaign reset X: X's epoch, and the monster's count when X happened.
    `UPDATE workout_result SET
       progression_epoch = (SELECT f.epoch_at FROM l19_reset_final f WHERE f.uuid = workout_result.void_reset_uuid),
       monster_reset_count = (SELECT COUNT(*) FROM l19_reset_final m
         WHERE m.user_id = workout_result.user_id AND m.scope = 'monster' AND m.monster_id = workout_result.monster_id
           AND m.epoch_at = (SELECT f.epoch_at FROM l19_reset_final f WHERE f.uuid = workout_result.void_reset_uuid))
     WHERE voided_at IS NOT NULL
       AND EXISTS (SELECT 1 FROM l19_reset_final f WHERE f.uuid = workout_result.void_reset_uuid AND f.scope = 'campaign');`,
    // Voided by a monster reset Y: Y's epoch, and the count immediately before Y.
    `UPDATE workout_result SET
       progression_epoch = (SELECT f.epoch_at FROM l19_reset_final f WHERE f.uuid = workout_result.void_reset_uuid),
       monster_reset_count = (SELECT f.count_before FROM l19_reset_final f WHERE f.uuid = workout_result.void_reset_uuid)
     WHERE voided_at IS NOT NULL
       AND EXISTS (SELECT 1 FROM l19_reset_final f WHERE f.uuid = workout_result.void_reset_uuid AND f.scope = 'monster'
                   AND f.monster_id = workout_result.monster_id);`,

    // C1 consistency checks — each failure is recorded, never thrown.
    `CREATE TEMP TABLE l19_anomaly (user_id TEXT, reason TEXT);`,
    `INSERT INTO l19_anomaly SELECT u.id, 'campaign_reset_count_mismatch' FROM user u
     WHERE u.progression_epoch <> (SELECT COUNT(*) FROM l19_reset r WHERE r.user_id = u.id AND r.scope = 'campaign');`,
    `INSERT INTO l19_anomaly SELECT DISTINCT r.user_id, 'reset_without_user' FROM l19_reset r
     WHERE NOT EXISTS (SELECT 1 FROM user u WHERE u.id = r.user_id);`,
    `INSERT INTO l19_anomaly SELECT DISTINCT a.user_id, 'reset_clock_went_backwards'
     FROM l19_reset a JOIN l19_reset b ON b.user_id = a.user_id AND b.rid > a.rid AND b.reset_at < a.reset_at;`,
    `INSERT INTO l19_anomaly SELECT DISTINCT user_id, 'reset_malformed' FROM l19_reset
     WHERE scope NOT IN ('campaign', 'monster') OR (scope = 'monster' AND monster_id IS NULL);`,
    `INSERT INTO l19_anomaly SELECT DISTINCT w.user_id, 'void_without_matching_reset' FROM workout_result w
     WHERE (w.voided_at IS NULL) <> (w.void_reset_uuid IS NULL)
        OR (w.void_reset_uuid IS NOT NULL AND NOT EXISTS (
             SELECT 1 FROM l19_reset r WHERE r.uuid = w.void_reset_uuid AND r.user_id = w.user_id
               AND (r.scope = 'campaign' OR (r.scope = 'monster' AND r.monster_id = w.monster_id))));`,
    `INSERT INTO l19_anomaly SELECT DISTINCT w.user_id, 'result_without_user' FROM workout_result w
     WHERE NOT EXISTS (SELECT 1 FROM user u WHERE u.id = w.user_id);`,
    `INSERT INTO l19_anomaly SELECT DISTINCT c.user_id, 'claim_epoch_mismatch' FROM first_clear_claim c
     JOIN workout_result w ON w.uuid = c.result_uuid
     WHERE w.progression_epoch IS NOT NULL AND c.epoch <> w.progression_epoch;`,

    // For an anomalous user, every order-dependent value becomes NULL.
    `UPDATE progress_reset SET epoch = NULL, to_epoch = NULL, count_before = NULL, count_after = NULL
     WHERE user_id IN (${L19_ANOMALOUS});`,
    `UPDATE workout_result SET progression_epoch = NULL, monster_reset_count = NULL
     WHERE voided_at IS NOT NULL AND user_id IN (${L19_ANOMALOUS});`,
    `UPDATE workout_result SET monster_reset_count = NULL WHERE voided_at IS NULL AND user_id IN (${L19_ANOMALOUS});`,
    `UPDATE sync_state SET sync_blocked_reason = (SELECT group_concat(DISTINCT reason) FROM l19_anomaly) WHERE id = 1;`,

    // 6. baseline: an exact snapshot of the stored counters (only if there is any progress).
    `CREATE TABLE IF NOT EXISTS progress_baseline (
      uuid TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      origin_device_uuid TEXT NOT NULL,
      epoch INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      total_xp INTEGER NOT NULL,
      level INTEGER NOT NULL,
      total_workouts INTEGER NOT NULL,
      total_hunts_completed INTEGER NOT NULL,
      total_monsters_defeated INTEGER NOT NULL,
      total_volume_kg REAL NOT NULL,
      total_training_minutes INTEGER NOT NULL,
      current_streak_days INTEGER NOT NULL,
      longest_streak_days INTEGER NOT NULL,
      chronicle_updated_at TEXT
    );`,
    `CREATE TABLE IF NOT EXISTS progress_baseline_monster (
      baseline_uuid TEXT NOT NULL,
      monster_id TEXT NOT NULL,
      hunts_completed INTEGER NOT NULL,
      hunts_total INTEGER NOT NULL,
      defeated INTEGER NOT NULL,
      monster_reset_count INTEGER,
      PRIMARY KEY (baseline_uuid, monster_id)
    );`,
    `INSERT INTO progress_baseline
       (uuid, user_id, origin_device_uuid, epoch, created_at, total_xp, level, total_workouts, total_hunts_completed,
        total_monsters_defeated, total_volume_kg, total_training_minutes, current_streak_days, longest_streak_days,
        chronicle_updated_at)
     SELECT ${SQL_UUID_V4}, u.id, (SELECT device_uuid FROM sync_state WHERE id = 1), u.progression_epoch,
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), u.total_xp, u.level,
       COALESCE(c.total_workouts, 0), COALESCE(c.total_hunts_completed, 0), COALESCE(c.total_monsters_defeated, 0),
       COALESCE(c.total_volume_kg, 0), COALESCE(c.total_training_minutes, 0),
       COALESCE(c.current_streak_days, 0), COALESCE(c.longest_streak_days, 0), c.updated_at
     FROM user u LEFT JOIN chronicle c ON c.user_id = u.id
     WHERE u.total_xp <> 0 OR u.level <> 1
        OR COALESCE(c.total_workouts, 0) <> 0 OR COALESCE(c.total_hunts_completed, 0) <> 0
        OR COALESCE(c.total_monsters_defeated, 0) <> 0 OR COALESCE(c.total_volume_kg, 0) <> 0
        OR COALESCE(c.total_training_minutes, 0) <> 0 OR COALESCE(c.current_streak_days, 0) <> 0
        OR COALESCE(c.longest_streak_days, 0) <> 0
        OR EXISTS (SELECT 1 FROM monster_progress m WHERE m.user_id = u.id AND (m.hunts_completed <> 0 OR m.defeated <> 0));`,
    `INSERT INTO progress_baseline_monster (baseline_uuid, monster_id, hunts_completed, hunts_total, defeated, monster_reset_count)
     SELECT b.uuid, m.monster_id, m.hunts_completed, m.hunts_total, m.defeated,
       CASE WHEN b.user_id IN (${L19_ANOMALOUS}) THEN NULL ELSE
         (SELECT COUNT(*) FROM l19_reset_final f
          WHERE f.user_id = b.user_id AND f.scope = 'monster' AND f.monster_id = m.monster_id AND f.epoch_at = b.epoch)
       END
     FROM progress_baseline b JOIN monster_progress m ON m.user_id = b.user_id;`,

    `DROP TABLE l19_anomaly;`,
    `DROP TABLE l19_reset_final;`,
    `DROP TABLE l19_reset_calc;`,
    `DROP TABLE l19_reset;`,
  ],
};

/**
 * Migration 20 (Cloud Save P7, "L20"): what the sync engine needs to
 * remember locally. Purely additive; both tables start empty and stay
 * empty until an install is linked to an account.
 * - sync_item_version: the last server version (server_seq) this device
 *   knows for each synced item — the base a new edit is checked against.
 *   field = '' for a whole record, 'notes' / 'rpe' for a hunt's fields.
 * - sync_notice: player-facing notices produced by a sync (a campaign reset
 *   made on another device, totals recalculated), kept until dismissed so
 *   closing the app can never lose one.
 */
const migration20: Migration = {
  version: 20,
  statements: [
    `CREATE TABLE IF NOT EXISTS sync_item_version (
      entity_type TEXT NOT NULL,
      entity_key TEXT NOT NULL,
      field TEXT NOT NULL DEFAULT '',
      server_seq INTEGER NOT NULL,
      PRIMARY KEY (entity_type, entity_key, field)
    );`,
    `CREATE TABLE IF NOT EXISTS sync_notice (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      data_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      dismissed_at TEXT
    );`,
  ],
};

export const migrations: Migration[] = [
  migration1,
  migration2,
  migration3,
  migration4,
  migration5,
  migration6,
  migration7,
  migration8,
  migration9,
  migration10,
  migration11,
  migration12,
  migration13,
  migration14,
  migration15,
  migration16,
  migration17,
  migration18,
  migration19,
  migration20,
];
