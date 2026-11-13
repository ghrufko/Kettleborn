import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, controls, fontFamily, fontSize, spacing } from '../../theme';
import type { Exercise } from '../../models';
import type { CustomHuntConfig, CustomHuntModel, PhaseModel, StepModel } from '../../utils/customHuntModel';
import { outerValue } from '../../utils/customHuntModel';

/**
 * Custom Hunt controls driven by the workout's CustomHuntModel
 * (src/utils/customHuntModel.ts):
 *
 *  - Chain/Complex workouts: one section per phase in authored order
 *    ("PHASE 1 — CHAIN", "PHASE 2 — COMPLEX"…) with its own cycle count and
 *    one reps stepper per movement — each movement shown once.
 *  - Round-based workouts: the round count, then one row per movement;
 *    left/right versions share a row with a stepper per side.
 *  - Ladders: the max rung.
 *
 * Values live in `config` (namespaced keys; a missing key = canonical) and
 * `structuralValue` (the outer rounds / max rung; null = canonical).
 */
interface Props {
  model: CustomHuntModel;
  structuralValue: number | null;
  onStructuralChange: (value: number | null) => void;
  config: CustomHuntConfig;
  onConfigChange: (config: CustomHuntConfig) => void;
  onExercisePress?: (exercise: Exercise) => void;
}

function Stepper({
  value,
  min,
  max,
  step = 1,
  suffix,
  onChange,
  compact = false,
  accessibilityLabel,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (next: number) => void;
  compact?: boolean;
  accessibilityLabel: string;
}) {
  return (
    <View style={styles.stepper}>
      <Pressable
        onPress={() => onChange(Math.max(min, value - step))}
        style={[styles.stepButton, compact && styles.stepButtonCompact]}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`Decrease ${accessibilityLabel}`}
      >
        <Ionicons name="remove" size={compact ? 14 : 16} color={colors.bronze.base} />
      </Pressable>
      <Text style={[styles.stepValue, compact && styles.stepValueCompact]}>{suffix ? `${value} ${suffix}` : value}</Text>
      <Pressable
        onPress={() => onChange(Math.min(max, value + step))}
        style={[styles.stepButton, compact && styles.stepButtonCompact]}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`Increase ${accessibilityLabel}`}
      >
        <Ionicons name="add" size={compact ? 14 : 16} color={colors.bronze.base} />
      </Pressable>
    </View>
  );
}

function setKey(config: CustomHuntConfig, key: string, value: number, canonical: number): CustomHuntConfig {
  const next = { ...config };
  if (value === canonical) delete next[key];
  else next[key] = value;
  return next;
}

function MovementName({ exercise, name, onPress }: { exercise: Exercise; name: string; onPress?: (exercise: Exercise) => void }) {
  return onPress ? (
    <Pressable onPress={() => onPress(exercise)} accessibilityRole="link" style={styles.nameLink}>
      <Text style={styles.rowLabel}>{name}</Text>
      <Ionicons name="information-circle-outline" size={15} color={colors.text.muted} />
    </Pressable>
  ) : (
    <Text style={[styles.rowLabel, styles.nameLink]}>{name}</Text>
  );
}

function PhaseControls({
  phase,
  config,
  onConfigChange,
  onExercisePress,
}: {
  phase: PhaseModel;
  config: CustomHuntConfig;
  onConfigChange: (config: CustomHuntConfig) => void;
  onExercisePress?: (exercise: Exercise) => void;
}) {
  const cycles = config[phase.cyclesKey] ?? phase.canonicalCycles;
  return (
    <View style={styles.phase}>
      <Text style={styles.phaseTitle}>
        Phase {phase.index + 1} — {phase.title}
      </Text>
      <View style={styles.row}>
        <Text style={styles.rowLabel}>{phase.kind === 'chain' ? 'Chain Cycles' : 'Complex Cycles'}</Text>
        <Stepper
          value={cycles}
          min={phase.minCycles}
          max={phase.maxCycles}
          onChange={(next) => onConfigChange(setKey(config, phase.cyclesKey, next, phase.canonicalCycles))}
          accessibilityLabel={`${phase.title} cycles`}
        />
      </View>
      <Text style={styles.subLabel}>Repetitions per {phase.kind === 'chain' ? 'cycle' : 'movement'}</Text>
      {phase.movements.map((movement) => (
        <View key={movement.key} style={styles.row}>
          <MovementName exercise={movement.exercise} name={movement.name} onPress={onExercisePress} />
          <Stepper
            value={config[movement.key] ?? movement.canonicalReps}
            min={1}
            max={Math.max(movement.canonicalReps * 3, 10)}
            onChange={(next) => onConfigChange(setKey(config, movement.key, next, movement.canonicalReps))}
            accessibilityLabel={`${movement.name} reps`}
          />
        </View>
      ))}
    </View>
  );
}

