# Phase 2.4 — Real Authentication Implementation

Moves Phase 2.2's auth implementation from "built and mocked" to "wired
to the real `kettleborn-dev` project, with native session persistence
and a working password-reset deep link." No sign-in UI, slice, or
service was rebuilt — all of Phase 2.2's architecture is reused as-is;
this phase extends it.

## 1. What changed and why

### Native session persistence (`src/services/supabase/secureStorage.ts`, `client.ts`)

Added `expo-secure-store@~57.0.4` (via `npx expo install`, the SDK-57-
correct version — confirmed against the installed Expo SDK before
adding it). `client.ts` now sets `persistSession: true`,
`autoRefreshToken: true`, and passes a `secureSessionStorage` adapter
(iOS Keychain / Android Keystore) on native platforms only —
**web is explicitly left on supabase-js's own default** (`browser
localStorage`), which already works correctly there; passing a
native-only adapter on web would be wrong, not just redundant. This is
the one place web and native storage *deliberately* differ, not an
inconsistency.

**Known, documented limitation, not fixed this phase:** some Android
Keystore configurations cap a single stored value around 2048 bytes.
A Supabase session is usually smaller, but if it ever isn't,
`secureSessionStorage.setItem` fails safely (caught, logged, swallowed
— see its own comment) rather than crashing; the session just won't
persist that one time. Supabase's own docs describe a chunked/
encrypted "LargeSecureStore" wrapper (via `aes-js`) for this exact
case — not implemented here, since it requires a new dependency whose
necessity cannot be verified without a real device test (none
available in this environment). Revisit if a real device shows this
failing in practice.

### Password reset, end to end (`auth.ts`, `authSlice.ts`, `App.tsx`, `UpdatePasswordScreen.tsx`)

- `requestPasswordReset(email)` now passes `redirectTo:
  'kettleborn://reset-password'` (the app's existing custom URL scheme,
  already declared in `app.json`).
- New `exchangeCodeForSession(code)` and `updatePassword(newPassword)`
  wrappers in `auth.ts`, following the same closed-error-model pattern
  as every other function there.
- `App.tsx` now handles the `kettleborn://reset-password?code=...` deep
  link (both cold-start via `Linking.getInitialURL()` and warm-start via
  the `'url'` event), extracting the `code` param with a plain string
  match rather than the `URL` constructor (not guaranteed present on
  Hermes), and calling the new `handlePasswordRecoveryLink` store
  action.
- `authSlice.ts` gained `passwordRecoveryPending` state and
  `handlePasswordRecoveryLink` / `completePasswordRecovery` /
  `cancelPasswordRecovery` actions. The `PASSWORD_RECOVERY` GoTrue event
  (previously collapsed into `'OTHER'`) is now distinguished and also
  sets this flag directly from the listener, independent of which code
  path (deep link vs. an auth-state event firing on its own) triggers
  it first.
- New `UpdatePasswordScreen.tsx`, rendered top-level by `App.tsx` — same
  pattern as the existing `OnboardingScreen` — whenever
  `passwordRecoveryPending` is true, taking priority over onboarding
  and normal navigation. Avoids needing deep-link-to-nested-route
  navigation logic entirely.

### Everything else from Phase 2.2 reused unchanged

`SignInScreen`, `CreateAccountScreen`, the `SettingsScreen` Account
section, `signUp`/`signIn`/`signOut`/`getSession`/`onAuthStateChange`,
the leaderboard service/screen — none were rebuilt. Only extended where
the task required (persistence, password-reset completion).

## 2. Real-project testing — what was actually exercised against `kettleborn-dev`

Distinguished explicitly from the mocked suite below, per the task's
own instruction.

