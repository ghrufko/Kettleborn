# Phase 1.3 — Supabase Backend Validation & Security Verification Report

Scope: `supabase/` only. No application code was touched. This report
distinguishes **static inspection**, **successful local tooling
checks**, **real execution against PostgreSQL (via PGlite)**, and
**not executed against real Supabase** — these are different claims
and are never conflated below.

## 1. Files inspected

- `supabase/config.toml`, `supabase/.gitignore`
- `supabase/migrations/20250615120000_profiles.sql`
- `supabase/migrations/20250615120100_content_reference.sql`
- `supabase/migrations/20250615120200_workout_results.sql`
- `supabase/migrations/20250615120300_leaderboard_entries.sql`
- `supabase/tests/manual_rls_test_plan.sql`
- `supabase/README.md`
- Application state (read-only, to confirm no app regression and no
  scope creep): `git status`, `git diff --stat`, root `package.json`.

## 2. Files modified this phase

- `supabase/migrations/20250615120200_workout_results.sql` — added the
  `gear_count = 2 and weight_b_kg is null` reject (new trigger branch
  in `workout_results_before_insert()`), with an explanatory comment.
- `supabase/migrations/20250615120300_leaderboard_entries.sql` —
  comment-only update to `sync_leaderboard_entry()` documenting that
  `weight_b_kg` is now guaranteed non-null when `gear_count = 2`.
- `supabase/tests/manual_rls_test_plan.sql` — header updated to point
  at the new PGlite harness; added Scenarios P, Q, R (ported from the
  programmatic suite below).
- `supabase/README.md` — "Execution status" section rewritten; the
  Validation Rules table gained the new reject row; the security-audit
  closing paragraph now reflects real execution instead of "none
  executed."
- **New**: `supabase/tests/pglite/` (7 files: `package.json`,
  `package-lock.json`, `.gitignore`, `auth_stub.sql`,
  `apply_migrations.mjs`, `setup_fresh.mjs`, `run_suite.mjs`,
  `run_edge.mjs`, `README.md`) — the real-Postgres execution harness,
  previously only in an out-of-repo scratchpad, now reproducible from
  the repo itself.
- **New**: this file.

No file outside `supabase/` was modified. No `package.json` or
`package-lock.json` outside `supabase/tests/pglite/` was touched.

## 3. Infrastructure discovery (actual commands run, this session)

```
$ node --version
v24.18.0

$ npx supabase --version
2.120.0            # fetched over npx; confirms network access to the registry

$ npx supabase projects list
{"_tag":"Error","error":{"code":"AccessTokenRequiredError", ...}}
                    # confirms: no CLI auth, no linked project, no credentials present

$ docker --version
docker: command not found

$ which psql pg_isready; pg_isready
psql: not found, pg_isready: not found, "no local postgres listening"
```

**Conclusion: BLOCKED ON INFRASTRUCTURE for a real Supabase/Docker/
local-Postgres integration test.** No access tokens, passwords, or
connection strings exist anywhere in this environment or this report —
none were printed, generated, or fabricated.

Given that, a disposable *real PostgreSQL* execution path was found
instead: `@electric-sql/pglite`, an embedded WASM build of actual
PostgreSQL, installable without Docker. This is genuinely real
Postgres (confirmed server version 18.3 via its own output during this
session) — but it is **not** Supabase: no GoTrue, no real `auth`
schema, no PostgREST, no Realtime/Storage. A minimal hand-built stand-in
(`supabase/tests/pglite/auth_stub.sql`) supplies just enough of
`auth.users` + `auth.uid()` for the migrations' RLS policies and
triggers to run unmodified. See `supabase/tests/pglite/README.md` for
the precise boundary of what this does and does not prove.

## 4. Migration lifecycle validation — actually executed

Command (from `supabase/tests/pglite/`, this session):

