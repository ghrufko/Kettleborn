import { RECORD_TYPES, SEED_ORDER, type EntityType } from './recordTypes';

/**
 * Cloud Save P6 (decision D1): the Supabase schema for sync, GENERATED from
 * RECORD_TYPES so the 13 server tables can never drift from what the
 * device sends. `npm run generate:sync-sql` writes the migration file; a
 * test fails if the committed file differs from this generator's output.
 *
 * Every table follows one pattern:
 * - user_id from auth.uid() (set inside sync_push, never sent by a client),
 *   cascading on account deletion;
 * - entity_key = the P5 identity; primary key (user_id, entity_key);
 * - server_seq from one sequence, assigned under a per-player lock;
 * - row-level security: a player can read only their own rows; no client
 *   has INSERT/UPDATE/DELETE — every write goes through sync_push;
 * - a guard trigger: identity never changes, and facts never change except
 *   their explicitly editable fields (hunt notes / RPE).
 */

const INTEGER_FIELDS = new Set([
  'time_minutes', 'time_seconds', 'xp_awarded', 'difficulty', 'rpe', 'is_custom_hunt', 'rest_seconds_used',
  'structural_value_used', 'first_clear_bonus_xp', 'progression_epoch', 'monster_reset_count', 'training_minutes',
  'origin_order', 'streak_after', 'tz_offset_minutes', 'pr_bonus_xp', 'prior_clears_seen', 'gear_count', 'rounds',
  'rest_seconds', 'randomize_exercises', 'owned', 'total_duration_seconds', 'elapsed_seconds', 'total_reps', 'epoch',
  'to_epoch', 'count_before', 'count_after', 'voided_result_count', 'total_xp', 'level', 'total_workouts',
  'total_hunts_completed', 'total_monsters_defeated', 'total_training_minutes', 'current_streak_days',
  'longest_streak_days', 'custom_structure_value',
]);
const REAL_FIELDS = new Set([
  'weight_value_a', 'weight_value_b', 'volume_kg', 'weight_kg', 'weight_b_kg', 'weight', 'repeat_multiplier',
  'total_volume_kg',
]);
/** Free text a player types — kept shorter than other text columns. */
const PLAYER_TEXT_FIELDS: Readonly<Record<string, number>> = { notes: 4000, note: 4000, name: 200, label: 200 };
const MAX_TEXT = 16384;

/** Identity expression per type: the payload field(s) entity_key must equal. */
const KEY_EXPRESSION: Readonly<Record<EntityType, string>> = {
  baseline: 'v_in.uuid',
  custom_workout: 'v_in.uuid',
  timer_preset: 'v_in.uuid',
  equipment: 'v_in.sync_key',
  custom_hunt_preset: 'v_in.workout_id',
  settings_account: "'account'",
  hunt_result: 'v_in.uuid',
  custom_workout_result: 'v_in.uuid',
  timer_result: 'v_in.uuid',
  stopwatch_result: 'v_in.uuid',
  progress_reset: 'v_in.uuid',
  first_clear_claim: "v_in.stage_key || '@' || v_in.epoch",
  achievement: 'v_in.milestone_type',
};

/** Fields a fact may change after insert (only hunt notes / RPE, each with its own version). */
export const EDITABLE_FACT_FIELDS: Readonly<Partial<Record<EntityType, readonly string[]>>> = {
  hunt_result: ['notes', 'rpe'],
};
/** Achievements merge as a union: the earliest unlock time on any device is kept. */
const EARLIEST_WINS: Partial<Record<EntityType, string>> = { achievement: 'unlocked_at' };
/** Record types whose deletion is permanent (D9: restoring makes a copy). */
const STICKY_DELETE = new Set<EntityType>(['custom_workout']);

const SYSTEM_COLUMNS = ['user_id', 'entity_key', 'server_seq', 'server_created_at', 'server_updated_at'];

export function serverTable(type: EntityType): string {
  return `sync_${type}`;
}

export function columnType(field: string): string {
  if (INTEGER_FIELDS.has(field)) return 'integer';
  if (REAL_FIELDS.has(field)) return 'double precision';
  return 'text';
}

/** Payload keys a client may send for a type (the P5 fields, plus type-specific extras). */
export function payloadKeys(type: EntityType): string[] {
  const keys = [...RECORD_TYPES[type].fields];
  if (type === 'baseline') keys.push('monsters');
  if (type === 'custom_workout_result') keys.push('deleted_at'); // orphan results only (D9)
  return keys;
}

