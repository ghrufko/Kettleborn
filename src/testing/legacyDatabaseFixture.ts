import { migrations } from '../services/db/schema';
import { openTestDatabase } from './nodeSqliteDatabase';

/**
 * Builds a realistic database at schema version 17 — what an existing
 * player's device holds at commit d33ae50, before Cloud Save Phase 1 —
 * using the app's own migrations 1–17 and the same column values the app
 * writes. Used to prove migration 18 preserves every existing value.
 *
 * Deliberately includes the awkward real-world cases:
 * - total_xp (4120) higher than the sum of xp_awarded, as left behind by
 *   an earlier per-monster reset (which deleted results but kept XP);
 * - two results of one workout with an identical completed_at (claim tie);
 * - Custom Hunt overrides, ladder laps, extra sets, RPE and notes;
 * - Custom Workouts with results, a timer preset/result, a stopwatch
 *   session, default + custom equipment, achievements, a Custom Hunt
 *   preset, and a campaign_progress row (nothing writes that table today,
 *   but old installs may hold one).
 */
export const LEGACY_USER = 'local-hunter';

/** The newest schema version the app's migrations produce. */
export const LATEST_VERSION = Math.max(...migrations.map((m) => m.version));

/** Applies the app's migrations (each in its own transaction, recorded in schema_migrations) up to and including `lastVersion`, skipping any already applied. */
export function applyMigrationsUpTo(path: string, lastVersion: number): void {
  const db = openTestDatabase(path);
  db.raw.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY NOT NULL, applied_at TEXT NOT NULL);`);
  const applied = new Set(db.raw.prepare('SELECT version FROM schema_migrations').all().map((r: any) => r.version));
  for (const migration of migrations.filter((m) => m.version <= lastVersion && !applied.has(m.version))) {
    db.raw.exec('BEGIN');
    for (const statement of migration.statements) {
      db.raw.exec(statement);
    }
    db.raw
      .prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?);')
      .run(migration.version, '2026-09-01T00:00:00.000Z');
    db.raw.exec('COMMIT');
  }
  db.raw.close();
}

export function buildVersion17Database(path: string): void {
  applyMigrationsUpTo(path, 17);
  const db = openTestDatabase(path);
  // Synchronous on purpose: a fixture insert error must throw here, loudly.
  const run = (sql: string, ...params: unknown[]) => {
    db.raw.prepare(sql).run(...(params as Array<string | number | null>));
  };
  const u = LEGACY_USER;

  run(
    `INSERT INTO user (id, display_name, created_at, level, total_xp, unit_preference, active_campaign_id)
     VALUES (?, 'Hunter', '2026-08-01T09:00:00.000Z', 7, 4120, 'kg', 'campaign-1');`,
    u
  );
  run(
    `INSERT INTO settings (user_id, unit_preference, sound_enabled, haptics_enabled, reduce_motion, notifications_enabled, keep_screen_awake)
     VALUES (?, 'kg', 1, 0, 0, 1, 1);`,
    u
  );
  for (const [id, weight, label] of [
    ['kb-1', 16, '16 KG'],
    ['kb-2', 16, '16 KG'],
    ['equipment-1757000000000', 24, '24 KG'],
  ] as const) {
    run(`INSERT INTO equipment (id, user_id, type, weight, unit, label, owned) VALUES (?, ?, 'kettlebell', ?, 'kg', ?, 1);`, id, u, weight, label);
  }

  const results: unknown[][] = [
    // id, workout, monster, hunt, completed_at, min, sec, wA, wB, notes, xp, diff, rung, rpe, custom, rest, struct, reps, extras
    ['endless-spiral-1756000000000', 'endless-spiral', 'aether', 'aether-first-encounter', '2026-08-24T07:00:00.000Z', 12, 30, 16, 16, 'Felt strong', 640, 2, null, 3, 0, null, null, null, null],
    ['endless-spiral-1756100000000', 'endless-spiral', 'aether', 'aether-second-encounter', '2026-08-25T07:00:00.000Z', 11, 58, 16, 16, null, 410, 2, null, 2, 0, null, null, null, null],
    ['endless-spiral-1756200000000', 'endless-spiral', 'aether', 'aether-final-hunt', '2026-08-26T07:00:00.000Z', 11, 41, 16, 16, null, 455, 2, null, null, 0, null, null, null, null],
    ['atlas-chain-1756300000000', 'atlas-chain', 'atlas', 'atlas-first-encounter', '2026-08-27T18:30:00.000Z', 20, 5, 20, null, null, 720, 3, null, 4, 1, 90, null, '{"swing":15}', null],
    ['labyrinth-ladder-1756400000000', 'labyrinth-ladder', 'minotaur', 'minotaur-first-encounter', '2026-08-28T06:15:00.000Z', 18, 12, 16, 18, 'Ladder PR attempt', 690, 3, '[{"round":1,"elapsedSeconds":60},{"round":2,"elapsedSeconds":150}]', 3, 0, null, null, null, '[{"id":"extra-1756400000500","exerciseId":"vertical-pullup","reps":8}]'],
    // Same workout, identical completed_at — the first-clear backfill must still produce exactly one claim.
    ['web-of-motion-1756500000000', 'web-of-motion', 'arachne', 'arachne-first-encounter', '2026-08-29T08:00:00.000Z', 14, 0, 16, 16, null, 600, 2, null, null, 0, null, null, null, null],
    ['web-of-motion-1756500000001', 'web-of-motion', 'arachne', 'arachne-second-encounter', '2026-08-29T08:00:00.000Z', 13, 45, 16, 16, null, 420, 2, null, null, 0, null, null, null, null],
  ];
  for (const r of results) {
    run(
      `INSERT INTO workout_result
        (id, user_id, workout_id, monster_id, hunt_id, completed_at, time_minutes, time_seconds,
         weight_value_a, weight_value_b, weight_unit, notes, xp_awarded, difficulty, app_version, rung_times_json, rpe,
         is_custom_hunt, rest_seconds_used, structural_value_used, reps_overrides_used_json, extra_sets_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'kg', ?, ?, ?, '0.1.0', ?, ?, ?, ?, ?, ?, ?);`,
      r[0], u, r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8], r[9], r[10], r[11], r[12], r[13], r[14], r[15], r[16], r[17], r[18]
    );
  }

  for (const [monster, done, total, defeated] of [
    ['aether', 3, 3, 1],
    ['atlas', 1, 3, 0],
    ['minotaur', 1, 3, 0],
    ['arachne', 2, 3, 0],
    ['hydra', 0, 3, 0],
  ] as const) {
    run(`INSERT INTO monster_progress (user_id, monster_id, hunts_completed, hunts_total, defeated) VALUES (?, ?, ?, ?, ?);`, u, monster, done, total, defeated);
  }
  run(`INSERT INTO campaign_progress (user_id, campaign_id, hunts_completed, hunts_total) VALUES (?, 'campaign-1', 7, 30);`, u);
  run(
    `INSERT INTO chronicle (user_id, total_workouts, total_hunts_completed, total_monsters_defeated, total_volume_kg,
       total_training_minutes, longest_streak_days, current_streak_days, updated_at)
     VALUES (?, 9, 9, 1, 48250.5, 141, 6, 2, '2026-08-29T08:00:00.000Z');`,
    u
  );

  run(
    `INSERT INTO custom_hunt_preset (user_id, workout_id, weight_kg, gear_count, rest_seconds, updated_at, custom_structure_value, reps_overrides_json, weight_b_kg)
     VALUES (?, 'atlas-chain', 20, 1, 90, '2026-08-27T18:00:00.000Z', null, '{"swing":15}', null);`,
    u
  );
  run(
    `INSERT INTO custom_workout (id, user_id, name, exercises_json, weight_kg, gear_count, rounds, rest_seconds, created_at, updated_at, weight_b_kg)
     VALUES ('custom-workout-1755000000000', ?, 'Morning Complex', '[{"exerciseId":"swing","reps":10,"order":0}]', 16, 2, 5, 60,
             '2026-08-12T06:00:00.000Z', '2026-08-20T06:00:00.000Z', 16);`,
    u
  );
  for (const [id, at, secs] of [
    ['custom-workout-1755000000000-1755100000000', '2026-08-13T06:30:00.000Z', 900],
    ['custom-workout-1755000000000-1755200000000', '2026-08-14T06:30:00.000Z', 870],
  ] as const) {
    run(
      `INSERT INTO custom_workout_result (id, custom_workout_id, completed_at, elapsed_seconds, weight_kg, gear_count, user_id,
         workout_name, rounds, rest_seconds, total_reps, exercise_breakdown_json, weight_b_kg)
       VALUES (?, 'custom-workout-1755000000000', ?, ?, 16, 2, ?, 'Morning Complex', 5, 60, 50, '[{"name":"Swing","totalReps":50}]', 16);`,
      id, at, secs, u
    );
  }
  run(
    `INSERT INTO timer_preset (id, user_id, name, rounds_json, created_at, linked_workout_id, randomize_exercises)
     VALUES ('custom-1754000000000', ?, 'EMOM 10', '[{"workSeconds":40,"restSeconds":20}]', '2026-08-05T10:00:00.000Z', null, 0);`,
    u
  );
  run(
    `INSERT INTO timer_result (id, user_id, preset_id, preset_name, total_duration_seconds, completed_at, weight_kg, app_version)
     VALUES ('custom-1754000000000-1754100000000', ?, 'custom-1754000000000', 'EMOM 10', 600, '2026-08-06T10:00:00.000Z', 16, '0.1.0');`,
    u
  );
  run(
    `INSERT INTO stopwatch_result (id, user_id, completed_at, elapsed_seconds, lap_seconds_json, note)
     VALUES ('stopwatch-1753000000000', ?, '2026-08-03T12:00:00.000Z', 1234, '[300,610,905]', 'Hill sprints');`,
    u
  );
  for (const [type, at] of [
    ['first-victory', '2026-08-24T07:00:00.000Z'],
    ['first-level-up', '2026-08-24T07:00:00.000Z'],
    ['monster-slayer', '2026-08-26T07:00:00.000Z'],
  ] as const) {
    run(`INSERT INTO achievement (user_id, milestone_type, unlocked_at) VALUES (?, ?, ?);`, u, type, at);
  }
  db.raw.close();
}

/** Every pre-migration-18 table and its primary-key ordering, for before/after comparisons. */
export const LEGACY_TABLES: Record<string, string> = {
  user: 'id',
  settings: 'user_id',
  equipment: 'id',
  workout_result: 'id',
  monster_progress: 'monster_id',
  campaign_progress: 'campaign_id',
  chronicle: 'user_id',
  custom_hunt_preset: 'workout_id',
  custom_workout: 'id',
  custom_workout_result: 'id',
  timer_preset: 'id',
  timer_result: 'id',
  stopwatch_result: 'id',
  achievement: 'milestone_type',
};
