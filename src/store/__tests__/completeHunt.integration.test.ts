import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Cloud Save Phase 1.1 — the REAL hunt-completion flow, end to end:
 * the production Zustand slices (workout, progress, user, chronicle,
 * achievement) composed into a real store, the production repositories,
 * the production migration runner (database.ts) and a real SQLite file —
 * a copy of the realistic version-17 fixture, migrated to 18 by that
 * runner on "launch". Only two platform modules are replaced:
 * - expo-sqlite → node:sqlite via nodeSqliteDatabase.ts (which mirrors
 *   expo-sqlite's withTransactionAsync statement for statement);
 * - expo-crypto → Node's own CSPRNG randomUUID.
 * Failures are injected with SQLite triggers, so the production code
 * path is never stubbed.
 */

const DATABASE_URL = new URL('../../services/db/database.ts', import.meta.url).href;
const { openTestDatabase } = await import(new URL('../../testing/nodeSqliteDatabase.ts', import.meta.url).href);
const { buildVersion17Database, LEGACY_USER, LATEST_VERSION } = await import(
  new URL('../../testing/legacyDatabaseFixture.ts', import.meta.url).href
);

/** One "device": the file its database lives in, the open handle, and the current launch's getDatabase. */
const device: { path: string; handle: any; getDatabase: (() => Promise<unknown>) | null } = {
  path: '',
  handle: null,
  getDatabase: null,
};
mock.module('expo-sqlite', {
  exports: {
    openDatabaseAsync: async () => {
      device.handle = openTestDatabase(device.path);
      return device.handle;
    },
  },
});
// Repositories import getDatabase from services/db once; each launch
// swaps in a fresh instance of the real database.ts behind it.
mock.module(new URL('../../services/db/index.ts', import.meta.url).href, {
  exports: { getDatabase: () => device.getDatabase!(), migrations: [] },
});
mock.module('expo-crypto', { exports: { randomUUID } });

const { createStore } = await import('zustand/vanilla');
const { createUserSlice } = await import(new URL('../userSlice.ts', import.meta.url).href);
const { createChronicleSlice } = await import(new URL('../chronicleSlice.ts', import.meta.url).href);
const { createProgressSlice } = await import(new URL('../progressSlice.ts', import.meta.url).href);
const { createWorkoutSlice } = await import(new URL('../workoutSlice.ts', import.meta.url).href);
const { createAchievementSlice } = await import(new URL('../achievementSlice.ts', import.meta.url).href);
const { HuntCompletionInProgressError } = await import(new URL('../workoutSlice.ts', import.meta.url).href);
const Services = await import(new URL('../../services/index.ts', import.meta.url).href);
const { contentEngine } = await import(new URL('../../../engines/content/index.ts', import.meta.url).href);
const { getLevelForTotalXP, PROGRESSION_CONFIG } = await import(
  new URL('../../../engines/progress/progressionEngine.ts', import.meta.url).href
);

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const U = LEGACY_USER;
const FIRST_CLEAR = PROGRESSION_CONFIG.firstClearBonus;

/** Hydra has no history in the fixture — a stage that has never been cleared. */
const HYDRA = {
  monsterId: 'hydra',
  huntId: 'hydra-first-encounter',
  workoutId: 'everlasting-cycle',
  elapsedSeconds: 900,
  totalDamageDealt: 1200,
  criticalHits: 3,
};
const HYDRA_STAGE = 'workout:everlasting-cycle';

const workDir = mkdtempSync(join(tmpdir(), 'kettleborn-complete-hunt-'));
const fixturePath = join(workDir, 'fixture-v17.db');
buildVersion17Database(fixturePath);
let copies = 0;

test.afterEach(async () => {
  await closeDevice();
});
test.after(() => {
  try {
    rmSync(workDir, { recursive: true, force: true });
  } catch {
    // Best effort: Windows can hold a lock on a just-closed SQLite file.
  }
});

async function closeDevice() {
  if (device.handle) {
    try {
      device.handle.raw.close();
    } catch {
      // Already closed.
    }
    device.handle = null;
  }
}

/** One app launch over `path`: the real migration runner, then a fresh store booted the way bootstrapApp boots it. */
async function launch(path: string) {
  await closeDevice();
  device.path = path;
  const database = await import(`${DATABASE_URL}?launch=${Math.random()}`);
  device.getDatabase = database.getDatabase;
  await database.getDatabase();

  return bootStore();
}

/** A fresh store booted the way bootstrapApp boots it, on the currently open connection. */
async function bootStore() {
  contentEngine.load();
  const store = createStore<any>()((...api: any[]) => ({
    ...createUserSlice(...api),
    ...createChronicleSlice(...api),
    ...createProgressSlice(...api),
    ...createWorkoutSlice(...api),
    ...createAchievementSlice(...api),
  }));
  const s = store.getState();
  await s.initializeUser();
  await s.initializeChronicle();
  await s.loadAllMonsterProgress();
  await s.loadAchievements();
  return store;
}

/** A fresh copy of the v17 fixture — an existing player's real-shaped database — launched (and so migrated to 18). */
async function freshDevice() {
  copies += 1;
  const path = join(workDir, `device-${copies}.db`);
  copyFileSync(fixturePath, path);
  const store = await launch(path);
  return { path, store };
}

function raw() {
  return device.handle.raw;
}

function userRow() {
  return raw().prepare('SELECT * FROM user WHERE id = ?').get(U);
}

function resultsFor(workoutId: string, { includeVoided = false } = {}) {
  return raw()
    .prepare(
      `SELECT * FROM workout_result WHERE user_id = ? AND workout_id = ? ${includeVoided ? '' : 'AND voided_at IS NULL'} ORDER BY completed_at, id`
    )
    .all(U, workoutId);
}

function claims(stageKey: string) {
  return raw().prepare('SELECT * FROM first_clear_claim WHERE user_id = ? AND stage_key = ? ORDER BY epoch').all(U, stageKey);
}

/** Every row of every table — the whole database, for "nothing changed" comparisons. */
function dumpDatabase() {
  const tables = raw()
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((row: any) => row.name);
  return Object.fromEntries(tables.map((t: string) => [t, raw().prepare(`SELECT * FROM "${t}" ORDER BY rowid`).all()]));
}

/** The persisted slices of store state completeHunt is allowed to change. */
function storeSnapshot(store: any) {
  const s = store.getState();
  return structuredClone({
    user: s.user,
    chronicle: s.chronicle,
    monsterProgress: s.monsterProgress,
    lastResult: s.lastResult,
    lastHuntSummary: s.lastHuntSummary,
    achievements: s.achievements,
  });
}

function failOn(table: string, events: Array<'INSERT' | 'UPDATE'>) {
  for (const event of events) {
    raw().exec(
      `CREATE TRIGGER inject_${table}_${event} BEFORE ${event} ON "${table}"
       BEGIN SELECT RAISE(ABORT, 'injected failure: ${event} ${table}'); END;`
    );
  }
}

function clearFailures(table: string, events: Array<'INSERT' | 'UPDATE'>) {
  for (const event of events) {
    raw().exec(`DROP TRIGGER inject_${table}_${event}`);
  }
}

// ---------------------------------------------------------------- A

test('A. a successful completion persists the result, progression, Chronicle, XP/level, first-clear claim and uuid together', async () => {
  const { store } = await freshDevice();
  const before = { user: userRow(), chronicle: store.getState().chronicle, hydra: store.getState().monsterProgress.hydra };
  assert.equal(before.user.total_xp, 4120);
  assert.equal(before.hydra.huntsCompleted, 0);

  const result = await store.getState().completeHunt(HYDRA);
  const summary = store.getState().lastHuntSummary;

  // Result row: exactly one, carrying a v4 uuid and the bonus split.
  const rows = resultsFor('everlasting-cycle');
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.match(row.uuid, UUID_V4);
  assert.equal(row.uuid, result.uuid);
  assert.equal(row.id, result.id);
  assert.equal(row.hunt_id, 'hydra-first-encounter');
  assert.equal(row.time_minutes * 60 + row.time_seconds, 900);
  assert.equal(row.xp_awarded, summary.xp.total);
  assert.equal(row.first_clear_bonus_xp, FIRST_CLEAR);
  assert.equal(row.voided_at, null);
  assert.equal(row.updated_at, row.completed_at);

  // First clear: bonus granted once, claim points at this result.
  assert.equal(summary.isFirstClear, true);
  assert.equal(summary.xp.firstClearBonus, FIRST_CLEAR);
  assert.deepEqual(
    claims(HYDRA_STAGE).map((c: any) => [c.epoch, c.result_uuid, c.claimed_at]),
    [[0, result.uuid, result.completedAt]]
  );

  // Monster progression.
  const progress = raw().prepare('SELECT * FROM monster_progress WHERE user_id = ? AND monster_id = ?').get(U, 'hydra');
  assert.equal(progress.hunts_completed, 1);
  assert.equal(progress.defeated, 0);
  assert.equal(store.getState().monsterProgress.hydra.huntsCompleted, 1);

  // Chronicle: +1 workout/hunt, the hunt's minutes and volume.
  const chronicle = raw().prepare('SELECT * FROM chronicle WHERE user_id = ?').get(U);
  assert.equal(chronicle.total_workouts, before.chronicle.totalWorkouts + 1);
  assert.equal(chronicle.total_hunts_completed, before.chronicle.totalHuntsCompleted + 1);
  assert.equal(chronicle.total_training_minutes, before.chronicle.totalTrainingMinutes + 15);
  assert.ok(summary.volumeKg > 0);
  assert.equal(chronicle.total_volume_kg, before.chronicle.totalVolumeKg + summary.volumeKg);
  assert.equal(chronicle.total_monsters_defeated, before.chronicle.totalMonstersDefeated);

  // XP and level: previous total + this hunt's XP; level from the engine's curve.
  const user = userRow();
  assert.equal(user.total_xp, 4120 + summary.xp.total);
  assert.equal(user.level, getLevelForTotalXP(4120 + summary.xp.total));
  assert.equal(summary.previousXP, 4120);
  assert.equal(summary.newXP, user.total_xp);
  assert.equal(user.progression_epoch, 0);

  // The store reflects exactly what was committed.
  const s = store.getState();
  assert.equal(s.user.totalXP, user.total_xp);
  assert.equal(s.user.level, user.level);
  assert.equal(s.chronicle.totalWorkouts, chronicle.total_workouts);
  assert.equal(s.lastResult.uuid, row.uuid);

  // Achievement side effect (outside the transaction, as before) still runs.
  const unlocked = raw().prepare('SELECT milestone_type FROM achievement WHERE user_id = ?').all(U).map((r: any) => r.milestone_type);
  assert.ok(unlocked.length >= 3, 'the fixture achievements are kept');
});

// ---------------------------------------------------------------- B

test('B1/B2. first completion awards the first-clear bonus; a repeat completion of the same stage does not', async () => {
  const { store } = await freshDevice();

  const first = await store.getState().completeHunt(HYDRA);
  const firstSummary = store.getState().lastHuntSummary;
  assert.equal(firstSummary.isFirstClear, true);
  assert.equal(firstSummary.xp.firstClearBonus, FIRST_CLEAR);

  const second = await store.getState().completeHunt({ ...HYDRA, huntId: 'hydra-second-encounter', elapsedSeconds: 880 });
  const secondSummary = store.getState().lastHuntSummary;
  assert.equal(secondSummary.isFirstClear, false);
  assert.equal(secondSummary.xp.firstClearBonus, 0);
  // Every completion is still its own fact with its own normal XP.
  assert.ok(secondSummary.xp.total > 0);

  const rows = resultsFor('everlasting-cycle');
  assert.deepEqual(rows.map((r: any) => [r.uuid, r.first_clear_bonus_xp]), [
    [first.uuid, FIRST_CLEAR],
    [second.uuid, 0],
  ]);
  assert.equal(claims(HYDRA_STAGE).length, 1);
  assert.equal(userRow().total_xp, 4120 + firstSummary.xp.total + secondSummary.xp.total);
});

test('B3. a monster reset does not let the same stage bonus be earned again (and keeps the voided history)', async () => {
  const { store } = await freshDevice();

  const first = await store.getState().completeHunt(HYDRA);
  const firstXp = store.getState().lastHuntSummary.xp;
  const xpAfterFirst = userRow().total_xp;

  await store.getState().resetMonsterProgress('hydra');
  assert.equal(store.getState().monsterProgress.hydra.huntsCompleted, 0);
  assert.equal(resultsFor('everlasting-cycle').length, 0, 'the result is no longer active');
  assert.equal(userRow().total_xp, xpAfterFirst, 'a monster reset never removes XP');
  assert.equal(userRow().progression_epoch, 0, 'a monster reset does not start a new epoch');

  // Same encounter, same time and weight: active history is empty again, so
  // the only difference from the first clear must be the withheld bonus.
  const replay = await store.getState().completeHunt(HYDRA);
  const replaySummary = store.getState().lastHuntSummary;
  assert.equal(replaySummary.isFirstClear, false);
  assert.equal(replaySummary.xp.firstClearBonus, 0);
  assert.equal(replaySummary.xp.total, firstXp.total - FIRST_CLEAR);

  const all = resultsFor('everlasting-cycle', { includeVoided: true });
  assert.deepEqual(all.map((r: any) => [r.uuid, r.first_clear_bonus_xp, r.voided_at !== null]), [
    [first.uuid, FIRST_CLEAR, true],
    [replay.uuid, 0, false],
  ]);
  assert.deepEqual(claims(HYDRA_STAGE).map((c: any) => c.result_uuid), [first.uuid]);
  assert.equal(store.getState().monsterProgress.hydra.huntsCompleted, 1);
});

test('B3 (legacy). a stage cleared before migration 18 is protected by its backfilled claim after a monster reset', async () => {
  const { store } = await freshDevice();
  assert.equal(claims('workout:endless-spiral').length, 1, 'backfilled from the fixture history');

  await store.getState().resetMonsterProgress('aether');
  await store.getState().completeHunt({
    monsterId: 'aether',
    huntId: 'aether-first-encounter',
    workoutId: 'endless-spiral',
    elapsedSeconds: 700,
    totalDamageDealt: 900,
    criticalHits: 1,
  });
  const summary = store.getState().lastHuntSummary;
  assert.equal(summary.isFirstClear, false);
  assert.equal(summary.xp.firstClearBonus, 0);
  assert.equal(claims('workout:endless-spiral').length, 1);
});

test('B4. a campaign reset starts a new progression epoch, and the stage bonus can be earned once in it', async () => {
  const { store } = await freshDevice();

  const first = await store.getState().completeHunt(HYDRA);
  await store.getState().resetCampaignProgress();

  const afterReset = userRow();
  assert.equal(afterReset.progression_epoch, 1);
  assert.equal(afterReset.total_xp, 0);
  assert.equal(afterReset.level, 1);
  assert.equal(store.getState().user.progressionEpoch, 1, 'the store carries the new epoch');

  const again = await store.getState().completeHunt(HYDRA);
  const againSummary = store.getState().lastHuntSummary;
  assert.equal(againSummary.isFirstClear, true);
  assert.equal(againSummary.xp.firstClearBonus, FIRST_CLEAR);
  assert.equal(userRow().total_xp, againSummary.xp.total);

  // ... and only once in the new epoch.
  await store.getState().completeHunt({ ...HYDRA, huntId: 'hydra-second-encounter' });
  assert.equal(store.getState().lastHuntSummary.xp.firstClearBonus, 0);

  assert.deepEqual(
    claims(HYDRA_STAGE).map((c: any) => [c.epoch, c.result_uuid]),
    [
      [0, first.uuid],
      [1, again.uuid],
    ]
  );
  // The epoch-0 result is voided, not deleted.
  assert.equal(resultsFor('everlasting-cycle', { includeVoided: true }).length, 3);
});

// ---------------------------------------------------------------- C

const FAILURE_POINTS: Array<{ name: string; table: string; events: Array<'INSERT' | 'UPDATE'> }> = [
  { name: 'saving the workout result (first write)', table: 'workout_result', events: ['INSERT'] },
  { name: 'recording the first-clear claim', table: 'first_clear_claim', events: ['INSERT'] },
  { name: 'updating monster progress', table: 'monster_progress', events: ['INSERT', 'UPDATE'] },
  { name: 'updating the Chronicle', table: 'chronicle', events: ['INSERT', 'UPDATE'] },
  { name: 'updating XP and level (last write)', table: 'user', events: ['UPDATE'] },
];

for (const point of FAILURE_POINTS) {
  test(`C. a failure while ${point.name} leaves no partial completion — database and store unchanged, and a retry succeeds`, async () => {
    const { store } = await freshDevice();
    const dbBefore = dumpDatabase();
    const storeBefore = storeSnapshot(store);

    failOn(point.table, point.events);
    await assert.rejects(store.getState().completeHunt(HYDRA), /injected failure/);

    // No orphaned result, no claim, no partial progress / Chronicle / XP:
    // every row of every table is exactly as before.
    assert.deepEqual(dumpDatabase(), dbBefore);
    // The store was never updated either.
    assert.deepEqual(storeSnapshot(store), storeBefore);

    // Nothing inconsistent was left behind: the retry is still a first clear.
    clearFailures(point.table, point.events);
    const result = await store.getState().completeHunt(HYDRA);
    assert.equal(store.getState().lastHuntSummary.xp.firstClearBonus, FIRST_CLEAR);
    assert.equal(resultsFor('everlasting-cycle').length, 1);
    assert.deepEqual(claims(HYDRA_STAGE).map((c: any) => c.result_uuid), [result.uuid]);
  });
}

test('C. a failure inside a non-first-clear completion (no claim written) also rolls back fully', async () => {
  const { store } = await freshDevice();
  await store.getState().completeHunt(HYDRA);
  const dbBefore = dumpDatabase();
  const storeBefore = storeSnapshot(store);

  failOn('user', ['UPDATE']);
  await assert.rejects(store.getState().completeHunt({ ...HYDRA, huntId: 'hydra-second-encounter' }), /injected failure/);
  assert.deepEqual(dumpDatabase(), dbBefore);
  assert.deepEqual(storeSnapshot(store), storeBefore);
});

test('C. an achievement failure after commit does not undo or fail the completion (unchanged best-effort behaviour)', async () => {
  const { store } = await freshDevice();
  failOn('achievement', ['INSERT']);

  const result = await store.getState().completeHunt(HYDRA);
  assert.equal(resultsFor('everlasting-cycle')[0].uuid, result.uuid);
  assert.equal(claims(HYDRA_STAGE).length, 1);
  assert.equal(store.getState().lastResult.uuid, result.uuid);
});

// ---------------------------------------------------------------- D

test('D. after relaunching on the same database, every persisted value is intact and the claim still applies', async () => {
  const { path, store } = await freshDevice();
  const result = await store.getState().completeHunt(HYDRA);
  const before = storeSnapshot(store);
  const dbBefore = dumpDatabase();

  // Close everything and launch again: a new database.ts instance (the
  // migration runner re-checks and applies nothing), new repositories'
  // connection, a brand-new store booted from disk.
  const relaunched = await launch(path);
  assert.deepEqual(dumpDatabase(), dbBefore, 'relaunching changes nothing on disk');
  const s = relaunched.getState();
  assert.deepEqual(s.user, before.user);
  assert.deepEqual(s.chronicle, before.chronicle);
  assert.deepEqual(s.monsterProgress.hydra, before.monsterProgress.hydra);
  assert.deepEqual(
    raw().prepare('SELECT version FROM schema_migrations ORDER BY version').all().map((r: any) => r.version),
    Array.from({ length: LATEST_VERSION }, (_, i) => i + 1)
  );

  const [latest] = await s.getAllResults();
  assert.deepEqual(latest, before.lastResult);
  assert.equal(latest.uuid, result.uuid);

  // The first-clear claim survived the relaunch.
  await s.completeHunt({ ...HYDRA, huntId: 'hydra-second-encounter' });
  assert.equal(relaunched.getState().lastHuntSummary.xp.firstClearBonus, 0);
  assert.equal(claims(HYDRA_STAGE).length, 1);
});

// ---------------------------------------------------------------- E

test('E. repeated completion attempts of one stage never create a second first-clear reward', async () => {
  const { store } = await freshDevice();
  for (let i = 0; i < 4; i += 1) {
    await store.getState().completeHunt({ ...HYDRA, elapsedSeconds: 900 - i });
  }
  const rows = resultsFor('everlasting-cycle');
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map((r: any) => r.first_clear_bonus_xp), [FIRST_CLEAR, 0, 0, 0]);
  assert.equal(claims(HYDRA_STAGE).length, 1);
});

