import { MonsterProgress, Campaign } from '../models';

export type CampaignMonsterState = 'locked' | 'available' | 'defeated';

/**
 * Every monster's Hunt I is available from the start — locking is never
 * monster-to-monster. The one exception is a campaign's designated final
 * boss (campaign.finalBossId), which stays locked until every other
 * monster in the campaign has been defeated. A campaign with no final
 * boss set (finalBossId: null) has no monster-level locking at all.
 * Hunt-to-hunt progression within a single monster (Hunt II needs Hunt I)
 * is a separate, unrelated mechanism — see getHuntDisplayState.
 */
export function getCampaignMonsterState(
  campaign: Campaign,
  monsterId: string,
  progressByMonsterId: Record<string, MonsterProgress>
): CampaignMonsterState {
  if (progressByMonsterId[monsterId]?.defeated) {
    return 'defeated';
  }

  if (monsterId !== campaign.finalBossId) {
    return 'available';
  }

  const otherMonsterIds = campaign.monsterIds.filter((id) => id !== monsterId);
  const allOthersDefeated = otherMonsterIds.every((id) => progressByMonsterId[id]?.defeated);
  return allOthersDefeated ? 'available' : 'locked';
}

export type CampaignState = 'locked' | 'available' | 'completed';

/** A campaign is complete once every monster in it — and its final boss, if it has one — has been defeated. */
export function isCampaignComplete(
  campaign: Campaign,
  progressByMonsterId: Record<string, MonsterProgress>
): boolean {
  if (campaign.monsterIds.length === 0) {
    return false;
  }
  const allMonstersDefeated = campaign.monsterIds.every((monsterId) => progressByMonsterId[monsterId]?.defeated);
  if (!allMonstersDefeated) {
    return false;
  }
  if (!campaign.finalBossId) {
    return true;
  }
  return !!progressByMonsterId[campaign.finalBossId]?.defeated;
}

/**
 * A campaign is locked until the campaign named by its
 * unlockRequiresCampaignId is fully completed (every one of its monsters
 * defeated). A campaign with no unlock requirement is always available.
 * Entirely data-driven — no per-campaign special-casing.
 *
 * Territory redesign: the three territories are explicitly non-linear —
 * every content campaign now has unlockRequiresCampaignId: null, so this
 * always resolves to 'available' (or 'completed') for all three. This
 * used to be forced by a temporary DEV_UNLOCK_ALL_CAMPAIGNS override in
 * this file; that override is gone because the underlying data now makes
 * it permanently true, not just for a testing pass. The unlock-by-prior-
 * campaign mechanism itself is left in place (not deleted) in case a
 * future, explicitly-requested campaign genuinely needs it.
 */
export function getCampaignState(
  campaigns: Campaign[],
  campaignId: string,
  progressByMonsterId: Record<string, MonsterProgress>
): CampaignState {
  const campaign = campaigns.find((c) => c.id === campaignId);
  if (!campaign) {
    return 'locked';
  }

  if (isCampaignComplete(campaign, progressByMonsterId)) {
    return 'completed';
  }

  if (!campaign.unlockRequiresCampaignId) {
    return 'available';
  }

  const requiredCampaign = campaigns.find((c) => c.id === campaign.unlockRequiresCampaignId);
  if (!requiredCampaign) {
    return 'available';
  }

  return isCampaignComplete(requiredCampaign, progressByMonsterId) ? 'available' : 'locked';
}
