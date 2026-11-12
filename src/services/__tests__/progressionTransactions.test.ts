import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { openTestDatabase } = await import(new URL('../../testing/nodeSqliteDatabase.ts', import.meta.url).href);
const { buildVersion17Database, applyMigrationsUpTo, LEGACY_USER, LATEST_VERSION } = await import(
  new URL('../../testing/legacyDatabaseFixture.ts', import.meta.url).href
);

/**
 * File-wide mocks (repositories cache their `./db` import, so the database
 * module is mocked once and its target swapped per test):
 * - services/db → a real SQLite database (a migrated copy of the v17 fixture);
 * - expo-crypto → Node's own CSPRNG UUIDs.
 */
const current: { db: any } = { db: null };
mock.module(new URL('../db/index.ts', import.meta.url).href, {
  exports: { getDatabase: async () => current.db, migrations: [] },
});
mock.module('expo-crypto', { exports: { randomUUID } });

const S = await import(new URL('../index.ts', import.meta.url).href);
const {
  WorkoutRepository,
  CustomWorkoutRepository,
  SettingsRepository,
  TimerRepository,
  UserRepository,
  ChronicleRepository,
  ProgressRepository,
  FirstClearRepository,
  firstClearStageKey,
  persistHuntCompletion,
  resetCampaignProgressAtomically,
  resetMonsterProgressAtomically,
} = S;

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const U = LEGACY_USER;

const workDir = mkdtempSync(join(tmpdir(), 'kettleborn-phase1-'));
const fixturePath = join(workDir, 'fixture-v17.db');
buildVersion17Database(fixturePath);
let copies = 0;
test.beforeEach(() => {
  copies += 1;
  const path = join(workDir, `db-${copies}.db`);
  copyFileSync(fixturePath, path);
  applyMigrationsUpTo(path, LATEST_VERSION);
  current.db = openTestDatabase(path);
});
test.afterEach(() => current.db?.raw.close());
test.after(() => {
  try {
    rmSync(workDir, { recursive: true, force: true });
  } catch {
    // Best effort on Windows file locks.
  }
});

const count = (sql: string, ...p: unknown[]) => current.db.raw.prepare(sql).get(...p).n as number;

function newHuntResult(overrides: Record<string, unknown> = {}) {
  return {
    id: `iron-ascent-${Date.now()}`,
    uuid: randomUUID(),
    firstClearBonusXp: 100,
    voidedAt: null,
    userId: U,
    workoutId: 'iron-ascent',
    monsterId: 'behemoth',
    huntId: 'behemoth-first-encounter',
    completedAt: '2026-11-09T08:00:00.000Z',
    timeMinutes: 15,
    timeSeconds: 10,
    weightValueA: 20,
    weightValueB: 20,
    weightUnit: 'kg',
    notes: null,
    xpAwarded: 700,
    difficulty: 3,
    appVersion: '0.1.0',
    rungLaps: null,
    rpe: null,
    isCustomHunt: false,
    restSecondsUsed: null,
    structuralValueUsed: null,
    repsOverridesUsed: null,
    extraSets: null,
    ...overrides,
  };
}

function completionWrite(result: any, chronicleOverrides: Record<string, unknown> = {}) {
  return {
    result,
    monsterProgress: { userId: U, monsterId: 'behemoth', huntsCompleted: 1, huntsTotal: 3, defeated: false },
    chronicle: {
      userId: U,
      totalWorkouts: 10,
      totalHuntsCompleted: 10,
      totalMonstersDefeated: 1,
      totalVolumeKg: 50000,
      totalTrainingMinutes: 156,
      longestStreakDays: 6,
      currentStreakDays: 3,
      updatedAt: result.completedAt,
      ...chronicleOverrides,
    },
    xpGained: result.xpAwarded,
    newLevel: 8,
    firstClear: { stageKey: firstClearStageKey(result.workoutId), epoch: 0 },
  };
}

// ---------------------------------------------------------------- completeHunt atomicity

