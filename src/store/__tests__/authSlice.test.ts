import test from 'node:test';
import assert from 'node:assert/strict';

const AUTH_PATH = new URL('../../services/supabase/auth.ts', import.meta.url).href;
const SLICE_URL = new URL('../authSlice.ts', import.meta.url).href;

/**
 * Exports of auth.ts that most tests don't care about. Spread first into
 * every mock so a test only lists what it actually exercises (an ESM mock
 * missing a named import fails at link time).
 */
const AUTH_DEFAULTS = {
  isAuthAvailable: () => true,
  getSession: async () => ({ ok: true, data: null }),
  onAuthStateChange: () => () => undefined,
  signUp: async () => ({ ok: false, error: { reason: 'unknown', message: '' } }),
  signIn: async () => ({ ok: false, error: { reason: 'unknown', message: '' } }),
  signOut: async () => ({ ok: true, data: undefined }),
  exchangeCodeForSession: async () => ({ ok: false, error: { reason: 'unknown', message: '' } }),
  updatePassword: async () => ({ ok: false, error: { reason: 'unknown', message: '' } }),
  onSessionStorageFailure: () => () => undefined,
  startAutoRefreshLifecycle: () => () => undefined,
  getInitialWebAuthCallback: () => null,
  clearWebAuthCallbackUrl: () => undefined,
};

/**
 * A minimal Zustand-shaped harness: `set`/`get` close over one mutable
 * state object, same contract real Zustand gives a StateCreator. Good
 * enough to exercise createAuthSlice's logic without constructing the
 * full AppStore (which would pull in expo-sqlite and other RN-only
 * modules unusable under plain Node).
 */
function makeHarness() {
  let state: Record<string, unknown> = {};
  const set = (patch: Record<string, unknown> | ((s: typeof state) => Record<string, unknown>)) => {
    state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
  };
  const get = () => state;
  return {
    set,
    get,
    seed: (initial: Record<string, unknown>) => {
      state = { ...state, ...initial };
    },
  };
}

async function freshSlice() {
  return import(`${SLICE_URL}?bust=${Math.random()}`);
}

test('initializeAuth: unavailable config sets status without calling getSession', async (t) => {
  let getSessionCalled = false;
  t.mock.module(AUTH_PATH, {
    exports: {
      ...AUTH_DEFAULTS,
      isAuthAvailable: () => false,
      getSession: async () => {
        getSessionCalled = true;
        return { ok: true, data: null };
      },
      onAuthStateChange: () => () => undefined,
      signUp: async () => ({ ok: false, error: { reason: 'not_configured', message: '' } }),
      signIn: async () => ({ ok: false, error: { reason: 'not_configured', message: '' } }),
      signOut: async () => ({ ok: true, data: undefined }),
      exchangeCodeForSession: async () => ({ ok: false, error: { reason: 'unknown', message: '' } }),
      updatePassword: async () => ({ ok: false, error: { reason: 'unknown', message: '' } }),
    },
  });
  const { createAuthSlice } = await freshSlice();
  const h = makeHarness();
  const slice = createAuthSlice(h.set as any, h.get as any, {} as any);
  h.seed(slice);

  await slice.initializeAuth();
  assert.equal(h.get().authStatus, 'unavailable');
  assert.equal(getSessionCalled, false);
});

test('initializeAuth: configured + existing session -> signed_in', async (t) => {
  t.mock.module(AUTH_PATH, {
    exports: {
      ...AUTH_DEFAULTS,
      isAuthAvailable: () => true,
      getSession: async () => ({ ok: true, data: { id: 'u1', email: 'a@b.com' } }),
      onAuthStateChange: () => () => undefined,
      signUp: async () => ({ ok: false, error: { reason: 'unknown', message: '' } }),
      signIn: async () => ({ ok: false, error: { reason: 'unknown', message: '' } }),
      signOut: async () => ({ ok: true, data: undefined }),
      exchangeCodeForSession: async () => ({ ok: false, error: { reason: 'unknown', message: '' } }),
      updatePassword: async () => ({ ok: false, error: { reason: 'unknown', message: '' } }),
    },
  });
  const { createAuthSlice } = await freshSlice();
  const h = makeHarness();
  const slice = createAuthSlice(h.set as any, h.get as any, {} as any);
  h.seed(slice);

  await slice.initializeAuth();
  assert.equal(h.get().authStatus, 'signed_in');
  assert.deepEqual(h.get().authUser, { id: 'u1', email: 'a@b.com' });
});

