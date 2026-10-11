import { Platform } from 'react-native';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';
import { getSupabaseConfigState } from './config';
import { secureSessionStorage } from './secureStorage';

let cachedClient: SupabaseClient<Database> | null | undefined;
let warnedInvalid = false;

/**
 * Lazily constructs (and memoizes) the Supabase client on first call.
 * As of Phase 2.4, real call paths exist — App.tsx's deep-link handler
 * and bootstrap.ts's non-blocking `initializeAuth()` both reach this
 * indirectly via authSlice.ts — but the construction itself is still
 * fully lazy and still returns `null` without throwing when
 * unconfigured, so a device/build with no Supabase env vars set still
 * never constructs a client or makes any Supabase-related network
 * request: `getSupabaseConfigState()` short-circuits before
 * `createClient()` is ever reached. This is deliberate: the local app
 * must keep working identically whether or not Supabase is configured.
 *
 * Returns null (never throws) when configuration is absent or invalid —
 * callers must treat null as "cloud features unavailable," not as an
 * error to surface to the player.
 */
export function getSupabaseClient(): SupabaseClient<Database> | null {
  if (cachedClient !== undefined) {
    return cachedClient;
  }

  const state = getSupabaseConfigState();
  if (state.status !== 'configured') {
    if (state.status === 'invalid' && !warnedInvalid) {
      warnedInvalid = true;
      // Never logs the key/url values themselves — only the reason code.
      console.warn(`[supabase] cloud features disabled: ${state.reason}`);
    }
    cachedClient = null;
    return null;
  }

  cachedClient = createClient<Database>(state.url, state.anonKey, {
    auth: {
      // Phase 2.4: sign-in is real now, so a session can actually
      // exist — persist and auto-refresh it. Storage adapter differs
      // by platform: native (iOS/Android) has no `localStorage`, so
      // supabase-js's own default storage would fail/no-op there —
      // `secureSessionStorage` (Keychain/Keystore via expo-secure-store)
      // is passed explicitly. Web is left unset so supabase-js uses its
      // own default (browser `localStorage`), which already works
      // correctly there — passing a native-only adapter on web would be
      // actively wrong, not just redundant.
      persistSession: true,
      autoRefreshToken: true,
      // Web: lets supabase-js pick up a PKCE `code`/session fragment
      // from the URL itself (e.g. after a password-reset redirect).
      // Native: deep links are handled explicitly via `Linking` in
      // App.tsx instead — there is no "URL" to detect a session in on
      // a native app, so this is always false there.
      detectSessionInUrl: Platform.OS === 'web',
      ...(Platform.OS === 'web' ? {} : { storage: secureSessionStorage }),
    },
  });
  return cachedClient;
}

export { isSupabaseConfigured, getSupabaseConfigState } from './config';
export type { SupabaseConfigState, SupabaseConfigInvalidReason } from './config';
export type { Database } from './database.types';
