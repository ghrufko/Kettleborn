# Phase 2.1 — Readiness Report

## Initial Git state and preservation

Re-verified at the start of this phase (not assumed from prior reports):
branch `main`; the same 17 pre-existing modified application files as
every prior phase; untracked `Microsoft/` and `supabase/` directories;
untracked `src/services/supabase/` and `.env.example` from Phase 2.0.
Final `git status --short`, taken after all Phase 2.1 work, shows the
identical 17 modified files plus the identical untracked-directory set
— the only change is new content inside `supabase/` (two new
documentation files; no SQL changed). No destructive git command was
run. No commit, no push.

**Note on a prompt discrepancy:** this phase's task description states
the project uses "Expo SDK 54." The installed and configured version is
**Expo SDK 57** (`package.json`: `"expo": "^57.0.19"`;
`npx expo --version` → `57.0.21`), unchanged since before Phase 2.0.
Flagging this explicitly rather than silently treating the prompt's
figure as authoritative, per this phase's own instruction not to assume.

## Files changed this phase

**New:**
- `supabase/PHASE_2_1_MIGRATION_AUDIT.md`
- `supabase/PHASE_2_1_AUTH_ARCHITECTURE.md`
- `supabase/PHASE_2_1_READINESS_REPORT.md` (this file)

**Modified:** none. No SQL migration, no application source file, no
`package.json`/lockfile, no existing Phase 1.3/2.0 documentation file
was edited this phase — this phase was read/verify/document only, per
its own instruction to prefer documentation over speculative production
changes and the absence of any concrete, isolated, fully-verifiable
defect (Security assessment, below).

**Confirmed untouched:** all 17 pre-existing application files; all
four SQL migrations; `supabase/tests/`; `src/services/supabase/*`;
`.env.example`; `package.json`/`package-lock.json`.

## Migration audit — key findings

Full detail in `PHASE_2_1_MIGRATION_AUDIT.md`. Summary:
- All four migrations re-read in full against the current `.sql`
  files. Dependency order confirmed correct (1→2→3→4, each migration's
  FKs only reference objects created by an equal-or-earlier one).
- None are idempotent (no `if not exists`/`on conflict` guards on the
  `create table`/`create function` statements), and this is the correct
  design — re-application fails loudly (`relation already exists`),
  confirmed via PGlite, not silent duplication or corruption.
- Zero `anon`-role grants exist anywhere across all four files —
  confirmed by exhaustive grep, not sampling. An unauthenticated
  request has no access to any table.
- Every previously-identified trust boundary (`auth.uid()` forcing,
  column-level XP/level lockdown, immutable `workout_results`, no
  direct `leaderboard_entries` write path) was re-verified directly
  against the current SQL text, not re-asserted from memory of prior
  reports.
- One documentation-accuracy correction made (not a SQL defect): a
  README line implying the content-reference migration's own `INSERT`
  statements already use `ON CONFLICT` was corrected — they don't (by
  design; a future content update should ship as a *new* migration
  with that pattern, not retrofit this one).
- `FORCE ROW LEVEL SECURITY` is not set on any table; reviewed and
  confirmed not a gap in this schema (the app never connects as the
  table owner).

## Security assessment

**Confirmed issues: none found this phase.** Every client-identity
trust point was re-inspected directly (not re-assumed) specifically
looking for a case where a client-supplied id is trusted instead of
`auth.uid()` — none exists. No policy was modified, per the task's own
instruction not to touch a passing policy without a concrete finding.

**Theoretical/residual risks (documented, unchanged from Phase 1.3,
re-confirmed still present and still non-blocking):** `client_result_id`
has no uniqueness constraint (sync-idempotency gap — irrelevant until a
sync writer exists, which none does); `content_version` recorded but
unenforced; no advisory lock against a same-user concurrent PR-rank
race. None have a current code path that triggers them.

**Verification-level ceiling, unchanged:** every claim above is
Static + PGlite. Nothing is verified against real Supabase Auth,
PostgREST, or a hosted project's actual grants — no such project exists
in this environment (see Infrastructure, below).

## Account lifecycle decision

Full contract and scenario table in `PHASE_2_1_AUTH_ARCHITECTURE.md`.
**Recommendation:** explicit, user-initiated, one-time import of local
history into a new or existing account (never automatic on sign-in);
no silent attachment of guest records; remote history stays append-only
(already enforced by the existing schema — no UPDATE/DELETE grant on
`workout_results` at all), so an import can only add rows, never
overwrite existing remote progress. Rejected: leaving guest progress
permanently isolated with no import path (discards real user data for
no safety benefit, since the schema's own immutability already
prevents the overwrite risk that would otherwise justify it).

## Tests executed — exact commands, results, exit codes

