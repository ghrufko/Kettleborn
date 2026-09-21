/**
 * Short, sparing atmospheric lines (Sprint 17) — never more than one
 * sentence, shown only where they add anticipation (World Map's current
 * target, Home's Continue Adventure card). Deterministic per seed (e.g. a
 * hunt id) so the same hunt doesn't flicker between lines on re-render.
 */
const FLAVOR_LINES = [
  'The Labyrinth waits.',
  'Your hunt continues.',
  'Steel remembers.',
  'The beast is watching.',
  'One more victory.',
];

export function flavorTextFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash + seed.charCodeAt(i)) % FLAVOR_LINES.length;
  }
  return FLAVOR_LINES[hash];
}
