export interface RungLap {
  round: number;
  durationSeconds: number;
}

export interface WorkoutResult {
  id: string;
  userId: string;
  workoutId: string;
  monsterId: string;
  huntId: string;
  completedAt: string;
  timeMinutes: number;
  timeSeconds: number;
  weightValueA: number;
  weightValueB: number | null;
  weightUnit: 'kg' | 'lb';
  notes: string | null;
  xpAwarded: number;
  difficulty: number;
  appVersion: string;
  /**
   * Sprint 24: per-round/rung lap times, in chronological completion order.
   * Only ever populated for workouts that report a real per-rung sequence
   * worth keeping (currently just the Minotaur ladder, `labyrinth-ladder`,
   * via its `stepLabel: "Rung"` content flag) — `null` for every other
   * result, past and future. A repeated round number (e.g. rung 1 appearing
   * twice in a ladder) is disambiguated by array position, not by this
   * field's shape — see `RungLap.round`, which is the sequence position
   * (1..N), not a rep count.
   */
  rungLaps: RungLap[] | null;
  /**
   * Post-Hunt perceived effort, 1 (Easy) – 4 (Brutal). Set separately from
   * the rest of the row, after the player picks it on Victory — `null`
   * until then, and stays `null` forever for any result recorded before
   * this existed or where the player skips the prompt. Purely a self-
   * reported label; never read by damage/XP/rank — those are unaffected.
   */
  rpe: number | null;
  /**
   * Custom Hunt: true when this result was completed using a player-set
   * CustomHuntPreset (weight/gearCount/rest) instead of the canonical
   * workout parameters. Additive, defaults false — every result recorded
   * before this field existed reads as false (canonical), which is
   * correct since Custom Hunt didn't exist yet. Display-only: never read
   * by damage/HP/rank; only used to label a result in Journal and — for
   * now, unchanged — still shares the same workoutId-scoped PR pool as
   * canonical results (a known, documented limitation, not a bug).
   */
  isCustomHunt: boolean;
  /**
   * Encounter Lock (Custom Hunt merge): the EXACT configuration used for
   * this specific result, snapshotted at completion time — never re-read
   * from the player's CURRENT CustomHuntPreset later, since that can
   * change. `null` for every canonical result (isCustomHunt === false) —
   * canonical config is always fully reconstructable from content alone
   * (hunt.restSecondsOverride ?? workout.restSeconds / no structural or
   * reps changes), so storing it redundantly here would be pointless.
   * For a Custom Hunt result, `null` here specifically means LEGACY DATA
   * — this row predates this migration and its exact rest cannot be
   * reconstructed; see src/utils/encounterLock.ts's `isExact` flag,
   * which is what actually decides "legacy" vs "exact" downstream, not
   * this field alone.
   */
  restSecondsUsed: number | null;
  /**
   * Task 2's structural control value (rounds/max rung/cycles) actually
   * used, or `null` for canonical structure — same
   * snapshot-not-live-preset reasoning as restSecondsUsed above.
   */
  structuralValueUsed: number | null;
  /**
   * Per-exercise rep overrides actually used (same shape as
   * CustomHuntPreset.repsOverrides), or `null` for canonical reps —
   * same snapshot-not-live-preset reasoning as restSecondsUsed above.
   */
  repsOverridesUsed: Record<string, number> | null;
}
