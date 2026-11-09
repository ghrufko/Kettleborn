import { parseAuthCallbackUrl } from './authCallback';

/**
 * Extracts the PKCE `code` param from a `kettleborn://confirm-email?code=...`
 * deep link — the link Supabase's signup-confirmation email redirects to
 * on native (see signUp()'s emailRedirectTo in services/supabase/auth.ts).
 * Thin wrapper over parseAuthCallbackUrl, same as extractResetPasswordCode,
 * gated on the `confirm-email` route so a password-reset link is never
 * mistaken for a signup confirmation.
 */
export function extractEmailConfirmationCode(url: string): string | null {
  const callback = parseAuthCallbackUrl(url);
  return callback?.kind === 'pkce' && callback.route === 'confirm-email' ? callback.code : null;
}
