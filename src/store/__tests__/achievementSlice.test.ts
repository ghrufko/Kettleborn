import test from 'node:test';
import assert from 'node:assert/strict';

const SERVICES_PATH = new URL('../../services/index.ts', import.meta.url).href;
const SLICE_URL = new URL('../achievementSlice.ts', import.meta.url).href;

/**
 * Same minimal Zustand-shaped harness used by authSlice.test.ts /
 * settingsSlice.test.ts, with `get()` typed `any` (not `unknown`) — this
 * file's assertions read specific array properties/methods off the
 * result (`.length`, `.map`, `[0].milestoneType`), unlike those other
 * suites which only ever pass the whole object to `assert.deepEqual`.
 */
function makeHarness() {
  let state: Record<string, unknown> = {};
  const set = (patch: Record<string, unknown> | ((s: typeof state) => Record<string, unknown>)) => {
    state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
  };
  const get = (): any => state;
  return { set, get, seed: (initial: Record<string, unknown>) => { state = { ...state, ...initial }; } };
}

async function freshSlice() {
  return import(`${SLICE_URL}?bust=${Math.random()}`);
}

test('loadAchievements: populates state from the repository', async (t) => {
  const stored = [{ userId: 'local-hunter', milestoneType: 'first-victory', unlockedAt: '2026-01-01T00:00:00.000Z' }];
  t.mock.module(SERVICES_PATH, {
    exports: {
      AchievementRepository: {
        getAllForUser: async () => stored,
        unlock: async () => {},
      },
    },
  });
  const { createAchievementSlice } = await freshSlice();
  const h = makeHarness();
  const slice = createAchievementSlice(h.set as any, h.get as any, {} as any);
  h.seed(slice);

  await slice.loadAchievements();
  assert.deepEqual(h.get().achievements, stored);
});

test('unlockAchievements: a qualifying milestone is persisted once and reflected in state', async (t) => {
  const unlockCalls: unknown[] = [];
  t.mock.module(SERVICES_PATH, {
    exports: {
      AchievementRepository: {
        getAllForUser: async () => [],
        unlock: async (userId: string, milestoneType: string, unlockedAt: string) => {
          unlockCalls.push({ userId, milestoneType, unlockedAt });
        },
      },
    },
  });
  const { createAchievementSlice } = await freshSlice();
  const h = makeHarness();
  const slice = createAchievementSlice(h.set as any, h.get as any, {} as any);
  h.seed(slice);

  await slice.unlockAchievements(['first-victory'], '2026-01-01T00:00:00.000Z');

  assert.equal(unlockCalls.length, 1);
  assert.deepEqual(unlockCalls[0], {
    userId: 'local-hunter',
    milestoneType: 'first-victory',
    unlockedAt: '2026-01-01T00:00:00.000Z',
  });
  assert.equal(h.get().achievements.length, 1);
  assert.equal(h.get().achievements[0].milestoneType, 'first-victory');
});

test('unlockAchievements: calling again for an already-unlocked type in the SAME session never calls the repository again (in-memory guard)', async (t) => {
  let unlockCallCount = 0;
  t.mock.module(SERVICES_PATH, {
    exports: {
      AchievementRepository: {
        getAllForUser: async () => [],
        unlock: async () => {
          unlockCallCount += 1;
        },
      },
    },
  });
  const { createAchievementSlice } = await freshSlice();
  const h = makeHarness();
  const slice = createAchievementSlice(h.set as any, h.get as any, {} as any);
  h.seed(slice);

  await slice.unlockAchievements(['first-victory'], '2026-01-01T00:00:00.000Z');
  await slice.unlockAchievements(['first-victory'], '2026-01-02T00:00:00.000Z');

  assert.equal(unlockCallCount, 1, 'repository.unlock should only be called once for the same type');
  assert.equal(h.get().achievements.length, 1);
  // The original timestamp is preserved — the second call never overwrites it.
  assert.equal(h.get().achievements[0].unlockedAt, '2026-01-01T00:00:00.000Z');
});

test('unlockAchievements: duplicate types within the SAME call are also de-duplicated', async (t) => {
  let unlockCallCount = 0;
  t.mock.module(SERVICES_PATH, {
    exports: {
      AchievementRepository: {
        getAllForUser: async () => [],
        unlock: async () => {
          unlockCallCount += 1;
        },
      },
    },
  });
  const { createAchievementSlice } = await freshSlice();
  const h = makeHarness();
  const slice = createAchievementSlice(h.set as any, h.get as any, {} as any);
  h.seed(slice);

  await slice.unlockAchievements(['first-victory', 'first-victory'], '2026-01-01T00:00:00.000Z');

  assert.equal(unlockCallCount, 1);
  assert.equal(h.get().achievements.length, 1);
});

