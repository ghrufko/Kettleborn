import { StateCreator } from 'zustand';
import { ProgressRepository, WorkoutRepository, ChronicleRepository, UserRepository } from '../services';
import { contentEngine } from '../../engines/content';
import { LOCAL_USER_ID } from '../constants/localUser';
import { AppStore, ProgressSlice } from './types';
import { MonsterProgress } from '../models';

export const createProgressSlice: StateCreator<AppStore, [], [], ProgressSlice> = (set, get) => ({
  monsterProgress: {},

  loadAllMonsterProgress: async () => {
    const monsters = contentEngine.getAllMonsters();

    for (const monster of monsters) {
      const existing = await ProgressRepository.getMonsterProgress(LOCAL_USER_ID, monster.id);
      if (!existing) {
        await ProgressRepository.upsertMonsterProgress({
          userId: LOCAL_USER_ID,
          monsterId: monster.id,
          huntsCompleted: 0,
          huntsTotal: monster.hunts.length,
          defeated: false,
        });
      }
    }

    const rows = await ProgressRepository.getAllMonsterProgress(LOCAL_USER_ID);
    const byMonsterId = Object.fromEntries(rows.map((row) => [row.monsterId, row]));
    set({ monsterProgress: byMonsterId });
  },

  resetCampaignProgress: async () => {
    // Workout history is the sole source Personal Best is derived from —
    // clear it, plus per-monster/campaign progress and lifetime Chronicle
    // and XP/level, so the player starts Campaign I exactly like a new
    // player. App settings, user settings, exercise library, campaign
    // content, audio, and images are untouched by any of these calls.
    await WorkoutRepository.deleteAllForUser(LOCAL_USER_ID);
    await ProgressRepository.clearMonsterProgress(LOCAL_USER_ID);
    await ProgressRepository.clearCampaignProgress(LOCAL_USER_ID);
    const chronicle = await ChronicleRepository.reset(LOCAL_USER_ID);
    const user = await UserRepository.resetProgression(LOCAL_USER_ID);

    set({
      chronicle,
      user: user ?? get().user,
      lastResult: null,
      lastHuntSummary: null,
    });

    await get().loadAllMonsterProgress();
  },

  /**
   * Encounter Lock — Reset Progress (per-monster): scoped sibling of
   * resetCampaignProgress above, for one monster instead of the whole
   * account. Deletes this monster's WorkoutResult rows (its Encounter
   * 1/2/3 baseline/target/history all derive from those, nothing else to
   * clear — see encounterLock.ts) and resets its MonsterProgress row to
   * a fresh, never-fought state. Deliberately does NOT touch: the
   * lifetime Chronicle aggregate row (streak/XP/volume totals stay as
   * they are — this is a per-monster reset, not an XP refund), other
   * monsters' progress/results, Custom Workouts, Timer data, or
   * campaign_progress (unused for gating, see campaignState.ts).
   */
  resetMonsterProgress: async (monsterId: string) => {
    await WorkoutRepository.deleteResultsForMonster(LOCAL_USER_ID, monsterId);
    const huntsTotal = contentEngine.getMonster(monsterId)?.hunts.length ?? 0;
    const resetProgress: MonsterProgress = {
      userId: LOCAL_USER_ID,
      monsterId,
      huntsCompleted: 0,
      huntsTotal,
      defeated: false,
    };
    await ProgressRepository.upsertMonsterProgress(resetProgress);
    set((state) => ({
      monsterProgress: { ...state.monsterProgress, [monsterId]: resetProgress },
    }));
  },
});
