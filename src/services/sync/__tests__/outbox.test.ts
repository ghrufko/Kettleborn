import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * Cloud Save P5 — the local upload queue, against the real app stack over
 * real SQLite (appHarness). No network: server answers are simulated by
 * calling applyAck() the way a transport would.
 */
const H = await import(new URL('../../../testing/appHarness.ts', import.meta.url).href);
const O = await import(new URL('../outbox.ts', import.meta.url).href);
const E = await import(new URL('../encoding.ts', import.meta.url).href);
const T = await import(new URL('../recordTypes.ts', import.meta.url).href);
const C = await import(new URL('../claimStatus.ts', import.meta.url).href);
const { DEFAULT_EQUIPMENT_SYNC_KEYS } = await import(new URL('../../db/schema.ts', import.meta.url).href);
const S = H.Services;
const U = 'local-hunter';

test.after(() => H.cleanupWorkDir());

const db = () => H.device.handle;
const queue = () => H.raw().prepare('SELECT * FROM sync_outbox ORDER BY device_seq').all().map((r: any) => ({ ...r }));
const conflicts = () => H.raw().prepare('SELECT * FROM sync_conflict').all().map((r: any) => ({ ...r }));
const enableOnly = () => H.raw().exec('UPDATE sync_state SET sync_enabled = 1');
const one = (sql: string, ...p: unknown[]) => H.raw().prepare(sql).get(...p);

const HYDRA = {
  monsterId: 'hydra',
  huntId: 'hydra-first-encounter',
  workoutId: 'everlasting-cycle',
  elapsedSeconds: 900,
  totalDamageDealt: 1200,
  criticalHits: 3,
};

/** Every syncable write path once (via the store where the harness has the slice, else the repository). */
async function everyWritePath(store: any) {
  const result = await store.getState().completeHunt(HYDRA); // result + claim (+ achievements)
  await S.WorkoutRepository.updateNotes(result.id, 'Felt the burn');
  await S.WorkoutRepository.updateRPE(result.id, 3);
  await store.getState().updateSettings({ unitPreference: 'lb' });
  await store.getState().updateSettings({ soundEnabled: false }); // device-only: never queued
  await S.SettingsRepository.upsertEquipment({ id: 'equipment-new', userId: U, type: 'kettlebell', weight: 28, unit: 'kg', label: '28 KG', owned: true });
  await S.SettingsRepository.deleteEquipment('equipment-1757000000000');
  await S.CustomHuntPresetRepository.upsert({ userId: U, workoutId: 'everlasting-cycle', weightKg: 20, weightBKg: 20, gearCount: 2, restSeconds: 60, customStructureValue: null, repsOverrides: null, updatedAt: '2026-11-11T08:00:00.000Z' });
  await S.TimerRepository.savePreset(U, { id: 'custom-9', name: 'Ladder', rounds: [], randomizeExercises: false });
  await S.TimerRepository.deletePreset('custom-9');
  await S.TimerRepository.saveResult({ id: 'timer-r1', userId: U, presetId: 'custom-1754000000000', presetName: 'EMOM 10', totalDurationSeconds: 600, completedAt: '2026-11-11T08:00:00.000Z', weightKg: 16, appVersion: '1.0.0' });
  await S.StopwatchRepository.saveResult(U, { id: 'sw-1', completedAt: '2026-11-11T08:00:00.000Z', elapsedSeconds: 61, laps: [30], note: null });
  await S.CustomWorkoutRepository.upsert(U, { id: 'cw-2', name: 'Evening', exercises: [], weightKg: 16, weightBKg: null, gearCount: 1, rounds: 3, restSeconds: 30, createdAt: '2026-11-11T08:00:00.000Z', updatedAt: '2026-11-11T08:00:00.000Z' });
  await S.CustomWorkoutRepository.saveResult(U, { id: 'cw-2-r1', customWorkoutId: 'cw-2', completedAt: '2026-11-11T08:10:00.000Z', elapsedSeconds: 300, weightKg: 16, weightBKg: null, gearCount: 1, workoutName: 'Evening', rounds: 3, restSeconds: 30, totalReps: 30, exerciseBreakdown: null });
  await S.CustomWorkoutRepository.delete('cw-2');
  await store.getState().resetMonsterProgress('aether');
  await store.getState().resetCampaignProgress();
  return result;
}

// ---------------------------------------------------------------- sync off / on

test('sync off (every install today): no write path queues anything', async () => {
  const { store } = await H.legacyDevice();
  await everyWritePath(store);
  assert.equal(queue().length, 0);
  assert.equal(one('SELECT sync_enabled n FROM sync_state').n, 0);
});

