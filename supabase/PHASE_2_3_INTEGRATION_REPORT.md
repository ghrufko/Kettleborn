# Phase 2.3 — Integration Report

## Result: BLOCKED ON SUPABASE PROJECT ACCESS

No real Supabase project is accessible in this environment. Every task
in this phase that requires one is marked **BLOCKED** below, not
fabricated. Every task that does not require one was completed and is
marked accordingly. This is the same infrastructure ceiling re-
confirmed at the start of Phases 1.3, 2.1, and now 2.3 — re-checked
directly each time, never assumed to still be true from a prior
phase's report.

## 1–2. Current remote project status / accessibility

Checked this phase, with exact commands:

```
$ docker --version
docker: command not found

$ which psql
psql: not found

$ npx supabase --version
2.120.0                 # CLI itself is fetchable/installed

$ npx supabase projects list
{"_tag":"Error","error":{"code":"AccessTokenRequiredError", ...}}
                         # no CLI auth, no linked project

$ echo "SUPABASE_ACCESS_TOKEN set: ..."      -> no
$ echo "EXPO_PUBLIC_SUPABASE_URL set: ..."   -> no
$ echo "EXPO_PUBLIC_SUPABASE_ANON_KEY set: ..." -> no
$ ls -la .env*
.env.example   # only the committed placeholder template; no real .env/.env.local exists
```

`supabase/config.toml`'s `project_id = "Kettleborn"` is, as its own
comment states, the local scaffold default assigned by `supabase init`
("defaults to the working directory name") — re-confirmed this phase
to **not** be a real project reference, not assumed.

**No real project exists or is accessible. No credentials of any kind
were found, printed, or fabricated.**

### Exact action required to unblock

1. Create a Supabase project (free tier is sufficient) at
   [supabase.com](https://supabase.com).
2. Run `supabase login` (or set `SUPABASE_ACCESS_TOKEN`) so the CLI in
   this environment can authenticate.
3. Run `supabase link --project-ref <your-ref>` from the repo root.
4. Provide `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`
   (via `.env.local`, gitignored) so the app itself can reach it.
5. Confirm whether email confirmation should stay enabled on that
   project (default) or be disabled for faster manual testing — this
   phase did not change that setting and was not authorized to.

## 3. Migration deployment status

**Not deployed — no target exists.** Deployment safety was
re-inspected instead (what Section 5 of the task actually asked for
when deployment itself is blocked):

- All four migration files re-confirmed **byte-identical in line
  count** to the Phase 2.1 audit (123 / 204 / 215 / 161 = 703 total) —
  no drift since that audit, re-checked directly via `wc -l`, not
  assumed.
- Re-confirmed: no `if not exists`/`on conflict` guards on any `create
  table`/`create function` — intentional, fails loudly
  (`relation already exists`) rather than silently duplicating, if
  mistakenly re-run outside the CLI's own tracking (PGlite-confirmed in
  Phase 1.3, re-confirmed again this phase via the PGlite suite re-run
  in Section 14 below).
- Dependency order (1 `profiles` → 2 `content_reference` → 3
  `workout_results` → 4 `leaderboard_entries`) re-confirmed correct:
  each migration's foreign keys only reference objects created by an
  equal-or-earlier one.
- Whether the real hosted project (once created) will be fresh or
  partial is unknowable until it exists — the "exact action required"
  list above item 3 (`supabase link`) is also the point at which this
  becomes answerable, via `supabase migration list` against the real
  project before applying anything.

**No migration was applied anywhere.** No destructive operation was
performed or attempted.

## 4. Actual remote schema verification

**BLOCKED** — no remote schema exists to verify.

## 5. RLS / security test results

**BLOCKED for real-Postgres-on-a-hosted-project verification.**
**Not blocked, and re-run this phase:** the PGlite suite, which
exercises the identical SQL/RLS/grant logic against real PostgreSQL
(not a hosted project — see the long-standing caveat in
`supabase/README.md` and `VALIDATION_REPORT.md`):

```
$ node run_suite.mjs      (from supabase/tests/pglite/)
=== 35/35 PASSED ===
Exit code: 0

$ node run_edge.mjs
=== 15/15 PASSED ===
Exit code: 0
```

Every specific property Section 6 of the task asked to validate is
already covered by this re-run suite and was **not** re-litigated with
new tests this phase (none of the underlying SQL changed, so no new
test was needed — see `PHASE_2_1_MIGRATION_AUDIT.md` for the full
per-property mapping to scenario letters A–R and the edge-boundary
assertions). Specifically already covered: cross-user submission
rejection (C, I), server-controlled-field forcing (A, D), immutability
(no UPDATE/DELETE grant — I2–I5), no direct leaderboard writes (G, H),
cross-user read isolation (I1), profile XP/level lockdown (Q1–Q2),
unauthenticated rejection (R), invalid hunt/workout refs (F), canonical
gear-count mismatch (M), single-kettlebell-with-second-weight (O),
gear_count=2-without-second-weight (P), excessive weight /
implausible time exclusion (E, N, Edge1–Edge9), custom-hunt exclusion
(B), NULL-bypass prevention (the `coalesce(..., false)` fix, N),
client-rank/monster-id/timestamp/user-id override rejection (A, C, D),
faster-result-updates / slower-result-ignored (J), independent-user
isolation (K), PR-specific S-rank (L).