test('persistHuntCompletion commits result, first-clear claim, progression, Chronicle and XP together', async () => {
  const result = newHuntResult();
  const { user, origin } = await persistHuntCompletion(completionWrite(result));
  assert.equal(user.totalXP, 4120 + 700);
  assert.equal(user.level, 8);
  // Migration 19: the result is stamped with this install and its first creation order, in the same transaction.
  const state = current.db.raw.prepare('SELECT device_uuid, next_origin_order FROM sync_state').get();
  assert.deepEqual(origin, { deviceUuid: state.device_uuid, order: 1 });
  assert.equal(state.next_origin_order, 2);
  const stamped = current.db.raw.prepare('SELECT origin_device_uuid, origin_order FROM workout_result WHERE id = ?').get(result.id);
  assert.deepEqual({ ...stamped }, { origin_device_uuid: state.device_uuid, origin_order: 1 });
  const saved = current.db.raw.prepare('SELECT uuid, updated_at, first_clear_bonus_xp FROM workout_result WHERE id = ?').get(result.id);
  assert.deepEqual({ ...saved }, { uuid: result.uuid, updated_at: result.completedAt, first_clear_bonus_xp: 100 });
  assert.equal(await FirstClearRepository.hasClaim(U, 'workout:iron-ascent', 0), true);
  assert.equal((await ProgressRepository.getMonsterProgress(U, 'behemoth')).huntsCompleted, 1);
  assert.equal((await ChronicleRepository.getByUserId(U)).totalWorkouts, 10);
});

test('rollback: a failure in the Chronicle write undoes the result, claim, progression and XP', async () => {
  const before = {
    results: count('SELECT COUNT(*) n FROM workout_result'),
    claims: count('SELECT COUNT(*) n FROM first_clear_claim'),
    xp: (await UserRepository.getById(U)).totalXP,
    chronicle: await ChronicleRepository.getByUserId(U),
  };
  const result = newHuntResult();
  // NULL into a NOT NULL column — fails on the third of the four writes.
  await assert.rejects(persistHuntCompletion(completionWrite(result, { totalWorkouts: null })));
  assert.equal(count('SELECT next_origin_order n FROM sync_state'), 1, 'the origin counter rolled back too');
  assert.equal(count('SELECT COUNT(*) n FROM workout_result'), before.results);
  assert.equal(count('SELECT COUNT(*) n FROM first_clear_claim'), before.claims);
  assert.equal(await ProgressRepository.getMonsterProgress(U, 'behemoth'), null);
  assert.equal((await UserRepository.getById(U)).totalXP, before.xp);
  assert.deepEqual(await ChronicleRepository.getByUserId(U), before.chronicle);
});

test('rollback: a second first-clear claim for the same stage and epoch is refused and nothing is written', async () => {
  const before = count('SELECT COUNT(*) n FROM workout_result');
  const result = newHuntResult({ workoutId: 'endless-spiral', monsterId: 'aether', huntId: 'aether-first-encounter' });
  await assert.rejects(persistHuntCompletion(completionWrite(result)));
  assert.equal(count('SELECT COUNT(*) n FROM workout_result'), before);
  assert.equal((await UserRepository.getById(U)).totalXP, 4120);
});

// ---------------------------------------------------------------- resets