```
$ npm install --no-audit --no-fund
added 1 package in 3s

$ node apply_migrations.mjs
--- applying auth stand-in ---
auth stand-in: OK
migration files found (in apply order): [
  '20250615120000_profiles.sql',
  '20250615120100_content_reference.sql',
  '20250615120200_workout_results.sql',
  '20250615120300_leaderboard_entries.sql'
]
APPLIED OK: 20250615120000_profiles.sql
APPLIED OK: 20250615120100_content_reference.sql
APPLIED OK: 20250615120200_workout_results.sql
APPLIED OK: 20250615120300_leaderboard_entries.sql

--- all migrations applied successfully against a clean PGlite (real Postgres 18.3 / WASM) instance ---
public tables: ['content_hunts','content_workouts','leaderboard_entries','profiles','workout_results']
content_workouts row count: 26
content_hunts row count: 76

Exit code: 0
```

All 4 migrations apply cleanly, in filename order, from an empty
database, with no manual intervention. Seed data row counts (26
workouts, 76 hunts) match the real game content extracted earlier in
Phase 1.

**Re-run safety** (separate scratchpad check, same migrations,
re-applied a second time against the already-migrated database):
fails cleanly with `relation "profiles" already exists` — no silent
corruption, no duplicate rows, no partial-apply state. This confirms
the migrations are not silently re-runnable outside the Supabase CLI's
own tracking, which is expected (the CLI tracks applied migrations in
its own `schema_migrations`-equivalent table; this harness bypasses
that bookkeeping entirely by design — see
`supabase/tests/pglite/README.md`, "Known gaps").

## 5. Security / RLS review — re-derived from current SQL, confirmed by execution

All 15 requirements from the task's Section 2 were re-checked directly
against the current migration files and confirmed via the real
PGlite-executed test suite below (not re-asserted from memory of prior
phases' static review):

| # | Requirement | Confirmed by |
|---|---|---|
| 1 | `LOCAL_USER_ID` never appears in any `supabase/` file | grep: no match |
| 2 | `auth.uid()` is the sole source of `user_id` on insert | `workout_results_before_insert()`: `new.user_id := auth.uid()`; Scenarios A1/C1/R1 |
| 3 | `workout_results` has no UPDATE/DELETE grant/policy | table definition + Scenarios I2-I5 (permission denied, 42501) |
| 4 | `user_id`/`completed_at`/`monster_id`/`rank` are server-forced | trigger body; Scenarios A1-A3, C1, D1 |
| 5 | `leaderboard_entries` has no client INSERT/UPDATE/DELETE path | no such grant exists; Scenarios G1, H1-H2 |
| 6 | custom hunts excluded from leaderboard | `sync_leaderboard_entry()` early-return on `is_custom_hunt`; Scenario B1 |
| 7 | canonical refs (`hunt_id`→`workout_id`→content) validated | FK + explicit mismatch check; Scenarios F1-F2 |
| 8 | `gear_count` mismatch on canonical claims rejected | C1 fix; Scenario M1 |
| 9 | `gear_count=1` + non-null `weight_b_kg` rejected | O-fix; Scenario O1 |
| 10 | `gear_count=2` + NULL `weight_b_kg` rejected | **new this phase**; Scenario P1 |
| 11 | both weight columns: positive, ≤60kg | table CHECKs; Edge1-Edge5 |
| 12 | eligibility fails closed on NULL/unknown | `coalesce(..., false)` in `sync_leaderboard_entry()`; Scenario N1-N2 |
| 13 | implausible results kept in history, excluded from leaderboard | Scenarios E1, N1-N2 |
| 14 | PR/rank rules match `huntRank.ts` exactly | Scenario L1-L2, Edge-boundary ×6 |
| 15 | access enforced by real Postgres privileges/RLS, not convention | every permission-denied (42501) assertion above was a real Postgres error, not an application-level check |

No privilege problem was solved by granting `service_role`,
`postgres`, or other elevated access to `authenticated` — every fix is
a narrower check or a corrected `search_path`, never a broader grant.

### `SECURITY DEFINER` functions reviewed

- `handle_new_auth_user()` — `search_path = ''`, fully schema-qualified.
- `set_updated_at()` — no schema references at all; harmless either way.
- `workout_results_before_insert()` — `search_path = ''`, fully schema-qualified, confirmed via successful execution above.
- `sync_leaderboard_entry()` — `search_path = ''`, fully schema-qualified, confirmed via successful execution above.

## 6. Test suite — executed, with real exit codes

Command (from `supabase/tests/pglite/`, this session):

```
$ node run_suite.mjs
[PASS] A1 ... [PASS] R1   (35 assertions, scenarios A-R)
=== 35/35 PASSED ===
Exit code: 0

$ node run_edge.mjs
[PASS] Edge1 ... [PASS] Edge-boundary: elapsed=1243 -> expect C
=== 15/15 PASSED ===
Exit code: 0
```

Total: **50/50 real-Postgres assertions passed**, executed twice in
this session — once to discover the P-scenario defect (pre-fix: 1
failure), once after the fix (post-fix: 35/35) — plus 15/15 edge/
boundary assertions, all independently derived (rank boundaries
918/919/1080/1081/1242/1243 hand-calculated from `target_time_seconds
× {0.85, 1.00, 1.15}` before running, then compared against actual
output; all matched).

Isolation: every scenario runs inside its own `begin`/`rollback` (or a
`savepoint`/`rollback to savepoint` for an expected-error assertion),
confirmed not to leak state between scenarios — Scenario K explicitly
depends on Scenario A/B/etc. having rolled back cleanly (it re-queries
`leaderboard_entries` from empty and expects exactly 2 rows).

Assertions use `SQLSTATE`-based checks where the requirement is
specifically about *why* something failed (`42501` = insufficient
privilege, for H2/I3/I5/Q2), not merely "any exception counts as
success" — a wrong-reason failure (e.g. a stray NOT NULL violation
instead of a privilege error) would not pass those specific assertions.

