import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Cloud Save P4 — shadow rebuild. Drives the REAL store (completeHunt and
 * both resets) over real SQLite, then checks that the totals rebuilt from
 * the baseline + recorded facts equal the totals the app stores, exactly.
 */
const H = await import(new URL('../../../testing/appHarness.ts', import.meta.url).href);
const { rebuildTotals, multiOriginStreaks } = await import(new URL('../rebuild.ts', import.meta.url).href);
const { loadProjectionInput } = await import(new URL('../load.ts', import.meta.url).href);
const { computeHistoricalRanks } = await import(new URL('../../../utils/rankHistory.ts', import.meta.url).href);
const { LEGACY_USER } = await import(new URL('../../../testing/legacyDatabaseFixture.ts', import.meta.url).href);

const U = LEGACY_USER;
const ORIGINAL_TZ = process.env.TZ;
test.after(() => {
  process.env.TZ = ORIGINAL_TZ;
  H.cleanupWorkDir();
});
test.afterEach(() => {
  mock.timers.reset();
  process.env.TZ = ORIGINAL_TZ;
});

function stored() {
  const raw = H.raw();
  const user = raw.prepare('SELECT total_xp, level FROM user WHERE id = ?').get(U);
  const c = raw.prepare('SELECT * FROM chronicle WHERE user_id = ?').get(U);
  const monsters = Object.fromEntries(
    raw
      .prepare('SELECT monster_id, hunts_completed, defeated FROM monster_progress WHERE user_id = ?')
      .all(U)
      .map((m: any) => [m.monster_id, { huntsCompleted: m.hunts_completed, defeated: m.defeated === 1 }])
  );
  return {
    confirmedXP: user.total_xp,
    level: user.level,
    chronicle: {
      totalWorkouts: c.total_workouts,
      totalHuntsCompleted: c.total_hunts_completed,
      totalMonstersDefeated: c.total_monsters_defeated,
      totalVolumeKg: c.total_volume_kg,
      totalTrainingMinutes: c.total_training_minutes,
      currentStreakDays: c.current_streak_days,
      longestStreakDays: c.longest_streak_days,
    },
    monsterProgress: monsters,
  };
}

async function rebuilt() {
  const p = rebuildTotals(await loadProjectionInput(U, H.huntsTotalByMonster()));
  return {
    confirmedXP: p.confirmedXP,
    level: p.level,
    chronicle: p.chronicle,
    monsterProgress: p.monsterProgress,
    pendingXP: p.pendingXP,
    streakMode: p.streakMode,
  };
}

async function assertNoDifference(label: string) {
  const s = stored();
  const r = await rebuilt();
  assert.equal(r.pendingXP, 0, `${label}: nothing pending on an unlinked install`);
  assert.equal(r.streakMode, 'single', label);
  assert.deepEqual(
    { confirmedXP: r.confirmedXP, level: r.level, chronicle: r.chronicle, monsterProgress: r.monsterProgress },
    s,
    label
  );
}

/** Deterministic PRNG so failures reproduce. */
function rng(seed: number) {
  let x = seed >>> 0;
  return () => {
    x = (x * 1664525 + 1013904223) >>> 0;
    return x / 2 ** 32;
  };
}

const MONSTERS = [
  { monsterId: 'hydra', workoutId: 'everlasting-cycle' },
  { monsterId: 'basilisk', workoutId: 'basilisk-confrontation' },
  { monsterId: 'minotaur', workoutId: 'labyrinth-ladder' },
  { monsterId: 'aether', workoutId: 'endless-spiral' },
  { monsterId: 'atlas', workoutId: 'atlas-chain' },
];
const ZONES = ['UTC', 'America/New_York', 'Asia/Tokyo', 'Europe/Berlin', 'Pacific/Auckland'];
const ORDERS = ['first-encounter', 'second-encounter', 'final-hunt'];

const coverage = { monsterResets: 0, campaignResets: 0, defeats: 0, completions: 0, zonesUsed: new Set<string>() };

