import type { WorkoutResult, Workout, Chronicle } from '../models';
import type { HuntSummary } from '../store/types';
import { computeHistoricalRanks } from './rankHistory';
import type { HuntRank } from './huntRank';

export type MilestoneType =
  | 'first-victory'
  | 'monster-slayer'
  | 'first-s-rank'
  | 'first-level-up'
  | 'campaign-complete';

export interface Milestone {
  type: MilestoneType;
  title: string;
  description: string;
}

/**
 * Phase 2.11: the single source of truth for each milestone's display
 * text — `detectMilestone` below reads from this instead of inlining its
 * own copies, and the Achievements screen reads it directly for the
 * LOCKED entries it has no live Milestone object for. One place to edit,
 * banner and screen can never drift apart.
 */
export const MILESTONE_DEFINITIONS: Record<MilestoneType, { title: string; description: string }> = {
  'campaign-complete': {
    title: 'Campaign Complete',
    description: 'Every monster in this trial has fallen.',
  },
  'first-victory': {
    title: 'First Victory',
    description: 'Your first completed Hunt. Every Hunter starts here.',
  },
  'monster-slayer': {
    title: 'Monster Slayer',
    description: 'This monster has never been defeated by you before. Now it has.',
  },
  'first-level-up': {
    title: 'First Level Up',
    description: "You've grown stronger than when you started.",
  },
  'first-s-rank': {
    title: 'First S Rank',
    description: 'Flawless pace. This is the mark to chase from here.',
  },
};

/** Stable display order for the Achievements screen — not alphabetical, not priority order, just a readable "how a new Hunter would naturally reach each one" sequence. */
export const MILESTONE_DISPLAY_ORDER: MilestoneType[] = [
  'first-victory',
  'first-level-up',
  'first-s-rank',
  'monster-slayer',
  'campaign-complete',
];

/**
 * Detects the single most significant "moment" this Hunt just produced —
 * not a new achievement system, just recognizing events already implied
 * by data completeHunt already computed or that already persists.
 * Nothing here is stored; if the app were reinstalled, these moments
 * simply wouldn't be recognized again (same as any other derived view).
 * Only the single highest-priority moment is returned, to keep the
 * Victory screen from turning into a badge dump.
 *
 * Phase 2.11: persistent unlock tracking is driven by
 * `detectAllQualifyingMilestones` below, not this function — this one is
 * unchanged, still purely about which ONE banner to show.
 */
export function detectMilestone(params: {
  summary: HuntSummary;
  chronicle: Chronicle | null;
  huntOrder: number;
  monsterHuntCount: number;
  justCompletedCampaign: boolean;
  priorResults: WorkoutResult[]; // every result BEFORE this one, excluding it
  getWorkout: (workoutId: string) => Workout | undefined;
}): Milestone | null {
  const { summary, chronicle, huntOrder, monsterHuntCount, justCompletedCampaign, priorResults, getWorkout } =
    params;

  if (justCompletedCampaign) {
    return { type: 'campaign-complete', ...MILESTONE_DEFINITIONS['campaign-complete'] };
  }

  // First Victory: totalHuntsCompleted was incremented to exactly 1 by this hunt.
  if (chronicle?.totalHuntsCompleted === 1) {
    return { type: 'first-victory', ...MILESTONE_DEFINITIONS['first-victory'] };
  }

  // Monster Slayer: this was the monster's final Hunt, cleared for the first time.
  if (summary.isFirstClear && huntOrder === monsterHuntCount) {
    return { type: 'monster-slayer', ...MILESTONE_DEFINITIONS['monster-slayer'] };
  }

  // First Level Up: level was 1 before this hunt and is higher now.
  if (summary.leveledUp && summary.previousLevel === 1) {
    return { type: 'first-level-up', ...MILESTONE_DEFINITIONS['first-level-up'] };
  }

  // First S Rank: this hunt earned S, and no prior result in the whole
  // history ever did — recomputed the same way completeHunt would have
  // computed each of those past ranks at the time.
  if (summary.rank === 'S') {
    const priorRanks = computeHistoricalRanks(priorResults, getWorkout);
    const hasEarnedSBefore = priorRanks.some((r) => r.rank === 'S');
    if (!hasEarnedSBefore) {
      return { type: 'first-s-rank', ...MILESTONE_DEFINITIONS['first-s-rank'] };
    }
  }

  return null;
}

/**
 * Phase 2.11: EVERY milestone condition that is true for this Hunt
 * completion, not just the single highest-priority one detectMilestone
 * surfaces as a banner. This drives persistent achievement unlocking —
 * without it, a genuinely-earned milestone could be permanently missed
 * just because a higher-priority banner shadowed it on the one occasion
 * its condition was true. Several of these conditions are NEVER true
 * again on a later replay (e.g. `isFirstClear` is scoped to a single
 * workoutId's history), so this has to check independently, not rely on
 * detectMilestone's single winner.
 *
 * Reuses the exact same individual conditions as detectMilestone, just
 * without the early-return priority ordering — detectMilestone itself is
 * completely unchanged, so the banner's condition logic and timing are
 * preserved exactly as they were.
 *
 * Takes the handful of individual fields this actually needs (not a full
 * HuntSummary) deliberately — this is called from inside completeHunt
 * itself (workoutSlice.ts), before the full HuntSummary object exists,
 * so requiring one would force constructing it early just for this.
 */
export function detectAllQualifyingMilestones(params: {
  isFirstClear: boolean;
  leveledUp: boolean;
  previousLevel: number;
  rank: HuntRank;
  chronicle: Chronicle | null;
  huntOrder: number;
  monsterHuntCount: number;
  justCompletedCampaign: boolean;
  priorResults: WorkoutResult[];
  getWorkout: (workoutId: string) => Workout | undefined;
}): MilestoneType[] {
  const {
    isFirstClear,
    leveledUp,
    previousLevel,
    rank,
    chronicle,
    huntOrder,
    monsterHuntCount,
    justCompletedCampaign,
    priorResults,
    getWorkout,
  } = params;
  const qualifying: MilestoneType[] = [];

  if (justCompletedCampaign) {
    qualifying.push('campaign-complete');
  }
  if (chronicle?.totalHuntsCompleted === 1) {
    qualifying.push('first-victory');
  }
  if (isFirstClear && huntOrder === monsterHuntCount) {
    qualifying.push('monster-slayer');
  }
  if (leveledUp && previousLevel === 1) {
    qualifying.push('first-level-up');
  }
  if (rank === 'S') {
    const priorRanks = computeHistoricalRanks(priorResults, getWorkout);
    const hasEarnedSBefore = priorRanks.some((r) => r.rank === 'S');
    if (!hasEarnedSBefore) {
      qualifying.push('first-s-rank');
    }
  }

  return qualifying;
}