test('initializeAuth: configured + no session -> signed_out, no authUser', async (t) => {
  t.mock.module(AUTH_PATH, {
    exports: {
      ...AUTH_DEFAULTS,
      isAuthAvailable: () => true,
      getSession: async () => ({ ok: true, data: null }),
      onAuthStateChange: () => () => undefined,
      signUp: async () => ({ ok: false, error: { reason: 'unknown', message: '' } }),
      signIn: async () => ({ ok: false, error: { reason: 'unknown', message: '' } }),
      signOut: async () => ({ ok: true, data: undefined }),
      exchangeCodeForSession: async () => ({ ok: false, error: { reason: 'unknown', message: '' } }),
      updatePassword: async () => ({ ok: false, error: { reason: 'unknown', message: '' } }),
    },
  });
  const { createAuthSlice } = await freshSlice();
  const h = makeHarness();
  const slice = createAuthSlice(h.set as any, h.get as any, {} as any);
  h.seed(slice);

  await slice.initializeAuth();
  assert.equal(h.get().authStatus, 'signed_out');
  assert.equal(h.get().authUser, null);
});

test('initializeAuth: a getSession failure does not block startup and is recorded as a recoverable error', async (t) => {
  t.mock.module(AUTH_PATH, {
    exports: {
      ...AUTH_DEFAULTS,
      isAuthAvailable: () => true,
      getSession: async () => ({ ok: false, error: { reason: 'network_error', message: 'offline' } }),
      onAuthStateChange: () => () => undefined,
      signUp: async () => ({ ok: false, error: { reason: 'unknown', message: '' } }),
      signIn: async () => ({ ok: false, error: { reason: 'unknown', message: '' } }),
      signOut: async () => ({ ok: true, data: undefined }),
      exchangeCodeForSession: async () => ({ ok: false, error: { reason: 'unknown', message: '' } }),
      updatePassword: async () => ({ ok: false, error: { reason: 'unknown', message: '' } }),
    },
  });
  const { createAuthSlice } = await freshSlice();
  const h = makeHarness();
  const slice = createAuthSlice(h.set as any, h.get as any, {} as any);
  h.seed(slice);

  await assert.doesNotReject(slice.initializeAuth());
  assert.equal(h.get().authStatus, 'signed_out');
  assert.equal((h.get().authError as any)?.reason, 'network_error');
});

test('initializeAuth: calling it twice registers only one underlying listener', async (t) => {
  let registrations = 0;
  t.mock.module(AUTH_PATH, {
    exports: {
      ...AUTH_DEFAULTS,
      isAuthAvailable: () => true,
      getSession: async () => ({ ok: true, data: null }),
      onAuthStateChange: () => {
        registrations += 1;
        return () => undefined;
      },
      signUp: async () => ({ ok: false, error: { reason: 'unknown', message: '' } }),
      signIn: async () => ({ ok: false, error: { reason: 'unknown', message: '' } }),
      signOut: async () => ({ ok: true, data: undefined }),
      exchangeCodeForSession: async () => ({ ok: false, error: { reason: 'unknown', message: '' } }),
      updatePassword: async () => ({ ok: false, error: { reason: 'unknown', message: '' } }),
    },
  });
  const { createAuthSlice } = await freshSlice();
  const h = makeHarness();
  const slice = createAuthSlice(h.set as any, h.get as any, {} as any);
  h.seed(slice);

  await slice.initializeAuth();
  await slice.initializeAuth();
  assert.equal(registrations, 1);
});

test('authSignIn: a second call while one is in flight is rejected as a duplicate submission', async (t) => {
  let signInCalls = 0;
  t.mock.module(AUTH_PATH, {
    exports: {
      ...AUTH_DEFAULTS,
      isAuthAvailable: () => true,
      getSession: async () => ({ ok: true, data: null }),
      onAuthStateChange: () => () => undefined,
      signUp: async () => ({ ok: false, error: { reason: 'unknown', message: '' } }),
      signIn: async () => {
        signInCalls += 1;
        await new Promise((r) => setTimeout(r, 20));
        return { ok: true, data: { id: 'u1', email: 'a@b.com' } };
      },
      signOut: async () => ({ ok: true, data: undefined }),
      exchangeCodeForSession: async () => ({ ok: false, error: { reason: 'unknown', message: '' } }),
      updatePassword: async () => ({ ok: false, error: { reason: 'unknown', message: '' } }),
    },
  });
  const { createAuthSlice } = await freshSlice();
  const h = makeHarness();
  const slice = createAuthSlice(h.set as any, h.get as any, {} as any);
  h.seed(slice);

  const first = slice.authSignIn('a@b.com', 'password');
  const second = slice.authSignIn('a@b.com', 'password'); // fired before `first` resolves
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(firstResult.ok, true);
  assert.equal(secondResult.ok, false);
  assert.equal(signInCalls, 1); // the duplicate never reached the service layer
});

test('authSignIn: failure leaves the store in signed_out, never stuck loading', async (t) => {
  t.mock.module(AUTH_PATH, {
    exports: {
      ...AUTH_DEFAULTS,
      isAuthAvailable: () => true,
      getSession: async () => ({ ok: true, data: null }),
      onAuthStateChange: () => () => undefined,
      signUp: async () => ({ ok: false, error: { reason: 'unknown', message: '' } }),
      signIn: async () => ({ ok: false, error: { reason: 'invalid_credentials', message: 'Incorrect email or password.' } }),
      signOut: async () => ({ ok: true, data: undefined }),
      exchangeCodeForSession: async () => ({ ok: false, error: { reason: 'unknown', message: '' } }),
      updatePassword: async () => ({ ok: false, error: { reason: 'unknown', message: '' } }),
    },
  });
  const { createAuthSlice } = await freshSlice();
  const h = makeHarness();
  const slice = createAuthSlice(h.set as any, h.get as any, {} as any);
  h.seed(slice);

  const result = await slice.authSignIn('a@b.com', 'wrong');
  assert.equal(result.ok, false);
  assert.equal(h.get().authStatus, 'signed_out');
  assert.notEqual(h.get().authStatus, 'signing_in');
});