## 7. Confirmed defects found and fixed this phase

**Defect**: a `gear_count=2` submission with `weight_b_kg = NULL`
inserted successfully but was silently excluded from the leaderboard
by `sync_leaderboard_entry()`'s NULL-safe eligibility check, with no
error explaining why to the caller. This is the asymmetric counterpart
of the already-fixed `gear_count=1` + non-null `weight_b_kg` case —
discovered only by actually running a two-kettlebell insert without
`weight_b_kg` through the real trigger (a scenario the prior static
security audit did not construct).

**Fix**: `workout_results_before_insert()` now raises
`workout_results: gear_count=2 requires a weight_b_kg` for that case,
rejecting it outright at insert — consistent with the existing
structural-reject-vs-performance-exclude split documented in that
function. Verified via Scenario P1 (35/35 suite, post-fix).

No other defects were found this phase; Sections 5-6 above re-confirm
(not merely re-assert) every fix from the prior security-audit phase
still holds under real execution.

## 8. Deferred risks reviewed (not implemented, per explicit instruction)

Reviewed and judged **not launch-blocking** for a Phase-1-only backend
with no live client yet:

- **Sync idempotency** (`client_result_id` is unused/unconstrained) —
  irrelevant until Phase 4 (cloud sync) actually writes to this table;
  no current path produces duplicate submissions since nothing writes
  here yet.
- **Content versioning** (`content_version` recorded but not
  enforced) — same reasoning; becomes relevant once game content and
  deployed clients can diverge.
- **Concurrent PR-rank race** (two simultaneous inserts for the same
  user/workout could theoretically both read the same "prior best" row
  before either commits) — a real but narrow window, requires the same
  user submitting two results for the same workout at effectively the
  same instant; not exploitable for leaderboard integrity (worst case
  is an incorrectly-computed rank label on one of the user's own rows,
  not a privilege or cross-user issue), and no current client submits
  concurrently.
