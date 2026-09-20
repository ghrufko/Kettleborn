# KettleBorn — Technical Handoff (August 2026)

This document describes the **current implemented state** of the project, verified against the actual
files in the codebase — not an ideal future architecture, and not a restatement of old plans. Every claim
below was checked against the code during this session. Tags used throughout:

- **FIXED** — implemented and verified present in the current code.
- **PLANNED / NOT IMPLEMENTED** — discussed or content-authored for, but no runtime code reads/uses it.
- **NEEDS VERIFICATION** — behavior that only a real device run can confirm; static/bundle checks can't.

Attach this file together with the current project ZIP when starting a new chat — the ZIP is the source
of truth for actual code; this document is the map.

---

## 1. Project Overview

KettleBorn is a dark-fantasy-RPG kettlebell training companion — **React Native + Expo SDK 54 +
TypeScript**, fully offline (SQLite only, no backend/networking).

- **Concept**: kettlebell complexes are framed as boss fights. Each Monster has HP; completing rounds of
  a linked Workout deals damage until the boss's HP reaches 0.
- **Campaign structure**: one campaign exists — **Campaign I, "The First Trial"**
  (`content/campaigns/campaign-1.json`, id `main-campaign`). 5 regular monsters (Minotaur, Leviathan,
  Behemoth, Hydra, Arachne) — all unlocked from the start, no monster-to-monster gate — plus one final
  boss, **The Weaver** (`finalBossId: "weaver"`), which unlocks only once all 5 regular monsters are
  defeated.
- **Current boss structure**: every regular monster has exactly **3 Hunts** ("Encounter 1/2/3"), all
  pointing at the *same* `workoutId` (identical exercises/reps/rounds/HP every time — the only thing that
  currently differs between Encounters is rest duration, see §5/§13). The Weaver has exactly **1** Hunt.
- **A Hunt** = one specific attempt record at one numbered Encounter of one Monster (`Hunt.id`, e.g.
  `"behemoth-second-encounter"`), bound to a `Workout` (the actual kettlebell complex content).
- **Player progression through Campaign I**: complete all 3 Hunts of a monster (in any order — see §4 for
  the current sequential-lock nuance) → monster becomes `defeated` → once all 5 regular monsters are
  `defeated` → Weaver unlocks → defeat Weaver → campaign complete.

---

## 2. Current Architecture

```
src/
  screens/     — one folder per feature area (hunt, timer, chronicle, hunter, forge, settings, onboarding, shared)
  components/  — core/ (Button, GlassCard, Header, LevelUpModal), monster/, navigation/, progress/, workout/ (TimerWidget, WeightSelector)
  navigation/  — React Navigation stacks + route param types (types.ts)
  store/       — Zustand slices, combined into one store (index.ts)
  services/    — SQLite repositories + db bootstrap/migrations
  models/      — TypeScript interfaces — the shape source of truth
  utils/       — pure derived-data functions (never a second copy of persisted data)
  theme/       — colors/typography/spacing/radii design tokens
engines/
  content/     — ContentEngine (loads + validates every content JSON file)
  session/     — useWorkoutSession (Active Hunt's round/rest/countdown state machine)
  battle/      — useBattleEngine + damageResolver (HP/damage reducer)
  timer/       — useIntervalClock, useTimerSession (standalone Timer feature — separate from Hunts)
  progress/    — progressionEngine (XP/level math)
  audio/       — AudioEngine (sound cue playback)
content/       — all game content JSON (monsters, workouts, exercises, lore, campaigns, timer presets)
```

| Subsystem | Key file(s) | Role | Depends on it | Don't casually change |
|---|---|---|---|---|
| Content | `engines/content/ContentEngine.ts` | Single loader/validator for all JSON content, via static imports (Metro requires static paths — every new content file needs one registration line). Throws on malformed monster/workout/campaign; lore/timer-preset/exercise-library entries degrade gracefully (warn + skip, never crash). | Every screen, via `contentEngine.getX()` | The static-import list; validation shape checks |
| Store | `src/store/index.ts` + `*Slice.ts` | One combined Zustand store (`useAppStore`), built from `userSlice`, `settingsSlice`, `chronicleSlice`, `progressSlice`, `workoutSlice`, `timerSlice`. Slices freely read/write each other's state through the shared `set`/`get`. | Nearly every screen | `workoutSlice.completeHunt` — the single place a Hunt's outcome is computed and persisted |
| Database | `src/services/db/schema.ts`, `database.ts` | 4 versioned migrations, tracked in a `schema_migrations` table, applied in order at boot. | All repositories | Never edit an already-shipped migration — only add a new one |
| Repositories | `src/services/*Repository.ts` | One per table (`workoutRepository`, `progressRepository`, `chronicleRepository`, `userRepository`, `settingsRepository`, `timerRepository`). Raw SQL + row↔model mapping. | Corresponding store slice | Table/column names |
| Workout/session engine | `engines/session/useWorkoutSession.ts` | Round/rest/countdown state machine. Owns `elapsedSeconds` (total), `currentRoundElapsedSeconds` (round), `restRemainingSeconds` (rest), lap history. Signature: `(workout, callbacks, restSecondsOverride?)`. | `ActiveHuntScreen.tsx` only | Phase-name/transition logic — the UI depends on exact phase values |
| Battle Engine | `engines/battle/useBattleEngine.ts` + `damageResolver.ts` | Pure reducer over `ROUND_COMPLETED`/`WORKOUT_COMPLETED` actions. `damageResolver.resolveExerciseDamage` is the only place `damageCoefficient`/`damageType` is read. | `ActiveHuntScreen.tsx` | Do not touch unless a task explicitly requests Battle Engine/damage changes |
| Navigation | `src/navigation/types.ts` + per-tab Stack files | Route param lists (typed) + stack definitions. | Every screen's `Props` type | Param shapes — many screens destructure by exact key |
| Timer system | `engines/timer/useIntervalClock.ts`, `useTimerSession.ts` | A **separate**, parallel state machine for the standalone Timer tab — deliberately not code-shared with `useWorkoutSession` beyond the shared 1-second tick primitive (`useIntervalClock`). | Timer screens only | Never conflate with Hunt/session timing |
| Progression | `engines/progress/progressionEngine.ts` | Centralized XP/level math — `calculateHuntXP`, `getLevelForTotalXP`, `getLevelProgress`. | `workoutSlice.completeHunt`, Hunter/Victory screens | The `PROGRESSION_CONFIG` object is the single tuning point |
| Audio | `engines/audio/AudioEngine.ts` | Sound cue playback (`expo-audio`), checks `settings.soundEnabled`. | Active Hunt, Timer | — |

