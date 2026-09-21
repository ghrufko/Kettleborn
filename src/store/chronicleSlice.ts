import { StateCreator } from 'zustand';
import { ChronicleRepository } from '../services';
import { LOCAL_USER_ID } from '../constants/localUser';
import { AppStore, ChronicleSlice } from './types';

export const createChronicleSlice: StateCreator<AppStore, [], [], ChronicleSlice> = (set) => ({
  chronicle: null,

  initializeChronicle: async () => {
    const chronicle = await ChronicleRepository.createIfNotExists(LOCAL_USER_ID);
    set({ chronicle });
  },
});
