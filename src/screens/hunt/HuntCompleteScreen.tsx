import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated, Image, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { triggerHaptic } from '../../utils/haptics';
import { HuntStackParamList } from '../../navigation/types';
import { Button, GlassCard, LevelUpModal, AppBackground } from '../../components/core';
import { ProgressBar } from '../../components/progress';
import { getAtmosphericColor } from '../../utils/bossPersonality';
import { contentEngine } from '../../../engines/content';
import { getMonsterPortrait } from '../../constants/monsterPortraits';
import { useAppStore } from '../../store';
import { getLevelProgress } from '../../../engines/progress/progressionEngine';
import { isCampaignComplete } from '../../utils/campaignState';
import { getNextObjective, NextObjective } from '../../utils/nextObjective';
import { flavorTextFor } from '../../utils/flavorText';
import { detectMilestone, Milestone } from '../../utils/milestones';
import { useStaggeredReveal } from '../../utils/useStaggeredReveal';
import { getRoundStats } from '../../utils/roundStats';
import { convertKgToDisplay, formatWeightPair } from '../../utils/weight';
import { colors, fontFamily, fontSize, spacing, glow } from '../../theme';

type Props = NativeStackScreenProps<HuntStackParamList, 'HuntComplete'>;

const RPE_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: 'Easy' },
  { value: 2, label: 'Solid' },
  { value: 3, label: 'Hard' },
  { value: 4, label: 'Brutal' },
];

/**
 * Returns to this monster's World Map with the stack cleared beneath it —
 * same "no lingering hunt screens behind you" behavior popToTop() gave
 * pre-Sprint-14, but now the map is campaign-parameterized so it lands on
 * the right one instead of the Campaign Select root.
 */
function returnToWorldMap(navigation: Props['navigation'], monsterId: string) {
  const campaign = contentEngine.getCampaignForMonster(monsterId);
  navigation.reset({
    index: campaign ? 1 : 0,
    routes: campaign
      ? [{ name: 'Hunt' }, { name: 'WorldMap', params: { campaignId: campaign.id } }]
      : [{ name: 'Hunt' }],
  });
}

const RANK_COLORS: Record<string, string> = {
  S: colors.gold,
  A: colors.ember.base,
  B: colors.bronze.base,
  C: colors.text.secondary,
};

const MILESTONE_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  'campaign-complete': 'flag',
  'first-victory': 'sparkles',
  'monster-slayer': 'skull',
  'first-s-rank': 'star',
  'first-level-up': 'trending-up',
};

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

