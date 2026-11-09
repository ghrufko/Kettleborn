import { AppState, Platform } from 'react-native';

/**
 * The only module in the auth layer that touches `react-native` platform
 * APIs directly. auth.ts imports these instead of `react-native` itself,
 * which keeps auth.ts loadable (and mockable) under plain `node --test`.
 */

/**
 * Captured once, at module load — i.e. at app start, before the Supabase
 * client exists. On web, supabase-js's `detectSessionInUrl` clears a
 * successful implicit-flow `#access_token=...&type=...` fragment from the
 * address bar while it initializes, so reading `window.location.href`
 * any later would lose the `type` (recovery vs signup) the app needs to
 * route the user. Always null on native, where callbacks arrive through
 * `Linking` instead.
 */
const INITIAL_WEB_URL: string | null =
  Platform.OS === 'web' && typeof window !== 'undefined' && window.location
    ? window.location.href
    : null;

export function isWebPlatform(): boolean {
  return Platform.OS === 'web';
}

/** The deployed site's own origin (e.g. https://animated-pixie-b97fbb.netlify.app) on web; null on native. */
export function getWebOrigin(): string | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined' || !window.location) {
    return null;
  }
  return window.location.origin || null;
}

export function getInitialWebUrl(): string | null {
  return INITIAL_WEB_URL;
}

/**
 * Removes a handled auth callback (path, query and fragment) from the
 * browser address bar so a reload never re-processes it. The app has no
 * URL-based routing (NavigationContainer has no `linking` config), so the
 * site root is always the correct place to land.
 */
export function replaceWebUrlWithRoot(): void {
  if (Platform.OS !== 'web' || typeof window === 'undefined' || !window.history?.replaceState) {
    return;
  }
  window.history.replaceState(window.history.state, '', '/');
}

export function isAppActive(): boolean {
  return AppState.currentState === 'active';
}

export function subscribeToAppActive(listener: (active: boolean) => void): () => void {
  const subscription = AppState.addEventListener('change', (state) => listener(state === 'active'));
  return () => subscription.remove();
}
