import { getLevelForTotalXP } from '../../../engines/progress/progressionEngine';

/**
 * Cloud Save P4 — rebuilding the stored totals (XP, level, Chronicle,
 * monster progress) from facts: the migration-19 baseline plus every
 * result recorded since (origin_order set). Pure functions, no database.
 *
 * SHADOW MODE: nothing in the app reads these yet. Tests compare them with
 * the totals the app stores today; they must be identical. Each rule below
 * mirrors exactly what completeHunt / the resets do to the stored totals.
 */

export interface BaselineFacts {
  uuid: string;
  originDeviceUuid: string;
  epoch: number;
  totalXP: number;
  level: number;
  totalWorkouts: number;
  totalHuntsCompleted: number;
  totalMonstersDefeated: number;
  totalVolumeKg: number;
  totalTrainingMinutes: number;
  currentStreakDays: number;
  longestStreakDays: number;
  chronicleUpdatedAt: string | null;
  monsters: Record<string, { huntsCompleted: number; huntsTotal: number; defeated: boolean; monsterResetCount: number | null }>;
}

export interface ResultFact {
  uuid: string;
  monsterId: string;
  /** For first-clear: the stage is 'workout:' + workoutId. Optional for synthetic facts without a bonus. */
  workoutId?: string;
  completedAt: string;
  xpAwarded: number;
  firstClearBonusXp: number | null;
  progressionEpoch: number | null;
  monsterResetCount: number | null;
  volumeKg: number | null;
  trainingMinutes: number | null;
  streakAfter: number | null;
  originDeviceUuid: string | null;
  originOrder: number | null;
}

export interface ResetFact {
  scope: 'campaign' | 'monster';
  monsterId: string | null;
  epoch: number | null;
  countAfter: number | null;
}

export type ClaimStatus = 'local_final' | 'pending' | 'confirmed' | 'lost';

export interface ProjectionInput {
  currentEpoch: number;
  baseline: BaselineFacts | null;
  results: ResultFact[];
  resets: ResetFact[];
  /** Claim status by the result uuid the claim refers to. */
  claimStatusByResult: Record<string, ClaimStatus>;
  /**
   * The claim held for each `${stage}@${epoch}`, when known. A result whose
   * stage/epoch is claimed by ANOTHER result has lost its bonus (another
   * device's claim was accepted first) — it never counts.
   */
  claimsByStage?: Record<string, { resultUuid: string; status: ClaimStatus }>;
  /** Content hunt count per monster (completeHunt uses monster.hunts.length). */
  huntsTotalByMonster: Record<string, number>;
}

export interface ChronicleTotals {
  totalWorkouts: number;
  totalHuntsCompleted: number;
  totalMonstersDefeated: number;
  totalVolumeKg: number;
  totalTrainingMinutes: number;
  currentStreakDays: number;
  longestStreakDays: number;
}

export interface Projection {
  confirmedXP: number;
  pendingXP: number;
  level: number;
  chronicle: ChronicleTotals;
  /** null when the facts can't determine it (reset counts unknown — C1). */
  monsterProgress: Record<string, { huntsCompleted: number; defeated: boolean }> | null;
  /** 'single' = every fact since the baseline came from one install (exact stored streak); 'multi' = recalculated. */
  streakMode: 'single' | 'multi';
}

const COUNTS_TOWARD_XP: ReadonlySet<ClaimStatus> = new Set(['local_final', 'confirmed']);

/** Results recorded since the baseline (P3 stamps origin_order on every new result). */
function postBaseline(results: ResultFact[]): ResultFact[] {
  return results.filter((r) => r.originOrder !== null && r.originDeviceUuid !== null);
}

function byCreation(a: ResultFact, b: ResultFact): number {
  if (a.originDeviceUuid === b.originDeviceUuid) {
    return (a.originOrder ?? 0) - (b.originOrder ?? 0);
  }
  return a.completedAt < b.completedAt ? -1 : a.completedAt > b.completedAt ? 1 : a.uuid < b.uuid ? -1 : a.uuid > b.uuid ? 1 : 0;
}

export function rebuildTotals(input: ProjectionInput): Projection {
  const E = input.currentEpoch;
  const baseline = input.baseline && input.baseline.epoch === E ? input.baseline : null;
  // Every result of the current epoch counts — including those a monster
  // reset voided: a monster reset never removed XP or Chronicle totals.
  const posts = postBaseline(input.results)
    .filter((r) => r.progressionEpoch === E)
    .sort(byCreation);

  // XP (D3): ordinary XP always; the first-clear bonus only once final or confirmed.
  let confirmedXP = baseline ? baseline.totalXP : 0;
  let pendingXP = 0;
  for (const r of posts) {
    const bonus = r.firstClearBonusXp ?? 0;
    confirmedXP += r.xpAwarded - bonus;
    const stageClaim = r.workoutId !== undefined ? input.claimsByStage?.[`workout:${r.workoutId}@${E}`] : undefined;
    const status: ClaimStatus =
      stageClaim && stageClaim.resultUuid !== r.uuid ? 'lost' : input.claimStatusByResult[r.uuid] ?? 'local_final';
    if (bonus > 0 && !COUNTS_TOWARD_XP.has(status)) {
      if (status === 'pending') pendingXP += bonus;
    } else {
      confirmedXP += bonus;
    }
  }
  const level = posts.length > 0 ? getLevelForTotalXP(confirmedXP) : baseline ? baseline.level : 1;

  // Chronicle sums, added in creation order so floating-point volume matches the stored total exactly.
  let totalVolumeKg = baseline ? baseline.totalVolumeKg : 0;
  let totalTrainingMinutes = baseline ? baseline.totalTrainingMinutes : 0;
  for (const r of posts) {
    totalVolumeKg += r.volumeKg ?? 0;
    totalTrainingMinutes += r.trainingMinutes ?? 0;
  }

  const origins = new Set(posts.map((r) => r.originDeviceUuid));
  if (baseline) origins.add(baseline.originDeviceUuid);
  const streakMode: 'single' | 'multi' = origins.size <= 1 ? 'single' : 'multi';
  const streaks =
    streakMode === 'single' ? singleOriginStreaks(baseline, posts) : multiOriginStreaks(baseline, posts);

  const monsters = rebuildMonsters(input, baseline, posts);

  return {
    confirmedXP,
    pendingXP,
    level,
    chronicle: {
      totalWorkouts: (baseline ? baseline.totalWorkouts : 0) + posts.length,
      totalHuntsCompleted: (baseline ? baseline.totalHuntsCompleted : 0) + posts.length,
      totalMonstersDefeated: monsters ? monsters.defeatedTotal : baseline ? baseline.totalMonstersDefeated : 0,
      totalVolumeKg,
      totalTrainingMinutes,
      currentStreakDays: streaks.current,
      longestStreakDays: streaks.longest,
    },
    monsterProgress: monsters ? monsters.progress : null,
    streakMode,
  };
}