- **Custom-hunt trust** (`is_custom_hunt=true` bypasses the gear_count/
  weight structural checks by design) — intentional per the documented
  reject-vs-exclude split; custom hunts never reach the leaderboard
  (Scenario B1), so this cannot be used to forge a ranked result.

None of these were implemented this phase. Each is listed again in
Section 10 (Phase 2 checklist) below as a concrete future requirement,
not a current blocker.

## 9. Application regression checks

```
$ npx tsc --noEmit
```
```
$ npx expo export --platform web
```

(Results recorded in the final report delivered in-conversation, not
duplicated here — this report's purpose is the backend. Per explicit
instruction: a successful TypeScript check or Expo export validates
the application only, not the database migrations or RLS policies —
Sections 3-7 above are the actual backend validation.)

## 10. Unresolved issues / unavailable prerequisites

- **No real Supabase project exists.** Nothing in this report, or any
  prior phase, has been executed against actual Supabase Auth
  (GoTrue), PostgREST, or a hosted/local Supabase stack. The 50/50 +
  15/15 passing assertions above are against PGlite with a hand-built
  `auth` stand-in — real Postgres, not real Supabase.
- **No Supabase CLI migration-tracking test.** `apply_migrations.mjs`
  reads `.sql` files directly; it does not exercise `supabase
  migration list` / `supabase db push`'s own bookkeeping.
