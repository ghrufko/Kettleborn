import type { Exercise, Workout } from '../models';

export interface WorkoutPresentationGroup {
  id: string;
  kind: 'chain' | 'complex';
  label: string;
  occurrence: number;
  occurrenceCount: number;
  exercises: Exercise[];
  repsEach: number | null;
}

export interface ExerciseRange {
  start: number;
  end: number;
}

const CHAIN_SUFFIX = /\s*\(Chain (\d+)\/(\d+)\)\s*$/i;
const COMPLEX_SUFFIX = /\s*\(Complex\s*[×x]\s*(\d+)\)\s*$/i;

function chainInfo(exercise: Exercise) {
  const match = (exercise.displayName ?? exercise.name).match(CHAIN_SUFFIX);
  return match ? { pass: Number(match[1]), count: Number(match[2]) } : null;
}

function complexCount(exercise: Exercise): number | null {
  const match = (exercise.displayName ?? exercise.name).match(COMPLEX_SUFFIX);
  return match ? Number(match[1]) : null;
}

function movementName(exercise: Exercise): string {
  const name = (exercise.displayName ?? exercise.name)
    .replace(CHAIN_SUFFIX, '')
    .replace(COMPLEX_SUFFIX, '')
    .trim();
  return exercise.sequenceGroup
    ? name.replace(new RegExp(`^${exercise.sequenceGroup}\\s*[·:-]\\s*`, 'i'), '').trim()
    : name;
}

/** Find the continuous chain that contains the given authored exercise step. */
export function getContinuousChainRange(
  exercises: Exercise[],
  index: number,
  sequenceType?: Workout['sequenceType']
): ExerciseRange | null {
  const current = exercises[index];
  if (!current) return null;

  const chainPattern = /\(Chain \d+\/\d+\)/i;
  if (chainPattern.test(current.displayName ?? '')) {
    let start = index;
    let end = index;
    while (start > 0 && chainPattern.test(exercises[start - 1].displayName ?? '')) start -= 1;
    while (end < exercises.length - 1 && chainPattern.test(exercises[end + 1].displayName ?? '')) end += 1;
    return { start, end };
  }

  return sequenceType === 'chain' ? { start: 0, end: exercises.length - 1 } : null;
}

function sameMovements(a: Exercise[], b: Exercise[]): boolean {
  return a.length === b.length && a.every((exercise, index) =>
    (exercise.libraryExerciseId ?? exercise.name) === (b[index].libraryExerciseId ?? b[index].name) &&
    exercise.targetReps === b[index].targetReps &&
    exercise.targetSteps === b[index].targetSteps &&
    exercise.targetDistanceFt === b[index].targetDistanceFt &&
    exercise.damageCoefficient === b[index].damageCoefficient &&
    exercise.damageType === b[index].damageType &&
    exercise.libraryExerciseId === b[index].libraryExerciseId &&
    exercise.usesGearCount === b[index].usesGearCount
  );
}

/**
 * Returns the authored movements for one round. Some legacy repeated Chains
 * are stored as consecutive copies of the same sequence in the flat exercise
 * list; in that case, select the matching block instead of scoring/displaying
 * the entire workout as one round.
 */
