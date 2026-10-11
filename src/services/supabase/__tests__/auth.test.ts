import test from 'node:test';
import assert from 'node:assert/strict';
import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js';

const CLIENT_PATH = new URL('../client.ts', import.meta.url).href;
const AUTH_URL = new URL('../auth.ts', import.meta.url).href;

async function freshAuth() {
  return import(`${AUTH_URL}?bust=${Math.random()}`);
}

test('signIn: not_configured when no client (unconfigured)', async (t) => {
  t.mock.module(CLIENT_PATH, { exports: { getSupabaseClient: () => null } });
  const auth = await freshAuth();
  const result = await auth.signIn('a@b.com', 'password123');
  assert.equal(result.ok, false);
  assert.equal(result.error.reason, 'not_configured');
});

test('signIn: maps invalid_credentials', async (t) => {
  const fakeError = new AuthApiError('Invalid login credentials', 400, 'invalid_credentials');
  const fakeClient = {
    auth: { signInWithPassword: async () => ({ data: { user: null, session: null }, error: fakeError }) },
  };
  t.mock.module(CLIENT_PATH, { exports: { getSupabaseClient: () => fakeClient } });
  const auth = await freshAuth();
  const result = await auth.signIn('a@b.com', 'wrong');
  assert.equal(result.ok, false);
  assert.equal(result.error.reason, 'invalid_credentials');
});

test('signIn: maps a retryable fetch error to network_error', async (t) => {
  const fakeError = new AuthRetryableFetchError('fetch failed', 0);
  const fakeClient = {
    auth: { signInWithPassword: async () => ({ data: { user: null, session: null }, error: fakeError }) },
  };
  t.mock.module(CLIENT_PATH, { exports: { getSupabaseClient: () => fakeClient } });
  const auth = await freshAuth();
  const result = await auth.signIn('a@b.com', 'whatever');
  assert.equal(result.ok, false);
  assert.equal(result.error.reason, 'network_error');
});

test('signIn: successful sign-in returns a minimal AppAuthUser (no tokens)', async (t) => {
  const fakeSession = { access_token: 'secret-token', refresh_token: 'secret-refresh', user: { id: 'u1', email: 'a@b.com' } };
  const fakeClient = {
    auth: { signInWithPassword: async () => ({ data: { user: fakeSession.user, session: fakeSession }, error: null }) },
  };
  t.mock.module(CLIENT_PATH, { exports: { getSupabaseClient: () => fakeClient } });
  const auth = await freshAuth();
  const result = await auth.signIn('a@b.com', 'correct');
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, { id: 'u1', email: 'a@b.com' });
  // No credential leakage: the returned shape must not carry tokens.
  assert.equal('access_token' in (result as any).data, false);
});

test('signUp: emailConfirmationRequired is true when session is null', async (t) => {
  const fakeClient = {
    auth: {
      signUp: async () => ({ data: { user: { id: 'u2', email: 'c@d.com' }, session: null }, error: null }),
    },
  };
  t.mock.module(CLIENT_PATH, { exports: { getSupabaseClient: () => fakeClient } });
  const auth = await freshAuth();
  const result = await auth.signUp('c@d.com', 'password123');
  assert.equal(result.ok, true);
  assert.equal(result.data.emailConfirmationRequired, true);
});

test('signUp: passes a kettleborn:// emailRedirectTo so the confirmation email never falls back to the Supabase project\'s default Site URL (localhost:3000)', async (t) => {
  const signUpCalls: unknown[] = [];
  const fakeClient = {
    auth: {
      signUp: async (args: unknown) => {
        signUpCalls.push(args);
        return { data: { user: { id: 'u2', email: 'c@d.com' }, session: null }, error: null };
      },
    },
  };
  t.mock.module(CLIENT_PATH, { exports: { getSupabaseClient: () => fakeClient } });
  const auth = await freshAuth();
  await auth.signUp('c@d.com', 'password123');

  assert.equal(signUpCalls.length, 1);
  const call = signUpCalls[0] as { email: string; password: string; options?: { emailRedirectTo?: string } };
  assert.equal(call.email, 'c@d.com');
  assert.equal(call.password, 'password123');
  assert.ok(call.options, 'signUp must pass an options object');
  assert.ok(
    call.options!.emailRedirectTo && call.options!.emailRedirectTo.startsWith('kettleborn://'),
    `expected a kettleborn:// emailRedirectTo, got ${call.options?.emailRedirectTo}`
  );
  // Must be a distinct path from the password-reset redirect — these two
  // deep links are handled by different App.tsx branches and must never
  // collide.
  assert.notEqual(call.options!.emailRedirectTo, 'kettleborn://reset-password');
});

