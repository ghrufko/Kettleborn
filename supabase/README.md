# Kettleborn — Supabase Backend (Phase 1)

Backend-only foundation for Accounts + Cloud Sync + Leaderboards, built per
the Phase 0 architecture proposal. **Nothing in the React Native app
reads or writes any of this yet** — see "Scope of this phase" below.

## Execution status — read this first

There is still no hosted Supabase project and no authenticated Supabase
CLI session anywhere in this environment — that part has **not**
changed and still requires you.

**What *has* changed as of Phase 1.3:** the migrations and a 50-assertion
test suite (covering every scenario in
`supabase/tests/manual_rls_test_plan.sql`, plus weight-ceiling and exact
rank-boundary edge cases) were actually **executed against real
PostgreSQL 18** — specifically [PGlite](https://pglite.dev/), an
embedded WASM build of genuine Postgres, run from a disposable Node
script outside this repository (nothing was installed into
`package.json`). This is real execution, not SQL parsing or a mock — but
it is **also not a full Supabase integration test**: PGlite has no
GoTrue, no real `auth` schema, and none of Supabase's platform plumbing.
A minimal hand-built stand-in (`auth.users` table + an `auth.uid()`
function reading the same `request.jwt.claims` GUC Supabase's real
implementation reads) was created to give the migrations' `auth.*`
references something real to run against. See
`supabase/VALIDATION_REPORT.md` for the full, itemized results —
including one real bug this execution found that static review had
missed, now fixed.

**Still genuinely untested:** actual Supabase Auth behavior (GoTrue
itself — signup flows, JWT issuance, session handling), anything
specific to Supabase's hosted Postgres configuration vs. vanilla
Postgres 18, and the CLI's own `db push`/migration-tracking machinery.
Nothing in this repository can exercise those without a real account.

**Re-confirmed as of Phase 2.3:** still true, re-checked directly
(no CLI auth, no Docker, no local Postgres, no `.env`/environment
variables present) rather than assumed from this paragraph's prior
phases. See `PHASE_2_3_INTEGRATION_REPORT.md` for the exact checks run
and the exact steps needed to unblock this.

## Phase 2.0 — client integration boundary (new)

A minimal, typed client boundary now exists in the app itself, at
`src/services/supabase/`:

- `config.ts` — reads `EXPO_PUBLIC_SUPABASE_URL` /
  `EXPO_PUBLIC_SUPABASE_ANON_KEY` from `process.env` and returns a
  discriminated `SupabaseConfigState` (`unconfigured` / `invalid` /
  `configured`). Pure and synchronous — no I/O, never throws. Includes a
  best-effort check that rejects a service-role/secret key placed in the
  anon-key slot (both the legacy JWT `role` claim and the newer
  `sb_secret_...` prefix).
- `client.ts` — `getSupabaseClient()` lazily constructs and memoizes a
  `SupabaseClient<Database>`, returning `null` (never throwing) when
  configuration is absent or invalid. **Nothing in the app calls this
  function yet** — grep confirms `App.tsx` and `store/bootstrap.ts` do
  not import `services/supabase` at all, so no Supabase client is ever
  constructed and no related network activity can occur during ordinary
  local-first usage. Deliberately not wired into `src/services/index.ts`
  either, so importing the existing repository barrel never pulls in
  `@supabase/supabase-js`.
- `database.types.ts` — a hand-derived `Database` type covering exactly
  the columns in the four migrations below (not generated via
  `supabase gen types` — no real project exists to generate from).
  Regenerate once a real project exists.
- `.env.example` (repo root) — documents both variables; neither is a
  secret (see below).

**Dependency added:** `@supabase/supabase-js@2.117.3` in root
`package.json`. Confirmed via `npm audit` that none of the 31
pre-existing vulnerability warnings in this project are attributable to
it or its transitive dependencies (`@supabase/auth-js`,
`@supabase/realtime-js`, etc.) — all 31 pre-date this change.

**What was verified, concretely, this phase:**
- `getSupabaseConfigState()` was executed (via Node's native TypeScript
  support, no test framework added) against 11 scenarios: both vars
  absent, only URL, only key, malformed URL, non-https URL, both valid,
  too-short key, a `sb_secret_...` key, a `sb_publishable_...` key, a
  legacy JWT with `role: service_role`, and a legacy JWT with
  `role: anon`. All 11 passed.
- `createClient()` (the exact call `client.ts` makes, same options) was
  executed with a syntactically valid fake URL/key and did not throw or
  attempt a network call at construction.
- `npx tsc --noEmit` passed with the new files included.
- `npx expo export --platform web` passed; the resulting bundle contains
  **zero** references to actual Supabase client code (the one `grep`
  match for "supabase" in the exported bundle is an inert string inside
  an embedded copy of `package.json`'s dependency list, not executable
  code) — concrete evidence nothing imports this boundary yet.
- The Expo web dev server was started with **no** `EXPO_PUBLIC_SUPABASE_*`
  variables set; the app's bundle compiled cleanly (950 modules, no
  errors) and served successfully, confirming the local-first app
  initializes correctly with Supabase entirely unconfigured.

**What was NOT verified** (no device/simulator available in this
environment): React Native/Hermes-specific runtime behavior of
`@supabase/supabase-js` on iOS/Android specifically — e.g. whether
`@supabase/realtime-js`'s use of the global `WebSocket` or
`@supabase/auth-js`'s internals need an additional polyfill
(`react-native-url-polyfill`, `react-native-get-random-values`) on a
real device. Likely fine (modern React Native/Hermes provides these
globals, and this phase deliberately never constructs a client during
ordinary app usage anyway, further reducing exposure), but not run on
an actual device/simulator — verify in whichever phase first calls
`getSupabaseClient()` for real.

### Local development without Supabase

