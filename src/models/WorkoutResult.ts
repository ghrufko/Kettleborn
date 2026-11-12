export interface RungLap {
  round: number;
  durationSeconds: number;
}

/**
 * Optional post-Hunt exercises — a small, fixed starting set. Not part of
 * the content Exercise Library (src/constants/extraExercises.ts holds the
 * definitions): these are a simple player-logged addition, not
 * damage/XP-bearing workout content, so they don't need that system's
 * description/muscles/benefits authoring.
 */
export type ExtraExerciseId = 'double-kb-pushup' | 'single-kb-pushup' | 'vertical-pullup';

export interface ExtraExerciseSet {
  id: string;
  exerciseId: ExtraExerciseId;
  reps: number;
}

export interface WorkoutResult {
  id: string;
  /**
   * Permanent, globally unique identity (v4 UUID) — migration 18. Set by
   * completeHunt for every new result; backfilled for older rows. Optional
   * in the type only so pre-existing fixtures/callers still compile; every
   * row read from the database has one.
   */
  uuid?: string;
  /**
   * The part of xpAwarded that was this stage's first-clear bonus (0 when
   * none was granted). null for results saved before migration 18, where
   * the split wasn't recorded. Kept so a future server can enforce
   * "one first-clear bonus per stage" across devices without guessing.
   */
  firstClearBonusXp?: number | null;
  /** Set when a progress reset voided this result (migration 18). Voided results are kept, never deleted, but excluded from progression and every existing history view. */
  voidedAt?: string | null;
  /**
   * Cloud Save P3 (migration 19): facts recorded at completion so totals
   * can later be rebuilt from history. All optional in the type (older
   * fixtures/callers); NULL on rows saved before migration 19 except
   * progressionEpoch/monsterResetCount, which that migration backfilled.
   * - progressionEpoch / monsterResetCount: captured when the hunt STARTED (D5/D6).
   * - volumeKg / trainingMinutes: exactly what this hunt added to the Chronicle.
   * - streakAfter: the current streak completeHunt computed (D14 streak policy C).
   * - tzOffsetMinutes: Date#getTimezoneOffset() at completion (audit only).
   * - originDeviceUuid / originOrder: which install recorded it, and in what order.
   * - prBonusXp / repeatMultiplier / priorClearsSeen: the XP breakdown inputs (D3).
   */
  progressionEpoch?: number | null;
  monsterResetCount?: number | null;
  volumeKg?: number | null;
  trainingMinutes?: number | null;
  streakAfter?: number | null;
  tzOffsetMinutes?: number | null;
  originDeviceUuid?: string | null;
  originOrder?: number | null;
  prBonusXp?: number | null;
  repeatMultiplier?: number | null;
  priorClearsSeen?: number | null;
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
  /**
   * Optional extra exercises logged after the main Hunt timer stopped,
   * before this result was saved — purely additive, never read by
   * duration/rank/XP/achievement calculations. `null` for every result
   * saved before this feature existed, and for any result the player
   * didn't add extras to; an empty array is never stored (there's no
   * meaningful difference between "no extras" and "empty list," so only
   * one representation — null — is ever written, keeping reads simple).
   */
  extraSets: ExtraExerciseSet[] | null;
}
