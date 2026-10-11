# Phase 2.1 — Authentication & Account-Lifecycle Architecture

Documentation only. Nothing in this file is implemented — no sign-in
screen, session listener, or sync code exists. This is the contract
the phase that does implement those should follow.

## Grounding: what actually exists today

Re-confirmed by reading the current files this phase, not assumed:

- `src/constants/localUser.ts`: `LOCAL_USER_ID = 'local-hunter'` — the
  single hardcoded id every local SQLite table is keyed on
  (`user`, `monster_progress`, `campaign_progress`, `workout_result`,
  `chronicle`, `settings`, `equipment`, `timer_preset`, `timer_result`,
  `custom_hunt_preset`, `custom_workout`, `custom_workout_result`,
  `stopwatch_result` — all 11 tables with a `user_id` column use it).
- `src/store/bootstrap.ts`: `bootstrapApp()` runs once at launch, in a
  fixed order (DB open/migrate → content load → `initializeUser()` →
  settings → equipment → chronicle → monster progress → timer presets
  → custom workouts). No network call anywhere in this sequence.
- `src/services/supabase/client.ts`: `getSupabaseClient()` exists but
  is called by nothing (confirmed by grep, Phase 2.0 and re-confirmed
  this phase) — zero authentication state exists anywhere in the app
  today.
- Zustand (`src/store/index.ts`): nine slices, none auth-related. No
  precedent for a "remote identity" concept in the store.

## 1. Anonymous/guest mode

**Already the only mode.** No change needed to reach this state — the
app today is permanently in it. The future contract: guest mode remains
the default and requires no action; `LOCAL_USER_ID` keeps meaning
exactly what it means today — "the data on this device," not "a
particular person."

## 2. Email/password sign-up and sign-in

Minimum viable shape, not UI: a thin async wrapper module (e.g.
`src/services/supabase/auth.ts`, sibling to `client.ts`, not inside
it — keeps `client.ts` itself free of auth-flow logic) exposing:

```ts
signUp(email, password): Promise<AuthResult>
signIn(email, password): Promise<AuthResult>
signOut(): Promise<void>
getSession(): Promise<Session | null>
onAuthStateChange(cb): Unsubscribe
```

Each wraps the corresponding `supabase.auth.*` call, translating
`@supabase/supabase-js`'s error shapes into a small closed set the UI
layer can switch on (`invalid_credentials`, `network_error`,
`email_not_confirmed`, `unknown`) rather than the UI matching on raw
Supabase error strings. This is the same "repository hides the storage
detail" shape every existing `src/services/*Repository.ts` already
follows — not a new pattern, a reused one.

**Not building this module in Phase 2.1** — documenting its shape so
Phase 2.2 doesn't have to design it while also building the screen.

## 3. Sign-out

Must do exactly two things: call `supabase.auth.signOut()`, and clear
whatever in-memory auth state the future auth slice holds (Section 9).
**Must never** touch any SQLite table or call any existing
repository's delete path — there is no "delete all local data" method
anywhere in the repositories today, so this is satisfied by simply not
adding one for this purpose. The local game continues exactly as before
sign-out, now simply without a cloud session.

## 4. Session restoration after app restart

`supabase-js` restores a session automatically from its configured
storage adapter on `createClient()` — but only once Section 8's storage
decision is wired in (today, `persistSession: false`, so there is
nothing to restore). The future bootstrap sequence becomes: existing
`bootstrapApp()` steps, unchanged, run first and complete fully
regardless of auth state (so local play is never gated on a session
check); a *separate*, non-blocking call to `getSession()` updates the
future auth slice afterward or in parallel. **Local-first invariant:**
`bootstrapApp()` must never `await` a session-restoration call — it
already doesn't, and this must stay true, since the task requires the
app to work fully offline.

## 5. Expired or refreshed sessions

With `autoRefreshToken: true` (once Section 8 flips it), `supabase-js`
handles refresh transparently. The contract for when refresh fails
outright (refresh token itself expired/revoked): treat identically to
a clean sign-out from the local game's perspective (no local data
touched) plus a passive auth-state flag the UI can use to show "signed
out — sign in again to resume cloud sync," never a blocking modal and
never a retry loop that blocks local play.

## 6. Offline startup

Already fully solved by the current architecture and must stay true:
`bootstrapApp()` has no network dependency. The future auth slice's
initial state must be a third, explicit value — not just
`boolean | null` — distinguishing "not yet checked," "checked, no
session," and "checked, session present" (see Section 9's type) so a
slow/failed `getSession()` call while offline is indistinguishable from
"definitely signed out" only until it actually resolves, never assumed
early.

## 7. Invalid credentials and network errors

Both surface through the small closed error-reason set from Section 2.
Neither should ever be presented as "something went wrong" if the
service is genuinely configured and reachable but the credentials are
simply wrong — these are different user-facing messages, and the
wrapper module's job is specifically to make that distinction possible
without the UI layer parsing Supabase's raw errors itself.

## 8. Secure session persistence on iOS and Android — `expo-secure-store` decision

**Evaluated explicitly, per the task's instruction not to add it
reflexively.**

