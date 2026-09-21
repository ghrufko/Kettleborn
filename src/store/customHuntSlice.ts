import { StateCreator } from 'zustand';
import { CustomHuntPresetRepository } from '../services';
import { LOCAL_USER_ID } from '../constants/localUser';
import { AppStore, CustomHuntSlice } from './types';

export const createCustomHuntSlice: StateCreator<AppStore, [], [], CustomHuntSlice> = () => ({
  getCustomHuntPreset: async (workoutId) => {
    return CustomHuntPresetRepository.getByWorkoutId(LOCAL_USER_ID, workoutId);
  },

  saveCustomHuntPreset: async ({
    workoutId,
    weightKg,
    weightBKg,
    gearCount,
    restSeconds,
    customStructureValue,
    repsOverrides,
  }) => {
    await CustomHuntPresetRepository.upsert({
      userId: LOCAL_USER_ID,
      workoutId,
      weightKg,
      weightBKg: weightBKg ?? null,
      gearCount,
      restSeconds,
      customStructureValue: customStructureValue ?? null,
      repsOverrides: repsOverrides ?? null,
      updatedAt: new Date().toISOString(),
    });
  },
});
