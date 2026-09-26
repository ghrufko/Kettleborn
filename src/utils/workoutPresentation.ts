import type { Exercise } from '../models';

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
  return (exercise.displayName ?? exercise.name).replace(CHAIN_SUFFIX, '').replace(COMPLEX_SUFFIX, '').trim();
}

function sameMovements(a: Exercise[], b: Exercise[]): boolean {
  return a.length === b.length && a.every((exercise, index) => movementName(exercise) === movementName(b[index]));
}

/**
 * Collapse the content's contiguous Chain N/M passes and Complex ×N entries
 * into player-facing groups. Only reads display metadata; the original
 * exercise list remains the input to the workout and battle engines.
 */
export function groupWorkoutStructure(exercises: Exercise[]): WorkoutPresentationGroup[] {
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

  // Let existing rendering handle a mixed or partially annotated sequence
  // until every entry can be represented without hiding content.
  if (hasUnstructuredExercises) return [];

  const occurrenceCounts = new Map<string, number>();
  for (const group of groups) {
    const key = `${group.kind}-${group.label}`;
    occurrenceCounts.set(key, (occurrenceCounts.get(key) ?? 0) + 1);
  }
  const occurrences = new Map<string, number>();
  return groups.map((group) => {
    const key = `${group.kind}-${group.label}`;
    const occurrence = (occurrences.get(key) ?? 0) + 1;
    occurrences.set(key, occurrence);
    return { ...group, occurrence, occurrenceCount: occurrenceCounts.get(key) ?? 1 };
  });
}
