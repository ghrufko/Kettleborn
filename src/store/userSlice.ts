import { StateCreator } from 'zustand';
import { UserRepository } from '../services';
import { LOCAL_USER_ID } from '../constants/localUser';
import { AppStore, UserSlice } from './types';

export const createUserSlice: StateCreator<AppStore, [], [], UserSlice> = (set) => ({
  user: null,

  initializeUser: async () => {
    const user = await UserRepository.createIfNotExists({
      id: LOCAL_USER_ID,
      displayName: 'Hunter',
      createdAt: new Date().toISOString(),
      level: 1,
      totalXP: 0,
      unitPreference: 'kg',
      activeCampaignId: null,
    });
    set({ user });
  },
});
