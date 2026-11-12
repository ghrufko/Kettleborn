import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * Core gameplay & UX correction sprint — regression tests on the real
 * content (content/*.json through the Content Engine), pure functions only.
 * The store/database flow is covered in
 * src/store/__tests__/correctionSprint.integration.test.ts.
 */
const { contentEngine } = await import(new URL('../../../engines/content/index.ts', import.meta.url).href);
const R = await import(new URL('../resultWorkout.ts', import.meta.url).href);
const { getAllExerciseStats } = await import(new URL('../exerciseStats.ts', import.meta.url).href);
const { getWeeklySummary, getMonthlySummary } = await import(new URL('../chronicleSummary.ts', import.meta.url).href);
const { formatExerciseRecord } = await import(new URL('../exerciseRecordFormat.ts', import.meta.url).href);
const { getEncounterSnapshots } = await import(new URL('../encounterSnapshot.ts', import.meta.url).href);
const { getExerciseBreakdown } = await import(new URL('../exerciseBreakdown.ts', import.meta.url).href);
const { computeHistoricalRanks } = await import(new URL('../rankHistory.ts', import.meta.url).href);
const C = await import(new URL('../customWorkoutStructure.ts', import.meta.url).href);
const { getWorkoutRoundExercises } = await import(new URL('../workoutPresentation.ts', import.meta.url).href);
const { makeReducer, createInitialState } = await import(new URL('../../../engines/battle/useBattleEngine.ts', import.meta.url).href);
const { getBattlePlan, isOpenEndedWorkout, rawRoundDamage } = await import(
  new URL('../../../engines/battle/battlePlan.ts', import.meta.url).href
);
const { getRoundCompletionOutcome, getWindowExpiryOutcome } = await import(
  new URL('../../../engines/session/useWorkoutSession.ts', import.meta.url).href
);
const { PORTRAIT_FRAMING, getPortraitFramingLayout, REFERENCE_FRAME_DIAMETER } = await import(
  new URL('../../constants/portraitFraming.ts', import.meta.url).href
);

contentEngine.load();
const workout = (id: string) => contentEngine.getWorkout(id)!;
const getWorkout = (id: string) => contentEngine.getWorkout(id);
const byId = (id: string) => contentEngine.getExerciseLibraryEntry(id);
const byName = (name: string) => contentEngine.getExerciseLibraryEntryByName(name);

/** Content revision timestamp (Hydra's Double Jerk, Basilisk's Double KB Burpee). */
const AFTER = '2026-11-12T09:00:00.000Z';
const BEFORE = '2026-11-01T09:00:00.000Z';

let seq = 0;
function result(overrides: Record<string, unknown>): any {
  seq += 1;
  return {
    id: `r-${seq}`,
    uuid: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    userId: 'local-hunter',
    workoutId: 'labyrinth-ladder',
    monsterId: 'minotaur',
    huntId: 'minotaur-first-encounter',
    completedAt: AFTER,
    timeMinutes: 10,
    timeSeconds: 0,
    weightValueA: 16,
    weightValueB: 16,
    weightUnit: 'kg',
    notes: null,
    xpAwarded: 100,
    difficulty: 3,
    appVersion: '0.1.0',
    rungLaps: null,
    rpe: null,
    isCustomHunt: false,
    restSecondsUsed: null,
    structuralValueUsed: null,
    repsOverridesUsed: null,
    extraSets: null,
    volumeKg: null,
    ...overrides,
  };
}
const entry = (breakdown: any[], id: string) => breakdown.find((e) => e.exerciseId === id);
const stat = (stats: any[], id: string) => stats.find((s) => s.exerciseId === id);
const hydraResult = (overrides: Record<string, unknown>) =>
  result({ workoutId: 'everlasting-cycle', monsterId: 'hydra', huntId: 'hydra-first-encounter', ...overrides });

/** A 5-rung Custom Minotaur ladder (1→5→1, 9 rungs) with 2 × 24 kg — the reported hunt. */
const minotaurCustom5 = (overrides: Record<string, unknown> = {}) =>
  result({
    isCustomHunt: true,
    structuralValueUsed: 5,
    restSecondsUsed: 3,
    weightValueA: 24,
    weightValueB: 24,
    rungLaps: Array.from({ length: 9 }, (_, i) => ({ round: i + 1, durationSeconds: 40 })),
    ...overrides,
  });

// ------------------------------------------------------------- 1. Custom Hunt statistics

test('Minotaur Custom Hunt, 5-rung ladder: 25 Double Snatch + 25 Double Thruster (ascending/descending), 2,400 kg', () => {
  const breakdown = R.getResultExerciseBreakdown(minotaurCustom5(), getWorkout, byId);
  const snatch = breakdown.find((e: any) => e.name === 'Double Snatch');
  const thruster = breakdown.find((e: any) => e.name === 'Double Thruster');
  // 1+2+3+4+5+4+3+2+1 = 25 — the completed ladder, not max rung × rounds.
  assert.equal(snatch.totalReps, 25);
  assert.equal(thruster.totalReps, 25);
  assert.equal(snatch.volumeKg, 25 * 48);
  assert.equal(R.getResultVolumeKg(minotaurCustom5(), getWorkout, byId), 2400);
  // The canonical ladder (max rung 10) is still 100 each — the number that was wrongly reported.
  const canonical = R.getResultExerciseBreakdown(result({ weightValueA: 24, weightValueB: 24 }), getWorkout, byId);
  assert.equal(canonical.find((e: any) => e.name === 'Double Snatch').totalReps, 100);
});

test('Exercise Records, weekly and monthly volume all agree with the hunt\'s own Exercise Breakdown', () => {
  const now = new Date(AFTER);
  const r = minotaurCustom5();
  assert.equal(getWeeklySummary([r], now).totalVolumeKg, 2400);
  assert.equal(getMonthlySummary([r], now).totalVolumeKg, 2400);
  const stats = getAllExerciseStats([r], getWorkout, byName, byId);
  const snatch = stats.find((s: any) => s.exerciseName === 'Double Snatch');
  assert.equal(snatch.totalReps, 25);
  assert.equal(snatch.totalVolumeKg, 1200);
  const breakdownTotal = R.getResultExerciseBreakdown(r, getWorkout, byId).reduce((sum: number, e: any) => sum + e.volumeKg, 0);
  const recordsTotal = stats.reduce((sum: number, s: any) => sum + s.totalVolumeKg, 0);
  assert.equal(recordsTotal, breakdownTotal);
  assert.equal(recordsTotal, 2400);
});

test('weekly/monthly volume: the stored volume (what completeHunt added to the Chronicle) is used; older rows are rebuilt', () => {
  const now = new Date(AFTER);
  assert.equal(getWeeklySummary([minotaurCustom5()], now).totalVolumeKg, 2400, 'rebuilt (no stored volume)');
  assert.equal(getWeeklySummary([minotaurCustom5({ volumeKg: 2400 })], now).totalVolumeKg, 2400, 'stored');
  const old = minotaurCustom5({ completedAt: '2026-08-01T09:00:00.000Z' });
  assert.equal(getWeeklySummary([old], now).totalVolumeKg, 0, 'another week');
  assert.equal(getMonthlySummary([old], now).totalVolumeKg, 0, 'another month');
  // Two hunts in the week add up — no double counting, no canonical substitution.
  assert.equal(getWeeklySummary([minotaurCustom5(), minotaurCustom5()], now).totalVolumeKg, 4800);
});

test('Custom Hunt on other monsters: custom rounds and per-exercise reps count, with the real bell weights (16 + 18 kg)', () => {
  const hydra = hydraResult({
    isCustomHunt: true, structuralValueUsed: 3, restSecondsUsed: 60, repsOverridesUsed: { 'hydra-snatch': 8 },
    weightValueA: 16, weightValueB: 18,
  });
  const breakdown = R.getResultExerciseBreakdown(hydra, getWorkout, byId);
  assert.equal(entry(breakdown, 'double-snatch').totalReps, 24, '8 reps × 3 rounds');
  assert.equal(entry(breakdown, 'double-snatch').volumeKg, 24 * 34, 'both real bells: 16 + 18 = 34 kg per rep');
  assert.equal(entry(breakdown, 'double-jerk').totalReps, 15, 'Hydra\'s jerk, 5 × 3 rounds');
  assert.equal(entry(breakdown, 'double-swing').totalReps, 30);
  // Canonical Hydra is unchanged: 5 rounds, canonical reps.
  const canonical = R.getResultExerciseBreakdown(hydraResult({}), getWorkout, byId);
  assert.equal(entry(canonical, 'double-snatch').totalReps, 25);
  assert.equal(entry(canonical, 'double-snatch').volumeKg, 25 * 32);
});

test('a single-bell Custom Hunt counts one bell; a canonical double-bell workout counts both', () => {
  const single = hydraResult({ isCustomHunt: true, restSecondsUsed: 90, weightValueA: 24, weightValueB: null });
  assert.equal(entry(R.getResultExerciseBreakdown(single, getWorkout, byId), 'double-snatch').volumeKg, 25 * 24);
  const pair = hydraResult({ weightValueA: 20, weightValueB: 20 });
  assert.equal(entry(R.getResultExerciseBreakdown(pair, getWorkout, byId), 'double-snatch').volumeKg, 25 * 40);
});

// ------------------------------------------------------------- 3. Exercise Records format

test('Exercise Records show "N reps — X kg done"; bodyweight and carries never get a fabricated kg figure', () => {
  const kg = (v: number) => Math.round(v);
  assert.equal(
    formatExerciseRecord({ totalReps: 100, totalVolumeKg: 4800, totalDistanceFt: 0, totalSteps: 0 }, kg, 'kg'),
    `100 reps — ${(4800).toLocaleString()} kg done`
  );
  assert.equal(formatExerciseRecord({ totalReps: 40, totalVolumeKg: 0, totalDistanceFt: 0, totalSteps: 0 }, kg, 'kg'), '40 reps');
  assert.equal(formatExerciseRecord({ totalReps: 0, totalVolumeKg: 0, totalDistanceFt: 0, totalSteps: 250 }, kg, 'kg'), '250 steps');
  const lb = (v: number) => Math.round(v * 2.20462);
  assert.equal(
    formatExerciseRecord({ totalReps: 10, totalVolumeKg: 100, totalDistanceFt: 0, totalSteps: 0 }, lb, 'lb'),
    '10 reps — 220 lb done'
  );
});

// ------------------------------------------------------------- 4. Leviathan carry steps

test('Leviathan Custom Hunt: Front Rack Carry steps are configurable, recorded as steps (never reps or volume)', () => {
  const abyss = workout('abyss-carry');
  assert.equal(abyss.exercises.find((e: any) => e.id === 'leviathan-carry').targetSteps, 50, 'canonical unchanged');
  const groups = C.getRepsCustomizableGroups(abyss);
  assert.ok(groups[0].exercises.some((e: any) => e.id === 'leviathan-carry' && C.isAmountCustomizable(e)));

  const custom = C.buildCustomWorkout(abyss, 2, { 'leviathan-carry': 80 });
  const carry = custom.exercises.find((e: any) => e.id === 'leviathan-carry');
  assert.equal(carry.targetSteps, 80);
  assert.equal(carry.targetReps, undefined);
  assert.equal(carry.durationSeconds, 48, 'expected carry time scales with distance (30 s × 80/50)');

  const r = result({
    workoutId: 'abyss-carry', monsterId: 'leviathan', huntId: 'leviathan-first-encounter',
    isCustomHunt: true, structuralValueUsed: 2, restSecondsUsed: 120, repsOverridesUsed: { 'leviathan-carry': 80 },
  });
  const breakdown = R.getResultExerciseBreakdown(r, getWorkout, byId);
  const carryEntry = entry(breakdown, 'front-rack-carry');
  assert.equal(carryEntry.totalSteps, 160, '80 steps × 2 rounds');
  assert.equal(carryEntry.totalReps, 0);
  assert.equal(carryEntry.volumeKg, 0);
  assert.equal(stat(getAllExerciseStats([r], getWorkout, byName, byId), 'front-rack-carry').totalSteps, 160);
  // Standard Leviathan: 50 steps × 5 rounds.
  assert.equal(entry(R.getResultExerciseBreakdown(result({ workoutId: 'abyss-carry', monsterId: 'leviathan' }), getWorkout, byId), 'front-rack-carry').totalSteps, 250);
});

// ------------------------------------------------------------- Behemoth three phases

test('Behemoth Custom Hunt: reps are set per phase, the three phases stay three phases', () => {
  const iron = workout('iron-ascent');
  const groups = C.getRepsCustomizableGroups(iron);
  assert.deepEqual(groups.map((g: any) => g.label), iron.sections.map((s: any) => s.label));
  assert.equal(groups.length, 3);
  assert.equal(C.getStructuralControlConfig(iron), null, 'still no structural control');

  const overrides = { 'behemoth-p1-snatch-a': 10, 'behemoth-p2-press': 8, 'behemoth-p3-press': 9 };
  const custom = C.buildCustomWorkout(iron, 0, overrides);
  assert.equal(custom.sections.length, 3);
  assert.deepEqual(custom.sections.map((s: any) => s.label), iron.sections.map((s: any) => s.label));
  const find = (id: string) => custom.sections.flatMap((s: any) => s.exercises).find((e: any) => e.id === id);
  assert.equal(find('behemoth-p1-snatch-a').targetReps, 10);
  assert.equal(find('behemoth-p2-press').targetReps, 8);
  assert.equal(find('behemoth-p3-press').targetReps, 9);
  assert.equal(find('behemoth-p1-press').targetReps, 12, 'Phase I press untouched — overrides are per phase, by step id');
  assert.equal(iron.sections[0].exercises[0].targetReps, 20, 'canonical content never mutated');

  const r = result({
    workoutId: 'iron-ascent', monsterId: 'behemoth', huntId: 'behemoth-first-encounter',
    isCustomHunt: true, restSecondsUsed: 120, repsOverridesUsed: overrides, weightValueA: 20, weightValueB: 20,
  });
  const breakdown = R.getResultExerciseBreakdown(r, getWorkout, byId);
  assert.equal(entry(breakdown, 'tactical-snatch').totalReps, 10);
  assert.equal(entry(breakdown, 'tactical-snatch').volumeKg, 10 * 20, 'single-bell phase: one bell');
  assert.equal(entry(breakdown, 'press').totalReps, 12 + 8, 'Phase I + Phase II single press');
  assert.equal(entry(breakdown, 'double-press').totalReps, 9);
  assert.equal(entry(breakdown, 'double-press').volumeKg, 9 * 40, 'two-bell phase: both bells');
});

// ------------------------------------------------------------- 10. Extra push-ups / pull-ups

test('extra push-up / pull-up sets are real reps: in the breakdown and the records, exactly once, no fabricated kg', () => {
  const extras = [
    { id: 'x1', exerciseId: 'double-kb-pushup', reps: 10 },
    { id: 'x2', exerciseId: 'double-kb-pushup', reps: 15 },
    { id: 'x3', exerciseId: 'vertical-pullup', reps: 5 },
    { id: 'x4', exerciseId: 'vertical-pullup', reps: 0 },
  ];
  const r = hydraResult({ extraSets: extras });
  const breakdown = R.getResultExerciseBreakdown(r, getWorkout, byId);
  assert.equal(entry(breakdown, 'double-kb-pushup').totalReps, 25);
  assert.equal(entry(breakdown, 'double-kb-pushup').extraReps, 25);
  assert.equal(entry(breakdown, 'double-kb-pushup').volumeKg, 0);
  assert.equal(entry(breakdown, 'vertical-pullup').totalReps, 5, 'a 0-rep set adds nothing');
  assert.equal(breakdown.filter((e: any) => e.exerciseId === 'double-kb-pushup').length, 1, 'one row per exercise');

  const stats = getAllExerciseStats([r, hydraResult({ extraSets: [extras[2]] })], getWorkout, byName, byId);
  assert.equal(stat(stats, 'double-kb-pushup').totalReps, 25);
  assert.equal(stat(stats, 'double-kb-pushup').totalSessions, 1);
  assert.equal(stat(stats, 'vertical-pullup').totalReps, 10, '5 + 5 across two hunts');
  assert.equal(stat(stats, 'vertical-pullup').totalVolumeKg, 0);
  // Extras never change the hunt's volume.
  assert.equal(
    R.getResultVolumeKg(r, getWorkout, byId),
    R.getResultVolumeKg(hydraResult({}), getWorkout, byId)
  );
  // Reading twice changes nothing (no accumulation in the source rows).
  assert.deepEqual(R.getResultExerciseBreakdown(r, getWorkout, byId), breakdown);
  assert.equal(r.extraSets.length, 4);
});

test('an extra set of a movement already in the workout is added to that row, not a second one', () => {
  const merged = R.addExtraSetsToBreakdown(
    [{ exerciseId: 'double-kb-pushup', name: 'Double KB Push-Up', totalReps: 10, volumeKg: 0, weightAKg: 0, weightBKg: null }],
    [{ id: 'x', exerciseId: 'double-kb-pushup', reps: 6 }],
    byId
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0].totalReps, 16);
  assert.equal(merged[0].extraReps, 6);
});

