import { BattleConfig, Exercise, Workout } from '../models';

/**
 * Task 2 (Custom Training — structural parameters). This module answers
 * three questions, purely from a Workout's own existing content shape —
 * never a monster id or workout id check:
 *
 *  1. classifyWorkoutStructure — what KIND of structure is this?
 *  2. getStructuralControlConfig — does that kind get a control, and what
 *     are its safe min/max/canonical values?
 *  3. buildCustomWorkout / scaleBattleConfigForCustomWorkout — given a
 *     chosen value, produce a new, fully self-consistent Workout and a
 *     proportionally-scaled BattleConfig.
 *
 * Architecture decision (see final report for the fuller version): this
 * reuses the codebase's OWN existing pattern rather than inventing a new
 * one. useWorkoutSession, useBattleEngine, and getExerciseBreakdown all
 * already take a plain Workout/BattleConfig object as their sole source
 * of truth — none of them re-fetch canonical content mid-session. So a
 * "custom structure" session is just: build a different, but equally
 * valid and self-consistent, Workout + BattleConfig object, and hand it
 * to those exact same untouched engines. This is "Option C" (reuse
 * existing architecture) implementing "Option A" (proportional HP
 * scaling) — not a new mechanism layered on top.
 *
 * The canonical Workout content itself is never mutated — every function
 * here reads a canonical Workout and returns a NEW object.
 */

export type WorkoutStructureKind = 'flat' | 'ladder' | 'cyclical-sectioned' | 'fixed-sectioned';

function sectionSignature(section: { exercises: Exercise[] }): string {
  return section.exercises.map((e) => e.name).join('|');
}

/**
 * Purely structural: finds the smallest block size k (2 <= k <= n/2, k
 * divides n evenly) such that grouping the sections into consecutive
 * blocks of k gives blocks with IDENTICAL exercise-name sequences. This
 * is what "cyclical" means here — e.g. Janus/Agony's 10 sections are
 * (Left, Right) x 5, an ABABAB... pattern -> k=2. Orthrus's 10 sections
 * are 5x SequenceI then 5x SequenceII (AAAAABBBBB, not interleaved) ->
 * no k matches -> not cyclical, correctly gets no control. Ifrit's 3
 * sections (main, main, finisher) and Weaver's 5 distinct sections also
 * correctly find no match.
 */
function detectRepeatingCycleLength(sections: { exercises: Exercise[] }[]): number | null {
  const n = sections.length;
  const signatures = sections.map(sectionSignature);
  for (let k = 2; k <= Math.floor(n / 2); k++) {
    if (n % k !== 0) {
      continue;
    }
    const firstBlock = signatures.slice(0, k).join(',');
    let matches = true;
    for (let start = k; start < n; start += k) {
      if (signatures.slice(start, start + k).join(',') !== firstBlock) {
        matches = false;
        break;
      }
    }
    if (matches) {
      return k;
    }
  }
  return null;
}

export function classifyWorkoutStructure(workout: Workout): WorkoutStructureKind {
  // Reuses the exact existing content flag (Sprint 23) — the only ladder
  // in the project today (Minotaur's labyrinth-ladder) already sets this,
  // and any future ladder workout would too, so this needs no per-monster
  // logic.
  if (workout.stepLabel === 'Rung') {
    return 'ladder';
  }
  if (!workout.sections) {
    return 'flat';
  }
  return detectRepeatingCycleLength(workout.sections) !== null ? 'cyclical-sectioned' : 'fixed-sectioned';
}

export interface StructuralControlConfig {
  kind: WorkoutStructureKind;
  /** UI label for the control — "Rounds" / "Max Rung" / "Cycles". */
  label: string;
  min: number;
  max: number;
  /** The workout's own canonical value — what the control should default to / reset to. */
  canonical: number;
}

/**
 * Per-exercise rep customization (weight/kettlebell task). Scoped to
 * FLAT workouts only, deliberately — their `exercises` array is
 * authored once with stable, already-unique ids and is reused verbatim
 * every round (buildCustomWorkout's flat branch never regenerates it).
 * Ladder rungs derive their reps from rung position by design (not
 * independently settable without breaking the ladder concept), and
 * fixed/cyclical-sectioned workouts reuse the SAME exercise across
 * multiple sections with regenerated per-section ids (e.g. Janus's
 * "Clean & Press" appears once in its Left section and again, a
 * different id, in Right) — keying an override by name would silently
 * apply to both, and by id would require setting it twice for "the same"
 * movement, either of which risks exactly the accidental merge/
 * duplication this feature must avoid. Returns null for anything that
 * isn't 'flat'; the UI simply shows no reps control in that case,
 * matching the existing "no fake configurability" rule already applied
 * to the structural control above.
 */