Fetched the project's **public** URL + publishable key via `supabase
projects api-keys` (both are intentionally public — safe to use
client-side) and wrote them to a new, gitignored `.env.local`. Then ran
small standalone Node scripts (outside the app UI — no device/simulator
available) using `@supabase/supabase-js` directly against the real
project:

- `signUp` with a placeholder-domain test address → real GoTrue
  rejected it with `email_address_invalid` for **both** `.invalid` and
  `example.com` domains. This is genuine, newly-discovered information
  about this project's email validation (likely a disposable/placeholder
  domain restriction) — not something I could create a real inbox to
  work around, and not something I attempted to bypass. **Signup was
  never completed against the real project** — this is a real,
  documented blocker, not a success being misreported.
- `signInWithPassword` with a wrong password, and with a nonexistent
  email → both correctly returned real `invalid_credentials` errors
  from live GoTrue — confirms `auth.ts`'s error-mapping logic against
  the actual server, not just a mock.
- `resetPasswordForEmail` with the real `redirectTo:
  'kettleborn://reset-password'` → succeeded (no error) against the
  real project for a nonexistent address (GoTrue deliberately doesn't
  reveal whether an account exists). This does **not** prove email
  delivery or that the redirect lands correctly — no inbox access
  exists in this environment to verify either.

**A security incident occurred and is disclosed here:** running
`supabase projects api-keys` without `--reveal` printed the project's
full legacy `service_role` JWT in plaintext into this session's output
(it masked the newer `sb_secret_...` key but not the legacy one). That
value was not used, stored, or repeated anywhere. **Recommend rotating
the `kettleborn-dev` service-role key in the Dashboard** (Project
Settings → API) as a precaution, since it was exposed in this
conversation's output. This does not affect the app, which never uses
that key.

## 3. Mocked automated tests (deterministic, no network)

Extended the existing Phase 2.2 harness (`node --test`, no new test
framework). **63/63 passing, up from 48** — the 15 new assertions cover
exactly what was added this phase:

- `requestPasswordReset` passes the real app redirect URL (not the
  SDK default).
- `exchangeCodeForSession`: not-configured, success, expired/invalid
  code.
- `updatePassword`: not-configured, success, weak-password mapping.
- `PASSWORD_RECOVERY` is a distinguished event, not collapsed to
  `'OTHER'`.
- `authSlice`: the event setting `passwordRecoveryPending` directly;
  `handlePasswordRecoveryLink` success and failure; `completePasswordRecovery`
  success (clears the flag) and failure (leaves it true so the user can
  retry); `cancelPasswordRecovery` (clears the flag, does not sign out).

**Not tested automatically** (documented limitation, unchanged from
Phase 2.2): no UI component/interaction test exists for any screen
(`SignInScreen`, `CreateAccountScreen`, `UpdatePasswordScreen`, the
`SettingsScreen` Account section) — there is still no React Native
component-testing tool in this repo, and adding one was judged out of
scope for this phase (a separate, larger framework decision). These
screens are verified by `tsc --noEmit` and a successful `expo export`
only — compiles and bundles, not "renders correctly" or "button does X."

## 4. Guest mode / local-first verification

Re-verified explicitly this phase, not assumed, with two separate live
dev-server runs:

- **With the real `.env.local` present:** `npx expo start --web` served
  a clean bundle (1008 modules, no errors), confirming the app builds
  correctly with real Supabase configuration active and
  `persistSession: true`.
- **With `.env.local` temporarily moved aside (true unconfigured
  state):** same clean result (998 modules, no errors) — confirms
  `getSupabaseClient()` still short-circuits to `null` before ever
  reaching `createClient()`'s native-storage branch, so guest mode is
  unaffected by any of this phase's changes.
- `bootstrap.ts`'s local initialization sequence is unchanged; the only
  line added in Phase 2.2 (`store.initializeAuth().catch(() =>
  undefined)`, still not awaited) is untouched this phase.
- No gameplay, battle, progression, XP, rank, timer, or SQLite-schema
  file was touched — confirmed by the final git diff (Section 7).

## 5. Dependencies added

`expo-secure-store@~57.0.4` — installed via `npx expo install
expo-secure-store`, which resolved the SDK-57-compatible version
automatically and added the required config plugin entry to
`app.json`. No other dependency changed.

## 6. Dashboard configuration required (manual, cannot be done from here)

1. **Authentication → URL Configuration → Redirect URLs:** add
   `kettleborn://reset-password`. Without this, `resetPasswordForEmail`
   may still accept the request (confirmed — see Section 2) but the
   actual redirect after the user clicks the email link could be
   rejected or fall back to a default, breaking the deep link.