/** Columns that are not part of the client payload (system + per-field versions). */
function nonPayloadColumns(type: EntityType): string[] {
  const extra = (EDITABLE_FACT_FIELDS[type] ?? []).map((f) => `${f}_seq`);
  return [...SYSTEM_COLUMNS, ...extra];
}

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const textArray = (xs: readonly string[]) => `array[${xs.map(q).join(', ')}]::text[]`;

function tableSql(type: EntityType): string {
  const spec = RECORD_TYPES[type];
  const table = `public.${serverTable(type)}`;
  const cols = payloadKeys(type).map((f) => {
    if (f === 'monsters') return `  monsters jsonb not null default '[]'::jsonb check (jsonb_typeof(monsters) = 'array')`;
    const t = columnType(f);
    const limit = PLAYER_TEXT_FIELDS[f] ?? MAX_TEXT;
    return t === 'text' ? `  ${f} text check (${f} is null or char_length(${f}) <= ${limit})` : `  ${f} ${t}`;
  });
  const versions = (EDITABLE_FACT_FIELDS[type] ?? []).map((f) => `  ${f}_seq bigint not null`);
  const mutable =
    spec.kind === 'record'
      ? [...payloadKeys(type), 'server_seq', 'server_updated_at']
      : [
          'server_seq',
          'server_updated_at',
          ...(EDITABLE_FACT_FIELDS[type] ?? []).flatMap((f) => [f, `${f}_seq`]),
          ...(EARLIEST_WINS[type] ? [EARLIEST_WINS[type] as string] : []),
        ];
  return `create table ${table} (
  user_id uuid not null references auth.users (id) on delete cascade,
  entity_key text not null check (char_length(entity_key) between 1 and 200),
${[...cols, ...versions].join(',\n')},
  server_seq bigint not null,
  server_created_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  primary key (user_id, entity_key)
);
create index ${serverTable(type)}_seq_idx on ${table} (user_id, server_seq);
alter table ${table} enable row level security;
create policy "${serverTable(type)}_select_own" on ${table} for select to authenticated using (user_id = auth.uid());
revoke all on ${table} from public, anon, authenticated;
grant select on ${table} to authenticated;
create trigger ${serverTable(type)}_guard before update on ${table}
  for each row execute function public.sync_guard_row(${mutable.map(q).join(', ')});
`;
}

function castValue(field: string): string {
  const t = columnType(field);
  return t === 'text' ? `p_payload->>'value'` : `(p_payload->>'value')::${t}`;
}