test('authSignUp: email confirmation required leaves the store signed_out, not signed_in', async (t) => {
  t.mock.module(AUTH_PATH, {
    exports: {
      ...AUTH_DEFAULTS,
      isAuthAvailable: () => true,
      getSession: async () => ({ ok: true, data: null }),
      onAuthStateChange: () => () => undefined,
      signUp: async () => ({
        ok: true,
        data: { user: { id: 'u2', email: 'c@d.com' }, emailConfirmationRequired: true },
      }),
      signIn: async () => ({ ok: false, error: { reason: 'unknown', message: '' } }),
      signOut: async () => ({ ok: true, data: undefined }),
      exchangeCodeForSession: async () => ({ ok: false, error: { reason: 'unknown', message: '' } }),
      updatePassword: async () => ({ ok: false, error: { reason: 'unknown', message: '' } }),
    },
  });
  const { createAuthSlice } = await freshSlice();
  const h = makeHarness();
  const slice = createAuthSlice(h.set as any, h.get as any, {} as any);
  h.seed(slice);

  const result = await slice.authSignUp('c@d.com', 'password123');
  assert.equal(result.ok, true);
  assert.equal(h.get().authStatus, 'signed_out');
  assert.equal(h.get().authUser, null);
});

test('authSignOut: failure does not claim the session was destroyed (authUser preserved)', async (t) => {
  t.mock.module(AUTH_PATH, {
    exports: {
      ...AUTH_DEFAULTS,
      isAuthAvailable: () => true,
      getSession: async () => ({ ok: true, data: { id: 'u1', email: 'a@b.com' } }),
      onAuthStateChange: () => () => undefined,
      signUp: async () => ({ ok: false, error: { reason: 'unknown', message: '' } }),
      signIn: async () => ({ ok: false, error: { reason: 'unknown', message: '' } }),
      signOut: async () => ({ ok: false, error: { reason: 'network_error', message: 'offline' } }),
      exchangeCodeForSession: async () => ({ ok: false, error: { reason: 'unknown', message: '' } }),
      updatePassword: async () => ({ ok: false, error: { reason: 'unknown', message: '' } }),
    },
  });
  const { createAuthSlice } = await freshSlice();
  const h = makeHarness();
  const slice = createAuthSlice(h.set as any, h.get as any, {} as any);
  h.seed(slice);
  await slice.initializeAuth(); // establishes signed_in + authUser

  const result = await slice.authSignOut();
  assert.equal(result.ok, false);
  assert.equal(h.get().authStatus, 'signed_in');
  assert.deepEqual(h.get().authUser, { id: 'u1', email: 'a@b.com' });
});

test('clearAuthError: resets authError to null without touching other fields', async (t) => {
  t.mock.module(AUTH_PATH, {
    exports: {
      ...AUTH_DEFAULTS,
      isAuthAvailable: () => false,
      getSession: async () => ({ ok: true, data: null }),
      onAuthStateChange: () => () => undefined,
      signUp: async () => ({ ok: false, error: { reason: 'unknown', message: '' } }),
      signIn: async () => ({ ok: false, error: { reason: 'invalid_credentials', message: 'nope' } }),
      signOut: async () => ({ ok: true, data: undefined }),
      exchangeCodeForSession: async () => ({ ok: false, error: { reason: 'unknown', message: '' } }),
      updatePassword: async () => ({ ok: false, error: { reason: 'unknown', message: '' } }),
    },
  });
  const { createAuthSlice } = await freshSlice();
  const h = makeHarness();
  const slice = createAuthSlice(h.set as any, h.get as any, {} as any);
  h.seed(slice);
  await slice.authSignIn('a@b.com', 'wrong');
  assert.ok(h.get().authError);

  slice.clearAuthError();
  assert.equal(h.get().authError, null);
});

