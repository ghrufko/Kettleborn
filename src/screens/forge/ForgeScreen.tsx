import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ForgeStackParamList } from '../../navigation/types';
import { Header, GlassCard, Button } from '../../components/core';
import { WeightSelector } from '../../components/workout';
import { useAppStore } from '../../store';
import { convertKgToDisplay } from '../../utils/weight';
import { colors, fontFamily, fontSize, spacing } from '../../theme';

type Props = NativeStackScreenProps<ForgeStackParamList, 'Forge'>;

export function ForgeScreen({ navigation }: Props) {
  const equipment = useAppStore((state) => state.equipment);
  const unitPreference = useAppStore((state) => state.settings?.unitPreference ?? 'kg');
  const kettlebells = equipment.filter((item) => item.type === 'kettlebell' && item.owned);

  return (
    <View style={styles.container}>
      <Header title="Forge" />
      <View style={styles.content}>
        <GlassCard>
          <Text style={styles.sectionLabel}>Your Kettlebells</Text>
          {kettlebells.length >= 2 ? (
            <WeightSelector
              valueA={convertKgToDisplay(kettlebells[0].weight, unitPreference)}
              valueB={convertKgToDisplay(kettlebells[1].weight, unitPreference)}
              unit={unitPreference}
            />
          ) : kettlebells.length === 1 ? (
            <WeightSelector
              valueA={convertKgToDisplay(kettlebells[0].weight, unitPreference)}
              unit={unitPreference}
            />
          ) : (
            <Text style={styles.caption}>No kettlebells recorded yet.</Text>
          )}
        </GlassCard>
        <Text style={styles.caption}>Editing your equipment set is coming in a future update.</Text>

        <Button
          label="Settings"
          variant="secondary"
          onPress={() => navigation.navigate('Settings')}
          style={styles.settingsButton}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.void.base,
  },
  content: {
    padding: spacing.md,
    gap: spacing.md,
  },
  sectionLabel: {
    fontFamily: fontFamily.displayRegular,
    fontSize: fontSize.xs,
    letterSpacing: 2,
    color: colors.text.muted,
    textTransform: 'uppercase',
    marginBottom: spacing.sm,
  },
  caption: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.base,
    color: colors.text.secondary,
    textAlign: 'center',
    paddingHorizontal: spacing.md,
  },
  settingsButton: {
    marginTop: spacing.md,
  },
});