export function getRepsCustomizableTemplate(workout: Workout): Exercise[] | null {
  return classifyWorkoutStructure(workout) === 'flat' ? workout.exercises : null;
}

const MIN_ROUNDS = 1;
const MIN_LADDER_MAX_RUNG = 3;
const MIN_CYCLES = 1;

/**
 * Returns null for 'fixed-sectioned' workouts (no safe structural
 * parameter — Custom Hunt still gets weight/gear/rest, just not a
 * structural control) and for any workout whose canonical shape is
 * already at its own floor (nothing sensible to reduce to).
 */
export function getStructuralControlConfig(workout: Workout): StructuralControlConfig | null {
  const kind = classifyWorkoutStructure(workout);

  if (kind === 'flat') {
    // Ceiling: canonical rounds x2, per the task's own suggested default
    // ("preferably canonical rounds x2 unless existing architecture
    // suggests something better" — nothing in the codebase suggests a
    // different ceiling, so this is it).
    return { kind, label: 'Rounds', min: MIN_ROUNDS, max: workout.rounds * 2, canonical: workout.rounds };
  }

  if (kind === 'ladder') {
    const canonicalMaxRung = Math.ceil((workout.rounds + 1) / 2);
    return {
      kind,
      label: 'Max Rung',
      min: MIN_LADDER_MAX_RUNG,
      max: canonicalMaxRung * 2,
      canonical: canonicalMaxRung,
    };
  }

  if (kind === 'cyclical-sectioned') {
    const cycleLength = detectRepeatingCycleLength(workout.sections!) as number;
    const canonicalCycles = workout.sections!.length / cycleLength;
    return { kind, label: 'Cycles', min: MIN_CYCLES, max: canonicalCycles * 2, canonical: canonicalCycles };
  }

  return null;
}

/** Independent, deliberately duplicated estimate — see file header. Never imported by/into damageResolver.ts, and never used during live gameplay; purely a calibration-time aggregate. */
function estimatePerExerciseDamage(exercise: Exercise): number {
  switch (exercise.damageType) {
    case 'flat':
      return exercise.damageCoefficient;
    case 'per_rep':
      return exercise.damageCoefficient * (exercise.targetReps ?? 0);
    case 'per_second':
    case 'over_time':
      return exercise.damageCoefficient * (exercise.durationSeconds ?? 0);
    default:
      return exercise.damageCoefficient;
  }
}

function estimateWorkoutBaseDamage(workout: Workout): number {
  let exerciseDamage: number;
  if (workout.sections) {
    exerciseDamage = workout.sections.reduce(
      (sum, section) => sum + section.exercises.reduce((a, e) => a + estimatePerExerciseDamage(e), 0),
      0
    );
  } else {
    const perRound = workout.exercises.reduce((a, e) => a + estimatePerExerciseDamage(e), 0);
    exerciseDamage = perRound * workout.rounds;
  }
  return exerciseDamage + workout.roundBonusDamage * workout.rounds;
}

function ladderRungSequence(maxRung: number): number[] {
  const ascending = Array.from({ length: maxRung }, (_, i) => i + 1);
  const descending = Array.from({ length: maxRung - 1 }, (_, i) => maxRung - 1 - i);
  return [...ascending, ...descending];
}

/**
 * Applies rep overrides to a flat workout's exercise template. For
 * `per_rep` exercises this is the whole story — damage already scales
 * with targetReps via the existing, untouched damageResolver formula.
 * For `flat`-type exercises (the majority of this project's content),
 * damage is a fixed per-completion amount that deliberately ignores
 * targetReps (see damageResolver.ts) — so changing reps alone wouldn't
 * change that exercise's damage contribution at all. Rather than
 * touching damageResolver to make it reps-aware (a formula change this
 * task explicitly rules out), this scales that exercise's own
 * damageCoefficient by the same ratio the reps changed by — the same
 * "build a different, self-consistent content object" pattern already
 * used for round/ladder-depth/cycle-count HP scaling above, applied one
 * exercise at a time instead of to the whole workout. damageResolver
 * itself never sees a difference: it just reads whatever coefficient
 * this object carries, exactly as it always has.
 */
function applyRepsOverrides(template: Exercise[], repsOverrides: Record<string, number>): Exercise[] {
  return template.map((exercise) => {
    const overrideReps = repsOverrides[exercise.id];
    if (!overrideReps || overrideReps === exercise.targetReps || !exercise.targetReps) {
      return exercise;
    }
    const clampedReps = Math.max(1, Math.round(overrideReps));
    if (exercise.damageType === 'flat') {
      const ratio = clampedReps / exercise.targetReps;
      return {
        ...exercise,
        targetReps: clampedReps,
        damageCoefficient: Math.max(1, Math.round(exercise.damageCoefficient * ratio)),
      };
    }
    // per_rep: damage already scales via the untouched formula, no
    // coefficient change needed. per_second/over_time exercises never
    // reach here — getRepsCustomizableTemplate's callers only offer this
    // control for exercises that actually have a targetReps to begin
    // with (see the HuntOverviewScreen UI).
    return { ...exercise, targetReps: clampedReps };
  });
}