---

## 3. Important Data Models

(All in `src/models/*.ts`.)

- **`Monster`** (`Content.ts`) — `id, name, title, description, rarity, battle: BattleConfig, hunts: Hunt[],
  portraitAsset?, personality?: CombatPersonality, accentColor?`.
- **`Hunt`** — `id, monsterId, order, name, locked, workoutId, restSecondsOverride?, targetTimeIsEstimate?`.
  One entry per Encounter, embedded inside its owning `Monster.hunts[]` (no standalone hunt content files
  — `content/hunts/` is a reserved-but-empty folder, its own README documents this explicitly).
- **`Workout`** — `id, name, description?, difficulty, estimatedMinutesRange, gearWeightKg, gearCount (1|2),
  rounds, restSeconds, roundBonusDamage, targetTimeSeconds, focus[], exercises: Exercise[],
  sections?: {label, exercises: Exercise[]}[], finisher`. `sections`, when present, must have
  `sections.length === rounds`; only Behemoth (`iron-ascent`) and The Weaver (`the-final-trial`) use it.
- **`Exercise`** — `id, name, targetReps?, targetDistanceFt?, damageCoefficient, damageType
  ('flat'|'per_rep'|'per_second'|'over_time'), durationSeconds?`.
- **`WorkoutResult`** (`WorkoutResult.ts`) — one row per completed Hunt: `id, userId, workoutId, monsterId,
  huntId, completedAt, timeMinutes, timeSeconds, weightValueA, weightValueB (nullable),
  weightUnit ('kg'|'lb'), notes, xpAwarded, difficulty, appVersion`. `huntId` is the only field that
  identifies exactly *which* Encounter was completed (see §4).
- **`HuntSummary`** — the in-memory (not persisted separately) object `completeHunt` returns/stores as
  `lastHuntSummary` for Victory to read: includes `weightKg`, `gearCount`, `volumeKg`, `totalRounds`, rank,
  XP breakdown, level-up info.
- **`MonsterProgress`** (`Progress.ts`) — `(userId, monsterId)`-keyed: `huntsCompleted, huntsTotal,
  defeated`. A plain counter, not a set of completed `huntId`s.
- **`Chronicle`** (`Chronicle.ts`) — one row per user: lifetime `totalWorkouts, totalHuntsCompleted,
  totalMonstersDefeated, totalVolumeKg, totalTrainingMinutes, longestStreakDays, currentStreakDays,
  updatedAt`.
- **User progression** — on `User`: `level, totalXP`. Computed via `progressionEngine.ts`, not stored
  pre-derived beyond those two fields.
