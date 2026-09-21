export type MovementCategory = 'Ballistic' | 'Grind' | 'Carry' | 'Combo';

export interface ExerciseLibraryEntry {
  id: string;
  name: string;
  description: string;
  /** Kettlebell movement family — Ballistic (explosive), Grind (slow strength), Carry, or Combo (chained lifts). */
  category: MovementCategory;
  musclesTrained: string[];
  benefits: string[];
  commonMistakes: string[];
  /** A sane starting range in kg for most lifters — not a per-workout weight, which comes from Workout.gearWeightKg. */
  recommendedWeightRangeKg: [number, number];
}