test('PASSWORD_RECOVERY event: sets passwordRecoveryPending without going through handlePasswordRecoveryLink', async (t) => {
  let registeredCallback: ((event: string, user: unknown) => void) | null = null;
  t.mock.module(AUTH_PATH, {
    exports: {
      ...AUTH_DEFAULTS,
      isAuthAvailable: () => true,
      getSession: async () => ({ ok: true, data: null }),
      onAuthStateChange: (cb: (event: string, user: unknown) => void) => {
        registeredCallback = cb;
        return () => undefined;
      },
      signUp: async () => ({ ok: false, error: { reason: 'unknown', message: '' } }),
      signIn: async () => ({ ok: false, error: { reason: 'unknown', message: '' } }),
      signOut: async () => ({ ok: true, data: undefined }),
      exchangeCodeForSession: async () => ({ ok: false, error: { reason: 'unknown', message: '' } }),
      updatePassword: async () => ({ ok: false, error: { reason: 'unknown', message: '' } }),
    },
  });
  const { createAuthSlice } = await freshSlice();
  const h = makeHarness();
  const slice = createAuthSlice(h.set as any, h.get as any, {} as any);
  h.seed(slice);

  await slice.initializeAuth();
  assert.equal(h.get().passwordRecoveryPending, false);

  registeredCallback!('PASSWORD_RECOVERY', { id: 'u8', email: 'recover@b.com' });
  assert.equal(h.get().passwordRecoveryPending, true);
  assert.equal(h.get().authStatus, 'signed_in');
  assert.deepEqual(h.get().authUser, { id: 'u8', email: 'recover@b.com' });
});

test('handlePasswordRecoveryLink: success sets passwordRecoveryPending and authUser', async (t) => {
  t.mock.module(AUTH_PATH, {
    exports: {
      ...AUTH_DEFAULTS,
      isAuthAvailable: () => true,
      getSession: async () => ({ ok: true, data: null }),
      onAuthStateChange: () => () => undefined,
      signUp: async () => ({ ok: false, error: { reason: 'unknown', message: '' } }),
      signIn: async () => ({ ok: false, error: { reason: 'unknown', message: '' } }),
      signOut: async () => ({ ok: true, data: undefined }),
      exchangeCodeForSession: async (code: string) => {
        assert.equal(code, 'deep-link-code-123');
        return { ok: true, data: { id: 'u9', email: 'recover2@b.com' } };
      },
      updatePassword: async () => ({ ok: false, error: { reason: 'unknown', message: '' } }),
    },
  });
  const { createAuthSlice } = await freshSlice();
  const h = makeHarness();
  const slice = createAuthSlice(h.set as any, h.get as any, {} as any);
  h.seed(slice);

  const result = await slice.handlePasswordRecoveryLink('deep-link-code-123');
  assert.equal(result.ok, true);
  assert.equal(h.get().passwordRecoveryPending, true);
  assert.equal(h.get().authStatus, 'signed_in');
  assert.deepEqual(h.get().authUser, { id: 'u9', email: 'recover2@b.com' });
});

test('handlePasswordRecoveryLink: an expired/invalid code is reported, passwordRecoveryPending stays false', async (t) => {
  t.mock.module(AUTH_PATH, {
    exports: {
      ...AUTH_DEFAULTS,
      isAuthAvailable: () => true,
      getSession: async () => ({ ok: true, data: null }),
      onAuthStateChange: () => () => undefined,
      signUp: async () => ({ ok: false, error: { reason: 'unknown', message: '' } }),
      signIn: async () => ({ ok: false, error: { reason: 'unknown', message: '' } }),
      signOut: async () => ({ ok: true, data: undefined }),
      exchangeCodeForSession: async () => ({ ok: false, error: { reason: 'unknown', message: 'Link expired' } }),
      updatePassword: async () => ({ ok: false, error: { reason: 'unknown', message: '' } }),
    },
  });
  const { createAuthSlice } = await freshSlice();
  const h = makeHarness();
  const slice = createAuthSlice(h.set as any, h.get as any, {} as any);
  h.seed(slice);

  const result = await slice.handlePasswordRecoveryLink('expired-code');
  assert.equal(result.ok, false);
  assert.equal(h.get().passwordRecoveryPending, false);
  assert.ok(h.get().authError);
});

test('handleEmailConfirmationLink: success sets authUser/signed_in WITHOUT setting passwordRecoveryPending', async (t) => {
  t.mock.module(AUTH_PATH, {
    exports: {
      ...AUTH_DEFAULTS,
      isAuthAvailable: () => true,
      getSession: async () => ({ ok: true, data: null }),
      onAuthStateChange: () => () => undefined,
      signUp: async () => ({ ok: false, error: { reason: 'unknown', message: '' } }),
      signIn: async () => ({ ok: false, error: { reason: 'unknown', message: '' } }),
      signOut: async () => ({ ok: true, data: undefined }),
      exchangeCodeForSession: async (code: string) => {
        assert.equal(code, 'signup-confirm-code-123');
        return { ok: true, data: { id: 'u20', email: 'newhunter@b.com' } };
      },
      updatePassword: async () => ({ ok: false, error: { reason: 'unknown', message: '' } }),
    },
  });
  const { createAuthSlice } = await freshSlice();
  const h = makeHarness();
  const slice = createAuthSlice(h.set as any, h.get as any, {} as any);
  h.seed(slice);

  const result = await slice.handleEmailConfirmationLink('signup-confirm-code-123');
  assert.equal(result.ok, true);
  assert.equal(h.get().authStatus, 'signed_in');
  assert.deepEqual(h.get().authUser, { id: 'u20', email: 'newhunter@b.com' });
  // The key behavioral difference from handlePasswordRecoveryLink — a
  // signup confirmation must never route the UI to UpdatePasswordScreen.
  assert.notEqual(h.get().passwordRecoveryPending, true);
});