test('E. two rapid calls to the same completeHunt action produce exactly one completion, and never two first-clear rewards', async () => {
  const { store } = await freshDevice();
  const before = { xp: userRow().total_xp, chronicle: store.getState().chronicle };

  const outcomes = await Promise.allSettled([
    store.getState().completeHunt(HYDRA),
    store.getState().completeHunt(HYDRA),
  ]);

  const saved = resultsFor('everlasting-cycle');
  const fulfilled = outcomes.filter((o) => o.status === 'fulfilled').length;
  const chronicle = raw().prepare('SELECT * FROM chronicle WHERE user_id = ?').get(U);
  const progress = raw().prepare('SELECT * FROM monster_progress WHERE user_id = ? AND monster_id = ?').get(U, 'hydra');
  const report = JSON.stringify({
    outcomes: outcomes.map((o) => (o.status === 'fulfilled' ? 'ok' : String((o as PromiseRejectedResult).reason?.message))),
    savedResults: saved.length,
    xpGained: userRow().total_xp - before.xp,
    chronicleWorkoutsGained: chronicle.total_workouts - before.chronicle.totalWorkouts,
    huntsCompleted: progress.hunts_completed,
  });

  // The first proceeds; the second is refused by the in-flight guard
  // before it reads or writes anything — no transaction error at all.
  assert.equal(outcomes[0].status, 'fulfilled', report);
  assert.equal(outcomes[1].status, 'rejected', report);
  assert.ok((outcomes[1] as PromiseRejectedResult).reason instanceof HuntCompletionInProgressError, report);

  // Each completion either fully happened or did not happen at all, and
  // the app was told the truth about which.
  assert.equal(saved.length, fulfilled, report);
  assert.equal(userRow().total_xp - before.xp, saved.reduce((sum: number, r: any) => sum + r.xp_awarded, 0), report);
  assert.equal(chronicle.total_workouts - before.chronicle.totalWorkouts, saved.length, report);
  assert.equal(progress.hunts_completed, saved.length, report);
  assert.equal(store.getState().user.totalXP, userRow().total_xp, report);
  assert.equal(store.getState().monsterProgress.hydra.huntsCompleted, 1, report);
  assert.equal(claims(HYDRA_STAGE).length, 1, report);
  assert.equal(raw().isTransaction, false);
});

