import { useEffect, useRef } from 'react';

/**
 * Calls onTick() once per second while isRunning is true. Both the Hunt
 * session and the Timer session need exactly this mechanism and nothing
 * more — the business rules for what a "tick" means (decrement a rest
 * countdown, advance a step, etc.) stay in each hook, only the raw
 * interval plumbing is shared.
 */
export function useIntervalClock(isRunning: boolean, onTick: () => void): void {
  const onTickRef = useRef(onTick);
  useEffect(() => {
    onTickRef.current = onTick;
  });

  useEffect(() => {
    if (!isRunning) {
      return;
    }
    const intervalId = setInterval(() => {
      onTickRef.current();
    }, 1000);
    return () => clearInterval(intervalId);
  }, [isRunning]);
}
