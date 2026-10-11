import type { ExtraExerciseId } from '../models';

/**
 * Phase "extra exercises as library entries": the 3 ids offered in the
 * post-Hunt picker, in display order. Each id is also a real entry in
 * content/exercises/library.json (double-kb-pushup, single-kb-pushup,
 * vertical-pullup) — same id used in both places deliberately, so an
 * ExtraExerciseSet links directly to its library entry via
 * contentEngine.getExerciseLibraryEntry(set.exerciseId) with no separate
 * mapping table. Display names/descriptions live ONLY in the library
 * JSON now (the single source of truth) — this file no longer carries
 * its own copy of them.
 */
export const EXTRA_EXERCISE_IDS: ExtraExerciseId[] = ['double-kb-pushup', 'single-kb-pushup', 'vertical-pullup'];
