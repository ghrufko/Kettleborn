import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * Cloud Save P7 — the sync engine end to end: two real local SQLite
 * installs (the real app stack, appHarness) syncing through the REAL
 * generated server functions running in PGlite (embedded PostgreSQL).
 * One account. Devices take turns (the harness has one open database at a
 * time), exactly like two phones that are each online at different times.
 */
const H = await import(new URL('../../../testing/appHarness.ts', import.meta.url).href);
const { startTestServer } = await import(new URL('../../../testing/pgliteServer.ts', import.meta.url).href);
const O = await import(new URL('../outbox.ts', import.meta.url).href);
const { syncOnce, setHuntActive, SyncScheduler } = await import(new URL('../engine.ts', import.meta.url).href);
const { SyncGuardError } = await import(new URL('../apply.ts', import.meta.url).href);

const U = 'local-hunter';
const server = await startTestServer();
test.after(async () => {
  await server.close();
  H.cleanupWorkDir();
});

function transportFor(authUser: string, faults: { dropNextPushAnswer?: boolean } = {}) {
  return {
    async push(device: string, items: unknown[]) {
      const answer = await server.rpc(authUser, 'sync_push', [device, JSON.stringify(items)]);
      if (faults.dropNextPushAnswer) {
        faults.dropNextPushAnswer = false;
        throw new Error('network dropped the answer'); // the server committed; the device never heard back
      }
      return answer;
    },
    pull: (cursor: number, limit: number) => server.rpc(authUser, 'sync_pull', [cursor, limit]),
    accountStatus: () => server.rpc(authUser, 'sync_account_status', []),
  };
}
const raw = () => H.raw();
const db = () => H.device.handle;
const sync = (t: any) => syncOnce(db(), t, U, H.huntsTotalByMonster());

const HYDRA = { monsterId: 'hydra', huntId: 'hydra-first-encounter', workoutId: 'everlasting-cycle', elapsedSeconds: 900, totalDamageDealt: 1000, criticalHits: 1 };
const BASILISK = { monsterId: 'basilisk', huntId: 'basilisk-first-encounter', workoutId: 'basilisk-confrontation', elapsedSeconds: 800, totalDamageDealt: 1000, criticalHits: 1 };

/** Everything a player can see, as stored on this install (timestamps that only mark local writes excluded). */
function displayedState() {
  const all = (sql: string) => raw().prepare(sql).all().map((r: any) => ({ ...r }));
  return {
    user: all('SELECT total_xp, level, progression_epoch FROM user'),
    chronicle: all('SELECT total_workouts, total_hunts_completed, total_monsters_defeated, total_volume_kg, total_training_minutes, current_streak_days, longest_streak_days FROM chronicle'),
    monsters: all('SELECT monster_id, hunts_completed, defeated FROM monster_progress ORDER BY monster_id'),
    results: all('SELECT uuid, xp_awarded, notes, rpe, voided_at IS NOT NULL AS voided FROM workout_result ORDER BY uuid'),
    claims: all('SELECT stage_key, epoch, result_uuid FROM first_clear_claim ORDER BY stage_key, epoch'),
    achievements: all('SELECT milestone_type, unlocked_at FROM achievement ORDER BY milestone_type'),
    equipment: all('SELECT sync_key, weight, label, deleted_at IS NOT NULL AS deleted FROM equipment ORDER BY sync_key'),
    unit: all('SELECT unit_preference FROM settings'),
    customWorkouts: all('SELECT uuid, name, deleted_at IS NOT NULL AS deleted FROM custom_workout ORDER BY uuid'),
    customResults: all('SELECT uuid, deleted_at IS NOT NULL AS hidden FROM custom_workout_result ORDER BY uuid'),
    timers: all('SELECT uuid, name, deleted_at IS NOT NULL AS deleted FROM timer_preset ORDER BY uuid'),
    timerResults: all('SELECT uuid, preset_uuid FROM timer_result ORDER BY uuid'),
    stopwatch: all('SELECT uuid, elapsed_seconds, note FROM stopwatch_result ORDER BY uuid'),
    resets: all('SELECT uuid FROM progress_reset ORDER BY uuid'),
  };
}

/** Device A: an existing player (legacy fixture) who links to an empty account and seeds. */
async function linkedLegacyDevice(authUser: string) {
  const a = await H.legacyDevice();
  await O.enableAndSeed(db(), U, authUser);
  return a;
}

