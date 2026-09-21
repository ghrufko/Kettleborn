import minotaurData from '../../content/monsters/minotaur.json';
import mammothData from '../../content/monsters/mammoth.json';
import basiliskData from '../../content/monsters/basilisk.json';
import arachneData from '../../content/monsters/arachne.json';
import hydraData from '../../content/monsters/hydra.json';
import leviathanData from '../../content/monsters/leviathan.json';
import behemothData from '../../content/monsters/behemoth.json';
import weaverData from '../../content/monsters/weaver.json';
import harpyData from '../../content/monsters/harpy.json';
import atlasData from '../../content/monsters/atlas.json';
import ifritData from '../../content/monsters/ifrit.json';
import chimeraData from '../../content/monsters/chimera.json';
import chronosData from '../../content/monsters/chronos.json';
import janusData from '../../content/monsters/janus.json';
import orthrusData from '../../content/monsters/orthrus.json';
import agonyData from '../../content/monsters/agony.json';
import ambidexterData from '../../content/monsters/ambidexter.json';
import fluidData from '../../content/monsters/fluid.json';
import molochData from '../../content/monsters/moloch.json';
import aresData from '../../content/monsters/ares.json';
import aetherData from '../../content/monsters/aether.json';
import riteData from '../../content/monsters/rite.json';
import crookedData from '../../content/monsters/crooked.json';
import descentData from '../../content/monsters/descent.json';
import judgeData from '../../content/monsters/judge.json';
import ravagerData from '../../content/monsters/ravager.json';
import workoutData from '../../content/workouts/workout.json';
import campaign1Data from '../../content/campaigns/campaign-1.json';
import campaign2Data from '../../content/campaigns/campaign-2.json';
import campaign3Data from '../../content/campaigns/campaign-3.json';
import minotaurLoreData from '../../content/lore/minotaur.lore.json';
import arachneLoreData from '../../content/lore/arachne.lore.json';
import hydraLoreData from '../../content/lore/hydra.lore.json';
import leviathanLoreData from '../../content/lore/leviathan.lore.json';
import behemothLoreData from '../../content/lore/behemoth.lore.json';
import weaverLoreData from '../../content/lore/weaver.lore.json';
import builtInTimerPresetsData from '../../content/timers/builtin-presets.json';
import exerciseLibraryData from '../../content/exercises/library.json';
import { Monster, Workout, Campaign, Hunt, Exercise, Lore, TimerPreset, ExerciseLibraryEntry } from '../../src/models';

/**
 * Every monster/campaign/lore file needs one line here (Metro requires
 * static import paths — this is the one unavoidable registration point,
 * same constraint noted since Sprint 9). Adding a new campaign or monster
 * never requires touching any screen.
 *
 * Campaign 2 ("The Ruins", Harpy/Atlas/Ifrit/Chimera) has no lore
 * files — Lore is decorative only (validateLore below just skips a
 * missing/malformed entry with a warning, never blocks load), and every
 * screen that reads it already treats an absent Lore as "no lore to show"
 * rather than an error.
 */
const ALL_MONSTER_SOURCES = [
  minotaurData,
  mammothData,
  basiliskData,
  arachneData,
  hydraData,
  leviathanData,
  behemothData,
  weaverData,
  harpyData,
  atlasData,
  ifritData,
  chimeraData,
  chronosData,
  janusData,
  orthrusData,
  agonyData,
  ambidexterData,
  fluidData,
  molochData,
  aresData,
  aetherData,
  riteData,
  crookedData,
  descentData,
  judgeData,
  ravagerData,
];
const ALL_CAMPAIGN_SOURCES = [campaign1Data, campaign2Data, campaign3Data];
const ALL_LORE_SOURCES = [
  minotaurLoreData,
  arachneLoreData,
  hydraLoreData,
  leviathanLoreData,
  behemothLoreData,
  weaverLoreData,
];

interface ContentIndex {
  monsters: Map<string, Monster>;
  workouts: Map<string, Workout>;
  campaigns: Map<string, Campaign>;
  lore: Map<string, Lore>;
  timerPresets: Map<string, TimerPreset>;
  exerciseLibrary: Map<string, ExerciseLibraryEntry>;
}

