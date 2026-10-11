# PGlite execution harness

Runs the real migrations in `supabase/migrations/` against an actual
embedded PostgreSQL instance ([PGlite](https://pglite.dev/), WASM
build, confirmed Postgres 18.3), without Docker and without a hosted
Supabase project.

**This is not a Supabase integration test.** PGlite is genuine
PostgreSQL, so table/column/CHECK constraints, triggers, functions,
RLS policies and GRANT/REVOKE privileges all execute exactly as they
would on a real server. What it does **not** provide is Supabase's
platform layer: there is no GoTrue, no real `auth` schema, no JWT
issuance, no PostgREST, no Storage, no Realtime. `auth_stub.sql` is a
minimal hand-built stand-in — just an `auth.users` table and an
`auth.uid()` function that reads the `request.jwt.claims` GUC — good
enough for every RLS policy and trigger in these migrations to run for
real, but it does not prove anything about how Supabase's actual
GoTrue-issued JWTs, session refresh, or PostgREST request path behave.

## Setup

```sh
cd supabase/tests/pglite
npm install
```

This installs only `@electric-sql/pglite` into this subfolder — it
does not touch the project's root `package.json`/`package-lock.json`
or `node_modules`.

## Running

```sh
npm run apply       # apply_migrations.mjs  — migrations apply cleanly, in order, from empty
npm test             # run_suite.mjs         — scenarios A-R (security/validation/leaderboard behavior)
npm run test:edge   # run_edge.mjs          — weight/time boundary values + exact rank cutoffs
```

Each script prints `[PASS]`/`[FAIL]` per assertion and exits non-zero
if any assertion failed. Every scenario runs inside `begin; ... 
rollback;` (or a `savepoint`, for an assertion expected to throw) —
nothing persists between runs or between scenarios in the same run.

## Files

- `auth_stub.sql` — the `auth` schema/`auth.uid()` stand-in described above.
- `apply_migrations.mjs` — applies the stub + all real migrations once, prints the resulting table list and seed-row counts.
- `setup_fresh.mjs` — shared helpers (`freshDb()`, `HUNTER_A`/`HUNTER_B` fixture UUIDs, `asUser()`/`asSuperuser()` role-switching).
- `run_suite.mjs` — scenarios A–R. A–O mirror `../manual_rls_test_plan.sql`; P, Q, R were found or added during Phase 1.3 PGlite execution and are not yet mirrored in that manual file (see its own header comment).
- `run_edge.mjs` — weight-ceiling/zero/negative-value checks plus the six independently-derived rank-boundary values (918/919/1080/1081/1242/1243 → S/A/A/B/B/C).

## Known gaps (see `../VALIDATION_REPORT.md` for the full breakdown)

- No real Supabase Auth — a hand-built stand-in, not GoTrue.
- No PostgREST — nothing here validates the HTTP/REST surface a real
  client actually calls, only the SQL/RLS layer underneath it.
- No test for Supabase CLI migration tracking (`supabase db push`/
  `supabase migration list`) — this harness reads the `.sql` files
  directly, bypassing the CLI's own bookkeeping entirely.