- **Current state:** `client.ts` sets `persistSession: false`,
  `autoRefreshToken: false` — there is no session to persist, so no
  storage adapter is needed *yet*. Confirmed correct to leave as-is.
- **When it becomes needed:** the moment any sign-in call is actually
  implemented (Phase 2.2 or later) and a real session object (access +
  refresh token) can exist. A refresh token is materially more
  sensitive than anything else this app currently stores client-side —
  the existing precedent, `AsyncStorage` for the onboarding-seen flag
  (`src/utils/onboardingStorage.ts`), is a single non-sensitive boolean
  and must not be reused as a precedent for token storage.
- **Recommendation:** add `expo-secure-store` in the phase that adds
  the first real `signIn` call, not before. Integration shape at that
  time: implement `supabase-js`'s `SupportedStorage` interface
  (`getItem`/`setItem`/`removeItem`, all `async`) backed by
  `SecureStore.getItemAsync`/`setItemAsync`/`deleteItemAsync`, passed as
  `auth.storage` in `createClient()`. `expo-secure-store` wraps iOS
  Keychain and Android Keystore — no further platform-specific code
  needed beyond that adapter.
- **Platform consideration to carry forward:** `expo-secure-store` has
  a per-item size limit on Android (Keystore-backed values are
  constrained; large values can fail to write) — a Supabase session
  object is small (a JWT pair plus metadata), well within typical
  limits, but this should be confirmed empirically on Android once
  real sessions exist, not assumed.
- **Not added in Phase 2.1.** No `package.json` change in this phase
  beyond what Phase 2.0 already added.

## 9. Should auth state live in Zustand?

**Recommendation: a dedicated slice, added only when Section 2's wrapper
is actually built — not in Phase 2.1.** Reasoning, evaluated against
the existing architecture rather than a generic rule:

- Every existing slice (`userSlice`, `settingsSlice`, etc.) wraps a
  SQLite-backed repository and exposes derived, already-loaded state to
  screens — auth state has no local-database backing at all (a session
  is supabase-js's own in-memory/storage-adapter state), so it isn't a
  perfect fit for the existing pattern, but Zustand is still the
  project's one established "screens read global app state from here"
  mechanism — introducing a second one (e.g. React Context just for
  auth) would be the actual architectural inconsistency.
- Proposed shape, for Phase 2.2 to adopt or revise:
  ```ts
  interface AuthSlice {
    authStatus: 'unknown' | 'signed_out' | 'signed_in';
    authUser: { id: string; email: string } | null; // never the full Session object in Zustand — tokens stay inside supabase-js's own storage adapter, not duplicated into app state
    initializeAuth: () => Promise<void>; // calls getSession(), subscribes via onAuthStateChange
    signOut: () => Promise<void>;
  }
  ```
  Deliberately excludes the raw access/refresh tokens from Zustand
  state — they already live in `supabase-js`'s configured storage
  adapter; duplicating them into Zustand (which has no encryption
  story of its own) would widen the token's exposure surface for no
  benefit.
- **Not added in Phase 2.1** — no auth wrapper exists yet to back it.

## 10. Account-switching behavior

Depends entirely on the Section 11 decision below. Documented jointly
there, since they're the same question from two directions (what
happens to local data vs. what happens to the signed-in identity).

## 11. Guest-to-account migration contract — the required architectural decision

### Scenario-by-scenario contract

