import type { AuthError, Session } from '@supabase/supabase-js';
import { isAuthError, isAuthRetryableFetchError } from '@supabase/supabase-js';
import { getSupabaseClient } from './client';
import { isSupabaseConfigured } from './config';
import {
  getInitialWebUrl,
  getWebOrigin,
  isAppActive,
  isWebPlatform,
  replaceWebUrlWithRoot,
  subscribeToAppActive,
} from './platform';
import { parseAuthCallbackUrl, type AuthCallback } from '../../utils/authCallback';

export { onSessionStorageFailure } from './storageHealth';
export type { SessionStorageOperation } from './storageHealth';

/**
 * Closed set of application-facing failure reasons. UI code switches on
 * this, never on a raw Supabase/GoTrue error code or message — see
 * mapAuthError() below for the only place SDK error shapes are read.
 */
export type AuthErrorReason =
  | 'invalid_credentials'
  | 'invalid_email'
  | 'weak_password'
  | 'email_not_confirmed'
  | 'already_registered'
  | 'rate_limited'
  | 'link_expired'
  | 'link_invalid'
  | 'email_not_authorized'
  | 'signups_disabled'
  | 'same_password'
  | 'session_expired'
  | 'reauthentication_needed'
  | 'network_error'
  | 'not_configured'
  | 'unknown';

export interface AuthFailure {
  reason: AuthErrorReason;
  /** Safe to show directly to the player. Never the raw SDK message. */
  message: string;
}

export type AuthResult<T> = { ok: true; data: T } | { ok: false; error: AuthFailure };

/** Minimal, app-facing identity — never the full Session/User object (no tokens). */
export interface AppAuthUser {
  id: string;
  email: string | null;
}

export interface SignUpResult {
  user: AppAuthUser;
  /**
   * True when the project requires email confirmation before a session is
   * issued — Supabase's signUp() returns a user but a null session in that
   * case. The caller must not assume sign-up produced a signed-in session.
   */
  emailConfirmationRequired: boolean;
}

const REASON_MESSAGES: Record<AuthErrorReason, string> = {
  invalid_credentials: 'Incorrect email or password.',
  invalid_email: 'Enter a valid email address.',
  weak_password: 'Choose a stronger password.',
  email_not_confirmed: 'Confirm your email address before signing in.',
  already_registered: 'An account with this email already exists.',
  rate_limited: 'Too many attempts. Try again in a few minutes.',
  link_expired: 'This link has expired or was already used. Request a new one.',
  link_invalid: 'This link is invalid or can no longer be used. Request a new one.',
  email_not_authorized: "We can't send email to this address right now. Try again later.",
  signups_disabled: "New accounts can't be created right now.",
  same_password: 'Choose a password different from your current one.',
  session_expired: 'Your session has expired. Sign in again.',
  reauthentication_needed: 'For security, sign in again before changing your password.',
  network_error: 'Could not reach the server. Check your connection and try again.',
  not_configured: 'Cloud accounts are not available right now.',
  unknown: 'Something went wrong. Try again.',
};

function failure(reason: AuthErrorReason): AuthFailure {
  return { reason, message: REASON_MESSAGES[reason] };
}

/**
 * Maps a raw GoTrue/network error to a closed AuthFailure. This is the one
 * function in the module allowed to read error.code / error.message — every
 * caller below goes through this instead of inspecting SDK errors directly,
 * so a leak of raw backend text can only ever happen here, in one place.
 */