function validateMonster(raw: unknown): Monster {
  const monster = raw as Monster;
  const bonuses = monster?.battle?.performanceBonuses;
  if (
    !monster.id ||
    !monster.name ||
    !Array.isArray(monster.hunts) ||
    !monster.battle ||
    typeof monster.battle.hp !== 'number' ||
    !Array.isArray(monster.battle.phases) ||
    typeof monster.battle.damageMultiplier !== 'number' ||
    !bonuses ||
    typeof bonuses.perfectExecutionDamage !== 'number' ||
    typeof bonuses.relentlessAssaultDamage !== 'number' ||
    typeof bonuses.relentlessAssaultStreak !== 'number' ||
    typeof bonuses.personalRecordDamage !== 'number' ||
    typeof bonuses.fastFinishDamage !== 'number'
  ) {
    throw new Error(`Content Engine: malformed monster content (id="${monster?.id}")`);
  }
  return monster;
}

function validateExercise(raw: unknown, workoutId: string): void {
  const exercise = raw as Exercise;
  if (
    !exercise.id ||
    !exercise.name ||
    typeof exercise.damageCoefficient !== 'number' ||
    !exercise.damageType
  ) {
    throw new Error(
      `Content Engine: malformed exercise content in workout "${workoutId}" (id="${exercise?.id}")`
    );
  }
}

function validateWorkout(raw: unknown): Workout {
  const workout = raw as Workout;
  if (
    !workout.id ||
    !Array.isArray(workout.exercises) ||
    !workout.finisher ||
    typeof workout.rounds !== 'number' ||
    typeof workout.restSeconds !== 'number' ||
    typeof workout.roundBonusDamage !== 'number' ||
    typeof workout.targetTimeSeconds !== 'number' ||
    !Array.isArray(workout.focus)
  ) {
    throw new Error(`Content Engine: malformed workout content (id="${workout?.id}")`);
  }
  workout.exercises.forEach((exercise) => validateExercise(exercise, workout.id));
  return workout;
}

function validateCampaign(raw: unknown): Campaign {
  const campaign = raw as Campaign;
  if (
    !campaign.id ||
    !Array.isArray(campaign.monsterIds) ||
    typeof campaign.order !== 'number' ||
    !('unlockRequiresCampaignId' in campaign) ||
    !campaign.tagline ||
    !campaign.introText ||
    !campaign.completionText
  ) {
    throw new Error(`Content Engine: malformed campaign content (id="${campaign?.id}")`);
  }
  return campaign;
}

function validateLore(raw: unknown): Lore | null {
  const lore = raw as Lore;
  if (!lore || !lore.monsterId || !lore.origin || !lore.story || !Array.isArray(lore.quotes)) {
    // Lore is decorative, not load-bearing — a missing or malformed lore
    // file should never block the app from being playable.
    console.warn('Content Engine: skipping malformed lore content', lore?.monsterId);
    return null;
  }
  return lore;
}

function validateTimerPreset(raw: unknown): TimerPreset | null {
  const preset = raw as TimerPreset;
  const roundsValid =
    Array.isArray(preset?.rounds) &&
    preset.rounds.every(
      (round) =>
        !!round.id && !!round.name && Array.isArray(round.intervals) && round.intervals.length > 0
    );
  if (!preset || !preset.id || !preset.name || !roundsValid) {
    console.warn('Content Engine: skipping malformed timer preset', preset?.id);
    return null;
  }
  return { ...preset, isBuiltIn: true };
}

function validateExerciseLibraryEntry(raw: unknown): ExerciseLibraryEntry | null {
  const entry = raw as ExerciseLibraryEntry;
  if (
    !entry ||
    !entry.id ||
    !entry.name ||
    !entry.description ||
    !entry.category ||
    !Array.isArray(entry.recommendedWeightRangeKg) ||
    entry.recommendedWeightRangeKg.length !== 2 ||
    !Array.isArray(entry.musclesTrained) ||
    !Array.isArray(entry.benefits) ||
    !Array.isArray(entry.commonMistakes)
  ) {
    console.warn('Content Engine: skipping malformed exercise library entry', entry?.id);
    return null;
  }
  return entry;
}

class ContentEngineImpl {
  private index: ContentIndex | null = null;

