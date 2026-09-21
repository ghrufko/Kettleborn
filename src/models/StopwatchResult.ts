/**
 * A single completed Stopwatch session (Timer tab). Deliberately its own
 * type — no exercises, weight, reps, or workout identity of any kind —
 * so it can never be mistaken for a Monster Hunt or a Custom Workout
 * result, per the feature's own requirement. Just a clock, laps, and an
 * optional freeform note.
 */
export interface StopwatchResult {
  id: string;
  completedAt: string;
  elapsedSeconds: number;
  /** Cumulative elapsed seconds at the moment each LAP was tapped, in order — e.g. [42, 90, 145] for three laps. Empty if the player never tapped LAP. */
  laps: number[];
  /** Freeform, no required structure — null if the player saved without writing one. */
  note: string | null;
}
