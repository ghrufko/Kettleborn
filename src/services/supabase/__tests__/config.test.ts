import test from 'node:test';
import assert from 'node:assert/strict';

const CONFIG_URL = new URL('../config.ts', import.meta.url).href;

function withEnv(url: string | undefined, key: string | undefined, fn: () => void) {
  const prevUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const prevKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (url === undefined) delete process.env.EXPO_PUBLIC_SUPABASE_URL;
  else process.env.EXPO_PUBLIC_SUPABASE_URL = url;
  if (key === undefined) delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  else process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = key;
  try {
    fn();
  } finally {
    if (prevUrl === undefined) delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    else process.env.EXPO_PUBLIC_SUPABASE_URL = prevUrl;
    if (prevKey === undefined) delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
    else process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = prevKey;
  }
}

// config.ts reads process.env live on every call (no module-level
// caching), so re-importing per assertion isn't needed — a single
// import is reused throughout this file.
const { getSupabaseConfigState } = await import(CONFIG_URL);

test('both vars absent -> unconfigured', () => {
  withEnv(undefined, undefined, () => {
    assert.deepEqual(getSupabaseConfigState(), { status: 'unconfigured' });
  });
});

test('only URL present -> invalid missing_anon_key', () => {
  withEnv('https://abc.supabase.co', undefined, () => {
    const s = getSupabaseConfigState();
    assert.equal(s.status, 'invalid');
    assert.equal(s.reason, 'missing_anon_key');
  });
});

test('only key present -> invalid missing_url', () => {
  withEnv(undefined, 'a'.repeat(40), () => {
    const s = getSupabaseConfigState();
    assert.equal(s.status, 'invalid');
    assert.equal(s.reason, 'missing_url');
  });
});

test('malformed URL -> invalid malformed_url', () => {
  withEnv('not-a-url', 'a'.repeat(40), () => {
    const s = getSupabaseConfigState();
    assert.equal(s.status, 'invalid');
    assert.equal(s.reason, 'malformed_url');
  });
});

test('non-https URL -> invalid malformed_url', () => {
  withEnv('http://abc.supabase.co', 'a'.repeat(40), () => {
    const s = getSupabaseConfigState();
    assert.equal(s.status, 'invalid');
    assert.equal(s.reason, 'malformed_url');
  });
});

test('both syntactically valid -> configured', () => {
  withEnv('https://abc.supabase.co', 'a'.repeat(40), () => {
    const s = getSupabaseConfigState();
    assert.equal(s.status, 'configured');
  });
});

test('too-short key -> invalid anon_key_too_short', () => {
  withEnv('https://abc.supabase.co', 'short', () => {
    const s = getSupabaseConfigState();
    assert.equal(s.status, 'invalid');
    assert.equal(s.reason, 'anon_key_too_short');
  });
});

test('sb_secret_ key is rejected even though it is syntactically valid', () => {
  withEnv('https://abc.supabase.co', `sb_secret_${'x'.repeat(30)}`, () => {
    const s = getSupabaseConfigState();
    assert.equal(s.status, 'invalid');
    assert.equal(s.reason, 'secret_key_in_anon_key_slot');
  });
});

test('sb_publishable_ key is accepted', () => {
  withEnv('https://abc.supabase.co', `sb_publishable_${'x'.repeat(30)}`, () => {
    const s = getSupabaseConfigState();
    assert.equal(s.status, 'configured');
  });
});

test('legacy JWT with role=service_role is rejected', () => {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ role: 'service_role', iss: 'supabase', iat: 0, exp: 9999999999 })).toString(
    'base64url'
  );
  withEnv('https://abc.supabase.co', `${header}.${payload}.fakesig`, () => {
    const s = getSupabaseConfigState();
    assert.equal(s.status, 'invalid');
    assert.equal(s.reason, 'secret_key_in_anon_key_slot');
  });
});

test('legacy JWT with role=anon is accepted', () => {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ role: 'anon', iss: 'supabase', iat: 0, exp: 9999999999 })).toString('base64url');
  withEnv('https://abc.supabase.co', `${header}.${payload}.fakesig`, () => {
    const s = getSupabaseConfigState();
    assert.equal(s.status, 'configured');
  });
});
