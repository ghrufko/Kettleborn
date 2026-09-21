import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { Header, GlassCard, AppBackground } from '../../components/core';
import { useAppStore } from '../../store';
import { contentEngine } from '../../../engines/content';
import { groupResultsByDay } from '../../utils/timeline';
import { getHuntRank } from '../../utils/huntRank';
import { getWeeklySummary, getMonthlySummary, getTrainingCalendar } from '../../utils/chronicleSummary';
import { ExerciseStats, WeaknessProfile } from '../../utils/exerciseStats';
import { getLongestSilenceDays, getMostDangerousOpponent } from '../../utils/chronicleStory';
import { getRPELabel } from '../../utils/rpeLabels';
import { getExerciseBreakdown } from '../../utils/exerciseBreakdown';
import { formatWeightPair } from '../../utils/weight';
import { WorkoutResult, CustomWorkoutResult, StopwatchResult } from '../../models';
import { colors, fontFamily, fontSize, spacing } from '../../theme';

function formatElapsed(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const RANK_COLORS: Record<string, string> = {
  S: colors.gold,
  A: colors.ember.base,
  B: colors.bronze.base,
  C: colors.text.secondary,
};

export function ChronicleScreen() {
  const chronicle = useAppStore((state) => state.chronicle);
  const getAllResults = useAppStore((state) => state.getAllResults);
  const getAllExerciseStats = useAppStore((state) => state.getAllExerciseStats);
  const getWeaknessProfile = useAppStore((state) => state.getWeaknessProfile);
  const getAllCustomWorkoutResults = useAppStore((state) => state.getAllCustomWorkoutResults);
  const getAllStopwatchResults = useAppStore((state) => state.getAllStopwatchResults);
  const [groups, setGroups] = useState<ReturnType<typeof groupResultsByDay>>([]);
  const [allResults, setAllResults] = useState<WorkoutResult[]>([]);
  const [exerciseStats, setExerciseStats] = useState<ExerciseStats[]>([]);
  const [weaknessProfile, setWeaknessProfile] = useState<WeaknessProfile | null>(null);
  const [customWorkoutResults, setCustomWorkoutResults] = useState<CustomWorkoutResult[]>([]);
  const [stopwatchResults, setStopwatchResults] = useState<StopwatchResult[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // useFocusEffect (not a plain useEffect) so this re-fetches every time the
  // Journal tab regains focus, not just on first mount — this screen stays
  // mounted across tab switches (React Navigation's default tab behavior),
  // so a plain useEffect with these stable store-action deps would only
  // ever run once and go stale after a Hunt completes elsewhere.
  useFocusEffect(
    useCallback(() => {
      getAllResults().then((results) => {
        setGroups(groupResultsByDay(results));
        setAllResults(results);
        setIsLoading(false);
      });
      getAllExerciseStats().then(setExerciseStats);
      getWeaknessProfile().then(setWeaknessProfile);
      // Journal integration (§9): a completely separate fetch/state from
      // everything above — Custom Workout results never feed
      // groupResultsByDay, getWeeklySummary/getMonthlySummary,
      // exerciseStats, weaknessProfile, or the Chronicle aggregate
      // (XP/rank/streak). They're real training sessions, just not
      // monster-hunt RPG ones — see the "Training Sessions" section
      // below, which reads only this state.
      getAllCustomWorkoutResults().then(setCustomWorkoutResults);
      // Stopwatch: same "real session, not a monster-hunt RPG one"
      // treatment as Custom Workout results directly above — its own
      // separate fetch/state, its own section below, never touching any
      // of the monster-scoped stats this screen also computes.
      getAllStopwatchResults().then(setStopwatchResults);
    }, [
      getAllResults,
      getAllExerciseStats,
      getWeaknessProfile,
      getAllCustomWorkoutResults,
      getAllStopwatchResults,
    ])
  );

  const weeklySummary = getWeeklySummary(allResults);
  const monthlySummary = getMonthlySummary(allResults);
  const calendarDays = getTrainingCalendar(allResults);
  const longestSilenceDays = getLongestSilenceDays(allResults);
  const dangerousOpponent = getMostDangerousOpponent(
    allResults,
    (id) => contentEngine.getMonster(id),
    (id) => contentEngine.getWorkout(id)
  );
  const leadingBlanks = new Date(
    new Date().getFullYear(),
    new Date().getMonth(),
    1
  ).getDay();

  return (
    <AppBackground style={styles.container}>
      <Header title="Hunter's Journal" />
      <ScrollView contentContainerStyle={styles.content}>
        <GlassCard>
          <Text style={styles.sectionLabel}>Lifetime Record</Text>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>Monsters Defeated</Text>
            <Text style={styles.statValue}>{chronicle?.totalMonstersDefeated ?? 0}</Text>
          </View>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>Hunts Completed</Text>
            <Text style={styles.statValue}>{chronicle?.totalHuntsCompleted ?? 0}</Text>
          </View>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>Current Streak</Text>
            <Text style={styles.statValue}>{chronicle?.currentStreakDays ?? 0} days</Text>
          </View>
        </GlassCard>

        {isLoading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={colors.bronze.base} />
            <Text style={styles.loadingText}>Reading the record…</Text>
          </View>
        ) : (
        <>
        <View style={styles.periodRow}>
          <GlassCard style={styles.periodCard}>
            <Text style={styles.sectionLabel}>This Week</Text>
            <Text style={styles.periodValue}>{weeklySummary.workouts}</Text>
            <Text style={styles.periodCaption}>hunts</Text>
            <Text style={styles.periodDetail}>
              {weeklySummary.totalMinutes} min · {Math.round(weeklySummary.totalVolumeKg)} kg
            </Text>
          </GlassCard>
          <GlassCard style={styles.periodCard}>
            <Text style={styles.sectionLabel}>This Month</Text>
            <Text style={styles.periodValue}>{monthlySummary.workouts}</Text>
            <Text style={styles.periodCaption}>hunts</Text>
            <Text style={styles.periodDetail}>
              {monthlySummary.totalMinutes} min · {Math.round(monthlySummary.totalVolumeKg)} kg
            </Text>
          </GlassCard>
        </View>

        <GlassCard>
          <Text style={styles.sectionLabel}>Training Calendar</Text>
          <View style={styles.weekdayRow}>
            {WEEKDAY_LABELS.map((label, index) => (
              <Text key={`weekday-${index}`} style={styles.weekdayLabel}>
                {label}
              </Text>
            ))}
          </View>
          <View style={styles.calendarGrid}>
            {Array.from({ length: leadingBlanks }, (_, i) => (
              <View key={`blank-${i}`} style={styles.calendarCell} />
            ))}
            {calendarDays.map((day) => (
              <View
                key={day.date}
                style={[
                  styles.calendarCell,
                  day.trained && styles.calendarCellTrained,
                  day.isToday && styles.calendarCellToday,
                ]}
              >
                <Text
                  style={[styles.calendarDayText, day.trained && styles.calendarDayTextTrained]}
                >
                  {day.date}
                </Text>
              </View>
            ))}
          </View>
        </GlassCard>

        {exerciseStats.length > 0 ? (
          <GlassCard>
            <Text style={styles.sectionLabel}>Exercise Records</Text>
            {exerciseStats.slice(0, 5).map((stat) => (
              <View key={stat.exerciseId} style={styles.statRow}>
                <Text style={styles.statLabel}>{stat.exerciseName}</Text>
                <Text style={styles.statValue}>
                  {stat.totalReps > 0
                    ? `${stat.totalReps.toLocaleString()} reps`
                    : `${stat.totalDistanceFt.toLocaleString()} ft`}
                </Text>
              </View>
            ))}
            <View style={[styles.statRow, styles.favoriteRow]}>
              <Text style={styles.favoriteLabel}>Weapon of Choice</Text>
              <Text style={styles.favoriteValue}>{exerciseStats[0].exerciseName}</Text>
            </View>
          </GlassCard>
        ) : null}

        {weaknessProfile && (weaknessProfile.strongest || weaknessProfile.leastTrained) ? (
          <GlassCard>
            <Text style={styles.sectionLabel}>Training Balance</Text>
            {weaknessProfile.strongest ? (
              <View style={styles.statRow}>
                <Text style={styles.statLabel}>Strongest Movement</Text>
                <Text style={styles.statValue}>{weaknessProfile.strongest.exerciseName}</Text>
              </View>
            ) : null}
            {weaknessProfile.weakest && weaknessProfile.weakest.exerciseId !== weaknessProfile.strongest?.exerciseId ? (
              <View style={styles.statRow}>
                <Text style={styles.statLabel}>Weakest Movement</Text>
                <Text style={styles.statValue}>{weaknessProfile.weakest.exerciseName}</Text>
              </View>
            ) : null}
            {weaknessProfile.leastTrained ? (
              <View style={styles.statRow}>
                <Text style={styles.statLabel}>Least Trained</Text>
                <Text style={styles.statValue}>{weaknessProfile.leastTrained.exerciseName}</Text>
              </View>
            ) : null}
          </GlassCard>
        ) : null}

        {longestSilenceDays !== null || dangerousOpponent ? (
          <GlassCard>
            <Text style={styles.sectionLabel}>Hunter's Notes</Text>
            {dangerousOpponent ? (
              <View style={styles.statRow}>
                <Text style={styles.statLabel}>Most Dangerous Opponent</Text>
                <Text style={styles.statValue}>{dangerousOpponent.monsterName}</Text>
              </View>
            ) : null}
            {longestSilenceDays !== null && longestSilenceDays > 0 ? (
              <View style={styles.statRow}>
                <Text style={styles.statLabel}>Longest Silence</Text>
                <Text style={styles.statValue}>{longestSilenceDays} days</Text>
              </View>
            ) : null}
          </GlassCard>
        ) : null}
        </>
        )}

        <Text style={styles.timelineLabel}>Timeline</Text>

        {!isLoading && groups.length === 0 ? (
          <Text style={styles.emptyText}>No hunts completed yet. Your history starts here.</Text>
        ) : null}

        {groups.map((group) => (
          <View key={group.label} style={styles.dayGroup}>
            <Text style={styles.dayLabel}>{group.label}</Text>
            {group.entries.map(({ result, wasPersonalRecord, wasFirstClear }) => {
              const monster = contentEngine.getMonster(result.monsterId);
              const workout = contentEngine.getWorkout(result.workoutId);
              const seconds = result.timeMinutes * 60 + result.timeSeconds;
              const rank = workout ? getHuntRank(seconds, workout.targetTimeSeconds, wasPersonalRecord) : 'C';
              // Bug #3: reads the already-saved WorkoutResult.rpe as-is —
              // null for any result recorded before RPE existed or where
              // the player skipped the prompt, and this renders nothing
              // extra in that case (no invented value, no placeholder).
              const rpeLabel = getRPELabel(result.rpe);
              // Reconstructed the same way getAllExerciseStats already
              // does for the lifetime aggregate above: workout.gearCount
              // (the canonical content), never a per-result override —
              // WorkoutResult doesn't persist a used-gearCount at all, so
              // this is the same established assumption already made
              // elsewhere, not a new one. Rounds, however, use this
              // result's own rungLaps.length when available (Task 3 —
              // an open-ended EMOM workout's real round count can differ
              // from workout.rounds, a reference value only for those).
              const exerciseBreakdown = workout
                ? getExerciseBreakdown(
                    workout,
                    result.rungLaps?.length ?? workout.rounds,
                    result.weightValueA,
                    workout.gearCount,
                    result.weightValueB
                  )
                : [];

              return (
                <GlassCard key={result.id} style={styles.entryCard}>
                  <View style={styles.entryHeader}>
                    <Text style={styles.entryMonster}>{monster?.name ?? 'Unknown'} defeated</Text>
                    <View style={styles.entryBadgeRow}>
                      {result.isCustomHunt ? (
                        <View style={styles.customBadge}>
                          <Text style={styles.customBadgeText}>Custom</Text>
                        </View>
                      ) : null}
                      <View style={[styles.rankBadge, { borderColor: RANK_COLORS[rank] }]}>
                        <Text style={[styles.rankText, { color: RANK_COLORS[rank] }]}>{rank}</Text>
                      </View>
                    </View>
                  </View>
                  <Text style={styles.entryDetail}>
                    {formatWeightPair(result.weightValueA, result.weightValueB, result.weightUnit)} ·{' '}
                    {result.timeMinutes}:{result.timeSeconds.toString().padStart(2, '0')}
                    {rpeLabel ? ` · Felt: ${rpeLabel}` : ''}
                  </Text>
                  {/* Task 10: old results have notes === null and simply
                      render nothing extra here — no placeholder text. */}
                  {result.notes ? <Text style={styles.entryNote}>"{result.notes}"</Text> : null}
                  {exerciseBreakdown.length > 0 ? (
                    <Text style={styles.entryNote}>
                      {exerciseBreakdown
                        .map((e) => {
                          const amount =
                            e.totalReps > 0 ? `${e.totalReps}` : `${e.totalDistanceFt} ft`;
                          return `${e.displayName ?? e.name} — ${amount} × ${formatWeightPair(
                            e.weightAKg,
                            e.weightBKg,
                            result.weightUnit
                          )}`;
                        })
                        .join('  ·  ')}
                    </Text>
                  ) : null}
                  {wasPersonalRecord ? (
                    <View style={styles.prRow}>
                      <Ionicons name="flame" size={12} color={colors.gold} />
                      <Text style={styles.prText}>Personal Record</Text>
                    </View>
                  ) : null}
                  {wasFirstClear ? (
                    <View style={styles.prRow}>
                      <Ionicons name="flag" size={12} color={colors.ember.base} />
                      <Text style={[styles.prText, { color: colors.ember.base }]}>First Clear</Text>
                    </View>
                  ) : null}
                </GlassCard>
              );
            })}
          </View>
        ))}

        {/*
          Journal integration (§9): "Training Sessions" — Custom Workout
          results, deliberately kept as a separate section rather than
          merged into the day-grouped Hunt timeline above. They're real
          training sessions (shown here), but NOT monster victories: no
          rank badge, no Personal Record/First Clear badge, no XP — this
          section never touches groups/getHuntRank/wasPersonalRecord, all
          of which are monster-hunt-only concepts (§10's "do not mix
          these three concepts"). A pre-migration12 result (workoutName
          null) still shows, just without the name/breakdown it never had.
        */}
        {customWorkoutResults.length > 0 ? (
          <>
            <Text style={styles.timelineLabel}>Training Sessions</Text>
            {customWorkoutResults.map((result) => (
              <GlassCard key={result.id} style={styles.entryCard}>
                <View style={styles.entryHeader}>
                  <Text style={styles.entryMonster}>{result.workoutName ?? 'Custom Workout'}</Text>
                </View>
                <Text style={styles.entryDetail}>
                  {new Date(result.completedAt).toLocaleDateString()} ·{' '}
                  {result.gearCount === 2
                    ? `${result.weightKg} + ${result.weightBKg ?? result.weightKg} kg`
                    : `${result.weightKg} kg`}{' '}
                  · {formatElapsed(result.elapsedSeconds)}
                  {result.rounds !== null ? ` · ${result.rounds} rounds` : ''}
                  {result.restSeconds !== null ? ` · ${result.restSeconds}s rest` : ''}
                  {result.totalReps !== null ? ` · ${result.totalReps} reps` : ''}
                </Text>
                {result.exerciseBreakdown && result.exerciseBreakdown.length > 0 ? (
                  <Text style={styles.entryNote}>
                    {result.exerciseBreakdown.map((e) => `${e.name} (${e.totalReps})`).join(' · ')}
                  </Text>
                ) : null}
              </GlassCard>
            ))}
          </>
        ) : null}

        {/*
          Stopwatch: its own section, same reasoning as Training Sessions
          directly above — a real training session, never a monster
          victory or a Custom Workout. No weight/reps/exercises at all,
          so its card is deliberately the plainest of the three entry
          types (time + laps + note only) — nothing here is inferred or
          borrowed from the Custom Workout shape above it.
        */}
        {stopwatchResults.length > 0 ? (
          <>
            <Text style={styles.timelineLabel}>Stopwatch Sessions</Text>
            {stopwatchResults.map((result) => (
              <GlassCard key={result.id} style={styles.entryCard}>
                <View style={styles.entryHeader}>
                  <Text style={styles.entryMonster}>Stopwatch</Text>
                </View>
                <Text style={styles.entryDetail}>
                  {new Date(result.completedAt).toLocaleDateString()} · {formatElapsed(result.elapsedSeconds)}
                  {result.laps.length > 0 ? ` · ${result.laps.length} laps` : ''}
                </Text>
                {result.note ? <Text style={styles.entryNote}>{result.note}</Text> : null}
              </GlassCard>
            ))}
          </>
        ) : null}
      </ScrollView>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: spacing.md,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
  sectionLabel: {
    fontFamily: fontFamily.displayRegular,
    fontSize: fontSize.xs,
    letterSpacing: 2,
    color: colors.text.muted,
    textTransform: 'uppercase',
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
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
  favoriteRow: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border.hairline,
  },
  favoriteLabel: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.base,
    color: colors.text.secondary,
  },
  favoriteValue: {
    fontFamily: fontFamily.monoBold,
    fontSize: fontSize.base,
    color: colors.gold,
  },
  periodRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  periodCard: {
    flex: 1,
    alignItems: 'center',
  },
  periodValue: {
    fontFamily: fontFamily.displayBold,
    fontSize: fontSize.xl,
    color: colors.gold,
    marginTop: spacing.xxs,
  },
  periodCaption: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.xs,
    color: colors.text.muted,
    textTransform: 'uppercase',
  },
  periodDetail: {
    fontFamily: fontFamily.monoRegular,
    fontSize: fontSize.xs,
    color: colors.text.secondary,
    marginTop: spacing.xxs,
  },
  weekdayRow: {
    flexDirection: 'row',
    marginTop: spacing.xs,
  },
  weekdayLabel: {
    flex: 1,
    textAlign: 'center',
    fontFamily: fontFamily.monoRegular,
    fontSize: fontSize.xs,
    color: colors.text.muted,
  },
  calendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: spacing.xxs,
  },
  calendarCell: {
    width: `${100 / 7}%`,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calendarCellTrained: {
    backgroundColor: colors.charcoal.raised,
    borderRadius: 999,
  },
  calendarCellToday: {
    borderWidth: 1,
    borderColor: colors.bronze.base,
    borderRadius: 999,
  },
  calendarDayText: {
    fontFamily: fontFamily.monoRegular,
    fontSize: fontSize.xs,
    color: colors.text.muted,
    // Bug #2, third pass. Both prior fixes only ever adjusted lineHeight,
    // which centers a glyph within its line box only as reliably as the
    // active font's own internal ascent/descent metrics allow — and the
    // one day that visibly failed on-device (today's date) is also
    // always a *trained* day whenever the user has logged something
    // that day, which is the ONLY case that switches this Text's font
    // from monoRegular to monoBold (see calendarDayTextTrained below).
    // Different weights of the same font family commonly ship with
    // slightly different internal metrics, so a lineHeight tuned by eye
    // against the regular weight doesn't necessarily hold for bold —
    // exactly the kind of two-steps-forward-one-back result the
    // previous comment here describes.
    // Fix: stop relying on lineHeight arithmetic entirely. `height`
    // fixes the box to an exact size regardless of font metrics, and
    // `textAlignVertical: 'center'` is Android's own native text
    // centering (distinct from lineHeight-based centering) — it
    // re-centers the glyph inside that box using the OS's own font
    // rendering, not JS-side line-box math, so it isn't thrown off by a
    // bold cut's different ascent/descent. No-op on iOS (where this
    // prop doesn't apply and lineHeight centering already holds), so
    // nothing to regress there.
    height: 20,
    lineHeight: 20,
    textAlignVertical: 'center',
    includeFontPadding: false,
    textAlign: 'center',
  },
  calendarDayTextTrained: {
    color: colors.ember.base,
    // Bug #2, fourth pass. All three prior fixes (lineHeight tuning,
    // then height + textAlignVertical + includeFontPadding) centered
    // this Text correctly *within its own box* — verified by rendering
    // a normal and a trained cell with nothing else different. The
    // actual remaining cause: `textAlignVertical: 'center'` on Android
    // centers using the ACTIVE font's own reported ascent/descent, and
    // JetBrainsMono_700Bold and JetBrainsMono_400Regular are two
    // separate font FILES (see theme/typography.ts) with their own
    // independently-hinted vertical metrics — swapping between them for
    // trained/untrained days means each is "perfectly centered"
    // according to a slightly different definition of center, which
    // shows up as the trained (bold-file) digit sitting a couple of
    // pixels lower. Fixed by never swapping the font FILE: `fontWeight`
    // instead of `fontFamily.monoBold` asks Android to synthesize bold
    // from the SAME regular file already centered correctly above,
    // so the metrics — and therefore the vertical position — never
    // change, only the stroke weight does. Still visually bold; still a
    // real fix, not another lineHeight guess.
    fontWeight: '700',
  },
  timelineLabel: {
    fontFamily: fontFamily.displayBold,
    fontSize: fontSize.lg,
    color: colors.text.primary,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  emptyText: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.base,
    color: colors.text.secondary,
    textAlign: 'center',
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.lg,
  },
  loadingText: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.sm,
    fontStyle: 'italic',
    color: colors.text.muted,
  },
  dayGroup: {
    gap: spacing.xs,
  },
  dayLabel: {
    fontFamily: fontFamily.displayRegular,
    fontSize: fontSize.xs,
    letterSpacing: 2,
    color: colors.bronze.base,
    textTransform: 'uppercase',
    marginBottom: spacing.xxs,
  },
  entryCard: {
    marginBottom: spacing.xs,
  },
  entryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  entryMonster: {
    fontFamily: fontFamily.displayBold,
    fontSize: fontSize.base,
    color: colors.text.primary,
    textTransform: 'uppercase',
  },
  entryBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
  },
  customBadge: {
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border.hairlineStrong,
  },
  customBadgeText: {
    fontFamily: fontFamily.monoRegular,
    fontSize: 10,
    color: colors.text.muted,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  rankBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankText: {
    fontFamily: fontFamily.displayBold,
    fontSize: fontSize.sm,
  },
  entryDetail: {
    fontFamily: fontFamily.monoRegular,
    fontSize: fontSize.sm,
    color: colors.text.muted,
    marginTop: spacing.xxs,
  },
  // Task 10: a personal training-journal line, styled like other
  // italic/muted flavor text in the app rather than a plain data field.
  entryNote: {
    fontFamily: fontFamily.bodyRegular,
    fontStyle: 'italic',
    fontSize: fontSize.sm,
    color: colors.text.secondary,
    marginTop: spacing.xxs,
  },
  prRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
    marginTop: spacing.xs,
  },
  prText: {
    fontFamily: fontFamily.monoBold,
    fontSize: fontSize.xs,
    color: colors.gold,
    textTransform: 'uppercase',
  },
});
