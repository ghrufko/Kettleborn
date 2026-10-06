import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { contentEngine } from '../../../engines/content';
import { colors, fontFamily, fontSize, spacing } from '../../theme';
import type { Exercise } from '../../models';
import { isAlternatingHandChain } from '../../utils/workoutPresentation';
import type { WorkoutPresentationGroup } from '../../utils/workoutPresentation';

interface Props {
  groups: WorkoutPresentationGroup[];
  compact?: boolean;
  onExercisePress?: (exercise: Exercise) => void;
}

function AlternatingHandChain({
  exercises,
  compact,
  navigate,
  onExercisePress,
}: {
  exercises: WorkoutPresentationGroup['exercises'];
  compact: boolean;
  navigate: (screen: string, params: { exerciseId: string }) => void;
  onExercisePress?: (exercise: WorkoutPresentationGroup['exercises'][number]) => void;
}) {
  const left = exercises.filter((exercise) => /^\s*left\s*[·:-]/i.test(exercise.displayName ?? ''));
  const right = exercises.filter((exercise) => /^\s*right\s*[·:-]/i.test(exercise.displayName ?? ''));
  const renderFlow = (items: typeof left) => (
    <View style={styles.sequenceFlow}>
      {items.map((exercise, index) => {
        const libraryEntry = exercise.libraryExerciseId
          ? contentEngine.getExerciseLibraryEntry(exercise.libraryExerciseId)
          : contentEngine.getExerciseLibraryEntryByName(exercise.name);
        const onPress = () => {
          if (onExercisePress) onExercisePress(exercise);
          else if (libraryEntry) navigate('ExerciseDetail', { exerciseId: libraryEntry.id });
        };
        return (
          <React.Fragment key={exercise.id}>
            {index > 0 ? <Text style={styles.sequenceArrow}> → </Text> : null}
            {libraryEntry || onExercisePress ? (
              <Pressable onPress={onPress} accessibilityRole="link">
                <Text style={[styles.sequenceMovement, compact && styles.sequenceMovementCompact]}>
                  {exercise.name}
                </Text>
              </Pressable>
            ) : (
              <Text style={[styles.sequenceMovement, compact && styles.sequenceMovementCompact]}>
                {exercise.name}
              </Text>
            )}
          </React.Fragment>
        );
      })}
    </View>
  );

  return (
    <View style={[styles.alternatingChain, compact && styles.alternatingChainCompact]}>
      <Text style={styles.handHeading}>LEFT HAND</Text>
      {renderFlow(left.slice(0, -1))}
      <View style={styles.handTransition}>
        {renderFlow([left[left.length - 1]])}
        <Text style={styles.transitionLabel}>→ SWITCH HANDS</Text>
      </View>
      <Text style={styles.handHeading}>RIGHT HAND</Text>
      {renderFlow(right.slice(0, -1))}
      <View style={styles.handTransition}>
        {renderFlow([right[right.length - 1]])}
        <Text style={styles.transitionLabel}>→ SWITCH BACK</Text>
      </View>
    </View>
  );
}

