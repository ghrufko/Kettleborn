import type { StateCreator } from 'zustand';
import { AchievementRepository } from '../services';
import { LOCAL_USER_ID } from '../constants/localUser';
import type { AppStore, AchievementSlice } from './types';

export const createAchievementSlice: StateCreator<AppStore, [], [], AchievementSlice> = (set, get) => ({
  achievements: [],

  loadAchievements: async () => {
    const achievements = await AchievementRepository.getAllForUser(LOCAL_USER_ID);
    set({ achievements });
  },

  unlockAchievements: async (types, unlockedAt) => {
    const alreadyUnlocked = new Set(get().achievements.map((a) => a.milestoneType));
    // De-dupe the input itself too (defensive — detectAllQualifyingMilestones
    // never produces duplicates today, but this guard costs nothing).
    const newTypes = Array.from(new Set(types)).filter((type) => !alreadyUnlocked.has(type));
    for (const type of newTypes) {
      try {
        await AchievementRepository.unlock(LOCAL_USER_ID, type, unlockedAt);
      } catch {
        // Storage error — never claim a save happened when it didn't.
        // Skip updating in-memory state for this type and move on to the
        // rest of the batch; the Hunt itself already completed
        // successfully regardless of whether an achievement persisted.
        continue;
      }
      set((state) => ({
        achievements: [...state.achievements, { userId: LOCAL_USER_ID, milestoneType: type, unlockedAt }],
      }));
    }
  },
});
