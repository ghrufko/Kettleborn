import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * Cloud Save P8 — account linking (D4, D10) through the real store slice,
 * the real local database and the real server functions in PGlite.
 */
const H = await import(new URL('../../../testing/appHarness.ts', import.meta.url).href);
const { startTestServer } = await import(new URL('../../../testing/pgliteServer.ts', import.meta.url).href);
const R = await import(new URL('../runtime.ts', import.meta.url).href);
const { syncOnce } = await import(new URL('../engine.ts', import.meta.url).href);
const { decideLink, localHasProgress } = await import(new URL('../linking.ts', import.meta.url).href);
const O = await import(new URL('../outbox.ts', import.meta.url).href);

const U = 'local-hunter';
const server = await startTestServer();
let lastStore: any = null;
test.afterEach(() => lastStore?.getState().stopSync());
test.after(async () => {
  R.setSyncTransport(null);
  R.setSyncFeatureEnabledForTests(null);
  await server.close();
  H.cleanupWorkDir();
});

function transportFor(authUser: string) {
  return {
    push: (device: string, items: unknown[]) => server.rpc(authUser, 'sync_push', [device, JSON.stringify(items)]),
    pull: (cursor: number, limit: number) => server.rpc(authUser, 'sync_pull', [cursor, limit]),
    accountStatus: () => server.rpc(authUser, 'sync_account_status', []),
  };
}
const raw = () => H.raw();
const db = () => H.device.handle;
const syncNow = (authUser: string) => syncOnce(db(), transportFor(authUser), U, H.huntsTotalByMonster());
const dump = () => {
  const tables = raw().prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((r: any) => r.name);
  return Object.fromEntries(tables.map((t: string) => [t, raw().prepare(`SELECT * FROM "${t}" ORDER BY rowid`).all()]));
};
/** Waits until the slice's scheduled sync pass has settled. */
async function settle(store: any) {
  lastStore = store;
  for (let i = 0; i < 200; i += 1) {
    await new Promise((r) => setTimeout(r, 10));
    if (!store.getState().sync.syncing && raw().prepare('SELECT COUNT(*) n FROM sync_outbox').get().n === 0) return;
  }
}

test('feature off (every build today): signing in changes nothing and uploads nothing', async () => {
  R.setSyncFeatureEnabledForTests(false);
  const authUser = await server.createUser();
  R.setSyncTransport(transportFor(authUser));
  const { store } = await H.legacyDevice();
  const before = dump();
  await store.getState().handleAuthUser(authUser);
  assert.equal(store.getState().sync.decision, 'off');
  assert.deepEqual(dump(), before);
  assert.equal((await server.rpc(authUser, 'sync_account_status', [])).has_data, false);
});

test('link decisions: every combination of local progress and account data (D4)', async () => {
  const empty = await server.createUser();
  const full = await server.createUser();
  // Give `full` some data from another install.
  await H.legacyDevice();
  await O.enableAndSeed(db(), U, full);
  await syncNow(full);

  await H.legacyDevice(); // has progress
  assert.equal(await localHasProgress(db(), U), true);
  assert.equal(await decideLink(db(), transportFor(empty), U, empty), 'offer_link');
  assert.equal(await decideLink(db(), transportFor(full), U, full), 'refused');

  await H.freshDevice(); // no progress (default bells and settings don't count)
  assert.equal(await localHasProgress(db(), U), false);
  assert.equal(await decideLink(db(), transportFor(empty), U, empty), 'auto_link');
  assert.equal(await decideLink(db(), transportFor(full), U, full), 'offer_restore');

  raw().exec(`UPDATE sync_state SET linked_user_id = '${full}'`);
  assert.equal(await decideLink(db(), transportFor(full), U, full), 'resume');
  assert.equal(await decideLink(db(), transportFor(empty), U, empty), 'other_account', 'D10: bound to its first account');

  await H.freshDevice();
  raw().exec("UPDATE sync_state SET sync_blocked_reason = 'campaign_reset_count_mismatch'");
  assert.equal(await decideLink(db(), transportFor(empty), U, empty), 'blocked');
});

test('back up (offer_link → confirmLink): everything is uploaded and the install is bound to the account', async () => {
  R.setSyncFeatureEnabledForTests(true);
  const authUser = await server.createUser();
  R.setSyncTransport(transportFor(authUser));
  const { store } = await H.legacyDevice();
  await store.getState().handleAuthUser(authUser);
  assert.equal(store.getState().sync.decision, 'offer_link');
  assert.equal((await server.rpc(authUser, 'sync_account_status', [])).has_data, false, 'nothing before the player agrees');
  await store.getState().confirmLink();
  await settle(store);
  assert.equal((await server.rpc(authUser, 'sync_account_status', [])).has_data, true);
  assert.equal(raw().prepare('SELECT linked_user_id u FROM sync_state').get().u, authUser);
  assert.ok(store.getState().sync.lastSyncedAt);
});

test('refused (both have progress): nothing changes locally and nothing is uploaded', async () => {
  R.setSyncFeatureEnabledForTests(true);
  const authUser = await server.createUser();
  await H.legacyDevice();
  await O.enableAndSeed(db(), U, authUser);
  await syncNow(authUser);
  const accountRows = (await server.rpc(authUser, 'sync_pull', [0, 1000])).items.length;

  R.setSyncTransport(transportFor(authUser));
  const { store } = await H.legacyDevice();
  const before = dump();
  await store.getState().handleAuthUser(authUser);
  assert.equal(store.getState().sync.decision, 'refused');
  await store.getState().confirmLink(); // not offered after a refusal — and refused by the slice if called
  await store.getState().confirmRestore();
  assert.deepEqual(dump(), before, 'nothing changed on this device');
  assert.equal((await server.rpc(authUser, 'sync_pull', [0, 1000])).items.length, accountRows, 'nothing uploaded');
});

