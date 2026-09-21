# progress

XP, levels, titles, streaks, and Chronicle writes, driven by Session/Battle Engine events.

Implemented in Sprint 13: `progressionEngine.ts` centralizes XP calculation (base +
difficulty + weight + performance/rank + PR + first-clear) and the level curve
(cumulative XP thresholds, current-level progress). Titles stay in
`src/utils/hunterTitle.ts` (level → title lookup, same pattern as before).
Streak/Chronicle aggregation stays in `workoutSlice.completeHunt` and
`src/utils/timeline.ts` / `src/utils/chronicleSummary.ts`, unchanged in shape
from Sprint 12 — this folder is XP/level math only.
