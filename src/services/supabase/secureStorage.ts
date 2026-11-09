import * as SecureStore from 'expo-secure-store';
import type { SupportedStorage } from '@supabase/supabase-js';
import { reportSessionStorageFailure, type SessionStorageOperation } from './storageHealth';

/**
 * `expo-secure-store`-backed session storage adapter (iOS Keychain /
 * Android Keystore) — used only on native platforms. Not used on web:
 * `SecureStore` is a native-only module, and supabase-js's own default
 * storage (browser `localStorage`) already works correctly there — see
 * `client.ts`, which only passes this adapter when `Platform.OS !==
 * 'web'`.
 *
 * Holds the Supabase session blob and the SDK's PKCE code verifiers
 * (`<storageKey>-code-verifier`, `<storageKey>-flow-<hex>-code-verifier`)
 * — all SecureStore-valid keys. Nothing else is ever written here.
 *
 * Size: expo-secure-store 57.0.4 (installed) no longer carries the old
 * 2048-byte value warning in its JS layer — re-checked against
 * node_modules this phase, superseding the Phase 2.4 note. Still
 * unverified on a physical device.
 *
 * Failures are caught (a storage error must never crash sign-in) but are
 * NOT silent: each one is reported through storageHealth.ts, and
 * authSlice tells the player their sign-in may not be remembered. The
 * console line carries only the operation and the error's message —
 * never the key's value (session tokens) or the value being written.
 */
function handleFailure(operation: SessionStorageOperation, error: unknown): void {
  const reason = error instanceof Error ? error.message : 'unknown error';
  console.warn(`[secureStorage] ${operation} failed: ${reason}`);
  reportSessionStorageFailure(operation);
}

export const secureSessionStorage: SupportedStorage = {
  getItem: async (key: string) => {
    try {
      return await SecureStore.getItemAsync(key);
    } catch (error) {
      handleFailure('read', error);
      return null;
    }
  },
  setItem: async (key: string, value: string) => {
    try {
      await SecureStore.setItemAsync(key, value);
    } catch (error) {
      handleFailure('write', error);
    }
  },
  removeItem: async (key: string) => {
    try {
      await SecureStore.deleteItemAsync(key);
    } catch (error) {
      handleFailure('remove', error);
    }
  },
};
