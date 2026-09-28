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

function sameMovements(a: Exercise[], b: Exercise[]): boolean {
  return a.length === b.length && a.every((exercise, index) => movementName(exercise) === movementName(b[index]));
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
      const reps = members.map((exercise) => exercise.targetReps ?? null);
      groups.push({
        id: `chain-${sequenceGroup ?? first.id}`,
        kind: 'chain',
        label: sequenceGroup ? `Chain · ${sequenceGroup}` : 'Chain',
        occurrence: 0,
        occurrenceCount: 0,
        exercises: members.map((exercise) => ({ ...exercise, displayName: movementName(exercise) })),
        repsEach: reps.every((rep) => rep === reps[0]) ? reps[0] : null,
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
    return Array.from(groupsByLabel.values()).map(({ group, count }) => ({
      ...group,
      occurrence: 1,
      occurrenceCount: count,
    }));
  }

  const exercises = workout.sections?.[0]?.exercises ?? workout.exercises;
  return groupWorkoutStructure(exercises, workout.sequenceType);
}