test('E. the in-flight guard is released after a failed completion, so the player can retry', async () => {
  const { store } = await freshDevice();
  const dbBefore = dumpDatabase();
  failOn('chronicle', ['INSERT', 'UPDATE']);

  const [failed, refused] = await Promise.allSettled([
    store.getState().completeHunt(HYDRA),
    store.getState().completeHunt(HYDRA),
  ]);
  assert.match(String((failed as PromiseRejectedResult).reason?.message), /injected failure/);
  assert.ok((refused as PromiseRejectedResult).reason instanceof HuntCompletionInProgressError);
  assert.deepEqual(dumpDatabase(), dbBefore);

  clearFailures('chronicle', ['INSERT', 'UPDATE']);
  const retried = await store.getState().completeHunt(HYDRA);
  assert.equal(store.getState().lastHuntSummary.xp.firstClearBonus, FIRST_CLEAR);
  assert.deepEqual(resultsFor('everlasting-cycle').map((r: any) => r.uuid), [retried.uuid]);
});

// ------------------------------------------- Phase 1.2: transaction queue
// These bypass the store's in-flight guard on purpose (two independent
// stores, or a store plus a repository, on ONE connection) so that the
// transaction queue alone is what keeps each operation atomic.

const BASILISK = {
  monsterId: 'basilisk',
  huntId: 'basilisk-first-encounter',
  workoutId: 'basilisk-confrontation',
  elapsedSeconds: 840,
  totalDamageDealt: 1100,
  criticalHits: 2,
};
const CUSTOM_WORKOUT_ID = 'custom-workout-1755000000000';