test('campaign reset: voids (never deletes) all history, zeroes totals, starts epoch 1, keeps a full snapshot', async () => {
  const totalRows = count('SELECT COUNT(*) n FROM workout_result');
  const fresh = ['aether', 'atlas', 'hydra'].map((m) => ({ userId: U, monsterId: m, huntsCompleted: 0, huntsTotal: 3, defeated: false }));
  const out = await resetCampaignProgressAtomically({ userId: U, freshMonsterProgress: fresh });

  assert.equal(out.voidedResultCount, 7);
  assert.equal(count('SELECT COUNT(*) n FROM workout_result'), totalRows, 'no row deleted');
  assert.deepEqual(await WorkoutRepository.getResultsForUser(U), [], 'progression/history views see nothing, as before');
  const all = await WorkoutRepository.getAllResultsIncludingVoided(U);
  assert.equal(all.length, 7);
  assert.ok(all.every((r: any) => r.voidedAt && r.xpAwarded > 0), 'voided rows keep their XP');
  assert.equal(count('SELECT COUNT(*) n FROM workout_result WHERE void_reset_uuid = ?', out.resetUuid), 7);

  assert.deepEqual(
    { level: out.user.level, xp: out.user.totalXP, epoch: out.user.progressionEpoch },
    { level: 1, xp: 0, epoch: 1 }
  );
  assert.equal(out.chronicle.totalWorkouts, 0);
  assert.equal(count('SELECT COUNT(*) n FROM monster_progress WHERE hunts_completed > 0 OR defeated = 1'), 0);
  assert.equal(count('SELECT COUNT(*) n FROM campaign_progress WHERE hunts_completed > 0'), 0);

  const log = current.db.raw.prepare('SELECT scope, voided_result_count, snapshot_json FROM progress_reset WHERE uuid = ?').get(out.resetUuid);
  const snapshot = JSON.parse(log.snapshot_json);
  assert.equal(log.scope, 'campaign');
  assert.equal(snapshot.user.totalXP, 4120);
  assert.equal(snapshot.user.level, 7);
  assert.equal(snapshot.chronicle.totalVolumeKg, 48250.5);
  assert.equal(snapshot.monsterProgress.find((m: any) => m.monsterId === 'aether').defeated, true);

  // New epoch: every stage's first-clear bonus is available again, as for a new player.
  assert.equal(await FirstClearRepository.hasClaim(U, 'workout:endless-spiral', 1), false);
});

test('campaign reset rollback: a failure leaves history, XP and Chronicle exactly as they were', async () => {
  const bad = [{ userId: U, monsterId: null, huntsCompleted: 0, huntsTotal: 3, defeated: false }];
  await assert.rejects(resetCampaignProgressAtomically({ userId: U, freshMonsterProgress: bad }));
  assert.equal((await WorkoutRepository.getResultsForUser(U)).length, 7);
  const user = await UserRepository.getById(U);
  assert.deepEqual({ xp: user.totalXP, level: user.level, epoch: user.progressionEpoch }, { xp: 4120, level: 7, epoch: 0 });
  assert.equal((await ChronicleRepository.getByUserId(U)).totalWorkouts, 9);
  assert.equal(count('SELECT COUNT(*) n FROM progress_reset'), 0);
});

test('monster reset: voids only that monster, keeps XP/Chronicle/epoch, and its first-clear bonus is not re-earnable', async () => {
  const out = await resetMonsterProgressAtomically({
    userId: U,
    monsterId: 'aether',
    resetProgress: { userId: U, monsterId: 'aether', huntsCompleted: 0, huntsTotal: 3, defeated: false },
  });
  assert.equal(out.voidedResultCount, 3);
  assert.deepEqual(await WorkoutRepository.getResultsForWorkout(U, 'endless-spiral'), []);
  assert.equal((await WorkoutRepository.getResultsForUser(U)).length, 4, 'other monsters untouched');
  assert.equal(count('SELECT COUNT(*) n FROM workout_result'), 7, 'nothing deleted');
  assert.equal((await ProgressRepository.getMonsterProgress(U, 'aether')).defeated, false);
  const user = await UserRepository.getById(U);
  assert.deepEqual({ xp: user.totalXP, level: user.level, epoch: user.progressionEpoch }, { xp: 4120, level: 7, epoch: 0 });
  assert.equal((await ChronicleRepository.getByUserId(U)).totalWorkouts, 9);
  // completeHunt's rule: first clear only if no active history AND no claim this epoch.
  assert.equal(await FirstClearRepository.hasClaim(U, firstClearStageKey('endless-spiral'), 0), true);
  const snapshot = JSON.parse(current.db.raw.prepare('SELECT snapshot_json FROM progress_reset WHERE uuid = ?').get(out.resetUuid).snapshot_json);
  assert.equal(snapshot.monsterProgress.huntsCompleted, 3);
});

