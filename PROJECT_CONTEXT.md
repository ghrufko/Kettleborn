# KETTLEBORN — PROJECT CONTEXT

Generated from direct source inspection (not from memory/assumption). Read
this first in a new chat; verify any specific value against the actual
file before editing it — content and code can move between sessions.

---

## 1. PROJECT OVERVIEW

Kettleborn is a React Native / Expo mobile app that turns kettlebell
training into an RPG boss fight. Each **Hunt** is a real kettlebell
workout mapped onto a monster fight: completing exercise reps deals
damage to a boss's HP bar; finishing the prescribed workout defeats it.

**Core loop:** World Map → pick a monster → pick a Hunt (Level) →
Hunt Overview (set weight, see recommended reps) → Active Hunt (real-time
workout + live boss HP bar + timer) → Hunt Complete/Victory (XP, rank,
PR, RPE prompt) → back to World Map/Journal.

**Vocabulary, as the code actually uses it:**
- **Campaign** — a set of monsters (`content/campaigns/`). Only Campaign
  1 exists and is content-complete.
- **Monster** — one boss (`content/monsters/*.json`), has `battle` config
  (HP, damage multiplier, phases, performance bonuses) and `hunts[]`.
- **Hunt** — one specific *encounter/attempt* at a monster. A monster has
  up to 3 Hunts ("Level 1/2/3" in product language), each with its own
  `id`, `order`, `name`, and a `workoutId` it points at.
- **Level 1/2/3** — informal name for a monster's 3 `Hunt` entries
  (`order: 1/2/3`). For every monster except Weaver, **all 3 Hunts of one
  monster share the exact same `workoutId`** — they differ only via
  `Hunt.restSecondsOverride` (progressively shorter rest) and sometimes
  `targetTimeIsEstimate`. Weaver has only 1 Hunt (final boss, no Levels).
- **Workout** — the actual exercise program (`content/workouts/workout.json`),
  keyed by `workoutId`. Owns rounds, exercises/sections, gear, damage
  content, target time, finisher.

**How a player goes through a Hunt:** World Map → Monster Detail (see
Hunts/Levels, locked/available/completed) → Hunt Overview (enter weight,
review exercises, see Personal Best) → Active Hunt (live round-by-round
combat) → Hunt Complete (XP/rank/PR, RPE picker) → back to World Map.

---

## 2. ARCHITECTURE

React Native + Expo SDK 57, TypeScript, functional components + hooks.
No backend, no auth, no network calls — 100% offline, single hardcoded
local user (`LOCAL_USER_ID`).

- **`src/models/`** — pure TS types for content and persisted shapes.
  `Content.ts` (Monster/Workout/Exercise/Hunt/Campaign), `WorkoutResult.ts`
  (the persisted per-Hunt row, incl. `rungLaps`, `rpe`), `Timer.ts`
  (TimerPreset/TimerInterval/TimerResult), `Equipment.ts`,
  `ExerciseLibrary.ts`, `Chronicle.ts`, `Progress.ts`, `User.ts`,
  `Settings.ts`, `Lore.ts`.
- **`src/screens/`** — one folder per feature area: `hunt/` (WorldMap,
  MonsterDetail, HuntOverview, ActiveHunt, HuntComplete, HuntFailed,
  ExerciseLibrary/Detail, Home), `hunter/`, `chronicle/` (Journal),
  `timer/` (TimerHome, TimerBuilder, TimerRun), `settings/`,
  `onboarding/`, `forge/`, `shared/`.
- **`src/components/core/`** — `Button`, `GlassCard`, `Header`,
  `AppBackground`, `LevelUpModal`. **Important quirk:** `Button.tsx`
  forwards its `style` prop only to its inner `Animated.View`, never to
  the outer `Pressable` — so `flex`/layout-affecting styles on a `Button`
  do nothing in a flex row unless the `Button` itself is wrapped in a
  sized `View`. (Discovered and worked around in `ActiveHuntScreen`.)
