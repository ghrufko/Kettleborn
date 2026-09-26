import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Image, Pressable, TextInput } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { HuntStackParamList } from '../../navigation/types';
import { Header, Button, GlassCard, AppBackground } from '../../components/core';
import { WorkoutStructure } from '../../components/workout/WorkoutStructure';
import { contentEngine } from '../../../engines/content';
import { getMonsterPortrait } from '../../constants/monsterPortraits';
import { getStructuralControlConfig, StructuralControlConfig, buildCustomWorkout, getRepsCustomizableTemplate } from '../../utils/customWorkoutStructure';
import { getCombatPersonality, getAtmosphericColor } from '../../utils/bossPersonality';
import {
  isEncounterLocked,
  getEncounterLockState,
  EncounterConfig,
  EncounterLockState,
} from '../../utils/encounterLock';
import { useAppStore } from '../../store';
import { flavorTextFor } from '../../utils/flavorText';
import { groupWorkoutStructure } from '../../utils/workoutPresentation';
import { WorkoutResult, CustomHuntPreset } from '../../models';
import { convertKgToDisplay, convertDisplayToKg, formatWeightPair } from '../../utils/weight';
import { colors, fontFamily, fontSize, radii, spacing } from '../../theme';

type Props = NativeStackScreenProps<HuntStackParamList, 'HuntOverview'>;

// Sane upper bound for a single kettlebell's weight — generous enough for
// any real gear, just enough to catch stray typos before they reach XP/
// Volume math.
const MAX_WEIGHT_KG = 60;
const MIN_WEIGHT_KG = 0.5;
const WEIGHT_STEP_KG = 1;
const REST_STEP_SECONDS = 5;
const MIN_REST_SECONDS = 15;