test('unlockAchievements: a type already present in loaded state (from a prior session) is never re-persisted', async (t) => {
  let unlockCallCount = 0;
  t.mock.module(SERVICES_PATH, {
    exports: {
      AchievementRepository: {
        getAllForUser: async () => [],
        unlock: async () => {
          unlockCallCount += 1;
        },
      },
    },
  });
  const { createAchievementSlice } = await freshSlice();
  const h = makeHarness();
  const slice = createAchievementSlice(h.set as any, h.get as any, {} as any);
  h.seed(slice);
  // Simulate an achievement already loaded from SQLite at bootstrap, in a
  // prior session/reload.
  h.seed({
    achievements: [{ userId: 'local-hunter', milestoneType: 'first-victory', unlockedAt: '2025-12-01T00:00:00.000Z' }],
  });

  await slice.unlockAchievements(['first-victory'], '2026-01-01T00:00:00.000Z');

  assert.equal(unlockCallCount, 0, 'already-unlocked type from a prior session must never be re-persisted');
  assert.equal(h.get().achievements.length, 1);
  assert.equal(h.get().achievements[0].unlockedAt, '2025-12-01T00:00:00.000Z');
});

test('unlockAchievements: unlocking several different new types in one call persists each of them', async (t) => {
  const unlockedTypes: string[] = [];
  t.mock.module(SERVICES_PATH, {
    exports: {
      AchievementRepository: {
        getAllForUser: async () => [],
        unlock: async (userId: string, milestoneType: string) => {
          unlockedTypes.push(milestoneType);
        },
      },
    },
  });
  const { createAchievementSlice } = await freshSlice();
  const h = makeHarness();
  const slice = createAchievementSlice(h.set as any, h.get as any, {} as any);
  h.seed(slice);

  await slice.unlockAchievements(['first-victory', 'first-level-up'], '2026-01-01T00:00:00.000Z');

  assert.deepEqual(unlockedTypes.sort(), ['first-level-up', 'first-victory']);
  assert.equal(h.get().achievements.length, 2);
});

test('unlockAchievements: a storage failure for one type is never reflected as unlocked in state (honest failure handling)', async (t) => {
  t.mock.module(SERVICES_PATH, {
    exports: {
      AchievementRepository: {
        getAllForUser: async () => [],
        unlock: async () => {
          throw new Error('disk full');
        },
      },
    },
  });
  const { createAchievementSlice } = await freshSlice();
  const h = makeHarness();
  const slice = createAchievementSlice(h.set as any, h.get as any, {} as any);
  h.seed(slice);

  // unlockAchievements itself must not throw — a storage failure here
  // must never take down the Hunt-completion flow that calls it.
  await assert.doesNotReject(() => slice.unlockAchievements(['first-victory'], '2026-01-01T00:00:00.000Z'));
  assert.equal(h.get().achievements.length, 0, 'a failed persist must never be reflected as unlocked');
});

test('unlockAchievements: a storage failure for one type does not block the others in the same batch from succeeding', async (t) => {
  t.mock.module(SERVICES_PATH, {
    exports: {
      AchievementRepository: {
        getAllForUser: async () => [],
        unlock: async (userId: string, milestoneType: string) => {
          if (milestoneType === 'first-victory') {
            throw new Error('disk full');
          }
        },
      },
    },
  });
  const { createAchievementSlice } = await freshSlice();
  const h = makeHarness();
  const slice = createAchievementSlice(h.set as any, h.get as any, {} as any);
  h.seed(slice);

  await slice.unlockAchievements(['first-victory', 'first-level-up'], '2026-01-01T00:00:00.000Z');

  const types = h.get().achievements.map((a: any) => a.milestoneType);
  assert.ok(!types.includes('first-victory'), 'the failed type must not appear as unlocked');
  assert.ok(types.includes('first-level-up'), 'the succeeding type must still be recorded');
});

test('unlockAchievements: an empty types array is a no-op', async (t) => {
  let unlockCallCount = 0;
  t.mock.module(SERVICES_PATH, {
    exports: {
      AchievementRepository: {
        getAllForUser: async () => [],
        unlock: async () => {
          unlockCallCount += 1;
        },
      },
    },
  });
  const { createAchievementSlice } = await freshSlice();
  const h = makeHarness();
  const slice = createAchievementSlice(h.set as any, h.get as any, {} as any);
  h.seed(slice);

  await slice.unlockAchievements([], '2026-01-01T00:00:00.000Z');

  assert.equal(unlockCallCount, 0);
  assert.equal(h.get().achievements.length, 0);
});