test('sync on: every write path queues its item, device settings never, notes/RPE fold into the unsent insert', async () => {
  const { store } = await H.legacyDevice();
  enableOnly();
  const result = await everyWritePath(store);
  const rows = queue();
  const find = (type: string, key?: string) => rows.filter((r: any) => r.entity_type === type && (key === undefined || r.entity_key === key));

  const hunt = find('hunt_result', result.uuid);
  assert.equal(hunt.length, 1, 'notes and RPE folded into the queued insert');
  assert.equal(hunt[0].op, 'insert');
  const payload = JSON.parse(hunt[0].payload_json);
  assert.equal(payload.notes, 'Felt the burn');
  assert.equal(payload.rpe, 3);
  assert.equal(find('first_clear_claim', 'workout:everlasting-cycle@0').length, 1);
  assert.ok(find('first_clear_claim')[0].device_seq > hunt[0].device_seq, 'claim queued after its result');
  assert.ok(find('achievement').length >= 1);

  const settings = find('settings_account');
  assert.equal(settings.length, 1, 'only the unit change is queued');
  assert.deepEqual(JSON.parse(settings[0].payload_json), { unit_preference: 'lb' });

  assert.equal(find('equipment').find((r: any) => JSON.parse(r.payload_json).id === 'equipment-new').op, 'insert');
  const deletedBell = find('equipment').find((r: any) => JSON.parse(r.payload_json).id === 'equipment-1757000000000');
  assert.equal(deletedBell.op, 'delete');
  assert.ok(JSON.parse(deletedBell.payload_json).deleted_at, 'a delete carries the full last state');
  assert.equal(find('custom_hunt_preset', 'everlasting-cycle')[0].op, 'insert');

  const timer = find('timer_preset');
  assert.equal(timer.length, 1);
  assert.equal(timer[0].op, 'insert', 'a never-sent insert followed by delete stays one insert…');
  assert.ok(JSON.parse(timer[0].payload_json).deleted_at, '…carrying the tombstone');
  assert.equal(find('timer_result').length, 1);
  assert.equal(find('stopwatch_result').length, 1);

  const workout = find('custom_workout');
  assert.equal(workout.length, 1);
  assert.equal(workout[0].op, 'insert');
  assert.ok(JSON.parse(workout[0].payload_json).deleted_at);
  const cwResult = find('custom_workout_result');
  assert.equal(cwResult.length, 1, 'the result is queued once and never re-sent for its parent deletion');
  assert.equal('deleted_at' in JSON.parse(cwResult[0].payload_json), false, 'hiding is derived from the parent');
  assert.equal(find('progress_reset').length, 2);
});

test('atomic: when the queue write fails the change is rolled back; when the change fails nothing is queued', async () => {
  const { store } = await H.legacyDevice();
  enableOnly();
  const bells = () => H.raw().prepare('SELECT * FROM equipment ORDER BY id').all().map((r: any) => ({ ...r }));
  const before = bells();
  H.raw().exec("CREATE TRIGGER no_queue BEFORE INSERT ON sync_outbox BEGIN SELECT RAISE(ABORT, 'injected queue failure'); END;");
  await assert.rejects(S.SettingsRepository.upsertEquipment({ id: 'x', userId: U, type: 'kettlebell', weight: 8, unit: 'kg', label: '8', owned: true }), /injected/);
  assert.deepEqual(bells(), before);
  const resultsBefore = one('SELECT COUNT(*) n FROM workout_result').n;
  await assert.rejects(store.getState().completeHunt(HYDRA), /injected/);
  assert.equal(one('SELECT COUNT(*) n FROM workout_result').n, resultsBefore);
  await assert.rejects(S.StopwatchRepository.saveResult(U, { id: 'sw-x', completedAt: 't', elapsedSeconds: 1, laps: [], note: null }), /injected/);
  assert.equal(one("SELECT COUNT(*) n FROM stopwatch_result WHERE id = 'sw-x'").n, 0);
  H.raw().exec('DROP TRIGGER no_queue');

  H.raw().exec("CREATE TRIGGER no_timer BEFORE INSERT ON timer_result BEGIN SELECT RAISE(ABORT, 'injected source failure'); END;");
  await assert.rejects(S.TimerRepository.saveResult({ id: 't-x', userId: U, presetId: 'p', presetName: 'p', totalDurationSeconds: 1, completedAt: 't', weightKg: null, appVersion: '1' }), /injected/);
  assert.equal(queue().length, 0);
  assert.equal(H.raw().isTransaction, false);
});

// ---------------------------------------------------------------- folding (queued rows)

async function enq(type: string, key: string, op: string, payload: object, field: string | null = null) {
  await O.enqueue(db(), { entityType: type, entityKey: key, field, op, payload });
}
const itemRows = (key: string) => queue().filter((r: any) => r.entity_key === key);

test('folding: every combination of two unsent changes to one record', async () => {
  await H.freshDevice();
  enableOnly();
  const cases: Array<[string, string, string]> = [
    ['insert', 'update', 'insert'],
    ['insert', 'delete', 'insert'],
    ['update', 'update', 'update'],
    ['update', 'delete', 'delete'],
    ['delete', 'update', 'update'],
    ['delete', 'delete', 'delete'],
  ];
  for (const [first, second, expected] of cases) {
    const key = `fold-${first}-${second}`;
    await enq('custom_workout', key, first, { v: 1 });
    H.raw().prepare('UPDATE sync_outbox SET base_seq = 7 WHERE entity_key = ?').run(key);
    const seq = itemRows(key)[0].device_seq;
    await enq('custom_workout', key, second, { v: 2 });
    const rows = itemRows(key);
    assert.equal(rows.length, 1, key);
    assert.deepEqual(
      [rows[0].op, rows[0].device_seq, rows[0].base_seq, JSON.parse(rows[0].payload_json)],
      [expected, seq, 7, { v: 2 }],
      `${first} → ${second}`
    );
  }
});

