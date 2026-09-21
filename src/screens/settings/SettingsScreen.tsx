import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Switch, Pressable, Alert } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ForgeStackParamList } from '../../navigation/types';
import { Header, GlassCard, Button } from '../../components/core';
import { useAppStore } from '../../store';
import { colors, fontFamily, fontSize, spacing } from '../../theme';

type Props = NativeStackScreenProps<ForgeStackParamList, 'Settings'>;

function ToggleRow({
  label,
  value,
  onValueChange,
}: {
  label: string;
  value: boolean;
  onValueChange: (next: boolean) => void;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: colors.charcoal.raised, true: colors.bronze.base }}
        thumbColor={colors.text.primary}
      />
    </View>
  );
}

export function SettingsScreen({ navigation }: Props) {
  const settings = useAppStore((state) => state.settings);
  const updateSettings = useAppStore((state) => state.updateSettings);
  const resetCampaignProgress = useAppStore((state) => state.resetCampaignProgress);
  const [isResetting, setIsResetting] = useState(false);

  const confirmResetCampaign = () => {
    Alert.alert(
      'Reset Campaign Progress?',
      'This will erase your campaign progress and Personal Best records, and start Campaign I over as a new player. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            setIsResetting(true);
            try {
              await resetCampaignProgress();
            } finally {
              setIsResetting(false);
            }
          },
        },
      ]
    );
  };

  if (!settings) {
    return (
      <View style={styles.container}>
        <Header title="Settings" onBack={() => navigation.goBack()} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Header title="Settings" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.content}>
        <GlassCard style={styles.card}>
          <Text style={styles.sectionLabel}>Units</Text>
          <View style={styles.unitRow}>
            {(['kg', 'lb'] as const).map((unit) => (
              <Pressable
                key={unit}
                onPress={() => updateSettings({ unitPreference: unit })}
                style={[
                  styles.unitOption,
                  settings.unitPreference === unit && styles.unitOptionActive,
                ]}
              >
                <Text
                  style={[
                    styles.unitOptionText,
                    settings.unitPreference === unit && styles.unitOptionTextActive,
                  ]}
                >
                  {unit.toUpperCase()}
                </Text>
              </Pressable>
            ))}
          </View>
        </GlassCard>

        <GlassCard style={styles.card}>
          <Text style={styles.sectionLabel}>Timer</Text>
          <ToggleRow
            label="Sounds"
            value={settings.soundEnabled}
            onValueChange={(value) => updateSettings({ soundEnabled: value })}
          />
          <ToggleRow
            label="Vibration"
            value={settings.hapticsEnabled}
            onValueChange={(value) => updateSettings({ hapticsEnabled: value })}
          />
        </GlassCard>

        <GlassCard style={styles.card}>
          <Text style={styles.sectionLabel}>Display</Text>
          <ToggleRow
            label="Keep Screen Awake"
            value={settings.keepScreenAwake}
            onValueChange={(value) => updateSettings({ keepScreenAwake: value })}
          />
        </GlassCard>

        <Text style={styles.footnote}>
          Sound and vibration apply to both Hunts and the Timer. Keep Screen Awake applies while a
          Hunt or Timer is actively running.
        </Text>

        <GlassCard style={styles.card}>
          <Text style={styles.sectionLabel}>Danger Zone</Text>
          <Button
            label={isResetting ? 'Resetting…' : 'Reset Campaign Progress'}
            variant="destructive"
            onPress={confirmResetCampaign}
            disabled={isResetting}
          />
          <Text style={styles.dangerCaption}>
            Erases campaign progress, defeated/unlocked monster state, and Personal Best records.
            Your app settings and equipment are kept.
          </Text>
        </GlassCard>
      </ScrollView>
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
  card: {
    width: '100%',
  },
  sectionLabel: {
    fontFamily: fontFamily.displayRegular,
    fontSize: fontSize.xs,
    letterSpacing: 2,
    color: colors.text.muted,
    textTransform: 'uppercase',
    marginBottom: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  rowLabel: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.base,
    color: colors.text.primary,
  },
  unitRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  unitOption: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border.hairlineStrong,
  },
  unitOptionActive: {
    backgroundColor: colors.bronze.base,
    borderColor: colors.bronze.base,
  },
  unitOptionText: {
    fontFamily: fontFamily.monoBold,
    fontSize: fontSize.base,
    color: colors.text.secondary,
  },
  unitOptionTextActive: {
    color: colors.text.onBronze,
  },
  footnote: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.sm,
    color: colors.text.muted,
    textAlign: 'center',
    paddingHorizontal: spacing.md,
  },
  dangerCaption: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.sm,
    color: colors.text.muted,
    marginTop: spacing.sm,
  },
});
