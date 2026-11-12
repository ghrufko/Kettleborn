import { DatabaseSync } from 'node:sqlite';

/**
 * Test-only adapter: a real SQLite database (Node's built-in node:sqlite)
 * exposing the subset of expo-sqlite's async SQLiteDatabase API the app's
 * repositories and migration runner use. Lets tests run the real migration
 * SQL and the real repository code against a real database file, instead
 * of mocks — including real transaction rollback.
 */
type Param = string | number | bigint | null | Uint8Array;

function normalize(params: unknown[]): Param[] {
  const flat = params.length === 1 && Array.isArray(params[0]) ? (params[0] as unknown[]) : params;
  return flat.map((value) => {
    if (value === undefined) {
      return null;
    }
    if (typeof value === 'boolean') {
      return value ? 1 : 0;
    }
    return value as Param;
  });
}

export interface TestDatabase {
  raw: DatabaseSync;
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, ...params: unknown[]): Promise<{ changes: number; lastInsertRowId: number }>;
  getAllAsync<T>(sql: string, ...params: unknown[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, ...params: unknown[]): Promise<T | null>;
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
  closeAsync(): Promise<void>;
}

export function openTestDatabase(path = ':memory:'): TestDatabase {
  const raw = new DatabaseSync(path);
  return {
    raw,
    async execAsync(sql) {
      raw.exec(sql);
    },
    async runAsync(sql, ...params) {
      const result = raw.prepare(sql).run(...normalize(params));
      return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) };
    },
    async getAllAsync<T>(sql: string, ...params: unknown[]) {
      return raw.prepare(sql).all(...normalize(params)) as T[];
    },
    async getFirstAsync<T>(sql: string, ...params: unknown[]) {
      return (raw.prepare(sql).get(...normalize(params)) as T | undefined) ?? null;
    },
    // Mirrors expo-sqlite's SQLiteDatabase.withTransactionAsync statement
    // for statement — including BEGIN sitting inside the try, so a BEGIN
    // that fails (a transaction is already open on this connection) still
    // issues ROLLBACK. Overlapping-transaction tests depend on this.
    async withTransactionAsync(task) {
      try {
        await this.execAsync('BEGIN');
        await task();
        await this.execAsync('COMMIT');
      } catch (error) {
        await this.execAsync('ROLLBACK');
        throw error;
      }
    },
    async closeAsync() {
      raw.close();
    },
  };
}
