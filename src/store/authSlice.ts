import type { StateCreator } from 'zustand';
import {
  signUp as doSignUp,
  signIn as doSignIn,
  signOut as doSignOut,
  getSession,
  onAuthStateChange,
  isAuthAvailable,
  exchangeCodeForSession,
  updatePassword,
  type Unsubscribe,
} from '../services/supabase/auth';
import type { AppStore, AuthSlice } from './types';

/**
 * Module-scoped, not store state: the active GoTrue listener's unsubscribe
 * function, if one has been registered. Guards initializeAuth() against
 * registering a second listener if it's ever called more than once (e.g.
 * App.tsx's ErrorScreen onRetry re-running bootstrapApp() after a local
 * SQLite failure) — see Phase 2.2's bootstrap-integration requirement
 * that listener registration must not accumulate.
 */
let activeUnsubscribe: Unsubscribe | null = null;

export const createAuthSlice: StateCreator<AppStore, [], [], AuthSlice> = (set, get) => ({
  authStatus: 'hydrating',
  authUser: null,
  authError: null,
  passwordRecoveryPending: false,

  initializeAuth: async () => {
    if (!isAuthAvailable()) {
      set({ authStatus: 'unavailable', authUser: null });
      return;
    }

    if (!activeUnsubscribe) {
      activeUnsubscribe = onAuthStateChange((event, user) => {
        if (event === 'PASSWORD_RECOVERY') {
          // A real session now exists (the recovery link's code was
          // already exchanged for one — see handlePasswordRecoveryLink),
          // but the app must show UpdatePasswordScreen instead of normal
          // navigation. authStatus still reflects the real session state
          // (signed_in) — passwordRecoveryPending is the separate signal
          // App.tsx branches on.
          set({ authUser: user, authStatus: 'signed_in', passwordRecoveryPending: true });
          return;
        }
        // Reflects real auth-state changes (sign-in elsewhere, token
        // refresh failure, etc.) regardless of which slice action (if
        // any) triggered them — the listener is the source of truth,
        // not a side-channel the actions below need to duplicate.
        set({ authUser: user, authStatus: user ? 'signed_in' : 'signed_out' });
      });
    }

    const result = await getSession();
    if (!result.ok) {
      // A real error trying to determine session state — not the same
      // as "no session." Local play is never blocked by this either way
      // (see store/bootstrap.ts: this call is never awaited by startup).
      set({ authStatus: 'signed_out', authUser: null, authError: result.error });
      return;
    }
    set({
      authStatus: result.data ? 'signed_in' : 'signed_out',
      authUser: result.data,
      authError: null,
    });
  },

  authSignUp: async (email, password) => {
    if (get().authStatus === 'signing_up' || get().authStatus === 'signing_in') {
      return {
        ok: false,
        error: { reason: 'unknown', message: 'An authentication request is already in progress.' },
      };
    }
    set({ authStatus: 'signing_up', authError: null });
    const result = await doSignUp(email, password);
    if (!result.ok) {
      set({ authStatus: 'signed_out', authError: result.error });
      return result;
    }
    // A session may or may not exist yet (email confirmation). The
    // onAuthStateChange listener (registered in initializeAuth) will
    // reflect the real outcome if a session was actually issued; this
    // only sets the interim state so the UI isn't stuck "signing up."
    set({
      authStatus: result.data.emailConfirmationRequired ? 'signed_out' : 'signed_in',
      authUser: result.data.emailConfirmationRequired ? null : result.data.user,
      authError: null,
    });
    return result;
  },

  authSignIn: async (email, password) => {
    if (get().authStatus === 'signing_up' || get().authStatus === 'signing_in') {
      return {
        ok: false,
        error: { reason: 'unknown', message: 'An authentication request is already in progress.' },
      };
    }
    set({ authStatus: 'signing_in', authError: null });
    const result = await doSignIn(email, password);
    if (!result.ok) {
      set({ authStatus: 'signed_out', authError: result.error });
      return result;
    }
    set({ authStatus: 'signed_in', authUser: result.data, authError: null });
    return result;
  },

  authSignOut: async () => {
    set({ authStatus: 'signing_out', authError: null });
    const result = await doSignOut();
    if (!result.ok) {
      // Does not claim success — the remote session's actual state is
      // unknown/unchanged, so the previous authUser is preserved rather
      // than optimistically cleared.
      set({ authStatus: 'signed_in', authError: result.error });
      return result;
    }
    set({ authStatus: 'signed_out', authUser: null, authError: null });
    return result;
  },

  handlePasswordRecoveryLink: async (code) => {
    const result = await exchangeCodeForSession(code);
    if (!result.ok) {
      set({ authError: result.error });
      return result;
    }
    // The onAuthStateChange listener above also fires PASSWORD_RECOVERY
    // for this same session and sets passwordRecoveryPending — set it
    // here too so the UI updates immediately even if that listener
    // callback hasn't run yet (no dependency on event-delivery timing).
    set({ authUser: result.data, authStatus: 'signed_in', passwordRecoveryPending: true, authError: null });
    return result;
  },

  handleEmailConfirmationLink: async (code) => {
    const result = await exchangeCodeForSession(code);
    if (!result.ok) {
      set({ authError: result.error });
      return result;
    }
    // Deliberately does NOT set passwordRecoveryPending — this is a
    // signup confirmation, not a password-recovery session. GoTrue fires
    // a plain SIGNED_IN (not PASSWORD_RECOVERY) event for it, so the
    // onAuthStateChange listener's default branch already lands the user
    // in normal signed-in state; this just applies that immediately
    // rather than waiting on the listener callback.
    set({ authUser: result.data, authStatus: 'signed_in', authError: null });
    return result;
  },

  completePasswordRecovery: async (newPassword) => {
    const result = await updatePassword(newPassword);
    if (!result.ok) {
      // Left true deliberately — the user is still in the recovery flow
      // and should be able to retry with a different password.
      set({ authError: result.error });
      return result;
    }
    set({ passwordRecoveryPending: false, authError: null });
    return result;
  },

  cancelPasswordRecovery: () => set({ passwordRecoveryPending: false }),

  clearAuthError: () => set({ authError: null }),
});
