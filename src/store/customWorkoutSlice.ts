import { StateCreator } from 'zustand';
import { CustomWorkoutRepository } from '../services';
import { LOCAL_USER_ID } from '../constants/localUser';
import { AppStore, CustomWorkoutSlice } from './types';
import { CustomWorkout, CustomWorkoutExercise } from '../models';

export const createCustomWorkoutSlice: StateCreator<AppStore, [], [], CustomWorkoutSlice> = (set) => ({
  userCustomWorkouts: [],

  loadCustomWorkouts: async () => {
    const workouts = await CustomWorkoutRepository.getAll(LOCAL_USER_ID);
    set({ userCustomWorkouts: workouts });
  },

  saveCustomWorkout: async (input: {
    id?: string;
    name: string;
    exercises: CustomWorkoutExercise[];
    weightKg: number;
    /** Kettlebell weight audit: see CustomWorkout.weightBKg. */
    weightBKg?: number | null;
    gearCount: 1 | 2;
    rounds: number;
    restSeconds: number;
  }) => {
    const now = new Date().toISOString();
    const existing = input.id ? await CustomWorkoutRepository.getById(input.id) : null;
    const workout: CustomWorkout = {
      id: input.id ?? `custom-workout-${Date.now()}`,
      name: input.name,
      exercises: input.exercises,
      weightKg: input.weightKg,
      weightBKg: input.weightBKg ?? null,
      gearCount: input.gearCount,
      rounds: input.rounds,
      restSeconds: input.restSeconds,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await CustomWorkoutRepository.upsert(LOCAL_USER_ID, workout);
    const workouts = await CustomWorkoutRepository.getAll(LOCAL_USER_ID);
    set({ userCustomWorkouts: workouts });
    return workout;
  },

  deleteCustomWorkout: async (id: string) => {
    await CustomWorkoutRepository.delete(id);
    const workouts = await CustomWorkoutRepository.getAll(LOCAL_USER_ID);
    set({ userCustomWorkouts: workouts });
  },

  saveCustomWorkoutResult: async ({
    customWorkoutId,
    elapsedSeconds,
    weightKg,
    weightBKg,
    gearCount,
    workoutName,
    rounds,
    restSeconds,
    totalReps,
    exerciseBreakdown,
  }) => {
    const result = {
      id: `${customWorkoutId}-${Date.now()}`,
      customWorkoutId,
      completedAt: new Date().toISOString(),
      elapsedSeconds,
      weightKg,
      weightBKg: weightBKg ?? null,
      gearCount,
      workoutName: workoutName ?? null,
      rounds: rounds ?? null,
      restSeconds: restSeconds ?? null,
      totalReps: totalReps ?? null,
      exerciseBreakdown: exerciseBreakdown ?? null,
    };
    await CustomWorkoutRepository.saveResult(LOCAL_USER_ID, result);
    return result;
  },

  getAllCustomWorkoutResults: async () => {
    return CustomWorkoutRepository.getAllForUser(LOCAL_USER_ID);
  },
});