// ------------------------------------------------------------- 6. Encounter snapshots

test('encounter snapshots: each encounter shows its own configuration, independent of the others', () => {
  const minotaur = contentEngine.getMonster('minotaur')!;
  const e1 = minotaurCustom5({ huntId: 'minotaur-first-encounter', completedAt: '2026-11-12T09:00:00.000Z' });
  const e2 = minotaurCustom5({
    huntId: 'minotaur-second-encounter', completedAt: '2026-11-13T09:00:00.000Z',
    restSecondsUsed: 45, weightValueA: 20, weightValueB: 22,
  });
  const before = getEncounterSnapshots(minotaur, [e1], getWorkout);
  const after = getEncounterSnapshots(minotaur, [e1, e2], getWorkout);
  const first = after.get('minotaur-first-encounter');
  assert.equal(first.result.id, e1.id);
  assert.equal(first.workout.rounds, 9, 'the Custom 5-rung ladder, not the default 19 rungs');
  assert.equal(first.restSeconds, 3);
  assert.deepEqual(before.get('minotaur-first-encounter').workout, first.workout, 'a later encounter never changes an earlier one');
  const second = after.get('minotaur-second-encounter');
  assert.equal(second.result.id, e2.id);
  assert.equal(second.restSeconds, 45);
  assert.equal(second.result.weightValueB, 22);
  assert.equal(after.has('minotaur-final-hunt'), false, 'an encounter with no result shows no snapshot');
  // A canonical encounter snapshot is the canonical workout (incl. the custom target time scaling only for custom).
  const canonical = getEncounterSnapshots(minotaur, [result({})], getWorkout).get('minotaur-first-encounter');
  assert.equal(canonical.workout.rounds, 19);
  assert.ok(first.workout.targetTimeSeconds < canonical.workout.targetTimeSeconds, 'custom target time scales with structure');
});