function tableRows(table: string) {
  return raw().prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all();
}

test('Queue A. two overlapping completions of different stages both commit fully, with no transaction errors', async () => {
  const { store: first } = await freshDevice();
  const second = await bootStore();

  const outcomes = await Promise.allSettled([first.getState().completeHunt(HYDRA), second.getState().completeHunt(BASILISK)]);
  assert.deepEqual(outcomes.map((o) => o.status), ['fulfilled', 'fulfilled'], JSON.stringify(outcomes));

  const hydra = resultsFor('everlasting-cycle');
  const basilisk = resultsFor('basilisk-confrontation');
  assert.equal(hydra.length, 1);
  assert.equal(basilisk.length, 1);
  assert.equal(hydra[0].first_clear_bonus_xp, FIRST_CLEAR);
  assert.equal(basilisk[0].first_clear_bonus_xp, FIRST_CLEAR);
  assert.equal(claims(HYDRA_STAGE).length, 1);
  assert.equal(claims('workout:basilisk-confrontation').length, 1);
  assert.equal(userRow().total_xp, 4120 + hydra[0].xp_awarded + basilisk[0].xp_awarded);
  // The queue ran them in call order, so the second store saw the final total.
  assert.equal(second.getState().user.totalXP, userRow().total_xp);
  assert.equal(raw().isTransaction, false);
});