function applyFunctionSql(type: EntityType): string {
  const spec = RECORD_TYPES[type];
  const table = `public.${serverTable(type)}`;
  const keys = payloadKeys(type);
  const editable = EDITABLE_FACT_FIELDS[type] ?? [];
  const insertCols = ['user_id', 'entity_key', ...keys, ...editable.map((f) => `${f}_seq`), 'server_seq'];
  const insertVals = ['p_uid', 'p_key', ...keys.map((k) => `v_in.${k}`), ...editable.map(() => 'v_seq'), 'v_seq'];
  const compareExcluded = [...nonPayloadColumns(type), ...editable];
  const ignored = textArray(compareExcluded);
  const sameContent = `(to_jsonb(v_row) - ${ignored}) = (to_jsonb(v_in) - ${ignored})`;
  const serverValue = `to_jsonb(v_row) - ${textArray(['user_id'])}`;
  const hasDeleted = keys.includes('deleted_at');

  let body: string;
  if (EARLIEST_WINS[type]) {
    const f = EARLIEST_WINS[type] as string;
    body = `
  if p_op <> 'insert' or p_field is not null then
    return jsonb_build_object('status', 'invalid', 'error', 'insert-only');
  end if;
  if v_found then
    if v_in.${f} is not null and v_in.${f} < v_row.${f} then
      -- union across devices: the earliest time wins, and other devices download it
      v_seq := nextval('public.sync_server_seq');
      update ${table} set ${f} = v_in.${f}, server_seq = v_seq, server_updated_at = now()
        where user_id = p_uid and entity_key = p_key;
      return jsonb_build_object('status', 'accepted', 'server_seq', v_seq);
    end if;
    return jsonb_build_object('status', 'duplicate', 'server_seq', v_row.server_seq);
  end if;
  v_seq := nextval('public.sync_server_seq');
  insert into ${table} (${insertCols.join(', ')}) values (${insertVals.join(', ')});
  return jsonb_build_object('status', 'accepted', 'server_seq', v_seq);`;
  } else if (type === 'first_clear_claim') {
    body = `
  if p_op <> 'insert' or p_field is not null then
    return jsonb_build_object('status', 'invalid', 'error', 'claims are insert-only');
  end if;
  if v_in.status is null or v_in.status not in ('local_final', 'pending') then
    return jsonb_build_object('status', 'invalid', 'error', 'claim status must be local_final or pending');
  end if;
  -- D2: a claim is accepted only for this player's existing hunt result of the same stage and epoch.
  if not exists (
    select 1 from public.sync_hunt_result r
    where r.user_id = p_uid and r.entity_key = v_in.result_uuid
      and 'workout:' || r.workout_id = v_in.stage_key and r.progression_epoch = v_in.epoch
  ) then
    return jsonb_build_object('status', 'invalid', 'error', 'claim does not match a known hunt result');
  end if;
  if v_found then
    if v_row.result_uuid = v_in.result_uuid then
      return jsonb_build_object('status', 'duplicate', 'server_seq', v_row.server_seq);
    end if;
    -- D2: the first accepted claim wins permanently.
    return jsonb_build_object('status', 'claimed_elsewhere', 'server_seq', v_row.server_seq, 'server_value', ${serverValue});
  end if;
  v_seq := nextval('public.sync_server_seq');
  insert into ${table} (${insertCols.join(', ')}) values (${insertVals.join(', ')});
  return jsonb_build_object('status', 'accepted', 'server_seq', v_seq);`;
  } else if (spec.kind !== 'record') {
    const fieldBranches = editable
      .map(
        (f) => `
  if p_op = 'update' and p_field = ${q(f)} then
    if not v_found then
      return jsonb_build_object('status', 'invalid', 'error', 'unknown record');
    end if;
    if p_base is distinct from v_row.${f}_seq then
      return jsonb_build_object('status', 'stale', 'server_seq', v_row.${f}_seq, 'server_value', to_jsonb(v_row.${f}));
    end if;
    v_seq := nextval('public.sync_server_seq');
    update ${table} set ${f} = ${castValue(f)}, ${f}_seq = v_seq, server_seq = v_seq, server_updated_at = now()
      where user_id = p_uid and entity_key = p_key;
    return jsonb_build_object('status', 'accepted', 'server_seq', v_seq);
  end if;`
      )
      .join('');
    body = `${fieldBranches}
  if p_op <> 'insert' or p_field is not null then
    return jsonb_build_object('status', 'invalid', 'error', 'facts are insert-only');
  end if;
  if v_found then
    if ${sameContent} then
      return jsonb_build_object('status', 'duplicate', 'server_seq', v_row.server_seq);
    end if;
    return jsonb_build_object('status', 'invalid', 'error', 'a different fact already has this identity');
  end if;
  v_seq := nextval('public.sync_server_seq');
  insert into ${table} (${insertCols.join(', ')}) values (${insertVals.join(', ')});
  return jsonb_build_object('status', 'accepted', 'server_seq', v_seq);`;
  } else {
    const setList = [...keys.map((k) => `${k} = v_in.${k}`), 'server_seq = v_seq', 'server_updated_at = now()'].join(', ');
    body = `
  if p_field is not null or p_op not in ('insert', 'update', 'delete') then
    return jsonb_build_object('status', 'invalid', 'error', 'unsupported operation');
  end if;
  if p_op = 'insert' then
    if v_found then
      if ${sameContent} then
        return jsonb_build_object('status', 'duplicate', 'server_seq', v_row.server_seq);
      end if;
      return jsonb_build_object('status', 'stale', 'server_seq', v_row.server_seq, 'server_value', ${serverValue});
    end if;
    v_seq := nextval('public.sync_server_seq');
    insert into ${table} (${insertCols.join(', ')}) values (${insertVals.join(', ')});
    return jsonb_build_object('status', 'accepted', 'server_seq', v_seq);
  end if;
  if not v_found then
    return jsonb_build_object('status', 'invalid', 'error', 'unknown record');
  end if;${
    hasDeleted
      ? `
  if p_op = 'delete' and v_row.deleted_at is not null then
    -- deleting what is already deleted changes nothing
    return jsonb_build_object('status', 'accepted', 'server_seq', v_row.server_seq);
  end if;${
    STICKY_DELETE.has(type)
      ? `
  if v_row.deleted_at is not null then
    -- D9: a deleted custom workout stays deleted; the device may save its version as a copy.
    return jsonb_build_object('status', 'stale', 'server_seq', v_row.server_seq, 'server_value', ${serverValue});
  end if;`
      : ''
  }`
      : ''
  }
  if p_base is distinct from v_row.server_seq then
    return jsonb_build_object('status', 'stale', 'server_seq', v_row.server_seq, 'server_value', ${serverValue});
  end if;
  v_seq := nextval('public.sync_server_seq');
  update ${table} set ${setList} where user_id = p_uid and entity_key = p_key;
  return jsonb_build_object('status', 'accepted', 'server_seq', v_seq);`;
  }

  return `create function public.sync_apply_${type}(
  p_uid uuid, p_op text, p_key text, p_field text, p_base bigint, p_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row ${table};
  v_in ${table};
  v_found boolean;
  v_seq bigint;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    return jsonb_build_object('status', 'invalid', 'error', 'payload must be a JSON object');
  end if;
  select * into v_row from ${table} where user_id = p_uid and entity_key = p_key;
  v_found := found;
  if p_field is null then
    if exists (select 1 from jsonb_object_keys(p_payload) k where k <> all (${textArray(keys)})) then
      return jsonb_build_object('status', 'invalid', 'error', 'payload has an unknown field');
    end if;
    v_in := jsonb_populate_record(null::${table}, p_payload);
    if (${KEY_EXPRESSION[type]}) is distinct from p_key then
      return jsonb_build_object('status', 'invalid', 'error', 'entity_key does not match the payload identity');
    end if;
  end if;${body}
end;
$$;
revoke all on function public.sync_apply_${type}(uuid, text, text, text, bigint, jsonb) from public, anon, authenticated;
`;
}

