import React from 'react';
import { View, Text, Pressable, StyleSheet, ImageSourcePropType, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontFamily, fontSize, radii, spacing, glow, RarityTier } from '../../theme';

interface MonsterCardProps {
  name: string;
  title: string;
  rarity: RarityTier;
  huntsCompleted: number;
  huntsTotal: number;
  locked?: boolean;
  portraitSource?: ImageSourcePropType;
  onPress?: () => void;
}

const RARITY_GLOW: Record<RarityTier, keyof typeof glow> = {
  common: 'none',
  elite: 'sm',
  boss: 'md',
  legendary: 'lg',
};

export function MonsterCard({
  name,
  title,
  rarity,
  huntsCompleted,
  huntsTotal,
  locked = false,
  portraitSource,
  onPress,
}: MonsterCardProps) {
  const rarityColor = colors.rarity[rarity];
  const isComplete = !locked && huntsTotal > 0 && huntsCompleted >= huntsTotal;

  return (
    <Pressable
      onPress={locked ? undefined : onPress}
      disabled={locked}
      accessibilityRole="button"
      accessibilityLabel={name}
      style={({ pressed }) => [styles.container, pressed && !locked && styles.pressed]}
    >
      <View
        style={[
          styles.portraitWrap,
          { borderColor: rarityColor },
          glow[RARITY_GLOW[rarity]],
        ]}
      >
        {portraitSource ? (
          <Image source={portraitSource} style={styles.portraitImage} resizeMode="cover" />
        ) : (
          <Text style={styles.portraitInitial}>{name.charAt(0)}</Text>
        )}
        {locked ? (
          <View style={styles.lockOverlay}>
            <Ionicons name="lock-closed" size={18} color={colors.text.secondary} />
          </View>
        ) : null}
      </View>

      <View style={styles.info}>
        <Text style={[styles.name, locked && styles.dimmed]} numberOfLines={1}>
          {name}
        </Text>
        <Text style={[styles.title, locked && styles.dimmed]} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.progress}>
          {huntsCompleted} / {huntsTotal} Hunts
        </Text>
      </View>

      {isComplete ? (
        <Ionicons name="checkmark-circle" size={22} color={colors.gold} />
      ) : locked ? null : (
        <Ionicons name="chevron-forward" size={20} color={colors.steel} />
      )}
    </Pressable>
  );
}

const PORTRAIT_SIZE = 56;

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.charcoal.base,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border.hairline,
    padding: spacing.sm,
    gap: spacing.sm,
  },
  pressed: {
    backgroundColor: colors.charcoal.raised,
  },
  portraitWrap: {
    width: PORTRAIT_SIZE,
    height: PORTRAIT_SIZE,
    borderRadius: PORTRAIT_SIZE / 2,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.void.surface,
    overflow: 'hidden',
  },
  portraitImage: {
    width: '100%',
    height: '100%',
  },
  portraitInitial: {
    fontFamily: fontFamily.displayBold,
    fontSize: fontSize.xl,
    color: colors.text.secondary,
  },
  lockOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(10, 9, 8, 0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: {
    flex: 1,
  },
  name: {
    fontFamily: fontFamily.displayBold,
    fontSize: fontSize.base,
    color: colors.text.primary,
    textTransform: 'uppercase',
  },
  title: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.sm,
    color: colors.text.secondary,
    marginTop: 2,
  },
  progress: {
    fontFamily: fontFamily.monoRegular,
    fontSize: fontSize.xs,
    color: colors.text.muted,
    marginTop: spacing.xxs,
  },
  dimmed: {
    color: colors.steel,
  },
});
