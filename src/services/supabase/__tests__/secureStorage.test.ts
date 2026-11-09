import test from 'node:test';
import assert from 'node:assert/strict';

const SECURE_STORAGE_URL = new URL('../secureStorage.ts', import.meta.url).href;
const STORAGE_HEALTH_URL = new URL('../storageHealth.ts', import.meta.url).href;

const SESSION_VALUE = JSON.stringify({ access_token: 'eyJ.secret.token', refresh_token: 'v1.secret-refresh' });

async function load(t: any, secureStore: Record<string, unknown>) {
  t.mock.module('expo-secure-store', { exports: secureStore });
  const { secureSessionStorage } = await import(`${SECURE_STORAGE_URL}?bust=${Math.random()}`);
  // Same module instance secureStorage.ts imports (no cache-bust).
  const { onSessionStorageFailure } = await import(STORAGE_HEALTH_URL);
  const reported: string[] = [];
  const unsubscribe = onSessionStorageFailure((op: string) => reported.push(op));
  t.after(unsubscribe);
  const warn = t.mock.method(console, 'warn', () => undefined);
  return { storage: secureSessionStorage, reported, warn };
}

test('a write failure does not throw, is reported (not silent), and never logs the session value', async (t) => {
  const { storage, reported, warn } = await load(t, {
    setItemAsync: async () => {
      throw new Error('Keystore unavailable');
    },
  });
  await assert.doesNotReject(storage.setItem('sb-ref-auth-token', SESSION_VALUE));
  assert.deepEqual(reported, ['write']);
  const logged = warn.mock.calls.map((c: any) => c.arguments.join(' ')).join('\n');
  assert.match(logged, /write failed: Keystore unavailable/);
  assert.equal(logged.includes('secret'), false);
});

test('a read failure returns null (no session) and is reported', async (t) => {
  const { storage, reported } = await load(t, {
    getItemAsync: async () => {
      throw new Error('User authentication required');
    },
  });
  assert.equal(await storage.getItem('sb-ref-auth-token'), null);
  assert.deepEqual(reported, ['read']);
});

test('a remove failure (e.g. during sign-out) is reported', async (t) => {
  const { storage, reported } = await load(t, {
    deleteItemAsync: async () => {
      throw new Error('Keychain locked');
    },
  });
  await storage.removeItem('sb-ref-auth-token');
  assert.deepEqual(reported, ['remove']);
});

test('healthy storage reports nothing and round-trips values', async (t) => {
  const store = new Map<string, string>();
  const { storage, reported, warn } = await load(t, {
    getItemAsync: async (k: string) => store.get(k) ?? null,
    setItemAsync: async (k: string, v: string) => {
      store.set(k, v);
    },
    deleteItemAsync: async (k: string) => {
      store.delete(k);
    },
  });
  await storage.setItem('sb-ref-auth-token', SESSION_VALUE);
  assert.equal(await storage.getItem('sb-ref-auth-token'), SESSION_VALUE);
  await storage.removeItem('sb-ref-auth-token');
  assert.equal(await storage.getItem('sb-ref-auth-token'), null);
  assert.deepEqual(reported, []);
  assert.equal(warn.mock.callCount(), 0);
});
