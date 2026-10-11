import React from 'react';
import { TrendBarChart } from './TrendBarChart';
import type { RoundsTrendPoint } from '../../utils/performanceHistory';

interface RoundsTrendChartProps {
  points: RoundsTrendPoint[];
  /** Most recent N points shown, oldest-to-newest left-to-right within that window — keeps the chart readable on a narrow phone screen without horizontal scrolling. */
  maxPoints?: number;
}

function formatRounds(rounds: number): string {
  return `${rounds} round${rounds === 1 ? '' : 's'}`;
}

/**
 * Phase 2.10: the EMOM/open-ended companion to `DurationTrendChart` —
 * same shared `TrendBarChart` engine, but plotting rounds completed
 * instead of elapsed time, and oriented the opposite way: MORE rounds is
 * the better outcome here (`higherIsBetter`), so the tallest bar is the
 * best one, not the shortest. `points` must already be the comparable,
 * chronologically-sorted series from `getRoundsTrendSeries` — this
 * component trusts that filtering, it doesn't repeat it. Never labels a
 * round count as a time value.
 */
export function RoundsTrendChart({ points, maxPoints = 8 }: RoundsTrendChartProps) {
  return (
    <TrendBarChart
      points={points.map((p) => ({
        resultId: p.resultId,
        completedAt: p.completedAt,
        value: p.rounds,
        isPersonalBestAtTime: p.isPersonalBestAtTime,
      }))}
      maxPoints={maxPoints}
      formatValue={formatRounds}
      bestLabel="Most Rounds"
      higherIsBetter
      caption="Taller bar = more rounds completed."
      emptyText="No comparable EMOM attempts recorded yet."
      insufficientText="Complete this Hunt again to start a progress trend."
      overflowNoun="EMOM attempts"
    />
  );
}
