import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Image, Animated, BackHandler, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { HuntStackParamList } from '../../navigation/types';
import { Button, GlassCard, AppBackground, ConfirmDialog } from '../../components/core';
import { WorkoutStructure } from '../../components/workout/WorkoutStructure';
import { ProgressBar } from '../../components/progress';
import { TimerWidget } from '../../components/workout';
import { contentEngine } from '../../../engines/content';
import { useWorkoutSession } from '../../../engines/session/useWorkoutSession';
import type { RoundLap } from '../../../engines/session/useWorkoutSession';
import { useBattleEngine, phaseLabel } from '../../../engines/battle/useBattleEngine';
import { useAppStore } from '../../store';
import { getMonsterPortrait } from '../../constants/monsterPortraits';
import { scaleBattleConfigForCustomWorkout, buildCustomWorkout } from '../../utils/customWorkoutStructure';
import {
  isEncounterLocked,
  getEncounterLockState,
  isEncounterAttemptSuccessful,
  isEmomEncounterAttemptSuccessful,
  EncounterLockState,
} from '../../utils/encounterLock';
import { useConditionalKeepAwake } from '../../utils/useConditionalKeepAwake';
import { getCombatPersonality, getAtmosphericColor } from '../../utils/bossPersonality';
import { restFlavorFor } from '../../utils/huntAtmosphere';
import { getRoundStats } from '../../utils/roundStats';
import { groupWorkoutStructure } from '../../utils/workoutPresentation';
import { triggerHaptic } from '../../utils/haptics';
import { audioEngine } from '../../../engines/audio/AudioEngine';
import * as Haptics from 'expo-haptics';
import { Monster, Workout } from '../../models';
import { colors, fontFamily, fontSize, radii, spacing, glow } from '../../theme';

type Props = NativeStackScreenProps<HuntStackParamList, 'ActiveHunt'>;

function formatClock(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return { minutes, seconds };
}

/**
 * Chain + Complex workouts (The Risen, The Rite, ...) repeat the same
 * exercise several times as separate "Chain N/M" entries — content marks
 * this with a `(Chain N/M)` suffix on displayName (see e.g. iron-descent,
 * the-rite in workout.json). Parsed here purely for display grouping —
 * never used for routing/completion logic, and works for any workout
 * that uses this displayName convention, not just one monster by name.
 */
function chainPassNumber(displayName: string | undefined): number | null {
  const match = displayName?.match(/\(Chain (\d+)\/\d+\)/);
  return match ? parseInt(match[1], 10) : null;
}

function exerciseDisplayName(exercise: Workout['exercises'][number]): string {
  return (exercise.displayName ?? exercise.name)
    .replace(/\s*\((?:Chain \d+\/\d+|Complex\s*[×x]\s*\d+)\)\s*$/i, '')
    .trim();
}

function exerciseStepLabel(exercises: Workout['exercises'], index: number): string {
  const exercise = exercises[index];
  if (!exercise) return '';
  const chain = exercise.displayName?.match(/\(Chain (\d+)\/(\d+)\)/i);
  const complex = exercise.displayName?.match(/\(Complex\s*[×x]\s*(\d+)\)/i);
  const marker = chain ? `chain-${chain[1]}-${chain[2]}` : complex ? `complex-${complex[1]}` : null;
  let start = index;
  let end = index;
  if (marker) {
    while (start > 0) {
      const previous = exercises[start - 1].displayName ?? '';
      const previousMarker = previous.match(/\(Chain (\d+)\/(\d+)\)/i);
      const previousComplex = previous.match(/\(Complex\s*[×x]\s*(\d+)\)/i);
      const key = previousMarker ? `chain-${previousMarker[1]}-${previousMarker[2]}` : previousComplex ? `complex-${previousComplex[1]}` : null;
      if (key !== marker) break;
      start -= 1;
    }
    while (end < exercises.length - 1) {
      const next = exercises[end + 1].displayName ?? '';
      const nextMarker = next.match(/\(Chain (\d+)\/(\d+)\)/i);
      const nextComplex = next.match(/\(Complex\s*[×x]\s*(\d+)\)/i);
      const key = nextMarker ? `chain-${nextMarker[1]}-${nextMarker[2]}` : nextComplex ? `complex-${nextComplex[1]}` : null;
      if (key !== marker) break;
      end += 1;
    }
  } else {
    start = 0;
    end = exercises.length - 1;
  }
  const position = index - start + 1;
  const total = end - start + 1;
  return chain
    ? `Chain ${chain[1]} / ${chain[2]}  ·  Exercise ${position} / ${total}`
    : complex
      ? `Complex ${complex[1]}  ·  Exercise ${position} / ${total}`
      : `Exercise ${index + 1} / ${exercises.length}`;
}

const BONUS_LABELS: Record<string, string> = {
  perfect_execution: 'Perfect Execution',
  relentless_assault: 'Relentless Assault',
  personal_record: 'Personal Record',
  fast_finish: 'Fast Finish',
};

