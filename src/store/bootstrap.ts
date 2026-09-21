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
}
