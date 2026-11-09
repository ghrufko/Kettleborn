import test from 'node:test';
import assert from 'node:assert/strict';
import { AuthApiError, AuthPKCECodeVerifierMissingError, AuthRetryableFetchError } from '@supabase/supabase-js';

const CLIENT_PATH = new URL('../client.ts', import.meta.url).href;
const PLATFORM_PATH = new URL('../platform.ts', import.meta.url).href;
const AUTH_URL = new URL('../auth.ts', import.meta.url).href;

async function freshAuth() {
  return import(`${AUTH_URL}?bust=${Math.random()}`);
}

/**
 * platform.ts is the auth layer's only `react-native` import, which can't
 * load under plain Node — every test mocks it alongside client.ts. The
 * default is a native (Android/iOS) device in the foreground.
 */
interface FakePlatform {
  isWebPlatform?: () => boolean;
  getWebOrigin?: () => string | null;
  getInitialWebUrl?: () => string | null;
  replaceWebUrlWithRoot?: () => void;
  isAppActive?: () => boolean;
  subscribeToAppActive?: (listener: (active: boolean) => void) => () => void;
}

const NATIVE_PLATFORM: Required<FakePlatform> = {
  isWebPlatform: () => false,
  getWebOrigin: () => null,
  getInitialWebUrl: () => null,
  replaceWebUrlWithRoot: () => undefined,
  isAppActive: () => true,
  subscribeToAppActive: () => () => undefined,
};

const WEB_ORIGIN = 'https://animated-pixie-b97fbb.netlify.app';
const WEB_PLATFORM: FakePlatform = {
  isWebPlatform: () => true,
  getWebOrigin: () => WEB_ORIGIN,
};

function mockClient(t: any, client: unknown, platform: FakePlatform = {}) {
  t.mock.module(CLIENT_PATH, { exports: { getSupabaseClient: () => client } });
  t.mock.module(PLATFORM_PATH, { exports: { ...NATIVE_PLATFORM, ...platform } });
}

test('signIn: not_configured when no client (unconfigured)', async (t) => {
  mockClient(t, null);
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
  mockClient(t, fakeClient);
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
  mockClient(t, fakeClient);
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
  mockClient(t, fakeClient);
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
  mockClient(t, fakeClient);
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
  mockClient(t, fakeClient);
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
  mockClient(t, fakeClient);
  const auth = await freshAuth();
  const result = await auth.signUp('e@f.com', 'password123');
  assert.equal(result.ok, true);
  assert.equal(result.data.emailConfirmationRequired, false);
});

test('signUp: maps already_registered', async (t) => {
  const fakeError = new AuthApiError('User already registered', 422, 'user_already_exists');
  const fakeClient = { auth: { signUp: async () => ({ data: { user: null, session: null }, error: fakeError }) } };
  mockClient(t, fakeClient);
  const auth = await freshAuth();
  const result = await auth.signUp('dup@b.com', 'password123');
  assert.equal(result.ok, false);
  assert.equal(result.error.reason, 'already_registered');
});

test('signUp: maps weak_password', async (t) => {
  const fakeError = new AuthApiError('Password is too weak', 422, 'weak_password');
  const fakeClient = { auth: { signUp: async () => ({ data: { user: null, session: null }, error: fakeError }) } };
  mockClient(t, fakeClient);
  const auth = await freshAuth();
  const result = await auth.signUp('weak@b.com', '123');
  assert.equal(result.ok, false);
  assert.equal(result.error.reason, 'weak_password');
});

test('signUp: maps rate limiting', async (t) => {
  const fakeError = new AuthApiError('Too many requests', 429, 'over_email_send_rate_limit');
  const fakeClient = { auth: { signUp: async () => ({ data: { user: null, session: null }, error: fakeError }) } };
  mockClient(t, fakeClient);
  const auth = await freshAuth();
  const result = await auth.signUp('rl@b.com', 'password123');
  assert.equal(result.ok, false);
  assert.equal(result.error.reason, 'rate_limited');
});

test('signOut: not_configured client is a trivial success (nothing to sign out of)', async (t) => {
  mockClient(t, null);
  const auth = await freshAuth();
  const result = await auth.signOut();
  assert.equal(result.ok, true);
});

test('signOut: a real failure is NOT reported as success', async (t) => {
  const fakeError = new AuthApiError('Network down', 0, undefined);
  const fakeClient = { auth: { signOut: async () => ({ error: fakeError }) } };
  mockClient(t, fakeClient);
  const auth = await freshAuth();
  const result = await auth.signOut();
  assert.equal(result.ok, false);
});

