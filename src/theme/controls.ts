import { ViewStyle } from 'react-native';
import { colors } from './colors';

/**
 * Shared chrome for the app's small form controls. Every +/- stepper
 * (Custom Hunt, Forge, Timer builders, post-Hunt extra sets) draws its
 * buttons from here, so they are one shape everywhere: a round, dark
 * well with a bronze hairline ring and a bronze glyph. Before this, the
 * weight stepper used a filled grey button, the Forge a square one and
 * the rest an outline, all in the same card.
 */
export const controls = {
  stepButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border.hairlineStrong,
    backgroundColor: colors.void.surface,
    alignItems: 'center',
    justifyContent: 'center',
  } satisfies ViewStyle,

  /** Same button for dense rows (per-movement reps, Left/Right pairs). */
  stepButtonCompact: {
    width: 28,
    height: 28,
    borderRadius: 14,
  } satisfies ViewStyle,

  stepButtonPressed: {
    backgroundColor: colors.charcoal.raised,
  } satisfies ViewStyle,
} as const;
