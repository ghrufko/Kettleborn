import test from 'node:test';
import assert from 'node:assert/strict';

const BOOTSTRAP_URL = new URL('../bootstrap.ts', import.meta.url).href;
const DB_PATH = new URL('../../services/db/index.ts', import.meta.url).href;
const CONTENT_PATH = new URL('../../../engines/content/index.ts', import.meta.url).href;
const AUDIO_PATH = new URL('../../../engines/audio/AudioEngine.ts', import.meta.url).href;
const STORE_PATH = new URL('../index.ts', import.meta.url).href;

/**
 * Mocks every module bootstrap.ts touches (each pulls in expo-sqlite /
 * expo-audio / the full RN store, unusable under plain Node) and records
 * the order of the calls that matter.
 */
async function setup(t: any, getDatabase: () => Promise<unknown>) {
  const calls: string[] = [];
  const localStep = (name: string) => async () => {
    calls.push(name);
  };
  const store = {
    initializeAuth: async () => {
      calls.push('initializeAuth');
    },
    initializeUser: localStep('initializeUser'),
    initializeSettings: localStep('initializeSettings'),
    loadEquipment: localStep('loadEquipment'),
    initializeChronicle: localStep('initializeChronicle'),
    loadAllMonsterProgress: localStep('loadAllMonsterProgress'),
    loadTimerPresets: localStep('loadTimerPresets'),
    loadCustomWorkouts: localStep('loadCustomWorkouts'),
    loadAchievements: localStep('loadAchievements'),
  };
  t.mock.module(DB_PATH, {
    exports: {
      getDatabase: () => {
        calls.push('getDatabase');
        return getDatabase();
      },
      migrations: [],
    },
  });
  t.mock.module(CONTENT_PATH, { exports: { contentEngine: { load: () => calls.push('contentLoad') } } });
  t.mock.module(AUDIO_PATH, { exports: { audioEngine: { preload: async () => undefined } } });
  t.mock.module(STORE_PATH, { exports: { useAppStore: { getState: () => store } } });
  const { bootstrapApp } = await import(`${BOOTSTRAP_URL}?bust=${Math.random()}`);
  return { calls, bootstrapApp };
}

test('auth initialization starts before, and independently of, SQLite — even when SQLite fails', async (t) => {
  const { calls, bootstrapApp } = await setup(t, async () => {
    throw new Error('SQLite open failed');
  });
  await assert.rejects(bootstrapApp(), /SQLite open failed/);
  assert.deepEqual(calls, ['initializeAuth', 'getDatabase']);
  // No local step ran against a database that never opened.
  assert.equal(calls.includes('initializeUser'), false);
});

test('a bootstrap retry after a SQLite failure re-runs the local steps (initializeAuth itself is memoized in the slice)', async (t) => {
  let attempts = 0;
  const { calls, bootstrapApp } = await setup(t, async () => {
    attempts += 1;
    if (attempts === 1) {
      throw new Error('SQLite open failed');
    }
    return {};
  });
  await assert.rejects(bootstrapApp());
  await bootstrapApp();
  assert.equal(attempts, 2);
  assert.ok(calls.includes('loadAchievements'));
  assert.equal(calls.lastIndexOf('initializeAuth') < calls.lastIndexOf('getDatabase'), true);
});
