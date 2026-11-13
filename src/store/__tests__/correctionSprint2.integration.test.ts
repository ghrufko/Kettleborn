import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * Correction Sprint 2 — the real store, repositories, migrations and SQLite:
 * equipment rules enforced at completion, a one-bell flexible hunt, and a
 * Chain/Complex Custom Hunt saved and read back (also after a restart).
 */
const H = await import(new URL('../../testing/appHarness.ts', import.meta.url).href);
const { buildCustomWorkout } = await import(new URL('../../utils/customWorkoutStructure.ts', import.meta.url).href);
const { CONFIG_VERSION, CONFIG_VERSION_KEY } = await import(new URL('../../utils/customHuntModel.ts', import.meta.url).href);
const { getResultExerciseBreakdown } = await import(new URL('../../utils/resultWorkout.ts', import.meta.url).href);
const { getEncounterSnapshots } = await import(new URL('../../utils/encounterSnapshot.ts', import.meta.url).href);

test.after(() => H.cleanupWorkDir());

const { contentEngine } = H;
contentEngine.load();
const getWorkout = (id: string) => contentEngine.getWorkout(id);
const byId = (id: string) => contentEngine.getExerciseLibraryEntry(id);
const sum = (breakdown: any[], id: string) => breakdown.filter((e) => e.exerciseId === id).reduce((s, e) => s + e.totalReps, 0);

test('a fixed two-bell workout can\'t be completed with one bell; a flexible one runs its one-bell movements', async () => {
  const { store } = await H.legacyDevice();
  const hydra = await store.getState().completeHunt({
    monsterId: 'hydra', huntId: 'hydra-first-encounter', workoutId: 'everlasting-cycle',
    elapsedSeconds: 800, totalDamageDealt: 600, criticalHits: 0,
    actualWeightKg: 20, actualGearCount: 1, isCustomHunt: true, restSecondsUsed: 90,
  });
  assert.equal(hydra.weightValueB, 20, 'two bells enforced (second bell mirrors the first)');

  const behemoth = await store.getState().completeHunt({
    monsterId: 'behemoth', huntId: 'behemoth-first-encounter', workoutId: 'iron-ascent',
    elapsedSeconds: 1500, totalDamageDealt: 1900, criticalHits: 0,
    actualWeightKg: 20, actualGearCount: 1, isCustomHunt: true, restSecondsUsed: 120,
  });
  assert.equal(behemoth.weightValueB, null, 'one bell kept for a flexible workout');
  const summary = store.getState().lastHuntSummary;
  assert.equal(summary.exerciseBreakdown.find((e: any) => e.exerciseId === 'double-press'), undefined);
  assert.equal(summary.exerciseBreakdown.find((e: any) => e.exerciseId === 'press').totalReps, 24);
  // The saved row reads back the same way.
  assert.equal(sum(getResultExerciseBreakdown(behemoth, getWorkout, byId), 'press'), 24);
});

test('a Custom Sovereign (Chain 3 × Complex 2, jerk reps 2) is saved, rebuilt and shown identically after a restart', async () => {
  const { path, store } = await H.legacyDevice();
  const atlas = contentEngine.getWorkout('atlas-chain');
  const config = { [CONFIG_VERSION_KEY]: CONFIG_VERSION, 'phase.0.cycles': 3, 'phase.0.reps.1': 2, 'phase.1.cycles': 2 };
  const custom = buildCustomWorkout(atlas, 0, config);
  const saved = await store.getState().completeHunt({
    monsterId: 'atlas', huntId: 'atlas-first-encounter', workoutId: 'atlas-chain',
    elapsedSeconds: 900, totalDamageDealt: 2500, criticalHits: 0,
    actualWeightKg: 16, actualWeightBKg: 16, actualGearCount: 2, isCustomHunt: true,
    customWorkout: custom, restSecondsUsed: 150, repsOverridesUsed: config,
  });
  assert.deepEqual(saved.repsOverridesUsed, config);
  const summary = store.getState().lastHuntSummary;
  // Chain: 3 × 2 jerks; Complex: 2 cycles × 3 = 12 jerks in total.
  const jerks = summary.exerciseBreakdown.find((e: any) => e.name === 'Double Jerk').totalReps;
  assert.equal(jerks, 12);
  assert.equal(saved.volumeKg, summary.volumeKg);

  const relaunched = await H.launch(path);
  const results = await relaunched.getState().getAllResults();
  const again = results.find((r: any) => r.id === saved.id);
  const rebuilt = getResultExerciseBreakdown(again, getWorkout, byId);
  assert.equal(rebuilt.find((e: any) => e.name === 'Double Jerk').totalReps, 12);
  const snapshot = getEncounterSnapshots(contentEngine.getMonster('atlas'), results, getWorkout).get('atlas-first-encounter');
  assert.equal(snapshot.workout.rounds, 4, 'the encounter shows its own 3 passes + Complex');
});
