import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DATABASE_URL = new URL('../database.ts', import.meta.url).href;
const { openTestDatabase } = await import(new URL('../../../testing/nodeSqliteDatabase.ts', import.meta.url).href);
const { buildVersion17Database, LEGACY_TABLES, LEGACY_USER, LATEST_VERSION } = await import(
  new URL('../../../testing/legacyDatabaseFixture.ts', import.meta.url).href
);

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UUID_TABLES = [
  'workout_result',
  'custom_workout',
  'custom_workout_result',
  'timer_preset',
  'timer_result',
  'stopwatch_result',
  'equipment',
];

/** A realistic v17 database, built once, copied fresh for every test (the original is never migrated). */
const workDir = mkdtempSync(join(tmpdir(), 'kettleborn-mig18-'));
const fixturePath = join(workDir, 'fixture-v17.db');
buildVersion17Database(fixturePath);
test.after(() => {
  try {
    rmSync(workDir, { recursive: true, force: true });
  } catch {
    // Best effort: Windows can hold a lock on a just-closed SQLite file.
  }
});

let copyCount = 0;
function freshCopy(): string {
  copyCount += 1;
  const path = join(workDir, `copy-${copyCount}.db`);
  copyFileSync(fixturePath, path);
  return path;
}

/**
 * Mocks expo-sqlite once per test (Node allows one mock per module per
 * test) so that each "app launch" — a fresh import of database.ts — opens
 * whatever file the test points it at.
 */
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

/** One app launch: the real migration runner (database.ts getDatabase) over `path`. Returns the open handle. */
async function launch(state: { path: string; db: any }, path: string) {
  state.path = path;
  const { getDatabase } = await import(`${DATABASE_URL}?bust=${Math.random()}`);
  await getDatabase();
  return state.db;
}

async function migrate(t: any, path: string) {
  return launch(mockSqlite(t), path);
}

function legacyColumns(db: any, table: string): string[] {
  return db.raw.prepare(`PRAGMA table_info(${table})`).all().map((c: any) => c.name);
}

function snapshot(db: any, columnsByTable: Record<string, string[]>) {
  const out: Record<string, unknown[]> = {};
  for (const [table, orderBy] of Object.entries(LEGACY_TABLES as Record<string, string>)) {
    const cols = columnsByTable[table].join(', ');
    out[table] = db.raw.prepare(`SELECT ${cols} FROM ${table} ORDER BY ${orderBy}`).all().map((r: any) => ({ ...r }));
  }
  return out;
}

function versions(db: any): number[] {
  return db.raw.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map((r: any) => r.version);
}

test('every pre-existing value — XP, level, history, progression, settings — is byte-for-byte unchanged', async (t) => {
  const path = freshCopy();
  const before = openTestDatabase(path);
  const columnsByTable = Object.fromEntries(Object.keys(LEGACY_TABLES).map((tb) => [tb, legacyColumns(before, tb)]));
  const expected = snapshot(before, columnsByTable);
  before.raw.close();

  const db = await migrate(t, path);
  assert.deepEqual(snapshot(db, columnsByTable), expected);
  // Spot-check the values most at risk of silent change.
  const user = db.raw.prepare('SELECT level, total_xp, progression_epoch FROM user').get();
  assert.deepEqual({ ...user }, { level: 7, total_xp: 4120, progression_epoch: 0 });
  assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM workout_result').get().n, 7);
  db.raw.close();
});

test('UUID backfill: every row of every synced table gets a distinct v4 UUID, enforced by a unique index', async (t) => {
  const db = await migrate(t, freshCopy());
  const all: string[] = [];
  for (const table of UUID_TABLES) {
    const rows = db.raw.prepare(`SELECT uuid FROM ${table}`).all();
    assert.ok(rows.length > 0, `${table} fixture has rows`);
    for (const { uuid } of rows) {
      assert.match(uuid, UUID_V4, `${table}.uuid`);
      all.push(uuid);
    }
    const index = db.raw.prepare(`PRAGMA index_list(${table})`).all().find((i: any) => i.name === `${table}_uuid_idx`);
    assert.equal(index?.unique, 1, `${table} has a unique uuid index`);
  }
  assert.equal(new Set(all).size, all.length, 'no UUID repeats across any table');
  assert.throws(() =>
    db.raw.prepare('UPDATE workout_result SET uuid = (SELECT uuid FROM workout_result LIMIT 1)').run()
  );
  db.raw.close();
});