test('link + seed, then restore on a fresh install: the restored install shows exactly the same progress', async () => {
  const authUser = await server.createUser();
  const t = transportFor(authUser);
  const a = await linkedLegacyDevice(authUser);
  await a.store.getState().completeHunt(HYDRA);
  await H.Services.SettingsRepository.deleteEquipment('equipment-1757000000000');
  const report = await sync(t);
  assert.ok(report.pushed > 20);
  assert.equal(report.quarantined, 0, 'nothing rejected');
  const aState = displayedState();

  await H.freshDevice();
  await O.enableForRestore(db(), authUser);
  const restored = await sync(t);
  assert.ok(restored.pulled > 20);
  assert.deepEqual(displayedState(), aState);
  assert.equal(raw().prepare('SELECT COUNT(*) n FROM sync_outbox').get().n, 0, 'a restore uploads nothing');
});

test('repeated downloads and uploads change nothing; a lost acknowledgement is retried as a duplicate', async () => {
  const authUser = await server.createUser();
  const faults = { dropNextPushAnswer: true };
  const t = transportFor(authUser, faults);
  const a = await linkedLegacyDevice(authUser);
  await assert.rejects(sync(t), /dropped/);
  assert.ok(raw().prepare('SELECT COUNT(*) n FROM sync_outbox').get().n > 0, 'unanswered rows are kept');
  await sync(t);
  assert.equal(raw().prepare('SELECT COUNT(*) n FROM sync_outbox').get().n, 0);
  const rowsOnServer = async () => (await server.as(authUser, 'select count(*)::int n from public.sync_hunt_result'))[0].n;
  const before = await rowsOnServer();
  const state = displayedState();
  raw().exec('UPDATE sync_state SET pull_cursor = 0');
  await sync(t);
  await sync(t);
  assert.deepEqual(displayedState(), state, 'downloading everything again changes nothing');
  assert.equal(await rowsOnServer(), before, 'no duplicate rows on the server');
  void a;
});

test('two devices offline: every hunt counts once on both; the first-clear bonus goes to the first claim accepted; confirmed XP never drops', async () => {
  const authUser = await server.createUser();
  const t = transportFor(authUser);
  const { path: pathA } = await linkedLegacyDevice(authUser);
  await sync(t);
  const { path: pathB } = await H.freshDevice();
  await O.enableForRestore(db(), authUser);
  await sync(t);

  // Both devices clear Hydra for the first time while offline.
  const storeB = await H.launch(pathB);
  await storeB.getState().completeHunt(HYDRA);
  const bSummary = storeB.getState().lastHuntSummary;
  assert.equal(bSummary.pendingFirstClearBonus, 100, 'linked install: the bonus is pending');
  const bXpAfterHunt = raw().prepare('SELECT total_xp n FROM user').get().n;
  await storeB.getState().completeHunt(BASILISK);

  const storeA = await H.launch(pathA);
  const xpBeforeA = raw().prepare('SELECT total_xp n FROM user').get().n;
  await storeA.getState().completeHunt(HYDRA);
  const aHunt = storeA.getState().lastResult;
  assert.equal(raw().prepare('SELECT total_xp n FROM user').get().n, xpBeforeA + aHunt.xpAwarded - 100, 'pending bonus not in confirmed XP');
  await sync(t); // A's claim reaches the server first
  assert.equal(raw().prepare('SELECT status s FROM first_clear_claim WHERE stage_key = ?').get('workout:everlasting-cycle').s, 'confirmed');
  assert.equal(raw().prepare('SELECT total_xp n FROM user').get().n, xpBeforeA + aHunt.xpAwarded, 'confirmed: the bonus is added');

  await H.launch(pathB);
  await sync(t);
  assert.ok(raw().prepare('SELECT total_xp n FROM user').get().n >= bXpAfterHunt, 'B never loses confirmed XP');
  assert.equal(raw().prepare('SELECT result_uuid r FROM first_clear_claim WHERE stage_key = ?').get('workout:everlasting-cycle').r, aHunt.uuid, "A's claim holds on B");
  const bState = displayedState();

  await H.launch(pathA);
  await sync(t);
  assert.deepEqual(displayedState(), bState, 'both devices converge to the same progress');
  const hydraResults = raw().prepare("SELECT COUNT(*) n FROM workout_result WHERE workout_id = 'everlasting-cycle'").get().n;
  assert.equal(hydraResults, 2, 'both hunts kept');
});

