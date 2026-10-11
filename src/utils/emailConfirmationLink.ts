/**
 * Extracts the PKCE `code` param from a `kettleborn://confirm-email?code=...`
 * deep link — the link Supabase's signup-confirmation email now redirects
 * to (see signUp()'s emailRedirectTo in services/supabase/auth.ts). Same
 * plain-string-match approach as extractResetPasswordCode (no `URL`
 * constructor dependency; not guaranteed present on Hermes/React Native),
 * and the same `confirm-email` substring gate so this never mistakes an
 * ordinary link, or a password-reset link, for a signup confirmation.
 */
export function extractEmailConfirmationCode(url: string): string | null {
  if (!url.includes('confirm-email')) {
    return null;
  }
  const match = url.match(/code=([^&]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}
