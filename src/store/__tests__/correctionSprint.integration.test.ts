import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * Core gameplay & UX correction sprint — the real store, repositories,
 * migrations and SQLite (an existing player's v17 database, migrated on
 * launch), through completeHunt and back out through every statistic.
 */
const H = await import(new URL('../../testing/appHarness.ts', import.meta.url).href);
const { buildCustomWorkout } = await import(new URL('../../utils/customWorkoutStructure.ts', import.meta.url).href);
const { getWeeklySummary, getMonthlySummary } = await import(new URL('../../utils/chronicleSummary.ts', import.meta.url).href);
const { getEncounterSnapshots } = await import(new URL('../../utils/encounterSnapshot.ts', import.meta.url).href);
const { getResultExerciseBreakdown } = await import(new URL('../../utils/resultWorkout.ts', import.meta.url).href);
const { HuntCompletionInProgressError } = await import(new URL('../workoutSlice.ts', import.meta.url).href);

test.after(() => H.cleanupWorkDir());

const { contentEngine } = H;
contentEngine.load();
const getWorkout = (id: string) => contentEngine.getWorkout(id);
const byId = (id: string) => contentEngine.getExerciseLibraryEntry(id);
const statOf = (stats: any[], id: string) => stats.find((s) => s.exerciseId === id);
const laps = (n: number) => Array.from({ length: n }, (_, i) => ({ round: i + 1, durationSeconds: 45 }));

test('one Custom Minotaur ladder (5 rungs, 2 × 24 kg, + extra sets) produces the same numbers everywhere', async () => {
  const { store } = await H.legacyDevice();
  const ladder = contentEngine.getWorkout('labyrinth-ladder');
  const statsBefore = await store.getState().getAllExerciseStats();
  const chronicleBefore = store.getState().chronicle.totalVolumeKg;
  const resultsBefore = (await store.getState().getAllResults()).length;

  const saved = await store.getState().completeHunt({
    monsterId: 'minotaur',
    huntId: 'minotaur-first-encounter',
    workoutId: 'labyrinth-ladder',
    elapsedSeconds: 540,
    totalDamageDealt: 1500,
    criticalHits: 0,
    actualWeightKg: 24,
    actualWeightBKg: 24,
    actualGearCount: 2,
    isCustomHunt: true,
    rungLaps: laps(9),
    customWorkout: buildCustomWorkout(ladder, 5),
    restSecondsUsed: 3,
    structuralValueUsed: 5,
    extraSets: [
      { id: 'x1', exerciseId: 'double-kb-pushup', reps: 10 },
      { id: 'x2', exerciseId: 'vertical-pullup', reps: 5 },
    ],
  });

  // Victory screen (HuntSummary).
  const summary = store.getState().lastHuntSummary;
  const snatchName = (e: any) => e.name === 'Double Snatch';
  assert.equal(summary.exerciseBreakdown.find(snatchName).totalReps, 25);
  assert.equal(summary.exerciseBreakdown.find((e: any) => e.exerciseId === 'double-kb-pushup').totalReps, 10);
  assert.equal(summary.volumeKg, 2400);

  // The saved row and the lifetime Chronicle total.
  assert.equal(saved.volumeKg, 2400);
  assert.equal(store.getState().chronicle.totalVolumeKg - chronicleBefore, 2400);

  // Rebuilt from the saved row (what every later screen reads).
  const rebuilt = getResultExerciseBreakdown(saved, getWorkout, byId);
  assert.deepEqual(
    rebuilt.map((e: any) => [e.exerciseId ?? e.name, e.totalReps, e.volumeKg]),
    summary.exerciseBreakdown.map((e: any) => [e.exerciseId ?? e.name, e.totalReps, e.volumeKg])
  );

  // Exercise Records: +25 each, extras once.
  const statsAfter = await store.getState().getAllExerciseStats();
  const delta = (id: string, field: string) => (statOf(statsAfter, id)?.[field] ?? 0) - (statOf(statsBefore, id)?.[field] ?? 0);
  const snatchId = statsAfter.find((s: any) => s.exerciseName === 'Double Snatch').exerciseId;
  assert.equal(delta(snatchId, 'totalReps'), 25);
  assert.equal(delta(snatchId, 'totalVolumeKg'), 1200);
  assert.equal(delta('double-kb-pushup', 'totalReps'), 10);
  assert.equal(delta('vertical-pullup', 'totalReps'), 5);
  assert.equal(delta('double-kb-pushup', 'totalVolumeKg'), 0);

  // Weekly / monthly: this is the only hunt in this week and month of the fixture.
  const results = await store.getState().getAllResults();
  assert.equal(results.length, resultsBefore + 1);
  const at = new Date(saved.completedAt);
  assert.equal(getWeeklySummary(results, at).totalVolumeKg, 2400);
  assert.equal(getWeeklySummary(results, at).workouts, 1);
  assert.equal(getMonthlySummary(results, at).totalVolumeKg, 2400);

  // The same numbers after an app restart (read back from SQLite).
  const relaunched = await H.launch(H.device.path);
  const statsRelaunched = await relaunched.getState().getAllExerciseStats();
  assert.deepEqual(statsRelaunched, statsAfter);
  assert.equal(relaunched.getState().chronicle.totalVolumeKg, store.getState().chronicle.totalVolumeKg);
});

