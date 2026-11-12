import type { StateCreator } from 'zustand';
import type { AppStore, SyncSlice, SyncStatus } from './types';
import { getDatabase } from '../services/db';
import { contentEngine } from '../../engines/content';
import { LOCAL_USER_ID } from '../constants/localUser';
import { syncOnce, SyncScheduler } from '../services/sync/engine';
import { enableAndSeed, enableForRestore, type QueueConnection } from '../services/sync/outbox';
import { decideLink } from '../services/sync/linking';
import { listOpenConflicts, resolveConflict as resolveConflictInDb } from '../services/sync/conflicts';
import { getAccountDeleter, getSyncTransport, isSyncFeatureEnabled } from '../services/sync/runtime';
import { unlinkAfterAccountDeletion } from '../services/sync/accountData';
import { rebuildTotals } from '../services/projections/rebuild';
import { loadProjectionInput } from '../services/projections/load';

/**
 * Cloud Save P8 — the store side of sync: which account this install
 * belongs to (D4/D10), running sync passes, and what the screens show
 * (pending XP, last sync, conflicts, notices). With the feature flag off
 * every action is a no-op and `sync.decision` stays 'off'.
 */

const INITIAL: SyncStatus = {
  decision: 'off',
  syncing: false,
  linked: false,
  lastSyncedAt: null,
  pendingXP: 0,
  unsyncedChanges: 0,
  blockedReason: null,
  conflicts: [],
  notices: [],
  lastError: null,
};

function huntsTotalByMonster(): Record<string, number> {
  return Object.fromEntries(contentEngine.getAllMonsters().map((m) => [m.id, m.hunts.length]));
}

export const createSyncSlice: StateCreator<AppStore, [], [], SyncSlice> = (set, get) => {
  let scheduler: SyncScheduler | null = null;
  let authUserId: string | null = null;

  const patch = (p: Partial<SyncStatus>) => set((s) => ({ sync: { ...s.sync, ...p } }));

  /** Reloads every slice the sync can change (all read from SQLite). */
  const reloadLocalData = async () => {
    const s = get();
    await s.initializeUser?.();
    await s.initializeChronicle?.();
    await s.loadAllMonsterProgress?.();
    await s.loadAchievements?.();
    await s.loadEquipment?.();
    await s.initializeSettings?.();
    await s.loadTimerPresets?.();
    await s.loadCustomWorkouts?.();
  };

  const startScheduler = () => {
    const transport = getSyncTransport();
    if (!transport) return;
    scheduler?.stop();
    scheduler = new SyncScheduler(
      async () => {
        patch({ syncing: true });
        try {
          const db = (await getDatabase()) as unknown as QueueConnection;
          return await syncOnce(db, transport, LOCAL_USER_ID, huntsTotalByMonster());
        } finally {
          patch({ syncing: false });
        }
      },
      (outcome) => {
        void (async () => {
          if (outcome instanceof Error) {
            patch({ lastError: outcome.message });
          } else {
            patch({ lastError: null });
            if (outcome.pulled > 0 || outcome.pushed > 0) await reloadLocalData();
          }
          await get().refreshSyncStatus();
        })();
      }
    );
    scheduler.request();
  };

  return {
    sync: INITIAL,

    handleAuthUser: async (userId: string | null) => {
      authUserId = userId;
      const transport = getSyncTransport();
      if (!isSyncFeatureEnabled() || !transport) {
        patch({ decision: 'off' });
        return;
      }
      if (userId === null) {
        // D10: signing out pauses sync; local data and the queue stay.
        scheduler?.stop();
        scheduler = null;
        patch({ decision: 'signed_out' });
        await get().refreshSyncStatus();
        return;
      }
      try {
        const db = (await getDatabase()) as unknown as QueueConnection;
        const decision = await decideLink(db, transport, LOCAL_USER_ID, userId);
        patch({ decision, lastError: null });
        if (decision === 'resume') startScheduler();
        if (decision === 'auto_link') await get().confirmLink();
      } catch (error) {
        patch({ lastError: (error as Error).message });
      }
      await get().refreshSyncStatus();
    },

    confirmLink: async () => {
      // Only when the account is empty (D4): never offered, and never allowed, after 'refused'.
      if (!authUserId || !getSyncTransport() || !['offer_link', 'auto_link'].includes(get().sync.decision)) return;
      const db = (await getDatabase()) as unknown as QueueConnection;
      await enableAndSeed(db, LOCAL_USER_ID, authUserId);
      patch({ decision: 'resume' });
      startScheduler();
    },

    confirmRestore: async () => {
      // Only when this install has no progress (D4).
      if (!authUserId || !getSyncTransport() || get().sync.decision !== 'offer_restore') return;
      const db = (await getDatabase()) as unknown as QueueConnection;
      await enableForRestore(db, authUserId);
      patch({ decision: 'resume' });
      startScheduler();
    },

    requestSync: () => {
      scheduler?.request();
    },

    stopSync: () => {
      scheduler?.stop();
      scheduler = null;
    },

    refreshSyncStatus: async () => {
      const db = (await getDatabase()) as unknown as QueueConnection;
      const state = await db.getFirstAsync<{ last_sync_at: string | null; sync_blocked_reason: string | null; linked_user_id: string | null }>(
        'SELECT last_sync_at, sync_blocked_reason, linked_user_id FROM sync_state WHERE id = 1;'
      );
      const queued = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM sync_outbox;');
      const notices = await db.getAllAsync<any>('SELECT * FROM sync_notice WHERE dismissed_at IS NULL ORDER BY id;');
      let pendingXP = 0;
      try {
        pendingXP = rebuildTotals(await loadProjectionInput(LOCAL_USER_ID, huntsTotalByMonster())).pendingXP;
      } catch {
        pendingXP = 0;
      }
      patch({
        linked: (state?.linked_user_id ?? null) !== null,
        lastSyncedAt: state?.last_sync_at ?? null,
        blockedReason: state?.sync_blocked_reason ?? null,
        unsyncedChanges: queued?.n ?? 0,
        pendingXP,
        conflicts: await listOpenConflicts(db),
        notices: notices.map((n) => ({ id: n.id, kind: n.kind, data: JSON.parse(n.data_json), createdAt: n.created_at })),
      });
    },

    resolveConflict: async (conflictUuid, choice) => {
      const db = (await getDatabase()) as unknown as QueueConnection;
      await resolveConflictInDb(db, LOCAL_USER_ID, conflictUuid, choice);
      await reloadLocalData();
      await get().refreshSyncStatus();
      scheduler?.request();
    },

    deleteCloudAccount: async () => {
      const deleter = getAccountDeleter();
      if (!isSyncFeatureEnabled() || !deleter) return { ok: false, error: 'Cloud accounts are not available in this build.' };
      scheduler?.stop();
      scheduler = null;
      const result = await deleter();
      if (!result.ok) return result;
      const db = (await getDatabase()) as unknown as QueueConnection;
      await unlinkAfterAccountDeletion(db, LOCAL_USER_ID, huntsTotalByMonster());
      authUserId = null;
      patch({ decision: 'signed_out' });
      await reloadLocalData();
      await get().refreshSyncStatus();
      await get().authSignOut?.();
      return result;
    },

    dismissNotice: async (id) => {
      const db = (await getDatabase()) as unknown as QueueConnection;
      await db.runAsync('UPDATE sync_notice SET dismissed_at = ? WHERE id = ?;', new Date().toISOString(), id);
      await get().refreshSyncStatus();
    },
  };
};
