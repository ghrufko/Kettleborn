import type { Exercise, Workout } from '../models';
import { getWorkoutActualExercises } from './workoutPresentation';

/**
 * Custom Hunt configuration model (Correction Sprint 2).
 *
 * One reusable description of "what a player can change in this workout",
 * derived from the workout's own content — never a monster-id check:
 *
 *  - 'phased': workouts authored as Chain / Complex phases, recognised from
 *    the content's own "(Chain p/N)" and "(Complex ×N)" step labels. Each
 *    phase has its own cycle count (Chain passes, or Complex repeats —
 *    Exercise.cycles) and its own per-movement reps, so The Sovereign's
 *    Chain → Complex and The Rite's Chain → Complex → Chain are configured
 *    phase by phase, each movement shown once. Outer rounds (The Rite's 5
 *    rounds) are a separate control.
 *  - 'template': every other round-based workout. One round (or one
 *    left/right cycle) is the template, shown once with its round count
 *    separately; each step's reps (or a carry's steps) are set per step.
 *    Left/right versions of the same movement share one row ("Swing —
 *    Left 1 / Right 1"), keeping the authored alternating order.
 *  - 'ladder': a rung ladder — its reps are the rung numbers; only the
 *    max rung is configurable (unchanged from before).
 *
 * A configuration is stored in the existing Custom Hunt fields — the outer
 * value in customStructureValue / structuralValueUsed, everything else in
 * repsOverrides / repsOverridesUsed under namespaced keys
 * ("phase.0.cycles", "phase.0.reps.2", "step.4") plus a format marker
 * (CONFIG_VERSION_KEY). Configurations saved before this model (no
 * marker) keep being read by the original builder, so every existing
 * Custom Hunt result and preset reads exactly as it did — see
 * buildCustomWorkout in customWorkoutStructure.ts.
 */

export const CONFIG_VERSION_KEY = '__v';
export const CONFIG_VERSION = 2;

export type CustomHuntConfig = Record<string, number>;

export function isModelConfig(overrides: Record<string, number> | null | undefined): boolean {
  return !!overrides && overrides[CONFIG_VERSION_KEY] === CONFIG_VERSION;
}

// ------------------------------------------------------------------ labels

const CHAIN_SUFFIX = /\s*\(Chain (\d+)\/(\d+)\)\s*$/i;
const COMPLEX_SUFFIX = /\s*\(Complex\s*[×x]\s*(\d+)\)\s*$/i;
const SIDE_PREFIX = /^\s*(left|right)(?:\s+(?:hand|side))?\s*[·:-]\s*/i;
const SIDE_ARROW = /\s*→\s*(left|right)\s*$/i;

function label(exercise: Exercise): string {
  return exercise.displayName ?? exercise.name;
}
function chainPass(exercise: Exercise): { pass: number; count: number } | null {
  const match = label(exercise).match(CHAIN_SUFFIX);
  return match ? { pass: Number(match[1]), count: Number(match[2]) } : null;
}
function isComplexStep(exercise: Exercise): boolean {
  return COMPLEX_SUFFIX.test(label(exercise));
}
/** The movement's own name: no Chain/Complex suffix, no side prefix or arrow. */
export function baseMovementName(exercise: Exercise): string {
  return label(exercise).replace(CHAIN_SUFFIX, '').replace(COMPLEX_SUFFIX, '').replace(SIDE_PREFIX, '').replace(SIDE_ARROW, '').trim();
}

// ------------------------------------------------------------------ model types

export interface OuterControl {
  label: string;
  canonical: number;
  min: number;
  max: number;
}

export interface PhaseMovementModel {
  /** Config key for this movement's reps within its phase. */
  key: string;
  /** The movement as authored in the phase's first pass/cycle. */
  exercise: Exercise;
  name: string;
  canonicalReps: number;
}

export interface PhaseModel {
  index: number;
  kind: 'chain' | 'complex';
  /** "Chain", "Complex", "Opening Chain", "Closing Chain"… */
  title: string;
  cyclesKey: string;
  canonicalCycles: number;
  minCycles: number;
  maxCycles: number;
  movements: PhaseMovementModel[];
}

