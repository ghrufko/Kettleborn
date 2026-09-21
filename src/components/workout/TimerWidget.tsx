import React, { useEffect, useRef } from 'react';
import { Animated, Text, View, StyleSheet } from 'react-native';
import { colors, fontFamily, fontSize, radii, spacing } from '../../theme';

interface TimerWidgetProps {
  label: string; // e.g. "TIME" or "REST"
  minutes: number;
  seconds: number;
  isRunning?: boolean;
  // Bug #1 fix (Active Hunt real-device report): the standalone Timer tab
  // (TimerRunScreen) has plenty of vertical room and is unaffected by this
  // — compact defaults to false so that screen's sizing is untouched.
  // Active Hunt opts in explicitly, since its TimerWidget shares the
  // screen with the exercise card and action buttons.
  compact?: boolean;
  // Further Active Hunt real-device UX pass: a single-line horizontal
  // chip (label + digits side by side) instead of the stacked
  // label-then-digits block, so the timer can sit *beside* the round
  // button in one row instead of stacking above it as its own row.
  // Opt-in, default false. TimerRunScreen (and every other TimerWidget
  // call site) never passes this, so nothing else changes appearance.
  inline?: boolean;
  // Real-device report (this sprint): Active Hunt's controls needed to
  // read as one balanced 2x2 grid — Timer/Complete Round on top,
  // Pause/Quit below, all four the same size. This makes the Timer
  // display match Button.tsx's own shell exactly (same minHeight,
  // borderRadius, padding) so it's genuinely the same cell shape as its
  // neighbors, not just visually close. Opt-in, default false — every
  // other TimerWidget call site (TimerRunScreen, and inline/compact
  // elsewhere) is unaffected.
  gridCell?: boolean;
}

function pad(value: number): string {
  return value.toString().padStart(2, '0');
}

export function TimerWidget({
  label,
  minutes,
  seconds,
  isRunning = false,
  compact = false,
  inline = false,
  gridCell = false,
}: TimerWidgetProps) {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!isRunning) {
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: false }),
        Animated.timing(pulse, { toValue: 0, duration: 900, useNativeDriver: false }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [isRunning, pulse]);

  const borderColor = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [colors.border.hairline, colors.ember.glow],
  });

  return (
    <Animated.View
      style={[
        styles.container,
        compact && styles.containerCompact,
        inline && styles.containerInline,
        gridCell && styles.containerGridCell,
        { borderColor },
      ]}
    >
      <Text style={[styles.label, inline && styles.labelInline]}>{label}</Text>
      <View style={styles.timeRow}>
        <Text
          style={[
            styles.digits,
            compact && styles.digitsCompact,
            inline && styles.digitsInline,
            gridCell && styles.digitsCompact,
          ]}
        >
          {pad(minutes)}
        </Text>
        <Text
          style={[
            styles.colon,
            compact && styles.digitsCompact,
            inline && styles.digitsInline,
            gridCell && styles.digitsCompact,
          ]}
        >
          :
        </Text>
        <Text
          style={[
            styles.digits,
            compact && styles.digitsCompact,
            inline && styles.digitsInline,
            gridCell && styles.digitsCompact,
          ]}
        >
          {pad(seconds)}
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    backgroundColor: colors.void.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  // Bug #1 fix: compact variant only trims this widget's own padding and
  // digit size — no color/border/label logic touched, no effect on the
  // default (TimerRunScreen) rendering.
  containerCompact: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.lg,
  },
  // Single-line chip: label and digits share one row instead of stacking,
  // trading the block's own height for width — meant to sit next to the
  // round button rather than above it. Tighter padding than
  // containerCompact since this is a narrow chip, not a standalone card.
  containerInline: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  // Matches Button.tsx's `base` style exactly (borderRadius: radii.md,
  // minHeight: 48, paddingVertical: spacing.sm, paddingHorizontal:
  // spacing.lg, centered) so this reads as the same cell shape as the
  // buttons next to it in the grid — see the gridCell prop comment.
  containerGridCell: {
    flex: 1,
    minHeight: 48,
    borderRadius: radii.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
  },
  label: {
    fontFamily: fontFamily.displayRegular,
    fontSize: fontSize.xs,
    letterSpacing: 2,
    color: colors.text.muted,
    textTransform: 'uppercase',
    marginBottom: spacing.xxs,
  },
  labelInline: {
    fontSize: 10,
    letterSpacing: 1,
    marginBottom: 0,
    marginRight: spacing.xxs,
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  digits: {
    fontFamily: fontFamily.monoBold,
    fontSize: fontSize.display,
    color: colors.text.primary,
  },
  digitsCompact: {
    fontSize: fontSize.xl,
  },
  // Smaller than digitsCompact (xl/28), matching the round button's own
  // label size (fontSize.base) rather than trying to be a hero element —
  // the inline chip sits in a row whose height is governed by the 48dp
  // button beside it, and narrow phones need the width for that button's
  // own text ("Complete Round" etc.), not for oversized digits.
  digitsInline: {
    fontSize: fontSize.base,
  },
  colon: {
    fontFamily: fontFamily.monoBold,
    fontSize: fontSize.display,
    color: colors.bronze.base,
    marginHorizontal: 2,
  },
});
