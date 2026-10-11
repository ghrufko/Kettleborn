import test from 'node:test';
import assert from 'node:assert/strict';
import { getAllExtraExerciseStats, findExtraExerciseStats } from '../extraExerciseStats';
import type { WorkoutResult, ExtraExerciseSet } from '../../models';

function result(overrides: Partial<WorkoutResult>): WorkoutResult {
  return {
    id: 'result-test',
    userId: 'local-hunter',
    workoutId: 'test-workout',
    monsterId: 'test-monster',
    huntId: 'test-hunt',
    completedAt: '2026-01-01T00:00:00.000Z',
    timeMinutes: 10,
    timeSeconds: 0,
    weightValueA: 16,
    weightValueB: null,
    weightUnit: 'kg',
    notes: null,
    xpAwarded: 100,
    difficulty: 3,
    appVersion: '1.0.0',
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

function set(overrides: Partial<ExtraExerciseSet>): ExtraExerciseSet {
  return { id: 'extra-test', exerciseId: 'double-kb-pushup', reps: 10, ...overrides };
}

test('getAllExtraExerciseStats: empty results produce an empty list', () => {
  assert.deepEqual(getAllExtraExerciseStats([]), []);
});

test('getAllExtraExerciseStats: a result with no extraSets contributes nothing', () => {
  assert.deepEqual(getAllExtraExerciseStats([result({ extraSets: null })]), []);
});

test('getAllExtraExerciseStats: sums reps and counts sets across multiple results for the same exercise', () => {
  const results = [
    result({ id: 'a', completedAt: '2026-01-01T00:00:00.000Z', extraSets: [set({ reps: 10 })] }),
    result({ id: 'b', completedAt: '2026-01-02T00:00:00.000Z', extraSets: [set({ reps: 15 })] }),
  ];
  const stats = getAllExtraExerciseStats(results);
  assert.equal(stats.length, 1);
  assert.equal(stats[0].exerciseId, 'double-kb-pushup');
  assert.equal(stats[0].totalReps, 25);
  assert.equal(stats[0].totalSets, 2);
});

test('getAllExtraExerciseStats: multiple sets of different exercises within ONE result are tracked independently', () => {
  const results = [
    result({
      extraSets: [
        set({ id: 'a', exerciseId: 'double-kb-pushup', reps: 10 }),
        set({ id: 'b', exerciseId: 'vertical-pullup', reps: 5 }),
        set({ id: 'c', exerciseId: 'double-kb-pushup', reps: 8 }), // a second set of the same exercise, same Hunt
      ],
    }),
  ];
  const stats = getAllExtraExerciseStats(results);
  const pushups = findExtraExerciseStats(stats, 'double-kb-pushup');
  const pullups = findExtraExerciseStats(stats, 'vertical-pullup');
  assert.equal(pushups?.totalReps, 18);
  assert.equal(pushups?.totalSets, 2);
  assert.equal(pullups?.totalReps, 5);
  assert.equal(pullups?.totalSets, 1);
});

test('getAllExtraExerciseStats: lastPerformedAt reflects the most recent result, not insertion order', () => {
  const results = [
    result({ id: 'newer', completedAt: '2026-03-01T00:00:00.000Z', extraSets: [set({})] }),
    result({ id: 'older', completedAt: '2026-01-01T00:00:00.000Z', extraSets: [set({})] }),
  ];
  const stats = getAllExtraExerciseStats(results);
  assert.equal(stats[0].lastPerformedAt, '2026-03-01T00:00:00.000Z');
});

test('getAllExtraExerciseStats: never fabricates a volume/weight figure — the stats shape has no such field', () => {
  const stats = getAllExtraExerciseStats([result({ extraSets: [set({})] })]);
  assert.ok(!('totalVolumeKg' in stats[0]));
});

test('findExtraExerciseStats: returns null for an exercise never logged', () => {
  const stats = getAllExtraExerciseStats([result({ extraSets: [set({ exerciseId: 'double-kb-pushup' })] })]);
  assert.equal(findExtraExerciseStats(stats, 'single-kb-pushup'), null);
});
