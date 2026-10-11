import test from 'node:test';
import assert from 'node:assert/strict';

const CLIENT_PATH = new URL('../client.ts', import.meta.url).href;
const LEADERBOARD_URL = new URL('../leaderboard.ts', import.meta.url).href;

async function freshLeaderboard() {
  return import(`${LEADERBOARD_URL}?bust=${Math.random()}`);
}

/** Minimal fake of the subset of the PostgREST query builder leaderboard.ts actually calls. */
function fakeQueryBuilder(result: { data: unknown; error: unknown }) {
  const builder: any = {
    select: () => builder,
    eq: () => builder,
    // Terminal in leaderboard.ts's actual usage (profiles lookup: no
    // .limit()/.maybeSingle() follows it) — must resolve directly,
    // matching how the real postgrest-js builder is awaited there.
    in: async () => result,
    order: () => builder,
    limit: async () => result,
    maybeSingle: async () => result,
  };
  return builder;
}

test('getLeaderboard: not_configured when no client', async (t) => {
  t.mock.module(CLIENT_PATH, { exports: { getSupabaseClient: () => null } });
  const lb = await freshLeaderboard();
  const result = await lb.getLeaderboard('everlasting-cycle');
  assert.equal(result.ok, false);
  assert.equal(result.error.reason, 'not_configured');
});

test('getLeaderboard: empty result is ok:true with an empty array, not an error', async (t) => {
  const fakeClient = { from: () => fakeQueryBuilder({ data: [], error: null }) };
  t.mock.module(CLIENT_PATH, { exports: { getSupabaseClient: () => fakeClient } });
  const lb = await freshLeaderboard();
  const result = await lb.getLeaderboard('everlasting-cycle');
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, []);
});

test('getLeaderboard: maps rows and joins display names, ordered as returned (fastest first)', async (t) => {
  const entryRows = [
    { user_id: 'u1', elapsed_seconds: 800, rank: 'S', achieved_at: '2026-01-01T00:00:00Z' },
    { user_id: 'u2', elapsed_seconds: 900, rank: 'A', achieved_at: '2026-01-02T00:00:00Z' },
  ];
  const profileRows = [
    { id: 'u1', display_name: 'HunterOne' },
    { id: 'u2', display_name: 'HunterTwo' },
  ];
  let call = 0;
  const fakeClient = {
    from: (table: string) => {
      call += 1;
      if (table === 'leaderboard_entries') {
        return fakeQueryBuilder({ data: entryRows, error: null });
      }
      assert.equal(table, 'profiles');
      return fakeQueryBuilder({ data: profileRows, error: null });
    },
  };
  t.mock.module(CLIENT_PATH, { exports: { getSupabaseClient: () => fakeClient } });
  const lb = await freshLeaderboard();
  const result = await lb.getLeaderboard('everlasting-cycle');
  assert.equal(result.ok, true);
  assert.equal(call, 2); // two separate queries — no FK embed exists between these tables, see leaderboard.ts header comment
  assert.deepEqual(result.data, [
    { position: 1, userId: 'u1', displayName: 'HunterOne', elapsedSeconds: 800, grade: 'S', achievedAt: '2026-01-01T00:00:00Z' },
    { position: 2, userId: 'u2', displayName: 'HunterTwo', elapsedSeconds: 900, grade: 'A', achievedAt: '2026-01-02T00:00:00Z' },
  ]);
});

test('getLeaderboard: a missing profile row falls back to a safe default name, never crashes', async (t) => {
  const entryRows = [{ user_id: 'u1', elapsed_seconds: 800, rank: 'S', achieved_at: '2026-01-01T00:00:00Z' }];
  const fakeClient = {
    from: (table: string) =>
      table === 'leaderboard_entries'
        ? fakeQueryBuilder({ data: entryRows, error: null })
        : fakeQueryBuilder({ data: [], error: null }),
  };
  t.mock.module(CLIENT_PATH, { exports: { getSupabaseClient: () => fakeClient } });
  const lb = await freshLeaderboard();
  const result = await lb.getLeaderboard('everlasting-cycle');
  assert.equal(result.ok, true);
  assert.equal(result.data[0].displayName, 'Hunter');
});

test('getLeaderboard: a 42501 (insufficient_privilege) error maps to auth_required, not unknown', async (t) => {
  const fakeClient = { from: () => fakeQueryBuilder({ data: null, error: { code: '42501', message: 'permission denied' } }) };
  t.mock.module(CLIENT_PATH, { exports: { getSupabaseClient: () => fakeClient } });
  const lb = await freshLeaderboard();
  const result = await lb.getLeaderboard('everlasting-cycle');
  assert.equal(result.ok, false);
  assert.equal(result.error.reason, 'auth_required');
});

test('getLeaderboard: an unrecognized PostgrestError maps to unknown, not swallowed into empty success', async (t) => {
  const fakeClient = { from: () => fakeQueryBuilder({ data: null, error: { code: '57014', message: 'statement timeout' } }) };
  t.mock.module(CLIENT_PATH, { exports: { getSupabaseClient: () => fakeClient } });
  const lb = await freshLeaderboard();
  const result = await lb.getLeaderboard('everlasting-cycle');
  assert.equal(result.ok, false);
  assert.equal(result.error.reason, 'unknown');
});

test('getLeaderboard: a thrown TypeError (network-level failure) maps to network_error', async (t) => {
  const builder: any = {
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    limit: async () => {
      throw new TypeError('Failed to fetch');
    },
  };
  const fakeClient = { from: () => builder };
  t.mock.module(CLIENT_PATH, { exports: { getSupabaseClient: () => fakeClient } });
  const lb = await freshLeaderboard();
  const result = await lb.getLeaderboard('everlasting-cycle');
  assert.equal(result.ok, false);
  assert.equal(result.error.reason, 'network_error');
});

test('getMyLeaderboardEntry: returns null (not an error) when the user has no entry yet', async (t) => {
  const fakeClient = { from: () => fakeQueryBuilder({ data: null, error: null }) };
  t.mock.module(CLIENT_PATH, { exports: { getSupabaseClient: () => fakeClient } });
  const lb = await freshLeaderboard();
  const result = await lb.getMyLeaderboardEntry('everlasting-cycle', 'u1');
  assert.equal(result.ok, true);
  assert.equal(result.data, null);
});

test('getMyLeaderboardEntry: maps a real row without a position or displayName field', async (t) => {
  const row = { elapsed_seconds: 850, rank: 'S', achieved_at: '2026-01-01T00:00:00Z' };
  const fakeClient = { from: () => fakeQueryBuilder({ data: row, error: null }) };
  t.mock.module(CLIENT_PATH, { exports: { getSupabaseClient: () => fakeClient } });
  const lb = await freshLeaderboard();
  const result = await lb.getMyLeaderboardEntry('everlasting-cycle', 'u1');
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, { elapsedSeconds: 850, grade: 'S', achievedAt: '2026-01-01T00:00:00Z' });
  assert.equal('position' in (result.data as object), false);
  assert.equal('displayName' in (result.data as object), false);
});
