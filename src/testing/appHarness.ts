import { mock } from 'node:test';
import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openTestDatabase } from './nodeSqliteDatabase';
import { buildVersion17Database } from './legacyDatabaseFixture';

/**
 * Test-only: the real app stack (store slices, repositories, migration
 * runner) over real SQLite files, with only the platform modules replaced
 * (expo-sqlite → node:sqlite, expo-crypto → Node's randomUUID). Same setup
 * as completeHunt.integration.test.ts, shared by the Cloud Save P4/P5 tests.
 *
 * Import this module before any app module: it registers the module mocks
 * when it is evaluated, and loads the app modules afterwards.
 */
const DB_INDEX_URL = new URL('../services/db/index.ts', import.meta.url).href;
const DATABASE_URL = new URL('../services/db/database.ts', import.meta.url).href;

export const device: { path: string; handle: any; getDatabase: (() => Promise<unknown>) | null } = {
  path: '',
  handle: null,
  getDatabase: null,
};

mock.module('expo-sqlite', {
  exports: {
    openDatabaseAsync: async () => {
      device.handle = openTestDatabase(device.path);
      return device.handle;
    },
  },
});
mock.module(DB_INDEX_URL, { exports: { getDatabase: () => device.getDatabase!(), migrations: [] } });
mock.module('expo-crypto', { exports: { randomUUID } });

const { createStore } = await import('zustand/vanilla');
const { createUserSlice } = await import(new URL('../store/userSlice.ts', import.meta.url).href);
const { createChronicleSlice } = await import(new URL('../store/chronicleSlice.ts', import.meta.url).href);
const { createProgressSlice } = await import(new URL('../store/progressSlice.ts', import.meta.url).href);
const { createWorkoutSlice } = await import(new URL('../store/workoutSlice.ts', import.meta.url).href);
const { createAchievementSlice } = await import(new URL('../store/achievementSlice.ts', import.meta.url).href);
const { createSettingsSlice } = await import(new URL('../store/settingsSlice.ts', import.meta.url).href);
const { createSyncSlice } = await import(new URL('../store/syncSlice.ts', import.meta.url).href);
export const { contentEngine } = await import(new URL('../../engines/content/index.ts', import.meta.url).href);
export const Services = await import(new URL('../services/index.ts', import.meta.url).href);

const workDir = mkdtempSync(join(tmpdir(), 'kettleborn-app-'));
const fixturePath = join(workDir, 'fixture-v17.db');
buildVersion17Database(fixturePath);
let copies = 0;

export function closeDevice() {
  if (device.handle) {
    try {
      device.handle.raw.close();
    } catch {
      // Already closed.
    }
    device.handle = null;
  }
}

export function cleanupWorkDir() {
  closeDevice();
  try {
    rmSync(workDir, { recursive: true, force: true });
  } catch {
    // Best effort: Windows can hold a lock on a just-closed SQLite file.
  }
}

/** The open connection's raw node:sqlite handle. */
export function raw(): any {
  return device.handle.raw;
}

/** A fresh store booted the way bootstrapApp boots it, on the open connection. */
export async function bootStore() {
  contentEngine.load();
  const store = createStore<any>()((...api: any[]) => ({
    ...createUserSlice(...api),
    ...createSettingsSlice(...api),
    ...createChronicleSlice(...api),
    ...createProgressSlice(...api),
    ...createWorkoutSlice(...api),
    ...createAchievementSlice(...api),
    ...createSyncSlice(...api),
  }));
  const s = store.getState();
  await s.initializeUser();
  await s.initializeSettings();
  await s.loadEquipment();
  await s.initializeChronicle();
  await s.loadAllMonsterProgress();
  await s.loadAchievements();
  return store;
}

/** One app launch over `path`: the real migration runner, then a booted store. */
export async function launch(path: string) {
  closeDevice();
  device.path = path;
  const database = await import(`${DATABASE_URL}?launch=${Math.random()}`);
  device.getDatabase = database.getDatabase;
  await database.getDatabase();
  return bootStore();
}

/** An existing player's install (copy of the realistic v17 fixture), launched and therefore migrated. */
export async function legacyDevice() {
  copies += 1;
  const path = join(workDir, `legacy-${copies}.db`);
  copyFileSync(fixturePath, path);
  return { path, store: await launch(path) };
}

/** A brand-new install. */
export async function freshDevice() {
  copies += 1;
  const path = join(workDir, `fresh-${copies}.db`);
  return { path, store: await launch(path) };
}

/** Content hunt counts, as completeHunt reads them. */
export function huntsTotalByMonster(): Record<string, number> {
  contentEngine.load();
  return Object.fromEntries(contentEngine.getAllMonsters().map((m: any) => [m.id, m.hunts.length]));
}
