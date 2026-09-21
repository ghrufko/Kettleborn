import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { TimerStackParamList } from '../../navigation/types';
import { Header, Button, GlassCard } from '../../components/core';
import { contentEngine } from '../../../engines/content';
import { useAppStore } from '../../store';
import { TimerRound, TimerInterval } from '../../models';
import { colors, fontFamily, fontSize, radii, spacing } from '../../theme';

type Props = NativeStackScreenProps<TimerStackParamList, 'TimerBuilder'>;

type WorkMode = 'countdown' | 'stopwatch';

interface DraftRound {
  key: string;
  mode: WorkMode;
  workSeconds: number;
  workRandom: boolean;
  hasRest: boolean;
  restSeconds: number;
  restRandom: boolean;
  isExerciseSlot: boolean;
}

const RANDOM_SPREAD_SECONDS = 15;

function formatSeconds(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function newRound(index: number): DraftRound {
  return {
    key: `round-${Date.now()}-${index}`,
    mode: 'countdown',
    workSeconds: 60,
    workRandom: false,
    hasRest: true,
    restSeconds: 30,
    restRandom: false,
    isExerciseSlot: false,
  };
}

function Stepper({
  value,
  onChange,
  step = 15,
}: {
  value: number;
  onChange: (next: number) => void;
  step?: number;
}) {
  return (
    <View style={styles.stepperRow}>
      <Pressable onPress={() => onChange(Math.max(0, value - step))} style={styles.stepperButton} hitSlop={8}>
        <Ionicons name="remove" size={16} color={colors.bronze.base} />
      </Pressable>
      <Text style={styles.stepperValue}>{formatSeconds(value)}</Text>
      <Pressable onPress={() => onChange(value + step)} style={styles.stepperButton} hitSlop={8}>
        <Ionicons name="add" size={16} color={colors.bronze.base} />
      </Pressable>
    </View>
  );
}

function MiniToggle({ label, value, onToggle }: { label: string; value: boolean; onToggle: () => void }) {
  return (
    <Pressable onPress={onToggle} style={[styles.miniToggle, value && styles.miniToggleActive]}>
      <Text style={[styles.miniToggleText, value && styles.miniToggleTextActive]}>{label}</Text>
    </Pressable>
  );
}

export function TimerBuilderScreen({ navigation }: Props) {
  const saveTimerPreset = useAppStore((state) => state.saveTimerPreset);
  const workouts = contentEngine.getAllWorkouts();

  const [name, setName] = useState('');
  const [rounds, setRounds] = useState<DraftRound[]>([newRound(0)]);
  const [hasWarmup, setHasWarmup] = useState(false);
  const [warmupSeconds, setWarmupSeconds] = useState(300);
  const [linkedWorkoutId, setLinkedWorkoutId] = useState<string | null>(null);
  const [randomizeExercises, setRandomizeExercises] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const addRound = () => setRounds((current) => [...current, newRound(current.length)]);
  const removeRound = (key: string) => setRounds((current) => current.filter((r) => r.key !== key));
  const updateRound = (key: string, patch: Partial<DraftRound>) =>
    setRounds((current) => current.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const canSave = name.trim().length > 0 && rounds.length > 0 && !isSaving;

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const timerRounds: TimerRound[] = [];

      if (hasWarmup) {
        timerRounds.push({
          id: 'warmup',
          name: 'Prep',
          intervals: [{ id: 'warmup-interval', label: 'Prep', type: 'timed', durationSeconds: warmupSeconds, startSound: 'start' }],
        });
      }

      rounds.forEach((round, index) => {
        const intervals: TimerInterval[] = [];
        const workSound = index === 0 && !hasWarmup ? 'start' : 'nextRound';

        if (round.mode === 'stopwatch') {
          intervals.push({
            id: `${round.key}-work`,
            label: 'Work',
            type: 'open',
            startSound: workSound,
            isExerciseSlot: round.isExerciseSlot,
          });
        } else if (round.workRandom) {
          intervals.push({
            id: `${round.key}-work`,
            label: 'Work',
            type: 'random',
            minSeconds: Math.max(0, round.workSeconds - RANDOM_SPREAD_SECONDS),
            maxSeconds: round.workSeconds + RANDOM_SPREAD_SECONDS,
            startSound: workSound,
            isExerciseSlot: round.isExerciseSlot,
          });
        } else {
          intervals.push({
            id: `${round.key}-work`,
            label: 'Work',
            type: 'timed',
            durationSeconds: round.workSeconds,
            startSound: workSound,
            isExerciseSlot: round.isExerciseSlot,
          });
        }

        if (round.hasRest) {
          if (round.restRandom) {
            intervals.push({
              id: `${round.key}-rest`,
              label: 'Rest',
              type: 'random',
              minSeconds: Math.max(0, round.restSeconds - RANDOM_SPREAD_SECONDS),
              maxSeconds: round.restSeconds + RANDOM_SPREAD_SECONDS,
              startSound: 'rest',
            });
          } else {
            intervals.push({
              id: `${round.key}-rest`,
              label: 'Rest',
              type: 'timed',
              durationSeconds: round.restSeconds,
              startSound: 'rest',
            });
          }
        }

        timerRounds.push({ id: round.key, name: `Round ${index + 1}`, intervals });
      });

      await saveTimerPreset(name.trim(), timerRounds, {
        linkedWorkoutId: linkedWorkoutId ?? undefined,
        randomizeExercises,
      });
      navigation.goBack();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <View style={styles.container}>
      <Header title="New Timer" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.content}>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Timer name"
          placeholderTextColor={colors.text.muted}
          style={styles.nameInput}
        />

        <View style={styles.toggleRow}>
          <MiniToggle label="Prep" value={hasWarmup} onToggle={() => setHasWarmup((v) => !v)} />
        </View>
        {hasWarmup ? (
          <GlassCard style={styles.smallCard}>
            <Text style={styles.smallLabel}>Prep Duration</Text>
            <Stepper value={warmupSeconds} onChange={setWarmupSeconds} />
          </GlassCard>
        ) : null}

        {rounds.map((round, index) => (
          <GlassCard key={round.key} style={styles.roundCard}>
            <View style={styles.roundHeader}>
              <Text style={styles.roundTitle}>Round {index + 1}</Text>
              {rounds.length > 1 ? (
                <Pressable onPress={() => removeRound(round.key)} hitSlop={8}>
                  <Ionicons name="trash-outline" size={18} color={colors.blood} />
                </Pressable>
              ) : null}
            </View>

            <View style={styles.toggleRow}>
              <MiniToggle
                label="Countdown"
                value={round.mode === 'countdown'}
                onToggle={() => updateRound(round.key, { mode: 'countdown' })}
              />
              <MiniToggle
                label="Stopwatch"
                value={round.mode === 'stopwatch'}
                onToggle={() => updateRound(round.key, { mode: 'stopwatch' })}
              />
              {linkedWorkoutId ? (
                <MiniToggle
                  label="Exercise Slot"
                  value={round.isExerciseSlot}
                  onToggle={() => updateRound(round.key, { isExerciseSlot: !round.isExerciseSlot })}
                />
              ) : null}
            </View>

            {round.mode === 'countdown' ? (
              <View style={styles.fieldBlock}>
                <View style={styles.fieldHeader}>
                  <Text style={styles.smallLabel}>Work</Text>
                  <MiniToggle
                    label="Random"
                    value={round.workRandom}
                    onToggle={() => updateRound(round.key, { workRandom: !round.workRandom })}
                  />
                </View>
                <Stepper
                  value={round.workSeconds}
                  onChange={(next) => updateRound(round.key, { workSeconds: next })}
                />
              </View>
            ) : (
              <Text style={styles.stopwatchNote}>Counts up until marked complete</Text>
            )}

            <View style={styles.fieldBlock}>
              <View style={styles.fieldHeader}>
                <Text style={styles.smallLabel}>Rest</Text>
                <MiniToggle
                  label="No Rest"
                  value={!round.hasRest}
                  onToggle={() => updateRound(round.key, { hasRest: !round.hasRest })}
                />
              </View>
              {round.hasRest ? (
                <>
                  <Stepper
                    value={round.restSeconds}
                    onChange={(next) => updateRound(round.key, { restSeconds: next })}
                  />
                  <MiniToggle
                    label="Random Rest"
                    value={round.restRandom}
                    onToggle={() => updateRound(round.key, { restRandom: !round.restRandom })}
                  />
                </>
              ) : null}
            </View>
          </GlassCard>
        ))}

        <Button label="Add Round" variant="secondary" onPress={addRound} style={styles.addButton} />

        <GlassCard style={styles.smallCard}>
          <Text style={styles.smallLabel}>Link a Hunt Workout (optional)</Text>
          <Text style={styles.smallCaption}>Saved with this timer for future use.</Text>
          <View style={styles.workoutPicker}>
            {workouts.map((workout) => (
              <MiniToggle
                key={workout.id}
                label={workout.name}
                value={linkedWorkoutId === workout.id}
                onToggle={() =>
                  setLinkedWorkoutId((current) => (current === workout.id ? null : workout.id))
                }
              />
            ))}
          </View>
          {linkedWorkoutId ? (
            <MiniToggle
              label="Randomize Exercise Order"
              value={randomizeExercises}
              onToggle={() => setRandomizeExercises((v) => !v)}
            />
          ) : null}
        </GlassCard>
      </ScrollView>

      <View style={styles.footer}>
        <Button
          label={isSaving ? 'Saving…' : 'Save Timer'}
          onPress={handleSave}
          disabled={!canSave}
          style={styles.saveButton}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.void.base },
  content: { padding: spacing.md, paddingBottom: spacing.xxl, gap: spacing.sm },
  nameInput: {
    fontFamily: fontFamily.displayBold,
    fontSize: fontSize.lg,
    color: colors.text.primary,
    backgroundColor: colors.void.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border.hairline,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.xs,
  },
  toggleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.xs },
  smallCard: { marginBottom: spacing.sm },
  smallLabel: {
    fontFamily: fontFamily.displayRegular,
    fontSize: fontSize.xs,
    letterSpacing: 1,
    color: colors.text.muted,
    textTransform: 'uppercase',
  },
  smallCaption: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.xs,
    color: colors.text.muted,
    marginTop: spacing.xxs,
    marginBottom: spacing.xs,
  },
  roundCard: { marginBottom: spacing.sm },
  roundHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  roundTitle: {
    fontFamily: fontFamily.displayBold,
    fontSize: fontSize.base,
    color: colors.text.primary,
    textTransform: 'uppercase',
  },
  fieldBlock: { marginTop: spacing.sm },
  fieldHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xxs,
  },
  stopwatchNote: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.sm,
    color: colors.text.muted,
    marginTop: spacing.sm,
  },
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  stepperButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: colors.border.hairlineStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperValue: {
    fontFamily: fontFamily.monoBold,
    fontSize: fontSize.base,
    color: colors.text.primary,
    minWidth: 50,
    textAlign: 'center',
  },
  miniToggle: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border.hairlineStrong,
  },
  miniToggleActive: {
    backgroundColor: colors.bronze.base,
    borderColor: colors.bronze.base,
  },
  miniToggleText: {
    fontFamily: fontFamily.monoRegular,
    fontSize: fontSize.xs,
    color: colors.text.secondary,
    textTransform: 'uppercase',
  },
  miniToggleTextActive: {
    color: colors.text.onBronze,
  },
  workoutPicker: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs },
  addButton: { marginTop: spacing.xs },
  footer: {
    padding: spacing.md,
    backgroundColor: colors.void.base,
    borderTopWidth: 1,
    borderTopColor: colors.border.hairline,
  },
  saveButton: { width: '100%' },
});