test('Queue A. two overlapping first clears of the SAME stage: one commits, the other is rolled back cleanly by the claim — never a second bonus', async (t) => {
  // Result ids are `${workoutId}-${Date.now()}`; two completions in the same
  // millisecond collide on that id first (also rolled back cleanly). A
  // strictly increasing clock makes the first-clear claim the rule tested.
  const realNow = Date.now.bind(Date);
  let tick = 0;
  t.mock.method(Date, 'now', () => realNow() + (tick += 1));
  const { store: first } = await freshDevice();
  const second = await bootStore();
  const secondBefore = storeSnapshot(second);

  const [a, b] = await Promise.allSettled([first.getState().completeHunt(HYDRA), second.getState().completeHunt(HYDRA)]);
  assert.equal(a.status, 'fulfilled');
  assert.equal(b.status, 'rejected');
  const reason = String((b as PromiseRejectedResult).reason?.message);
  assert.match(reason, /constraint failed: first_clear_claim/);
  assert.doesNotMatch(reason, /transaction/, 'no interference error — the claim rule, not the connection, refused it');

  const saved = resultsFor('everlasting-cycle');
  assert.equal(saved.length, 1);
  assert.equal(claims(HYDRA_STAGE).length, 1);
  assert.equal(userRow().total_xp, 4120 + saved[0].xp_awarded);
  assert.equal(
    raw().prepare('SELECT hunts_completed FROM monster_progress WHERE user_id = ? AND monster_id = ?').get(U, 'hydra').hunts_completed,
    1
  );
  assert.equal(first.getState().user.totalXP, userRow().total_xp);
  assert.deepEqual(storeSnapshot(second), secondBefore, 'the refused store never changed');
  assert.equal(raw().isTransaction, false);
});