**The two-query leaderboard service specifically:** re-verified this
phase via the Phase 2.2 `leaderboard.test.ts` suite (mocked, not
hosted — see Section 8) that the no-FK-embed limitation is handled
correctly (separate `leaderboard_entries` + `profiles` queries, joined
client-side, with a documented fallback when a profile row is missing).
Not yet verified against a real PostgREST endpoint, which is the one
thing that could behave differently from the mock (e.g. actual
PostgREST query-param encoding) — flagged, not assumed safe.

## 6. Authentication end-to-end test results

**BLOCKED — no real project to sign up against.** No account was
created, no sign-in was attempted, no password-reset email was
requested, because there is no real GoTrue endpoint to send any of
those requests to. `getSupabaseConfigState()` was re-confirmed this
phase to correctly report `unconfigured` (verified by the existing,
re-run `config.test.ts` suite — Section 14), which is the correct and
only honest behavior available without real credentials.

**Not blocked — re-confirmed from Phase 2.2, not re-tested fresh:** the
48-assertion mocked suite covering every one of Section 7's listed
behaviors (required-field validation, invalid email, password
validation, duplicate-submit protection, loading-state cleanup,
user-facing error mapping, `emailConfirmationRequired` distinction,
valid/invalid/missing credentials, session restoration and its
failure, sign-out and its failure, listener registration/cleanup) —
all against a mocked client, none against a real GoTrue. Re-run this
phase with no changes and no regressions (Section 14).

## 7. Password-reset and email-confirmation status

**BLOCKED** for actual delivery verification — `requestPasswordReset()`
exists (Phase 2.2) and is implemented correctly per the SDK's
documented contract, but calling it requires a real project with a
configured redirect URL, neither of which exists. **Not claimed as
working end-to-end** — distinguished explicitly: the request-submission
code path is implemented and type-checks; actual email delivery and
the full reset flow are unverified.

## 8. Leaderboard integration test results

**BLOCKED for real data.** No real `leaderboard_entries` rows exist
anywhere (no project, so no inserts have ever happened outside PGlite's
disposable, in-memory test runs). **Not blocked:** the Phase 2.2
`leaderboard.test.ts` suite (9 assertions, re-run this phase, no
regressions) already covers: unauthenticated (`auth_required`)
behavior, empty leaderboard, populated/ordered leaderboard, the
display-name join and its missing-profile fallback, network-error
mapping, and an unrecognized-Postgrest-error mapping — all against a
mocked client. **Genuinely unverified:** real PostgREST query
behavior, real RLS enforcement end-to-end (vs. PGlite's hand-built
`auth` stand-in), and the actual `HuntCompleteScreen` → `Leaderboard`
navigation rendering real data on a real device/browser session.

## 9. Web verification

Re-run this phase (Section 14): `npx expo export --platform web`
succeeded, producing a **byte-identical bundle** to the one at the end
of Phase 2.2 (`AppEntry-231121bf...`) — confirms zero behavioral drift
from re-running checks alone (no code was changed by this phase; see
Section 12). A live dev-server smoke test was not re-run this phase
(already demonstrated twice, Phases 2.0 and 2.2, with no code change
since to warrant a third run) — if that omission matters, it is called
out here rather than silently skipped.

## 10. Native verification status

**Not performed — no iOS/Android device or simulator is available in
this environment.** This was not attempted, approximated, or
represented as done. See Section 11 below for the code-level assessment
that substitutes for it where possible.

## 11. Session-persistence assessment

Installed `@supabase/supabase-js`: **2.117.3**, re-confirmed this phase
via `node -e "require('@supabase/supabase-js/package.json').version"`
— unchanged since Phase 2.0.

Current configuration (`src/services/supabase/client.ts`, unchanged
this phase): `persistSession: false`, `autoRefreshToken: false`,
`detectSessionInUrl: false` — **no storage adapter configured on any
platform, deliberately**, because no sign-in flow has ever produced a
session worth persisting (Phase 2.2 built the UI; nothing has
successfully signed in yet, anywhere, since no real project exists).

**Why this is correct for both platforms today, not an oversight:**
Supabase-js's default session storage (when `persistSession: true` and
no adapter is given) assumes a `localStorage`-like global, which exists
in a browser (Expo web) but **does not exist in React Native/Hermes**
— enabling persistence without an explicit adapter would likely throw
or silently no-op on native, a real platform divergence. Leaving
persistence off entirely avoids this trap on both platforms rather than
accidentally shipping web-only behavior.