  /**
   * Loads and validates all content files into an in-memory index.
   * Safe to call more than once — subsequent calls are no-ops once loaded.
   */
  load(): void {
    if (this.index) {
      return;
    }

    const monsters = new Map<string, Monster>();
    ALL_MONSTER_SOURCES.forEach((raw) => {
      const monster = validateMonster(raw);
      monsters.set(monster.id, monster);
    });

    const workouts = new Map<string, Workout>();
    const workoutRecord = workoutData as Record<string, unknown>;
    Object.values(workoutRecord).forEach((raw) => {
      const workout = validateWorkout(raw);
      workouts.set(workout.id, workout);
    });

    const campaigns = new Map<string, Campaign>();
    ALL_CAMPAIGN_SOURCES.forEach((raw) => {
      const campaign = validateCampaign(raw);
      campaigns.set(campaign.id, campaign);
    });

    const lore = new Map<string, Lore>();
    ALL_LORE_SOURCES.forEach((raw) => {
      const entry = validateLore(raw);
      if (entry) {
        lore.set(entry.monsterId, entry);
      }
    });

    const timerPresets = new Map<string, TimerPreset>();
    (builtInTimerPresetsData as unknown[]).forEach((raw) => {
      const preset = validateTimerPreset(raw);
      if (preset) {
        timerPresets.set(preset.id, preset);
      }
    });

    const exerciseLibrary = new Map<string, ExerciseLibraryEntry>();
    (exerciseLibraryData as unknown[]).forEach((raw) => {
      const entry = validateExerciseLibraryEntry(raw);
      if (entry) {
        exerciseLibrary.set(entry.id, entry);
      }
    });

    this.index = { monsters, workouts, campaigns, lore, timerPresets, exerciseLibrary };
  }

  private requireIndex(): ContentIndex {
    if (!this.index) {
      throw new Error('Content Engine: load() must be called before querying content');
    }
    return this.index;
  }

  getAllMonsters(): Monster[] {
    return Array.from(this.requireIndex().monsters.values());
  }

  getMonster(monsterId: string): Monster | undefined {
    return this.requireIndex().monsters.get(monsterId);
  }

  getHunt(monsterId: string, huntId: string): Hunt | undefined {
    return this.getMonster(monsterId)?.hunts.find((hunt) => hunt.id === huntId);
  }

  getWorkout(workoutId: string): Workout | undefined {
    return this.requireIndex().workouts.get(workoutId);
  }

  getAllWorkouts(): Workout[] {
    return Array.from(this.requireIndex().workouts.values());
  }

  getCampaign(campaignId: string): Campaign | undefined {
    return this.requireIndex().campaigns.get(campaignId);
  }

  /** All campaigns, sorted by their content-authored `order`. */
  getAllCampaigns(): Campaign[] {
    return Array.from(this.requireIndex().campaigns.values()).sort((a, b) => a.order - b.order);
  }

  /** Derived by scanning campaign monsterIds — no stored back-reference to keep in sync. */
  getCampaignForMonster(monsterId: string): Campaign | undefined {
    return this.getAllCampaigns().find((campaign) => campaign.monsterIds.includes(monsterId));
  }

  getLore(monsterId: string): Lore | undefined {
    return this.requireIndex().lore.get(monsterId);
  }

  getBuiltInTimerPresets(): TimerPreset[] {
    return Array.from(this.requireIndex().timerPresets.values());
  }

  getExerciseLibrary(): ExerciseLibraryEntry[] {
    return Array.from(this.requireIndex().exerciseLibrary.values());
  }

  getExerciseLibraryEntry(id: string): ExerciseLibraryEntry | undefined {
    return this.requireIndex().exerciseLibrary.get(id);
  }

  getExerciseLibraryEntryByName(name: string): ExerciseLibraryEntry | undefined {
    const normalized = name.trim().toLowerCase();
    return this.getExerciseLibrary().find((entry) => entry.name.toLowerCase() === normalized);
  }

  /** Derived by scanning all loaded workouts — no stored relation to keep in sync. */
  getWorkoutsContainingExercise(exerciseName: string): Workout[] {
    const normalized = exerciseName.trim().toLowerCase();
    return Array.from(this.requireIndex().workouts.values()).filter((workout) =>
      workout.exercises.some((exercise) => exercise.name.toLowerCase() === normalized)
    );
  }
}

export const contentEngine = new ContentEngineImpl();