export function getWorkoutRoundExercises(workout: Workout, round: number): Exercise[] {
  if (workout.sections?.length) {
    return workout.sections[round - 1]?.exercises ?? workout.exercises;
  }

  if (workout.sequenceType !== 'chain' || workout.rounds < 2 || workout.exercises.length <= workout.rounds) {
    return workout.exercises;
  }

  const blockSize = workout.exercises.length / workout.rounds;
  if (!Number.isInteger(blockSize) || blockSize < 1) return workout.exercises;

  const authoredChainCount = workout.rounds - 1;
  if (!workout.exercises.slice(0, blockSize).every((exercise) => chainInfo(exercise)?.count === authoredChainCount)) {
    return workout.exercises;
  }

  const blocks = Array.from({ length: workout.rounds }, (_, index) =>
    workout.exercises.slice(index * blockSize, (index + 1) * blockSize)
  );
  const passesAreOrdered = blocks.slice(0, -1).every((block, index) =>
    block.every((exercise) => chainInfo(exercise)?.pass === index + 1 && chainInfo(exercise)?.count === authoredChainCount)
  );
  const finalBlockIsComplex = blocks[blocks.length - 1].every((exercise) => complexCount(exercise) === authoredChainCount);
  if (!passesAreOrdered || !finalBlockIsComplex) return workout.exercises;
  if (!blocks.every((block) => sameMovements(blocks[0], block))) return workout.exercises;

  return blocks[Math.max(0, Math.min(round - 1, blocks.length - 1))];
}

/**
 * Every exercise actually performed across a completed session, resolved
 * per round exactly as `useWorkoutSession`/the Battle Engine do (via
 * `getWorkoutRoundExercises`) — not a blind `workout.exercises` flat list
 * repeated `actualRounds` times. That blind multiply is correct for an
 * ordinary flat workout (where `getWorkoutRoundExercises` returns the same
 * full list every round anyway — mathematically identical output), but
 * double-counts a workout using the "legacy repeated Chain stored as
 * consecutive blocks" fallback (e.g. Atlas: 30 authored exercises really
 * means 5 per round, not 30) and silently ignores a content-authored
 * `rounds` value an open-ended EMOM workout's real `actualRounds` has
 * already outgrown. Sectioned workouts are unaffected — each section is
 * already one round's worth, same as before.
 */
export function getWorkoutActualExercises(workout: Workout, actualRounds: number): Exercise[] {
  if (workout.sections) {
    return workout.sections.flatMap((section) => section.exercises);
  }
  const result: Exercise[] = [];
  for (let round = 1; round <= actualRounds; round += 1) {
    result.push(...getWorkoutRoundExercises(workout, round));
  }
  return result;
}

/** Same "left"/"right hand/side" tolerance as handOf(), applied to a raw
 * `Exercise.sequenceGroup` string instead of a displayName. */
function sideOf(sequenceGroup: string | undefined): 'left' | 'right' | null {
  if (!sequenceGroup) return null;
  const match = sequenceGroup.match(/^\s*(left|right)(?:\s+(?:hand|side))?\s*$/i);
  return match ? (match[1].toLowerCase() as 'left' | 'right') : null;
}

function handOf(exercise: Exercise): 'left' | 'right' | null {
  const displayName = exercise.displayName ?? '';
  // Tolerates both authored forms seen in content: "LEFT · Swing" (Unbroken)
  // and "Left Hand · Snatch" (the Wraith's sequenceGroup-derived label) —
  // an optional "hand"/"side" word is the only difference between them.
  const match = displayName.match(/^\s*(left|right)(?:\s+(?:hand|side))?\s*[·:-]/i);
  return match ? match[1].toLowerCase() as 'left' | 'right' : null;
}

/**
 * True for any chain whose exercises split evenly into a left-hand half and
 * a right-hand half of the same movements, regardless of how many movements
 * each half has — Unbroken's 6-per-side and the Wraith's 5-per-side both
 * qualify; a hardcoded "6" previously left the Wraith (and any future
 * differently-sized alternating chain) rendered as a flat, unstructured row
 * list instead of the compact left/right flow.
 */
export function isAlternatingHandChain(exercises: Exercise[]): boolean {
  const left = exercises.filter((exercise) => handOf(exercise) === 'left');
  const right = exercises.filter((exercise) => handOf(exercise) === 'right');
  const movementForSide = (exercise: Exercise) => movementName(exercise)
    .replace(/^\s*(?:left|right)(?:\s+(?:hand|side))?\s*[·:-]\s*/i, '')
    .replace(/\s*→\s*(?:left|right)\s*$/i, '')
    .trim();
  return left.length > 0 && left.length === right.length && left.every((exercise, index) =>
    movementForSide(exercise) === movementForSide(right[index])
  );
}

