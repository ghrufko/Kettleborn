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
];
