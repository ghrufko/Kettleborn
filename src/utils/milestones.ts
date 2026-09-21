import { WorkoutResult, Workout, Chronicle } from '../models';
import { HuntSummary } from '../store/types';
import { computeHistoricalRanks } from './rankHistory';

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
 * Detects the single most significant "moment" this Hunt just produced —
 * not a new achievement system, just recognizing events already implied
 * by data completeHunt already computed or that already persists.
 * Nothing here is stored; if the app were reinstalled, these moments
 * simply wouldn't be recognized again (same as any other derived view).
 * Only the single highest-priority moment is returned, to keep the
 * Victory screen from turning into a badge dump.
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
    return {
      type: 'campaign-complete',
      title: 'Campaign Complete',
      description: 'Every monster in this trial has fallen.',
    };
  }

  // First Victory: totalHuntsCompleted was incremented to exactly 1 by this hunt.
  if (chronicle?.totalHuntsCompleted === 1) {
    return {
      type: 'first-victory',
      title: 'First Victory',
      description: 'Your first completed Hunt. Every Hunter starts here.',
    };
  }

  // Monster Slayer: this was the monster's final Hunt, cleared for the first time.
  if (summary.isFirstClear && huntOrder === monsterHuntCount) {
    return {
      type: 'monster-slayer',
      title: 'Monster Slayer',
      description: 'This monster has never been defeated by you before. Now it has.',
    };
  }

  // First Level Up: level was 1 before this hunt and is higher now.
  if (summary.leveledUp && summary.previousLevel === 1) {
    return {
      type: 'first-level-up',
      title: 'First Level Up',
      description: "You've grown stronger than when you started.",
    };
  }

  // First S Rank: this hunt earned S, and no prior result in the whole
  // history ever did — recomputed the same way completeHunt would have
  // computed each of those past ranks at the time.
  if (summary.rank === 'S') {
    const priorRanks = computeHistoricalRanks(priorResults, getWorkout);
    const hasEarnedSBefore = priorRanks.some((r) => r.rank === 'S');
    if (!hasEarnedSBefore) {
      return {
        type: 'first-s-rank',
        title: 'First S Rank',
        description: 'Flawless pace. This is the mark to chase from here.',
      };
    }
  }

  return null;
}
