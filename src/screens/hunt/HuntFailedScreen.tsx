import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, Animated, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { HuntStackParamList } from '../../navigation/types';
import { Button, GlassCard, AppBackground } from '../../components/core';
import { contentEngine } from '../../../engines/content';
import { getMonsterPortrait } from '../../constants/monsterPortraits';
import { useStaggeredReveal } from '../../utils/useStaggeredReveal';
import { triggerHaptic } from '../../utils/haptics';
import { getAtmosphericColor } from '../../utils/bossPersonality';
import { colors, fontFamily, fontSize, spacing, glow } from '../../theme';

type Props = NativeStackScreenProps<HuntStackParamList, 'HuntFailed'>;

export function HuntFailedScreen({ route, navigation }: Props) {
  const { monsterId, huntId, workoutId, stoppedAtRound, reason, targetSeconds, elapsedSeconds, roundsCompleted, targetRounds } =
    route.params;
  const monster = contentEngine.getMonster(monsterId);
  const workout = contentEngine.getWorkout(workoutId);
  const isNotFaster = reason === 'not_faster';
  const isFewerRounds = reason === 'fewer_rounds';

  const formatMMSS = (totalSeconds: number) => {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const hasFiredHapticRef = useRef(false);
  useEffect(() => {
    if (!hasFiredHapticRef.current) {
      hasFiredHapticRef.current = true;
      triggerHaptic(Haptics.ImpactFeedbackStyle.Medium);
    }
  }, []);

  const returnToWorldMap = () => {
    const campaign = contentEngine.getCampaignForMonster(monsterId);
    navigation.reset({
      index: campaign ? 1 : 0,
      routes: campaign
        ? [{ name: 'Hunt' }, { name: 'WorldMap', params: { campaignId: campaign.id } }]
        : [{ name: 'Hunt' }],
    });
  };

  // Purely informational, per Sprint 16 — the exercises that were part of
  // this attempt, sourced directly from workout content, nothing inferred.
  const involvedExercises = (workout?.exercises ?? [])
    .map((exercise) => contentEngine.getExerciseLibraryEntryByName(exercise.name))
    .filter((entry): entry is NonNullable<typeof entry> => !!entry);

  // Emotional pacing (Sprint 18): the sting lands first, then the honest
  // diagnostic detail, then a path forward — instead of everything
  // appearing at once. Same shared beat mechanism as Victory.
  const revealStyle = useStaggeredReveal(3, 200);

  return (
    <AppBackground
      style={styles.container}
      atmosphericColor={getAtmosphericColor(monster?.personality, monster?.accentColor)}
    >
      <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Animated.View style={[styles.beat, revealStyle(0)]}>
        <View style={styles.badgeWrap}>
          <View style={[styles.badge, glow.md]}>
            {monster && getMonsterPortrait(monster.portraitAsset) ? (
              <>
                <Image
                  source={getMonsterPortrait(monster.portraitAsset)}
                  style={styles.badgeImage}
                  resizeMode="cover"
                />
                <View style={styles.badgeDefeatOverlay} pointerEvents="none" />
              </>
            ) : (
              <Ionicons name="skull" size={44} color={colors.blood} />
            )}
          </View>
          <View style={styles.badgeSkull}>
            <Ionicons name="skull" size={14} color={colors.text.primary} />
          </View>
        </View>

        <Text style={styles.title}>
          {isNotFaster ? 'Not Fast Enough' : isFewerRounds ? 'Fewer Rounds Than Last Time' : 'Hunt Failed'}
        </Text>
        <Text style={styles.subtitle}>
          {isNotFaster
            ? `${monster?.name ?? 'The boss'} fell, but not quickly enough`
            : isFewerRounds
            ? `${monster?.name ?? 'The boss'} outlasted you this time`
            : `${monster?.name ?? 'The boss'} was not defeated`}
        </Text>

        <GlassCard style={styles.infoCard}>
          {isNotFaster ? (
            <>
              <Text style={styles.infoLine}>
                {elapsedSeconds != null ? `Your time: ${formatMMSS(elapsedSeconds)}` : 'Encounter not beaten'}
              </Text>
              <Text style={styles.infoLine}>
                {targetSeconds != null ? `Needed to beat: ${formatMMSS(targetSeconds)}` : ''}
              </Text>
              <Text style={styles.infoLine}>This encounter does not count — try again</Text>
            </>
          ) : isFewerRounds ? (
            <>
              <Text style={styles.infoLine}>
                {roundsCompleted != null ? `Your rounds: ${roundsCompleted}` : 'Encounter not beaten'}
              </Text>
              <Text style={styles.infoLine}>
                {targetRounds != null ? `Needed to beat: ${targetRounds} rounds` : ''}
              </Text>
              <Text style={styles.infoLine}>This encounter does not count — try again</Text>
            </>
          ) : (
            <>
              <Text style={styles.infoLine}>No experience awarded</Text>
              <Text style={styles.infoLine}>This attempt was not saved</Text>
            </>
          )}
        </GlassCard>
        </Animated.View>

        <Animated.View style={[styles.beat, revealStyle(1)]}>
        {stoppedAtRound ? (
          <View style={styles.struggleCard}>
            <Ionicons name="flag" size={16} color={colors.blood} />
            <Text style={styles.struggleText}>
              You stopped during <Text style={styles.struggleName}>Round {stoppedAtRound}</Text>
            </Text>
          </View>
        ) : null}

        {involvedExercises.length > 0 ? (
          <GlassCard style={styles.exerciseCard}>
            <Text style={styles.sectionLabel}>Exercises Involved</Text>
            {involvedExercises.map((entry, index) => (
              <Pressable
                key={entry.id}
                onPress={() => navigation.navigate('ExerciseDetail', { exerciseId: entry.id })}
                style={({ pressed }) => [
                  styles.exerciseRow,
                  index === 0 && styles.exerciseRowFirst,
                  pressed && styles.rowPressed,
                ]}
              >
                <Text style={styles.exerciseName}>{entry.name}</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.steel} />
              </Pressable>
            ))}
          </GlassCard>
        ) : null}
        </Animated.View>

        <Animated.View style={[styles.beat, revealStyle(2)]}>
        <Button
          label="Retry Hunt"
          onPress={() => navigation.replace('ActiveHunt', { monsterId, huntId, workoutId })}
          style={styles.button}
        />
        <Button
          label="Return to Hunt"
          variant="secondary"
          onPress={returnToWorldMap}
          style={styles.button}
        />
        </Animated.View>
      </ScrollView>
      </SafeAreaView>
    </AppBackground>
  );
}