// ---------------------------------------------------------------- deletion markers & change tracking

test('equipment delete is a marker: hidden from the Forge list, row kept; re-seeding the id restores it with the same uuid', async () => {
  const uuid = current.db.raw.prepare(`SELECT uuid FROM equipment WHERE id = 'kb-1'`).get().uuid;
  await SettingsRepository.deleteEquipment('kb-1');
  assert.equal((await SettingsRepository.getEquipmentForUser(U)).some((e: any) => e.id === 'kb-1'), false);
  assert.equal(count(`SELECT COUNT(*) n FROM equipment WHERE id = 'kb-1' AND deleted_at IS NOT NULL`), 1);
  await SettingsRepository.upsertEquipment({ id: 'kb-1', userId: U, type: 'kettlebell', weight: 16, unit: 'kg', label: '16 KG', owned: true });
  const restored = current.db.raw.prepare(`SELECT uuid, deleted_at FROM equipment WHERE id = 'kb-1'`).get();
  assert.deepEqual({ ...restored }, { uuid, deleted_at: null });
});

test('new custom-workout and timer results reference their parent by uuid (NULL when the parent is not stored)', async () => {
  const cw = current.db.raw.prepare(`SELECT uuid FROM custom_workout WHERE id = 'custom-workout-1755000000000'`).get().uuid;
  await CustomWorkoutRepository.saveResult(U, {
    id: 'custom-workout-1755000000000-1799999999999',
    customWorkoutId: 'custom-workout-1755000000000',
    completedAt: '2026-11-11T07:00:00.000Z',
    elapsedSeconds: 600,
    weightKg: 16,
    weightBKg: 16,
    gearCount: 2,
    workoutName: 'Morning Complex',
    rounds: 5,
    restSeconds: 60,
    totalReps: 50,
    exerciseBreakdown: null,
  });
  assert.equal(
    current.db.raw.prepare(`SELECT custom_workout_uuid u FROM custom_workout_result WHERE id = 'custom-workout-1755000000000-1799999999999'`).get().u,
    cw
  );
  const preset = current.db.raw.prepare('SELECT id, uuid, name FROM timer_preset').get();
  for (const [id, presetId, expected] of [
    ['timer-a', preset.id, preset.uuid],
    ['timer-b', 'builtin-tabata', null],
  ]) {
    await TimerRepository.saveResult({
      id,
      userId: U,
      presetId,
      presetName: 'x',
      totalDurationSeconds: 60,
      completedAt: '2026-11-11T07:00:00.000Z',
      weightKg: null,
      appVersion: '1.0.0',
    });
    assert.equal(current.db.raw.prepare('SELECT preset_uuid u FROM timer_result WHERE id = ?').get(id).u, expected);
  }
});

test('equipment sync_key (D8): default bells keep their fixed key on re-seed; a new bell uses its own uuid', async () => {
  const { DEFAULT_EQUIPMENT_SYNC_KEYS } = await import(new URL('../db/schema.ts', import.meta.url).href);
  await SettingsRepository.upsertEquipment({ id: 'kb-2', userId: U, type: 'kettlebell', weight: 20, unit: 'kg', label: '20 KG', owned: true });
  assert.equal(
    current.db.raw.prepare(`SELECT sync_key FROM equipment WHERE id = 'kb-2'`).get().sync_key,
    DEFAULT_EQUIPMENT_SYNC_KEYS['kb-2']
  );
  // A fresh install seeding the default (row did not exist yet) gets the same fixed key.
  current.db.raw.exec(`DELETE FROM equipment WHERE id = 'kb-1'`);
  await SettingsRepository.upsertEquipment({ id: 'kb-1', userId: U, type: 'kettlebell', weight: 16, unit: 'kg', label: '16 KG', owned: true });
  assert.equal(current.db.raw.prepare(`SELECT sync_key FROM equipment WHERE id = 'kb-1'`).get().sync_key, DEFAULT_EQUIPMENT_SYNC_KEYS['kb-1']);
  await SettingsRepository.upsertEquipment({ id: 'equipment-1', userId: U, type: 'kettlebell', weight: 32, unit: 'kg', label: '32 KG', owned: true });
  const bell = current.db.raw.prepare(`SELECT uuid, sync_key FROM equipment WHERE id = 'equipment-1'`).get();
  assert.equal(bell.sync_key, bell.uuid);
});