test('signUp: emailConfirmationRequired is false when a session is issued', async (t) => {
  const fakeClient = {
    auth: {
      signUp: async () => ({
        data: { user: { id: 'u3', email: 'e@f.com' }, session: { access_token: 'x', refresh_token: 'y', user: { id: 'u3', email: 'e@f.com' } } },
        error: null,
      }),
    },
  };
  t.mock.module(CLIENT_PATH, { exports: { getSupabaseClient: () => fakeClient } });
  const auth = await freshAuth();
  const result = await auth.signUp('e@f.com', 'password123');
  assert.equal(result.ok, true);
  assert.equal(result.data.emailConfirmationRequired, false);
});

test('signUp: maps already_registered', async (t) => {
  const fakeError = new AuthApiError('User already registered', 422, 'user_already_exists');
  const fakeClient = { auth: { signUp: async () => ({ data: { user: null, session: null }, error: fakeError }) } };
  t.mock.module(CLIENT_PATH, { exports: { getSupabaseClient: () => fakeClient } });
  const auth = await freshAuth();
  const result = await auth.signUp('dup@b.com', 'password123');
  assert.equal(result.ok, false);
  assert.equal(result.error.reason, 'already_registered');
});

test('signUp: maps weak_password', async (t) => {
  const fakeError = new AuthApiError('Password is too weak', 422, 'weak_password');
  const fakeClient = { auth: { signUp: async () => ({ data: { user: null, session: null }, error: fakeError }) } };
  t.mock.module(CLIENT_PATH, { exports: { getSupabaseClient: () => fakeClient } });
  const auth = await freshAuth();
  const result = await auth.signUp('weak@b.com', '123');
  assert.equal(result.ok, false);
  assert.equal(result.error.reason, 'weak_password');
});

test('signUp: maps rate limiting', async (t) => {
  const fakeError = new AuthApiError('Too many requests', 429, 'over_email_send_rate_limit');
  const fakeClient = { auth: { signUp: async () => ({ data: { user: null, session: null }, error: fakeError }) } };
  t.mock.module(CLIENT_PATH, { exports: { getSupabaseClient: () => fakeClient } });
  const auth = await freshAuth();
  const result = await auth.signUp('rl@b.com', 'password123');
  assert.equal(result.ok, false);
  assert.equal(result.error.reason, 'rate_limited');
});

test('signOut: not_configured client is a trivial success (nothing to sign out of)', async (t) => {
  t.mock.module(CLIENT_PATH, { exports: { getSupabaseClient: () => null } });
  const auth = await freshAuth();
  const result = await auth.signOut();
  assert.equal(result.ok, true);
});

test('signOut: a real failure is NOT reported as success', async (t) => {
  const fakeError = new AuthApiError('Network down', 0, undefined);
  const fakeClient = { auth: { signOut: async () => ({ error: fakeError }) } };
  t.mock.module(CLIENT_PATH, { exports: { getSupabaseClient: () => fakeClient } });
  const auth = await freshAuth();
  const result = await auth.signOut();
  assert.equal(result.ok, false);
});

test('signOut: successful sign-out', async (t) => {
  const fakeClient = { auth: { signOut: async () => ({ error: null }) } };
  t.mock.module(CLIENT_PATH, { exports: { getSupabaseClient: () => fakeClient } });
  const auth = await freshAuth();
  const result = await auth.signOut();
  assert.equal(result.ok, true);
});

test('getSession: unconfigured returns ok:true, data:null (not an error)', async (t) => {
  t.mock.module(CLIENT_PATH, { exports: { getSupabaseClient: () => null } });
  const auth = await freshAuth();
  const result = await auth.getSession();
  assert.equal(result.ok, true);
  assert.equal(result.data, null);
});