export function HuntCompleteScreen({ route, navigation }: Props) {
  const { monsterId, huntId, workoutId } = route.params;
  const monster = contentEngine.getMonster(monsterId);
  const hunt = contentEngine.getHunt(monsterId, huntId);
  const summary = useAppStore((state) => state.lastHuntSummary);
  const monsterProgress = useAppStore((state) => state.monsterProgress);
  const chronicle = useAppStore((state) => state.chronicle);
  const getAllResults = useAppStore((state) => state.getAllResults);
  const unitPreference = useAppStore((state) => state.settings?.unitPreference ?? 'kg');

  const campaign = contentEngine.getCampaignForMonster(monsterId);
  const justCompletedCampaign = campaign ? isCampaignComplete(campaign, monsterProgress) : false;
  const nextObjective: NextObjective | null = getNextObjective(
    contentEngine.getAllCampaigns(),
    (id) => contentEngine.getMonster(id),
    monsterProgress
  );

  const [milestone, setMilestone] = useState<Milestone | null>(null);
  const setResultRPE = useAppStore((state) => state.setResultRPE);
  const setResultNotes = useAppStore((state) => state.setResultNotes);
  const [selectedRPE, setSelectedRPE] = useState<number | null>(null);
  // Task 10 (Training Notes): free text, purely local until the player
  // moves on — committed once, via setResultNotes, at the moment they
  // press whichever Continue action ends this screen (mirrors how RPE
  // already writes via setResultRPE, just deferred to a natural "done
  // typing" point instead of on every keystroke).
  const [noteText, setNoteText] = useState('');
  useEffect(() => {
    if (!summary || !hunt || !monster) {
      return;
    }
    getAllResults().then((allResults) => {
      // Results are ordered DESC by completedAt; index 0 is the one this
      // very screen is displaying, so everything after it is "prior".
      const priorResults = allResults.slice(1);
      setMilestone(
        detectMilestone({
          summary,
          chronicle,
          huntOrder: hunt.order,
          monsterHuntCount: monster.hunts.length,
          justCompletedCampaign,
          priorResults,
          getWorkout: (id) => contentEngine.getWorkout(id),
        })
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary, hunt, monster, chronicle, justCompletedCampaign, getAllResults]);

  // Haptics for the two moments here that Start/Finish Hunt haptics
  // (fired earlier, on ActiveHuntScreen) don't already cover. Fires once
  // per screen visit; sequenced with a short gap so a PR + Campaign
  // Complete on the same hunt reads as two distinct pulses, not one
  // confused buzz.
  const hasFiredMomentHapticsRef = useRef(false);
  useEffect(() => {
    if (!summary || hasFiredMomentHapticsRef.current) {
      return;
    }
    hasFiredMomentHapticsRef.current = true;
    if (summary.isPersonalRecord) {
      triggerHaptic(Haptics.ImpactFeedbackStyle.Medium);
    }
    if (justCompletedCampaign) {
      const timeoutId = setTimeout(
        () => triggerHaptic(Haptics.ImpactFeedbackStyle.Heavy),
        summary.isPersonalRecord ? 220 : 0
      );
      return () => clearTimeout(timeoutId);
    }
  }, [summary, justCompletedCampaign]);

  const [levelUpVisible, setLevelUpVisible] = useState(!!summary?.leveledUp);

  // Staged reveal (Sprint 17, extracted to a shared hook in Sprint 18):
  // Rank → XP → Stats → Next Goal, instead of the whole screen fading in
  // at once. Four beats, staggered — same content, just sequenced.
  const revealStyle = useStaggeredReveal(4);

  // Trophy and rank get their own small spring "pop" on top of the beat-0
  // fade — a premium touch is usually one element arriving with a bit more
  // physicality than a flat fade, not a whole new animation system.
  const trophyPop = useRef(new Animated.Value(0.4)).current;
  const rankPop = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    Animated.spring(trophyPop, { toValue: 1, delay: 80, useNativeDriver: true, speed: 14, bounciness: 10 }).start();
    Animated.spring(rankPop, { toValue: 1, delay: 260, useNativeDriver: true, speed: 16, bounciness: 14 }).start();
  }, [trophyPop, rankPop]);

  // Smooth XP count-up (Sprint 18) — counts from previousXP to newXP over
  // the same window the Experience beat is revealing in, instead of the
  // number just appearing. Purely a display value; summary.newXP remains
  // the source of truth used everywhere else on this screen.
  const [displayedXP, setDisplayedXP] = useState(summary?.previousXP ?? 0);
  useEffect(() => {
    if (!summary) {
      return;
    }
    const anim = new Animated.Value(summary.previousXP);
    const listenerId = anim.addListener(({ value }) => setDisplayedXP(Math.round(value)));
    Animated.timing(anim, {
      toValue: summary.newXP,
      duration: 900,
      delay: 180, // lines up with the XP beat's own stagger delay
      useNativeDriver: false,
    }).start();
    return () => anim.removeListener(listenerId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary?.previousXP, summary?.newXP]);

  if (!summary) {
    return (
      <AppBackground
        style={styles.container}
        atmosphericColor={getAtmosphericColor(monster?.personality, monster?.accentColor)}
      >
        <SafeAreaView style={styles.safeArea} edges={['top']}>
          <Text style={styles.missingText}>No hunt result to show.</Text>
          <Button
            label="Continue"
            onPress={() => returnToWorldMap(navigation, monsterId)}
            style={styles.continueButton}
          />
        </SafeAreaView>
      </AppBackground>
    );
  }

  const rank = summary.rank;
  const levelProgress = getLevelProgress(displayedXP);
  const weightLabel = formatWeightPair(
    summary.weightKg,
    summary.gearCount === 2 ? summary.weightBKg ?? summary.weightKg : null,
    unitPreference
  );
  // Task 6 fix: this used to be `contentEngine.getWorkout(workoutId)` +
  // a fresh getExerciseBreakdown call here — that re-fetched the
  // CANONICAL workout by id, silently ignoring any Custom Hunt
  // structural change (ladder depth, round count, cycle count) the
  // session actually ran with, so a 5-step Custom ladder still reported
  // canonical Minotaur's ~100-rep total. summary.exerciseBreakdown is
  // computed once inside completeHunt from whichever Workout the session
  // actually used — reading it here instead means there's exactly one
  // place this is ever calculated, not two that can disagree.
  const exerciseBreakdown = summary.exerciseBreakdown;
  // Sprint 23: only ever present for the Minotaur ladder (`stepLabel: "Rung"`
  // content flag) — every other workout's summary.rungLaps is undefined, so
  // this card never renders for them.
  const rungLaps = summary.rungLaps ?? [];
  const rungStats = rungLaps.length > 0 ? getRoundStats(rungLaps, []) : null;

  return (
    <AppBackground
      style={styles.container}
      atmosphericColor={getAtmosphericColor(monster?.personality, monster?.accentColor)}
    >
      <SafeAreaView style={styles.safeArea} edges={['top']}>
      <LevelUpModal
        visible={levelUpVisible}
        newLevel={summary.newLevel}
        title={summary.title}
        onDismiss={() => setLevelUpVisible(false)}
      />

      <Animated.ScrollView
        contentContainerStyle={{
          alignItems: 'center',
          width: '100%',
          padding: spacing.xl,
        }}
        style={{ width: '100%' }}
      >
        <Animated.View style={[styles.beat, revealStyle(0)]}>
          <View style={styles.badgeWrap}>
            <Animated.View style={[styles.badge, glow.lg, { transform: [{ scale: trophyPop }] }]}>
              {monster && getMonsterPortrait(monster.portraitAsset) ? (
                <Image
                  source={getMonsterPortrait(monster.portraitAsset)}
                  style={styles.badgeImage}
                  resizeMode="cover"
                />
              ) : (
                <Ionicons name="trophy" size={48} color={colors.gold} />
              )}
            </Animated.View>
            <View style={styles.badgeTrophy}>
              <Ionicons name="trophy" size={16} color={colors.void.base} />
            </View>
          </View>

          <Text style={styles.title}>Hunt Complete</Text>
          <Text style={styles.subtitle}>
            {monster?.name ?? 'The boss'}
            {hunt ? ` · ${hunt.name}` : ''} defeated
          </Text>

          {milestone ? (
            <View style={styles.milestoneBanner}>
              <Ionicons name={MILESTONE_ICON[milestone.type]} size={14} color={colors.gold} />
              <Text style={styles.milestoneBannerText}>{milestone.title}</Text>
            </View>
          ) : null}
          {milestone ? <Text style={styles.milestoneDescription}>{milestone.description}</Text> : null}

          <Animated.View
            style={[
              styles.rankBadge,
              { borderColor: RANK_COLORS[rank] },
              { transform: [{ scale: rankPop }] },
            ]}
          >
            <Text style={[styles.rankText, { color: RANK_COLORS[rank] }]}>{rank}</Text>
          </Animated.View>

          <View style={styles.badgeRow}>
            {summary.isPersonalRecord ? (
              <View style={styles.prBadge}>
                <Ionicons name="flame" size={14} color={colors.gold} />
                <Text style={styles.prText}>Personal Record</Text>
              </View>
            ) : null}
            {summary.isFirstClear ? (
              <View style={styles.prBadge}>
                <Ionicons name="ribbon" size={14} color={colors.bronze.base} />
                <Text style={styles.prText}>First Clear</Text>
              </View>
            ) : null}
            {summary.titleChanged ? (
              <View style={styles.prBadge}>
                <Ionicons name="star" size={14} color={colors.ember.glow} />
                <Text style={styles.prText}>New Title: {summary.title}</Text>
              </View>
            ) : null}
            {/* Task 7: only ever rendered when a genuinely comparable
                prior result exists (same encounter, same weight/gear/
                custom-mode) — see completeHunt. Better reuses the same
                celebratory prBadge look as the badges above it; worse
                uses a visibly quieter variant, same shape, muted color —
                shown clearly but without competing with the good news
                above when there is any. */}
            {summary.isBetterThanComparable === true ? (
              <View style={styles.prBadge}>
                <Ionicons name="trending-up" size={14} color={colors.gold} />
                <Text style={styles.prText}>Better Than Last Time</Text>
              </View>
            ) : summary.isBetterThanComparable === false ? (
              <View style={styles.comparisonBadgeSubtle}>
                <Ionicons name="trending-down" size={13} color={colors.text.muted} />
                <Text style={styles.comparisonTextSubtle}>Slower Than Last Time</Text>
              </View>
            ) : null}
            {/* Encounter Lock: exclusive of the Task 7 badges above —
                encounterOutcome is only ever set for a locked Hunt (every
                Hunt today), and reaching this screen for an order>=2 Hunt
                already means the target was beaten (see the
                pre-completeHunt gate in ActiveHuntScreen), so this is
                confirmation, not a fresh comparison. */}
            {summary.encounterOutcome === 'baseline-established' ? (
              <View style={styles.prBadge}>
                <Ionicons name="flag" size={14} color={colors.ember.base} />
                <Text style={styles.prText}>Baseline Established</Text>
              </View>
            ) : summary.encounterOutcome === 'target-beaten' ? (
              <View style={styles.prBadge}>
                <Ionicons name="flag" size={14} color={colors.ember.base} />
                <Text style={styles.prText}>Encounter Beaten</Text>
              </View>
            ) : null}
          </View>
          {summary.encounterOutcome === 'baseline-established' ? (
            <Text style={styles.encounterOutcomeHint}>
              This time becomes the target the next Encounter has to beat.
            </Text>
          ) : summary.encounterOutcome === 'target-beaten' && summary.encounterTargetSeconds !== null ? (
            <Text style={styles.encounterOutcomeHint}>
              Beat {formatTime(summary.encounterTargetSeconds)} — this run is the new target.
            </Text>
          ) : null}
        </Animated.View>

        <Animated.View style={[styles.beatFull, revealStyle(1)]}>
        <GlassCard style={styles.card}>
          <Text style={styles.sectionLabel}>Experience</Text>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>XP Earned</Text>
            <Text style={[styles.statValue, styles.xpValue]}>+{summary.xp.total} XP</Text>
          </View>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>Previous XP</Text>
            <Text style={styles.statValue}>{summary.previousXP}</Text>
          </View>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>Current XP</Text>
            <Text style={styles.statValue}>{displayedXP}</Text>
          </View>

          <View style={styles.levelRow}>
            <Text style={styles.levelLabel}>
              Level {levelProgress.level} · {summary.title}
            </Text>
            <Text style={styles.levelLabel}>
              {levelProgress.xpIntoLevel} / {levelProgress.xpForThisLevel}
            </Text>
          </View>
          <ProgressBar progress={levelProgress.progress} fillColor={colors.gold} height={6} />

          <View style={styles.breakdown}>
            <BreakdownLine label="Base" value={summary.xp.baseXP} />
            <BreakdownLine label="Weight" value={summary.xp.weightBonus} />
            <BreakdownLine label="Performance" value={summary.xp.performanceBonus} />
            {summary.xp.personalRecordBonus > 0 ? (
              <BreakdownLine label="Personal Record" value={summary.xp.personalRecordBonus} />
            ) : null}
            {summary.xp.firstClearBonus > 0 ? (
              <BreakdownLine label="First Clear" value={summary.xp.firstClearBonus} />
            ) : null}
          </View>
        </GlassCard>
        </Animated.View>

        <Animated.View style={[styles.beatFull, revealStyle(2)]}>
        <GlassCard style={styles.card}>
          <Text style={styles.sectionLabel}>Statistics</Text>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>Final Time</Text>
            <Text style={styles.statValue}>{formatTime(summary.elapsedSeconds)}</Text>
          </View>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>Weight Used</Text>
            <Text style={styles.statValue}>{weightLabel}</Text>
          </View>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>Volume</Text>
            <Text style={styles.statValue}>{Math.round(summary.volumeKg)} kg</Text>
          </View>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>Damage Dealt</Text>
            <Text style={styles.statValue}>{summary.totalDamageDealt}</Text>
          </View>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>Critical Hits</Text>
            <Text style={styles.statValue}>{summary.criticalHits}</Text>
          </View>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>Rounds</Text>
            <Text style={styles.statValue}>{summary.totalRounds}</Text>
          </View>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>Exercises</Text>
            <Text style={styles.statValue}>{summary.totalExercises}</Text>
          </View>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>Completion</Text>
            <Text style={styles.statValue}>{summary.completionPercentage}%</Text>
          </View>
        </GlassCard>

        {exerciseBreakdown.length > 0 ? (
          <GlassCard style={styles.card}>
            <Text style={styles.sectionLabel}>Exercise Breakdown</Text>
            {exerciseBreakdown.map((entry, index) => (
              <View
                key={entry.name}
                style={[styles.breakdownEntry, index > 0 && styles.breakdownEntryDivider]}
              >
                <Text style={styles.breakdownEntryName}>{entry.displayName ?? entry.name}</Text>
                <View style={styles.breakdownEntryStats}>
                  <Text style={styles.breakdownEntryReps}>{entry.totalReps} reps</Text>
                  <Text style={styles.breakdownEntryVolume}>{Math.round(entry.volumeKg)} kg</Text>
                </View>
              </View>
            ))}
          </GlassCard>
        ) : null}

        {rungStats ? (
          <GlassCard style={styles.card}>
            <Text style={styles.sectionLabel}>Rung Performance</Text>
            {rungLaps.map((lap, index) => (
              <View
                key={`${lap.round}-${index}`}
                style={[styles.breakdownEntry, index > 0 && styles.breakdownEntryDivider]}
              >
                <Text style={styles.breakdownEntryName}>Rung {lap.round}</Text>
                <Text style={styles.breakdownEntryReps}>{formatTime(lap.durationSeconds)}</Text>
              </View>
            ))}
            <View style={styles.breakdown}>
              <View style={styles.statRow}>
                <Text style={styles.statLabel}>Fastest Rung</Text>
                <Text style={styles.statValue}>
                  {rungStats.fastestRoundSeconds !== null ? formatTime(rungStats.fastestRoundSeconds) : '—'}
                </Text>
              </View>
              <View style={styles.statRow}>
                <Text style={styles.statLabel}>Slowest Rung</Text>
                <Text style={styles.statValue}>
                  {rungStats.slowestRoundSeconds !== null ? formatTime(rungStats.slowestRoundSeconds) : '—'}
                </Text>
              </View>
              <View style={styles.statRow}>
                <Text style={styles.statLabel}>Average Rung</Text>
                <Text style={styles.statValue}>
                  {rungStats.averageRoundSeconds !== null ? formatTime(rungStats.averageRoundSeconds) : '—'}
                </Text>
              </View>
              <View style={styles.statRow}>
                <Text style={styles.statLabel}>Total Active Time</Text>
                <Text style={styles.statValue}>{formatTime(rungStats.totalActiveRoundSeconds)}</Text>
              </View>
              <View style={styles.statRow}>
                <Text style={styles.statLabel}>Total Workout Time</Text>
                <Text style={styles.statValue}>{formatTime(summary.elapsedSeconds)}</Text>
              </View>
            </View>
          </GlassCard>
        ) : null}
        </Animated.View>

        <Animated.View style={[styles.beatFull, revealStyle(3)]}>
        {/* Task 10: reordered to a natural athlete workflow — result was
            already shown above (beats 0-2: rank/XP/stats), so here it's
            "how did it feel" -> optional training note -> what's next,
            ending in exactly one Continue action (previously there were
            two: "Continue Adventure" inside Next Goal *and* a separate
            plain "Continue" below it, with RPE sandwiched between them).
            The second one is gone; whichever Next Goal button applies is
            now the only way off this screen, and it commits the RPE/note
            that was just entered before navigating. */}
        <GlassCard style={styles.card}>
          <Text style={styles.sectionLabel}>How did that feel?</Text>
          <View style={styles.rpeRow}>
            {RPE_OPTIONS.map(({ value, label }) => (
              <Button
                key={value}
                label={label}
                variant={selectedRPE === value ? 'primary' : 'secondary'}
                onPress={() => {
                  setSelectedRPE(value);
                  setResultRPE(summary.resultId, value);
                }}
                style={styles.rpeButton}
              />
            ))}
          </View>
        </GlassCard>

        <GlassCard style={styles.card}>
          <Text style={styles.sectionLabel}>Training Notes</Text>
          <TextInput
            style={styles.notesInput}
            placeholder="What happened in the arena?"
            placeholderTextColor={colors.text.muted}
            value={noteText}
            onChangeText={setNoteText}
            multiline
            maxLength={500}
          />
        </GlassCard>

        {/*
          Polish pass, fix 1: this used to be "Continue Adventure",
          which navigated straight into Encounter 2/3's Hunt Overview —
          i.e. auto-starting the next encounter. That's gone: the player
          now always lands back on the World Map and chooses when to
          fight next, exactly like the "every trial conquered" fallback
          below already did. The card still shows what's next (informational
          only, not an action) so the context isn't lost — same visual
          design/layout/card style as before, only the button + its
          behavior changed.
        */}
        {nextObjective ? (
          <GlassCard style={[styles.card, styles.nextCard]}>
            <Text style={styles.sectionLabel}>Next Goal</Text>
            <Text style={styles.nextMonster}>{nextObjective.monster.name}</Text>
            <Text style={styles.nextHunt}>{nextObjective.hunt.name}</Text>
            <Text style={styles.nextFlavor}>{flavorTextFor(nextObjective.hunt.id)}</Text>
            <Button
              label="Return to Map"
              onPress={() => {
                setResultNotes(summary.resultId, noteText.trim() || null);
                returnToWorldMap(navigation, monsterId);
              }}
              style={styles.nextButton}
            />
          </GlassCard>
        ) : (
          <GlassCard style={[styles.card, styles.nextCard]}>
            <Text style={styles.sectionLabel}>Next Goal</Text>
            <Text style={styles.nextFlavor}>Every trial conquered — for now.</Text>
            <Button
              label="Return to Map"
              onPress={() => {
                setResultNotes(summary.resultId, noteText.trim() || null);
                returnToWorldMap(navigation, monsterId);
              }}
              style={styles.nextButton}
            />
          </GlassCard>
        )}
        </Animated.View>
      </Animated.ScrollView>
      </SafeAreaView>
    </AppBackground>
  );
}

function BreakdownLine({ label, value }: { label: string; value: number }) {
  if (value === 0) {
    return null;
  }
  return (
    <View style={styles.breakdownRow}>
      <Text style={styles.breakdownLabel}>{label}</Text>
      <Text style={styles.breakdownValue}>+{value}</Text>
    </View>
  );
}

const BADGE_SIZE = 96;
const RANK_SIZE = 64;

const styles = StyleSheet.create({
  beat: {
    width: '100%',
    alignItems: 'center',
  },
  beatFull: {
    width: '100%',
  },
  nextCard: {
    alignItems: 'center',
  },
  nextMonster: {
    fontFamily: fontFamily.displayBold,
    fontSize: fontSize.lg,
    color: colors.text.primary,
    textTransform: 'uppercase',
  },
  nextHunt: {
    fontFamily: fontFamily.bodySemiBold,
    fontSize: fontSize.base,
    color: colors.bronze.active,
    marginTop: 2,
  },
  nextFlavor: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.sm,
    fontStyle: 'italic',
    color: colors.text.muted,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  nextButton: {
    width: '100%',
    marginTop: spacing.md,
  },
  container: { flex: 1 },
  safeArea: { flex: 1, alignItems: 'center' },
  missingText: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.lg,
    color: colors.text.secondary,
    marginTop: spacing.xxl,
    textAlign: 'center',
    paddingHorizontal: spacing.xl,
  },
  badgeWrap: {
    alignSelf: 'center',
    marginBottom: spacing.lg,
  },
  badge: {
    width: BADGE_SIZE,
    height: BADGE_SIZE,
    borderRadius: BADGE_SIZE / 2,
    borderWidth: 2,
    borderColor: colors.gold,
    backgroundColor: colors.void.surface,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  badgeImage: {
    width: '100%',
    height: '100%',
  },
  badgeTrophy: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.void.base,
  },
  title: {
    fontFamily: fontFamily.displayBold,
    fontSize: fontSize.display,
    color: colors.text.primary,
    textTransform: 'uppercase',
    letterSpacing: 2,
    textAlign: 'center',
  },
  subtitle: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.lg,
    color: colors.text.secondary,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  milestoneBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.gold,
    backgroundColor: 'rgba(212, 175, 55, 0.08)',
  },
  milestoneBannerText: {
    fontFamily: fontFamily.monoRegular,
    fontSize: fontSize.xs,
    color: colors.gold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  milestoneDescription: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.sm,
    fontStyle: 'italic',
    color: colors.text.muted,
    textAlign: 'center',
    marginTop: spacing.xxs,
    paddingHorizontal: spacing.lg,
  },
  rankBadge: {
    width: RANK_SIZE,
    height: RANK_SIZE,
    borderRadius: RANK_SIZE / 2,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.lg,
    alignSelf: 'center',
  },
  rankText: { fontFamily: fontFamily.displayBold, fontSize: fontSize.xl },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  prBadge: { flexDirection: 'row', alignItems: 'center', gap: spacing.xxs },
  prText: {
    fontFamily: fontFamily.monoBold,
    fontSize: fontSize.xs,
    color: colors.gold,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  // Task 7: same shape as prBadge/prText, deliberately quieter (regular
  // weight, muted color, no letterSpacing/uppercase) — shown clearly, not
  // hidden, but reads as a plain fact rather than a celebration.
  comparisonBadgeSubtle: { flexDirection: 'row', alignItems: 'center', gap: spacing.xxs },
  comparisonTextSubtle: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.xs,
    color: colors.text.muted,
  },
  encounterOutcomeHint: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.xs,
    color: colors.text.muted,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  card: { width: '100%', marginTop: spacing.xl },
  sectionLabel: {
    fontFamily: fontFamily.displayRegular,
    fontSize: fontSize.xs,
    letterSpacing: 2,
    color: colors.text.muted,
    textTransform: 'uppercase',
    marginBottom: spacing.xs,
  },
  statRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xs },
  statLabel: { fontFamily: fontFamily.bodyRegular, fontSize: fontSize.base, color: colors.text.secondary },
  statValue: { fontFamily: fontFamily.monoBold, fontSize: fontSize.base, color: colors.text.primary },
  xpValue: { color: colors.gold },
  levelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.md,
    marginBottom: spacing.xxs,
  },
  levelLabel: { fontFamily: fontFamily.monoRegular, fontSize: fontSize.xs, color: colors.text.muted },
  breakdown: {
    marginTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border.hairline,
    paddingTop: spacing.xs,
  },
  breakdownRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xxs },
  breakdownLabel: { fontFamily: fontFamily.bodyRegular, fontSize: fontSize.sm, color: colors.text.muted },
  breakdownValue: { fontFamily: fontFamily.monoRegular, fontSize: fontSize.sm, color: colors.text.muted },
  breakdownEntry: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  breakdownEntryDivider: {
    borderTopWidth: 1,
    borderTopColor: colors.border.hairline,
  },
  breakdownEntryName: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.base,
    color: colors.text.secondary,
    flexShrink: 1,
    paddingRight: spacing.sm,
  },
  breakdownEntryStats: {
    alignItems: 'flex-end',
  },
  breakdownEntryReps: {
    fontFamily: fontFamily.monoBold,
    fontSize: fontSize.sm,
    color: colors.text.primary,
  },
  breakdownEntryVolume: {
    fontFamily: fontFamily.monoRegular,
    fontSize: fontSize.xs,
    color: colors.text.muted,
    marginTop: 1,
  },
  continueButton: { width: '100%', marginTop: spacing.xl, marginBottom: spacing.xl },
  rpeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  rpeButton: {
    flexGrow: 1,
    flexBasis: '45%',
  },
  // Task 10: styled like a journal entry, not a generic form field —
  // reuses the same body font as the rest of the app's prose text
  // (nextFlavor uses the same fontFamily), a hairline bottom rule
  // instead of a boxed input, and a muted placeholder tone matching
  // sectionLabel's own muted color.
  notesInput: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.base,
    color: colors.text.primary,
    minHeight: 72,
    textAlignVertical: 'top',
    borderBottomWidth: 1,
    borderBottomColor: colors.border.hairline,
    paddingBottom: spacing.sm,
  },
});