function formatBestTime(seconds: number | null): string {
  if (seconds === null) {
    return '—';
  }
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

function formatRestSeconds(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

// Task 4 (Personal Best weight): same weight-display convention already
// used for "Recent Hunt" on HunterScreen — reused here rather than
// inventing a new format. Uses the result's own weightUnit (what it was
// actually saved in), matching that existing convention too.
function formatResultWeight(result: WorkoutResult): string {
  return formatWeightPair(result.weightValueA, result.weightValueB, result.weightUnit);
}

// Custom Hunt: same two-button "mode chip" visual pattern as
// TimerBuilderScreen's local MiniToggle — kept local here rather than
// promoted to a shared component, matching how TimerBuilderScreen's own
// copy is also screen-local (no existing shared MiniToggle/Stepper to
// import from src/components).
function MiniToggle({ label, value, onToggle }: { label: string; value: boolean; onToggle: () => void }) {
  return (
    <Pressable onPress={onToggle} style={[styles.miniToggle, value && styles.miniToggleActive]}>
      <Text style={[styles.miniToggleText, value && styles.miniToggleTextActive]}>{label}</Text>
    </Pressable>
  );
}

// Custom Hunt: same +/- stepper visual pattern as TimerBuilderScreen's
// local Stepper, adapted for rest seconds (mm:ss display, 5s steps —
// 15s was too coarse: several encounters' canonical restSecondsOverride
// values (e.g. 50s, 40s, 25s) aren't multiples of 15, so a 15s step could
// never land back on them cleanly).
function RestStepper({ value, onChange }: { value: number; onChange: (next: number) => void }) {
  return (
    <View style={styles.restStepperRow}>
      <Pressable
        onPress={() => onChange(Math.max(MIN_REST_SECONDS, value - REST_STEP_SECONDS))}
        style={styles.restStepperButton}
        hitSlop={8}
      >
        <Ionicons name="remove" size={16} color={colors.bronze.base} />
      </Pressable>
      <Text style={styles.restStepperValue}>{formatRestSeconds(value)}</Text>
      <Pressable
        onPress={() => onChange(value + REST_STEP_SECONDS)}
        style={styles.restStepperButton}
        hitSlop={8}
      >
        <Ionicons name="add" size={16} color={colors.bronze.base} />
      </Pressable>
    </View>
  );
}

// Task 2: a plain integer +/- stepper (no mm:ss formatting), reused for
// whichever structural control applies — Rounds / Max Rung / Cycles.
// Same visual pattern as RestStepper, just a bare number.
function IntStepper({
  value,
  min,
  max,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
}) {
  return (
    <View style={styles.restStepperRow}>
      <Pressable onPress={() => onChange(Math.max(min, value - 1))} style={styles.restStepperButton} hitSlop={8}>
        <Ionicons name="remove" size={16} color={colors.bronze.base} />
      </Pressable>
      <Text style={styles.restStepperValue}>{value}</Text>
      <Pressable onPress={() => onChange(Math.min(max, value + 1))} style={styles.restStepperButton} hitSlop={8}>
        <Ionicons name="add" size={16} color={colors.bronze.base} />
      </Pressable>
    </View>
  );
}

// Weight selector relocation: same compact +/- stepper chrome as
// RestStepper/IntStepper above (visual consistency with the rest of
// Training Mode, per the brief's "preserve the current visual style"),
// adapted for a decimal kettlebell weight instead of an integer. Reused
// for both Kettlebell 1 and Kettlebell 2 — the two cells are otherwise
// fully independent (16kg + 18kg is a real, valid combination, never
// forced equal). `editable={false}` renders the same visual chrome as a
// plain value for a progression-locked encounter, where weight isn't a
// choice at all.
function WeightStepper({
  value,
  onChangeText,
  onAdjust,
  unit,
  invalid,
  editable = true,
}: {
  value: string;
  onChangeText?: (next: string) => void;
  onAdjust?: (delta: number) => void;
  unit: string;
  invalid?: boolean;
  editable?: boolean;
}) {
  if (!editable) {
    return <Text style={styles.lockedWeightValue}>{value} {unit}</Text>;
  }
  return (
    <View style={styles.weightStepper}>
      <Pressable
        onPress={() => onAdjust?.(-WEIGHT_STEP_KG)}
        hitSlop={8}
        style={({ pressed }) => [styles.weightStepButton, pressed && styles.weightStepButtonPressed]}
      >
        <Ionicons name="remove" size={16} color={colors.text.primary} />
      </Pressable>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        keyboardType="decimal-pad"
        style={[styles.weightInputCompact, invalid && styles.weightInputError]}
      />
      <Pressable
        onPress={() => onAdjust?.(WEIGHT_STEP_KG)}
        hitSlop={8}
        style={({ pressed }) => [styles.weightStepButton, pressed && styles.weightStepButtonPressed]}
      >
        <Ionicons name="add" size={16} color={colors.text.primary} />
      </Pressable>
      <Text style={styles.weightUnit}>{unit}</Text>
    </View>
  );
}

export function HuntOverviewScreen({ route, navigation }: Props) {
  const { monsterId, huntId } = route.params;
  const hunt = contentEngine.getHunt(monsterId, huntId);
  const monster = contentEngine.getMonster(monsterId);
  const workout = hunt?.workoutId ? contentEngine.getWorkout(hunt.workoutId) : undefined;
  const getBestResult = useAppStore((state) => state.getBestResult);
  const getCustomHuntPreset = useAppStore((state) => state.getCustomHuntPreset);
  const saveCustomHuntPreset = useAppStore((state) => state.saveCustomHuntPreset);
  const getResultsForHunt = useAppStore((state) => state.getResultsForHunt);
  const unitPreference = useAppStore((state) => state.settings?.unitPreference ?? 'kg');
  const [personalBestResult, setPersonalBestResult] = useState<WorkoutResult | null>(null);
  const [weightInput, setWeightInput] = useState('');
  // Kettlebell weight audit: the second bell's own weight — genuinely
  // independent from weightInput (16kg + 18kg is valid, never assumed
  // equal). Only ever read/shown when the effective gear count is 2 —
  // see showSecondWeightCell below.
  const [weightBInput, setWeightBInput] = useState('');
  // Encounter Lock (Custom Hunt merge): Encounter 1 is a real choice —
  // Canonical or Custom Hunt, full existing functionality — so it is
  // NEVER progression-locked. Only order >= 2 is: every parameter locked
  // to whichever exact configuration the encounter right before it
  // actually used (reconstructed from history — see encounterLock.ts),
  // not offered as a choice at all.
  const isProgressionLocked = !!hunt && isEncounterLocked(hunt) && hunt.order > 1;
  const [lockState, setLockState] = useState<EncounterLockState>({
    targetSeconds: null,
    targetRounds: null,
    lockedConfig: null,
    isExact: true,
  });
  useEffect(() => {
    if (!monster || !hunt || !isProgressionLocked) {
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
  }, [monster, hunt, isProgressionLocked, getResultsForHunt]);
  const lockedConfig: EncounterConfig | null = isProgressionLocked ? lockState.lockedConfig : null;
  // Canonical is always the default selection on open, for every
  // encounter. A saved Custom Hunt preset for this workoutId (if any)
  // still preloads its values below, so switching to Custom Hunt shows
  // the player's last setup — it just no longer auto-selects Custom Hunt
  // on load. Only applies to Encounter 1 — a progression-locked
  // encounter (below) shows whichever mode was actually used, never the
  // live preset.
  const [isCustomMode, setIsCustomMode] = useState(false);
  const [gearCount, setGearCount] = useState<1 | 2>(2);
  const [restSeconds, setRestSeconds] = useState(45);
  // Task 2: content-driven — null for a workout with no safe structural
  // parameter (e.g. Weaver, Ifrit's main+finisher shape), in which case
  // no control renders at all and this state is simply unused.
  const structuralControl: StructuralControlConfig | null = workout ? getStructuralControlConfig(workout) : null;
  const [structuralValue, setStructuralValue] = useState<number>(structuralControl?.canonical ?? 0);
  // Task (reps per exercise): null for anything that isn't a flat
  // workout — see getRepsCustomizableTemplate's own comment for why this
  // is deliberately not offered for ladder/sectioned workouts.
  const repsTemplate = workout ? getRepsCustomizableTemplate(workout) : null;
  const [repsOverrides, setRepsOverrides] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!workout) {
      return;
    }
    getBestResult(workout.id).then(setPersonalBestResult);
    // Encounter Lock (Custom Hunt merge): a progression-locked encounter
    // (order >= 2) shows whichever exact configuration the previous
    // encounter actually used — reconstructed history, never the live
    // CustomHuntPreset. While lockState is still loading (lockedConfig
    // null but isProgressionLocked true), fields are simply left as they
    // are; Begin Hunt is disabled until it resolves (see below).
    if (isProgressionLocked) {
      if (!lockedConfig) {
        return;
      }
      setIsCustomMode(lockedConfig.isCustomHunt);
      setWeightInput(String(convertKgToDisplay(lockedConfig.weightKg, unitPreference)));
      setWeightBInput(
        lockedConfig.weightBKg !== null ? String(convertKgToDisplay(lockedConfig.weightBKg, unitPreference)) : ''
      );
      setGearCount(lockedConfig.gearCount);
      setRestSeconds(lockedConfig.restSeconds);
      setStructuralValue(lockedConfig.structuralValue ?? structuralControl?.canonical ?? 0);
      setRepsOverrides(lockedConfig.repsOverrides ?? {});
      return;
    }
    getCustomHuntPreset(workout.id).then((preset: CustomHuntPreset | null) => {
      if (preset) {
        // Preset values are preloaded (so switching to Custom Hunt shows
        // the player's last setup), but Canonical is always the default
        // selection on open — no longer auto-flips to Custom just
        // because a preset exists.
        setWeightInput(String(convertKgToDisplay(preset.weightKg, unitPreference)));
        // Kettlebell weight audit: a preset saved before weightBKg existed
        // reads back as undefined/null here — falls back to mirroring the
        // first bell's weight, the exact value this field would already
        // have shown before this feature existed.
        setWeightBInput(
          String(convertKgToDisplay(preset.weightBKg ?? preset.weightKg, unitPreference))
        );
        setGearCount(preset.gearCount);
        setRestSeconds(preset.restSeconds);
        setStructuralValue(preset.customStructureValue ?? structuralControl?.canonical ?? 0);
        setRepsOverrides(preset.repsOverrides ?? {});
      } else {
        setWeightInput(String(convertKgToDisplay(workout.gearWeightKg, unitPreference)));
        setWeightBInput(String(convertKgToDisplay(workout.gearWeightKg, unitPreference)));
        setGearCount(workout.gearCount);
        setRestSeconds(hunt?.restSecondsOverride ?? workout.restSeconds);
        setStructuralValue(structuralControl?.canonical ?? 0);
        setRepsOverrides({});
      }
      setIsCustomMode(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workout, getBestResult, getCustomHuntPreset, unitPreference, isProgressionLocked, lockedConfig]);

  if (!hunt || !workout || !monster) {
    return (
      <AppBackground style={styles.container}>
        <Header title="Not Found" onBack={() => navigation.goBack()} />
        <View style={styles.missingState}>
          <Text style={styles.missingText}>This hunt is not yet available.</Text>
        </View>
      </AppBackground>
    );
  }

  const portraitSource = getMonsterPortrait(monster.portraitAsset);
  // weightInput is in the player's display unit (kg or lb); parsedWeightKg
  // is that same value converted back to kg — the only form stored/
  // validated/passed onward, so XP/Volume/data format are unaffected.
  const parsedDisplayWeight = Number(weightInput.replace(',', '.'));
  const parsedWeightKg = convertDisplayToKg(parsedDisplayWeight, unitPreference);
  const isWeightValid = Number.isFinite(parsedWeightKg) && parsedWeightKg > 0 && parsedWeightKg <= MAX_WEIGHT_KG;

  // Kettlebell weight audit: same parse/validate shape as the first bell,
  // for the second. Weight selector relocation: which effective gear
  // count is currently in play decides 1 vs 2 cells — Encounter 1
  // Canonical always follows the workout's own content (gearCount isn't
  // a player choice there), Encounter 1 Custom follows whatever the
  // player has picked with the Kettlebells toggle, and a
  // progression-locked Encounter 2/3 follows whatever the locked
  // configuration actually used. Determined from workout/mode structure
  // only — never hardcoded per monster, per the brief.
  const parsedDisplayWeightB = Number(weightBInput.replace(',', '.'));
  const parsedWeightBKg = convertDisplayToKg(parsedDisplayWeightB, unitPreference);
  const effectiveGearCount: 1 | 2 = isProgressionLocked
    ? lockedConfig?.gearCount ?? 1
    : isCustomMode
      ? gearCount
      : workout.gearCount;
  const showSecondWeightCell = effectiveGearCount === 2;
  const isWeightBValid =
    !showSecondWeightCell ||
    (Number.isFinite(parsedWeightBKg) && parsedWeightBKg > 0 && parsedWeightBKg <= MAX_WEIGHT_KG);

  // Sprint 25: nudge by a fixed step from the current value — never snaps to
  // a grid, so a manually-typed arbitrary weight (e.g. 22.5) stays exact
  // after a tap; only the tapped ±1kg is applied. Falls back to the
  // workout's recommended weight if the field is currently empty/invalid.
  // The step itself always happens in kg (unchanged granularity); only the
  // displayed result is converted to the player's unit.
  const adjustWeight = (delta: number) => {
    const base = Number.isFinite(parsedWeightKg) ? parsedWeightKg : workout.gearWeightKg;
    const nextKg = Math.min(MAX_WEIGHT_KG, Math.max(MIN_WEIGHT_KG, Math.round((base + delta) * 100) / 100));
    setWeightInput(String(convertKgToDisplay(nextKg, unitPreference)));
  };
  const adjustWeightB = (delta: number) => {
    const base = Number.isFinite(parsedWeightBKg) ? parsedWeightBKg : workout.gearWeightKg;
    const nextKg = Math.min(MAX_WEIGHT_KG, Math.max(MIN_WEIGHT_KG, Math.round((base + delta) * 100) / 100));
    setWeightBInput(String(convertKgToDisplay(nextKg, unitPreference)));
  };

  // Custom Hunt: switching TO Custom seeds gearCount/rest from canonical
  // as a starting point the player can then adjust (weightInput is left
  // as whatever's currently in the field — usually still the canonical
  // recommendation at this point, since no preset existed yet). Switching
  // BACK to Canonical resets weight to the canonical recommendation,
  // exactly like this screen behaved before Custom Hunt existed — nothing
  // is deleted from storage by switching modes, only Begin Hunt persists.
  const enterCustomMode = () => {
    setIsCustomMode(true);
  };
  const enterCanonicalMode = () => {
    setIsCustomMode(false);
    setWeightInput(String(convertKgToDisplay(workout.gearWeightKg, unitPreference)));
    setWeightBInput(String(convertKgToDisplay(workout.gearWeightKg, unitPreference)));
    // Task 2: structural value resets to canonical too, same "nothing is
    // deleted from storage, only Begin Hunt persists" rule as weight.
    setStructuralValue(structuralControl?.canonical ?? 0);
    setRepsOverrides({});
  };

  const beginHunt = async () => {
    // Encounter Lock (Custom Hunt merge): bypass any choice entirely —
    // always exactly the reconstructed locked config, never persist/read
    // a preset for this Hunt. customStructuralValue/customRepsOverrides
    // are passed through for completeness, but ActiveHuntScreen
    // independently re-derives the same lock state for order>=2 and
    // ignores these regardless — see that screen's own comment.
    if (isProgressionLocked && lockedConfig) {
      navigation.navigate('ActiveHunt', {
        monsterId,
        huntId,
        workoutId: workout.id,
        weightKg: lockedConfig.weightKg,
        weightBKg: lockedConfig.weightBKg ?? undefined,
        isCustomHunt: lockedConfig.isCustomHunt,
        customGearCount: lockedConfig.isCustomHunt ? lockedConfig.gearCount : undefined,
        customRestSeconds: lockedConfig.isCustomHunt ? lockedConfig.restSeconds : undefined,
        customStructuralValue: lockedConfig.structuralValue ?? undefined,
        customRepsOverrides: lockedConfig.repsOverrides ?? undefined,
        customWorkout: undefined,
      });
      return;
    }
    if (isCustomMode) {
      // Persisted here (not on every keystroke/tap) — matches the
      // existing project convention of saving on an explicit confirm
      // action rather than on every intermediate UI change (see
      // TimerBuilderScreen's explicit Save, not autosave-per-edit).
      await saveCustomHuntPreset({
        workoutId: workout.id,
        weightKg: parsedWeightKg,
        weightBKg: gearCount === 2 ? parsedWeightBKg : undefined,
        gearCount,
        restSeconds,
        customStructureValue: structuralControl ? structuralValue : undefined,
        repsOverrides: repsTemplate ? repsOverrides : undefined,
      });
    }
    const hasStructuralChange = !!structuralControl && structuralValue !== structuralControl.canonical;
    const hasRepsChange = !!repsTemplate && Object.keys(repsOverrides).length > 0;
    // repsTemplate is only ever non-null for 'flat' workouts, and a flat
    // workout always has a structuralControl too — so whenever
    // hasRepsChange is true, structuralValue is already a valid,
    // correctly-seeded round count (canonical unless also customized).
    const customWorkout =
      isCustomMode && (hasStructuralChange || hasRepsChange)
        ? buildCustomWorkout(workout, structuralValue, repsOverrides)
        : undefined;
    navigation.navigate('ActiveHunt', {
      monsterId,
      huntId,
      workoutId: workout.id,
      weightKg: parsedWeightKg,
      weightBKg: showSecondWeightCell ? parsedWeightBKg : undefined,
      isCustomHunt: isCustomMode,
      customGearCount: isCustomMode ? gearCount : undefined,
      customRestSeconds: isCustomMode ? restSeconds : undefined,
      customWorkout,
      customStructuralValue: isCustomMode && structuralControl ? structuralValue : undefined,
      customRepsOverrides: isCustomMode && repsTemplate && Object.keys(repsOverrides).length > 0 ? repsOverrides : undefined,
    });
  };

  // Polish pass, fix 2 (exercise list density): originally gated on
  // `stepLabel === 'Rung'` (only the Minotaur's ladder), but the same
  // "every section is actually the same exercises repeated" shape exists
  // on other workouts under different labels — e.g. mirror-trial's 10
  // alternating Left/Right rounds, unbroken-cycle's 10 Left/Right rounds
  // — which rendered as 10-20 near-duplicate groups with no collapsing at
  // all. Generalized to any workout whose `sections` all contain the
  // exact same exercise names in the same order, regardless of
  // `stepLabel` — content-driven, no monster names involved, so it scales
  // to any future workout with this repeating shape. A workout whose
  // sections genuinely differ (Behemoth's 3 phases, the Tactical Trial's
  // 5 distinct rounds) never matches this and renders exactly as before.
  const sectionExerciseNameShape = (exercises: { name: string }[]) => exercises.map((e) => e.name).join('|');
  const isRepeatingStructure =
    !!workout.sections &&
    workout.sections.length > 1 &&
    workout.sections.every(
      (section) => sectionExerciseNameShape(section.exercises) === sectionExerciseNameShape(workout.sections![0].exercises)
    );
  const repeatingStructurePreview = isRepeatingStructure
    ? (() => {
        const byName = new Map<string, { id: string; name: string; reps: number[] }>();
        for (const section of workout.sections!) {
          for (const exercise of section.exercises) {
            const entry = byName.get(exercise.name) ?? { id: exercise.id, name: exercise.name, reps: [] };
            if (exercise.targetReps) {
              entry.reps.push(exercise.targetReps);
            }
            byName.set(exercise.name, entry);
          }
        }
        return Array.from(byName.values());
      })()
    : [];
  const repeatingStructureUnitLabel = `${(workout.stepLabel ?? 'Round').toLowerCase()}s`;
  const previewGroups = workout.sections ?? [{ label: null, exercises: workout.exercises }];
  const structuredExercises = isRepeatingStructure ? workout.sections![0].exercises : workout.exercises;
  const workoutStructure = groupWorkoutStructure(structuredExercises);
  const hasWorkoutStructure = workoutStructure.length > 0;
  // Polish pass, fix 2 (exercise list density): same shape as
  // ActiveHuntScreen's in-combat `exerciseListDensity` (Task 8) — purely
  // a row count, no monster names — applied here to the PRE-FIGHT preview
  // list instead of the current in-combat round, since that's a separate
  // render with its own separate "too long, too much scrolling" failure
  // mode (a workout with several genuinely-distinct sections, e.g. the
  // Tactical Trial's 5 different rounds, which the repeating-structure
  // collapse above correctly leaves alone since they aren't duplicates).
  const totalPreviewRows = isRepeatingStructure
    ? repeatingStructurePreview.length
    : previewGroups.reduce((sum, group) => sum + group.exercises.length, 0);
  const exercisePreviewDensity: 'normal' | 'compact' | 'dense' =
    totalPreviewRows >= 16 ? 'dense' : totalPreviewRows >= 9 ? 'compact' : 'normal';

  return (
    <AppBackground
      style={styles.container}
      atmosphericColor={getAtmosphericColor(monster.personality, monster.accentColor)}
    >
      <Header title={hunt.name} onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.briefHeader}>
          <View style={styles.portrait}>
            {portraitSource ? (
              <Image source={portraitSource} style={styles.portraitImage} resizeMode="cover" />
            ) : (
              <Text style={styles.portraitInitial}>{monster.name.charAt(0)}</Text>
            )}
          </View>
          <Text style={styles.monsterName}>{monster.name}</Text>
          <Text style={styles.personalityLabel}>
            {getCombatPersonality(monster.personality).label}
          </Text>
          <Text style={styles.description}>{workout.description ?? monster.description}</Text>
          <Text style={styles.flavor}>{flavorTextFor(hunt.id)}</Text>
          <View style={styles.focusRow}>
            {workout.focus.map((tag) => (
              <View key={tag} style={styles.focusTag}>
                <Text style={styles.focusTagText}>{tag}</Text>
              </View>
            ))}
          </View>
        </View>

        <GlassCard style={styles.section}>
          <Text style={styles.sectionLabel}>Workout</Text>
          {hasWorkoutStructure ? (
            <View style={styles.exerciseList}>
              <WorkoutStructure
                groups={workoutStructure}
                onExercisePress={(exerciseName) => {
                  const libraryEntry = contentEngine.getExerciseLibraryEntryByName(exerciseName);
                  if (libraryEntry) navigation.navigate('ExerciseDetail', { exerciseId: libraryEntry.id });
                }}
              />
              {isRepeatingStructure ? (
                <Text style={styles.exerciseGroupLabel}>
                  {workout.sections!.length} {repeatingStructureUnitLabel}
                </Text>
              ) : null}
            </View>
          ) : isRepeatingStructure ? (
            <View style={styles.exerciseList}>
              {repeatingStructurePreview.map((exercise, index) => {
                const libraryEntry = contentEngine.getExerciseLibraryEntryByName(exercise.name);
                const low = exercise.reps.length ? Math.min(...exercise.reps) : null;
                const high = exercise.reps.length ? Math.max(...exercise.reps) : null;
                return (
                  <Pressable
                    key={exercise.id}
                    disabled={!libraryEntry}
                    onPress={() =>
                      libraryEntry &&
                      navigation.navigate('ExerciseDetail', { exerciseId: libraryEntry.id })
                    }
                    style={({ pressed }) => [
                      styles.exerciseRow,
                      exercisePreviewDensity === 'compact' && styles.exerciseRowCompact,
                      exercisePreviewDensity === 'dense' && styles.exerciseRowDense,
                      pressed && styles.exerciseRowPressed,
                    ]}
                  >
                    <Text
                      style={[
                        styles.exerciseIndex,
                        exercisePreviewDensity !== 'normal' && styles.exerciseIndexCompact,
                      ]}
                    >
                      {index + 1}
                    </Text>
                    <Text
                      style={[
                        styles.exerciseName,
                        exercisePreviewDensity !== 'normal' && styles.exerciseNameCompact,
                      ]}
                    >
                      {exercise.name}
                    </Text>
                    <Text
                      style={[
                        styles.exerciseTarget,
                        exercisePreviewDensity !== 'normal' && styles.exerciseTargetCompact,
                      ]}
                    >
                      {low !== null && high !== null ? (low === high ? `${low}` : `${low}–${high}`) : ''}
                    </Text>
                    {libraryEntry ? (
                      <Ionicons name="information-circle-outline" size={16} color={colors.text.muted} />
                    ) : null}
                  </Pressable>
                );
              })}
              <Text style={styles.exerciseGroupLabel}>
                {workout.sections!.length} {repeatingStructureUnitLabel}
              </Text>
            </View>
          ) : (
            previewGroups.map((group, groupIndex) => (
              <View key={group.label ?? 'main'} style={groupIndex > 0 ? styles.exerciseGroupSpacing : undefined}>
                {group.label ? <Text style={styles.exerciseGroupLabel}>{group.label}</Text> : null}
                <View style={styles.exerciseList}>
                  {group.exercises.map((exercise, index) => {
                    const libraryEntry = contentEngine.getExerciseLibraryEntryByName(exercise.name);
                    return (
                      <Pressable
                        key={exercise.id}
                        disabled={!libraryEntry}
                        onPress={() =>
                          libraryEntry &&
                          navigation.navigate('ExerciseDetail', { exerciseId: libraryEntry.id })
                        }
                        style={({ pressed }) => [
                          styles.exerciseRow,
                          exercisePreviewDensity === 'compact' && styles.exerciseRowCompact,
                          exercisePreviewDensity === 'dense' && styles.exerciseRowDense,
                          pressed && styles.exerciseRowPressed,
                        ]}
                      >
                        <Text
                          style={[
                            styles.exerciseIndex,
                            exercisePreviewDensity !== 'normal' && styles.exerciseIndexCompact,
                          ]}
                        >
                          {index + 1}
                        </Text>
                        <Text
                          style={[
                            styles.exerciseName,
                            exercisePreviewDensity !== 'normal' && styles.exerciseNameCompact,
                          ]}
                        >
                          {exercise.displayName ?? exercise.name}
                        </Text>
                        <Text
                          style={[
                            styles.exerciseTarget,
                            exercisePreviewDensity !== 'normal' && styles.exerciseTargetCompact,
                          ]}
                        >
                          {exercise.targetReps
                            ? exercise.targetReps
                            : exercise.targetDistanceFt
                            ? `${exercise.targetDistanceFt} ft`
                            : ''}
                        </Text>
                        {libraryEntry ? (
                          <Ionicons name="information-circle-outline" size={16} color={colors.text.muted} />
                        ) : null}
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ))
          )}

          <View style={styles.finisherRow}>
            <Ionicons name="flash" size={16} color={colors.ember.base} />
            <Text style={styles.finisherName}>{workout.finisher.name}</Text>
            <Text style={styles.finisherScheme}>{workout.finisher.scheme}</Text>
          </View>
        </GlassCard>

        <GlassCard style={styles.section}>
          {isProgressionLocked ? (
            <>
              <View style={styles.modeHeaderRow}>
                <Text style={styles.sectionLabel}>Beat Your Record</Text>
                <View style={styles.lockedPill}>
                  <Ionicons name="lock-closed" size={12} color={colors.text.muted} />
                  <Text style={styles.lockedPillText}>Locked</Text>
                </View>
              </View>
              {!lockedConfig ? (
                <Text style={styles.modeHint}>Loading your locked configuration…</Text>
              ) : (
                <>
                  <Text style={styles.modeHint}>
                    Configuration is locked to exactly what you used on your last successful Encounter —{' '}
                    {lockedConfig.isCustomHunt ? 'a Custom Hunt setup' : 'the canonical workout'}. This
                    Encounter only counts if you beat the time below — a slower clear doesn't save and
                    doesn't advance.
                  </Text>
                  {!lockState.isExact ? (
                    <Text style={styles.legacyHint}>
                      Your earlier result predates full configuration tracking, so rest/structure/reps
                      couldn't be recovered exactly — defaulted to canonical here as a best-effort fallback.
                    </Text>
                  ) : null}
                  <View style={styles.customRow}>
                    <Text style={styles.customRowLabel}>{showSecondWeightCell ? 'Kettlebell 1' : 'Weight'}</Text>
                    <WeightStepper
                      value={
                        lockedConfig
                          ? `${convertKgToDisplay(lockedConfig.weightKg, unitPreference)}`
                          : '—'
                      }
                      unit={unitPreference}
                      editable={false}
                    />
                  </View>
                  {showSecondWeightCell ? (
                    <View style={styles.customRow}>
                      <Text style={styles.customRowLabel}>Kettlebell 2</Text>
                      <WeightStepper
                        value={
                          lockedConfig?.weightBKg !== null && lockedConfig?.weightBKg !== undefined
                            ? `${convertKgToDisplay(lockedConfig.weightBKg, unitPreference)}`
                            : '—'
                        }
                        unit={unitPreference}
                        editable={false}
                      />
                    </View>
                  ) : null}
                  <Text style={styles.modeHint}>
                    Locked parameters: {formatRestSeconds(lockedConfig.restSeconds)} rest
                    {lockedConfig.structuralValue !== null
                      ? `, ${structuralControl?.label ?? 'structure'} ${lockedConfig.structuralValue}`
                      : ''}
                    .
                  </Text>
                  <View style={styles.targetCard}>
                    <Ionicons name="flag" size={16} color={colors.ember.base} />
                    <Text style={styles.targetText}>
                      {workout.emomSeconds ? 'Rounds to beat: ' : 'Time to beat: '}
                      <Text style={styles.targetTime}>
                        {workout.emomSeconds
                          ? lockState.targetRounds !== null
                            ? `${lockState.targetRounds}`
                            : '—'
                          : lockState.targetSeconds !== null
                          ? formatBestTime(lockState.targetSeconds)
                          : '—'}
                      </Text>
                    </Text>
                  </View>
                </>
              )}
            </>
          ) : (
            <>
              <View style={styles.modeHeaderRow}>
                <Text style={styles.sectionLabel}>Training Mode</Text>
                <View style={styles.modeToggleRow}>
                  <MiniToggle label="Canonical" value={!isCustomMode} onToggle={enterCanonicalMode} />
                  <MiniToggle label="Custom Hunt" value={isCustomMode} onToggle={enterCustomMode} />
                </View>
              </View>
              {hunt.order === 1 ? (
                <Text style={styles.baselineHint}>
                  Whichever you pick, your first successful clear becomes the baseline Encounter 2 has to beat.
                </Text>
              ) : null}
              {isCustomMode ? (
                <>
                  <Text style={styles.modeHint}>
                    Use your own equipment — the Monster and exercises stay the same, only how you perform
                    it changes. Saved for {monster.name}'s other Levels too.
                  </Text>
                  <View style={styles.customRow}>
                    <Text style={styles.customRowLabel}>Kettlebells</Text>
                    <View style={styles.modeToggleRow}>
                      <MiniToggle label="1" value={gearCount === 1} onToggle={() => setGearCount(1)} />
                      <MiniToggle label="2" value={gearCount === 2} onToggle={() => setGearCount(2)} />
                    </View>
                  </View>
                  <View style={styles.customRow}>
                    <Text style={styles.customRowLabel}>{gearCount === 2 ? 'Kettlebell 1' : 'Weight'}</Text>
                    <WeightStepper
                      value={weightInput}
                      onChangeText={setWeightInput}
                      onAdjust={adjustWeight}
                      unit={unitPreference}
                      invalid={!isWeightValid}
                    />
                  </View>
                  {gearCount === 2 ? (
                    <View style={styles.customRow}>
                      <Text style={styles.customRowLabel}>Kettlebell 2</Text>
                      <WeightStepper
                        value={weightBInput}
                        onChangeText={setWeightBInput}
                        onAdjust={adjustWeightB}
                        unit={unitPreference}
                        invalid={!isWeightBValid}
                      />
                    </View>
                  ) : null}
                  {!isWeightValid || !isWeightBValid ? (
                    <Text style={styles.weightErrorText}>
                      Enter a weight between {convertKgToDisplay(MIN_WEIGHT_KG, unitPreference)} and{' '}
                      {convertKgToDisplay(MAX_WEIGHT_KG, unitPreference)} {unitPreference}.
                    </Text>
                  ) : null}
                  <View style={styles.customRow}>
                    <Text style={styles.customRowLabel}>Rest Between Rounds</Text>
                    <RestStepper value={restSeconds} onChange={setRestSeconds} />
                  </View>
                  {/* Task 2: only rendered when this workout's own structure
                      has a safe adjustable parameter — a fixed-sectioned
                      workout (e.g. Weaver, Ifrit) shows nothing extra here,
                      exactly per "do not invent fake configurability." */}
                  {structuralControl ? (
                    <View style={styles.customRow}>
                      <Text style={styles.customRowLabel}>{structuralControl.label}</Text>
                      <IntStepper
                        value={structuralValue}
                        min={structuralControl.min}
                        max={structuralControl.max}
                        onChange={setStructuralValue}
                      />
                    </View>
                  ) : null}
                  {/* Task (reps per exercise): one stepper per exercise that
                      actually has a rep count — a duration-based exercise
                      like a carry has no "reps" to override, so it's simply
                      not shown here, matching the same "no fake
                      configurability" rule as the structural control above. */}
                  {repsTemplate ? (
                    <>
                      <Text style={styles.customRowLabel}>Reps</Text>
                      {repsTemplate
                        .filter((exercise) => !!exercise.targetReps)
                        .map((exercise) => {
                          const canonicalReps = exercise.targetReps!;
                          const currentReps = repsOverrides[exercise.id] ?? canonicalReps;
                          return (
                            <View key={exercise.id} style={styles.customRow}>
                              <Text style={styles.customRowLabel}>{exercise.displayName ?? exercise.name}</Text>
                              <IntStepper
                                value={currentReps}
                                min={1}
                                max={Math.max(canonicalReps * 3, 20)}
                                onChange={(next) =>
                                  setRepsOverrides((prev) => {
                                    const updated = { ...prev };
                                    if (next === canonicalReps) {
                                      delete updated[exercise.id];
                                    } else {
                                      updated[exercise.id] = next;
                                    }
                                    return updated;
                                  })
                                }
                              />
                            </View>
                          );
                        })}
                    </>
                  ) : null}
                </>
              ) : (
                <>
                  <View style={styles.customRow}>
                    <Text style={styles.customRowLabel}>{workout.gearCount === 2 ? 'Kettlebell 1' : 'Weight'}</Text>
                    <WeightStepper
                      value={weightInput}
                      onChangeText={setWeightInput}
                      onAdjust={adjustWeight}
                      unit={unitPreference}
                      invalid={!isWeightValid}
                    />
                  </View>
                  {workout.gearCount === 2 ? (
                    <View style={styles.customRow}>
                      <Text style={styles.customRowLabel}>Kettlebell 2</Text>
                      <WeightStepper
                        value={weightBInput}
                        onChangeText={setWeightBInput}
                        onAdjust={adjustWeightB}
                        unit={unitPreference}
                        invalid={!isWeightBValid}
                      />
                    </View>
                  ) : null}
                  {!isWeightValid || !isWeightBValid ? (
                    <Text style={styles.weightErrorText}>
                      Enter a weight between {convertKgToDisplay(MIN_WEIGHT_KG, unitPreference)} and{' '}
                      {convertKgToDisplay(MAX_WEIGHT_KG, unitPreference)} {unitPreference}.
                    </Text>
                  ) : null}
                  <Text style={styles.modeHint}>
                    Canonical parameters: {formatRestSeconds(hunt.restSecondsOverride ?? workout.restSeconds)} rest.
                  </Text>
                </>
              )}
            </>
          )}
        </GlassCard>

        <GlassCard style={styles.section}>
          <Text style={styles.sectionLabel}>Estimated Time</Text>
          <Text style={styles.metaValue}>
            {workout.estimatedMinutesRange[0]}–{workout.estimatedMinutesRange[1]} min
          </Text>
        </GlassCard>

        <GlassCard style={[styles.section, styles.metaRow]}>
          <View>
            <Text style={styles.sectionLabel}>Personal Best</Text>
            <Text style={styles.metaValue}>
              {personalBestResult
                ? `${formatBestTime(personalBestResult.timeMinutes * 60 + personalBestResult.timeSeconds)} · ${formatResultWeight(personalBestResult)}`
                : formatBestTime(null)}
            </Text>
          </View>
          <View style={styles.difficultyBlock}>
            <Text style={styles.sectionLabel}>Global Best</Text>
            <View style={styles.globalBestRow}>
              <Ionicons name="lock-closed" size={12} color={colors.steel} />
              <Text style={styles.globalBestText}>Coming Soon</Text>
            </View>
          </View>
        </GlassCard>
      </ScrollView>

      <View style={styles.footer}>
        <Button
          label="Begin Hunt"
          disabled={isProgressionLocked ? !lockedConfig : !isWeightValid || !isWeightBValid}
          onPress={beginHunt}
          style={styles.beginButton}
        />
      </View>
    </AppBackground>
  );
}

const PORTRAIT_SIZE = 88;

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: spacing.md,
    paddingBottom: spacing.xxl,
    gap: spacing.sm,
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
  briefHeader: {
    alignItems: 'center',
    marginBottom: spacing.sm,
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
    marginBottom: spacing.xs,
  },
  portraitImage: {
    width: '100%',
    height: '100%',
  },
  portraitInitial: {
    fontFamily: fontFamily.displayBold,
    fontSize: 32,
    color: colors.text.secondary,
  },
  monsterName: {
    fontFamily: fontFamily.displayBold,
    fontSize: fontSize.lg,
    color: colors.text.primary,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  personalityLabel: {
    fontFamily: fontFamily.monoRegular,
    fontSize: fontSize.xs,
    color: colors.bronze.base,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: 2,
  },
  description: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.base,
    color: colors.text.secondary,
    textAlign: 'center',
    marginTop: spacing.xxs,
    // briefHeader centers its children (alignItems: 'center'), which lets a
    // Text child measure by its own content instead of being bounded to the
    // container — long descriptions (e.g. Leviathan's) could overflow past
    // the screen edge instead of wrapping. Stretching to the full width
    // constrains wrapping without changing font, size, color, or GlassCard.
    width: '100%',
  },
  flavor: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.sm,
    fontStyle: 'italic',
    color: colors.text.muted,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  focusRow: {
    // briefHeader centers its children (alignItems: 'center'), so without an
    // explicit width this row shrink-wraps to its content instead of using
    // the screen's available width — with long tags (e.g. Leviathan's
    // "Shoulder Endurance", Behemoth's "Technical Consistency") that pushed
    // the row past the screen edge and clipped it, since flexDirection:
    // 'row' alone never wraps. Same root cause/fix shape as the earlier
    // `description` wrapping fix above.
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    width: '100%',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  focusTag: {
    backgroundColor: colors.void.surface,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border.hairlineStrong,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
  },
  focusTagText: {
    fontFamily: fontFamily.monoRegular,
    fontSize: fontSize.xs,
    color: colors.bronze.active,
    textTransform: 'uppercase',
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
  exerciseList: {
    gap: spacing.xs,
  },
  exerciseGroupLabel: {
    fontFamily: fontFamily.monoBold,
    fontSize: fontSize.xs,
    color: colors.bronze.base,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: spacing.xxs,
  },
  exerciseGroupSpacing: {
    marginTop: spacing.sm,
  },
  exerciseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  // Polish pass, fix 2: same two-tier compact/dense shape as
  // ActiveHuntScreen's in-combat exerciseListDensity, applied here to
  // this screen's pre-fight preview instead — see totalPreviewRows above
  // for the (also generic, no monster names) thresholds.
  exerciseRowCompact: {
    gap: spacing.xs,
  },
  exerciseRowDense: {
    gap: spacing.xxs,
  },
  exerciseIndexCompact: {
    fontSize: fontSize.xs,
  },
  exerciseNameCompact: {
    fontSize: fontSize.sm,
  },
  exerciseTargetCompact: {
    fontSize: fontSize.xs,
  },
  exerciseRowPressed: {
    opacity: 0.6,
  },
  exerciseIndex: {
    fontFamily: fontFamily.monoRegular,
    fontSize: fontSize.sm,
    color: colors.text.muted,
    width: 16,
  },
  exerciseName: {
    flex: 1,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: fontSize.base,
    color: colors.text.primary,
  },
  exerciseTarget: {
    fontFamily: fontFamily.monoRegular,
    fontSize: fontSize.sm,
    color: colors.bronze.base,
  },
  finisherRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border.hairline,
  },
  finisherName: {
    fontFamily: fontFamily.bodySemiBold,
    fontSize: fontSize.base,
    color: colors.text.primary,
    flex: 1,
  },
  finisherScheme: {
    fontFamily: fontFamily.monoRegular,
    fontSize: fontSize.sm,
    color: colors.ember.base,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  metaValue: {
    fontFamily: fontFamily.monoBold,
    fontSize: fontSize.base,
    color: colors.text.primary,
  },
  difficultyBlock: {
    alignItems: 'flex-end',
  },
  globalBestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
  },
  globalBestText: {
    fontFamily: fontFamily.monoRegular,
    fontSize: fontSize.sm,
    color: colors.steel,
  },
  footer: {
    padding: spacing.md,
    backgroundColor: colors.void.base,
    borderTopWidth: 1,
    borderTopColor: colors.border.hairline,
  },
  weightStepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  weightStepButton: {
    width: 36,
    height: 36,
    borderRadius: radii.pill,
    backgroundColor: colors.void.surface,
    borderWidth: 1,
    borderColor: colors.border.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weightStepButtonPressed: {
    backgroundColor: colors.charcoal.raised,
  },
  weightInputCompact: {
    width: 64,
    fontFamily: fontFamily.monoBold,
    fontSize: fontSize.base,
    color: colors.text.primary,
    backgroundColor: colors.void.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border.hairline,
    paddingVertical: spacing.xs,
    textAlign: 'center',
  },
  weightInputError: {
    borderColor: colors.blood,
  },
  weightUnit: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.sm,
    color: colors.text.muted,
  },
  weightErrorText: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.xs,
    color: colors.blood,
    marginTop: spacing.xs,
  },
  beginButton: {
    width: '100%',
  },
  // Custom Hunt: "Training Mode" card styles. miniToggle*/restStepper*
  // mirror TimerBuilderScreen's local MiniToggle/Stepper visual pattern
  // exactly (same tokens/shapes), kept local to this screen the same way
  // that one is local to its own screen — no shared component existed to
  // import instead.
  modeHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  modeToggleRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  modeHint: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.sm,
    color: colors.text.muted,
    marginTop: spacing.xs,
  },
  baselineHint: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.xs,
    color: colors.text.muted,
    fontStyle: 'italic',
    marginTop: spacing.xs,
  },
  legacyHint: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.xs,
    color: colors.ember.base,
    marginTop: spacing.xs,
  },
  customRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  // Encounter Lock: "Canonical Encounter — Locked" card + footer styles.
  lockedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
    backgroundColor: colors.void.surface,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border.hairline,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
  },
  lockedPillText: {
    fontFamily: fontFamily.bodySemiBold,
    fontSize: fontSize.xs,
    color: colors.text.muted,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  targetCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.sm,
    backgroundColor: colors.void.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border.hairlineStrong,
    padding: spacing.sm,
  },
  targetText: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.sm,
    color: colors.text.secondary,
  },
  targetTime: {
    fontFamily: fontFamily.monoBold,
    color: colors.ember.base,
    fontSize: fontSize.base,
  },
  lockedWeightValue: {
    fontFamily: fontFamily.monoBold,
    fontSize: fontSize.base,
    color: colors.text.primary,
  },
  customRowLabel: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.sm,
    color: colors.text.primary,
  },
  miniToggle: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border.hairlineStrong,
  },
  miniToggleActive: {
    backgroundColor: colors.bronze.base,
    borderColor: colors.bronze.base,
  },
  miniToggleText: {
    fontFamily: fontFamily.monoRegular,
    fontSize: fontSize.xs,
    color: colors.text.secondary,
    textTransform: 'uppercase',
  },
  miniToggleTextActive: {
    color: colors.text.onBronze,
  },
  restStepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  restStepperButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: colors.border.hairlineStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  restStepperValue: {
    fontFamily: fontFamily.monoBold,
    fontSize: fontSize.base,
    color: colors.text.primary,
    minWidth: 50,
    textAlign: 'center',
  },
});
