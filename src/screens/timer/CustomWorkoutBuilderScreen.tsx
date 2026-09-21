import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { TimerStackParamList } from '../../navigation/types';
import { Header, Button, GlassCard } from '../../components/core';
import { contentEngine } from '../../../engines/content';
import { useAppStore } from '../../store';
import { CustomWorkoutExercise } from '../../models';
import { convertKgToDisplay, convertDisplayToKg } from '../../utils/weight';
import { colors, fontFamily, fontSize, radii, spacing } from '../../theme';

type Props = NativeStackScreenProps<TimerStackParamList, 'CustomWorkoutBuilder'>;

const MAX_WEIGHT_KG = 60;
const MIN_WEIGHT_KG = 0.5;
const WEIGHT_STEP_KG = 1;
const MIN_ROUNDS = 1;
const MAX_ROUNDS = 20;
const MIN_REST_SECONDS = 15;
const REST_STEP_SECONDS = 5;
const MIN_REPS = 1;
const MAX_REPS = 100;

function formatRestSeconds(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function MiniToggle({ label, value, onToggle }: { label: string; value: boolean; onToggle: () => void }) {
  return (
    <Pressable onPress={onToggle} style={[styles.miniToggle, value && styles.miniToggleActive]}>
      <Text style={[styles.miniToggleText, value && styles.miniToggleTextActive]}>{label}</Text>
    </Pressable>
  );
}

interface DraftExercise {
  key: string;
  exerciseId: string;
  displayName: string;
  reps: number;
}

export function CustomWorkoutBuilderScreen({ route, navigation }: Props) {
  const editingId = route.params?.id;
  const userCustomWorkouts = useAppStore((state) => state.userCustomWorkouts);
  const saveCustomWorkout = useAppStore((state) => state.saveCustomWorkout);
  const unitPreference = useAppStore((state) => state.settings?.unitPreference ?? 'kg');
  const library = useMemo(() => contentEngine.getExerciseLibrary(), []);

  const editingWorkout = editingId ? userCustomWorkouts.find((w) => w.id === editingId) : undefined;

  const [name, setName] = useState(editingWorkout?.name ?? '');
  const [exercises, setExercises] = useState<DraftExercise[]>(() => {
    if (!editingWorkout) return [];
    return editingWorkout.exercises
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((e) => {
        const entry = contentEngine.getExerciseLibraryEntry(e.exerciseId);
        return {
          key: `${e.exerciseId}-${e.order}`,
          exerciseId: e.exerciseId,
          displayName: entry?.name ?? e.exerciseId,
          reps: e.reps,
        };
      });
  });
  const [showPicker, setShowPicker] = useState(false);
  const [gearCount, setGearCount] = useState<1 | 2>(editingWorkout?.gearCount ?? 2);
  const [weightInput, setWeightInput] = useState(
    String(convertKgToDisplay(editingWorkout?.weightKg ?? 16, unitPreference))
  );
  // Kettlebell weight audit: the second bell's own weight — independent
  // from weightInput (16kg + 18kg is valid, never assumed equal). Seeded
  // from the first bell's weight when there's nothing saved yet, same
  // "both bells start equal, then the player can split them" default as
  // Custom Hunt's Training Mode.
  const [weightBInput, setWeightBInput] = useState(
    String(convertKgToDisplay(editingWorkout?.weightBKg ?? editingWorkout?.weightKg ?? 16, unitPreference))
  );
  const [rounds, setRounds] = useState(editingWorkout?.rounds ?? 3);
  const [restSeconds, setRestSeconds] = useState(editingWorkout?.restSeconds ?? 60);
  const [isSaving, setIsSaving] = useState(false);

  const parsedWeightKg = convertDisplayToKg(parseFloat(weightInput.replace(',', '.')) || 0, unitPreference);
  const isWeightValid = Number.isFinite(parsedWeightKg) && parsedWeightKg > 0 && parsedWeightKg <= MAX_WEIGHT_KG;
  const parsedWeightBKg = convertDisplayToKg(parseFloat(weightBInput.replace(',', '.')) || 0, unitPreference);
  const isWeightBValid =
    gearCount === 1 ||
    (Number.isFinite(parsedWeightBKg) && parsedWeightBKg > 0 && parsedWeightBKg <= MAX_WEIGHT_KG);
  const canStart = name.trim().length > 0 && exercises.length > 0 && isWeightValid && isWeightBValid;

  const addExercise = (exerciseId: string, displayName: string) => {
    setExercises((current) => [
      ...current,
      { key: `${exerciseId}-${Date.now()}`, exerciseId, displayName, reps: 5 },
    ]);
    setShowPicker(false);
  };

  const removeExercise = (key: string) => {
    setExercises((current) => current.filter((e) => e.key !== key));
  };

  const moveExercise = (index: number, direction: -1 | 1) => {
    setExercises((current) => {
      const next = current.slice();
      const target = index + direction;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const setReps = (key: string, reps: number) => {
    setExercises((current) => current.map((e) => (e.key === key ? { ...e, reps } : e)));
  };

  const startWorkout = async () => {
    setIsSaving(true);
    try {
      const exerciseInputs: CustomWorkoutExercise[] = exercises.map((e, index) => ({
        exerciseId: e.exerciseId,
        reps: e.reps,
        order: index,
      }));
      const saved = await saveCustomWorkout({
        id: editingId,
        name: name.trim(),
        exercises: exerciseInputs,
        weightKg: parsedWeightKg,
        weightBKg: gearCount === 2 ? parsedWeightBKg : undefined,
        gearCount,
        rounds,
        restSeconds,
      });
      navigation.replace('CustomWorkoutSession', { customWorkoutId: saved.id });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <View style={styles.container}>
      <Header title="Custom Workout" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.content}>
        <GlassCard style={styles.section}>
          <Text style={styles.sectionLabel}>Workout Name</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Untitled Workout"
            placeholderTextColor={colors.text.muted}
            style={styles.nameInput}
          />
        </GlassCard>

        <GlassCard style={styles.section}>
          <Text style={styles.sectionLabel}>Exercises</Text>
          {exercises.length === 0 ? (
            <Text style={styles.emptyHint}>Add at least one exercise to build this workout.</Text>
          ) : null}
          {exercises.map((exercise, index) => (
            <View key={exercise.key} style={styles.exerciseRow}>
              <View style={styles.exerciseReorderCol}>
                <Pressable
                  onPress={() => moveExercise(index, -1)}
                  disabled={index === 0}
                  hitSlop={6}
                  style={styles.reorderButton}
                >
                  <Ionicons name="chevron-up" size={14} color={index === 0 ? colors.steel : colors.bronze.base} />
                </Pressable>
                <Pressable
                  onPress={() => moveExercise(index, 1)}
                  disabled={index === exercises.length - 1}
                  hitSlop={6}
                  style={styles.reorderButton}
                >
                  <Ionicons
                    name="chevron-down"
                    size={14}
                    color={index === exercises.length - 1 ? colors.steel : colors.bronze.base}
                  />
                </Pressable>
              </View>
              <Text style={styles.exerciseName} numberOfLines={1}>
                {exercise.displayName}
              </Text>
              <View style={styles.repsStepperRow}>
                <Pressable
                  onPress={() => setReps(exercise.key, Math.max(MIN_REPS, exercise.reps - 1))}
                  hitSlop={8}
                  style={styles.repsStepButton}
                >
                  <Ionicons name="remove" size={14} color={colors.bronze.base} />
                </Pressable>
                <Text style={styles.repsValue}>{exercise.reps}</Text>
                <Pressable
                  onPress={() => setReps(exercise.key, Math.min(MAX_REPS, exercise.reps + 1))}
                  hitSlop={8}
                  style={styles.repsStepButton}
                >
                  <Ionicons name="add" size={14} color={colors.bronze.base} />
                </Pressable>
              </View>
              <Pressable onPress={() => removeExercise(exercise.key)} hitSlop={8} style={styles.removeButton}>
                <Ionicons name="trash-outline" size={18} color={colors.text.muted} />
              </Pressable>
            </View>
          ))}

          <Button
            label={showPicker ? 'Close' : '+ Add Exercise'}
            variant="secondary"
            onPress={() => setShowPicker((v) => !v)}
            style={styles.addExerciseButton}
          />

          {showPicker ? (
            // Bug fix: this was a plain `View` with `maxHeight: 260` — RN
            // clips a View's overflow by default, so with 52 Exercise
            // Library entries (see audit below) only the first ~8 rows
            // that fit in 260px were ever reachable; the rest were
            // silently clipped, not just scrolled-off. A `ScrollView`
            // (with nestedScrollEnabled for Android, since this sits
            // inside the screen's own outer ScrollView) makes every
            // entry in the library actually reachable. No data changed —
            // content/exercises/library.json already lists all 52
            // exercises used across every monster workout in all 3
            // campaigns (audited: 44 distinct exercise names in current
            // monster content, all 44 already present here by name).
            <ScrollView style={styles.pickerList} nestedScrollEnabled>
              {library.map((entry) => (
                <Pressable
                  key={entry.id}
                  onPress={() => addExercise(entry.id, entry.name)}
                  style={({ pressed }) => [styles.pickerRow, pressed && styles.pickerRowPressed]}
                >
                  <Text style={styles.pickerRowText}>{entry.name}</Text>
                  <Text style={styles.pickerRowCategory}>{entry.category}</Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : null}
        </GlassCard>

        <GlassCard style={styles.section}>
          <Text style={styles.sectionLabel}>Workout Settings</Text>

          <View style={styles.settingsRow}>
            <Text style={styles.settingsLabel}>Kettlebells</Text>
            <View style={styles.miniToggleGroup}>
              <MiniToggle label="1" value={gearCount === 1} onToggle={() => setGearCount(1)} />
              <MiniToggle label="2" value={gearCount === 2} onToggle={() => setGearCount(2)} />
            </View>
          </View>

          <View style={styles.settingsRow}>
            <Text style={styles.settingsLabel}>{gearCount === 2 ? 'Kettlebell 1' : 'Weight'}</Text>
            <View style={styles.weightStepper}>
              <Pressable
                onPress={() =>
                  setWeightInput(
                    String(
                      convertKgToDisplay(
                        Math.max(MIN_WEIGHT_KG, parsedWeightKg - WEIGHT_STEP_KG),
                        unitPreference
                      )
                    )
                  )
                }
                hitSlop={8}
                style={styles.repsStepButton}
              >
                <Ionicons name="remove" size={16} color={colors.bronze.base} />
              </Pressable>
              <TextInput
                value={weightInput}
                onChangeText={setWeightInput}
                keyboardType="decimal-pad"
                style={[styles.weightInputCompact, !isWeightValid && styles.weightInputError]}
              />
              <Pressable
                onPress={() =>
                  setWeightInput(
                    String(
                      convertKgToDisplay(
                        Math.min(MAX_WEIGHT_KG, parsedWeightKg + WEIGHT_STEP_KG),
                        unitPreference
                      )
                    )
                  )
                }
                hitSlop={8}
                style={styles.repsStepButton}
              >
                <Ionicons name="add" size={16} color={colors.bronze.base} />
              </Pressable>
              <Text style={styles.weightUnit}>{unitPreference}</Text>
            </View>
          </View>

          {gearCount === 2 ? (
            // Kettlebell weight audit: independent second bell, same
            // stepper chrome as the first — the two are never forced
            // equal, e.g. 16kg + 18kg.
            <View style={styles.settingsRow}>
              <Text style={styles.settingsLabel}>Kettlebell 2</Text>
              <View style={styles.weightStepper}>
                <Pressable
                  onPress={() =>
                    setWeightBInput(
                      String(
                        convertKgToDisplay(
                          Math.max(MIN_WEIGHT_KG, parsedWeightBKg - WEIGHT_STEP_KG),
                          unitPreference
                        )
                      )
                    )
                  }
                  hitSlop={8}
                  style={styles.repsStepButton}
                >
                  <Ionicons name="remove" size={16} color={colors.bronze.base} />
                </Pressable>
                <TextInput
                  value={weightBInput}
                  onChangeText={setWeightBInput}
                  keyboardType="decimal-pad"
                  style={[styles.weightInputCompact, !isWeightBValid && styles.weightInputError]}
                />
                <Pressable
                  onPress={() =>
                    setWeightBInput(
                      String(
                        convertKgToDisplay(
                          Math.min(MAX_WEIGHT_KG, parsedWeightBKg + WEIGHT_STEP_KG),
                          unitPreference
                        )
                      )
                    )
                  }
                  hitSlop={8}
                  style={styles.repsStepButton}
                >
                  <Ionicons name="add" size={16} color={colors.bronze.base} />
                </Pressable>
                <Text style={styles.weightUnit}>{unitPreference}</Text>
              </View>
            </View>
          ) : null}

          <View style={styles.settingsRow}>
            <Text style={styles.settingsLabel}>Rounds</Text>
            <View style={styles.repsStepperRow}>
              <Pressable
                onPress={() => setRounds(Math.max(MIN_ROUNDS, rounds - 1))}
                hitSlop={8}
                style={styles.repsStepButton}
              >
                <Ionicons name="remove" size={16} color={colors.bronze.base} />
              </Pressable>
              <Text style={styles.repsValue}>{rounds}</Text>
              <Pressable
                onPress={() => setRounds(Math.min(MAX_ROUNDS, rounds + 1))}
                hitSlop={8}
                style={styles.repsStepButton}
              >
                <Ionicons name="add" size={16} color={colors.bronze.base} />
              </Pressable>
            </View>
          </View>

          <View style={styles.settingsRow}>
            <Text style={styles.settingsLabel}>Rest Between Rounds</Text>
            <View style={styles.repsStepperRow}>
              <Pressable
                onPress={() => setRestSeconds(Math.max(MIN_REST_SECONDS, restSeconds - REST_STEP_SECONDS))}
                hitSlop={8}
                style={styles.repsStepButton}
              >
                <Ionicons name="remove" size={16} color={colors.bronze.base} />
              </Pressable>
              <Text style={styles.repsValue}>{formatRestSeconds(restSeconds)}</Text>
              <Pressable
                onPress={() => setRestSeconds(restSeconds + REST_STEP_SECONDS)}
                hitSlop={8}
                style={styles.repsStepButton}
              >
                <Ionicons name="add" size={16} color={colors.bronze.base} />
              </Pressable>
            </View>
          </View>
        </GlassCard>
      </ScrollView>

      <View style={styles.footer}>
        <Button
          label="Start Workout"
          disabled={!canStart || isSaving}
          onPress={startWorkout}
          style={styles.startButton}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.void.base },
  content: { padding: spacing.md, paddingBottom: spacing.xl },
  section: { marginBottom: spacing.md },
  sectionLabel: {
    fontFamily: fontFamily.displayRegular,
    fontSize: fontSize.xs,
    letterSpacing: 2,
    color: colors.text.muted,
    textTransform: 'uppercase',
    marginBottom: spacing.sm,
  },
  nameInput: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.base,
    color: colors.text.primary,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.hairline,
    paddingBottom: spacing.xs,
  },
  emptyHint: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.sm,
    color: colors.text.muted,
    fontStyle: 'italic',
  },
  exerciseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.border.hairline,
  },
  exerciseReorderCol: { justifyContent: 'center' },
  reorderButton: { padding: 2 },
  exerciseName: {
    flex: 1,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: fontSize.sm,
    color: colors.text.primary,
  },
  repsStepperRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  repsStepButton: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: colors.border.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  repsValue: {
    fontFamily: fontFamily.monoBold,
    fontSize: fontSize.sm,
    color: colors.text.primary,
    minWidth: 28,
    textAlign: 'center',
  },
  removeButton: { padding: spacing.xxs },
  addExerciseButton: { marginTop: spacing.sm },
  pickerList: {
    marginTop: spacing.sm,
    maxHeight: 260,
  },
  pickerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.border.hairline,
  },
  pickerRowPressed: { backgroundColor: colors.charcoal.raised },
  pickerRowText: { fontFamily: fontFamily.bodyRegular, fontSize: fontSize.sm, color: colors.text.primary },
  pickerRowCategory: { fontFamily: fontFamily.monoRegular, fontSize: 10, color: colors.text.muted },
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  settingsLabel: { fontFamily: fontFamily.bodyRegular, fontSize: fontSize.sm, color: colors.text.secondary },
  miniToggleGroup: { flexDirection: 'row', gap: spacing.xs },
  miniToggle: {
    width: 36,
    height: 36,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniToggleActive: { borderColor: colors.bronze.base, backgroundColor: colors.charcoal.raised },
  miniToggleText: { fontFamily: fontFamily.monoBold, fontSize: fontSize.sm, color: colors.text.muted },
  miniToggleTextActive: { color: colors.bronze.base },
  weightStepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  weightInputCompact: {
    fontFamily: fontFamily.monoBold,
    fontSize: fontSize.sm,
    color: colors.text.primary,
    minWidth: 44,
    textAlign: 'center',
    borderBottomWidth: 1,
    borderBottomColor: colors.border.hairline,
  },
  weightInputError: { borderBottomColor: colors.blood },
  weightUnit: { fontFamily: fontFamily.monoRegular, fontSize: fontSize.xs, color: colors.text.muted },
  footer: {
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border.hairline,
  },
  startButton: {},
});
