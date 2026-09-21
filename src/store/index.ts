import { create } from 'zustand';
import { AppStore } from './types';
import { createUserSlice } from './userSlice';
import { createSettingsSlice } from './settingsSlice';
import { createChronicleSlice } from './chronicleSlice';
import { createProgressSlice } from './progressSlice';
import { createWorkoutSlice } from './workoutSlice';
import { createTimerSlice } from './timerSlice';
import { createCustomHuntSlice } from './customHuntSlice';
import { createCustomWorkoutSlice } from './customWorkoutSlice';
import { createStopwatchSlice } from './stopwatchSlice';

export const useAppStore = create<AppStore>()((...api) => ({
  ...createUserSlice(...api),
  ...createSettingsSlice(...api),
  ...createChronicleSlice(...api),
  ...createProgressSlice(...api),
  ...createWorkoutSlice(...api),
  ...createTimerSlice(...api),
  ...createCustomHuntSlice(...api),
  ...createCustomWorkoutSlice(...api),
  ...createStopwatchSlice(...api),
}));

export type { AppStore } from './types';
