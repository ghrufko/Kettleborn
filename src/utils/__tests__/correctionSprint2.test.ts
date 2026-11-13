import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * Correction Sprint 2 — Chain/Complex Custom Hunt model, equipment rules,
 * The Sovereign's content, Exercise Records parts and portrait framing.
 * Real content through the Content Engine; pure functions only.
 */
const { contentEngine } = await import(new URL('../../../engines/content/index.ts', import.meta.url).href);
const M = await import(new URL('../customHuntModel.ts', import.meta.url).href);
const C = await import(new URL('../customWorkoutStructure.ts', import.meta.url).href);
const R = await import(new URL('../resultWorkout.ts', import.meta.url).href);
const E = await import(new URL('../equipmentRules.ts', import.meta.url).href);
const { getAllExerciseStats } = await import(new URL('../exerciseStats.ts', import.meta.url).href);
const { getExerciseRecordParts } = await import(new URL('../exerciseRecordFormat.ts', import.meta.url).href);
const { getWorkoutRoundExercises } = await import(new URL('../workoutPresentation.ts', import.meta.url).href);
const { makeReducer, createInitialState } = await import(new URL('../../../engines/battle/useBattleEngine.ts', import.meta.url).href);
const { PORTRAIT_FRAMING, getPortraitFramingLayout } = await import(new URL('../../constants/portraitFraming.ts', import.meta.url).href);

contentEngine.load();
const workout = (id: string) => contentEngine.getWorkout(id)!;
const getWorkout = (id: string) => contentEngine.getWorkout(id);
const byId = (id: string) => contentEngine.getExerciseLibraryEntry(id);
const byName = (name: string) => contentEngine.getExerciseLibraryEntryByName(name);
const V = { [M.CONFIG_VERSION_KEY]: M.CONFIG_VERSION };
const AFTER = '2026-11-13T09:00:00.000Z';
const BEFORE = '2026-11-10T09:00:00.000Z';

let seq = 0;
function result(overrides: Record<string, unknown>): any {
  seq += 1;
  return {
    id: `s2-${seq}`, uuid: `00000000-0000-4000-9000-${String(seq).padStart(12, '0')}`, userId: 'local-hunter',
    workoutId: 'atlas-chain', monsterId: 'atlas', huntId: 'atlas-first-encounter', completedAt: AFTER,
    timeMinutes: 20, timeSeconds: 0, weightValueA: 16, weightValueB: 16, weightUnit: 'kg', notes: null,
    xpAwarded: 100, difficulty: 3, appVersion: '0.1.0', rungLaps: null, rpe: null, isCustomHunt: false,
    restSecondsUsed: null, structuralValueUsed: null, repsOverridesUsed: null, extraSets: null, volumeKg: null,
    ...overrides,
  };
}
const totalOf = (breakdown: any[], name: string) => breakdown.filter((e) => e.name === name).reduce((s, e) => s + e.totalReps, 0);
/** Every step a workout's session runs, round by round. */
function performed(w: any): any[] {
  const out: any[] = [];
  for (let round = 1; round <= w.rounds; round += 1) out.push(...getWorkoutRoundExercises(w, round));
  return out;
}

function step(id: string, name: string, displayName: string, reps: number, extra: Record<string, unknown> = {}) {
  return { id, name, displayName, targetReps: reps, damageCoefficient: 10, damageType: 'flat', ...extra };
}
function synthetic(overrides: Record<string, unknown>): any {
  return {
    id: 'synthetic', name: 'Synthetic', difficulty: 3, estimatedMinutesRange: [10, 15], gearWeightKg: 16, gearCount: 2,
    rounds: 1, restSeconds: 60, roundBonusDamage: 20, targetTimeSeconds: 600, focus: [], exercises: [],
    finisher: { name: 'F', scheme: 'S' }, ...overrides,
  };
}

// ------------------------------------------------------------------ 1B. The Sovereign content

