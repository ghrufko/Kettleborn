import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * Cloud Save P6 — the generated Supabase sync schema, executed for real in
 * PGlite (embedded PostgreSQL) with every migration in supabase/migrations.
 * Calls run as the `authenticated` / `anon` roles with JWT claims, the way
 * PostgREST runs them. Not a hosted Supabase project (that is P11).
 */
const { startTestServer, requiresServerWorkspace, listTestMigrations } = await import(new URL('../../../testing/pgliteServer.ts', import.meta.url).href);
const { generateSyncMigrationSql, SYNC_MIGRATION_FILE, serverTable } = await import(new URL('../serverSchema.ts', import.meta.url).href);
const { SEED_ORDER } = await import(new URL('../recordTypes.ts', import.meta.url).href);

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url).href);
const DEVICE_A = '11111111-1111-4111-8111-111111111111';
const DEVICE_B = '22222222-2222-4222-8222-222222222222';

const server = await startTestServer();
test.after(() => server.close());

let seq = 0;
function item(entityType: string, entityKey: string, op: string, payload: object, extra: { field?: string; base_seq?: number | null } = {}) {
  seq += 1;
  return { device_seq: seq, entity_type: entityType, entity_key: entityKey, op, field: extra.field ?? null, base_seq: extra.base_seq ?? null, payload };
}
const push = (user: string, items: object[], device = DEVICE_A) => server.rpc(user, 'sync_push', [device, JSON.stringify(items)]);

