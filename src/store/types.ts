import { User, Settings, Chronicle, MonsterProgress, WorkoutResult, Equipment, TimerPreset, TimerResult, TimerRound, CustomHuntPreset, Workout, CustomWorkout, CustomWorkoutExercise, CustomWorkoutResult, StopwatchResult, Achievement, ExtraExerciseSet } from '../models';
import { HuntRank } from '../utils/huntRank';
import { XPBreakdown } from '../../engines/progress/progressionEngine';
import { ExerciseStats, WeaknessProfile } from '../utils/exerciseStats';
import { RoundLap } from '../../engines/session/useWorkoutSession';
import { ExerciseBreakdownEntry } from '../utils/exerciseBreakdown';
import { AppAuthUser, AuthFailure, AuthResult, SignUpResult } from '../services/supabase/auth';

export interface UserSlice {
  user: User | null;
  initializeUser: () => Promise<void>;
}

/**
 * Phase 2.2 — cloud account state. Deliberately separate from UserSlice
 * (the local, always-present `User` row) and from every workout/campaign
 * slice — this is remote identity only, never a substitute for local
 * progress. See supabase/PHASE_2_1_AUTH_ARCHITECTURE.md §9 for the design
 * rationale and supabase/PHASE_2_2_IMPLEMENTATION.md for what's actually
 * wired up.
 *
 * Status is a single closed union, not separate booleans, specifically so
 * "signed in" and "signed out" (or "hydrating" and "signed in") can never
 * both be true at once — the invalid states simply don't have a
 * representation.
 */
export type AuthStatus =
  | 'hydrating'
  | 'unavailable'
  | 'signed_out'
  | 'signing_in'
  | 'signing_up'
  | 'signing_out'
  | 'signed_in';

export interface AuthSlice {
  authStatus: AuthStatus;
  authUser: AppAuthUser | null;
  /** The most recent recoverable failure, or null. Cleared by clearAuthError() or the start of a new attempt. */
  authError: AuthFailure | null;
  /**
   * Phase 2.4: true from the moment the `kettleborn://reset-password`
   * deep link establishes a recovery session (GoTrue's `PASSWORD_RECOVERY`
   * event) until the new password is set or the flow is cancelled.
   * Deliberately separate from `authStatus` — the user IS signed in
   * during recovery (a real session exists), but the app must show
   * UpdatePasswordScreen instead of normal navigation, which a boolean
   * flag App.tsx checks expresses more directly than overloading
   * authStatus with a state that isn't really about sign-in/out.
   */
  passwordRecoveryPending: boolean;
  /**
   * Runs once at bootstrap: checks for an existing session and subscribes
   * to future auth-state changes. Never throws, never blocks local
   * startup — see store/bootstrap.ts. Safe to call more than once; a
   * second call is a no-op if a listener is already registered.
   */
  initializeAuth: () => Promise<void>;
  /** Called from App.tsx's deep-link handler with the `code` query param from `kettleborn://reset-password?code=...`. */
  handlePasswordRecoveryLink: (code: string) => Promise<AuthResult<AppAuthUser>>;
  /**
   * Called from App.tsx's deep-link handler with the `code` query param
   * from `kettleborn://confirm-email?code=...` (the signup-confirmation
   * email's link). Unlike handlePasswordRecoveryLink, this never sets
   * passwordRecoveryPending — GoTrue fires a plain SIGNED_IN event (not
   * PASSWORD_RECOVERY) for this exchange, so the existing
   * onAuthStateChange listener already routes it to normal signed-in
   * state on its own; this action exists so the deep link resolves even
   * faster than waiting on that listener, same reasoning as
   * handlePasswordRecoveryLink setting state immediately too.
   */
  handleEmailConfirmationLink: (code: string) => Promise<AuthResult<AppAuthUser>>;
  /** Sets the new password and clears passwordRecoveryPending on success — the failure path leaves it true so the user can retry. */
  completePasswordRecovery: (newPassword: string) => Promise<AuthResult<void>>;
  /** Clears passwordRecoveryPending without changing the password — e.g. the user backs out of UpdatePasswordScreen. Does not sign out; the recovery session is still a real session. */
  cancelPasswordRecovery: () => void;
  authSignUp: (email: string, password: string) => Promise<AuthResult<SignUpResult>>;
  authSignIn: (email: string, password: string) => Promise<AuthResult<AppAuthUser>>;
  authSignOut: () => Promise<AuthResult<void>>;
  clearAuthError: () => void;
}

export interface SettingsSlice {
  settings: Settings | null;
  equipment: Equipment[];
  initializeSettings: () => Promise<void>;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
  loadEquipment: () => Promise<void>;
  /**
   * Phase 2.6: creates (when `id` is omitted) or updates (when present)
   * one kettlebell. The Forge screen is the only caller today — this is
   * deliberately generic enough to cover `type: 'other'` equipment too,
   * even though no current screen creates that type yet.
   */
  saveEquipment: (input: {
    id?: string;
    type: 'kettlebell' | 'other';
    weightKg: number;
    label: string;
  }) => Promise<void>;
  deleteEquipment: (id: string) => Promise<void>;
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
   * rebuilds and publishes fresh new-player rows. Does not
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
  /** Optional post-Hunt exercises the player added — same value as the persisted WorkoutResult.extraSets, surfaced here so HuntCompleteScreen can show them without a separate read. Empty/absent means none were added. */
  extraSets: ExtraExerciseSet[] | null;
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
    /**
     * Optional post-Hunt exercises the player added after the main timer
     * stopped, before confirming the result (ActiveHuntScreen's "Workout
     * Complete" card). Stored as-is on the result; never read by any
     * rank/XP/duration/achievement calculation above it in completeHunt.
     * Omitted/undefined (or an empty array) means no extras — identical
     * to every pre-existing call site, which still works unchanged.
     */
    extraSets?: ExtraExerciseSet[];
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

/**
 * Phase 2.11: persistent achievement unlocks, backed by the `achievement`
 * table (migration16). `achievements` is loaded once at bootstrap and
 * kept in sync in-memory on every unlock — the Achievements screen reads
 * it directly via a selector, no per-screen fetch needed.
 */
export interface AchievementSlice {
  achievements: Achievement[];
  loadAchievements: () => Promise<void>;
  /**
   * Persists every milestone type in `types` that isn't already unlocked
   * for this user — idempotent (AchievementRepository.unlock is a no-op
   * for an already-unlocked type, enforced by the table's own PRIMARY
   * KEY), safe to call with a type that's already unlocked, and safe to
   * call with duplicates in the same array. Called from completeHunt
   * (workoutSlice.ts) with the result of
   * `detectAllQualifyingMilestones` — never invents an unlock from
   * anywhere else.
   */
  unlockAchievements: (types: Achievement['milestoneType'][], unlockedAt: string) => Promise<void>;
}

export type AppStore = UserSlice &
  SettingsSlice &
  ChronicleSlice &
  ProgressSlice &
  WorkoutSlice &
  TimerSlice &
  CustomHuntSlice &
  CustomWorkoutSlice &
  StopwatchSlice &
  AchievementSlice &
  AuthSlice;
