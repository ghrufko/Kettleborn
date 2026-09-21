import { colors } from './colors';
import { fontFamily, fontSize, lineHeight, letterSpacing } from './typography';
import { spacing } from './spacing';
import { radii } from './radii';
import { glow } from './glow';

export const theme = {
  colors,
  fontFamily,
  fontSize,
  lineHeight,
  letterSpacing,
  spacing,
  radii,
  glow,
} as const;

export type Theme = typeof theme;

export { colors } from './colors';
export { fontFamily, fontSize, lineHeight, letterSpacing } from './typography';
export { spacing } from './spacing';
export { radii } from './radii';
export { glow } from './glow';
export type { DifficultyTier, RarityTier } from './colors';