export interface PhasedModel {
  kind: 'phased';
  /**
   * 'pass-rounds': every Chain pass and the Complex block is its own
   * session round, with rest between (The Sovereign, The Risen).
   * 'inline': each outer round contains all phases back to back (The Rite).
   */
  layout: 'pass-rounds' | 'inline';
  outer: OuterControl | null;
  phases: PhaseModel[];
  /** Section/round labels to keep for an inline workout's rounds. */
  roundLabelSuffix: string | null;
}

export interface StepModel {
  key: string;
  exercise: Exercise;
  unit: 'reps' | 'steps';
  canonicalAmount: number;
  side: 'left' | 'right' | null;
  /** "Left", "Right", "Left → Right"… for a sided step. */
  sideLabel: string | null;
}

export interface StepRow {
  name: string;
  /** The section/phase this row belongs to, for a workout of distinct sections (Behemoth). */
  groupLabel: string | null;
  steps: StepModel[];
}

export interface TemplateModel {
  kind: 'template';
  /** How the template repeats: none (fixed sections), a flat round list, or a cycle of sections. */
  shape: 'flat' | 'cycle' | 'fixed';
  outer: OuterControl | null;
  /** Sections of one cycle ('cycle'), or every section ('fixed'). Empty for 'flat'. */
  sectionCount: number;
  rows: StepRow[];
  /** Every customizable step in template order (rows regroup these). */
  steps: StepModel[];
}

export interface LadderModel {
  kind: 'ladder';
  outer: OuterControl;
}

export type CustomHuntModel = PhasedModel | TemplateModel | LadderModel;

// ------------------------------------------------------------------ phases

interface ParsedPhase {
  kind: 'chain' | 'complex';
  cycles: number;
  movements: Exercise[];
}

/** Splits a sequence of steps into Chain/Complex phases; null if any step is neither. */
function parsePhases(steps: Exercise[]): ParsedPhase[] | null {
  const phases: ParsedPhase[] = [];
  let i = 0;
  while (i < steps.length) {
    const info = chainPass(steps[i]);
    if (info && info.pass === 1) {
      const count = info.count;
      const firstPass: Exercise[] = [];
      while (i < steps.length && chainPass(steps[i])?.pass === 1 && chainPass(steps[i])?.count === count) {
        firstPass.push(steps[i++]);
      }
      for (let pass = 2; pass <= count; pass += 1) {
        for (let m = 0; m < firstPass.length; m += 1) {
          const next = steps[i];
          if (!next || chainPass(next)?.pass !== pass || baseMovementName(next) !== baseMovementName(firstPass[m])) {
            return null;
          }
          i += 1;
        }
      }
      phases.push({ kind: 'chain', cycles: count, movements: firstPass });
      continue;
    }
    if (isComplexStep(steps[i])) {
      const block: Exercise[] = [];
      while (i < steps.length && isComplexStep(steps[i])) block.push(steps[i++]);
      phases.push({ kind: 'complex', cycles: block[0].cycles ?? 1, movements: block });
      continue;
    }
    return null;
  }
  return phases.length > 0 ? phases : null;
}

function phaseSignature(phases: ParsedPhase[]): string {
  return phases.map((p) => `${p.kind}:${p.cycles}:${p.movements.map(baseMovementName).join(',')}`).join('|');
}

function phaseTitles(phases: ParsedPhase[]): string[] {
  const chains = phases.filter((p) => p.kind === 'chain').length;
  const complexes = phases.filter((p) => p.kind === 'complex').length;
  let chainSeen = 0;
  let complexSeen = 0;
  return phases.map((p) => {
    if (p.kind === 'chain') {
      chainSeen += 1;
      if (chains === 2) return chainSeen === 1 ? 'Opening Chain' : 'Closing Chain';
      return chains > 2 ? `Chain ${chainSeen}` : 'Chain';
    }
    complexSeen += 1;
    return complexes > 1 ? `Complex ${complexSeen}` : 'Complex';
  });
}