test('The Sovereign: Double Press is now Double Jerk in every Chain pass and the Complex; Double Push Press is untouched', () => {
  const atlas = workout('atlas-chain');
  assert.equal(atlas.exercises.filter((e: any) => e.name === 'Double Press').length, 0);
  assert.equal(atlas.exercises.filter((e: any) => e.name === 'Double Jerk').length, 6);
  assert.equal(atlas.exercises.filter((e: any) => e.name === 'Double Push Press').length, 6, 'unrelated press kept');
  assert.ok(atlas.exercises.filter((e: any) => e.name === 'Double Jerk').every((e: any) => /^Double Jerk \((Chain \d\/5|Complex ×5)\)$/.test(e.displayName)));
  // Other workouts' Double Press is not renamed.
  assert.ok(workout('ember-trial').exercises.some((e: any) => e.name === 'Double Press'));
  // Records for a new Sovereign hunt credit Double Jerk.
  const stats = getAllExerciseStats([result({})], getWorkout, byName, byId);
  assert.ok(stats.some((s: any) => s.exerciseName === 'Double Jerk'));
  assert.ok(!stats.some((s: any) => s.exerciseName === 'Double Press'));
});

test('The Sovereign: Chain 5 cycles, then Complex 5 cycles — in that order, in the model, the engine and the statistics', () => {
  const atlas = workout('atlas-chain');
  const model = M.getCustomHuntModel(atlas);
  assert.equal(model.kind, 'phased');
  assert.deepEqual(model.phases.map((p: any) => [p.kind, p.canonicalCycles]), [['chain', 5], ['complex', 5]]);
  assert.deepEqual(model.phases[0].movements.map((m: any) => m.name), ['Double Front Squat', 'Double Jerk', 'Double Clean', 'Double Push Press', 'Double Row']);
  // Session: 5 Chain passes, then the Complex round (5 cycles of each movement ×3).
  const rounds = Array.from({ length: atlas.rounds }, (_, i) => getWorkoutRoundExercises(atlas, i + 1));
  assert.equal(rounds.length, 6);
  rounds.slice(0, 5).forEach((r: any[], i: number) => assert.ok(r.every((e) => e.displayName.endsWith(`(Chain ${i + 1}/5)`))));
  assert.ok(rounds[5].every((e: any) => e.cycles === 5));
  // Statistics: 5 × 3 (chain) + 5 × 3 (complex) = 30 per movement.
  assert.equal(totalOf(R.getResultExerciseBreakdown(result({}), getWorkout, byId), 'Double Jerk'), 30);
});

test('history: a Sovereign hunt recorded before the change keeps Double Press and the single Complex it was counted as', () => {
  const old = R.getResultExerciseBreakdown(result({ completedAt: BEFORE }), getWorkout, byId);
  assert.equal(totalOf(old, 'Double Press'), 18, '5 × 3 + 1 × 3');
  assert.equal(totalOf(old, 'Double Jerk'), 0);
});

// ------------------------------------------------------------------ 2. Phase model

test('chain only: one Chain phase with its cycles and per-movement reps', () => {
  const w = synthetic({
    rounds: 3,
    sections: [1, 2, 3].map((p) => ({
      label: `Chain ${p}`,
      exercises: [step(`a${p}`, 'Swing', `Swing (Chain ${p}/3)`, 2), step(`b${p}`, 'Clean', `Clean (Chain ${p}/3)`, 2)],
    })),
  });
  w.exercises = w.sections[0].exercises;
  const model = M.getCustomHuntModel(w);
  assert.equal(model.kind, 'phased');
  assert.deepEqual(model.phases.map((p: any) => [p.kind, p.canonicalCycles, p.movements.length]), [['chain', 3, 2]]);
  const built = M.buildWorkoutFromModel(w, null, { ...V, 'phase.0.cycles': 4, 'phase.0.reps.1': 5 });
  assert.equal(built.rounds, 4, 'one pass per round, as authored');
  assert.deepEqual(performed(built).map((e: any) => [e.name, e.targetReps]), Array.from({ length: 4 }, () => [['Swing', 2], ['Clean', 5]]).flat());
});

