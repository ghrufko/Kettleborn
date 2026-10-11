import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(HERE, '../../migrations');

export async function freshDb() {
  const db = new PGlite();
  await db.waitReady;
  const authStub = readFileSync(path.join(HERE, 'auth_stub.sql'), 'utf8');
  await db.exec(authStub);
  const files = readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();
  for (const f of files) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
    await db.exec(sql);
  }
  // Two fixture users, created as the superuser (bypasses RLS, same role
  // the migration-applying connection already uses throughout).
  await db.query(
    `insert into auth.users (id, email, raw_user_meta_data, aud, role) values
     ('11111111-1111-1111-1111-111111111111','hunter.a@test.kettleborn','{"display_name":"HunterA"}','authenticated','authenticated'),
     ('22222222-2222-2222-2222-222222222222','hunter.b@test.kettleborn','{"display_name":"HunterB"}','authenticated','authenticated')
     on conflict (id) do nothing;`
  );
  return db;
}

export const HUNTER_A = '11111111-1111-1111-1111-111111111111';
export const HUNTER_B = '22222222-2222-2222-2222-222222222222';

export async function asUser(db, userId) {
  await db.exec(`set local role authenticated;`);
  await db.query(`select set_config('request.jwt.claims', $1, true);`, [JSON.stringify({ sub: userId, role: 'authenticated' })]);
}

export async function asSuperuser(db) {
  await db.exec(`reset role;`);
}