/** Shared readable, numbered view of the authored chain/complex structure. */
export function WorkoutStructure({ groups, compact = false, onExercisePress }: Props) {
  const navigation = useNavigation<any>();
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
            {group.kind === 'chain' && /^Chain \d+$/i.test(group.label) ? `${group.label.split(' ')[1]} passes · ` : ''}
            {group.exercises.length} {group.exercises.length === 1 ? 'exercise' : 'exercises'}
            {group.repsEach !== null ? ` · ${group.repsEach} rep${group.repsEach === 1 ? '' : 's'} each` : ''}
          </Text>
          {isAlternatingHandChain(group.exercises) ? (
            <>
              <Text style={styles.handRepSummary}>
                {group.label.match(/×\s*(\d+)/)?.[1] ?? group.occurrenceCount} reps per hand
              </Text>
              <AlternatingHandChain
                exercises={group.exercises}
                compact={compact}
                navigate={(screen, params) => navigation.navigate(screen, params)}
                onExercisePress={onExercisePress}
              />
            </>
          ) : <View style={styles.exerciseList}>
            {group.exercises.map((exercise, exerciseIndex) => {
              const rawName = (exercise.displayName ?? exercise.name)
                .replace(/\s*\((?:Chain \d+\/\d+|Complex\s*[×x]\s*\d+)\)\s*$/i, '')
                .trim();
              const name = rawName.replace(/\s*→\s*$/, '');
              const reps = group.repsEach ?? exercise.targetReps;
              const steps = exercise.targetSteps;
              const target = steps ? `${steps} steps` : reps ? `×${reps}` : '';
              const libraryEntry = exercise.libraryExerciseId
                ? contentEngine.getExerciseLibraryEntry(exercise.libraryExerciseId)
                : exercise.components?.[0]?.libraryExerciseId
                  ? contentEngine.getExerciseLibraryEntry(exercise.components[0].libraryExerciseId)
                  : contentEngine.getExerciseLibraryEntryByName(exercise.name);
              const isClickable = !!libraryEntry || !!onExercisePress;
              const onPress = () => {
                if (onExercisePress) onExercisePress(exercise);
                else if (libraryEntry) navigation.navigate('ExerciseDetail', { exerciseId: libraryEntry.id });
              };
              const Name = (
                <Text style={[styles.exerciseName, compact && styles.exerciseNameCompact]}>
                  {name}
                  {exerciseIndex < group.exercises.length - 1 ? ' →' : ''}
                </Text>
              );
              const componentLabels = exercise.components?.length && name.includes('→')
                ? exercise.components.map((component) => ({
                    id: component.libraryExerciseId,
                    name: contentEngine.getExerciseLibraryEntry(component.libraryExerciseId)?.name ?? component.libraryExerciseId,
                  }))
                : null;
              const cycleNote = componentLabels ? name.match(/\s*\(([^)]+)\)$/)?.[0] ?? '' : '';

              return (
                <View key={exercise.id} style={styles.exerciseRow}>
                  <Text style={[styles.index, compact && styles.indexCompact]}>{exerciseIndex + 1}.</Text>
                  <View style={styles.nameColumn}>
                    {componentLabels ? (
                      <View style={styles.componentNames}>
                        {componentLabels.map((component, componentIndex) => (
                          <React.Fragment key={component.id}>
                            {componentIndex > 0 ? <Text style={[styles.exerciseName, compact && styles.exerciseNameCompact]}> → </Text> : null}
                            <Pressable
                              onPress={() => navigation.navigate('ExerciseDetail', { exerciseId: component.id })}
                              accessibilityRole="link"
                            >
                              <Text style={[styles.exerciseName, compact && styles.exerciseNameCompact]}>{component.name}</Text>
                            </Pressable>
                          </React.Fragment>
                        ))}
                        {cycleNote ? <Text style={[styles.exerciseName, compact && styles.exerciseNameCompact]}>{cycleNote}</Text> : null}
                      </View>
                    ) : isClickable ? (
                      <Pressable onPress={onPress} accessibilityRole="link" style={styles.namePressable}>
                        {Name}
                        {libraryEntry ? <Ionicons name="information-circle-outline" size={15} color={colors.text.muted} /> : null}
                      </Pressable>
                    ) : Name}
                  </View>
                  {!!target && <Text style={[styles.target, compact && styles.targetCompact]}>{target}</Text>}
                </View>
              );
            })}
          </View>}
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
  occurrence: { fontFamily: fontFamily.monoRegular, fontSize: fontSize.xs, color: colors.text.muted },
  summary: { marginTop: 2, fontFamily: fontFamily.monoRegular, fontSize: fontSize.xs, color: colors.text.muted },
  exerciseList: { marginTop: spacing.xs, gap: spacing.xxs },
  exerciseRow: { minHeight: 27, width: '100%', flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs },
  index: { width: 22, flexShrink: 0, fontFamily: fontFamily.monoRegular, fontSize: fontSize.base, color: colors.text.muted },
  indexCompact: { fontSize: fontSize.sm },
  nameColumn: { flex: 1, minWidth: 0 },
  componentNames: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  namePressable: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xxs, flexShrink: 1 },
  exerciseName: { flexShrink: 1, fontFamily: fontFamily.bodySemiBold, fontSize: fontSize.base, lineHeight: 23, color: colors.text.primary },
  exerciseNameCompact: { fontSize: fontSize.sm, lineHeight: 20 },
  target: { minWidth: 48, textAlign: 'right', fontFamily: fontFamily.monoRegular, fontSize: fontSize.base, color: colors.bronze.active },
  targetCompact: { fontSize: fontSize.sm },
  handRepSummary: { marginTop: 2, fontFamily: fontFamily.monoRegular, fontSize: fontSize.xs, color: colors.bronze.active },
  alternatingChain: { width: '100%', marginTop: spacing.xs, gap: 2 },
  alternatingChainCompact: { marginTop: spacing.xxs, gap: 1 },
  handHeading: { marginTop: spacing.xxs, fontFamily: fontFamily.displayBold, fontSize: fontSize.xs, color: colors.bronze.active, letterSpacing: 1 },
  sequenceFlow: { width: '100%', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  sequenceMovement: { fontFamily: fontFamily.bodySemiBold, fontSize: fontSize.base, lineHeight: 21, color: colors.text.primary },
  sequenceMovementCompact: { fontSize: fontSize.sm, lineHeight: 19 },
  sequenceArrow: { fontFamily: fontFamily.bodyRegular, fontSize: fontSize.sm, color: colors.bronze.active },
  handTransition: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.xs },
  transitionLabel: { fontFamily: fontFamily.monoBold, fontSize: fontSize.xs, color: colors.bronze.active, letterSpacing: 0.5 },
});
