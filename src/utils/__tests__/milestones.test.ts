import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectMilestone,
  detectAllQualifyingMilestones,
  MILESTONE_DEFINITIONS,
  MILESTONE_DISPLAY_ORDER,
} from '../milestones';
import type { MilestoneType } from '../milestones';
import type { HuntSummary } from '../../store/types';
import type { Chronicle, WorkoutResult, Workout } from '../../models';

function summary(overrides: Partial<HuntSummary>): HuntSummary {
  return {
    rank: 'C',
    xp: {
      baseXP: 10,
      workloadBonus: 0,
      repeatMultiplier: 1,
      difficultyBonus: 0,
      weightBonus: 0,
      performanceBonus: 0,
      personalRecordBonus: 0,
      firstClearBonus: 0,
      total: 10,
    },
    previousXP: 0,
    newXP: 10,
    previousLevel: 1,
    newLevel: 1,
    leveledUp: false,
    title: 'Novice Hunter',
    previousTitle: 'Novice Hunter',
    titleChanged: false,
    isPersonalRecord: false,
    isFirstClear: false,
    totalDamageDealt: 0,
    criticalHits: 0,
    totalRounds: 1,
    totalExercises: 1,
    completionPercentage: 100,
    volumeKg: 0,
    weightKg: 16,
    weightBKg: null,
    gearCount: 1,
    elapsedSeconds: 300,
    exerciseBreakdown: [],
    comparablePreviousSeconds: null,
    isBetterThanComparable: null,
    resultId: 'result-test',
    encounterOutcome: null,
    encounterTargetSeconds: null,
    isCustomHunt: false,
    extraSets: null,
    ...overrides,
  };
}

