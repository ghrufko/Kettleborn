import { getDatabase } from '../services/db';
import { contentEngine } from '../../engines/content';
import { audioEngine } from '../../engines/audio/AudioEngine';
import { useAppStore } from './index';

/**
 * Runs once at app launch. Order matters: the database must be open and
 * migrated before any repository call, and content must be loaded before
 * ProgressSlice can determine each monster's huntsTotal.
 */
export async function bootstrapApp(): Promise<void> {
  const store = useAppStore.getState();

  // Started FIRST and deliberately NOT awaited. Session restoration is a
  // cloud concern with no dependency on local SQLite, and it must not
  // depend on it: previously it ran only after every local step below,
  // so a database failure (e.g. web storage unavailable) meant auth never
  // initialized at all — no session restore, and an email link's
  // callback never completed. Never awaited either way, so a slow or
  // unreachable network can't delay local-first startup. initializeAuth()
  // memoizes its own promise, so a bootstrap retry (ErrorScreen onRetry)
  // reuses it rather than registering anything twice. The .catch() is
  // defense-in-depth — initializeAuth() itself never rejects.
  store.initializeAuth().catch(() => undefined);

  await getDatabase();

  contentEngine.load();
  audioEngine.preload().catch(() => undefined);

  await store.initializeUser();
  await store.initializeSettings();
  await store.loadEquipment();
  await store.initializeChronicle();
  await store.loadAllMonsterProgress();
  await store.loadTimerPresets();
  await store.loadCustomWorkouts();
  await store.loadAchievements();
}
