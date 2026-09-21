import { StateCreator } from 'zustand';
import { StopwatchRepository } from '../services';
import { LOCAL_USER_ID } from '../constants/localUser';
import { AppStore, StopwatchSlice } from './types';

export const createStopwatchSlice: StateCreator<AppStore, [], [], StopwatchSlice> = () => ({
  saveStopwatchResult: async ({ elapsedSeconds, laps, note }) => {
    const result = {
      id: `stopwatch-${Date.now()}`,
      completedAt: new Date().toISOString(),
      elapsedSeconds,
      laps,
      note: note && note.trim().length > 0 ? note.trim() : null,
    };
    await StopwatchRepository.saveResult(LOCAL_USER_ID, result);
    return result;
  },

  getAllStopwatchResults: async () => {
    return StopwatchRepository.getAllForUser(LOCAL_USER_ID);
  },
});