test('folding: notes/RPE fold into an unsent fact insert; distinct facts never fold', async () => {
  await H.freshDevice();
  enableOnly();
  await enq('hunt_result', 'r1', 'insert', { uuid: 'r1', notes: null, rpe: null });
  await enq('hunt_result', 'r1', 'update', { value: 'note' }, 'notes');
  await enq('hunt_result', 'r1', 'update', { value: 4 }, 'rpe');
  await enq('hunt_result', 'r2', 'insert', { uuid: 'r2' });
  const rows = queue();
  assert.equal(rows.length, 2);
  assert.deepEqual(JSON.parse(rows[0].payload_json), { uuid: 'r1', notes: 'note', rpe: 4 });
});

// ---------------------------------------------------------------- in flight (R) and successor (S)

const TRANSITIONS: Array<[string, string]> = [
  ['insert', 'update'],
  ['insert', 'delete'],
  ['update', 'update'],
  ['update', 'delete'],
  ['delete', 'update'],
  ['delete', 'delete'],
];
const OUTCOMES = ['accepted', 'lost-ack-then-duplicate', 'stale', 'invalid'] as const;

test('in flight: every transition × every server outcome keeps R unchanged and the newest local state', async () => {
  await H.freshDevice();
  enableOnly();
  for (const [first, second] of TRANSITIONS) {
    for (const outcome of OUTCOMES) {
      H.raw().exec('DELETE FROM sync_outbox; DELETE FROM sync_conflict;');
      const key = `${first}-${second}-${outcome}`;
      await enq('equipment', key, first, { v: 'sent' });
      let [r] = await O.takeBatch(db(), 10);
      assert.equal(r.entity_key, key);

      // Several consecutive changes while R is in flight: they all land in one successor S.
      await enq('equipment', key, second, { v: 's1' });
      await enq('equipment', key, second, { v: 's2' });
      const expectS = !(first === 'delete' && second === 'delete');
      const pending = itemRows(key).filter((x: any) => x.state === 'queued');
      assert.equal(pending.length, expectS ? 1 : 0, `${key}: one successor`);
      assert.equal(JSON.parse(itemRows(key).find((x: any) => x.device_seq === r.device_seq).payload_json).v, 'sent', `${key}: R untouched`);
      assert.deepEqual(await O.takeBatch(db(), 10), [], `${key}: S waits for R`);

      if (outcome === 'lost-ack-then-duplicate') {
        await O.resetInFlight(db()); // the acknowledgement was lost; the app restarted
        await enq('equipment', key, second, { v: 's3' }); // must not fold into the re-queued R
        const again = await O.takeBatch(db(), 10);
        assert.deepEqual(again.map((x: any) => [x.device_seq, JSON.parse(x.payload_json).v]), [[r.device_seq, 'sent']], `${key}: R resent unchanged`);
        r = again[0];
        await O.applyAck(db(), r.device_seq, { status: 'duplicate', serverSeq: 41 });
      } else if (outcome === 'accepted') {
        await O.applyAck(db(), r.device_seq, { status: 'accepted', serverSeq: 41 });
      } else if (outcome === 'stale') {
        await O.applyAck(db(), r.device_seq, { status: 'stale', serverSeq: 50, serverValue: { v: 'server' } });
      } else {
        await O.applyAck(db(), r.device_seq, { status: 'invalid', error: 'payload rejected' });
      }

      const rows = itemRows(key);
      // delete → delete never creates a successor (deleting what is already being deleted does nothing).
      const newest = !expectS ? 'sent' : outcome === 'lost-ack-then-duplicate' ? 's3' : 's2';
      if (outcome === 'accepted' || outcome === 'lost-ack-then-duplicate') {
        assert.equal(rows.length, expectS ? 1 : 0, key);
        if (rows.length) {
          assert.equal(rows[0].base_seq, 41, `${key}: S is based on R's server version`);
          assert.equal(JSON.parse(rows[0].payload_json).v, newest);
          assert.equal((await O.takeBatch(db(), 10)).length, 1, `${key}: S is now sent`);
        }
      } else if (outcome === 'stale') {
        assert.equal(rows.length, 0, key);
        const c = conflicts();
        assert.equal(c.length, 1, key);
        assert.equal(JSON.parse(c[0].local_value_json).v, newest, `${key}: the conflict keeps the newest local state`);
        assert.deepEqual(JSON.parse(c[0].server_value_json), { v: 'server' });
      } else {
        assert.equal(rows.find((x: any) => x.device_seq === r.device_seq).state, 'quarantined', key);
        assert.equal(rows.filter((x: any) => x.state === 'queued').length, expectS ? 1 : 0, `${key}: S kept`);
        assert.deepEqual(await O.takeBatch(db(), 10), [], `${key}: S stays blocked behind the quarantined row`);
      }
    }
  }
});

test('a repeated acknowledgement changes nothing', async () => {
  await H.freshDevice();
  enableOnly();
  await enq('timer_preset', 'p', 'update', { v: 1 });
  const [r] = await O.takeBatch(db(), 10);
  await enq('timer_preset', 'p', 'update', { v: 2 });
  await O.applyAck(db(), r.device_seq, { status: 'accepted', serverSeq: 9 });
  await O.applyAck(db(), r.device_seq, { status: 'accepted', serverSeq: 9 });
  assert.deepEqual(queue().map((x: any) => [x.base_seq, JSON.parse(x.payload_json).v]), [[9, 2]]);
});

// ---------------------------------------------------------------- first-link seed