// ------------------------------------------------------------- 8/12/13. Boss HP ↔ objectives

function fight(w: any, battle: any, rounds: number) {
  const reduce = makeReducer(battle, w);
  let state = createInitialState(battle);
  const hpAfterRound: number[] = [];
  for (let round = 1; round <= rounds; round += 1) {
    const exercises = getWorkoutRoundExercises(w, round).map((exercise: any) => ({
      exercise,
      repsCompleted: exercise.targetReps ?? 1,
      skipped: false,
    }));
    state = reduce(state, { type: 'ROUND_COMPLETED', round, durationSeconds: 60, exercises });
    hpAfterRound.push(state.currentHP);
  }
  const finished = reduce(state, { type: 'WORKOUT_COMPLETED', elapsedSeconds: 1, previousBestSeconds: 99999 });
  return { hpAfterRound, state, finished };
}

function assertSynced(label: string, w: any, battle: any) {
  const { hpAfterRound, state, finished } = fight(w, battle, w.rounds);
  hpAfterRound.slice(0, -1).forEach((hp, i) => assert.ok(hp > 0, `${label}: boss alive after round ${i + 1} of ${w.rounds} (hp ${hp})`));
  assert.equal(state.currentHP, 0, `${label}: final objective leaves 0 HP`);
  assert.equal(state.isDefeated, true, `${label}: defeated after the final objective`);
  assert.equal(finished.currentHP, 0, `${label}: still 0 after completion`);
  assert.equal(finished.isDefeated, true);
}