test('the same notes edited on two devices: the first upload wins, the other is kept in a conflict record', async () => {
  const authUser = await server.createUser();
  const t = transportFor(authUser);
  const { path: pathA } = await linkedLegacyDevice(authUser);
  await sync(t);
  const { path: pathB } = await H.freshDevice();
  await O.enableForRestore(db(), authUser);
  await sync(t);

  await H.launch(pathA);
  await H.Services.WorkoutRepository.updateNotes('labyrinth-ladder-1756400000000', 'From A');
  await sync(t);
  await H.launch(pathB);
  await H.Services.WorkoutRepository.updateNotes('labyrinth-ladder-1756400000000', 'From B');
  const report = await sync(t);
  assert.equal(report.conflicts, 1);
  const conflict = raw().prepare('SELECT * FROM sync_conflict').get();
  assert.equal(JSON.parse(conflict.local_value_json).value, 'From B', 'nothing typed is lost');
  assert.equal(raw().prepare("SELECT notes FROM workout_result WHERE id = 'labyrinth-ladder-1756400000000'").get().notes, 'From A');
});

test('D5: a hunt started before a campaign reset made on another device is kept in history; the notice is recorded', async () => {
  const authUser = await server.createUser();
  const t = transportFor(authUser);
  const { path: pathA } = await linkedLegacyDevice(authUser);
  await sync(t);
  const { path: pathB } = await H.freshDevice();
  await O.enableForRestore(db(), authUser);
  await sync(t);

  const storeA = await H.launch(pathA);
  const started = await storeA.getState().getHuntStartContext('basilisk'); // A starts a hunt under epoch 0, offline

  const storeB = await H.launch(pathB);
  await storeB.getState().resetCampaignProgress();
  await sync(t);

  const storeA2 = await H.launch(pathA);
  const result = await storeA2.getState().completeHunt({ ...BASILISK, startedUnderEpoch: started.epoch, startedUnderMonsterResetCount: started.monsterResetCount });
  await sync(t);
  const row = raw().prepare('SELECT progression_epoch, voided_at FROM workout_result WHERE uuid = ?').get(result.uuid);
  assert.equal(row.progression_epoch, 0);
  assert.ok(row.voided_at, 'kept in history, not in current progress');
  assert.equal(raw().prepare('SELECT progression_epoch n FROM user').get().n, 1);
  assert.equal(raw().prepare('SELECT total_xp n FROM user').get().n, 0, 'the reset cleared XP, as on the device that reset');
  const notice = raw().prepare("SELECT data_json FROM sync_notice WHERE kind = 'campaign_reset_elsewhere'").get();
  assert.equal(JSON.parse(notice.data_json).huntsMovedToHistory, 1);
  assert.equal(raw().prepare('SELECT COUNT(*) n FROM workout_result WHERE uuid = ?').get(result.uuid).n, 1, 'never deleted');
});

test('D6: a monster reset made on another device clears that monster here; XP unchanged; custom-workout deletion hides its results', async () => {
  const authUser = await server.createUser();
  const t = transportFor(authUser);
  const { path: pathA } = await linkedLegacyDevice(authUser);
  await sync(t);
  const { path: pathB } = await H.freshDevice();
  await O.enableForRestore(db(), authUser);
  await sync(t);
  const storeB = await H.launch(pathB);
  await storeB.getState().resetMonsterProgress('aether');
  await H.Services.CustomWorkoutRepository.delete('custom-workout-1755000000000');
  await sync(t);

  await H.launch(pathA);
  const xp = raw().prepare('SELECT total_xp n FROM user').get().n;
  await sync(t);
  assert.deepEqual({ ...raw().prepare("SELECT hunts_completed, defeated FROM monster_progress WHERE monster_id = 'aether'").get() }, { hunts_completed: 0, defeated: 0 });
  assert.equal(raw().prepare("SELECT COUNT(*) n FROM workout_result WHERE monster_id = 'aether' AND voided_at IS NULL").get().n, 0);
  assert.equal(raw().prepare('SELECT total_xp n FROM user').get().n, xp);
  assert.equal(raw().prepare('SELECT COUNT(*) n FROM custom_workout_result WHERE deleted_at IS NULL').get().n, 0);
});

