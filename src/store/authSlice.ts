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
  onSessionStorageFailure,
  startAutoRefreshLifecycle,
  getInitialWebAuthCallback,
  clearWebAuthCallbackUrl,
  type AppAuthUser,
  type Unsubscribe,
} from '../services/supabase/auth';
import {
  isExpiredLinkErrorCode,
  parseAuthCallbackUrl,
  type AuthCallback,
  type AuthCallbackRoute,
} from '../utils/authCallback';
import type { AppStore, AuthNotice, AuthSlice } from './types';

/**
 * Module-scoped, not store state: the registrations initializeAuth()
 * makes exactly once per app run, and the in-flight/settled promise every
 * later call returns. Guards against re-registering anything when
 * bootstrap is retried after a local SQLite failure (App.tsx's
 * ErrorScreen onRetry re-runs bootstrapApp()).
 */
let activeUnsubscribe: Unsubscribe | null = null;
let stopAutoRefreshLifecycle: Unsubscribe | null = null;
let stopStorageFailureListener: Unsubscribe | null = null;
let initializePromise: Promise<void> | null = null;
/** Deep-link URLs already handled this run — an auth code is single-use, so a duplicate delivery (cold-start getInitialURL plus a 'url' event) must not be exchanged twice and reported as "already used". */
const handledCallbackUrls = new Set<string>();

const STORAGE_FAILURE_NOTICE: AuthNotice = {
  tone: 'error',
  title: 'Sign-In Not Saved',
  message:
    "This device couldn't access its secure storage for your sign-in. You may need to sign in again next time you open Kettleborn.",
};

const EMAIL_CONFIRMED_NOTICE: AuthNotice = {
  tone: 'info',
  title: 'Email Confirmed',
  message: "Your email is confirmed and you're signed in.",
};

function linkProblemNotice(route: AuthCallbackRoute, expired: boolean): AuthNotice {
  if (route === 'reset-password') {
    return expired
      ? {
          tone: 'error',
          title: 'Reset Link Expired',
          message:
            'This password reset link has expired or was already used. Request a new one from Sign In → Forgot password?',
        }
      : {
          tone: 'error',
          title: 'Reset Link Not Valid',
          message:
            "This password reset link can't be used here. Request a new one from Sign In → Forgot password? and open it on this device.",
        };
  }
  if (route === 'confirm-email') {
    return expired
      ? {
          tone: 'error',
          title: 'Confirmation Link Expired',
          message:
            "This confirmation link has expired or was already used. If you've already confirmed your email, sign in. Otherwise request a new confirmation email from Sign In.",
        }
      : {
          tone: 'error',
          title: 'Confirmation Not Completed',
          message:
            "We couldn't sign you in from this link. If you've already confirmed your email, sign in with your password. Otherwise request a new confirmation email from Sign In.",
        };
  }
  return {
    tone: 'error',
    title: 'Link Not Valid',
    message: expired
      ? 'This link has expired or was already used. Request a new one.'
      : 'This link is invalid or can no longer be used. Request a new one.',
  };
}

const NETWORK_LINK_NOTICE: AuthNotice = {
  tone: 'error',
  title: 'Connection Problem',
  message: "Couldn't reach the server to finish this link. Check your connection and open the link again.",
};