test('every fixed-round monster: HP reaches exactly 0 on the final objective, never before (canonical)', () => {
  for (const monster of contentEngine.getAllMonsters()) {
    const ids = [...new Set(monster.hunts.map((h: any) => h.workoutId).filter(Boolean))] as string[];
    for (const id of ids) {
      const w = workout(id);
      if (isOpenEndedWorkout(w)) continue;
      assertSynced(`${monster.id}/${id}`, w, monster.battle);
    }
  }
});

test('Leviathan: no HP left when the boss falls, canonical and every Custom Hunt round count', () => {
  const monster = contentEngine.getMonster('leviathan')!;
  const abyss = workout('abyss-carry');
  assertSynced('leviathan canonical', abyss, monster.battle);
  for (let rounds = 1; rounds <= 10; rounds += 1) {
    const custom = C.buildCustomWorkout(abyss, rounds, rounds % 2 ? { 'leviathan-carry': 80 } : undefined);
    assertSynced(`leviathan ${rounds} rounds`, custom, C.scaleBattleConfigForCustomWorkout(abyss, custom, monster.battle));
  }
});

test('Mammoth: defeated after the configured rounds (canonical and Custom Hunt 1–10), HP 0, not before', () => {
  const monster = contentEngine.getMonster('mammoth')!;
  const emom = workout('mammoth-emom');
  assert.equal(isOpenEndedWorkout(emom), false, 'Mammoth is a fixed-round EMOM');
  assertSynced('mammoth canonical', emom, monster.battle);
  for (let rounds = 1; rounds <= 10; rounds += 1) {
    const custom = C.buildCustomWorkout(emom, rounds);
    assertSynced(`mammoth ${rounds} rounds`, custom, C.scaleBattleConfigForCustomWorkout(emom, custom, monster.battle));
    // The session ends — once — exactly at the configured round.
    for (let round = 1; round < rounds; round += 1) assert.equal(getRoundCompletionOutcome(custom, round), 'next-window');
    assert.equal(getRoundCompletionOutcome(custom, rounds), 'workout-complete');
  }
  assert.equal(getWindowExpiryOutcome(emom), 'objectives-unfinished', 'a missed window is not a victory');
});