- **`src/components/{workout,monster,progress,navigation}/`** —
  `TimerWidget` (has a `compact` prop, opt-in, default `false`, used only
  by `ActiveHuntScreen`), `WeightSelector` (Forge-only, distinct from Hunt
  Overview's own inline weight stepper), `MonsterCard`, `ProgressBar`,
  `BottomNavigation` (custom tab bar renderer, honors
  `tabBarStyle: { display: 'none' }` set via `navigation.getParent()?.setOptions()`).
- **`src/store/`** — Zustand slices (`workoutSlice`, `userSlice`,
  `chronicleSlice`, `settingsSlice`, `timerSlice`, `progressSlice`)
  combined in `src/store/index.ts`. `src/store/types.ts` is the single
  authoritative interface for every action/selector signature.
- **`src/services/`** — one repository per persisted entity
  (`workoutRepository.ts`, `userRepository.ts`, `chronicleRepository.ts`,
  `timerRepository.ts`, `settingsRepository.ts`, `progressRepository.ts`)
  + `db/database.ts` (connection/migration runner) + `db/schema.ts` (all
  migrations).
- **`engines/`** — business logic, separate from UI:
  - `content/ContentEngine.ts` — singleton, the **single read path** for
    all monster/workout/exercise/lore/campaign JSON content. Includes
    `getMonster`, `getWorkout`, `getHunt`, `getExerciseLibraryEntryByName`.
  - `battle/useBattleEngine.ts` (reducer over `ROUND_COMPLETED`/
    `WORKOUT_COMPLETED`) + `battle/damageResolver.ts` (pure per-exercise
    damage math).
  - `session/useWorkoutSession.ts` — round/rest/countdown state machine
    driving Active Hunt.
  - `timer/useTimerSession.ts` — standalone Timer tab's session engine,
    `flattenPreset()` lives here.
  - `progress/progressionEngine.ts` — XP formula + level curve.
  - `audio/AudioEngine.ts`, `animation/`, `sync/` (exists, unused — no
    backend to sync with).
- **`src/utils/`** — pure derivation helpers: `huntRank.ts`,
  `rankHistory.ts`, `exerciseBreakdown.ts`, `exerciseStats.ts`,
  `monsterHistory.ts`, `chronicleSummary.ts`, `chronicleStory.ts`,
  `bossPersonality.ts`, `weight.ts`, `flavorText.ts`, `huntAtmosphere.ts`,
  `campaignState.ts`, `nextObjective.ts`, `huntState.ts` (locked/
  available/completed derivation), `roundStats.ts`, `milestones.ts`,
  `hunterTitle.ts`, `rpeLabels.ts` (RPE value→label map, shared between
  HuntComplete and Chronicle).
- **`content/`** — all game data as JSON: `monsters/` (6 files),
  `workouts/workout.json` (keyed by workout id), `exercises/library.json`
  (Exercise Library — canonical names/videos/notes), `timers/` (built-in
  presets, currently unused by Timer Home UI), `lore/`, `achievements/`,
  `hunts/`, `titles/`, `campaigns/`.
- **SQLite** — one local DB, `src/services/db/schema.ts`, 6 additive
  migrations (see §5). Tables: `user`, `monster_progress`,
  `campaign_progress`, `workout_result`, `chronicle`, `settings`,
  `equipment`, `timer_preset`, `timer_result`.
- **Navigation** — `@react-navigation`: `RootNavigator.tsx` (native-stack,
  wraps `MainTabs`) → `MainTabs.tsx` (bottom-tabs, custom `tabBar` render
  prop = `BottomNavigation`, 5 tabs: HuntTab/TimerTab/ChronicleTab/
  HunterTab/ForgeTab) → per-tab native-stacks (`HuntStack.tsx`,
  `TimerStack.tsx`, `ChronicleStack.tsx`, `HunterStack.tsx`,
  `ForgeStack.tsx`). Route param types centralized in
  `src/navigation/types.ts`.

---

## 3. GAMEPLAY DATA FLOW

```
content/workouts/workout.json (rounds, sections|flat exercises,
  targetTimeSeconds, gearWeightKg, gearCount, restSeconds)
        │
        ▼
HuntOverviewScreen — player sets weight (display-unit-converted,
  stored/passed as kg); everything else here is read-only content
        │  navigation.navigate('ActiveHunt', { monsterId, huntId,
        │                                      workoutId, weightKg })
        ▼
ActiveHuntScreen
   ├─ useWorkoutSession — round/rest/countdown timing, laps[]
   │    (repsCompleted for each exercise is hardcoded to
   │     exercise.targetReps ?? 1 — always assumed fully completed,
   │     no UI lets the player enter a different actual rep count)
   └─ useBattleEngine — HP/damage state, driven by
        resolveExerciseDamage(exercise, repsCompleted) — reads only
        exercise.damageCoefficient/damageType + repsCompleted;
        NEVER reads weight
        │  (on finish)
        ▼
workoutSlice.completeHunt({ elapsedSeconds, actualWeightKg, rungLaps?, ... })
   ├─ rank = getHuntRank(elapsedSeconds, workout.targetTimeSeconds,
   │           isPersonalRecord)   — time-only, never reads weight/reps
   ├─ xp = calculateHuntXP({ difficulty, actualWeightKg,
   │         recommendedWeightKg: workout.gearWeightKg,
   │         gearCount: workout.gearCount (ALWAYS canonical, never
   │           player-chosen — no UI exists to change gearCount),
   │         totalReps (canonical, via getExerciseBreakdown, never
   │           what the player actually did), priorClearsOfThisWorkout,
   │         rank, isPersonalRecord, isFirstClear })
   ├─ WorkoutRepository.saveResult() → SQLite INSERT
   │    (weightValueB is set to weightKg IF workout.gearCount === 2,
   │     ELSE null — derived from canonical content, not an actual
   │     player choice of 1 vs 2 bells)
   └─ Chronicle/MonsterProgress/User updated in the same transaction
        │
        ▼
HuntCompleteScreen — reads transient HuntSummary (in-memory only)
   └─ RPE picker (Easy/Solid/Hard/Brutal) → setResultRPE(resultId, value)
        → separate UPDATE on the row just inserted (rpe stays NULL
          until this fires; skipped forever if the player doesn't tap one)
        │
        ▼
Journal/Chronicle — re-fetches WorkoutResult history on every tab focus
  (useFocusEffect, not useEffect — this screen stays mounted across tab
  switches), re-derives rank/volume/exercise stats fresh every time;
  entry card now also shows "· Felt: {RPE label}" when result.rpe is set
```

**Where each thing actually lives:**
- **weight** — `Workout.gearWeightKg` (canonical recommendation, content)
  vs. `route.params.weightKg` / `WorkoutResult.weightValueA` (what the
  player actually entered on Hunt Overview). The only player-customizable
  parameter today.
- **gearCount** — `Workout.gearCount: 1 | 2`, a single value for the
  *whole* workout (not per-exercise/phase). Never player-editable.
  `WorkoutResult.weightValueB` is non-null iff `workout.gearCount === 2` —
  there is no dedicated `gearCount` column on `WorkoutResult`.
- **reps** — `Exercise.targetReps`, content-authored, always assumed
  fully completed by the Session Engine. No live rep counter, no
  player-entered actual value anywhere.
- **duration** — `Exercise.durationSeconds`, content-authored *estimate*
  for `per_second`/`over_time` damage exercises — never measured live.
- **rest** — `Workout.restSeconds`, optionally overridden per-Hunt by
  `Hunt.restSecondsOverride` (this is the actual Level 2/3
  difficulty-escalation mechanism today).
- **damage** — `engines/battle/damageResolver.ts`, pure function of
  `exercise.damageCoefficient` + `damageType` + `repsCompleted` (see
  above — always canonical). Never reads weight.
- **HP** — `Monster.battle.hp`, hand-derived to exactly equal the
  baseline achievable damage total for that monster's workout (see §5).
- **XP** — `engines/progress/progressionEngine.ts`, `calculateHuntXP()`.
  Weight matters here (via `weightBonus`, ratio-clamped to [0.5, 1.5]
  against `recommendedWeightKg`); gearCount and totalReps are always
  canonical, never actual player performance.
- **rank** — `src/utils/huntRank.ts`, `getHuntRank()`. Time-only:
  `elapsedSeconds` vs `workout.targetTimeSeconds` (± thresholds), or
  automatic `S` on a PR.
- **PR** — `workoutSlice.getBestTimeSeconds` / `getBestResult`, scoped by
  **`workoutId`**, not `huntId`. Since a monster's 3 Levels share one
  `workoutId`, they already share one PR pool today — a fast Level-1
  clear and a fast Level-3 clear compete for the same "personal best."
- **RPE** — `WorkoutResult.rpe`, set via a separate `UPDATE` after the
  row exists (see §7). Never read by XP/rank/damage/HP.

---

## 4. MONSTER / WORKOUT STRUCTURE

- **Flat workouts** — `Workout.exercises: Exercise[]`, same list repeats
  every round (`workout.rounds` times). Used by Arachne, Hydra, Leviathan.
- **Sectioned workouts** — `Workout.sections: { label, exercises }[]`,
  one distinct exercise list per round; `sections.length` must equal
  `rounds`. Used by Behemoth (3 phases), Minotaur (19 rungs), Weaver
  (5 rounds, each a themed excerpt of another monster's own workout).
  **Convention (not enforced by code):** a sectioned workout's flat
  `exercises[]` always mirrors `sections[0]` — a real fallback several
  code paths still read (e.g. Timer's Exercise Slot, see §8).
- **Minotaur ladder** — `labyrinth-ladder` workout, 19 rounds, real
  1→10→1 rung structure, `stepLabel: "Rung"` (pure UI label override —
  Session/Battle Engines are round-count-agnostic either way). Per-rung
  timing persisted via `WorkoutResult.rungLaps` (only populated for this
  one `stepLabel: "Rung"` workout; `null` for every other result).
- **Behemoth phases** — `iron-ascent`, 3 sections ("The Colossus" /
  "The Climb" / "The Summit"), `gearCount: 2` at the whole-workout level
  even though Phase II's exercise names ("Snatch", "Press", etc.) imply
  single-bell work — the content model has no per-phase gear-count field.
- **Weaver structure** — `the-final-trial`, 5 sections, each a
  near-copy of an excerpt from one of the other 5 monsters' own content
  (same exercise names/coefficients, sometimes different reps) —
  **deliberate**, the "Final Trial" callback design, not drift to clean up.
- **`displayName` vs `name`** — `Exercise.name` is the **routing key**:
  Exercise Library lookup (`getExerciseLibraryEntryByName`, exact
  case-insensitive match) and Journal per-exercise lifetime stat
  aggregation both key off it. `Exercise.displayName` (optional) is a
  **visual-only** override, read at exactly 3 UI call sites (Hunt
  Overview, Active Hunt, Hunt Complete's Victory breakdown). Currently
  set only for Behemoth's Phase I and Weaver's Behemoth-themed section
  (both show "Double Snatch" instead of the routing name "Tactical
  Double Snatch"). **Never rename `.name` to fix a display issue** — use
  `.displayName` instead, or Library/Journal routing silently breaks.

---

## 5. CRITICAL GAMEPLAY INVARIANTS

- **HP is calibrated exactly against canonical workout damage.**
  `HP = Σ(per-round exercise damage × damageMultiplier) + roundBonusDamage×rounds
  + perfectExecutionDamage×rounds + relentlessAssaultDamage×⌊rounds/streak⌋`,
  verified exact (ratio 1.000) for all 6 monsters as content currently
  stands. There is **zero margin for error** — a player must complete
  literally every prescribed rep to defeat any monster; the only buffer
  is conditional overkill bonuses (fast finish / PR), and PR is
  structurally unavailable on a first-ever attempt. Changing exercise
  reps/coefficients without recalculating HP (or vice versa) breaks this
  silently for that monster.
- **`damageResolver.ts` / `useBattleEngine.ts`** — the entire
  combat-damage pipeline. Any change here silently invalidates the HP
  calibration above for every monster at once, not just one.
- **`progressionEngine.ts`** — XP formula + level curve, already
  redesigned once specifically to close exploits (self-reported weight,
  repeat-farming via `repeatDecayGraceClears`/`repeatDecayFloor`).
  Casual changes can reopen those.
- **Rank formula (`huntRank.ts`)** is deliberately simple/time-only —
  don't fold in other factors without an explicit product decision.
- **PR scoping is per-`workoutId`, not per-`huntId`** — already true
  today (see §3). Any change here (e.g. splitting PR pools) is a real
  product+schema decision, not a bugfix.
- **`WorkoutResult` persistence** — one row per completed Hunt, RPE
  updates the *same* row after the fact via a dedicated `UPDATE`, never a
  second row. No row is ever deleted or overwritten except that one RPE
  `UPDATE`. **Superseded in part by §16 (Encounter Lock):** for a locked
  Encounter 2/3 (every Hunt today), a *slower* completion now saves NO
  row at all — the invariant still holds for every row that DOES exist
  (still exactly one per counted completion, still never overwritten),
  it just no longer means "every physical completion is saved."
- **Navigation flow** — `ActiveHunt`/`HuntComplete`/`HuntFailed` are all
  registered with `gestureEnabled: false` (no accidental back-swipe mid-
  combat or off a result screen).
- **SQLite backward compatibility** — every migration so far (1→6) is
  strictly additive: `CREATE TABLE IF NOT EXISTS` or nullable/defaulted
  `ALTER TABLE ... ADD COLUMN`. Never destructive, never a non-nullable
  column added to an existing table without a default. This must hold
  for any future migration too, or existing local installs break on
  update.
- **No test harness** — no jest, no `*.test.ts` files anywhere.
  Validation is `npx tsc --noEmit` + `npx expo export --platform android`
  + manual numeric/behavioral checks. No git either — file-change
  verification in this environment is by inspection/diffing content you
  read yourself, not `git diff`.

---

## 6. RECENT IMPLEMENTED FEATURES

**Exercise Slot in Timer Builder** — `TimerInterval.isExerciseSlot` +
`TimerPreset.linkedWorkoutId`/`randomizeExercises`. WHERE:
`engines/timer/useTimerSession.ts` (`flattenPreset()`),
`src/screens/timer/TimerBuilderScreen.tsx` (UI toggle, only shown once a
workout is linked). WHY: let a custom timer reuse a real Hunt workout's
exercise names as round labels instead of manual typing. NOT changed:
sections-awareness (see §8/§10 — known, deferred limitation).

**Post-Hunt RPE** — `WorkoutResult.rpe` (migration 6), 1–4
(Easy/Solid/Hard/Brutal). WHERE: picker in `HuntCompleteScreen.tsx`
(`RPE_OPTIONS` local constant), saved via
`workoutSlice.setResultRPE` → `WorkoutRepository.updateRPE`. WHY: let the
player self-report perceived effort without inventing a whole new system.
NOT changed: XP/rank/damage/PR — RPE is purely descriptive (see §7).

**Monster Performance History utility** — `getMonsterHistory()` exists
(reuses existing rank computation, latest N results for one monster).
NOT wired into any UI yet — a real, unused, deliberately-deferred helper.

**Active Hunt sweaty-hands UX fixes** — 48px minimum Button touch target
+ hitSlop, Pause/Quit spacing, larger exercise name/reps text. WHERE:
`src/components/core/Button.tsx` (`minHeight: 48`),
`src/screens/hunt/ActiveHuntScreen.tsx`. WHY: real-device usability
during an actual workout, not aesthetic.

**TimerWidget compact mode** — `TimerWidget` gained an optional
`compact?: boolean` prop (default `false`), trimming padding/digit size.
WHERE: `src/components/workout/TimerWidget.tsx`. WHY: Active Hunt's timer
was eating too much vertical space on a real phone; `TimerRunScreen`
(the standalone Timer tab) does NOT pass `compact` and is untouched.

**Calendar TODAY alignment** — `ChronicleScreen.tsx`'s
`calendarDayText` style. Went through two failed attempts (tight
`lineHeight` + `includeFontPadding`/`textAlignVertical`; then an explicit
fixed `height`/`width` on the Text) before landing on the actual fix: a
generously-larger `lineHeight` (20, vs `fontSize.xs`=12) with no explicit
height — the standard "line-height taller than font-size centers the
glyph within its own line" technique. Circle size/color/TODAY-logic
untouched throughout all three attempts.

**RPE display in Chronicle/Journal** — Journal's Timeline entry card now
appends `· Felt: {label}` to its detail line when `result.rpe` is set
(nothing rendered for `null`, no invented values for old results). WHERE:
`ChronicleScreen.tsx` + new `src/utils/rpeLabels.ts` (shared
value→label map, extracted from `HuntCompleteScreen`'s local
`RPE_OPTIONS` so the two don't duplicate the list — `HuntCompleteScreen`
itself was left untouched). No aggregate stats (Average RPE, Easy/Hard
counts) were added — deliberately deferred, not a natural fit found yet.

**Front Rack Carry damage fix** — `per_second`/`over_time` exercises
with no `durationSeconds` silently deal 0 damage; fixed by adding a
content-authored `durationSeconds` to Leviathan's own workout AND
Weaver's Leviathan-section duplicate of it (both places it appears).
Pure content fix, no engine change.

**Weaver `displayName` fixes** — Weaver's Behemoth-themed section got
the same `displayName` override Behemoth's own Phase I has, so "Double
Snatch" displays consistently across both places that exercise appears.

**Hunt Overview weight unit support** — the weight input/stepper now
respects `settings.unitPreference` (kg/lb) consistently with Victory —
was previously hardcoded to kg display regardless of setting. Internal
storage/validation is still always kg (`src/utils/weight.ts`
`convertKgToDisplay`/`convertDisplayToKg`).

**Weaver section-label cleanup** — section labels de-duplicated
("Minotaur — Round 1" → "Minotaur") to stop colliding visually with the
separate live round counter.

**Active Hunt layout/overlap fixes (most recent session)** —
- Combat feedback overlay (`feedbackAnchor`) went from `height: 0` with
  absolutely-positioned children (which overlapped the round card below,
  then — second pass — overlapped *each other* when several bonuses fired
  at once) to a fixed non-zero height (108) with children in **normal
  flex-column flow**, not per-element absolute offsets. No more magic
  pixel-offset guessing.
- `phaseBanner` moved from `top: '38%'` (which coincided with the
  feedback zone on real device proportions) to anchored near the top of
  the safe area — a separate strip, can't collide with hit feedback.
- Pause/Quit and Finish Hunt: root cause of "not full width / not
  centered" was `Button.tsx` only forwarding `style` to its inner
  `Animated.View`, never the outer `Pressable` — so `flex: 1` set
  directly on a `Button` did nothing in a row. Fixed by wrapping each
  `Button` in its own `flex: 1` View in `ActiveHuntScreen` instead of
  touching the shared `Button.tsx` (used everywhere else in the app).
- Bottom tab bar now hides while `ActiveHuntScreen` is focused, via
  `navigation.getParent()?.setOptions({ tabBarStyle: { display: 'none' } })`
  in a `useFocusEffect`, restored on blur (when HuntComplete/HuntFailed
  gets pushed on top). Only this one screen affected.

---

## 7. CURRENT RPE SYSTEM (end-to-end)

```
Hunt Complete screen (HuntCompleteScreen.tsx)
  → local RPE_OPTIONS = [Easy(1), Solid(2), Hard(3), Brutal(4)]
  → player taps one → setSelectedRPE(value) [local UI state]
                     → setResultRPE(summary.resultId, value)
                         │
                         ▼
workoutSlice.setResultRPE(resultId, rpe)
  → WorkoutRepository.updateRPE(resultId, rpe)
      → UPDATE workout_result SET rpe = ? WHERE id = ?
        (targets the SAME row saveResult() already inserted at Hunt
         completion — rpe starts NULL at insert time, migration 6)
                         │
                         ▼
WorkoutResult.rpe: number | null  (1–4, or null forever if skipped /
  if the result predates this feature)
                         │
                         ▼
ChronicleScreen.tsx Timeline entry card
  → getRPELabel(result.rpe)  [src/utils/rpeLabels.ts]
  → appends "· Felt: {label}" to the entry's detail line, only when
    non-null — nothing rendered, nothing invented, for null
```

**RPE currently does NOT affect:** XP (`progressionEngine.ts` never
reads it), rank (`huntRank.ts` never reads it), damage
(`damageResolver.ts`/`useBattleEngine.ts` never read it), or any other
progression system. It is purely a self-reported, display-only label.

---

## 8. CURRENT TIMER / EXERCISE SLOT SYSTEM

- **`TimerInterval.isExerciseSlot?: boolean`** (`src/models/Timer.ts`) —
  if true *and* the preset links a workout, this interval's `label` is
  replaced at runtime with an exercise name from that workout.
- **`DraftRound.isExerciseSlot`** — the Timer Builder's local draft-state
  mirror of the same flag, toggled per-round in
  `TimerBuilderScreen.tsx`'s UI (toggle only rendered once
  `linkedWorkoutId` is set).
- **`TimerBuilder`** (`TimerBuilderScreen.tsx`) — lets the player author
  rounds/intervals by hand, optionally set `linkedWorkoutId` (picked from
  real Hunt workouts) and `randomizeExercises`.
- **`flattenPreset()`** (`engines/timer/useTimerSession.ts`) — the actual
  resolution logic. Reads `preset.linkedWorkoutId` →
  `contentEngine.getWorkout(...)` → **`workout.exercises.map(name)`
  only** — never touches `workout.sections`. Optionally shuffles once
  (`randomizeExercises`) if set. Then walks every round/interval; for
  each `isExerciseSlot` interval (only if `exerciseNames.length > 0`),
  assigns `exerciseNames[exerciseCursor % exerciseNames.length]` and
  increments a **single shared cursor across the whole preset** (not
  reset per round) — so slots keep cycling forward through the same name
  list round after round rather than restarting each round.
- **Fallback behavior:** if there's no linked workout, the workout isn't
  found, or `exerciseNames` is empty, `isExerciseSlot` intervals simply
  keep their original authored `label` — no crash, silent no-op.

**Known, confirmed limitation (explicitly deferred, not yet fixed):**
sectioned workouts (Behemoth, Minotaur, Weaver) currently resolve
Exercise Slot labels from `workout.exercises` — their flat top-level
array, which by convention only ever mirrors `sections[0]`. Linking one
of these workouts to a timer therefore only ever surfaces that workout's
**first phase/rung's** exercises, never the full `sections[]` set.

---

## 9. CUSTOM HUNT — IMPLEMENTED (V1: weight + gearCount + rest)

Fully implemented, validated (`tsc --noEmit` clean, `expo export --platform android` succeeds). Lets a player run any monster's Hunt with their own equipment instead of canonical parameters — a separate mode selected on Hunt Overview, not an edit to the canonical Hunt.

**Scope:** weight, gear count (1/2), rest. **Explicitly NOT included:** reps, rounds, exercise duration, workout structure, phases/rungs, target time — these feed `repsCompleted` → `damageResolver.ts` → the HP calibration invariant (§5); making them player-editable needs a properly designed combat/scoring model, not attempted here.

**Data model:** `src/models/CustomHuntPreset.ts` — `{ userId, workoutId, weightKg, gearCount, restSeconds, updatedAt }`, keyed by `workoutId` (not `huntId`) — since a monster's Levels 1/2/3 share one `workoutId`, one saved row is read by every Level automatically, no propagation code exists or is needed. Weaver (1 Hunt, no Levels) just gets a normal one-off preset.

**Persistence:** SQLite migration 7 (`src/services/db/schema.ts`) — additive: `CREATE TABLE IF NOT EXISTS custom_hunt_preset` (composite PK `user_id, workout_id`, same upsert shape as `monster_progress`/`campaign_progress`) + `ALTER TABLE workout_result ADD COLUMN is_custom_hunt INTEGER NOT NULL DEFAULT 0`. `src/services/customHuntPresetRepository.ts` (`getByWorkoutId`, `upsert`). New `src/store/customHuntSlice.ts` (`getCustomHuntPreset`, `saveCustomHuntPreset`), registered in `src/store/index.ts`, typed in `src/store/types.ts` (`CustomHuntSlice`, part of `AppStore`).

**UI:** `src/screens/hunt/HuntOverviewScreen.tsx` — a "Training Mode" `GlassCard` (Canonical/Custom `MiniToggle`, gearCount `MiniToggle`, rest `RestStepper` — both new small screen-local components mirroring `TimerBuilderScreen`'s existing local `MiniToggle`/`Stepper` pattern exactly, no shared component was extracted). Existing weight input/stepper is reused as-is for both modes. Preset loads on mount (`getCustomHuntPreset(workout.id)`); if found, auto-selects Custom mode and seeds all three fields — this is the actual Level 2/3 auto-inheritance mechanism. Saved via `saveCustomHuntPreset` only when **Begin Hunt** is pressed (not on every keystroke/toggle), then navigates with the new params.

**Flow:** `HuntOverview` → `navigation.navigate('ActiveHunt', { ..., isCustomHunt, customGearCount, customRestSeconds })` (new fields on `HuntStackParamList['ActiveHunt']`, `src/navigation/types.ts`) → `ActiveHuntScreen.tsx` resolves `restSecondsOverride = isCustomHunt ? customRestSeconds : hunt?.restSecondsOverride` (canonical Hunts: byte-for-byte the same expression as before this feature existed) → `completeHunt({ ..., actualWeightKg, actualGearCount, isCustomHunt })` → `workoutSlice.completeHunt` (`src/store/workoutSlice.ts`) computes `gearCount = actualGearCount ?? workout.gearCount` and uses it for both `weightValueB` and the `calculateHuntXP` call (formula itself untouched, just fed the real value instead of always-canonical) → `WorkoutResult.isCustomHunt` saved on the row.

**Journal:** `src/screens/chronicle/ChronicleScreen.tsx` shows a small "Custom" badge next to the rank badge on entries where `result.isCustomHunt` is true.

**Known, accepted limitations (not bugs — documented product decisions from this implementation):**
- **PR pool is shared** between canonical and custom results — still scoped purely by `workoutId` (`getBestTimeSeconds`/`getBestResult`), unchanged. A lighter custom-weight clear can set/beat a canonical PR. Splitting PR pools was identified as needing a broader schema/query change and was deliberately not done.
- **Rank is unaffected** by Custom Hunt (still purely time-based, weight/gearCount/rest play no role) — this was correct to leave as-is, not a gap.
- **XP formula itself is unchanged** — only the `gearCount` input it receives is now real instead of always-canonical.
- Reps/rounds/duration/target-time remain a real, unstarted V2 if ever revisited — same reasoning as §5's HP-calibration invariant.

**Partially superseded by §16/§17 (Encounter Lock):** Custom Hunt (this section) is fully available for a monster's Encounter 1 (the real choice §17 restored) but NOT reachable for Encounter 2/3 (`order` 2-3), which lock to whichever exact config Encounter 1 actually used instead of offering a live choice — see §17. Also worth flagging: this section's own header ("V1: weight + gearCount + rest") is itself stale — `src/utils/customWorkoutStructure.ts` + migrations 9/10 later added reps-override and structural-rounds customization on top of this, undocumented here before now. Left as discovered, not fixed — out of scope for this change.

---

## 16. ENCOUNTER LOCK — "BEAT YOUR PREVIOUS RESULT" (IMPLEMENTED, PARTIALLY SUPERSEDED BY §17)

**§17 changed this section's core rule — read §17 first if you're touching Encounter Lock.** Originally, Encounter 1 was canonical-only (no Custom Hunt) and Encounter 2/3 always locked to Encounter 1's canonical config. A follow-up request explicitly reversed the canonical-only restriction: Encounter 1 is a real Canonical-or-Custom choice again, and Encounter 2/3 lock to whichever exact configuration (canonical OR custom) the previous encounter actually used. The progression-chain mechanics below (first-successful-result baseline, beat-the-target gate, no-save-on-slower, Reset Progress) are UNCHANGED and still accurate. What's stale in the prose below: "no Custom Hunt of any kind" for Encounter 1, "Zero schema changes" (§17 added migration11/12), `getLockedEncounterConfig`/`getEncounterTargetSeconds` (renamed/merged into `getEncounterLockState` — see §17), and "why §9's Custom Hunt UI has no live path" (it does now, for Encounter 1).

Fully implemented, validated (`tsc --noEmit` clean, `expo export --platform android` succeeds, plus a content audit — see below). A monster's first three Hunts (`Hunt.order` 1/2/3 — "Level 1/2/3" elsewhere in this doc, "Encounter 1/2/3" in the feature request that added this) now form a locked progression chain, superseding the Custom Hunt (§9) and per-Level rest-escalation (§15) decisions above for every Hunt they touch.

**Rule (as originally implemented — see §17 for the current rule):** Encounter 1 must be run with the canonical workout exactly as content defines it (no Custom Hunt of any kind — weight/gearCount/rest/structure/reps all locked to content). Its first-ever successful completion becomes the player's baseline. Encounter 2/3 are locked to that SAME canonical configuration (not their own `restSecondsOverride`) and only count — save, award XP, advance progress — if the attempt beats the time to beat. A slower attempt saves nothing, advances nothing, and the player just retries with the same locked setup.

**Zero schema changes (at the time — no longer true, see §17).** Everything is re-derived from existing `Hunt` content and existing `WorkoutResult` history — no new migration, no new columns. See `src/utils/encounterLock.ts` for the full derivation (`getLockedEncounterConfig`, `getEncounterTargetSeconds`, `isEncounterAttemptSuccessful`, `getEncounterOutcome`) and its own inline comments for exactly why Encounter 1's baseline uses the FIRST-ever result while Encounter 2→3's target uses the LATEST successful one.

**Content audit (confirmed against `content/monsters/*.json`):** 18 monsters have Hunts with contiguous `order` 1/2/3; Weaver has just `order: 1`. Max `order` anywhere in current content is 3. `LOCKED_ENCOUNTER_ORDERS = [1, 2, 3]` in `encounterLock.ts` therefore governs literally every Hunt that exists today.

**Where it lives (original — see §17 for what changed):**
- `src/utils/encounterLock.ts` (new) — all pure lock/target/success/outcome logic.
- `src/services/workoutRepository.ts` — new `getResultsForHunt` (results for one specific `huntId`, not the whole shared `workoutId` — needed because Level 1/2/3 share a `workoutId` but are distinct encounters) and `deleteResultsForMonster` (Reset Progress, below).
- `src/store/workoutSlice.ts` — `completeHunt` takes an optional `encounterTargetSeconds` (passed through from the caller's own gate, not re-checked) and stores `encounterOutcome`/`encounterTargetSeconds` on `HuntSummary` for Victory-screen display. New `getResultsForHunt` slice method.
- `src/screens/hunt/ActiveHuntScreen.tsx` — computes the locked config and effective `restSecondsOverride` from it instead of `hunt?.restSecondsOverride`/Custom Hunt params; fetches the target up front; on Finish Hunt, for `order > 1`, gates success BEFORE calling `completeHunt` — a failed gate routes to `HuntFailed` with `reason: 'not_faster'` instead, skipping save/XP entirely (same "no save, no XP, instant retry" handling `HuntFailed` already had for quitting mid-hunt).
- `src/navigation/types.ts` — `HuntFailed` params gained optional `reason`/`targetSeconds`/`elapsedSeconds`.
- `src/screens/hunt/HuntFailedScreen.tsx` — `reason: 'not_faster'` variant copy ("Not Fast Enough" / shows your time vs. the time needed / "this encounter does not count"), same screen/retry mechanics otherwise.
- `src/screens/hunt/HuntOverviewScreen.tsx` — for a locked Hunt, the "Training Mode" card is replaced by a read-only locked card, and the footer weight control becomes read-only.
- `src/screens/hunt/HuntCompleteScreen.tsx` — new badges: "Baseline Established" (Encounter 1's true first clear only, not replays) / "Encounter Beaten" (Encounter 2/3 success), plus a line naming the target that was beaten. Additive — existing Personal Record/First Clear/Task-7 comparison badges untouched.
- `src/store/progressSlice.ts` / `src/store/types.ts` — new `resetMonsterProgress(monsterId)` (Reset Progress, below).
- `src/screens/hunt/MonsterDetailScreen.tsx` — new "Danger Zone" card (only shown once `huntsCompleted > 0`) with a destructive "Reset Progress" button, same confirm-dialog pattern as Settings' existing "Reset Campaign Progress".

**Reset Progress (per-monster):** `resetMonsterProgress` deletes only that monster's `WorkoutResult` rows (`deleteResultsForMonster`, scoped by the existing `monster_id` column — can't touch other monsters, Custom Workouts, or Timer data, which live in unrelated/separate tables) and resets its `MonsterProgress` row to `huntsCompleted: 0, defeated: false`. Deliberately does NOT touch the lifetime `Chronicle` aggregate row (streak/XP/volume totals are left as-is — this is a per-monster progress reset, not an XP refund) or `campaign_progress` (confirmed unused for gating — see `campaignState.ts`, which reads `MonsterProgress.defeated` live). A monster that gates a final boss (`finalBossId`) CAN re-lock it as a natural, expected consequence, since that gating already reads live `MonsterProgress` — not something Reset Progress does itself. Still accurate under §17.

**Known limitations / assumptions (documented, not bugs — still relevant under §17):**
- **Legacy pre-feature `WorkoutResult` rows aren't guaranteed monotonic.** Anything saved before this feature shipped could include an order-2/3 completion slower than an earlier one for the same Hunt. Superseded/sharpened by §17's `isExact` flag for Custom Hunt rows specifically.
- **Encounter 1 replays never move the baseline**, even if a later replay is faster than the original first clear — matches the brief's literal "first successful result" wording, not "best."
- **The Victory-screen "Encounter Beaten"/"Baseline Established" badges are separate from the pre-existing Task 7 "Better/Slower Than Last Time" badges** (§6) — both can appear together, which is intentional.

---

## 17. ENCOUNTER LOCK + CUSTOM HUNT MERGE, CUSTOM WORKOUT JOURNAL INTEGRATION (IMPLEMENTED)

Follow-up to §16, fully implemented and validated the same way (`tsc --noEmit` clean, `expo export --platform android` succeeds). Two explicit corrections to §16 plus two independent additions, all from one request:

**A. Encounter 1 is a real Canonical-or-Custom choice again.** §16's "no Custom Hunt for Encounter 1" was an over-restriction the follow-up explicitly reversed. Encounter 1 now shows the full original Training Mode card (Canonical/Custom toggle, weight/gearCount/rest/structural-value/reps-overrides — everything Custom Hunt (§9) always had). Whichever mode the player picks, the first-ever successful result becomes the baseline — Custom Encounter 1 is "not a cheat," per the brief: the player is beating THEIR OWN chosen version of the monster from then on, never compared against the canonical target time.

**B. Encounter 2/3 lock to the PREVIOUS encounter's actual result, not always-canonical.** This needed real, new persistence — `WorkoutResult` never stored the rest/structural-value/reps-overrides a Custom Hunt result used (only `CustomHuntPreset` did, and that's the player's CURRENT preference, editable later, explicitly disqualified by the brief as a source for historical baseline data — see §12/§13 of that request). **Migration11** (`workout_result`: `rest_seconds_used`, `structural_value_used`, `reps_overrides_used_json`, all nullable) snapshots the exact configuration a Custom Hunt result used, immutably, at completion time. A canonical result needs none of this — its config is always re-derivable from content — so these three columns stay `null` for every canonical row, by design, not by omission.

**Legacy data (§13 of the request):** any Custom Hunt `WorkoutResult` row saved BEFORE migration11 has `rest_seconds_used = null`. `reconstructEncounterConfig` (`encounterLock.ts`) treats that specifically as `isExact: false` — weight/gearCount are still trusted (always stored, migration11 or not), but rest/structural-value/reps-overrides are defaulted to canonical as a best-effort fallback and this is surfaced, not hidden: `HuntOverviewScreen` shows an explicit "predates full configuration tracking" notice for a progression-locked encounter whose lock came from a legacy row. Never silently claimed as an exact baseline.

**`encounterLock.ts` was substantially rewritten**, not just extended:
- `reconstructEncounterConfig(hunt, workout, result) -> { config, isExact }` — what a SPECIFIC past result actually used. Canonical is always `isExact: true`; Custom is `isExact` iff `restSecondsUsed !== null`.
- `getEncounterLockState(previousHunt, previousWorkout, previousHuntResults) -> { targetSeconds, lockedConfig, isExact }` — replaces §16's separate `getLockedEncounterConfig` (which always returned canonical) + `getEncounterTargetSeconds`. Same first-for-baseline (Encounter 1→2) / latest-for-chain (Encounter 2→3, and beyond) selection rule as §16, now also carrying the WINNING result's own reconstructed config forward, not just its time.
- `encounterConfigsMatch(a, b)` — new, exact-equality across every field (weight/gearCount/rest/structuralValue/repsOverrides/isCustomHunt). Used by `workoutSlice.completeHunt`'s Task-7 "Better/Slower Than Last Time" comparison (§6 of the request: "a result with different weight/rest/reps/rounds/etc. must never be treated as the same configuration"). A legacy (`isExact: false`) row is never treated as comparable — its true configuration can't be verified.
- `isEncounterAttemptSuccessful`/`getEncounterOutcome` — unchanged from §16 (time-only comparison is still correct: since §17 forces the EXACT locked config with no player choice at all for order>=2, "different configuration → faster result" is structurally impossible, not just disallowed).

**`ActiveHuntScreen.tsx` is the actual enforcement point**, same as §16: for `order > 1` it independently re-derives `getEncounterLockState` from history and ignores every custom-related route param HuntOverviewScreen might have sent — including rebuilding the exact custom `Workout` via `buildCustomWorkout(canonicalWorkout, lockedConfig.structuralValue, lockedConfig.repsOverrides)` when the lock is itself a Custom Hunt with a structural change, rather than trusting whatever `customWorkout` HuntOverviewScreen's CURRENT UI state happened to pass.

**`HuntOverviewScreen.tsx`:** `isLocked` was renamed `isProgressionLocked` and now means `order > 1` specifically (Encounter 1 is never progression-locked). The locked card ("Beat Your Record") now states which mode is locked ("a Custom Hunt setup" vs. "the canonical workout") and shows the legacy notice when `!lockState.isExact`.

**§1 (Monster Overview):** `MonsterDetailScreen.tsx` gained a "First Encounter" preview card, shown immediately on opening a monster — always the CANONICAL Encounter 1 config (exercises, structure, reps, weight, gearCount, rest, target time) regardless of which mode the player ends up choosing, so "what am I about to fight" has one stable, unambiguous answer. A ladder workout (`stepLabel === 'Rung'`) gets a short structural summary instead of a misleading flat reps list — `HuntOverviewScreen` still owns the real per-rung ladder preview.

**§8 (Complete Exercise Library in Custom Workout Builder): already satisfied, no code changed.** Traced `CustomWorkoutBuilderScreen.tsx`'s exercise picker before touching anything — it already calls `contentEngine.getExerciseLibrary()` (all 52 entries in `content/exercises/library.json`, the single source of truth) with no filtering of any kind. Documented here so a future session doesn't re-do this investigation.

**§9 (Custom Workouts in Journal/Statistics) — new integration, deliberately kept separate from monster stats:**
- **Migration12** (`custom_workout_result`: `user_id TEXT NOT NULL DEFAULT 'local-hunter'` — backfills existing rows exactly, this app is single-local-user only, see `src/constants/localUser.ts` — plus nullable `workout_name`, `rounds`, `rest_seconds`, `total_reps`, `exercise_breakdown_json`). The five new fields are a SNAPSHOT taken at completion time (`CustomWorkoutSessionScreen.tsx`, via the existing `getExerciseBreakdown` util reused as-is), not a live join against the source `CustomWorkout` — a result still displays correctly in the Journal even if that `CustomWorkout` is later edited or deleted. All nullable because a pre-migration12 row won't have them; the Journal shows what it has, never a fabricated breakdown.
- `CustomWorkoutRepository.getAllForUser(userId)` (new) + `customWorkoutSlice.getAllCustomWorkoutResults()` (new) — the read path for the Journal section.
- `ChronicleScreen.tsx` gained a "Training Sessions" section — its own separate fetch/state/render block, entirely downstream of `getAllCustomWorkoutResults()` only. **Never touches** `groupResultsByDay`, `getWeeklySummary`/`getMonthlySummary`, `getExerciseStats`, `getWeaknessProfile`, `getHuntRank`, the Personal-Record/First-Clear badges, or the `chronicle` aggregate row (XP/rank/streak) — all of those remain exactly as `groups`/`allResults` (WorkoutResult-only) fed them before this change. This is the deliberate boundary that keeps a Custom Workout a real, visible training session (§9) without it ever becoming a monster victory (§10's "do not mix these three concepts").

**Content audit:** unchanged from §16 — still 18 monsters at Levels 1/2/3, Weaver at Level 1 only, nothing in content touched by this request either.

**Known limitations / assumptions (documented, not bugs):**
- Everything under §16's own "Known limitations" still applies (Encounter 1 baseline uses first-not-best, badges are additive to Task 7's, etc.), sharpened by `isExact` where relevant.
- **A legacy Custom Hunt row's rest/structural-value/reps-overrides are gone, not guessable** — `isExact: false` is a correctness signal, not a UI polish detail; don't remove the "predates full configuration tracking" notice without also reconsidering whether locking to a fabricated canonical fallback is still honest.
- **A Custom Workout result's `exerciseBreakdown`/`totalReps`/etc. are also snapshots** — editing a `CustomWorkout` after running it does NOT retroactively update past Journal entries, by design (same reasoning as the WorkoutResult snapshot above).
- **`getExerciseBreakdown` is now called from two independent places** (`workoutSlice.completeHunt`'s exercise-stats path, pre-existing, and `CustomWorkoutSessionScreen.tsx`, new) — still the same pure function, no duplication of logic, just noting the second call site exists.

---


## 10. KNOWN TECHNICAL DEBT / LIMITATIONS (confirmed in code)

- Timer's Exercise Slot only reads a linked workout's flat/first-section
  exercises, never full `sections[]` (§8).
- PR is scoped per-`workoutId`, so a monster's 3 Levels already share one
  PR pool — not a bug exactly, but a real, confirmed existing behavior
  worth knowing before touching anything PR-related.
- RPE is stored and displayed per-Hunt-result only; no aggregate
  analytics (Average RPE, Easy/Hard counts) exist anywhere.
- `Chronicle.totalWorkouts` is a dead-weight duplicate field — always
  equals `totalHuntsCompleted`, never displayed.
- `WorkoutResult.notes` is a fully inert column — always written `null`,
  no UI ever sets or reads it.
- `gearCount` has no dedicated `WorkoutResult` column — it's inferred
  from `weightValueB != null`, itself always derived from canonical
  `workout.gearCount`, never an actual player choice (relevant if Custom
  Hunt is ever implemented — see §9).
- No accounts/cloud sync/backend — confirmed zero auth/networking
  dependencies installed.
- `engines/sync/` exists as a folder but is unused (no backend to sync
  with).
- No test harness (no jest, no `*.test.ts` anywhere) and no git in this
  environment — validation is `tsc --noEmit` + `expo export` + manual
  checks, file-change tracking is by direct inspection.

---

## 11. DEVELOPMENT RULES

**Before coding:** inspect the actual current architecture (don't trust
a prior handoff's specifics for fast-moving areas — trust it for shape,
verify exact current values); find the real source of truth for
whatever's being changed; identify downstream consumers before touching
a shared type/function; determine the smallest safe change.

**During coding:** prefer minimal, targeted changes; reuse existing
patterns (repository/slice/engine shapes already established); don't
redesign architecture unless explicitly asked; don't touch the Battle
Engine unless the task explicitly requires it; don't change
balance/HP/XP/rank casually; preserve backward compatibility (additive
SQLite migrations only); don't rename `Exercise.name` to fix a display
issue (use `displayName`).

**After coding:** run `npx tsc --noEmit`; run
`npx expo export --platform android` when the change touches runtime
code (not needed for pure content-only edits); inspect the actual
changed-file list; confirm no forbidden/high-risk file (§12) was touched
unless the task explicitly required it; validate actual data paths
(numeric invariants, real render output), not just "it compiles."

---

## 12. FORBIDDEN / HIGH-RISK AREAS

- `engines/battle/useBattleEngine.ts` + `engines/battle/damageResolver.ts`
  — the entire combat-damage pipeline; HP calibration for all 6 monsters
  depends on this exact logic staying as-is.
- `engines/progress/progressionEngine.ts` — XP formula + level curve;
  already hardened once against real exploits.
- `content/monsters/*.json` (`battle.hp` specifically) — hand-derived
  from the damage formula; changing workout content without
  recalculating HP (or vice versa) breaks the calibration.
- `src/services/db/schema.ts` + migrations — every migration must stay
  additive/nullable; a destructive or non-nullable change risks breaking
  every existing local install on update.
- `engines/content/ContentEngine.ts`'s `getExerciseLibraryEntryByName` —
  the single routing key between workout content and the Exercise
  Library; anything that changes an `Exercise.name` (not `displayName`)
  silently repoints Library/video/Journal-stat routing.
- `content/workouts/workout.json`'s flat-vs-sections structure — the
  flat `exercises[]` array is a real fallback several code paths still
  read; editing a sectioned workout's content requires keeping
  `sections[0]` and the flat array in sync (convention, not enforced).
- `src/utils/huntRank.ts` — rank formula; deliberately time-only.

---

## 13. CURRENT PROJECT STATUS

**Working:** full Campaign 1 (6 monsters, all Hunt flow, XP/rank/PR,
Journal, Timer, RPE, backgrounds/atmosphere). `tsc --noEmit` clean,
`expo export --platform android` succeeds.

**Recently fixed (real-device bug reports):** Active Hunt combat-feedback
overlap (twice — layout-space issue, then cross-element overlap issue),
calendar TODAY-number alignment (twice — two different root causes),
Finish Hunt/Pause/Quit button sizing (`Button.tsx`'s style-forwarding
quirk), bottom tab bar hidden during Active Hunt.

**Recently implemented:** Custom Hunt (§9) — weight + gearCount + rest,
full V1, validated (`tsc`/`expo export` both clean).

**Remains optional / deferred, not urgent:** Timer Exercise Slot's
sections-awareness; surfacing `getMonsterHistory()` in any UI; removing
`Chronicle.totalWorkouts`/`WorkoutResult.notes` dead fields; RPE
aggregate analytics; Custom Hunt PR-pool splitting (documented
limitation, §9); Custom Hunt reps/rounds (V2, not started).

**Not implemented:** Campaign 2 (not started, no commitment); any
account/auth/cloud-sync feature (explicitly out of scope until a real
architecture decision).

---

## 14. IMPORTANT FILE MAP

| File | Purpose | Why it matters | Safe to modify? |
|---|---|---|---|
| `engines/battle/damageResolver.ts` | Pure per-exercise damage math | HP calibration for all 6 monsters depends on this exactly | No — only with explicit task + full HP re-audit |
| `engines/battle/useBattleEngine.ts` | Combat reducer, HP/phase/bonus state | Same calibration dependency as above | No |
| `engines/progress/progressionEngine.ts` | XP formula, level curve | Already hardened against exploits once | No — only with explicit task |
| `src/utils/huntRank.ts` | Rank (S/A/B/C) formula | Deliberately time-only; other systems assume this | No — only with explicit task |
| `src/services/db/schema.ts` | SQLite migrations | Breaking additivity corrupts every existing install | Cautiously — additive only, ever |
| `content/monsters/*.json` | Monster battle config, HP | Hand-derived from damage formula | Cautiously — recompute HP if workout content changes |
| `content/workouts/workout.json` | All workout content | Flat/sections convention several code paths assume | Cautiously — keep `sections[0]` = flat array |
| `engines/content/ContentEngine.ts` | Single content read path, incl. Exercise Library routing | `Exercise.name` changes here silently break routing | Cautiously |
| `engines/session/useWorkoutSession.ts` | Round/rest/countdown state machine | Drives Active Hunt timing; `repsCompleted` currently always canonical | Cautiously |
| `engines/timer/useTimerSession.ts` | Timer session + `flattenPreset()` | Exercise Slot's known sections limitation lives here | Cautiously |
| `src/store/workoutSlice.ts` | `completeHunt`, PR lookups | Single source of truth for XP/rank/PR/persistence on Hunt completion | Cautiously |
| `src/models/WorkoutResult.ts` | Persisted per-Hunt row shape | Any new field needs a matching additive migration | Cautiously |
| `src/components/core/Button.tsx` | Shared button, used app-wide | `style` prop only reaches inner `Animated.View`, not `Pressable` — flex/layout styles need a wrapping View at the call site instead | Cautiously — used everywhere, changes ripple app-wide |
| `src/components/workout/TimerWidget.tsx` | Shared timer display | Has an opt-in `compact` prop (default false); `TimerRunScreen` relies on default sizing | Cautiously |
| `src/screens/hunt/ActiveHuntScreen.tsx` | Active combat screen | Recently reworked feedback-overlay/controls layout; now also resolves Custom Hunt's `restSecondsOverride`; combat/timing logic itself untouched throughout | Cautiously |
| `src/screens/hunt/HuntOverviewScreen.tsx` | Pre-Hunt weight/config screen | Custom Hunt's actual UI entry point (Training Mode card, mode toggle, preset load/save) | Cautiously |
| `src/screens/chronicle/ChronicleScreen.tsx` | Journal/history screen | Calendar alignment + RPE display + Custom Hunt badge | Cautiously |
| `src/models/CustomHuntPreset.ts` | Custom Hunt preset shape | Keyed by `workoutId`, not `huntId` — that's the whole inheritance mechanism | Yes |
| `src/services/customHuntPresetRepository.ts` | Custom Hunt persistence | Composite-key upsert, mirrors `monster_progress`/`campaign_progress` | Yes |
| `src/store/customHuntSlice.ts` | Custom Hunt store actions | Thin wrapper, no cached array state | Yes |
| `src/utils/rpeLabels.ts` | RPE value→label map | Shared by HuntComplete (indirectly, same list) and Chronicle | Yes |
| `src/navigation/*.ts` | Stack/tab structure, route param types | `ActiveHuntScreen` hides the tab bar via `navigation.getParent()`, not a navigator restructure; `ActiveHunt` params carry Custom Hunt fields | Cautiously |
| `PROJECT_CONTEXT.md` (this file) | Handoff context for future sessions | Keep it accurate — stale context is worse than none | Yes — keep it updated as things change |

---

## 15. DECISION HISTORY

- **A monster's 3 Levels share one `workoutId`, differentiated by
  `restSecondsOverride`** — this is intentional content design (shorter
  rest = harder), not something to "fix" by giving each Level its own
  workout. Also why PR pools naturally end up shared per-`workoutId` today.
- **HP is calibrated to leave zero margin for error** (ratio 1.000
  against baseline achievable damage) — intentional difficulty design,
  not a balance bug to soften.
- **Weaver's content duplicates other monsters' content on purpose** —
  the "Final Trial" callback design, not drift to deduplicate.
- **`Exercise.name` vs `displayName` split is intentional** — routing
  stability vs. cosmetic flexibility. Don't collapse them into one field.
- **RPE was deliberately kept non-gameplay-affecting** — self-reported
  perceived effort should never feed back into damage/XP/rank; this was
  an explicit constraint from the feature's inception, not an oversight.
- **`Button.tsx`'s style-forwarding-only-to-inner-View behavior was NOT
  changed** when it caused a real bug (Finish Hunt/Pause/Quit sizing) —
  fixed at the call site instead, specifically to avoid rippling a
  behavior change across every other `Button` usage in the app for a
  problem that only manifested in one row-layout context.
- **Custom Hunt (§9) was implemented as weight+gearCount+rest, V1** —
  reps/rounds/duration were identified as disproportionately risky
  against the HP-calibration invariant and intentionally excluded, not
  just for the first version but until a real combat/scoring redesign is
  explicitly requested.
- **Custom Hunt's PR pool was deliberately left shared with canonical**
  (both scoped by `workoutId`, unchanged) — splitting it was identified
  as needing a broader schema/query change and was explicitly deferred
  rather than improvised; don't "fix" this without a real product
  decision on how PR pools should be scoped.
- **Custom Hunt's rest override fully replaces `restSecondsOverride`
  only in Custom mode** — canonical Hunts are byte-for-byte unaffected
  (`hunt?.restSecondsOverride` untouched), so the Level 1/2/3
  difficulty-via-rest escalation stays intact for anyone not using this
  feature. Don't merge/layer custom rest onto canonical rest.
- **SUPERSEDES THE TWO DECISIONS ABOVE: Encounter Lock (§16/§17) was
  explicitly requested** and deliberately locks Encounter 2/3 to
  Encounter 1's ACTUAL result configuration (canonical or custom,
  whichever Encounter 1 used — §17), not Encounter 2/3's own
  `restSecondsOverride`, and makes Custom Hunt unreachable for Encounter
  2/3 specifically (Encounter 1 itself keeps full Custom Hunt — §17
  reversed an earlier over-restriction here). This was a real,
  intentional gameplay-rule change request, not a casual violation of the
  entries above — don't "restore" the old per-Level-rest-escalation
  behavior without an equally explicit request to reverse it.

---

## RULE FOR FUTURE CLAUDE

The future Claude should:
1. Read this document first.
2. Verify assumptions against the actual code before editing.
3. Prefer the smallest safe implementation.
4. Never modify gameplay/balance systems merely to make a feature easier.
5. Report exactly what changed and what was intentionally left untouched.
6. Treat existing working architecture as intentional unless there is
   concrete evidence otherwise.

---

## 18. BASILISK — PROVISIONAL CONTENT, PENDING PHYSICAL TESTING

`content/monsters/basilisk.json` / `content/workouts/workout.json['basilisk-confrontation']`
(Campaign 1 — The Wilds) is real, playable content, but its round count,
rest, and overall format are explicitly **not final** — the creator is
going to physically test the movement sequence before deciding the real
prescription. The exercise sequence itself IS locked and should not
change: Burpee ×4, Clean → Jerk ×2, Deadlift ×4, Clean → Jerk ×2, Deep
Snatch ×4, Clean → Jerk ×2 (the repeated Clean → Jerk is the intentional
"same confrontation, three times a round" design, not a bug).

**What's provisional (safe/expected to change once testing is done),
all on the one workout object:**
- `rounds: 5`, `restSeconds: 120` — current guess is a Fixed-Round Trial
  (Option B in the original brief), matching Campaign 1's typical
  5-round/120s-rest shape. Could become EMOM, Rounds-for-Time, or a
  Timed Hunt instead — see the brief's own Option A–D.
- `roundBonusDamage: 55`, `targetTimeSeconds: 900`, `difficulty: 3`,
  `estimatedMinutesRange: [12, 18]` — all follow from the rounds/rest
  guess above; recalculate together, not independently, if the format
  changes (see §16/§17's own hp-calibration note: hp ≈ total base damage
  × 1.10, and total base damage = rounds × sum(exercise
  damageCoefficient) + roundBonusDamage × rounds for a flat-damageType,
  non-sectioned workout like this one).
- `battle.hp: 787` on the monster — derived from the damage total above
  at the same ~1.10x ratio every other monster uses; must be recalculated
  if rounds/exercises/coefficients change.

**Not provisional — don't change without a new explicit request:** the
exercise sequence/order/reps, the four new Exercise Library entries this
added (`burpee`, `clean-jerk`, `deadlift`, `deep-snatch` — checked
against the existing 55 entries first, no duplicates), and Basilisk's
own id/monster identity.

Same registration requirement as Mammoth (§ above it in file history):
a new monster JSON needs a static import + an entry in
`ALL_MONSTER_SOURCES` inside `engines/content/ContentEngine.ts` — Metro
won't pick it up from disk alone.

---

## 19. TERRITORY REDESIGN — CAMPAIGNS ARE NON-LINEAR TERRITORIES NOW

Explicit, permanent design decision (not a testing hack): all three
campaigns are meant to be freely enterable at any time, always. This
used to be true only via `campaignState.ts`'s temporary
`DEV_UNLOCK_ALL_CAMPAIGNS` override (added for a real-device testing
pass). That override is now GONE — every content campaign has
`unlockRequiresCampaignId: null` for real, so the same "always
available" behavior is permanent and no longer depends on a flag a
future session could silently revert. The `unlockRequiresCampaignId`
mechanism itself is still implemented in `campaignState.ts` (not
deleted) in case a future campaign genuinely needs a real gate — it's
just unused by any of the three territories today. `Monster`-level
`finalBossId` locking (Weaver requiring the rest of the Wilds defeated
first) is unrelated and untouched — that's a within-territory mechanic,
not a between-territory one, and the brief never asked for it to change.

**"Campaign" is being renamed "Territory" in product language, not in
code.** `Campaign` (the interface, the model file, `getCampaignState`,
`campaignId` route params, etc.) all keep their existing names — only
UI-facing copy says "Territory." Renaming the type/identifiers too would
touch far more files for zero player-visible benefit.

**New optional `Campaign` fields** (`src/models/Content.ts`):
`territoryLore: { theTerritory, whatDwellsHere, huntersPurpose,
transition }` and `heroImageAsset?: string`. Both optional so old-shaped
campaign data still loads. All three current campaigns have both set —
see `content/campaigns/campaign-{1,2,3}.json`.

**No Trophy/Arsenal data model exists in this project.** `ForgeScreen`
is kettlebell equipment management, unrelated. The new Territory Hub's
Trophies tab (`WorldMapScreen.tsx`) deliberately does NOT invent one —
it reuses each monster's existing `title`/`description` as the trophy's
name/flavor, gated by the same `monsterProgress[id].defeated` flag every
other screen already reads. No new persistence, no inventory mechanic.

**No territory artwork exists yet.** `src/constants/territoryArt.ts`
mirrors `monsterPortraits.ts`'s exact optional-lookup-with-undefined-
fallback shape (`getTerritoryArt(heroImageAsset)`), currently an empty
map. Every hero header (`HuntScreen.tsx`'s territory cards,
`WorldMapScreen.tsx`'s Hub header) already renders a themed flat-color
panel (`TERRITORY_ACCENT`, reusing existing palette tokens — ember/
bronze/blood, never new hex values) with a scrim for text legibility
when no image resolves, built from plain `View`s only — this project
doesn't use a gradient library anywhere (see `AppBackground`'s own
comment) and this redesign didn't introduce one. Dropping a real
`require()`'d image into `TERRITORY_ART` under the matching
`heroImageAsset` key (`territory-wilds` / `territory-ruins` /
`territory-abyss`) is the only change needed once real art exists.

**Files changed:** `src/models/Content.ts` (Campaign fields), all 3
`content/campaigns/*.json` (lore + unlock fix + Abyss's real thematic
copy replacing its old "temporary holding ground" placeholder text),
`src/utils/campaignState.ts` (flag removal), `src/constants/territoryArt.ts`
(new), `src/screens/hunt/HuntScreen.tsx` (Territory Selection redesign),
`src/screens/hunt/WorldMapScreen.tsx` (Territory Hub + tabs redesign —
the Hunts tab's monster-node logic itself is unchanged from before this
pass, just relocated under a tab).

**Known discrepancy, flagged rather than silently resolved:** the brief
listed "TALOS" as a Ruins monster. No monster named Talos exists
anywhere in the project; the closest and almost certainly intended match
is the existing **Atlas** (already in the Ruins) — both are load-bearing
Titan/automaton figures from Greek myth, an easy mix-up. Atlas was left
exactly as-is (not renamed) since the brief's own rule is "do not rename
existing monsters unless explicitly required," and this wasn't explicit.
