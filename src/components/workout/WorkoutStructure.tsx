import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fontFamily, fontSize, spacing } from '../../theme';
import type { WorkoutPresentationGroup } from '../../utils/workoutPresentation';

interface Props {
  groups: WorkoutPresentationGroup[];
  compact?: boolean;
  onExercisePress?: (exerciseName: string) => void;
}

/** Shared compact view of the authored chain/complex structure. */
export function WorkoutStructure({ groups, compact = false, onExercisePress }: Props) {
  if (!groups.length) return null;

  return (
    <View style={styles.container}>
      {groups.map((group, index) => (
        <View key={group.id} style={[styles.group, index > 0 && styles.groupDivider, compact && styles.groupCompact]}>
          <View style={styles.headingRow}>
            <Text style={[styles.heading, compact && styles.headingCompact]}>{group.label}</Text>
            {group.occurrenceCount > 1 ? (
              <Text style={styles.occurrence}>{group.occurrence}/{group.occurrenceCount}</Text>
            ) : null}
          </View>
          <Text style={styles.summary}>
            {group.kind === 'chain' ? `${group.label.split(' ')[1]} passes · ` : ''}
            {group.exercises.length} {group.exercises.length === 1 ? 'exercise' : 'exercises'}
            {group.repsEach !== null ? ` · ${group.repsEach} rep${group.repsEach === 1 ? '' : 's'} each` : ''}
          </Text>
          <View style={styles.exerciseRow}>
            {group.exercises.map((exercise, exerciseIndex) => {
              const name = (exercise.displayName ?? exercise.name)
                .replace(/\s*\((?:Chain \d+\/\d+|Complex\s*[×x]\s*\d+)\)\s*$/i, '')
                .trim();
              const content = (
                <Text style={[styles.exerciseName, compact && styles.exerciseNameCompact]}>
                  {name}{exerciseIndex < group.exercises.length - 1 ? '  ·  ' : ''}
                </Text>
              );
              return onExercisePress ? (
                <Pressable key={exercise.id} onPress={() => onExercisePress(exercise.name)}>
                  {content}
                </Pressable>
              ) : (
                <View key={exercise.id}>{content}</View>
              );
            })}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { width: '100%' },
  group: { width: '100%', paddingVertical: spacing.sm },
  groupCompact: { paddingVertical: spacing.xs },
  groupDivider: { borderTopWidth: 1, borderTopColor: colors.border.hairline },
  headingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  heading: {
    fontFamily: fontFamily.displayBold,
    fontSize: fontSize.base,
    color: colors.bronze.active,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  headingCompact: { fontSize: fontSize.sm },
  occurrence: {
    fontFamily: fontFamily.monoRegular,
    fontSize: fontSize.xs,
    color: colors.text.muted,
  },
  summary: {
    marginTop: 2,
    fontFamily: fontFamily.monoRegular,
    fontSize: fontSize.xs,
    color: colors.text.muted,
  },
  exerciseRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.xxs },
  exerciseName: {
    fontFamily: fontFamily.bodySemiBold,
    fontSize: fontSize.base,
    color: colors.text.primary,
  },
  exerciseNameCompact: { fontSize: fontSize.sm },
});
