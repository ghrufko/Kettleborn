# Phase 2.2 — Active Account System & Leaderboard Foundation

Implementation doc. Covers what Phase 2.2 actually built: a real
authentication service and Zustand slice, non-blocking bootstrap
integration, sign-in/create-account screens reachable from Settings, a
read-only per-workout leaderboard service and screen, and a new,
framework-free test harness.

No sign-in has ever been tested against a real Supabase project — none
exists in this environment (unchanged since Phase 1.3). Everything
below is implementation + local verification, not hosted integration
proof.

## 1. New authentication service — `src/services/supabase/auth.ts`

Exports `signUp`, `signIn`, `signOut`, `getSession`,
`onAuthStateChange`, `requestPasswordReset`, plus the closed
`AuthErrorReason` type (`invalid_credentials`, `invalid_email`,
`weak_password`, `email_not_confirmed`, `already_registered`,
`rate_limited`, `network_error`, `not_configured`, `unknown`).

- Every operation goes through `getSupabaseClient()` (the existing
  Phase 2.0 boundary) — returns `{ ok: false, error: { reason:
  'not_configured' } }` without throwing when cloud isn't configured.
- A single `mapAuthError()` function is the only place that reads a
  raw GoTrue/network error's code or message — every public function
  routes through it, so a raw-error leak can only happen in one place,
  and it was specifically tested not to (see §7).
- Returns a minimal `AppAuthUser` (`{ id, email }`) — never the full
  Supabase `Session`/`User` object, so an access/refresh token can
  never leave this module through a normal return value.
- `onAuthStateChange` registers exactly one underlying GoTrue listener
  per call and returns a matching `unsubscribe` — a no-op function when
  unconfigured (nothing to listen to).
- `signUp`'s result distinguishes `emailConfirmationRequired` (true
  when Supabase returns a user but a null session) — callers must not
  assume a successful sign-up produced a live session.

## 2. Zustand integration — `src/store/authSlice.ts`

`AuthSlice` (see `src/store/types.ts`) adds `authStatus` (a closed
union: `hydrating | unavailable | signed_out | signing_in | signing_up
| signing_out | signed_in` — states that could never coexist, like
signed-in-and-signed-out, simply have no representation), `authUser`,
`authError`, and actions `initializeAuth`, `authSignUp`, `authSignIn`,
`authSignOut`, `clearAuthError`.

- Wired into the existing combined store exactly like every other
  slice (`src/store/index.ts`) — no second store, no React Context.
- `authSignIn`/`authSignUp` guard against a duplicate submission while
  one is already in flight (checked via `get().authStatus` before
  calling the service layer) — verified by a real test, not just by
  inspection (§7).
- Every action is wrapped so a failure always resolves `authStatus`
  back to a terminal state (`signed_out` or, for sign-out failure,
  back to `signed_in` — see next point) — never left stuck on
  `signing_in`/`signing_up`/`signing_out`.
- `authSignOut` on failure does **not** claim success: `authUser` is
  preserved and `authStatus` reverts to `signed_in`, because the
  remote session's real state is unknown, not confirmed destroyed.
- `initializeAuth` is idempotent against double-registration: a
  module-scoped `activeUnsubscribe` guards against a second
  `onAuthStateChange` listener if it's ever called twice (e.g.
  `App.tsx`'s `ErrorScreen.onRetry` re-running `bootstrapApp()`).

## 3. Bootstrap integration — `src/store/bootstrap.ts`

One line added at the end: `store.initializeAuth().catch(() =>
undefined);` — **not awaited**. Every pre-existing local
initialization step (`initializeUser`, `initializeSettings`,
`loadEquipment`, `initializeChronicle`, `loadAllMonsterProgress`,
`loadTimerPresets`, `loadCustomWorkouts`) is unchanged, still awaited in
the same order, and completes before this line is reached. The app is
fully usable the instant those finish, regardless of whether
`initializeAuth()` ever resolves — confirmed by:
- Grep: `bootstrap.ts` is the only file that calls `initializeAuth`.
- Live check: the Expo web dev server was started with both
  `EXPO_PUBLIC_SUPABASE_*` vars absent and served a clean, error-free
  bundle (see §7).
- No new timeout was introduced — `initializeAuth()` itself never
  throws (every path inside it is wrapped; see `authSlice.ts`), and the
  stray `.catch()` here is pure defense-in-depth, not a timing hack.

## 4. Screens and navigation

**Account entry point** — added an "Account" section to the existing
`SettingsScreen.tsx` (not a new always-visible tab, per the task's own
"restrained entry point" instruction): shows Sign In / Create Account
buttons when signed out, the signed-in email + Sign Out when signed in,
or a muted "not available in this build" message when unconfigured.
Local training is never gated behind this — it's purely an optional
section on an already-optional screen.

