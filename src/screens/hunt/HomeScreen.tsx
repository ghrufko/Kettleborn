import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { HuntStackParamList } from '../../navigation/types';
import { GlassCard, Button, AppBackground } from '../../components/core';
import { ProgressBar } from '../../components/progress';
import { contentEngine } from '../../../engines/content';
import { useAppStore } from '../../store';
import { getLevelProgress } from '../../../engines/progress/progressionEngine';
import { getHunterTitle } from '../../utils/hunterTitle';
import { getNextObjective, NextObjective } from '../../utils/nextObjective';
import { flavorTextFor } from '../../utils/flavorText';
import { getHomeMotivation } from '../../utils/homeMotivation';
import { WorkoutResult } from '../../models';
import { colors, fontFamily, fontSize, spacing, glow } from '../../theme';

type Props = NativeStackScreenProps<HuntStackParamList, 'Home'>;

function formatRelativeDate(iso: string): string {
  const diffDays = Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 60 * 60 * 1000));
  if (diffDays <= 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return `${diffDays} days ago`;
}

export function HomeScreen({ navigation }: Props) {
  const user = useAppStore((state) => state.user);
  const chronicle = useAppStore((state) => state.chronicle);
  const monsterProgress = useAppStore((state) => state.monsterProgress);
  const getHunterSummary = useAppStore((state) => state.getHunterSummary);

  const [recentResult, setRecentResult] = useState<WorkoutResult | null>(null);

  useEffect(() => {
    getHunterSummary().then((summary) => setRecentResult(summary.recentResult));
  }, [getHunterSummary]);

  const level = user?.level ?? 1;
  const levelProgress = getLevelProgress(user?.totalXP ?? 0);
  const campaigns = contentEngine.getAllCampaigns();
  const objective: NextObjective | null = getNextObjective(
    campaigns,
    (id) => contentEngine.getMonster(id),
    monsterProgress
  );
  const recentMonster = recentResult ? contentEngine.getMonster(recentResult.monsterId) : undefined;

  const hasTrainedToday = recentResult
    ? new Date(recentResult.completedAt).toDateString() === new Date().toDateString()
    : false;
  const motivation = getHomeMotivation({
    chronicle,
    hasTrainedToday,
    levelProgress: levelProgress.progress,
    nextLevel: level + 1,
    lastMonsterName: recentMonster?.name ?? null,
    nextMonsterName: objective?.monster.name ?? null,
  });

  return (
    <AppBackground style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.greeting}>Welcome back, Hunter</Text>
            <Text style={styles.titleLine}>
              Level {level} · {getHunterTitle(level)}
            </Text>
          </View>
          {chronicle && chronicle.currentStreakDays > 0 ? (
            <View style={styles.streakPill}>
              <Ionicons name="flame" size={14} color={colors.ember.base} />
              <Text style={styles.streakText}>{chronicle.currentStreakDays}</Text>
            </View>
          ) : null}
        </View>

        <ProgressBar progress={levelProgress.progress} fillColor={colors.gold} height={5} />
        <Text style={styles.xpCaption}>
          {levelProgress.xpIntoLevel} / {levelProgress.xpForThisLevel} XP to Level {level + 1}
        </Text>

        {motivation ? <Text style={styles.motivationLine}>{motivation}</Text> : null}

        {objective ? (
          <GlassCard style={[styles.heroCard, glow.md]}>
            <Text style={styles.heroLabel}>{objective.campaign.name}</Text>
            <Text style={styles.heroMonster}>{objective.monster.name}</Text>
            <Text style={styles.heroHunt}>{objective.hunt.name}</Text>
            <Text style={styles.heroFlavor}>{flavorTextFor(objective.hunt.id)}</Text>
            <Button
              label="View Hunt Brief"
              onPress={() =>
                navigation.navigate('HuntOverview', {
                  monsterId: objective.monster.id,
                  huntId: objective.hunt.id,
                })
              }
              style={styles.heroButton}
            />
          </GlassCard>
        ) : (
          <GlassCard style={[styles.heroCard, glow.md]}>
            <Ionicons name="trophy" size={28} color={colors.gold} />
            <Text style={styles.heroMonster}>Every Trial Conquered</Text>
            <Text style={styles.heroFlavor}>The realm holds nothing left to hunt — for now.</Text>
          </GlassCard>
        )}

        <Pressable
          onPress={() => navigation.navigate('Hunt')}
          style={({ pressed }) => [styles.linkRow, pressed && styles.rowPressed]}
        >
          <Text style={styles.linkText}>View All Campaigns</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.steel} />
        </Pressable>

        {recentResult ? (
          <GlassCard style={styles.section}>
            <Text style={styles.sectionLabel}>Last Hunt</Text>
            <View style={styles.lastHuntRow}>
              <Text style={styles.lastHuntMonster}>{recentMonster?.name ?? 'Unknown'}</Text>
              <Text style={styles.lastHuntDate}>{formatRelativeDate(recentResult.completedAt)}</Text>
            </View>
            <Text style={styles.lastHuntDetail}>
              {recentResult.timeMinutes}:{recentResult.timeSeconds.toString().padStart(2, '0')} ·
              {' '}+{recentResult.xpAwarded} XP
            </Text>
          </GlassCard>
        ) : null}

        <Pressable
          onPress={() => navigation.getParent()?.navigate('TimerTab', { screen: 'TimerHome' })}
          style={({ pressed }) => [styles.timerRow, pressed && styles.rowPressed]}
        >
          <Ionicons name="timer-outline" size={20} color={colors.bronze.base} />
          <Text style={styles.timerText}>Quick Start Timer</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.steel} />
        </Pressable>
      </ScrollView>
      </SafeAreaView>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  content: {
    padding: spacing.md,
    paddingTop: spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.sm,
  },
  greeting: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.sm,
    color: colors.text.muted,
  },
  titleLine: {
    fontFamily: fontFamily.displayBold,
    fontSize: fontSize.lg,
    color: colors.text.primary,
    textTransform: 'uppercase',
    marginTop: 2,
  },
  streakPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.void.surface,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border.hairlineStrong,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
  },
  streakText: {
    fontFamily: fontFamily.monoBold,
    fontSize: fontSize.sm,
    color: colors.ember.base,
  },
  xpCaption: {
    fontFamily: fontFamily.monoRegular,
    fontSize: fontSize.xs,
    color: colors.text.muted,
    marginTop: spacing.xxs,
    marginBottom: spacing.lg,
  },
  motivationLine: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.sm,
    color: colors.ember.base,
    marginTop: -spacing.md,
    marginBottom: spacing.lg,
  },
  heroCard: {
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  heroLabel: {
    fontFamily: fontFamily.monoRegular,
    fontSize: fontSize.xs,
    color: colors.text.muted,
    textTransform: 'uppercase',
    letterSpacing: 2,
  },
  heroMonster: {
    fontFamily: fontFamily.displayBold,
    fontSize: fontSize.xl,
    color: colors.text.primary,
    textTransform: 'uppercase',
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  heroHunt: {
    fontFamily: fontFamily.bodySemiBold,
    fontSize: fontSize.base,
    color: colors.bronze.active,
    marginTop: 2,
  },
  heroFlavor: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.sm,
    color: colors.text.muted,
    fontStyle: 'italic',
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  heroButton: {
    width: '100%',
    marginTop: spacing.md,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xxs,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
  },
  linkText: {
    fontFamily: fontFamily.monoRegular,
    fontSize: fontSize.xs,
    color: colors.text.muted,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  rowPressed: {
    opacity: 0.7,
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
    marginBottom: spacing.xs,
  },
  lastHuntRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  lastHuntMonster: {
    fontFamily: fontFamily.bodySemiBold,
    fontSize: fontSize.base,
    color: colors.text.primary,
  },
  lastHuntDate: {
    fontFamily: fontFamily.monoRegular,
    fontSize: fontSize.xs,
    color: colors.text.muted,
  },
  lastHuntDetail: {
    fontFamily: fontFamily.monoRegular,
    fontSize: fontSize.sm,
    color: colors.text.secondary,
    marginTop: spacing.xxs,
  },
  timerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.charcoal.base,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border.hairline,
    padding: spacing.sm,
    marginBottom: spacing.xl,
  },
  timerText: {
    flex: 1,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: fontSize.base,
    color: colors.text.primary,
  },
});
