import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Image, Pressable, Alert } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { HuntStackParamList } from '../../navigation/types';
import { Header, Button, GlassCard, AppBackground } from '../../components/core';
import { ProgressBar } from '../../components/progress';
import { contentEngine } from '../../../engines/content';
import { getMonsterPortrait } from '../../constants/monsterPortraits';
import { getHuntDisplayState } from '../../utils/huntState';
import { getCombatPersonality } from '../../utils/bossPersonality';
import { getBestiaryStats, BestiaryStats } from '../../utils/bestiaryStats';
import { computeHistoricalRanks } from '../../utils/rankHistory';
import { groupResultsByDay } from '../../utils/timeline';
import { getRPELabel } from '../../utils/rpeLabels';
import { HuntRank } from '../../utils/huntRank';
import { WorkoutResult } from '../../models';
import { convertKgToDisplay, formatWeightPair } from '../../utils/weight';
import { useAppStore } from '../../store';
import { colors, fontFamily, fontSize, lineHeight, spacing, glow } from '../../theme';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatSecondsClock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

type Props = NativeStackScreenProps<HuntStackParamList, 'MonsterDetail'>;

const STATE_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  completed: 'checkmark-circle',
  available: 'chevron-forward',
  locked: 'lock-closed',
};

const STATE_COLOR: Record<string, string> = {
  completed: colors.gold,
  available: colors.bronze.base,
  locked: colors.steel,
};

// Same rank-color convention already used by ChronicleScreen.tsx and
// HuntCompleteScreen.tsx (each defines its own local copy rather than a
// shared export — following that existing pattern here, not changing it).
const RANK_COLORS: Record<string, string> = {
  S: colors.gold,
  A: colors.ember.base,
  B: colors.bronze.base,
  C: colors.text.secondary,
};

interface PreviousEncounterSummary {
  result: WorkoutResult;
  rank: HuntRank;
  wasPersonalRecord: boolean;
}

