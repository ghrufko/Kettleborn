import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { HunterStackParamList } from '../../navigation/types';
import { Header, GlassCard, AppBackground } from '../../components/core';
import { ProgressBar } from '../../components/progress';
import { useAppStore } from '../../store';
import { MILESTONE_DEFINITIONS, MILESTONE_DISPLAY_ORDER, MilestoneType } from '../../utils/milestones';
import { colors, fontFamily, fontSize, spacing } from '../../theme';

type Props = NativeStackScreenProps<HunterStackParamList, 'Achievements'>;

// Same icon choices HuntCompleteScreen's own local MILESTONE_ICON already
// uses for these banners — kept as its own local copy here (not a shared
// export) to match this codebase's established pattern of small
// per-screen lookup tables (RANK_COLORS is duplicated the same way across
// three screens) rather than introducing a UI-layer concern into
// milestones.ts, which stays pure logic.
const MILESTONE_ICON: Record<MilestoneType, keyof typeof Ionicons.glyphMap> = {
  'campaign-complete': 'flag',
  'first-victory': 'sparkles',
  'monster-slayer': 'skull',
  'first-s-rank': 'star',
  'first-level-up': 'trending-up',
};

function formatUnlockDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Phase 2.11: a browsable, persistent view of the milestones
 * detectMilestone/detectAllQualifyingMilestones already define — reads
 * `achievements` directly from the store (loaded once at bootstrap, kept
 * live in memory by unlockAchievements), no per-screen fetch needed. No
 * loading state beyond that: by the time any screen is reachable,
 * bootstrapApp() has already awaited loadAchievements(), matching how
 * every other bootstrap-loaded slice (monsterProgress, chronicle, …) is
 * already treated elsewhere in this app.
 */
export function AchievementsScreen({ navigation }: Props) {
  const achievements = useAppStore((state) => state.achievements);
  const unlockedByType = new Map(achievements.map((a) => [a.milestoneType, a]));
  const unlockedCount = MILESTONE_DISPLAY_ORDER.filter((type) => unlockedByType.has(type)).length;
  const totalCount = MILESTONE_DISPLAY_ORDER.length;
  const progress = totalCount > 0 ? unlockedCount / totalCount : 0;

  return (
    <AppBackground style={styles.container}>
      <Header title="Achievements" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.content}>
        <GlassCard style={styles.summaryCard}>
          <Text style={styles.sectionLabel}>Progress</Text>
          <Text style={styles.summaryValue}>
            {unlockedCount} / {totalCount} Unlocked
          </Text>
          <ProgressBar progress={progress} fillColor={colors.gold} height={6} style={styles.progressBar} />
          {unlockedCount === 0 ? (
            <Text style={styles.summaryCaption}>Complete Hunts to unlock your first achievement.</Text>
          ) : null}
        </GlassCard>

        {MILESTONE_DISPLAY_ORDER.map((type) => {
          const definition = MILESTONE_DEFINITIONS[type];
          const unlocked = unlockedByType.get(type);
          return (
            <GlassCard key={type} style={!unlocked ? styles.achievementCardLocked : undefined}>
              <View style={styles.achievementRow}>
                <View style={[styles.iconWrap, unlocked ? styles.iconWrapUnlocked : styles.iconWrapLocked]}>
                  <Ionicons
                    name={unlocked ? MILESTONE_ICON[type] : 'lock-closed'}
                    size={20}
                    color={unlocked ? colors.gold : colors.steel}
                  />
                </View>
                <View style={styles.achievementBody}>
                  <Text style={[styles.achievementTitle, !unlocked && styles.achievementTitleLocked]}>
                    {definition.title}
                  </Text>
                  <Text style={[styles.achievementDescription, !unlocked && styles.achievementDescriptionLocked]}>
                    {definition.description}
                  </Text>
                  <Text style={styles.achievementMeta}>
                    {unlocked ? `Unlocked ${formatUnlockDate(unlocked.unlockedAt)}` : 'Locked'}
                  </Text>
                </View>
              </View>
            </GlassCard>
          );
        })}
      </ScrollView>
    </AppBackground>
  );
}

const ICON_SIZE = 40;

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: spacing.md,
    gap: spacing.sm,
    paddingBottom: spacing.xxl,
  },
  sectionLabel: {
    fontFamily: fontFamily.displayRegular,
    fontSize: fontSize.xs,
    letterSpacing: 2,
    color: colors.text.muted,
    textTransform: 'uppercase',
    marginBottom: spacing.xs,
  },
  summaryCard: {
    marginBottom: spacing.xs,
  },
  summaryValue: {
    fontFamily: fontFamily.displayBold,
    fontSize: fontSize.lg,
    color: colors.text.primary,
  },
  progressBar: {
    marginTop: spacing.sm,
  },
  summaryCaption: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.sm,
    color: colors.text.muted,
    fontStyle: 'italic',
    marginTop: spacing.sm,
  },
  achievementCardLocked: {
    opacity: 0.6,
  },
  achievementRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  iconWrap: {
    width: ICON_SIZE,
    height: ICON_SIZE,
    borderRadius: ICON_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  iconWrapUnlocked: {
    backgroundColor: 'rgba(212, 175, 55, 0.08)',
    borderColor: colors.gold,
  },
  iconWrapLocked: {
    backgroundColor: colors.void.surface,
    borderColor: colors.border.hairlineStrong,
  },
  achievementBody: {
    flex: 1,
  },
  achievementTitle: {
    fontFamily: fontFamily.bodySemiBold,
    fontSize: fontSize.base,
    color: colors.text.primary,
  },
  achievementTitleLocked: {
    color: colors.text.secondary,
  },
  achievementDescription: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.sm,
    color: colors.text.secondary,
    marginTop: 1,
  },
  achievementDescriptionLocked: {
    color: colors.text.muted,
  },
  achievementMeta: {
    fontFamily: fontFamily.monoRegular,
    fontSize: fontSize.xs,
    color: colors.text.muted,
    marginTop: spacing.xxs,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
});
