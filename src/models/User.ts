export interface User {
  id: string;
  displayName: string;
  createdAt: string;
  level: number;
  totalXP: number;
  unitPreference: 'kg' | 'lb';
  activeCampaignId: string | null;
  /**
   * Migration 18: which "life" of progression the player is on. Starts at
   * 0 and advances only on a full campaign reset (which also returns XP to
   * 0), so a stage's first-clear bonus is granted at most once per epoch.
   */
  progressionEpoch?: number;
}