| # | Scenario | Local data | Ownership | Upload/download/merge | Confirmation needed | Duplicate/partial-failure handling | Safely retryable |
|---|---|---|---|---|---|---|---|
| 1 | New guest starts using the app, no account | Created under `LOCAL_USER_ID` | Device only | None | No | N/A | N/A |
| 2 | Guest creates an account | Unchanged, stays under `LOCAL_USER_ID` | Local: device. Remote: new `auth.users`/`profiles` row, empty | **None automatic** — see recommendation below; an explicit, separate "import my guest progress" action is offered, not run implicitly | **Yes, explicit, every time** | N/A (no data moved yet) | N/A |
| 3 | Existing guest signs into an *existing* account | Unchanged | Remote account's existing cloud history, untouched | None automatic (same reasoning as #2 — this is the more dangerous case, see below) | Yes, if the user separately chooses to import | Same import logic as #2, see "Import operation" below | Yes — see below |
| 4 | Signed-in user signs out | Unchanged | Reverts to local-only until next sign-in | None | No | N/A | N/A |
| 5 | Signed-in user switches accounts | Unchanged | Local data is never auto-attributed to either account | None automatic | Yes, if importing into the *new* account | Same import logic | Yes |
| 6 | Reinstall / local data loss | Local data is gone (expected — no backup mechanism was ever built) | Whatever was previously uploaded to the cloud account remains there, retrievable only by signing back in | Download, if a future "restore from cloud" feature is built (not in scope) | N/A for this phase | N/A | N/A |
| 7 | Network failure during sign-up/sign-in | Untouched | Unchanged | None | N/A | The auth wrapper (Section 2) must surface `network_error` distinctly; local play continues regardless | Yes — sign-in/sign-up itself is safely retryable; `supabase-js`'s own `signUp`/`signInWithPassword` are not insert-like operations with duplicate-row risk |
| 8 | App launches offline | Unaffected — `bootstrapApp()` has no network step | N/A | None | No | N/A | N/A |
| 9 | Authenticated user has unsynced local progress | Stays local until a future sync phase exists | Device, until synced | Upload, once a sync writer exists (not in scope — Phase 1.3's `client_result_id` uniqueness gap must be fixed first, see Migration Audit) | Depends on the sync design chosen later | Idempotent insert via `client_result_id` uniqueness (future requirement, documented, not implemented) | Yes, once that constraint exists |
| 10 | Remote account already has conflicting progress | Both sets of data continue to exist | Remote: the account's existing `workout_results`/`leaderboard_entries` rows. Local: the device's `workout_result` rows | **Merge, never overwrite** — remote history is append-only by schema design (`workout_results` has no UPDATE/DELETE grant at all, confirmed in the Migration Audit), so there is no mechanism to overwrite it even accidentally; a local-history import would **add** rows, never replace or delete existing remote ones | Yes, explicit | Each imported local result becomes its own new `workout_results` insert, validated by the exact same triggers every other insert goes through (no special-cased "import" path in the SQL) | Yes, once `client_result_id` uniqueness exists |

### Required decision: evaluated options

**Option A — Keep guest progress isolated; start fresh after signing
in.** Simplest to build; zero data-loss risk because nothing is ever
moved. Trade-off: a guest who trained for weeks before creating an
account loses the appearance of continuity (their cloud leaderboard
history starts at zero), which is a real cost for a fitness-RPG app
specifically built around visible long-term progress.

**Option B — Explicit one-time guest-progress import into a new
account.** The account is new and empty, so there is no remote data to
conflict with — every local `workout_result` row becomes a new
`workout_results` insert. Lowest risk of the three "do something"
options: nothing pre-existing can be overwritten because nothing
pre-exists on that account yet.

**Option C — Deliberate merge into an existing account, with conflict
rules.** Necessary for Scenario 10 (an existing account already has
history) but meaningfully higher-risk: "conflict rules" has to define
what happens when the same workout appears on both sides with different
times — the schema's answer (append-only, `leaderboard_entries` already
keeps only the faster of any two results for the same `(user,
workout)`, confirmed in the Migration Audit) actually makes this safer
than it sounds, but the *user-facing* decision ("do you want to see both
attempts in your history, or treat the import as informational only")
still needs an explicit product decision outside this phase's scope.

### Recommendation

**Option B for account creation (Scenario 2), explicit per-import
confirmation; Option C's same mechanism for Scenario 3/5 (signing into
or switching to an existing account), with no additional "smart"
conflict resolution beyond what the schema already does automatically**
(append-only history; `leaderboard_entries` already keeps the best time
per workout with no action needed). Rejected: Option A alone, because
it discards real user data for no safety benefit — Option B achieves
the same safety (nothing pre-existing can be overwritten, since a new
account is empty) while preserving the user's history, so there is no
reason to pick the strictly worse option for the common case (signing
up for the first time). Rejected: a "smart automatic merge" beyond what
B/C already provide via the append-only schema — more complexity for a
risk (silently losing data) the schema's own immutability already
prevents without it.

**The import operation itself, as a concrete contract** (not
implemented — this is what Phase 2.2+ should build to):
1. User explicitly taps "Import my local history" (never automatic,
   never on first sign-in without this explicit step, per the task's
   own instruction not to silently attach guest records on sign-in).
2. The app reads every local `workout_result` row not yet marked
   synced (requires the `client_result_id`-uniqueness migration from
   the Migration Audit's "Known risks" — not yet applied).
3. Each row is submitted as an ordinary `workout_results` insert,
   through the exact same triggers (`workout_results_before_insert`,
   `sync_leaderboard_entry`) every other insert uses — no special
   "import mode" bypass in the SQL, so every existing validation rule
   (canonical gear_count, weight ranges, etc.) applies identically.
4. On success, the local row is marked synced (new local column,
   not yet added — see Migration Audit). On failure (network or
   validation), the row stays unmarked and the import can be safely
   re-run later — safe specifically because of the `client_result_id`
   uniqueness constraint preventing a re-run from duplicating already-
   succeeded rows.
5. The operation never deletes or modifies any local row — it only
   reads and marks.

## 12. Future leaderboard eligibility and ownership

Already fully implemented server-side (Migration Audit, migrations 3–4)
and requires no new design: a result is eligible the moment it's a
canonical (`is_custom_hunt = false`), structurally valid, plausible-
time/weight insert from an authenticated user — ownership is `auth.uid()`,
forced, with no client override path. Nothing in a future auth UI needs
to re-implement or duplicate this logic; it only needs to get an
authenticated session so the existing insert path can run at all.

## Explicit non-goals for Phase 2.1 (confirmed not built)

No sign-in/sign-up/password-reset screen, no session listener wiring
into `App.tsx` or any store slice, no `expo-secure-store` dependency, no
remote data fetch of any kind, no modification to `bootstrapApp()`,
`completeHunt()`, or any repository.