/**
 * Collapse the content's contiguous Chain N/M passes and Complex ×N entries
 * into player-facing groups. Only reads display metadata; the original
 * exercise list remains the input to the workout and battle engines.
 */
function numberOccurrences(groups: WorkoutPresentationGroup[]): WorkoutPresentationGroup[] {
  const occurrenceCounts = new Map<string, number>();
  for (const group of groups) {
    occurrenceCounts.set(group.label, (occurrenceCounts.get(group.label) ?? 0) + 1);
  }
  const occurrences = new Map<string, number>();
  return groups.map((group) => {
    const occurrence = (occurrences.get(group.label) ?? 0) + 1;
    occurrences.set(group.label, occurrence);
    return { ...group, occurrence, occurrenceCount: occurrenceCounts.get(group.label) ?? 1 };
  });
}

export function groupWorkoutStructure(
  exercises: Exercise[],
  sequenceType?: 'chain'
): WorkoutPresentationGroup[] {
  const groups: WorkoutPresentationGroup[] = [];
  let index = 0;
  let hasUnstructuredExercises = false;

  while (index < exercises.length) {
    const first = exercises[index];
    const firstChain = chainInfo(first);
    if (firstChain?.pass === 1 && firstChain.count > 0) {
      const firstPass: Exercise[] = [];
      while (index < exercises.length) {
        const info = chainInfo(exercises[index]);
        if (!info || info.pass !== 1 || info.count !== firstChain.count) break;
        firstPass.push(exercises[index++]);
      }

      let pass = 2;
      while (pass <= firstChain.count) {
        const passStart = index;
        const passExercises: Exercise[] = [];
        while (index < exercises.length) {
          const info = chainInfo(exercises[index]);
          if (!info || info.pass !== pass || info.count !== firstChain.count) break;
          passExercises.push(exercises[index++]);
        }
        if (!sameMovements(firstPass, passExercises)) {
          index = passStart;
          break;
        }
        pass += 1;
      }

      groups.push({
        id: `chain-${first.id}`,
        kind: 'chain',
        label: `Chain ${firstChain.count}`,
        occurrence: 0,
        occurrenceCount: 0,
        exercises: firstPass,
        repsEach: firstPass.length ? firstPass[0].targetReps ?? null : null,
      });
      continue;
    }

    const complex = complexCount(first);
    if (complex !== null) {
      const block: Exercise[] = [];
      while (index < exercises.length && complexCount(exercises[index]) === complex) {
        block.push(exercises[index++]);
      }
      groups.push({
        id: `complex-${first.id}`,
        kind: 'complex',
        label: `Complex ${complex}`,
        occurrence: 0,
        occurrenceCount: 0,
        exercises: block,
        repsEach: block.length ? block[0].targetReps ?? null : null,
      });
      continue;
    }

    hasUnstructuredExercises = true;
    index += 1;
  }

  // A content-authored chain without legacy suffix tags is presented as
  // contiguous chain groups. sequenceGroup is optional; absent groups form
  // one continuous chain in authored order.
  if (hasUnstructuredExercises) {
    if (sequenceType !== 'chain') return [];
    const groups: WorkoutPresentationGroup[] = [];
    let cursor = 0;
    while (cursor < exercises.length) {
      const first = exercises[cursor];
      const sequenceGroup = first.sequenceGroup;
      const members: Exercise[] = [];
      while (cursor < exercises.length && exercises[cursor].sequenceGroup === sequenceGroup) {
        members.push(exercises[cursor++]);
      }

      // A "Left Hand" sequenceGroup run immediately followed by an
      // equal-length "Right Hand" run (the Wraith) is one alternating-hand
      // chain authored as two separate sequenceGroups, not two unrelated
      // Chain blocks — combine them into a single group up front, before
      // movementName() strips each exercise's own sequenceGroup prefix
      // from its displayName (which would otherwise erase the left/right
      // signal isAlternatingHandChain needs downstream). Checked on the
      // raw sequenceGroup string, not the stripped text.
      let combined = members;
      const side = sideOf(sequenceGroup);
      const nextSequenceGroup = exercises[cursor]?.sequenceGroup;
      if (side === 'left' && sideOf(nextSequenceGroup) === 'right') {
        const rightMembers: Exercise[] = [];
        while (cursor < exercises.length && exercises[cursor].sequenceGroup === nextSequenceGroup) {
          rightMembers.push(exercises[cursor++]);
        }
        if (rightMembers.length === members.length) {
          combined = [...members, ...rightMembers];
        } else {
          // Shape mismatch — not expected in authored content, but put
          // the cursor back rather than silently drop the right half.
          cursor -= rightMembers.length;
        }
      }

      const reps = combined.map((exercise) => exercise.targetReps ?? null);
      const repsEachValue = reps.every((rep) => rep === reps[0]) ? reps[0] : null;
      const isMergedPair = combined !== members;
      groups.push({
        id: `chain-${sequenceGroup ?? first.id}`,
        kind: 'chain',
        // A merged left/right pair uses an "×N" label carrying the real
        // reps-per-side (read by WorkoutStructure's "N reps per hand"
        // line) instead of a sequenceGroup name — and, critically, its
        // exercises keep their ORIGINAL displayName (left unstripped by
        // movementName()) so isAlternatingHandChain can still read the
        // "Left Hand ·"/"Right Hand ·" prefix once WorkoutStructure
        // re-checks it; movementName() would otherwise erase that signal
        // before it's ever used downstream.
        label: isMergedPair ? `Chain ×${repsEachValue ?? ''}` : sequenceGroup ? `Chain · ${sequenceGroup}` : 'Chain',
        occurrence: 0,
        occurrenceCount: 0,
        exercises: isMergedPair ? combined : combined.map((exercise) => ({ ...exercise, displayName: movementName(exercise) })),
        repsEach: repsEachValue,
      });
    }
    return numberOccurrences(groups);
  }

  return numberOccurrences(groups);
}