test('Behemoth: all three phases count; defeated with 0 HP only after Phase III (canonical and per-phase custom reps)', () => {
  const monster = contentEngine.getMonster('behemoth')!;
  const iron = workout('iron-ascent');
  const { hpAfterRound } = fight(iron, monster.battle, 3);
  assert.ok(hpAfterRound[0] > 0 && hpAfterRound[1] > 0 && hpAfterRound[2] === 0);
  assertSynced('behemoth canonical', iron, monster.battle);
  const custom = C.buildCustomWorkout(iron, 0, { 'behemoth-p1-snatch-a': 10, 'behemoth-p3-press': 12 });
  assertSynced('behemoth custom', custom, C.scaleBattleConfigForCustomWorkout(iron, custom, monster.battle));
  assert.equal(getRoundCompletionOutcome(iron, 2), 'rest');
  assert.equal(getRoundCompletionOutcome(iron, 3), 'workout-complete');
});

test('the open-ended EMOM (The Breaking) keeps its rounds-as-metric rules and raw damage', () => {
  const warEngine = workout('war-engine');
  const ares = contentEngine.getMonster('ares')!;
  assert.equal(isOpenEndedWorkout(warEngine), true);
  assert.equal(getBattlePlan(warEngine, ares.battle), null);
  assert.equal(getRoundCompletionOutcome(warEngine, warEngine.rounds), 'next-window', 'no round cap');
  assert.equal(getWindowExpiryOutcome(warEngine), 'attempt-complete');
  const { hpAfterRound } = fight(warEngine, ares.battle, 1);
  assert.equal(ares.battle.hp - hpAfterRound[0], rawRoundDamage(warEngine, ares.battle, 1, 1), 'unscaled');
});

