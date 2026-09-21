import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { TimerStackParamList } from '../../navigation/types';
import { Header, Button, GlassCard } from '../../components/core';
import { ProgressBar } from '../../components/progress';
import { TimerWidget } from '../../components/workout';
import { contentEngine } from '../../../engines/content';
import { useTimerSession } from '../../../engines/timer/useTimerSession';
import { audioEngine } from '../../../engines/audio/AudioEngine';
import { useAppStore } from '../../store';
import { useConditionalKeepAwake } from '../../utils/useConditionalKeepAwake';
import { TimerInterval, TimerPreset } from '../../models';
import { colors, fontFamily, fontSize, spacing } from '../../theme';

type Props = NativeStackScreenProps<TimerStackParamList, 'TimerRun'>;

function formatClock(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return { minutes, seconds };
}

function playIntervalStartSound(interval: TimerInterval) {
  if (interval.startSound && interval.startSound !== 'none') {
    audioEngine.playSound(interval.startSound);
  }
}

export function TimerRunScreen({ route, navigation }: Props) {
  const { presetId, isBuiltIn } = route.params;
  const userPresets = useAppStore((state) => state.userTimerPresets);
  const saveTimerResult = useAppStore((state) => state.saveTimerResult);

  const preset: TimerPreset | undefined = isBuiltIn
    ? contentEngine.getBuiltInTimerPresets().find((p) => p.id === presetId)
    : userPresets.find((p) => p.id === presetId);

  if (!preset) {
    return (
      <View style={styles.container}>
        <Header title="Not Found" onBack={() => navigation.goBack()} />
        <View style={styles.missingState}>
          <Text style={styles.missingText}>This timer could not be found.</Text>
        </View>
      </View>
    );
  }

  return <TimerRunSession preset={preset} onExit={() => navigation.goBack()} onSave={saveTimerResult} />;
}

interface TimerRunSessionProps {
  preset: TimerPreset;
  onExit: () => void;
  onSave: (params: {
    presetId: string;
    presetName: string;
    totalDurationSeconds: number;
    weightKg: number | null;
  }) => Promise<unknown>;
}

