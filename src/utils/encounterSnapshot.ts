import type { Monster, Hunt, Workout, WorkoutResult } from '../models';
import { reconstructEncounterConfig } from './encounterLock';
import { getPerformedWorkout } from './resultWorkout';

/**
 * What a completed encounter actually was — its exercises/quantities,
 * structure, rest, weight and target time — rebuilt from that
 * encounter's OWN saved result, never the monster's default template.
 *
 * Every snapshot is derived from one result of one huntId, so Encounters
 * 1, 2 and 3 are independent: completing (or replaying) a later
 * encounter writes a new result for that encounter only and can never
 * change an earlier encounter's snapshot. Nothing new is stored — the
 * result already holds the configuration (weights, rest, Custom Hunt
 * structural value and per-step overrides; see encounterLock.ts), and
 * it survives app restarts like every other saved result.
 */
export interface EncounterSnapshot {
  hunt: Hunt;
  result: WorkoutResult;
  /** The workout the encounter performed (Custom Hunt structure/reps/steps applied). */
  workout: Workout;
  restSeconds: number;
  isCustomHunt: boolean;
  /** false for a legacy Custom Hunt row whose rest/structure/reps couldn't be recorded (see ReconstructedConfig.isExact). */
  isExact: boolean;
  elapsedSeconds: number;
}

/** The most recent result per encounter (huntId) of this monster, as a snapshot. */
export function getEncounterSnapshots(
  monster: Monster,
  results: WorkoutResult[],
  getWorkout: (workoutId: string) => Workout | undefined
): Map<string, EncounterSnapshot> {
  const latestByHunt = new Map<string, WorkoutResult>();
  for (const result of results) {
    if (result.monsterId !== monster.id) continue;
    const existing = latestByHunt.get(result.huntId);
    if (!existing || new Date(result.completedAt).getTime() > new Date(existing.completedAt).getTime()) {
      latestByHunt.set(result.huntId, result);
    }
  }
  const snapshots = new Map<string, EncounterSnapshot>();
  for (const hunt of monster.hunts) {
    const result = latestByHunt.get(hunt.id);
    const canonicalWorkout = result ? getWorkout(result.workoutId) : undefined;
    if (!result || !canonicalWorkout) continue;
    const { config, isExact } = reconstructEncounterConfig(hunt, canonicalWorkout, result);
    snapshots.set(hunt.id, {
      hunt,
      result,
      workout: getPerformedWorkout(result, canonicalWorkout),
      restSeconds: config.restSeconds,
      isCustomHunt: result.isCustomHunt,
      isExact,
      elapsedSeconds: result.timeMinutes * 60 + result.timeSeconds,
    });
  }
  return snapshots;
}
