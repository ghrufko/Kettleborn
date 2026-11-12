import type { BattleConfig, Workout } from '../../src/models';
import { getWorkoutRoundExercises } from '../../src/utils/workoutPresentation';
import { resolveExerciseDamage } from './damageResolver';

/**
 * Boss HP ↔ workout objectives synchronization.
 *
 * The boss is defeated by finishing the workout — that is the game's
 * rule (Sprint 6: victory is bound to completing the prescribed
 * workout). HP is the visible measure of that progress. It used to be an
 * independent number: damage was each round's raw content damage plus
 * performance bonuses, and HP was a separately-authored total. The two
 * only matched when they happened to be tuned to each other:
 *
 *  - Behemoth's canonical three phases dealt 1,030 of its 1,930 HP;
 *    Mammoth's five rounds 3,050 of 3,273 — "defeated" with HP left.
 *  - Custom Hunt rescales HP by the workout's base damage, which leaves
 *    out the per-round performance bonuses, so a shorter custom hunt
 *    (e.g. Leviathan at 1–2 rounds) ended with HP still showing.
 *  - Several workouts overshoot and empty the bar a round early.
 *
 * The plan below fixes the relationship in one place, for every
 * monster: it simulates the full planned workout exactly as the reducer
 * scores it (every round clean, which is what the session reports) and
 * derives a scale factor HP / plannedDamage. Each round's damage is
 * scaled by it, so relative pacing — bigger rounds hit harder, bonuses
 * still fire — is unchanged, the bar empties in step with the work, the
 * final objective deals exactly the HP that remains, and no earlier
 * round can bring HP to 0.
 *
 * Open-ended EMOM workouts (no final round: The Breaking) have no
 * planned total, so they keep their raw damage exactly as before.
 */
export interface BattlePlan {
  /** Rounds that make up the workout's objectives. The final one defeats the boss. */
  objectiveRounds: number;
  /** HP / planned total damage — multiplies every round's raw damage. */
  scale: number;
}

export function isOpenEndedWorkout(workout: Workout): boolean {
  return !!workout.emomSeconds && workout.emomMode !== 'fixed';
}

/** Raw (unscaled) damage of one fully-clean round, as the reducer scores it. */
export function rawRoundDamage(
  workout: Workout,
  config: BattleConfig,
  round: number,
  cleanStreakAfter: number
): number {
  const exerciseDamage =
    getWorkoutRoundExercises(workout, round).reduce(
      (sum, exercise) => sum + resolveExerciseDamage(exercise, exercise.targetReps ?? 1),
      0
    ) * config.damageMultiplier;
  const bonuses = config.performanceBonuses;
  const relentless = cleanStreakAfter % bonuses.relentlessAssaultStreak === 0 ? bonuses.relentlessAssaultDamage : 0;
  return Math.round(exerciseDamage + workout.roundBonusDamage + bonuses.perfectExecutionDamage + relentless);
}

export function getBattlePlan(workout: Workout, config: BattleConfig): BattlePlan | null {
  if (isOpenEndedWorkout(workout) || workout.rounds < 1 || config.hp <= 0) {
    return null;
  }
  let planned = 0;
  for (let round = 1; round <= workout.rounds; round += 1) {
    planned += rawRoundDamage(workout, config, round, round);
  }
  if (planned <= 0) {
    return null;
  }
  return { objectiveRounds: workout.rounds, scale: config.hp / planned };
}
