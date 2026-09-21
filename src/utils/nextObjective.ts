import { Campaign, Monster, MonsterProgress, Hunt } from '../models';
import { getCampaignState, getCampaignMonsterState, isCampaignComplete } from './campaignState';
import { getHuntDisplayState } from './huntState';

export interface NextObjective {
  campaign: Campaign;
  monster: Monster;
  hunt: Hunt;
}

/**
 * The single "what should the player do next" answer, reused by the Home
 * dashboard's Continue Adventure card and the Victory screen's Next Target
 * card — one derivation, not two. Walks campaigns in order, skipping
 * locked/completed ones; within the first eligible campaign, finds the
 * first monster that's unlocked and not yet defeated; within that
 * monster, finds the first Hunt that's unlocked and not yet completed.
 * Entirely composed from existing derived helpers (getCampaignState,
 * getCampaignMonsterState, getHuntDisplayState) — no new state, no new
 * traversal rules beyond what World Map and Monster Detail already use
 * individually.
 */
export function getNextObjective(
  campaigns: Campaign[],
  getMonster: (monsterId: string) => Monster | undefined,
  monsterProgress: Record<string, MonsterProgress>
): NextObjective | null {
  const sortedCampaigns = [...campaigns].sort((a, b) => a.order - b.order);

  for (const campaign of sortedCampaigns) {
    if (getCampaignState(sortedCampaigns, campaign.id, monsterProgress) !== 'available') {
      continue;
    }
    if (isCampaignComplete(campaign, monsterProgress)) {
      continue;
    }

    for (const monsterId of campaign.monsterIds) {
      const monsterState = getCampaignMonsterState(campaign, monsterId, monsterProgress);
      if (monsterState !== 'available') {
        continue;
      }

      const monster = getMonster(monsterId);
      if (!monster) {
        continue;
      }

      const huntsCompleted = monsterProgress[monsterId]?.huntsCompleted ?? 0;
      const hunt = monster.hunts.find(
        (candidate) => getHuntDisplayState(candidate, huntsCompleted) === 'available'
      );
      if (hunt) {
        return { campaign, monster, hunt };
      }
    }
  }

  return null;
}
