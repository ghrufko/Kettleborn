import type { StateCreator } from 'zustand';
import {
  ProgressRepository,
  resetCampaignProgressAtomically,
  resetMonsterProgressAtomically,
} from '../services';
import { contentEngine } from '../../engines/content';
import { LOCAL_USER_ID } from '../constants/localUser';
import type { AppStore, ProgressSlice } from './types';
import type { MonsterProgress } from '../models';

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
    // Personal Best is derived only from active workout history — voiding
    // it (Cloud Save Phase 1: never deleting), plus resetting per-monster/
    // campaign progress, lifetime Chronicle and XP/level, starts the
    // player on Campaign I exactly like a new player. The voided results
    // and a snapshot of every zeroed total stay in the database (see
    // resetCampaignProgressAtomically). App settings, user settings,
    // exercise library, campaign content, audio, and images are untouched.
    const monsters = contentEngine.getAllMonsters();
    const freshProgress: Record<string, MonsterProgress> = Object.fromEntries(
      monsters.map((monster) => [monster.id, {
        userId: LOCAL_USER_ID,
        monsterId: monster.id,
        huntsCompleted: 0,
        huntsTotal: monster.hunts.length,
        defeated: false,
      }])
    ) as Record<string, MonsterProgress>;
    // All-or-nothing: if anything fails, nothing is voided or reset and
    // this throws before the store changes (SettingsScreen reports it).
    const { chronicle, user } = await resetCampaignProgressAtomically({
      userId: LOCAL_USER_ID,
      freshMonsterProgress: Object.values(freshProgress),
    });

    set({
      monsterProgress: freshProgress,
      chronicle,
      user: user ?? get().user,
      lastResult: null,
      lastHuntSummary: null,
    });
  },

  /**
   * Encounter Lock — Reset Progress (per-monster): scoped sibling of
   * resetCampaignProgress above, for one monster instead of the whole
   * account. Voids (Cloud Save Phase 1: never deletes) this monster's
   * WorkoutResult rows (its Encounter 1/2/3 baseline/target/history all
   * derive from the active ones, nothing else to clear — see
   * encounterLock.ts) and resets its MonsterProgress row to
   * a fresh, never-fought state. Deliberately does NOT touch: the
   * lifetime Chronicle aggregate row (streak/XP/volume totals stay as
   * they are — this is a per-monster reset, not an XP refund), other
   * monsters' progress/results, Custom Workouts, Timer data, or
   * campaign_progress (unused for gating, see campaignState.ts).
   */
  resetMonsterProgress: async (monsterId: string) => {
    const huntsTotal = contentEngine.getMonster(monsterId)?.hunts.length ?? 0;
    const resetProgress: MonsterProgress = {
      userId: LOCAL_USER_ID,
      monsterId,
      huntsCompleted: 0,
      huntsTotal,
      defeated: false,
    };
    // Voids (never deletes) this monster's results and resets its progress
    // row in one transaction — see resetMonsterProgressAtomically.
    await resetMonsterProgressAtomically({ userId: LOCAL_USER_ID, monsterId, resetProgress });
    set((state) => ({
      monsterProgress: { ...state.monsterProgress, [monsterId]: resetProgress },
    }));
  },
});
