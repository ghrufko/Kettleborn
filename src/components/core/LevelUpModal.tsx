import React, { useEffect, useRef } from 'react';
import { Modal, View, Text, StyleSheet, Animated, Pressable } from 'react-native';
import * as Haptics from 'expo-haptics';
import { audioEngine } from '../../../engines/audio/AudioEngine';
import { triggerHaptic } from '../../utils/haptics';
import { colors, fontFamily, fontSize, spacing, glow } from '../../theme';

interface LevelUpModalProps {
  visible: boolean;
  newLevel: number;
  title: string;
  onDismiss: () => void;
}

/**
 * Fired whenever completeHunt reports leveledUp === true. Owns its own
 * sound + haptic on mount so any screen can just render it conditionally
 * without repeating that wiring — the Victory screen is the only caller
 * today, but this isn't Victory-screen-specific.
 */
export function LevelUpModal({ visible, newLevel, title, onDismiss }: LevelUpModalProps) {
  const scale = useRef(new Animated.Value(0.6)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) {
      return;
    }
    audioEngine.playSound('levelUp');
    triggerHaptic(Haptics.ImpactFeedbackStyle.Heavy);
    scale.setValue(0.6);
    opacity.setValue(0);
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 14, bounciness: 12 }),
      Animated.timing(opacity, { toValue: 1, duration: 250, useNativeDriver: true }),
    ]).start();
  }, [visible, scale, opacity]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <Pressable style={styles.backdrop} onPress={onDismiss}>
        <Animated.View
          style={[styles.card, glow.lg, { opacity, transform: [{ scale }] }]}
        >
          <Text style={styles.eyebrow}>Level Up</Text>
          <Text style={styles.level}>{newLevel}</Text>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.hint}>Tap to continue</Text>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(10, 9, 8, 0.82)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  card: {
    width: '100%',
    maxWidth: 320,
    alignItems: 'center',
    backgroundColor: colors.charcoal.base,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: colors.gold,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  eyebrow: {
    fontFamily: fontFamily.displayRegular,
    fontSize: fontSize.xs,
    letterSpacing: 3,
    color: colors.bronze.base,
    textTransform: 'uppercase',
  },
  level: {
    fontFamily: fontFamily.displayBold,
    fontSize: 72,
    color: colors.gold,
    marginTop: spacing.xs,
  },
  title: {
    fontFamily: fontFamily.displayBold,
    fontSize: fontSize.xl,
    color: colors.text.primary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: spacing.xxs,
  },
  hint: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.sm,
    color: colors.text.muted,
    marginTop: spacing.lg,
  },
});