function mapAuthError(error: unknown): AuthFailure {
  if (isAuthRetryableFetchError(error)) {
    return failure('network_error');
  }
  // Every AuthError, not only AuthApiError: client-side SDK errors carry
  // codes too — e.g. AuthPKCECodeVerifierMissingError is a CustomAuthError
  // with code 'pkce_code_verifier_not_found' (a link opened on a device
  // or app install that didn't request it). Codes below are taken from
  // the installed SDK's lib/error-codes.d.ts.
  if (isAuthError(error)) {
    const err = error as AuthError;
    switch (err.code) {
      case 'invalid_credentials':
        return failure('invalid_credentials');
      case 'email_address_invalid':
        return failure('invalid_email');
      case 'weak_password':
        return failure('weak_password');
      case 'email_not_confirmed':
        return failure('email_not_confirmed');
      case 'user_already_exists':
      case 'email_exists':
      case 'identity_already_exists':
        return failure('already_registered');
      case 'over_request_rate_limit':
      case 'over_email_send_rate_limit':
      case 'over_sms_send_rate_limit':
        return failure('rate_limited');
      case 'otp_expired':
      case 'flow_state_expired':
        return failure('link_expired');
      case 'flow_state_not_found':
      case 'bad_code_verifier':
      case 'pkce_code_verifier_not_found':
      case 'bad_oauth_callback':
        return failure('link_invalid');
      case 'email_address_not_authorized':
        return failure('email_not_authorized');
      case 'signup_disabled':
      case 'email_provider_disabled':
        return failure('signups_disabled');
      case 'same_password':
        return failure('same_password');
      case 'session_not_found':
      case 'session_expired':
      case 'refresh_token_not_found':
      case 'refresh_token_already_used':
        return failure('session_expired');
      case 'reauthentication_needed':
        return failure('reauthentication_needed');
      default:
        break;
    }
    // Codeless SDK callback errors (raised while reading a redirect URL).
    if (err.name === 'AuthPKCEGrantCodeExchangeError' || err.name === 'AuthImplicitGrantRedirectError') {
      return failure('link_invalid');
    }
    if (err.status === 429) {
      return failure('rate_limited');
    }
    return failure('unknown');
  }
  // A plain network-level throw (e.g. fetch rejecting with no AuthError
  // wrapper at all) — treat as network_error rather than unknown, since
  // that's the far more common real-world cause of an unwrapped throw here.
  if (error instanceof TypeError) {
    return failure('network_error');
  }
  return failure('unknown');
}

function toAppAuthUser(session: Session | null): AppAuthUser | null {
  if (!session?.user) {
    return null;
  }
  return { id: session.user.id, email: session.user.email ?? null };
}

/** Re-exported so callers can check availability without importing config.ts directly. */
export { isSupabaseConfigured as isAuthAvailable };

export type AuthRedirectRoute = 'confirm-email' | 'reset-password';

/**
 * Where an auth email's link returns the player, per platform:
 * - Native: the app's custom scheme (app.json `"scheme": "kettleborn"`),
 *   e.g. `kettleborn://reset-password`, received by App.tsx via Linking.
 * - Web: the site's own origin — whatever origin is actually serving the
 *   app (the Netlify URL in production, a deploy preview, or localhost),
 *   e.g. `https://animated-pixie-b97fbb.netlify.app/reset-password`.
 *   A browser user is never sent to the native-only scheme.
 *
 * Every one of these must be allow-listed in the Supabase Dashboard
 * (Authentication → URL Configuration → Redirect URLs), or Supabase
 * ignores it and falls back to the project's Site URL — the source of
 * the `localhost:3000/#error...` redirect reported earlier.
 */
export function getAuthRedirectUrl(route: AuthRedirectRoute): string | undefined {
  if (isWebPlatform()) {
    const origin = getWebOrigin();
    // No resolvable origin is not expected in a browser; let Supabase
    // fall back to the Dashboard Site URL rather than send a bad URL.
    return origin ? `${origin}/${route}` : undefined;
  }
  return `kettleborn://${route}`;
}

/**
 * With "Confirm email" enabled (the live project's setting), Supabase
 * deliberately returns the same shape — a user object and a null session,
 * no error — whether or not the address already has an account, so the
 * endpoint can't be used to discover registered emails. This function
 * does not try to tell those cases apart; `emailConfirmationRequired`
 * only means "no session was issued", and the UI words its message so it
 * is true in both cases. `already_registered` is still mapped for a
 * project with confirmations off, where Supabase does return an error.
 */
export async function signUp(email: string, password: string): Promise<AuthResult<SignUpResult>> {
  const client = getSupabaseClient();
  if (!client) {
    return { ok: false, error: failure('not_configured') };
  }
  try {
    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: getAuthRedirectUrl('confirm-email') },
    });
    if (error) {
      return { ok: false, error: mapAuthError(error) };
    }
    if (!data.user) {
      return { ok: false, error: failure('unknown') };
    }
    return {
      ok: true,
      data: {
        user: { id: data.user.id, email: data.user.email ?? null },
        emailConfirmationRequired: data.session === null,
      },
    };
  } catch (error) {
    return { ok: false, error: mapAuthError(error) };
  }
}

/**
 * Re-sends the signup confirmation email, with the same per-platform
 * redirect as signUp(). Like signUp, Supabase does not reveal whether the
 * address has a pending signup, so success means "request accepted", not
 * "an email was definitely sent".
 */
