import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

/** Cloud Save P10 — the bundle secret scanner, on synthetic inputs only (no real credential is used anywhere). */
const S = await import(new URL('../bundleSecretScan.ts', import.meta.url).href);

const b64url = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const fakeJwt = (role: string) => `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ role, iss: 'supabase' })}.${randomBytes(24).toString('base64url')}`;
const fakeSecret = () => `sb_secret_${randomBytes(30).toString('base64url')}`;

test('flags a service_role JWT and a random sb_secret_ key; reports kind and offset only', () => {
  const content = `var a="${fakeJwt('service_role')}";var b="${fakeSecret()}";`;
  const findings = S.scanContent('bundle.js', content);
  assert.deepEqual(findings.map((f: any) => f.kind).sort(), ['secret_api_key', 'service_role_jwt']);
  for (const f of findings) assert.deepEqual(Object.keys(f).sort(), ['file', 'kind', 'offset']);
});

test('does not flag user tokens, publishable keys, or the app\'s own literal prefix check followed by other strings', () => {
  const content = [
    `"${fakeJwt('authenticated')}"`,
    `"${fakeJwt('anon')}"`,
    '"sb_publishable_' + randomBytes(20).toString('base64url') + '"',
    // Hermes-style string table: the literal prefix immediately followed by adjacent identifiers.
    'sb_secret_keyIsRejectedBecauseItIsSecretserviceRoleKey',
    "if (key.startsWith('sb_secret_')) {",
  ].join('\n');
  assert.deepEqual(S.scanContent('bundle.hbc', content), []);
});

test('entropy check separates random keys from words', () => {
  assert.equal(S.looksLikeRandomKey(randomBytes(30).toString('base64url') + 'A1a'), true);
  assert.equal(S.looksLikeRandomKey('keyIsRejectedBecauseItIsSecret'), false);
  assert.ok(S.shannonEntropy('aaaa') < 1);
});
