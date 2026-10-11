import test from 'node:test';
import assert from 'node:assert/strict';

const AUTH_PATH = new URL('../../services/supabase/auth.ts', import.meta.url).href;
const SLICE_URL = new URL('../authSlice.ts', import.meta.url).href;

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