export function MonsterDetailScreen({ route, navigation }: Props) {
  const { monsterId } = route.params;
  const monster = contentEngine.getMonster(monsterId);
  const lore = monster ? contentEngine.getLore(monster.id) : undefined;
  const progress = useAppStore((state) => state.monsterProgress[monsterId]);
  const getAllResults = useAppStore((state) => state.getAllResults);
  const resetMonsterProgress = useAppStore((state) => state.resetMonsterProgress);
  const unitPreference = useAppStore((state) => state.settings?.unitPreference ?? 'kg');
  const [isResetting, setIsResetting] = useState(false);
  const [bestiaryStats, setBestiaryStats] = useState<BestiaryStats | null>(null);
  const [completedHuntIds, setCompletedHuntIds] = useState<Set<string>>(new Set());
  const [monsterResults, setMonsterResults] = useState<WorkoutResult[]>([]);

  useEffect(() => {
    if (!monster) {
      return;
    }
    getAllResults().then((results) => {
      const monsterResults = results.filter((r) => r.monsterId === monsterId);
      setCompletedHuntIds(new Set(monsterResults.map((r) => r.huntId)));
      setMonsterResults(monsterResults);
      setBestiaryStats(
        getBestiaryStats(monster, progress, monsterResults, (id) => contentEngine.getWorkout(id))
      );
    });
  }, [monster, monsterId, progress, getAllResults]);

  // Encounter History (read-only): for the encounter list below, each
  // encounter after the first should be able to show the player's result
  // from the encounter immediately before it (Encounter II shows
  // Encounter I's result, etc). This is a lookup by huntId ->  that hunt's
  // most recent completed WorkoutResult, with rank and PR status derived
  // the exact same way Chronicle/Journal already derive them — via
  // computeHistoricalRanks (rankHistory.ts) and groupResultsByDay
  // (timeline.ts), both reused unmodified. No new PR/rank logic, no new
  // storage, no write path — purely reads WorkoutResult rows already
  // fetched above via getAllResults(). Uses monsterResults (already
  // filtered to this monster), matching the same scoping bestiaryStats.ts
  // already uses for its own PR/rank lookups on this screen — safe here
  // too since no two monsters share a workoutId in content today.
  const previousEncounterByHuntId = useMemo(() => {
    const summaries = new Map<string, PreviousEncounterSummary>();
    if (monsterResults.length === 0) {
      return summaries;
    }

    const ranked = computeHistoricalRanks(monsterResults, (id) => contentEngine.getWorkout(id));
    const rankByResultId = new Map(ranked.map(({ result, rank }) => [result.id, rank]));

    const prByResultId = new Map(
      groupResultsByDay(monsterResults)
        .flatMap((group) => group.entries)
        .map((entry) => [entry.result.id, entry.wasPersonalRecord])
    );

    // A Hunt can be replayed (bestiaryStats.ts: "each clear counts as a
    // defeat, including replays") so more than one WorkoutResult can share
    // a huntId — the most recent completion is what best reflects the
    // player's current result for that encounter.
    const latestResultByHuntId = new Map<string, WorkoutResult>();
    monsterResults.forEach((result) => {
      const existing = latestResultByHuntId.get(result.huntId);
      if (!existing || new Date(result.completedAt).getTime() > new Date(existing.completedAt).getTime()) {
        latestResultByHuntId.set(result.huntId, result);
      }
    });

    latestResultByHuntId.forEach((result, huntId) => {
      summaries.set(huntId, {
        result,
        rank: rankByResultId.get(result.id) ?? 'C',
        wasPersonalRecord: prByResultId.get(result.id) ?? false,
      });
    });

    return summaries;
  }, [monsterResults]);

  if (!monster) {
    return (
      <AppBackground style={styles.container}>
        <Header title="Not Found" onBack={() => navigation.goBack()} />
        <View style={styles.missingState}>
          <Text style={styles.missingText}>This monster could not be found.</Text>
        </View>
      </AppBackground>
    );
  }

  const portraitSource = getMonsterPortrait(monster.portraitAsset);
  const personality = getCombatPersonality(monster.personality, monster.accentColor);
  const nextHunt = monster.hunts.find((hunt) => {
    const previousHunt = monster.hunts.find((h) => h.order === hunt.order - 1);
    const isPreviousHuntCompleted = previousHunt ? completedHuntIds.has(previousHunt.id) : true;
    return getHuntDisplayState(hunt, progress?.huntsCompleted ?? 0, isPreviousHuntCompleted) === 'available';
  });
  const firstHunt = monster.hunts.find((h) => h.order === 1);
  const firstWorkout = firstHunt?.workoutId ? contentEngine.getWorkout(firstHunt.workoutId) : undefined;
  const huntsCompleted = progress?.huntsCompleted ?? 0;
  const huntsTotal = progress?.huntsTotal ?? monster.hunts.length;
  const huntsRemaining = Math.max(huntsTotal - huntsCompleted, 0);
  const completionPercent = huntsTotal > 0 ? Math.round((huntsCompleted / huntsTotal) * 100) : 0;
  const defeated = progress?.defeated ?? false;

  // Encounter Lock: Reset Progress — same confirm-then-destructive-action
  // pattern as Settings' "Reset Campaign Progress" (SettingsScreen.tsx),
  // scoped to just this monster via resetMonsterProgress.
  const confirmResetProgress = () => {
    Alert.alert(
      `Reset ${monster.name}'s Progress?`,
      "This will erase this monster's Encounter results, baseline, and Hunt progress, as if you had never fought it. Other monsters, your Chronicle, Custom Workouts, and Timer data are not affected. This cannot be undone.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            setIsResetting(true);
            try {
              await resetMonsterProgress(monsterId);
            } finally {
              setIsResetting(false);
            }
          },
        },
      ]
    );
  };

  return (
    <AppBackground style={styles.container}>
      <Header title={monster.name} onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.portrait, glow.lg, { borderColor: personality.accentColor }]}>
          {portraitSource ? (
            <Image source={portraitSource} style={styles.portraitImage} resizeMode="cover" />
          ) : (
            <Text style={styles.portraitInitial}>{monster.name.charAt(0)}</Text>
          )}
        </View>

        <Text style={styles.name}>{monster.name}</Text>
        <Text style={styles.title}>{monster.title}</Text>
        <View style={[styles.personalityPill, { borderColor: personality.accentColor }]}>
          <Text style={[styles.personalityText, { color: personality.accentColor }]}>
            {personality.label}
          </Text>
        </View>
        {defeated ? (
          <View style={styles.defeatedBadge}>
            <Ionicons name="checkmark-circle" size={14} color={colors.gold} />
            <Text style={styles.defeatedText}>Defeated</Text>
          </View>
        ) : null}
        <Text style={styles.description}>{monster.description}</Text>
        <Text style={styles.personalityFlavor}>{personality.beforeBattleFlavor}</Text>

        {/*
          Monster Overview (Custom Hunt merge, §1): "what exactly am I
          going to fight" at a glance, the moment the player opens this
          monster — always the CANONICAL Encounter 1 workout (content
          exactly as authored), regardless of whether the player ends up
          choosing Canonical or Custom Hunt on Hunt Overview. A ladder
          workout (stepLabel 'Rung') gets a structural summary instead of
          a per-exercise reps list — its reps vary by rung, and
          HuntOverviewScreen already has the real low–high ladder preview
          for that; this card is deliberately a lighter glance, not a
          duplicate of that screen.
        */}
        {firstHunt && firstWorkout ? (
          <GlassCard style={styles.progressCard}>
            <Text style={styles.sectionLabel}>First Encounter</Text>
            <Text style={styles.previewSubtitle}>{firstWorkout.name}</Text>
            {firstWorkout.stepLabel === 'Rung' ? (
              <Text style={styles.modeHint}>
                A {firstWorkout.rounds}-{firstWorkout.stepLabel.toLowerCase()} ladder on{' '}
                {Array.from(new Set(firstWorkout.exercises.map((e) => e.displayName ?? e.name))).join(' and ')}.
              </Text>
            ) : (
              firstWorkout.exercises.map((exercise) => (
                <View key={exercise.id} style={styles.statRow}>
                  <Text style={styles.statLabel}>{exercise.displayName ?? exercise.name}</Text>
                  <Text style={styles.statValue}>
                    {exercise.targetReps
                      ? `${exercise.targetReps} reps`
                      : exercise.targetDistanceFt
                        ? `${exercise.targetDistanceFt} ft`
                        : ''}
                  </Text>
                </View>
              ))
            )}
            <View style={styles.statRow}>
              <Text style={styles.statLabel}>Structure</Text>
              <Text style={styles.statValue}>
                {firstWorkout.rounds} {(firstWorkout.stepLabel ?? 'Round').toLowerCase()}
                {firstWorkout.rounds === 1 ? '' : 's'}
              </Text>
            </View>
            <View style={styles.statRow}>
              <Text style={styles.statLabel}>Canonical Weight</Text>
              <Text style={styles.statValue}>
                {convertKgToDisplay(firstWorkout.gearWeightKg, unitPreference)} {unitPreference} ×{' '}
                {firstWorkout.gearCount}
              </Text>
            </View>
            <View style={styles.statRow}>
              <Text style={styles.statLabel}>Canonical Rest</Text>
              <Text style={styles.statValue}>
                {formatSecondsClock(firstHunt.restSecondsOverride ?? firstWorkout.restSeconds)}
              </Text>
            </View>
            <View style={styles.statRow}>
              <Text style={styles.statLabel}>Target Time</Text>
              <Text style={styles.statValue}>
                {firstWorkout.targetTimeSeconds ? formatSecondsClock(firstWorkout.targetTimeSeconds) : '—'}
              </Text>
            </View>
          </GlassCard>
        ) : null}

        <GlassCard style={styles.progressCard}>
          <Text style={styles.sectionLabel}>Monster Progress</Text>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>Hunts Completed</Text>
            <Text style={styles.statValue}>{huntsCompleted}</Text>
          </View>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>Hunts Remaining</Text>
            <Text style={styles.statValue}>{huntsRemaining}</Text>
          </View>
          <ProgressBar progress={completionPercent / 100} style={styles.progressBar} />
          <Text style={styles.completionText}>{completionPercent}% Complete</Text>
        </GlassCard>

        {huntsCompleted > 0 ? (
          <GlassCard style={styles.progressCard}>
            <Text style={styles.sectionLabel}>Danger Zone</Text>
            <Button
              label={isResetting ? 'Resetting…' : 'Reset Progress'}
              variant="destructive"
              onPress={confirmResetProgress}
              disabled={isResetting}
            />
            <Text style={styles.resetCaption}>
              Erases this monster's Encounter results and Hunt progress only. Other monsters and
              your Chronicle are kept.
            </Text>
          </GlassCard>
        ) : null}

        {bestiaryStats && bestiaryStats.timesDefeated > 0 ? (
          <GlassCard style={styles.progressCard}>
            <Text style={styles.sectionLabel}>Bestiary Record</Text>
            <View style={styles.statRow}>
              <Text style={styles.statLabel}>First Defeated</Text>
              <Text style={styles.statValue}>
                {bestiaryStats.firstDefeatedAt ? formatDate(bestiaryStats.firstDefeatedAt) : '—'}
              </Text>
            </View>
            <View style={styles.statRow}>
              <Text style={styles.statLabel}>Times Defeated</Text>
              <Text style={styles.statValue}>{bestiaryStats.timesDefeated}</Text>
            </View>
            <View style={styles.statRow}>
              <Text style={styles.statLabel}>Fastest Victory</Text>
              <Text style={styles.statValue}>
                {bestiaryStats.fastestVictorySeconds !== null
                  ? formatSecondsClock(bestiaryStats.fastestVictorySeconds)
                  : '—'}
              </Text>
            </View>
            <View style={styles.statRow}>
              <Text style={styles.statLabel}>Personal Best Rank</Text>
              <Text style={styles.statValue}>{bestiaryStats.personalBestRank ?? '—'}</Text>
            </View>
            <View style={styles.statRow}>
              <Text style={styles.statLabel}>Favorite Hunt</Text>
              <Text style={styles.statValue}>{bestiaryStats.favoriteHuntName ?? '—'}</Text>
            </View>
          </GlassCard>
        ) : null}

        {lore ? (
          <GlassCard style={styles.loreCard}>
            <Text style={styles.sectionLabel}>Bestiary</Text>
            <Text style={styles.loreLabel}>Origin</Text>
            <Text style={styles.loreText}>{lore.origin}</Text>
            <Text style={styles.loreLabel}>Weakness</Text>
            <Text style={styles.loreText}>{lore.weakness}</Text>
            {lore.quotes[0] ? <Text style={styles.loreQuote}>"{lore.quotes[0]}"</Text> : null}
          </GlassCard>
        ) : null}

        <GlassCard style={styles.huntsCard}>
          <Text style={styles.sectionLabel}>Hunts</Text>
          {monster.hunts.map((hunt) => {
            const previousHunt = monster.hunts.find((h) => h.order === hunt.order - 1);
            const isPreviousHuntCompleted = previousHunt ? completedHuntIds.has(previousHunt.id) : true;
            const state = getHuntDisplayState(hunt, huntsCompleted, isPreviousHuntCompleted);
            const isTappable = state !== 'locked';
            // Encounter History: only ever set when the previous encounter
            // has an actual completed result on file — for order 1 (no
            // previous encounter) or an uncompleted previous encounter,
            // this stays undefined and nothing extra renders below, i.e.
            // the existing row is exactly what it was before this change.
            const previousEncounter = previousHunt
              ? previousEncounterByHuntId.get(previousHunt.id)
              : undefined;
            const previousSeconds = previousEncounter
              ? previousEncounter.result.timeMinutes * 60 + previousEncounter.result.timeSeconds
              : 0;
            const previousRpeLabel = previousEncounter ? getRPELabel(previousEncounter.result.rpe) : null;

            return (
              <Pressable
                key={hunt.id}
                disabled={!isTappable}
                onPress={() =>
                  navigation.navigate('HuntOverview', { monsterId: monster.id, huntId: hunt.id })
                }
                style={({ pressed }) => [
                  styles.huntRow,
                  isTappable && pressed && styles.huntRowPressed,
                ]}
              >
                <View style={styles.huntRowTop}>
                  <Text style={styles.huntOrder}>{hunt.order}</Text>
                  <Text style={[styles.huntName, state === 'locked' && styles.huntNameLocked]}>
                    {hunt.name}
                  </Text>
                  <Text style={[styles.huntStateLabel, { color: STATE_COLOR[state] }]}>
                    {state === 'completed' ? 'Completed' : state === 'available' ? 'Available' : 'Locked'}
                  </Text>
                  <Ionicons name={STATE_ICON[state]} size={16} color={STATE_COLOR[state]} />
                </View>

                {previousEncounter ? (
                  // Real-device report: this used to be a single
                  // numberOfLines={1} line cramming rank+time+weight+RPE
                  // together, so it got clipped. Split into two rows:
                  // rank/time/PR (the headline result) on its own line,
                  // then a smaller metadata line below for
                  // weight/gear/RPE/Custom Hunt — nothing capped to one
                  // line anymore, so nothing gets silently cut off.
                  <View style={styles.previousEncounterBlock}>
                    <View style={styles.previousEncounterRow}>
                      <View
                        style={[
                          styles.previousRankBadge,
                          { borderColor: RANK_COLORS[previousEncounter.rank] },
                        ]}
                      >
                        <Text
                          style={[styles.previousRankText, { color: RANK_COLORS[previousEncounter.rank] }]}
                        >
                          {previousEncounter.rank}
                        </Text>
                      </View>
                      <Text style={styles.previousEncounterText}>
                        Previous: {formatSecondsClock(previousSeconds)}
                      </Text>
                      {previousEncounter.wasPersonalRecord ? (
                        <Ionicons name="flame" size={12} color={colors.gold} />
                      ) : null}
                    </View>
                    <Text style={styles.previousEncounterMeta}>
                      {formatWeightPair(
                        previousEncounter.result.weightValueA,
                        previousEncounter.result.weightValueB,
                        previousEncounter.result.weightUnit
                      )}
                      {previousRpeLabel ? ` · Felt: ${previousRpeLabel}` : ''}
                      {previousEncounter.result.isCustomHunt ? ' · Custom Hunt' : ''}
                    </Text>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </GlassCard>

        {nextHunt ? (
          <Button
            label={`Begin ${nextHunt.name}`}
            onPress={() =>
              navigation.navigate('HuntOverview', {
                monsterId: monster.id,
                huntId: nextHunt.id,
              })
            }
            style={styles.startButton}
          />
        ) : null}
      </ScrollView>
    </AppBackground>
  );
}

const PORTRAIT_SIZE = 160;

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    alignItems: 'center',
    padding: spacing.lg,
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
  portrait: {
    width: PORTRAIT_SIZE,
    height: PORTRAIT_SIZE,
    borderRadius: PORTRAIT_SIZE / 2,
    borderWidth: 2,
    borderColor: colors.rarity.boss,
    backgroundColor: colors.void.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
    overflow: 'hidden',
  },
  portraitImage: {
    width: '100%',
    height: '100%',
  },
  portraitInitial: {
    fontFamily: fontFamily.displayBold,
    fontSize: 64,
    color: colors.text.secondary,
  },
  name: {
    fontFamily: fontFamily.displayBold,
    fontSize: fontSize.xl,
    color: colors.text.primary,
    textTransform: 'uppercase',
    letterSpacing: 2,
  },
  title: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.lg,
    color: colors.bronze.base,
    marginTop: spacing.xxs,
  },
  personalityPill: {
    marginTop: spacing.xs,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  personalityText: {
    fontFamily: fontFamily.monoBold,
    fontSize: fontSize.xs,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  personalityFlavor: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.sm,
    fontStyle: 'italic',
    color: colors.text.muted,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  defeatedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
    marginTop: spacing.xs,
  },
  defeatedText: {
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
    textAlign: 'center',
    marginTop: spacing.md,
  },
  progressCard: {
    width: '100%',
    marginTop: spacing.lg,
  },
  resetCaption: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.xs,
    color: colors.text.muted,
    marginTop: spacing.sm,
  },
  previewSubtitle: {
    fontFamily: fontFamily.bodySemiBold,
    fontSize: fontSize.sm,
    color: colors.text.secondary,
    marginBottom: spacing.xs,
  },
  modeHint: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.sm,
    color: colors.text.muted,
    marginBottom: spacing.xs,
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
  progressBar: {
    marginTop: spacing.sm,
  },
  completionText: {
    fontFamily: fontFamily.monoRegular,
    fontSize: fontSize.xs,
    color: colors.text.muted,
    marginTop: spacing.xxs,
    textAlign: 'right',
  },
  loreCard: {
    width: '100%',
    marginTop: spacing.sm,
  },
  loreLabel: {
    fontFamily: fontFamily.displayRegular,
    fontSize: fontSize.xs,
    letterSpacing: 1,
    color: colors.bronze.base,
    textTransform: 'uppercase',
    marginTop: spacing.sm,
  },
  loreText: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.base,
    lineHeight: lineHeight.base,
    color: colors.text.secondary,
    marginTop: spacing.xxs,
  },
  loreQuote: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.base,
    fontStyle: 'italic',
    color: colors.text.muted,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  huntsCard: {
    width: '100%',
    marginTop: spacing.sm,
  },
  sectionLabel: {
    fontFamily: fontFamily.displayRegular,
    fontSize: fontSize.xs,
    letterSpacing: 2,
    color: colors.text.muted,
    textTransform: 'uppercase',
    marginBottom: spacing.sm,
  },
  huntRow: {
    paddingVertical: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.border.hairline,
  },
  huntRowPressed: {
    backgroundColor: colors.charcoal.raised,
  },
  // The original single-line row layout, now nested inside huntRow so a
  // second (optional) row can sit below it for the previous-encounter
  // summary, without changing how this top line itself looks or behaves.
  huntRowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  huntOrder: {
    fontFamily: fontFamily.monoRegular,
    fontSize: fontSize.sm,
    color: colors.text.muted,
    width: 16,
  },
  huntName: {
    flex: 1,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: fontSize.base,
    color: colors.text.primary,
  },
  huntNameLocked: {
    color: colors.steel,
  },
  huntStateLabel: {
    fontFamily: fontFamily.monoRegular,
    fontSize: fontSize.xs,
    textTransform: 'uppercase',
  },
  // Encounter History summary — now two rows (real-device report: a
  // single numberOfLines={1} line was clipping weight/RPE/etc). Block
  // wraps both rows so they share the same left-alignment under huntName.
  previousEncounterBlock: {
    marginTop: spacing.xxs,
    marginLeft: 16 + spacing.sm, // aligns under huntName, past huntOrder's width + its row gap
  },
  previousEncounterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
  },
  previousRankBadge: {
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 4,
    minWidth: 18,
    alignItems: 'center',
  },
  previousRankText: {
    fontFamily: fontFamily.monoBold,
    fontSize: 10,
  },
  previousEncounterText: {
    fontFamily: fontFamily.monoRegular,
    fontSize: fontSize.xs,
    color: colors.text.muted,
  },
  // Second line: weight/gear/RPE/Custom Hunt — smaller and more muted
  // than the headline row above it, and allowed to wrap if it's ever
  // genuinely long, rather than silently truncating.
  previousEncounterMeta: {
    fontFamily: fontFamily.monoRegular,
    fontSize: 10,
    color: colors.text.muted,
    opacity: 0.85,
    marginTop: 1,
  },
  startButton: {
    width: '100%',
    marginTop: spacing.lg,
  },
});