test('signOut: successful sign-out', async (t) => {
  const fakeClient = { auth: { signOut: async () => ({ error: null }) } };
  mockClient(t, fakeClient);
  const auth = await freshAuth();
  const result = await auth.signOut();
  assert.equal(result.ok, true);
});

test('getSession: unconfigured returns ok:true, data:null (not an error)', async (t) => {
  mockClient(t, null);
  const auth = await freshAuth();
  const result = await auth.getSession();
  assert.equal(result.ok, true);
  assert.equal(result.data, null);
});

test('getSession: restores an existing session as a minimal AppAuthUser', async (t) => {
  const fakeSession = { access_token: 'x', refresh_token: 'y', user: { id: 'u4', email: 'g@h.com' } };
  const fakeClient = { auth: { getSession: async () => ({ data: { session: fakeSession }, error: null }) } };
  mockClient(t, fakeClient);
  const auth = await freshAuth();
  const result = await auth.getSession();
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, { id: 'u4', email: 'g@h.com' });
});

test('getSession: a real error restoring the session is reported, not swallowed into null', async (t) => {
  const fakeError = new AuthApiError('Session lookup failed', 500, undefined);
  const fakeClient = { auth: { getSession: async () => ({ data: { session: null }, error: fakeError }) } };
  mockClient(t, fakeClient);
  const auth = await freshAuth();
  const result = await auth.getSession();
  assert.equal(result.ok, false);
});

test('onAuthStateChange: unconfigured returns a safe no-op unsubscribe, listener never fires', async (t) => {
  mockClient(t, null);
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
  mockClient(t, fakeClient);
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
  mockClient(t, fakeClient);
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
  mockClient(t, fakeClient);
  const auth = await freshAuth();
  const result = await auth.requestPasswordReset('a@b.com');
  assert.equal(result.ok, true);
  assert.deepEqual(capturedOptions, { redirectTo: 'kettleborn://reset-password' });
});

test('requestPasswordReset: not_configured when no client', async (t) => {
  mockClient(t, null);
  const auth = await freshAuth();
  const result = await auth.requestPasswordReset('a@b.com');
  assert.equal(result.ok, false);
  assert.equal(result.error.reason, 'not_configured');
});

test('exchangeCodeForSession: not_configured when no client', async (t) => {
  mockClient(t, null);
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
  mockClient(t, fakeClient);
  const auth = await freshAuth();
  const result = await auth.exchangeCodeForSession('real-code-123');
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, { id: 'u6', email: 'recover@b.com' });
});

test('exchangeCodeForSession: an invalid/expired code is reported, not swallowed', async (t) => {
  const fakeError = new AuthApiError('Token has expired or is invalid', 403, 'bad_oauth_callback');
  const fakeClient = { auth: { exchangeCodeForSession: async () => ({ data: { user: null, session: null }, error: fakeError }) } };
  mockClient(t, fakeClient);
  const auth = await freshAuth();
  const result = await auth.exchangeCodeForSession('expired-code');
  assert.equal(result.ok, false);
});

test('updatePassword: not_configured when no client', async (t) => {
  mockClient(t, null);
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
  mockClient(t, fakeClient);
  const auth = await freshAuth();
  const result = await auth.updatePassword('newpassword123');
  assert.equal(result.ok, true);
  assert.deepEqual(capturedAttributes, { password: 'newpassword123' });
});

test('updatePassword: weak_password is mapped and not swallowed', async (t) => {
  const fakeError = new AuthApiError('Password is too weak', 422, 'weak_password');
  const fakeClient = { auth: { updateUser: async () => ({ data: { user: null }, error: fakeError }) } };
  mockClient(t, fakeClient);
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
  mockClient(t, fakeClient);
  const auth = await freshAuth();
  const events: Array<{ event: string; user: unknown }> = [];
  auth.onAuthStateChange((event: string, user: unknown) => events.push({ event, user }));
  registeredCallback!('PASSWORD_RECOVERY', { access_token: 'x', refresh_token: 'y', user: { id: 'u7', email: null } });
  assert.deepEqual(events, [{ event: 'PASSWORD_RECOVERY', user: { id: 'u7', email: null } }]);
});

// ---------------------------------------------------------------------
// Phase 1 (auth stabilization): per-platform redirects, repeated sign-up
// semantics, resend, SDK error mapping, token-refresh lifecycle, and web
// callback capture.
// ---------------------------------------------------------------------

function captureSignUp() {
  const calls: any[] = [];
  const client = {
    auth: {
      signUp: async (args: unknown) => {
        calls.push(args);
        return { data: { user: { id: 'u2', email: 'c@d.com' }, session: null }, error: null };
      },
    },
  };
  return { calls, client };
}

