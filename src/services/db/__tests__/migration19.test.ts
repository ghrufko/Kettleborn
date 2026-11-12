import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Cloud Save P2 — migration 19, run by the real migration runner
 * (database.ts) against real SQLite files: copies of the realistic v17
 * fixture, migrated to 18 and then given a reset history written the way
 * the Phase 1 reset code writes it (progress_reset rows in write order,
 * void markers, epoch increments, claims).
 */

const DATABASE_URL = new URL('../database.ts', import.meta.url).href;
const { openTestDatabase } = await import(new URL('../../../testing/nodeSqliteDatabase.ts', import.meta.url).href);
const { buildVersion17Database, applyMigrationsUpTo, LEGACY_USER, LATEST_VERSION } = await import(
  new URL('../../../testing/legacyDatabaseFixture.ts', import.meta.url).href
);
const { DEFAULT_EQUIPMENT_SYNC_KEYS } = await import(new URL('../schema.ts', import.meta.url).href);

const U = LEGACY_USER;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const T = '2026-09-10T12:00:00.000Z';

const workDir = mkdtempSync(join(tmpdir(), 'kettleborn-mig19-'));
const fixturePath = join(workDir, 'fixture-v17.db');
buildVersion17Database(fixturePath);
test.after(() => {
  try {
    rmSync(workDir, { recursive: true, force: true });
  } catch {
    // Best effort on Windows file locks.
  }
});

let copies = 0;
function freshPath(): string {
  copies += 1;
  return join(workDir, `copy-${copies}.db`);
}

/** A copy of the v17 fixture at version 18 — an existing player's database just before migration 19. */
function v18Copy(): string {
  const path = freshPath();
  copyFileSync(fixturePath, path);
  applyMigrationsUpTo(path, 18);
  return path;
}

function mockSqlite(t: any) {
  const state: { path: string; db: any } = { path: '', db: null };
  t.mock.module('expo-sqlite', {
    exports: {
      openDatabaseAsync: async () => {
        state.db = openTestDatabase(state.path);
        return state.db;
      },
    },
  });
  return state;
}

/** One app launch: the real runner over `path`. Returns the open handle. */
async function launch(state: { path: string; db: any }, path: string) {
  state.path = path;
  const { getDatabase } = await import(`${DATABASE_URL}?bust=${Math.random()}`);
  await getDatabase();
  return state.db;
}

/**
 * Writes reset history exactly as Phase 1's resetCampaignProgressAtomically /
 * resetMonsterProgressAtomically do (log row, void markers, epoch increment).
 */