// ------------------------------------------------------------- 9/12/14. Content

test('Hydra uses Double Jerk (not Double Press/Push Press); other workouts keep their press', () => {
  const hydra = workout('everlasting-cycle');
  const ids = hydra.exercises.map((e: any) => e.libraryExerciseId);
  assert.ok(ids.includes('double-jerk'));
  assert.ok(!ids.includes('double-push-press') && !ids.includes('double-press'));
  assert.equal(hydra.exercises.find((e: any) => e.libraryExerciseId === 'double-jerk').name, 'Double Jerk');
  const pressElsewhere = contentEngine
    .getAllWorkouts()
    .filter((w: any) => w.id !== 'everlasting-cycle')
    .some((w: any) =>
      [...w.exercises, ...(w.sections?.flatMap((s: any) => s.exercises) ?? [])].some(
        (e: any) => e.libraryExerciseId === 'double-push-press' || e.name === 'Double Push Press'
      )
    );
  assert.ok(pressElsewhere, 'Double Push Press is not replaced globally');
  assert.equal(entry(R.getResultExerciseBreakdown(hydraResult({}), getWorkout, byId), 'double-jerk').name, 'Double Jerk');
});

test('history keeps the movement that was performed: pre-change Hydra/Basilisk results stay Push Press/Burpee', () => {
  const oldHydra = hydraResult({ completedAt: BEFORE });
  const newHydra = hydraResult({ completedAt: AFTER });
  const stats = getAllExerciseStats([oldHydra, newHydra], getWorkout, byName, byId);
  assert.equal(stat(stats, 'double-push-press').totalReps, 25, 'the old hunt');
  assert.equal(stat(stats, 'double-jerk').totalReps, 25, 'the new hunt');

  const basilisk = (completedAt: string) =>
    result({ workoutId: 'basilisk-confrontation', monsterId: 'basilisk', huntId: 'basilisk-first-encounter', completedAt });
  const oldB = R.getResultExerciseBreakdown(basilisk(BEFORE), getWorkout, byId);
  const newB = R.getResultExerciseBreakdown(basilisk(AFTER), getWorkout, byId);
  assert.equal(entry(oldB, 'burpee').totalReps, 20);
  assert.equal(entry(oldB, 'burpee').volumeKg, 0, 'the bodyweight burpee it was');
  assert.equal(entry(newB, 'burpee-kettlebell').totalReps, 20);
  assert.equal(entry(newB, 'burpee-kettlebell').volumeKg, 20 * 32, 'a double-kettlebell burpee, both bells');
  assert.equal(entry(newB, 'burpee-kettlebell').name, 'Double KB Burpee');
});