test('handleEmailConfirmationLink: an expired/invalid code is reported as a recoverable error, never claimed as signed in', async (t) => {
  t.mock.module(AUTH_PATH, {
    exports: {
      ...AUTH_DEFAULTS,
      isAuthAvailable: () => true,
      getSession: async () => ({ ok: true, data: null }),
      onAuthStateChange: () => () => undefined,
      signUp: async () => ({ ok: false, error: { reason: 'unknown', message: '' } }),
      signIn: async () => ({ ok: false, error: { reason: 'unknown', message: '' } }),
      signOut: async () => ({ ok: true, data: undefined }),
      exchangeCodeForSession: async () => ({ ok: false, error: { reason: 'unknown', message: 'Link expired' } }),
      updatePassword: async () => ({ ok: false, error: { reason: 'unknown', message: '' } }),
    },
  });
  const { createAuthSlice } = await freshSlice();
  const h = makeHarness();
  const slice = createAuthSlice(h.set as any, h.get as any, {} as any);
  h.seed(slice);

  const result = await slice.handleEmailConfirmationLink('expired-code');
  assert.equal(result.ok, false);
  assert.ok(h.get().authError);
  assert.notEqual(h.get().authStatus, 'signed_in');
});

test('completePasswordRecovery: success clears passwordRecoveryPending', async (t) => {
  t.mock.module(AUTH_PATH, {
    exports: {
      ...AUTH_DEFAULTS,
      isAuthAvailable: () => true,
      getSession: async () => ({ ok: true, data: null }),
      onAuthStateChange: () => () => undefined,
      signUp: async () => ({ ok: false, error: { reason: 'unknown', message: '' } }),
      signIn: async () => ({ ok: false, error: { reason: 'unknown', message: '' } }),
      signOut: async () => ({ ok: true, data: undefined }),
      exchangeCodeForSession: async () => ({ ok: true, data: { id: 'u10', email: null } }),
      updatePassword: async (newPassword: string) => {
        assert.equal(newPassword, 'brandNewPassword123');
        return { ok: true, data: undefined };
      },
    },
  });
  const { createAuthSlice } = await freshSlice();
  const h = makeHarness();
  const slice = createAuthSlice(h.set as any, h.get as any, {} as any);
  h.seed(slice);

  await slice.handlePasswordRecoveryLink('some-code');
  assert.equal(h.get().passwordRecoveryPending, true);

  const result = await slice.completePasswordRecovery('brandNewPassword123');
  assert.equal(result.ok, true);
  assert.equal(h.get().passwordRecoveryPending, false);
});

test('completePasswordRecovery: failure leaves passwordRecoveryPending true so the user can retry', async (t) => {
  t.mock.module(AUTH_PATH, {
    exports: {
      ...AUTH_DEFAULTS,
      isAuthAvailable: () => true,
      getSession: async () => ({ ok: true, data: null }),
      onAuthStateChange: () => () => undefined,
      signUp: async () => ({ ok: false, error: { reason: 'unknown', message: '' } }),
      signIn: async () => ({ ok: false, error: { reason: 'unknown', message: '' } }),
      signOut: async () => ({ ok: true, data: undefined }),
      exchangeCodeForSession: async () => ({ ok: true, data: { id: 'u11', email: null } }),
      updatePassword: async () => ({ ok: false, error: { reason: 'weak_password', message: 'Choose a stronger password.' } }),
    },
  });
  const { createAuthSlice } = await freshSlice();
  const h = makeHarness();
  const slice = createAuthSlice(h.set as any, h.get as any, {} as any);
  h.seed(slice);

  await slice.handlePasswordRecoveryLink('some-code');
  const result = await slice.completePasswordRecovery('weak');
  assert.equal(result.ok, false);
  assert.equal(h.get().passwordRecoveryPending, true);
  assert.equal((h.get().authError as any)?.reason, 'weak_password');
});

test('cancelPasswordRecovery: clears the flag without touching authStatus/authUser', async (t) => {
  t.mock.module(AUTH_PATH, {
    exports: {
      ...AUTH_DEFAULTS,
      isAuthAvailable: () => true,
      getSession: async () => ({ ok: true, data: null }),
      onAuthStateChange: () => () => undefined,
      signUp: async () => ({ ok: false, error: { reason: 'unknown', message: '' } }),
      signIn: async () => ({ ok: false, error: { reason: 'unknown', message: '' } }),
      signOut: async () => ({ ok: true, data: undefined }),
      exchangeCodeForSession: async () => ({ ok: true, data: { id: 'u12', email: 'x@y.com' } }),
      updatePassword: async () => ({ ok: false, error: { reason: 'unknown', message: '' } }),
    },
  });
  const { createAuthSlice } = await freshSlice();
  const h = makeHarness();
  const slice = createAuthSlice(h.set as any, h.get as any, {} as any);
  h.seed(slice);

  await slice.handlePasswordRecoveryLink('some-code');
  assert.equal(h.get().passwordRecoveryPending, true);

  slice.cancelPasswordRecovery();
  assert.equal(h.get().passwordRecoveryPending, false);
  // Does not sign out — the recovery session is still a real session.
  assert.equal(h.get().authStatus, 'signed_in');
  assert.deepEqual(h.get().authUser, { id: 'u12', email: 'x@y.com' });
});

