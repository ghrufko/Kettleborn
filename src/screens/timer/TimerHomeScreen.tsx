import React from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Alert } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { TimerStackParamList } from '../../navigation/types';
import { Header, Button, GlassCard } from '../../components/core';
import { useAppStore } from '../../store';
import { TimerPreset } from '../../models';
import { colors, fontFamily, fontSize, spacing } from '../../theme';

type Props = NativeStackScreenProps<TimerStackParamList, 'TimerHome'>;

function totalRounds(preset: TimerPreset): number {
  return preset.rounds.length;
}

export function TimerHomeScreen({ navigation }: Props) {
  const userPresets = useAppStore((state) => state.userTimerPresets);
  const deleteTimerPreset = useAppStore((state) => state.deleteTimerPreset);
  const userCustomWorkouts = useAppStore((state) => state.userCustomWorkouts);
  const deleteCustomWorkout = useAppStore((state) => state.deleteCustomWorkout);
  // Task 6 (Timer cleanup): built-in presets (GS 10', EMOM, etc.) are no
  // longer shown on this screen — the screen should start empty except
  // for "New Timer". contentEngine.getBuiltInTimerPresets() and the
  // underlying content/timers/builtin-presets.json are untouched; nothing
  // here reads them anymore, but they still exist for a future screen
  // (e.g. editable campaign-workout timers) to reuse.

  const confirmDeletePreset = (preset: TimerPreset) => {
    Alert.alert(
      'Delete Timer?',
      `"${preset.name}" will be permanently removed. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => deleteTimerPreset(preset.id),
        },
      ]
    );
  };

  const confirmDeleteCustomWorkout = (workout: { id: string; name: string }) => {
    Alert.alert(
      'Delete Workout?',
      `"${workout.name}" will be permanently removed. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => deleteCustomWorkout(workout.id) },
      ]
    );
  };

  return (
    <View style={styles.container}>
      <Header title="Timer" />
      <ScrollView contentContainerStyle={styles.content}>
        {/* Stopwatch: a live tool, not a saved-preset list like the two
            sections below — one entry point is enough, no "your
            stopwatches" list to maintain. Kept small/compact per its own
            requirement ("should take minimal space"), sitting above
            everything else since it needs no setup to use. */}
        <Pressable
          onPress={() => navigation.navigate('Stopwatch')}
          style={({ pressed }) => [styles.stopwatchRow, pressed && styles.presetRowPressed]}
        >
          <Ionicons name="stopwatch-outline" size={24} color={colors.ember.base} />
          <Text style={styles.stopwatchLabel}>Stopwatch</Text>
          <Ionicons name="chevron-forward" size={20} color={colors.text.muted} />
        </Pressable>

        {userPresets.length > 0 ? (
          <>
            <Text style={[styles.sectionLabel, styles.customLabel]}>Your Timers</Text>
            {userPresets.map((preset) => (
              <Pressable
                key={preset.id}
                onPress={() =>
                  navigation.navigate('TimerRun', { presetId: preset.id, isBuiltIn: false })
                }
                style={({ pressed }) => [styles.presetRow, pressed && styles.presetRowPressed]}
              >
                <View style={styles.presetInfo}>
                  <Text style={styles.presetName}>{preset.name}</Text>
                  <Text style={styles.presetMeta}>{totalRounds(preset)} rounds</Text>
                </View>
                <Pressable
                  onPress={() => confirmDeletePreset(preset)}
                  hitSlop={8}
                  style={styles.deleteButton}
                >
                  <Ionicons name="trash-outline" size={20} color={colors.text.muted} />
                </Pressable>
                <Ionicons name="play-circle" size={28} color={colors.ember.base} />
              </Pressable>
            ))}
          </>
        ) : null}

        {/* Custom Workout Builder — same row/list pattern as "Your Timers"
            just above, deliberately not a redesign of this screen. These
            are user-authored workouts (no monster/campaign identity),
            separate from Timer presets. */}
        <Text style={[styles.sectionLabel, styles.customLabel]}>My Workouts</Text>
        {userCustomWorkouts.length === 0 ? (
          <Text style={styles.emptyWorkoutsHint}>No custom workouts yet.</Text>
        ) : (
          userCustomWorkouts.map((workout) => (
            <Pressable
              key={workout.id}
              onPress={() => navigation.navigate('CustomWorkoutSession', { customWorkoutId: workout.id })}
              style={({ pressed }) => [styles.presetRow, pressed && styles.presetRowPressed]}
            >
              <View style={styles.presetInfo}>
                <Text style={styles.presetName}>{workout.name}</Text>
                <Text style={styles.presetMeta}>
                  {workout.exercises.length} exercises · {workout.rounds} rounds
                </Text>
              </View>
              <Pressable
                onPress={() => navigation.navigate('CustomWorkoutBuilder', { id: workout.id })}
                hitSlop={8}
                style={styles.deleteButton}
              >
                <Ionicons name="create-outline" size={20} color={colors.text.muted} />
              </Pressable>
              <Pressable
                onPress={() => confirmDeleteCustomWorkout(workout)}
                hitSlop={8}
                style={styles.deleteButton}
              >
                <Ionicons name="trash-outline" size={20} color={colors.text.muted} />
              </Pressable>
              <Ionicons name="play-circle" size={28} color={colors.ember.base} />
            </Pressable>
          ))
        )}
        <Button
          label="Create Workout"
          variant="secondary"
          onPress={() => navigation.navigate('CustomWorkoutBuilder', {})}
          style={styles.newWorkoutButton}
        />

        <GlassCard style={styles.pitchCard}>
          <Text style={styles.pitchText}>
            Fully custom rounds — different work and rest on every round, rep-based sets, random
            intervals, and manual-start finishers. Build it once, save it, never think about it
            again.
          </Text>
        </GlassCard>

        <Button
          label="New Timer"
          onPress={() => navigation.navigate('TimerBuilder')}
          style={styles.newButton}
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
  },
  sectionLabel: {
    fontFamily: fontFamily.displayRegular,
    fontSize: fontSize.xs,
    letterSpacing: 2,
    color: colors.text.muted,
    textTransform: 'uppercase',
    marginBottom: spacing.sm,
  },
  customLabel: {
    marginTop: spacing.lg,
  },
  stopwatchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.charcoal.base,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.bronze.base,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  stopwatchLabel: {
    flex: 1,
    fontFamily: fontFamily.displayRegular,
    fontSize: fontSize.base,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.text.primary,
  },
  presetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.charcoal.base,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border.hairline,
    padding: spacing.sm,
    marginBottom: spacing.sm,
  },
  presetRowPressed: {
    backgroundColor: colors.charcoal.raised,
  },
  presetInfo: {
    flex: 1,
  },
  deleteButton: {
    padding: spacing.xxs,
    marginRight: spacing.xs,
  },
  presetName: {
    fontFamily: fontFamily.displayBold,
    fontSize: fontSize.base,
    color: colors.text.primary,
    textTransform: 'uppercase',
  },
  presetMeta: {
    fontFamily: fontFamily.monoRegular,
    fontSize: fontSize.xs,
    color: colors.text.muted,
    marginTop: 2,
  },
  emptyWorkoutsHint: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.sm,
    color: colors.text.muted,
    fontStyle: 'italic',
    marginBottom: spacing.sm,
  },
  newWorkoutButton: {
    marginTop: spacing.xs,
    marginBottom: spacing.md,
  },
  pitchCard: {
    marginTop: spacing.md,
  },
  pitchText: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.base,
    color: colors.text.secondary,
    textAlign: 'center',
  },
  newButton: {
    marginTop: spacing.lg,
  },
});
