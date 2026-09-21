import React, { useRef } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  StyleProp,
  ViewStyle,
  GestureResponderEvent,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { triggerHaptic } from '../../utils/haptics';
import { colors, fontFamily, fontSize, radii, spacing, glow } from '../../theme';

export type ButtonVariant = 'primary' | 'secondary' | 'destructive';

interface ButtonProps {
  label: string;
  onPress: (event: GestureResponderEvent) => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

const VARIANT_STYLES: Record<
  ButtonVariant,
  { background: string; border: string; text: string; glow: ViewStyle }
> = {
  primary: {
    background: colors.bronze.base,
    border: colors.bronze.active,
    text: colors.text.onBronze,
    glow: glow.md,
  },
  secondary: {
    background: 'transparent',
    border: colors.steel,
    text: colors.text.primary,
    glow: glow.none,
  },
  destructive: {
    background: 'transparent',
    border: colors.blood,
    text: colors.blood,
    glow: glow.none,
  },
};

export function Button({ label, onPress, variant = 'primary', disabled, style }: ButtonProps) {
  const scale = useRef(new Animated.Value(1)).current;
  const variantStyle = VARIANT_STYLES[variant];

  const animateTo = (toValue: number) => {
    Animated.spring(scale, {
      toValue,
      useNativeDriver: true,
      speed: 40,
      bounciness: 6,
    }).start();
  };

  const handlePressIn = () => {
    animateTo(0.97);
    if (!disabled) {
      triggerHaptic(Haptics.ImpactFeedbackStyle.Light);
    }
  };

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      onPressIn={handlePressIn}
      onPressOut={() => animateTo(1)}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
    >
      <Animated.View
        style={[
          styles.base,
          variantStyle.glow,
          {
            backgroundColor: variantStyle.background,
            borderColor: variantStyle.border,
            transform: [{ scale }],
            opacity: disabled ? 0.4 : 1,
          },
          style,
        ]}
      >
        <Text style={[styles.label, { color: variantStyle.text }]}>{label}</Text>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radii.md,
    borderWidth: 1,
    minHeight: 48,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontFamily: fontFamily.displayBold,
    fontSize: fontSize.base,
    textTransform: 'uppercase',
    letterSpacing: 1,
    // Real-device report (Complete Round/Complete Rung specifically):
    // this label never set textAlign, so React Native's Text defaults to
    // left-aligned. Invisible for every single-line button in the app
    // (the parent's alignItems/justifyContent:'center' already centers
    // the whole text block), but on narrower phones "Complete Round"
    // wraps to two lines inside its row (shared with the timer chip),
    // and two left-anchored lines of different widths read as
    // off-center/ragged even though the block itself is centered.
    // Explicit center fixes that without changing anything for text
    // that already fits on one line.
    textAlign: 'center',
  },
});