export function ActiveHuntScreen({ route, navigation }: Props) {
  const {
    monsterId,
    huntId,
    workoutId,
    weightKg,
    weightBKg,
    isCustomHunt,
    customGearCount,
    customRestSeconds,
    customWorkout,
    customStructuralValue,
    customRepsOverrides,
  } = route.params;
  const monster = contentEngine.getMonster(monsterId);
  const workout = contentEngine.getWorkout(workoutId);
  const hunt = contentEngine.getHunt(monsterId, huntId);
  const completeHunt = useAppStore((state) => state.completeHunt);
  const getBestTimeSeconds = useAppStore((state) => state.getBestTimeSeconds);
  const getResultsForHunt = useAppStore((state) => state.getResultsForHunt);
  const [isSaving, setIsSaving] = useState(false);
  const [previousBestSeconds, setPreviousBestSeconds] = useState<number | null>(null);

  useEffect(() => {
    getBestTimeSeconds(workoutId).then(setPreviousBestSeconds);
  }, [workoutId, getBestTimeSeconds]);

  // Encounter Lock (Custom Hunt merge): Encounter 1 (order === 1) is a
  // real choice — Canonical or Custom Hunt, exactly like before this
  // feature existed — so it has no lock state at all. Only order >= 2 is
  // locked, to the PREVIOUS encounter's own actual result (whichever
  // mode it used), fetched once up front so Finish Hunt can decide
  // success synchronously. See encounterLock.ts for the full derivation.
  const [lockState, setLockState] = useState<EncounterLockState>({
    targetSeconds: null,
    targetRounds: null,
    lockedConfig: null,
    isExact: true,
  });
  useEffect(() => {
    if (!monster || !hunt || !isEncounterLocked(hunt) || hunt.order === 1) {
      setLockState({ targetSeconds: null, targetRounds: null, lockedConfig: null, isExact: true });
      return;
    }
    const previousHunt = monster.hunts.find((h) => h.order === hunt.order - 1);
    const previousWorkout = previousHunt?.workoutId
      ? contentEngine.getWorkout(previousHunt.workoutId)
      : undefined;
    if (!previousHunt) {
      setLockState({ targetSeconds: null, targetRounds: null, lockedConfig: null, isExact: true });
      return;
    }
    getResultsForHunt(previousHunt.id).then((results) => {
      setLockState(getEncounterLockState(previousHunt, previousWorkout, results));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monster, hunt, getResultsForHunt]);

  // Bug #4 (real-device report): the bottom tab bar (Hunt/Timer/
  // Chronicle/Hunter/Forge) has no purpose mid-workout and was eating
  // vertical space the whole time. Hides only while this specific screen
  // is focused, via the standard React Navigation pattern of setting
  // options on the parent tab navigator — and restores it the moment
  // focus leaves (Quit -> HuntFailed, Finish -> HuntComplete both push a
  // new screen on top, which blurs this one and runs the cleanup below),
  // so HuntComplete/HuntFailed and every other tab keep the bar exactly
  // as before. No navigator structure changed, no other screen touched.
  useFocusEffect(
    useCallback(() => {
      const parentTabNavigator = navigation.getParent();
      parentTabNavigator?.setOptions({ tabBarStyle: { display: 'none' } });
      return () => parentTabNavigator?.setOptions({ tabBarStyle: undefined });
    }, [navigation])
  );

  if (!monster || !workout) {
    return (
      <AppBackground style={styles.container}>
        <SafeAreaView style={styles.safeArea} edges={['top']}>
          <View style={styles.missingState}>
            <Text style={styles.missingText}>This hunt is not yet available.</Text>
            <Button label="Go Back" onPress={() => navigation.goBack()} style={styles.missingButton} />
          </View>
        </SafeAreaView>
      </AppBackground>
    );
  }

  const isLocked = !!hunt && isEncounterLocked(hunt) && hunt.order > 1;
  const lockedConfig = isLocked ? lockState.lockedConfig : null;

  // Encounter Lock (Custom Hunt merge): order >= 2 uses ONLY the locked
  // config reconstructed from history above — every route param that
  // would otherwise carry a player choice (isCustomHunt, customGearCount,
  // customRestSeconds, customWorkout, customStructuralValue,
  // customRepsOverrides) is deliberately ignored here, since the UI
  // never offers them for a locked encounter to begin with (see
  // HuntOverviewScreen) — this is the actual enforcement point, not just
  // a UI nicety. Encounter 1 (or an unlocked Hunt) is completely
  // untouched from how Custom Hunt worked before this feature existed.
  const restSecondsOverride = lockedConfig
    ? lockedConfig.restSeconds
    : isCustomHunt
      ? customRestSeconds
      : hunt?.restSecondsOverride;

  // Task 2: when a structural control was changed, customWorkout is a
  // fully-built, self-consistent Workout (see buildCustomWorkout) —
  // useWorkoutSession/useBattleEngine below take it exactly as they'd
  // take the canonical one; neither engine is touched or aware this is
  // "custom." The battle config's hp is scaled the same proportion the
  // workout's own damage total scaled by, preserving this monster's
  // canonical hp/base-damage ratio (see scaleBattleConfigForCustomWorkout).
  // The canonical `workout`/`monster` objects looked up above are never
  // mutated — this only decides what gets passed down.
  // Encounter Lock: for order >= 2 with a locked CUSTOM configuration,
  // the exact same custom Workout is rebuilt from the locked
  // structuralValue/repsOverrides — never trusting route params' own
  // customWorkout (which reflects Hunt Overview's current UI state, not
  // necessarily this locked encounter's actual required shape).
  const effectiveCustomWorkout = lockedConfig
    ? lockedConfig.isCustomHunt && lockedConfig.structuralValue !== null
      ? buildCustomWorkout(workout, lockedConfig.structuralValue, lockedConfig.repsOverrides ?? undefined)
      : undefined
    : customWorkout;
  const effectiveWorkout = effectiveCustomWorkout ?? workout;
  const effectiveMonster = effectiveCustomWorkout
    ? {
        ...monster,
        battle: scaleBattleConfigForCustomWorkout(workout, effectiveCustomWorkout, monster.battle),
      }
    : monster;

  return (
    <ActiveHuntSession
      monster={effectiveMonster}
      workout={effectiveWorkout}
      restSecondsOverride={restSecondsOverride}
      previousBestSeconds={previousBestSeconds}
      targetSeconds={isLocked ? lockState.targetSeconds : null}
      targetRounds={isLocked ? lockState.targetRounds : null}
      isSaving={isSaving}
      onFinish={async (elapsedSeconds, battleStats, rungLaps) => {
        setIsSaving(true);
        try {
          // Encounter Lock: order>=2 must beat lockState.targetSeconds to
          // "count" at all. A slower attempt is never saved, never awards
          // XP, and never advances progress — it routes to the existing
          // no-save/no-XP/instant-retry HuntFailed screen (same handling
          // as quitting mid-hunt, different copy) instead of completeHunt.
          // Encounter 1 (or an unlocked Hunt) has no target and always
          // succeeds here, exactly as completion worked before this rule.
          if (hunt && isLocked) {
            const succeeded = workout.emomSeconds
              ? isEmomEncounterAttemptSuccessful(hunt, rungLaps?.length ?? 0, lockState.targetRounds)
              : isEncounterAttemptSuccessful(hunt, elapsedSeconds, lockState.targetSeconds);
            if (!succeeded) {
              navigation.replace('HuntFailed', {
                monsterId,
                huntId,
                workoutId,
                reason: workout.emomSeconds ? 'fewer_rounds' : 'not_faster',
                targetSeconds: lockState.targetSeconds ?? undefined,
                elapsedSeconds,
                roundsCompleted: rungLaps?.length,
                targetRounds: lockState.targetRounds ?? undefined,
              });
              return;
            }
          }
          const effectiveIsCustomHunt = lockedConfig ? lockedConfig.isCustomHunt : !!isCustomHunt;
          await completeHunt({
            monsterId,
            huntId,
            workoutId,
            elapsedSeconds,
            totalDamageDealt: battleStats.totalDamageDealt,
            criticalHits: battleStats.criticalHits,
            actualWeightKg: lockedConfig ? lockedConfig.weightKg : weightKg,
            // Kettlebell weight audit: the second bell's real weight,
            // whichever source is in effect — never assumed equal to
            // actualWeightKg. undefined (not e.g. weightKg) for a
            // single-bell attempt, so completeHunt's own gearCount-based
            // fallback (mirrors actualWeightKg only when gearCount is 2
            // but nothing else was supplied) is what actually applies.
            actualWeightBKg: lockedConfig ? (lockedConfig.weightBKg ?? undefined) : weightBKg,
            actualGearCount: lockedConfig
              ? lockedConfig.gearCount
              : isCustomHunt
                ? customGearCount
                : undefined,
            isCustomHunt: effectiveIsCustomHunt,
            rungLaps,
            customWorkout: effectiveCustomWorkout,
            // Encounter Lock (Custom Hunt merge): snapshot the EXACT
            // configuration this result used, whichever encounter this
            // is — for order>=2 that's the locked config reconstructed
            // above (so a successful Encounter 3 can, in turn, be
            // reconstructed exactly by any future replay logic); for
            // Encounter 1 it's whatever the player actually chose on
            // Hunt Overview. Every field is simply omitted (undefined)
            // for a canonical result — completeHunt already stores null
            // in that case, never needed for reconstruction.
            restSecondsUsed: effectiveIsCustomHunt
              ? lockedConfig
                ? lockedConfig.restSeconds
                : customRestSeconds
              : undefined,
            structuralValueUsed: effectiveIsCustomHunt
              ? lockedConfig
                ? (lockedConfig.structuralValue ?? undefined)
                : customStructuralValue
              : undefined,
            repsOverridesUsed: effectiveIsCustomHunt
              ? lockedConfig
                ? (lockedConfig.repsOverrides ?? undefined)
                : customRepsOverrides
              : undefined,
            encounterTargetSeconds: isLocked ? lockState.targetSeconds : undefined,
          });
          navigation.navigate('HuntComplete', { monsterId, huntId, workoutId });
        } finally {
          setIsSaving(false);
        }
      }}
      onQuit={(stoppedAtRound) => {
        navigation.replace('HuntFailed', {
          monsterId,
          huntId,
          workoutId,
          stoppedAtRound,
        });
      }}
    />
  );
}

interface ActiveHuntSessionProps {
  monster: Monster;
  workout: Workout;
  /**
   * Resolved by the caller: canonical Hunt.restSecondsOverride, or the
   * player's Custom Hunt rest value when running in Custom mode.
   * Undefined falls back to workout.restSeconds, same as before this was
   * wired up.
   */
  restSecondsOverride: number | undefined;
  previousBestSeconds: number | null;
  /**
   * Target-to-beat HUD chip: the exact same lockState.targetSeconds
   * ActiveHuntScreen already computes and relies on for pass/fail — null
   * whenever there's nothing to beat (Encounter 1, or the previous
   * encounter has no result yet), in which case the chip simply doesn't
   * render.
   */
  targetSeconds: number | null;
  targetRounds: number | null;
  isSaving: boolean;
  onFinish: (
    elapsedSeconds: number,
    battleStats: { totalDamageDealt: number; criticalHits: number },
    /** Sprint 23: per-rung lap times, only passed for `stepLabel: "Rung"` workouts. */
    rungLaps?: RoundLap[]
  ) => void;
  onQuit: (stoppedAtRound: number) => void;
}

function ActiveHuntSession({
  monster,
  workout,
  restSecondsOverride,
  previousBestSeconds,
  targetSeconds,
  targetRounds,
  isSaving,
  onFinish,
  onQuit,
}: ActiveHuntSessionProps) {
  const keepScreenAwake = useAppStore((state) => state.settings?.keepScreenAwake ?? false);
  useConditionalKeepAwake(keepScreenAwake);
  const [quitDialogVisible, setQuitDialogVisible] = useState(false);
  const [quitRound, setQuitRound] = useState(1);
  const requestQuit = useCallback((round: number) => {
    setQuitRound(round);
    setQuitDialogVisible(true);
  }, []);
  const confirmQuit = useCallback(() => {
    setQuitDialogVisible(false);
    onQuit(quitRound);
  }, [onQuit, quitRound]);

  const battle = useBattleEngine(monster.battle, workout);
  const personality = getCombatPersonality(monster.personality, monster.accentColor);

  const session = useWorkoutSession(workout, {
    onRoundComplete: (info) => {
      battle.dispatch({
        type: 'ROUND_COMPLETED',
        round: info.round,
        durationSeconds: info.durationSeconds,
        exercises: info.exercises,
      });
    },
    onWorkoutComplete: (info) => {
      battle.dispatch({
        type: 'WORKOUT_COMPLETED',
        elapsedSeconds: info.elapsedSeconds,
        previousBestSeconds,
      });
    },
  }, restSecondsOverride);

  // QA audit finding: `gestureEnabled: false` (set on this route in
  // HuntStack.tsx) only disables iOS's swipe-back gesture — confirmed
  // directly in @react-navigation/native-stack's own type declarations
  // ("Only supported on iOS. @platform ios"). Nothing was intercepting
  // Android's hardware/gesture back button, so it silently popped this
  // screen with no confirmation at all, bypassing the existing "Abandon
  // Hunt?" dialog entirely. Reuses that exact same dialog (via the
  // onQuit prop this component already receives) rather than inventing
  // a new one. While the phase is 'complete' (HP already at 0, waiting
  // on the visible "Finish Hunt" tap), the back press is swallowed
  // instead — abandoning here would silently discard an already-won,
  // not-yet-saved result, which is worse than requiring the existing
  // button; there's no destructive "Abandon" action that makes sense
  // once the fight is already over.
  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        if (session.phase === 'complete') {
          return true;
        }
        requestQuit(session.currentRound);
        return true;
      });
      return () => subscription.remove();
    }, [session.phase, session.currentRound, requestQuit])
  );

  const elapsedClock = formatClock(session.elapsedSeconds);
  const restClock = formatClock(session.restRemainingSeconds);
  const roundClock = formatClock(session.currentRoundElapsedSeconds);
  const emomClock = formatClock(session.emomRemainingSeconds ?? 0);
  const roundStats = getRoundStats(session.laps, session.restLaps);
  // Sprint 23: content-driven label swap ("Round" -> "Rung" for the
  // Minotaur ladder). Absent on every other workout, so this is exactly
  // 'Round' everywhere else, unchanged from before this field existed.
  const stepLabel = workout.stepLabel ?? 'Round';
  const isRungWorkout = workout.stepLabel === 'Rung';
  // Same per-round history array ladder workouts already populate — EMOM
  // workouts need it too (it's how completed-round progression, Task 3,
  // is measured), so it's captured the same way rather than adding a
  // second tracking path.
  const capturesRoundLaps = isRungWorkout || !!workout.emomSeconds;
  // Task 8 (dynamic exercise list density): purely structural, driven by
  // how many exercise rows the *current* round/section is actually about
  // to render — the exact thing that causes "excessive scrolling" for a
  // dense round like The Two-Faced's 10-item circuit or Atlas's 6-item
  // chain, vs. a normal 2-4 item round. No monster names involved, so
  // this scales automatically to any future workout with a big round.
  const currentRoundExerciseCount = (
    workout.sections?.[session.currentRound - 1]?.exercises ?? workout.exercises
  ).length;
  const currentRoundExercises = workout.sections?.[session.currentRound - 1]?.exercises ?? workout.exercises;
  const currentRoundStructure = groupWorkoutStructure(currentRoundExercises);
  const [activeSequencePosition, setActiveSequencePosition] = useState({ round: 1, index: 0 });
  const activeExerciseIndex = activeSequencePosition.round === session.currentRound ? activeSequencePosition.index : 0;
  const activeExercise = currentRoundExercises[activeExerciseIndex];
  const nextExercise = currentRoundExercises[activeExerciseIndex + 1];
  const exerciseListDensity: 'normal' | 'compact' | 'dense' =
    currentRoundExerciseCount >= 8 ? 'dense' : currentRoundExerciseCount >= 5 ? 'compact' : 'normal';
  const hpFraction = battle.maxHP > 0 ? battle.currentHP / battle.maxHP : 0;
  const wasCriticalHit = !!battle.lastDamage && battle.lastBonuses.length > 0;

  // --- Combat feedback: combo pulse (grows with streak, shatters on reset) ---
  const previousStreakRef = useRef(0);
  const comboAnim = useRef(new Animated.Value(0)).current;
  const [comboVisible, setComboVisible] = useState(false);
  const comboResetAnim = useRef(new Animated.Value(0)).current;
  const [comboResetVisible, setComboResetVisible] = useState(false);

  useEffect(() => {
    const previousStreak = previousStreakRef.current;
    if (battle.cleanStreak > previousStreak && battle.cleanStreak >= 2) {
      setComboVisible(true);
      comboAnim.setValue(0);
      Animated.sequence([
        Animated.spring(comboAnim, { toValue: 1, useNativeDriver: true, speed: 40, bounciness: 10 }),
        Animated.delay(650 * personality.animationPace),
        Animated.timing(comboAnim, { toValue: 0, duration: 300, useNativeDriver: true }),
      ]).start(() => setComboVisible(false));
    } else if (battle.cleanStreak === 0 && previousStreak >= 2) {
      // The streak broke — a quick "shatter" beat instead of just
      // silently vanishing, so losing a combo is felt, not just noticed.
      setComboResetVisible(true);
      comboResetAnim.setValue(1);
      Animated.timing(comboResetAnim, { toValue: 0, duration: 450, useNativeDriver: true }).start(() =>
        setComboResetVisible(false)
      );
    }
    previousStreakRef.current = battle.cleanStreak;
  }, [battle.cleanStreak, comboAnim, comboResetAnim]);

  // Growing glow: each additional clean streak scales the combo text up a
  // little further (capped), so a 6-streak visibly reads as bigger than a
  // 2-streak — same event, more presence.
  const comboScale = Math.min(1.4, 1 + Math.max(0, battle.cleanStreak - 2) * 0.06);

  // --- Combat feedback: damage/bonus pop + portrait shake on heavy hits ---
  const damageAnim = useRef(new Animated.Value(0)).current;
  const criticalAnim = useRef(new Animated.Value(0)).current;
  const bonusAnim = useRef(new Animated.Value(0)).current;
  const portraitShakeAnim = useRef(new Animated.Value(0)).current;
  const { animationPace, heavyHitThreshold, shakeDistance } = personality;
  useEffect(() => {
    if (!wasCriticalHit) return;
    criticalAnim.setValue(0);
    Animated.sequence([
      Animated.timing(criticalAnim, { toValue: 1, duration: 120, useNativeDriver: true }),
      Animated.delay(450 * animationPace),
      Animated.timing(criticalAnim, { toValue: 0, duration: 220, useNativeDriver: true }),
    ]).start();
  }, [battle.lastDamage, wasCriticalHit, animationPace, criticalAnim]);

  useEffect(() => {
    if (!battle.lastBonuses.length) return;
    bonusAnim.setValue(0);
    Animated.sequence([
      Animated.timing(bonusAnim, { toValue: 1, duration: 100, useNativeDriver: true }),
      Animated.delay(350 * animationPace),
      Animated.timing(bonusAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start();
  }, [battle.lastBonuses, animationPace, bonusAnim]);
  useEffect(() => {
    if (battle.lastDamage) {
      damageAnim.setValue(0);
      Animated.sequence([
        Animated.spring(damageAnim, { toValue: 1, useNativeDriver: true, speed: 50, bounciness: 8 }),
        Animated.delay(500 * animationPace),
        Animated.timing(damageAnim, { toValue: 0, duration: 400, useNativeDriver: true }),
      ]).start();

      const isHeavyHit = battle.lastDamage.amount / Math.max(1, battle.maxHP) >= heavyHitThreshold;
      if (isHeavyHit && shakeDistance > 0) {
        const pace = animationPace;
        portraitShakeAnim.setValue(0);
        Animated.sequence([
          Animated.timing(portraitShakeAnim, { toValue: 1, duration: 40 * pace, useNativeDriver: true }),
          Animated.timing(portraitShakeAnim, { toValue: -1, duration: 80 * pace, useNativeDriver: true }),
          Animated.timing(portraitShakeAnim, { toValue: 1, duration: 80 * pace, useNativeDriver: true }),
          Animated.timing(portraitShakeAnim, { toValue: 0, duration: 60 * pace, useNativeDriver: true }),
        ]).start();
      }

      if (wasCriticalHit) {
        triggerHaptic(Haptics.ImpactFeedbackStyle.Heavy);
      }
    }
    // personality is rebuilt with a new object reference on every render
    // (getCombatPersonality spreads a new object whenever the monster has
    // an accentColor, which all Campaign I monsters do) — depending on the
    // object itself re-ran this effect on every render, including the
    // once-per-second round/rest tick, restarting damageAnim before its
    // fade-out could ever finish and leaving the Critical Hit tag stuck
    // visible. Depending on the primitives actually used instead keeps
    // this effect tied only to real damage events, same as the phase-
    // banner and combo effects above already do.
  }, [battle.lastDamage, damageAnim, portraitShakeAnim, animationPace, heavyHitThreshold, shakeDistance, wasCriticalHit, battle.maxHP]);

  // --- HP feedback: flash on damage or phase change, pulse at low HP ---
  const hpFlashAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    hpFlashAnim.setValue(1);
    Animated.timing(hpFlashAnim, { toValue: 0, duration: 350, useNativeDriver: false }).start();
    // A phase change briefly interrupts the HP bar's own fill animation
    // with this flash, same as a damage hit — deliberately shared, not two
    // separate effects, so phase transitions read as part of the same
    // combat feedback language.
  }, [battle.lastDamage, battle.phaseIndex, hpFlashAnim]);

  const hpUrgency = hpFraction < 0.1 ? 'critical' : hpFraction < 0.3 ? 'low' : 'normal';
  const hpPulseAnim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (hpUrgency === 'normal') {
      hpPulseAnim.setValue(1);
      return;
    }
    const duration = hpUrgency === 'critical' ? 350 : 600;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(hpPulseAnim, { toValue: 0.5, duration, useNativeDriver: false }),
        Animated.timing(hpPulseAnim, { toValue: 1, duration, useNativeDriver: false }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [hpUrgency, hpPulseAnim]);

  // --- Sound: mirrors the existing Timer feature's sequencing exactly
  // (start/rest/countdown/countdownUrgent/nextRound/finish) — the Hunt
  // flow never had any sound at all before Sprint 18. No new assets. ---
  const hasPlayedStartRef = useRef(false);
  useEffect(() => {
    if (!hasPlayedStartRef.current) {
      hasPlayedStartRef.current = true;
      audioEngine.playSound('start');
      triggerHaptic(Haptics.ImpactFeedbackStyle.Light);
    }
  }, []);

  // Countdown ticks (Sprint 21's new pre-round-1 countdown) reuse the same
  // cues rest-countdown already uses — a countdown is a countdown.
  useEffect(() => {
    if (session.phase !== 'countdown' || session.status !== 'active') {
      return;
    }
    const remaining = session.countdownRemaining;
    if (remaining === 5) {
      audioEngine.playSound('countdown');
    } else if (remaining > 0 && remaining <= 3) {
      audioEngine.playSound('countdownUrgent');
    }
  }, [session.phase, session.countdownRemaining, session.status]);

  // The moment the countdown ends and Round 1 actually begins — reuses
  // 'nextRound' (the same "here we go" cue already used between rounds),
  // rather than adding a new asset for what is conceptually the same event.
  const previousSessionPhaseRef = useRef(session.phase);
  useEffect(() => {
    if (previousSessionPhaseRef.current === 'countdown' && session.phase === 'round') {
      audioEngine.playSound('nextRound');
    }
    previousSessionPhaseRef.current = session.phase;
  }, [session.phase]);

  const previousIsRestingRef = useRef(session.isResting);
  const restEntryRemainingRef = useRef<number | null>(null);
  useEffect(() => {
    if (session.isResting !== previousIsRestingRef.current) {
      audioEngine.playSound(session.isResting ? 'rest' : 'nextRound');
      previousIsRestingRef.current = session.isResting;
      // Remember the exact "just entered" remaining-seconds value so the
      // countdown-tick effect below never fires in the same instant as
      // this entry sound, even if a rest period happens to be exactly
      // 10s (or short enough to start inside the urgent window).
      restEntryRemainingRef.current = session.isResting ? session.restRemainingSeconds : null;
    }
  }, [session.isResting, session.restRemainingSeconds]);

  useEffect(() => {
    if (!session.isResting || session.status !== 'active') {
      return;
    }
    const remaining = session.restRemainingSeconds;
    if (remaining === restEntryRemainingRef.current) {
      return; // this tick is the rest-entry render itself, not an elapsed second
    }
    if (remaining === 10) {
      audioEngine.playSound('countdown');
    } else if (remaining > 0 && remaining <= 3) {
      audioEngine.playSound('countdownUrgent');
    }
  }, [session.isResting, session.restRemainingSeconds, session.status]);

  const hasPlayedFinishRef = useRef(false);
  const [showDefeatOverlay, setShowDefeatOverlay] = useState(false);
  const defeatBackdropAnim = useRef(new Animated.Value(0)).current;
  const defeatTextAnim = useRef(new Animated.Value(0.85)).current;
  useEffect(() => {
    if (session.isComplete && !hasPlayedFinishRef.current) {
      hasPlayedFinishRef.current = true;
      audioEngine.playSound('finish');
      triggerHaptic(Haptics.ImpactFeedbackStyle.Medium);
      // Task 5 (Monster Defeated moment): reuses this exact same
      // "fires once on completion" guard rather than adding a second
      // tracking ref — same trigger the finish sound/haptic already use.
      // Built entirely from the Animated technique already used
      // throughout this screen (Animated.Value + Animated.timing/spring,
      // no new animation library): backdrop fades in over the portrait,
      // "MONSTER DEFEATED" scales up from 0.85→1 and fades in, holds
      // briefly, then the whole overlay fades out on its own —
      // pointerEvents="none" throughout, so it never blocks or delays
      // the real "Finish Hunt" flow underneath; the player can proceed
      // immediately if they want to, the overlay is purely a moment, not
      // a gate.
      setShowDefeatOverlay(true);
      defeatBackdropAnim.setValue(0);
      defeatTextAnim.setValue(0.85);
      Animated.sequence([
        Animated.timing(defeatBackdropAnim, { toValue: 1, duration: 220, useNativeDriver: true }),
        Animated.spring(defeatTextAnim, { toValue: 1, useNativeDriver: true, speed: 14, bounciness: 6 }),
        Animated.delay(950),
        Animated.timing(defeatBackdropAnim, { toValue: 0, duration: 400, useNativeDriver: true }),
      ]).start(() => setShowDefeatOverlay(false));
    }
  }, [session.isComplete, defeatBackdropAnim, defeatTextAnim]);

  return (
    <AppBackground
      style={styles.container}
      atmosphericColor={getAtmosphericColor(monster.personality, monster.accentColor)}
    >
      <SafeAreaView style={styles.safeArea} edges={['top']}>
      {showDefeatOverlay ? (
        // The transient defeat title does not block the finishing controls.
        <Animated.View pointerEvents="none" style={[styles.defeatOverlay, { opacity: defeatBackdropAnim }]}>
          <Animated.Text
            style={[
              styles.defeatOverlayText,
              { color: personality.accentColor, transform: [{ scale: defeatTextAnim }] },
            ]}
          >
            Monster Defeated
          </Animated.Text>
        </Animated.View>
      ) : null}

      <ScrollView style={styles.scrollArea} contentContainerStyle={styles.content}>
        {/* Boss */}
        {/* Boss portrait and status. */}
        <View style={styles.portraitContainer}>
          <Animated.View
            style={[
              styles.portrait,
              glow.md,
              { borderColor: personality.accentColor },
              {
                transform: [
                  {
                    translateX: portraitShakeAnim.interpolate({
                      inputRange: [-1, 0, 1],
                      outputRange: [-personality.shakeDistance, 0, personality.shakeDistance],
                    }),
                  },
                ],
              },
            ]}
          >
            {getMonsterPortrait(monster.portraitAsset) ? (
              <Image
                source={getMonsterPortrait(monster.portraitAsset)}
                style={styles.portraitImage}
                resizeMode="cover"
              />
            ) : (
              <Text style={styles.portraitInitial}>{monster.name.charAt(0)}</Text>
            )}
          </Animated.View>

        </View>
        <View style={styles.monsterHeader}>
          <Text style={styles.monsterName} numberOfLines={2}>{monster.name}</Text>
          {battle.totalDamageDealt > 0 ? (
            <View style={styles.portraitStatusPill} pointerEvents="none">
              <Text style={[styles.portraitStatusText, { color: personality.accentColor }]} numberOfLines={1}>
                {phaseLabel(battle.phaseIndex).toUpperCase()}
              </Text>
            </View>
          ) : null}
        </View>
        <View style={styles.hpBarWrap}>
          <ProgressBar
            progress={hpFraction}
            fillColor={personality.hpBarColor}
            trackColor={colors.charcoal.raised}
            height={8}
            style={styles.hpBar}
          />
          <Animated.View
            pointerEvents="none"
            style={[styles.hpFlashOverlay, { opacity: hpFlashAnim, backgroundColor: personality.critColor }]}
          />
          {hpUrgency !== 'normal' ? (
            <Animated.View
              pointerEvents="none"
              style={[
                styles.hpUrgentGlow,
                {
                  opacity: hpPulseAnim.interpolate({ inputRange: [0.5, 1], outputRange: [0.55, 0] }),
                  borderColor: hpUrgency === 'critical' ? colors.blood : colors.ember.base,
                },
              ]}
            />
          ) : null}
        </View>
        {/* The phase word ("Wounded"/"Staggering") used to be appended
            here too ("X / Y HP · Wounded") — now shown once, on the
            portrait itself, instead of duplicated in this small line
            right underneath it. */}
        <Text style={styles.hpValue}>
          {Math.ceil(battle.currentHP)} / {battle.maxHP} HP
        </Text>

        {/* Target-to-beat HUD chip: `targetSeconds` is a prop, passed down
            from ActiveHuntScreen's already-computed lockState.targetSeconds
            (the exact same getEncounterLockState call HuntOverviewScreen's
            own "Time to beat" card uses, and the same value already relied
            on for pass/fail at Finish Hunt above this component) — no new
            calculation. null whenever that card wouldn't show one either
            (Encounter 1, or the previous encounter has no result yet), so
            this simply renders nothing then. Sits directly under HP/above
            the scrollable exercise content so it never competes with the
            portrait, the fixed-zone round timer, or the exercise list for
            space, and stays in place across exercise/round changes and
            rest, since it depends on none of that state. */}
        {workout.emomSeconds ? (
          targetRounds !== null ? (
            <View style={styles.targetChip}>
              <Ionicons name="flag" size={10} color={colors.ember.base} />
              <Text style={styles.targetChipLabel}>Target</Text>
              <Text style={styles.targetChipValue}>{`> ${targetRounds} rounds`}</Text>
            </View>
          ) : null
        ) : targetSeconds !== null ? (
          <View style={styles.targetChip}>
            <Ionicons name="flag" size={10} color={colors.ember.base} />
            <Text style={styles.targetChipLabel}>Target</Text>
            <Text style={styles.targetChipValue}>
              {'< '}
              {formatClock(targetSeconds).minutes}:
              {formatClock(targetSeconds).seconds.toString().padStart(2, '0')}
            </Text>
          </View>
        ) : null}

        {!session.isComplete ? (
          <View style={styles.feedbackAnchor} pointerEvents="none">
            <Animated.View
              style={[
                styles.damageFeedback,
                {
                  opacity: damageAnim,
                  transform: [
                    {
                      scale: damageAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0.88, wasCriticalHit ? 1.08 : 1],
                      }),
                    },
                  ],
                },
              ]}
            >
              {battle.lastDamage ? (
                <>
                  <Text style={[styles.damageText, wasCriticalHit && { color: personality.critColor }]}>
                    -{battle.lastDamage.amount}
                  </Text>
                  {battle.lastDamage.source === 'round' ? (
                    <Text style={styles.roundBonusLabel}>ROUND BONUS</Text>
                  ) : null}
                </>
              ) : null}
            </Animated.View>

            {wasCriticalHit ? (
              <Animated.Text
                style={[
                  styles.critTag,
                  { color: personality.critColor, opacity: criticalAnim },
                  {
                    transform: [
                      { scale: criticalAnim.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) },
                    ],
                  },
                ]}
              >
                CRITICAL HIT
              </Animated.Text>
            ) : null}

            {battle.lastBonuses.length ? (
              <Animated.View style={[styles.bonusRow, { opacity: bonusAnim }]}>
                {battle.lastBonuses.map((bonus) => (
                  <Text key={bonus.type} style={styles.bonusText}>
                    {BONUS_LABELS[bonus.type].toUpperCase()} +{bonus.amount}
                  </Text>
                ))}
              </Animated.View>
            ) : null}

            {comboVisible && !comboResetVisible ? (
              <Animated.Text
                style={[
                  styles.comboText,
                  {
                    opacity: comboAnim,
                    transform: [
                      {
                        scale: comboAnim.interpolate({
                          inputRange: [0, 1],
                        outputRange: [0.94, Math.min(1.05, comboScale)],
                        }),
                      },
                    ],
                  },
                ]}
              >
                COMBO x{battle.cleanStreak}
              </Animated.Text>
            ) : null}

            {comboResetVisible ? (
              <Animated.Text
                pointerEvents="none"
                style={[
                  styles.comboResetText,
                  {
                    opacity: comboResetAnim,
                    transform: [
                      {
                        scale: comboResetAnim.interpolate({ inputRange: [0, 1], outputRange: [1.3, 1] }),
                      },
                    ],
                  },
                ]}
              >
                COMBO BROKEN
              </Animated.Text>
            ) : null}
          </View>
        ) : null}

        {session.phase === 'complete' ? (
          <GlassCard style={styles.completeCard} glow="lg">
            <Text style={styles.completeTitle}>Workout Complete</Text>
            <Text style={styles.completeCaption}>
              {session.totalRounds} {stepLabel.toLowerCase()}s finished in {elapsedClock.minutes}:
              {elapsedClock.seconds.toString().padStart(2, '0')}
              {roundStats.fastestRoundSeconds !== null
                ? ` · Fastest ${stepLabel.toLowerCase()} ${formatClock(roundStats.fastestRoundSeconds).minutes}:${formatClock(
                    roundStats.fastestRoundSeconds
                  ).seconds.toString().padStart(2, '0')}`
                : ''}
            </Text>
          </GlassCard>
        ) : session.phase === 'countdown' ? (
          <GlassCard style={styles.exerciseCard} glow="md">
            <Text style={styles.sectionLabel}>Get Ready</Text>
            <Text style={styles.countdownNumber}>{session.countdownRemaining}</Text>
            <Text style={styles.roundLabel}>{stepLabel} 1 begins shortly</Text>
            {/* Task 9: kept visually secondary (small, muted, no card/glow
                of its own) so it doesn't compete with the countdown
                number above it — reuses Button's existing "secondary"
                variant, same component every other secondary action in
                this file already uses, just sized down via the style
                prop. skipCountdown mirrors startNextRoundEarly 1:1 (see
                useWorkoutSession) — nothing scoring-related to protect
                here since the countdown was never counted as elapsed
                time to begin with, skipped or not. */}
            <Button
              label="Skip"
              variant="secondary"
              onPress={session.skipCountdown}
              style={styles.skipCountdownButton}
            />
          </GlassCard>
        ) : (
          <>
            {/* Display-only cursor and compact grouped prescription for structured workouts. */}
            <GlassCard
              style={[
                styles.exerciseCard,
                exerciseListDensity === 'compact' && styles.exerciseCardCompact,
                exerciseListDensity === 'dense' && styles.exerciseCardDense,
              ]}
              glow="md"
            >
              {session.isResting ? (
                <>
                  <Text style={styles.sectionLabel}>Resting</Text>
                  <Text style={styles.exerciseName}>Recover</Text>
                  <Text style={styles.restFlavor}>
                    {restFlavorFor(`${workout.id}-${session.currentRound}`)}
                  </Text>
                  {roundStats.previousRoundSeconds !== null ? (
                    <Text style={styles.nextLabel}>
                      Previous {stepLabel.toLowerCase()}: {formatClock(roundStats.previousRoundSeconds).minutes}:
                      {formatClock(roundStats.previousRoundSeconds).seconds.toString().padStart(2, '0')}
                    </Text>
                  ) : null}
                </>
              ) : (
                <>
                  <Text style={styles.sectionLabel}>
                    {workout.sections?.[session.currentRound - 1]?.label ?? `This ${stepLabel}`}
                  </Text>
                  {currentRoundStructure.length ? (
                    <>
                      <View style={styles.activeExerciseFocus}>
                        <Text style={styles.activeExerciseLabel}>CURRENT EXERCISE</Text>
                        <Text style={styles.activeExerciseName} numberOfLines={2}>
                          {exerciseDisplayName(activeExercise)}
                        </Text>
                        <Text style={styles.activeExerciseProgress}>
                          {exerciseStepLabel(currentRoundExercises, activeExerciseIndex)}
                        </Text>
                        <View style={styles.nextExerciseRow}>
                          <Text style={styles.nextExerciseLabel}>NEXT</Text>
                          <Text style={styles.nextExerciseName} numberOfLines={1}>
                            {nextExercise ? exerciseDisplayName(nextExercise) : 'Complete the round'}
                          </Text>
                        </View>
                        {nextExercise ? (
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Mark ${exerciseDisplayName(activeExercise)} complete and show ${exerciseDisplayName(nextExercise)}`}
                            style={styles.nextExerciseButton}
                            onPress={() => setActiveSequencePosition({ round: session.currentRound, index: activeExerciseIndex + 1 })}
                          >
                            <Text style={styles.nextExerciseButtonText}>Next Exercise</Text>
                          </Pressable>
                        ) : null}
                      </View>
                      <WorkoutStructure groups={currentRoundStructure} compact />
                    </>
                  ) : currentRoundExercises.map(
                    (exercise) => {
                      const passNumber = chainPassNumber(exercise.displayName);
                      // Odd/even alternation by Chain pass number — a
                      // simple, subtle way to break up "Floor Deadlift
                      // (Chain 1/2)" / "Floor Deadlift (Chain 2/2)" reading
                      // as identical lines, without any new color and
                      // without tracking live per-exercise completion
                      // (this list has never tracked that — it's the
                      // round's prescription at a glance, not a checklist).
                      const isAlternatePass = passNumber !== null && passNumber % 2 === 0;
                      return (
                        <Text
                          key={exercise.id}
                          style={[
                            styles.roundExerciseLine,
                            exerciseListDensity === 'compact' && styles.roundExerciseLineCompact,
                            exerciseListDensity === 'dense' && styles.roundExerciseLineDense,
                            isAlternatePass && styles.roundExerciseLineChainAlt,
                          ]}
                        >
                          {exercise.targetReps
                            ? `${exercise.targetReps} × ${exercise.displayName ?? exercise.name}`
                            : exercise.targetDistanceFt
                            ? `${exercise.targetDistanceFt} ft ${exercise.displayName ?? exercise.name}`
                            : exercise.displayName ?? exercise.name}
                        </Text>
                      );
                    }
                  )}
                </>
              )}
              <Text
                style={[
                  styles.roundLabel,
                  exerciseListDensity === 'dense' && styles.roundLabelCompact,
                ]}
              >
                {workout.emomSeconds
                  ? `${stepLabel} ${session.currentRound}`
                  : `${stepLabel} ${session.currentRound} / ${session.totalRounds}`}{' '}
                · Total {elapsedClock.minutes}:
                {elapsedClock.seconds.toString().padStart(2, '0')}
              </Text>
            </GlassCard>
          </>
        )}
      </ScrollView>

      {/* Task 10 (Arachne / Active Hunt fixed controls): timer, Complete
          Round, Pause/Quit/Finish Hunt moved out of the ScrollView into a
          fixed zone below it. Previously all of this lived inside the
          same scrollable column as the exercise list — a long exercise
          list (Arachne) could push these controls below the fold,
          requiring a scroll to reach them mid-workout. The exercise
          list/portrait/HP bar above remain scrollable (variable height by
          design, fine to scroll); this bottom zone's own height is fixed
          content, not flex-grown, so it always sits at a stable position
          just above the safe-area bottom inset, regardless of device
          height or how long any given monster's exercise list is. No
          combat/timing/round logic changed — same components, same
          conditions, only their position in the tree moved. */}
      <View style={styles.fixedControls}>
        {session.phase !== 'complete' && session.phase !== 'countdown' ? (
          /* Real-device follow-up: the timer and the round button used to
             be two separate stacked rows (timer block, then a full-width
             button below it). Putting them in one row removes an entire
             row's worth of height from the fixed zone — the row's own
             height is governed by the 48dp button, and the timer chip
             (inline TimerWidget) just sits inside that same height next
             to it, rather than adding its own. No timing/session logic
             touched, same components, same conditions. */
          <View style={styles.timerActionRow}>
            {/* Real-device report (this sprint): Timer/Complete Round and
                Pause/Quit should read as one balanced 2x2 grid — same
                cell size in every position. The timer used to be a small
                inline chip sized to leave room for the button text next
                to it; now it's a full grid cell (gridCell prop) matching
                the button's own shape, and the button no longer needs
                its old reduced-padding "roundButtonTight" compensation
                since it has a real half-row of its own again. */}
            <View style={styles.actionButtonWrap}>
              {session.isResting ? (
                <TimerWidget
                  label="Rest"
                  minutes={restClock.minutes}
                  seconds={restClock.seconds}
                  isRunning={session.status === 'active'}
                  gridCell
                />
              ) : (
                <TimerWidget
                  label={workout.emomSeconds ? 'Window' : stepLabel}
                  minutes={workout.emomSeconds ? emomClock.minutes : roundClock.minutes}
                  seconds={workout.emomSeconds ? emomClock.seconds : roundClock.seconds}
                  isRunning={session.status === 'active'}
                  gridCell
                />
              )}
            </View>

            <View style={styles.actionButtonWrap}>
              {session.isResting ? (
                <Button
                  label={`Next ${stepLabel}`}
                  onPress={session.startNextRoundEarly}
                  disabled={session.status !== 'active'}
                  style={styles.actionButton}
                />
              ) : (
                <Button
                  label={`Complete ${stepLabel}`}
                  onPress={session.completeRound}
                  disabled={session.status !== 'active'}
                  style={styles.actionButton}
                />
              )}
            </View>
          </View>
        ) : null}

        {/* Bottom controls */}
        <View style={styles.actions}>
          {session.phase === 'complete' ? (
            <View style={styles.actionButtonWrap}>
              <Button
                label={isSaving ? 'Saving…' : 'Finish Hunt'}
                onPress={() =>
                  onFinish(
                    session.elapsedSeconds,
                    {
                      totalDamageDealt: battle.totalDamageDealt,
                      criticalHits: battle.criticalHitCount,
                    },
                    capturesRoundLaps ? session.laps : undefined
                  )
                }
                disabled={isSaving}
                style={styles.actionButton}
              />
            </View>
          ) : (
            <>
              <View style={styles.actionButtonWrap}>
                <Button
                  label={session.status === 'paused' ? 'Resume' : 'Pause'}
                  onPress={session.status === 'paused' ? session.resume : session.pause}
                  style={styles.actionButton}
                />
              </View>
              <View style={styles.actionButtonWrap}>
                <Button
                  label="Quit"
                  variant="destructive"
                  onPress={() => requestQuit(session.currentRound)}
                  style={styles.actionButton}
                />
              </View>
            </>
          )}
        </View>
      </View>
      </SafeAreaView>
      <ConfirmDialog
        visible={quitDialogVisible}
        title="Abandon Hunt?"
        message="The boss will be marked as undefeated. No experience will be awarded, and this attempt will not be saved."
        cancelLabel="Keep Fighting"
        confirmLabel="Abandon"
        onCancel={() => setQuitDialogVisible(false)}
        onConfirm={confirmQuit}
      />
    </AppBackground>
  );
}

const PORTRAIT_SIZE = 96;

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  fixedControls: {
    width: '100%',
    paddingHorizontal: spacing.lg,
    // Real-device report: the control block sat too close to the bottom
    // edge relative to the breathing room above the portrait (`content`'s
    // own padding: spacing.lg = 24). Matching that value here (was
    // spacing.md = 16) pushes the whole block up slightly without
    // touching any button's own size — layout-only.
    paddingBottom: spacing.lg,
    gap: spacing.xs,
  },
  scrollArea: {
    flex: 1,
  },
  content: {
    alignItems: 'center',
    padding: spacing.lg,
    gap: spacing.xs,
  },
  missingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  missingText: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.lg,
    color: colors.text.secondary,
    textAlign: 'center',
  },
  missingButton: {
    marginTop: spacing.md,
  },
  // A centered victory band that never blocks the finish controls.
  defeatOverlay: {
    position: 'absolute',
    top: '38%',
    left: spacing.lg,
    right: spacing.lg,
    zIndex: 20,
    alignItems: 'center',
  },
  defeatOverlayText: {
    fontFamily: fontFamily.displayBold,
    fontSize: fontSize.xl,
    textTransform: 'uppercase',
    letterSpacing: 3,
    textAlign: 'center',
    backgroundColor: 'rgba(10, 9, 8, 0.85)',
    borderWidth: 1,
    borderColor: colors.ember.glow,
    borderRadius: 12,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    overflow: 'hidden',
  },
  // Sprint 4: same footprint as `portrait` itself (not larger) so wrapping
  // it doesn't add any height to the boss column — the status pill below
  // is positioned absolutely and doesn't participate in layout flow.
  portraitContainer: {
    width: PORTRAIT_SIZE,
    height: PORTRAIT_SIZE,
    alignItems: 'center',
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
    overflow: 'hidden',
  },
  portraitImage: {
    width: '100%',
    height: '100%',
  },
  portraitInitial: {
    fontFamily: fontFamily.displayBold,
    fontSize: 36,
    color: colors.text.secondary,
  },
  portraitStatusPill: { alignSelf: 'center' },
  portraitStatusText: {
    fontFamily: fontFamily.displayBold,
    fontSize: 9,
    letterSpacing: 1,
    color: colors.text.primary,
    borderRadius: 8,
    paddingHorizontal: spacing.xxs,
    paddingVertical: 1,
    overflow: 'hidden',
  },
  monsterHeader: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    columnGap: spacing.xs,
    rowGap: 2,
  },
  monsterName: {
    fontFamily: fontFamily.displayBold,
    fontSize: fontSize.base,
    color: colors.text.primary,
    textTransform: 'uppercase',
    letterSpacing: 2,
    textAlign: 'center',
    flexShrink: 1,
  },
  hpBarWrap: {
    width: '100%',
    marginTop: spacing.xxs,
  },
  hpBar: {
    width: '100%',
  },
  hpFlashOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 4,
  },
  hpUrgentGlow: {
    position: 'absolute',
    top: -4,
    left: -4,
    right: -4,
    bottom: -4,
    borderRadius: 8,
    borderWidth: 2,
  },
  hpValue: {
    fontFamily: fontFamily.monoRegular,
    fontSize: fontSize.xs,
    color: colors.text.muted,
  },
  targetChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: spacing.xxs,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: `${colors.ember.base}55`,
    backgroundColor: 'rgba(10, 9, 8, 0.4)',
  },
  targetChipLabel: {
    fontFamily: fontFamily.monoBold,
    fontSize: 9,
    color: colors.ember.base,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  targetChipValue: {
    fontFamily: fontFamily.monoBold,
    fontSize: fontSize.xs,
    color: colors.text.primary,
  },
  feedbackAnchor: {
    height: 78,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  damageFeedback: {
    flexDirection: 'row',
    minHeight: 30,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  damageText: {
    fontFamily: fontFamily.displayBold,
    fontSize: fontSize.xl,
    color: colors.ember.base,
    letterSpacing: 1,
    lineHeight: 30,
  },
  roundBonusLabel: {
    fontFamily: fontFamily.monoBold,
    fontSize: 8,
    lineHeight: 10,
    color: colors.text.muted,
    letterSpacing: 1,
  },
  critTag: {
    fontFamily: fontFamily.monoBold,
    fontSize: 10,
    letterSpacing: 1.5,
    lineHeight: 13,
  },
  bonusRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    columnGap: spacing.xs,
    minHeight: 13,
  },
  bonusText: {
    fontFamily: fontFamily.monoBold,
    fontSize: 9,
    lineHeight: 12,
    color: colors.gold,
  },
  comboText: {
    fontFamily: fontFamily.displayBold,
    fontSize: fontSize.xs,
    color: colors.ember.glow,
    letterSpacing: 1,
    marginTop: 2,
    textAlign: 'center',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: `${colors.ember.base}66`,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 1,
    backgroundColor: colors.void.surface,
  },
  comboResetText: {
    fontFamily: fontFamily.monoBold,
    fontSize: fontSize.xs,
    color: colors.steel,
    letterSpacing: 2,
    marginTop: spacing.xxs,
    textAlign: 'center',
  },
  activeExerciseFocus: {
    width: '100%',
    alignItems: 'center',
    marginTop: spacing.xs,
    marginBottom: spacing.xs,
    paddingBottom: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.hairline,
  },
  activeExerciseName: {
    fontFamily: fontFamily.displayBold,
    fontSize: fontSize.xl,
    color: colors.text.primary,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  activeExerciseLabel: {
    fontFamily: fontFamily.monoBold,
    fontSize: 9,
    color: colors.text.muted,
    letterSpacing: 1.5,
    marginBottom: 2,
  },
  activeExerciseProgress: {
    fontFamily: fontFamily.monoBold,
    fontSize: fontSize.xs,
    color: colors.bronze.active,
    marginTop: 2,
    textAlign: 'center',
  },
  nextExerciseRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    marginTop: spacing.xxs,
  },
  nextExerciseLabel: {
    fontFamily: fontFamily.monoBold,
    fontSize: 9,
    color: colors.text.muted,
    letterSpacing: 1,
  },
  nextExerciseName: {
    flexShrink: 1,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: fontSize.sm,
    color: colors.text.secondary,
  },
  nextExerciseButton: {
    minHeight: 36,
    minWidth: 130,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xxs,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: `${colors.bronze.base}66`,
    backgroundColor: colors.void.surface,
  },
  nextExerciseButtonText: {
    fontFamily: fontFamily.monoBold,
    fontSize: fontSize.xs,
    color: colors.bronze.active,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  completeCard: {
    width: '100%',
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  completeTitle: {
    fontFamily: fontFamily.displayBold,
    fontSize: fontSize.xl,
    color: colors.gold,
    textTransform: 'uppercase',
    letterSpacing: 2,
  },
  completeCaption: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.base,
    color: colors.text.secondary,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  exerciseCard: {
    width: '100%',
    alignItems: 'center',
    marginTop: spacing.sm,
    paddingVertical: spacing.lg,
  },
  // Task 8 (dynamic exercise list density): only paddingVertical shrinks
  // here — the card's width/marginTop/border/glow are untouched, so this
  // never looks like a different component, just a tighter one.
  exerciseCardCompact: {
    paddingVertical: spacing.md,
  },
  exerciseCardDense: {
    paddingVertical: spacing.sm,
  },
  sectionLabel: {
    fontFamily: fontFamily.displayRegular,
    fontSize: fontSize.xs,
    letterSpacing: 2,
    color: colors.text.muted,
    textTransform: 'uppercase',
  },
  exerciseName: {
    fontFamily: fontFamily.displayBold,
    fontSize: fontSize.display,
    color: colors.text.primary,
    textTransform: 'uppercase',
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  countdownNumber: {
    fontFamily: fontFamily.displayBold,
    fontSize: 64,
    color: colors.gold,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  // Task 9: deliberately small/secondary — a plain Button "secondary"
  // variant, just sized down (reduced padding/minHeight) so it reads as
  // a quiet option next to the countdown, not a second primary action.
  skipCountdownButton: {
    marginTop: spacing.md,
    minHeight: 36,
    paddingVertical: spacing.xxs,
    paddingHorizontal: spacing.lg,
  },
  restFlavor: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.sm,
    fontStyle: 'italic',
    // Real-device report: recommendation/instruction text ("Steady your
    // breath") should read as slightly warmer than plain historical data
    // ("Previous rung: ...", nextLabel below) — using the app's own
    // existing accent tone (bronze, already the primary highlight color
    // throughout this screen) rather than introducing any new color.
    color: colors.bronze.base,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  roundExerciseLine: {
    fontFamily: fontFamily.displayBold,
    fontSize: fontSize.xl,
    color: colors.text.primary,
    textTransform: 'uppercase',
    textAlign: 'center',
    marginTop: spacing.xxs,
  },
  // Task 8: two steps down from fontSize.xl (28) — still comfortably
  // readable, just not fighting for space against 5-7 siblings.
  roundExerciseLineCompact: {
    fontSize: fontSize.lg,
    marginTop: 2,
  },
  // For 8+ rows (e.g. The Two-Faced's 10-item round) — one step further
  // down again, matching the button label's own fontSize.base so it
  // never reads smaller than the app's own UI text.
  roundExerciseLineDense: {
    fontSize: fontSize.base,
    marginTop: 1,
  },
  // Chain + Complex readability fix: alternate Chain passes (Chain 2/2,
  // 4/4, ...) drop to text.secondary instead of text.primary — same font,
  // same size, just one shade quieter, so consecutive repeats of the same
  // exercise name read as distinct lines instead of identical ones.
  roundExerciseLineChainAlt: {
    color: colors.text.secondary,
  },
  roundLabel: {
    fontFamily: fontFamily.monoRegular,
    fontSize: fontSize.sm,
    color: colors.bronze.base,
    marginTop: spacing.md,
  },
  // Task 8: secondary metadata gets a smaller top-margin in the dense
  // tier too, matching "more compact secondary metadata" — font size
  // itself stays the same (it's already small/secondary at fontSize.sm).
  roundLabelCompact: {
    marginTop: spacing.sm,
  },
  nextLabel: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.sm,
    color: colors.text.muted,
    marginTop: spacing.xxs,
  },
  // Timer + round button share one row now (see the real-device follow-up
  // comment at the call site) — this replaces the old separate
  // TimerWidget row and completeRoundButton row.
  timerActionRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  // Bug #1 fix: Pause/Quit were stacked full-width (2 × 48px buttons +
  // gap), the single biggest contributor to the fixed-controls zone's
  // height. Placing them side by side halves that without shrinking
  // either button below the existing 48px min touch target — Finish Hunt
  // still renders correctly full-width here since flex: 1 on a lone
  // child in a row still fills the row. No behavior/logic touched.
  // Bug #3 fix (real-device report): Button.tsx only forwards its `style`
  // prop to its inner Animated.View, not to the outer Pressable — so
  // `flex: 1` set directly on a Button never actually grows the button
  // inside a row (the un-styled Pressable stays content-sized, the
  // flex:1 one level too deep has nothing to act on). That's why Finish
  // Hunt rendered short/left-aligned instead of centered, and Pause/Quit
  // weren't reliably splitting the row either. Wrapping each Button in
  // its own flex: 1 View gives the row a properly-sizing child (the
  // wrapper), and that wrapper's default column stretch behavior fills
  // its Pressable to match — Button.tsx itself is untouched, so every
  // other Button usage in the app (Victory RPE picker, Settings, etc.)
  // is unaffected.
  actions: {
    // marginTop removed: fixedControls' own `gap` already spaces this row
    // from the one above it (timerActionRow, or nothing when phase is
    // 'complete'/'countdown') — the two together were double-spacing.
    width: '100%',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  actionButtonWrap: {
    flex: 1,
  },
  actionButton: {
    width: '100%',
  },
});