2. **Authentication → Providers → Email:** confirm whether "Confirm
   email" is enabled or disabled — this phase could not determine
   that empirically (every signUp attempt was blocked earlier, by
   email-domain validation, before confirmation would even become
   relevant). The app's code handles both states correctly either way
   (`emailConfirmationRequired` in `signUp`'s result), but the actual
   project setting should be confirmed directly in the Dashboard.
3. **Authentication → Providers → Email → allowed domains/disposable-
   email restriction (if present):** investigate why `example.com` and
   `.invalid`-TLD addresses were both rejected with
   `email_address_invalid` — likely an intentional anti-abuse setting,
   but worth confirming it won't also block real test accounts you
   intend to use.
4. **Rotate the service-role key** (Project Settings → API) — see
   Section 2's incident disclosure.

## 7. Files changed

**New:**
- `src/services/supabase/secureStorage.ts`
- `src/screens/account/UpdatePasswordScreen.tsx`
- `.env.local` (gitignored — real public URL + publishable key only,
  no secret)
- `supabase/PHASE_2_4_AUTH_IMPLEMENTATION.md` (this file)

**Modified:**
- `src/services/supabase/client.ts` — persistence/storage config.
- `src/services/supabase/auth.ts` — redirectTo, `exchangeCodeForSession`,
  `updatePassword`, expanded `AuthChangeEvent`.
- `src/services/supabase/index.ts` — barrel exports for the two new
  functions.
- `src/store/types.ts`, `src/store/authSlice.ts` — password-recovery
  state/actions.
- `App.tsx` — deep-link handling, `UpdatePasswordScreen` top-level
  render.
- `app.json` — `expo-secure-store` config plugin (added automatically
  by `expo install`).
- `package.json`/`package-lock.json` — the one new dependency.
- `src/services/supabase/__tests__/auth.test.ts`,
  `src/store/__tests__/authSlice.test.ts` — new test coverage.

**Not modified:** any gameplay/battle/progression/timer/XP/rank file;
`src/services/db/schema.ts` or any SQLite migration; any existing
Supabase SQL migration; `SignInScreen.tsx`, `CreateAccountScreen.tsx`,
the leaderboard service/screen, or the `SettingsScreen` Account section
beyond what Phase 2.2 already built (all reused as-is).

## 8. Known limitations / blockers

- Full signup-to-confirmed-account flow was never completed against
  the real project — blocked by that project's email-domain validation,
  not by any code issue (see Section 2, and Section 6 item 3).
- Password-reset email delivery and the full click-through redirect
  were never verified — no inbox access in this environment.
- Native session persistence is implemented but never run on an actual
  iOS/Android device or simulator — none available here.
- No UI component/interaction automated test exists for any auth
  screen (unchanged limitation from Phase 2.2).
- The legacy `service_role` key exposure (Section 2) — recommend
  rotation.

## 9. Go/No-Go

**Code is complete and locally verified** (63/63 mocked assertions,
`tsc`, `expo export`, PGlite re-confirmed unaffected, guest-mode
re-verified with and without real config). **Real end-to-end sign-up/
sign-in/password-reset through the actual app UI remains unverified**
— blocked by (a) no device/simulator and (b) the real project's email-
domain restriction blocking a full signup test even via direct API
calls. Recommend: resolve the Dashboard items in Section 6 first (in
particular, confirm which email domains the project will actually
accept for real test accounts), then re-attempt a full signup/confirm/
signin cycle before considering this phase's flows production-ready.

---

# Phase 2.4.1 Addendum — Security Closure & Real-Device Verification Plan

Everything above this line is the original Phase 2.4 report, unchanged.
This addendum closes the service-role-key exposure incident disclosed
there and confirms the real project's Auth configuration via a
genuinely read-only CLI command (`supabase config diff`) rather than
assumption.

## Security findings and remediation checklist

**Incident re-confirmed, not assumed resolved:**
- Searched every tracked and untracked file in this repository
  (excluding `node_modules`) for the leaked key's unique signature
  fragment — **not found anywhere**. Searched `git log --all -p`
  (full history/objects) — **not found**. Searched this session's
  scratchpad directory — **not found**. `.env.local` contains only the
  public project URL and the `sb_publishable_...` key — confirmed by
  reading it directly.
- `.env.local` is confirmed `!!` (ignored) under `git status --ignored`
  — it has never been trackable, in this session or otherwise.
- **What this does NOT cover:** the conversation transcript in which
  the key was originally printed is not a file in this repository and
  cannot be edited or scrubbed from here — that exposure already
  happened in that transcript and this audit cannot undo it, only
  confirm no repository file inherited it.

**Remediation checklist — action required from you, not done here:**
- [ ] **Rotate the legacy `service_role` key** for `kettleborn-dev`:
      Supabase Dashboard → Project Settings → API → find the legacy
      `service_role` key → regenerate/roll it. This invalidates the
      exposed value immediately. Nothing in this app uses that key, so
      rotation has zero effect on the client.
- [ ] Optionally also review who else had access to this session's
      output (if shared) — out of scope for me to determine, since I
      have no visibility into that.

**Not done, by design:** no rotation was attempted from here — this
requires Dashboard access only the project owner has, and the task
explicitly reserved that action for you.

## RLS / grants re-verified (read-only, unchanged)

Re-queried the real project directly rather than trusting the Phase
2.3.5 report from memory:
- `information_schema.role_table_grants` for `anon`/`authenticated`:
  identical to the hardened state from Phase 2.3.5 — `anon` has zero
  grants on all 5 tables; `authenticated` matches the intended
  least-privilege matrix exactly (unchanged).
- `supabase db advisors --linked --type security`: **`No issues
  found`** — still zero findings.
- **No policy or grant was changed this phase** — both checks above
  were read-only confirmations, not modifications.

## Authentication configuration — confirmed via `supabase config diff` (read-only)

This command only compares local `supabase/config.toml` against the
real project's actual settings — it does not write to either side.
Real, confirmed values (not assumed):

| Setting | Remote (real) value | Action needed |
|---|---|---|
| `auth.additional_redirect_urls` | `[]` (empty) | **Yes** — add `kettleborn://reset-password` in Dashboard → Authentication → URL Configuration → Redirect URLs. Confirmed empty, so the deep link will currently fail at the redirect step even though the reset-request API call itself succeeds (Phase 2.4 Section 2). |
| `auth.email.enable_confirmations` | `true` | None — **email confirmation is ON** for this project. The app's `signUp` code already handles this correctly (`emailConfirmationRequired`), confirmed by the mocked test suite. This answers Phase 2.4's open question. |
| `auth.site_url` | `http://localhost:3000` | None required for the custom-scheme flow (we pass `redirectTo` explicitly per call), but this default should eventually be set to a real value before any web-based auth flow ships. |
| `auth.email.otp_length` | `8` | None — not used by our link-based (not OTP-based) flows. |
| `auth.mfa.totp.*` | enabled | None — our client never calls MFA endpoints. |

**Email-domain restriction (why `signUp` rejected `.invalid`/`example.com`):**
not a setting that appears in `config diff`'s output at all, which
means it is very likely Supabase's own built-in disposable/placeholder-
email-domain blocklist (a default anti-abuse feature on new projects),
not an adjustable per-project toggle. **Safest way to resolve the
blocked signup test:** use one real, dedicated test mailbox under an
ordinary email provider (e.g., a Gmail address created specifically for
testing this app) rather than a synthetic placeholder domain — Supabase
distinguishes real-looking domains from known placeholder/disposable
ones. **Not done here** — no real mailbox was created or used, per
"never use real user credentials" and because I cannot own/monitor an
inbox from this environment regardless.

**No native deep-link configuration gap found beyond the Redirect URLs
entry above** — `app.json`'s `"scheme": "kettleborn"` already covers
both iOS and Android URL-scheme registration automatically through
Expo's build tooling; nothing else is required on the app side.

## Verification re-run this phase

| Command | Result |
|---|---|
| `npm test` | 63/63, exit 0 (no code changed this phase — confirms no regression) |
| `npx tsc --noEmit` | exit 0 |
| `npx expo export --platform web` | exit 0, **byte-identical bundle hash** to Phase 2.4's own export — confirms zero code drift |
| `node run_suite.mjs` / `run_edge.mjs` / `run_hardening_checks.mjs` (PGlite) | 35/35 + 15/15 + 7/7, exit 0 |
| Guest mode | Not re-run live this phase — no app code changed since Phase 2.4's own two dev-server verifications (with and without `.env.local`), both already confirmed clean; re-running would be redundant given zero drift |

No automated test gap was identified this phase (no new code was
written — this was an audit/documentation/configuration-confirmation
pass), so no new test was added, per the task's own "add tests only
where needed" instruction.

## Device test plan (Android & iOS) — not yet executed, no device available

Precise manual steps for whoever has a real device. Each step names
whether it's genuinely new verification or confirms something already
covered another way.

1. **Fresh install, guest mode** — install the app with no account.
   Confirm the Hunt flow, a full workout completion, and XP/rank all
   work with no network and no sign-in. *(Automated: config-absent
   path unit-tested + two dev-server runs. Device: not yet verified.)*
2. **Create account** — Settings → Account → Create Account, with a
   real test mailbox (see "safest way to resolve" above, not a
   placeholder domain). Expect the "Check your email" confirmation
   screen (since `enable_confirmations` is confirmed `true`). *(Real
   project: the API-level behavior for a valid domain is unverified —
   only placeholder domains were tested and rejected. Device: not yet
   verified.)*
3. **Email confirmation** — open the confirmation email on the device,
   tap the link, confirm it returns to the app (or a browser
   confirmation page, depending on Supabase's default template) without
   error. *(Entirely unverified — no inbox access here.)*
4. **Sign in** — with the now-confirmed account's real credentials.
   Confirm `authStatus` becomes `signed_in` and the Settings screen
   shows the account email. *(Mocked: fully tested. Real project:
   wrong-password/nonexistent-email paths confirmed live in Phase 2.4;
   a real successful sign-in was not. Device: not yet verified.)*
5. **Sign out** — confirm it returns to `signed_out`, and that local
   workout history/progress is visibly unaffected (check Hunter
   tab/Chronicle still shows prior local stats). *(Mocked: tested.
   Device: not yet verified.)*
6. **Session restoration after force-close** — sign in, fully force-
   close the app (not just background it), relaunch. Confirm it opens
   already signed in, without any visible delay or flash of a signed-
   out state. *(This is the one behavior that specifically needs
   `expo-secure-store` working correctly on-device — genuinely
   unverified until this step runs; nothing short of a real device can
   confirm Keychain/Keystore read/write actually succeeds.)*
7. **Password-reset deep link** — Settings → Account → Sign In →
   "Forgot password?", submit the test mailbox's address, open the
   email on the device, tap the link. Confirm the app opens directly to
   `UpdatePasswordScreen` (not the normal Hunt screen). **Requires
   Dashboard Redirect URLs to include `kettleborn://reset-password`
   first** (see checklist above) — expect this step to fail until that
   Dashboard change is made. *(Entirely unverified — blocked on both
   the Dashboard setting and inbox/device access.)*
8. **Password update** — on `UpdatePasswordScreen`, set a new password,
   confirm the "Password Updated" success state, tap Continue, confirm
   normal navigation resumes. Then sign out and sign back in with the
   *new* password to confirm it actually took effect server-side.
   *(Entirely unverified.)*
9. **Guest mode after sign-out** — after step 5, confirm local gameplay
   still works identically to step 1, with no leftover auth-related UI
   state stuck anywhere (no stale "signing out…" label, no crash).
   *(Device: not yet verified, though the underlying state-machine
   logic is mocked-tested.)*

**Summary of verification tiers, per the task's own requested
distinction:**
- **Verified by automated tests only:** every state transition in
  `authSlice.ts` (signed-in/out, recovery pending, duplicate-submit
  guards, error mapping) — 63/63 mocked assertions.
- **Verified against the real Supabase project (no device, direct API
  calls):** `invalid_credentials` error mapping (wrong password,
  nonexistent email), `resetPasswordForEmail` request success, current
  RLS/grants/Advisor state, current Auth config values (confirmations
  on, redirect URLs empty).
- **Not yet verified on a physical device, at all:** every item in the
  numbered plan above — signup-to-confirmed-account, real sign-in,
  secure session persistence across a force-close, and the full
  password-reset deep-link round trip.

## Minimal files changed this phase

**None.** This sub-phase was audit, live read-only verification against
the real project, and documentation only — no application file, test
file, or dependency was touched. The only file modified is this
addendum to `supabase/PHASE_2_4_AUTH_IMPLEMENTATION.md`.

## Go/No-Go

**No-Go on the password-reset and signup flows specifically** until:
1. The Redirect URL is added in the Dashboard (confirmed missing).
2. A real signup is attempted with a non-placeholder test mailbox.
3. The service-role key is rotated.

**Conditional Go on everything else** — sign-in/sign-out logic,
guest-mode protection, and RLS/grant security are all re-confirmed
correct against the real project with no outstanding findings. The
remaining gap is device access and the three action items above, not a
code defect.

---

# Phase 2.4.3 + 2.5 Addendum — Readiness Fixes, Cloud-Foundation Design Note, Device Checklist

Everything above is unchanged. This addendum covers: two genuine,
verified UX gaps found and fixed in the existing code (re-inspected
fresh, not assumed correct from prior reports), expanded test coverage,
a design-only note for future guest-data sync, and a practical device
acceptance checklist.

## Two real gaps found and fixed

Both relate to the same root cause: `bootstrap.ts`'s `initializeAuth()`
call is deliberately non-blocking (local-first), so a screen can render
before session restoration finishes. Neither screen previously
distinguished "not yet known" from "signed out."

1. **`SettingsScreen.tsx`'s `AccountSection`** fell through to the
   signed-out "Sign In / Create Account" UI during `authStatus ===
   'hydrating'`, which could misrepresent a user with a real persisted
   session as signed out for the brief window before restoration
   completes. **Fix:** added an explicit `hydrating` branch showing
   "Checking account status…" with no action buttons.
2. **`LeaderboardScreen.tsx`** had no mechanism to recover from an
   `auth_required` result if the real session restored a moment after
   the screen's initial fetch. **Fix:** added an edge-triggered effect
   (fires only on the `authStatus` transition *into* `signed_in`, not
   on every render — deliberately excludes `state` from its dependency
   array to avoid any retry-loop risk) that re-fetches exactly once in
   that case.

Both are minimal, scoped changes with no effect on gameplay, SQLite,
or SQL. Verified via `tsc --noEmit` (clean) and `expo export` (clean;
no automated UI test exists for either, since no React Native
component-testing tool exists in this repo — unchanged limitation from
Phase 2.2, not newly introduced).

## New test coverage

**`src/utils/resetPasswordLink.ts`** (new file) — the recovery deep-
link URL parser was previously inline and untested inside `App.tsx`
(which has no test coverage of its own). Extracted as a pure function
with no behavior change, then tested directly:
`src/utils/__tests__/resetPasswordLink.test.ts`, 6 new assertions —
code extraction, extra query params, percent-decoding, and specifically
the "never mistaken for an ordinary link" guard (requirement #4 from
this phase's own checklist).

**Full suite: 69/69 passing** (63 → 69), `node --test
--experimental-test-module-mocks`, exit 0.

## Platform constraints — what actually needs what

- **Guest mode, sign-in/out, SecureStore persistence:** testable via
  **Expo Go** — every native module this app uses
  (`expo-secure-store`, `expo-sqlite`, `expo-audio`, `expo-haptics`,
  etc.) is part of Expo Go's standard supported set; no custom
  development build is required for these specifically.
- **The `kettleborn://reset-password` custom-scheme deep link
  specifically requires a real installed build** — an EAS development
  build or a production build — **not Expo Go**. Expo Go owns its own
  URL scheme (`exp://...`); the OS has no reason to route a
  `kettleborn://` link to Expo Go, since Expo Go isn't registered for
  it. Testing the deep link through Expo Go during development would
  require temporarily pointing Supabase's redirect at Expo Go's own
  `exp://<host>:<port>/--/reset-password` form instead — a separate,
  explicit decision, not done here.
- **A successful `expo export --platform web` proves the bundle
  compiles and serves — it proves nothing about native deep-link
  routing, Keychain/Keystore behavior, or Expo Go's own URL handling.**
  Stated explicitly per this phase's own instruction not to conflate
  the two.

## Cloud-foundation design note (design only — nothing below is implemented)

Re-reviewed the current migrations/RLS/grants/triggers directly (not
from memory) to confirm the schema still supports today's intended
flow: `profiles` (one row per signed-up user, `display_name` the only
client-writable field), `content_workouts`/`content_hunts` (read-only
reference data), `workout_results` (append-only, SELECT+INSERT own
rows only), `leaderboard_entries` (SELECT-only, written exclusively by
`sync_leaderboard_entry()`). All confirmed correct and unchanged.

**Future guest-progress sync — design only:**

- **Ownership:** every synced `workout_results` row's `user_id` stays
  server-forced from `auth.uid()`, exactly as today — a synced row is
  owned by whoever is signed in at upload time, never client-asserted.
- **Duplicate-upload prevention:** `workout_results.client_result_id`
  already exists as a column (reserved in Phase 1, still unused) but
  has no uniqueness constraint. **Required before any real sync
  ships:** `unique (user_id, client_result_id)` + an `on conflict
  (user_id, client_result_id) do nothing` upsert — this is a schema
  gap already documented in `PHASE_2_1_MIGRATION_AUDIT.md`, re-
  confirmed still open, still not implemented.
- **Retries/offline:** a sync attempt should be safely re-runnable —
  the uniqueness constraint above is what makes a retry-after-timeout
  safe rather than a duplicate-insert risk. No local "pending sync"
  column exists yet on the SQLite `workout_result` table; one would be
  needed to track what's already been uploaded.
- **Guest progress preserved during account creation:** per
  `PHASE_2_1_AUTH_ARCHITECTURE.md`'s already-made decision, sync must
  be an explicit, user-initiated action — never automatic on sign-up
  or sign-in. Nothing in this phase changes that decision or
  implements the import operation itself.
- **Conflict handling:** `workout_results` is append-only with no
  UPDATE/DELETE grant at all — there is no "later edit" to conflict
  with. A local result and a remote result for the same canonical hunt
  are just two independent historical rows; `leaderboard_entries`
  already keeps only the faster of any two results for the same
  `(user, workout)` via its existing `ON CONFLICT ... WHERE` upsert, so
  no new conflict-resolution logic is needed there either.
- **Backend constraints that must never be trusted to the client:**
  all of today's existing ones, unchanged — `user_id`/`monster_id`/
  `rank`/`completed_at` (server-forced), canonical `gear_count` match,
  the `weight_b_kg` structural rules, and the leaderboard eligibility
  checks. A future sync write path must go through the exact same
  `workout_results_before_insert()` trigger every other insert does —
  no "trusted import" bypass.

**Not implemented, not started:** the uniqueness constraint, any new
SQLite column, the import UI, or any upload code. This section is
analysis only, per this phase's explicit scope limit.

## Device acceptance checklist (practical, for the project owner)

Windows/Android is the available real workflow here (no Mac/iOS device
assumed). Dashboard action required first: add
`kettleborn://reset-password` to Authentication → URL Configuration →
Redirect URLs — **not yet added**, do not assume otherwise.

1. **Fresh install, guest mode** — install via Expo Go (scan the QR
   code from `npx expo start`) or a built APK. Complete a full workout
   with no sign-in. Confirm XP/rank/history all work offline.
2. **Create account** — Settings → Account → Create Account, using a
   real mailbox you control (not a placeholder domain — Supabase's own
   anti-abuse rules reject those, confirmed in Phase 2.4). Expect the
   "Check your email" screen.
3. **Confirm the email** — open it on the device, tap the confirmation
   link.
4. **Sign in** — with the confirmed account. Confirm Settings shows the
   signed-in email.
5. **Sign out** — confirm Settings returns to the Sign In/Create
   Account state, and local Hunter/Chronicle stats are unaffected.
6. **Force-close and reopen** — sign in again, then fully force-close
   the app (not background it), relaunch. Confirm it opens already
   signed in. **This specifically tests `expo-secure-store` — requires
   a real device/Expo-Go session, cannot be verified any other way.**
7. **Request password reset** — Settings → Sign In → "Forgot
   password?" with the same real mailbox.
8. **Open the recovery link** — from the email, on the device. **Needs
   either a real installed build, or Supabase's redirect temporarily
   pointed at Expo Go's `exp://` scheme — see "Platform constraints"
   above.** Confirm the app opens directly to "Set a New Password,"
   not the normal Hunt screen.
9. **Set a new password, sign in again** — with the new password, to
   confirm it actually took effect server-side, not just client-side.
10. **Return to guest mode** — sign out, confirm local guest progress
    from step 1 is still fully intact and untouched by any of the
    above.

## Final verification re-run this addendum

| Command | Result |
|---|---|
| `npm test` | **69/69**, exit 0 |
| `npx tsc --noEmit` | exit 0 |
| `npx expo export --platform web` | exit 0 |
| PGlite `run_suite.mjs` / `run_edge.mjs` / `run_hardening_checks.mjs` | 35/35 + 15/15 + 7/7, exit 0 |
| Dev-server guest-mode check (`.env.local` absent) | clean bundle (1008 modules), HTTP 200, no errors |

## Files changed this addendum

- `src/screens/settings/SettingsScreen.tsx` — hydrating-state branch.
- `src/screens/hunt/LeaderboardScreen.tsx` — edge-triggered re-fetch.
- `App.tsx` — now imports the extracted parser instead of defining it inline.
- New: `src/utils/resetPasswordLink.ts`, `src/utils/__tests__/resetPasswordLink.test.ts`.
- This addendum to `supabase/PHASE_2_4_AUTH_IMPLEMENTATION.md`.

No gameplay, SQLite, migration, or dependency change.
