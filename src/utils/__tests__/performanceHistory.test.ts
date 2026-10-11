import test from 'node:test';
import assert from 'node:assert/strict';
import { getDurationTrendSeries, getRoundsTrendSeries, getMonsterHistoryEntries } from '../performanceHistory';
import type { WorkoutResult, Workout, RungLap } from '../../models';

function result(overrides: Partial<WorkoutResult>): WorkoutResult {
  return {
    id: 'result-test',
    userId: 'local-hunter',
    workoutId: 'labyrinth-ladder',
    monsterId: 'minotaur',
    huntId: 'minotaur-first-encounter',
    completedAt: '2026-01-01T00:00:00.000Z',
    timeMinutes: 10,
    timeSeconds: 0,
    weightValueA: 16,
    weightValueB: null,
    weightUnit: 'kg',
    notes: null,
    xpAwarded: 100,
    difficulty: 4,
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

function workout(overrides: Partial<Workout>): Workout {
  return {
    id: 'labyrinth-ladder',
    name: 'The Labyrinth Ladder',
    difficulty: 4,
    estimatedMinutesRange: [12, 18],
    gearWeightKg: 16,
    gearCount: 2,
    rounds: 19,
    restSeconds: 3,
    roundBonusDamage: 60,
    targetTimeSeconds: 780,
    focus: [],
    exercises: [],
    finisher: { name: 'The Ladder', scheme: '1-10-1' },
    ...overrides,
  } as Workout;
}

// mammoth-emom is a real EMOM workout in current content (rounds: 5,
// emomSeconds: 180) — mirrored here rather than inventing arbitrary values.
function emomWorkout(overrides: Partial<Workout>): Workout {
  return workout({ id: 'mammoth-emom', name: "The Breaking", emomSeconds: 180, rounds: 5, ...overrides });
}

function laps(count: number): RungLap[] {
  return Array.from({ length: count }, (_, i) => ({ round: i + 1, durationSeconds: 30 }));
}

// --- getDurationTrendSeries ---

test('duration trend: empty results produce an empty series', () => {
  assert.deepEqual(getDurationTrendSeries([], workout({})), []);
});

test('duration trend: an undefined workout produces an empty series rather than throwing', () => {
  assert.deepEqual(getDurationTrendSeries([result({})], undefined), []);
});

test('duration trend: an EMOM workout (emomSeconds set) produces an empty series — elapsed time there is a fixed window, not a performance signal', () => {
  const w = workout({ emomSeconds: 600 });
  assert.deepEqual(getDurationTrendSeries([result({}), result({ id: 'b' })], w), []);
});

test('duration trend: sorts chronologically ascending regardless of input order', () => {
  const results = [
    result({ id: 'newest', completedAt: '2026-01-03T00:00:00.000Z', timeMinutes: 9 }),
    result({ id: 'oldest', completedAt: '2026-01-01T00:00:00.000Z', timeMinutes: 11 }),
    result({ id: 'middle', completedAt: '2026-01-02T00:00:00.000Z', timeMinutes: 10 }),
  ];
  const series = getDurationTrendSeries(results, workout({}));
  assert.deepEqual(series.map((p) => p.resultId), ['oldest', 'middle', 'newest']);
});

test('duration trend: excludes a structurally-customized Custom Hunt result', () => {
  const results = [
    result({ id: 'canonical' }),
    result({ id: 'structural', isCustomHunt: true, structuralValueUsed: 12 }),
  ];
  const series = getDurationTrendSeries(results, workout({}));
  assert.deepEqual(series.map((p) => p.resultId), ['canonical']);
});

test('duration trend: excludes a Custom Hunt result with non-empty repsOverridesUsed', () => {
  const results = [
    result({ id: 'canonical' }),
    result({ id: 'reps-override', isCustomHunt: true, repsOverridesUsed: { 'minotaur-rung-1-snatch': 5 } }),
  ];
  const series = getDurationTrendSeries(results, workout({}));
  assert.deepEqual(series.map((p) => p.resultId), ['canonical']);
});

test('duration trend: includes a weight/rest-only Custom Hunt result (same work, still comparable)', () => {
  const results = [
    result({ id: 'canonical' }),
    result({ id: 'weight-only-custom', isCustomHunt: true, restSecondsUsed: 10, structuralValueUsed: null, repsOverridesUsed: null }),
  ];
  const series = getDurationTrendSeries(results, workout({}));
  assert.deepEqual(series.map((p) => p.resultId).sort(), ['canonical', 'weight-only-custom']);
});

test('duration trend: a Custom Hunt result with an empty repsOverridesUsed object is still included (not treated as structurally customized)', () => {
  const results = [result({ id: 'empty-overrides', isCustomHunt: true, repsOverridesUsed: {} })];
  const series = getDurationTrendSeries(results, workout({}));
  assert.deepEqual(series.map((p) => p.resultId), ['empty-overrides']);
});

test('duration trend: marks isPersonalBestAtTime chronologically, not by global fastest', () => {
  const results = [
    result({ id: 'a', completedAt: '2026-01-01T00:00:00.000Z', timeMinutes: 10, timeSeconds: 0 }), // 600s, first -> PB
    result({ id: 'b', completedAt: '2026-01-02T00:00:00.000Z', timeMinutes: 11, timeSeconds: 0 }), // 660s, slower -> not PB
    result({ id: 'c', completedAt: '2026-01-03T00:00:00.000Z', timeMinutes: 9, timeSeconds: 0 }), // 540s, fastest yet -> PB
  ];
  const series = getDurationTrendSeries(results, workout({}));
  assert.deepEqual(
    series.map((p) => ({ id: p.resultId, pb: p.isPersonalBestAtTime })),
    [
      { id: 'a', pb: true },
      { id: 'b', pb: false },
      { id: 'c', pb: true },
    ]
  );
});

test('duration trend: two results completed on the same day are both kept, not deduplicated', () => {
  const results = [
    result({ id: 'morning', completedAt: '2026-01-01T08:00:00.000Z' }),
    result({ id: 'evening', completedAt: '2026-01-01T20:00:00.000Z' }),
  ];
  const series = getDurationTrendSeries(results, workout({}));
  assert.equal(series.length, 2);
});

test('duration trend: ignores results for a different workoutId', () => {
  const results = [result({ id: 'this-workout' }), result({ id: 'other-workout', workoutId: 'abyss-carry' })];
  const series = getDurationTrendSeries(results, workout({}));
  assert.deepEqual(series.map((p) => p.resultId), ['this-workout']);
});

test('duration trend: a non-EMOM workout passed to getRoundsTrendSeries produces an empty series (mutually exclusive by construction)', () => {
  assert.deepEqual(getRoundsTrendSeries([result({ rungLaps: laps(3) })], workout({})), []);
});

// --- getRoundsTrendSeries ---

test('rounds trend: empty results produce an empty series', () => {
  assert.deepEqual(getRoundsTrendSeries([], emomWorkout({})), []);
});

test('rounds trend: an undefined workout produces an empty series rather than throwing', () => {
  assert.deepEqual(getRoundsTrendSeries([result({ workoutId: 'mammoth-emom', rungLaps: laps(3) })], undefined), []);
});

test('rounds trend: a non-EMOM workout (no emomSeconds) produces an empty series — this is getDurationTrendSeries\' job, not this one\'s', () => {
  const w = workout({ id: 'mammoth-emom', emomSeconds: undefined });
  assert.deepEqual(getRoundsTrendSeries([result({ workoutId: 'mammoth-emom', rungLaps: laps(3) })], w), []);
});

test('rounds trend: valid rungLaps produce the expected rounds value', () => {
  const results = [result({ workoutId: 'mammoth-emom', rungLaps: laps(4) })];
  const series = getRoundsTrendSeries(results, emomWorkout({}));
  assert.equal(series.length, 1);
  assert.equal(series[0].rounds, 4);
});

test('rounds trend: sorts chronologically ascending regardless of input order', () => {
  const results = [
    result({ id: 'newest', workoutId: 'mammoth-emom', completedAt: '2026-01-03T00:00:00.000Z', rungLaps: laps(5) }),
    result({ id: 'oldest', workoutId: 'mammoth-emom', completedAt: '2026-01-01T00:00:00.000Z', rungLaps: laps(3) }),
    result({ id: 'middle', workoutId: 'mammoth-emom', completedAt: '2026-01-02T00:00:00.000Z', rungLaps: laps(4) }),
  ];
  const series = getRoundsTrendSeries(results, emomWorkout({}));
  assert.deepEqual(series.map((p) => p.resultId), ['oldest', 'middle', 'newest']);
});

test('rounds trend: marks isPersonalBestAtTime chronologically by MOST rounds, not fewest (opposite direction from duration)', () => {
  const results = [
    result({ id: 'a', workoutId: 'mammoth-emom', completedAt: '2026-01-01T00:00:00.000Z', rungLaps: laps(3) }), // first -> PB
    result({ id: 'b', workoutId: 'mammoth-emom', completedAt: '2026-01-02T00:00:00.000Z', rungLaps: laps(2) }), // fewer -> not PB
    result({ id: 'c', workoutId: 'mammoth-emom', completedAt: '2026-01-03T00:00:00.000Z', rungLaps: laps(5) }), // most yet -> PB
  ];
  const series = getRoundsTrendSeries(results, emomWorkout({}));
  assert.deepEqual(
    series.map((p) => ({ id: p.resultId, pb: p.isPersonalBestAtTime })),
    [
      { id: 'a', pb: true },
      { id: 'b', pb: false },
      { id: 'c', pb: true },
    ]
  );
});

test('rounds trend: a null rungLaps is skipped entirely, never counted as 0 rounds', () => {
  const results = [
    result({ id: 'valid', workoutId: 'mammoth-emom', rungLaps: laps(3) }),
    result({ id: 'missing', workoutId: 'mammoth-emom', rungLaps: null }),
  ];
  const series = getRoundsTrendSeries(results, emomWorkout({}));
  assert.deepEqual(series.map((p) => p.resultId), ['valid']);
  assert.ok(!series.some((p) => p.rounds === 0), 'no fabricated 0-round data point');
});

test('rounds trend: an empty rungLaps array is skipped entirely, never counted as 0 rounds', () => {
  const results = [
    result({ id: 'valid', workoutId: 'mammoth-emom', rungLaps: laps(3) }),
    result({ id: 'empty-array', workoutId: 'mammoth-emom', rungLaps: [] }),
  ];
  const series = getRoundsTrendSeries(results, emomWorkout({}));
  assert.deepEqual(series.map((p) => p.resultId), ['valid']);
});

test('rounds trend: excludes a structurally-customized Custom Hunt result', () => {
  const results = [
    result({ id: 'canonical', workoutId: 'mammoth-emom', rungLaps: laps(4) }),
    result({ id: 'structural', workoutId: 'mammoth-emom', rungLaps: laps(4), isCustomHunt: true, structuralValueUsed: 6 }),
  ];
  const series = getRoundsTrendSeries(results, emomWorkout({}));
  assert.deepEqual(series.map((p) => p.resultId), ['canonical']);
});

test('rounds trend: excludes a Custom Hunt result with non-empty repsOverridesUsed', () => {
  const results = [
    result({ id: 'canonical', workoutId: 'mammoth-emom', rungLaps: laps(4) }),
    result({
      id: 'reps-override',
      workoutId: 'mammoth-emom',
      rungLaps: laps(4),
      isCustomHunt: true,
      repsOverridesUsed: { 'some-exercise': 10 },
    }),
  ];
  const series = getRoundsTrendSeries(results, emomWorkout({}));
  assert.deepEqual(series.map((p) => p.resultId), ['canonical']);
});

test('rounds trend: includes a weight/rest-only Custom Hunt result (same work, still comparable)', () => {
  const results = [
    result({ id: 'canonical', workoutId: 'mammoth-emom', rungLaps: laps(4) }),
    result({
      id: 'weight-only-custom',
      workoutId: 'mammoth-emom',
      rungLaps: laps(4),
      isCustomHunt: true,
      restSecondsUsed: 10,
      structuralValueUsed: null,
      repsOverridesUsed: null,
    }),
  ];
  const series = getRoundsTrendSeries(results, emomWorkout({}));
  assert.deepEqual(series.map((p) => p.resultId).sort(), ['canonical', 'weight-only-custom']);
});

test("rounds trend: a result's elapsed-time fields never leak into its rounds value — EMOM time is a fixed window, not a performance signal", () => {
  // Deliberately mismatched: a long elapsed time but few rounds, and a
  // short elapsed time but many rounds — rounds must come from
  // rungLaps.length alone, never derived from or influenced by
  // timeMinutes/timeSeconds.
  const results = [
    result({ id: 'long-time-few-rounds', workoutId: 'mammoth-emom', timeMinutes: 3, timeSeconds: 0, rungLaps: laps(2) }),
    result({ id: 'short-time-many-rounds', workoutId: 'mammoth-emom', timeMinutes: 0, timeSeconds: 5, rungLaps: laps(8) }),
  ];
  const series = getRoundsTrendSeries(results, emomWorkout({}));
  const byId = new Map(series.map((p) => [p.resultId, p.rounds]));
  assert.equal(byId.get('long-time-few-rounds'), 2);
  assert.equal(byId.get('short-time-many-rounds'), 8);
  // And no field on a RoundsTrendPoint is itself a time value.
  series.forEach((p) => {
    assert.ok(!('seconds' in p), 'RoundsTrendPoint must never carry a seconds/time field');
  });
});

test('rounds trend: ignores results for a different workoutId', () => {
  const results = [
    result({ id: 'this-workout', workoutId: 'mammoth-emom', rungLaps: laps(3) }),
    result({ id: 'other-workout', workoutId: 'war-engine', rungLaps: laps(3) }),
  ];
  const series = getRoundsTrendSeries(results, emomWorkout({}));
  assert.deepEqual(series.map((p) => p.resultId), ['this-workout']);
});

// --- getMonsterHistoryEntries ---

test('history entries: empty results produce an empty list', () => {
  assert.deepEqual(getMonsterHistoryEntries([]), []);
});

test('history entries: sorted newest-first', () => {
  const results = [
    result({ id: 'oldest', completedAt: '2026-01-01T00:00:00.000Z' }),
    result({ id: 'newest', completedAt: '2026-01-03T00:00:00.000Z' }),
    result({ id: 'middle', completedAt: '2026-01-02T00:00:00.000Z' }),
  ];
  assert.deepEqual(getMonsterHistoryEntries(results).map((r) => r.id), ['newest', 'middle', 'oldest']);
});

test('history entries: repeated same-day results are all kept, not collapsed into one', () => {
  const results = [
    result({ id: 'morning', completedAt: '2026-01-01T08:00:00.000Z' }),
    result({ id: 'evening', completedAt: '2026-01-01T20:00:00.000Z' }),
  ];
  assert.equal(getMonsterHistoryEntries(results).length, 2);
});
