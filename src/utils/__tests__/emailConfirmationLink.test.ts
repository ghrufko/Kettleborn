import test from 'node:test';
import assert from 'node:assert/strict';

// Dynamic import with a URL (not a static import with an explicit
// `.ts` extension) — same pattern every other test file in this repo
// uses; see resetPasswordLink.test.ts's own comment for why (satisfies
// both the Node test runner and `tsc --noEmit`'s TS5097 check at once).
const { extractEmailConfirmationCode } = await import(
  new URL('../emailConfirmationLink.ts', import.meta.url).href
);

test('extracts the code from a real confirm-email deep link', () => {
  const url = 'kettleborn://confirm-email?code=abc123';
  assert.equal(extractEmailConfirmationCode(url), 'abc123');
});

test('extracts the code when other query params are present too', () => {
  const url = 'kettleborn://confirm-email?type=signup&code=abc123&foo=bar';
  assert.equal(extractEmailConfirmationCode(url), 'abc123');
});

test('decodes a percent-encoded code', () => {
  const url = 'kettleborn://confirm-email?code=abc%2F123%3D';
  assert.equal(extractEmailConfirmationCode(url), 'abc/123=');
});

test('returns null for a plain app-open link with no confirm-email segment', () => {
  assert.equal(extractEmailConfirmationCode('kettleborn://'), null);
  assert.equal(extractEmailConfirmationCode('kettleborn://code=someOtherFlow'), null);
});

test('returns null when confirm-email is present but no code param exists', () => {
  assert.equal(extractEmailConfirmationCode('kettleborn://confirm-email'), null);
  assert.equal(extractEmailConfirmationCode('kettleborn://confirm-email?type=signup'), null);
});

test('returns null for an unrelated URL that happens to share no structure', () => {
  assert.equal(extractEmailConfirmationCode('https://example.com/other-flow?code=xyz'), null);
});

test('a reset-password link is never mistaken for an email-confirmation link', () => {
  // These two deep-link types must stay mutually exclusive — App.tsx
  // relies on exactly one of extractResetPasswordCode /
  // extractEmailConfirmationCode ever matching a given real URL.
  assert.equal(extractEmailConfirmationCode('kettleborn://reset-password?code=abc123'), null);
});
