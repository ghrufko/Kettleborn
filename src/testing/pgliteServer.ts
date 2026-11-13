import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { basename, join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { generateSyncMigrationSql, SYNC_MIGRATION_FILE } from '../services/sync/serverSchema';

/**
 * Test-only: an embedded PostgreSQL (PGlite) with Supabase's auth stand-in
 * (supabase/tests/pglite/auth_stub.sql) and every migration in
 * supabase/migrations applied in filename order — the archived, unapplied
 * one is not in that folder. Calls run as a given user through the
 * `authenticated` role with request.jwt.claims set, exactly how PostgREST
 * runs a signed-in request. Not Supabase itself: no GoTrue, no PostgREST.
 *
 * The sync schema is always the committed generator's output
 * (generateSyncMigrationSql), applied at the sync migration's place in the
 * order — never read from the .sql file. That file is server-side work
 * kept out of the repository while it is frozen; when it is present,
 * server.pglite.test.ts checks it equals the generator byte for byte, so
 * both are the same SQL. This keeps every test that exercises committed
 * client code reproducible from a clean checkout.
 */
const ROOT = fileURLToPath(new URL('../../', import.meta.url).href);
const SYNC_MIGRATION_NAME = basename(SYNC_MIGRATION_FILE);

/**
 * Server-side files that are not committed yet (frozen Cloud Sync server
 * work). A test that checks one of them is skipped, with this reason, on a
 * checkout that does not have it — it cannot test what is not there. Tests
 * of committed code never use this.
 */
export function requiresServerWorkspace(relativePath: string): string | false {
  return existsSync(join(ROOT, relativePath))
    ? false
    : `needs ${relativePath} — uncommitted Cloud Sync server work, not in this checkout`;
}

/** The migrations a test server applies, in order; the sync schema is marked as generated. */
export function listTestMigrations(): string[] {
  const onDisk = readdirSync(join(ROOT, 'supabase/migrations')).filter((f) => f.endsWith('.sql'));
  return [...new Set([...onDisk, SYNC_MIGRATION_NAME])]
    .sort()
    .map((name) => (name === SYNC_MIGRATION_NAME ? `${name} (generated)` : name));
}

export interface TestServer {
  /** The migrations applied, in order (listTestMigrations). */
  migrations: string[];
  db: PGlite;
  /** Creates an auth user (as the platform would) and returns its id. */
  createUser(email?: string): Promise<string>;
  /** Runs one statement as `userId` (null = anonymous), like a PostgREST request. Returns rows. */
  as<T = any>(userId: string | null, sql: string, params?: unknown[]): Promise<T[]>;
  /** Calls an RPC as `userId` and returns its single JSON result. */
  rpc(userId: string | null, fn: string, args: unknown[]): Promise<any>;
  close(): Promise<void>;
}

export async function startTestServer(): Promise<TestServer> {
  const db = new PGlite();
  await db.waitReady;
  await db.exec(readFileSync(join(ROOT, 'supabase/tests/pglite/auth_stub.sql'), 'utf8'));
  const dir = join(ROOT, 'supabase/migrations');
  const migrations = listTestMigrations();
  for (const entry of migrations) {
    const file = entry.replace(/ \(generated\)$/, '');
    const sql = file === SYNC_MIGRATION_NAME ? generateSyncMigrationSql() : readFileSync(join(dir, file), 'utf8');
    try {
      await db.exec(sql);
    } catch (error) {
      throw new Error(`migration ${entry} failed: ${(error as Error).message}`);
    }
  }

  let chain: Promise<unknown> = Promise.resolve();
  /** PGlite is one connection: serialize calls so role/claims never leak between them. */
  function serial<T>(work: () => Promise<T>): Promise<T> {
    const run = chain.then(work, work);
    chain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  async function as<T>(userId: string | null, sql: string, params: unknown[] = []): Promise<T[]> {
    return serial(async () => {
      const result = await db.transaction(async (tx) => {
        await tx.query(`set local role ${userId ? 'authenticated' : 'anon'}`);
        await tx.query(`select set_config('request.jwt.claims', $1, true)`, [
          userId ? JSON.stringify({ sub: userId, role: 'authenticated' }) : '',
        ]);
        return tx.query<T>(sql, params);
      });
      return result.rows as T[];
    });
  }

  return {
    migrations,
    db,
    async createUser(email) {
      const id = randomUUID();
      await serial(() => db.query('insert into auth.users (id, email) values ($1, $2)', [id, email ?? `${id}@test.local`]));
      return id;
    },
    as,
    async rpc(userId, fn, args) {
      const placeholders = args.map((_, i) => `$${i + 1}`).join(', ');
      const rows = await as<{ result: any }>(userId, `select public.${fn}(${placeholders}) as result`, args);
      return rows[0].result;
    },
    close: () => db.close(),
  };
}
