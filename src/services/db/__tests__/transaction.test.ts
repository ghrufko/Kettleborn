import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * Cloud Save Phase 1.2 — runInTransaction against a real SQLite
 * connection (node:sqlite through the same adapter the integration tests
 * use). Nothing here is mocked: real BEGIN/COMMIT/ROLLBACK, real
 * constraint and commit failures.
 */
const { openTestDatabase } = await import(new URL('../../../testing/nodeSqliteDatabase.ts', import.meta.url).href);
const { runInTransaction } = await import(new URL('../transaction.ts', import.meta.url).href);

function setup() {
  const db = openTestDatabase(':memory:');
  db.raw.exec('CREATE TABLE item (name TEXT PRIMARY KEY NOT NULL)');
  return db;
}

function names(db: any): string[] {
  return db.raw.prepare('SELECT name FROM item ORDER BY name').all().map((r: any) => r.name);
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

const insert = (db: any, name: string) => db.runAsync('INSERT INTO item (name) VALUES (?)', name);

test('two overlapping transactions never overlap: the second starts only after the first commits, and both commit', async () => {
  const db = setup();
  const events: string[] = [];
  const gate = deferred();

  const first = runInTransaction(db, async () => {
    events.push('first:start');
    await insert(db, 'a');
    await gate.promise; // hold the transaction open
    await insert(db, 'b');
    events.push('first:end');
    return 'first';
  });
  const second = runInTransaction(db, async () => {
    events.push('second:start');
    await insert(db, 'c');
    return 'second';
  });

  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(events, ['first:start'], 'the second transaction is waiting, not interleaved');
  gate.resolve();

  assert.deepEqual(await Promise.all([first, second]), ['first', 'second']);
  assert.deepEqual(events, ['first:start', 'first:end', 'second:start']);
  assert.deepEqual(names(db), ['a', 'b', 'c']);
  assert.equal(db.raw.isTransaction, false);
});

test('a failed first transaction rolls back only itself; the queued second one commits; the connection stays usable', async () => {
  const db = setup();
  const gate = deferred();

  const first = runInTransaction(db, async () => {
    await insert(db, 'first-1');
    await gate.promise;
    await insert(db, 'first-1'); // PRIMARY KEY violation
  });
  const second = runInTransaction(db, async () => {
    await insert(db, 'second');
  });
  gate.resolve();

  await assert.rejects(first, /UNIQUE constraint failed/);
  await second;
  assert.deepEqual(names(db), ['second'], 'first-1 rolled back, second committed');
  assert.equal(db.raw.isTransaction, false);

  await runInTransaction(db, async () => insert(db, 'later'));
  await insert(db, 'autocommit');
  assert.deepEqual(names(db), ['autocommit', 'later', 'second']);
});

test('queue recovery: rejected transactions never block the transactions queued behind them', async () => {
  const db = setup();
  const outcomes = await Promise.allSettled([
    runInTransaction(db, async () => {
      await insert(db, 'x');
      throw new Error('first fails');
    }),
    runInTransaction(db, async () => {
      throw new Error('second fails');
    }),
    runInTransaction(db, async () => {
      await insert(db, 'y');
      return 'third';
    }),
    runInTransaction(db, async () => {
      await insert(db, 'z');
      return 'fourth';
    }),
  ]);

  assert.deepEqual(
    outcomes.map((o) => (o.status === 'fulfilled' ? o.value : (o.reason as Error).message)),
    ['first fails', 'second fails', 'third', 'fourth']
  );
  assert.deepEqual(names(db), ['y', 'z']);
  assert.equal(db.raw.isTransaction, false);
});

test('the original error is propagated unchanged (same object), and the work result is returned', async () => {
  const db = setup();
  const original = new Error('boom');
  await assert.rejects(
    runInTransaction(db, async () => {
      throw original;
    }),
    (error: unknown) => error === original
  );
  assert.equal(await runInTransaction(db, async () => 42), 42);
});

test('a BEGIN that fails rolls back nothing: a transaction someone else already holds open is left intact', async () => {
  const db = setup();
  // A transaction opened outside the helper on the same connection.
  db.raw.exec('BEGIN');
  db.raw.prepare('INSERT INTO item (name) VALUES (?)').run('outside');

  await assert.rejects(
    runInTransaction(db, async () => insert(db, 'never')),
    /cannot start a transaction within a transaction/
  );

  assert.equal(db.raw.isTransaction, true, 'the other transaction is still open — not rolled back');
  db.raw.exec('COMMIT');
  assert.deepEqual(names(db), ['outside']);
});

test('a COMMIT that fails is rolled back, so the connection is never left inside a transaction', async () => {
  const db = setup();
  db.raw.exec('PRAGMA foreign_keys = ON');
  db.raw.exec(`CREATE TABLE child (
    parent TEXT NOT NULL REFERENCES item (name) DEFERRABLE INITIALLY DEFERRED
  )`);

  await assert.rejects(
    runInTransaction(db, async () => {
      await db.runAsync("INSERT INTO child (parent) VALUES ('missing')"); // only checked at COMMIT
    }),
    /FOREIGN KEY constraint failed/
  );
  assert.equal(db.raw.isTransaction, false);
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM child').get().n, 0);

  await runInTransaction(db, async () => insert(db, 'after'));
  assert.deepEqual(names(db), ['after']);
});

test('queues are per connection: a transaction held open on one database never delays another database', async () => {
  const one = setup();
  const two = setup();
  const gate = deferred();
  const held = runInTransaction(one, async () => {
    await insert(one, 'held');
    await gate.promise;
  });
  await runInTransaction(two, async () => insert(two, 'free'));
  assert.deepEqual(names(two), ['free']);
  gate.resolve();
  await held;
  assert.deepEqual(names(one), ['held']);
});
