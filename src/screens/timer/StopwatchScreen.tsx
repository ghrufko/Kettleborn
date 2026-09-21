import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, Alert } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { TimerStackParamList } from '../../navigation/types';
import { Header, Button, GlassCard, AppBackground } from '../../components/core';
import { useIntervalClock } from '../../../engines/timer/useIntervalClock';
import { useAppStore } from '../../store';
import { colors, fontFamily, fontSize, spacing } from '../../theme';

type Props = NativeStackScreenProps<TimerStackParamList, 'Stopwatch'>;

type Phase = 'idle' | 'running' | 'paused' | 'reviewing' | 'saved';

function formatElapsed(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const mm = m.toString().padStart(2, '0');
  const ss = s.toString().padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * Stopwatch (new Timer mode): a plain running clock with LAP and a
 * freeform note, saved as its own StopwatchResult — never a Monster Hunt
 * or Custom Workout. Reuses the existing useIntervalClock hook (same
 * raw 1-second-tick plumbing the Hunt/Timer sessions already use) rather
 * than a new setInterval — see that hook's own comment. No Battle
 * Engine, XP, Hunt Rank, or monster progression is touched anywhere in
 * this screen.
 */
export function StopwatchScreen({ navigation }: Props) {
  const saveStopwatchResult = useAppStore((state) => state.saveStopwatchResult);
  const [phase, setPhase] = useState<Phase>('idle');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [laps, setLaps] = useState<number[]>([]);
  const [note, setNote] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useIntervalClock(phase === 'running', () => {
    setElapsedSeconds((current) => current + 1);
  });

  const start = () => setPhase('running');
  const pause = () => setPhase('paused');
  const resume = () => setPhase('running');

  const addLap = () => {
    setLaps((current) => [...current, elapsedSeconds]);
  };

  const resetToIdle = () => {
    setPhase('idle');
    setElapsedSeconds(0);
    setLaps([]);
    setNote('');
  };

  const confirmReset = () => {
    if (elapsedSeconds === 0) {
      resetToIdle();
      return;
    }
    Alert.alert('Reset Stopwatch?', 'This time will not be saved. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Reset', style: 'destructive', onPress: resetToIdle },
    ]);
  };

  const finish = () => {
    setPhase('reviewing');
  };

  const save = async () => {
    setIsSaving(true);
    try {
      await saveStopwatchResult({ elapsedSeconds, laps, note });
      setPhase('saved');
    } finally {
      setIsSaving(false);
    }
  };

  const discard = () => {
    Alert.alert('Discard This Session?', 'This time will not be saved. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: resetToIdle },
    ]);
  };

  if (phase === 'saved') {
    return (
      <AppBackground style={styles.container}>
        <Header title="Stopwatch" onBack={() => navigation.navigate('TimerHome')} />
        <View style={styles.savedWrap}>
          <Ionicons name="checkmark-circle" size={56} color={colors.gold} />
          <Text style={styles.savedTitle}>Session Saved</Text>
          <Text style={styles.savedSubtitle}>It's in your Chronicle now.</Text>
          <Button label="New Session" onPress={resetToIdle} style={styles.savedButton} />
          <Button
            label="Back to Timer"
            variant="secondary"
            onPress={() => navigation.navigate('TimerHome')}
            style={styles.savedButton}
          />
        </View>
      </AppBackground>
    );
  }

  return (
    <AppBackground style={styles.container}>
      <Header title="Stopwatch" onBack={() => navigation.navigate('TimerHome')} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.clockWrap}>
          <Text style={styles.clockText}>{formatElapsed(elapsedSeconds)}</Text>
        </View>

        {phase === 'reviewing' ? (
          <>
            <GlassCard style={styles.card}>
              <Text style={styles.sectionLabel}>Note</Text>
              <Text style={styles.noteHint}>
                What you did, kettlebells used, rounds/reps, how it felt — anything, or nothing.
              </Text>
              <TextInput
                style={styles.noteInput}
                placeholder="Optional note…"
                placeholderTextColor={colors.text.muted}
                value={note}
                onChangeText={setNote}
                multiline
                maxLength={500}
              />
            </GlassCard>
            {laps.length > 0 ? <LapList laps={laps} /> : null}
            <Button label={isSaving ? 'Saving…' : 'Save Session'} onPress={save} disabled={isSaving} />
            <Button
              label="Discard"
              variant="secondary"
              onPress={discard}
              disabled={isSaving}
              style={styles.discardButton}
            />
          </>
        ) : (
          <>
            <View style={styles.controlsRow}>
              {phase === 'idle' ? (
                <Button label="Start" onPress={start} style={styles.mainButton} />
              ) : phase === 'running' ? (
                <Button label="Pause" variant="secondary" onPress={pause} style={styles.mainButton} />
              ) : (
                <Button label="Resume" onPress={resume} style={styles.mainButton} />
              )}
            </View>

            {phase !== 'idle' ? (
              <Pressable
                onPress={addLap}
                disabled={phase !== 'running'}
                style={({ pressed }) => [
                  styles.lapButton,
                  phase !== 'running' && styles.lapButtonDisabled,
                  pressed && phase === 'running' && styles.lapButtonPressed,
                ]}
              >
                <Text style={styles.lapButtonText}>LAP</Text>
              </Pressable>
            ) : null}

            {phase !== 'idle' ? (
              <View style={styles.secondaryRow}>
                <Button label="Reset" variant="secondary" onPress={confirmReset} style={styles.secondaryButton} />
                <Button label="Finish" onPress={finish} style={styles.secondaryButton} />
              </View>
            ) : null}

            {laps.length > 0 ? <LapList laps={laps} /> : null}
          </>
        )}
      </ScrollView>
    </AppBackground>
  );
}

