import test from 'node:test';
import assert from 'node:assert/strict';

// Dynamic import with a URL — same tsc-compatible pattern as the other
// util tests (see resetPasswordLink.test.ts for why).
const { parseAuthCallbackUrl, parseCallbackParams, isExpiredLinkErrorCode } = await import(
  new URL('../authCallback.ts', import.meta.url).href
);
const { extractResetPasswordCode } = await import(new URL('../resetPasswordLink.ts', import.meta.url).href);
const { extractEmailConfirmationCode } = await import(new URL('../emailConfirmationLink.ts', import.meta.url).href);

// Shapes below follow what @supabase/auth-js 2.117.3 actually reads/
// produces (see authCallback.ts's header): PKCE `?code=<uuid>`, implicit
// `#access_token=…&expires_at=…&expires_in=…&refresh_token=…&token_type=bearer&type=…`,
// and GoTrue error redirects carrying error/error_code/error_description.
const SITE = 'https://animated-pixie-b97fbb.netlify.app';
const AUTH_CODE = '8d2c6b0e-3f4a-4c1d-9a7e-5b1f2c3d4e5f';
const ACCESS_TOKEN =
  'eyJhbGciOiJIUzI1NiIsImtpZCI6Ik5QMk9QT1IiLCJ0eXAiOiJKV1QifQ.eyJzdWIiOiI0YjNlIiwicm9sZSI6ImF1dGhlbnRpY2F0ZWQifQ.c2lnbmF0dXJl';
const IMPLICIT_FRAGMENT = (type: string) =>
  `#access_token=${ACCESS_TOKEN}&expires_at=1762700400&expires_in=3600&refresh_token=v1.MRjVQ2Lk0n-yW1aQ&token_type=bearer&type=${type}`;
const EXPIRED_PARAMS = 'error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired';

test('native PKCE password-reset link → pkce / reset-password with the auth code', () => {
  assert.deepEqual(parseAuthCallbackUrl(`kettleborn://reset-password?code=${AUTH_CODE}`), {
    kind: 'pkce',
    route: 'reset-password',
    code: AUTH_CODE,
  });
});

test('native PKCE confirmation link → pkce / confirm-email', () => {
  assert.deepEqual(parseAuthCallbackUrl(`kettleborn://confirm-email?code=${AUTH_CODE}`), {
    kind: 'pkce',
    route: 'confirm-email',
    code: AUTH_CODE,
  });
});

test('Expo Go development link form (exp://host:port/--/route) is recognised', () => {
  const callback = parseAuthCallbackUrl(`exp://192.168.1.20:8081/--/reset-password?code=${AUTH_CODE}`);
  assert.equal(callback?.kind, 'pkce');
  assert.equal(callback?.route, 'reset-password');
});

test('PKCE link with the SDK flow-id param still yields only the code', () => {
  const callback = parseAuthCallbackUrl(
    `kettleborn://reset-password?sb_flow_id=0f1e2d3c4b5a69788796a5b4c3d2e1f0&code=${AUTH_CODE}`
  );
  assert.deepEqual(callback, { kind: 'pkce', route: 'reset-password', code: AUTH_CODE });
});

test('web implicit recovery callback → implicit with type=recovery (tokens are not returned)', () => {
  const callback = parseAuthCallbackUrl(`${SITE}/reset-password${IMPLICIT_FRAGMENT('recovery')}`);
  assert.deepEqual(callback, { kind: 'implicit', route: 'reset-password', type: 'recovery' });
  assert.equal(JSON.stringify(callback).includes(ACCESS_TOKEN), false);
});

test('web implicit signup confirmation → implicit with type=signup', () => {
  assert.deepEqual(parseAuthCallbackUrl(`${SITE}/confirm-email${IMPLICIT_FRAGMENT('signup')}`), {
    kind: 'implicit',
    route: 'confirm-email',
    type: 'signup',
  });
});

test('expired/used link (error in fragment) → error with otp_expired, decoded description', () => {
  assert.deepEqual(parseAuthCallbackUrl(`${SITE}/reset-password#${EXPIRED_PARAMS}`), {
    kind: 'error',
    route: 'reset-password',
    error: 'access_denied',
    errorCode: 'otp_expired',
    description: 'Email link is invalid or has expired',
  });
});

test('PKCE error redirect (error in BOTH query and fragment) → error on the native route', () => {
  const callback = parseAuthCallbackUrl(`kettleborn://confirm-email?${EXPIRED_PARAMS}#${EXPIRED_PARAMS}`);
  assert.equal(callback?.kind, 'error');
  assert.equal(callback?.route, 'confirm-email');
  assert.equal(callback?.errorCode, 'otp_expired');
});

test('Site URL fallback error (the reported localhost:3000/#error=… shape) is still an auth error', () => {
  const callback = parseAuthCallbackUrl(`http://localhost:3000/#${EXPIRED_PARAMS}`);
  assert.equal(callback?.kind, 'error');
  assert.equal(callback?.route, 'unknown');
});

test('regression: error_code=otp_expired is never mistaken for a code= param', () => {
  const url = `kettleborn://reset-password#${EXPIRED_PARAMS}`;
  // The previous /code=([^&]+)/ regex returned "otp_expired" here and
  // tried to exchange it as an auth code.
  assert.equal(extractResetPasswordCode(url), null);
  assert.equal(parseAuthCallbackUrl(url)?.kind, 'error');
});

test('non-auth URLs → null', () => {
  assert.equal(parseAuthCallbackUrl('kettleborn://'), null);
  assert.equal(parseAuthCallbackUrl(`${SITE}/`), null);
  assert.equal(parseAuthCallbackUrl(`${SITE}/?utm_source=newsletter`), null);
  assert.equal(parseAuthCallbackUrl('https://example.com/oauth/callback?code=xyz'), null);
  assert.equal(parseAuthCallbackUrl('kettleborn://reset-password'), null);
  assert.equal(parseAuthCallbackUrl(null), null);
});

test('query params take precedence over fragment params (same as supabase-js)', () => {
  assert.equal(parseCallbackParams('kettleborn://x?type=a#type=b').type, 'a');
});

test('otp_expired and flow_state_expired count as expired; anything else does not', () => {
  assert.equal(isExpiredLinkErrorCode('otp_expired'), true);
  assert.equal(isExpiredLinkErrorCode('flow_state_expired'), true);
  assert.equal(isExpiredLinkErrorCode('bad_code_verifier'), false);
  assert.equal(isExpiredLinkErrorCode(null), false);
});

test('route-specific extractors never cross-match', () => {
  const reset = `kettleborn://reset-password?code=${AUTH_CODE}`;
  const confirm = `kettleborn://confirm-email?code=${AUTH_CODE}`;
  assert.equal(extractResetPasswordCode(reset), AUTH_CODE);
  assert.equal(extractEmailConfirmationCode(reset), null);
  assert.equal(extractEmailConfirmationCode(confirm), AUTH_CODE);
  assert.equal(extractResetPasswordCode(confirm), null);
});
