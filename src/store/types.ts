import { User, Settings, Chronicle, MonsterProgress, WorkoutResult, Equipment, TimerPreset, TimerResult, TimerRound, CustomHuntPreset, Workout, CustomWorkout, CustomWorkoutExercise, CustomWorkoutResult, StopwatchResult } from '../models';
import { HuntRank } from '../utils/huntRank';
import { XPBreakdown } from '../../engines/progress/progressionEngine';
import { ExerciseStats, WeaknessProfile } from '../utils/exerciseStats';
import { RoundLap } from '../../engines/session/useWorkoutSession';
import { ExerciseBreakdownEntry } from '../utils/exerciseBreakdown';

export interface UserSlice {
  user: User | null;
  initializeUser: () => Promise<void>;
}

export interface SettingsSlice {
  settings: Settings | null;
  equipment: Equipment[];
  initializeSettings: () => Promise<void>;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
  loadEquipment: () => Promise<void>;
}

export interface ChronicleSlice {
  chronicle: Chronicle | null;
  initializeChronicle: () => Promise<void>;
}

export interface ProgressSlice {
  monsterProgress: Record<string, MonsterProgress>;
  loadAllMonsterProgress: () => Promise<void>;
  /**
   * Campaign Reset (Settings): wipes campaign/monster progress, Personal
   * Best-bearing workout history, and lifetime Chronicle/XP records, then
   * rebuilds fresh new-player rows via loadAllMonsterProgress. Does not
   * touch app/user settings, exercise library, or campaign content.
   */
  resetCampaignProgress: () => Promise<void>;
  /**
   * Encounter Lock — Reset Progress (per-monster, Monster Detail screen):
   * wipes ONLY this monster's Encounter 1/2/3 results/baseline/target and
   * huntsCompleted/defeated flags, as if it had never been fought. Does
   * NOT touch: other monsters' progress/results, the lifetime Chronicle
   * aggregate row (streak/XP/volume totals — deliberately left as-is, see
   * completion report), Custom Workouts, Timer data, or campaign_progress
   * (unused for gating — see campaignState.ts). Campaign-level unlock
   * state CAN change as a natural consequence (e.g. a final boss that
   * requires "every other monster defeated" re-locks) because that
   * gating already reads MonsterProgress.defeated live — an existing,
   * explicit architectural tie, not something this action does itself.
   */
  resetMonsterProgress: (monsterId: string) => Promise<void>;
}

/**
 * Everything the Victory screen and level-up popup need, computed once in
 * completeHunt (the single source of truth for XP/rank/PR) rather than
 * re-derived per-screen. Ephemeral — not persisted, cleared on the next hunt.
 */
