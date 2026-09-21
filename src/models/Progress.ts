export interface MonsterProgress {
  userId: string;
  monsterId: string;
  huntsCompleted: number;
  huntsTotal: number;
  defeated: boolean;
}

export interface CampaignProgress {
  userId: string;
  campaignId: string;
  huntsCompleted: number;
  huntsTotal: number;
}
