// Applies auth_stub.sql + every real migration in supabase/migrations/
// (in filename order) against a fresh, disposable PGlite (embedded
// WASM PostgreSQL) instance, then closes it. Nothing persists — this
// is purely a "do the migrations apply cleanly, in order, from empty"
// check. See ../README.md for what PGlite can and cannot stand in for.
//
// Run from this directory: npm install && npm run apply
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(HERE, '../../migrations');

const db = new PGlite();
await db.waitReady;

console.log('--- applying auth stand-in ---');
const authStub = readFileSync(path.join(HERE, 'auth_stub.sql'), 'utf8');
try {
  await db.exec(authStub);
  console.log('auth stand-in: OK');
} catch (e) {
  console.error('auth stand-in FAILED:', e.message);
  process.exit(1);
}

const files = readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();
console.log('migration files found (in apply order):', files);

for (const f of files) {
  const sql = readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
  try {
    await db.exec(sql);
    console.log(`APPLIED OK: ${f}`);
  } catch (e) {
    console.error(`APPLY FAILED: ${f}`);
    console.error('Error:', e.message);
    process.exit(1);
  }
}

console.log('\n--- all migrations applied successfully against a clean PGlite (real Postgres 18.3 / WASM) instance ---');

const tables = await db.query(`select table_name from information_schema.tables where table_schema='public' order by table_name;`);
console.log('public tables:', tables.rows.map(r => r.table_name));

const seedCount = await db.query(`select count(*) from public.content_workouts;`);
console.log('content_workouts row count:', seedCount.rows[0].count);
const huntCount = await db.query(`select count(*) from public.content_hunts;`);
console.log('content_hunts row count:', huntCount.rows[0].count);

await db.close();