export interface HuntSummary {
  rank: HuntRank;
  xp: XPBreakdown;
  previousXP: number;
  newXP: number;
  previousLevel: number;
  newLevel: number;
  leveledUp: boolean;
  title: string;
  previousTitle: string;
  titleChanged: boolean;
  isPersonalRecord: boolean;
  isFirstClear: boolean;
  totalDamageDealt: number;
  criticalHits: number;
  totalRounds: number;
  totalExercises: number;
  completionPercentage: number;
  volumeKg: number;
  weightKg: number;
  /** Kettlebell weight audit: the second bell's real weight when gearCount is 2 — independent from weightKg. null for a single-bell Hunt. */
  weightBKg: number | null;
  gearCount: 1 | 2;
  elapsedSeconds: number;
  /**
   * Sprint 23: only present for workouts that report a real per-rung/round
   * sequence worth showing on Victory (currently just the Minotaur ladder,
   * `labyrinth-ladder`, via its `stepLabel: "Rung"` content flag). In
   * chronological completion order — reused as-is from
   * `useWorkoutSession`'s `laps`, so a repeated round number (e.g. rung 1
   * appearing twice) is disambiguated by its array position, not stored
   * separately. Transient like the rest of `HuntSummary` — not persisted
   * to `WorkoutResult`/SQLite; lost once the player leaves Victory. See
   * KettleBorn_Minotaur_Ladder_Plan.md §3/§7 for the persistence tradeoff.
   */
  rungLaps?: RoundLap[];
  /**
   * Task 6 fix (real-device report: Custom Hunt ladder at 5 steps showed
   * canonical Minotaur's ~100-rep total instead of the actual reps
   * performed). Computed once, inside completeHunt, from whichever
   * Workout the session actually ran against — customWorkout when a
   * structural control was used, canonical otherwise — the same `workout`
   * variable totalRounds/totalExercises/volumeKg above already use.
   * HuntCompleteScreen reads this directly instead of independently
   * re-fetching contentEngine.getWorkout(workoutId), which is exactly
   * what was silently re-deriving reps from the CANONICAL structure and
   * ignoring any Custom Hunt structural change.
   */
  exerciseBreakdown: ExerciseBreakdownEntry[];
  /**
   * Task 7: "did I improve" comparison against the most recent prior
   * result for this SAME huntId with matching weight/gear/custom-mode
   * (see completeHunt for the exact match rule and its documented
   * limitation). null when no comparable prior result exists — the UI
   * must not invent a comparison in that case.
   */
  comparablePreviousSeconds: number | null;
  isBetterThanComparable: boolean | null;
  /** Post-Hunt RPE (Task: RPE) targets this row via WorkoutRepository.updateRPE — same id as the persisted WorkoutResult, not transient. */
  resultId: string;
  /**
   * Encounter Lock: null for a Hunt the lock doesn't govern (none exist
   * today — see isEncounterLocked). 'baseline-established' only on
   * Encounter 1's true first-ever clear. 'target-beaten' for a
   * successful Encounter 2/3 completion — reaching completeHunt at all
   * for order >= 2 already means the target was beaten (see the
   * pre-completeHunt gate in ActiveHuntScreen), so this is a display
   * flag confirming that, not a fresh check.
   */
  encounterOutcome: 'baseline-established' | 'target-beaten' | null;
  /** The time (seconds) this result had to beat, if any — the same value the pre-completion gate compared against. null for Encounter 1 or an unlocked Hunt. */
  encounterTargetSeconds: number | null;
  /** Whether THIS result used Custom Hunt — surfaced so Victory can label a baseline/target correctly ("Custom Baseline Established" vs "Baseline Established"). */
  isCustomHunt: boolean;
}

export interface HunterSummary {
  favoriteMonsterId: string | null;
  favoriteWorkoutId: string | null;
  recentResult: WorkoutResult | null;
  weightPRKg: number | null;
  fastestHuntSeconds: number | null;
}

