import { useCallback, useEffect, useRef, useState } from 'react';
import { Exercise, Workout } from '../../src/models';
import { useIntervalClock } from '../timer/useIntervalClock';

export type SessionStatus = 'active' | 'paused' | 'complete';
export type SessionPhase = 'countdown' | 'round' | 'resting' | 'complete';

/** Fixed pre-round-1 countdown, per the Sprint 21 spec. Not content-driven — a short, universal beat before every Hunt starts, same for every workout. */
export const PRE_ROUND_COUNTDOWN_SECONDS = 10;

export interface RoundLap {
  round: number;
  durationSeconds: number;
}

export interface RestLap {
  /** The round that just finished — this rest happens after it. */
  round: number;
  /** Actual rest taken, which may be less than workout.restSeconds if started early. */
  durationSeconds: number;
}

export interface WorkoutSessionState {
  status: SessionStatus;
  phase: SessionPhase;
  currentRound: number;
  totalRounds: number;
  countdownRemaining: number;
  /** Total workout clock — ticks continuously from the moment Round 1 begins, through every round AND every rest, pausing only on explicit Pause. Never reset, mirrors a stopwatch, not a per-step timer. */
  elapsedSeconds: number;
  /** The current round's own "lap" time — resets to 0 at the start of every round, ticks only while phase is 'round'. */
  currentRoundElapsedSeconds: number;
  restRemainingSeconds: number;
  /**
   * Countdown for the current round's EMOM window, ticking down from
   * `workout.emomSeconds` — `null` for a workout that isn't EMOM-style
   * (no fabricated 0 for "not applicable", same principle used
   * elsewhere for distance-vs-reps fields).
   */
  emomRemainingSeconds: number | null;
  /** One entry per completed round, in order — the lap history. */
  laps: RoundLap[];
  /** One entry per rest period taken, in order. */
  restLaps: RestLap[];
  isResting: boolean;
  isComplete: boolean;
}

export interface WorkoutSessionActions {
  completeRound: () => void;
  startNextRoundEarly: () => void;
  skipCountdown: () => void;
  pause: () => void;
  resume: () => void;
}

/**
 * Sprint 21: replaces the old exercise-by-exercise, tap-per-rep step queue.
 * The player performs an entire round's complex without touching the
 * phone, then presses Complete Round once. Every exercise in the round is
 * assumed fully completed for now (per the sprint brief) — but the
 * completion record carries per-exercise reps/skipped fields rather than
 * a single flat "done" flag, specifically so a future partial-completion
 * or penalty flow can populate different values here without this engine
 * (or the Battle Engine reducer that consumes it) needing to change shape.
 */
export interface WorkoutSessionCallbacks {
  onRoundComplete?: (info: {
    round: number;
    durationSeconds: number;
    exercises: { exercise: Exercise; repsCompleted: number; skipped: boolean }[];
  }) => void;
  onWorkoutComplete?: (info: { elapsedSeconds: number }) => void;
}

/**
 * True only for a section pair that IS the whole round split into two
 * hands — label is exactly "Left Hand" (no "Round N —" prefix), meaning
 * `workout.rounds` itself equals the section count (e.g. The Wraith's
 * endless-spiral: 2 sections, 2 rounds, labels "Left Hand"/"Right Hand").
 * A workout where each hand is its own deliberate mini-round within a
 * larger round count (e.g. "Round 3 — Left Hand") does NOT match this —
 * those keep resting between every section exactly as before, since nothing
 * here says that pacing was wrong.
 */
function isBareHandLabel(label: string | undefined, hand: 'Left' | 'Right'): boolean {
  return !!label && new RegExp(`^${hand} Hand$`, 'i').test(label.trim());
}

