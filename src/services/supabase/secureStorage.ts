import * as SecureStore from 'expo-secure-store';
import type { SupportedStorage } from '@supabase/supabase-js';

/**
 * `expo-secure-store`-backed session storage adapter (iOS Keychain /
 * Android Keystore) — used only on native platforms. Not used on web:
 * `SecureStore` is a native-only module, and supabase-js's own default
 * storage (browser `localStorage`) already works correctly there — see
 * `client.ts`, which only passes this adapter when `Platform.OS !==
 * 'web'`.
 *
 * Known limitation, not addressed here: some Android Keystore
 * configurations cap a single stored value around 2048 bytes. A
 * Supabase session is usually well under that, but if it ever isn't,
 * `setItem` below fails safely (caught, logged, swallowed) rather than
 * crashing the app — the session simply won't persist that one time,
 * the same practical outcome `persistSession: false` already had.
 * Supabase's own docs describe a chunked/encrypted "LargeSecureStore"
 * wrapper (via `aes-js`) for this exact edge case; not implemented
 * here, since it requires a new dependency whose necessity cannot be
 * verified without a real device test — see
 * supabase/PHASE_2_4_AUTH_IMPLEMENTATION.md for this trade-off and
 * what would trigger revisiting it.
 *
 * Never used to store anything but the Supabase session blob itself —
 * no password, no privileged key, nothing else is ever written here.
 */
export const secureSessionStorage: SupportedStorage = {
  getItem: async (key: string) => {
    try {
      return await SecureStore.getItemAsync(key);
    } catch (error) {
      console.warn('[secureStorage] getItem failed', error);
      return null;
    }
  },
  setItem: async (key: string, value: string) => {
    try {
      await SecureStore.setItemAsync(key, value);
    } catch (error) {
      console.warn('[secureStorage] setItem failed — session will not persist this time', error);
    }
  },
  removeItem: async (key: string) => {
    try {
      await SecureStore.deleteItemAsync(key);
    } catch (error) {
      console.warn('[secureStorage] removeItem failed', error);
    }
  },
};
