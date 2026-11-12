import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

/** delete-account Edge Function — current API keys only (no legacy fallback), fail-closed config, caller-only deletion. Synthetic values only. */
const { readApiKeys } = await import(new URL('../../../supabase/functions/delete-account/keys.ts', import.meta.url).href);
const { handleDeleteAccount, handleUnavailable } = await import(
  new URL('../../../supabase/functions/delete-account/handler.ts', import.meta.url).href
);
const FUNCTION_DIR = new URL('../../../supabase/functions/delete-account/', import.meta.url).href;
const readText = (relative: string) => readFileSync(fileURLToPath(new URL(relative, FUNCTION_DIR).href), 'utf8');

const pub = `sb_publishable_${randomBytes(20).toString('base64url')}`;
const sec = `sb_secret_${randomBytes(30).toString('base64url')}`;
const b64url = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const legacyJwt = (role: string) => `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ role })}.${randomBytes(24).toString('base64url')}`;
const env = (vars: Record<string, string | undefined>) => (name: string) => vars[name];
const good = { SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: pub }), SUPABASE_SECRET_KEYS: JSON.stringify({ default: sec }) };

// ---------------------------------------------------------------- keys

test('keys: reads the `default` publishable and secret keys', () => {
  assert.deepEqual(readApiKeys(env(good)), { ok: true, publishableKey: pub, secretKey: sec });
  const withOthers = {
    SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ web: 'sb_publishable_other', default: pub }),
    SUPABASE_SECRET_KEYS: JSON.stringify({ ci: 'sb_secret_other', default: sec }),
  };
  assert.deepEqual(readApiKeys(env(withOthers)), { ok: true, publishableKey: pub, secretKey: sec });
});

test('keys: fails closed on every bad shape, naming only the variable and the problem', () => {
  const cases: [Record<string, string | undefined>, string, string][] = [
    [{ ...good, SUPABASE_PUBLISHABLE_KEYS: undefined }, 'SUPABASE_PUBLISHABLE_KEYS', 'missing'],
    [{ ...good, SUPABASE_SECRET_KEYS: undefined }, 'SUPABASE_SECRET_KEYS', 'missing'],
    [{ ...good, SUPABASE_SECRET_KEYS: '  ' }, 'SUPABASE_SECRET_KEYS', 'missing'],
    [{ ...good, SUPABASE_SECRET_KEYS: `{default:${sec}` }, 'SUPABASE_SECRET_KEYS', 'malformed_json'],
    [{ ...good, SUPABASE_SECRET_KEYS: sec }, 'SUPABASE_SECRET_KEYS', 'malformed_json'],
    [{ ...good, SUPABASE_SECRET_KEYS: JSON.stringify([sec]) }, 'SUPABASE_SECRET_KEYS', 'not_an_object'],
    [{ ...good, SUPABASE_SECRET_KEYS: 'null' }, 'SUPABASE_SECRET_KEYS', 'not_an_object'],
    [{ ...good, SUPABASE_SECRET_KEYS: JSON.stringify({ other: sec }) }, 'SUPABASE_SECRET_KEYS', 'no_default_key'],
    [{ ...good, SUPABASE_SECRET_KEYS: JSON.stringify({ default: '' }) }, 'SUPABASE_SECRET_KEYS', 'no_default_key'],
    [{ ...good, SUPABASE_SECRET_KEYS: JSON.stringify({ default: 42 }) }, 'SUPABASE_SECRET_KEYS', 'no_default_key'],
    // Wrong kind: a legacy JWT, or the publishable key where the secret belongs (and vice versa).
    [{ ...good, SUPABASE_SECRET_KEYS: JSON.stringify({ default: legacyJwt('service_role') }) }, 'SUPABASE_SECRET_KEYS', 'wrong_key_kind'],
    [{ ...good, SUPABASE_SECRET_KEYS: JSON.stringify({ default: pub }) }, 'SUPABASE_SECRET_KEYS', 'wrong_key_kind'],
    [{ ...good, SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: legacyJwt('anon') }) }, 'SUPABASE_PUBLISHABLE_KEYS', 'wrong_key_kind'],
    [{ ...good, SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: sec }) }, 'SUPABASE_PUBLISHABLE_KEYS', 'wrong_key_kind'],
  ];
  for (const [vars, variable, problem] of cases) {
    const result = readApiKeys(env(vars));
    assert.deepEqual(result, { ok: false, variable, problem }, `${variable} ${problem}`);
    assert.ok(!JSON.stringify(result).includes(sec.slice(10)) && !JSON.stringify(result).includes(pub.slice(15)), 'no key value in the result');
  }
});