test('Queue C. a hunt completion, a custom-workout deletion and a monster reset overlapping on one connection all commit intact', async () => {
  const { store } = await freshDevice();
  const other = await bootStore();

  const outcomes = await Promise.allSettled([
    store.getState().completeHunt(HYDRA),
    Services.CustomWorkoutRepository.delete(CUSTOM_WORKOUT_ID),
    other.getState().resetMonsterProgress('aether'),
  ]);
  assert.deepEqual(outcomes.map((o) => o.status), ['fulfilled', 'fulfilled', 'fulfilled'], JSON.stringify(outcomes));

  assert.equal(resultsFor('everlasting-cycle').length, 1);
  assert.ok(tableRows('custom_workout').every((r: any) => r.deleted_at !== null));
  assert.ok(tableRows('custom_workout_result').every((r: any) => r.deleted_at !== null));
  assert.equal(resultsFor('endless-spiral').length, 0);
  assert.equal(resultsFor('endless-spiral', { includeVoided: true }).length, 3);
  assert.equal(raw().prepare("SELECT COUNT(*) AS n FROM progress_reset WHERE scope = 'monster'").get().n, 1);
  assert.equal(raw().isTransaction, false);
});

test('Queue C. a failing hunt completion overlapping a custom-workout deletion: the completion rolls back alone, the deletion commits', async () => {
  const { store } = await freshDevice();
  const before = dumpDatabase();
  failOn('chronicle', ['INSERT', 'UPDATE']);

  const [completion, deletion] = await Promise.allSettled([
    store.getState().completeHunt(HYDRA),
    Services.CustomWorkoutRepository.delete(CUSTOM_WORKOUT_ID),
  ]);
  assert.equal(completion.status, 'rejected');
  assert.match(String((completion as PromiseRejectedResult).reason?.message), /injected failure/);
  assert.equal(deletion.status, 'fulfilled');

  const after = dumpDatabase();
  const deletionTables = ['custom_workout', 'custom_workout_result'];
  for (const table of Object.keys(before).filter((t) => !deletionTables.includes(t))) {
    assert.deepEqual(after[table], before[table], `${table} unchanged by the failed completion`);
  }
  assert.ok(tableRows('custom_workout').every((r: any) => r.deleted_at !== null));
  assert.ok(tableRows('custom_workout_result').every((r: any) => r.deleted_at !== null));
  assert.equal(raw().isTransaction, false);
});