/** D14 policy C, one origin: the streak completeHunt stored on the latest result is exact (travel, daylight saving included). */
function singleOriginStreaks(baseline: BaselineFacts | null, posts: ResultFact[]) {
  let longest = baseline ? baseline.longestStreakDays : 0;
  for (const r of posts) longest = Math.max(longest, r.streakAfter ?? 0);
  const last = posts[posts.length - 1];
  const current = last ? last.streakAfter ?? 0 : baseline ? baseline.currentStreakDays : 0;
  return { current, longest };
}

/** Calendar day number of an instant in THIS device's time zone. */
function localDayNumber(iso: string): number {
  const d = new Date(iso);
  return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);
}

/**
 * D14 policy C, several origins: recalculated over distinct calendar days
 * in the viewing device's time zone, seeded from the baseline, with a true
 * calendar-day difference. The longest streak never drops below any value
 * a device already stored.
 */
export function multiOriginStreaks(baseline: BaselineFacts | null, posts: ResultFact[]) {
  let lastDay = baseline && baseline.chronicleUpdatedAt ? localDayNumber(baseline.chronicleUpdatedAt) : null;
  let current = baseline ? baseline.currentStreakDays : 0;
  let longest = baseline ? baseline.longestStreakDays : 0;
  const days = Array.from(new Set(posts.map((r) => localDayNumber(r.completedAt)))).sort((a, b) => a - b);
  for (const day of days) {
    if (lastDay !== null && day < lastDay) continue; // older than history already summarised
    if (lastDay !== null && day === lastDay) current = Math.max(current, 1);
    else if (lastDay !== null && day === lastDay + 1) current += 1;
    else current = 1;
    lastDay = day;
    longest = Math.max(longest, current);
  }
  for (const r of posts) longest = Math.max(longest, r.streakAfter ?? 0);
  return { current, longest };
}

function rebuildMonsters(input: ProjectionInput, baseline: BaselineFacts | null, posts: ResultFact[]) {
  if (posts.some((r) => r.monsterResetCount === null)) return null;
  if (baseline && Object.values(baseline.monsters).some((m) => m.monsterResetCount === null)) return null;
  const E = input.currentEpoch;
  const currentCount: Record<string, number> = {};
  for (const reset of input.resets) {
    if (reset.scope !== 'monster' || reset.epoch !== E || reset.monsterId === null) continue;
    if (reset.countAfter === null) return null;
    currentCount[reset.monsterId] = Math.max(currentCount[reset.monsterId] ?? 0, reset.countAfter);
  }

  const groups = new Map<string, ResultFact[]>(); // `${monster}|${count}`
  for (const r of posts) {
    const key = `${r.monsterId}|${r.monsterResetCount}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }

  let defeatedTotal = baseline ? baseline.totalMonstersDefeated : 0;
  for (const [key, group] of groups) {
    const [monsterId, countText] = key.split('|');
    const start = baselineStart(baseline, monsterId, Number(countText));
    const total = input.huntsTotalByMonster[monsterId] ?? 0;
    if (!start.defeated && start.huntsCompleted + group.length >= total) defeatedTotal += 1;
  }

  const monsterIds = new Set([
    ...Object.keys(input.huntsTotalByMonster),
    ...(baseline ? Object.keys(baseline.monsters) : []),
  ]);
  const progress: Record<string, { huntsCompleted: number; defeated: boolean }> = {};
  for (const monsterId of monsterIds) {
    const count = currentCount[monsterId] ?? 0;
    const start = baselineStart(baseline, monsterId, count);
    const n = (groups.get(`${monsterId}|${count}`) ?? []).length;
    if (n === 0) {
      progress[monsterId] = { huntsCompleted: start.huntsCompleted, defeated: start.defeated };
    } else {
      const total = input.huntsTotalByMonster[monsterId] ?? 0;
      const huntsCompleted = Math.min(start.huntsCompleted + n, total);
      progress[monsterId] = { huntsCompleted, defeated: huntsCompleted >= total };
    }
  }
  return { progress, defeatedTotal };
}

/** A monster's state at the start of a reset era: the baseline row if it belongs to that era, else never fought. */
function baselineStart(baseline: BaselineFacts | null, monsterId: string, count: number) {
  const row = baseline?.monsters[monsterId];
  if (row && row.monsterResetCount === count) {
    return { huntsCompleted: row.huntsCompleted, defeated: row.defeated };
  }
  return { huntsCompleted: 0, defeated: false };
}