function TimerRunSession({ preset, onExit, onSave }: TimerRunSessionProps) {
  const [isSaving, setIsSaving] = useState(false);
  const keepScreenAwake = useAppStore((state) => state.settings?.keepScreenAwake ?? false);
  useConditionalKeepAwake(keepScreenAwake);

  const handleTick = useCallback((remaining: number) => {
    if (remaining === 10) {
      audioEngine.playSound('countdown');
    } else if (remaining > 0 && remaining <= 3) {
      audioEngine.playSound('countdownUrgent');
    }
  }, []);

  const handleComplete = useCallback(() => {
    audioEngine.playSound('finish');
  }, []);

  const session = useTimerSession(preset, {
    onIntervalStart: playIntervalStartSound,
    onTick: handleTick,
    onComplete: handleComplete,
  });

  const clock = formatClock(session.remainingSeconds ?? 0);
  const isCountingDown = session.currentStep.interval.type === 'timed' || session.currentStep.interval.type === 'random';
  const isManualType = session.currentStep.interval.type === 'reps' || session.currentStep.interval.type === 'open';

  const handleFinish = async () => {
    setIsSaving(true);
    try {
      await onSave({
        presetId: preset.id,
        presetName: preset.name,
        totalDurationSeconds: session.elapsedTotalSeconds,
        weightKg: null,
      });
      onExit();
    } finally {
      setIsSaving(false);
    }
  };

  const handleQuit = () => {
    Alert.alert('End Timer?', 'This session will not be saved.', [
      { text: 'Keep Going', style: 'cancel' },
      { text: 'End', style: 'destructive', onPress: onExit },
    ]);
  };

  return (
    <View style={styles.container}>
      <Header title={preset.name} onBack={handleQuit} />
      <ScrollView contentContainerStyle={styles.content}>
        <ProgressBar
          progress={preset.rounds.length > 0 ? (session.stepIndex + 1) / session.totalSteps : 0}
          style={styles.progressBar}
        />
        <Text style={styles.roundLabel}>{session.currentStep.roundName}</Text>

        {session.isComplete ? (
          <GlassCard style={styles.completeCard} glow="lg">
            <Text style={styles.completeTitle}>Timer Complete</Text>
            <Text style={styles.completeCaption}>
              Total time {formatClock(session.elapsedTotalSeconds).minutes}:
              {formatClock(session.elapsedTotalSeconds).seconds.toString().padStart(2, '0')}
            </Text>
          </GlassCard>
        ) : (
          <>
            <GlassCard style={styles.intervalCard} glow="md">
              <Text style={styles.intervalLabel}>{session.currentStep.interval.label}</Text>
              {session.nextStep ? (
                <Text style={styles.nextLabel}>
                  Next: {session.nextStep.interval.label}
                  {session.nextStep.roundIndex !== session.currentStep.roundIndex
                    ? ` (${session.nextStep.roundName})`
                    : ''}
                </Text>
              ) : (
                <Text style={styles.nextLabel}>Final interval</Text>
              )}
            </GlassCard>

            {isCountingDown ? (
              <TimerWidget
                label={session.currentStep.interval.label}
                minutes={clock.minutes}
                seconds={clock.seconds}
                isRunning={session.status === 'active'}
              />
            ) : (
              <View style={styles.manualBlock}>
                <Text style={styles.manualText}>
                  {session.currentStep.interval.type === 'reps' ? 'Complete your reps' : 'Work until ready'}
                </Text>
              </View>
            )}

            {session.status === 'awaiting-start' ? (
              <Button label="Continue" onPress={session.beginManualStart} style={styles.wideButton} />
            ) : isManualType ? (
              <Button label="Mark Complete" onPress={session.markStepComplete} style={styles.wideButton} />
            ) : null}
          </>
        )}

        <View style={styles.actions}>
          {session.isComplete ? (
            <Button
              label={isSaving ? 'Saving…' : 'Finish'}
              onPress={handleFinish}
              disabled={isSaving}
              style={styles.actionButton}
            />
          ) : (
            <>
              {session.status !== 'awaiting-start' ? (
                <Button
                  label={session.status === 'paused' ? 'Resume' : 'Pause'}
                  onPress={session.status === 'paused' ? session.resume : session.pause}
                  style={styles.actionButton}
                />
              ) : null}
              <Button
                label="Previous"
                variant="secondary"
                onPress={session.goToPrevious}
                disabled={session.stepIndex === 0}
                style={styles.actionButton}
              />
              <Button label="Skip" variant="secondary" onPress={session.skip} style={styles.actionButton} />
              <Button label="End" variant="destructive" onPress={handleQuit} style={styles.actionButton} />
            </>
          )}
        </View>
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
    alignItems: 'center',
    padding: spacing.lg,
    gap: spacing.sm,
  },
  missingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  missingText: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.lg,
    color: colors.text.secondary,
  },
  progressBar: {
    width: '100%',
  },
  roundLabel: {
    fontFamily: fontFamily.displayRegular,
    fontSize: fontSize.sm,
    letterSpacing: 2,
    color: colors.bronze.base,
    textTransform: 'uppercase',
  },
  intervalCard: {
    width: '100%',
    alignItems: 'center',
    marginTop: spacing.sm,
    paddingVertical: spacing.lg,
  },
  intervalLabel: {
    fontFamily: fontFamily.displayBold,
    fontSize: fontSize.display,
    color: colors.text.primary,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  nextLabel: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.sm,
    color: colors.text.muted,
    marginTop: spacing.xs,
  },
  manualBlock: {
    paddingVertical: spacing.xl,
  },
  manualText: {
    fontFamily: fontFamily.bodySemiBold,
    fontSize: fontSize.lg,
    color: colors.text.secondary,
  },
  wideButton: {
    width: '100%',
  },
  completeCard: {
    width: '100%',
    alignItems: 'center',
    marginTop: spacing.md,
  },
  completeTitle: {
    fontFamily: fontFamily.displayBold,
    fontSize: fontSize.xl,
    color: colors.gold,
    textTransform: 'uppercase',
    letterSpacing: 2,
  },
  completeCaption: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.base,
    color: colors.text.secondary,
    marginTop: spacing.xs,
  },
  actions: {
    width: '100%',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  actionButton: {
    width: '100%',
  },
});