let n = 0;
function huntPayload(over: Record<string, unknown> = {}) {
  n += 1;
  const uuid = `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  return {
    id: `everlasting-cycle-${n}`, workout_id: 'everlasting-cycle', monster_id: 'hydra', hunt_id: 'hydra-first-encounter',
    completed_at: '2026-11-11T08:00:00.000Z', time_minutes: 15, time_seconds: 0, weight_value_a: 16, weight_value_b: 16,
    weight_unit: 'kg', notes: null, xp_awarded: 421, difficulty: 2, app_version: '1.0.0', rung_times_json: null, rpe: null,
    is_custom_hunt: 0, rest_seconds_used: null, structural_value_used: null, reps_overrides_used_json: null, extra_sets_json: null,
    uuid, updated_at: '2026-11-11T08:00:00.000Z', voided_at: null, void_reset_uuid: null, first_clear_bonus_xp: 100,
    progression_epoch: 0, monster_reset_count: 0, volume_kg: 1234.5, training_minutes: 15, origin_device_uuid: DEVICE_A,
    origin_order: n, streak_after: 1, tz_offset_minutes: 0, pr_bonus_xp: 0, repeat_multiplier: 1, prior_clears_seen: 0,
    ...over,
  };
}
function equipmentPayload(over: Record<string, unknown> = {}) {
  return { id: 'kb-9', type: 'kettlebell', weight: 24, unit: 'kg', label: '24 KG', owned: 1, uuid: 'e9', updated_at: 't', deleted_at: null, sync_key: 'eq-1', ...over };
}

// ---------------------------------------------------------------- generator and archive

test('the test server applies the committed generator\'s sync schema, in migration order', () => {
  // Every test below that exercises committed code runs against this
  // schema, so it is reproducible from a clean checkout (src/testing/pgliteServer.ts).
  const sync = `${SYNC_MIGRATION_FILE.split('/').pop()} (generated)`;
  assert.deepEqual(server.migrations, listTestMigrations());
  assert.ok(server.migrations.includes(sync), 'the sync schema is applied from the generator');
  assert.deepEqual([...server.migrations].sort(), server.migrations, 'filename order');
});

// The three tests below check server-side files that are not committed yet
// (frozen Cloud Sync server work). On a checkout without them they are
// skipped and say which file they need; with them, they run in full.

test('the committed migration is exactly the generator output', { skip: requiresServerWorkspace(SYNC_MIGRATION_FILE) }, () => {
  assert.equal(readFileSync(`${ROOT}${SYNC_MIGRATION_FILE}`, 'utf8'), generateSyncMigrationSql());
});

test('D13: the client_result_id migration is archived unchanged and is not in the applied folder', {
  skip: requiresServerWorkspace('supabase/migrations_archive/20261010120000_workout_results_client_id_uniqueness.sql'),
}, () => {
  const name = '20261010120000_workout_results_client_id_uniqueness.sql';
  assert.equal(existsSync(`${ROOT}supabase/migrations/${name}`), false);
  const archived = readFileSync(`${ROOT}supabase/migrations_archive/${name}`, 'utf8');
  const original = execFileSync('git', ['show', `HEAD:supabase/migrations/${name}`], { cwd: ROOT }).toString();
  assert.equal(archived, original);
});

test('one table per record type, each with row-level security and no client write privilege', async () => {
  for (const type of SEED_ORDER) {
    const table = serverTable(type);
    const [rls] = await server.db.query(`select relrowsecurity from pg_class where relname = $1`, [table]).then((r: any) => r.rows);
    assert.equal(rls.relrowsecurity, true, table);
    const privileges = (await server.db.query(
      `select privilege_type from information_schema.role_table_grants where table_name = $1 and grantee in ('authenticated', 'anon') order by 1`,
      [table]
    )).rows.map((r: any) => r.privilege_type);
    assert.deepEqual(privileges, ['SELECT'], `${table}: authenticated may only SELECT`);
  }
});

// ---------------------------------------------------------------- isolation and privileges

test('two users never see each other\'s data; anonymous callers get nothing', async () => {
  const a = await server.createUser();
  const b = await server.createUser();
  const hunt = huntPayload();
  assert.equal((await push(a, [item('hunt_result', hunt.uuid, 'insert', hunt)]))[0].status, 'accepted');

  assert.equal((await server.as(a, 'select * from public.sync_hunt_result')).length, 1);
  assert.equal((await server.as(b, 'select * from public.sync_hunt_result')).length, 0);
  assert.deepEqual((await server.rpc(b, 'sync_pull', [0, 100])).items, []);
  assert.equal((await server.rpc(a, 'sync_pull', [0, 100])).items.length, 1);
  assert.equal((await server.rpc(a, 'sync_account_status', [])).has_data, true);
  assert.equal((await server.rpc(b, 'sync_account_status', [])).has_data, false);

  await assert.rejects(server.as(null, 'select * from public.sync_hunt_result'), /permission denied/);
  await assert.rejects(server.rpc(null, 'sync_push', [DEVICE_A, '[]']), /permission denied/);
  await assert.rejects(server.rpc(null, 'sync_pull', [0, 10]), /permission denied/);
});

test('clients cannot write tables directly, nor call the internal apply functions', async () => {
  const a = await server.createUser();
  await assert.rejects(
    server.as(a, `insert into public.sync_achievement (user_id, entity_key, milestone_type, unlocked_at, server_seq) values ($1, 'x', 'x', 't', 1)`, [a]),
    /permission denied/
  );
  await assert.rejects(server.as(a, `update public.sync_hunt_result set xp_awarded = 99999`), /permission denied/);
  await assert.rejects(server.as(a, `delete from public.sync_hunt_result`), /permission denied/);
  await assert.rejects(server.as(a, `select public.sync_apply_achievement($1, 'insert', 'x', null, null, '{}'::jsonb)`, [a]), /permission denied/);
});

test('profiles are readable by their owner only (D11)', {
  skip: requiresServerWorkspace('supabase/migrations/20261111120100_profiles_owner_only.sql'),
}, async () => {
  const a = await server.createUser();
  const b = await server.createUser();
  assert.equal((await server.as(a, 'select id from public.profiles')).length, 1);
  assert.deepEqual((await server.as(a, 'select id from public.profiles where id = $1', [b])), []);
});

// ---------------------------------------------------------------- facts, retries, immutability

test('retries are idempotent: the same device_seq returns the original outcome as a duplicate', async () => {
  const a = await server.createUser();
  const hunt = huntPayload();
  const batch = [item('hunt_result', hunt.uuid, 'insert', hunt)];
  const first = await push(a, batch);
  const again = await push(a, batch);
  assert.equal(first[0].status, 'accepted');
  assert.deepEqual([again[0].status, again[0].server_seq], ['duplicate', first[0].server_seq]);
  assert.equal((await server.as(a, 'select * from public.sync_hunt_result')).length, 1);
});

test('facts are insert-only: a different fact under the same identity is rejected; the guard blocks changes even to a superuser', async () => {
  const a = await server.createUser();
  const hunt = huntPayload();
  await push(a, [item('hunt_result', hunt.uuid, 'insert', hunt)]);
  const same = await push(a, [item('hunt_result', hunt.uuid, 'insert', hunt)], DEVICE_B);
  assert.equal(same[0].status, 'duplicate');
  const different = await push(a, [item('hunt_result', hunt.uuid, 'insert', { ...hunt, xp_awarded: 99999 })]);
  assert.equal(different[0].status, 'invalid');
  await assert.rejects(server.db.query('update public.sync_hunt_result set xp_awarded = 1'), /immutable/);
  await assert.rejects(server.db.query(`update public.sync_hunt_result set entity_key = 'other'`), /immutable/);
});

test('hunt notes and RPE are versioned per field: base must match, stale returns the server value, fields do not conflict with each other', async () => {
  const a = await server.createUser();
  const hunt = huntPayload();
  const [ins] = await push(a, [item('hunt_result', hunt.uuid, 'insert', hunt)]);
  const [notes] = await push(a, [item('hunt_result', hunt.uuid, 'update', { value: 'Felt strong' }, { field: 'notes', base_seq: ins.server_seq })]);
  assert.equal(notes.status, 'accepted');
  const [rpe] = await push(a, [item('hunt_result', hunt.uuid, 'update', { value: 3 }, { field: 'rpe', base_seq: ins.server_seq })], DEVICE_B);
  assert.equal(rpe.status, 'accepted', 'an RPE edit does not conflict with a notes edit');
  const [stale] = await push(a, [item('hunt_result', hunt.uuid, 'update', { value: 'Old text' }, { field: 'notes', base_seq: ins.server_seq })], DEVICE_B);
  assert.deepEqual([stale.status, stale.server_seq, stale.server_value], ['stale', notes.server_seq, 'Felt strong']);
  const row = (await server.as(a, 'select notes, rpe from public.sync_hunt_result'))[0];
  assert.deepEqual({ ...row }, { notes: 'Felt strong', rpe: 3 });
});

// ---------------------------------------------------------------- editable records

test('records: base-checked updates, stale edits get the server version, deletes and restores', async () => {
  const a = await server.createUser();
  const [ins] = await push(a, [item('equipment', 'eq-1', 'insert', equipmentPayload())]);
  const [upd] = await push(a, [item('equipment', 'eq-1', 'update', equipmentPayload({ weight: 28 }), { base_seq: ins.server_seq })]);
  assert.equal(upd.status, 'accepted');
  const [stale] = await push(a, [item('equipment', 'eq-1', 'update', equipmentPayload({ weight: 32 }), { base_seq: ins.server_seq })], DEVICE_B);
  assert.equal(stale.status, 'stale');
  assert.equal(stale.server_value.weight, 28);
  const [del] = await push(a, [item('equipment', 'eq-1', 'delete', equipmentPayload({ weight: 28, deleted_at: 'd' }), { base_seq: upd.server_seq })]);
  assert.equal(del.status, 'accepted');
  const [delAgain] = await push(a, [item('equipment', 'eq-1', 'delete', equipmentPayload({ deleted_at: 'd2' }), { base_seq: 1 })], DEVICE_B);
  assert.deepEqual([delAgain.status, delAgain.server_seq], ['accepted', del.server_seq], 'deleting what is deleted changes nothing');
  const [restore] = await push(a, [item('equipment', 'eq-1', 'update', equipmentPayload({ deleted_at: null }), { base_seq: del.server_seq })]);
  assert.equal(restore.status, 'accepted', 'equipment can be restored');
});

test('a deleted custom workout stays deleted: a later edit is stale (the device saves its version as a copy)', async () => {
  const a = await server.createUser();
  const cw = { id: 'cw', name: 'Evening', exercises_json: '[]', weight_kg: 16, weight_b_kg: null, gear_count: 1, rounds: 3, rest_seconds: 30, created_at: 't', updated_at: 't', uuid: 'cw-1', deleted_at: null };
  const [ins] = await push(a, [item('custom_workout', 'cw-1', 'insert', cw)]);
  const [del] = await push(a, [item('custom_workout', 'cw-1', 'delete', { ...cw, deleted_at: 'd' }, { base_seq: ins.server_seq })]);
  const [edit] = await push(a, [item('custom_workout', 'cw-1', 'update', { ...cw, name: 'Renamed' }, { base_seq: del.server_seq })], DEVICE_B);
  assert.equal(edit.status, 'stale');
  assert.equal(edit.server_value.deleted_at, 'd');
});

// ---------------------------------------------------------------- first-clear claims (D2)

test('claims: need a matching result; the first accepted claim wins permanently; seeded local_final is kept as-is', async () => {
  const a = await server.createUser();
  const claim = (resultUuid: string, status = 'pending', epoch = 0) => ({ stage_key: 'workout:everlasting-cycle', epoch, result_uuid: resultUuid, claimed_at: 't', status });
  const key = 'workout:everlasting-cycle@0';
  const h1 = huntPayload();
  const h2 = huntPayload();

  const [orphan] = await push(a, [item('first_clear_claim', key, 'insert', claim(h1.uuid))]);
  assert.equal(orphan.status, 'invalid', 'no result yet: quarantined');

  const out = await push(a, [item('hunt_result', h1.uuid, 'insert', h1), item('first_clear_claim', key, 'insert', claim(h1.uuid))]);
  assert.deepEqual(out.map((o: any) => o.status), ['accepted', 'accepted'], 'result then claim in one batch');

  const other = await push(a, [item('hunt_result', h2.uuid, 'insert', h2), item('first_clear_claim', key, 'insert', claim(h2.uuid))], DEVICE_B);
  assert.equal(other[1].status, 'claimed_elsewhere');
  assert.equal(other[1].server_value.result_uuid, h1.uuid);
  const [same] = await push(a, [item('first_clear_claim', key, 'insert', claim(h1.uuid))], DEVICE_B);
  assert.equal(same.status, 'duplicate');

  const [wrongEpoch] = await push(a, [item('first_clear_claim', 'workout:everlasting-cycle@1', 'insert', claim(h2.uuid, 'pending', 1))]);
  assert.equal(wrongEpoch.status, 'invalid', 'result epoch must match the claim epoch');

  const b = await server.createUser();
  const legacy = huntPayload({ first_clear_bonus_xp: null });
  const seeded = await push(b, [item('hunt_result', legacy.uuid, 'insert', legacy), item('first_clear_claim', key, 'insert', claim(legacy.uuid, 'local_final'))]);
  assert.equal(seeded[1].status, 'accepted');
  assert.equal((await server.as(b, 'select status from public.sync_first_clear_claim'))[0].status, 'local_final');
});

// ---------------------------------------------------------------- validation and limits

test('invalid items are rejected one by one without failing the batch', async () => {
  const a = await server.createUser();
  const good = huntPayload();
  const out = await push(a, [
    item('hunt_result', 'not-the-uuid', 'insert', huntPayload()),
    item('achievement', 'x', 'insert', { milestone_type: 'x', unlocked_at: 't', smuggled: 1 }),
    item('no_such_type', 'x', 'insert', {}),
    item('stopwatch_result', 's1', 'insert', { id: 's', completed_at: 't', elapsed_seconds: 1, lap_seconds_json: null, note: 'x'.repeat(5000), uuid: 's1' }),
    item('stopwatch_result', 's2', 'update', { id: 's' }),
    item('hunt_result', good.uuid, 'insert', good),
  ]);
  assert.deepEqual(out.map((o: any) => o.status), ['invalid', 'invalid', 'invalid', 'invalid', 'invalid', 'accepted']);
  assert.match(out[0].error, /identity/);
  assert.match(out[1].error, /unknown field/);
  assert.equal((await server.as(a, 'select * from public.sync_stopwatch_result')).length, 0);
});

test('batches over 200 items are refused as a whole', async () => {
  const a = await server.createUser();
  const many = Array.from({ length: 201 }, (_, i) => item('achievement', `m${i}`, 'insert', { milestone_type: `m${i}`, unlocked_at: 't' }));
  await assert.rejects(push(a, many), /batch too large/);
});

// ---------------------------------------------------------------- pull, sequencing, deletion

test('pull pages by server_seq; changed rows come back with a higher seq; seq only grows per player', async () => {
  const a = await server.createUser();
  const ins = await push(a, ['a', 'b', 'c'].map((m) => item('achievement', m, 'insert', { milestone_type: m, unlocked_at: 't' })));
  const seqs = ins.map((o: any) => o.server_seq);
  assert.deepEqual(seqs, [...seqs].sort((x: number, y: number) => x - y));
  const page1 = await server.rpc(a, 'sync_pull', [0, 2]);
  assert.equal(page1.items.length, 2);
  const page2 = await server.rpc(a, 'sync_pull', [page1.next_cursor, 2]);
  assert.deepEqual(page2.items.map((i: any) => i.entity_key), ['c']);
  const [eq] = await push(a, [item('equipment', 'eq-1', 'insert', equipmentPayload())]);
  const [upd] = await push(a, [item('equipment', 'eq-1', 'update', equipmentPayload({ weight: 30 }), { base_seq: eq.server_seq })]);
  const page3 = await server.rpc(a, 'sync_pull', [page2.next_cursor, 10]);
  assert.deepEqual(page3.items.map((i: any) => [i.entity_key, i.server_seq, i.payload.weight]), [['eq-1', upd.server_seq, 30]]);
  assert.equal('user_id' in page3.items[0].payload, false);
});

test('deleting the auth user (account deletion) removes every synced row and mutation record', async () => {
  const a = await server.createUser();
  const hunt = huntPayload();
  await push(a, [item('hunt_result', hunt.uuid, 'insert', hunt), item('equipment', 'eq-1', 'insert', equipmentPayload())]);
  await server.db.query('delete from auth.users where id = $1', [a]);
  for (const type of SEED_ORDER) {
    const rows = (await server.db.query(`select count(*)::int n from public.${serverTable(type)} where user_id = $1`, [a])).rows as any[];
    assert.equal(rows[0].n, 0, type);
  }
  assert.equal(((await server.db.query('select count(*)::int n from public.sync_mutation where user_id = $1', [a])).rows as any[])[0].n, 0);
});

test('achievements merge across devices: the earliest unlock time wins and is re-published', async () => {
  const a = await server.createUser();
  const [first] = await push(a, [item('achievement', 'slayer', 'insert', { milestone_type: 'slayer', unlocked_at: '2026-09-02T00:00:00.000Z' })]);
  const [later] = await push(a, [item('achievement', 'slayer', 'insert', { milestone_type: 'slayer', unlocked_at: '2026-09-03T00:00:00.000Z' })], DEVICE_B);
  assert.equal(later.status, 'duplicate');
  const [earlier] = await push(a, [item('achievement', 'slayer', 'insert', { milestone_type: 'slayer', unlocked_at: '2026-09-01T00:00:00.000Z' })], DEVICE_B);
  assert.equal(earlier.status, 'accepted');
  assert.ok(earlier.server_seq > first.server_seq, 'other devices download the earlier time');
  assert.equal((await server.as(a, 'select unlocked_at from public.sync_achievement'))[0].unlocked_at, '2026-09-01T00:00:00.000Z');
});