function getPhasedModel(workout: Workout): PhasedModel | null {
  let parsed: ParsedPhase[] | null = null;
  let layout: PhasedModel['layout'] = 'pass-rounds';
  let outer: OuterControl | null = null;
  let roundLabelSuffix: string | null = null;

  const sections = workout.sections;
  if (sections && sections.length > 1) {
    // Every section a complete, identical set of phases (The Rite: each of
    // its 5 rounds is Chain ×3 → Complex → Chain ×3). A workout whose
    // sections are single passes (The Risen) doesn't parse per section and
    // falls through to the whole-workout parse below.
    const perSection = sections.map((section) => parsePhases(section.exercises));
    const allInline =
      perSection.every((p) => p !== null) &&
      perSection.every((p) => phaseSignature(p!) === phaseSignature(perSection[0]!));
    if (allInline) {
      parsed = perSection[0]!;
      layout = 'inline';
      outer = { label: 'Rounds', canonical: sections.length, min: 1, max: sections.length * 2 };
      const suffix = sections[0].label.replace(/^Round\s+\d+\s*[—-]\s*/i, '').trim();
      roundLabelSuffix = suffix && suffix !== sections[0].label ? suffix : null;
    }
  }
  if (!parsed) {
    parsed = parsePhases(getWorkoutActualExercises(workout, workout.rounds));
    layout = 'pass-rounds';
  }
  if (!parsed) return null;

  const titles = phaseTitles(parsed);
  return {
    kind: 'phased',
    layout,
    outer,
    roundLabelSuffix,
    phases: parsed.map((phase, index) => ({
      index,
      kind: phase.kind,
      title: titles[index],
      cyclesKey: `phase.${index}.cycles`,
      canonicalCycles: phase.cycles,
      minCycles: 1,
      maxCycles: Math.max(phase.cycles * 2, 5),
      movements: phase.movements.map((exercise, m) => ({
        key: `phase.${index}.reps.${m}`,
        exercise,
        name: baseMovementName(exercise),
        canonicalReps: exercise.targetReps ?? 1,
      })),
    })),
  };
}

// ------------------------------------------------------------------ template

/** "Round 1 — Left Hand" / "Left Hand" → 'left'; a label that only mentions a hand mid-sentence → null. */
function sectionSide(label: string | null | undefined): 'left' | 'right' | null {
  const match = label?.match(/(?:^|[—–-]\s*)(left|right)\s+(?:hand|side)\s*$/i);
  return match ? (match[1].toLowerCase() as 'left' | 'right') : null;
}

// The side is part of a section's identity: The Fallen's Left Hand and
// Right Hand sections list the same movements but are different halves of
// a round, so its repeating unit is the (Left, Right) pair, not one side.
function sectionSignature(section: { label?: string; exercises: Exercise[] }): string {
  return `${sectionSide(section.label) ?? ''}:${section.exercises.map((e) => e.name).join('|')}`;
}

/** Smallest k (1 ≤ k ≤ n/2, k | n) whose blocks of k sections repeat identically; null if none. */
function repeatingCycleLength(sections: { label?: string; exercises: Exercise[] }[]): number | null {
  const n = sections.length;
  const signatures = sections.map(sectionSignature);
  for (let k = 1; k <= Math.floor(n / 2); k += 1) {
    if (n % k !== 0) continue;
    const first = signatures.slice(0, k).join(',');
    let matches = true;
    for (let start = k; start < n; start += k) {
      if (signatures.slice(start, start + k).join(',') !== first) {
        matches = false;
        break;
      }
    }
    if (matches) return k;
  }
  return null;
}

function stepSide(exercise: Exercise, sectionLabel: string | null): { side: 'left' | 'right' | null; sideLabel: string | null } {
  const prefix = label(exercise).match(SIDE_PREFIX) ?? (exercise.sequenceGroup ? `${exercise.sequenceGroup} ·`.match(SIDE_PREFIX) : null);
  const raw = (prefix?.[1] ?? sectionSide(sectionLabel) ?? '').toLowerCase();
  if (raw !== 'left' && raw !== 'right') return { side: null, sideLabel: null };
  const arrow = label(exercise).match(SIDE_ARROW)?.[1]?.toLowerCase();
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  return { side: raw, sideLabel: arrow ? `${cap(raw)} → ${cap(arrow)}` : cap(raw) };
}

function amountOf(exercise: Exercise): { unit: 'reps' | 'steps'; amount: number } | null {
  if (exercise.targetReps) return { unit: 'reps', amount: exercise.targetReps };
  if (exercise.targetSteps) return { unit: 'steps', amount: exercise.targetSteps };
  return null;
}

/** Groups steps into display rows: a left step and the right step of the same movement share a row. */
function groupRows(steps: StepModel[], groupLabelOf: (step: StepModel) => string | null): StepRow[] {
  const rows: StepRow[] = [];
  for (const step of steps) {
    const name = baseMovementName(step.exercise);
    const group = groupLabelOf(step);
    if (step.side) {
      const partner = rows.find(
        (row) =>
          row.groupLabel === group &&
          row.name === name &&
          row.steps.length === 1 &&
          row.steps[0].side !== null &&
          row.steps[0].side !== step.side
      );
      if (partner) {
        partner.steps.push(step);
        continue;
      }
    }
    rows.push({ name, groupLabel: group, steps: [step] });
  }
  return rows;
}