The app requires **no environment variables at all** to run — this was
verified above with both variables unset. Both
`EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` are
optional; if either is missing, `getSupabaseConfigState()` returns
`{ status: 'unconfigured' }` (if both are missing) or
`{ status: 'invalid', reason: ... }` (if only one is set, or a value is
malformed) — never a crash, never a silent false-positive "configured"
state.

To opt into cloud features in development: copy `.env.example` (repo
root) to `.env.local` (already gitignored) and fill in a real project's
URL and anon/publishable key.

**Why public client keys are not secrets:** the `EXPO_PUBLIC_` prefix
means Expo inlines the value into the JS bundle at build time
(`babel-preset-expo` does this automatically — confirmed against this
project's actual `babel.config.js`, no extra configuration needed). The
anon/publishable key is specifically designed by Supabase to be shipped
this way; it grants no access on its own — every table's Row Level
Security policy (see "RLS summary" below) is what actually controls what
an authenticated-or-anonymous request can do. **Why the service-role/
secret key must never appear here:** that key bypasses RLS entirely,
has no public-safe use, and must only ever live on a server you control
(none exists in this project). `config.ts`'s `looksLikeSecretKey()`
check exists specifically to catch this mistake early.

## What you need to do to actually stand this up

1. **Create the project**: [supabase.com](https://supabase.com) → New
   Project. Free tier is fine for this stage — nothing here needs more.
   Pick a region close to your expected player base; it's changeable
   later only by migrating, so don't agonize over it.
2. **Install the CLI** (if you want the standard workflow):
   `npm install -g supabase` (or `npx supabase@latest` per command, which
   is what was used to scaffold this directory — no global install
   required).
3. **Link this repo to the project**: `supabase login`, then
   `supabase link --project-ref <your-project-ref>` from the repo root.
4. **Apply the migrations**: `supabase db push` — this runs every file
   in `supabase/migrations/` in order against your live project. (Or:
   paste each migration file's contents into the Dashboard's SQL Editor,
   in filename order, if you'd rather not use the CLI at all.)
5. **Run the test plan**: paste
   `supabase/tests/manual_rls_test_plan.sql` into the SQL Editor and
   read through the `EXPECT:` comments against the actual output. Every
   scenario in this file has already been executed once against real
   Postgres (PGlite) with all assertions passing — see
   `VALIDATION_REPORT.md` — so this step is confirming the *same* logic
   behaves identically on Supabase's actual hosted Postgres + real auth,
   not discovering it for the first time. See the caveat at the top of
   that file about the `auth.users` fixture insert — it may need
   adjusting for your project's exact auth schema version (this is the
   one part PGlite testing couldn't validate, since it has no real
   GoTrue-managed `auth.users` table).
6. Come back and tell me it's live — Phase 2 (account identity in the
   app) needs your project URL and anon key.

## Scope of this phase

Per the Phase 1 instructions, strictly backend-only. Confirmed **not**
touched: SQLite schema/migrations, Zustand store, `completeHunt()`,
battle/progression/session engines, any UI or navigation, `package.json`
(no `@supabase/supabase-js` added). The app behaves identically to
before this phase — there is nothing in it yet that could behave
differently, since nothing calls out to any of this.

---

## Project structure

```
supabase/
  config.toml                        — CLI config (from `supabase init`)
  migrations/
    20250615120000_profiles.sql
    20250615120100_content_reference.sql
    20250615120200_workout_results.sql
    20250615120300_leaderboard_entries.sql
  tests/
    manual_rls_test_plan.sql         — scenarios A-R; executed via PGlite (see below), not yet against real Supabase
    pglite/                          — real-Postgres (PGlite/WASM) execution harness; see its own README.md
      package.json, package-lock.json, .gitignore
      auth_stub.sql                  — hand-built auth.users/auth.uid() stand-in
      apply_migrations.mjs           — applies all 4 migrations from empty
      setup_fresh.mjs                — shared fixtures/helpers
      run_suite.mjs                  — scenarios A-R (35 assertions)
      run_edge.mjs                   — weight/time boundaries + rank cutoffs (15 assertions)
      README.md                     — exact run instructions + what PGlite does/doesn't prove
  VALIDATION_REPORT.md               — Phase 1.3: files touched, commands run, exit codes, go/no-go
  README.md                          — this file
```

Four migrations, in dependency order. Each is self-contained and
commented; this document is the map, not a duplicate of the SQL.

## Local environment & running the tests

**No credentials, access tokens, or project URLs are required for
anything in this section** — the PGlite harness is fully local and
disposable.

Required: Node.js (confirmed working with v24.18.0 this session; any
reasonably current LTS should work) and network access once, to `npm
install` `@electric-sql/pglite`.

```sh
cd supabase/tests/pglite
npm install              # installs @electric-sql/pglite into this subfolder only
npm run apply            # apply_migrations.mjs — confirms all 4 migrations apply cleanly from empty
npm test                 # run_suite.mjs — scenarios A-R, 35 assertions
npm run test:edge        # run_edge.mjs — weight/time boundaries + exact rank cutoffs, 15 assertions
```

Each prints `[PASS]`/`[FAIL]` per assertion and a final count; exit
code is non-zero if anything failed. As of Phase 1.3, all three
commands pass cleanly (50/50 total assertions) — see
`VALIDATION_REPORT.md` Section 6 for the literal output and exit codes
from the run that produced that report.

**What this does and does not prove**, briefly (full detail in
`tests/pglite/README.md`): PGlite is real PostgreSQL (confirmed
version 18.3), so every constraint, trigger, function, RLS policy and
GRANT/REVOKE in the migrations executes for real. It is **not**
Supabase — no GoTrue, no real `auth` schema, no PostgREST. A hand-built
`auth.uid()`/`auth.users` stand-in lets the migrations run unmodified,
but nothing here exercises Supabase's actual authentication platform
or its CLI's migration-tracking.

**Which checks were actually executed vs. still manual/blocked:**

| Check | Status |
|---|---|
| Migrations apply cleanly, in order, from empty | ✅ Executed (PGlite) |
| Migrations re-run safely (no silent corruption) | ✅ Executed (PGlite, scratchpad) |
| All RLS policies / privilege grants behave as documented | ✅ Executed (PGlite, 35 assertions) |
| Rank calculation matches `huntRank.ts` exactly, incl. boundaries | ✅ Executed (PGlite, 15 assertions) |
| `gear_count`/`weight_b_kg` structural validation (C1/C2 + Phase 1.3 fix) | ✅ Executed (PGlite) |
| `SECURITY DEFINER` functions run correctly with `search_path=''` | ✅ Executed (PGlite — they ran successfully, which requires correct schema-qualification) |
| Real Supabase Auth (GoTrue) behavior | ❌ Not executed — no project exists |
| Supabase CLI `db push` / migration-tracking | ❌ Not executed — no project exists |
| PostgREST-layer behavior (real HTTP requests through Supabase's REST API) | ❌ Not executed — no project exists |
| Behavior on Supabase's actual hosted Postgres configuration | ❌ Not executed — no project exists |

## Safe procedure for applying these migrations to a real, hosted project

1. **Never** run `supabase db push` or paste migrations into the SQL
   Editor against a project that already has real user data from an
   earlier, different schema — these migrations assume they're
   building these four tables from nothing. If a project already has
   other tables/data, review for naming collisions first.
2. Prefer a fresh project (or a disposable branch/preview project, if
   your Supabase plan supports branching) for the *first* real
   application of these migrations — don't let the first real-Postgres
   run of a stack this complex happen directly against production.
3. `supabase link --project-ref <ref>`, then `supabase db push`. Review
   its dry-run / diff output before confirming, if your CLI version
   offers one.
4. Run `supabase/tests/manual_rls_test_plan.sql` against that project
   next (SQL Editor or `psql`), before any application code is pointed
   at it. Expect every scenario to behave exactly as the PGlite run
   already demonstrated — if anything differs, that difference is
   itself informative (likely a real-auth-schema or real-Postgres-config
   detail PGlite couldn't surface) and should be understood before
   proceeding, not patched around.
5. Only after that passes: hand the project URL + anon key to whoever
   starts Phase 2.

## Tables

### `profiles`
One row per `auth.users` row, auto-created by a trigger on signup
(`handle_new_auth_user`). Holds `display_name` (client-editable) and
`total_xp`/`level` (present now, **unused** until Phase 4 cloud sync
starts writing them — see "What's deliberately inert" below). Does
**not** mirror the full local `User` model
(`src/models/User.ts`) — `unitPreference`, `activeCampaignId`, etc. have
no cross-device value and stay local-only forever, by design, not by
oversight.

### `content_workouts` / `content_hunts`
A small, read-only mirror of the facts leaderboard validation needs from
`content/workouts/workout.json` and `content/monsters/*.json` — **not**
a copy of the game's content system. 26 workouts, 76 hunts, every id and
number pulled directly from the real game content at the time this
migration was written (not placeholder data). `content_workouts` carries
`target_time_seconds` (for rank calculation) and `min_elapsed_seconds` /
`min_weight_kg` / `max_weight_kg` (plausibility bounds for leaderboard
eligibility — see "Validation rules"). `content_hunts` carries
`monster_id`, `workout_id`, `encounter_order` per hunt.

If game content changes in a future app release, re-extract and ship a
new migration with updated `ON CONFLICT ... DO UPDATE` rows — don't hand
-edit this table's data in the Dashboard, so the history of what
reference data was in effect when stays in version control.

### `workout_results`
The cloud counterpart of the local `WorkoutResult` row. One row per
completed hunt (canonical or custom), **immutable after insert** — no
UPDATE policy exists for any role but the migration owner, and no DELETE
policy exists at all in this phase. `user_id`, `monster_id`,
`completed_at`, and `rank` are never trusted from the client — a
`BEFORE INSERT` trigger (`workout_results_before_insert`) forcibly
overwrites all four from server-side truth before Row Level Security's
`WITH CHECK` is even evaluated:
- `user_id` ← `auth.uid()` (the actual authenticated caller, always)
- `completed_at` ← `now()`
- `monster_id` ← looked up from `content_hunts` via the submitted
  `hunt_id` (never accepted as client input)
- `workout_id` is **validated** against `hunt_id`'s real workout (an
  insert with a mismatched pair is rejected outright, not silently
  corrected)
- `rank` ← computed server-side, mirroring `src/utils/huntRank.ts`'s
  `getHuntRank()` exactly: `S` on a personal record (strictly faster
  than this user's prior best for this `workout_id` — a first-ever
  attempt is never a PR, same rule as the local app) or ≤85% of
  `target_time_seconds`; `A` ≤100%; `B` ≤115%; else `C`.

### `leaderboard_entries`
One row per `(user_id, workout_id)` — the player's personal best on that
canonical workout. **The only way a row gets here is the
`sync_leaderboard_entry` trigger**, which fires after every
`workout_results` insert. No `INSERT`/`UPDATE`/`DELETE` policy exists
for `authenticated` at all — not restricted, genuinely absent. A result
is promoted (or an existing entry updated, only if strictly faster) when
`is_custom_hunt = false` and the elapsed time/weight fall within
`content_workouts`' plausibility bounds; otherwise the `workout_results`
row is saved (it's real history) but never reaches the leaderboard.

## Relationships

```
auth.users ──1:1── profiles
auth.users ──1:N── workout_results ──N:1── content_workouts ──1:N── content_hunts
                 └─ (hunt_id FK)──────────────────────────────────────┘
workout_results ──trigger──> leaderboard_entries (1 row per user+workout, best time only)
```

## RLS summary

| Table | INSERT | SELECT | UPDATE | DELETE |
|---|---|---|---|---|
| `profiles` | trigger only (not a client policy) | any authenticated user, all rows (no sensitive columns live here) | own row; `total_xp`/`level` column-locked regardless (see below) | never |
| `content_workouts`, `content_hunts` | never (migrations only) | any authenticated user | never | never |
| `workout_results` | own `user_id` (enforced twice — trigger + `WITH CHECK`) | own rows only | never | never |
| `leaderboard_entries` | never (trigger only) | any authenticated user | never | never |

`profiles.total_xp`/`level` get a second, independent lock beyond RLS:
`REVOKE UPDATE ... GRANT UPDATE (display_name)`, a Postgres column-level
privilege. Even if a future policy change accidentally widened the
UPDATE policy, a client still could not write those two columns — two
unrelated mechanisms would both have to be wrong at once.

## Validation rules (what's enforced where)

Revised after a dedicated security/correctness audit of this directory
(see "Security audit fixes" below) — this table reflects the **current**
rules, post-fix.

Two different enforcement styles are used deliberately, applied
consistently:
- **Reject** (raises an exception, no row is ever written) — for
  **structural contradictions**: a claim about *what was done* (which
  hunt, which workout, how many bells, whether a second bell even
  applies) that's self-contradictory or doesn't match content. This is
  invalid data, not merely suspicious performance.
- **Exclude** (the `workout_results` row is saved — it's the player's
  real history — but `sync_leaderboard_entry` never promotes it to
  `leaderboard_entries`) — for **performance plausibility**: is this
  time/weight realistic. An unusual-but-real performance is still
  legitimate history even when it shouldn't rank.

| Rule | Enforced by | Reject or exclude |
|---|---|---|
| `user_id` is the real authenticated caller | `workout_results_before_insert` trigger (forced) + RLS `WITH CHECK` (redundant, intentional) | n/a — forced, not merely checked |
| `completed_at` is server time | `workout_results_before_insert` trigger (forced) | n/a — forced |
| `monster_id` matches `hunt_id` | `workout_results_before_insert` trigger (derived, never accepted from client) | n/a — derived |
| `workout_id` matches `hunt_id` | `workout_results_before_insert` trigger | Reject |
| `hunt_id`/`workout_id` refer to real content | Foreign keys + an explicit check in the trigger for a clearer error | Reject |
| `rank` reflects real performance | `workout_results_before_insert` trigger (computed, overwrites client input) | n/a — forced |
| **Canonical (`is_custom_hunt=false`) results use the workout's own `gear_count`** | `workout_results_before_insert` trigger | **Reject** |
| **`gear_count=1` cannot carry a `weight_b_kg`** | `workout_results_before_insert` trigger | **Reject** |
| **`gear_count=2` requires a non-null `weight_b_kg`** (found in Phase 1.3 by actually executing this trigger — see `VALIDATION_REPORT.md`) | `workout_results_before_insert` trigger | **Reject** |
| Custom Hunts never reach the leaderboard | `sync_leaderboard_entry` trigger checks `is_custom_hunt` first | Exclude |
| Elapsed time is plausible | `sync_leaderboard_entry`, against `content_workouts.min_elapsed_seconds` (30% of `target_time_seconds`, floor 10s) | Exclude |
| `canonical_weight_kg` is plausible | `sync_leaderboard_entry`, against `content_workouts.min/max_weight_kg` ([0.5, 1.5] × `gearWeightKg`, same band `progressionEngine.ts` already clamps XP's weight bonus to) | Exclude |
| **`weight_b_kg` is plausible when `gear_count=2`** (previously unchecked entirely) | `sync_leaderboard_entry`, same range as above; `weight_b_kg` is now guaranteed non-null by the reject rule directly above, so the `is not null` check here is defense-in-depth, not the primary guard it was before Phase 1.3 | **Exclude** |
| **Absolute weight ceiling, both bells** | Table `CHECK` on `canonical_weight_kg` and `weight_b_kg` (`> 0 and <= 60`), matching the app's own existing Hunt Overview input validation | **Reject at the table level** (separate from and tighter than nothing, looser than the per-workout range above — it only catches wildly nonsense values like 500kg; it never constrains a legitimate submission, since the highest real `gearWeightKg` in current content is 20kg) |
| Only the fastest time per user+workout is kept | `ON CONFLICT (user_id, workout_id) DO UPDATE ... WHERE excluded.elapsed_seconds < leaderboard_entries.elapsed_seconds` | n/a |

**Three-valued-logic fix**: the eligibility computation in
`sync_leaderboard_entry` is wrapped in `coalesce(..., false)`. Before
this fix, a NULL anywhere in the boolean chain (e.g. an unexpectedly
NULL `weight_b_kg`) could make the whole expression evaluate to NULL
instead of `false` — and `if not v_eligible` on a NULL does **not**
trigger the exclusion branch in plpgsql, so a NULL-tainted check would
have silently fallen through as "eligible." The `coalesce` wrapper
forces any NULL result to fail closed (excluded), not fail open.

None of this is anti-cheat — stated explicitly in the Phase 0 doc and
true here: there is no verification a human actually performed the
reps. This catches fabricated/impossible submissions and keeps custom
and canonical results separated; it does not and cannot catch a human
lying plausibly. `is_custom_hunt` itself is taken at face value — a
client could claim `false` for a session that was actually structurally
modified, and the backend has no way to independently verify that
(it never receives exercise-level structure, only rounds/target-time).
This is a deliberate, accepted non-goal, not an oversight — distinct
from the `gear_count`/`weight_b_kg` gaps above, which were genuine,
cheap-to-fix omissions using data the schema already had.

## Security audit fixes (this revision)

A dedicated audit of everything in `supabase/` found two issues rated
critical enough to fix before this should ever be applied to a real
project, plus several lower-severity hardening items and two bugs in
the test file's own expected outcomes. All fixed in this revision:

- **C1 — `gear_count` mismatch on canonical claims.** A client could
  previously submit `is_custom_hunt=false` with any `gear_count` at
  all, even one that didn't match the workout's own canonical value.
  Fixed: rejected outright in `workout_results_before_insert`.
- **C2 — `weight_b_kg` had zero validation.** Unbounded, unchecked
  against content, and a `gear_count=1` result could carry a nonsense
  second-bell weight with nothing catching it. Fixed in two parts: the
  structural contradiction (`gear_count=1` with non-null `weight_b_kg`)
  is now rejected at insert; the plausibility question (is `weight_b_kg`
  a realistic value for this workout when `gear_count=2`) is now
  range-checked in `sync_leaderboard_entry`, NULL-safely (see
  "three-valued-logic fix" above).
- **`search_path` hardened** from `public` to `''` on all three
  `SECURITY DEFINER` functions (`handle_new_auth_user`,
  `workout_results_before_insert`, `sync_leaderboard_entry`). Every
  reference in all three was already fully schema-qualified, so this
  was not exploitable as written — this is defense-in-depth against a
  *future* accidental unqualified reference failing loudly instead of
  silently resolving elsewhere.
- **Absolute weight ceiling added** (60kg, both weight columns) as an
  outer sanity bound beneath the per-workout range check — see the
  table above.
- **Test file bugs fixed**: Scenario D's expected rank was arithmetically
  wrong (claimed `'C'` for a time that's actually inside the `'B'` band —
  the bug was in the test's own math, not the trigger). Scenarios H and
  I expected UPDATE/DELETE to silently affect zero rows; the actual
  Postgres behavior (no GRANT at all for that command on that table) is
  an immediate permission-denied error, checked before RLS row-matching
  ever applies — both scenarios now wrap the statements in
  exception-catching blocks and assert the correct failure mode.
- **New test scenarios L, M, N, O** added for PR-specific rank isolation,
  the `gear_count` mismatch reject, the `weight_b_kg` range exclude, and
  the `gear_count=1`-with-`weight_b_kg` reject — see
  `supabase/tests/manual_rls_test_plan.sql`.

**Phase 1.3 update: all of the above has since been executed** — against
real PostgreSQL 18 via PGlite, not a live Supabase project (see the
"Execution status" section at the top of this file and
`VALIDATION_REPORT.md` for the full, itemized results: 50/50 assertions
passed). That execution pass found one additional real bug beyond
everything listed above — a `gear_count=2` result with a NULL
`weight_b_kg` was being silently excluded from the leaderboard with no
error, rather than rejected — now fixed (see the `gear_count=2 requires
a non-null weight_b_kg` row in the table above) and covered by a new
test. What remains unexecuted is specifically the parts PGlite cannot
provide: real Supabase Auth (GoTrue), the hosted platform's own Postgres
configuration, and the CLI's `db push` migration-tracking flow — those
still need an actual Supabase project.

## Content versioning

Per the Phase 0 recommendation (avoid over-engineering): a single
`content_version` text column on `workout_results`, populated by the
client (Phase 4+) from whatever string the app build tags its content
bundle with — no separate `workout_version`/`encounter_version`/
`result_schema_version` concepts. A result is labeled with the version
it was earned under; nothing attempts automatic reconciliation against
later-changed workout definitions, matching how the local `WorkoutResult`
already snapshots `difficulty`/weight at completion time rather than
re-deriving from possibly-changed content.

## What's deliberately inert in this phase

- `profiles.total_xp`/`level`: columns exist, nothing writes to them.
  Phase 4 (cloud sync) is where these start getting updated, from the
  same aggregation logic `progressionEngine.ts` already uses locally.
- `workout_results.client_result_id`: reserved for Phase 4, where it'll
  carry the local `WorkoutResult.id` so sync can upsert idempotently.
  Unused and unconstrained now.
- Any player-initiated deletion of their own `workout_results` history:
  the Phase 0 doc floated this as a possible future addition; no DELETE
  policy was added in this phase. Explicit decision needed before adding
  one, not a gap to silently fill in later.

## Explicitly deferred — follow-up requirements for later phases

Raised by the security audit, intentionally **not** implemented now —
each needs the context/data a later phase actually provides:

- **Sync idempotency / retry deduplication.** `client_result_id` exists
  as a column (see above) but has no `UNIQUE` constraint and nothing
  checks it — a retried sync upload would currently create a duplicate
  history row, not a safe no-op. There's nothing to build against yet
  (Phase 1 has no sync writing to this table at all). **Phase 4
  requirement:** add `UNIQUE (user_id, client_result_id)` and switch the
  sync insert to `ON CONFLICT (user_id, client_result_id) DO NOTHING`
  before any retry logic ships.
- **Content history / versioning.** `content_workouts`/`content_hunts`
  hold exactly one row per id, upserted in place — there's no historical
  record of what a workout's `target_time_seconds` or weight bounds
  *used to be*. `content_version` is captured on `workout_results` but
  validated against nothing (deliberately — see "Content versioning"
  above) and nothing currently lets it reconstruct "what were the rules
  when this was earned." Fine today because only one content version has
  ever existed. **Requirement for whichever phase ships the first real
  content update:** decide whether old results need their stored `rank`
  values to stay frozen (they currently would, since `rank` is computed
  once and copied, never recomputed) or whether a versioned reference
  table is actually needed — don't let a content update silently change
  the rules old, already-ranked results were judged under.
- **Concurrent PR-rank coordination.** Two simultaneous submissions from
  the same user (two devices, or a retried request racing the original)
  can both read the same stale "prior best" in
  `workout_results_before_insert` and both get marked `rank='S'` when
  only one is genuinely first. This does **not** corrupt the leaderboard
  itself — `leaderboard_entries`' `ON CONFLICT ... WHERE` guard is
  transactionally safe regardless — it's a minor, narrow rank-*label*
  inaccuracy under a real race. Not worth a `SELECT ... FOR UPDATE` or
  advisory lock in Phase 1 (nothing concurrent can happen yet — there's
  no sync client). **Revisit once Phase 4's sync client can plausibly
  fire overlapping requests** (e.g. two devices syncing at once).

## Known content data gap (not fixed here, out of scope)

`content_workouts.target_time_seconds = 0` for `the-twisted` (Crooked,
The Abyss) — reflects the app's own content as of this migration;
`min_elapsed_seconds` falls back to its 10s floor so validation still
functions, but rank calculation for that one workout (`<= 0 * 0.85`)
will never produce `S`/`A`/`B` from time alone, only from PR. This is an
app content issue, not a backend bug — flagged for whoever next touches
`content/workouts/workout.json`, not silently patched with a guessed
value here.

## Authentication readiness (documented, not implemented)

No sign-in UI, OAuth, or session code exists anywhere in this app as of
Phase 2.0 — confirmed by inspection (no file under `src/` references
`auth`, `signIn`, `session`, or similar). The practical future flow,
grounded in what actually exists today:

- **Anonymous/local-only use** — the default and current-only mode.
  `LOCAL_USER_ID = 'local-hunter'` (`src/constants/localUser.ts`) is the
  single hardcoded local user every SQLite table keys on
  (`UserRepository`, `SettingsRepository`, etc. all take a `userId`
  parameter already — the plumbing for a *different* local id exists,
  just never varies today).
- **Explicit user choice to enable cloud features** — must be an opt-in
  action (a Settings screen entry point, not automatic), consistent with
  this phase's constraint that configuration presence alone must never
  silently start syncing anything.
- **Sign-in / sign-out** — via `supabase.auth.signInWithPassword` /
  `signOut` (or whichever provider is chosen) once `client.ts`'s `auth`
  block is revisited (see its own comment — `persistSession`/
  `autoRefreshToken`/`detectSessionInUrl` are all `false` today
  specifically because no session can exist yet).
- **Session restoration** — `supabase-js` handles this automatically
  once a storage adapter is configured; the open decision is *which*
  adapter (see "Session/token storage" below), not the restoration logic
  itself.
- **Token storage appropriate for Expo/React Native** — this project
  already depends on `@react-native-async-storage/async-storage`
  (used today only for the onboarding-seen flag,
  `src/utils/onboardingStorage.ts` — a non-sensitive UI flag, not a
  precedent for storing tokens). Current official Supabase guidance for
  Expo recommends `expo-secure-store` for the auth token storage
  adapter specifically because AsyncStorage is unencrypted on-device
  storage, and a Supabase session contains a refresh token, which is
  materially more sensitive than a UI flag. **Implemented in Phase
  2.4**: `expo-secure-store` is now installed and wired as `client.ts`'s
  native-platform `auth.storage` adapter (web deliberately left on
  supabase-js's own default, `localStorage`) — see
  `supabase/PHASE_2_4_AUTH_IMPLEMENTATION.md`. Never run on a real
  device/simulator (none available), so this is implemented and
  locally verified (compiles, bundles, unit-tested), not device-proven.
- **Authentication errors and expired sessions** — must surface as a
  non-fatal, retryable UI state (consistent with how `App.tsx` already
  handles SQLite bootstrap failure via `ErrorScreen`/`onRetry`, a pattern
  to reuse rather than invent a new one for this).
- **Local data ownership** — every existing local table's rows stay
  exactly where they are; signing in never retroactively "claims"
  existing local rows automatically (see guest→account migration
  decision, still open, in the Phase 2 checklist below).
- **Account switching** — undefined today because only one local user
  exists. Needs an explicit decision: does switching accounts show a
  *different* local history (per-account local data) or does local
  history stay global to the device regardless of which account is
  signed in? Not decided — flagged as a concrete open question, not an
  oversight.
- **Sign-out without accidental deletion of local workouts** — signing
  out must never run any `DELETE` against local SQLite tables. The
  repositories already have no such "delete all my data" method, so
  this is naturally satisfied today; stays a hard constraint on
  whatever sign-out code gets written later.
- **Account deletion and server-side cleanup** — `profiles` has
  `on delete cascade` from `auth.users`, and `workout_results`/
  `leaderboard_entries` both cascade from `auth.users` too (see their FK
  definitions) — deleting the `auth.users` row via Supabase Auth's
  account-deletion API cleans up every cloud row automatically. Local
  SQLite data is unaffected either way (different database entirely).
- **Recovery after reinstall/device loss** — only possible for whatever
  was actually synced to the cloud (nothing, today — Phase 1
  intentionally built the backend with no write path from the app yet).
  Until cloud sync (a later phase) exists, reinstalling the app means
  starting over locally, same as today, regardless of having an
  account.

## Future synchronization contract (documented, not implemented)

Grounded in the actual current schemas — local SQLite
(`src/services/db/schema.ts`, 15 migrations) and the Supabase tables
(`supabase/migrations/`):

| Local data | Could eventually sync? | Owning cloud table | Stays device-local forever |
|---|---|---|---|
| `workout_result` (canonical hunts) | Yes | `workout_results` (already shaped for this — see column-by-column mapping below) | — |
| `custom_workout_result` | Partially — only if `is_custom_hunt`-style exclusion is extended to cover genuinely custom workouts too (today `workout_results` has no FK target for a workout that isn't in `content_workouts`) | None yet — **schema gap**, see below | — |
| `timer_result`, `stopwatch_result` | No — no monster/workout/rank concept applies; nothing to leaderboard | — | Yes |
| `user` (display name, unit preference, active campaign) | `display_name` only, into `profiles.display_name` | `profiles` | `unit_preference`, `active_campaign_id` — no cross-device value |
| `custom_hunt_preset`, `custom_workout`, `timer_preset`, `equipment`, `settings`, `chronicle` | No — device/player preference or a locally-recomputable aggregate | — | Yes |

**Column-by-column mapping, `workout_result` → `workout_results`** (the
one table genuinely ready today):

| Local (`workout_result`) | Cloud (`workout_results`) | Notes |
|---|---|---|
| `id` | `client_result_id` (not `id`) | Cloud `id` is server-generated (`gen_random_uuid()`); the local id becomes the idempotency key — see "duplicate request prevention" below, which is why this column exists but is currently unused/unconstrained (documented in Phase 1.3's "Explicitly deferred" section above). |
| `user_id` | ignored — overwritten from `auth.uid()` | Local `'local-hunter'` has no cloud meaning; the signed-in user is whoever is actually authenticated. |
| `workout_id`, `monster_id`, `hunt_id` | same names | `monster_id` is still re-derived server-side from `hunt_id` regardless of what's sent — see `workout_results_before_insert()`. |
| `weight_value_a`, `weight_value_b` | `canonical_weight_kg`, `weight_b_kg` | Local stores unit-agnostic values + a separate `weight_unit`; the sync layer must convert to kg before sending (cloud has no unit column — kg only, matching `content_workouts.gear_weight_kg`'s own unit). |
| (derived from `weight_value_a`/`weight_value_b` being set) | `gear_count` | Local has no explicit `gear_count` column on `workout_result` — it's implied by whether `weight_value_b` is null. The sync layer must compute this explicitly rather than guessing from nullability alone, since a genuinely single-bell result could theoretically have historical data with a stray non-null value — **schema gap**, see below. |
| `time_minutes` + `time_seconds` | `elapsed_seconds` | Straightforward conversion. |
| — (not derived, client never sends rank) | `rank` | Server-computed either way; the local `rank` isn't even stored today (`huntRank.ts` computes it on the fly from `time_minutes`/`time_seconds`) — nothing to send regardless. |
| `is_custom_hunt` | `is_custom_hunt` | Direct. |
| `app_version` | `app_version` | Direct. |
| — | `content_version` | No local equivalent exists yet — would need a new local column recording which content build produced this result, or a global "current content version" constant at sync time (less accurate for old rows synced late). Undecided. |
| `completed_at` | ignored — overwritten from `now()` at insert | A result synced late gets the sync time, not the original completion time, **unless** a column is added to pass `completed_at` through explicitly — currently the trigger always uses `now()`. **Schema gap**, see below. |

**How authenticated users are associated with their data:** `auth.uid()`
only, forced server-side on every insert — never client-supplied. This
is already fully implemented and verified (Phase 1.3).

**How ownership is enforced by RLS:** `workout_results_select_own` /
`workout_results_insert_own` (`user_id = auth.uid()`), already
implemented and verified.

**How updates/deletions propagate:** they don't, today — Phase 1 made
`workout_results` immutable after insert (no UPDATE/DELETE grant at
all). A sync layer therefore only ever needs to INSERT, never
reconcile a later edit — simpler than a typical sync design, and
deliberate (see that table's own migration comment).

**Retries and network failures:** undesigned. The natural approach
(standard offline-sync pattern): a local-only `synced_at` or
`sync_status` column on `workout_result`, set on confirmed success;
the sync layer retries anything still unsynced on next connectivity,
with exponential backoff. **Not implemented** — no such column exists
locally today.

**Duplicate-request prevention:** the schema gap flagged throughout
Phase 1.3's "Explicitly deferred" section — `workout_results` has no
uniqueness constraint on `client_result_id`, so a naive retry-after-
timeout would currently insert a second row. **Required before any
real sync write path ships:** a migration adding
`unique (user_id, client_result_id)` plus switching the sync insert to
`on conflict (user_id, client_result_id) do nothing`.

**Conflict detection/resolution:** none needed for `workout_results`
(immutable, append-only — there is no "later edit" to conflict with).
`profiles.display_name` is the one genuinely editable field; last-write-
wins (`updated_at` already bumped by `set_updated_at()`) is adequate for
a single freeform text field with no real concurrent-edit scenario.

**Account switching:** undesigned — see "Account switching" under
Authentication readiness above; this is the same open question from the
other direction (what happens to *locally stored* data, not cloud).

**Data created offline:** works today by construction — nothing
requires a network connection to complete a hunt (`completeHunt()` only
touches local SQLite). A sync layer would upload whatever's unsynced
whenever connectivity + auth are both available; no special "offline
mode" is needed because the app has no other mode.

**Schema versioning:** `content_version` (text, free-form) exists on
`workout_results` already; nothing currently validates or interprets it
(deliberate — see Phase 1.3's README section on this). No equivalent
exists on the local `workout_result` table yet — would need adding if
`content_version` is ever actually populated from a real sync client.

**Identified schema gaps, smallest viable migrations (not applied — for
whichever phase first needs them):**
1. `workout_result.gear_count` (local) — add as a plain `INTEGER NOT
   NULL DEFAULT 2` column (additive, same shape as every migration in
   `schema.ts`) so sync has an explicit value instead of inferring it
   from `weight_value_b`'s nullability.
2. `workout_results.completed_at` (cloud) accepting a client-supplied,
   server-validated value for late-synced results — if backdating is
   wanted at all; otherwise document that a late sync always timestamps
   as "now," which may be the simpler, acceptable choice.
3. `workout_results` unique constraint on `(user_id, client_result_id)`
   — required before any retry-safe sync write path, per Phase 1.3.

None of these are applied in this phase — listed here because Section 7
of this phase's task asked for the exact gap and the smallest fix, not
because any of them are needed yet (nothing currently writes to this
table from the app).

## Security review (Phase 2.0 — re-confirmed, not re-litigated)

Re-inspected the current RLS policies, grants, `SECURITY DEFINER`
functions, `search_path` settings, and trigger logic directly against
the live SQL files (not from memory of prior phases). Specifically
checked whether any policy or function trusts a client-supplied id
where it should trust `auth.uid()` instead:

- `workout_results_before_insert()`: `new.user_id := auth.uid()`,
  unconditionally, before any other logic runs. A client-supplied
  `user_id` value is completely discarded. Confirmed correct — no
  client-id-trusted path exists.
- `profiles_update_own` policy: `using (auth.uid() = id) with check
  (auth.uid() = id)` — compares the row's own (immutable, server-
  assigned-at-signup) primary key against `auth.uid()`, never a
  client-supplied value standing in for identity. Confirmed correct.
- `sync_leaderboard_entry()`: reads `new.user_id` — but `new` here is
  the already-trigger-forced row from `workout_results_before_insert`
  (which fires `BEFORE INSERT`, ahead of this `AFTER INSERT` trigger),
  so by the time this function runs, `user_id` has already been
  replaced with the real `auth.uid()`. No independent client-trust gap.
- No function or policy anywhere in the four migrations reads a
  client-supplied id column and treats it as authoritative for access
  control. (`leaderboard_entries.user_id` is likewise always copied
  from the already-forced `workout_results.user_id`, never accepted
  directly — there is no INSERT grant on that table for `authenticated`
  at all regardless.)

**No new defect found this phase.** Every fix from the Phase 1
security audit and the Phase 1.3 PGlite-execution-found defect
(`gear_count=2` + NULL `weight_b_kg`) was re-confirmed present and
correct in the current SQL, not just assumed still-true from memory.
Existing policies were not modified — per this phase's own instruction
not to touch policies that already pass the existing suite without a
concrete finding. The full 35+15 PGlite assertion suite was re-run this
phase (see below) specifically to confirm nothing regressed.

**What this review could NOT verify** (depends on real Supabase Auth,
PostgREST, or hosted-project grants that PGlite cannot faithfully
reproduce): whether Supabase's actual PostgREST layer exposes anything
beyond what these table-level grants intend (e.g. schema introspection
endpoints), and whether a real hosted project's default roles/grants
differ from this hand-built `auth` stand-in in any way that would
change these conclusions. Flagged as a manual verification step for the
real hosted-project test pass (see "Safe procedure" above).

## Phase 2 readiness checklist (status as of Phase 2.2 — see dates below)

This checklist was written in Phase 1.3, before application-side work
began. Phases 2.0–2.2 have since implemented real portions of it —
updated in place below rather than left stale; see
`PHASE_2_2_IMPLEMENTATION.md` for full detail on what changed.

- [ ] **Still open.** A real Supabase project exists, migrations
      applied via the "Safe procedure" above, and
      `manual_rls_test_plan.sql` has been run against it directly (not
      just PGlite). Nothing in Phases 2.0–2.2 changes this — it remains
      the single hard blocker before any of the code below can be
      exercised against a real backend.
- [x] **Decided (Phase 2.1), implemented (Phase 2.2).** Guest→account
      migration UX: explicit, user-initiated, one-time import —
      never automatic on sign-in. See
      `PHASE_2_1_AUTH_ARCHITECTURE.md` §11 for the decision and
      `PHASE_2_2_IMPLEMENTATION.md` for what's actually wired up (the
      import operation itself is still not implemented — only the
      decision and the sign-in/out flow that must never trigger it
      automatically).
- [x] **Decided (Phase 2.1), partially implemented (Phase 2.2).**
      Session-handling: `persistSession`/`autoRefreshToken` are
      deliberately `false` until a real sign-in call needs a session to
      persist (see `src/services/supabase/client.ts`); the storage-
      adapter choice (`expo-secure-store`, not `AsyncStorage`) is
      decided and documented but not yet wired in — still correct to
      defer, no session exists to persist yet without a real project.
- [x] **Done (Phase 2.0).** `@supabase/supabase-js` added to
      `package.json`. Confirmed in Phase 2.0 that none of this
      project's pre-existing `npm audit` findings are attributable to
      it; RN/Hermes-native runtime behavior (not just web) still
      unverified — no device/simulator available in this environment
      (re-confirmed Phase 2.2).
- [ ] **Still open.** The exact Phase 4 (cloud sync) trigger condition.
      Phase 2.2 built a read-only leaderboard and the auth flow, but no
      write/sync path exists yet — this decision isn't needed until one
      does.
- [ ] **Still open, re-confirmed non-blocking (Phase 2.2).** The three
      deferred risks (sync idempotency, content versioning, concurrent
      PR-rank) — none have a triggering code path yet; Phase 2.2 added
      no sync writer, so this is unchanged.
- [x] **Partially done (Phase 2.2).** Leaderboard UI: a read-only,
      per-workout leaderboard screen now exists (reachable from Hunt
      Complete for a canonical result), covering loading/empty/error/
      auth-required states. Not designed or built: ties display beyond
      natural sort order, pagination beyond a fixed 50-row cap, or any
      opt-out mechanism — none were needed yet given the verified
      schema and zero real users.

## Regenerating the content reference data

The `content_workouts`/`content_hunts` seed rows in
`20250615120100_content_reference.sql` were generated by reading
`content/workouts/workout.json` and `content/monsters/*.json` directly
and computing `min_elapsed_seconds`/`min_weight_kg`/`max_weight_kg` from
each workout's own `targetTimeSeconds`/`gearWeightKg`. There is no
standing script for this in the repo (it was a one-off extraction) — if
content changes enough to warrant updating the reference table, write a
short script that reads those same two content sources and emits
`INSERT ... ON CONFLICT DO UPDATE` statements in the same shape, as a
new dated migration file.
