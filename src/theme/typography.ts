/**
 * Typography tokens.
 * Font family names must exactly match the keys returned by the
 * useFonts() call in App.tsx (from @expo-google-fonts/*).
 */
export const fontFamily = {
  displayRegular: 'Cinzel_400Regular',
  displayBold: 'Cinzel_700Bold',
  bodyRegular: 'Cormorant_400Regular',
  bodySemiBold: 'Cormorant_600SemiBold',
  bodyBold: 'Cormorant_700Bold',
  monoRegular: 'JetBrainsMono_400Regular',
  monoBold: 'JetBrainsMono_700Bold',
} as const;

export const fontSize = {
  xs: 12,
  sm: 14,
  base: 16,
  lg: 20,
  xl: 28,
  display: 36,
} as const;

export const lineHeight = {
  xs: 16,
  sm: 20,
  base: 24,
  lg: 28,
  xl: 36,
  display: 44,
} as const;

export const letterSpacing = {
  tight: 0,
  normal: 0.2,
  wide: 1.2,
  wider: 2.4,
} as const;
