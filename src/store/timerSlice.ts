import { StateCreator } from 'zustand';
import { TimerRepository } from '../services';
import { LOCAL_USER_ID } from '../constants/localUser';
import { APP_VERSION } from '../constants/version';
import { AppStore, TimerSlice } from './types';
import { TimerResult, TimerRound } from '../models';

export const createTimerSlice: StateCreator<AppStore, [], [], TimerSlice> = (set) => ({
  userTimerPresets: [],
  lastTimerResult: null,

  loadTimerPresets: async () => {
    const presets = await TimerRepository.getPresetsForUser(LOCAL_USER_ID);
    set({ userTimerPresets: presets });
  },

  saveTimerPreset: async (
    name: string,
    rounds: TimerRound[],
    options?: { linkedWorkoutId?: string; randomizeExercises?: boolean }
  ) => {
    const preset = {
      id: `custom-${Date.now()}`,
      name,
      rounds,
      linkedWorkoutId: options?.linkedWorkoutId,
      randomizeExercises: options?.randomizeExercises ?? false,
    };
    await TimerRepository.savePreset(LOCAL_USER_ID, preset);
    const presets = await TimerRepository.getPresetsForUser(LOCAL_USER_ID);
    set({ userTimerPresets: presets });
  },

  deleteTimerPreset: async (presetId: string) => {
    await TimerRepository.deletePreset(presetId);
    const presets = await TimerRepository.getPresetsForUser(LOCAL_USER_ID);
    set({ userTimerPresets: presets });
  },

  saveTimerResult: async ({ presetId, presetName, totalDurationSeconds, weightKg }) => {
    const result: TimerResult = {
      id: `${presetId}-${Date.now()}`,
      userId: LOCAL_USER_ID,
      presetId,
      presetName,
      totalDurationSeconds,
      completedAt: new Date().toISOString(),
      weightKg,
      appVersion: APP_VERSION,
    };
    await TimerRepository.saveResult(result);
    set({ lastTimerResult: result });
    return result;
  },
});