/** Independent, hand-written expected inventory — NOT derived from RECORD_TYPES. */
const EXPECTED_FIELDS: Record<string, { table: string; fields: string[]; localOnly: string[] }> = {
  baseline: { table: 'progress_baseline', fields: ['uuid', 'origin_device_uuid', 'epoch', 'created_at', 'total_xp', 'level', 'total_workouts', 'total_hunts_completed', 'total_monsters_defeated', 'total_volume_kg', 'total_training_minutes', 'current_streak_days', 'longest_streak_days', 'chronicle_updated_at'], localOnly: ['user_id'] },
  custom_workout: { table: 'custom_workout', fields: ['id', 'name', 'exercises_json', 'weight_kg', 'weight_b_kg', 'gear_count', 'rounds', 'rest_seconds', 'created_at', 'updated_at', 'uuid', 'deleted_at'], localOnly: ['user_id'] },
  timer_preset: { table: 'timer_preset', fields: ['id', 'name', 'rounds_json', 'created_at', 'linked_workout_id', 'randomize_exercises', 'uuid', 'updated_at', 'deleted_at'], localOnly: ['user_id'] },
  equipment: { table: 'equipment', fields: ['id', 'type', 'weight', 'unit', 'label', 'owned', 'uuid', 'updated_at', 'deleted_at', 'sync_key'], localOnly: ['user_id'] },
  custom_hunt_preset: { table: 'custom_hunt_preset', fields: ['workout_id', 'weight_kg', 'weight_b_kg', 'gear_count', 'rest_seconds', 'custom_structure_value', 'reps_overrides_json', 'updated_at'], localOnly: ['user_id'] },
  settings_account: { table: 'settings', fields: ['unit_preference'], localOnly: ['user_id', 'sound_enabled', 'haptics_enabled', 'reduce_motion', 'notifications_enabled', 'keep_screen_awake', 'updated_at'] },
  hunt_result: { table: 'workout_result', fields: ['id', 'workout_id', 'monster_id', 'hunt_id', 'completed_at', 'time_minutes', 'time_seconds', 'weight_value_a', 'weight_value_b', 'weight_unit', 'notes', 'xp_awarded', 'difficulty', 'app_version', 'rung_times_json', 'rpe', 'is_custom_hunt', 'rest_seconds_used', 'structural_value_used', 'reps_overrides_used_json', 'extra_sets_json', 'uuid', 'updated_at', 'voided_at', 'void_reset_uuid', 'first_clear_bonus_xp', 'progression_epoch', 'monster_reset_count', 'volume_kg', 'training_minutes', 'origin_device_uuid', 'origin_order', 'streak_after', 'tz_offset_minutes', 'pr_bonus_xp', 'repeat_multiplier', 'prior_clears_seen'], localOnly: ['user_id'] },
  custom_workout_result: { table: 'custom_workout_result', fields: ['id', 'custom_workout_id', 'completed_at', 'elapsed_seconds', 'weight_kg', 'weight_b_kg', 'gear_count', 'workout_name', 'rounds', 'rest_seconds', 'total_reps', 'exercise_breakdown_json', 'uuid', 'custom_workout_uuid'], localOnly: ['user_id', 'deleted_at'] },
  timer_result: { table: 'timer_result', fields: ['id', 'preset_id', 'preset_name', 'total_duration_seconds', 'completed_at', 'weight_kg', 'app_version', 'uuid', 'preset_uuid'], localOnly: ['user_id'] },
  stopwatch_result: { table: 'stopwatch_result', fields: ['id', 'completed_at', 'elapsed_seconds', 'lap_seconds_json', 'note', 'uuid'], localOnly: ['user_id'] },
  progress_reset: { table: 'progress_reset', fields: ['uuid', 'scope', 'monster_id', 'reset_at', 'voided_result_count', 'snapshot_json', 'epoch', 'to_epoch', 'count_before', 'count_after'], localOnly: ['user_id'] },
  first_clear_claim: { table: 'first_clear_claim', fields: ['stage_key', 'epoch', 'result_uuid', 'claimed_at', 'status'], localOnly: ['user_id'] },
  achievement: { table: 'achievement', fields: ['milestone_type', 'unlocked_at'], localOnly: ['user_id'] },
};
const NOT_SEEDED = ['user', 'chronicle', 'monster_progress', 'campaign_progress', 'schema_migrations', 'sync_state', 'sync_outbox', 'sync_conflict', 'sync_item_version', 'sync_notice', 'sqlite_sequence', 'progress_baseline_monster'];

test('inventory: every table and every column is classified; the encoder sends exactly the expected fields', async () => {
  await H.legacyDevice();
  const tables = H.raw().prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((r: any) => r.name);
  const seededTables = Object.values(EXPECTED_FIELDS).map((e) => e.table);
  for (const table of tables) {
    assert.ok(seededTables.includes(table) || NOT_SEEDED.includes(table), `unclassified table: ${table}`);
    assert.ok(T.TABLE_CLASSIFICATION[table], `table missing from TABLE_CLASSIFICATION: ${table}`);
  }
  assert.deepEqual([...T.SEED_ORDER].sort(), Object.keys(EXPECTED_FIELDS).sort(), 'record types');
  for (const [type, expected] of Object.entries(EXPECTED_FIELDS)) {
    const spec = T.RECORD_TYPES[type];
    assert.equal(spec.table, expected.table, type);
    assert.deepEqual([...spec.fields], expected.fields, `${type}: fields`);
    assert.deepEqual(Object.keys(spec.localOnly).sort(), [...expected.localOnly].sort(), `${type}: local-only`);
    const columns = H.raw().prepare(`PRAGMA table_info(${expected.table})`).all().map((c: any) => c.name).sort();
    assert.deepEqual(columns, [...expected.fields, ...expected.localOnly].sort(), `${type}: every column of ${expected.table} is classified`);
  }
  const monsterCols = H.raw().prepare('PRAGMA table_info(progress_baseline_monster)').all().map((c: any) => c.name).sort();
  assert.deepEqual(monsterCols, ['baseline_uuid', ...T.BASELINE_MONSTER_FIELDS].sort());
});

