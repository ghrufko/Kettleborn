import { DifficultyTier } from '../../src/models';
import { HuntRank } from '../../src/utils/huntRank';

/**
 * Centralized, tunable XP/level config. Nothing outside this file should
 * hardcode an XP number or a level threshold — Sprint 13 requires the
 * system to "already support balancing", so every knob lives here.
 */
export const PROGRESSION_CONFIG = {
  baseXP: 100,
  /** XP added per difficulty tier above 1 (tier 1 gets no bonus). */
  difficultyBonusPerTier: 20,
  /** XP per kg of gear used, per bell (a 2-bell hunt counts each bell). */
  xpPerKgPerBell: 1.5,
  /** Flat XP by the rank the hunt was finished at. */
  rankBonus: { S: 80, A: 50, B: 25, C: 0 } as Record<HuntRank, number>,
  personalRecordBonus: 40,
  firstClearBonus: 100,

  // --- Sprint 26 (XP Hybrid Model) ---
  /**
   * The floor/ceiling on how far `actualWeightKg` can move `weightBonus`
   * away from the workout's own recommended weight (`workout.gearWeightKg`).
   * Going heavier than recommended still helps, but only up to +50%; going
   * lighter never drops the weight contribution below 50%. This is what
   * stops a self-reported weight from scaling XP unboundedly — the bonus
   * is always anchored to content's recommended weight, never to whatever
   * number the player typed on its own.
   */
  weightRatioMin: 0.5,
  weightRatioMax: 1.5,
  /** Flat XP per prescribed rep toward the new workload term, capped below. */
  workloadXpPerRep: 0.3,
  /**
   * Ceiling on how many reps count toward `workloadBonus`. Headroom above
   * the current highest-volume workout (Behemoth, 270 reps), not a limit
   * anyone hits today — keeps the term bounded if a future workout has an
   * even larger prescribed volume.
   */
  workloadRepCap: 300,
  /**
   * Repeat-farm protection: the first N clears of a given `workoutId` get
   * full XP (this covers a monster's 3 canonical Encounters, which all
   * share one `workoutId` — that's real RPG progression, not farming).
   * From clear N+1 onward, only the `baseXP + workloadBonus` portion
   * decays — rank/weight/PR/first-clear bonuses are never reduced by
   * repetition, since those require genuine performance to earn.
   */
  repeatDecayGraceClears: 3,
  repeatDecayPerClear: 0.05,
  repeatDecayFloor: 0.4,

  /**
   * Level curve: XP required to go from `level` to `level + 1`. Simple
   * arithmetic growth (+50 per level) — produces the cumulative thresholds
   * 100 / 250 / 450 / 700 / 1000 / ... called out in the Sprint 13 brief.
   * MVP-simple by design; only this function needs to change to rebalance
   * the whole curve later.
   *
   * Sprint 26 note: deliberately UNCHANGED — this sprint redesigns XP
   * economy only. Changing the curve in the same sprint would make it
   * impossible to tell which change produced which effect on progression
   * speed, per the Sprint 26 brief.
   */
  xpToReachNextLevel(level: number): number {
    return 100 + (level - 1) * 50;
  },
} as const;

export interface XPBreakdown {
  baseXP: number;
  workloadBonus: number;
  /** 1.0 for the first `repeatDecayGraceClears` clears of this workoutId; decays below that. Informational — already folded into `baseXP` above. */
  repeatMultiplier: number;
  difficultyBonus: number;
  weightBonus: number;
  performanceBonus: number;
  personalRecordBonus: number;
  firstClearBonus: number;
  total: number;
}

export interface XPCalculationInput {
  difficulty: DifficultyTier;
  /** The weight the player actually entered on Hunt Brief (kg, per bell). */
  actualWeightKg: number;
  /** The workout's content-authored recommended weight (kg, per bell) — canonical, never player-supplied. */
  recommendedWeightKg: number;
  /** 1 or 2 bells — same gearCount concept `weightValueB`/`totalWeightKg` already used. */
  gearCount: number;
  /**
   * Total prescribed reps across the whole workout (every round/section,
   * every exercise) — sections+rounds aware. Callers should derive this
   * via the existing `getExerciseBreakdown` helper (sum its `totalReps`
   * across entries with weightKg=1/gearCount=1), not a new calculation —
   * that helper is already the correct, sections-and-rounds-aware source
   * of truth for "how many reps does this workout prescribe."
   */
  totalReps: number;
  /**
   * How many times this exact `workoutId` has already been completed
   * (i.e. `priorResults.length` from the existing history query) —
   * NOT a global attempt count. A monster's 3 Encounters share one
   * workoutId by design (see `repeatDecayGraceClears`), so this only
   * starts reducing XP once a specific workout is repeated beyond its
   * own real story arc.
   */
  priorClearsOfThisWorkout: number;
  rank: HuntRank;
  isPersonalRecord: boolean;
  isFirstClear: boolean;
}

/** attempt 1..repeatDecayGraceClears -> 1.0; beyond that, linear decay to a floor. Never zero. */
function getRepeatMultiplier(priorClears: number): number {
  const { repeatDecayGraceClears, repeatDecayPerClear, repeatDecayFloor } = PROGRESSION_CONFIG;
  const attempt = Math.max(0, priorClears) + 1;
  if (attempt <= repeatDecayGraceClears) {
    return 1;
  }
  const decays = attempt - repeatDecayGraceClears;
  return Math.max(repeatDecayFloor, 1 - decays * repeatDecayPerClear);
}