/** Presentation groups for a whole workout, collapsing repeated side-labelled chains. */
export function groupWorkoutPresentation(workout: Workout): WorkoutPresentationGroup[] {
  if (workout.sequenceType === 'chain' && workout.sections?.length) {
    const groupsByLabel = new Map<string, { group: WorkoutPresentationGroup; count: number }>();
    for (const section of workout.sections) {
      const sectionName = section.label.replace(/^Round\s+\d+\s*[—-]\s*/i, '').trim();
      const existing = groupsByLabel.get(sectionName);
      if (existing) {
        existing.count += 1;
        continue;
      }
      const sectionGroups = groupWorkoutStructure(section.exercises, 'chain');
      const group = sectionGroups[0];
      if (group) {
        groupsByLabel.set(sectionName, {
          count: 1,
          group: {
            ...group,
            id: `${group.id}-${sectionName}`,
            label: sectionName ? `${group.label} · ${sectionName}` : group.label,
          },
        });
      }
    }
    return Array.from(groupsByLabel.values()).map(({ group, count }) => {
      const alternatingHands = isAlternatingHandChain(group.exercises);
      return {
        ...group,
        label: alternatingHands ? `Chain ×${count}` : group.label,
        occurrence: 1,
        occurrenceCount: alternatingHands ? 1 : count,
      };
    });
  }

  const exercises = getWorkoutRoundExercises(workout, 1);
  const groups = groupWorkoutStructure(exercises, workout.sequenceType);
  if (exercises.length < workout.exercises.length && workout.sequenceType === 'chain') {
    return groups.map((group) => ({ ...group, label: `Chain ×${workout.rounds}` }));
  }
  return groups;
}