- **Timer models** (`Timer.ts`) — `TimerPreset` (rounds/intervals, optional `linkedWorkoutId` to reuse a
  Hunt's exercise names), `TimerResult`. Entirely separate from `WorkoutResult`.

---

## 4. Campaign Mechanics

- **Monsters**: 5 regular + 1 final boss, all defined in `content/monsters/*.json`, registered via static
  import in `ContentEngine.ts`.
- **Encounters/Hunts**: each regular monster's `hunts[]` has `order: 1/2/3`, all sharing one `workoutId`,
  all `locked: false` in content (nothing is content-gated).
- **Encounter progression / unlock logic — FIXED this session**: `getHuntDisplayState(hunt, huntsCompleted,
  isPreviousHuntCompleted?)` (`src/utils/huntState.ts`). For `hunt.order > 1`, if the caller passes
  `isPreviousHuntCompleted === false`, the state is forced `'locked'` regardless of the count or
  `hunt.locked`. `isPreviousHuntCompleted` is computed in `MonsterDetailScreen.tsx` from real
  `WorkoutResult.huntId` data (via the store's `getAllResults()`), checking whether the *specific*
  previous-order Hunt's id is among completed results — **not** a `huntsCompleted >= N` count check. This
  satisfies the original requirement: completing Encounter 3 directly does not count as clearing
  Encounter 1/2.
  - **Known limitation, NOT fixed**: the 3rd parameter is optional/backward-compatible.
    `src/utils/nextObjective.ts` (used by Home/Hunter/Victory's "Continue" card) still calls the 2-arg
    form and is unaffected — it can recommend a Hunt that `MonsterDetailScreen` would show as locked.
- **How completion is determined / how `huntId` is used**: every completed Hunt writes a `WorkoutResult`
  row with `huntId` set to the exact Encounter completed — this is the only place a *specific* Encounter's
  completion is recorded.
- **How `huntsCompleted` is used**: `MonsterProgress.huntsCompleted` is a **plain counter**, incremented
  `+1` in `completeHunt` for *any* completed Hunt of that monster, uncapped-aware (capped at `huntsTotal`).
  It does not know *which* `huntId` was completed — only `WorkoutResult.huntId` does.
  - **Known limitation, NOT fixed**: the `'completed'` display state itself is still
    `hunt.order <= huntsCompleted` (count-based, pre-existing, unchanged). A save that completed Encounter
    3 before sequential-locking existed could now mis-render as `'locked'` rather than `'completed'`.
- **How a monster becomes defeated**: `MonsterProgress.defeated = huntsCompleted >= huntsTotal` (3),
  computed in `completeHunt`.
- **Final boss unlock**: `src/utils/campaignState.ts` — once every id in `Campaign.monsterIds` is
  `defeated`, the monster whose id equals `Campaign.finalBossId` becomes `'available'`.
- **Campaign completion**: `isCampaignComplete` — true once the final boss is also `defeated`. No special
  cutscene/screen exists in the mobile app for this — only World Map state transitions.
- **Personal Best**: scoped to **`workoutId`**, not `huntId`. Since all 3 Encounters of a monster share one
  `workoutId`, PB is shared across them — a fast Encounter 1 time counts as the record when replaying
  Encounter 3. **NOT changed this session; documented limitation only.**

---

## 5. Workout Mechanics

- **Rounds**: `workout.rounds` — the number of `ROUND_COMPLETED` events a full Hunt dispatches.
- **Sections** (`workout.sections?`): optional per-round-different exercise lists. Only Behemoth
  (`iron-ascent`, 3 sections: "The Colossus" / "The Climb" / "The Summit") and The Weaver
  (`the-final-trial`, 5 sections, one borrowed from each regular monster) use this. Every other workout
  uses the flat `exercises` array, repeated identically every round.
- **Exercises / `targetReps`**: content-authored per `Exercise`; used for both display (Hunt Brief, Active
  Hunt, Exercise Breakdown) and damage (`per_rep` damage type multiplies `damageCoefficient * targetReps`).
- **Rest**: `workout.restSeconds` is the base/fallback value. **FIXED this session**:
  `Hunt.restSecondsOverride?`, when present, takes priority — `useWorkoutSession`'s `completeRound` now
  calls `setRestRemainingSeconds(restSecondsOverride ?? workout.restSeconds)`. `ActiveHuntScreen.tsx` now
  resolves `const hunt = contentEngine.getHunt(monsterId, huntId)` (this lookup did not exist before this
  session) and passes `hunt?.restSecondsOverride` through as the 3rd `useWorkoutSession` argument. Absent
  → falls back byte-for-byte to prior behavior.
- **Workout completion**: `completeRound` fires `onRoundComplete` each round (→ Battle Engine
  `ROUND_COMPLETED`); after the final round, `onWorkoutComplete` fires (→ Battle Engine
  `WORKOUT_COMPLETED`, fast-finish/PR bonuses) and the session enters a `'complete'` phase.
- **Minotaur ladder mechanics — PLANNED / NOT IMPLEMENTED**: content workout `labyrinth-ladder` has
  `rounds: 1` and two flat exercises (`Double Snatch` 100 reps, `Double Thruster` 100 reps) — a real
  rung-by-rung ladder (1→2→3→...→N, Complete-Round-per-rung, per-rung HP strikes) does **not** exist in
  code or content. The single round is just the ladder's total collapsed into one lump. Explicitly
  excluded from any redesign this session.
- **Behemoth multi-section workout — FIXED / working as intended**: `iron-ascent` genuinely differs
  round-to-round (3 phases, different exercises/reps each). Active Hunt, Hunt Brief, and Exercise
  Breakdown all correctly read `workout.sections[roundIndex]` instead of the flat list when present.
- **How workout results are stored**: see `WorkoutResult` in §3 and the full `completeHunt` flow in §6/§7.

---

## 6. Battle / Damage System

**Actual implemented behavior** (not intended design — this is what the code does):

- `damageResolver.resolveExerciseDamage(exercise, repsCompleted)`:
  - `'flat'` → `damageCoefficient`
  - `'per_rep'` → `damageCoefficient * repsCompleted`
  - `'per_second'` / `'over_time'` → `damageCoefficient * (durationSeconds ?? 0)`
- On `ROUND_COMPLETED`, `useBattleEngine`:
  `exerciseDamage = Σ resolveExerciseDamage(...) * config.damageMultiplier`, then adds:
  - `workout.roundBonusDamage` — flat, every round.
  - `perfectExecutionDamage` — a "performance bonus" that in the current always-full-completion design
    (no partial-completion UI exists) fires on **every** round, not actually skill-gated today.
  - `relentlessAssaultDamage` — fires every `relentlessAssaultStreak`-th (3) consecutive clean round —
    also effectively guaranteed today, same reason.
- On `WORKOUT_COMPLETED`: `fastFinishDamage` (if finished under target time) and `personalRecordDamage`
  (if a PR) — these ARE genuinely skill-conditional, applied once at the very end.
- **HP**: `monster.battle.hp` (content, rebalanced this session — see §12/§9). `currentHP` clamps at 0
  (`isDefeated` flips true). A separate uncapped `totalDamageDealt` running total exists for an honest
  "Damage Dealt" Victory stat even on an overkill final hit.
- **`damageMultiplier`**: currently `1.0` for every monster in content — present in the type/reducer but
  not actively differentiating any monster right now.
- **When damage is applied**: once per `ROUND_COMPLETED` dispatch (i.e. once per round, when the player
  taps Complete Round), plus once more at `WORKOUT_COMPLETED` for the two skill-conditional bonuses.
- **Does weight affect battle damage?** **NO — confirmed by direct grep, zero matches.**
  `damageResolver.ts`/`useBattleEngine.ts` never read `gearWeightKg`, `weightKg`, or any weight-related
  field. This is an explicit, intentional design decision (see §13) — do not change without an explicit
  task asking for it.

---

## 7. Progression

- **XP**: `engines/progress/progressionEngine.ts`, `calculateHuntXP()` — additive: `baseXP (100) +
  difficultyBonus ((difficulty-1)*20) + weightBonus (round(totalWeightKg * 1.5)) + rankBonus
  (S:80/A:50/B:25/C:0) + personalRecordBonus (40, if PR) + firstClearBonus (100, if first-ever clear of
  this workoutId)`. `totalWeightKg = weightKg * workout.gearCount` — **FIXED this session** to use the
  actual entered weight, not `workout.gearWeightKg` (see §12).
- **Levels**: simple arithmetic curve, `xpToReachNextLevel(level) = 100 + (level-1)*50`. `getLevelForTotalXP`
  walks cumulative thresholds; `getLevelProgress` gives a Hunter/Victory-ready progress-bar shape.
- **Ranks**: `src/utils/huntRank.ts` — `S` (PR, or ≤85% of target time), `A` (≤100%), `B` (≤115%), else `C`.
- **Titles**: `src/utils/hunterTitle.ts` — level-threshold lookup (`Novice Hunter` → `Hunter` (5) →
  `Veteran` (10) → `Slayer` (20) → `Champion` (35) → `Legend` (50)). Shown on the Hunter screen.
- **Achievements**: **PLANNED / NOT IMPLEMENTED** — `content/achievements/` exists only as a README
  describing the intent ("Authored starting Step 8"); no achievement JSON, no runtime code reads it.
- **Chronicle**: lifetime aggregate stats (see §3) — updated every `completeHunt` call: `totalWorkouts +=1`,
  `totalHuntsCompleted += 1`, `totalMonstersDefeated` recomputed from `monsterProgress`,
  `totalVolumeKg += weightKg * gearCount * totalReps` (**FIXED this session** — actual weight, see §12),
  streak fields updated by day-based logic in `workoutSlice`/`src/utils/timeline.ts`.
- **Hunts completed / Monster defeated**: see §4 (`MonsterProgress`).
- **Personal Best**: `WorkoutRepository.getResultsForWorkout(userId, workoutId)`, `Math.min` of prior
  `timeMinutes*60+timeSeconds` — recomputed fresh each time, never stored as a separate "PB" field.
  Scoped per `workoutId`, shared across a monster's 3 Encounters (see §4 limitation).

---

## 8. Timer System

Two entirely separate timing systems exist — do not conflate them:

1. **Standalone Timer feature** (5th root tab) — `engines/timer/useTimerSession.ts` +
   `useIntervalClock.ts`. Fully custom per-round work/rest, reps-based, open-ended, random-duration, and
   manual-start-gated intervals. Optionally links a Hunt workout's exercise names into its step labels
   (`linkedWorkoutId`) but does **not** touch Hunt state, HP, or `WorkoutResult` at all — it saves to its
   own `TimerResult` table. Deliberately parallel to, not code-shared with, `useWorkoutSession` (beyond the
   shared `useIntervalClock` 1-second tick primitive) — this is intentional, so Hunt flow changes never
   risk the Timer feature and vice versa.
2. **Hunt/session timers** (Active Hunt) — `engines/session/useWorkoutSession.ts` owns three values:
   - **Total time** — `elapsedSeconds`, ticks continuously through both Round and Rest phases, never
     pauses except on explicit Pause. **FIXED this session**: now also displayed as a small always-visible
     "Round X / Y · Total MM:SS" text line on Active Hunt (previously `elapsedClock` was computed but only
     used on the Victory screen). Reuses the pre-existing `elapsedClock` — no new state was created.
   - **Round time** — `currentRoundElapsedSeconds`, resets to 0 at the start of each round.
   - **Rest time** — `restRemainingSeconds`, only meaningful during the `'resting'` phase; now resolved
     from `hunt.restSecondsOverride ?? workout.restSeconds` (see §5).
   - Both Round and Rest are shown via a shared `TimerWidget` component (big mono-digit display) — the two
     are mutually exclusive on-screen (whichever phase is active), while Total is the separate small
     always-on line.
3. **Minotaur timing**: since `labyrinth-ladder` has `rounds: 1`, the `'resting'` phase never occurs during
   a real Minotaur Hunt today (`completeRound` goes straight to `WORKOUT_COMPLETED` after the one round) —
   `restSeconds: 60` in content is effectively inert in practice. **NEEDS VERIFICATION** on-device that
   this doesn't cause any UI glitch (static/bundle checks can't observe this).
4. **Known limitations**: rest-time reduction per Encounter (`restSecondsOverride`) is wired for the 5
   regular monsters but has **not been manually verified live-counting-down on a device** — see §11/§15.

---

## 9. Current UI / Screens

| Screen | File | Responsibility |
|---|---|---|
| World Map | `src/screens/hunt/WorldMapScreen.tsx` | Campaign-ordered monster nodes + final boss node, derived unlock/defeated state via `campaignState.ts` |
| Monster Detail | `src/screens/hunt/MonsterDetailScreen.tsx` | Per-monster Encounter list (locked/available/completed rows — sequential-lock-aware, see §4), bestiary/lore stats, "Begin X" CTA |
| Hunt Overview / Hunt Brief | `src/screens/hunt/HuntOverviewScreen.tsx` | Pre-Hunt info (monster/workout description, focus tags, Personal Best, Global Best "Coming Soon" placeholder), the actual-weight input block (**FIXED this session** — see §12), sticky "Begin Hunt" footer |
| Active Hunt | `src/screens/hunt/ActiveHuntScreen.tsx` | The live Hunt screen — countdown/round/rest state, Battle Engine HUD (HP bar, phase banner, damage pop, Critical Hit tag, portrait shake), Complete Round / Start Next Round controls |
| Hunt Complete / Victory | `src/screens/hunt/HuntCompleteScreen.tsx` | Final time/rank/PR, XP breakdown, Statistics card ("Weight Used" — actual weight, verified unambiguous), Exercise Breakdown card |
| Hunt Failed | `src/screens/hunt/HuntFailedScreen.tsx` | Shown on quitting mid-Hunt — no XP, not saved, instant retry |
| Hunter | `src/screens/hunter/HunterScreen.tsx` | Character sheet — title, level/XP bar, favorite monster/workout, recent Hunt, weight PR, fastest Hunt, next objective |
| Hunter's Journal | `src/screens/chronicle/ChronicleScreen.tsx` (in-app `<Header title="Hunter's Journal">`) | Today/Yesterday/date timeline, weekly/monthly summaries, training calendar, exercise stats, "weakness profile", longest-silence/most-dangerous-opponent story stats |
| Exercise Library | `src/screens/hunt/ExerciseLibraryScreen.tsx` | Searchable list of all library exercises |
| Exercise Detail | `src/screens/hunt/ExerciseDetailScreen.tsx` | Technique/benefits/mistakes, lifetime stats (sections-aware, **FIXED**), "Video coming soon" placeholder, related workouts (see §11 known bug) |
| Timer (Home/Builder/Run) | `src/screens/timer/Timer*.tsx` | Standalone Timer feature — separate from Hunts, see §8 |
| Forge / Settings | `src/screens/forge/ForgeScreen.tsx`, `src/screens/settings/SettingsScreen.tsx` | Forge shows read-only owned-equipment display (`WeightSelector`, editing "coming in a future update" — **not** the per-Hunt weight input, see §12/§13); Settings has app preferences + Campaign Reset (destructive button + confirm dialog, wipes `WorkoutResult`/`MonsterProgress`/`Chronicle`/XP for the user, leaves settings/equipment/content untouched) |
| Onboarding | `src/screens/onboarding/OnboardingScreen.tsx` | First-launch flow |

---

## 10. Exercise Library

- **Data**: `content/exercises/library.json` — flat array, ~31 entries. Fields: `id, name, description,
  category, recommendedWeightRangeKg: [min, max], musclesTrained[], benefits[], commonMistakes[]`.
- **Technique/benefits**: rendered directly from the library entry on Exercise Detail (`BulletList` for
  `musclesTrained`/`benefits`/`commonMistakes`).
- **Video**: **PLANNED / NOT IMPLEMENTED** — Exercise Detail renders a static "Video coming soon"
  placeholder block (`styles.videoPlaceholder`); no video asset system exists.
- **Player statistics**: `src/utils/exerciseStats.ts`, `getAllExerciseStats()` — per-exercise lifetime
  `totalReps, totalVolumeKg, totalSessions, lastPerformedAt`, derived from every `WorkoutResult` the user
  has, cross-referenced by exercise name via `getLibraryEntry`. **FIXED this session**: now correctly
  iterates `workout.sections` (when present) instead of only the flat `exercises` list — previously
  Behemoth's Phase II/III (8 of 12 movements) were silently missing from these stats.
- **Workouts where exercise is used ("related workouts")**: `ContentEngine.getWorkoutsContainingExercise` —
  **known bug, NOT fixed**: still only scans the flat `workout.exercises`, so it misses Behemoth/Weaver's
  section-only exercises. A movement that only appears in a `sections` phase won't show that workout in
  its "related workouts" list.
- **Navigation structure**: `ExerciseLibraryScreen` (search/list) → `ExerciseDetailScreen` (via
  `exerciseId` route param), also reachable directly from Hunt Brief's exercise rows and a World Map
  header icon.

---

## 11. Known Bugs / Technical Limitations

Only items actually known from the project/this conversation — nothing invented.

### Confirmed bugs
| Problem | Current behavior | File | Fixed? |
|---|---|---|---|
| `getWorkoutsContainingExercise` not sections-aware | Misses Behemoth/Weaver's section-only exercises in "related workouts" | `engines/content/ContentEngine.ts` | Not fixed — deferred out of scope when the related `exerciseStats.ts` bug was fixed |
| Weight input ignores `unitPreference` | Hunt Brief's weight block is hardcoded to kg display/input regardless of the user's kg/lb setting (Victory and Forge DO respect it) | `src/screens/hunt/HuntOverviewScreen.tsx` | Not fixed |
| `nextObjective.ts` not sequential-lock-aware | Can recommend a Hunt that Monster Detail would show as locked | `src/utils/nextObjective.ts` | Not fixed — intentionally out of scope |
| `'completed'` Hunt state still count-based | A save that completed Encounter 3 out of order (only possible pre-sequential-lock) could render `'locked'` instead of `'completed'` | `src/utils/huntState.ts` | Not fixed — pre-existing, documented |
| Minotaur HP vs. achievable damage | HP=800, current-coefficient full-Hunt damage ≈1668 (~209%) — boss always dies mid-round-1 | `content/monsters/minotaur.json` | Intentionally not fixed — explicitly excluded from this session's HP rebalance pending the ladder redesign |

### Missing features (PLANNED / NOT IMPLEMENTED)
- Minotaur ladder-per-rung mechanic (current workout is a flat 1-round stand-in).
- Adaptive (~5%) Minotaur progression — `Hunt.targetTimeIsEstimate` is content-authored on Minotaur's
  Encounter 2/3 but is **never read by any code** (confirmed by grep — declared in the `Hunt` type and set
  in content, otherwise dead).
- Global Best / leaderboard — explicit "Coming Soon" in Hunt Brief UI; no backend exists at all.
- Forge equipment editing — `WeightSelector` there is read-only, caption says "coming in a future update".
- Exercise video content.
- Partial-completion / skipped-exercise / self-penalty UI — `ROUND_COMPLETED`'s payload shape
  (`{ exercise, repsCompleted, skipped }` per exercise) was deliberately built to support this later
  without a reducer change, but every exercise is currently always reported fully completed.
- Achievements — folder reserved, nothing implemented.
- Several other scaffold folders with only a README, no implementation: `src/hooks/`, `src/animations/`,
  `src/types/`, `engines/sync/`, `engines/animation/`, `content/titles/` (titles themselves ARE implemented,
  just via `src/utils/hunterTitle.ts`, not this content folder).

### Technical debt
- `perfectExecutionDamage`/`relentlessAssaultDamage` are labeled "performance bonuses" but are not
  currently skill-gated — they fire every round under the always-full-completion assumption. Only
  `fastFinishDamage`/`personalRecordDamage` are genuinely skill-conditional today.
- Two separate, similarly-named "weight" UIs exist: per-Hunt actual weight (Hunt Brief) vs. owned-equipment
  display (Forge) — not confused in code, but worth being deliberate about if either is touched.
- `campaign_progress` SQLite table exists (schema + repository methods) but is not read/written in normal
  play — only touched by the Campaign Reset feature's clear call.
- `BattleConfig.personality?: BossPersonality` (`{id: string}`, reserved) is a separate, entirely unread
  field from `Monster.personality?: CombatPersonality` (which IS used, presentation-only).

### Design decisions (intentional — do not "fix")
- All 5 regular Campaign I monsters unlock immediately, no monster-to-monster campaign gate.
- Circular portrait containers — match the pre-composed circular-medallion artwork.
- `damageMultiplier` is `1.0` for every current monster — unused headroom in the current balance, not dead
  code.
- Weight does not affect battle damage (see §6/§13).

---

## 12. Recent Fixes (this development session)

1. **Total Time display during Active Hunt — FIXED.** Added a small always-visible "Round X / Y · Total
   MM:SS" text line on Active Hunt, reusing the pre-existing `elapsedClock` (previously computed but only
   shown on Victory). No new timer state created — satisfies "don't duplicate existing state."
2. **Campaign progress reset — FIXED (pre-existing feature, confirmed working).** Settings screen,
   destructive button + `Alert.alert` confirm. Wipes `WorkoutResult` (→ clears PB), `MonsterProgress`/
   `campaign_progress` (→ clears unlock/defeated state), `Chronicle` (→ zeroed), `User.level`/`totalXP`
   (→ reset). Leaves app/user settings, equipment, and all content untouched.
3. **Critical Hit animation dependency bug — FIXED.** `ActiveHuntScreen.tsx`'s damage-pop/Critical-Hit/
   portrait-shake `useEffect` used to depend on the whole `personality` object (rebuilt with a new
   reference every render, since all 6 monsters have `accentColor`), causing the fade animation to restart
   on every render — including the once-per-second timer tick — so the tag could get visibly stuck.
   Root-caused to 'steady'-personality bosses (Leviathan, Behemoth — the highest `animationPace`, so most
   reliably reproduced) but the underlying bug affected every monster. Fixed by depending on the three
   primitives actually used (`animationPace, heavyHitThreshold, shakeDistance`) instead of the object.
4. **Behemoth exercise statistics / sections bug — FIXED.** `src/utils/exerciseStats.ts`'s
   `getAllExerciseStats` now iterates `workout.sections.map(s => s.exercises)` when present, falling back
   to `[workout.exercises]` otherwise — previously only ever read the flat list, silently missing Phase
   II/III's 8 movements from Behemoth's Exercise Detail lifetime stats.
5. **Hunt Brief description wrapping — FIXED.** `HuntOverviewScreen.tsx`'s `styles.description` gained
   `width: '100%'` — its parent `briefHeader` uses `alignItems: 'center'`, which otherwise let a long
   `workout.description` (e.g. Leviathan's) overflow instead of wrapping. Same-file, same-style-block
   change only; no font/size/color/GlassCard change.
6. **Monster HP balancing — FIXED.** Simulated full-Hunt achievable damage against each monster's
   canonical workout+damage-coefficients, found systematic mismatch (Behemoth/Minotaur under-HP'd — died
   in round 1; Arachne/Hydra/Leviathan/Weaver over-HP'd — 20–25% HP left after a full clear), then applied
   the analyzed recommendation as a content-only change: Arachne 820→**765**, Behemoth 950→**1930**, Hydra
   850→**655**, Leviathan 900→**670**, Weaver 1400→**1220**. Minotaur (800) intentionally **not** touched
   — see §5/§11.
7. **Encounter `restSecondsOverride` — FIXED.** See §5. Content already had decreasing per-Encounter
   values authored for all 5 regular monsters; the runtime simply never read them before this fix.
8. **Sequential encounter unlocking — FIXED.** See §4.
9. **Actual player-entered kettlebell weight ("Weight Per Hunt") — FIXED.** See §13 for the full
   navigation/store data flow. Summary: `HuntOverviewScreen.tsx` gained a validated weight input (default
   = `workout.gearWeightKg`, must be a positive number ≤ 60) directly above "Begin Hunt"; the value travels
   via `ActiveHunt` route param `weightKg?: number` → `ActiveHuntScreen` → `completeHunt({ ...,
   actualWeightKg: weightKg })` → `const weightKg = actualWeightKg ?? workout.gearWeightKg` (the one
   fallback point) → drives `WorkoutResult.weightValueA/B`, XP's weight component, `Chronicle.totalVolumeKg`,
   and `HuntSummary.weightKg` (→ Victory "Weight Used" stat + Exercise Breakdown). No SQLite schema change
   was needed (`weightValueA/B`/`weightUnit` columns already existed).
10. **Verified — no change needed**: Victory's weight label was checked for ambiguity with "recommended
    weight" — it already reads **"Weight Used"**, already unambiguous, left untouched.
11. **Verified — old Behemoth reps bug already closed**: re-checked Hunt Brief/Active Hunt/Victory/Exercise
    Breakdown against canonical `iron-ascent` sections — all four already matched exactly (the fix was #4
    above, applied earlier in the session; this was a confirmation pass, no code changed).

---

## 13. Important Design Decisions (do not accidentally undo)

- **Battle Engine does not use kettlebell weight for damage.** Confirmed by direct grep — zero references
  to weight in `damageResolver.ts`/`useBattleEngine.ts`. This was explicitly re-confirmed before building
  Weight Per Hunt, and the feature was built to route weight only into
  XP/Volume/Chronicle/WorkoutResult/Victory/Exercise-Breakdown — never into damage/HP.
- **Actual workout weight is stored separately from the canonical recommended weight.**
  `workout.gearWeightKg` (content) is permanent and never mutated by a completed Hunt. The player's actual
  weight lives only in that Hunt's `WorkoutResult` row (`weightValueA/B`) and the transient `HuntSummary`.
- **`gearCount` remains content-driven** — the player is never asked how many kettlebells; only the
  per-bell weight. `weightValueB = gearCount === 2 ? weightKg : null` — both bells always share the single
  entered value (no independent second-bell weight entry exists).
- **SQLite schema already supported actual weight — no migration was needed.** `weight_value_a`,
  `weight_value_b`, `weight_unit` existed from `migration1`; Weight Per Hunt only changed *where the value
  written to them comes from*.
- **`completeHunt`'s `actualWeightKg` parameter is optional and additive.** Every pre-existing call shape
  (without it) still works — `actualWeightKg ?? workout.gearWeightKg` is the sole fallback point, applied
  once, at the top of the function.
- **`Hunt.restSecondsOverride` only affects rest timing.** It does not change rounds, damage, HP, workout
  structure, or Personal Best logic — confirmed by design and by the implementation (only one line in
  `useWorkoutSession.ts` reads it).
- **Minotaur is intended to eventually become a real ladder/per-rung mechanic** — the current `rounds: 1`
  flat workout is a deliberate stand-in, not a design decision to keep. Its HP was left unbalanced on
  purpose, pending that redesign — do not "fix" the HP without first fixing the ladder mechanic, or you'll
  balance against the wrong workout shape.
- **`ROUND_COMPLETED`'s per-exercise payload already carries `repsCompleted`/`skipped`** specifically so a
  future partial-completion feature needs no reducer change — don't restructure this shape casually.
- **Forge's `WeightSelector` is a different concept from Weight Per Hunt** — owned-equipment display, not
  a Hunt-time input. Do not merge these two UIs without an explicit task to do so.

---

## 14. Source-of-Truth Map

| System | Source of truth |
|---|---|
| Campaign/monster unlock & defeated state | `src/utils/campaignState.ts` (derived from `MonsterProgress` + content, never separately stored) |
| Per-Encounter locked/available/completed | `src/utils/huntState.ts` (`getHuntDisplayState`) |
| Monster content (HP, phases, personality, hunts) | `content/monsters/<id>.json`, loaded via `ContentEngine.ts` |
| Workout content (exercises, sections, reps, rest, gear, damage) | `content/workouts/workout.json`, loaded via `ContentEngine.ts` |
| Exercise library content | `content/exercises/library.json` |
| Campaign content (roster, final boss id) | `content/campaigns/campaign-1.json` |
| Battle damage / HP during a live Hunt | `engines/battle/useBattleEngine.ts` + `damageResolver.ts` |
| Round/rest/total timing during a live Hunt | `engines/session/useWorkoutSession.ts` |
| Workout completion / result persistence | `src/store/workoutSlice.ts` (`completeHunt`) — the single writer of `WorkoutResult` |
| Personal Best | Recomputed on demand from `WorkoutRepository.getResultsForWorkout` — never a stored field |
| Journal/Hunter statistics (lifetime) | `src/services/chronicleRepository.ts` (persisted aggregate) + `src/utils/exerciseStats.ts`/`chronicleSummary.ts`/`timeline.ts` (derived, on-demand) |
| XP / level | `engines/progress/progressionEngine.ts` |
| Actual per-Hunt weight | `WorkoutResult.weightValueA/B` (persisted) + `HuntSummary.weightKg` (transient, Victory-only) |
| Recommended/default weight | `workout.gearWeightKg` (content, never mutated) |
| Owned equipment (Forge) | `Equipment[]` (SQLite `equipment` table) — unrelated to per-Hunt weight |
| App/user settings | `src/services/settingsRepository.ts` |
| Standalone Timer state | `engines/timer/useTimerSession.ts`, its own `TimerResult`/`TimerPreset` tables |

---

## 15. Development Rules

1. Prefer minimal changes — smallest diff that satisfies the task.
2. Reuse existing architecture (repositories, slices, utils, components) instead of introducing new ones.
3. Do not create duplicate state when existing state already provides the required value (e.g. `Total Time`
   reused the existing `elapsedClock` rather than a new timer).
4. Do not change the Battle Engine unless a task explicitly requires it.
5. Do not change the database schema unless a task explicitly requires it — check whether existing
   columns already fit first (Weight Per Hunt needed none).
6. Do not modify content when the actual problem is runtime logic (e.g. `restSecondsOverride` was already
   correct in content — the bug was that runtime never read it).
7. Do not modify runtime logic when the actual problem is content.
8. Preserve backward compatibility — new parameters to shared functions (`completeHunt`,
   `getHuntDisplayState`, `useWorkoutSession`) should be optional, with a fallback that reproduces old
   behavior exactly when omitted.
9. Before changing code, identify the exact source of truth (see §14) rather than guessing.
10. Run `npx tsc --noEmit` after every change.
11. Run `npx expo export --platform android` (the Metro/Hermes bundle check) whenever runtime code or
    content that's loaded at bundle time is changed.
12. Check touched files for unused imports/dead code before finishing.
13. Never silently expand the scope of a task.
14. If a task reveals a separate problem, report it — don't fix it automatically unless asked.
15. When uncertain, inspect the existing architecture before introducing anything new.

**Currently pending manual verification (not yet tested on a physical device — static/bundle checks only):**
Weight Per Hunt end-to-end feel (numeric input, validation UX, on-device keyboard), sequential-lock visuals,
live rest-time countdown per Encounter, and the rebalanced HP values' actual in-Hunt pacing. Treat these as
the top priorities for manual testing before further iterating on them.