// ---------------------------------------------------------------------
// Phase 1 (auth stabilization)
// ---------------------------------------------------------------------

const AUTH_CODE = '8d2c6b0e-3f4a-4c1d-9a7e-5b1f2c3d4e5f';
const EXPIRED_PARAMS = 'error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired';

async function sliceWith(t: any, overrides: Record<string, unknown>) {
  t.mock.module(AUTH_PATH, { exports: { ...AUTH_DEFAULTS, ...overrides } });
  const { createAuthSlice } = await freshSlice();
  const h = makeHarness();
  const slice = createAuthSlice(h.set as any, h.get as any, {} as any);
  h.seed(slice);
  return { h, slice };
}

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

test('native PKCE reset link: exchanges the real code and routes to password recovery', async (t) => {
  const exchanged: string[] = [];
  const { h, slice } = await sliceWith(t, {
    exchangeCodeForSession: async (code: string) => {
      exchanged.push(code);
      return { ok: true, data: { id: 'u30', email: 'r@b.com' } };
    },
  });
  await slice.handleAuthCallbackUrl(`kettleborn://reset-password?code=${AUTH_CODE}`);
  assert.deepEqual(exchanged, [AUTH_CODE]);
  assert.equal(h.get().passwordRecoveryPending, true);
  assert.equal(h.get().authStatus, 'signed_in');
});

test('native PKCE confirmation link: signs in, confirms by notice, never opens password recovery', async (t) => {
  const { h, slice } = await sliceWith(t, {
    exchangeCodeForSession: async () => ({ ok: true, data: { id: 'u31', email: 'new@b.com' } }),
  });
  await slice.handleAuthCallbackUrl(`kettleborn://confirm-email?code=${AUTH_CODE}`);
  assert.equal(h.get().authStatus, 'signed_in');
  assert.notEqual(h.get().passwordRecoveryPending, true);
  assert.equal((h.get().authNotice as any)?.title, 'Email Confirmed');
});

test('native expired-link redirect (error params, no code): no exchange attempted, expired notice shown', async (t) => {
  let exchangeCalls = 0;
  const { h, slice } = await sliceWith(t, {
    exchangeCodeForSession: async () => {
      exchangeCalls += 1;
      return { ok: false, error: { reason: 'unknown', message: '' } };
    },
  });
  await slice.handleAuthCallbackUrl(`kettleborn://reset-password?${EXPIRED_PARAMS}#${EXPIRED_PARAMS}`);
  assert.equal(exchangeCalls, 0);
  assert.equal((h.get().authNotice as any)?.title, 'Reset Link Expired');
  assert.equal(h.get().passwordRecoveryPending, false);
});

test('already-used reset code: exchange fails with link_expired, recovery not opened', async (t) => {
  const { h, slice } = await sliceWith(t, {
    exchangeCodeForSession: async () => ({ ok: false, error: { reason: 'link_expired', message: 'expired' } }),
  });
  await slice.handleAuthCallbackUrl(`kettleborn://reset-password?code=${AUTH_CODE}`);
  assert.equal(h.get().passwordRecoveryPending, false);
  assert.equal((h.get().authNotice as any)?.title, 'Reset Link Expired');
});

test('confirmation link opened on another device (verifier missing → link_invalid): honest guidance, not signed in', async (t) => {
  const { h, slice } = await sliceWith(t, {
    exchangeCodeForSession: async () => ({ ok: false, error: { reason: 'link_invalid', message: 'invalid' } }),
  });
  await slice.handleAuthCallbackUrl(`kettleborn://confirm-email?code=${AUTH_CODE}`);
  assert.notEqual(h.get().authStatus, 'signed_in');
  const notice = h.get().authNotice as any;
  assert.equal(notice?.title, 'Confirmation Not Completed');
  assert.match(notice?.message, /sign in with your password/);
});

test('the same deep link delivered twice (getInitialURL + url event) is exchanged only once', async (t) => {
  let exchangeCalls = 0;
  const { slice } = await sliceWith(t, {
    exchangeCodeForSession: async () => {
      exchangeCalls += 1;
      return { ok: true, data: { id: 'u32', email: null } };
    },
  });
  const url = `kettleborn://reset-password?code=${AUTH_CODE}`;
  await Promise.all([slice.handleAuthCallbackUrl(url), slice.handleAuthCallbackUrl(url)]);
  assert.equal(exchangeCalls, 1);
});

