import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '../../components/core';
import { colors, fontFamily, fontSize, lineHeight, spacing } from '../../theme';

interface OnboardingSlide {
  icon: keyof typeof Ionicons.glyphMap;
  headline: string;
  body: string;
}

const SLIDES: OnboardingSlide[] = [
  {
    icon: 'flame',
    headline: 'You are a Hunter.',
    body: 'Every kettlebell session you complete becomes a Hunt.',
  },
  {
    icon: 'skull',
    headline: 'Monsters are training challenges.',
    body: 'Each one demands a different kind of strength — and a different way to earn it.',
  },
  {
    icon: 'trending-up',
    headline: 'Finish Hunts. Gain XP.',
    body: 'Every completed Hunt makes you stronger and unlocks the monster ahead.',
  },
  {
    icon: 'trophy',
    headline: 'Become the Hunter they fear.',
    body: 'One Hunt at a time.',
  },
];

interface OnboardingScreenProps {
  onDone: () => void;
}

export function OnboardingScreen({ onDone }: OnboardingScreenProps) {
  const [index, setIndex] = useState(0);
  const isLast = index === SLIDES.length - 1;
  const slide = SLIDES[index];

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <Pressable
        onPress={onDone}
        style={({ pressed }) => [styles.skip, pressed && styles.skipPressed]}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel="Skip onboarding"
      >
        <Text style={styles.skipText}>Skip</Text>
      </Pressable>

      <View style={styles.content}>
        <View style={styles.iconWrap}>
          <Ionicons name={slide.icon} size={40} color={colors.gold} />
        </View>
        <Text style={styles.headline}>{slide.headline}</Text>
        <Text style={styles.body}>{slide.body}</Text>
      </View>

      <View style={styles.dots}>
        {SLIDES.map((_, dotIndex) => (
          <View
            key={dotIndex}
            style={[styles.dot, dotIndex === index && styles.dotActive]}
          />
        ))}
      </View>

      <Button
        label={isLast ? 'Begin' : 'Next'}
        onPress={() => (isLast ? onDone() : setIndex(index + 1))}
        style={styles.button}
      />
    </SafeAreaView>
  );
}

const ICON_SIZE = 88;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.void.base,
    padding: spacing.xl,
    justifyContent: 'flex-end',
  },
  skip: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.lg,
    zIndex: 1,
    padding: spacing.xs,
  },
  skipPressed: {
    opacity: 0.6,
  },
  skipText: {
    fontFamily: fontFamily.monoRegular,
    fontSize: fontSize.sm,
    color: colors.text.muted,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrap: {
    width: ICON_SIZE,
    height: ICON_SIZE,
    borderRadius: ICON_SIZE / 2,
    borderWidth: 2,
    borderColor: colors.gold,
    backgroundColor: colors.void.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xl,
  },
  headline: {
    fontFamily: fontFamily.displayBold,
    fontSize: fontSize.xl,
    color: colors.text.primary,
    textAlign: 'center',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  body: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.lg,
    lineHeight: lineHeight.lg,
    color: colors.text.secondary,
    textAlign: 'center',
    marginTop: spacing.sm,
    maxWidth: 320,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.xs,
    marginBottom: spacing.lg,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.steel,
  },
  dotActive: {
    backgroundColor: colors.gold,
    width: 18,
  },
  button: {
    width: '100%',
  },
});