async function randomHistory(seed: number, start: 'legacy' | 'fresh', steps: number) {
  const next = rng(seed);
  const pick = <T,>(xs: T[]) => xs[Math.floor(next() * xs.length)];
  let now = Date.parse('2026-09-01T10:00:00.000Z');
  mock.timers.enable({ apis: ['Date'], now });
  const { store } = start === 'legacy' ? await H.legacyDevice() : await H.freshDevice();
  await assertNoDifference(`seed ${seed}: after migration`);

  for (let step = 0; step < steps; step += 1) {
    now += pick([0, 2, 5, 20, 23, 25, 30, 49, 72]) * 3_600_000 + Math.floor(next() * 3_600_000);
    mock.timers.setTime(now);
    if (next() < 0.15) process.env.TZ = pick(ZONES); // the player travels
    coverage.zonesUsed.add(process.env.TZ ?? 'default');
    const roll = next();
    const m = pick(MONSTERS);
    if (roll < 0.08) {
      await store.getState().resetMonsterProgress(m.monsterId);
      coverage.monsterResets += 1;
    } else if (roll < 0.11) {
      await store.getState().resetCampaignProgress();
      coverage.campaignResets += 1;
    } else {
      coverage.completions += 1;
      const defeatedBefore = H.raw().prepare('SELECT total_monsters_defeated n FROM chronicle').get().n;
      await store.getState().completeHunt({
        monsterId: m.monsterId,
        huntId: `${m.monsterId}-${pick(ORDERS)}`,
        workoutId: m.workoutId,
        elapsedSeconds: 300 + Math.floor(next() * 1200),
        totalDamageDealt: 1000,
        criticalHits: 1,
        actualWeightKg: pick([undefined, 12, 16, 20, 24]),
      });
      coverage.defeats += H.raw().prepare('SELECT total_monsters_defeated n FROM chronicle').get().n - defeatedBefore;
    }
    await assertNoDifference(`seed ${seed}, step ${step} (roll ${roll.toFixed(2)})`);
  }
}

test('legacy install: rebuilt totals equal the stored totals right after migration', async () => {
  await H.legacyDevice();
  await assertNoDifference('legacy fixture');
});

for (const [seed, start] of [
  [1, 'legacy'],
  [2, 'legacy'],
  [3, 'fresh'],
] as const) {
  test(`random history ${seed} (${start} install, travel across time zones, both reset types): zero differences at every step`, async () => {
    await randomHistory(seed, start, 60);
  });
}

test('200 more random histories (legacy and fresh installs): zero differences at every step', async () => {
  for (let seed = 100; seed < 300; seed += 1) {
    await randomHistory(seed, seed % 3 === 0 ? 'fresh' : 'legacy', 20);
    mock.timers.reset();
    process.env.TZ = ORIGINAL_TZ;
  }
});

test('the random histories exercised both reset types, defeats, and several time zones', () => {
  assert.ok(coverage.completions > 150, JSON.stringify(coverage));
  assert.ok(coverage.monsterResets >= 5, `monster resets: ${coverage.monsterResets}`);
  assert.ok(coverage.campaignResets >= 2, `campaign resets: ${coverage.campaignResets}`);
  assert.ok(coverage.defeats >= 5, `defeats: ${coverage.defeats}`);
  assert.ok(coverage.zonesUsed.size >= 3, `zones: ${[...coverage.zonesUsed]}`);
});

test('daylight saving: 23-hour and 25-hour days, including a workout at 00:30 after the short day', async () => {
  process.env.TZ = 'America/New_York';
  const times = [
    '2026-03-07T15:00:00.000Z', // Sat 10:00 EST
    '2026-03-08T04:00:00.000Z', // Sat 23:00 EST
    '2026-03-09T04:30:00.000Z', // Mon 00:30 EDT, after the 23-hour Sunday (no Sunday workout)
    '2026-03-09T23:00:00.000Z', // Mon 19:00
    '2026-03-10T04:30:00.000Z', // Tue 00:30
    '2026-10-31T16:00:00.000Z', // Sat 12:00 EDT
    '2026-11-01T05:30:00.000Z', // Sun 00:30 EDT (25-hour day)
    '2026-11-02T05:30:00.000Z', // Mon 00:30 EST
  ];
  mock.timers.enable({ apis: ['Date'], now: Date.parse(times[0]) });
  const { store } = await H.legacyDevice();
  for (const [i, t] of times.entries()) {
    mock.timers.setTime(Date.parse(t));
    await store.getState().completeHunt({
      monsterId: 'hydra',
      huntId: 'hydra-first-encounter',
      workoutId: 'everlasting-cycle',
      elapsedSeconds: 900 - i,
      totalDamageDealt: 1000,
      criticalHits: 1,
    });
    await assertNoDifference(`DST step ${i}`);
  }
});

test('several workouts on one local day, and workouts either side of midnight', async () => {
  process.env.TZ = 'Europe/Berlin';
  mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-01T06:00:00.000Z') });
  const { store } = await H.freshDevice();
  for (const t of [
    '2026-09-01T06:00:00.000Z',
    '2026-09-01T12:00:00.000Z',
    '2026-09-01T21:59:00.000Z', // 23:59 Berlin
    '2026-09-01T22:01:00.000Z', // 00:01 next day Berlin
    '2026-09-02T21:59:00.000Z',
  ]) {
    mock.timers.setTime(Date.parse(t));
    await store.getState().completeHunt({
      monsterId: 'basilisk',
      huntId: 'basilisk-first-encounter',
      workoutId: 'basilisk-confrontation',
      elapsedSeconds: 800,
      totalDamageDealt: 1000,
      criticalHits: 1,
    });
    await assertNoDifference(t);
  }
  // 1 Sep, then 2 Sep (00:01 and 23:59 are the same Berlin day): a two-day streak.
  assert.equal(H.raw().prepare('SELECT current_streak_days n FROM chronicle').get().n, 2);
});

