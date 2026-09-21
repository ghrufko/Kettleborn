import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { Header, GlassCard, AppBackground } from '../../components/core';
import { ProgressBar } from '../../components/progress';
import { useAppStore } from '../../store';
import { contentEngine } from '../../../engines/content';
import { getHunterTitle } from '../../utils/hunterTitle';
import { getLevelProgress } from '../../../engines/progress/progressionEngine';
import { formatWeight, formatWeightPair } from '../../utils/weight';
import { isCampaignComplete, getCampaignState } from '../../utils/campaignState';
import { getNextObjective } from '../../utils/nextObjective';
import { computeHistoricalRanks, rankDistribution } from '../../utils/rankHistory';
import { HuntRank } from '../../utils/huntRank';
import { WorkoutResult } from '../../models';
import { colors, fontFamily, fontSize, spacing, glow } from '../../theme';

function formatTime(minutesSeconds: { timeMinutes: number; timeSeconds: number }): string {
  return `${minutesSeconds.timeMinutes}:${minutesSeconds.timeSeconds.toString().padStart(2, '0')}`;
}

function formatSecondsClock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function HunterScreen() {
  const user = useAppStore((state) => state.user);
  const chronicle = useAppStore((state) => state.chronicle);
  const monsterProgress = useAppStore((state) => state.monsterProgress);
  const getHunterSummary = useAppStore((state) => state.getHunterSummary);
  const getAllResults = useAppStore((state) => state.getAllResults);

  const [favoriteMonsterName, setFavoriteMonsterName] = useState<string | null>(null);
  const [favoriteWorkoutName, setFavoriteWorkoutName] = useState<string | null>(null);
  const [recentResult, setRecentResult] = useState<WorkoutResult | null>(null);
  const [weightPRKg, setWeightPRKg] = useState<number | null>(null);
  const [fastestHuntSeconds, setFastestHuntSeconds] = useState<number | null>(null);
  const [rankCounts, setRankCounts] = useState<Record<HuntRank, number>>({ S: 0, A: 0, B: 0, C: 0 });

  // Sprint 27: useFocusEffect (not a plain useEffect) so this re-fetches
  // every time the Hunter tab regains focus — HunterTab stays mounted
  // across tab switches (React Navigation's default), so a plain useEffect
  // with these stable store-action deps would only ever run once and go
  // stale after a Hunt completes elsewhere. Same fix already applied to
  // ChronicleScreen.tsx.
  useFocusEffect(
    useCallback(() => {
      getHunterSummary().then((summary) => {
        const monster = summary.favoriteMonsterId
          ? contentEngine.getMonster(summary.favoriteMonsterId)
          : undefined;
        const workout = summary.favoriteWorkoutId
          ? contentEngine.getWorkout(summary.favoriteWorkoutId)
          : undefined;
        setFavoriteMonsterName(monster?.name ?? null);
        setFavoriteWorkoutName(workout?.name ?? null);
        setRecentResult(summary.recentResult);
        setWeightPRKg(summary.weightPRKg);
        setFastestHuntSeconds(summary.fastestHuntSeconds);
      });
      getAllResults().then((results) => {
        const ranked = computeHistoricalRanks(results, (id) => contentEngine.getWorkout(id));
        setRankCounts(rankDistribution(ranked));
      });
    }, [getHunterSummary, getAllResults])
  );

  const recentMonster = recentResult ? contentEngine.getMonster(recentResult.monsterId) : undefined;
  const level = user?.level ?? 1;
  const levelProgress = getLevelProgress(user?.totalXP ?? 0);
  const unitPreference = user?.unitPreference ?? 'kg';

  const allMonsters = contentEngine.getAllMonsters();
  const allCampaigns = contentEngine.getAllCampaigns();
  const totalBossesDefeated = allMonsters.filter((m) => monsterProgress[m.id]?.defeated).length;
  const realmCompletionPercent =
    allMonsters.length > 0 ? Math.round((totalBossesDefeated / allMonsters.length) * 100) : 0;
  const objective = getNextObjective(allCampaigns, (id) => contentEngine.getMonster(id), monsterProgress);
  const currentCampaignName = objective?.campaign.name ?? null;

  return (
    <AppBackground style={styles.container}>
      <Header title="Hunter" />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.avatar, glow.sm]}>
          <Text style={styles.avatarInitial}>{user?.displayName.charAt(0) ?? 'H'}</Text>
        </View>
        <Text style={styles.name}>{user?.displayName ?? 'Hunter'}</Text>
        <Text style={styles.titleText}>{getHunterTitle(level)}</Text>
        <Text style={styles.levelCaption}>Level {level}</Text>
        {currentCampaignName ? (
          <Text style={styles.currentCampaign}>Currently hunting in {currentCampaignName}</Text>
        ) : null}

        <GlassCard style={styles.card}>
          <Text style={styles.sectionLabel}>Experience</Text>
          <Text style={styles.xpValue}>{user?.totalXP ?? 0} XP</Text>
          <View style={styles.xpBarRow}>
            <Text style={styles.xpBarLabel}>
              {levelProgress.xpIntoLevel} / {levelProgress.xpForThisLevel} to Level {level + 1}
            </Text>
          </View>
          <ProgressBar progress={levelProgress.progress} fillColor={colors.gold} height={6} />
        </GlassCard>

        <GlassCard style={styles.card}>
          <Text style={styles.sectionLabel}>Streak</Text>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>Current Streak</Text>
            <Text style={styles.statValue}>{chronicle?.currentStreakDays ?? 0} days</Text>
          </View>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>Longest Streak</Text>
            <Text style={styles.statValue}>{chronicle?.longestStreakDays ?? 0} days</Text>
          </View>
        </GlassCard>

        <GlassCard style={styles.card}>
          <Text style={styles.sectionLabel}>Rank Record</Text>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>S</Text>
            <Text style={styles.statValue}>{rankCounts.S}</Text>
          </View>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>A</Text>
            <Text style={styles.statValue}>{rankCounts.A}</Text>
          </View>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>B</Text>
            <Text style={styles.statValue}>{rankCounts.B}</Text>
          </View>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>C</Text>
            <Text style={styles.statValue}>{rankCounts.C}</Text>
          </View>
        </GlassCard>

        <GlassCard style={styles.card}>
          <Text style={styles.sectionLabel}>Favorites</Text>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>Favorite Monster</Text>
            <Text style={styles.statValue}>{favoriteMonsterName ?? '—'}</Text>
          </View>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>Favorite Workout</Text>
            <Text style={styles.statValue}>{favoriteWorkoutName ?? '—'}</Text>
          </View>
        </GlassCard>

        <GlassCard style={styles.card}>
          <Text style={styles.sectionLabel}>Lifetime Stats</Text>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>Total Hunts</Text>
            <Text style={styles.statValue}>{chronicle?.totalHuntsCompleted ?? 0}</Text>
          </View>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>Monsters Defeated</Text>
            <Text style={styles.statValue}>{chronicle?.totalMonstersDefeated ?? 0}</Text>
          </View>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>Total Training Time</Text>
            <Text style={styles.statValue}>{chronicle?.totalTrainingMinutes ?? 0} min</Text>
          </View>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>Total Volume</Text>
            <Text style={styles.statValue}>{Math.round(chronicle?.totalVolumeKg ?? 0)} kg</Text>
          </View>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>Weight PR</Text>
            <Text style={styles.statValue}>
              {weightPRKg !== null ? formatWeight(weightPRKg, unitPreference) : '—'}
            </Text>
          </View>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>Fastest Hunt</Text>
            <Text style={styles.statValue}>
              {fastestHuntSeconds !== null ? formatSecondsClock(fastestHuntSeconds) : '—'}
            </Text>
          </View>
        </GlassCard>

        <GlassCard style={styles.card}>
          <Text style={styles.sectionLabel}>Realm Progress</Text>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>Bosses Defeated</Text>
            <Text style={styles.statValue}>
              {totalBossesDefeated} / {allMonsters.length}
            </Text>
          </View>
          <ProgressBar progress={realmCompletionPercent / 100} fillColor={colors.gold} height={6} />
          <Text style={styles.completionCaption}>{realmCompletionPercent}% of the Realm Explored</Text>

          <View style={styles.medalRow}>
            {allCampaigns.map((campaign, index) => {
              const campaignState = getCampaignState(allCampaigns, campaign.id, monsterProgress);
              const complete = isCampaignComplete(campaign, monsterProgress);
              return (
                <MedalIcon
                  key={campaign.id}
                  delay={index * 80}
                  name={complete ? 'medal' : campaignState === 'locked' ? 'lock-closed' : 'medal-outline'}
                  color={complete ? colors.gold : campaignState === 'locked' ? colors.steel : colors.bronze.base}
                  label={campaignState === 'locked' ? '???' : campaign.name}
                />
              );
            })}
          </View>
        </GlassCard>

        {recentResult ? (
          <GlassCard style={styles.card}>
            <Text style={styles.sectionLabel}>Recent Hunt</Text>
            <Text style={styles.recentMonster}>{recentMonster?.name ?? 'Unknown'}</Text>
            <Text style={styles.recentDetail}>
              {formatTime(recentResult)} ·{' '}
              {formatWeightPair(recentResult.weightValueA, recentResult.weightValueB, recentResult.weightUnit)}
            </Text>
          </GlassCard>
        ) : null}
      </ScrollView>
    </AppBackground>
  );
}

