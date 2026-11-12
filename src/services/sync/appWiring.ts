import { AppState } from 'react-native';
import { useAppStore } from '../../store';
import { isSupabaseConfigured } from '../supabase/config';
import { createSupabaseTransport } from './supabaseTransport';
import { isSyncFeatureEnabled, setAccountDeleter, setSyncTransport } from './runtime';
import { deleteMyCloudAccount } from '../supabase/account';

let started = false;

/**
 * Called once by App.tsx after local bootstrap succeeds. Does nothing
 * unless the build enables sync (EXPO_PUBLIC_SYNC_ENABLED=true) and
 * Supabase is configured — today neither build does, so this is inert.
 * Follows the signed-in account (sign-in, sign-out, switch) and syncs when
 * the app returns to the foreground.
 */
export function startCloudSync(): void {
  if (started || !isSyncFeatureEnabled() || !isSupabaseConfigured()) return;
  started = true;
  setSyncTransport(createSupabaseTransport());
  setAccountDeleter(deleteMyCloudAccount);
  const current = () => useAppStore.getState().authUser?.id ?? null;
  let lastUser: string | null = current();
  void useAppStore.getState().handleAuthUser(lastUser);
  useAppStore.subscribe((state) => {
    const next = state.authUser?.id ?? null;
    if (next !== lastUser) {
      lastUser = next;
      void state.handleAuthUser(next);
    }
  });
  AppState.addEventListener('change', (status) => {
    if (status === 'active') useAppStore.getState().requestSync();
  });
}