test('updated_at is backfilled from the best existing timestamp; deletion/void markers start empty', async (t) => {
  const db = await migrate(t, freshCopy());
  const mismatched = db.raw.prepare('SELECT COUNT(*) n FROM workout_result WHERE updated_at IS NOT completed_at').get().n;
  assert.equal(mismatched, 0);
  assert.equal(db.raw.prepare('SELECT updated_at FROM timer_preset').get().updated_at, '2026-08-05T10:00:00.000Z');
  for (const table of ['equipment', 'settings']) {
    assert.equal(db.raw.prepare(`SELECT COUNT(*) n FROM ${table} WHERE updated_at IS NULL`).get().n, 0, table);
  }
  for (const [table, column] of [
    ['workout_result', 'voided_at'],
    ['custom_workout', 'deleted_at'],
    ['custom_workout_result', 'deleted_at'],
    ['timer_preset', 'deleted_at'],
    ['equipment', 'deleted_at'],
  ]) {
    assert.equal(db.raw.prepare(`SELECT COUNT(*) n FROM ${table} WHERE ${column} IS NOT NULL`).get().n, 0, `${table}.${column}`);
  }
  assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM workout_result WHERE first_clear_bonus_xp IS NOT NULL').get().n, 0);
  db.raw.close();
});

test('first-clear claims are backfilled once per cleared workout, from its earliest result (ties included)', async (t) => {
  const db = await migrate(t, freshCopy());
  const claims = db.raw
    .prepare('SELECT stage_key, epoch, result_uuid FROM first_clear_claim WHERE user_id = ? ORDER BY stage_key')
    .all(LEGACY_USER);
  assert.deepEqual(
    claims.map((c: any) => c.stage_key),
    ['workout:atlas-chain', 'workout:endless-spiral', 'workout:labyrinth-ladder', 'workout:web-of-motion']
  );
  assert.ok(claims.every((c: any) => c.epoch === 0));
  const earliestSpiral = db.raw.prepare(`SELECT uuid FROM workout_result WHERE id = 'endless-spiral-1756000000000'`).get().uuid;
  assert.equal(claims.find((c: any) => c.stage_key === 'workout:endless-spiral').result_uuid, earliestSpiral);
  db.raw.close();
});

test('idempotent: re-running the runner applies nothing twice and changes no UUID', async (t) => {
  const path = freshCopy();
  const sqlite = mockSqlite(t);
  const first = await launch(sqlite, path);
  const uuidsBefore = first.raw.prepare('SELECT id, uuid FROM workout_result ORDER BY id').all().map((r: any) => ({ ...r }));
  first.raw.close();

  const second = await launch(sqlite, path); // a later app launch
  assert.deepEqual(versions(second), Array.from({ length: LATEST_VERSION }, (_, i) => i + 1));
  assert.deepEqual(
    second.raw.prepare('SELECT id, uuid FROM workout_result ORDER BY id').all().map((r: any) => ({ ...r })),
    uuidsBefore
  );
  // The backfill statements themselves are also safe to repeat.
  second.raw.exec(`UPDATE workout_result SET uuid = 'should-not-apply' WHERE uuid IS NULL;`);
  assert.equal(second.raw.prepare(`SELECT COUNT(*) n FROM workout_result WHERE uuid = 'should-not-apply'`).get().n, 0);
  second.raw.close();
});

test('atomic: if any statement of migration 18 fails, the database stays exactly at version 17', async (t) => {
  const path = freshCopy();
  const sabotage = openTestDatabase(path);
  // A pre-existing, incompatible table makes migration 18's claim backfill fail part-way.
  sabotage.raw.exec('CREATE TABLE first_clear_claim (unrelated TEXT);');
  sabotage.raw.close();

  await assert.rejects(migrate(t, path));
  // The runner closed its handle on failure (database.ts); inspect the file afresh.
  const db = openTestDatabase(path);
  assert.deepEqual(versions(db), Array.from({ length: 17 }, (_, i) => i + 1));
  assert.equal(legacyColumns(db, 'workout_result').includes('uuid'), false, 'earlier statements rolled back too');
  assert.equal(db.raw.prepare('SELECT total_xp FROM user').get().total_xp, 4120);
  db.raw.close();
});
