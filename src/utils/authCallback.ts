/**
 * Parses the URL a Supabase auth email link lands on. Pure — no `URL`
 * constructor (React Native's built-in one is a partial regex-based
 * implementation) and no SDK import, so it runs identically on Hermes,
 * in the browser and under `node --test`.
 *
 * Callback shapes, verified against the installed @supabase/auth-js
 * (2.117.3) rather than assumed:
 *
 * - PKCE success (native, `flowType: 'pkce'`):
 *     kettleborn://reset-password?code=<auth code>
 *   The SDK only ever reads `code` (and an optional `sb_flow_id`, which
 *   it appends only under an experimental flag this app does not set).
 * - Implicit success (web, `flowType: 'implicit'`):
 *     https://<site>/reset-password#access_token=…&expires_at=…&expires_in=3600
 *       &refresh_token=…&token_type=bearer&type=recovery
 *   `type` is `recovery` for a password reset and `signup` for an email
 *   confirmation. supabase-js consumes these tokens itself on web
 *   (detectSessionInUrl) — this parser only reports that they were there.
 * - Error (either flow): `error`, `error_code` and `error_description`,
 *   in the fragment and/or the query string, e.g.
 *     #error=access_denied&error_code=otp_expired
 *       &error_description=Email+link+is+invalid+or+has+expired
 *   The SDK's own parseParametersFromURL reads both places, with query
 *   params taking precedence over fragment params — mirrored here.
 */

export type AuthCallbackRoute = 'reset-password' | 'confirm-email' | 'unknown';

export type AuthCallback =
  | { kind: 'pkce'; route: AuthCallbackRoute; code: string }
  | { kind: 'implicit'; route: AuthCallbackRoute; type: string | null }
  | {
      kind: 'error';
      route: AuthCallbackRoute;
      error: string | null;
      errorCode: string | null;
      description: string | null;
    };

function decodeComponent(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return value;
  }
}

function parseParamString(input: string, into: Record<string, string>): void {
  for (const pair of input.split('&')) {
    if (!pair) {
      continue;
    }
    const eq = pair.indexOf('=');
    const key = decodeComponent(eq === -1 ? pair : pair.slice(0, eq));
    const value = eq === -1 ? '' : decodeComponent(pair.slice(eq + 1));
    if (key) {
      into[key] = value;
    }
  }
}

/** Query-string params override fragment params, same precedence as supabase-js. */
export function parseCallbackParams(url: string): Record<string, string> {
  const params: Record<string, string> = {};
  const hashIndex = url.indexOf('#');
  const beforeHash = hashIndex === -1 ? url : url.slice(0, hashIndex);
  if (hashIndex !== -1) {
    parseParamString(url.slice(hashIndex + 1), params);
  }
  const queryIndex = beforeHash.indexOf('?');
  if (queryIndex !== -1) {
    parseParamString(beforeHash.slice(queryIndex + 1), params);
  }
  return params;
}

/**
 * The route is the path segment (or, for `kettleborn://reset-password`,
 * the URL "host") before any query/fragment. Matches the native scheme,
 * Expo Go's `exp://host:port/--/reset-password` form, and the web
 * `https://<site>/reset-password` form alike.
 */
function detectRoute(url: string): AuthCallbackRoute {
  const end = url.search(/[?#]/);
  const location = end === -1 ? url : url.slice(0, end);
  const match = location.match(/(?:^|[/:])(reset-password|confirm-email)\/?$/);
  return match ? (match[1] as AuthCallbackRoute) : 'unknown';
}

/**
 * Returns null for any URL that isn't an auth callback — including an
 * ordinary app open, or an unrelated link that happens to carry a `code`
 * param on a route this app never sends (a bare `code` is only trusted on
 * reset-password/confirm-email). Never mistakes `error_code=…` for a
 * `code=…` param: params are parsed by exact key, not by substring.
 */
export function parseAuthCallbackUrl(url: string | null | undefined): AuthCallback | null {
  if (!url) {
    return null;
  }
  const route = detectRoute(url);
  const params = parseCallbackParams(url);

  const hasError = Boolean(params.error_code || params.error_description || (params.error && route !== 'unknown'));
  if (hasError) {
    return {
      kind: 'error',
      route,
      error: params.error || null,
      errorCode: params.error_code || null,
      description: params.error_description || null,
    };
  }

  if (params.access_token && params.refresh_token) {
    return { kind: 'implicit', route, type: params.type || null };
  }

  if (params.code && route !== 'unknown') {
    return { kind: 'pkce', route, code: params.code };
  }

  return null;
}

/**
 * Supabase puts `otp_expired` on a link that expired *or* was already
 * used (GoTrue does not distinguish the two in the redirect), so both get
 * the same treatment. Everything else is reported as an invalid link.
 */
export function isExpiredLinkErrorCode(errorCode: string | null): boolean {
  return errorCode === 'otp_expired' || errorCode === 'flow_state_expired';
}