test('Queue C. a failing custom-workout deletion overlapping a hunt completion: the deletion rolls back alone, the completion commits', async () => {
  const { store } = await freshDevice();
  failOn('custom_workout_result', ['UPDATE']);

  const [completion, deletion] = await Promise.allSettled([
    store.getState().completeHunt(HYDRA),
    Services.CustomWorkoutRepository.delete(CUSTOM_WORKOUT_ID),
  ]);
  assert.equal(completion.status, 'fulfilled');
  assert.equal(deletion.status, 'rejected');

  // The deletion marks the workout row first — that was rolled back too.
  assert.ok(tableRows('custom_workout').every((r: any) => r.deleted_at === null));
  assert.ok(tableRows('custom_workout_result').every((r: any) => r.deleted_at === null));
  assert.equal(resultsFor('everlasting-cycle').length, 1);
  assert.equal(claims(HYDRA_STAGE).length, 1);
  assert.equal(store.getState().user.totalXP, userRow().total_xp);
  assert.equal(raw().isTransaction, false);
});

// ------------------------------------------- Cloud Save P3: facts recorded at completion

function resultRow(uuid: string) {
  return raw().prepare('SELECT * FROM workout_result WHERE uuid = ?').get(uuid);
}
function chronicleRow() {
  return raw().prepare('SELECT * FROM chronicle WHERE user_id = ?').get(U);
}

