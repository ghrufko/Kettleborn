export type IntervalType = 'timed' | 'reps' | 'open' | 'random';

/**
 * Reserved for future auto-generated preset modes (EMOM/AMRAP/For Time/
 * Intervals/Random/Custom Scripts) that would build a preset's rounds from
 * a handful of parameters instead of manual round-by-round authoring in
 * the Timer Builder. Not read by the Timer Engine yet — every preset today
 * (built-in and user-authored) is 'custom', assembled by hand or by the
 * existing Timer Builder UI. Same reserved-slot pattern as BossPersonality
 * in src/models/Content.ts.
 */
export type TimerMode = 'custom' | 'emom' | 'amrap' | 'for_time' | 'intervals' | 'random' | 'custom_script';

export interface TimerInterval {
  id: string;
  label: string;
  type: IntervalType;
  /** Required for 'timed'. */
  durationSeconds?: number;
  /** Required for 'random' — a duration is rolled once when the interval starts. */
  minSeconds?: number;
  maxSeconds?: number;
  /** Optional, display-only for 'reps' intervals. */
  reps?: number;
  /** If true, the countdown/step does not begin until the user taps Continue. */
  requiresManualStart?: boolean;
  /** Which sound cue plays when this interval begins. */
  startSound?: 'start' | 'rest' | 'nextRound' | 'none';
  /** If true and the preset links a workout, this interval's label is replaced at runtime with an exercise name from that workout. */
  isExerciseSlot?: boolean;
}

export interface TimerRound {
  id: string;
  name: string;
  intervals: TimerInterval[];
}

export interface TimerPreset {
  id: string;
  name: string;
  rounds: TimerRound[];
  isBuiltIn: boolean;
  /** Optional — reuses an existing Hunt workout's exercise list for isExerciseSlot interval labels. */
  linkedWorkoutId?: string;
  /** If true, the linked workout's exercises are shuffled once per session. */
  randomizeExercises?: boolean;
  /** Defaults to 'custom' when absent — see TimerMode. */
  mode?: TimerMode;
}

export interface TimerResult {
  id: string;
  userId: string;
  presetId: string;
  presetName: string;
  totalDurationSeconds: number;
  completedAt: string;
  weightKg: number | null;
  appVersion: string;
}