export function useWorkoutSession(
  workout: Workout,
  callbacks: WorkoutSessionCallbacks = {},
  restSecondsOverride?: number
): WorkoutSessionState & WorkoutSessionActions {
  const [status, setStatus] = useState<SessionStatus>('active');
  const [phase, setPhase] = useState<SessionPhase>('countdown');
  const [currentRound, setCurrentRound] = useState(1);
  const [countdownRemaining, setCountdownRemaining] = useState(PRE_ROUND_COUNTDOWN_SECONDS);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [currentRoundElapsedSeconds, setCurrentRoundElapsedSeconds] = useState(0);
  const [restRemainingSeconds, setRestRemainingSeconds] = useState(0);
  const [emomRemainingSeconds, setEmomRemainingSeconds] = useState<number | null>(
    workout.emomSeconds ?? null
  );
  const [laps, setLaps] = useState<RoundLap[]>([]);
  const [restLaps, setRestLaps] = useState<RestLap[]>([]);

  const callbacksRef = useRef(callbacks);
  useEffect(() => {
    callbacksRef.current = callbacks;
  });

  // Tracks actual rest seconds elapsed so far this rest period, so that
  // starting the next round early (or letting rest finish naturally)
  // records the true rest duration taken — not always workout.restSeconds.
  const restTakenRef = useRef(0);

  // One tick handler, one clock — every phase's per-second behavior lives
  // here so there's a single source of truth for what "a second passing"
  // means, instead of parallel intervals that could drift.
  useIntervalClock(status === 'active', () => {
    if (phase === 'countdown') {
      setCountdownRemaining((remaining) => {
        const next = remaining - 1;
        if (next <= 0) {
          setPhase('round');
          setCurrentRoundElapsedSeconds(0);
          return 0;
        }
        return next;
      });
      return;
    }

    if (phase === 'round') {
      setElapsedSeconds((s) => s + 1);
      setCurrentRoundElapsedSeconds((s) => s + 1);
      if (workout.emomSeconds) {
        setEmomRemainingSeconds((remaining) => {
          const next = (remaining ?? workout.emomSeconds!) - 1;
          if (next <= 0) {
            // Window expired before the player pressed Complete Round —
            // the in-progress round is never added to `laps` (it only
            // gets pushed inside completeRound, which wasn't called),
            // so it's correctly not counted. The attempt ends the exact
            // same way a normal fixed-round workout's final round does
            // (phase/status -> 'complete', onWorkoutComplete fires) —
            // no separate failure path, since reaching the window limit
            // is simply how every EMOM attempt is expected to end.
            setPhase('complete');
            setStatus('complete');
            callbacksRef.current.onWorkoutComplete?.({ elapsedSeconds: elapsedSeconds + 1 });
            return 0;
          }
          return next;
        });
      }
      return;
    }

    if (phase === 'resting') {
      setElapsedSeconds((s) => s + 1);
      restTakenRef.current += 1;
      setRestRemainingSeconds((remaining) => {
        const next = remaining - 1;
        if (next <= 0) {
          setRestLaps((prev) => [...prev, { round: currentRound - 1, durationSeconds: restTakenRef.current }]);
          setPhase('round');
          setCurrentRoundElapsedSeconds(0);
          return 0;
        }
        return next;
      });
    }
  });

  const completeRound = useCallback(() => {
    if (status !== 'active' || phase !== 'round') {
      return;
    }

    const round = currentRound;
    const durationSeconds = currentRoundElapsedSeconds;
    const roundExerciseList = workout.sections?.[round - 1]?.exercises ?? workout.exercises;
    const exercises = roundExerciseList.map((exercise) => ({
      exercise,
      repsCompleted: exercise.targetReps ?? 1,
      skipped: false,
    }));

    setLaps((prev) => [...prev, { round, durationSeconds }]);
    callbacksRef.current.onRoundComplete?.({ round, durationSeconds, exercises });

    if (workout.emomSeconds) {
      // Open-ended EMOM: no predetermined final round (per the brief —
      // "do not invent a maximum number of rounds"), so `workout.rounds`
      // is never checked here as a cap. Completing within the window
      // always advances straight into the next one, with no rest phase
      // in between — the next window starts immediately.
      setCurrentRound(round + 1);
      setCurrentRoundElapsedSeconds(0);
      setEmomRemainingSeconds(workout.emomSeconds);
      setPhase('round');
      return;
    }

    if (round >= workout.rounds) {
      setPhase('complete');
      setStatus('complete');
      callbacksRef.current.onWorkoutComplete?.({ elapsedSeconds });
      return;
    }

    // Left Hand -> Right Hand, both halves of the SAME round (see
    // isBareHandLabel above) -> no rest here, go straight into Right
    // Hand. Rest (if the workout has any left after this) is decided by
    // this same completeRound the next time it's called, once Right
    // Hand itself completes — same function, same logic, just run again
    // one round later; nothing new to keep in sync.
    const currentLabel = workout.sections?.[round - 1]?.label;
    const nextLabel = workout.sections?.[round]?.label;
    if (isBareHandLabel(currentLabel, 'Left') && isBareHandLabel(nextLabel, 'Right')) {
      setCurrentRound(round + 1);
      setCurrentRoundElapsedSeconds(0);
      setPhase('round');
      return;
    }

    restTakenRef.current = 0;
    setRestRemainingSeconds(restSecondsOverride ?? workout.restSeconds);
    setCurrentRound(round + 1);
    setPhase('resting');
  }, [status, phase, currentRound, currentRoundElapsedSeconds, workout, elapsedSeconds, restSecondsOverride]);

  const startNextRoundEarly = useCallback(() => {
    if (status !== 'active' || phase !== 'resting') {
      return;
    }
    setRestLaps((prev) => [...prev, { round: currentRound - 1, durationSeconds: restTakenRef.current }]);
    setPhase('round');
    setCurrentRoundElapsedSeconds(0);
  }, [status, phase, currentRound]);

  // Task 9: mirrors startNextRoundEarly exactly, one phase earlier —
  // same shape (guard on status+phase, transition phase, reset the round
  // clock), no new state machine. elapsedSeconds is never incremented
  // during 'countdown' (see the tick handler above — only 'round' and
  // 'resting' call setElapsedSeconds), so skipping vs. waiting out the
  // countdown produces identical downstream state either way: nothing
  // for this to accidentally affect in scoring/rank/XP, because the
  // countdown was never counted as elapsed/round time in the first
  // place.
  const skipCountdown = useCallback(() => {
    if (status !== 'active' || phase !== 'countdown') {
      return;
    }
    setCountdownRemaining(0);
    setPhase('round');
    setCurrentRoundElapsedSeconds(0);
  }, [status, phase]);

  const pause = useCallback(() => {
    setStatus((current) => (current === 'active' ? 'paused' : current));
  }, []);

  const resume = useCallback(() => {
    setStatus((current) => (current === 'paused' ? 'active' : current));
  }, []);

  return {
    status,
    phase,
    currentRound,
    totalRounds: workout.rounds,
    countdownRemaining,
    elapsedSeconds,
    currentRoundElapsedSeconds,
    restRemainingSeconds,
    emomRemainingSeconds,
    laps,
    restLaps,
    isResting: phase === 'resting',
    isComplete: status === 'complete',
    completeRound,
    startNextRoundEarly,
    skipCountdown,
    pause,
    resume,
  };
}
