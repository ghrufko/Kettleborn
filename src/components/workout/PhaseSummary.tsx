import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontFamily, fontSize, spacing } from '../../theme';
import type { Exercise, Workout } from '../../models';
import { getCustomHuntModel } from '../../utils/customHuntModel';

/**
 * Compact Chain/Complex presentation (Correction Sprint 2): each phase once,
 * in authored order, with its cycle count — "CHAIN · 5 CYCLES" — and every
 * movement once with its reps, instead of every pass of every movement as
 * its own row. Renders nothing for a workout that isn't Chain/Complex
 * phased (callers keep their existing presentation for those).
 */
export function PhaseSummary({
  workout,
  onExercisePress,
}: {
  workout: Workout;
  onExercisePress?: (exercise: Exercise) => void;
}) {
  const model = getCustomHuntModel(workout);
  if (model.kind !== 'phased') return null;
  const rounds = model.layout === 'inline' ? workout.sections?.length ?? workout.rounds : null;
  return (
    <View style={styles.container}>
      {model.phases.map((phase, index) => (
        <View key={phase.cyclesKey} style={[styles.phase, index > 0 && styles.phaseDivider]}>
          <View style={styles.headingRow}>
            <Text style={styles.heading}>{phase.title}</Text>
            <Text style={styles.cycles}>
              {phase.canonicalCycles} {phase.canonicalCycles === 1 ? 'cycle' : 'cycles'}
            </Text>
          </View>
          {phase.movements.map((movement, m) => {
            const isLast = m === phase.movements.length - 1;
            const name = (
              <Text style={styles.name}>
                {movement.name}
                {phase.kind === 'chain' && !isLast ? ' →' : ''}
              </Text>
            );
            return (
              <View key={movement.key} style={styles.row}>
                <Text style={styles.index}>{m + 1}.</Text>
                {onExercisePress ? (
                  <Pressable onPress={() => onExercisePress(movement.exercise)} accessibilityRole="link" style={styles.nameWrap}>
                    {name}
                  </Pressable>
                ) : (
                  <View style={styles.nameWrap}>{name}</View>
                )}
                <Text style={styles.reps}>×{movement.canonicalReps}</Text>
              </View>
            );
          })}
        </View>
      ))}
      {rounds && rounds > 1 ? (
        <View style={styles.roundsRow}>
          <Ionicons name="repeat" size={13} color={colors.bronze.active} />
          <Text style={styles.roundsText}>Repeated for {rounds} rounds</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { width: '100%' },
  phase: { paddingVertical: spacing.xs },
  phaseDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border.hairlineStrong, marginTop: spacing.xs },
  headingRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: spacing.xxs },
  heading: { fontFamily: fontFamily.displayBold, fontSize: fontSize.base, color: colors.bronze.active, textTransform: 'uppercase', letterSpacing: 1 },
  cycles: { fontFamily: fontFamily.monoBold, fontSize: fontSize.xs, color: colors.ember.base, textTransform: 'uppercase', letterSpacing: 1 },
  row: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  index: { width: 22, fontFamily: fontFamily.monoRegular, fontSize: fontSize.sm, color: colors.text.muted },
  nameWrap: { flex: 1, minWidth: 0 },
  name: { fontFamily: fontFamily.bodySemiBold, fontSize: fontSize.base, lineHeight: 22, color: colors.text.primary },
  reps: { marginLeft: spacing.sm, fontFamily: fontFamily.monoBold, fontSize: fontSize.sm, color: colors.bronze.active },
  roundsRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xxs, marginTop: spacing.sm },
  roundsText: { fontFamily: fontFamily.monoRegular, fontSize: fontSize.xs, color: colors.text.secondary, textTransform: 'uppercase', letterSpacing: 1 },
});