test('encounter snapshots: Encounters 1/2/3 keep their own configuration, also after a restart', async () => {
  const { path, store } = await H.legacyDevice();
  const hydra = contentEngine.getMonster('hydra');
  const cycle = contentEngine.getWorkout('everlasting-cycle');
  const [e1, e2, e3] = [...hydra.hunts].sort((a: any, b: any) => a.order - b.order);
  const complete = (huntId: string, extra: Record<string, unknown>) =>
    store.getState().completeHunt({
      monsterId: 'hydra', huntId, workoutId: 'everlasting-cycle', elapsedSeconds: 600,
      totalDamageDealt: 600, criticalHits: 0, ...extra,
    });

  // E1: Custom Hunt, 3 rounds, 24 + 20 kg, 75 s rest, snatch 7 reps.
  await complete(e1.id, {
    actualWeightKg: 24, actualWeightBKg: 20, actualGearCount: 2, isCustomHunt: true,
    customWorkout: buildCustomWorkout(cycle, 3, { 'hydra-snatch': 7 }),
    restSecondsUsed: 75, structuralValueUsed: 3, repsOverridesUsed: { 'hydra-snatch': 7 },
  });
  const afterE1 = getEncounterSnapshots(hydra, await store.getState().getAllResults(), getWorkout);
  // E2 (faster, same locked config) and E3 (canonical).
  await complete(e2.id, {
    elapsedSeconds: 500, actualWeightKg: 24, actualWeightBKg: 20, actualGearCount: 2, isCustomHunt: true,
    customWorkout: buildCustomWorkout(cycle, 3, { 'hydra-snatch': 7 }),
    restSecondsUsed: 75, structuralValueUsed: 3, repsOverridesUsed: { 'hydra-snatch': 7 },
  });
  await complete(e3.id, { elapsedSeconds: 400, actualWeightKg: 16, actualWeightBKg: 16 });

  const check = (snapshots: Map<string, any>) => {
    const s1 = snapshots.get(e1.id);
    assert.equal(s1.workout.rounds, 3);
    assert.equal(s1.workout.exercises.find((e: any) => e.id === 'hydra-snatch').targetReps, 7);
    assert.equal(s1.restSeconds, 75);
    assert.equal(s1.result.weightValueB, 20);
    assert.equal(s1.isCustomHunt, true);
    assert.equal(snapshots.get(e2.id).elapsedSeconds, 500);
    const s3 = snapshots.get(e3.id);
    assert.equal(s3.workout.rounds, 5, 'Encounter 3 is canonical — its own result, not Encounter 1/2\'s');
    assert.equal(s3.isCustomHunt, false);
    assert.equal(s3.restSeconds, e3.restSecondsOverride ?? cycle.restSeconds);
  };
  const later = getEncounterSnapshots(hydra, await store.getState().getAllResults(), getWorkout);
  check(later);
  assert.deepEqual(later.get(e1.id).workout, afterE1.get(e1.id).workout, 'completing E2/E3 did not overwrite E1');

  const relaunched = await H.launch(path);
  check(getEncounterSnapshots(hydra, await relaunched.getState().getAllResults(), getWorkout));
});

test('Mammoth Custom Hunt: one completion, rewards and progression granted exactly once', async () => {
  const { store } = await H.legacyDevice();
  const emom = contentEngine.getWorkout('mammoth-emom');
  const before = { xp: store.getState().user.totalXP, results: (await store.getState().getAllResults()).length };
  const params = {
    monsterId: 'mammoth', huntId: 'mammoth-first-encounter', workoutId: 'mammoth-emom',
    elapsedSeconds: 420, totalDamageDealt: 2000, criticalHits: 0,
    actualWeightKg: 16, actualWeightBKg: 16, actualGearCount: 2, isCustomHunt: true,
    rungLaps: laps(3), customWorkout: buildCustomWorkout(emom, 3), restSecondsUsed: 0, structuralValueUsed: 3,
  };
  const first = store.getState().completeHunt(params);
  await assert.rejects(store.getState().completeHunt(params), HuntCompletionInProgressError);
  const saved = await first;
  const after = { xp: store.getState().user.totalXP, results: (await store.getState().getAllResults()).length };
  assert.equal(after.results, before.results + 1);
  assert.equal(after.xp - before.xp, saved.xpAwarded);
  assert.equal(store.getState().monsterProgress.mammoth.huntsCompleted >= 1, true);
  // 3 configured rounds — the breakdown reports 3 rounds of work, not the canonical 5.
  const breakdown = getResultExerciseBreakdown(saved, getWorkout, byId);
  assert.equal(breakdown.find((e: any) => e.exerciseId === 'burpee-kettlebell').totalReps, 15);
  assert.equal(breakdown.find((e: any) => e.exerciseId === 'burpee-kettlebell').name, 'Double KB Burpee');
});
