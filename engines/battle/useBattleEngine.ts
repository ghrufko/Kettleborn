import { useMemo, useReducer } from 'react';
import type { BattleConfig, Workout } from '../../src/models';
import { resolveExerciseDamage } from './damageResolver';
import { getBattlePlan } from './battlePlan';
import type { BattleAction, BattleState, DamageEvent, PerformanceBonusEvent } from './types';

const PHASE_LABELS = ['Engaged', 'Staggering', 'Wounded', 'Weakened', 'Critical'];

export function phaseLabel(phaseIndex: number): string {
  return PHASE_LABELS[phaseIndex] ?? `Phase ${phaseIndex + 1}`;
}

function computePhaseIndex(hpPercent: number, thresholds: number[]): number {
  let phase = 0;
  for (const threshold of thresholds) {
    if (hpPercent <= threshold) {
      phase += 1;
    }
  }
  return phase;
}

function deriveHP(state: BattleState, cumulativeDamage: number, config: BattleConfig): BattleState {
  const currentHP = Math.max(0, config.hp - cumulativeDamage);
  const hpPercent = config.hp > 0 ? (currentHP / config.hp) * 100 : 0;
  return {
    ...state,
    currentHP,
    phaseIndex: computePhaseIndex(hpPercent, config.phases),
    isDefeated: currentHP <= 0,
  };
}

export function createInitialState(config: BattleConfig): BattleState {
  return {
    maxHP: config.hp,
    currentHP: config.hp,
    phaseIndex: 0,
    totalPhases: config.phases.length + 1,
    lastDamage: null,
    lastBonuses: [],
    cleanStreak: 0,
    isDefeated: false,
    totalDamageDealt: 0,
    criticalHitCount: 0,
  };
}

export function makeReducer(config: BattleConfig, workout: Workout) {
  // See battlePlan.ts: null for an open-ended EMOM workout, which keeps
  // its raw, unscaled damage.
  const plan = getBattlePlan(workout, config);
  return function battleReducer(state: BattleState, action: BattleAction): BattleState {
    switch (action.type) {
      case 'ROUND_COMPLETED': {
        const bonuses = config.performanceBonuses;

        // Sum every exercise's prescribed damage for the round — the same
        // resolveExerciseDamage used before Sprint 21, just called once
        // per exercise in the round instead of once per tap. Skipped
        // exercises (not possible yet, but the field exists) contribute
        // nothing.
        let exerciseDamage = 0;
        action.exercises.forEach(({ exercise, repsCompleted, skipped }) => {
          if (skipped) {
            return;
          }
          exerciseDamage += resolveExerciseDamage(exercise, repsCompleted);
        });
        exerciseDamage *= config.damageMultiplier;

        const roundBonus = workout.roundBonusDamage;

        // "Clean" used to mean "this exercise wasn't paused"; it now means
        // "this round had no skipped exercises and every exercise hit its
        // full prescribed reps" — always true today under the
        // assume-full-completion rule, but written as a real check (not a
        // hardcoded true) so a future partial-completion round correctly
        // breaks the streak instead of silently staying "clean".
        const roundWasClean = action.exercises.every(
          (e) => !e.skipped && e.repsCompleted >= (e.exercise.targetReps ?? 1)
        );

        const fired: PerformanceBonusEvent[] = [];
        let bonusDamage = 0;
        let nextStreak = state.cleanStreak;

        if (roundWasClean) {
          bonusDamage += bonuses.perfectExecutionDamage;
          fired.push({ type: 'perfect_execution', amount: bonuses.perfectExecutionDamage });

          nextStreak = state.cleanStreak + 1;
          if (nextStreak % bonuses.relentlessAssaultStreak === 0) {
            bonusDamage += bonuses.relentlessAssaultDamage;
            fired.push({ type: 'relentless_assault', amount: bonuses.relentlessAssaultDamage });
          }
        } else {
          nextStreak = 0;
        }

        const rawDamage = Math.round(exerciseDamage + roundBonus + bonusDamage);
        let totalDamage = rawDamage;
        let shownBonuses = fired;
        if (plan) {
          if (action.round >= plan.objectiveRounds) {
            // The final objective: the boss falls with exactly the HP it
            // has left — never short of it (HP left on a "defeated"
            // boss), and never more than the plan's own scaled share.
            totalDamage = Math.max(state.currentHP, Math.round(rawDamage * plan.scale));
          } else {
            // Every earlier round: scaled to the plan, and never lethal —
            // the boss can't fall while objectives remain.
            totalDamage = Math.min(Math.round(rawDamage * plan.scale), Math.max(0, state.currentHP - 1));
          }
          shownBonuses = fired.map((bonus) => ({ ...bonus, amount: Math.round(bonus.amount * plan.scale) }));
        }
        const lastDamage: DamageEvent = { amount: totalDamage, source: 'round' };

        return deriveHP(
          {
            ...state,
            lastDamage,
            lastBonuses: shownBonuses,
            cleanStreak: nextStreak,
            totalDamageDealt: state.totalDamageDealt + totalDamage,
            criticalHitCount: state.criticalHitCount + (fired.length > 0 ? 1 : 0),
          },
          config.hp - state.currentHP + totalDamage,
          config
        );
      }

      case 'WORKOUT_COMPLETED': {
        const bonuses = config.performanceBonuses;
        const fired: PerformanceBonusEvent[] = [];
        let bonusDamage = 0;

        if (action.elapsedSeconds <= workout.targetTimeSeconds) {
          bonusDamage += bonuses.fastFinishDamage;
          fired.push({ type: 'fast_finish', amount: bonuses.fastFinishDamage });
        }
        if (
          action.previousBestSeconds !== null &&
          action.elapsedSeconds < action.previousBestSeconds
        ) {
          bonusDamage += bonuses.personalRecordDamage;
          fired.push({ type: 'personal_record', amount: bonuses.personalRecordDamage });
        }

        // Every objective is done, so the boss is down. The final round
        // already took HP to 0 under the plan; this only guarantees it
        // (e.g. a session that reported fewer rounds than planned).
        const remainingHP = plan ? state.currentHP : 0;

        if (fired.length === 0 && remainingHP === 0) {
          return state;
        }

        return deriveHP(
          {
            ...state,
            lastBonuses: fired.length > 0 ? fired : state.lastBonuses,
            totalDamageDealt: state.totalDamageDealt + bonusDamage + remainingHP,
          },
          config.hp - state.currentHP + bonusDamage + remainingHP,
          config
        );
      }

      default:
        return state;
    }
  };
}

export function useBattleEngine(config: BattleConfig, workout: Workout) {
  const reducer = useMemo(() => makeReducer(config, workout), [config, workout]);
  const [state, dispatch] = useReducer(reducer, config, createInitialState);
  return { ...state, dispatch };
}
