import { Hunt } from '../models';

export type HuntDisplayState = 'locked' | 'available' | 'completed';

/**
 * A hunt is Completed once its order falls within the count of hunts the
 * player has finished for this monster; otherwise it's Available if content
 * says it's unlocked (and, for order > 1, the specific previous Hunt has
 * actually been completed), or Locked if content hasn't released it yet or
 * the previous Hunt hasn't. This is entirely derived — huntsCompleted
 * already persists via MonsterProgress, and per-Hunt completion is already
 * recoverable from WorkoutResult.huntId — so no separate per-hunt
 * completion table is needed.
 *
 * isPreviousHuntCompleted is optional and only enforced when the caller
 * supplies it: callers that don't pass it (nextObjective.ts) keep their
 * existing huntsCompleted-only behavior unchanged, since they don't have
 * WorkoutResult data on hand — see MonsterDetailScreen for the one caller
 * that does and passes it through.
 */
export function getHuntDisplayState(
  hunt: Hunt,
  huntsCompleted: number,
  isPreviousHuntCompleted?: boolean
): HuntDisplayState {
  if (hunt.order <= huntsCompleted) {
    return 'completed';
  }
  if (hunt.locked) {
    return 'locked';
  }
  if (hunt.order > 1 && isPreviousHuntCompleted === false) {
    return 'locked';
  }
  return 'available';
}