test('a network failure during the exchange lets the player reopen the same link', async (t) => {
  let exchangeCalls = 0;
  const { h, slice } = await sliceWith(t, {
    exchangeCodeForSession: async () => {
      exchangeCalls += 1;
      return exchangeCalls === 1
        ? { ok: false, error: { reason: 'network_error', message: 'offline' } }
        : { ok: true, data: { id: 'u33', email: null } };
    },
  });
  const url = `kettleborn://reset-password?code=${AUTH_CODE}`;
  await slice.handleAuthCallbackUrl(url);
  assert.equal((h.get().authNotice as any)?.title, 'Connection Problem');
  await slice.handleAuthCallbackUrl(url);
  assert.equal(exchangeCalls, 2);
  assert.equal(h.get().passwordRecoveryPending, true);
});

test('cold-start ordering: a slow session restore cannot overwrite the deep link\'s signed-in result', async (t) => {
  const order: string[] = [];
  const { h, slice } = await sliceWith(t, {
    getSession: async () => {
      await tick(30); // restoration still running when the link arrives
      order.push('getSession');
      return { ok: true, data: null };
    },
    exchangeCodeForSession: async () => {
      order.push('exchange');
      return { ok: true, data: { id: 'u34', email: 'x@b.com' } };
    },
  });
  const init = slice.initializeAuth(); // bootstrap's call, not awaited there
  await slice.handleAuthCallbackUrl(`kettleborn://reset-password?code=${AUTH_CODE}`);
  await init;
  assert.deepEqual(order, ['getSession', 'exchange']);
  assert.equal(h.get().authStatus, 'signed_in');
  assert.equal(h.get().passwordRecoveryPending, true);
});

test('non-auth URLs are ignored entirely', async (t) => {
  let exchangeCalls = 0;
  const { h, slice } = await sliceWith(t, {
    exchangeCodeForSession: async () => {
      exchangeCalls += 1;
      return { ok: true, data: { id: 'x', email: null } };
    },
  });
  await slice.handleAuthCallbackUrl('kettleborn://');
  await slice.handleAuthCallbackUrl('https://example.com/oauth/callback?code=xyz');
  assert.equal(exchangeCalls, 0);
  assert.equal(h.get().authNotice, null);
});

test('deep link while cloud accounts are unavailable: nothing is attempted', async (t) => {
  let exchangeCalls = 0;
  const { h, slice } = await sliceWith(t, {
    isAuthAvailable: () => false,
    exchangeCodeForSession: async () => {
      exchangeCalls += 1;
      return { ok: true, data: { id: 'x', email: null } };
    },
  });
  await slice.handleAuthCallbackUrl(`kettleborn://reset-password?code=${AUTH_CODE}`);
  assert.equal(exchangeCalls, 0);
  assert.equal(h.get().authStatus, 'unavailable');
});

test('web recovery callback: SDK-detected session + type=recovery opens password recovery and cleans the URL', async (t) => {
  let cleared = 0;
  const { h, slice } = await sliceWith(t, {
    getInitialWebAuthCallback: () => ({ kind: 'implicit', route: 'reset-password', type: 'recovery' }),
    getSession: async () => ({ ok: true, data: { id: 'u40', email: 'w@b.com' } }),
    clearWebAuthCallbackUrl: () => {
      cleared += 1;
    },
  });
  await slice.initializeAuth();
  assert.equal(h.get().authStatus, 'signed_in');
  assert.equal(h.get().passwordRecoveryPending, true);
  assert.equal(cleared, 1);
});

test('web signup confirmation callback: signed in with a confirmation notice, no recovery', async (t) => {
  const { h, slice } = await sliceWith(t, {
    getInitialWebAuthCallback: () => ({ kind: 'implicit', route: 'confirm-email', type: 'signup' }),
    getSession: async () => ({ ok: true, data: { id: 'u41', email: 'w@b.com' } }),
  });
  await slice.initializeAuth();
  assert.equal(h.get().authStatus, 'signed_in');
  assert.equal(h.get().passwordRecoveryPending, false);
  assert.equal((h.get().authNotice as any)?.title, 'Email Confirmed');
});

test('web expired link while already signed in: existing session kept, expired notice shown, URL cleaned', async (t) => {
  let cleared = 0;
  const { h, slice } = await sliceWith(t, {
    getInitialWebAuthCallback: () => ({
      kind: 'error',
      route: 'confirm-email',
      error: 'access_denied',
      errorCode: 'otp_expired',
      description: 'Email link is invalid or has expired',
    }),
    getSession: async () => ({ ok: true, data: { id: 'u42', email: 'w@b.com' } }),
    clearWebAuthCallbackUrl: () => {
      cleared += 1;
    },
  });
  await slice.initializeAuth();
  assert.equal(h.get().authStatus, 'signed_in');
  assert.deepEqual(h.get().authUser, { id: 'u42', email: 'w@b.com' });
  assert.equal((h.get().authNotice as any)?.title, 'Confirmation Link Expired');
  assert.equal(cleared, 1);
});

