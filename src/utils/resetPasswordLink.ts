/**
 * Extracts the PKCE `code` param from a `kettleborn://reset-password?code=...`
 * deep link without depending on the global `URL` constructor (not
 * guaranteed present on Hermes/React Native) — the link shape is fixed
 * and known, so a plain string match is simpler and more portable than
 * a general-purpose URL parser here.
 *
 * The `reset-password` substring check is also what keeps this from
 * ever mistaking an ordinary link (or any other future deep link) for
 * a recovery link — only a URL containing that exact path segment is
 * treated as one, regardless of what other query params it happens to
 * carry.
 *
 * Extracted out of App.tsx (which has no automated test coverage of
 * its own — no React Native component-testing tool exists in this
 * repo) specifically so this parsing logic itself can be unit-tested;
 * see src/utils/__tests__/resetPasswordLink.test.ts.
 */
export function extractResetPasswordCode(url: string): string | null {
  if (!url.includes('reset-password')) {
    return null;
  }
  const match = url.match(/code=([^&]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}
