import { CombatPersonality } from '../models';

export interface CombatPersonalityConfig {
  /** Short recognizable descriptor shown outside battle (Monster Detail, Hunt Brief, World Map). */
  label: string;
  /** One sentence, shown on Monster Detail / Hunt Brief — the boss's identity before the fight starts. */
  beforeBattleFlavor: string;
  /** HP bar fill color — replaces the flat colors.blood used before Sprint 18. */
  hpBarColor: string;
  /** Damage-pop text color for normal (non-critical) hits. */
  damageColor: string;
  /** Color used for the shared critical-hit treatment across all bosses. */
  critColor: string;
  /** Accent used for phase-transition banners and portrait glow. */
  accentColor: string;
  /**
   * Multiplies every combat-feedback animation duration in ActiveHuntScreen.
   * >1 = slower/weightier, <1 = quicker/lighter. Never changes timing that
   * affects gameplay (rest countdown, rep targets) — only decorative
   * animation pacing.
   */
  animationPace: number;
  /** How far (px) the portrait shakes on a heavy hit. 0 = no shake style for this boss. */
  shakeDistance: number;
  /** Fraction of maxHP a single hit must exceed to count as "heavy" and trigger a portrait shake. */
  heavyHitThreshold: number;
}

const PERSONALITY_CONFIG: Record<CombatPersonality, CombatPersonalityConfig> = {
  // Minotaur — brutal: heavy, slow, high-impact. Every hit should feel like
  // it costs the boss something.
  brutal: {
    label: 'Brutal',
    beforeBattleFlavor: 'Heavy blows, no hurry. It does not need to be fast to break you.',
    hpBarColor: '#A11F1F',
    damageColor: '#FF6A3D',
    critColor: '#FFB13D',
    accentColor: '#8B1E1E',
    animationPace: 1.3,
    shakeDistance: 6,
    heavyHitThreshold: 0.05,
  },
  // Arachne — agile: quick, light, frequent small events rather than a few
  // big ones.
  agile: {
    label: 'Agile',
    beforeBattleFlavor: 'Quick and unpredictable. It wins by outlasting your patience, not your strength.',
    hpBarColor: '#6E3FA3',
    damageColor: '#B37FE0',
    critColor: '#E6C6FF',
    accentColor: '#6E3FA3',
    animationPace: 0.7,
    shakeDistance: 2,
    heavyHitThreshold: 0.09,
  },
  // Hydra — regenerating: slower, heavier transitions, a sense that damage
  // has to fight against something that keeps recovering.
  regenerating: {
    label: 'Regenerating',
    beforeBattleFlavor: 'Wounds that refuse to stay closed. Every strike must outpace its recovery.',
    hpBarColor: '#3E8F5C',
    damageColor: '#7FDC9E',
    critColor: '#C8FFDA',
    accentColor: '#2E7048',
    animationPace: 1.5,
    shakeDistance: 3,
    heavyHitThreshold: 0.06,
  },
  // Leviathan / Behemoth — steady: no wasted motion, no urgency, damage
  // lands like something immovable being worn down rather than staggered.
  // Sprint 22: added because Campaign I's source needed a pacing bucket
  // distinct from "brutal" (which reads as aggressive/fast-impact) for
  // monsters whose identity is composure and crushing weight instead.
  steady: {
    label: 'Steady',
    beforeBattleFlavor: 'No wasted motion, no urgency. It simply outlasts what it cannot outrun.',
    hpBarColor: '#3F7FA6',
    damageColor: '#6FA8C9',
    critColor: '#BFE3F5',
    accentColor: '#3F7FA6',
    animationPace: 1.6,
    shakeDistance: 4,
    heavyHitThreshold: 0.06,
  },
};

const DEFAULT_CONFIG: CombatPersonalityConfig = {
  label: 'Balanced',
  beforeBattleFlavor: 'Its measure has not yet been taken.',
  hpBarColor: '#8B1E1E',
  damageColor: '#FF8A4C',
  critColor: '#D4AF37',
  accentColor: '#B87333',
  animationPace: 1,
  shakeDistance: 3,
  heavyHitThreshold: 0.07,
};

/**
 * Falls back to a neutral config for any monster without a personality
 * set. `accentColorOverride` (Sprint 22) lets an individual monster keep
 * its own brand color from source content while still sharing a pacing
 * bucket with other monsters — only accentColor/hpBarColor/critColor are
 * swapped, animation feel stays tied to the personality type.
 */
export function getCombatPersonality(
  personality?: CombatPersonality,
  accentColorOverride?: string
): CombatPersonalityConfig {
  const base = personality ? PERSONALITY_CONFIG[personality] ?? DEFAULT_CONFIG : DEFAULT_CONFIG;
  if (!accentColorOverride) {
    return base;
  }
  return {
    ...base,
    accentColor: accentColorOverride,
    hpBarColor: accentColorOverride,
  };
}

/**
 * The single call site every Hunt screen uses to get its atmospheric glow
 * color — never a duplicated/hardcoded color. Sprint 3: the Sprint 2
 * Minotaur-only allowlist gate is gone — every monster in the current
 * roster has a real content `accentColor`, and `getCombatPersonality`
 * itself never returns an empty color (it falls back to the monster's
 * personality-bucket color, or `DEFAULT_CONFIG`'s neutral bronze if the
 * monster has no personality set either) — so this always resolves to a
 * valid color for any monster, present or future, with zero per-monster
 * listing to maintain. Always derives from `getCombatPersonality`, the
 * same function every other combat-feedback consumer (HP bar, phase
 * banner, crit flash) already uses — there remains exactly one authority
 * for a monster's identity color.
 */
export function getAtmosphericColor(personality?: CombatPersonality, accentColorOverride?: string): string {
  return getCombatPersonality(personality, accentColorOverride).accentColor;
}