test('the guard: a sync that would lower confirmed XP without a campaign reset is rolled back entirely', async () => {
  const authUser = await server.createUser();
  const t = transportFor(authUser);
  await linkedLegacyDevice(authUser);
  await sync(t);
  raw().exec('UPDATE user SET total_xp = total_xp + 500'); // stored XP no longer explained by the facts
  const before = displayedState();
  const cursor = raw().prepare('SELECT pull_cursor c FROM sync_state').get().c;
  await assert.rejects(sync(t), (e: unknown) => e instanceof SyncGuardError);
  assert.deepEqual(displayedState(), before);
  assert.equal(raw().prepare('SELECT pull_cursor c FROM sync_state').get().c, cursor);
});

test('nothing syncs during a hunt, on an unlinked install, or on a blocked install', async () => {
  const authUser = await server.createUser();
  const t = transportFor(authUser);
  await H.legacyDevice();
  assert.equal((await sync(t)).skipped, 'not_linked');
  await O.enableAndSeed(db(), U, authUser);
  setHuntActive(true);
  try {
    assert.equal((await sync(t)).skipped, 'hunt_active');
  } finally {
    setHuntActive(false);
  }
  raw().exec("UPDATE sync_state SET sync_blocked_reason = 'x'");
  assert.equal((await sync(t)).skipped, 'blocked');
  assert.equal((await server.rpc(authUser, 'sync_account_status', [])).has_data, false, 'nothing uploaded');
});

test('scheduler backoff: 5 s doubling to a 15-minute cap, ±20 % jitter', () => {
  assert.equal(SyncScheduler.backoffMs(1, 0.5), 5_000);
  assert.equal(SyncScheduler.backoffMs(2, 0.5), 10_000);
  assert.equal(SyncScheduler.backoffMs(20, 0.5), 900_000);
  assert.equal(SyncScheduler.backoffMs(1, 0), 4_000);
  assert.equal(SyncScheduler.backoffMs(1, 1), 6_000);
});

test('D3 notices and status: pending XP shown until the server answers, then "confirmed" or "already earned on another device"', async () => {
  const authUser = await server.createUser();
  const t = transportFor(authUser);
  const { path: pathA } = await linkedLegacyDevice(authUser);
  await sync(t);
  const { path: pathB } = await H.freshDevice();
  await O.enableForRestore(db(), authUser);
  await sync(t);

  const storeB = await H.launch(pathB);
  await storeB.getState().completeHunt(HYDRA);
  await storeB.getState().refreshSyncStatus();
  assert.equal(storeB.getState().sync.pendingXP, 100, 'pending XP is reported separately');

  const storeA = await H.launch(pathA);
  await storeA.getState().completeHunt(HYDRA);
  await sync(t);
  await storeA.getState().refreshSyncStatus();
  assert.deepEqual(storeA.getState().sync.notices.map((n: any) => [n.kind, n.data.xp]), [['bonus_confirmed', 100]]);
  assert.equal(storeA.getState().sync.pendingXP, 0);

  const storeB2 = await H.launch(pathB);
  await sync(t);
  await storeB2.getState().refreshSyncStatus();
  assert.deepEqual(storeB2.getState().sync.notices.map((n: any) => n.kind), ['bonus_lost']);
  assert.equal(storeB2.getState().sync.pendingXP, 0, 'nothing pending any more, and nothing was taken away');
  await storeB2.getState().dismissNotice(storeB2.getState().sync.notices[0].id);
  assert.equal(storeB2.getState().sync.notices.length, 0);
});

test('the "recalculated" notice appears only when merged history lowers the current streak', async () => {
  const authUser = await server.createUser();
  const t = transportFor(authUser);
  const { path: pathA } = await linkedLegacyDevice(authUser);
  await sync(t);
  const { path: pathB } = await H.freshDevice();
  await O.enableForRestore(db(), authUser);
  await sync(t);
  assert.equal(raw().prepare("SELECT COUNT(*) n FROM sync_notice WHERE kind = 'recalculated'").get().n, 0, 'not for a restore');

  // B trains today; A (offline) trains today too: both one-day streaks, no drop → no notice.
  const storeB = await H.launch(pathB);
  await storeB.getState().completeHunt(BASILISK);
  await sync(t);
  const storeA = await H.launch(pathA);
  await storeA.getState().completeHunt(HYDRA);
  await sync(t);
  assert.equal(raw().prepare("SELECT COUNT(*) n FROM sync_notice WHERE kind = 'recalculated'").get().n, 0, 'not for ordinary new workouts');
});
