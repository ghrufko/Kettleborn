/**
 * Bug #3 fix: shared source of truth for the RPE (1–4) value→label mapping.
 * Previously only existed as a local, unexported constant inside
 * HuntCompleteScreen.tsx (the Victory screen's own RPE picker). Extracted
 * here, unchanged, so Journal/Chronicle can render the same "Easy/Solid/
 * Hard/Brutal" labels for a saved WorkoutResult.rpe without duplicating
 * this list a second time. HuntCompleteScreen's own RPE_OPTIONS (id +
 * label, used to render the picker buttons) is untouched — this is purely
 * an additional read-side lookup for an already-saved value.
 */
export const RPE_LABELS: Record<number, string> = {
  1: 'Easy',
  2: 'Solid',
  3: 'Hard',
  4: 'Brutal',
};

/** Returns the display label for a saved WorkoutResult.rpe, or null if unset. */
export function getRPELabel(rpe: number | null | undefined): string | null {
  if (rpe === null || rpe === undefined) {
    return null;
  }
  return RPE_LABELS[rpe] ?? null;
}
