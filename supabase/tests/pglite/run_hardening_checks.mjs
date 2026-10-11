// Phase 2.3.4: targeted checks for the new hardening migration
// (20261009150000_harden_grants_and_function_execute.sql) specifically
// — not duplicating run_suite.mjs/run_edge.mjs, which already cover
// every pre-existing behavior and continue to pass unchanged with this
// migration applied (see the Phase 2.3.4 report). These assertions
// prove the two NEW claims that migration's header comment makes: (1)
// anon now has zero table-level privilege, not just RLS-filtered
// access, and (2) the three trigger functions are no longer directly
// callable, while still firing correctly via their triggers (already
// reconfirmed by run_suite.mjs's Scenario A1/A4 passing unchanged).
import { freshDb, HUNTER_A, asUser } from './setup_fresh.mjs';

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name}${detail ? ' :: ' + detail : ''}`);
}

let spCounter = 0;
async function expectError(db, fn) {
  const sp = `sp_${spCounter++}`;
  await db.exec(`savepoint ${sp};`);
  try {
    await fn();
    await db.exec(`release savepoint ${sp};`);
    return { threw: false };
  } catch (e) {
    await db.exec(`rollback to savepoint ${sp};`);
    return { threw: true, message: e.message || String(e), code: e.code };
  }
}

const db = await freshDb();
await db.exec('begin;');

// anon now has no table-level grant at all — must fail at the
// privilege-check layer (42501, insufficient_privilege), not merely
// return 0 rows via RLS filtering (which was the PRE-hardening
// behavior this migration specifically removed).
await db.exec('set local role anon;');

const anonSelect = await expectError(db, () => db.query('select count(*) from public.profiles;'));
record('anon: SELECT on profiles now fails at the grant layer', anonSelect.threw && anonSelect.code === '42501', `code=${anonSelect.code}, message=${anonSelect.message}`);

const anonInsert = await expectError(db, () =>
  db.query(
    `insert into public.workout_results (user_id, monster_id, workout_id, hunt_id, canonical_weight_kg, weight_b_kg, gear_count, elapsed_seconds, is_custom_hunt) values (null,'hydra','everlasting-cycle','hydra-first-encounter',16,16,2,900,false);`
  )
);
record('anon: INSERT on workout_results now fails at the grant layer', anonInsert.threw && anonInsert.code === '42501', `code=${anonInsert.code}, message=${anonInsert.message}`);

// authenticated/anon can no longer call the three trigger functions
// directly (the Security Advisor's exact finding) — must fail at the
// grant layer (42501), not execute.
await db.exec('reset role;');
await asUser(db, HUNTER_A);
for (const fn of ['handle_new_auth_user', 'workout_results_before_insert', 'sync_leaderboard_entry']) {
  const r = await expectError(db, () => db.query(`select public.${fn}();`));
  record(`authenticated: direct call to ${fn}() now rejected`, r.threw && r.code === '42501', `code=${r.code}, message=${r.message}`);
}

// But the SAME functions still fire correctly through their triggers —
// a real insert must still succeed and still produce a leaderboard
// entry (this is the actual proof EXECUTE revocation doesn't disable
// trigger firing; run_suite.mjs's Scenario A already re-confirms this
// too, this is an explicit, narrower repeat for this report).
const ins = await db.query(
  `insert into public.workout_results (user_id, monster_id, workout_id, hunt_id, canonical_weight_kg, weight_b_kg, gear_count, elapsed_seconds, is_custom_hunt) values ($1,'hydra','everlasting-cycle','hydra-first-encounter',16,16,2,900,false) returning id, rank;`,
  [HUNTER_A]
);
record('authenticated: trigger-fired insert still succeeds after EXECUTE revocation', ins.rows.length === 1 && ins.rows[0].rank === 'S', JSON.stringify(ins.rows));
const lb = await db.query(`select count(*) from public.leaderboard_entries where user_id=$1;`, [HUNTER_A]);
record('authenticated: sync_leaderboard_entry trigger still fired and inserted', Number(lb.rows[0].count) === 1, `count=${lb.rows[0].count}`);

await db.exec('rollback;');
await db.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n=== ${results.length - failed.length}/${results.length} PASSED ===`);
if (failed.length) {
  console.log('FAILED:', failed.map((f) => f.name));
  process.exit(1);
}
