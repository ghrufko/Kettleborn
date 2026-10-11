import { getSupabaseClient } from './client';

/**
 * Closed set of application-facing failure reasons for leaderboard reads.
 * 'auth_required' specifically means "no authenticated session" — verified
 * against the actual schema: leaderboard_entries grants SELECT to the
 * `authenticated` role only (no `anon` grant exists anywhere in
 * supabase/migrations/), and its one RLS policy is `using (true)` for any
 * authenticated caller — there is no row-level filtering that could ever
 * produce a permission error for a legitimately signed-in user. So any
 * permission-denied response from this table can only mean "not signed
 * in," never "signed in as the wrong user" — see
 * supabase/PHASE_2_1_MIGRATION_AUDIT.md's RLS table for the verified grant.
 */
export type LeaderboardErrorReason =
  | 'not_configured'
  | 'auth_required'
  | 'network_error'
  | 'unknown';

export interface LeaderboardFailure {
  reason: LeaderboardErrorReason;
  message: string;
}

export type LeaderboardResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: LeaderboardFailure };

/** One row as actually displayed — only fields the verified schema/RLS make safe to show. */
export interface LeaderboardEntry {
  /** 1-based position in this result's ordering. NOT the S/A/B/C grade below. */
  position: number;
  userId: string;
  /** From profiles.display_name — the only profile field this table's RLS makes safe to show publicly. */
  displayName: string;
  elapsedSeconds: number;
  /** The letter grade stored in leaderboard_entries.rank (S/A/B/C), server-computed — never client-supplied. */
  grade: string;
  achievedAt: string;
}

const REASON_MESSAGES: Record<LeaderboardErrorReason, string> = {
  not_configured: 'Leaderboards are not available right now.',
  auth_required: 'Sign in to view the leaderboard.',
  network_error: 'Could not reach the server. Check your connection and try again.',
  unknown: 'Something went wrong loading the leaderboard.',
};

function failure(reason: LeaderboardErrorReason): LeaderboardFailure {
  return { reason, message: REASON_MESSAGES[reason] };
}

/** Postgres SQLSTATE for insufficient_privilege — see this module's header comment. */
const INSUFFICIENT_PRIVILEGE = '42501';

function mapPostgrestError(error: { code?: string; message?: string } | null): LeaderboardFailure {
  if (!error) {
    return failure('unknown');
  }
  if (error.code === INSUFFICIENT_PRIVILEGE) {
    return failure('auth_required');
  }
  // PostgREST's own JWT-related codes (expired/invalid token) — also
  // "not really authenticated," same user-facing treatment as above.
  if (error.code?.startsWith('PGRST30')) {
    return failure('auth_required');
  }
  return failure('unknown');
}

/** Hard ceiling — no UI in this schema needs more than one screen's worth of rows, and this is a small, fixed feature, not paginated infrastructure (see PHASE_2_2 docs for why). */
const MAX_ENTRIES = 50;

/**
 * Fetches the leaderboard for one canonical workout, fastest first.
 * Returns an empty array (ok:true, data:[]) when the workout genuinely has
 * no eligible results yet — distinct from every failure case above, which
 * the caller must not conflate with "empty."
 */
export async function getLeaderboard(workoutId: string): Promise<LeaderboardResult<LeaderboardEntry[]>> {
  const client = getSupabaseClient();
  if (!client) {
    return { ok: false, error: failure('not_configured') };
  }

  let entriesRes;
  try {
    entriesRes = await client
      .from('leaderboard_entries')
      .select('user_id, elapsed_seconds, rank, achieved_at')
      .eq('workout_id', workoutId)
      .order('elapsed_seconds', { ascending: true })
      .limit(MAX_ENTRIES);
  } catch (error) {
    return { ok: false, error: error instanceof TypeError ? failure('network_error') : failure('unknown') };
  }
  if (entriesRes.error) {
    return { ok: false, error: mapPostgrestError(entriesRes.error) };
  }
  const rows = entriesRes.data ?? [];
  if (rows.length === 0) {
    return { ok: true, data: [] };
  }

  // No direct FK exists between leaderboard_entries and profiles (both
  // independently reference auth.users) — PostgREST cannot embed one
  // through the other, so display names are fetched as a second, explicit
  // query rather than guessed at via an unsupported embed. See
  // supabase/PHASE_2_2_IMPLEMENTATION.md for this schema limitation.
  const userIds = Array.from(new Set(rows.map((row) => row.user_id)));
  let profilesRes;
  try {
    profilesRes = await client.from('profiles').select('id, display_name').in('id', userIds);
  } catch (error) {
    return { ok: false, error: error instanceof TypeError ? failure('network_error') : failure('unknown') };
  }
  if (profilesRes.error) {
    return { ok: false, error: mapPostgrestError(profilesRes.error) };
  }
  const nameById = new Map(profilesRes.data?.map((p) => [p.id, p.display_name]) ?? []);

  const entries: LeaderboardEntry[] = rows.map((row, index) => ({
    position: index + 1,
    userId: row.user_id,
    displayName: nameById.get(row.user_id) ?? 'Hunter',
    elapsedSeconds: row.elapsed_seconds,
    grade: row.rank,
    achievedAt: row.achieved_at,
  }));
  return { ok: true, data: entries };
}

/** The caller's own best result for one workout — no position/displayName, since neither applies to a single own-row lookup (see getMyLeaderboardEntry). */
export interface MyLeaderboardEntry {
  elapsedSeconds: number;
  grade: string;
  achievedAt: string;
}

/**
 * The signed-in caller's own entry for one workout, or null if they have
 * none yet (not an error — a real, common state: signed in, never
 * completed this workout canonically). Takes userId explicitly rather than
 * looking it up itself, keeping this module independent of auth.ts.
 * Deliberately returns no `position` (would require fetching the full
 * ordered list to compute) and no `displayName` (the caller already knows
 * their own) — a separate, smaller type instead of a partially-meaningless
 * reuse of LeaderboardEntry.
 */
export async function getMyLeaderboardEntry(
  workoutId: string,
  userId: string
): Promise<LeaderboardResult<MyLeaderboardEntry | null>> {
  const client = getSupabaseClient();
  if (!client) {
    return { ok: false, error: failure('not_configured') };
  }
  let res;
  try {
    res = await client
      .from('leaderboard_entries')
      .select('elapsed_seconds, rank, achieved_at')
      .eq('workout_id', workoutId)
      .eq('user_id', userId)
      .maybeSingle();
  } catch (error) {
    return { ok: false, error: error instanceof TypeError ? failure('network_error') : failure('unknown') };
  }
  if (res.error) {
    return { ok: false, error: mapPostgrestError(res.error) };
  }
  if (!res.data) {
    return { ok: true, data: null };
  }
  return {
    ok: true,
    data: {
      elapsedSeconds: res.data.elapsed_seconds,
      grade: res.data.rank,
      achievedAt: res.data.achieved_at,
    },
  };
}
