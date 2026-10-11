/**
 * Reads the two EXPO_PUBLIC_* environment variables Expo inlines into the
 * bundle at build time (babel-preset-expo does this automatically for any
 * env var prefixed EXPO_PUBLIC_ — no extra babel/webpack config needed,
 * confirmed against this project's existing babel.config.js). Neither
 * value is a secret: EXPO_PUBLIC_SUPABASE_URL is a public project
 * endpoint, and EXPO_PUBLIC_SUPABASE_ANON_KEY is Supabase's
 * publishable/anon key, which is designed to be shipped in client code
 * and is meaningless without Row Level Security enforcing access — see
 * supabase/README.md's "Why public client keys are not secrets" section.
 *
 * This module never throws and never performs I/O — it only inspects
 * process.env synchronously, so calling it costs nothing and cannot fail
 * the app's local-first startup path.
 */

export type SupabaseConfigInvalidReason =
  | 'missing_url'
  | 'missing_anon_key'
  | 'malformed_url'
  | 'anon_key_too_short'
  | 'secret_key_in_anon_key_slot';

export type SupabaseConfigState =
  | { status: 'unconfigured' }
  | { status: 'invalid'; reason: SupabaseConfigInvalidReason; detail: string }
  | { status: 'configured'; url: string; anonKey: string };

/**
 * Best-effort detection of a service-role/secret key placed where the
 * public anon key belongs — a config mistake with real consequences (a
 * secret key bypasses RLS entirely), so it's worth catching even
 * heuristically. Never attempts to verify the key cryptographically; this
 * is a shape/role sanity check on a key we already trust was issued by
 * Supabase, not an authenticity check.
 */
function looksLikeSecretKey(key: string): boolean {
  // Supabase's 2024+ API key format: publishable keys start with
  // `sb_publishable_`, secret keys with `sb_secret_`.
  if (key.startsWith('sb_secret_')) {
    return true;
  }
  // Legacy format: both the anon key and the service_role key are JWTs:
  // header.payload.signature. Only the decoded payload's `role` claim
  // tells them apart. Decoded without verifying the signature — there is
  // no secret to verify with here, and none is needed for this check.
  const parts = key.split('.');
  if (parts.length === 3) {
    try {
      const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const payload = JSON.parse(
        typeof atob === 'function'
          ? atob(base64)
          : Buffer.from(base64, 'base64').toString('utf8')
      );
      if (payload && (payload.role === 'service_role' || payload.role === 'secret')) {
        return true;
      }
    } catch {
      // Not decodable — this heuristic simply doesn't apply; fall through
      // to treating the key as plausible.
    }
  }
  return false;
}

/**
 * Computes the current Supabase configuration state from environment
 * variables. Pure and synchronous — call it as often as needed, it never
 * caches and never performs network access (callers that want a cached
 * decision should cache the result themselves, see client.ts).
 */
export function getSupabaseConfigState(): SupabaseConfigState {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();

  if (!url && !anonKey) {
    return { status: 'unconfigured' };
  }
  if (!url) {
    return {
      status: 'invalid',
      reason: 'missing_url',
      detail: 'EXPO_PUBLIC_SUPABASE_ANON_KEY is set but EXPO_PUBLIC_SUPABASE_URL is not.',
    };
  }
  if (!anonKey) {
    return {
      status: 'invalid',
      reason: 'missing_anon_key',
      detail: 'EXPO_PUBLIC_SUPABASE_URL is set but EXPO_PUBLIC_SUPABASE_ANON_KEY is not.',
    };
  }

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') {
      return {
        status: 'invalid',
        reason: 'malformed_url',
        detail: `EXPO_PUBLIC_SUPABASE_URL must use https:// (got "${parsed.protocol}").`,
      };
    }
  } catch {
    return {
      status: 'invalid',
      reason: 'malformed_url',
      detail: 'EXPO_PUBLIC_SUPABASE_URL is not a valid URL.',
    };
  }

  if (anonKey.length < 20) {
    return {
      status: 'invalid',
      reason: 'anon_key_too_short',
      detail: 'EXPO_PUBLIC_SUPABASE_ANON_KEY is implausibly short to be a real Supabase key.',
    };
  }

  if (looksLikeSecretKey(anonKey)) {
    return {
      status: 'invalid',
      reason: 'secret_key_in_anon_key_slot',
      detail:
        'EXPO_PUBLIC_SUPABASE_ANON_KEY appears to be a service-role/secret key, not a publishable/anon key. Refusing to use a secret key client-side — see supabase/README.md.',
    };
  }

  return { status: 'configured', url, anonKey };
}

/** Convenience check that doesn't require the caller to pattern-match the state. */
export function isSupabaseConfigured(): boolean {
  return getSupabaseConfigState().status === 'configured';
}