/**
 * Builds a new, fully self-consistent Workout for the given structural
 * value and/or per-exercise rep overrides. Never mutates
 * canonicalWorkout. gearWeightKg/gearCount/restSeconds/roundBonusDamage/
 * difficulty/focus/finisher are carried through unchanged — only
 * rounds/sections/exercises/targetTimeSeconds change, since those are
 * the fields that actually describe "how much workout this is."
 */
export function buildCustomWorkout(
  canonicalWorkout: Workout,
  value: number,
  repsOverrides?: Record<string, number>
): Workout {
  const config = getStructuralControlConfig(canonicalWorkout);
  if (!config) {
    return canonicalWorkout;
  }
  const clamped = Math.min(config.max, Math.max(config.min, Math.round(value)));

  if (config.kind === 'flat') {
    const ratio = clamped / config.canonical;
    const exercises =
      repsOverrides && Object.keys(repsOverrides).length > 0
        ? applyRepsOverrides(canonicalWorkout.exercises, repsOverrides)
        : canonicalWorkout.exercises;
    return {
      ...canonicalWorkout,
      rounds: clamped,
      exercises,
      targetTimeSeconds: Math.round(canonicalWorkout.targetTimeSeconds * ratio),
    };
  }

  if (config.kind === 'ladder') {
    // The canonical ladder's own rung-1 exercises are the template for
    // every rung — same names/coefficients throughout the real content
    // (verified: e.g. labyrinth-ladder's Double Snatch/Double Thruster
    // keep coefficient 8 at every rung, only targetReps changes to match
    // the rung number) — so this generalizes to any future ladder
    // workout, not just Minotaur's.
    const template = canonicalWorkout.sections![0].exercises;
    const rungNumbers = ladderRungSequence(clamped);
    const sections = rungNumbers.map((rung, index) => ({
      label: `Rung ${rung}`,
      exercises: template.map((e) => ({ ...e, id: `${e.id}-custom-${index}`, targetReps: rung })),
    }));
    const ratio = sections.length / canonicalWorkout.rounds;
    return {
      ...canonicalWorkout,
      rounds: sections.length,
      sections,
      exercises: sections[0].exercises,
      targetTimeSeconds: Math.round(canonicalWorkout.targetTimeSeconds * ratio),
    };
  }

  // cyclical-sectioned
  const cycleLength = detectRepeatingCycleLength(canonicalWorkout.sections!) as number;
  const baseCycle = canonicalWorkout.sections!.slice(0, cycleLength);
  const sections: { label: string; exercises: Exercise[] }[] = [];
  for (let cycle = 0; cycle < clamped; cycle++) {
    baseCycle.forEach((section, i) => {
      sections.push({
        label: cycle === 0 ? section.label : `${section.label} (Cycle ${cycle + 1})`,
        exercises: section.exercises.map((e) => ({ ...e, id: `${e.id}-custom-c${cycle}` })),
      });
    });
  }
  const ratio = clamped / config.canonical;
  return {
    ...canonicalWorkout,
    rounds: sections.length,
    sections,
    exercises: sections[0].exercises,
    targetTimeSeconds: Math.round(canonicalWorkout.targetTimeSeconds * ratio),
  };
}

/**
 * Proportional HP scaling ("Option A"): preserves THIS monster's own
 * canonical hp/base-damage ratio (whatever it legitimately is), rather
 * than forcing a universal constant — a custom session should feel
 * exactly as "hard per unit of work" as the canonical one, no harder or
 * easier. Only `hp` changes; phases/damageMultiplier/performanceBonuses/
 * personality are untouched, so the fight still escalates and rewards
 * the same way, just against a differently-sized bar.
 */
export function scaleBattleConfigForCustomWorkout(
  canonicalWorkout: Workout,
  customWorkout: Workout,
  canonicalBattleConfig: BattleConfig
): BattleConfig {
  const canonicalDamage = estimateWorkoutBaseDamage(canonicalWorkout);
  const customDamage = estimateWorkoutBaseDamage(customWorkout);
  const ratio = canonicalDamage > 0 ? customDamage / canonicalDamage : 1;
  return { ...canonicalBattleConfig, hp: Math.max(1, Math.round(canonicalBattleConfig.hp * ratio)) };
}