function pushSql(): string {
  const cases = SEED_ORDER.map(
    (t) =>
      `        when ${q(t)} then public.sync_apply_${t}(v_uid, v_item->>'op', v_item->>'entity_key', v_item->>'field', (v_item->>'base_seq')::bigint, v_item->'payload')`
  ).join('\n');
  return `create function public.sync_push(p_device uuid, p_items jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_item jsonb;
  v_seq bigint;
  v_prev jsonb;
  v_res jsonb;
  v_out jsonb := '[]'::jsonb;
begin
  if v_uid is null then
    raise exception 'sync_push: not signed in' using errcode = '42501';
  end if;
  if p_device is null or jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'sync_push: device and an items array are required' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 200 or octet_length(p_items::text) > 1048576 then
    raise exception 'sync_push: batch too large (max 200 items, 1 MB)' using errcode = '54000';
  end if;
  -- One player's uploads commit one at a time, so server_seq order = commit order per player.
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));
  insert into public.sync_device (user_id, device_uuid) values (v_uid, p_device) on conflict do nothing;

  for v_item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item) <> 'object' or (v_item->>'device_seq') is null or (v_item->>'device_seq') !~ '^[0-9]{1,18}$' then
      raise exception 'sync_push: every item needs a numeric device_seq' using errcode = '22023';
    end if;
    v_seq := (v_item->>'device_seq')::bigint;
    select outcome into v_prev from public.sync_mutation
      where user_id = v_uid and device_uuid = p_device and device_seq = v_seq;
    if found then
      -- A retry: return the original outcome; an accepted change is reported as a duplicate.
      v_out := v_out || jsonb_build_array(
        v_prev || jsonb_build_object('status', case when v_prev->>'status' = 'accepted' then 'duplicate' else v_prev->>'status' end));
      continue;
    end if;
    begin
      v_res := case v_item->>'entity_type'
${cases}
        else jsonb_build_object('status', 'invalid', 'error', 'unknown entity_type')
      end;
    exception when others then
      v_res := jsonb_build_object('status', 'invalid', 'error', sqlerrm);
    end;
    v_res := v_res || jsonb_build_object('device_seq', v_seq);
    insert into public.sync_mutation (user_id, device_uuid, device_seq, outcome) values (v_uid, p_device, v_seq, v_res);
    v_out := v_out || jsonb_build_array(v_res);
  end loop;
  return v_out;
end;
$$;
`;
}

