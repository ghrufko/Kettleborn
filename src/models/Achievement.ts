/**
 * Mirrors MilestoneType in src/utils/milestones.ts — duplicated rather
 * than imported, since every file in this directory is self-contained
 * (no model imports from outside src/models). Keep in sync if the set of
 * milestone types ever changes.
 */
export type AchievementMilestoneType =
  | 'first-victory'
  | 'monster-slayer'
  | 'first-s-rank'
  | 'first-level-up'
  | 'campaign-complete';

/**
 * One row per (user, milestone type) ever unlocked — the first time a
 * milestone's condition was true, permanently. A milestone type whose
 * condition can become true more than once (e.g. "monster-slayer" fires
 * on every monster's first defeat, "campaign-complete" on every
 * campaign's completion) still only ever gets ONE row/timestamp here —
 * the achievement record is "have I ever done this," not "how many
 * times," matching how MilestoneType itself carries no per-monster or
 * per-campaign identity in the existing banner system.
 */
export interface Achievement {
  userId: string;
  milestoneType: AchievementMilestoneType;
  unlockedAt: string;
}
