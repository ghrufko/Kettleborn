import { parseAuthCallbackUrl } from './authCallback';

/**
 * Extracts the PKCE `code` param from a `kettleborn://reset-password?code=...`
 * deep link. Thin wrapper over parseAuthCallbackUrl (see authCallback.ts),
 * which parses params by exact key — so an expired-link redirect carrying
 * `error_code=otp_expired` is never mistaken for a `code=` param, which
 * the previous substring regex did.
 *
 * The `reset-password` route check is also what keeps this from ever
 * mistaking an ordinary link (or any other future deep link) for a
 * recovery link.
 */
export function extractResetPasswordCode(url: string): string | null {
  const callback = parseAuthCallbackUrl(url);
  return callback?.kind === 'pkce' && callback.route === 'reset-password' ? callback.code : null;
}