const BADGE_SIZE = 88;

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  beat: {
    width: '100%',
    alignItems: 'center',
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
    borderColor: colors.blood,
    backgroundColor: colors.void.surface,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  badgeImage: {
    width: '100%',
    height: '100%',
  },
  badgeDefeatOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(139, 0, 0, 0.35)',
  },
  badgeSkull: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.blood,
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
  infoCard: {
    width: '100%',
    alignItems: 'center',
    marginTop: spacing.xl,
    gap: spacing.xxs,
  },
  infoLine: {
    fontFamily: fontFamily.monoRegular,
    fontSize: fontSize.sm,
    color: colors.text.muted,
  },
  struggleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    width: '100%',
    marginTop: spacing.sm,
    backgroundColor: colors.void.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border.hairlineStrong,
    padding: spacing.sm,
  },
  struggleText: {
    flex: 1,
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.sm,
    color: colors.text.secondary,
  },
  struggleName: {
    fontFamily: fontFamily.bodySemiBold,
    color: colors.text.primary,
  },
  exerciseCard: {
    width: '100%',
    marginTop: spacing.sm,
  },
  sectionLabel: {
    fontFamily: fontFamily.displayRegular,
    fontSize: fontSize.xs,
    letterSpacing: 2,
    color: colors.text.muted,
    textTransform: 'uppercase',
    marginBottom: spacing.xs,
  },
  exerciseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.border.hairline,
  },
  exerciseRowFirst: {
    borderTopWidth: 0,
  },
  exerciseName: {
    fontFamily: fontFamily.bodySemiBold,
    fontSize: fontSize.base,
    color: colors.text.primary,
  },
  rowPressed: {
    opacity: 0.7,
  },
  button: {
    width: '100%',
    marginTop: spacing.md,
  },
});
