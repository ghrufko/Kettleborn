// Phase 2.5.1: targeted checks for the new
// 20261010120000_workout_results_client_id_uniqueness.sql migration —
// not duplicating run_suite.mjs/run_edge.mjs, which already cover
// every pre-existing behavior and continue to pass unchanged with this
// migration applied (re-run this phase: 35/35 + 15/15 + 7/7). These
// assertions prove the specific new claims that migration's header
// comment makes: per-user (not global) uniqueness scope, correct NULL
// handling, and that a duplicate retry is genuinely rejected by the
// database rather than merely discouraged client-side.
import { freshDb, HUNTER_A, HUNTER_B, asUser } from './setup_fresh.mjs';

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
await asUser(db, HUNTER_A);

// 1. A new workout result with a client_result_id inserts normally.
const first = await db.query(
  `insert into public.workout_results (user_id, monster_id, workout_id, hunt_id, canonical_weight_kg, weight_b_kg, gear_count, elapsed_seconds, is_custom_hunt, client_result_id) values ($1,'hydra','everlasting-cycle','hydra-first-encounter',16,16,2,900,false,'local-result-abc') returning id;`,
  [HUNTER_A]
);
record('insert with a client_result_id succeeds', first.rows.length === 1, JSON.stringify(first.rows));

// 2. Reusing the same (user, client_result_id) — the exact "retried
// upload" scenario this migration exists to prevent — is rejected.
const retry = await expectError(db, () =>
  db.query(
    `insert into public.workout_results (user_id, monster_id, workout_id, hunt_id, canonical_weight_kg, weight_b_kg, gear_count, elapsed_seconds, is_custom_hunt, client_result_id) values ($1,'hydra','everlasting-cycle','hydra-first-encounter',16,16,2,950,false,'local-result-abc') returning id;`,
    [HUNTER_A]
  )
);
record('retrying the same client_result_id for the same user is rejected', retry.threw && retry.code === '23505', `code=${retry.code}, message=${retry.message}`);

// 3. A different client_result_id for the same user inserts normally
// — the constraint doesn't block genuinely new results.
const second = await db.query(
  `insert into public.workout_results (user_id, monster_id, workout_id, hunt_id, canonical_weight_kg, weight_b_kg, gear_count, elapsed_seconds, is_custom_hunt, client_result_id) values ($1,'hydra','everlasting-cycle','hydra-first-encounter',16,16,2,850,false,'local-result-xyz') returning id;`,
  [HUNTER_A]
);
record('a different client_result_id for the same user succeeds', second.rows.length === 1, JSON.stringify(second.rows));

// 4. The exact real-world collision risk this migration's scoping
// choice exists to prevent: the local id format
// (`${workoutId}-${Date.now()}`) is not cryptographically unique, so
// two DIFFERENT users could in principle generate the identical
// client_result_id string. Per-user scoping must let both through.
await asUser(db, HUNTER_B);
const collision = await db.query(
  `insert into public.workout_results (user_id, monster_id, workout_id, hunt_id, canonical_weight_kg, weight_b_kg, gear_count, elapsed_seconds, is_custom_hunt, client_result_id) values ($1,'hydra','everlasting-cycle','hydra-first-encounter',16,16,2,800,false,'local-result-abc') returning id;`,
  [HUNTER_B]
);
record('the SAME client_result_id string for a DIFFERENT user succeeds (per-user scope, not global)', collision.rows.length === 1, JSON.stringify(collision.rows));

// 5. NULL client_result_id (every pre-sync, canonical/custom result
// today — nothing currently populates this column) is unaffected:
// multiple NULLs for the same user must NOT collide with each other.
await asUser(db, HUNTER_A);
const null1 = await db.query(
  `insert into public.workout_results (user_id, monster_id, workout_id, hunt_id, canonical_weight_kg, weight_b_kg, gear_count, elapsed_seconds, is_custom_hunt) values ($1,'hydra','everlasting-cycle','hydra-first-encounter',16,16,2,700,false) returning id;`,
  [HUNTER_A]
);
const null2 = await db.query(
  `insert into public.workout_results (user_id, monster_id, workout_id, hunt_id, canonical_weight_kg, weight_b_kg, gear_count, elapsed_seconds, is_custom_hunt) values ($1,'hydra','everlasting-cycle','hydra-first-encounter',16,16,2,650,false) returning id;`,
  [HUNTER_A]
);
record('two NULL client_result_id rows for the same user both succeed', null1.rows.length === 1 && null2.rows.length === 1, `${JSON.stringify(null1.rows)} ${JSON.stringify(null2.rows)}`);

// 6. The leaderboard trigger still fires correctly for a row that
// does carry a client_result_id — confirms this migration didn't
// interfere with the existing AFTER INSERT trigger chain.
const lb = await db.query(`select count(*) from public.leaderboard_entries where user_id=$1;`, [HUNTER_A]);
record('existing triggers still produce leaderboard entries alongside the new constraint', Number(lb.rows[0].count) >= 1, `count=${lb.rows[0].count}`);

await db.exec('rollback;');
await db.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n=== ${results.length - failed.length}/${results.length} PASSED ===`);
if (failed.length) {
  console.log('FAILED:', failed.map((f) => f.name));
  process.exit(1);
}