/** A legacy install with every variant a seed must carry. */
async function maximalDevice() {
  const { store } = await H.legacyDevice();
  const hunt = await store.getState().completeHunt(HYDRA);
  await S.WorkoutRepository.updateNotes(hunt.id, 'Felt the burn');
  await store.getState().resetMonsterProgress('minotaur');
  await S.CustomWorkoutRepository.upsert(U, { id: 'cw-2', name: 'Evening', exercises: [], weightKg: 16, weightBKg: null, gearCount: 1, rounds: 3, restSeconds: 30, createdAt: '2026-11-11T08:00:00.000Z', updatedAt: '2026-11-11T08:00:00.000Z' });
  await S.CustomWorkoutRepository.saveResult(U, { id: 'cw-2-r1', customWorkoutId: 'cw-2', completedAt: '2026-11-11T08:10:00.000Z', elapsedSeconds: 300, weightKg: 16, weightBKg: null, gearCount: 1, workoutName: 'Evening', rounds: 3, restSeconds: 30, totalReps: 30, exerciseBreakdown: null });
  await S.CustomWorkoutRepository.delete('cw-2');
  H.raw().exec(`INSERT INTO custom_workout_result (id, custom_workout_id, completed_at, elapsed_seconds, weight_kg, gear_count, user_id, uuid, deleted_at)
                VALUES ('orphan-1', 'gone', '2026-08-01T00:00:00.000Z', 100, 12, 1, '${U}', 'aaaaaaaa-0000-4000-8000-000000000001', '2026-08-02T00:00:00.000Z')`);
  await S.SettingsRepository.deleteEquipment('equipment-1757000000000');
  await S.SettingsRepository.deleteEquipment('kb-2');
  await S.SettingsRepository.upsertEquipment({ id: 'kb-2', userId: U, type: 'kettlebell', weight: 16, unit: 'kg', label: '16 KG', owned: true });
  await S.TimerRepository.deletePreset('custom-1754000000000');
  await S.TimerRepository.saveResult({ id: 'builtin-r1', userId: U, presetId: 'builtin-tabata', presetName: 'Tabata', totalDurationSeconds: 240, completedAt: '2026-11-11T09:00:00.000Z', weightKg: null, appVersion: '1.0.0' });
  return { store, hunt };
}

test('seed: every syncable record is queued exactly once, voided and deleted included, in dependency order', async () => {
  const { hunt } = await maximalDevice();
  assert.equal(queue().length, 0, 'nothing queued before linking');
  const seeded = await O.enableAndSeed(db(), U, 'auth-user-1');
  const rows = queue();
  assert.equal(rows.length, seeded);
  assert.deepEqual({ ...one('SELECT sync_enabled, linked_user_id FROM sync_state') }, { sync_enabled: 1, linked_user_id: 'auth-user-1' });

  for (const type of T.SEED_ORDER) {
    const spec = T.RECORD_TYPES[type];
    const local = H.raw().prepare(spec.selectAll).all(U).map((r: any) => spec.key(r));
    const queued = rows.filter((r: any) => r.entity_type === type).map((r: any) => r.entity_key);
    assert.deepEqual(queued, local, `${type}: same identities, same (creation) order`);
    assert.ok(rows.filter((r: any) => r.entity_type === type).every((r: any) => r.op === 'insert' && r.field === null));
  }
  const typeOrder = rows.map((r: any) => T.SEED_ORDER.indexOf(r.entity_type));
  assert.deepEqual(typeOrder, [...typeOrder].sort((a, b) => a - b), 'types follow SEED_ORDER');
  const resultSeq = rows.find((r: any) => r.entity_key === hunt.uuid).device_seq;
  const claimSeq = rows.find((r: any) => r.entity_key === 'workout:everlasting-cycle@0').device_seq;
  assert.ok(resultSeq < claimSeq);
  // Variants present.
  assert.ok(H.raw().prepare('SELECT COUNT(*) n FROM workout_result WHERE voided_at IS NOT NULL').get().n > 0);
  assert.ok(rows.some((r: any) => r.entity_type === 'custom_workout' && JSON.parse(r.payload_json).deleted_at));
});