test('signUp on web: emailRedirectTo is the site origin, never the native kettleborn:// scheme', async (t) => {
  const { calls, client } = captureSignUp();
  mockClient(t, client, WEB_PLATFORM);
  const auth = await freshAuth();
  await auth.signUp('c@d.com', 'password123');
  assert.equal(calls[0].options.emailRedirectTo, `${WEB_ORIGIN}/confirm-email`);
  assert.equal(calls[0].options.emailRedirectTo.startsWith('kettleborn://'), false);
});

test('signUp on native: emailRedirectTo is kettleborn://confirm-email', async (t) => {
  const { calls, client } = captureSignUp();
  mockClient(t, client);
  const auth = await freshAuth();
  await auth.signUp('c@d.com', 'password123');
  assert.equal(calls[0].options.emailRedirectTo, 'kettleborn://confirm-email');
});

test('requestPasswordReset on web: redirectTo is the site origin reset path', async (t) => {
  let captured: any;
  mockClient(
    t,
    {
      auth: {
        resetPasswordForEmail: async (_e: string, options: unknown) => {
          captured = options;
          return { data: {}, error: null };
        },
      },
    },
    WEB_PLATFORM
  );
  const auth = await freshAuth();
  await auth.requestPasswordReset('a@b.com');
  assert.deepEqual(captured, { redirectTo: `${WEB_ORIGIN}/reset-password` });
});

test('repeated registration with confirmations ON: the obfuscated response is treated exactly like a new signup', async (t) => {
  // Shape GoTrue returns for an already-registered, confirmed address when
  // "Confirm email" is on: a user object with no identities, a null
  // session and NO error — deliberately indistinguishable to the caller.
  const obfuscated = {
    data: {
      user: {
        id: '5d7c1f3e-0a8b-4c2d-9e6f-1a2b3c4d5e6f',
        aud: 'authenticated',
        role: 'authenticated',
        email: 'existing@b.com',
        identities: [],
        user_metadata: {},
        app_metadata: { provider: 'email', providers: ['email'] },
        created_at: '2026-10-01T10:00:00.000000Z',
      },
      session: null,
    },
    error: null,
  };
  mockClient(t, { auth: { signUp: async () => obfuscated } });
  const auth = await freshAuth();
  const result = await auth.signUp('existing@b.com', 'password123');
  assert.equal(result.ok, true);
  assert.equal(result.data.emailConfirmationRequired, true);
  // Exposes no field that could be (mis)used to claim "account exists".
  assert.deepEqual(Object.keys(result.data).sort(), ['emailConfirmationRequired', 'user']);
});

test('resendConfirmation: sends a signup resend with the native redirect', async (t) => {
  let captured: any;
  mockClient(t, {
    auth: {
      resend: async (args: unknown) => {
        captured = args;
        return { data: {}, error: null };
      },
    },
  });
  const auth = await freshAuth();
  const result = await auth.resendConfirmation('c@d.com');
  assert.equal(result.ok, true);
  assert.deepEqual(captured, { type: 'signup', email: 'c@d.com', options: { emailRedirectTo: 'kettleborn://confirm-email' } });
});

test('resendConfirmation: web redirect, and rate limiting is mapped', async (t) => {
  let captured: any;
  const fakeError = new AuthApiError('For security purposes, you can only request this after 60 seconds.', 429, 'over_email_send_rate_limit');
  mockClient(
    t,
    {
      auth: {
        resend: async (args: unknown) => {
          captured = args;
          return { data: {}, error: fakeError };
        },
      },
    },
    WEB_PLATFORM
  );
  const auth = await freshAuth();
  const result = await auth.resendConfirmation('c@d.com');
  assert.equal(captured.options.emailRedirectTo, `${WEB_ORIGIN}/confirm-email`);
  assert.equal(result.ok, false);
  assert.equal(result.error.reason, 'rate_limited');
});

test('resendConfirmation: not_configured when no client', async (t) => {
  mockClient(t, null);
  const auth = await freshAuth();
  const result = await auth.resendConfirmation('c@d.com');
  assert.equal(result.ok, false);
  assert.equal(result.error.reason, 'not_configured');
});

for (const [code, reason] of [
  ['otp_expired', 'link_expired'],
  ['flow_state_expired', 'link_expired'],
  ['flow_state_not_found', 'link_invalid'],
  ['bad_code_verifier', 'link_invalid'],
] as const) {
  test(`exchangeCodeForSession: ${code} maps to ${reason}`, async (t) => {
    const fakeError = new AuthApiError('upstream text', 403, code);
    mockClient(t, { auth: { exchangeCodeForSession: async () => ({ data: { user: null, session: null }, error: fakeError }) } });
    const auth = await freshAuth();
    const result = await auth.exchangeCodeForSession('some-code');
    assert.equal(result.ok, false);
    assert.equal(result.error.reason, reason);
  });
}