function history(path: string) {
  const db = openTestDatabase(path);
  const raw = db.raw;
  let n = 0;
  const api = {
    raw,
    result(monsterId: string, workoutId: string, completedAt: string): string {
      n += 1;
      const id = `${workoutId}-scenario-${n}`;
      const uuid = `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
      raw
        .prepare(
          `INSERT INTO workout_result (id, user_id, workout_id, monster_id, hunt_id, completed_at, time_minutes, time_seconds,
             weight_value_a, weight_value_b, weight_unit, notes, xp_awarded, difficulty, app_version, uuid, updated_at, first_clear_bonus_xp)
           VALUES (?, ?, ?, ?, ?, ?, 10, 0, 16, 16, 'kg', NULL, 300, 2, '1.0.0', ?, ?, 0)`
        )
        .run(id, U, workoutId, monsterId, `${monsterId}-first-encounter`, completedAt, uuid, completedAt);
      return uuid;
    },
    monsterReset(uuid: string, monsterId: string, resetAt: string) {
      raw
        .prepare(
          `INSERT INTO progress_reset (uuid, user_id, scope, monster_id, reset_at, voided_result_count, snapshot_json)
           VALUES (?, ?, 'monster', ?, ?, 0, '{}')`
        )
        .run(uuid, U, monsterId, resetAt);
      raw
        .prepare(
          `UPDATE workout_result SET voided_at = ?, void_reset_uuid = ?, updated_at = ?
           WHERE user_id = ? AND monster_id = ? AND voided_at IS NULL`
        )
        .run(resetAt, uuid, resetAt, U, monsterId);
    },
    campaignReset(uuid: string, resetAt: string) {
      raw
        .prepare(
          `INSERT INTO progress_reset (uuid, user_id, scope, monster_id, reset_at, voided_result_count, snapshot_json)
           VALUES (?, ?, 'campaign', NULL, ?, 0, '{}')`
        )
        .run(uuid, U, resetAt);
      raw
        .prepare('UPDATE workout_result SET voided_at = ?, void_reset_uuid = ?, updated_at = ? WHERE user_id = ? AND voided_at IS NULL')
        .run(resetAt, uuid, resetAt, U);
      raw.prepare('UPDATE user SET level = 1, total_xp = 0, progression_epoch = progression_epoch + 1 WHERE id = ?').run(U);
    },
    claim(stageKey: string, epoch: number, resultUuid: string) {
      raw
        .prepare('INSERT INTO first_clear_claim (user_id, stage_key, epoch, result_uuid, claimed_at) VALUES (?, ?, ?, ?, ?)')
        .run(U, stageKey, epoch, resultUuid, T);
    },
    close() {
      raw.close();
    },
  };
  return api;
}

const LEGACY_MINOTAUR = 'labyrinth-ladder-1756400000000';

function byId(db: any, id: string) {
  return db.raw.prepare('SELECT * FROM workout_result WHERE id = ?').get(id);
}
function byUuid(db: any, uuid: string) {
  return db.raw.prepare('SELECT * FROM workout_result WHERE uuid = ?').get(uuid);
}
function reset(db: any, uuid: string) {
  const r = db.raw.prepare('SELECT epoch, to_epoch, count_before, count_after FROM progress_reset WHERE uuid = ?').get(uuid);
  return { ...r };
}
function syncState(db: any) {
  return { ...db.raw.prepare('SELECT * FROM sync_state').get() };
}

/** Every value of every table/column that existed before migration 19, in a stable order. */
function snapshotV18(db: any): Record<string, unknown[]> {
  const tables = db.raw
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((r: any) => r.name);
  const out: Record<string, unknown[]> = {};
  for (const table of tables) {
    if (table === 'schema_migrations') continue;
    out[table] = db.raw.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all().map((r: any) => ({ ...r }));
  }
  return out;
}
function project(after: Record<string, unknown[]>, before: Record<string, unknown[]>) {
  const out: Record<string, unknown[]> = {};
  for (const [table, rows] of Object.entries(before)) {
    const cols = rows.length > 0 ? Object.keys(rows[0] as object) : [];
    out[table] = (after[table] ?? []).map((row: any) => Object.fromEntries(cols.map((c) => [c, row[c]])));
  }
  return out;
}

// ---------------------------------------------------------------- legacy fixture

test('legacy install: every existing value is unchanged; sync tables, references, keys and baseline are created exactly', async (t) => {
  const path = v18Copy();
  const pre = openTestDatabase(path);
  const before = snapshotV18(pre);
  pre.raw.close();

  const db = await launch(mockSqlite(t), path);
  assert.deepEqual(project(snapshotV18(db), before), before, 'no pre-existing value changed');

  const state = syncState(db);
  assert.match(state.device_uuid, UUID_V4);
  assert.equal(state.sync_enabled, 0);
  assert.equal(state.sync_blocked_reason, null);
  assert.equal(state.next_origin_order, 1);
  assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM sync_outbox').get().n, 0);
  assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM sync_conflict').get().n, 0);

  // Results: epoch 0 and reset count 0 everywhere; facts recorded from now on are NULL.
  const results = db.raw.prepare('SELECT * FROM workout_result').all();
  assert.equal(results.length, 7);
  for (const r of results) {
    assert.equal(r.progression_epoch, 0);
    assert.equal(r.monster_reset_count, 0);
    for (const c of ['volume_kg', 'training_minutes', 'origin_device_uuid', 'origin_order', 'streak_after',
      'tz_offset_minutes', 'pr_bonus_xp', 'repeat_multiplier', 'prior_clears_seen']) {
      assert.equal(r[c], null, c);
    }
  }
  assert.deepEqual(
    db.raw.prepare('SELECT DISTINCT status FROM first_clear_claim').all().map((r: any) => r.status),
    ['local_final']
  );

  // References to parents.
  const cw = db.raw.prepare('SELECT uuid FROM custom_workout').get().uuid;
  assert.deepEqual(db.raw.prepare('SELECT DISTINCT custom_workout_uuid u FROM custom_workout_result').all().map((r: any) => r.u), [cw]);
  const tr = db.raw.prepare('SELECT t.preset_uuid, p.uuid FROM timer_result t LEFT JOIN timer_preset p ON p.id = t.preset_id').get();
  assert.equal(tr.preset_uuid, tr.uuid);

  // Equipment identity (D8).
  for (const e of db.raw.prepare('SELECT id, uuid, sync_key FROM equipment').all()) {
    assert.equal(e.sync_key, DEFAULT_EQUIPMENT_SYNC_KEYS[e.id] ?? e.uuid, e.id);
  }
  assert.match(DEFAULT_EQUIPMENT_SYNC_KEYS['kb-1'], UUID_V4);
  assert.match(DEFAULT_EQUIPMENT_SYNC_KEYS['kb-2'], UUID_V4);

  // Baseline = the stored counters, exactly.
  const b = db.raw.prepare('SELECT * FROM progress_baseline').all();
  assert.equal(b.length, 1);
  const user = db.raw.prepare('SELECT * FROM user').get();
  const chron = db.raw.prepare('SELECT * FROM chronicle').get();
  assert.equal(b[0].origin_device_uuid, state.device_uuid);
  assert.deepEqual(
    [b[0].epoch, b[0].total_xp, b[0].level, b[0].total_workouts, b[0].total_hunts_completed, b[0].total_monsters_defeated,
      b[0].total_volume_kg, b[0].total_training_minutes, b[0].current_streak_days, b[0].longest_streak_days, b[0].chronicle_updated_at],
    [user.progression_epoch, user.total_xp, user.level, chron.total_workouts, chron.total_hunts_completed,
      chron.total_monsters_defeated, chron.total_volume_kg, chron.total_training_minutes, chron.current_streak_days,
      chron.longest_streak_days, chron.updated_at]
  );
  const bm = db.raw.prepare('SELECT monster_id, hunts_completed, hunts_total, defeated, monster_reset_count FROM progress_baseline_monster ORDER BY monster_id').all().map((r: any) => ({ ...r }));
  const mp = db.raw.prepare('SELECT monster_id, hunts_completed, hunts_total, defeated, 0 AS monster_reset_count FROM monster_progress ORDER BY monster_id').all().map((r: any) => ({ ...r }));
  assert.deepEqual(bm, mp);
  db.raw.close();
});

test('fresh install: sync_state is created, nothing is blocked, and no baseline exists', async (t) => {
  const db = await launch(mockSqlite(t), freshPath());
  assert.equal(syncState(db).sync_blocked_reason, null);
  assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM progress_baseline').get().n, 0);
  assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM progress_baseline_monster').get().n, 0);
  db.raw.close();
});

// ---------------------------------------------------------------- reset backfill

test('two monster resets with identical timestamps: write order decides; voided rows get the count before their reset, active rows the latest', async (t) => {
  const path = v18Copy();
  const h = history(path);
  h.monsterReset('reset-y1', 'minotaur', T); // voids the legacy minotaur result
  const m2 = h.result('minotaur', 'labyrinth-ladder', '2026-09-10T12:00:00.000Z');
  h.monsterReset('reset-y2', 'minotaur', T); // identical reset_at
  const m3 = h.result('minotaur', 'labyrinth-ladder', '2026-09-11T08:00:00.000Z');
  h.close();

  const db = await launch(mockSqlite(t), path);
  assert.equal(syncState(db).sync_blocked_reason, null);
  assert.deepEqual(reset(db, 'reset-y1'), { epoch: 0, to_epoch: null, count_before: 0, count_after: 1 });
  assert.deepEqual(reset(db, 'reset-y2'), { epoch: 0, to_epoch: null, count_before: 1, count_after: 2 });
  assert.deepEqual([byId(db, LEGACY_MINOTAUR).progression_epoch, byId(db, LEGACY_MINOTAUR).monster_reset_count], [0, 0]);
  assert.deepEqual([byUuid(db, m2).progression_epoch, byUuid(db, m2).monster_reset_count], [0, 1]);
  assert.deepEqual([byUuid(db, m3).progression_epoch, byUuid(db, m3).monster_reset_count], [0, 2]);
  // Other monsters are unaffected.
  assert.equal(byId(db, 'endless-spiral-1756000000000').monster_reset_count, 0);
  assert.equal(
    db.raw.prepare("SELECT monster_reset_count FROM progress_baseline_monster WHERE monster_id = 'minotaur'").get().monster_reset_count,
    2
  );
  db.raw.close();
});

test('campaign and monster reset with identical timestamps: write order decides the epoch, in both orders', async (t) => {
  // Order 1: campaign first, then a monster reset in the new epoch.
  const p1 = v18Copy();
  const a = history(p1);
  a.campaignReset('reset-c', T);
  const r1 = a.result('minotaur', 'labyrinth-ladder', '2026-09-10T12:00:00.000Z');
  a.claim('workout:labyrinth-ladder', 1, r1);
  a.monsterReset('reset-y', 'minotaur', T);
  a.close();
  const db1 = await launch(mockSqlite(t), p1);
  assert.equal(syncState(db1).sync_blocked_reason, null);
  assert.deepEqual(reset(db1, 'reset-c'), { epoch: 0, to_epoch: 1, count_before: null, count_after: null });
  assert.deepEqual(reset(db1, 'reset-y'), { epoch: 1, to_epoch: null, count_before: 0, count_after: 1 });
  assert.deepEqual([byId(db1, LEGACY_MINOTAUR).progression_epoch, byId(db1, LEGACY_MINOTAUR).monster_reset_count], [0, 0]);
  assert.deepEqual([byUuid(db1, r1).progression_epoch, byUuid(db1, r1).monster_reset_count], [1, 0]);
  db1.raw.close();
});

test('monster reset then campaign reset with identical timestamps: the monster reset belongs to epoch 0', async (t) => {
  const p2 = v18Copy();
  const b = history(p2);
  b.monsterReset('reset-y', 'minotaur', T);
  b.campaignReset('reset-c', T);
  b.close();
  const db2 = await launch(mockSqlite(t), p2);
  assert.equal(syncState(db2).sync_blocked_reason, null);
  assert.deepEqual(reset(db2, 'reset-y'), { epoch: 0, to_epoch: null, count_before: 0, count_after: 1 });
  assert.deepEqual(reset(db2, 'reset-c'), { epoch: 0, to_epoch: 1, count_before: null, count_after: null });
  assert.deepEqual([byId(db2, LEGACY_MINOTAUR).progression_epoch, byId(db2, LEGACY_MINOTAUR).monster_reset_count], [0, 0]);
  const spiral = byId(db2, 'endless-spiral-1756000000000');
  assert.deepEqual([spiral.progression_epoch, spiral.monster_reset_count], [0, 0]);
  db2.raw.close();
});

test('several monster resets then a campaign reset: counts restart in the new epoch; campaign-voided rows keep the final count of their epoch', async (t) => {
  const path = v18Copy();
  const h = history(path);
  h.monsterReset('reset-y1', 'aether', '2026-09-01T00:00:00.000Z'); // voids the three legacy aether results
  const a1 = h.result('aether', 'endless-spiral', '2026-09-02T00:00:00.000Z');
  h.monsterReset('reset-y2', 'aether', '2026-09-03T00:00:00.000Z');
  const a2 = h.result('aether', 'endless-spiral', '2026-09-04T00:00:00.000Z');
  h.campaignReset('reset-c', '2026-09-05T00:00:00.000Z');
  const a3 = h.result('aether', 'endless-spiral', '2026-09-06T00:00:00.000Z');
  h.claim('workout:endless-spiral', 1, a3);
  h.close();

  const db = await launch(mockSqlite(t), path);
  assert.equal(syncState(db).sync_blocked_reason, null);
  assert.deepEqual(reset(db, 'reset-y1'), { epoch: 0, to_epoch: null, count_before: 0, count_after: 1 });
  assert.deepEqual(reset(db, 'reset-y2'), { epoch: 0, to_epoch: null, count_before: 1, count_after: 2 });
  assert.deepEqual(reset(db, 'reset-c'), { epoch: 0, to_epoch: 1, count_before: null, count_after: null });
  assert.deepEqual([byId(db, 'endless-spiral-1756000000000').progression_epoch, byId(db, 'endless-spiral-1756000000000').monster_reset_count], [0, 0]);
  assert.deepEqual([byUuid(db, a1).progression_epoch, byUuid(db, a1).monster_reset_count], [0, 1]);
  assert.deepEqual([byUuid(db, a2).progression_epoch, byUuid(db, a2).monster_reset_count], [0, 2], 'voided by the campaign reset');
  assert.deepEqual([byUuid(db, a3).progression_epoch, byUuid(db, a3).monster_reset_count], [1, 0], 'active, new epoch');
  // Atlas (never monster-reset) voided by the campaign reset: epoch 0, count 0.
  const atlas = db.raw.prepare("SELECT progression_epoch, monster_reset_count FROM workout_result WHERE monster_id = 'atlas'").get();
  assert.deepEqual({ ...atlas }, { progression_epoch: 0, monster_reset_count: 0 });
  db.raw.close();
});

// ---------------------------------------------------------------- C1

const ANOMALIES: Array<{ name: string; reason: string; build: (h: ReturnType<typeof history>) => void }> = [
  {
    name: 'epoch does not match the logged campaign resets',
    reason: 'campaign_reset_count_mismatch',
    build: (h) => {
      h.monsterReset('reset-y', 'minotaur', T);
      h.raw.prepare('UPDATE user SET progression_epoch = 3').run();
    },
  },
  {
    name: 'the device clock went backwards between resets',
    reason: 'reset_clock_went_backwards',
    build: (h) => {
      h.monsterReset('reset-y1', 'minotaur', '2026-09-10T12:00:00.000Z');
      h.monsterReset('reset-y2', 'aether', '2026-09-09T12:00:00.000Z');
    },
  },
  {
    name: 'a voided result points to a reset that does not exist',
    reason: 'void_without_matching_reset',
    build: (h) => {
      h.monsterReset('reset-y', 'minotaur', T);
      h.raw.prepare(`UPDATE workout_result SET void_reset_uuid = 'missing' WHERE id = '${LEGACY_MINOTAUR}'`).run();
    },
  },
  {
    name: "a claim's epoch differs from its result's epoch",
    reason: 'claim_epoch_mismatch',
    build: (h) => {
      h.monsterReset('reset-y', 'minotaur', T);
      h.raw.prepare("UPDATE first_clear_claim SET epoch = 1 WHERE stage_key = 'workout:atlas-chain'").run();
    },
  },
];

for (const anomaly of ANOMALIES) {
  test(`C1: when ${anomaly.name}, the app still launches; order-dependent values are NULL and sync is blocked`, async (t) => {
    const path = v18Copy();
    const h = history(path);
    anomaly.build(h);
    const before = snapshotV18({ raw: h.raw });
    h.close();

    const db = await launch(mockSqlite(t), path); // must not throw
    assert.deepEqual(
      db.raw.prepare('SELECT MAX(version) v FROM schema_migrations').get().v,
      LATEST_VERSION,
      'migration 19 is applied'
    );
    assert.match(syncState(db).sync_blocked_reason, new RegExp(anomaly.reason));
    assert.deepEqual(project(snapshotV18(db), before), before, 'no pre-existing value changed');

    assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM progress_reset WHERE epoch IS NOT NULL OR count_before IS NOT NULL').get().n, 0);
    assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM workout_result WHERE voided_at IS NOT NULL AND progression_epoch IS NOT NULL').get().n, 0);
    assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM workout_result WHERE monster_reset_count IS NOT NULL').get().n, 0);
    const userEpoch = db.raw.prepare('SELECT progression_epoch FROM user').get().progression_epoch;
    assert.equal(
      db.raw.prepare('SELECT COUNT(*) n FROM workout_result WHERE voided_at IS NULL AND progression_epoch IS NOT ?').get(userEpoch).n,
      0,
      'active results keep the (certain) current epoch'
    );
    assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM progress_baseline').get().n, 1, 'the baseline is still exact');
    assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM progress_baseline_monster WHERE monster_reset_count IS NOT NULL').get().n, 0);
    db.raw.close();
  });
}

// ---------------------------------------------------------------- atomicity and rerun

test('a genuine SQL error in migration 19 rolls everything back to version 18', async (t) => {
  const path = v18Copy();
  const sabotage = openTestDatabase(path);
  sabotage.raw.exec('CREATE TABLE sync_state (unrelated TEXT);'); // makes the device-identity insert fail
  const before = snapshotV18(sabotage);
  sabotage.raw.close();

  await assert.rejects(launch(mockSqlite(t), path));
  const db = openTestDatabase(path);
  assert.equal(db.raw.prepare('SELECT MAX(version) v FROM schema_migrations').get().v, 18);
  const cols = db.raw.prepare('PRAGMA table_info(workout_result)').all().map((c: any) => c.name);
  assert.equal(cols.includes('progression_epoch'), false, 'earlier statements rolled back too');
  assert.deepEqual(snapshotV18(db), before);
  db.raw.close();
});

test('a second launch applies nothing and changes nothing', async (t) => {
  const path = v18Copy();
  const h = history(path);
  h.monsterReset('reset-y', 'minotaur', T);
  h.close();
  const state = mockSqlite(t);
  const first = await launch(state, path);
  const all = (db: any) => snapshotV18(db);
  const once = all(first);
  first.raw.close();
  const second = await launch(state, path);
  assert.deepEqual(all(second), once);
  assert.deepEqual(
    second.raw.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map((r: any) => r.version),
    Array.from({ length: LATEST_VERSION }, (_, i) => i + 1)
  );
  second.raw.close();
});