test('complex only: one Complex phase; its cycles multiply the work, not the rows', () => {
  const w = synthetic({
    exercises: [step('a', 'Swing', 'Swing (Complex ×3)', 3), step('b', 'Clean', 'Clean (Complex ×3)', 3)],
  });
  const model = M.getCustomHuntModel(w);
  assert.deepEqual(model.phases.map((p: any) => [p.kind, p.canonicalCycles]), [['complex', 1]]);
  const built = M.buildWorkoutFromModel(w, null, { ...V, 'phase.0.cycles': 4, 'phase.0.reps.0': 6 });
  const steps = performed(built);
  assert.equal(steps.length, 2, 'each movement once');
  assert.deepEqual(steps.map((e: any) => [e.name, e.targetReps, e.cycles]), [['Swing', 6, 4], ['Clean', 3, 4]]);
});

test('Chain → Complex (The Sovereign): independent Chain and Complex cycles, independent movement reps', () => {
  const atlas = workout('atlas-chain');
  const config = { ...V, 'phase.0.cycles': 3, 'phase.0.reps.1': 2, 'phase.1.cycles': 2, 'phase.1.reps.1': 4 };
  const built = C.buildCustomWorkout(atlas, 0, config);
  assert.equal(built.rounds, 4, '3 Chain passes + the Complex round');
  const rounds = Array.from({ length: built.rounds }, (_, i) => getWorkoutRoundExercises(built, i + 1));
  assert.ok(rounds.slice(0, 3).every((r: any[]) => r.length === 5 && r[1].name === 'Double Jerk' && r[1].targetReps === 2 && r[0].targetReps === 3));
  assert.ok(rounds[3].every((e: any) => e.cycles === 2));
  assert.equal(rounds[3][1].targetReps, 4);
  assert.equal(rounds[3][0].targetReps, 3, 'only the configured movement changed');
  // Chain: 3 × 2 = 6 jerks; Complex: 2 cycles × 4 = 8.
  const breakdown = R.getResultExerciseBreakdown(
    result({ isCustomHunt: true, restSecondsUsed: 150, repsOverridesUsed: config }),
    getWorkout,
    byId
  );
  assert.equal(totalOf(breakdown, 'Double Jerk'), 14);
  assert.equal(totalOf(breakdown, 'Double Front Squat'), 3 * 3 + 2 * 3);
});

test('Chain → Complex → Chain (The Rite): opening and closing Chains are configured independently; outer rounds stay separate', () => {
  const rite = workout('the-rite');
  const model = M.getCustomHuntModel(rite);
  assert.equal(model.layout, 'inline');
  assert.deepEqual(model.phases.map((p: any) => p.title), ['Opening Chain', 'Complex', 'Closing Chain']);
  assert.equal(model.outer.canonical, 5);
  const config = { ...V, 'phase.0.cycles': 2, 'phase.2.cycles': 4, 'phase.2.reps.0': 2, 'phase.1.cycles': 2 };
  const built = C.buildCustomWorkout(rite, 3, config);
  assert.equal(built.sections.length, 3, 'outer rounds: 3');
  const r1 = built.sections[0].exercises;
  // Opening 2 passes × 4 + Complex 4 + Closing 4 passes × 4 = 28 steps, in order.
  assert.equal(r1.length, 2 * 4 + 4 + 4 * 4);
  assert.ok(r1.slice(0, 8).every((e: any) => /\(Chain [12]\/2\)$/.test(e.displayName)));
  assert.ok(r1.slice(8, 12).every((e: any) => e.cycles === 2 && /Complex/.test(e.displayName)));
  assert.ok(r1.slice(12).every((e: any) => /\(Chain [1-4]\/4\)$/.test(e.displayName)));
  assert.equal(r1[12].targetReps, 2, 'closing chain jerk');
  assert.equal(r1[0].targetReps, 1, 'opening chain jerk unchanged');
  assert.match(built.sections[0].label, /Chain ×2 → Complex ×2 → Chain ×4/);
  // The rebuilt workout re-derives as the same three phases.
  const rebuilt = M.getCustomHuntModel(built);
  assert.deepEqual(rebuilt.phases.map((p: any) => p.canonicalCycles), [2, 2, 4]);
});

