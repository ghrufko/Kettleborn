import { NavigatorScreenParams } from '@react-navigation/native';
import { Workout } from '../models';

export type HuntStackParamList = {
  Home: undefined;
  Hunt: undefined;
  WorldMap: { campaignId: string };
  MonsterDetail: { monsterId: string };
  HuntOverview: { monsterId: string; huntId: string };
  ActiveHunt: {
    monsterId: string;
    huntId: string;
    workoutId: string;
    weightKg?: number;
    /** Kettlebell weight audit: the second bell's real weight when gearCount is 2 — independent from weightKg (16kg + 18kg is valid). Undefined for a single-bell Hunt. */
    weightBKg?: number;
    /** Custom Hunt: player-chosen gear count + rest, only meaningful when isCustomHunt is true. */
    isCustomHunt?: boolean;
    customGearCount?: 1 | 2;
    customRestSeconds?: number;
    /**
     * Task 2: only present when the player changed a structural control
     * (rounds/max rung/cycles) away from canonical — a fully-built,
     * self-consistent Workout object (see buildCustomWorkout). When
     * present, ActiveHuntScreen uses this in place of the canonical
     * workout for the session AND scales the BattleConfig's hp to match
     * (see scaleBattleConfigForCustomWorkout) — the canonical workout
     * behind `workoutId` is never touched.
     */
    customWorkout?: Workout;
    /**
     * Encounter Lock (Custom Hunt merge): the RAW structural value / reps
     * overrides behind `customWorkout` above — needed separately from
     * the already-built Workout object so a successful Encounter 1
     * result can snapshot them into WorkoutResult (restSecondsUsed/
     * structuralValueUsed/repsOverridesUsed — see encounterLock.ts) for
     * later encounters to reconstruct exactly. Only meaningful when
     * isCustomHunt is true; ignored entirely for a locked order>=2 Hunt,
     * which computes its own effective configuration from history
     * instead of trusting anything passed here — see ActiveHuntScreen.
     */
    customStructuralValue?: number;
    customRepsOverrides?: Record<string, number>;
  };
  HuntComplete: {
    monsterId: string;
    huntId: string;
    workoutId: string;
  };
  HuntFailed: {
    monsterId: string;
    huntId: string;
    workoutId: string;
    stoppedAtRound?: number;
    /**
     * Encounter Lock: distinguishes an abandoned Hunt (existing 'quit'
     * behavior, the default when omitted) from a physically-completed
     * Encounter 2/3 that didn't beat its locked target — same "no XP,
     * not saved, instant retry" handling, different copy. See
     * targetSeconds/elapsedSeconds below for that copy's numbers.
     */
    reason?: 'quit' | 'not_faster' | 'fewer_rounds';
    /** EMOM-style workouts only (reason 'fewer_rounds') — the rounds equivalent of elapsedSeconds/targetSeconds above. */
    roundsCompleted?: number;
    targetRounds?: number;
    targetSeconds?: number;
    elapsedSeconds?: number;
  };
  ExerciseLibrary: undefined;
  ExerciseDetail: { exerciseId: string };
};

export type ChronicleStackParamList = {
  Chronicle: undefined;
};

export type HunterStackParamList = {
  Hunter: undefined;
};

export type ForgeStackParamList = {
  Forge: undefined;
  Settings: undefined;
};

export type TimerStackParamList = {
  TimerHome: undefined;
  TimerBuilder: undefined;
  TimerRun: { presetId: string; isBuiltIn: boolean };
  /** Custom Workout Builder — id present when editing, absent when creating. */
  CustomWorkoutBuilder: { id?: string };
  CustomWorkoutSession: { customWorkoutId: string };
  Stopwatch: undefined;
};

export type MainTabsParamList = {
  HuntTab: NavigatorScreenParams<HuntStackParamList>;
  TimerTab: NavigatorScreenParams<TimerStackParamList>;
  ChronicleTab: NavigatorScreenParams<ChronicleStackParamList>;
  HunterTab: NavigatorScreenParams<HunterStackParamList>;
  ForgeTab: NavigatorScreenParams<ForgeStackParamList>;
};

export type RootStackParamList = {
  MainTabs: NavigatorScreenParams<MainTabsParamList>;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
