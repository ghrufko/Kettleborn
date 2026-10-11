import test from 'node:test';
import assert from 'node:assert/strict';

const SERVICES_PATH = new URL('../../services/index.ts', import.meta.url).href;
const SLICE_URL = new URL('../settingsSlice.ts', import.meta.url).href;

/** Same minimal Zustand-shaped harness used by authSlice.test.ts. */
function makeHarness() {
  let state: Record<string, unknown> = {};
  const set = (patch: Record<string, unknown> | ((s: typeof state) => Record<string, unknown>)) => {
    state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
  };
  const get = () => state;
  return { set, get, seed: (initial: Record<string, unknown>) => { state = { ...state, ...initial }; } };
}

async function freshSlice() {
  return import(`${SLICE_URL}?bust=${Math.random()}`);
}

test('saveEquipment: creating (no id given) generates a new id and persists owned:true, unit:kg', async (t) => {
  const upserted: unknown[] = [];
  t.mock.module(SERVICES_PATH, {
    exports: {
      SettingsRepository: {
        upsertEquipment: async (equipment: unknown) => {
          upserted.push(equipment);
        },
        getEquipmentForUser: async () => upserted,
      },
    },
  });
  const { createSettingsSlice } = await freshSlice();
  const h = makeHarness();
  const slice = createSettingsSlice(h.set as any, h.get as any, {} as any);
  h.seed(slice);

  await slice.saveEquipment({ type: 'kettlebell', weightKg: 20, label: '20 KG' });
  assert.equal(upserted.length, 1);
  const saved = upserted[0] as any;
  assert.equal(saved.type, 'kettlebell');
  assert.equal(saved.weight, 20);
  assert.equal(saved.label, '20 KG');
  assert.equal(saved.unit, 'kg');
  assert.equal(saved.owned, true);
  assert.ok(typeof saved.id === 'string' && saved.id.startsWith('equipment-'), `got id=${saved.id}`);
  assert.deepEqual(h.get().equipment, upserted);
});

test('saveEquipment: updating (id given) reuses that exact id, does not generate a new one', async (t) => {
  const upserted: unknown[] = [];
  t.mock.module(SERVICES_PATH, {
    exports: {
      SettingsRepository: {
        upsertEquipment: async (equipment: unknown) => {
          upserted.push(equipment);
        },
        getEquipmentForUser: async () => upserted,
      },
    },
  });
  const { createSettingsSlice } = await freshSlice();
  const h = makeHarness();
  const slice = createSettingsSlice(h.set as any, h.get as any, {} as any);
  h.seed(slice);

  await slice.saveEquipment({ id: 'kb-1', type: 'kettlebell', weightKg: 24, label: 'Heavy Bell' });
  assert.equal((upserted[0] as any).id, 'kb-1');
  assert.equal((upserted[0] as any).weight, 24);
  assert.equal((upserted[0] as any).label, 'Heavy Bell');
});

test('deleteEquipment: calls the repository delete and refreshes local state', async (t) => {
  let deletedId: string | null = null;
  const remaining = [{ id: 'kb-2', userId: 'local-hunter', type: 'kettlebell', weight: 16, unit: 'kg', label: '16 KG', owned: true }];
  t.mock.module(SERVICES_PATH, {
    exports: {
      SettingsRepository: {
        deleteEquipment: async (id: string) => {
          deletedId = id;
        },
        getEquipmentForUser: async () => remaining,
      },
    },
  });
  const { createSettingsSlice } = await freshSlice();
  const h = makeHarness();
  const slice = createSettingsSlice(h.set as any, h.get as any, {} as any);
  h.seed(slice);

  await slice.deleteEquipment('kb-1');
  assert.equal(deletedId, 'kb-1');
  assert.deepEqual(h.get().equipment, remaining);
});

test('saveEquipment: a repository failure propagates rather than being swallowed', async (t) => {
  t.mock.module(SERVICES_PATH, {
    exports: {
      SettingsRepository: {
        upsertEquipment: async () => {
          throw new Error('disk full');
        },
        getEquipmentForUser: async () => [],
      },
    },
  });
  const { createSettingsSlice } = await freshSlice();
  const h = makeHarness();
  const slice = createSettingsSlice(h.set as any, h.get as any, {} as any);
  h.seed(slice);

  await assert.rejects(() => slice.saveEquipment({ type: 'kettlebell', weightKg: 16, label: '16 KG' }), /disk full/);
});