test('web callback with tokens the SDK rejected (no session results): invalid-link notice, not signed in', async (t) => {
  const { h, slice } = await sliceWith(t, {
    getInitialWebAuthCallback: () => ({ kind: 'implicit', route: 'reset-password', type: 'recovery' }),
    getSession: async () => ({ ok: true, data: null }),
  });
  await slice.initializeAuth();
  assert.equal(h.get().authStatus, 'signed_out');
  assert.equal(h.get().passwordRecoveryPending, false);
  assert.equal((h.get().authNotice as any)?.title, 'Reset Link Not Valid');
});

test('session restoration: concurrent initializeAuth calls share one restore and one set of registrations', async (t) => {
  let getSessionCalls = 0;
  let lifecycleStarts = 0;
  let storageListeners = 0;
  const { h, slice } = await sliceWith(t, {
    getSession: async () => {
      getSessionCalls += 1;
      await tick(5);
      return { ok: true, data: { id: 'u50', email: 'p@b.com' } };
    },
    startAutoRefreshLifecycle: () => {
      lifecycleStarts += 1;
      return () => undefined;
    },
    onSessionStorageFailure: () => {
      storageListeners += 1;
      return () => undefined;
    },
  });
  await Promise.all([slice.initializeAuth(), slice.initializeAuth()]);
  await slice.initializeAuth(); // e.g. a bootstrap retry after a SQLite failure
  assert.equal(getSessionCalls, 1);
  assert.equal(lifecycleStarts, 1);
  assert.equal(storageListeners, 1);
  assert.equal(h.get().authStatus, 'signed_in');
});

test('token refresh lifecycle is not started when cloud accounts are unavailable', async (t) => {
  let lifecycleStarts = 0;
  const { slice } = await sliceWith(t, {
    isAuthAvailable: () => false,
    startAutoRefreshLifecycle: () => {
      lifecycleStarts += 1;
      return () => undefined;
    },
  });
  await slice.initializeAuth();
  assert.equal(lifecycleStarts, 0);
});

test('storage failure: reported to the player once, without replacing an unread notice', async (t) => {
  let report: ((op: string) => void) | null = null;
  const { h, slice } = await sliceWith(t, {
    onSessionStorageFailure: (listener: (op: string) => void) => {
      report = listener;
      return () => undefined;
    },
  });
  await slice.initializeAuth();
  report!('write');
  assert.equal((h.get().authNotice as any)?.title, 'Sign-In Not Saved');
  slice.dismissAuthNotice();
  assert.equal(h.get().authNotice, null);
  h.seed({ authNotice: { tone: 'info', title: 'Email Confirmed', message: '' } });
  report!('read');
  assert.equal((h.get().authNotice as any)?.title, 'Email Confirmed');
});

test('authSignOut: server unreachable but the SDK already cleared the local session → signed out, with an honest notice', async (t) => {
  let getSessionCalls = 0;
  const { h, slice } = await sliceWith(t, {
    getSession: async () => {
      getSessionCalls += 1;
      return { ok: true, data: getSessionCalls === 1 ? { id: 'u60', email: 'o@b.com' } : null };
    },
    signOut: async () => ({ ok: false, error: { reason: 'network_error', message: 'offline' } }),
  });
  await slice.initializeAuth();
  assert.equal(h.get().authStatus, 'signed_in');
  const result = await slice.authSignOut();
  assert.equal(result.ok, true);
  assert.equal(h.get().authStatus, 'signed_out');
  assert.equal(h.get().authUser, null);
  assert.equal((h.get().authNotice as any)?.title, 'Signed Out');
});

test('SIGNED_OUT event (e.g. refresh token revoked) clears any pending password recovery', async (t) => {
  let listener: ((event: string, user: unknown) => void) | null = null;
  const { h, slice } = await sliceWith(t, {
    onAuthStateChange: (cb: (event: string, user: unknown) => void) => {
      listener = cb;
      return () => undefined;
    },
  });
  await slice.initializeAuth();
  listener!('PASSWORD_RECOVERY', { id: 'u70', email: null });
  assert.equal(h.get().passwordRecoveryPending, true);
  listener!('SIGNED_OUT', null);
  assert.equal(h.get().passwordRecoveryPending, false);
  assert.equal(h.get().authStatus, 'signed_out');
});

test('TOKEN_REFRESHED after returning from background keeps the user signed in', async (t) => {
  let listener: ((event: string, user: unknown) => void) | null = null;
  const { h, slice } = await sliceWith(t, {
    getSession: async () => ({ ok: true, data: { id: 'u71', email: 'b@b.com' } }),
    onAuthStateChange: (cb: (event: string, user: unknown) => void) => {
      listener = cb;
      return () => undefined;
    },
  });
  await slice.initializeAuth();
  listener!('TOKEN_REFRESHED', { id: 'u71', email: 'b@b.com' });
  assert.equal(h.get().authStatus, 'signed_in');
  assert.deepEqual(h.get().authUser, { id: 'u71', email: 'b@b.com' });
});