test('exchangeCodeForSession: a link opened on another device (verifier missing, a non-API SDK error) maps to link_invalid', async (t) => {
  mockClient(t, {
    auth: {
      exchangeCodeForSession: async () => ({ data: { user: null, session: null }, error: new AuthPKCECodeVerifierMissingError() }),
    },
  });
  const auth = await freshAuth();
  const result = await auth.exchangeCodeForSession('code-from-other-device');
  assert.equal(result.ok, false);
  assert.equal(result.error.reason, 'link_invalid');
});

for (const [method, code, reason] of [
  ['updatePassword', 'same_password', 'same_password'],
  ['updatePassword', 'reauthentication_needed', 'reauthentication_needed'],
  ['updatePassword', 'session_not_found', 'session_expired'],
  ['signUp', 'email_address_not_authorized', 'email_not_authorized'],
  ['signUp', 'signup_disabled', 'signups_disabled'],
] as const) {
  test(`${method}: ${code} maps to ${reason}`, async (t) => {
    const fakeError = new AuthApiError('upstream text', 400, code);
    mockClient(t, {
      auth: {
        updateUser: async () => ({ data: { user: null }, error: fakeError }),
        signUp: async () => ({ data: { user: null, session: null }, error: fakeError }),
      },
    });
    const auth = await freshAuth();
    const result =
      method === 'updatePassword' ? await auth.updatePassword('password123') : await auth.signUp('a@b.com', 'password123');
    assert.equal(result.ok, false);
    assert.equal(result.error.reason, reason);
    assert.equal(result.error.message.includes('upstream text'), false);
  });
}

function refreshClient() {
  const calls: string[] = [];
  return {
    calls,
    client: {
      auth: {
        startAutoRefresh: async () => {
          calls.push('start');
        },
        stopAutoRefresh: async () => {
          calls.push('stop');
        },
      },
    },
  };
}

test('token refresh lifecycle (native): starts when active, stops in background, restarts on return', async (t) => {
  const { calls, client } = refreshClient();
  let appListener: ((active: boolean) => void) | null = null;
  let unsubscribed = false;
  mockClient(t, client, {
    isAppActive: () => true,
    subscribeToAppActive: (listener) => {
      appListener = listener;
      return () => {
        unsubscribed = true;
      };
    },
  });
  const auth = await freshAuth();
  const stop = auth.startAutoRefreshLifecycle();
  assert.deepEqual(calls, ['start']);
  appListener!(false);
  appListener!(true);
  assert.deepEqual(calls, ['start', 'stop', 'start']);
  stop();
  assert.equal(unsubscribed, true);
});

test('token refresh lifecycle: launched in the background, the ticker stays stopped until the app is active', async (t) => {
  const { calls, client } = refreshClient();
  mockClient(t, client, { isAppActive: () => false });
  const auth = await freshAuth();
  auth.startAutoRefreshLifecycle();
  assert.deepEqual(calls, ['stop']);
});

test('token refresh lifecycle: no-op on web (the SDK uses visibilitychange)', async (t) => {
  const { calls, client } = refreshClient();
  let subscribed = false;
  mockClient(t, client, {
    ...WEB_PLATFORM,
    subscribeToAppActive: () => {
      subscribed = true;
      return () => undefined;
    },
  });
  const auth = await freshAuth();
  auth.startAutoRefreshLifecycle();
  assert.deepEqual(calls, []);
  assert.equal(subscribed, false);
});

test('getInitialWebAuthCallback: parses the URL captured at app start on web', async (t) => {
  const url = `${WEB_ORIGIN}/reset-password#access_token=eyJ.a.b&expires_at=1762700400&expires_in=3600&refresh_token=v1.r&token_type=bearer&type=recovery`;
  mockClient(t, {}, { ...WEB_PLATFORM, getInitialWebUrl: () => url });
  const auth = await freshAuth();
  assert.deepEqual(auth.getInitialWebAuthCallback(), { kind: 'implicit', route: 'reset-password', type: 'recovery' });
});

test('getInitialWebAuthCallback: native ignores any URL', async (t) => {
  mockClient(t, {}, { getInitialWebUrl: () => 'kettleborn://reset-password?code=abc' });
  const auth = await freshAuth();
  assert.equal(auth.getInitialWebAuthCallback(), null);
});

test('clearWebAuthCallbackUrl: replaces the URL on web only', async (t) => {
  let replaced = 0;
  mockClient(t, {}, {
    ...WEB_PLATFORM,
    replaceWebUrlWithRoot: () => {
      replaced += 1;
    },
  });
  const auth = await freshAuth();
  auth.clearWebAuthCallbackUrl();
  assert.equal(replaced, 1);
});