test('getSession: restores an existing session as a minimal AppAuthUser', async (t) => {
  const fakeSession = { access_token: 'x', refresh_token: 'y', user: { id: 'u4', email: 'g@h.com' } };
  const fakeClient = { auth: { getSession: async () => ({ data: { session: fakeSession }, error: null }) } };
  t.mock.module(CLIENT_PATH, { exports: { getSupabaseClient: () => fakeClient } });
  const auth = await freshAuth();
  const result = await auth.getSession();
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, { id: 'u4', email: 'g@h.com' });
});

test('getSession: a real error restoring the session is reported, not swallowed into null', async (t) => {
  const fakeError = new AuthApiError('Session lookup failed', 500, undefined);
  const fakeClient = { auth: { getSession: async () => ({ data: { session: null }, error: fakeError }) } };
  t.mock.module(CLIENT_PATH, { exports: { getSupabaseClient: () => fakeClient } });
  const auth = await freshAuth();
  const result = await auth.getSession();
  assert.equal(result.ok, false);
});

test('onAuthStateChange: unconfigured returns a safe no-op unsubscribe, listener never fires', async (t) => {
  t.mock.module(CLIENT_PATH, { exports: { getSupabaseClient: () => null } });
  const auth = await freshAuth();
  let called = false;
  const unsubscribe = auth.onAuthStateChange(() => {
    called = true;
  });
  assert.equal(typeof unsubscribe, 'function');
  unsubscribe(); // must not throw
  assert.equal(called, false);
});

test('onAuthStateChange: registers exactly one underlying listener and cleans up via unsubscribe', async (t) => {
  let registeredCallback: ((event: string, session: unknown) => void) | null = null;
  let unsubscribeCalls = 0;
  const fakeClient = {
    auth: {
      onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
        registeredCallback = cb;
        return { data: { subscription: { unsubscribe: () => { unsubscribeCalls += 1; } } } };
      },
    },
  };
  t.mock.module(CLIENT_PATH, { exports: { getSupabaseClient: () => fakeClient } });
  const auth = await freshAuth();
  const events: Array<{ event: string; user: unknown }> = [];
  const unsubscribe = auth.onAuthStateChange((event: string, user: unknown) => events.push({ event, user }));
  assert.equal(typeof registeredCallback, 'function');
  registeredCallback!('SIGNED_IN', { access_token: 'x', refresh_token: 'y', user: { id: 'u5', email: null } });
  assert.deepEqual(events, [{ event: 'SIGNED_IN', user: { id: 'u5', email: null } }]);
  unsubscribe();
  assert.equal(unsubscribeCalls, 1);
});

test('no credential leakage: a failure message never contains the raw SDK message text for a mapped reason', async (t) => {
  const fakeError = new AuthApiError('super secret internal detail xyz123', 400, 'invalid_credentials');
  const fakeClient = { auth: { signInWithPassword: async () => ({ data: { user: null, session: null }, error: fakeError }) } };
  t.mock.module(CLIENT_PATH, { exports: { getSupabaseClient: () => fakeClient } });
  const auth = await freshAuth();
  const result = await auth.signIn('a@b.com', 'wrong');
  assert.equal(result.ok, false);
  assert.equal(result.error.message.includes('xyz123'), false);
});

test('requestPasswordReset: passes the app deep-link redirectTo, not the SDK default', async (t) => {
  let capturedOptions: unknown;
  const fakeClient = {
    auth: {
      resetPasswordForEmail: async (_email: string, options: unknown) => {
        capturedOptions = options;
        return { data: {}, error: null };
      },
    },
  };
  t.mock.module(CLIENT_PATH, { exports: { getSupabaseClient: () => fakeClient } });
  const auth = await freshAuth();
  const result = await auth.requestPasswordReset('a@b.com');
  assert.equal(result.ok, true);
  assert.deepEqual(capturedOptions, { redirectTo: 'kettleborn://reset-password' });
});

test('requestPasswordReset: not_configured when no client', async (t) => {
  t.mock.module(CLIENT_PATH, { exports: { getSupabaseClient: () => null } });
  const auth = await freshAuth();
  const result = await auth.requestPasswordReset('a@b.com');
  assert.equal(result.ok, false);
  assert.equal(result.error.reason, 'not_configured');
});