test('canonical configs build the same work as the authored workout (no drift)', () => {
  for (const id of ['atlas-chain', 'the-rite', 'iron-descent']) {
    const w = workout(id);
    const built = M.buildWorkoutFromModel(w, null, { ...V });
    const work = (x: any) => performed(x).reduce((s: number, e: any) => s + (e.targetReps ?? 0) * (e.cycles ?? 1), 0);
    assert.equal(work(built), work(w), id);
    assert.equal(built.targetTimeSeconds, w.targetTimeSeconds, `${id} target time`);
    assert.equal(M.isCanonicalConfig(w, M.getCustomHuntModel(w).outer?.canonical ?? null, { ...V }), true);
  }
});

test('boss HP still reaches exactly 0 on the final objective of a custom phased hunt', () => {
  const monster = contentEngine.getMonster('atlas')!;
  const atlas = workout('atlas-chain');
  for (const config of [{ ...V }, { ...V, 'phase.0.cycles': 2, 'phase.1.cycles': 7 }, { ...V, 'phase.0.reps.0': 9 }]) {
    const built = C.buildCustomWorkout(atlas, 0, config);
    const battle = C.scaleBattleConfigForCustomWorkout(atlas, built, monster.battle);
    const reduce = makeReducer(battle, built);
    let state = createInitialState(battle);
    for (let round = 1; round <= built.rounds; round += 1) {
      const exercises = getWorkoutRoundExercises(built, round).map((exercise: any) => ({ exercise, repsCompleted: exercise.targetReps ?? 1, skipped: false }));
      state = reduce(state, { type: 'ROUND_COMPLETED', round, durationSeconds: 60, exercises });
      assert.equal(state.currentHP === 0, round === built.rounds, `round ${round}/${built.rounds}`);
    }
  }
});

// ------------------------------------------------------------------ 2E/2F/5. Template model

test('The Unbroken: one round shown once, left/right paired per movement, alternating order and transitions preserved', () => {
  const fluid = workout('living-current');
  const model = M.getCustomHuntModel(fluid);
  assert.equal(model.kind, 'template');
  assert.equal(model.outer.canonical, 5);
  assert.equal(model.rows.length, 6, '12 sided steps in 6 rows, not 60');
  assert.deepEqual(model.rows.map((r: any) => r.name), ['Swing', 'Clean', 'Reverse Lunge', 'Jerk', 'Thruster', 'Tactical Snatch']);
  assert.deepEqual(model.rows[5].steps.map((s: any) => s.sideLabel), ['Left → Right', 'Right → Left']);
  // Left and right are independent; the sequence and the round count are separate.
  const right = model.rows[1].steps.find((s: any) => s.side === 'right');
  const built = M.buildWorkoutFromModel(fluid, 3, { ...V, [right.key]: 3 });
  assert.equal(built.sections.length, 3);
  const r1 = built.sections[0].exercises;
  assert.deepEqual(r1.map((e: any) => e.displayName), fluid.sections[0].exercises.map((e: any) => e.displayName), 'same alternating sequence');
  assert.equal(r1.find((e: any) => e.displayName === 'RIGHT · Clean').targetReps, 3);
  assert.equal(r1.find((e: any) => e.displayName === 'LEFT · Clean').targetReps, 1);
  assert.ok(built.sections.every((s: any) => s.exercises.length === 12));
});

test('The Judge is a regular sequential complex: not a Chain, per-exercise reps, no cycle controls', () => {
  const judge = workout('judge-verdict');
  assert.equal(judge.sequenceType, undefined);
  const model = M.getCustomHuntModel(judge);
  assert.equal(model.kind, 'template');
  assert.equal(model.shape, 'flat');
  assert.equal(model.rows.length, 6);
  assert.ok(model.rows.every((r: any) => r.steps.length === 1 && r.steps[0].side === null));
  const built = M.buildWorkoutFromModel(judge, null, { ...V, 'step.4': 8 });
  assert.deepEqual(built.exercises.map((e: any) => e.id), judge.exercises.map((e: any) => e.id), 'order unchanged');
  assert.equal(built.exercises[4].targetReps, 8);
  assert.equal(built.rounds, 5);
});