test('seed payloads equal hand-written expected values (weights, durations, notes, RPE, XP breakdown, void links, tombstones, legacy NULLs)', async () => {
  const { hunt } = await maximalDevice();
  await O.enableAndSeed(db(), U, 'auth-user-1');
  const payloadOf = (type: string, key: string) => JSON.parse(queue().find((r: any) => r.entity_type === type && r.entity_key === key).payload_json);
  const uuidOf = (table: string, id: string) => one(`SELECT uuid FROM ${table} WHERE id = ?`, id).uuid;
  const minotaurUuid = uuidOf('workout_result', 'labyrinth-ladder-1756400000000');
  const reset = one("SELECT uuid, reset_at FROM progress_reset WHERE scope = 'monster' AND monster_id = 'minotaur'");

  assert.deepEqual(payloadOf('hunt_result', minotaurUuid), {
    id: 'labyrinth-ladder-1756400000000', workout_id: 'labyrinth-ladder', monster_id: 'minotaur', hunt_id: 'minotaur-first-encounter',
    completed_at: '2026-08-28T06:15:00.000Z', time_minutes: 18, time_seconds: 12, weight_value_a: 16, weight_value_b: 18,
    weight_unit: 'kg', notes: 'Ladder PR attempt', xp_awarded: 690, difficulty: 3, app_version: '0.1.0',
    rung_times_json: '[{"round":1,"elapsedSeconds":60},{"round":2,"elapsedSeconds":150}]', rpe: 3, is_custom_hunt: 0,
    rest_seconds_used: null, structural_value_used: null, reps_overrides_used_json: null,
    extra_sets_json: '[{"id":"extra-1756400000500","exerciseId":"vertical-pullup","reps":8}]', uuid: minotaurUuid,
    updated_at: reset.reset_at, voided_at: reset.reset_at, void_reset_uuid: reset.uuid, first_clear_bonus_xp: null,
    progression_epoch: 0, monster_reset_count: 0, volume_kg: null, training_minutes: null, origin_device_uuid: null,
    origin_order: null, streak_after: null, tz_offset_minutes: null, pr_bonus_xp: null, repeat_multiplier: null, prior_clears_seen: null,
  });
  const atlas = payloadOf('hunt_result', uuidOf('workout_result', 'atlas-chain-1756300000000'));
  assert.deepEqual(
    [atlas.weight_value_a, atlas.weight_value_b, atlas.is_custom_hunt, atlas.rest_seconds_used, atlas.reps_overrides_used_json, atlas.time_minutes, atlas.time_seconds, atlas.rpe, atlas.voided_at],
    [20, null, 1, 90, '{"swing":15}', 20, 5, 4, null]
  );
  const fresh = payloadOf('hunt_result', hunt.uuid);
  assert.deepEqual(
    [fresh.time_minutes, fresh.time_seconds, fresh.training_minutes, fresh.weight_value_a, fresh.weight_value_b, fresh.notes,
      fresh.first_clear_bonus_xp, fresh.pr_bonus_xp, fresh.repeat_multiplier, fresh.prior_clears_seen, fresh.progression_epoch,
      fresh.monster_reset_count, fresh.origin_order, fresh.streak_after],
    [15, 0, 15, 16, 16, 'Felt the burn', 100, 0, 1, 0, 0, 0, 1, 1]
  );
  assert.equal(fresh.xp_awarded, H.raw().prepare('SELECT xp_awarded n FROM workout_result WHERE uuid = ?').get(hunt.uuid).n);

  assert.deepEqual(payloadOf('first_clear_claim', 'workout:labyrinth-ladder@0'), {
    stage_key: 'workout:labyrinth-ladder', epoch: 0, result_uuid: minotaurUuid, claimed_at: '2026-08-28T06:15:00.000Z', status: 'local_final',
  });
  assert.deepEqual(
    (({ uuid, reset_at, snapshot_json, ...rest }) => rest)(payloadOf('progress_reset', reset.uuid)),
    { scope: 'monster', monster_id: 'minotaur', voided_result_count: 1, epoch: 0, to_epoch: null, count_before: 0, count_after: 1 }
  );

  const kb2 = payloadOf('equipment', DEFAULT_EQUIPMENT_SYNC_KEYS['kb-2']);
  assert.deepEqual(
    (({ uuid, updated_at, ...rest }) => rest)(kb2),
    { id: 'kb-2', type: 'kettlebell', weight: 16, unit: 'kg', label: '16 KG', owned: 1, deleted_at: null, sync_key: DEFAULT_EQUIPMENT_SYNC_KEYS['kb-2'] }
  );
  const oldBell = queue().map((r: any) => JSON.parse(r.payload_json)).find((p: any) => p.id === 'equipment-1757000000000');
  assert.equal(oldBell.weight, 24);
  assert.ok(oldBell.deleted_at);
  assert.deepEqual(payloadOf('settings_account', 'account'), { unit_preference: 'kg' });
  assert.deepEqual(payloadOf('custom_hunt_preset', 'atlas-chain'), {
    workout_id: 'atlas-chain', weight_kg: 20, weight_b_kg: null, gear_count: 1, rest_seconds: 90, custom_structure_value: null,
    reps_overrides_json: '{"swing":15}', updated_at: '2026-08-27T18:00:00.000Z',
  });

  const cwUuid = one("SELECT uuid FROM custom_workout WHERE id = 'custom-workout-1755000000000'").uuid;
  const cwResult = payloadOf('custom_workout_result', uuidOf('custom_workout_result', 'custom-workout-1755000000000-1755100000000'));
  assert.deepEqual(
    (({ uuid, ...rest }) => rest)(cwResult),
    {
      id: 'custom-workout-1755000000000-1755100000000', custom_workout_id: 'custom-workout-1755000000000', completed_at: '2026-08-13T06:30:00.000Z',
      elapsed_seconds: 900, weight_kg: 16, weight_b_kg: 16, gear_count: 2, workout_name: 'Morning Complex', rounds: 5, rest_seconds: 60,
      total_reps: 50, exercise_breakdown_json: '[{"name":"Swing","totalReps":50}]', custom_workout_uuid: cwUuid,
    }
  );
  assert.equal(payloadOf('custom_workout_result', 'aaaaaaaa-0000-4000-8000-000000000001').deleted_at, '2026-08-02T00:00:00.000Z', 'orphan keeps its own marker');
  assert.equal(payloadOf('timer_result', uuidOf('timer_result', 'builtin-r1')).preset_uuid, null);
  const presetUuid = one("SELECT uuid FROM timer_preset WHERE id = 'custom-1754000000000'").uuid;
  assert.equal(payloadOf('timer_result', uuidOf('timer_result', 'custom-1754000000000-1754100000000')).preset_uuid, presetUuid);
  assert.ok(payloadOf('timer_preset', presetUuid).deleted_at, 'deleted preset seeded as a tombstone');
  assert.deepEqual(payloadOf('stopwatch_result', uuidOf('stopwatch_result', 'stopwatch-1753000000000')), {
    id: 'stopwatch-1753000000000', completed_at: '2026-08-03T12:00:00.000Z', elapsed_seconds: 1234, lap_seconds_json: '[300,610,905]',
    note: 'Hill sprints', uuid: uuidOf('stopwatch_result', 'stopwatch-1753000000000'),
  });
  assert.deepEqual(payloadOf('achievement', 'first-victory'), { milestone_type: 'first-victory', unlocked_at: '2026-08-24T07:00:00.000Z' });

  const baselineUuid = one('SELECT uuid FROM progress_baseline').uuid;
  const b = payloadOf('baseline', baselineUuid);
  assert.deepEqual(
    (({ uuid, origin_device_uuid, created_at, ...rest }) => rest)(b),
    {
      epoch: 0, total_xp: 4120, level: 7, total_workouts: 9, total_hunts_completed: 9, total_monsters_defeated: 1,
      total_volume_kg: 48250.5, total_training_minutes: 141, current_streak_days: 2, longest_streak_days: 6,
      chronicle_updated_at: '2026-08-29T08:00:00.000Z',
      monsters: [
        { monster_id: 'aether', hunts_completed: 3, hunts_total: 3, defeated: 1, monster_reset_count: 0 },
        { monster_id: 'arachne', hunts_completed: 2, hunts_total: 3, defeated: 0, monster_reset_count: 0 },
        { monster_id: 'atlas', hunts_completed: 1, hunts_total: 3, defeated: 0, monster_reset_count: 0 },
        { monster_id: 'hydra', hunts_completed: 0, hunts_total: 3, defeated: 0, monster_reset_count: 0 },
        { monster_id: 'minotaur', hunts_completed: 1, hunts_total: 3, defeated: 0, monster_reset_count: 0 },
      ],
    }
  );
});

