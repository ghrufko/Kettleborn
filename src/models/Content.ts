export type Rarity = 'common' | 'elite' | 'boss' | 'legendary';
export type DifficultyTier = 1 | 2 | 3 | 4 | 5;
export type DamageType = 'flat' | 'per_rep' | 'per_second' | 'over_time';

export interface Exercise {
  id: string;
  name: string;
  /**
   * Optional visual-only override for the exercise name shown in the Hunt
   * flow UI. `name` itself stays the single routing key for Exercise
   * Library lookup (`getExerciseLibraryEntryByName`) and Journal lifetime
   * stat aggregation (`exerciseStats.ts`) — never read for either of
   * those. Lets a workout show a friendlier/shorter label (e.g. Behemoth
   * Phase I showing "Double Snatch" while still routing to the distinct
   * `tactical-double-snatch` Library entry via `name`) without splitting
   * that exercise's Library entry, video, or historical stats in two.
   */
  displayName?: string;
  targetReps?: number;
  targetDistanceFt?: number;
  damageCoefficient: number;
  damageType: DamageType;
  /**
   * Only meaningful for 'per_second' / 'over_time' damage types. Session
   * Engine does not yet track live per-exercise duration, so this is a
   * content-authored expected duration used to resolve damage at
   * completion time — an approximation, not a measured value.
   */
  durationSeconds?: number;
  /**
   * Kettlebell weight audit: overrides the WORKOUT's own `gearCount` for
   * THIS exercise's weight/volume calculation only — e.g. Chimera's
   * "Snatch / Thruster" and "Alternating Swing" are genuinely single-bell
   * movements embedded in an otherwise `gearCount: 2` workout (confirmed
   * against each exercise's own Exercise Library description, not
   * guessed from its name). Absent means "use the workout's own
   * gearCount", the exact behavior for every exercise before this field
   * existed. Never read by Battle Engine/damage resolution — statistics/
   * volume only (see src/utils/exerciseBreakdown.ts).
   */
  usesGearCount?: 1 | 2;
}

export interface Finisher {
  name: string;
  scheme: string;
}

export interface Workout {
  id: string;
  name: string;
  /**
   * The Hunt Brief's "why this hunt exists" narrative — what it trains and
   * why it's hard, in the monster's voice. Optional so older/placeholder
   * content never breaks; Hunt Brief falls back to the monster description
   * when absent.
   */
  description?: string;
  difficulty: DifficultyTier;
  estimatedMinutesRange: [number, number];
  gearWeightKg: number;
  gearCount: 1 | 2;
  rounds: number;
  restSeconds: number;
  roundBonusDamage: number;
  targetTimeSeconds: number;
  /**
   * Sprint 23: optional label override for what a "round" is called in this
   * workout's UI — e.g. "Rung" for a true ladder workout (`labyrinth-ladder`).
   * Absent means "Round", the exact behavior for every workout before this
   * field existed. Purely a display string — never read by the Session or
   * Battle Engines, which remain round-count-agnostic either way.
   */
  stepLabel?: string;
  focus: string[];
  /** Used when `sections` is absent — every round repeats this same exercise list. */
  exercises: Exercise[];
  /**
   * Sprint 22: optional per-round exercise lists, for a workout where each
   * round is genuinely different content (e.g. a composite final-boss
   * trial drawing one round from each of several monsters) rather than
   * the same complex repeated `rounds` times. When present, `sections.length`
   * must equal `rounds`, and the Session/Battle Engines use
   * `sections[roundIndex].exercises` instead of the flat `exercises` list
   * for that round. Every workout before Sprint 22 omits this and keeps
   * behaving exactly as before.
   */
  sections?: { label: string; exercises: Exercise[] }[];
  /**
   * When present, this workout is open-ended EMOM-style: each round must
   * be completed within this many seconds, immediately followed by the
   * next round's identical window (no separate rest phase — "the
   * remaining time until the next mark" IS the recovery, not a distinct
   * rest timer). `rounds` still holds a reference/informational value
   * (matching a known best result) but is never used as a hard cap when
   * this field is set — the attempt only ends when a window expires
   * before Complete Round is pressed. See useWorkoutSession.ts.
   */
  emomSeconds?: number;
  finisher: Finisher;
}