export const createAuthSlice: StateCreator<AppStore, [], [], AuthSlice> = (set, get) => {
  /**
   * Web only: completes the email-link callback the page was opened with.
   * By the time this runs, supabase-js (detectSessionInUrl) has already
   * consumed any `#access_token=…` fragment and saved the session — the
   * `session` argument is what getSession() then returned. The SDK
   * deliberately keeps an existing session when the URL carries an error,
   * and never surfaces that error through getSession(), so error links
   * are reported from the parsed URL here.
   */
  const applyWebCallback = (callback: AuthCallback, session: AppAuthUser | null) => {
    if (callback.kind === 'error') {
      set({ authNotice: linkProblemNotice(callback.route, isExpiredLinkErrorCode(callback.errorCode)) });
      return;
    }
    if (callback.kind === 'pkce') {
      // Web uses the implicit flow, so the SDK ignores a ?code= link it
      // has no verifier for — most likely a link requested from the app.
      set({ authNotice: linkProblemNotice(callback.route, false) });
      return;
    }
    if (!session) {
      // Tokens were in the URL but no session resulted (the SDK rejected
      // them, e.g. a stale or tampered link).
      set({ authNotice: linkProblemNotice(callback.route, false) });
      return;
    }
    const isRecovery =
      callback.type === 'recovery' || (callback.type === null && callback.route === 'reset-password');
    if (isRecovery) {
      set({ passwordRecoveryPending: true });
      return;
    }
    set({ authNotice: EMAIL_CONFIRMED_NOTICE });
  };

  const runInitialize = async () => {
    if (!isAuthAvailable()) {
      set({ authStatus: 'unavailable', authUser: null });
      return;
    }

    if (!activeUnsubscribe) {
      activeUnsubscribe = onAuthStateChange((event, user) => {
        if (event === 'PASSWORD_RECOVERY') {
          // A real recovery session now exists, but the app must show
          // UpdatePasswordScreen instead of normal navigation.
          // authStatus still reflects the real session state
          // (signed_in) — passwordRecoveryPending is the separate signal
          // App.tsx branches on.
          set({ authUser: user, authStatus: 'signed_in', passwordRecoveryPending: true });
          return;
        }
        if (event === 'SIGNED_OUT') {
          set({ authUser: null, authStatus: 'signed_out', passwordRecoveryPending: false });
          return;
        }
        // Reflects real auth-state changes (sign-in elsewhere, token
        // refresh, etc.) regardless of which slice action (if any)
        // triggered them — the listener is the source of truth.
        set({ authUser: user, authStatus: user ? 'signed_in' : 'signed_out' });
      });
    }
    if (!stopStorageFailureListener) {
      stopStorageFailureListener = onSessionStorageFailure(() => {
        // Never replace a notice the player hasn't dismissed yet — a
        // burst of failed storage calls should produce one message.
        if (!get().authNotice) {
          set({ authNotice: STORAGE_FAILURE_NOTICE });
        }
      });
    }
    if (!stopAutoRefreshLifecycle) {
      stopAutoRefreshLifecycle = startAutoRefreshLifecycle();
    }

    const webCallback = getInitialWebAuthCallback();
    const result = await getSession();
    if (!result.ok) {
      // A real error trying to determine session state — not the same
      // as "no session." Local play is never blocked by this either way.
      set({ authStatus: 'signed_out', authUser: null, authError: result.error });
    } else {
      set({
        authStatus: result.data ? 'signed_in' : 'signed_out',
        authUser: result.data,
        authError: null,
      });
    }

    if (webCallback) {
      applyWebCallback(webCallback, result.ok ? result.data : null);
      clearWebAuthCallbackUrl();
    }
  };

  return {
    authStatus: 'hydrating',
    authUser: null,
    authError: null,
    authNotice: null,
    passwordRecoveryPending: false,

    initializeAuth: () => {
      if (!initializePromise) {
        // runInitialize never rejects in practice (every service call
        // returns a result object); the catch is defense-in-depth so a
        // stray throw can never leave the store stuck in 'hydrating'.
        initializePromise = runInitialize().catch(() => {
          set({ authStatus: 'signed_out', authUser: null });
        });
      }
      return initializePromise;
    },

    handleAuthCallbackUrl: async (url) => {
      const callback = parseAuthCallbackUrl(url);
      if (!callback || handledCallbackUrls.has(url)) {
        return;
      }
      handledCallbackUrls.add(url);

      // Session restoration must settle first: otherwise its getSession()
      // (read before the exchange) could land after the exchange and
      // overwrite the link's signed-in result with signed_out.
      await get().initializeAuth();
      if (get().authStatus === 'unavailable') {
        return;
      }

      if (callback.kind === 'error') {
        set({ authNotice: linkProblemNotice(callback.route, isExpiredLinkErrorCode(callback.errorCode)) });
        return;
      }
      if (callback.kind === 'implicit') {
        // Native requests PKCE links only; a token-bearing link here was
        // not produced by this app's own request.
        set({ authNotice: linkProblemNotice(callback.route, false) });
        return;
      }

      const result =
        callback.route === 'reset-password'
          ? await get().handlePasswordRecoveryLink(callback.code)
          : callback.route === 'confirm-email'
            ? await get().handleEmailConfirmationLink(callback.code)
            : null;
      if (result && !result.ok && result.error.reason === 'network_error') {
        // The code was never consumed — let the player reopen the link.
        handledCallbackUrls.delete(url);
      }
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
      // onAuthStateChange listener reflects the real outcome if a session
      // was actually issued; this only sets the interim state so the UI
      // isn't stuck "signing up."
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
      if (result.ok) {
        set({ authStatus: 'signed_out', authUser: null, authError: null, passwordRecoveryPending: false });
        return result;
      }
      // The SDK removes the local session even when the server call fails
      // (see signOut() in auth.ts) — re-check instead of assuming either
      // way, so the UI never claims a state the device isn't in.
      const after = await getSession();
      if (after.ok && after.data === null) {
        set({
          authStatus: 'signed_out',
          authUser: null,
          authError: null,
          passwordRecoveryPending: false,
          authNotice: {
            tone: 'info',
            title: 'Signed Out',
            message:
              "You're signed out on this device. We couldn't reach the server, so other devices may stay signed in until their sessions expire.",
          },
        });
        return { ok: true, data: undefined };
      }
      // Still signed in locally — report the failure, keep the user.
      set({ authStatus: 'signed_in', authError: result.error });
      return result;
    },

    handlePasswordRecoveryLink: async (code) => {
      const result = await exchangeCodeForSession(code);
      if (!result.ok) {
        set({
          authError: result.error,
          authNotice:
            result.error.reason === 'network_error'
              ? NETWORK_LINK_NOTICE
              : linkProblemNotice('reset-password', result.error.reason === 'link_expired'),
        });
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
        set({
          authError: result.error,
          authNotice:
            result.error.reason === 'network_error'
              ? NETWORK_LINK_NOTICE
              : linkProblemNotice('confirm-email', result.error.reason === 'link_expired'),
        });
        return result;
      }
      // Deliberately does NOT set passwordRecoveryPending — this is a
      // signup confirmation, not a password-recovery session.
      set({ authUser: result.data, authStatus: 'signed_in', authError: null, authNotice: EMAIL_CONFIRMED_NOTICE });
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

    dismissAuthNotice: () => set({ authNotice: null }),
  };
};