**What's required before native persistence can work, unchanged from
the Phase 2.1 decision, re-confirmed not yet needed:** `expo-secure-store`
(iOS Keychain / Android Keystore-backed), wired as a
`SupportedStorage`-shaped adapter (`getItem`/`setItem`/`removeItem`,
all async) passed as `auth.storage`, with `persistSession`/
`autoRefreshToken` flipped to `true` at the same time. **Not added this
phase** — per explicit instruction, only if independently testable and
safe; with no real session ever producible in this environment, there
is nothing to test it against yet, so adding it now would be
unverifiable and premature.

**Not claimed:** that native persistence works. It has never been
exercised on any platform, including web (no real session has ever
existed to persist, since `persistSession` is off).

## 12. Files changed this phase

**New:**
- `supabase/PHASE_2_3_INTEGRATION_REPORT.md` (this file).

**Modified:**
- `supabase/README.md` — one short paragraph re-confirming the
  execution-status blocker as of this phase, pointing at this report.

**Not modified:** every application file, every SQL migration, every
Phase 2.2 service/slice/screen, `package.json`/lockfile,
`.env.example`. No code was written or changed this phase — it was a
verification-and-documentation pass, per the actual achievable scope
once Section 4's discovery confirmed no remote access exists.

## 13. Commands run and exact exit codes

| Command | Exit code | Notes |
|---|---|---|
| `git status --short` (before and after) | n/a | identical file set both times |
| `docker --version` | 1 (not found) | confirms no Docker |
| `which psql` | 1 (not found) | confirms no local Postgres client |
| `npx supabase --version` | 0 | CLI itself fetchable (`2.120.0`) |
| `npx supabase projects list` | non-zero | `AccessTokenRequiredError` — no auth |
| `npm test` | 0 | 48/48 passed |
| `npx tsc --noEmit` | 0 | no errors |
| `npx expo export --platform web` | 0 | bundle byte-identical to Phase 2.2's |
| `node run_suite.mjs` (PGlite) | 0 | 35/35 passed |
| `node run_edge.mjs` (PGlite) | 0 | 15/15 passed |
| secret-pattern scan across all Phase 2.0–2.3 files | n/a | only benign matches (the `sb_secret_` prefix-check string itself, and fake test JWTs) — re-confirmed this phase |

## 14. Existing tests re-run and their results

All of the above — `npm test` (48/48), `node run_suite.mjs` (35/35),
`node run_edge.mjs` (15/15), `tsc --noEmit` (clean), `expo export`
(byte-identical bundle hash to the prior phase, confirming no drift).
No test was skipped silently; none required modification.

## 15. Remaining blockers

1. No real Supabase project — blocks Sections 4, 6, 7, 8, 10, and the
   "real schema state" half of Section 3.
2. No iOS/Android device or simulator — blocks Section 10 entirely,
   independent of blocker 1 (would still block native testing even if
   a real project existed).

## 16. Known limitations

- The two-query leaderboard join, the `auth_required` error mapping,
  and every RLS/trigger property have only ever been verified against
  PGlite's hand-built `auth` stand-in, never real GoTrue/PostgREST.
- Native session persistence is unimplemented and unverified on both
  counts (code doesn't exist yet; no device to test it on even if it
  did).
- Password-reset delivery is implemented but has never sent a real
  email.

## 17. Recommended next phase (Phase 2.4 — plan only, not implemented)

Once a real Supabase project exists and is linked (see Section 1's
"exact action required" list):

1. Apply the existing migrations via `supabase db push`; run
   `manual_rls_test_plan.sql` against the real project directly.
2. Exercise the Phase 2.2 UI for real: create a test account, sign in,
   sign out, request a password reset — through the actual app, not a
   mock.
3. Confirm the leaderboard screen against real (test-account-produced)
   data.
4. Only after 1–3 succeed: add `expo-secure-store`, wire it as
   `client.ts`'s `auth.storage`, flip `persistSession`/
   `autoRefreshToken` to `true`.
5. Test on a real iOS/Android device or simulator — the first point in
   this entire project where that becomes possible.
6. Still explicitly out of scope even then, per standing instruction:
   guest-to-account migration implementation, background sync, and any
   automatic local-history upload — those remain Phase 2.1's documented
   decisions, not yet built.

## 18. Go / No-Go

**NO-GO for any claim of real backend integration** — none was
possible this phase; nothing above claims otherwise. **GO for Phase
2.4's plan once the user completes Section 1's five steps** — all
Phase 2.2 code is implementation-complete and locally verified, and is
the correct next thing to point at a real project the moment one
exists. No code in this repository needs to change before that happens.