export async function resendConfirmation(email: string): Promise<AuthResult<void>> {
  const client = getSupabaseClient();
  if (!client) {
    return { ok: false, error: failure('not_configured') };
  }
  try {
    const { error } = await client.auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: getAuthRedirectUrl('confirm-email') },
    });
    if (error) {
      return { ok: false, error: mapAuthError(error) };
    }
    return { ok: true, data: undefined };
  } catch (error) {
    return { ok: false, error: mapAuthError(error) };
  }
}

export async function signIn(email: string, password: string): Promise<AuthResult<AppAuthUser>> {
  const client = getSupabaseClient();
  if (!client) {
    return { ok: false, error: failure('not_configured') };
  }
  try {
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) {
      return { ok: false, error: mapAuthError(error) };
    }
    return { ok: true, data: { id: data.user.id, email: data.user.email ?? null } };
  } catch (error) {
    return { ok: false, error: mapAuthError(error) };
  }
}

/**
 * Does not silently claim success on failure — a real sign-out error
 * (e.g. network failure revoking the remote session) is returned as such,
 * never swallowed into an ok:true result. Called with no configured client
 * is itself a success: there is no remote session to destroy.
 *
 * Note (verified in auth-js 2.117.3's _signOut): when the server call
 * fails for any reason other than 401/403/404, the SDK has ALREADY
 * removed the local session (and its PKCE verifiers) before returning the
 * error. An error here therefore does not mean "still signed in on this
 * device" — authSlice re-checks getSession() to report the real state.
 */
export async function signOut(): Promise<AuthResult<void>> {
  const client = getSupabaseClient();
  if (!client) {
    return { ok: true, data: undefined };
  }
  try {
    const { error } = await client.auth.signOut();
    if (error) {
      return { ok: false, error: mapAuthError(error) };
    }
    return { ok: true, data: undefined };
  } catch (error) {
    return { ok: false, error: mapAuthError(error) };
  }
}

/**
 * `data: null` is a legitimate success ("no session right now" — including
 * when cloud is unconfigured), distinct from `ok: false` (a real error
 * trying to determine that). Callers that need to distinguish "not
 * configured" specifically should check isAuthAvailable() first.
 */
export async function getSession(): Promise<AuthResult<AppAuthUser | null>> {
  const client = getSupabaseClient();
  if (!client) {
    return { ok: true, data: null };
  }
  try {
    const { data, error } = await client.auth.getSession();
    if (error) {
      return { ok: false, error: mapAuthError(error) };
    }
    return { ok: true, data: toAppAuthUser(data.session) };
  } catch (error) {
    return { ok: false, error: mapAuthError(error) };
  }
}

/**
 * Initiates password recovery. The emailed link returns to
 * getAuthRedirectUrl('reset-password') — the app scheme on native, the
 * site's own origin on web — which must be allow-listed in the Dashboard
 * (Authentication → URL Configuration → Redirect URLs). On native (PKCE)
 * the SDK stores this request's code verifier marked as a recovery flow,
 * so exchanging the returned code emits PASSWORD_RECOVERY. Deliberately
 * does not reveal whether the email address has an account (Supabase
 * reports success either way) — standard practice to avoid using this
 * endpoint to enumerate registered emails.
 */
export async function requestPasswordReset(email: string): Promise<AuthResult<void>> {
  const client = getSupabaseClient();
  if (!client) {
    return { ok: false, error: failure('not_configured') };
  }
  try {
    const { error } = await client.auth.resetPasswordForEmail(email, {
      redirectTo: getAuthRedirectUrl('reset-password'),
    });
    if (error) {
      return { ok: false, error: mapAuthError(error) };
    }
    return { ok: true, data: undefined };
  } catch (error) {
    return { ok: false, error: mapAuthError(error) };
  }
}

/**
 * Completes a native PKCE deep link (`kettleborn://reset-password?code=…`
 * or `kettleborn://confirm-email?code=…`): exchanges the code for a real
 * session using the verifier this device stored when it requested the
 * email. The SDK emits PASSWORD_RECOVERY for a reset exchange and
 * SIGNED_IN for a confirmation. Fails with `link_invalid` when the link
 * was opened on another device/install (verifier missing) or was already
 * used, and `link_expired` for an expired flow.
 *
 * Without a `sb_flow_id` param (the SDK only adds one under an
 * experimental flag this app does not enable), the SDK reads the single
 * legacy verifier slot, which mirrors the MOST RECENT email request on
 * this device — so only the latest link requested here can be completed
 * in-app. An older confirmation link still confirmed the email
 * server-side before redirecting; the player can then sign in normally.
 */
