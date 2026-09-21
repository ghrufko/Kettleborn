/**
 * Custom Workout Builder. Deliberately separate from Monster/Hunt/
 * CustomHuntPreset:
 *
 *  - Custom Hunt modifies an EXISTING canonical Workout, keeps the
 *    monster/campaign identity, and feeds the Battle Engine (see
 *    src/utils/customWorkoutStructure.ts).
 *  - Custom Workout has no monster, no campaign, no HP bar, no XP/rank —
 *    it's a plain, user-authored round/rest/exercise structure, executed
 *    with the SAME session engine (useWorkoutSession) but without the
 *    Battle Engine at all.
 *
 * A CustomWorkout is converted to the existing `Workout` domain shape
 * only at session-start time (see customWorkoutSession.ts) so it can run
 * through useWorkoutSession unmodified — it is never itself a `Workout`,
 * and is never registered with ContentEngine or treated as content.
 */
export interface CustomWorkoutExercise {
  /** Exercise Library id — never a new/duplicate exercise definition. */
  exerciseId: string;
  reps: number;
  order: number;
}

export interface CustomWorkout {
  id: string;
  name: string;
  exercises: CustomWorkoutExercise[];
  weightKg: number;
  /** Kettlebell weight audit: the second bell's weight when gearCount is 2 — independent from weightKg (16kg + 18kg is valid). null/undefined when gearCount is 1, or for a workout saved before this field existed (falls back to mirroring weightKg). */
  weightBKg?: number | null;
  gearCount: 1 | 2;
  rounds: number;
  restSeconds: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * A single completed run of a CustomWorkout. Deliberately minimal — no
 * XP, rank, or PR fields, since those are monster-hunt RPG concepts this
 * feature explicitly should not gain (see the brief's "do not add new
 * RPG mechanics"). Just enough to answer "did I do this, when, how long
 * did it take, what did I use."
 *
 * Journal integration (§9): workoutName/rounds/restSeconds/totalReps/
 * exerciseBreakdown are a SNAPSHOT taken at completion time (migration12),
 * not a live join against the source CustomWorkout — so a result still
 * displays correctly in the Journal even if that CustomWorkout is later
 * edited or deleted. All five are optional/nullable because a result
 * saved before migration12 won't have them; the Journal shows what it
 * has rather than fabricating a breakdown for old rows.
 */
export interface CustomWorkoutResult {
  id: string;
  customWorkoutId: string;
  completedAt: string;
  elapsedSeconds: number;
  weightKg: number;
  /** Kettlebell weight audit: the second bell's real weight actually used, snapshotted like the other fields on this row — independent from weightKg. */
  weightBKg?: number | null;
  gearCount: 1 | 2;
  workoutName: string | null;
  rounds: number | null;
  restSeconds: number | null;
  totalReps: number | null;
  exerciseBreakdown: { name: string; totalReps: number }[] | null;
}
