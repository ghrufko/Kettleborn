import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, fontFamily, fontSize, radii, spacing } from '../../theme';

export interface TrendBarChartPoint {
  resultId: string;
  completedAt: string;
  value: number;
  isPersonalBestAtTime: boolean;
}

interface TrendBarChartProps {
  points: TrendBarChartPoint[];
  /** Most recent N points shown, oldest-to-newest left-to-right within that window — keeps the chart readable on a narrow phone screen without horizontal scrolling. */
  maxPoints?: number;
  formatValue: (value: number) => string;
  /** Label for the single best value highlighted in gold — e.g. "Fastest" or "Most Rounds". */
  bestLabel: string;
  /** Whether a larger `value` is the better outcome (rounds completed) or a smaller one is (elapsed seconds). Only affects which end of the series is picked out as "best" — bar height always tracks the raw value directly either way. */
  higherIsBetter: boolean;
  caption: string;
  emptyText: string;
  insufficientText: string;
  /** Noun for the overflow note ("Showing your N most recent ___") — e.g. "clears" or "EMOM attempts". */
  overflowNoun: string;
}

const TRACK_HEIGHT = 96;
const MIN_BAR_HEIGHT_RATIO = 0.22;

function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Phase 2.9/2.10: the shared rendering engine behind both
 * `DurationTrendChart` and `RoundsTrendChart` — plain Views only, no
 * chart library. Metric-agnostic: callers supply already-comparable,
 * chronologically-sorted points (from `getDurationTrendSeries` or
 * `getRoundsTrendSeries`) plus how to format/label/orient them. Not
 * exported from the barrel — `DurationTrendChart`/`RoundsTrendChart` are
 * the public API, each a thin, metric-specific wrapper around this.
 */
export function TrendBarChart({
  points,
  maxPoints = 8,
  formatValue,
  bestLabel,
  higherIsBetter,
  caption,
  emptyText,
  insufficientText,
  overflowNoun,
}: TrendBarChartProps) {
  if (points.length < 2) {
    return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyText}>{points.length === 0 ? emptyText : insufficientText}</Text>
      </View>
    );
  }

  const windowed = points.slice(-maxPoints);
  const windowedValues = windowed.map((p) => p.value);
  const minValue = Math.min(...windowedValues);
  const maxValue = Math.max(...windowedValues);
  const allValues = points.map((p) => p.value);
  const bestValue = higherIsBetter ? Math.max(...allValues) : Math.min(...allValues);
  const latest = windowed[windowed.length - 1];
  const hiddenEarlierCount = points.length - windowed.length;

  const barHeight = (value: number) => {
    if (maxValue === minValue) {
      return TRACK_HEIGHT * 0.6;
    }
    const ratio = (value - minValue) / (maxValue - minValue);
    return TRACK_HEIGHT * (MIN_BAR_HEIGHT_RATIO + (1 - MIN_BAR_HEIGHT_RATIO) * ratio);
  };

  return (
    <View>
      <View style={styles.summaryRow}>
        <Text style={styles.summaryText}>
          {bestLabel} <Text style={styles.summaryValue}>{formatValue(bestValue)}</Text>
        </Text>
        <Text style={styles.summaryText}>
          Latest <Text style={styles.summaryValue}>{formatValue(latest.value)}</Text>
        </Text>
      </View>

      <View style={styles.track}>
        {windowed.map((point) => {
          const isBestShown = point.value === bestValue;
          const isLatest = point.resultId === latest.resultId;
          return (
            <View key={point.resultId} style={styles.barColumn}>
              <View
                style={[
                  styles.bar,
                  { height: barHeight(point.value) },
                  isBestShown && styles.barBest,
                  isLatest && !isBestShown && styles.barLatest,
                ]}
              />
            </View>
          );
        })}
      </View>

      <View style={styles.axisRow}>
        <Text style={styles.axisLabel}>{formatShortDate(windowed[0].completedAt)}</Text>
        <Text style={styles.axisLabel}>{formatShortDate(latest.completedAt)}</Text>
      </View>

      <Text style={styles.caption}>
        {caption} {hiddenEarlierCount > 0 ? `Showing your ${windowed.length} most recent comparable ${overflowNoun}.` : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  summaryText: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.sm,
    color: colors.text.secondary,
  },
  summaryValue: {
    fontFamily: fontFamily.monoBold,
    color: colors.text.primary,
  },
  track: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    height: TRACK_HEIGHT,
  },
  barColumn: {
    flex: 1,
    alignItems: 'center',
  },
  bar: {
    width: '60%',
    minWidth: 10,
    maxWidth: 28,
    backgroundColor: colors.bronze.base,
    borderRadius: radii.sm,
  },
  barBest: {
    backgroundColor: colors.gold,
  },
  barLatest: {
    borderWidth: 2,
    borderColor: colors.ember.base,
  },
  axisRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.xxs,
  },
  axisLabel: {
    fontFamily: fontFamily.monoRegular,
    fontSize: fontSize.xs,
    color: colors.text.muted,
  },
  caption: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.xs,
    color: colors.text.muted,
    fontStyle: 'italic',
    marginTop: spacing.xs,
  },
  emptyState: {
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  emptyText: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.sm,
    color: colors.text.muted,
    textAlign: 'center',
  },
});
