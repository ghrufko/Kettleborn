import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

/**
 * Test-only: an embedded PostgreSQL (PGlite) with Supabase's auth stand-in
 * (supabase/tests/pglite/auth_stub.sql) and EVERY real migration in
 * supabase/migrations applied in filename order — the archived, unapplied
 * one is not in that folder. Calls run as a given user through the
 * `authenticated` role with request.jwt.claims set, exactly how PostgREST
 * runs a signed-in request. Not Supabase itself: no GoTrue, no PostgREST.
 */
const ROOT = fileURLToPath(new URL('../../', import.meta.url).href);

export interface TestServer {
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
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    try {
      await db.exec(readFileSync(join(dir, file), 'utf8'));
    } catch (error) {
      throw new Error(`migration ${file} failed: ${(error as Error).message}`);
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