function getTemplateModel(workout: Workout): TemplateModel {
  const sections = workout.sections;
  if (!sections || sections.length === 0) {
    const steps = workout.exercises.flatMap((exercise, i) => {
      const amount = amountOf(exercise);
      if (!amount) return [];
      return [{ key: `step.${i}`, exercise, unit: amount.unit, canonicalAmount: amount.amount, ...stepSide(exercise, null) }];
    });
    return {
      kind: 'template',
      shape: 'flat',
      outer: { label: 'Rounds', canonical: workout.rounds, min: 1, max: workout.rounds * 2 },
      sectionCount: 0,
      steps,
      rows: groupRows(steps, () => null),
    };
  }
  const k = sections.length > 1 ? repeatingCycleLength(sections) : null;
  const templateSections = k !== null ? sections.slice(0, k) : sections;
  const sectionOf = new Map<string, string | null>();
  let index = 0;
  const steps: StepModel[] = [];
  templateSections.forEach((section) => {
    section.exercises.forEach((exercise) => {
      const i = index++;
      const amount = amountOf(exercise);
      if (!amount) return;
      const step: StepModel = {
        key: `step.${i}`,
        exercise,
        unit: amount.unit,
        canonicalAmount: amount.amount,
        ...stepSide(exercise, section.label),
      };
      sectionOf.set(step.key, section.label);
      steps.push(step);
    });
  });
  if (k !== null) {
    const cycles = sections.length / k;
    return {
      kind: 'template',
      shape: 'cycle',
      outer: { label: 'Rounds', canonical: cycles, min: 1, max: cycles * 2 },
      sectionCount: k,
      steps,
      // One cycle shown once: left/right sections of the same round pair up.
      rows: groupRows(steps, () => null),
    };
  }
  return {
    kind: 'template',
    shape: 'fixed',
    outer: null,
    sectionCount: sections.length,
    steps,
    rows: groupRows(steps, (step) => sectionOf.get(step.key) ?? null),
  };
}

// ------------------------------------------------------------------ public API

export function getCustomHuntModel(workout: Workout): CustomHuntModel {
  if (workout.stepLabel === 'Rung') {
    const canonicalMaxRung = Math.ceil((workout.rounds + 1) / 2);
    return { kind: 'ladder', outer: { label: 'Max Rung', canonical: canonicalMaxRung, min: 3, max: canonicalMaxRung * 2 } };
  }
  return getPhasedModel(workout) ?? getTemplateModel(workout);
}

/** The outer control's value in a config, or its canonical value. */
export function outerValue(model: CustomHuntModel, structuralValue: number | null | undefined): number | null {
  if (!model.outer) return null;
  const value = structuralValue ?? model.outer.canonical;
  return Math.min(model.outer.max, Math.max(model.outer.min, Math.round(value)));
}

function configValue(config: CustomHuntConfig, key: string, fallback: number, min: number, max: number): number {
  const raw = config[key];
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, Math.round(raw)));
}

/** Sets a step's amount (reps, or a carry's steps), scaling the damage terms that don't scale on their own. */
function withAmount(exercise: Exercise, unit: 'reps' | 'steps', amount: number): Exercise {
  const current = unit === 'reps' ? exercise.targetReps : exercise.targetSteps;
  if (!current || amount === current) return exercise;
  const ratio = amount / current;
  const next: Exercise = unit === 'reps' ? { ...exercise, targetReps: amount } : { ...exercise, targetSteps: amount };
  if (exercise.damageType === 'flat') {
    next.damageCoefficient = Math.max(1, Math.round(exercise.damageCoefficient * ratio));
  }
  if (unit === 'steps' && exercise.durationSeconds !== undefined) {
    next.durationSeconds = Math.max(1, Math.round(exercise.durationSeconds * ratio));
  }
  return next;
}

function withSuffix(exercise: Exercise, suffix: string): string {
  return `${baseMovementName(exercise)} ${suffix}`;
}

