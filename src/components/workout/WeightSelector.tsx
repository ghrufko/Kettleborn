import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontFamily, fontSize, radii, spacing } from '../../theme';

interface WeightSelectorProps {
  valueA: number;
  unit: 'kg' | 'lb';
  valueB?: number;
  onPress?: () => void;
}

export function WeightSelector({ valueA, valueB, unit, onPress }: WeightSelectorProps) {
  const isDouble = typeof valueB === 'number';

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Weight ${valueA}${isDouble ? ` and ${valueB}` : ''} ${unit}`}
      style={({ pressed }) => [styles.container, pressed && styles.pressed]}
    >
      <Bell value={valueA} unit={unit} />
      {isDouble ? <Bell value={valueB as number} unit={unit} /> : null}
      {onPress ? (
        <Ionicons name="pencil" size={14} color={colors.text.muted} style={styles.editIcon} />
      ) : null}
    </Pressable>
  );
}

function Bell({ value, unit }: { value: number; unit: 'kg' | 'lb' }) {
  return (
    <View style={styles.bell}>
      <Ionicons name="barbell-outline" size={18} color={colors.bronze.base} />
      <Text style={styles.bellValue}>{value}</Text>
      <Text style={styles.bellUnit}>{unit.toUpperCase()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  pressed: {
    opacity: 0.7,
  },
  bell: {
    alignItems: 'center',
    backgroundColor: colors.void.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border.hairline,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    minWidth: 56,
  },
  bellValue: {
    fontFamily: fontFamily.monoBold,
    fontSize: fontSize.base,
    color: colors.text.primary,
    marginTop: 2,
  },
  bellUnit: {
    fontFamily: fontFamily.monoRegular,
    fontSize: fontSize.xs,
    color: colors.text.muted,
  },
  editIcon: {
    marginLeft: spacing.xxs,
  },
});