test('The Fallen: rounds and every movement\'s reps per side; stays one-kettlebell and unilateral', () => {
  const agony = workout('unbroken-cycle');
  const model = M.getCustomHuntModel(agony);
  assert.equal(model.outer.canonical, 5);
  assert.deepEqual(model.rows.map((r: any) => [r.name, r.steps.map((s: any) => s.sideLabel)]), [
    ['Single Dead Snatch', ['Left', 'Right']],
    ['Single Dead Clean', ['Left', 'Right']],
    ['Single Thruster', ['Left', 'Right']],
  ]);
  const left = model.rows[2].steps[0];
  const built = M.buildWorkoutFromModel(agony, 4, { ...V, [left.key]: 5 });
  assert.equal(built.sections.length, 8, '4 rounds × (Left, Right)');
  assert.deepEqual(built.sections.slice(0, 2).map((s: any) => s.label), ['Round 1 — Left Hand', 'Round 1 — Right Hand']);
  assert.equal(built.sections[0].exercises[2].targetReps, 5);
  assert.equal(built.sections[1].exercises[2].targetReps, 3, 'the right hand keeps its own reps');
  assert.equal(built.gearCount, 1);
  assert.deepEqual(E.getEquipmentRule(agony), { kind: 'fixed', gearCount: 1 });
});

// ------------------------------------------------------------------ backward compatibility

test('Custom Hunt configs saved before the model (no marker) still build exactly as before', () => {
  const hydra = workout('everlasting-cycle');
  // A Sprint-1 Hydra config: 3 rounds + snatch reps keyed by step id.
  const legacy = C.buildCustomWorkout(hydra, 3, { 'hydra-snatch': 8 });
  assert.equal(legacy.rounds, 3);
  assert.equal(legacy.exercises.find((e: any) => e.id === 'hydra-snatch').targetReps, 8);
  // A pre-Sprint-2 Sovereign result (flat-rounds semantics) reads as it always did.
  const old = result({ isCustomHunt: true, restSecondsUsed: 150, structuralValueUsed: 6, completedAt: BEFORE });
  assert.equal(totalOf(R.getResultExerciseBreakdown(old, getWorkout, byId), 'Double Press'), 18);
  // Model-config detection is explicit.
  assert.equal(M.isModelConfig({ 'hydra-snatch': 8 }), false);
  assert.equal(M.isModelConfig({ ...V }), true);
});

// ------------------------------------------------------------------ 6/7. Equipment rules

test('equipment: fixed one-bell, fixed two-bell and flexible monsters match the central rule', () => {
  const rule = (monsterId: string) => E.getMonsterEquipmentRule(contentEngine.getMonster(monsterId)!, getWorkout);
  for (const id of ['agony', 'fluid', 'moloch', 'crooked', 'aether']) assert.deepEqual(rule(id), { kind: 'fixed', gearCount: 1 }, id);
  for (const id of ['minotaur', 'leviathan', 'hydra', 'mammoth', 'arachne', 'basilisk', 'atlas', 'judge', 'ifrit', 'ambidexter', 'rite', 'ares', 'descent', 'ravager']) {
    assert.deepEqual(rule(id), { kind: 'fixed', gearCount: 2 }, id);
  }
  for (const id of ['behemoth', 'chimera']) assert.equal(rule(id)!.kind, 'flexible', id);
  // A fixed workout ignores any requested count; a flexible one honours it.
  assert.equal(E.resolveGearCount(workout('everlasting-cycle'), 1), 2);
  assert.equal(E.resolveGearCount(workout('living-current'), 2), 1);
  assert.equal(E.resolveGearCount(workout('iron-ascent'), 1), 1);
  assert.equal(E.resolveGearCount(workout('endless-grind'), undefined), 2);
});

