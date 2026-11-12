import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Cloud Save P1 (decision D7): the weight unit has one source of truth,
 * settings.unit_preference, written by the Settings screen through
 * updateSettings. These tests run the real settings slice, repository and
 * migration runner against a real SQLite file (a copy of the realistic v17
 * fixture, migrated on launch), and check that no screen reads the stale
 * user.unitPreference copy, which nothing updates after the user row is
 * created.
 */

const DATABASE_URL = new URL('../../services/db/database.ts', import.meta.url).href;
const { openTestDatabase } = await import(new URL('../../testing/nodeSqliteDatabase.ts', import.meta.url).href);
const { buildVersion17Database, LEGACY_USER } = await import(
  new URL('../../testing/legacyDatabaseFixture.ts', import.meta.url).href
);

const device: { path: string; handle: any; getDatabase: (() => Promise<unknown>) | null } = {
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
mock.module(new URL('../../services/db/index.ts', import.meta.url).href, {
  exports: { getDatabase: () => device.getDatabase!(), migrations: [] },
});
mock.module('expo-crypto', { exports: { randomUUID } });

const { createStore } = await import('zustand/vanilla');
const { createSettingsSlice } = await import(new URL('../settingsSlice.ts', import.meta.url).href);
const { createUserSlice } = await import(new URL('../userSlice.ts', import.meta.url).href);

const workDir = mkdtempSync(join(tmpdir(), 'kettleborn-unit-'));
const fixturePath = join(workDir, 'fixture-v17.db');
buildVersion17Database(fixturePath);
let copies = 0;

function closeDevice() {
  if (device.handle) {
    try {
      device.handle.raw.close();
    } catch {
      // Already closed.
    }
    device.handle = null;
  }
}
test.afterEach(() => closeDevice());
test.after(() => {
  try {
    rmSync(workDir, { recursive: true, force: true });
  } catch {
    // Best effort: Windows can hold a lock on a just-closed SQLite file.
  }
});

/** One app launch over `path`: the real migration runner, then a fresh store initialized the way bootstrapApp does. */
async function launch(path: string) {
  closeDevice();
  device.path = path;
  const database = await import(`${DATABASE_URL}?launch=${Math.random()}`);
  device.getDatabase = database.getDatabase;
  await database.getDatabase();
  const store = createStore<any>()((...api: any[]) => ({
    ...createUserSlice(...api),
    ...createSettingsSlice(...api),
  }));
  await store.getState().initializeUser();
  await store.getState().initializeSettings();
  return store;
}

function freshCopy() {
  copies += 1;
  const path = join(workDir, `device-${copies}.db`);
  copyFileSync(fixturePath, path);
  return path;
}

function storedUnits() {
  const raw = device.handle.raw;
  return {
    settings: raw.prepare('SELECT unit_preference FROM settings WHERE user_id = ?').get(LEGACY_USER).unit_preference,
    user: raw.prepare('SELECT unit_preference FROM user WHERE id = ?').get(LEGACY_USER).unit_preference,
  };
}

test('changing the unit updates the store immediately, writes settings.unit_preference, and survives a restart', async () => {
  const path = freshCopy();
  const store = await launch(path);
  assert.equal(store.getState().settings.unitPreference, 'kg');

  await store.getState().updateSettings({ unitPreference: 'lb' });
  assert.equal(store.getState().settings.unitPreference, 'lb', 'store updated immediately');
  assert.deepEqual(storedUnits(), { settings: 'lb', user: 'kg' }, 'only the settings row is written');

  const relaunched = await launch(path);
  assert.equal(relaunched.getState().settings.unitPreference, 'lb', 'loaded from SQLite after restart');

  await relaunched.getState().updateSettings({ unitPreference: 'kg' });
  const again = await launch(path);
  assert.equal(again.getState().settings.unitPreference, 'kg');
});

test('an existing install whose two stored units disagree reads the settings value, and nothing is rewritten', async () => {
  const path = freshCopy();
  await launch(path);
  // Old-install shape: the player chose lb in Settings; user.unit_preference is still the 'kg' it was created with.
  device.handle.raw.prepare("UPDATE settings SET unit_preference = 'lb' WHERE user_id = ?").run(LEGACY_USER);
  const before = storedUnits();
  assert.deepEqual(before, { settings: 'lb', user: 'kg' });

  const store = await launch(path);
  assert.equal(store.getState().settings.unitPreference, 'lb');
  assert.equal(store.getState().user.unitPreference, 'kg', 'the stale copy is left exactly as stored');
  assert.deepEqual(storedUnits(), before, 'launching rewrites neither field');
});

test('no screen or component reads the unit from the user record', () => {
  const srcRoot = fileURLToPath(new URL('../../', import.meta.url).href);
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        if (name !== '__tests__') walk(full);
      } else if (/\.tsx?$/.test(name)) {
        files.push(full);
      }
    }
  };
  walk(join(srcRoot, 'screens'));
  walk(join(srcRoot, 'components'));
  assert.ok(files.length > 10, 'scanned the UI source');

  const offenders = files.filter((file) => /\buser\??\.unitPreference\b/.test(readFileSync(file, 'utf8')));
  assert.deepEqual(offenders, [], 'read settings.unitPreference instead');

  const hunter = readFileSync(join(srcRoot, 'screens', 'hunter', 'HunterScreen.tsx'), 'utf8');
  assert.match(hunter, /state\.settings\?\.unitPreference \?\? 'kg'/);
});