test('decode: hand-written payloads map back to hand-written rows (parent-derived deletion included)', () => {
  assert.deepEqual(
    E.decodeToRow('stopwatch_result', { id: 's', completed_at: 'c', elapsed_seconds: 5, lap_seconds_json: '[1]', note: 'n', uuid: 'u' }, U),
    { user_id: U, id: 's', completed_at: 'c', elapsed_seconds: 5, lap_seconds_json: '[1]', note: 'n', uuid: 'u' }
  );
  const base = { id: 'r', custom_workout_id: 'w', completed_at: 'c', elapsed_seconds: 1, weight_kg: 8, weight_b_kg: null, gear_count: 1, workout_name: 'x', rounds: 1, rest_seconds: 0, total_reps: 1, exercise_breakdown_json: null, uuid: 'u' };
  assert.equal('deleted_at' in E.decodeToRow('custom_workout_result', { ...base, custom_workout_uuid: 'p' }, U), false);
  assert.equal(E.decodeToRow('custom_workout_result', { ...base, custom_workout_uuid: null, deleted_at: 'd' }, U).deleted_at, 'd');
  assert.deepEqual(E.decodeToRow('settings_account', { unit_preference: 'lb', sound_enabled: 0 }, U), { user_id: U, unit_preference: 'lb' }, 'device fields are never taken');
});

test('seed has no gap: a completion racing the seed is queued exactly once, in either order', async () => {
  for (const seedFirst of [true, false]) {
    const { store } = await H.legacyDevice();
    const seed = () => O.enableAndSeed(db(), U, 'auth-user-1');
    const play = () => store.getState().completeHunt(HYDRA);
    const [a, b] = seedFirst ? await Promise.all([seed(), play()]) : await Promise.all([play(), seed()]);
    const result = seedFirst ? b : a;
    assert.equal(queue().filter((r: any) => r.entity_key === result.uuid).length, 1, `seedFirst=${seedFirst}`);
    assert.equal(queue().filter((r: any) => r.entity_key === 'workout:everlasting-cycle@0').length, 1);
  }
});

