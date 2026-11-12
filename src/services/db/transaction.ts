/**
 * The one way app code opens a SQLite transaction on the shared connection.
 *
 * Why this exists (Cloud Save Phase 1.2): every repository shares ONE
 * connection (getDatabase is memoized), and SQLite allows one transaction
 * per connection. expo-sqlite's withTransactionAsync issues BEGIN inside its
 * own try block, so when a second transaction starts while one is open, its
 * BEGIN fails and its catch issues ROLLBACK — rolling back the OTHER
 * caller's transaction, whose remaining writes then autocommit outside any
 * transaction. Calling withTransactionAsync from independent call sites is
 * therefore unsafe; this helper replaces it.
 *
 * Guarantees, per connection:
 * - Transactions run strictly one at a time, in call order (a promise
 *   queue, not a boolean flag, so waiting callers are never dropped).
 * - A transaction that fails rolls back only its own changes and rejects
 *   with its own original error; the queue then moves on to the next one.
 * - A BEGIN that fails rolls nothing back (there is nothing of its own to
 *   roll back) — it can never touch another operation's transaction.
 *
 * Not re-entrant: calling runInTransaction from inside `work` on the same
 * connection would wait for itself forever. No caller does; keep it so.
 *
 * Deliberately independent of database.ts (takes the connection as an
 * argument): the migration runner, which runs before the connection is
 * handed to anyone, keeps its own withTransactionAsync.
 */

export interface TransactionalConnection {
  execAsync(source: string): Promise<void>;
}

const queueTails = new WeakMap<TransactionalConnection, Promise<void>>();

export function runInTransaction<T>(db: TransactionalConnection, work: () => Promise<T>): Promise<T> {
  const previous = queueTails.get(db) ?? Promise.resolve();
  const run = previous.then(() => executeTransaction(db, work));
  // The tail never rejects, so one failed transaction never blocks the next.
  queueTails.set(
    db,
    run.then(
      () => undefined,
      () => undefined
    )
  );
  return run;
}

async function executeTransaction<T>(db: TransactionalConnection, work: () => Promise<T>): Promise<T> {
  await db.execAsync('BEGIN');
  try {
    const value = await work();
    await db.execAsync('COMMIT');
    return value;
  } catch (error) {
    try {
      await db.execAsync('ROLLBACK');
    } catch {
      // SQLite already ended the transaction itself (it does for some
      // errors); the original error below is the one that matters.
    }
    throw error;
  }
}