const AVATAR_SIZE = 96;

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: spacing.md,
    alignItems: 'center',
    gap: spacing.xs,
    paddingBottom: spacing.xxl,
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    borderWidth: 2,
    borderColor: colors.bronze.base,
    backgroundColor: colors.void.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  avatarInitial: {
    fontFamily: fontFamily.displayBold,
    fontSize: 40,
    color: colors.text.secondary,
  },
  name: {
    fontFamily: fontFamily.displayBold,
    fontSize: fontSize.xl,
    color: colors.text.primary,
    textTransform: 'uppercase',
    letterSpacing: 2,
  },
  titleText: {
    fontFamily: fontFamily.bodySemiBold,
    fontSize: fontSize.lg,
    color: colors.bronze.base,
    marginTop: spacing.xxs,
    letterSpacing: 1,
  },
  currentCampaign: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.sm,
    fontStyle: 'italic',
    color: colors.text.muted,
    marginTop: spacing.xxs,
  },
  levelCaption: {
    fontFamily: fontFamily.monoRegular,
    fontSize: fontSize.sm,
    color: colors.text.muted,
  },
  sectionLabel: {
    fontFamily: fontFamily.displayRegular,
    fontSize: fontSize.xs,
    letterSpacing: 2,
    color: colors.text.muted,
    textTransform: 'uppercase',
    marginBottom: spacing.xs,
  },
  xpValue: {
    fontFamily: fontFamily.monoBold,
    fontSize: fontSize.lg,
    color: colors.gold,
  },
  xpBarRow: {
    marginTop: spacing.sm,
    marginBottom: spacing.xxs,
  },
  xpBarLabel: {
    fontFamily: fontFamily.monoRegular,
    fontSize: fontSize.xs,
    color: colors.text.muted,
  },
  card: {
    width: '100%',
    marginTop: spacing.md,
  },
  completionCaption: {
    fontFamily: fontFamily.monoRegular,
    fontSize: fontSize.xs,
    color: colors.text.muted,
    marginTop: spacing.xxs,
    textAlign: 'right',
  },
  medalRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border.hairline,
  },
  medal: {
    alignItems: 'center',
    maxWidth: 90,
  },
  medalLabel: {
    fontFamily: fontFamily.monoRegular,
    fontSize: fontSize.xs,
    color: colors.text.muted,
    marginTop: spacing.xxs,
    textAlign: 'center',
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  statLabel: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.base,
    color: colors.text.secondary,
  },
  statValue: {
    fontFamily: fontFamily.monoBold,
    fontSize: fontSize.base,
    color: colors.text.primary,
  },
  recentMonster: {
    fontFamily: fontFamily.displayBold,
    fontSize: fontSize.base,
    color: colors.text.primary,
    textTransform: 'uppercase',
  },
  recentDetail: {
    fontFamily: fontFamily.monoRegular,
    fontSize: fontSize.sm,
    color: colors.text.muted,
    marginTop: spacing.xxs,
  },
});

interface MedalIconProps {
  name: keyof typeof Ionicons.glyphMap;
  color: string;
  label: string;
  delay: number;
}

/** Each medal scales in from 0.5→1 with a short staggered delay (Sprint 20 micro-animation). */
function MedalIcon({ name, color, label, delay }: MedalIconProps) {
  const scale = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    Animated.spring(scale, { toValue: 1, delay, useNativeDriver: true, speed: 16, bounciness: 10 }).start();
  }, [scale, delay]);

  return (
    <View style={styles.medal}>
      <Animated.View style={{ transform: [{ scale }] }}>
        <Ionicons name={name} size={22} color={color} />
      </Animated.View>
      <Text style={styles.medalLabel} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}