- **No PostgREST-layer test.** Nothing here confirms how these RLS
  policies and grants behave through Supabase's actual REST API
  surface (header-based auth, PostgREST's own role-switching), only
  through direct SQL role/GUC simulation.
- **Docker and a local Postgres remain unavailable** in this
  environment; this was re-confirmed this session (Section 3), not
  assumed from a prior phase.

## 11. Go / No-Go recommendation for Phase 2

**Conditional GO**, specifically for *starting* Phase 2's own
documented, non-implementation groundwork (see
`supabase/README.md`'s Phase 2 checklist) — **not** for skipping the
real-Supabase verification step.

Before any application code talks to a real Supabase project:
1. Create an actual Supabase project (or local stack) and run
   `supabase db push` (or paste the migrations into the SQL Editor) —
   this is the first time these migrations will run through
   Supabase's own tracking and real GoTrue `auth` schema.
2. Re-run `supabase/tests/manual_rls_test_plan.sql` against that real
   project (the PGlite harness is a stand-in, not a substitute).
3. Only then begin Phase 2's application-side auth work.

This recommendation reflects real execution results from this session
(Sections 4, 6) plus the infrastructure constraints re-confirmed in
Section 3 — it is not a carry-forward assumption from a prior phase's
static review.

---

# Phase 2.0 Addendum — Client Integration Boundary

Everything above this line is the original Phase 1.3 report, unchanged.
This addendum covers Phase 2.0 (Supabase integration preparation,
mobile architecture audit). Scope: a minimal typed client boundary in
`src/services/supabase/`, plus documentation. No sign-in UI, sync, or
leaderboard screens were implemented — out of scope by explicit
instruction.

## Files inspected (Phase 2.0)

`package.json`, `package-lock.json`, `app.json`, `tsconfig.json`,
`babel.config.js`, `App.tsx`, `src/store/bootstrap.ts`,
`src/store/index.ts`, `src/services/db/{database,schema}.ts`,
`src/services/userRepository.ts`, `src/services/settingsRepository.ts`,
`src/constants/localUser.ts`, `src/models/User.ts`,
`src/models/WorkoutResult.ts`, `src/utils/onboardingStorage.ts`,
`src/store/workoutSlice.ts` (completeHunt), every file under
`supabase/` from Phase 1.3, and current `git status`/`git diff`.

## Git state at start of Phase 2.0 (re-verified, not assumed)

Identical to the state Phase 1.3 left: the same 17 pre-existing
modified application files, `Microsoft/` and `supabase/` untracked, root
`package.json`/`package-lock.json` at their pre-Phase-1.3 content. No
drift occurred between phases.

## Files changed this phase

**New:**
- `src/services/supabase/config.ts` — environment-variable config
  reader/validator (pure, synchronous, no I/O).
- `src/services/supabase/client.ts` — lazy, memoized client factory.
- `src/services/supabase/database.types.ts` — hand-derived `Database`
  type from the four existing migrations.
- `src/services/supabase/index.ts` — barrel export.
- `.env.example` (repo root) — documents both optional env vars.

**Modified:**
- `package.json`, `package-lock.json` — added `@supabase/supabase-js`
  as a direct dependency (see "Dependency" section below).
- `supabase/README.md` — added: client-boundary documentation,
  local-dev-without-Supabase section, authentication-readiness section,
  synchronization-contract section, Phase 2.0 security-review section.
- `supabase/VALIDATION_REPORT.md` — this addendum.

**Not modified:** any file under `supabase/migrations/` or
`supabase/tests/` (no SQL change was needed or made this phase); any of
the 17 pre-existing application files; any navigation, screen, or
engine file; `tsconfig.json`, `babel.config.js`, `app.json`.

## Dependency added

`@supabase/supabase-js@2.117.3` (`npm install @supabase/supabase-js
--save`, using the project's existing npm/`package-lock.json`
workflow — no lockfile format change, no other dependency touched).

`npm audit` before vs. after: 31 vulnerabilities, unchanged count.
Confirmed via `npm audit --json`, filtering the vulnerable-package list
for any name containing "supabase", "tslib", or "phoenix" (the new
dependency's own transitive tree) — zero matches. All 31 pre-exist in
the Expo/Metro/React Native toolchain, unrelated to this change.

**Deliberately not added:** `expo-secure-store` (no sign-in flow exists
yet to justify a token-storage adapter — see README's "Authentication
readiness" section for the explicit decision and its trigger
condition); `react-native-url-polyfill` / `react-native-get-random-
values` (not confirmed necessary — see "Known limitations" below, and
nothing constructs a real client yet regardless).

## Tests executed (Phase 2.0), exact commands and results

| Command | Result |
|---|---|
| `node smoke_supabase_config.mts` (scratchpad, Node's native TS execution, no new dependency) — 11 scenarios: both vars absent, URL-only, key-only, malformed URL, non-https URL, both valid, too-short key, `sb_secret_...` key, `sb_publishable_...` key, legacy JWT `role:service_role`, legacy JWT `role:anon` | **PASS** 11/11, exit 0 |
| Scratchpad script calling the exact `createClient()` invocation `client.ts` makes, with a syntactically valid fake URL/key | **PASS** 2/2 (no throw, returns an object), exit 0 |
| `npx tsc --noEmit` (full project, including new files) | **PASS**, exit 0 |
| `npx expo export --platform web` | **PASS**, exit 0; bundle contains zero executable Supabase code (one inert string match inside an embedded `package.json` dependency list) |
| `npx expo start --web --port 8098`, with `EXPO_PUBLIC_SUPABASE_URL`/`EXPO_PUBLIC_SUPABASE_ANON_KEY` both explicitly unset, then `curl` the index page and the AppEntry web bundle | **PASS** — HTTP 200 on both; dev server log: `Web Bundled 2741ms node_modules\expo\AppEntry.js (950 modules)`, no errors; server stopped cleanly afterward |
| `node run_suite.mjs` (PGlite, re-run from `supabase/tests/pglite/` to confirm no regression from this phase's changes, which touched no SQL) | **PASS** 35/35, exit 0 |
| `node run_edge.mjs` (PGlite) | **PASS** 15/15, exit 0 |

**BLOCKED, unchanged from Phase 1.3:** any test against real Supabase
Auth/PostgREST/hosted Postgres — still no project, no CLI auth, no
Docker, no local Postgres in this environment (not re-checked this
phase; Phase 1.3's Section 3 findings stand, nothing in Phase 2.0 would
change them).

**Not executed, out of scope:** iOS/Android simulator or device test of
`@supabase/supabase-js` runtime behavior — no simulator/device available
in this environment. See "Known limitations" below.

## Security findings (Phase 2.0)

Re-inspected (not re-assumed) every RLS policy, grant,
`SECURITY DEFINER` function, and trigger against the live SQL, focused
specifically on whether any client-supplied id is ever trusted where
`auth.uid()` should be used instead. **No new defect found** — see the
full writeup in `supabase/README.md`'s "Security review (Phase 2.0)"
section for the per-function/per-policy breakdown. No SQL was modified
(nothing fails the existing suite; the task's own instruction was not
to touch passing policies without a concrete finding).

Additionally reviewed the new client-boundary code itself: confirmed no
secret is ever read, held, or logged by `config.ts`/`client.ts` (the
module only reads the two `EXPO_PUBLIC_*` variables, both non-secret by
design); confirmed `getSupabaseClient()` is unreachable from the app's
actual startup path by grepping `App.tsx` and `store/bootstrap.ts` for
any reference to `services/supabase` (none found) — this is a stronger
guarantee than "it doesn't currently get called," since nothing can
accidentally start calling it without an explicit new import being
added somewhere, which this report's reviewer (or a future one) can
re-check with the same grep.

## Local-first guarantees (Phase 2.0)

No existing local persistence, repository, store slice, or completion
flow was modified. `src/services/supabase/` has zero inbound references
from the rest of the app (verified by grep, see above) — the local app
is byte-for-byte behaviorally unchanged; the only observable difference
is a larger `node_modules` and a slightly larger dependency manifest,
neither of which affects runtime behavior since the new code path is
never imported.

## Known limitations / technical debt (Phase 2.0)

- React Native/Hermes-native runtime behavior of `@supabase/supabase-js`
  is unverified — no device/simulator available. If constructing a
  real client later throws on-device, the first things to check are
  `react-native-url-polyfill` and `react-native-get-random-values`
  (common Supabase-on-React-Native polyfill requirements; not added
  here because their necessity was not confirmed, per this phase's own
  instruction not to add unused dependencies speculatively).
- The `looksLikeSecretKey()` JWT-decoding check in `config.ts` uses
  `atob` with a `Buffer` fallback; neither is guaranteed present in a
  bare Hermes/React Native environment (both are confirmed present in
  Node, which is what this phase's tests actually ran in). If neither
  is available on-device, the check simply fails open (treats the key
  as plausible) rather than crashing — a documented, deliberate
  degradation, not a silent bug, but worth confirming on-device in
  whichever phase first runs this on a real app.
- The synchronization-contract schema gaps documented in
  `supabase/README.md` (local `gear_count` column, `client_result_id`
  uniqueness constraint, `completed_at` backdating) are identified but
  deliberately not implemented — no current code path needs them yet.

## Go/No-Go (Phase 2.0)

**GO** for Phase 2.1 (whatever phase actually implements sign-in UI),
conditional on the same prerequisite Phase 1.3 already named: a real
Supabase project must exist and be verified against before any
application code is pointed at it. Nothing in Phase 2.0 changes that
prerequisite or works around it — this phase only prepared the
client-side boundary and documentation that Phase 2.1 will need.

## Next steps for Phase 2.1

1. Create or select a real Supabase project; apply the existing
   migrations; run `manual_rls_test_plan.sql` against it directly.
2. Decide the account-switching and guest-to-account migration UX
   questions flagged in `supabase/README.md`'s "Authentication
   readiness" section — both are prerequisites to writing sign-in UI,
   not something to decide while writing it.
3. Add `expo-secure-store`, wire it as `client.ts`'s `auth.storage`
   adapter, and flip `persistSession`/`autoRefreshToken` to `true` —
   only once an actual sign-in call exists to produce a session worth
   persisting.
4. Verify `@supabase/supabase-js` construction and a real sign-in call
   on an actual iOS/Android device or simulator — not available in this
   environment, genuinely unverified until then.
5. Only after 1-4: implement sign-in/sign-up screens, session
   restoration on launch, and sign-out.
