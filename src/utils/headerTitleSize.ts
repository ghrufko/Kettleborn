import { fontSize, letterSpacing } from '../theme/typography';
import { spacing } from '../theme/spacing';

/** Width of the Header's back/right icon slots (src/components/core/Header.tsx). */
export const HEADER_SIDE_WIDTH = 40;
const MIN_TITLE_SIZE = 15;

/**
 * The Header title's size for this screen width: the full 20pt when it
 * fits, stepped down (never below 15pt) for long titles on narrow phones,
 * so "Second Encounter" or "Hunter's Journal" read whole instead of
 * ending in an ellipsis. Cinzel capitals average ~0.8em wide.
 */
export function fitHeaderTitleSize(title: string, screenWidth: number): number {
  const available = screenWidth - spacing.md * 2 - HEADER_SIDE_WIDTH * 2;
  const perChar = 0.8 * fontSize.lg + letterSpacing.wide;
  const fitted = Math.floor((available / Math.max(1, title.length)) * (fontSize.lg / perChar));
  return Math.max(MIN_TITLE_SIZE, Math.min(fontSize.lg, fitted));
}