test('flexible equipment: one bell swaps the double-bell steps to their one-bell movements (Behemoth, The Duelist)', () => {
  const iron = E.applyGearVariants(workout('iron-ascent'), 1);
  const phase3 = iron.sections[2].exercises;
  assert.deepEqual(phase3.map((e: any) => e.libraryExerciseId), ['snatch', 'front-squat', 'press', 'clean', 'swing']);
  assert.ok(phase3.every((e: any) => e.usesGearCount === 1));
  assert.equal(iron.sections[2].label, 'Phase III — One Kettlebell', 'the phase label follows the equipment');
  assert.equal(E.applyGearVariants(workout('iron-ascent'), 2).sections[2].label, 'Phase III — Two Kettlebells · 2 × 20 kg');
  assert.deepEqual(iron.sections[0].exercises, workout('iron-ascent').sections[0].exercises, 'single-bell phases untouched');
  const grind = E.applyGearVariants(workout('endless-grind'), 1);
  assert.deepEqual(grind.exercises.slice(0, 3).map((e: any) => e.libraryExerciseId), ['snatch', 'thruster', 'swing']);
  assert.equal(E.applyGearVariants(workout('endless-grind'), 2), workout('endless-grind'), 'two bells: as authored');
  assert.equal(E.applyGearVariants(workout('everlasting-cycle'), 1), workout('everlasting-cycle'), 'fixed workouts never swap');
  // Statistics for a one-bell Behemoth hunt: Phase III counts one bell, as a single press.
  const r = result({ workoutId: 'iron-ascent', monsterId: 'behemoth', huntId: 'behemoth-first-encounter', weightValueA: 20, weightValueB: null });
  const breakdown = R.getResultExerciseBreakdown(r, getWorkout, byId);
  assert.equal(breakdown.find((e: any) => e.exerciseId === 'double-press'), undefined);
  assert.equal(breakdown.find((e: any) => e.exerciseId === 'press').totalReps, 12 + 6 + 6);
  assert.equal(breakdown.find((e: any) => e.exerciseId === 'press').volumeKg, 24 * 20);
  // …but a one-bell Behemoth hunt from before the variants existed reads as it did.
  const old = R.getResultExerciseBreakdown({ ...r, completedAt: BEFORE }, getWorkout, byId);
  assert.ok(old.some((e: any) => e.exerciseId === 'double-press'));
});

// ------------------------------------------------------------------ 4. Exercise Records

test('Exercise Records parts: reps and load separate, no "done", no kg for bodyweight or carries', () => {
  const kg = (v: number) => Math.round(v);
  assert.deepEqual(getExerciseRecordParts({ totalReps: 24, totalVolumeKg: 1152, totalDistanceFt: 0, totalSteps: 0 }, kg), {
    amount: 24, amountUnit: 'reps', load: 1152, isBodyweight: false,
  });
  assert.deepEqual(getExerciseRecordParts({ totalReps: 30, totalVolumeKg: 0, totalDistanceFt: 0, totalSteps: 0 }, kg), {
    amount: 30, amountUnit: 'reps', load: null, isBodyweight: true,
  });
  assert.deepEqual(getExerciseRecordParts({ totalReps: 0, totalVolumeKg: 0, totalDistanceFt: 0, totalSteps: 250 }, kg), {
    amount: 250, amountUnit: 'steps', load: null, isBodyweight: false,
  });
});

// ------------------------------------------------------------------ 1A/3/5A/10. Portraits

test('portraits: Sovereign, Duelist, Fallen, Unbroken and Colossus are framed by the shared system, centred', () => {
  for (const key of ['sovereign', 'dualist', 'fallen', 'unbroken', 'colossus', 'mammoth', 'basilisk']) {
    const framing = PORTRAIT_FRAMING[key];
    assert.ok(framing, key);
    const layout = getPortraitFramingLayout(framing);
    assert.ok(Math.abs(layout.left + framing.centerX * layout.size - 50) < 0.01, `${key} x`);
    assert.ok(Math.abs(layout.top + framing.centerY * layout.size - 50) < 0.01, `${key} y`);
    assert.ok(layout.size >= 100, key);
  }
});

// ------------------------------------------------------------------ locked panel description

test('a locked model config is described per phase/step for the locked panel', () => {
  const rows = M.describeConfig(workout('the-rite'), { ...V, 'phase.2.cycles': 4, 'phase.2.reps.0': 2 });
  assert.deepEqual(rows.map((r: any) => [r.label, r.value]), [['Closing Chain cycles', '4'], ['Closing Chain · Double Jerk', '2 reps']]);
  const fluid = M.getCustomHuntModel(workout('living-current'));
  const key = fluid.rows[0].steps[1].key;
  assert.deepEqual(M.describeConfig(workout('living-current'), { ...V, [key]: 2 }).map((r: any) => r.label), ['Swing (Right)']);
});
