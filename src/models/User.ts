export interface User {
  id: string;
  displayName: string;
  createdAt: string;
  level: number;
  totalXP: number;
  unitPreference: 'kg' | 'lb';
  activeCampaignId: string | null;
}
