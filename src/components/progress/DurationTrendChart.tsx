import React from 'react';
import { TrendBarChart } from './TrendBarChart';
import type { DurationTrendPoint } from '../../utils/performanceHistory';

interface DurationTrendChartProps {
  points: DurationTrendPoint[];
  /** Most recent N points shown, oldest-to-newest left-to-right within that window — keeps the chart readable on a narrow phone screen without horizontal scrolling. */
  maxPoints?: number;
}

// Same per-file-local formatter every other screen in this codebase
// already has its own copy of (HuntOverviewScreen, MonsterDetailScreen,
// HunterScreen, HuntCompleteScreen) — not extracted to a shared util,
// matching that existing convention rather than an unrelated refactor.
function formatSecondsClock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Phase 2.9: a lightweight completion-time trend chart — a thin,
 * duration-specific wrapper around the shared `TrendBarChart` renderer
 * (Phase 2.10 extracted that shared engine when `RoundsTrendChart` was
 * added; this component's own props and visible behavior are unchanged).
 * `points` must already be the comparable, chronologically-sorted series
 * from `getDurationTrendSeries` — this component trusts that filtering,
 * it doesn't repeat it. Bar height is DIRECTLY proportional to elapsed
 * seconds — shorter bar reads as "faster clear," the intuitive direction
 * for "getting better" — with the fastest clear in the shown window
 * picked out in gold and the most recent attempt outlined.
 */
export function DurationTrendChart({ points, maxPoints = 8 }: DurationTrendChartProps) {
  return (
    <TrendBarChart
      points={points.map((p) => ({
        resultId: p.resultId,
        completedAt: p.completedAt,
        value: p.seconds,
        isPersonalBestAtTime: p.isPersonalBestAtTime,
      }))}
      maxPoints={maxPoints}
      formatValue={formatSecondsClock}
      bestLabel="Fastest"
      higherIsBetter={false}
      caption="Shorter bar = faster clear."
      emptyText="No comparable clears recorded yet."
      insufficientText="Complete this Hunt again to start a progress trend."
      overflowNoun="clears"
    />
  );
}