test('keys: the legacy variables are never a fallback', () => {
  const legacyOnly = { SUPABASE_ANON_KEY: legacyJwt('anon'), SUPABASE_SERVICE_ROLE_KEY: legacyJwt('service_role') };
  assert.deepEqual(readApiKeys(env(legacyOnly)), { ok: false, variable: 'SUPABASE_PUBLISHABLE_KEYS', problem: 'missing' });
  assert.deepEqual(readApiKeys(env({ ...legacyOnly, SUPABASE_PUBLISHABLE_KEYS: good.SUPABASE_PUBLISHABLE_KEYS })), {
    ok: false,
    variable: 'SUPABASE_SECRET_KEYS',
    problem: 'missing',
  });
});

test('the function source reads only the current key variables and keeps platform JWT verification on', () => {
  for (const file of ['index.ts', 'handler.ts', 'keys.ts']) {
    const code = readText(file)
      .split('\n')
      .filter((line: string) => !/^\s*(\/\/|\*|\/\*\*)/.test(line)) // comments may mention the legacy names
      .join('\n');
    assert.doesNotMatch(code, /SUPABASE_SERVICE_ROLE_KEY|SUPABASE_ANON_KEY|SUPABASE_JWT_SECRET/, file);
  }
  const index = readText('index.ts');
  assert.match(index, /readApiKeys\(/);
  assert.doesNotMatch(index, /console\.\w+\([^)]*(secretKey|publishableKey)/, 'never logs a key');
  const config = readText('../../config.toml');
  assert.doesNotMatch(config, /verify_jwt\s*=\s*false/, 'gateway JWT verification is not disabled');
});

// ---------------------------------------------------------------- unavailable (fail closed)

test('unavailable: every request is refused with no detail; CORS preflight still answers', async () => {
  for (const init of [
    { method: 'POST', headers: { Authorization: 'Bearer good-token' } },
    { method: 'POST' },
    { method: 'GET' },
  ] as RequestInit[]) {
    const res = handleUnavailable(new Request('https://x/functions/v1/delete-account', init));
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { error: 'unavailable' });
  }
  assert.equal(handleUnavailable(new Request('https://x/f', { method: 'OPTIONS' })).status, 204);
});

// ---------------------------------------------------------------- handler

function deps(validToken: string, userId: string, deleteError: string | null = null) {
  const deleted: string[] = [];
  const verified: string[] = [];
  return {
    deleted,
    verified,
    getUserIdFromToken: async (token: string) => {
      verified.push(token);
      return token === validToken ? userId : null;
    },
    deleteUser: async (id: string) => {
      deleted.push(id);
      return { error: deleteError };
    },
  };
}
const post = (headers: Record<string, string> = {}, body?: unknown) =>
  new Request('https://x/functions/v1/delete-account', { method: 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body) });

test('handler: unauthorized requests (no header, not Bearer, empty token) never reach token verification or deletion', async () => {
  const d = deps('good-token', 'user-1');
  const cases: Record<string, string>[] = [{}, { Authorization: 'good-token' }, { Authorization: 'Basic Zm9vOmJhcg==' }, { Authorization: 'Bearer ' }, { apikey: pub }];
  for (const headers of cases) {
    const res = await handleDeleteAccount(post(headers), d);
    assert.equal(res.status, 401, JSON.stringify(headers));
    assert.deepEqual(await res.json(), { error: 'not_signed_in' });
  }
  assert.deepEqual(d.verified, []);
  assert.deepEqual(d.deleted, []);
});

test('handler: invalid, expired or forged tokens are refused and delete nothing — including a key sent as the bearer', async () => {
  const d = deps('good-token', 'user-1');
  for (const token of ['forged', legacyJwt('authenticated'), legacyJwt('service_role'), pub, sec]) {
    const res = await handleDeleteAccount(post({ Authorization: `Bearer ${token}` }), d);
    assert.equal(res.status, 401);
  }
  assert.equal(d.verified.length, 5, 'each token was checked with Supabase Auth');
  assert.deepEqual(d.deleted, []);
});

test('handler: a valid token deletes exactly its own account, whatever the body says', async () => {
  const d = deps('good-token', 'user-1');
  const res = await handleDeleteAccount(post({ Authorization: 'Bearer good-token' }, { userId: 'user-2', user_id: 'user-3' }), d);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { deleted: true });
  assert.deepEqual(d.deleted, ['user-1']);
});

test('handler: a failed deletion reports only a generic error', async () => {
  const d = deps('good-token', 'user-1', `internal detail ${sec}`);
  const res = await handleDeleteAccount(post({ Authorization: 'Bearer good-token' }), d);
  assert.equal(res.status, 500);
  const text = await res.text();
  assert.equal(text, JSON.stringify({ error: 'delete_failed' }));
});