test('restore (offer_restore → confirmRestore) on a fresh install, then sign-out pauses and sign-in resumes (D10)', async () => {
  R.setSyncFeatureEnabledForTests(true);
  const authUser = await server.createUser();
  await H.legacyDevice();
  await O.enableAndSeed(db(), U, authUser);
  await syncNow(authUser);
  const xp = raw().prepare('SELECT total_xp n FROM user').get().n;

  R.setSyncTransport(transportFor(authUser));
  const { store } = await H.freshDevice();
  await store.getState().handleAuthUser(authUser);
  assert.equal(store.getState().sync.decision, 'offer_restore');
  await store.getState().confirmRestore();
  await settle(store);
  assert.equal(raw().prepare('SELECT total_xp n FROM user').get().n, xp);
  assert.equal(store.getState().user.totalXP, xp, 'the store was reloaded from the restored data');

  await store.getState().handleAuthUser(null);
  assert.equal(store.getState().sync.decision, 'signed_out');
  await H.Services.StopwatchRepository.saveResult(U, { id: 'sw-offline', completedAt: 't', elapsedSeconds: 10, laps: [], note: null });
  assert.equal(raw().prepare('SELECT COUNT(*) n FROM sync_outbox').get().n, 1, 'changes made while signed out are kept and queued');
  await store.getState().refreshSyncStatus();
  assert.equal(store.getState().sync.unsyncedChanges, 1);

  const other = await server.createUser();
  R.setSyncTransport(transportFor(other));
  await store.getState().handleAuthUser(other);
  assert.equal(store.getState().sync.decision, 'other_account');
  assert.equal((await server.rpc(other, 'sync_account_status', [])).has_data, false, 'nothing reaches another account');

  R.setSyncTransport(transportFor(authUser));
  await store.getState().handleAuthUser(authUser);
  assert.equal(store.getState().sync.decision, 'resume');
  await settle(store);
  assert.equal(raw().prepare('SELECT COUNT(*) n FROM sync_outbox').get().n, 0, 'uploaded after signing back in');
});

test('conflict review: keep the other version, or use this device\'s version as a new edit', async () => {
  R.setSyncFeatureEnabledForTests(true);
  const authUser = await server.createUser();
  const { path: pathA } = await H.legacyDevice();
  await O.enableAndSeed(db(), U, authUser);
  await syncNow(authUser);
  const { path: pathB } = await H.freshDevice();
  await O.enableForRestore(db(), authUser);
  await syncNow(authUser);

  await H.launch(pathA);
  await H.Services.WorkoutRepository.updateNotes('labyrinth-ladder-1756400000000', 'From A');
  await syncNow(authUser);
  const storeB = await H.launch(pathB);
  await H.Services.WorkoutRepository.updateNotes('labyrinth-ladder-1756400000000', 'From B');
  await syncNow(authUser);
  await storeB.getState().refreshSyncStatus();
  const [conflict] = storeB.getState().sync.conflicts;
  assert.equal(conflict.localValue.value, 'From B');

  R.setSyncTransport(transportFor(authUser));
  await storeB.getState().resolveConflict(conflict.conflictUuid, 'use_local');
  assert.equal(raw().prepare("SELECT notes FROM workout_result WHERE id = 'labyrinth-ladder-1756400000000'").get().notes, 'From B');
  await syncNow(authUser);
  assert.equal(raw().prepare("SELECT COUNT(*) n FROM sync_conflict WHERE status = 'open'").get().n, 0);
  await H.launch(pathA);
  await syncNow(authUser);
  assert.equal(raw().prepare("SELECT notes FROM workout_result WHERE id = 'labyrinth-ladder-1756400000000'").get().notes, 'From B', 'the chosen version reached the other device');
});

test('conflict review: a custom workout deleted elsewhere is never undeleted — this device\'s version is saved as a copy', async () => {
  const authUser = await server.createUser();
  const { path: pathA } = await H.legacyDevice();
  await O.enableAndSeed(db(), U, authUser);
  await syncNow(authUser);
  const { path: pathB } = await H.freshDevice();
  await O.enableForRestore(db(), authUser);
  await syncNow(authUser);

  await H.launch(pathA);
  await H.Services.CustomWorkoutRepository.delete('custom-workout-1755000000000');
  await syncNow(authUser);
  const storeB = await H.launch(pathB);
  const cw = raw().prepare("SELECT * FROM custom_workout WHERE id = 'custom-workout-1755000000000'").get();
  await H.Services.CustomWorkoutRepository.upsert(U, { id: cw.id, name: 'Renamed on B', exercises: [], weightKg: 16, weightBKg: 16, gearCount: 2, rounds: 5, restSeconds: 60, createdAt: cw.created_at, updatedAt: '2026-11-11T09:00:00.000Z' });
  await syncNow(authUser);
  await storeB.getState().refreshSyncStatus();
  const [conflict] = storeB.getState().sync.conflicts;
  assert.ok(conflict, 'edit against a deleted workout is a conflict');
  await storeB.getState().resolveConflict(conflict.conflictUuid, 'use_local');
  await syncNow(authUser);
  const rows = raw().prepare('SELECT name, deleted_at IS NOT NULL AS deleted FROM custom_workout ORDER BY name').all().map((r: any) => ({ ...r }));
  assert.deepEqual(rows, [
    { name: 'Morning Complex', deleted: 1 },
    { name: 'Renamed on B', deleted: 0 },
  ]);
});