test('P3. each result stores exactly what it added to the Chronicle, its streak, XP breakdown, epoch and origin', async () => {
  const { store } = await freshDevice();
  const device = raw().prepare('SELECT device_uuid FROM sync_state').get().device_uuid;

  for (let i = 0; i < 3; i += 1) {
    const before = chronicleRow();
    const result = await store.getState().completeHunt({ ...HYDRA, elapsedSeconds: 905 - i * 20 });
    const summary = store.getState().lastHuntSummary;
    const after = chronicleRow();
    const row = resultRow(result.uuid);

    assert.equal(row.volume_kg, summary.volumeKg);
    assert.equal(before.total_volume_kg + row.volume_kg, after.total_volume_kg, 'volume is the Chronicle increment, bit for bit');
    assert.equal(before.total_training_minutes + row.training_minutes, after.total_training_minutes);
    assert.equal(row.streak_after, after.current_streak_days);
    assert.equal(row.tz_offset_minutes, new Date().getTimezoneOffset());
    assert.equal(row.pr_bonus_xp, summary.xp.personalRecordBonus);
    assert.equal(row.repeat_multiplier, summary.xp.repeatMultiplier);
    assert.equal(row.prior_clears_seen, i);
    assert.equal(row.first_clear_bonus_xp, summary.xp.firstClearBonus);
    assert.equal(row.xp_awarded, summary.xp.total);
    assert.equal(row.progression_epoch, 0);
    assert.equal(row.monster_reset_count, 0);
    assert.equal(row.origin_device_uuid, device);
    assert.equal(row.origin_order, i + 1);
    // The store's lastResult is exactly the saved row (D also checks this after a relaunch).
    assert.equal(store.getState().lastResult.originOrder, i + 1);
  }
  // Two personal records in a row (905 → 885 → 865) record their PR bonus.
  assert.deepEqual(
    raw().prepare("SELECT pr_bonus_xp p FROM workout_result WHERE workout_id = 'everlasting-cycle' ORDER BY origin_order").all().map((r: any) => r.p),
    [0, 40, 40]
  );
});

test('P3 (D5). the epoch captured when the hunt started is the one stored, with its first-clear claim', async () => {
  const { store } = await freshDevice();
  const context = await store.getState().getHuntStartContext('hydra');
  assert.deepEqual(context, { epoch: 0, monsterResetCount: 0 });

  // Not possible from the UI today (Settings is unreachable mid-hunt), but it
  // is exactly what a reset arriving from another device will look like.
  await store.getState().resetCampaignProgress();
  const result = await store.getState().completeHunt({
    ...HYDRA,
    startedUnderEpoch: context.epoch,
    startedUnderMonsterResetCount: context.monsterResetCount,
  });
  assert.equal(resultRow(result.uuid).progression_epoch, 0);
  assert.deepEqual(claims(HYDRA_STAGE).map((c: any) => [c.epoch, c.result_uuid]), [[0, result.uuid]]);

  // Without a captured context the current epoch is used, as before.
  const later = await store.getState().completeHunt({ ...HYDRA, huntId: 'hydra-second-encounter' });
  assert.equal(resultRow(later.uuid).progression_epoch, 1);
});

test('P3 (D6). resets record their epoch and counts; later results carry the monster reset count', async () => {
  const { store } = await freshDevice();
  await store.getState().completeHunt(HYDRA);
  await store.getState().resetMonsterProgress('hydra');
  const monsterReset = raw().prepare("SELECT * FROM progress_reset WHERE scope = 'monster' ORDER BY rowid DESC").get();
  assert.deepEqual(
    [monsterReset.epoch, monsterReset.to_epoch, monsterReset.count_before, monsterReset.count_after],
    [0, null, 0, 1]
  );
  assert.deepEqual(await store.getState().getHuntStartContext('hydra'), { epoch: 0, monsterResetCount: 1 });
  const after = await store.getState().completeHunt(HYDRA);
  assert.equal(resultRow(after.uuid).monster_reset_count, 1);
  assert.equal(resultRow(after.uuid).progression_epoch, 0);

  await store.getState().resetCampaignProgress();
  const campaignReset = raw().prepare("SELECT * FROM progress_reset WHERE scope = 'campaign'").get();
  assert.deepEqual(
    [campaignReset.epoch, campaignReset.to_epoch, campaignReset.count_before, campaignReset.count_after],
    [0, 1, null, null]
  );
  assert.deepEqual(await store.getState().getHuntStartContext('hydra'), { epoch: 1, monsterResetCount: 0 });
});

test('P3 (C1). on an install whose reset history could not be reconstructed, monster counts are stored as NULL, never guessed', async () => {
  const { store } = await freshDevice();
  raw().prepare("UPDATE sync_state SET sync_blocked_reason = 'campaign_reset_count_mismatch'").run();
  const result = await store.getState().completeHunt(HYDRA);
  assert.equal(resultRow(result.uuid).monster_reset_count, null);
  assert.equal(resultRow(result.uuid).progression_epoch, 0, 'the epoch is still certain');
  await store.getState().resetMonsterProgress('hydra');
  const reset = raw().prepare("SELECT epoch, count_before, count_after FROM progress_reset WHERE scope = 'monster'").get();
  assert.deepEqual({ ...reset }, { epoch: 0, count_before: null, count_after: null });
  // Gameplay itself is unaffected.
  assert.equal(store.getState().monsterProgress.hydra.huntsCompleted, 0);
});
