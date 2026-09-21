import { RoundLap, RestLap } from '../../engines/session/useWorkoutSession';

export interface RoundStatsSummary {
  completedRounds: number;
  fastestRoundSeconds: number | null;
  slowestRoundSeconds: number | null;
  averageRoundSeconds: number | null;
  totalActiveRoundSeconds: number;
  previousRoundSeconds: number | null;
  totalRestSeconds: number;
  averageRestSeconds: number | null;
}

/**
 * Everything the "iPhone Stopwatch, each round is a Lap" philosophy asks
 * for — computed on demand from the lap arrays the session engine already
 * records, never stored separately. Same "derive, don't persist a second
 * copy" principle as huntState.ts/campaignState.ts.
 */
export function getRoundStats(laps: RoundLap[], restLaps: RestLap[]): RoundStatsSummary {
  const durations = laps.map((lap) => lap.durationSeconds);
  const totalRestSeconds = restLaps.reduce((sum, lap) => sum + lap.durationSeconds, 0);
  const totalActiveRoundSeconds = durations.reduce((sum, d) => sum + d, 0);

  return {
    completedRounds: laps.length,
    fastestRoundSeconds: durations.length ? Math.min(...durations) : null,
    slowestRoundSeconds: durations.length ? Math.max(...durations) : null,
    averageRoundSeconds: durations.length ? Math.round(totalActiveRoundSeconds / durations.length) : null,
    totalActiveRoundSeconds,
    previousRoundSeconds: laps.length ? laps[laps.length - 1].durationSeconds : null,
    totalRestSeconds,
    averageRestSeconds: restLaps.length ? Math.round(totalRestSeconds / restLaps.length) : null,
  };
}