| # | Command | Result | Exit code |
|---|---|---|---|
| 1 | `node run_suite.mjs` (from `supabase/tests/pglite/`) | PASS — 35/35 | 0 |
| 2 | `node run_edge.mjs` (from `supabase/tests/pglite/`) | PASS — 15/15 | 0 |
| 3 | `npx tsc --noEmit` | PASS — no output, no errors | 0 |
| 4 | `npm ls @supabase/supabase-js` | PASS — resolves cleanly to `2.117.3`, no peer conflicts reported | 0 |
| 5 | `npm install --package-lock-only --dry-run` | PASS — "up to date," confirms lockfile matches `package.json` | 0 |
| 6 | `npx expo export --platform web` | PASS — bundle produced, **byte-identical output hash** to Phase 2.0's export (`AppEntry-98e3cd0c...`), confirming zero behavioral change from this phase's doc-only work | 0 |
| 7 | `grep -c "supabase"` on the exported web bundle | PASS — 1 match, confirmed to be an inert string inside an embedded `package.json` dependency listing, not executable code | n/a |
| 8 | Env-var presence check (`EXPO_PUBLIC_SUPABASE_URL`/`_ANON_KEY`), values never printed | Both confirmed **absent** | n/a |
| 9 | `npx expo start --web --port 8099` with both vars absent, then `curl` the index page and the AppEntry web bundle | PASS — HTTP 200 on both; dev-server log: `Web Bundled 829ms node_modules\expo\AppEntry.js (893 modules)`, no errors; server force-stopped afterward, port confirmed free | 0 (curl), server terminated via `taskkill` |
| 10 | Grep for `services/supabase` imports in `App.tsx`/`src/store/bootstrap.ts` | PASS — zero matches; confirms normal startup cannot initialize the Supabase client | n/a |
| 11 | Secret-pattern scan (`sb_secret_`, `service_role`, PEM headers, JWT-shaped strings) across every file changed this phase and Phase 2.0's new files | PASS — the only matches are explanatory text describing the detection heuristic itself, not real secret values; zero JWT-shaped strings found anywhere in the repo outside `node_modules` | n/a |
| 12 | `git status --short` before vs. after this phase | PASS — identical file set except new content inside `supabase/`; no unrelated file touched | n/a |

**NOT RUN:** any test against a real Supabase project, real GoTrue
auth, or PostgREST (no project exists — see Infrastructure). Any
iOS/Android device or simulator test (none available in this
environment — not fabricated).

## Infrastructure — verified locally vs. remotely

**Checked this phase, re-confirmed not assumed:**
- `docker --version` → `command not found`.
- `psql`/`pg_isready` → not found on PATH.
- `npx supabase projects list` → `AccessTokenRequiredError` — no CLI
  authentication, no linked project.
- `supabase/config.toml`'s `project_id = "Kettleborn"` — **this is the
  local scaffold default, explicitly documented in the file's own
  comment as "defaults to the working directory name when running
  `supabase init`," not a real hosted project reference.** Calling this
  out specifically because it is exactly the kind of artifact the task
  warned not to mistake for evidence a real project exists.
- `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` —
  confirmed absent from the environment; no `.env` or `.env.local` file
  exists in the repository (only the committed `.env.example`
  placeholder).

**Conclusion: hosted/remote verification is BLOCKED, identically to
Phase 1.3 and Phase 2.0.** No substitute project was created or
implied. No read-only remote inspection was possible because no
project identity could be established at all.

## Blocked items

- Everything requiring a real Supabase project: hosted migration
  application, real RLS/PostgREST behavior, real GoTrue session
  issuance/refresh.
- iOS/Android device or simulator verification of
  `@supabase/supabase-js` runtime behavior.

Both are unchanged from Phase 2.0 — this phase did not have, and did
not fabricate, a way around either.

## Go/no-go

**Phase 2.2 (building the Section-2 auth wrapper module and, later,
`expo-secure-store` integration) can begin on the documentation alone**
— neither requires a real Supabase project to write correctly, since
the architecture in `PHASE_2_1_AUTH_ARCHITECTURE.md` was derived from
the actual existing code, not from assumptions about a hosted project.

**Real sign-in testing, and anything involving an actual session,
remains NO-GO until:**
1. A real Supabase project exists and its identity (project ref, URL,
   anon key) is confirmed through an authenticated `supabase` CLI
   session or the Dashboard — not inferred from `config.toml`.
2. The existing migrations have been applied to that project and
   `manual_rls_test_plan.sql` has been run against it directly.
3. The `client_result_id` uniqueness migration (Migration Audit,
   "Known risks") is written and applied, if any import/sync feature
   is in that phase's scope.

## Next prompt recommendation (Phase 2.2 scope)

Implement the Section-2 auth wrapper module
(`src/services/supabase/auth.ts`) exactly as specified in
`PHASE_2_1_AUTH_ARCHITECTURE.md` — `signUp`/`signIn`/`signOut`/
`getSession`/`onAuthStateChange`, translating `supabase-js` errors into
the closed reason set — plus the Zustand `AuthSlice` shape from that
same document, wired into `bootstrapApp()` as a non-blocking parallel
step (never gating local-first startup). Do not build sign-in UI yet in
that phase either, unless a real Supabase project has been created and
verified first (per the Go/no-go above) — otherwise the wrapper would
have nothing real to call and no way to confirm it works.