function chronicle(overrides: Partial<Chronicle>): Chronicle {
  return {
    userId: 'local-hunter',
    totalWorkouts: 1,
    totalHuntsCompleted: 1,
    totalMonstersDefeated: 0,
    totalVolumeKg: 0,
    totalTrainingMinutes: 5,
    longestStreakDays: 1,
    currentStreakDays: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function workout(overrides: Partial<Workout>): Workout {
  return {
    id: 'test-workout',
    name: 'Test Workout',
    difficulty: 3,
    estimatedMinutesRange: [10, 15],
    gearWeightKg: 16,
    gearCount: 1,
    rounds: 5,
    restSeconds: 30,
    roundBonusDamage: 10,
    targetTimeSeconds: 300,
    focus: [],
    exercises: [],
    finisher: { name: 'Finisher', scheme: '1-1-1' },
    ...overrides,
  } as Workout;
}

function result(overrides: Partial<WorkoutResult>): WorkoutResult {
  return {
    id: 'result-prior',
    userId: 'local-hunter',
    workoutId: 'test-workout',
    monsterId: 'test-monster',
    huntId: 'test-hunt',
    completedAt: '2026-01-01T00:00:00.000Z',
    timeMinutes: 5,
    timeSeconds: 0,
    weightValueA: 16,
    weightValueB: null,
    weightUnit: 'kg',
    notes: null,
    xpAwarded: 10,
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

const noWorkout = () => undefined;

// --- MILESTONE_DEFINITIONS / MILESTONE_DISPLAY_ORDER ---

test('every MilestoneType has a definition with a non-empty title and description', () => {
  const types: MilestoneType[] = [
    'first-victory',
    'monster-slayer',
    'first-s-rank',
    'first-level-up',
    'campaign-complete',
  ];
  for (const type of types) {
    const def = MILESTONE_DEFINITIONS[type];
    assert.ok(def, `missing definition for ${type}`);
    assert.ok(def.title.length > 0);
    assert.ok(def.description.length > 0);
  }
});

test('MILESTONE_DISPLAY_ORDER contains exactly the 5 known milestone types, no more, no fewer', () => {
  const expected = new Set(['first-victory', 'monster-slayer', 'first-s-rank', 'first-level-up', 'campaign-complete']);
  assert.equal(MILESTONE_DISPLAY_ORDER.length, expected.size);
  assert.deepEqual(new Set(MILESTONE_DISPLAY_ORDER), expected);
});

// --- detectMilestone (unchanged behavior — banner logic) ---

test('detectMilestone: campaign-complete takes priority over everything else', () => {
  const m = detectMilestone({
    summary: summary({ isFirstClear: true, leveledUp: true, previousLevel: 1, rank: 'S' }),
    chronicle: chronicle({ totalHuntsCompleted: 1 }),
    huntOrder: 1,
    monsterHuntCount: 1,
    justCompletedCampaign: true,
    priorResults: [],
    getWorkout: noWorkout,
  });
  assert.equal(m?.type, 'campaign-complete');
});

test('detectMilestone: first-victory fires when totalHuntsCompleted is exactly 1', () => {
  const m = detectMilestone({
    summary: summary({}),
    chronicle: chronicle({ totalHuntsCompleted: 1 }),
    huntOrder: 1,
    monsterHuntCount: 3,
    justCompletedCampaign: false,
    priorResults: [],
    getWorkout: noWorkout,
  });
  assert.equal(m?.type, 'first-victory');
});

test('detectMilestone: monster-slayer fires on the monster\'s final hunt, first clear', () => {
  const m = detectMilestone({
    summary: summary({ isFirstClear: true }),
    chronicle: chronicle({ totalHuntsCompleted: 5 }),
    huntOrder: 3,
    monsterHuntCount: 3,
    justCompletedCampaign: false,
    priorResults: [],
    getWorkout: noWorkout,
  });
  assert.equal(m?.type, 'monster-slayer');
});

test('detectMilestone: monster-slayer does NOT fire when huntOrder is not the monster\'s final hunt', () => {
  const m = detectMilestone({
    summary: summary({ isFirstClear: true }),
    chronicle: chronicle({ totalHuntsCompleted: 5 }),
    huntOrder: 1,
    monsterHuntCount: 3,
    justCompletedCampaign: false,
    priorResults: [],
    getWorkout: noWorkout,
  });
  assert.notEqual(m?.type, 'monster-slayer');
});

test('detectMilestone: first-level-up fires when previousLevel was 1 and leveledUp is true', () => {
  const m = detectMilestone({
    summary: summary({ leveledUp: true, previousLevel: 1 }),
    chronicle: chronicle({ totalHuntsCompleted: 5 }),
    huntOrder: 2,
    monsterHuntCount: 3,
    justCompletedCampaign: false,
    priorResults: [],
    getWorkout: noWorkout,
  });
  assert.equal(m?.type, 'first-level-up');
});

test('detectMilestone: first-level-up does NOT fire for a level-up past level 1', () => {
  const m = detectMilestone({
    summary: summary({ leveledUp: true, previousLevel: 4 }),
    chronicle: chronicle({ totalHuntsCompleted: 5 }),
    huntOrder: 2,
    monsterHuntCount: 3,
    justCompletedCampaign: false,
    priorResults: [],
    getWorkout: noWorkout,
  });
  assert.notEqual(m?.type, 'first-level-up');
});

test('detectMilestone: first-s-rank fires on an S rank with no prior S in history', () => {
  const m = detectMilestone({
    summary: summary({ rank: 'S' }),
    chronicle: chronicle({ totalHuntsCompleted: 5 }),
    huntOrder: 2,
    monsterHuntCount: 3,
    justCompletedCampaign: false,
    priorResults: [result({ timeMinutes: 10 })], // slow prior result, not S
    getWorkout: () => workout({ targetTimeSeconds: 300 }),
  });
  assert.equal(m?.type, 'first-s-rank');
});

test('detectMilestone: first-s-rank does NOT fire if an S rank was already earned before', () => {
  const m = detectMilestone({
    summary: summary({ rank: 'S' }),
    chronicle: chronicle({ totalHuntsCompleted: 5 }),
    huntOrder: 2,
    monsterHuntCount: 3,
    justCompletedCampaign: false,
    // Fast enough to already have earned S previously under the same target.
    priorResults: [result({ timeMinutes: 0, timeSeconds: 1 })],
    getWorkout: () => workout({ targetTimeSeconds: 300 }),
  });
  assert.notEqual(m?.type, 'first-s-rank');
});

test('detectMilestone: returns null when no condition qualifies', () => {
  const m = detectMilestone({
    summary: summary({}),
    chronicle: chronicle({ totalHuntsCompleted: 5 }),
    huntOrder: 1,
    monsterHuntCount: 3,
    justCompletedCampaign: false,
    priorResults: [],
    getWorkout: noWorkout,
  });
  assert.equal(m, null);
});

// --- detectAllQualifyingMilestones (Phase 2.11 — drives persistence) ---

test('detectAllQualifyingMilestones: returns every qualifying type, not just one, when several conditions are simultaneously true', () => {
  const types = detectAllQualifyingMilestones({
    isFirstClear: true,
    leveledUp: true,
    previousLevel: 1,
    rank: 'S',
    chronicle: chronicle({ totalHuntsCompleted: 1 }),
    huntOrder: 1,
    monsterHuntCount: 1,
    justCompletedCampaign: false,
    priorResults: [],
    getWorkout: noWorkout,
  });
  // first-victory (totalHuntsCompleted===1), monster-slayer
  // (isFirstClear && huntOrder===monsterHuntCount), first-level-up
  // (leveledUp && previousLevel===1), and first-s-rank (rank S, no
  // prior S) are ALL true here — detectMilestone would only ever
  // surface 'first-victory' as the single banner, but this function
  // must report all four so none of them silently go unpersisted.
  assert.deepEqual(
    new Set(types),
    new Set(['first-victory', 'monster-slayer', 'first-level-up', 'first-s-rank'])
  );
});

test('detectAllQualifyingMilestones: returns an empty array when nothing qualifies', () => {
  const types = detectAllQualifyingMilestones({
    isFirstClear: false,
    leveledUp: false,
    previousLevel: 4,
    rank: 'B',
    chronicle: chronicle({ totalHuntsCompleted: 5 }),
    huntOrder: 1,
    monsterHuntCount: 3,
    justCompletedCampaign: false,
    priorResults: [],
    getWorkout: noWorkout,
  });
  assert.deepEqual(types, []);
});

test('detectAllQualifyingMilestones: campaign-complete is independent of the other conditions', () => {
  const types = detectAllQualifyingMilestones({
    isFirstClear: false,
    leveledUp: false,
    previousLevel: 6,
    rank: 'B',
    chronicle: chronicle({ totalHuntsCompleted: 40 }),
    huntOrder: 3,
    monsterHuntCount: 3,
    justCompletedCampaign: true,
    priorResults: [],
    getWorkout: noWorkout,
  });
  assert.deepEqual(types, ['campaign-complete']);
});
