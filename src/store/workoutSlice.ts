import { StateCreator } from 'zustand';
import { WorkoutRepository, ProgressRepository, ChronicleRepository, UserRepository } from '../services';
import { contentEngine } from '../../engines/content';
import { LOCAL_USER_ID } from '../constants/localUser';
import { APP_VERSION } from '../constants/version';
import { AppStore, WorkoutSlice } from './types';
import { MonsterProgress, Chronicle, WorkoutResult } from '../models';
import { getHuntRank } from '../utils/huntRank';
import { getHunterTitle } from '../utils/hunterTitle';
import { calculateHuntXP, getLevelForTotalXP } from '../../engines/progress/progressionEngine';
import { getExerciseBreakdown } from '../utils/exerciseBreakdown';
import {
  getEncounterOutcome,
  reconstructEncounterConfig,
  encounterConfigsMatch,
} from '../utils/encounterLock';
import {
  getAllExerciseStats as computeAllExerciseStats,
  findExerciseStats,
  getWeaknessProfile as computeWeaknessProfile,
} from '../utils/exerciseStats';

export const createWorkoutSlice: StateCreator<AppStore, [], [], WorkoutSlice> = (set, get) => ({
  lastResult: null,
  lastHuntSummary: null,

  completeHunt: async ({
    monsterId,
    huntId,
    workoutId,
    elapsedSeconds,
    totalDamageDealt,
    criticalHits,
    actualWeightKg,
    actualWeightBKg,
    actualGearCount,
    isCustomHunt,
    rungLaps,
    customWorkout,
    restSecondsUsed,
    structuralValueUsed,
    repsOverridesUsed,
    encounterTargetSeconds,
  }) => {
    const monster = contentEngine.getMonster(monsterId);
    const canonicalWorkout = contentEngine.getWorkout(workoutId);
    const hunt = contentEngine.getHunt(monsterId, huntId);
    if (!monster || !canonicalWorkout) {
      throw new Error(
        `completeHunt: unknown monster "${monsterId}" or workout "${workoutId}"`
      );
    }
    // Task 2: when a structural control was customized this session,
    // every downstream calculation below (rank, XP workload, reps
    // breakdown) uses THIS Workout instead of the canonical one — it's
    // the actual thing the player did. The canonical Workout is only
    // used for the existence check above and is otherwise untouched.
    const workout = customWorkout ?? canonicalWorkout;

    // Player-entered weight for this specific Hunt (Hunt Brief), falling
    // back to the workout's content-authored recommendation when not
    // supplied — keeps every existing/older completeHunt call working
    // unchanged.
    const weightKg = actualWeightKg ?? workout.gearWeightKg;
    // Custom Hunt: the player's actual gear count, falling back to
    // canonical workout.gearCount exactly like weightKg above — every
    // existing/older completeHunt call (no actualGearCount passed) keeps
    // reading workout.gearCount unchanged.
    const gearCount = actualGearCount ?? workout.gearCount;
    // Kettlebell weight audit: the second bell's REAL weight — genuinely
    // independent from `weightKg` (16kg + 18kg is valid, not assumed
    // equal). Falls back to `weightKg` only when gearCount is 2 but no
    // distinct B weight was supplied (keeps every pre-this-feature caller
    // working exactly as before: both bells at the one weight entered).
    // Always null for a single-bell Hunt.
    const weightBKg = gearCount === 2 ? actualWeightBKg ?? weightKg : null;

    // Determine PR/first-clear against this workout's history before we
    // write the new result — this is the single source of truth both the
    // saved xpAwarded and the Victory screen's HuntSummary read from.
    const priorResults = await WorkoutRepository.getResultsForWorkout(LOCAL_USER_ID, workoutId);
    // Task 2: a structurally-customized clear is deliberately never
    // PR/first-clear eligible — it did a different amount of work than
    // every other result sharing this workoutId, so comparing its
    // elapsedSeconds against them (or crediting it as "first ever
    // clear") would corrupt that workoutId's PR pool with an
    // apples-to-oranges time. Weight/gear/rest-only Custom Hunts (no
    // customWorkout) are completely unaffected — those never changed
    // achievable damage/duration, so they were always fairly comparable
    // and still are.
    const isFirstClear = !customWorkout && priorResults.length === 0;
    const priorBestSeconds = priorResults.length
      ? Math.min(...priorResults.map((r) => r.timeMinutes * 60 + r.timeSeconds))
      : null;
    const isPersonalRecord =
      !customWorkout && priorBestSeconds !== null && elapsedSeconds < priorBestSeconds;

    // Task 7: "did I improve" comparison — deliberately narrower than the
    // PR pool above. Only a prior result for this EXACT encounter
    // (huntId, not just workoutId — Level 1/2/3 share a workoutId but are
    // different challenges) with the EXACT SAME reconstructed
    // configuration (weight/gear/rest/structure/reps/mode — see
    // encounterLock.ts's encounterConfigsMatch, per this feature's own
    // "must never be treated as the same configuration" rule) is
    // comparable; anything else would be comparing different amounts of
    // work. A legacy Custom Hunt row (isExact === false — see
    // reconstructEncounterConfig) is never treated as comparable, since
    // its rest/structure/reps genuinely can't be verified equal. Most
    // recent matching result wins if there's more than one.
    const currentConfig = hunt
      ? {
          weightKg,
          weightBKg,
          gearCount: gearCount as 1 | 2,
          restSeconds: restSecondsUsed ?? (hunt.restSecondsOverride ?? workout.restSeconds),
          structuralValue: isCustomHunt ? structuralValueUsed ?? null : null,
          repsOverrides: isCustomHunt ? repsOverridesUsed ?? null : null,
          isCustomHunt: !!isCustomHunt,
        }
      : null;
    const comparableResult = hunt
      ? priorResults
          .filter((r) => r.huntId === huntId)
          .filter((r) => {
            const { config: priorConfig, isExact } = reconstructEncounterConfig(hunt, workout, r);
            return isExact && currentConfig !== null && encounterConfigsMatch(priorConfig, currentConfig);
          })
          .sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime())[0]
      : undefined;
    const comparablePreviousSeconds = comparableResult
      ? comparableResult.timeMinutes * 60 + comparableResult.timeSeconds
      : null;
    const isBetterThanComparable =
      comparablePreviousSeconds !== null ? elapsedSeconds < comparablePreviousSeconds : null;

    // Encounter Lock: was there ANY prior result for this exact huntId
    // (not just workoutId) before this one? Distinguishes Encounter 1's
    // true first-ever clear (baseline-establishing) from a later replay.
    // priorResults is already fetched by workoutId above, which is a
    // superset of every huntId sharing it — no extra query needed.
    const isFirstResultForThisHunt = hunt
      ? priorResults.every((r) => r.huntId !== huntId)
      : false;
    const encounterOutcome = hunt
      ? getEncounterOutcome(hunt, encounterTargetSeconds ?? null, isFirstResultForThisHunt)
      : null;

    const rank = getHuntRank(elapsedSeconds, workout.targetTimeSeconds, isPersonalRecord);
    // Sprint 26/27: totalReps reuses the existing, already sections+rounds-
    // aware getExerciseBreakdown helper. priorResults is already fetched
    // above for PR/first-clear — its .length is exactly "how many times
    // this workoutId has been completed before", already scoped
    // per-workoutId, not global. This same reps total also now feeds the
    // aggregate `volumeKg` calc below (Sprint 27) — one correct reps
    // figure, reused, not two different interpretations of how many reps
    // were performed.
    //
    // Task 6 fix: computed with the REAL weightKg/gearCount (not a dummy
    // 1/1) and the array itself is kept (exerciseBreakdown), not just its
    // reps sum — HuntCompleteScreen now reads this directly instead of
    // independently re-fetching contentEngine.getWorkout(workoutId) and
    // recomputing, which is exactly what was silently re-deriving reps
    // from the CANONICAL structure for a structurally-customized (Custom
    // Hunt ladder/rounds/cycles) session and reporting the canonical
    // total instead of what was actually performed.
    // Task 3 (EMOM): for an open-ended workout (The Breaking), the real
    // completed-round count can differ from workout.rounds (a reference
    // value only, never a cap for these) — rungLaps.length is what
    // actually happened, same source ladder workouts already use here
    // (and for them it already equals workout.rounds, so this changes
    // nothing for that case).
    const actualRounds = rungLaps && rungLaps.length > 0 ? rungLaps.length : workout.rounds;
    const exerciseBreakdown = getExerciseBreakdown(workout, actualRounds, weightKg, gearCount, weightBKg);
    const workoutTotalReps = exerciseBreakdown.reduce((sum, entry) => sum + entry.totalReps, 0);
    const xp = calculateHuntXP({
      difficulty: workout.difficulty,
      actualWeightKg: weightKg,
      recommendedWeightKg: workout.gearWeightKg,
      gearCount,
      totalReps: workoutTotalReps,
      priorClearsOfThisWorkout: priorResults.length,
      rank,
      isPersonalRecord,
      isFirstClear,
    });

    const result: WorkoutResult = {
      id: `${workoutId}-${Date.now()}`,
      userId: LOCAL_USER_ID,
      workoutId,
      monsterId,
      huntId,
      completedAt: new Date().toISOString(),
      timeMinutes: Math.floor(elapsedSeconds / 60),
      timeSeconds: elapsedSeconds % 60,
      weightValueA: weightKg,
      weightValueB: weightBKg,
      weightUnit: 'kg',
      notes: null,
      xpAwarded: xp.total,
      difficulty: workout.difficulty,
      appVersion: APP_VERSION,
      rungLaps: rungLaps && rungLaps.length > 0 ? rungLaps : null,
      rpe: null,
      isCustomHunt: isCustomHunt ?? false,
      restSecondsUsed: isCustomHunt ? restSecondsUsed ?? null : null,
      structuralValueUsed: isCustomHunt ? structuralValueUsed ?? null : null,
      repsOverridesUsed: isCustomHunt ? repsOverridesUsed ?? null : null,
    };
    await WorkoutRepository.saveResult(result);

    const huntsTotal = monster.hunts.length;
    const existingProgress = get().monsterProgress[monsterId] ?? {
      userId: LOCAL_USER_ID,
      monsterId,
      huntsCompleted: 0,
      huntsTotal,
      defeated: false,
    };
    const huntsCompleted = Math.min(existingProgress.huntsCompleted + 1, huntsTotal);
    const justDefeated = huntsCompleted >= huntsTotal && !existingProgress.defeated;
    const updatedProgress: MonsterProgress = {
      ...existingProgress,
      huntsCompleted,
      huntsTotal,
      defeated: huntsCompleted >= huntsTotal,
    };
    await ProgressRepository.upsertMonsterProgress(updatedProgress);

    // Kettlebell weight audit: sums the SAME per-exercise breakdown
    // (exerciseBreakdown, computed above for XP/HuntSummary) rather than
    // a separate `weightKg * workout.gearCount * workoutTotalReps`
    // formula — that flat formula assumed every exercise in the workout
    // used both bells at the SAME weight, which is wrong for (a) a
    // workout mixing single- and double-bell exercises (e.g. Chimera —
    // see Exercise.usesGearCount) and (b) two genuinely different real
    // bell weights (16kg + 18kg summed, never `weightKg * 2`). One
    // corrected source of truth now feeds both this Chronicle aggregate
    // and the Victory screen's "Volume" stat (HuntSummary.volumeKg,
    // below) — they can no longer diverge.
    const volumeKg = exerciseBreakdown.reduce((sum, entry) => sum + entry.volumeKg, 0);
    const existingChronicle = get().chronicle;

    const now = new Date();
    const today = now.toDateString();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toDateString();
    const lastActivityDay = existingChronicle?.updatedAt
      ? new Date(existingChronicle.updatedAt).toDateString()
      : null;

    let currentStreakDays = existingChronicle?.currentStreakDays ?? 0;
    if (lastActivityDay === today) {
      // Already trained today — streak doesn't advance twice in one day.
      currentStreakDays = Math.max(currentStreakDays, 1);
    } else if (lastActivityDay === yesterday) {
      currentStreakDays += 1;
    } else {
      currentStreakDays = 1;
    }
    const longestStreakDays = Math.max(existingChronicle?.longestStreakDays ?? 0, currentStreakDays);

    const updatedChronicle: Chronicle = {
      userId: LOCAL_USER_ID,
      totalWorkouts: (existingChronicle?.totalWorkouts ?? 0) + 1,
      totalHuntsCompleted: (existingChronicle?.totalHuntsCompleted ?? 0) + 1,
      totalMonstersDefeated: (existingChronicle?.totalMonstersDefeated ?? 0) + (justDefeated ? 1 : 0),
      totalVolumeKg: (existingChronicle?.totalVolumeKg ?? 0) + volumeKg,
      totalTrainingMinutes:
        (existingChronicle?.totalTrainingMinutes ?? 0) + Math.round(elapsedSeconds / 60),
      longestStreakDays,
      currentStreakDays,
      updatedAt: now.toISOString(),
    };
    await ChronicleRepository.upsert(updatedChronicle);

    const previousUser = get().user;
    const previousXP = previousUser?.totalXP ?? 0;
    const previousLevel = previousUser?.level ?? 1;
    const newXP = previousXP + xp.total;
    const newLevel = getLevelForTotalXP(newXP);
    const updatedUser = await UserRepository.addXPAndSetLevel(LOCAL_USER_ID, xp.total, newLevel);

    const previousTitle = getHunterTitle(previousLevel);
    const title = getHunterTitle(newLevel);

    const totalExercises = workout.rounds * workout.exercises.length;

    set((state) => ({
      lastResult: result,
      lastHuntSummary: {
        rank,
        xp,
        previousXP,
        newXP,
        previousLevel,
        newLevel,
        leveledUp: newLevel > previousLevel,
        title,
        previousTitle,
        titleChanged: title !== previousTitle,
        isPersonalRecord,
        isFirstClear,
        totalDamageDealt,
        criticalHits,
        totalRounds: workout.rounds,
        totalExercises,
        completionPercentage: 100,
        volumeKg,
        weightKg,
        // Kettlebell weight audit: was `workout.gearCount` — always the
        // CANONICAL gear count, wrong whenever Custom Hunt used a
        // different one (a 1-bell Custom Hunt on a gearCount:2 workout
        // would still report "2"). `gearCount` (already resolved above,
        // actualGearCount ?? workout.gearCount) is what this Hunt
        // actually used.
        weightBKg,
        gearCount: gearCount as 1 | 2,
        elapsedSeconds,
        rungLaps,
        exerciseBreakdown,
        comparablePreviousSeconds,
        isBetterThanComparable,
        resultId: result.id,
        encounterOutcome,
        encounterTargetSeconds: encounterTargetSeconds ?? null,
        isCustomHunt: isCustomHunt ?? false,
      },
      monsterProgress: { ...state.monsterProgress, [monsterId]: updatedProgress },
      chronicle: updatedChronicle,
      user: updatedUser ?? state.user,
    }));

    return result;
  },

  getResultsForHunt: async (huntId: string) => {
    return WorkoutRepository.getResultsForHunt(LOCAL_USER_ID, huntId);
  },

  getBestTimeSeconds: async (workoutId: string) => {
    const results = await WorkoutRepository.getResultsForWorkout(LOCAL_USER_ID, workoutId);
    if (results.length === 0) {
      return null;
    }
    const timesInSeconds = results.map((result) => result.timeMinutes * 60 + result.timeSeconds);
    return Math.min(...timesInSeconds);
  },

  getBestResult: async (workoutId: string) => {
    const results = await WorkoutRepository.getResultsForWorkout(LOCAL_USER_ID, workoutId);
    if (results.length === 0) {
      return null;
    }
    return results.reduce((best, current) => {
      const bestSeconds = best.timeMinutes * 60 + best.timeSeconds;
      const currentSeconds = current.timeMinutes * 60 + current.timeSeconds;
      return currentSeconds < bestSeconds ? current : best;
    });
  },

  getAllResults: async () => {
    return WorkoutRepository.getResultsForUser(LOCAL_USER_ID);
  },

  setResultRPE: async (resultId: string, rpe: number) => {
    await WorkoutRepository.updateRPE(resultId, rpe);
  },

  /** Task 10: mirrors setResultRPE exactly — see WorkoutRepository.updateNotes. */
  setResultNotes: async (resultId: string, notes: string | null) => {
    await WorkoutRepository.updateNotes(resultId, notes);
  },

  getHunterSummary: async () => {
    const results = await WorkoutRepository.getResultsForUser(LOCAL_USER_ID);
    if (results.length === 0) {
      return {
        favoriteMonsterId: null,
        favoriteWorkoutId: null,
        recentResult: null,
        weightPRKg: null,
        fastestHuntSeconds: null,
      };
    }

    const countBy = (key: 'monsterId' | 'workoutId'): string => {
      const counts = new Map<string, number>();
      results.forEach((result) => {
        const value = result[key];
        counts.set(value, (counts.get(value) ?? 0) + 1);
      });
      let topValue = results[0][key];
      let topCount = 0;
      counts.forEach((count, value) => {
        if (count > topCount) {
          topCount = count;
          topValue = value;
        }
      });
      return topValue;
    };

    const weightPRKg = Math.max(...results.map((r) => r.weightValueA + (r.weightValueB ?? 0)));
    const fastestHuntSeconds = Math.min(...results.map((r) => r.timeMinutes * 60 + r.timeSeconds));

    return {
      favoriteMonsterId: countBy('monsterId'),
      favoriteWorkoutId: countBy('workoutId'),
      // results are already ordered DESC by completedAt from the repository.
      recentResult: results[0],
      weightPRKg,
      fastestHuntSeconds,
    };
  },

  getAllExerciseStats: async () => {
    const results = await WorkoutRepository.getResultsForUser(LOCAL_USER_ID);
    return computeAllExerciseStats(
      results,
      (workoutId) => contentEngine.getWorkout(workoutId),
      (exerciseName) => contentEngine.getExerciseLibraryEntryByName(exerciseName)
    );
  },

  getExerciseStatsById: async (exerciseId) => {
    const stats = await get().getAllExerciseStats();
    return findExerciseStats(stats, exerciseId);
  },

  getWeaknessProfile: async () => {
    const stats = await get().getAllExerciseStats();
    return computeWeaknessProfile(stats);
  },
});