function LapList({ laps }: { laps: number[] }) {
  return (
    <GlassCard style={styles.card}>
      <Text style={styles.sectionLabel}>Laps</Text>
      {/* Requirement 3: each LAP shows both its own lap time (delta from
          the previous lap) and the total elapsed time at that point —
          most-recent lap first so the number the athlete cares about
          mid-set is always at the top, no scrolling needed. The existing
          ScrollView around this whole screen is the "existing scroll/
          layout system" this reuses — no separate nested scroll view or
          FlatList was added for what's realistically a short list. */}
      {[...laps].reverse().map((totalAtLap, reversedIndex) => {
        const index = laps.length - 1 - reversedIndex;
        const previousTotal = index > 0 ? laps[index - 1] : 0;
        const lapDuration = totalAtLap - previousTotal;
        return (
          <View key={index} style={styles.lapRow}>
            <Text style={styles.lapIndex}>Lap {index + 1}</Text>
            <Text style={styles.lapTime}>{formatElapsed(lapDuration)}</Text>
            <Text style={styles.lapTotal}>{formatElapsed(totalAtLap)} total</Text>
          </View>
        );
      })}
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: spacing.md,
    gap: spacing.md,
  },
  clockWrap: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
  },
  clockText: {
    fontFamily: fontFamily.monoBold,
    fontSize: 64,
    color: colors.text.primary,
  },
  controlsRow: {
    alignItems: 'center',
  },
  mainButton: {
    width: '100%',
  },
  lapButton: {
    width: '100%',
    minHeight: 72,
    borderRadius: 20,
    backgroundColor: colors.charcoal.base,
    borderWidth: 1,
    borderColor: colors.bronze.base,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lapButtonPressed: {
    opacity: 0.75,
  },
  lapButtonDisabled: {
    opacity: 0.4,
  },
  lapButtonText: {
    fontFamily: fontFamily.displayBold,
    fontSize: fontSize.lg,
    color: colors.ember.base,
    letterSpacing: 3,
  },
  secondaryRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  secondaryButton: {
    flex: 1,
  },
  discardButton: {
    marginTop: spacing.xs,
  },
  card: {
    width: '100%',
  },
  sectionLabel: {
    fontFamily: fontFamily.displayRegular,
    fontSize: fontSize.xs,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: colors.text.muted,
    marginBottom: spacing.xs,
  },
  noteHint: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.xs,
    color: colors.text.muted,
    marginBottom: spacing.sm,
  },
  noteInput: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.base,
    color: colors.text.primary,
    minHeight: 72,
    textAlignVertical: 'top',
    borderBottomWidth: 1,
    borderBottomColor: colors.border.hairline,
    paddingBottom: spacing.sm,
  },
  lapRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.hairline,
  },
  lapIndex: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.sm,
    color: colors.text.muted,
    flex: 1,
  },
  lapTime: {
    fontFamily: fontFamily.monoBold,
    fontSize: fontSize.sm,
    color: colors.text.primary,
    flex: 1,
    textAlign: 'center',
  },
  lapTotal: {
    fontFamily: fontFamily.monoRegular,
    fontSize: fontSize.xs,
    color: colors.text.muted,
    flex: 1,
    textAlign: 'right',
  },
  savedWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
    gap: spacing.sm,
  },
  savedTitle: {
    fontFamily: fontFamily.displayBold,
    fontSize: fontSize.lg,
    color: colors.text.primary,
    textTransform: 'uppercase',
    letterSpacing: 2,
  },
  savedSubtitle: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.sm,
    color: colors.text.muted,
  },
  savedButton: {
    width: '100%',
    marginTop: spacing.sm,
  },
});