// ---------------------------------------------------------------- several origins (synthetic facts)

function fact(uuid: string, device: string, order: number, completedAt: string, streakAfter: number) {
  return {
    uuid,
    monsterId: 'hydra',
    completedAt,
    xpAwarded: 300,
    firstClearBonusXp: 0,
    progressionEpoch: 0,
    monsterResetCount: 0,
    volumeKg: 100,
    trainingMinutes: 15,
    streakAfter,
    originDeviceUuid: device,
    originOrder: order,
  };
}

test('several origins: streaks are recalculated in the viewing device time zone; the longest never drops', () => {
  // Device A (UTC-5 player) trains Mon and Tue evenings; device B (UTC+1) trains Wed morning.
  const posts = [
    fact('a1', 'device-a', 1, '2026-09-07T23:00:00.000Z', 1), // Mon 18:00 NY
    fact('a2', 'device-a', 2, '2026-09-08T23:00:00.000Z', 2), // Tue 18:00 NY
    fact('b1', 'device-b', 1, '2026-09-09T08:00:00.000Z', 1), // Wed 10:00 Berlin / 04:00 NY
  ];
  process.env.TZ = 'America/New_York';
  assert.deepEqual(multiOriginStreaks(null, posts), { current: 3, longest: 3 });
  process.env.TZ = 'Europe/Berlin'; // Mon 18:00 NY = Tue 01:00 Berlin; Tue 18:00 NY = Wed 01:00 Berlin
  assert.deepEqual(multiOriginStreaks(null, posts), { current: 2, longest: 2 });
  // A gap after a three-day run: current drops to 1, longest keeps the stored 5.
  const gap = [...posts, fact('b2', 'device-b', 2, '2026-09-12T08:00:00.000Z', 5)];
  process.env.TZ = 'UTC';
  assert.deepEqual(multiOriginStreaks(null, gap), { current: 1, longest: 5 });
});

test('several origins: duplicate defeats of one monster are counted once; XP and totals are sums', () => {
  const posts = ['a', 'b'].flatMap((d) =>
    [1, 2, 3].map((i) => fact(`${d}${i}`, `device-${d}`, i, `2026-09-0${i}T10:00:00.000Z`, i))
  );
  const p = rebuildTotals({
    currentEpoch: 0,
    baseline: null,
    results: posts,
    resets: [],
    claimStatusByResult: {},
    huntsTotalByMonster: { hydra: 3 },
  });
  assert.equal(p.streakMode, 'multi');
  assert.equal(p.chronicle.totalMonstersDefeated, 1);
  assert.equal(p.chronicle.totalHuntsCompleted, 6);
  assert.equal(p.confirmedXP, 1800);
  assert.deepEqual(p.monsterProgress.hydra, { huntsCompleted: 3, defeated: true });
});

test('D3 accounting: pending and lost bonuses are excluded from confirmed XP and level; final and confirmed count', () => {
  const r = (uuid: string, bonus: number) => ({ ...fact(uuid, 'd', Number(uuid.slice(1)), '2026-09-01T10:00:00.000Z', 1), xpAwarded: 421, firstClearBonusXp: bonus });
  const p = rebuildTotals({
    currentEpoch: 0,
    baseline: null,
    results: [r('r1', 100), r('r2', 100), r('r3', 100), r('r4', 100), r('r5', 0)],
    resets: [],
    claimStatusByResult: { r1: 'local_final', r2: 'confirmed', r3: 'pending', r4: 'lost' },
    huntsTotalByMonster: { hydra: 3 },
  });
  assert.equal(p.confirmedXP, 321 * 4 + 421 + 100 + 100);
  assert.equal(p.pendingXP, 100);
});

// ---------------------------------------------------------------- rank tie-break

test('rank history: identical completion times are ordered by uuid, whatever order they were loaded in', () => {
  const workout = { targetTimeSeconds: 600 } as any;
  const base = { workoutId: 'w', completedAt: '2026-09-01T10:00:00.000Z', timeSeconds: 0 } as any;
  const results = [
    { ...base, id: 'x', uuid: 'bbbb', timeMinutes: 9 },
    { ...base, id: 'y', uuid: 'aaaa', timeMinutes: 10 },
  ];
  const one = computeHistoricalRanks(results, () => workout).map((r: any) => [r.result.uuid, r.rank]);
  const two = computeHistoricalRanks([...results].reverse(), () => workout).map((r: any) => [r.result.uuid, r.rank]);
  assert.deepEqual(one, two);
  assert.deepEqual(one, [['aaaa', 'A'], ['bbbb', 'S']], 'aaaa first (10:00, A); bbbb then beats it: a personal record, rank S');
});