export interface WorkoutSlice {
  lastResult: WorkoutResult | null;
  lastHuntSummary: HuntSummary | null;
  completeHunt: (params: {
    monsterId: string;
    huntId: string;
    workoutId: string;
    elapsedSeconds: number;
    totalDamageDealt: number;
    criticalHits: number;
    /** Player-entered weight for this specific Hunt; falls back to workout.gearWeightKg when omitted. */
    actualWeightKg?: number;
    /** Kettlebell weight audit: the second bell's real weight (may differ from actualWeightKg — 16kg + 18kg is valid) when actualGearCount is 2. Falls back to actualWeightKg when omitted, matching every pre-existing call site's "both bells at the one weight entered" behavior. */
    actualWeightBKg?: number;
    /** Custom Hunt: player-chosen gear count; falls back to workout.gearCount (canonical) when omitted — same fallback shape as actualWeightKg. */
    actualGearCount?: number;
    /** Custom Hunt: true when this Hunt ran with a CustomHuntPreset rather than canonical parameters. Defaults false. */
    isCustomHunt?: boolean;
    /** Sprint 23: per-round/rung lap times, only meaningful for `stepLabel: "Rung"` workouts. Transient — see HuntSummary.rungLaps. */
    rungLaps?: RoundLap[];
    /**
     * Task 2: only present when a structural control (rounds/max rung/
     * cycles) was changed away from canonical this session. When set,
     * rank/XP-workload/reps-breakdown are computed against THIS Workout
     * instead of the canonical one fetched by workoutId — and the result
     * is deliberately never PR/first-clear eligible (protects the
     * canonical workoutId's PR pool from being compared against a
     * different amount of work). The persisted WorkoutResult.workoutId
     * is always the canonical id, unchanged — this never affects preset
     * lookup, Chronicle grouping, or Level 1/2/3 sharing.
     */
    customWorkout?: Workout;
    /**
     * Encounter Lock (Custom Hunt merge): the EXACT rest/structural-
     * value/reps-overrides actually used this session, snapshotted into
     * WorkoutResult so a later locked encounter can reconstruct this
     * exact configuration without depending on CustomHuntPreset (which
     * can change) — see encounterLock.ts's reconstructEncounterConfig.
     * All omitted/undefined for a canonical (non-Custom-Hunt) result,
     * which needs none of this (always re-derivable from content).
     */
    restSecondsUsed?: number;
    structuralValueUsed?: number;
    repsOverridesUsed?: Record<string, number>;
    /**
     * Encounter Lock: the time (seconds) this attempt needed to beat,
     * exactly as computed by the caller's pre-completion gate (see
     * ActiveHuntScreen) — completeHunt is only ever reached for order>=2
     * once that gate already confirmed success, so this is passed
     * through for HuntSummary display (encounterTargetSeconds), not
     * re-checked. Omitted/undefined for Encounter 1 or an unlocked Hunt.
     */
    encounterTargetSeconds?: number | null;
  }) => Promise<WorkoutResult>;
  /** Encounter Lock: all results for one specific Hunt (encounter) — see WorkoutRepository.getResultsForHunt for why this differs from getBestTimeSeconds/getBestResult (workoutId-scoped, shared across Level 1/2/3). */
  getResultsForHunt: (huntId: string) => Promise<WorkoutResult[]>;
  getBestTimeSeconds: (workoutId: string) => Promise<number | null>;
  /**
   * Task 4 (Personal Best weight): the full WorkoutResult row that holds
   * the best (lowest) time for this workoutId — same "lowest time wins"
   * determination as getBestTimeSeconds, just returning the whole row so
   * a caller can also read the weight actually used for that specific
   * result, rather than only the time. Does not change how PR is
   * determined; a display-only sibling to getBestTimeSeconds, which stays
   * untouched for the actual PR-detection code path in ActiveHuntScreen.
   */
  getBestResult: (workoutId: string) => Promise<WorkoutResult | null>;
  getAllResults: () => Promise<WorkoutResult[]>;
  /** Post-Hunt RPE (1 Easy – 4 Brutal), set after the result already exists — see WorkoutResult.rpe. */
  setResultRPE: (resultId: string, rpe: number) => Promise<void>;
  /** Task 10: mirrors setResultRPE — see WorkoutRepository.updateNotes. */
  setResultNotes: (resultId: string, notes: string | null) => Promise<void>;
  getHunterSummary: () => Promise<HunterSummary>;
  getAllExerciseStats: () => Promise<ExerciseStats[]>;
  getExerciseStatsById: (exerciseId: string) => Promise<ExerciseStats | null>;
  getWeaknessProfile: () => Promise<WeaknessProfile>;
}

export interface TimerSlice {
  userTimerPresets: TimerPreset[];
  lastTimerResult: TimerResult | null;
  loadTimerPresets: () => Promise<void>;
  saveTimerPreset: (
    name: string,
    rounds: TimerRound[],
    options?: { linkedWorkoutId?: string; randomizeExercises?: boolean }
  ) => Promise<void>;
  deleteTimerPreset: (presetId: string) => Promise<void>;
  saveTimerResult: (params: {
    presetId: string;
    presetName: string;
    totalDurationSeconds: number;
    weightKg: number | null;
  }) => Promise<TimerResult>;
}

