export interface Equipment {
  id: string;
  userId: string;
  type: 'kettlebell' | 'other';
  weight: number;
  unit: 'kg' | 'lb';
  label: string;
  owned: boolean;
}
