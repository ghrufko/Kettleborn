import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, fontFamily, fontSize, radii, spacing } from '../../theme';
import type { EquipmentRule } from '../../utils/equipmentRules';

/**
 * Kettleborn's kettlebell glyph, drawn from plain views (no image, no SVG
 * dependency): a bronze handle arch over a forged bronze bell with an
 * ember-lit core and a flat base — the game's own silhouette, not a
 * borrowed fitness icon.
 */
function Kettlebell({ size, dim = false }: { size: number; dim?: boolean }) {
  // Proportions of a real bell: a wide, flat-topped handle whose horns
  // run down into a round body, and a flat foot — deliberately unlike the
  // app's padlock (narrow shackle, square body, keyhole).
  const handleWidth = size * 0.8;
  const stroke = Math.max(2, Math.round(size * 0.14));
  const metal = dim ? colors.bronze.base : colors.bronze.active;
  const bodySize = size * 0.86;
  return (
    <View style={{ width: size, height: size * 1.14 }}>
      <View
        style={{
          position: 'absolute',
          top: 0,
          left: (size - handleWidth) / 2,
          width: handleWidth,
          height: size * 0.62,
          borderWidth: stroke,
          borderBottomWidth: 0,
          borderColor: metal,
          borderTopLeftRadius: size * 0.22,
          borderTopRightRadius: size * 0.22,
        }}
      />
      <View
        style={{
          position: 'absolute',
          top: size * 0.24,
          left: (size - bodySize) / 2,
          width: bodySize,
          height: bodySize,
          borderRadius: bodySize / 2,
          backgroundColor: metal,
        }}
      >
        {/* Forge light on the shoulder of the bell. */}
        <View
          style={{
            position: 'absolute',
            top: bodySize * 0.16,
            left: bodySize * 0.18,
            width: bodySize * 0.26,
            height: bodySize * 0.14,
            borderRadius: bodySize * 0.1,
            backgroundColor: colors.ember.glow,
            opacity: 0.55,
            transform: [{ rotate: '-30deg' }],
          }}
        />
      </View>
      <View
        style={{
          position: 'absolute',
          bottom: 0,
          left: size * 0.26,
          width: size * 0.48,
          height: Math.max(2, size * 0.1),
          borderRadius: 1,
          backgroundColor: metal,
        }}
      />
    </View>
  );
}

/**
 * The equipment a hunt needs, from the same central rule Custom Hunt uses
 * (src/utils/equipmentRules.ts): one bell, a pair, or — for Behemoth and
 * The Duelist, which may be done either way — a neutral "1 or 2" mark that
 * never claims a fixed count.
 */
export function EquipmentIcon({ rule, size = 18 }: { rule: EquipmentRule; size?: number }) {
  const label =
    rule.kind === 'flexible' ? '1 or 2' : rule.gearCount === 2 ? '2 KB' : '1 KB';
  const accessibilityLabel =
    rule.kind === 'flexible'
      ? 'One or two kettlebells'
      : rule.gearCount === 2
        ? 'Two kettlebells'
        : 'One kettlebell';
  return (
    <View style={styles.badge} accessible accessibilityRole="image" accessibilityLabel={accessibilityLabel}>
      <View style={styles.bells}>
        {rule.kind === 'fixed' && rule.gearCount === 1 ? (
          <Kettlebell size={size} />
        ) : rule.kind === 'fixed' ? (
          <>
            <Kettlebell size={size} />
            <View style={{ marginLeft: Math.max(2, size * 0.14) }}>
              <Kettlebell size={size} />
            </View>
          </>
        ) : (
          <>
            <Kettlebell size={size} />
            <View style={styles.flexDivider} />
            <View style={{ opacity: 0.55 }}>
              <Kettlebell size={size * 0.8} dim />
            </View>
          </>
        )}
      </View>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 58,
    paddingHorizontal: spacing.xs,
    paddingTop: spacing.xs,
    paddingBottom: spacing.xxs,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border.hairlineStrong,
    backgroundColor: colors.charcoal.base,
  },
  bells: { flexDirection: 'row', alignItems: 'flex-end' },
  flexDivider: {
    width: 1,
    height: 14,
    marginHorizontal: 4,
    backgroundColor: colors.border.hairlineStrong,
  },
  label: {
    marginTop: 3,
    fontFamily: fontFamily.monoBold,
    fontSize: 10,
    letterSpacing: 1,
    color: colors.bronze.active,
    textTransform: 'uppercase',
  },
});
