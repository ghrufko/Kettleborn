import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { HuntStackParamList } from '../../navigation/types';
import { Header, GlassCard } from '../../components/core';
import { contentEngine } from '../../../engines/content';
import { useAppStore } from '../../store';
import { ExerciseStats } from '../../utils/exerciseStats';
import { convertKgToDisplay } from '../../utils/weight';
import { colors, fontFamily, fontSize, lineHeight, spacing } from '../../theme';

type Props = NativeStackScreenProps<HuntStackParamList, 'ExerciseDetail'>;

function BulletList({ items, color }: { items: string[]; color: string }) {
  return (
    <View>
      {items.map((item) => (
        <View key={item} style={styles.bulletRow}>
          <View style={[styles.bulletDot, { backgroundColor: color }]} />
          <Text style={styles.bulletText}>{item}</Text>
        </View>
      ))}
    </View>
  );
}

function formatLastPerformed(iso: string | null): string {
  if (!iso) {
    return 'Never';
  }
  const date = new Date(iso);
  const today = new Date();
  const diffDays = Math.floor((today.getTime() - date.getTime()) / (24 * 60 * 60 * 1000));
  if (diffDays <= 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  return date.toLocaleDateString();
}

export function ExerciseDetailScreen({ route, navigation }: Props) {
  const { exerciseId } = route.params;
  const entry = contentEngine.getExerciseLibraryEntry(exerciseId);
  const getExerciseStatsById = useAppStore((state) => state.getExerciseStatsById);
  const unitPreference = useAppStore((state) => state.settings?.unitPreference ?? 'kg');

  const [stats, setStats] = useState<ExerciseStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    getExerciseStatsById(exerciseId).then((result) => {
      setStats(result);
      setIsLoading(false);
    });
  }, [exerciseId, getExerciseStatsById]);

  if (!entry) {
    return (
      <View style={styles.container}>
        <Header title="Not Found" onBack={() => navigation.goBack()} />
        <View style={styles.missingState}>
          <Text style={styles.missingText}>This exercise could not be found.</Text>
        </View>
      </View>
    );
  }

  const relatedWorkouts = contentEngine.getWorkoutsContainingExercise(entry.name);

  return (
    <View style={styles.container}>
      <Header title={entry.name} onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.categoryPill}>
          <Text style={styles.categoryText}>{entry.category}</Text>
        </View>

        <Text style={styles.description}>{entry.description}</Text>

        <View style={styles.videoPlaceholder}>
          <Ionicons name="play-circle-outline" size={36} color={colors.text.muted} />
          <Text style={styles.videoPlaceholderText}>Video coming soon</Text>
        </View>

        <GlassCard style={styles.section}>
          <Text style={styles.sectionLabel}>Your Lifetime Stats</Text>
          {isLoading ? (
            <Text style={styles.statsLoading}>Loading…</Text>
          ) : stats ? (
            <>
              <View style={styles.statsGrid}>
                <View style={styles.statCell}>
                  <Text style={styles.statValue}>{stats.totalReps.toLocaleString()}</Text>
                  <Text style={styles.statCaption}>Total Reps</Text>
                </View>
                <View style={styles.statCell}>
                  <Text style={styles.statValue}>
                    {Math.round(convertKgToDisplay(stats.totalVolumeKg, unitPreference)).toLocaleString()}
                  </Text>
                  <Text style={styles.statCaption}>Volume ({unitPreference.toUpperCase()})</Text>
                </View>
                <View style={styles.statCell}>
                  <Text style={styles.statValue}>{stats.totalSessions}</Text>
                  <Text style={styles.statCaption}>Sessions</Text>
                </View>
              </View>
              <Text style={styles.lastPerformed}>
                Last performed: {formatLastPerformed(stats.lastPerformedAt)}
              </Text>
            </>
          ) : (
            <Text style={styles.statsEmpty}>
              You haven't performed this movement in a completed Hunt yet.
            </Text>
          )}
        </GlassCard>

        <GlassCard style={styles.section}>
          <Text style={styles.sectionLabel}>Muscles Trained</Text>
          <View style={styles.tagRow}>
            {entry.musclesTrained.map((muscle) => (
              <View key={muscle} style={styles.tag}>
                <Text style={styles.tagText}>{muscle}</Text>
              </View>
            ))}
          </View>
        </GlassCard>

        <GlassCard style={styles.section}>
          <Text style={styles.sectionLabel}>What It Develops</Text>
          <BulletList items={entry.benefits} color={colors.bronze.base} />
        </GlassCard>

        <GlassCard style={styles.section}>
          <Text style={styles.sectionLabel}>Common Mistakes</Text>
          <BulletList items={entry.commonMistakes} color={colors.blood} />
        </GlassCard>

        {relatedWorkouts.length > 0 ? (
          <GlassCard style={styles.section}>
            <Text style={styles.sectionLabel}>Appears In</Text>
            {relatedWorkouts.map((workout) => (
              <View key={workout.id} style={styles.relatedRow}>
                <Ionicons name="barbell-outline" size={14} color={colors.text.muted} />
                <Text style={styles.relatedText}>{workout.name}</Text>
              </View>
            ))}
          </GlassCard>
        ) : null}
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
  categoryPill: {
    alignSelf: 'flex-start',
    backgroundColor: colors.void.surface,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border.hairlineStrong,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
  },
  categoryText: {
    fontFamily: fontFamily.monoBold,
    fontSize: fontSize.xs,
    color: colors.gold,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  description: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.base,
    lineHeight: lineHeight.base,
    color: colors.text.secondary,
    marginBottom: spacing.xs,
  },
  videoPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 120,
    borderRadius: 16,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border.hairlineStrong,
    backgroundColor: colors.void.surface,
    marginBottom: spacing.xs,
  },
  videoPlaceholderText: {
    fontFamily: fontFamily.monoRegular,
    fontSize: fontSize.xs,
    color: colors.text.muted,
    marginTop: spacing.xxs,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  section: {
    marginBottom: spacing.sm,
  },
  sectionLabel: {
    fontFamily: fontFamily.displayRegular,
    fontSize: fontSize.xs,
    letterSpacing: 2,
    color: colors.text.muted,
    textTransform: 'uppercase',
    marginBottom: spacing.sm,
  },
  statsLoading: {
    fontFamily: fontFamily.monoRegular,
    fontSize: fontSize.sm,
    color: colors.text.muted,
  },
  statsEmpty: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.sm,
    color: colors.text.muted,
  },
  statsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  statCell: {
    alignItems: 'center',
    flex: 1,
  },
  statValue: {
    fontFamily: fontFamily.displayBold,
    fontSize: fontSize.lg,
    color: colors.gold,
  },
  statCaption: {
    fontFamily: fontFamily.monoRegular,
    fontSize: fontSize.xs,
    color: colors.text.muted,
    marginTop: 2,
    textTransform: 'uppercase',
  },
  lastPerformed: {
    fontFamily: fontFamily.monoRegular,
    fontSize: fontSize.xs,
    color: colors.text.muted,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  weightRangeText: {
    fontFamily: fontFamily.monoBold,
    fontSize: fontSize.lg,
    color: colors.text.primary,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  tag: {
    backgroundColor: colors.void.surface,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border.hairlineStrong,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
  },
  tagText: {
    fontFamily: fontFamily.monoRegular,
    fontSize: fontSize.xs,
    color: colors.bronze.active,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  bulletDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 7,
  },
  bulletText: {
    flex: 1,
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.base,
    color: colors.text.secondary,
  },
  relatedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  relatedText: {
    fontFamily: fontFamily.bodySemiBold,
    fontSize: fontSize.base,
    color: colors.text.primary,
  },
});