test('exchangeCodeForSession: not_configured when no client', async (t) => {
  t.mock.module(CLIENT_PATH, { exports: { getSupabaseClient: () => null } });
  const auth = await freshAuth();
  const result = await auth.exchangeCodeForSession('some-code');
  assert.equal(result.ok, false);
  assert.equal(result.error.reason, 'not_configured');
});

test('exchangeCodeForSession: success returns a minimal AppAuthUser', async (t) => {
  const fakeClient = {
    auth: {
      exchangeCodeForSession: async (code: string) => {
        assert.equal(code, 'real-code-123');
        return { data: { user: { id: 'u6', email: 'recover@b.com' }, session: { access_token: 'x', refresh_token: 'y' } }, error: null };
      },
    },
  };
  t.mock.module(CLIENT_PATH, { exports: { getSupabaseClient: () => fakeClient } });
  const auth = await freshAuth();
  const result = await auth.exchangeCodeForSession('real-code-123');
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, { id: 'u6', email: 'recover@b.com' });
});

test('exchangeCodeForSession: an invalid/expired code is reported, not swallowed', async (t) => {
  const fakeError = new AuthApiError('Token has expired or is invalid', 403, 'bad_oauth_callback');
  const fakeClient = { auth: { exchangeCodeForSession: async () => ({ data: { user: null, session: null }, error: fakeError }) } };
  t.mock.module(CLIENT_PATH, { exports: { getSupabaseClient: () => fakeClient } });
  const auth = await freshAuth();
  const result = await auth.exchangeCodeForSession('expired-code');
  assert.equal(result.ok, false);
});

test('updatePassword: not_configured when no client', async (t) => {
  t.mock.module(CLIENT_PATH, { exports: { getSupabaseClient: () => null } });
  const auth = await freshAuth();
  const result = await auth.updatePassword('newpassword123');
  assert.equal(result.ok, false);
  assert.equal(result.error.reason, 'not_configured');
});

test('updatePassword: success', async (t) => {
  let capturedAttributes: unknown;
  const fakeClient = {
    auth: {
      updateUser: async (attrs: unknown) => {
        capturedAttributes = attrs;
        return { data: { user: {} }, error: null };
      },
    },
  };
  t.mock.module(CLIENT_PATH, { exports: { getSupabaseClient: () => fakeClient } });
  const auth = await freshAuth();
  const result = await auth.updatePassword('newpassword123');
  assert.equal(result.ok, true);
  assert.deepEqual(capturedAttributes, { password: 'newpassword123' });
});

test('updatePassword: weak_password is mapped and not swallowed', async (t) => {
  const fakeError = new AuthApiError('Password is too weak', 422, 'weak_password');
  const fakeClient = { auth: { updateUser: async () => ({ data: { user: null }, error: fakeError }) } };
  t.mock.module(CLIENT_PATH, { exports: { getSupabaseClient: () => fakeClient } });
  const auth = await freshAuth();
  const result = await auth.updatePassword('123');
  assert.equal(result.ok, false);
  assert.equal(result.error.reason, 'weak_password');
});

test('onAuthStateChange: PASSWORD_RECOVERY is a distinguished event, not mapped to OTHER', async (t) => {
  let registeredCallback: ((event: string, session: unknown) => void) | null = null;
  const fakeClient = {
    auth: {
      onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
        registeredCallback = cb;
        return { data: { subscription: { unsubscribe: () => undefined } } };
      },
    },
  };
  t.mock.module(CLIENT_PATH, { exports: { getSupabaseClient: () => fakeClient } });
  const auth = await freshAuth();
  const events: Array<{ event: string; user: unknown }> = [];
  auth.onAuthStateChange((event: string, user: unknown) => events.push({ event, user }));
  registeredCallback!('PASSWORD_RECOVERY', { access_token: 'x', refresh_token: 'y', user: { id: 'u7', email: null } });
  assert.deepEqual(events, [{ event: 'PASSWORD_RECOVERY', user: { id: 'u7', email: null } }]);
});