function buildPhased(workout: Workout, model: PhasedModel, structuralValue: number | null, config: CustomHuntConfig): Workout {
  const phases = model.phases.map((phase) => ({
    phase,
    cycles: configValue(config, phase.cyclesKey, phase.canonicalCycles, phase.minCycles, phase.maxCycles),
    movements: phase.movements.map((m) => ({
      exercise: m.exercise,
      reps: configValue(config, m.key, m.canonicalReps, 1, Math.max(m.canonicalReps * 3, 10)),
    })),
  }));

  const chainPass = (pi: number, pass: number, cycles: number, tag: string) =>
    phases[pi].movements.map(({ exercise, reps }) => ({
      ...withAmount(exercise, 'reps', reps),
      id: `${exercise.id}-ph${pi}-p${pass}${tag}`,
      displayName: withSuffix(exercise, `(Chain ${pass}/${cycles})`),
      cycles: undefined,
      previousVersion: undefined,
    }));
  const complexBlock = (pi: number, cycles: number, tag: string) =>
    phases[pi].movements.map(({ exercise, reps }) => ({
      ...withAmount(exercise, 'reps', reps),
      id: `${exercise.id}-ph${pi}-cx${tag}`,
      displayName: withSuffix(exercise, `(Complex ×${reps})`),
      cycles: cycles > 1 ? cycles : undefined,
      previousVersion: undefined,
    }));

  let sections: { label: string; exercises: Exercise[] }[];
  if (model.layout === 'pass-rounds') {
    sections = [];
    phases.forEach(({ phase, cycles }, pi) => {
      if (phase.kind === 'chain') {
        for (let pass = 1; pass <= cycles; pass += 1) {
          sections.push({ label: `${phase.title} · Pass ${pass}/${cycles}`, exercises: chainPass(pi, pass, cycles, '') });
        }
      } else {
        sections.push({ label: cycles > 1 ? `${phase.title} · ${cycles} cycles` : phase.title, exercises: complexBlock(pi, cycles, '') });
      }
    });
  } else {
    const rounds = outerValue(model, structuralValue) ?? 1;
    const summary = phases.map(({ phase, cycles }) => (phase.kind === 'chain' ? `Chain ×${cycles}` : cycles > 1 ? `Complex ×${cycles}` : 'Complex')).join(' → ');
    sections = Array.from({ length: rounds }, (_, r) => ({
      label: `Round ${r + 1} — ${summary}`,
      exercises: phases.flatMap(({ phase, cycles }, pi) =>
        phase.kind === 'chain'
          ? Array.from({ length: cycles }, (_, p) => chainPass(pi, p + 1, cycles, `-r${r + 1}`)).flat()
          : complexBlock(pi, cycles, `-r${r + 1}`)
      ),
    }));
  }
  return finish(workout, { ...workout, rounds: sections.length, sections, exercises: sections[0].exercises });
}

function buildTemplate(workout: Workout, model: TemplateModel, structuralValue: number | null, config: CustomHuntConfig): Workout {
  const amountFor = (step: StepModel) =>
    configValue(config, step.key, step.canonicalAmount, step.unit === 'steps' ? 5 : 1, step.unit === 'steps' ? Math.max(step.canonicalAmount * 4, 200) : Math.max(step.canonicalAmount * 3, 20));
  const stepByIndex = new Map(model.steps.map((step) => [Number(step.key.slice('step.'.length)), step]));
  const apply = (exercise: Exercise, index: number) => {
    const step = stepByIndex.get(index);
    return step ? withAmount(exercise, step.unit, amountFor(step)) : exercise;
  };

  if (model.shape === 'flat') {
    const rounds = outerValue(model, structuralValue) ?? workout.rounds;
    return finish(workout, { ...workout, rounds, exercises: workout.exercises.map(apply) });
  }

  const source = workout.sections!;
  if (model.shape === 'fixed') {
    let index = 0;
    const sections = source.map((section) => ({
      ...section,
      exercises: section.exercises.map((exercise) => apply(exercise, index++)),
    }));
    return finish(workout, { ...workout, sections, exercises: sections[0].exercises });
  }

  const cycles = outerValue(model, structuralValue) ?? source.length / model.sectionCount;
  const base = source.slice(0, model.sectionCount);
  let index = 0;
  const baseCycle = base.map((section) => ({
    ...section,
    exercises: section.exercises.map((exercise) => apply(exercise, index++)),
  }));
  const sections: { label: string; exercises: Exercise[] }[] = [];
  for (let cycle = 0; cycle < cycles; cycle += 1) {
    baseCycle.forEach((section) => {
      sections.push({
        label: /^Round\s+\d+/i.test(section.label)
          ? section.label.replace(/^Round\s+\d+/i, `Round ${cycle + 1}`)
          : cycle === 0
            ? section.label
            : `${section.label} (Round ${cycle + 1})`,
        exercises: section.exercises.map((exercise) => ({ ...exercise, id: `${exercise.id}-c${cycle}` })),
      });
    });
  }
  return finish(workout, { ...workout, rounds: sections.length, sections, exercises: sections[0].exercises });
}