function pullSql(): string {
  const unions = SEED_ORDER.map(
    (t) =>
      `    select server_seq, ${q(t)}::text as entity_type, entity_key,
           to_jsonb(r) - ${textArray(['user_id', 'entity_key', 'server_seq', 'server_created_at', 'server_updated_at'])} as payload
      from public.${serverTable(t)} r where user_id = auth.uid() and server_seq > coalesce(p_cursor, 0)`
  ).join('\n    union all\n');
  return `create function public.sync_pull(p_cursor bigint, p_limit integer default 500) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with changes as (
${unions}
  ), page as (
    select * from changes order by server_seq limit least(greatest(coalesce(p_limit, 500), 1), 1000)
  )
  select jsonb_build_object(
    'items', coalesce(jsonb_agg(jsonb_build_object('server_seq', server_seq, 'entity_type', entity_type,
                                                    'entity_key', entity_key, 'payload', payload) order by server_seq), '[]'::jsonb),
    'next_cursor', coalesce(max(server_seq), coalesce(p_cursor, 0)))
  from page;
$$;
`;
}

function accountStatusSql(): string {
  const checks = SEED_ORDER.map((t) => `exists (select 1 from public.${serverTable(t)} where user_id = auth.uid())`).join('\n      or ');
  return `create function public.sync_account_status() returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('has_data', ${checks});
$$;
`;
}

export function generateSyncMigrationSql(): string {
  return `-- GENERATED by scripts/generate-sync-sql.mjs from src/services/sync/recordTypes.ts
-- and src/services/sync/serverSchema.ts. Do not edit by hand: edit the generator and re-run
-- \`npm run generate:sync-sql\`. A test fails if this file and the generator disagree.
--
-- Cloud Save P6 (decisions D1, D2): one table per synced record type; every write
-- goes through sync_push(); every read through sync_pull() / RLS-protected SELECT.

create sequence public.sync_server_seq;
revoke all on sequence public.sync_server_seq from public, anon, authenticated;

create table public.sync_device (
  user_id uuid not null references auth.users (id) on delete cascade,
  device_uuid uuid not null,
  first_seen_at timestamptz not null default now(),
  primary key (user_id, device_uuid)
);
alter table public.sync_device enable row level security;
create policy "sync_device_select_own" on public.sync_device for select to authenticated using (user_id = auth.uid());
revoke all on public.sync_device from public, anon, authenticated;
grant select on public.sync_device to authenticated;

-- Idempotency: the outcome of every (device, device_seq) change, returned again on retry.
create table public.sync_mutation (
  user_id uuid not null references auth.users (id) on delete cascade,
  device_uuid uuid not null,
  device_seq bigint not null,
  outcome jsonb not null,
  applied_at timestamptz not null default now(),
  primary key (user_id, device_uuid, device_seq)
);
alter table public.sync_mutation enable row level security;
revoke all on public.sync_mutation from public, anon, authenticated;

-- Guard: identity never changes; columns not listed as mutable never change.
create function public.sync_guard_row() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.user_id is distinct from old.user_id or new.entity_key is distinct from old.entity_key then
    raise exception 'sync: identity of a % row is immutable', tg_table_name;
  end if;
  if (to_jsonb(new) - tg_argv) is distinct from (to_jsonb(old) - tg_argv) then
    raise exception 'sync: % rows are immutable except their editable fields', tg_table_name;
  end if;
  return new;
end;
$$;
revoke all on function public.sync_guard_row() from public, anon, authenticated;

${SEED_ORDER.map(tableSql).join('\n')}
${SEED_ORDER.map(applyFunctionSql).join('\n')}
${pushSql()}
${pullSql()}
${accountStatusSql()}
revoke all on function public.sync_push(uuid, jsonb) from public, anon;
revoke all on function public.sync_pull(bigint, integer) from public, anon;
revoke all on function public.sync_account_status() from public, anon;
grant execute on function public.sync_push(uuid, jsonb) to authenticated;
grant execute on function public.sync_pull(bigint, integer) to authenticated;
grant execute on function public.sync_account_status() to authenticated;
`;
}

export const SYNC_MIGRATION_FILE = 'supabase/migrations/20261111120000_cloud_sync_tables.sql';
