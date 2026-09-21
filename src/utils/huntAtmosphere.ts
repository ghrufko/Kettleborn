/**
 * Short lines shown only during rest, between rounds — a different moment
 * than the anticipation lines in flavorText.ts (which fire before a hunt
 * starts). These are about recovery mid-fight, so the wording is
 * deliberately distinct: no repeats of "the beast is watching" / "the
 * labyrinth waits" from flavorText.ts. Deterministic per round so a line
 * doesn't flicker between renders within the same rest period.
 */
const REST_LINES = [
  'Steady your breath.',
  'The labyrinth grows silent.',
  'The hunt is not over.',
  'Recover. It is not done with you.',
  'Even the beast rests between strikes.',
];

export function restFlavorFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash + seed.charCodeAt(i)) % REST_LINES.length;
  }
  return REST_LINES[hash];
}