/**
 * The single place Hunt XP is computed. Every factor from the Sprint 13
 * brief (difficulty, weight, performance/rank, PR, first clear) is additive
 * on top of a flat base, matching the brief's worked example exactly.
 *
 * Sprint 26 (XP Hybrid Model) additions, all still purely additive:
 * - `weightBonus` is now anchored to `recommendedWeightKg`, not the raw
 *   `actualWeightKg` — the ratio between them is clamped to
 *   [weightRatioMin, weightRatioMax] before it can move the bonus at all,
 *   closing the "type a huge number" exploit without removing the ability
 *   to reward genuinely heavier training.
 * - `workloadBonus` is new — a small, capped, per-rep credit for the
 *   workout's real prescribed volume (sections+rounds aware via the
 *   caller-supplied `totalReps`).
 * - `baseXP + workloadBonus` (only those two terms) are scaled by a
 *   repeat-decay multiplier for workouts completed beyond their first
 *   `repeatDecayGraceClears` clears — rank/weight/PR/first-clear stay full
 *   value always, since those require real performance to earn.
 */
export function calculateHuntXP(input: XPCalculationInput): XPBreakdown {
  const {
    baseXP,
    difficultyBonusPerTier,
    xpPerKgPerBell,
    rankBonus,
    personalRecordBonus,
    firstClearBonus,
    weightRatioMin,
    weightRatioMax,
    workloadXpPerRep,
    workloadRepCap,
  } = PROGRESSION_CONFIG;

  const difficultyBonus = (input.difficulty - 1) * difficultyBonusPerTier;

  // Guard: a missing/zero recommendedWeightKg would make the ratio
  // Infinity/NaN — content should never omit this, but never trust a
  // single content field to keep XP from breaking. Falls back to a
  // neutral 1.0 ratio (full weightBonus at whatever the recommended
  // total would have been, i.e. 0 if recommendedWeightKg is genuinely 0).
  const safeActualWeightKg = Number.isFinite(input.actualWeightKg) && input.actualWeightKg > 0 ? input.actualWeightKg : input.recommendedWeightKg;
  const weightRatio =
    input.recommendedWeightKg > 0
      ? Math.max(weightRatioMin, Math.min(weightRatioMax, safeActualWeightKg / input.recommendedWeightKg))
      : 1;
  const recommendedTotalKg = Math.max(0, input.recommendedWeightKg) * Math.max(0, input.gearCount);
  const weightBonus = Math.round(recommendedTotalKg * xpPerKgPerBell * weightRatio);

  const safeTotalReps = Number.isFinite(input.totalReps) ? Math.max(0, input.totalReps) : 0;
  const workloadBonus = Math.round(Math.min(safeTotalReps, workloadRepCap) * workloadXpPerRep);

  const repeatMultiplier = getRepeatMultiplier(input.priorClearsOfThisWorkout);
  const repeatablePortion = Math.round((baseXP + workloadBonus) * repeatMultiplier);

  const performanceBonus = rankBonus[input.rank];
  const prBonus = input.isPersonalRecord ? personalRecordBonus : 0;
  const clearBonus = input.isFirstClear ? firstClearBonus : 0;

  const total = Math.round(repeatablePortion + difficultyBonus + weightBonus + performanceBonus + prBonus + clearBonus);

  return {
    baseXP: repeatablePortion,
    workloadBonus,
    repeatMultiplier,
    difficultyBonus,
    weightBonus,
    performanceBonus,
    personalRecordBonus: prBonus,
    firstClearBonus: clearBonus,
    total,
  };
}

/** Cumulative XP required to have reached `level` (level 1 = 0 XP). */
export function cumulativeXPForLevel(level: number): number {
  let total = 0;
  for (let current = 1; current < level; current += 1) {
    total += PROGRESSION_CONFIG.xpToReachNextLevel(current);
  }
  return total;
}

/** The level a hunter is at given their lifetime total XP. */
export function getLevelForTotalXP(totalXP: number): number {
  let level = 1;
  while (totalXP >= cumulativeXPForLevel(level + 1)) {
    level += 1;
  }
  return level;
}

export interface LevelProgress {
  level: number;
  totalXP: number;
  /** XP earned since hitting the current level. */
  xpIntoLevel: number;
  /** XP required to go from the current level to the next. */
  xpForThisLevel: number;
  /** 0 to 1, for progress bars. */
  progress: number;
}

/** Everything a Profile/Victory screen needs to render an XP bar. */
export function getLevelProgress(totalXP: number): LevelProgress {
  const level = getLevelForTotalXP(totalXP);
  const floorXP = cumulativeXPForLevel(level);
  const xpForThisLevel = PROGRESSION_CONFIG.xpToReachNextLevel(level);
  const xpIntoLevel = totalXP - floorXP;
  return {
    level,
    totalXP,
    xpIntoLevel,
    xpForThisLevel,
    progress: xpForThisLevel > 0 ? Math.min(1, xpIntoLevel / xpForThisLevel) : 1,
  };
}
