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
  await getDatabase();

  contentEngine.load();
  audioEngine.preload().catch(() => undefined);

  const store = useAppStore.getState();
  await store.initializeUser();
  await store.initializeSettings();
  await store.loadEquipment();
  await store.initializeChronicle();
  await store.loadAllMonsterProgress();
  await store.loadTimerPresets();
  await store.loadCustomWorkouts();
  await store.loadAchievements();

  // Phase 2.2: deliberately NOT awaited. Session hydration is a cloud
  // concern with no bearing on local-first startup — the local app above
  // is already fully initialized by this point regardless of whether
  // this ever resolves, rejects, or hangs on a slow/unreachable network.
  // initializeAuth() itself never throws (see authSlice.ts/auth.ts), but
  // the extra .catch() here is defense-in-depth against bootstrapApp()
  // ever being awaited somewhere that would otherwise surface a stray
  // rejection as an unrelated startup failure.
  store.initializeAuth().catch(() => undefined);
}