/**
 * Custom Hunt: presets are looked up per-workoutId on demand (same shape
 * as WorkoutSlice's getBestTimeSeconds/getBestResult — no cached array of
 * "all presets" in store state, since Hunt Overview only ever needs the
 * one for its own workout).
 */
export interface CustomHuntSlice {
  getCustomHuntPreset: (workoutId: string) => Promise<CustomHuntPreset | null>;
  saveCustomHuntPreset: (preset: {
    workoutId: string;
    weightKg: number;
    /** Kettlebell weight audit: see CustomHuntPreset.weightBKg. */
    weightBKg?: number | null;
    gearCount: 1 | 2;
    restSeconds: number;
    /** Task 2: see CustomHuntPreset.customStructureValue for what this means per workout. */
    customStructureValue?: number | null;
    /** See CustomHuntPreset.repsOverrides. */
    repsOverrides?: Record<string, number> | null;
  }) => Promise<void>;
}

/**
 * Custom Workout Builder — deliberately its own slice/state shape,
 * separate from CustomHuntSlice: these workouts have no workoutId (no
 * canonical Workout backs them) and no per-Level inheritance concept.
 * userCustomWorkouts is loaded once at bootstrap (mirrors
 * userTimerPresets in TimerSlice) since the whole list is small and
 * cheap, unlike WorkoutSlice's per-workoutId on-demand lookups.
 */
export interface CustomWorkoutSlice {
  userCustomWorkouts: CustomWorkout[];
  loadCustomWorkouts: () => Promise<void>;
  saveCustomWorkout: (input: {
    /** Present when editing an existing workout; omitted to create a new one. */
    id?: string;
    name: string;
    exercises: CustomWorkoutExercise[];
    weightKg: number;
    /** Kettlebell weight audit: see CustomWorkout.weightBKg. */
    weightBKg?: number | null;
    gearCount: 1 | 2;
    rounds: number;
    restSeconds: number;
  }) => Promise<CustomWorkout>;
  deleteCustomWorkout: (id: string) => Promise<void>;
  saveCustomWorkoutResult: (params: {
    customWorkoutId: string;
    elapsedSeconds: number;
    weightKg: number;
    /** Kettlebell weight audit: see CustomWorkoutResult.weightBKg. */
    weightBKg?: number | null;
    gearCount: 1 | 2;
    /**
     * Journal integration (§9): a snapshot of this run, taken at
     * completion time so it survives later edits/deletion of the source
     * CustomWorkout — see CustomWorkoutResult's own model comment. All
     * optional so an older call site (there are none left, but the type
     * doesn't need to force it) still compiles.
     */
    workoutName?: string;
    rounds?: number;
    restSeconds?: number;
    totalReps?: number;
    exerciseBreakdown?: { name: string; totalReps: number }[];
  }) => Promise<CustomWorkoutResult>;
  /** Journal integration (§9): every Custom Workout result for this user, for the Journal/Statistics "Training Sessions" list — see ChronicleScreen. Never affects monster XP/rank/progression; this is purely a read. */
  getAllCustomWorkoutResults: () => Promise<CustomWorkoutResult[]>;
}

/**
 * Stopwatch (Timer tab, new mode): deliberately its own slice/table, not
 * layered onto CustomWorkoutSlice — a Stopwatch session has no linked
 * CustomWorkout/exercises/weight, just elapsed time + laps + an optional
 * note. Never touches Battle Engine/XP/Hunt Rank/monster progression.
 */
export interface StopwatchSlice {
  saveStopwatchResult: (params: {
    elapsedSeconds: number;
    laps: number[];
    note?: string | null;
  }) => Promise<StopwatchResult>;
  /** Every Stopwatch result for this user, for the Chronicle "Stopwatch Sessions" section. Purely a read — never affects XP/rank/progression. */
  getAllStopwatchResults: () => Promise<StopwatchResult[]>;
}

export type AppStore = UserSlice &
  SettingsSlice &
  ChronicleSlice &
  ProgressSlice &
  WorkoutSlice &
  TimerSlice &
  CustomHuntSlice &
  CustomWorkoutSlice &
  StopwatchSlice;