export interface Hunt {
  id: string;
  monsterId: string;
  order: number;
  name: string;
  locked: boolean;
  workoutId: string | null;
  /**
   * Sprint 22: several monsters' encounters are the *same* trial with
   * progressively shorter rest between attempts, not different exercise
   * lists — this overrides Workout.restSeconds for this specific Hunt
   * without needing a near-duplicate Workout row per encounter. Absent
   * means "use the linked workout's own restSeconds", the existing
   * behavior for every hunt before Sprint 22.
   */
  restSecondsOverride?: number;
  /**
   * Sprint 22: a small number of encounters (Minotaur's later attempts)
   * have no fixed target time in the source material — the target is
   * meant to be the player's own prior best. True adaptive targeting is
   * deferred (a real mechanic, not content) — for now this is an honest,
   * clearly-labeled fixed estimate rather than a fabricated "real" target.
   */
  targetTimeIsEstimate?: boolean;
}

export interface PerformanceBonusConfig {
  perfectExecutionDamage: number;
  relentlessAssaultDamage: number;
  relentlessAssaultStreak: number;
  personalRecordDamage: number;
  fastFinishDamage: number;
}

/**
 * Reserved for future boss-specific battle behavior (phase reactions,
 * damage-type resistances, enrage triggers). Not read by the Battle Engine
 * yet — this is the architectural slot Sprint 6.5 prepares, not implements.
 */
export interface BossPersonality {
  id: string;
}

export interface BattleConfig {
  hp: number;
  phases: number[]; // descending HP% thresholds, e.g. [75, 50, 25]
  damageMultiplier: number;
  performanceBonuses: PerformanceBonusConfig;
  personality?: BossPersonality;
}

export type CombatPersonality = 'brutal' | 'agile' | 'regenerating' | 'steady';

export interface Monster {
  id: string;
  name: string;
  title: string;
  description: string;
  rarity: Rarity;
  battle: BattleConfig;
  hunts: Hunt[];
  portraitAsset?: string;
  /**
   * Presentation-only combat identity (Sprint 18) — colors, timing, and
   * intensity of the Active Hunt screen's feedback, never gameplay rules.
   * Distinct from BattleConfig.personality (BossPersonality) above, which
   * is a separate reserved slot for *future gameplay* boss behavior and is
   * still unread by the Battle Engine. Optional here too, defaulting to a
   * neutral look in getBossPersonality() when absent.
   */
  personality?: CombatPersonality;
  /**
   * Sprint 22: Campaign I's source material gives each monster its own
   * brand color, independent of its combat pacing "personality" (several
   * monsters share a personality bucket but should not look identical).
   * Optional — getCombatPersonality() falls back to the personality
   * type's own color when a monster doesn't set one.
   */
  accentColor?: string;
}

export interface Campaign {
  id: string;
  name: string;
  /** Display/unlock order among campaigns, 1-based. */
  order: number;
  monsterIds: string[];
  finalBossId: string | null;
  /**
   * null = always available (the first campaign). Otherwise the id of the
   * campaign that must be fully completed (every monster in its
   * monsterIds defeated) before this one unlocks. Read by
   * src/utils/campaignState.ts — never hardcoded per-campaign logic.
   */
  unlockRequiresCampaignId: string | null;
  /** Short thematic subtitle shown under the campaign name (Sprint 19). */
  tagline: string;
  /** One or two sentences shown when entering this campaign's World Map for identity/atmosphere. */
  introText: string;
  /** Shown once, when every monster in this campaign has been defeated. */
  completionText: string;
  /**
   * Territory Hub redesign: the longer-form lore shown on the Hub's Lore
   * tab, structured to match that tab's three fixed sections. Optional
   * so a campaign added before this existed still loads — the Lore tab
   * simply shows nothing for a campaign missing this, rather than
   * fabricating placeholder text.
   */
  territoryLore?: {
    /** "THE TERRITORY" section — what this place is, atmospherically. */
    theTerritory: string;
    /** "WHAT DWELLS HERE" section — the kind of monster this territory produces. */
    whatDwellsHere: string;
    /** "THE HUNTER'S PURPOSE" section — why a hunter comes here at all. */
    huntersPurpose: string;
    /** Short closing line bridging the Lore tab into the Hunts tab. */
    transition: string;
  };
  /**
   * Territory Hub redesign: key into src/constants/territoryArt.ts for
   * this territory's hero image, same optional-lookup-with-fallback shape
   * as Monster.portraitAsset — a missing/unmapped key renders the
   * existing gradient-only header instead of crashing, so real artwork
   * can be dropped in later with zero code changes (see that file).
   */
  heroImageAsset?: string;
}
