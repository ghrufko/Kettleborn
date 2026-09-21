import { StateCreator } from 'zustand';
import { SettingsRepository } from '../services';
import { LOCAL_USER_ID } from '../constants/localUser';
import { AppStore, SettingsSlice } from './types';
import { Settings } from '../models';

const DEFAULT_EQUIPMENT: Array<{ id: string; weight: number; label: string }> = [
  { id: 'kb-1', weight: 16, label: '16 KG' },
  { id: 'kb-2', weight: 16, label: '16 KG' },
];

export const createSettingsSlice: StateCreator<AppStore, [], [], SettingsSlice> = (set, get) => ({
  settings: null,
  equipment: [],

  initializeSettings: async () => {
    const settings = await SettingsRepository.createIfNotExists(LOCAL_USER_ID);
    set({ settings });
  },

  updateSettings: async (patch: Partial<Settings>) => {
    const current = get().settings;
    if (!current) {
      return;
    }
    const updated: Settings = { ...current, ...patch };
    await SettingsRepository.upsert(updated);
    set({ settings: updated });
  },

  loadEquipment: async () => {
    const existing = await SettingsRepository.getEquipmentForUser(LOCAL_USER_ID);
    if (existing.length === 0) {
      for (const item of DEFAULT_EQUIPMENT) {
        await SettingsRepository.upsertEquipment({
          id: item.id,
          userId: LOCAL_USER_ID,
          type: 'kettlebell',
          weight: item.weight,
          unit: 'kg',
          label: item.label,
          owned: true,
        });
      }
    }
    const equipment = await SettingsRepository.getEquipmentForUser(LOCAL_USER_ID);
    set({ equipment });
  },
});