export async function exchangeCodeForSession(code: string): Promise<AuthResult<AppAuthUser>> {
  const client = getSupabaseClient();
  if (!client) {
    return { ok: false, error: failure('not_configured') };
  }
  try {
    const { data, error } = await client.auth.exchangeCodeForSession(code);
    if (error) {
      return { ok: false, error: mapAuthError(error) };
    }
    return { ok: true, data: { id: data.user.id, email: data.user.email ?? null } };
  } catch (error) {
    return { ok: false, error: mapAuthError(error) };
  }
}

/**
 * Sets a new password for the currently-active session — only
 * meaningful immediately after a `PASSWORD_RECOVERY` event (see
 * exchangeCodeForSession above) or for an already-signed-in user
 * changing their own password. Requires an existing session either
 * way; Supabase itself enforces that, not this wrapper.
 */
export async function updatePassword(newPassword: string): Promise<AuthResult<void>> {
  const client = getSupabaseClient();
  if (!client) {
    return { ok: false, error: failure('not_configured') };
  }
  try {
    const { error } = await client.auth.updateUser({ password: newPassword });
    if (error) {
      return { ok: false, error: mapAuthError(error) };
    }
    return { ok: true, data: undefined };
  } catch (error) {
    return { ok: false, error: mapAuthError(error) };
  }
}

export type AuthChangeEvent =
  | 'INITIAL_SESSION'
  | 'SIGNED_IN'
  | 'SIGNED_OUT'
  | 'TOKEN_REFRESHED'
  | 'USER_UPDATED'
  | 'PASSWORD_RECOVERY'
  | 'OTHER';
export type AuthChangeListener = (event: AuthChangeEvent, user: AppAuthUser | null) => void;
export type Unsubscribe = () => void;

const KNOWN_EVENTS: ReadonlySet<string> = new Set([
  'INITIAL_SESSION',
  'SIGNED_IN',
  'SIGNED_OUT',
  'TOKEN_REFRESHED',
  'USER_UPDATED',
  'PASSWORD_RECOVERY',
]);

/**
 * Registers exactly one underlying GoTrue listener per call and returns a
 * matching unsubscribe function — callers (see authSlice.ts) are
 * responsible for calling it on cleanup so listeners never accumulate
 * across remounts. A no-op unsubscribe is returned when unconfigured,
 * since there is nothing to listen to.
 */
export function onAuthStateChange(listener: AuthChangeListener): Unsubscribe {
  const client = getSupabaseClient();
  if (!client) {
    return () => undefined;
  }
  const { data } = client.auth.onAuthStateChange((event, session) => {
    listener(KNOWN_EVENTS.has(event) ? (event as AuthChangeEvent) : 'OTHER', toAppAuthUser(session));
  });
  return () => data.subscription.unsubscribe();
}

/**
 * Native token-refresh lifecycle, per the SDK's own guidance for React
 * Native (GoTrueClient.startAutoRefresh docs): outside a browser the SDK
 * runs its refresh ticker unconditionally, and JS timers don't run while
 * the app is backgrounded — so on return to the foreground the access
 * token may already be stale. Starting the ticker on `active` makes the
 * SDK check and refresh immediately; stopping it in the background avoids
 * refresh attempts the OS would suspend mid-request.
 *
 * No-op on web, where the SDK already does the equivalent itself via
 * `visibilitychange`, and when Supabase isn't configured.
 */
export function startAutoRefreshLifecycle(): Unsubscribe {
  const client = getSupabaseClient();
  if (!client || isWebPlatform()) {
    return () => undefined;
  }
  const apply = (active: boolean) => {
    const action = active ? client.auth.startAutoRefresh() : client.auth.stopAutoRefresh();
    Promise.resolve(action).catch(() => undefined);
  };
  apply(isAppActive());
  return subscribeToAppActive(apply);
}

/**
 * Web only: the auth callback (if any) the page was opened with, parsed
 * from the URL captured at app start — see platform.ts for why it has to
 * be captured before the Supabase client initializes. Null on native,
 * and null when the page wasn't opened from an auth email link.
 */
export function getInitialWebAuthCallback(): AuthCallback | null {
  if (!isWebPlatform()) {
    return null;
  }
  return parseAuthCallbackUrl(getInitialWebUrl());
}

/** Web only: removes a handled callback from the address bar so a reload can't replay it. */
export function clearWebAuthCallbackUrl(): void {
  if (isWebPlatform()) {
    replaceWebUrlWithRoot();
  }
}
