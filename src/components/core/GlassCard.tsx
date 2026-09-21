import React, { ReactNode, useEffect, useRef } from 'react';
import { View, Animated, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { colors, radii, spacing, glow as glowTokens } from '../../theme';

type GlowLevel = keyof typeof glowTokens;

interface GlassCardProps {
  children: ReactNode;
  glow?: GlowLevel;
  padded?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * Charcoal surface, hairline bronze border, subtle inner top-highlight —
 * the standard card shell per Mobile Architecture v1.0 Section 6.
 *
 * Sprint 20: every card now fades + slides in gently on mount (220ms,
 * once) rather than just appearing — a single change here covers every
 * screen that uses GlassCard instead of hand-adding motion per screen.
 * Screens that already stage their own multi-beat reveal (Victory,
 * Defeat) are unaffected in end-state — this only adds a quick settle on
 * top, never conflicting with the outer stagger's timing.
 */
export function GlassCard({ children, glow = 'none', padded = true, style }: GlassCardProps) {
  const enter = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(enter, { toValue: 1, duration: 220, useNativeDriver: true }).start();
  }, [enter]);

  return (
    <Animated.View
      style={[
        styles.base,
        glowTokens[glow],
        padded && styles.padded,
        {
          opacity: enter,
          transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }],
        },
        style,
      ]}
    >
      <View style={styles.topHighlight} />
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: colors.charcoal.base,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border.hairline,
    overflow: 'hidden',
  },
  padded: {
    padding: spacing.md,
  },
  topHighlight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: colors.border.hairlineStrong,
  },
});
