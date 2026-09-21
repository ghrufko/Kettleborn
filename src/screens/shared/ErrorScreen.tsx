import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '../../components/core';
import { colors, fontFamily, fontSize, spacing, glow } from '../../theme';

interface ErrorScreenProps {
  onRetry: () => void;
}

export function ErrorScreen({ onRetry }: ErrorScreenProps) {
  return (
    <View style={styles.container}>
      <View style={[styles.badge, glow.md]}>
        <Ionicons name="alert-circle" size={44} color={colors.blood} />
      </View>
      <Text style={styles.title}>Something Went Wrong</Text>
      <Text style={styles.caption}>
        Kettleborn couldn't finish loading. Your saved progress is safe — this is a temporary
        problem, not a lost hunt.
      </Text>
      <Button label="Try Again" onPress={onRetry} style={styles.button} />
    </View>
  );
}

const BADGE_SIZE = 88;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.void.base,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  badge: {
    width: BADGE_SIZE,
    height: BADGE_SIZE,
    borderRadius: BADGE_SIZE / 2,
    borderWidth: 2,
    borderColor: colors.blood,
    backgroundColor: colors.void.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  title: {
    fontFamily: fontFamily.displayBold,
    fontSize: fontSize.xl,
    color: colors.text.primary,
    textTransform: 'uppercase',
    letterSpacing: 2,
    textAlign: 'center',
  },
  caption: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.base,
    color: colors.text.secondary,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  button: {
    width: '100%',
    marginTop: spacing.xl,
  },
});