function buildLadderRungs(workout: Workout, maxRung: number): Workout {
  const template = workout.sections![0].exercises;
  const rungs = [...Array.from({ length: maxRung }, (_, i) => i + 1), ...Array.from({ length: maxRung - 1 }, (_, i) => maxRung - 1 - i)];
  const sections = rungs.map((rung, index) => ({
    label: `Rung ${rung}`,
    exercises: template.map((e) => ({ ...e, id: `${e.id}-custom-${index}`, targetReps: rung })),
  }));
  return finish(workout, { ...workout, rounds: sections.length, sections, exercises: sections[0].exercises });
}

/** Total work (reps × cycles, carry steps) — the proportion the target time scales by. */
function totalWork(workout: Workout): number {
  return getWorkoutActualExercises(workout, workout.rounds).reduce(
    (sum, e) => sum + ((e.targetReps ?? 0) + (e.targetSteps ?? 0) / 10) * (e.cycles ?? 1),
    0
  );
}

function finish(canonical: Workout, built: Workout): Workout {
  const canonicalWork = totalWork(canonical);
  const ratio = canonicalWork > 0 ? totalWork(built) / canonicalWork : 1;
  return { ...built, targetTimeSeconds: Math.max(1, Math.round(canonical.targetTimeSeconds * ratio)) };
}

/**
 * The workout a model configuration describes. Never mutates `workout`.
 * `structuralValue` is the outer control (rounds / max rung), `config`
 * the namespaced phase/step values (a missing key = canonical).
 */
export function buildWorkoutFromModel(workout: Workout, structuralValue: number | null, config: CustomHuntConfig): Workout {
  const model = getCustomHuntModel(workout);
  if (model.kind === 'ladder') {
    return buildLadderRungs(workout, outerValue(model, structuralValue) ?? model.outer.canonical);
  }
  return model.kind === 'phased'
    ? buildPhased(workout, model, structuralValue, config)
    : buildTemplate(workout, model, structuralValue, config);
}

/** True when a model config changes nothing (canonical outer value, no amount/cycle changes). */
export function isCanonicalConfig(workout: Workout, structuralValue: number | null, config: CustomHuntConfig): boolean {
  const model = getCustomHuntModel(workout);
  const outer = model.outer ? outerValue(model, structuralValue) : null;
  if (model.outer && outer !== model.outer.canonical) return false;
  return Object.keys(config).every((key) => key === CONFIG_VERSION_KEY);
}

/** Human-readable description of a model config's non-canonical values, for the locked panel. */
export function describeConfig(
  workout: Workout,
  config: CustomHuntConfig
): { key: string; label: string; value: string }[] {
  const model = getCustomHuntModel(workout);
  const rows: { key: string; label: string; value: string }[] = [];
  if (model.kind === 'phased') {
    model.phases.forEach((phase) => {
      if (config[phase.cyclesKey] !== undefined) {
        rows.push({ key: phase.cyclesKey, label: `${phase.title} cycles`, value: `${config[phase.cyclesKey]}` });
      }
      phase.movements.forEach((m) => {
        if (config[m.key] !== undefined) rows.push({ key: m.key, label: `${phase.title} · ${m.name}`, value: `${config[m.key]} reps` });
      });
    });
  } else if (model.kind === 'template') {
    model.rows.forEach((row) =>
      row.steps.forEach((step) => {
        if (config[step.key] === undefined) return;
        const name = step.sideLabel ? `${row.name} (${step.sideLabel})` : row.name;
        rows.push({
          key: step.key,
          label: row.groupLabel ? `${row.groupLabel.split(/\s+[—–-]\s+/)[0]} · ${name}` : name,
          value: `${config[step.key]} ${step.unit}`,
        });
      })
    );
  }
  return rows;
}