test('seed is refused on an install whose history is blocked (C1), and when already enabled', async () => {
  await H.legacyDevice();
  H.raw().exec("UPDATE sync_state SET sync_blocked_reason = 'campaign_reset_count_mismatch'");
  await assert.rejects(O.enableAndSeed(db(), U, 'u'), O.SyncBlockedError);
  assert.equal(one('SELECT sync_enabled n FROM sync_state').n, 0);
  assert.equal(queue().length, 0);
  H.raw().exec('UPDATE sync_state SET sync_blocked_reason = NULL');
  await O.enableAndSeed(db(), U, 'u');
  await assert.rejects(O.enableAndSeed(db(), U, 'u'), /already enabled/);
});

// ---------------------------------------------------------------- claim status

test('claim status transitions (2.0.9 §4)', () => {
  assert.equal(C.initialClaimStatus(false), 'local_final');
  assert.equal(C.initialClaimStatus(true), 'pending');
  const table: Array<[string, string, string]> = [
    ['pending', 'server_accepted', 'confirmed'],
    ['pending', 'server_claimed_elsewhere', 'lost'],
    ['pending', 'retry', 'pending'],
    ['pending', 'server_rejected', 'pending'],
    ['pending', 'account_deleted', 'local_final'],
    ['local_final', 'server_accepted', 'local_final'],
    ['local_final', 'server_claimed_elsewhere', 'local_final'],
    ['local_final', 'server_rejected', 'local_final'],
    ['confirmed', 'retry', 'confirmed'],
    ['confirmed', 'server_claimed_elsewhere', 'confirmed'],
    ['lost', 'server_accepted', 'lost'],
  ];
  for (const [from, event, to] of table) {
    assert.equal(C.nextClaimStatus(from, event), to, `${from} + ${event}`);
  }
});

test('seeding twice the same claims (a retried seed) cannot create a second claim or bonus', async () => {
  await H.legacyDevice();
  await O.enableAndSeed(db(), U, 'u');
  const claims = queue().filter((r: any) => r.entity_type === 'first_clear_claim');
  // Re-queueing the same claim folds into the same unsent row.
  for (const c of claims) await O.enqueue(db(), { entityType: 'first_clear_claim', entityKey: c.entity_key, op: 'insert', payload: JSON.parse(c.payload_json) });
  assert.equal(queue().filter((r: any) => r.entity_type === 'first_clear_claim').length, claims.length);
  assert.equal(one('SELECT COUNT(*) n FROM first_clear_claim').n, claims.length);
});

test('property: random edits, uploads, lost acknowledgements and restarts always leave the server with each item\'s newest local state', async () => {
  await H.freshDevice();
  enableOnly();
  let x = 12345;
  const next = () => ((x = (x * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  for (let run = 0; run < 40; run += 1) {
    H.raw().exec('DELETE FROM sync_outbox; DELETE FROM sync_conflict;');
    const server = new Map<string, { seq: number; payload: any; applied: Set<number> }>();
    const latest = new Map<string, any>();
    const deleted = new Set<string>();
    let serverSeq = 0;
    let counter = 0;
    const keys = ['a', 'b', 'c'].map((k) => `prop-${run}-${k}`);

    for (let step = 0; step < 60; step += 1) {
      const roll = next();
      if (roll < 0.55) {
        const key = keys[Math.floor(next() * keys.length)];
        counter += 1;
        const first = !latest.has(key);
        const op = first ? 'insert' : deleted.has(key) ? 'update' : next() < 0.15 ? 'delete' : 'update';
        const payload = { v: counter, deleted: op === 'delete' };
        if (op === 'delete') deleted.add(key);
        else deleted.delete(key);
        latest.set(key, payload);
        await enq('custom_workout', key, op, payload);
      } else if (roll < 0.8) {
        const batch = await O.takeBatch(db(), 2);
        for (const row of batch) {
          if (next() < 0.25) continue; // acknowledgement lost: the row stays in flight
          const item = server.get(row.entity_key) ?? { seq: 0, payload: null, applied: new Set<number>() };
          let status: 'accepted' | 'duplicate' = 'accepted';
          if (item.applied.has(row.device_seq)) status = 'duplicate';
          else {
            serverSeq += 1;
            item.seq = serverSeq;
            item.payload = JSON.parse(row.payload_json);
            item.applied.add(row.device_seq);
          }
          server.set(row.entity_key, item);
          await O.applyAck(db(), row.device_seq, { status, serverSeq: item.seq });
        }
      } else if (roll < 0.9) {
        await O.resetInFlight(db()); // network failure or app restart
      }
    }
    // Drain: everything gets through eventually.
    for (let guard = 0; guard < 200 && queue().length > 0; guard += 1) {
      await O.resetInFlight(db());
      for (const row of await O.takeBatch(db(), 10)) {
        const item = server.get(row.entity_key) ?? { seq: 0, payload: null, applied: new Set<number>() };
        let status: 'accepted' | 'duplicate' = 'duplicate';
        if (!item.applied.has(row.device_seq)) {
          status = 'accepted';
          serverSeq += 1;
          item.seq = serverSeq;
          item.payload = JSON.parse(row.payload_json);
          item.applied.add(row.device_seq);
        }
        server.set(row.entity_key, item);
        await O.applyAck(db(), row.device_seq, { status, serverSeq: item.seq });
      }
    }
    assert.equal(queue().length, 0, `run ${run}: queue drained`);
    assert.equal(conflicts().length, 0);
    for (const [key, payload] of latest) {
      assert.deepEqual(server.get(key)?.payload, payload, `run ${run}, ${key}: server holds the newest local state`);
    }
  }
});
