import test from 'node:test';
import assert from 'node:assert/strict';

/** Cloud Save P10 — data export and account deletion, on the real local stack (the server side is a fake deleter here). */
const H = await import(new URL('../../../testing/appHarness.ts', import.meta.url).href);
const { startTestServer } = await import(new URL('../../../testing/pgliteServer.ts', import.meta.url).href);
const R = await import(new URL('../runtime.ts', import.meta.url).href);
const O = await import(new URL('../outbox.ts', import.meta.url).href);
const { syncOnce } = await import(new URL('../engine.ts', import.meta.url).href);
const { buildDataExport } = await import(new URL('../accountData.ts', import.meta.url).href);
const T = await import(new URL('../recordTypes.ts', import.meta.url).href);

const U = 'local-hunter';
const server = await startTestServer();
test.after(async () => {
  R.setAccountDeleter(null);
  R.setSyncFeatureEnabledForTests(null);
  await server.close();
  H.cleanupWorkDir();
});
const raw = () => H.raw();
const db = () => H.device.handle;

test('export: every synced record (deleted and voided included), the totals and this device\'s settings', async () => {
  const { store } = await H.legacyDevice();
  await store.getState().resetMonsterProgress('minotaur');
  await H.Services.CustomWorkoutRepository.delete('custom-workout-1755000000000');
  const data = await buildDataExport(db(), U);
  assert.equal(data.format, 'kettleborn-export');
  for (const type of T.SEED_ORDER) {
    const local = raw().prepare(T.RECORD_TYPES[type].selectAll).all(U).length;
    assert.equal(data.records[type].length, local, type);
  }
  assert.equal(data.player.total_xp, 4120);
  assert.equal(data.chronicle.total_volume_kg, 48250.5);
  assert.ok(data.records.hunt_result.some((r: any) => r.voided_at), 'voided history is included');
  assert.ok(data.records.custom_workout.some((r: any) => r.deleted_at), 'deleted records are included');
  assert.equal(data.deviceSettings.unit_preference, 'kg');
  assert.ok(JSON.stringify(data).length > 1000);
});

test('deleting the cloud account keeps all local progress; pending bonuses become final; the install is local-only again', async () => {
  R.setSyncFeatureEnabledForTests(true);
  const authUser = await server.createUser();
  const t = {
    push: (d: string, items: unknown[]) => server.rpc(authUser, 'sync_push', [d, JSON.stringify(items)]),
    pull: (c: number, l: number) => server.rpc(authUser, 'sync_pull', [c, l]),
    accountStatus: () => server.rpc(authUser, 'sync_account_status', []),
  };
  const { store } = await H.legacyDevice();
  await O.enableAndSeed(db(), U, authUser);
  await syncOnce(db(), t, U, H.huntsTotalByMonster());
  const result = await store.getState().completeHunt({ monsterId: 'hydra', huntId: 'hydra-first-encounter', workoutId: 'everlasting-cycle', elapsedSeconds: 900, totalDamageDealt: 1, criticalHits: 0 });
  assert.equal(raw().prepare("SELECT status s FROM first_clear_claim WHERE stage_key = 'workout:everlasting-cycle'").get().s, 'pending');
  const xpBefore = raw().prepare('SELECT total_xp n FROM user').get().n;
  const resultsBefore = raw().prepare('SELECT COUNT(*) n FROM workout_result').get().n;

  let called = 0;
  R.setAccountDeleter(async () => {
    called += 1;
    await server.db.query('delete from auth.users where id = $1', [authUser]); // what the Edge Function does
    return { ok: true };
  });
  const outcome = await store.getState().deleteCloudAccount();
  assert.deepEqual(outcome, { ok: true });
  assert.equal(called, 1);
  assert.equal(raw().prepare('SELECT COUNT(*) n FROM workout_result').get().n, resultsBefore, 'no local progress removed');
  assert.equal(raw().prepare("SELECT status s FROM first_clear_claim WHERE stage_key = 'workout:everlasting-cycle'").get().s, 'local_final');
  assert.equal(raw().prepare('SELECT total_xp n FROM user').get().n, xpBefore + 100, 'the bonus is now counted');
  assert.equal(store.getState().user.totalXP, xpBefore + 100);
  const state = raw().prepare('SELECT sync_enabled, linked_user_id FROM sync_state').get();
  assert.deepEqual({ ...state }, { sync_enabled: 0, linked_user_id: null });
  assert.equal(raw().prepare('SELECT COUNT(*) n FROM sync_outbox').get().n, 0);
  const remaining = (await server.db.query('select count(*)::int n from public.sync_hunt_result where user_id = $1', [authUser])).rows as any[];
  assert.equal(remaining[0].n, 0, 'the cloud copy is gone (cascade)');
  assert.equal(raw().prepare('SELECT COUNT(*) n FROM workout_result WHERE uuid = ?').get(result.uuid).n, 1, 'the local copy stays');
});

test('a failed deletion changes nothing locally', async () => {
  R.setSyncFeatureEnabledForTests(true);
  const { store } = await H.legacyDevice();
  raw().exec("UPDATE sync_state SET sync_enabled = 1, linked_user_id = 'u-1'");
  R.setAccountDeleter(async () => ({ ok: false, error: 'Your account could not be deleted. Please try again.' }));
  const outcome = await store.getState().deleteCloudAccount();
  assert.equal(outcome.ok, false);
  assert.equal(raw().prepare('SELECT linked_user_id u FROM sync_state').get().u, 'u-1');
});