test('"Double KB Burpee" is the one name everywhere (library, Mammoth, Basilisk); the old name is gone', () => {
  assert.equal(byId('burpee-kettlebell').name, 'Double KB Burpee');
  const mammothBurpee = workout('mammoth-emom').exercises.find((e: any) => e.libraryExerciseId === 'burpee-kettlebell');
  assert.equal(mammothBurpee.name, 'Double KB Burpee');
  assert.equal(mammothBurpee.displayName, 'Double KB Burpee');
  assert.equal(workout('basilisk-confrontation').exercises.find((e: any) => e.id === 'basilisk-burpee').name, 'Double KB Burpee');
  const all = JSON.stringify(contentEngine.getAllWorkouts());
  assert.ok(!all.includes('Burpee — Double KB'));
});

test('Mammoth and Basilisk portraits: the painted frame is centred and sized like Minotaur\'s and Hydra\'s', () => {
  for (const key of ['mammoth', 'basilisk']) {
    const framing = PORTRAIT_FRAMING[key];
    const layout = getPortraitFramingLayout(framing);
    // Where the frame centre lands, as % of the portrait circle.
    assert.ok(Math.abs(layout.left + framing.centerX * layout.size - 50) < 0.01, `${key} x centred`);
    assert.ok(Math.abs(layout.top + framing.centerY * layout.size - 50) < 0.01, `${key} y centred`);
    assert.ok(Math.abs((framing.diameter * layout.size) / 100 - REFERENCE_FRAME_DIAMETER) < 1e-9, `${key} frame size`);
    assert.ok(layout.size >= 100, `${key}: scaled up, never leaving an uncovered edge`);
  }
  assert.equal(PORTRAIT_FRAMING.minotaur, undefined, 'reference portraits are untouched');
  assert.equal(PORTRAIT_FRAMING.hydra, undefined);
});

