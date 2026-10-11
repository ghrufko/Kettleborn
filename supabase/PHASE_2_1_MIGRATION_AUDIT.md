# Phase 2.1 — Migration Readiness Audit

Scope: a full re-read of all four existing migrations, in order, verified
directly against the current `.sql` files (not recalled from prior
reports). No migration was modified as part of producing this audit.

**Verification-level key**, used throughout this document — these are
not interchangeable:
- **Static** — confirmed by reading the SQL text only.
- **PGlite** — confirmed by actually executing the SQL against a real
  embedded PostgreSQL instance (`supabase/tests/pglite/`), re-run this
  phase: `node run_suite.mjs` → 35/35, `node run_edge.mjs` → 15/15,
  both exit 0.
- **Hosted** — would require a real Supabase project. **Not performed
  — no project exists in this environment** (see
  `PHASE_2_1_READINESS_REPORT.md` Section "Infrastructure").

## Migration inventory, in dependency order

### 1. `20250615120000_profiles.sql`

- **Purpose:** one `profiles` row per `auth.users` row; holds
  `display_name` (client-editable) and `total_xp`/`level` (present,
  unused until a future cloud-sync phase).
- **Objects created:** table `profiles`; functions
  `handle_new_auth_user()` (SECURITY DEFINER), `set_updated_at()`;
  triggers `on_auth_user_created` (on `auth.users`),
  `profiles_set_updated_at` (on `profiles`); policies
  `profiles_select_all_authenticated`, `profiles_update_own`.
- **Constraints/grants:** `id` FK → `auth.users(id) on delete cascade`;
  `revoke update ... from authenticated` then `grant update
  (display_name)` — column-level lockdown independent of RLS;
  `grant select` to `authenticated` only (no `anon` grant anywhere in
  this file — confirmed by grep across all four migrations, zero `anon`
  matches).
- **Fresh-database safety:** Static — `create table`/`create function`
  with no `if not exists`/`or replace` guards; this is intentional for a
  first-ever apply (see "re-run safety" below), safe on an empty
  database.
- **Re-run safety:** Static + PGlite (confirmed in Phase 1.3) — re-
  applying against an already-migrated database fails cleanly with
  `relation "profiles" already exists`, no silent corruption or
  duplication. **Not idempotent by design** — correct behavior is to
  fail loudly if mistakenly re-run outside the Supabase CLI's own
  migration-tracking, which is what actually prevents re-application in
  real use.
- **Destructive operations:** none. No `drop`, no data-deleting
  statement.
- **Depends on:** `auth.users` (Supabase platform table, not created by
  this repo's migrations — see "hand-built `auth` stand-in" note under
  Known Risks).
- **Security-sensitive behavior:** `handle_new_auth_user()` and
  `set_updated_at()` are the first two `SECURITY DEFINER`/trigger
  functions in this schema; `search_path = ''` on
  `handle_new_auth_user()` (hardened in Phase 1's security audit —
  re-confirmed present in the current file, not re-applied).
  `set_updated_at()` has no `search_path` setting at all — reviewed
  this phase: it contains zero schema-qualified or unqualified object
  references (`new.updated_at = now()` only touches the row already in
  scope and calls the built-in `now()`), so there is nothing for an
  unexpected `search_path` to redirect. Confirmed not a gap.
- **Tests covering it:** Scenario Q (`run_suite.mjs`) — column-level
  lockdown (`total_xp` write rejected, `display_name` write succeeds,
  cross-user update matches zero rows). The initial fixture-profile
  creation (triggered by inserting into `auth.users` in
  `setup_fresh.mjs`) implicitly exercises `handle_new_auth_user()` on
  every single test run across both suites.

### 2. `20250615120100_content_reference.sql`

