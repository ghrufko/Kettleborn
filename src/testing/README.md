# Test harness (Phase 2.2)

No test framework existed in this repo before Phase 2.2 — no Jest,
no React Testing Library, no test script at all. Adding the auth/
leaderboard/store test coverage this phase required real module mocking
(swap out `@supabase/supabase-js` behind `getSupabaseClient()` for a
fake), and Node's own built-in test runner (`node:test`, no new
dependency) turned out to support exactly that via its experimental
module-mocking API — so that's what's used here, not a new framework.

## Running

```sh
npm test
```

Equivalent to:
```sh
node --test --experimental-test-module-mocks --import ./src/testing/register-hooks.mjs "src/**/__tests__/**/*.test.ts"
```

## Why two support files exist

- **`register-hooks.mjs`** registers `ts-resolve-hook.mjs` as a Node
  module resolution hook (via `node:module`'s `register()`).
- **`ts-resolve-hook.mjs`** lets `node --test` import this codebase's
  real, unmodified TypeScript source files. Node's native TS support
  (type-stripping) runs fine on individual files, but its ESM resolver
  requires explicit file extensions on relative imports — this
  codebase, like the rest of the TypeScript/Metro ecosystem, writes
  extensionless imports everywhere (`from './client'`, correct under
  tsconfig's `"moduleResolution": "bundler"`, and what Metro/`tsc` both
  already resolve). The hook retries a failed resolution with `.ts` (or
  `/index.ts` for a directory import like `from '../models'`) appended,
  so test files import production code directly — never a copy.

## A real limitation this surfaced: `import type`

Node's type-stripping removes type *annotations* but does not do full
type-checking — it cannot tell that an imported identifier is
type-only unless the import itself says so (`import type { X }`).
`src/store/authSlice.ts` originally wrote `import { StateCreator } from
'zustand'` and `import { AppStore, AuthSlice } from './types'` — both
imports used only in type position, both compiled and ran fine under
Metro/`tsc`, but failed under `node --test` with "does not provide an
export named ...", because neither `zustand` nor this project's own
`store/types.ts` actually exports those identifiers as runtime values.
Fixed by changing both to `import type` in that one new file — a
narrow, correct fix (those really are type-only imports), not a
workaround, and not applied to any pre-existing file in this phase.
**If a future test needs to import another file with the same
plain-import-of-a-type-only-identifier pattern, the fix is the same:
add `type` to that specific import, in that file, not a blanket
repo-wide change.**

## What this does and does not cover

Covers (see each file's own tests): `src/services/supabase/config.ts`
(pure logic, no mocking needed), `auth.ts` and `leaderboard.ts` (via a
mocked `client.ts`), `src/store/authSlice.ts` (via a mocked `auth.ts`
and a minimal hand-written Zustand-shaped `set`/`get` harness — not the
full `AppStore`, which pulls in `expo-sqlite` and other React-Native-
only modules that cannot run under plain Node).

Does **not** cover: any UI component (`SignInScreen`, `CreateAccountScreen`,
`LeaderboardScreen`, the `AccountSection` added to `SettingsScreen`) —
there is no React Native component-testing tool in this repo (no
React Testing Library, no `jest-expo`), and adding one was judged out
of scope for this phase (a second, larger testing-framework decision,
not a small addition). Those screens are verified by `tsc --noEmit`
and a successful `expo export`/dev-server bundle only — compiles and
bundles, not "renders correctly" or "button does X when pressed". See
`supabase/PHASE_2_2_IMPLEMENTATION.md` for the explicit list of what
was and wasn't verified.

Does **not** exercise real network calls, real Supabase Auth, or a
real PostgREST endpoint — every test above mocks `getSupabaseClient()`
entirely. See `supabase/PHASE_2_1_READINESS_REPORT.md` and
`supabase/VALIDATION_REPORT.md` for what's still blocked on a real
hosted project.

## Known noise

`--experimental-test-module-mocks` prints an `ExperimentalWarning` once
per process; `[MODULE_TYPELESS_PACKAGE_JSON]` prints because this
repo's `package.json` has no top-level `"type"` field (left as CommonJS
for Metro/Expo's own tooling, which is unrelated to and must not be
changed for this test runner's convenience). Both are harmless noise on
stderr, not failures — the actual pass/fail summary is the `ℹ tests /
pass / fail` block at the end of the output.
