# Phase 2.5.1 — Idempotent Workout Results & Sync Readiness

New, focused migration + tests. Does not implement sync, account
linking, conflict resolution, or data migration — design and
database-guarantee work only.

## 1. Schema and code behavior discovered (before any change)

- `workout_results.client_result_id` already existed (added in the
  original `20250615120200_workout_results.sql`) — `text`, nullable,
  no default, **no uniqueness guarantee, no index**. Confirmed by
  re-reading that migration file directly this phase, not from memory.
- **Nothing currently populates it.** No app code writes to
  `workout_results` at all yet (no sync writer exists) — confirmed
  live: `select count(*) from public.workout_results` against the real
  `kettleborn-dev` project returned **0 rows**.
- The *local* SQLite id this column is intended to eventually carry
  (`src/models/WorkoutResult.ts`'s `id`) is generated in
  `src/store/workoutSlice.ts`'s `completeHunt()` as:
  `` id: `${workoutId}-${Date.now()}` `` — **a millisecond timestamp
  concatenated with the workout id, not a cryptographically random
  UUID.** This is the single most important fact driving the migration
  design below: it means two different users' devices could, in
  principle, generate the identical string.
- Ownership (`user_id`) is always server-forced from `auth.uid()` by
  `workout_results_before_insert()` — unchanged, re-confirmed by
  re-reading that trigger, not assumed.
- RLS/grants/triggers: re-confirmed unchanged and correct (own-rows-
  only SELECT/INSERT, no UPDATE/DELETE grant at all, immutable) — no
  existing fixture, test, or app code assumes or relies on duplicate or
  null `client_result_id` values.

## 2. Was a new migration necessary?

**Yes.** The uniqueness guarantee was genuinely absent — not merely
undocumented. Added:

**`supabase/migrations/20261010120000_workout_results_client_id_uniqueness.sql`**
```sql
alter table public.workout_results
  add constraint workout_results_user_client_result_id_key
  unique (user_id, client_result_id);
```

**Scope decision — per-user, not global — and why:** because the local
id format above is not cryptographically unique, a **global** `unique
(client_result_id)` constraint would let one user's legitimate result
collide with and block a different, unrelated user's equally
legitimate result the moment two devices happened to complete the same
workout in the same millisecond. Scoping to `(user_id,
client_result_id)` eliminates that cross-user collision risk entirely,
while still giving exactly the per-user retry-dedup guarantee a sync
writer needs. `user_id` is trustworthy for this because it's always
server-forced, never client-asserted.

**NULL handling:** a plain composite `unique` constraint already treats
`NULL` as distinct from every other `NULL` under standard Postgres
semantics — every current and future non-synced result (nothing
populates this column yet) is completely unaffected. No partial index
or extra `where` clause was needed; confirmed empirically (see
Section 4), not just asserted.

**Existing-data safety:** the real table has 0 rows (Section 1), so
there is no existing duplicate or null to remediate and no data risk
from applying this migration. **Not applied** — this phase prepares
and validates it only, per the task's explicit scope limit.

**Nothing else touched:** no RLS policy, grant, trigger, or prior
migration file was edited. This is a new, additive, forward-only file.

## 3. Files changed and why

- **New:** `supabase/migrations/20261010120000_workout_results_client_id_uniqueness.sql`
  — the constraint itself.
- **New:** `supabase/tests/pglite/run_sync_readiness_checks.mjs` — 6
  targeted assertions (below).
- **New:** this file.
- **Not changed:** any existing migration, any application file, any
  dependency.

## 4. Tests run and exact results

All against **real PostgreSQL via PGlite** (confirmed version 18.3) —
not a mock, not a live hosted-database test (the real project was only
queried read-only, via `supabase db query`, to confirm the 0-row
baseline and the dry-run below; no test data was ever written there).

| Check | Result |
|---|---|
| `node apply_migrations.mjs` (all 6 migrations, fresh instance) | **PASS** — applies cleanly, exit 0 |
| `node run_suite.mjs` (pre-existing, re-run for regression) | **PASS** — 35/35, exit 0 |
| `node run_edge.mjs` (pre-existing) | **PASS** — 15/15, exit 0 |
| `node run_hardening_checks.mjs` (pre-existing) | **PASS** — 7/7, exit 0 |
| `node run_sync_readiness_checks.mjs` (**new**) | **PASS** — 6/6, exit 0 |
| `supabase db push --dry-run` (real project, read-only) | **PASS** — lists exactly the one new migration, exit 0. **Not applied.** |
| `npm test` (app-side) | **PASS** — 69/69, exit 0 |
| `npx tsc --noEmit` | **PASS** — exit 0 (see correction below) |
| `npx expo export --platform web` | **PASS** — exit 0 |

The 6 new assertions specifically prove (not just assert) this
migration's own design claims: a result inserts normally; retrying the
exact same `(user, client_result_id)` is rejected with `23505`
(`unique_violation`) — a real database rejection, not a client-side
convention; a different `client_result_id` for the same user still
succeeds; **the same `client_result_id` string for two different users
both succeed** (the specific cross-user collision scenario the scoping
decision exists to prevent); two `NULL` rows for the same user both
succeed; the pre-existing leaderboard trigger still fires correctly
for a row that carries a `client_result_id`.

**Self-correcting a verification mistake from this session's prior
turn:** `tsc --noEmit`'s exit code had been checked by piping its
output through `tail` and then reading `$?` — which reports `tail`'s
exit code, not `tsc`'s. Running it without that mask this phase
revealed a real, previously-unreported failure (TS5097, from a test
file added last turn using a static `import` with an explicit `.ts`
extension — fine for Node's test runner, not for `tsc`). Fixed by
switching that one import to the same dynamic-`import()`-with-`URL`
pattern every other test file already uses. Re-verified with an
unmasked exit-code check: genuinely `0`. Disclosed here rather than
silently corrected, since it means a prior report's "exit 0" claim for
`tsc` was wrong at the time it was made.

## 5. Existing-data risks or unresolved questions

- **None found** — the table is empty, so this specific migration has
  zero remediation burden. This will not remain true forever; the note
  below is for whenever it isn't.
- **Still unresolved, unchanged from every prior phase's documentation:**
  no local SQLite column exists yet to track "has this result been
  synced" — needed before any real sync writer can know what to
  upload. No sync writer exists. No guest-progress import UI exists.
  None of these were in this phase's scope.

## 6. Exact manual deployment step (not performed)

```
supabase db push
```
Same safe, already-proven path as every prior migration in this
project — applies only the one new, additive constraint. Requires your
explicit approval first, per this phase's instruction not to deploy.

## 7. Sync-readiness summary

- **Uniqueness guarantee now present (pending deployment):** `unique
  (user_id, client_result_id)` on `workout_results`.
- **Expected behavior for a duplicate submission, once deployed and
  once a sync writer exists:** a client sends `insert ... on conflict
  (user_id, client_result_id) do nothing` (not implemented yet); the
  database silently no-ops the retry rather than erroring or
  duplicating. Without the `on conflict` clause, a plain retried insert
  would receive a `23505` error instead — either is safe, the upsert
  form is simply friendlier for a retry loop.
- **How a future sync should distinguish a retry from a genuinely new
  workout:** by `client_result_id` alone, scoped to the signed-in
  user — the exact value already stored as that result's local SQLite
  `id`. No new identifier needs inventing.
- **What remains necessary before guest-progress sync can be safely
  implemented** (re-confirmed open, not newly discovered): deploying
  this migration; a local "synced" tracking column; the actual upload
  code, going through the same `workout_results_before_insert` trigger
  every other insert does; the explicit, user-initiated import UI
  decision already made in `PHASE_2_1_AUTH_ARCHITECTURE.md` (never
  automatic on sign-in).
- **Verified by automated tests (PGlite, real Postgres):** every claim
  in Section 4's table above.
- **Still requires a real hosted database or device:** applying this
  migration to the actual `kettleborn-dev` project (prepared, not
  done); everything about real sync behavior under real concurrent/
  retried requests, which cannot exist until a sync writer is built.
