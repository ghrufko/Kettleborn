import type { AuthError, Session } from '@supabase/supabase-js';
import { isAuthApiError, isAuthRetryableFetchError } from '@supabase/supabase-js';
import { getSupabaseClient } from './client';
import { isSupabaseConfigured } from './config';

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
  if (isAuthApiError(error)) {
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
      default:
        return failure('unknown');
    }
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

/**
 * Root-cause fix: this call previously passed no `options.emailRedirectTo`
 * at all, so Supabase fell back to the project's Dashboard-configured
 * Site URL for the confirmation email's link — which defaults to
 * `http://localhost:3000` on a fresh project (confirmed in
 * supabase/PHASE_2_4_AUTH_IMPLEMENTATION.md's Dashboard audit) and is
 * exactly the `localhost:3000/#error...` redirect reported. Mirrors
 * PASSWORD_RESET_REDIRECT_URL below it: same custom-scheme pattern, same
 * Dashboard allow-list requirement (see that constant's own comment and
 * the Phase report for this fix for the exact Dashboard step).
 */
const EMAIL_CONFIRMATION_REDIRECT_URL = 'kettleborn://confirm-email';

export async function signUp(email: string, password: string): Promise<AuthResult<SignUpResult>> {
  const client = getSupabaseClient();
  if (!client) {
    return { ok: false, error: failure('not_configured') };
  }
  try {
    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: EMAIL_CONFIRMATION_REDIRECT_URL },
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
 * The custom URL scheme (app.json's `"scheme": "kettleborn"`) the
 * password-reset email link redirects back into on a native device.
 * Must also be added to the real project's Auth → URL Configuration →
 * Redirect URLs allow-list in the Dashboard, or Supabase will reject
 * the redirect — see supabase/PHASE_2_4_AUTH_IMPLEMENTATION.md's
 * "Dashboard configuration required" section. Not used on web (the
 * web app's own origin is used there instead, which Supabase projects
 * allow by default for local/preview URLs — still subject to the same
 * allow-list rule for a real deployed web origin).
 */
const PASSWORD_RESET_REDIRECT_URL = 'kettleborn://reset-password';

/**
 * Initiates password recovery. Supabase emails a reset link using
 * `PASSWORD_RESET_REDIRECT_URL` as the redirect target — this requires
 * that exact URL to be allow-listed in the real project's Dashboard
 * (Authentication → URL Configuration → Redirect URLs), which is a
 * manual step only the project owner can perform; see
 * supabase/PHASE_2_4_AUTH_IMPLEMENTATION.md. Confirmed this phase that
 * the *request* itself reaches the real GoTrue endpoint successfully
 * (tested against the real `kettleborn-dev` project); actual email
 * delivery and the redirect landing correctly were NOT verified — no
 * inbox access exists in this environment. Deliberately does not
 * reveal whether the email address has an account (always reports
 * success on a valid-looking address) — standard practice to avoid
 * using this endpoint to enumerate registered emails.
 */
export async function requestPasswordReset(email: string): Promise<AuthResult<void>> {
  const client = getSupabaseClient();
  if (!client) {
    return { ok: false, error: failure('not_configured') };
  }
  try {
    const { error } = await client.auth.resetPasswordForEmail(email, {
      redirectTo: PASSWORD_RESET_REDIRECT_URL,
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
 * Completes the password-reset deep link: exchanges the PKCE `code`
 * param carried on `kettleborn://reset-password?code=...` (the link the
 * user's email redirects to) for a real session. Supabase's
 * `onAuthStateChange` listener (see onAuthStateChange() below) then
 * fires a `PASSWORD_RECOVERY` event for that session — App.tsx uses
 * that event to route to UpdatePasswordScreen, not this function's
 * return value directly.
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
