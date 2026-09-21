import { Exercise } from '../../src/models';

export type DamageSource = 'round';

export interface DamageEvent {
  amount: number;
  source: DamageSource;
}

export type PerformanceBonusType =
  | 'perfect_execution'
  | 'relentless_assault'
  | 'personal_record'
  | 'fast_finish';

export interface PerformanceBonusEvent {
  type: PerformanceBonusType;
  amount: number;
}

/**
 * Structured events the outside world (Active Hunt screen, driven by
 * Session Engine's onRoundComplete/onWorkoutComplete callbacks) dispatches
 * into the Battle Engine. This is the entire surface Battle Engine reasons
 * about — no session internals.
 *
 * Sprint 21: EXERCISE_COMPLETED was removed — there's no more per-exercise
 * interaction to react to. ROUND_COMPLETED now carries every exercise in
 * the round plus its reps/skipped state, computed once when the whole
 * round finishes rather than dispatched once per exercise. Every exercise
 * is currently reported with repsCompleted = its full targetReps and
 * skipped = false (the "assume full completion" rule from the sprint
 * brief) — but the shape already supports a future partial-completion or
 * skipped-exercise flow reporting different values here, with no change
 * needed to this type or the reducer that consumes it.
 */
export type BattleAction =
  | {
      type: 'ROUND_COMPLETED';
      round: number;
      durationSeconds: number;
      exercises: { exercise: Exercise; repsCompleted: number; skipped: boolean }[];
    }
  | { type: 'WORKOUT_COMPLETED'; elapsedSeconds: number; previousBestSeconds: number | null };

export interface BattleState {
  maxHP: number;
  currentHP: number;
  phaseIndex: number;
  totalPhases: number;
  lastDamage: DamageEvent | null;
  lastBonuses: PerformanceBonusEvent[];
  /** Consecutive clean rounds (Sprint 21 — was consecutive clean exercises before the interaction redesign). */
  cleanStreak: number;
  isDefeated: boolean;
  /**
   * Running total of every point of damage dealt this fight (uncapped by
   * maxHP), so the Victory screen can show a true "Damage Dealt" figure
   * even on an overkill final hit. currentHP/maxHP stays the clamped
   * display value used everywhere else.
   */
  totalDamageDealt: number;
  /** Count of round completions where a performance bonus fired. */
  criticalHitCount: number;
}
