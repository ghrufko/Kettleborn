import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert, BackHandler } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { TimerStackParamList } from '../../navigation/types';
import { Button, GlassCard } from '../../components/core';
import { useAppStore } from '../../store';
import { useWorkoutSession } from '../../../engines/session/useWorkoutSession';
import { customWorkoutToWorkout } from '../../utils/customWorkoutSession';
import { getExerciseBreakdown } from '../../utils/exerciseBreakdown';
import { colors, fontFamily, fontSize, spacing } from '../../theme';

type Props = NativeStackScreenProps<TimerStackParamList, 'CustomWorkoutSession'>;

function formatClock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function CustomWorkoutSessionScreen({ route, navigation }: Props) {
  const { customWorkoutId } = route.params;
  const userCustomWorkouts = useAppStore((state) => state.userCustomWorkouts);
  const saveCustomWorkoutResult = useAppStore((state) => state.saveCustomWorkoutResult);
  const customWorkout = userCustomWorkouts.find((w) => w.id === customWorkoutId);

  const workout = useMemo(() => (customWorkout ? customWorkoutToWorkout(customWorkout) : null), [customWorkout]);

  const [finished, setFinished] = useState<{ elapsedSeconds: number } | null>(null);

  const fallbackWorkout = useMemo(
    () =>
      customWorkoutToWorkout({
        id: 'missing',
        name: '',
        exercises: [],
        weightKg: 0,
        gearCount: 1,
        rounds: 1,
        restSeconds: 30,
        createdAt: '',
        updatedAt: '',
      }),
    []
  );

  const session = useWorkoutSession(workout ?? fallbackWorkout, {
    onWorkoutComplete: async ({ elapsedSeconds }) => {
      if (!customWorkout || !workout) return;
      // Journal integration (§9): snapshot everything needed to display
      // this result later, even if this CustomWorkout is subsequently
      // edited or deleted — see CustomWorkoutResult's own model comment.
      // Kettlebell weight audit: weightBKg passed through so a
      // double-bell Custom Workout's volume sums both bells' REAL weight
      // (16kg + 18kg), never assumes weightKg * 2 — see
      // resolveExerciseWeightKg in exerciseBreakdown.ts.
      const breakdown = getExerciseBreakdown(
        workout,
        customWorkout.rounds,
        customWorkout.weightKg,
        customWorkout.gearCount,
        customWorkout.gearCount === 2 ? customWorkout.weightBKg ?? customWorkout.weightKg : null
      );
      const totalReps = breakdown.reduce((sum, entry) => sum + entry.totalReps, 0);
      await saveCustomWorkoutResult({
        customWorkoutId: customWorkout.id,
        elapsedSeconds,
        weightKg: customWorkout.weightKg,
        weightBKg: customWorkout.gearCount === 2 ? customWorkout.weightBKg ?? customWorkout.weightKg : null,
        gearCount: customWorkout.gearCount,
        workoutName: customWorkout.name,
        rounds: customWorkout.rounds,
        restSeconds: customWorkout.restSeconds,
        totalReps,
        exerciseBreakdown: breakdown.map((entry) => ({
          name: entry.displayName ?? entry.name,
          totalReps: entry.totalReps,
        })),
      });
      setFinished({ elapsedSeconds });
    },
  });

  const quit = useCallback(() => {
    Alert.alert('End Workout?', 'This attempt will not be saved.', [
      { text: 'Keep Going', style: 'cancel' },
      { text: 'End Workout', style: 'destructive', onPress: () => navigation.goBack() },
    ]);
  }, [navigation]);

  // Same protection as ActiveHuntScreen (see that file's own comment) —
  // gestureEnabled is iOS-only, so Android's hardware back button needs
  // its own handler to route through the same confirmation.
  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        if (finished) return false;
        quit();
        return true;
      });
      return () => subscription.remove();
    }, [quit, finished])
  );

  if (!customWorkout || !workout) {
    return (
      <View style={styles.container}>
        <Text style={styles.missingText}>This workout no longer exists.</Text>
        <Button label="Back" onPress={() => navigation.goBack()} style={styles.missingButton} />
      </View>
    );
  }

  if (finished) {
    return (
      <View style={styles.container}>
        <View style={styles.finishedWrap}>
          <Text style={styles.finishedTitle}>Workout Complete</Text>
          <Text style={styles.finishedName}>{customWorkout.name}</Text>
          <Text style={styles.finishedTime}>{formatClock(finished.elapsedSeconds)}</Text>
          <Button label="Done" onPress={() => navigation.navigate('TimerHome')} style={styles.finishedButton} />
        </View>
      </View>
    );
  }

  const currentExercises = workout.exercises;

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.workoutName}>{customWorkout.name}</Text>

        {session.phase === 'countdown' ? (
          <GlassCard style={styles.card}>
            <Text style={styles.sectionLabel}>Get Ready</Text>
            <Text style={styles.countdownNumber}>{session.countdownRemaining}</Text>
            <Button label="Skip" variant="secondary" onPress={session.skipCountdown} style={styles.skipButton} />
          </GlassCard>
        ) : session.isResting ? (
          <GlassCard style={styles.card}>
            <Text style={styles.sectionLabel}>Resting</Text>
            <Text style={styles.restClock}>{formatClock(session.restRemainingSeconds)}</Text>
          </GlassCard>
        ) : (
          <GlassCard style={styles.card}>
            <Text style={styles.sectionLabel}>
              Round {session.currentRound} / {session.totalRounds}
            </Text>
            {currentExercises.map((exercise) => (
              <Text key={exercise.id} style={styles.exerciseLine}>
                {exercise.targetReps} × {exercise.displayName ?? exercise.name}
              </Text>
            ))}
            <Text style={styles.roundClock}>{formatClock(session.currentRoundElapsedSeconds)}</Text>
          </GlassCard>
        )}
      </ScrollView>

      {session.phase !== 'countdown' ? (
        <View style={styles.controls}>
          <View style={styles.controlsRow}>
            {session.isResting ? (
              <Button
                label="Start Next Round"
                onPress={session.startNextRoundEarly}
                disabled={session.status !== 'active'}
                style={styles.controlButton}
              />
            ) : (
              <Button
                label="Complete Round"
                onPress={session.completeRound}
                disabled={session.status !== 'active'}
                style={styles.controlButton}
              />
            )}
          </View>
          <View style={styles.controlsRow}>
            <View style={styles.controlWrap}>
              <Button
                label={session.status === 'paused' ? 'Resume' : 'Pause'}
                variant="secondary"
                onPress={session.status === 'paused' ? session.resume : session.pause}
                style={styles.controlButton}
              />
            </View>
            <View style={styles.controlWrap}>
              <Button label="Quit" variant="secondary" onPress={quit} style={styles.controlButton} />
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.void.base },
  content: { padding: spacing.md, alignItems: 'center' },
  workoutName: {
    fontFamily: fontFamily.displayBold,
    fontSize: fontSize.lg,
    color: colors.text.primary,
    marginTop: spacing.lg,
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  card: { width: '100%', alignItems: 'center', padding: spacing.lg },
  sectionLabel: {
    fontFamily: fontFamily.displayRegular,
    fontSize: fontSize.xs,
    letterSpacing: 2,
    color: colors.text.muted,
    textTransform: 'uppercase',
  },
  countdownNumber: {
    fontFamily: fontFamily.displayBold,
    fontSize: 64,
    color: colors.gold,
    marginTop: spacing.xs,
  },
  skipButton: { marginTop: spacing.md, minHeight: 36, paddingVertical: spacing.xxs },
  restClock: {
    fontFamily: fontFamily.monoBold,
    fontSize: 40,
    color: colors.bronze.base,
    marginTop: spacing.sm,
  },
  exerciseLine: {
    fontFamily: fontFamily.displayBold,
    fontSize: fontSize.xl,
    color: colors.text.primary,
    textTransform: 'uppercase',
    textAlign: 'center',
    marginTop: spacing.xxs,
  },
  roundClock: {
    fontFamily: fontFamily.monoRegular,
    fontSize: fontSize.sm,
    color: colors.bronze.base,
    marginTop: spacing.md,
  },
  controls: {
    padding: spacing.lg,
    gap: spacing.sm,
  },
  controlsRow: { flexDirection: 'row', gap: spacing.sm },
  controlWrap: { flex: 1 },
  controlButton: { width: '100%' },
  missingText: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.base,
    color: colors.text.muted,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
  missingButton: { margin: spacing.lg },
  finishedWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  finishedTitle: {
    fontFamily: fontFamily.displayBold,
    fontSize: fontSize.xl,
    color: colors.gold,
    textTransform: 'uppercase',
    letterSpacing: 2,
  },
  finishedName: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.base,
    color: colors.text.secondary,
    marginTop: spacing.sm,
  },
  finishedTime: {
    fontFamily: fontFamily.monoBold,
    fontSize: 40,
    color: colors.text.primary,
    marginTop: spacing.md,
  },
  finishedButton: { marginTop: spacing.xl, width: '100%' },
});
