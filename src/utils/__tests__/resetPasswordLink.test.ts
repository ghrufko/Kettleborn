import test from 'node:test';
import assert from 'node:assert/strict';

// Dynamic import with a URL (not a static import with an explicit
// `.ts` extension) — same pattern every other test file in this repo
// uses. A static `import ... from '../resetPasswordLink.ts'` resolves
// fine under Node's test runner (via src/testing/ts-resolve-hook.mjs)
// but fails `tsc --noEmit` with TS5097 ("An import path can only end
// with a '.ts' extension when 'allowImportingTsExtensions' is
// enabled") — tsc statically validates a literal static-import path
// against module-resolution rules, but does not attempt to resolve a
// dynamic `import()` call whose argument isn't a plain string literal,
// so this form satisfies both tools at once.
const { extractResetPasswordCode } = await import(new URL('../resetPasswordLink.ts', import.meta.url).href);

test('extracts the code from a real reset-password deep link', () => {
  const url = 'kettleborn://reset-password?code=abc123';
  assert.equal(extractResetPasswordCode(url), 'abc123');
});

test('extracts the code when other query params are present too', () => {
  const url = 'kettleborn://reset-password?type=recovery&code=abc123&foo=bar';
  assert.equal(extractResetPasswordCode(url), 'abc123');
});

test('decodes a percent-encoded code', () => {
  const url = 'kettleborn://reset-password?code=abc%2F123%3D';
  assert.equal(extractResetPasswordCode(url), 'abc/123=');
});

test('returns null for a plain app-open link with no reset-password segment', () => {
  // The "not mistaken for an ordinary sign-in link" requirement: any
  // link that doesn't contain reset-password is never treated as one,
  // regardless of what params it carries.
  assert.equal(extractResetPasswordCode('kettleborn://'), null);
  assert.equal(extractResetPasswordCode('kettleborn://code=someOtherFlow'), null);
});

test('returns null when reset-password is present but no code param exists', () => {
  assert.equal(extractResetPasswordCode('kettleborn://reset-password'), null);
  assert.equal(extractResetPasswordCode('kettleborn://reset-password?type=recovery'), null);
});

test('returns null for an unrelated URL that happens to share no structure', () => {
  assert.equal(extractResetPasswordCode('https://example.com/other-flow?code=xyz'), null);
});
