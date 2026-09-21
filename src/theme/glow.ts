import { ViewStyle } from 'react-native';
import { colors } from './colors';

/**
 * Glow presets. React Native's shadow* props (iOS) and elevation (Android)
 * are repurposed here to simulate the bronze/ember glow language from the
 * design system rather than standard drop shadows, which are invisible
 * against the void/charcoal background.
 */
export const glow = {
  none: {
    shadowColor: 'transparent',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  } satisfies ViewStyle,

  sm: {
    shadowColor: colors.bronze.base,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 3,
  } satisfies ViewStyle,

  md: {
    shadowColor: colors.bronze.active,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.45,
    shadowRadius: 12,
    elevation: 6,
  } satisfies ViewStyle,

  lg: {
    shadowColor: colors.ember.glow,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.55,
    shadowRadius: 24,
    elevation: 12,
  } satisfies ViewStyle,
} as const;
