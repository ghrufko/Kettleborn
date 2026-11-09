import test from 'node:test';
import assert from 'node:assert/strict';

const DATABASE_URL = new URL('../database.ts', import.meta.url).href;
const SCHEMA_PATH = new URL('../schema.ts', import.meta.url).href;

function fakeDb(options: { failPragma?: boolean } = {}) {
  let closed = 0;
  const db = {
    execAsync: async (sql: string) => {
      if (options.failPragma && sql.startsWith('PRAGMA')) {
        throw new Error('disk I/O error');
      }
    },
    getAllAsync: async () => [],
    runAsync: async () => undefined,
    withTransactionAsync: async (fn: () => Promise<void>) => fn(),
    closeAsync: async () => {
      closed += 1;
    },
  };
  return { db, closedCount: () => closed };
}

async function loadDatabase(t: any, open: () => Promise<unknown>) {
  t.mock.module('expo-sqlite', { exports: { openDatabaseAsync: open } });
  t.mock.module(SCHEMA_PATH, {
    exports: { migrations: [{ version: 1, statements: ['CREATE TABLE IF NOT EXISTS t (id TEXT);'] }] },
  });
  return import(`${DATABASE_URL}?bust=${Math.random()}`);
}

test('a failed open is not cached: the next getDatabase() genuinely retries and can succeed', async (t) => {
  let opens = 0;
  const { db } = fakeDb();
  const { getDatabase } = await loadDatabase(t, async () => {
    opens += 1;
    if (opens === 1) {
      throw new Error('OPFS unavailable');
    }
    return db;
  });
  await assert.rejects(getDatabase(), /OPFS unavailable/);
  assert.equal(await getDatabase(), db);
  assert.equal(opens, 2);
});

test('a successful open is memoized (concurrent and later callers share one handle)', async (t) => {
  let opens = 0;
  const { db } = fakeDb();
  const { getDatabase } = await loadDatabase(t, async () => {
    opens += 1;
    return db;
  });
  const [a, b] = await Promise.all([getDatabase(), getDatabase()]);
  assert.equal(a, b);
  await getDatabase();
  assert.equal(opens, 1);
});

test('a failure after opening closes the handle before a retry reopens it', async (t) => {
  const failing = fakeDb({ failPragma: true });
  const { getDatabase } = await loadDatabase(t, async () => failing.db);
  await assert.rejects(getDatabase(), /disk I\/O error/);
  assert.equal(failing.closedCount(), 1);
});