**New screens** (`src/screens/account/`): `SignInScreen.tsx`,
`CreateAccountScreen.tsx`. Both follow the existing visual language
exactly (`Header`, `GlassCard`, `Button`, `AppBackground`, the existing
charcoal/bronze/ember palette, `fontFamily`/`spacing` tokens) — no new
component library, no new colors. Both registered in
`ForgeStack.tsx` under the existing `ForgeStackParamList` (extended
with `SignIn`/`CreateAccount` routes in `navigation/types.ts`).

Covered in the UI: email format validation, a password-confirmation
field (create account only), a visibility toggle, loading state
(button label changes + disabled), safe error messages (never the raw
SDK text — routed through `auth.ts`'s closed reason set), duplicate-
submit prevention (disabled while `authStatus` is `signing_in`/
`signing_up`), a "Forgot password?" link, and an explicit email-
confirmation-required success state (distinct from "signed in").
Password fields are cleared from local component state immediately
after submission, success or failure.

**Leaderboard screen** (`src/screens/hunt/LeaderboardScreen.tsx`):
read-only, per-workout. Reachable via a new "View Leaderboard" button
added to `HuntCompleteScreen.tsx`, right after a canonical (non-Custom-
Hunt) result — hidden for Custom Hunt results, which never reach the
cloud leaderboard by schema design. Registered in `HuntStack.tsx` under
a new `Leaderboard: { workoutId, monsterId }` route
(`navigation/types.ts`). Handles loading, loaded (sorted list, position/
name/grade/time), empty ("no times yet"), `auth_required` (distinct
copy pointing at Settings → Account — RLS genuinely has no `anon`
grant on this table, so this is a correct, not a lazy, state), and
other errors (generic message + Retry). Pull-to-refresh via
`RefreshControl`, explicit refetch on screen focus
(`useFocusEffect`) — no polling.

## 5. Leaderboard service — `src/services/supabase/leaderboard.ts`

`getLeaderboard(workoutId)` and `getMyLeaderboardEntry(workoutId,
userId)`, both returning the closed `LeaderboardResult<T>` shape with
reasons `not_configured | auth_required | network_error | unknown`.

- Reads only `leaderboard_entries` and `profiles.display_name` — both
  columns-and-grants verified against the actual migrations in
  `PHASE_2_1_MIGRATION_AUDIT.md` before writing a single query.
- **Schema limitation found and documented, not worked around:** no FK
  exists between `leaderboard_entries` and `profiles` (both
  independently reference `auth.users`), so PostgREST cannot embed one
  through the other. `getLeaderboard` issues two explicit queries and
  joins client-side — slower than a single embedded query, but
  schema-honest rather than guessing at an unsupported embed.
- `auth_required` is specifically mapped from Postgres's `42501`
  (insufficient_privilege) / PostgREST's `PGRST30x` codes — justified
  because this table's RLS is `using (true)` for any authenticated
  caller with no row-level filtering at all (verified in the Migration
  Audit), so a permission error here can only mean "not authenticated,"
  never "authenticated as the wrong user."
- A hard 50-row cap (`MAX_ENTRIES`), no cursor pagination — a
  deliberate choice, not an oversight: there are zero real users and no
  verified need for more than one screen's worth of rows yet; revisit
  if that changes.
- No write path exists anywhere in this module — `rank`/`grade`/
  position are read-only, server-computed values; nothing here can
  submit a score.

## 6. Security / RLS considerations (re-confirmed, not re-litigated)

No SQL was touched this phase. Re-confirmed directly against the
leaderboard.ts code path: every query goes through the existing,
already-audited RLS policies (`leaderboard_entries_select_all`,
`profiles_select_all_authenticated`) — no new table, no new policy, no
privilege-widening grant. `email` is intentionally never selected from
`profiles` by this module (only `id`, `display_name`) even though RLS
would technically allow reading other columns — `profiles` has no
`email` column at all (it lives in `auth.users`, which clients can
never query directly) — confirmed by re-reading the migration, not
assumed.

## 7. Tests executed — exact commands and results

New test harness: `src/testing/` (`register-hooks.mjs` +
`ts-resolve-hook.mjs`), using Node's own built-in `node:test` runner
with its experimental module-mocking API — **no new dependency added**
(no Jest, no React Testing Library). See `src/testing/README.md` for
why and how.

| Command | Result |
|---|---|
| `npm test` (= `node --test --experimental-test-module-mocks --import ./src/testing/register-hooks.mjs "src/**/__tests__/**/*.test.ts"`) | **PASS** — 48/48, exit 0 |
| — `config.test.ts` (11 assertions: unconfigured/invalid/configured states, secret-key rejection, legacy+new key formats) | PASS |
| — `auth.test.ts` (18 assertions: not_configured, every `AuthErrorReason` mapping, successful sign-in/up with no token leakage, sign-out failure not reported as success, session restore + its failure, listener registration/cleanup, no raw-SDK-text leakage) | PASS |
| — `leaderboard.test.ts` (9 assertions: not_configured, empty vs. error vs. real rows, the two-query display-name join, missing-profile fallback, `auth_required` mapping, network-error mapping) | PASS |
| — `authSlice.test.ts` (10 assertions: hydration in all three outcomes, non-blocking failure, single-listener guarantee, duplicate-submit rejection, failure-never-stuck-loading, sign-out-failure-preserves-session, error clearing) | PASS |
| `npx tsc --noEmit` (full project, new screens/services/tests included) | **PASS**, exit 0 |
| `npx expo export --platform web` | **PASS**, exit 0 |
| `npx expo start --web` with both `EXPO_PUBLIC_SUPABASE_*` vars unset | **PASS** — clean bundle, no errors, confirmed via dev-server log and HTTP 200 on index + bundle |
| Grep: bundle contains no executable Supabase/auth/test code outside one inert `package.json`-string match | **PASS** |
| `node run_suite.mjs` / `run_edge.mjs` (PGlite, re-run to confirm no SQL regression — none was expected, none touched) | **PASS** — 35/35 + 15/15, exit 0 |
| Secret-pattern scan across every file this phase touched or added | **PASS** — only benign matches (the `sb_secret_` string-prefix check itself, and fake test JWTs) |
| `git status` before vs. after | **PASS** — all 17 pre-existing files preserved; no unrelated file touched |

**NOT RUN:** anything against a real Supabase project (none exists).
Any iOS/Android device or simulator test (none available in this
environment — not fabricated). Any UI component/interaction test (no
component-testing tool exists in this repo; judged out of scope to add
one this phase — see `src/testing/README.md`'s "What this does and
does not cover").

## 8. Local-first guarantees (re-verified)

- `bootstrapApp()`'s local steps are unchanged and still run first,
  unconditionally, still fully `await`ed.
- `initializeAuth()` is the only new call, and it is not awaited by
  bootstrap.
- A fresh grep confirms no screen, slice, or utility outside
  `SettingsScreen.tsx` (the optional Account section) and
  `HuntCompleteScreen.tsx` (the optional Leaderboard button) references
  anything under `services/supabase/` — local gameplay screens
  (Active Hunt, Hunt Overview, Monster Detail, Chronicle, Timer, etc.)
  are untouched.
- The dev-server smoke test (env vars absent) is the concrete proof,
  not just the grep.

## 9. What's implemented vs. verified vs. blocked

1. **Implemented and locally verified:** the auth service, the auth
   Zustand slice, non-blocking bootstrap wiring, the leaderboard
   service, both new screens' logic paths that don't require a live
   backend (validation, loading/duplicate-submit guards, error-reason
   display), the full 48-assertion test suite, `tsc`, `expo export`,
   PGlite re-confirmation.
2. **Implemented but not tested against a hosted backend:** every
   actual network call — real `signUp`/`signInWithPassword`/`signOut`/
   `getSession` against GoTrue, real `leaderboard_entries`/`profiles`
   reads through PostgREST, real email-confirmation delivery, real
   password-reset email delivery (needs a configured redirect URL on a
   real project — see `auth.ts`'s `requestPasswordReset` comment).
3. **Not implemented because out of scope or unsupported:**
   OAuth, the actual guest-history import operation (decision made,
   mechanism documented, not built), `expo-secure-store` wiring
   (correctly deferred — no session exists yet to persist), account
   deletion, any UI component test.
4. **Blocked pending a real Supabase project:** everything in bucket 2,
   plus confirming RN/Hermes-native (not just web) runtime behavior of
   `@supabase/supabase-js`.

## 10. Recommended next phase (Phase 2.3 or later)

1. Create and verify a real Supabase project (still the standing
   prerequisite from Phase 1.3/2.1 — unchanged by this phase).
2. Run `manual_rls_test_plan.sql` against it directly.
3. Exercise `signUp`/`signIn`/`signOut`/`getSession` against that real
   project from this phase's actual UI — the first genuine end-to-end
   test of anything built across Phases 2.0–2.2.
4. Only then: add `expo-secure-store`, wire it as `client.ts`'s
   `auth.storage`, flip `persistSession`/`autoRefreshToken` to `true`.
5. Verify on an actual iOS/Android device or simulator — still
   unavailable in this environment, still genuinely unverified.
