import type { ExtraExerciseId } from '../models';

export interface ExtraExerciseDefinition {
  id: ExtraExerciseId;
  name: string;
}

/**
 * The fixed starting set of optional post-Hunt exercises. Deliberately
 * not part of the content Exercise Library (content/exercises/library.json)
 * — these are a simple player-logged addition (exercise + rep count),
 * never damage/XP-bearing workout content, so they don't need that
 * system's description/muscles/benefits/commonMistakes authoring.
 */
export const EXTRA_EXERCISE_DEFINITIONS: ExtraExerciseDefinition[] = [
  { id: 'double-kb-pushup', name: 'Double-Kettlebell Push-Up' },
  { id: 'single-kb-pushup', name: 'Single-Kettlebell Push-Up' },
  { id: 'vertical-pullup', name: 'Vertical Pull-Up' },
];

const DEFINITION_BY_ID = new Map(EXTRA_EXERCISE_DEFINITIONS.map((def) => [def.id, def]));

/** Display name for an extra-exercise id — never fabricates a name for an unknown id, returns the raw id instead so a future/unexpected value is still visible rather than silently blank. */
export function getExtraExerciseName(id: ExtraExerciseId): string {
  return DEFINITION_BY_ID.get(id)?.name ?? id;
}