test('custom workout delete marks the workout and its completed results deleted — Journal hides them, history is kept', async () => {
  await CustomWorkoutRepository.delete('custom-workout-1755000000000');
  assert.deepEqual(await CustomWorkoutRepository.getAll(U), []);
  assert.equal(await CustomWorkoutRepository.getById('custom-workout-1755000000000'), null);
  assert.deepEqual(await CustomWorkoutRepository.getAllForUser(U), []);
  assert.equal(count('SELECT COUNT(*) n FROM custom_workout_result WHERE deleted_at IS NOT NULL'), 2);
  assert.equal(count('SELECT COUNT(*) n FROM custom_workout WHERE deleted_at IS NOT NULL'), 1);
});

test('timer preset delete is a marker; its timer results are untouched', async () => {
  await TimerRepository.deletePreset('custom-1754000000000');
  assert.deepEqual(await TimerRepository.getPresetsForUser(U), []);
  assert.equal(count('SELECT COUNT(*) n FROM timer_preset WHERE deleted_at IS NOT NULL'), 1);
  assert.equal(count('SELECT COUNT(*) n FROM timer_result'), 1);
});

test('editing RPE or notes stamps updated_at; reads still return every legacy field', async () => {
  const id = 'endless-spiral-1756100000000';
  await WorkoutRepository.updateRPE(id, 4);
  await WorkoutRepository.updateNotes(id, 'Grip failed late');
  const row = current.db.raw.prepare('SELECT rpe, notes, updated_at, completed_at FROM workout_result WHERE id = ?').get(id);
  assert.equal(row.rpe, 4);
  assert.equal(row.notes, 'Grip failed late');
  assert.ok(row.updated_at > row.completed_at);
  const [ladder] = await WorkoutRepository.getResultsForHunt(U, 'minotaur-first-encounter');
  assert.deepEqual(ladder.extraSets, [{ id: 'extra-1756400000500', exerciseId: 'vertical-pullup', reps: 8 }]);
  assert.equal(ladder.rungLaps.length, 2);
  assert.match(ladder.uuid, UUID_V4);
});

test('new records get fresh v4 UUIDs; an update keeps the original uuid', async () => {
  const workout = {
    id: 'custom-workout-1762000000000',
    name: 'Evening Flow',
    exercises: [{ exerciseId: 'swing', reps: 12, order: 0 }],
    weightKg: 16,
    weightBKg: null,
    gearCount: 2,
    rounds: 4,
    restSeconds: 45,
    createdAt: '2026-11-09T18:00:00.000Z',
    updatedAt: '2026-11-09T18:00:00.000Z',
  };
  await CustomWorkoutRepository.upsert(U, workout);
  const uuid = current.db.raw.prepare('SELECT uuid FROM custom_workout WHERE id = ?').get(workout.id).uuid;
  assert.match(uuid, UUID_V4);
  await CustomWorkoutRepository.upsert(U, { ...workout, name: 'Evening Flow II', updatedAt: '2026-11-09T19:00:00.000Z' });
  assert.equal(current.db.raw.prepare('SELECT uuid FROM custom_workout WHERE id = ?').get(workout.id).uuid, uuid);

  await WorkoutRepository.saveResult(newHuntResult({ uuid: undefined, id: 'iron-ascent-1762000000001' }));
  assert.match(current.db.raw.prepare(`SELECT uuid FROM workout_result WHERE id = 'iron-ascent-1762000000001'`).get().uuid, UUID_V4);
  assert.equal(count('SELECT COUNT(DISTINCT uuid) n FROM workout_result'), count('SELECT COUNT(*) n FROM workout_result'));
});
