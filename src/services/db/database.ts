import * as SQLite from 'expo-sqlite';
import { migrations } from './schema';

const DATABASE_NAME = 'kettleborn.db';

let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function runMigrations(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY NOT NULL,
      applied_at TEXT NOT NULL
    );`
  );

  const appliedRows = await db.getAllAsync<{ version: number }>(
    'SELECT version FROM schema_migrations ORDER BY version ASC;'
  );
  const appliedVersions = new Set(appliedRows.map((row) => row.version));

  const pending = migrations
    .filter((migration) => !appliedVersions.has(migration.version))
    .sort((a, b) => a.version - b.version);

  for (const migration of pending) {
    await db.withTransactionAsync(async () => {
      for (const statement of migration.statements) {
        await db.execAsync(statement);
      }
      await db.runAsync(
        'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?);',
        migration.version,
        new Date().toISOString()
      );
    });
  }
}

/**
 * Returns the shared SQLite database instance, opening it and running any
 * pending migrations on first call. Safe to call from multiple repositories
 * concurrently — the underlying promise is memoized.
 */
export function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (!databasePromise) {
    databasePromise = (async () => {
      const db = await SQLite.openDatabaseAsync(DATABASE_NAME);
      await db.execAsync('PRAGMA journal_mode = WAL;');
      await runMigrations(db);
      return db;
    })();
  }
  return databasePromise;
}