// ------------------------------------------------------------- 17/18. History and standard hunts

test('standard (canonical) hunts: the per-result breakdown is exactly the workout breakdown as before', () => {
  for (const [id, monsterId] of [['everlasting-cycle', 'hydra'], ['abyss-carry', 'leviathan'], ['iron-ascent', 'behemoth'], ['labyrinth-ladder', 'minotaur']]) {
    const w = workout(id);
    const r = result({ workoutId: id, monsterId, weightValueA: 16, weightValueB: 16 });
    assert.deepEqual(
      R.getResultExerciseBreakdown(r, getWorkout, byId),
      getExerciseBreakdown(w, w.rounds, 16, 2, 16, byId),
      id
    );
  }
});

test('legacy rows: a Custom Hunt saved before configuration snapshots reads as canonical; rows are never mutated', () => {
  const legacy = hydraResult({ isCustomHunt: true, restSecondsUsed: null, structuralValueUsed: null, repsOverridesUsed: null, completedAt: BEFORE });
  const frozen = JSON.parse(JSON.stringify(legacy));
  assert.equal(R.getPerformedWorkout(legacy, workout('everlasting-cycle')).rounds, 5);
  getAllExerciseStats([legacy], getWorkout, byName, byId);
  getWeeklySummary([legacy], new Date(BEFORE));
  assert.deepEqual(legacy, frozen);
  // A result whose workout no longer exists contributes nothing rather than a fabricated figure.
  assert.equal(R.getResultExerciseBreakdown(result({ workoutId: 'removed-workout' }), getWorkout, byId), null);
  assert.equal(getWeeklySummary([result({ workoutId: 'removed-workout' })], new Date(AFTER)).totalVolumeKg, 0);
});

test('historical ranks use the target the hunt was actually ranked against (Custom Hunt scales it)', () => {
  // 7:00 on a 9-rung custom ladder: its target is 780 s × 9/19 = 369 s, so 420 s is a B
  // (within 115 %). Against the canonical 13:00 target it would have read as an S.
  const slow = minotaurCustom5({ timeMinutes: 7, timeSeconds: 0 });
  const [ranked] = computeHistoricalRanks([slow], getWorkout);
  assert.equal(R.getPerformedWorkout(slow, workout('labyrinth-ladder')).targetTimeSeconds, 369);
  assert.equal(ranked.rank, 'B');
});