- **Purpose:** read-only mirror of `content/workouts/workout.json` +
  `content/monsters/*.json` facts needed to validate leaderboard
  submissions server-side, without trusting the client. 26
  `content_workouts` rows, 76 `content_hunts` rows (counts re-confirmed
  this phase via `apply_migrations.mjs`'s own output, not assumed).
- **Objects created:** tables `content_workouts`, `content_hunts`;
  policies `content_workouts_select_all`, `content_hunts_select_all`.
- **Constraints/grants:** `content_hunts.workout_id` FK →
  `content_workouts(workout_id)`; `grant select` only, to
  `authenticated` only — **no `insert`/`update`/`delete` grant to any
  non-owner role exists in this file**, confirmed by reading the full
  file; these tables can only ever be written by whichever role applies
  the migration.
- **Fresh-database safety:** Static — safe; depends only on
  `content_workouts` existing before `content_hunts` (correct order,
  single file, no cross-file ordering risk).
- **Re-run safety:** Static — the `create table` statements are not
  idempotent (same "fails loudly" behavior as migration 1) but the
  `insert` statements use no `on conflict` clause **in this file**
  (verified by reading — a plain `insert into ... values (...)`, no
  `on conflict`). This means a hypothetical future re-run of just the
  insert portion (e.g. hand-pasted into the SQL Editor without the
  `create table`) would raise a primary-key violation on `workout_id`/
  `hunt_id`, not silently duplicate rows — still fails loudly, same
  "safe to re-run" class as above, not a soft/silent risk. **Correction
  to a prior-phase README claim:** `supabase/README.md`'s "Regenerating
  the content reference data" section currently says a future content
  update should ship "`INSERT ... ON CONFLICT DO UPDATE` statements in
  the same shape" — that describes how a *future* regenerated migration
  should be written, not a property this existing file already has.
  Re-read confirms this migration itself has no `on conflict` clause.
  Not a defect (this file was never meant to be re-run — each content
  update should be its own new, additive migration, which is exactly
  what that README section recommends for next time), but worth stating
  precisely rather than implying this file is itself conflict-safe.
- **Destructive operations:** none.
- **Depends on:** nothing beyond the `public` schema existing.
- **Security-sensitive behavior:** none beyond standard read-only RLS —
  no `SECURITY DEFINER`, no trigger.
- **Tests covering it:** indirectly, every scenario that references a
  real `workout_id`/`hunt_id` (nearly all of A–R) — this table's data
  is what makes those lookups succeed or correctly fail (Scenarios F1/
  F2 specifically exercise the "doesn't exist" / "mismatched" paths
  against this data).

### 3. `20250615120200_workout_results.sql`

- **Purpose:** cloud leaderboard-eligible history, one row per
  completed hunt; immutable after insert; `user_id`/`monster_id`/
  `rank`/`completed_at` always server-forced.
- **Objects created:** table `workout_results`; function
  `workout_results_before_insert()` (SECURITY DEFINER); trigger
  `workout_results_before_insert` (before insert); policies
  `workout_results_insert_own`, `workout_results_select_own`.
- **Constraints/grants:** FKs to `auth.users`, `content_workouts`,
  `content_hunts`; `canonical_weight_kg`/`weight_b_kg` both `check (...
  > 0 and <= 60)`; `gear_count` `check (in (1,2))`; `elapsed_seconds`
  `check (> 0)`; `grant select, insert` only — **no update, no delete
  grant for `authenticated`**, confirmed by reading the full file (one
  `grant` statement total, line 212).
- **Fresh-database safety:** Static — depends on migrations 1 and 2
  already having run (`auth.users`, `content_workouts`,
  `content_hunts`); correct position in the apply order satisfies this.
- **Re-run safety:** same "fails loudly, no silent corruption" class as
  above — PGlite-confirmed in Phase 1.3 (re-apply attempt failed with
  `relation "workout_results" already exists`).
- **Destructive operations:** none.
- **Depends on:** migrations 1 and 2 (both FKs).
- **Security-sensitive behavior:** the most security-load-bearing file
  in the schema. Re-verified line-by-line this phase:
  - `new.user_id := auth.uid()` — unconditional, first statement in the
    trigger body, before any other logic. A client-supplied `user_id`
    is fully discarded regardless of what's submitted. **Confirmed: no
    client-supplied identity is ever trusted here.**
  - `new.completed_at := now()`, `new.monster_id := v_hunt.monster_id`
    (derived from `hunt_id`, never accepted from the client) — both
    forced before the `WITH CHECK` on the INSERT policy is even
    evaluated.
  - `workout_id`-vs-`hunt_id` mismatch, canonical `gear_count` mismatch,
    `gear_count=1`-with-`weight_b_kg`, and `gear_count=2`-without-
    `weight_b_kg` are all **rejected** (raise exception), not merely
    excluded — all four re-confirmed present in the current file and
    covered by Scenarios F, M, O, P respectively.
  - `rank` is computed server-side from `v_is_pr` (strictly faster than
    this user's own prior best for this `workout_id`) or the
    85%/100%/115% time thresholds — never accepted from the client
    (Scenario D confirms a submitted `rank='S'` is overwritten).
  - `search_path = ''` — present, confirmed in the current file.
- **Tests covering it:** A, C, D, F, I, L, M, O, P, R, plus Edge1–Edge9
  and the six rank-boundary assertions.

### 4. `20250615120300_leaderboard_entries.sql`

- **Purpose:** one row per `(user_id, workout_id)`, the player's
  personal best on that canonical workout; the only path in is the
  `sync_leaderboard_entry()` trigger.
- **Objects created:** table `leaderboard_entries`; function
  `sync_leaderboard_entry()` (SECURITY DEFINER); trigger
  `workout_results_sync_leaderboard` (after insert on
  `workout_results`); policy `leaderboard_entries_select_all`; two
  indexes.
- **Constraints/grants:** FKs to `auth.users`, `content_workouts`,
  `workout_results`; primary key `(user_id, workout_id)`; **`grant
  select` only — confirmed by reading the full file, there is no
  insert/update/delete grant to `authenticated` at all, not a
  restricted one, genuinely absent.**
- **Fresh-database safety:** Static — depends on migrations 2 and 3.
- **Re-run safety:** same "fails loudly" class, PGlite-confirmed.
- **Destructive operations:** none. (The `on conflict ... do update`
  inside `sync_leaderboard_entry()` only ever updates a row the
  function itself is managing, triggered by a new `workout_results`
  insert — not a standalone destructive statement.)
- **Depends on:** migrations 2 and 3.
- **Security-sensitive behavior:** `new.user_id`/`new.monster_id`/
  `new.rank` read here are already-forced values from the
  `BEFORE INSERT` trigger on `workout_results` (which fires before this
  `AFTER INSERT` trigger) — confirmed by trigger ordering, not an
  independent trust decision this function makes. Eligibility
  (`v_eligible`) is wrapped in `coalesce(..., false)` — any NULL in the
  chain fails closed (excluded), re-confirmed present. `search_path =
  ''` present.
- **Tests covering it:** A, B, E, J, K, N, P (indirectly, via the
  upstream reject).

## Cross-migration RLS / privilege surface (full table)

| Table | RLS enabled | RLS forced | SELECT | INSERT | UPDATE | DELETE | `anon` access |
|---|---|---|---|---|---|---|---|
| `profiles` | Yes | No | all authenticated rows | trigger only, no policy | own row; `display_name` only (column grant) | never | None |
| `content_workouts` | Yes | No | all authenticated rows | migrations only | never | never | None |
| `content_hunts` | Yes | No | all authenticated rows | migrations only | never | never | None |
| `workout_results` | Yes | No | own rows only | own `user_id` (policy + forced trigger) | never (no grant) | never (no grant) | None |
| `leaderboard_entries` | Yes | No | all authenticated rows | trigger only, no grant at all | never (no grant) | never (no grant) | None |

**RLS forced:** not set on any table. Reviewed whether this is a gap —
it is not, in this schema: `FORCE ROW LEVEL SECURITY` only matters when
the table owner (or a `BYPASSRLS` role) queries a table directly in a
context where RLS should still apply. Nothing in this schema's design
has the app connect as the owner/migration role; it always connects as
`authenticated` (or, pre-login, `anon`, which holds no grants on any of
these tables at all). Confirmed not exploitable as written.

**Anonymous (`anon`) access:** zero grants to `anon` exist anywhere
across all four migrations (verified by grep for `anon` across the
full `supabase/migrations/` directory — no matches). An unauthenticated
request has no access to any of these five tables at all. Scenario R
(`run_suite.mjs`) confirms this concretely for `workout_results`.

**Trusted-field write protection (XP/rank/progression):**
`profiles.total_xp`/`level` — column-level `REVOKE`, independent of
RLS (Scenario Q1/Q2). `workout_results.user_id`/`monster_id`/`rank`/
`completed_at` — forced by trigger before any policy check runs
(Scenarios A, C, D). `leaderboard_entries` — no write grant exists for
`authenticated` at all (Scenario G, H). No client-writable path to any
of these fields exists anywhere in the schema.

## Known risks (documented, not fixed — no concrete defect found this phase)

- **The hand-built `auth` stand-in used by the PGlite harness
  (`supabase/tests/pglite/auth_stub.sql`) is not real Supabase Auth.**
  Every "verified" claim above that depends on `auth.uid()` or
  `auth.users` is verified against that stand-in, not GoTrue. This is
  already documented in `supabase/tests/pglite/README.md` and
  `VALIDATION_REPORT.md` — repeated here because it is the single
  biggest caveat on this entire audit's security conclusions.
- **No test exercises the PostgREST layer.** Everything above is
  SQL/RLS-level; nothing confirms how Supabase's actual REST API
  surface (header-based auth, PostgREST's own role-switching, schema
  introspection endpoints) behaves on top of these same grants.
- **No migration file uses `if not exists` / idempotent guards.** This
  is reviewed above as "fails loudly, not silently" (acceptable), but
  it does mean these files cannot be safely re-run outside the Supabase
  CLI's own migration-tracking (`supabase_migrations.schema_migrations`
  on a real project) — re-running by hand (e.g. re-pasting into the SQL
  Editor) will error, which is the correct failure mode, but anyone
  doing it needs to know to expect that rather than debug it as a
  surprise.
- **Deferred items from Phase 1.3, re-confirmed still unimplemented,
  still not launch-blocking:** `client_result_id` has no uniqueness
  constraint (sync idempotency); `content_version` is recorded but not
  enforced; no advisory lock against a concurrent same-user PR-rank
  race. All three still have zero current code path that would trigger
  them (no sync writer exists yet) — re-confirmed true this phase, not
  re-asserted from memory.

## Test coverage added this phase

None — the existing 35 (`run_suite.mjs`) + 15 (`run_edge.mjs`) PGlite
assertions already cover every scenario this audit's re-reading
surfaced. No genuinely uncovered risk was identified that would justify
a new test without duplicating existing coverage (the task's own
instruction: avoid duplicating tests without a clear reason). Both
suites were re-run this phase to confirm the audit's conclusions match
actual behavior, not just the SQL text: **35/35 and 15/15, exit 0**
(see `PHASE_2_1_READINESS_REPORT.md` for the literal command output).