function stepLimits(step: StepModel) {
  return step.unit === 'steps'
    ? { min: 5, max: Math.max(step.canonicalAmount * 4, 200), step: 5 }
    : { min: 1, max: Math.max(step.canonicalAmount * 3, 20), step: 1 };
}

export function CustomHuntControls({
  model,
  structuralValue,
  onStructuralChange,
  config,
  onConfigChange,
  onExercisePress,
}: Props) {
  const outer = model.outer;
  const outerControl = outer ? (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{outer.label}</Text>
      <Stepper
        value={outerValue(model, structuralValue) ?? outer.canonical}
        min={outer.min}
        max={outer.max}
        onChange={(next) => onStructuralChange(next === outer.canonical ? null : next)}
        accessibilityLabel={outer.label}
      />
    </View>
  ) : null;

  if (model.kind === 'ladder') {
    return outerControl;
  }

  if (model.kind === 'phased') {
    return (
      <>
        {outerControl}
        {model.phases.map((phase) => (
          <PhaseControls
            key={phase.cyclesKey}
            phase={phase}
            config={config}
            onConfigChange={onConfigChange}
            onExercisePress={onExercisePress}
          />
        ))}
      </>
    );
  }

  let lastGroup: string | null = null;
  return (
    <>
      {outerControl}
      {model.rows.length > 0 ? <Text style={styles.subLabel}>Repetitions</Text> : null}
      {model.rows.map((row) => {
        const header = row.groupLabel && row.groupLabel !== lastGroup ? row.groupLabel : null;
        lastGroup = row.groupLabel;
        const single = row.steps.length === 1 && !row.steps[0].side;
        return (
          <View key={row.steps.map((s) => s.key).join('+')}>
            {header ? <Text style={styles.phaseTitle}>{header}</Text> : null}
            {single ? (
              <View style={styles.row}>
                <MovementName exercise={row.steps[0].exercise} name={row.name} onPress={onExercisePress} />
                {(() => {
                  const step = row.steps[0];
                  const limits = stepLimits(step);
                  return (
                    <Stepper
                      value={config[step.key] ?? step.canonicalAmount}
                      min={limits.min}
                      max={limits.max}
                      step={limits.step}
                      suffix={step.unit === 'steps' ? 'steps' : undefined}
                      onChange={(next) => onConfigChange(setKey(config, step.key, next, step.canonicalAmount))}
                      accessibilityLabel={`${row.name} ${step.unit}`}
                    />
                  );
                })()}
              </View>
            ) : (
              <View style={styles.sidedRow}>
                <MovementName exercise={row.steps[0].exercise} name={row.name} onPress={onExercisePress} />
                <View style={styles.sides}>
                  {row.steps.map((step) => {
                    const limits = stepLimits(step);
                    return (
                      <View key={step.key} style={styles.side}>
                        <Text style={styles.sideLabel}>{step.sideLabel ?? ''}</Text>
                        <Stepper
                          compact
                          value={config[step.key] ?? step.canonicalAmount}
                          min={limits.min}
                          max={limits.max}
                          step={limits.step}
                          onChange={(next) => onConfigChange(setKey(config, step.key, next, step.canonicalAmount))}
                          accessibilityLabel={`${row.name} ${step.sideLabel ?? ''} ${step.unit}`}
                        />
                      </View>
                    );
                  })}
                </View>
              </View>
            )}
          </View>
        );
      })}
    </>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  nameLink: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.xxs, marginRight: spacing.sm },
  rowLabel: { flexShrink: 1, fontFamily: fontFamily.bodyRegular, fontSize: fontSize.sm, color: colors.text.primary },
  subLabel: {
    marginTop: spacing.sm,
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.xs,
    color: colors.text.muted,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  phase: {
    marginTop: spacing.sm,
    paddingTop: spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border.hairlineStrong,
  },
  phaseTitle: {
    marginTop: spacing.sm,
    fontFamily: fontFamily.displayRegular,
    fontSize: fontSize.xs,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: colors.bronze.active,
  },
  sidedRow: { marginTop: spacing.sm },
  sides: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.xxs },
  side: { flexDirection: 'row', alignItems: 'center', gap: spacing.xxs },
  sideLabel: { fontFamily: fontFamily.monoRegular, fontSize: fontSize.xs, color: colors.bronze.active },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  stepButton: { ...controls.stepButton },
  stepButtonCompact: { ...controls.stepButtonCompact },
  stepValue: { minWidth: 36, textAlign: 'center', fontFamily: fontFamily.monoBold, fontSize: fontSize.base, color: colors.text.primary },
  stepValueCompact: { minWidth: 24, fontSize: fontSize.sm },
});
