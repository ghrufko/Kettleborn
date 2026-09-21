import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TimerPreset, TimerInterval } from '../../src/models';
import { useIntervalClock } from './useIntervalClock';
import { contentEngine } from '../content';

export type TimerSessionStatus = 'active' | 'paused' | 'awaiting-start' | 'complete';

export interface FlatTimerStep {
  roundIndex: number;
  roundName: string;
  interval: TimerInterval;
}

export interface TimerSessionCallbacks {
  /** Fired the moment a new step becomes current — screens use interval.startSound to play a cue. */
  onIntervalStart?: (interval: TimerInterval) => void;
  /** Fired once per second for the current timed/random step, so screens can cue last-10/last-3 sounds. */
  onTick?: (remainingSeconds: number) => void;
  onComplete?: (totalElapsedSeconds: number) => void;
}

export interface TimerSessionState {
  status: TimerSessionStatus;
  currentStep: FlatTimerStep;
  nextStep: FlatTimerStep | null;
  totalSteps: number;
  stepIndex: number;
  remainingSeconds: number | null;
  elapsedTotalSeconds: number;
  isComplete: boolean;
}

export interface TimerSessionActions {
  beginManualStart: () => void;
  markStepComplete: () => void;
  pause: () => void;
  resume: () => void;
  skip: () => void;
  goToPrevious: () => void;
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * Flattens a preset's rounds/intervals into a step queue. If the preset
 * links a Hunt workout, isExerciseSlot intervals get their label replaced
 * with an exercise name from that workout — reusing existing Content
 * Engine data rather than inventing new exercise content for the Timer.
 */
function flattenPreset(preset: TimerPreset): FlatTimerStep[] {
  let exerciseNames: string[] = [];
  if (preset.linkedWorkoutId) {
    const workout = contentEngine.getWorkout(preset.linkedWorkoutId);
    if (workout) {
      exerciseNames = workout.exercises.map((exercise) => exercise.name);
      if (preset.randomizeExercises) {
        exerciseNames = shuffle(exerciseNames);
      }
    }
  }

  let exerciseCursor = 0;
  const steps: FlatTimerStep[] = [];
  preset.rounds.forEach((round, roundIndex) => {
    round.intervals.forEach((interval) => {
      let resolvedInterval = interval;
      if (interval.isExerciseSlot && exerciseNames.length > 0) {
        const name = exerciseNames[exerciseCursor % exerciseNames.length];
        exerciseCursor += 1;
        resolvedInterval = { ...interval, label: name };
      }
      steps.push({ roundIndex, roundName: round.name, interval: resolvedInterval });
    });
  });
  return steps;
}

function resolveInitialRemaining(interval: TimerInterval): number | null {
  if (interval.type === 'timed') {
    return interval.durationSeconds ?? 0;
  }
  if (interval.type === 'random') {
    const min = interval.minSeconds ?? 0;
    const max = interval.maxSeconds ?? min;
    return Math.round(min + Math.random() * (max - min));
  }
  return null; // 'reps' and 'open' have no countdown
}

export function useTimerSession(
  preset: TimerPreset,
  callbacks: TimerSessionCallbacks = {}
): TimerSessionState & TimerSessionActions {
  const steps = useMemo(() => flattenPreset(preset), [preset]);

  const [stepIndex, setStepIndex] = useState(0);
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(() =>
    resolveInitialRemaining(steps[0]?.interval)
  );
  const [elapsedTotalSeconds, setElapsedTotalSeconds] = useState(0);
  const [status, setStatus] = useState<TimerSessionStatus>(() =>
    steps[0]?.interval.requiresManualStart ? 'awaiting-start' : 'active'
  );

  const callbacksRef = useRef(callbacks);
  useEffect(() => {
    callbacksRef.current = callbacks;
  });

  const currentStep = steps[Math.min(stepIndex, steps.length - 1)];
  const nextStep = stepIndex + 1 < steps.length ? steps[stepIndex + 1] : null;

  const elapsedTotalSecondsRef = useRef(0);
  useEffect(() => {
    elapsedTotalSecondsRef.current = elapsedTotalSeconds;
  }, [elapsedTotalSeconds]);

  // Fire onIntervalStart exactly once whenever the step identity changes.
  const announcedIndexRef = useRef(-1);
  useEffect(() => {
    if (announcedIndexRef.current !== stepIndex) {
      announcedIndexRef.current = stepIndex;
      callbacksRef.current.onIntervalStart?.(currentStep.interval);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIndex]);

  const advance = useCallback(() => {
    setStepIndex((previousIndex) => {
      const nextIndex = previousIndex + 1;
      if (nextIndex >= steps.length) {
        setStatus('complete');
        callbacksRef.current.onComplete?.(elapsedTotalSecondsRef.current);
        return previousIndex;
      }
      const step = steps[nextIndex];
      setRemainingSeconds(resolveInitialRemaining(step.interval));
      setStatus(step.interval.requiresManualStart ? 'awaiting-start' : 'active');
      return nextIndex;
    });
  }, [steps]);

  useIntervalClock(status === 'active', () => {
    setElapsedTotalSeconds((seconds) => seconds + 1);

    if (currentStep.interval.type === 'timed' || currentStep.interval.type === 'random') {
      setRemainingSeconds((remaining) => {
        const nextRemaining = (remaining ?? 0) - 1;
        callbacksRef.current.onTick?.(Math.max(nextRemaining, 0));
        if (nextRemaining <= 0) {
          advance();
          return 0;
        }
        return nextRemaining;
      });
    }
  });

  const beginManualStart = useCallback(() => {
    setStatus((current) => (current === 'awaiting-start' ? 'active' : current));
  }, []);

  const markStepComplete = useCallback(() => {
    if (
      status === 'active' &&
      (currentStep.interval.type === 'reps' || currentStep.interval.type === 'open')
    ) {
      advance();
    }
  }, [status, currentStep, advance]);

  const pause = useCallback(() => {
    setStatus((current) => (current === 'active' ? 'paused' : current));
  }, []);

  const resume = useCallback(() => {
    setStatus((current) => (current === 'paused' ? 'active' : current));
  }, []);

  const skip = useCallback(() => {
    if (status === 'active' || status === 'awaiting-start') {
      advance();
    }
  }, [status, advance]);

  const goToPrevious = useCallback(() => {
    if (status === 'complete') {
      return;
    }
    setStepIndex((previousIndex) => {
      const targetIndex = Math.max(0, previousIndex - 1);
      const step = steps[targetIndex];
      setRemainingSeconds(resolveInitialRemaining(step.interval));
      setStatus(step.interval.requiresManualStart ? 'awaiting-start' : 'active');
      return targetIndex;
    });
  }, [status, steps]);

  return {
    status,
    currentStep,
    nextStep,
    totalSteps: steps.length,
    stepIndex,
    remainingSeconds,
    elapsedTotalSeconds,
    isComplete: status === 'complete',
    beginManualStart,
    markStepComplete,
    pause,
    resume,
    skip,
    goToPrevious,
  };
}
