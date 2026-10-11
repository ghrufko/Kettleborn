import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable, ScrollView } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { ForgeStackParamList } from '../../navigation/types';
import { Header, GlassCard, Button } from '../../components/core';
import { useAppStore } from '../../store';
import { Equipment } from '../../models';
import { convertKgToDisplay, convertDisplayToKg } from '../../utils/weight';
import { colors, fontFamily, fontSize, radii, spacing } from '../../theme';

type Props = NativeStackScreenProps<ForgeStackParamList, 'Forge'>;

// Same bounds/step the Custom Workout Builder already uses for a weight
// input — reused rather than inventing a second convention.
const MIN_WEIGHT_KG = 1;
const MAX_WEIGHT_KG = 60;
const WEIGHT_STEP_KG = 1;

function KettlebellRow({
  item,
  unitPreference,
  onChangeWeight,
  onChangeLabel,
  onRemove,
}: {
  item: Equipment;
  unitPreference: 'kg' | 'lb';
  onChangeWeight: (weightKg: number) => void;
  onChangeLabel: (label: string) => void;
  onRemove: () => void;
}) {
  // Local text state so typing feels immediate; persisted on blur rather
  // than on every keystroke (the weight stepper below persists on every
  // tap instead, since each tap is already a discrete, infrequent action).
  const [labelText, setLabelText] = useState(item.label);
  const displayValue = convertKgToDisplay(item.weight, unitPreference);

  const step = (direction: 1 | -1) => {
    const nextDisplay = displayValue + direction * WEIGHT_STEP_KG;
    const nextKg = convertDisplayToKg(nextDisplay, unitPreference);
    onChangeWeight(Math.min(MAX_WEIGHT_KG, Math.max(MIN_WEIGHT_KG, nextKg)));
  };

  return (
    <View style={styles.row}>
      <Ionicons name="barbell-outline" size={20} color={colors.bronze.base} style={styles.rowIcon} />
      <TextInput
        style={styles.labelInput}
        value={labelText}
        onChangeText={setLabelText}
        onBlur={() => {
          if (labelText.trim().length > 0 && labelText !== item.label) {
            onChangeLabel(labelText.trim());
          } else {
            setLabelText(item.label);
          }
        }}
        placeholder="Kettlebell"
        placeholderTextColor={colors.text.muted}
        accessibilityLabel="Kettlebell label"
      />
      <View style={styles.weightStepperRow}>
        <Pressable
          onPress={() => step(-1)}
          hitSlop={8}
          style={styles.stepButton}
          accessibilityRole="button"
          accessibilityLabel="Decrease weight"
        >
          <Ionicons name="remove" size={14} color={colors.bronze.base} />
        </Pressable>
        <Text style={styles.weightValue}>
          {displayValue} {unitPreference.toUpperCase()}
        </Text>
        <Pressable
          onPress={() => step(1)}
          hitSlop={8}
          style={styles.stepButton}
          accessibilityRole="button"
          accessibilityLabel="Increase weight"
        >
          <Ionicons name="add" size={14} color={colors.bronze.base} />
        </Pressable>
      </View>
      <Pressable
        onPress={onRemove}
        hitSlop={8}
        style={styles.removeButton}
        accessibilityRole="button"
        accessibilityLabel={`Remove ${item.label}`}
      >
        <Ionicons name="trash-outline" size={18} color={colors.text.muted} />
      </Pressable>
    </View>
  );
}

export function ForgeScreen({ navigation }: Props) {
  const equipment = useAppStore((state) => state.equipment);
  const unitPreference = useAppStore((state) => state.settings?.unitPreference ?? 'kg');
  const saveEquipment = useAppStore((state) => state.saveEquipment);
  const deleteEquipment = useAppStore((state) => state.deleteEquipment);
  const [error, setError] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);

  const kettlebells = equipment.filter((item) => item.type === 'kettlebell' && item.owned);

  const handleSaveFailure = () => setError('Could not save your equipment. Try again.');

  const handleAddKettlebell = async () => {
    setError(null);
    setIsAdding(true);
    try {
      await saveEquipment({ type: 'kettlebell', weightKg: 16, label: '16 KG' });
    } catch {
      handleSaveFailure();
    } finally {
      setIsAdding(false);
    }
  };

  const handleChangeWeight = async (item: Equipment, weightKg: number) => {
    setError(null);
    try {
      await saveEquipment({ id: item.id, type: item.type, weightKg, label: item.label });
    } catch {
      handleSaveFailure();
    }
  };

  const handleChangeLabel = async (item: Equipment, label: string) => {
    setError(null);
    try {
      await saveEquipment({ id: item.id, type: item.type, weightKg: item.weight, label });
    } catch {
      handleSaveFailure();
    }
  };

  const handleRemove = async (item: Equipment) => {
    setError(null);
    try {
      await deleteEquipment(item.id);
    } catch {
      setError('Could not remove that kettlebell. Try again.');
    }
  };

  return (
    <View style={styles.container}>
      <Header title="Forge" />
      <ScrollView contentContainerStyle={styles.content}>
        <GlassCard>
          <Text style={styles.sectionLabel}>Your Kettlebells</Text>
          {kettlebells.length === 0 ? (
            <Text style={styles.caption}>No kettlebells recorded yet. Add one below.</Text>
          ) : (
            kettlebells.map((item) => (
              <KettlebellRow
                key={item.id}
                item={item}
                unitPreference={unitPreference}
                onChangeWeight={(weightKg) => handleChangeWeight(item, weightKg)}
                onChangeLabel={(label) => handleChangeLabel(item, label)}
                onRemove={() => handleRemove(item)}
              />
            ))
          )}
          <Button
            label={isAdding ? 'Adding…' : '+ Add Kettlebell'}
            variant="secondary"
            onPress={handleAddKettlebell}
            disabled={isAdding}
            style={styles.addButton}
          />
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
        </GlassCard>
        <Text style={styles.caption}>
          Keep a record of the kettlebells you actually own. Each Hunt still asks you to confirm
          the weight you're using that session on the Hunt Brief screen.
        </Text>

        <Button
          label="Settings"
          variant="secondary"
          onPress={() => navigation.navigate('Settings')}
          style={styles.settingsButton}
        />
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
    // Bottom-nav clearance fix — see MonsterDetailScreen.tsx's identical
    // comment; same spacing.xxl convention every tab-bar-visible
    // scrollable screen now uses.
    paddingBottom: spacing.xxl,
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.hairline,
  },
  rowIcon: {
    flexShrink: 0,
  },
  labelInput: {
    flex: 1,
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.base,
    color: colors.text.primary,
    minWidth: 60,
  },
  weightStepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  stepButton: {
    width: 28,
    height: 28,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border.hairlineStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weightValue: {
    fontFamily: fontFamily.monoBold,
    fontSize: fontSize.base,
    color: colors.text.primary,
    minWidth: 56,
    textAlign: 'center',
  },
  removeButton: {
    paddingLeft: spacing.xs,
  },
  addButton: {
    marginTop: spacing.md,
  },
  errorText: {
    marginTop: spacing.sm,
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.sm,
    color: colors.ember.base,
    textAlign: 'center',
  },
  settingsButton: {
    marginTop: spacing.md,
  },
});
