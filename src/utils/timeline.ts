import { WorkoutResult } from '../models';

export interface TimelineEntry {
  result: WorkoutResult;
  wasPersonalRecord: boolean;
  /** True only for the chronologically-first completion of this result's workoutId — same derivation shape as wasPersonalRecord, just tracking "seen before" instead of "beaten before". */
  wasFirstClear: boolean;
}

export interface TimelineGroup {
  label: string;
  entries: TimelineEntry[];
}

function dayLabel(isoDate: string): string {
  const date = new Date(isoDate);
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toDateString();
  const dateString = date.toDateString();
  if (dateString === today) return 'Today';
  if (dateString === yesterday) return 'Yesterday';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function groupResultsByDay(results: WorkoutResult[]): TimelineGroup[] {
  // Determine "was a PR at the time" by walking chronologically forward —
  // a result only counts as a PR if it beat every earlier result for the
  // same workout, never a later one.
  const chronological = [...results].sort(
    (a, b) => new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime()
  );
  const bestSoFar = new Map<string, number>();
  const prByResultId = new Map<string, boolean>();
  const firstClearByResultId = new Map<string, boolean>();
  const seenWorkoutIds = new Set<string>();
  chronological.forEach((result) => {
    const seconds = result.timeMinutes * 60 + result.timeSeconds;
    const previousBest = bestSoFar.get(result.workoutId);
    const wasPersonalRecord = previousBest !== undefined && seconds < previousBest;
    prByResultId.set(result.id, wasPersonalRecord);
    if (previousBest === undefined || seconds < previousBest) {
      bestSoFar.set(result.workoutId, seconds);
    }

    firstClearByResultId.set(result.id, !seenWorkoutIds.has(result.workoutId));
    seenWorkoutIds.add(result.workoutId);
  });

  const descending = [...results].sort(
    (a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime()
  );

  const groups: TimelineGroup[] = [];
  descending.forEach((result) => {
    const label = dayLabel(result.completedAt);
    let group = groups.find((g) => g.label === label);
    if (!group) {
      group = { label, entries: [] };
      groups.push(group);
    }
    group.entries.push({
      result,
      wasPersonalRecord: prByResultId.get(result.id) ?? false,
      wasFirstClear: firstClearByResultId.get(result.id) ?? false,
    });
  });

  return groups;
}
