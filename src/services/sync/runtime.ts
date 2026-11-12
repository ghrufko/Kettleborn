import type { SyncTransport } from './engine';

/**
 * Cloud sync is OFF unless the build sets EXPO_PUBLIC_SYNC_ENABLED=true —
 * no build does yet. With it off, nothing links, nothing uploads, and the
 * queue stays inactive; the app behaves exactly as an offline install.
 * The transport is injected at app start (appWiring.ts), never imported
 * here, so this module and the store load in tests without a network stack.
 */
let transport: SyncTransport | null = null;
let forcedForTests: boolean | null = null;

export function isSyncFeatureEnabled(): boolean {
  if (forcedForTests !== null) return forcedForTests;
  return process.env.EXPO_PUBLIC_SYNC_ENABLED === 'true';
}

export function setSyncFeatureEnabledForTests(enabled: boolean | null): void {
  forcedForTests = enabled;
}

export function setSyncTransport(next: SyncTransport | null): void {
  transport = next;
}

export function getSyncTransport(): SyncTransport | null {
  return transport;
}

/** Deletes the signed-in player's cloud account (the delete-account Edge Function); injected like the transport. */
export type AccountDeleter = () => Promise<{ ok: true } | { ok: false; error: string }>;
let accountDeleter: AccountDeleter | null = null;

export function setAccountDeleter(next: AccountDeleter | null): void {
  accountDeleter = next;
}

export function getAccountDeleter(): AccountDeleter | null {
  return accountDeleter;
}
