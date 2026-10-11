// Scenario suite A-R, executed against a real PostgreSQL instance
// (PGlite/WASM), covering the same ground as
// ../manual_rls_test_plan.sql plus three scenarios (P, Q, R) found or
// added during Phase 1.3 PGlite execution that are not yet mirrored
// there. Run from this directory: npm install && npm test
import { freshDb, HUNTER_A, HUNTER_B, asUser, asSuperuser } from './setup_fresh.mjs';

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

async function scenarioA(db) {
  await db.exec('begin;');
  await asUser(db, HUNTER_A);
  const ins = await db.query(
    `insert into public.workout_results
      (user_id, monster_id, workout_id, hunt_id, canonical_weight_kg, weight_b_kg, gear_count, elapsed_seconds, is_custom_hunt, app_version, content_version)
     values ($1,'wrong-monster','everlasting-cycle','hydra-first-encounter',16,16,2,900,false,'0.1.0','v1')
     returning id, user_id, monster_id, rank, completed_at;`,
    ['00000000-0000-0000-0000-000000000000']
  );
  const row = ins.rows[0];
  const lb = await db.query(`select * from public.leaderboard_entries where user_id=$1 and workout_id='everlasting-cycle';`, [HUNTER_A]);
  await db.exec('rollback;');

  record('A1: user_id forced to real caller', row.user_id === HUNTER_A, `got ${row.user_id}`);
  record('A2: monster_id derived, not trusted', row.monster_id === 'hydra', `got ${row.monster_id}`);
  record('A3: rank computed correctly (S)', row.rank === 'S', `got ${row.rank}`);
  record('A4: leaderboard entry created', lb.rows.length === 1 && lb.rows[0].elapsed_seconds === 900, JSON.stringify(lb.rows));
}

async function scenarioB(db) {
  await db.exec('begin;');
  await asUser(db, HUNTER_A);
  await db.query(
    `insert into public.workout_results
      (user_id, monster_id, workout_id, hunt_id, canonical_weight_kg, weight_b_kg, gear_count, elapsed_seconds, is_custom_hunt)
     values ($1,'hydra','everlasting-cycle','hydra-first-encounter',16,16,2,500,true);`,
    [HUNTER_A]
  );
  const lb = await db.query(`select count(*) from public.leaderboard_entries where user_id=$1;`, [HUNTER_A]);
  await db.exec('rollback;');
  record('B1: custom hunt never reaches leaderboard', Number(lb.rows[0].count) === 0, `count=${lb.rows[0].count}`);
}

async function scenarioC(db) {
  await db.exec('begin;');
  await asUser(db, HUNTER_A);
  const ins = await db.query(
    `insert into public.workout_results
      (user_id, monster_id, workout_id, hunt_id, canonical_weight_kg, weight_b_kg, gear_count, elapsed_seconds, is_custom_hunt)
     values ($1,'hydra','everlasting-cycle','hydra-first-encounter',16,16,2,950,false)
     returning user_id;`,
    [HUNTER_B]
  );
  await db.exec('rollback;');
  record('C1: fake user_id ignored, real caller used', ins.rows[0].user_id === HUNTER_A, `got ${ins.rows[0].user_id}`);
}

async function scenarioD(db) {
  await db.exec('begin;');
  await asUser(db, HUNTER_A);
  const ins = await db.query(
    `insert into public.workout_results
      (user_id, monster_id, workout_id, hunt_id, canonical_weight_kg, weight_b_kg, gear_count, elapsed_seconds, rank, is_custom_hunt)
     values ($1,'hydra','everlasting-cycle','hydra-first-encounter',16,16,2,1300,'S',false)
     returning rank;`,
    [HUNTER_A]
  );
  await db.exec('rollback;');
  record('D1: fake rank overwritten (1300s -> C)', ins.rows[0].rank === 'C', `got ${ins.rows[0].rank}`);
}

async function scenarioE(db) {
  await db.exec('begin;');
  await asUser(db, HUNTER_A);
  await db.query(
    `insert into public.workout_results
      (user_id, monster_id, workout_id, hunt_id, canonical_weight_kg, weight_b_kg, gear_count, elapsed_seconds, is_custom_hunt)
     values ($1,'hydra','everlasting-cycle','hydra-first-encounter',16,16,2,5,false);`,
    [HUNTER_A]
  );
  const lb = await db.query(`select count(*) from public.leaderboard_entries where user_id=$1;`, [HUNTER_A]);
  await db.exec('rollback;');
  record('E1: impossible elapsed time excluded from leaderboard', Number(lb.rows[0].count) === 0, `count=${lb.rows[0].count}`);
}

async function scenarioF(db) {
  await db.exec('begin;');
  await asUser(db, HUNTER_A);
  const r1 = await expectError(db, () => db.query(
    `insert into public.workout_results
      (user_id, monster_id, workout_id, hunt_id, canonical_weight_kg, weight_b_kg, gear_count, elapsed_seconds, is_custom_hunt)
     values ($1,'hydra','everlasting-cycle','not-a-real-hunt-id',16,16,2,900,false);`,
    [HUNTER_A]
  ));
  record('F1: unknown hunt_id rejected', r1.threw, r1.message);

  const r2 = await expectError(db, () => db.query(
    `insert into public.workout_results
      (user_id, monster_id, workout_id, hunt_id, canonical_weight_kg, weight_b_kg, gear_count, elapsed_seconds, is_custom_hunt)
     values ($1,'hydra','abyss-carry','hydra-first-encounter',16,16,2,900,false);`,
    [HUNTER_A]
  ));
  record('F2: mismatched workout_id/hunt_id rejected', r2.threw, r2.message);
  await db.exec('rollback;');
}

async function scenarioG(db) {
  await db.exec('begin;');
  await asUser(db, HUNTER_A);
  const r = await expectError(db, () => db.query(
    `insert into public.leaderboard_entries (user_id, workout_id, monster_id, best_result_id, elapsed_seconds, rank, achieved_at)
     values ($1,'everlasting-cycle','hydra', gen_random_uuid(), 1, 'S', now());`,
    [HUNTER_A]
  ));
  record('G1: direct leaderboard_entries INSERT rejected', r.threw, r.message);
  await db.exec('rollback;');
}

async function scenarioH(db) {
  await db.exec('begin;');
  await asUser(db, HUNTER_A);
  const r = await expectError(db, () => db.query(
    `update public.leaderboard_entries set elapsed_seconds = 1 where user_id=$1;`,
    [HUNTER_A]
  ));
  record('H1: leaderboard_entries UPDATE rejected', r.threw, r.message);
  record('H2: rejection is permission-denied (42501)', r.code === '42501', `code=${r.code}`);
  await db.exec('rollback;');
}

async function scenarioI(db) {
  await db.exec('begin;');
  // Seed HunterB's row as HunterB (their own authenticated session) --
  // not a superuser/service-role bypass. The trigger unconditionally
  // requires auth.uid() to resolve to a real user for ANY insert into
  // this table, by design (there is no separate service-role insert
  // path in this schema) -- discovered by actually running this and
  // hitting "workout_results: no authenticated user" when the earlier
  // version of this test tried to seed via asSuperuser().
  await asUser(db, HUNTER_B);
  await db.query(
    `insert into public.workout_results
      (user_id, monster_id, workout_id, hunt_id, canonical_weight_kg, weight_b_kg, gear_count, elapsed_seconds, is_custom_hunt)
     values ($1,'hydra','everlasting-cycle','hydra-first-encounter',16,16,2,950,false);`,
    [HUNTER_B]
  );
  await asUser(db, HUNTER_A);
  const sel = await db.query(`select count(*) from public.workout_results where user_id=$1;`, [HUNTER_B]);
  record('I1: cannot SELECT another users rows', Number(sel.rows[0].count) === 0, `count=${sel.rows[0].count}`);

  const upd = await expectError(db, () => db.query(`update public.workout_results set elapsed_seconds=1 where user_id=$1;`, [HUNTER_B]));
  record('I2: UPDATE another users row rejected', upd.threw, upd.message);
  record('I3: rejection is permission-denied', upd.code === '42501', `code=${upd.code}`);

  const del = await expectError(db, () => db.query(`delete from public.workout_results where user_id=$1;`, [HUNTER_B]));
  record('I4: DELETE another users row rejected', del.threw, del.message);
  record('I5: rejection is permission-denied', del.code === '42501', `code=${del.code}`);
  await db.exec('rollback;');
}

async function scenarioJ(db) {
  await db.exec('begin;');
  await asUser(db, HUNTER_A);
  await db.query(`insert into public.workout_results (user_id, monster_id, workout_id, hunt_id, canonical_weight_kg, weight_b_kg, gear_count, elapsed_seconds, is_custom_hunt) values ($1,'hydra','everlasting-cycle','hydra-first-encounter',16,16,2,1000,false);`, [HUNTER_A]);
  await db.query(`insert into public.workout_results (user_id, monster_id, workout_id, hunt_id, canonical_weight_kg, weight_b_kg, gear_count, elapsed_seconds, is_custom_hunt) values ($1,'hydra','everlasting-cycle','hydra-first-encounter',16,16,2,850,false);`, [HUNTER_A]);
  const lb1 = await db.query(`select elapsed_seconds from public.leaderboard_entries where user_id=$1 and workout_id='everlasting-cycle';`, [HUNTER_A]);
  record('J1: faster result updates leaderboard (850)', lb1.rows[0]?.elapsed_seconds === 850, JSON.stringify(lb1.rows));

  await db.query(`insert into public.workout_results (user_id, monster_id, workout_id, hunt_id, canonical_weight_kg, weight_b_kg, gear_count, elapsed_seconds, is_custom_hunt) values ($1,'hydra','everlasting-cycle','hydra-first-encounter',16,16,2,999,false);`, [HUNTER_A]);
  const lb2 = await db.query(`select elapsed_seconds from public.leaderboard_entries where user_id=$1 and workout_id='everlasting-cycle';`, [HUNTER_A]);
  record('J2: slower result does NOT overwrite (still 850)', lb2.rows[0]?.elapsed_seconds === 850, JSON.stringify(lb2.rows));
  await db.exec('rollback;');
}

async function scenarioK(db) {
  await db.exec('begin;');
  await asUser(db, HUNTER_A);
  await db.query(`insert into public.workout_results (user_id, monster_id, workout_id, hunt_id, canonical_weight_kg, weight_b_kg, gear_count, elapsed_seconds, is_custom_hunt) values ($1,'hydra','everlasting-cycle','hydra-first-encounter',16,16,2,900,false);`, [HUNTER_A]);
  await asUser(db, HUNTER_B);
  await db.query(`insert into public.workout_results (user_id, monster_id, workout_id, hunt_id, canonical_weight_kg, weight_b_kg, gear_count, elapsed_seconds, is_custom_hunt) values ($1,'hydra','everlasting-cycle','hydra-first-encounter',16,16,2,800,false);`, [HUNTER_B]);
  await asSuperuser(db);
  const lb = await db.query(`select user_id, elapsed_seconds from public.leaderboard_entries where workout_id='everlasting-cycle' order by elapsed_seconds asc;`);
  const ok = lb.rows.length === 2 && lb.rows[0].user_id === HUNTER_B && lb.rows[1].user_id === HUNTER_A;
  record('K1: two users both present independently', ok, JSON.stringify(lb.rows));
  await db.exec('rollback;');
}

async function scenarioL(db) {
  await db.exec('begin;');
  await asUser(db, HUNTER_A);
  const r1 = await db.query(`insert into public.workout_results (user_id, monster_id, workout_id, hunt_id, canonical_weight_kg, weight_b_kg, gear_count, elapsed_seconds, is_custom_hunt) values ($1,'hydra','everlasting-cycle','hydra-first-encounter',16,16,2,1080,false) returning rank;`, [HUNTER_A]);
  record('L1: baseline result ranks A', r1.rows[0].rank === 'A', `got ${r1.rows[0].rank}`);
  const r2 = await db.query(`insert into public.workout_results (user_id, monster_id, workout_id, hunt_id, canonical_weight_kg, weight_b_kg, gear_count, elapsed_seconds, is_custom_hunt) values ($1,'hydra','everlasting-cycle','hydra-first-encounter',16,16,2,1000,false) returning rank;`, [HUNTER_A]);
  record('L2: PR-specific S-rank (1000s, not fast enough for S by time alone)', r2.rows[0].rank === 'S', `got ${r2.rows[0].rank}`);
  await db.exec('rollback;');
}

async function scenarioM(db) {
  await db.exec('begin;');
  await asUser(db, HUNTER_A);
  const r1 = await expectError(db, () => db.query(
    `insert into public.workout_results (user_id, monster_id, workout_id, hunt_id, canonical_weight_kg, gear_count, elapsed_seconds, is_custom_hunt) values ($1,'hydra','everlasting-cycle','hydra-first-encounter',16,1,900,false);`,
    [HUNTER_A]
  ));
  record('M1: canonical gear_count mismatch rejected', r1.threw, r1.message);

  const r2 = await db.query(
    `insert into public.workout_results (user_id, monster_id, workout_id, hunt_id, canonical_weight_kg, gear_count, elapsed_seconds, is_custom_hunt) values ($1,'hydra','everlasting-cycle','hydra-first-encounter',16,1,900,true) returning id;`,
    [HUNTER_A]
  );
  record('M2: same gear_count mismatch OK when is_custom_hunt=true', r2.rows.length === 1, JSON.stringify(r2.rows));
  await db.exec('rollback;');
}

async function scenarioN(db) {
  await db.exec('begin;');
  await asUser(db, HUNTER_A);
  const ins = await db.query(
    `insert into public.workout_results (user_id, monster_id, workout_id, hunt_id, canonical_weight_kg, weight_b_kg, gear_count, elapsed_seconds, is_custom_hunt) values ($1,'hydra','everlasting-cycle','hydra-first-encounter',16,50,2,900,false) returning id;`,
    [HUNTER_A]
  );
  record('N1: in-ceiling-but-out-of-content-range weight_b_kg still inserts', ins.rows.length === 1, JSON.stringify(ins.rows));
  const lb = await db.query(`select count(*) from public.leaderboard_entries where user_id=$1;`, [HUNTER_A]);
  record('N2: excluded from leaderboard (weight_b_kg=50 outside [8,24])', Number(lb.rows[0].count) === 0, `count=${lb.rows[0].count}`);
  await db.exec('rollback;');
}

async function scenarioO(db) {
  await db.exec('begin;');
  await asUser(db, HUNTER_A);
  const r1 = await expectError(db, () => db.query(
    `insert into public.workout_results (user_id, monster_id, workout_id, hunt_id, canonical_weight_kg, weight_b_kg, gear_count, elapsed_seconds, is_custom_hunt) values ($1,'moloch','iron-descent','moloch-first-encounter',20,16,1,300,false);`,
    [HUNTER_A]
  ));
  record('O1: gear_count=1 with non-null weight_b_kg rejected', r1.threw, r1.message);

  const r2 = await db.query(
    `insert into public.workout_results (user_id, monster_id, workout_id, hunt_id, canonical_weight_kg, weight_b_kg, gear_count, elapsed_seconds, is_custom_hunt) values ($1,'moloch','iron-descent','moloch-first-encounter',20,null,1,300,false) returning id;`,
    [HUNTER_A]
  );
  record('O2: gear_count=1 with NULL weight_b_kg succeeds', r2.rows.length === 1, JSON.stringify(r2.rows));
  await db.exec('rollback;');
}

async function scenarioP(db) {
  await db.exec('begin;');
  await asUser(db, HUNTER_A);
  const r1 = await expectError(db, () => db.query(
    `insert into public.workout_results (user_id, monster_id, workout_id, hunt_id, canonical_weight_kg, gear_count, elapsed_seconds, is_custom_hunt) values ($1,'hydra','everlasting-cycle','hydra-first-encounter',16,2,900,false);`,
    [HUNTER_A]
  ));
  record('P1 (found via PGlite execution, Phase 1.3): gear_count=2 with NULL weight_b_kg rejected', r1.threw, r1.message);
  await db.exec('rollback;');
}

async function profileTests(db) {
  await db.exec('begin;');
  await asUser(db, HUNTER_A);
  const r1 = await expectError(db, () => db.query(`update public.profiles set total_xp = 99999 where id=$1;`, [HUNTER_A]));
  record('Q1: cannot write own total_xp via UPDATE', r1.threw, r1.message);
  record('Q2: rejection is permission-denied (column privilege)', r1.code === '42501', `code=${r1.code}`);

  await db.query(`update public.profiles set display_name = 'NewName' where id=$1;`, [HUNTER_A]);
  const check = await db.query(`select display_name from public.profiles where id=$1;`, [HUNTER_A]);
  record('Q3: CAN write own display_name', check.rows[0].display_name === 'NewName', `got ${check.rows[0].display_name}`);

  await db.query(`update public.profiles set display_name='Hacked' where id=$1;`, [HUNTER_B]);
  const check2 = await db.query(`select display_name from public.profiles where id=$1;`, [HUNTER_B]);
  record('Q4: another users profile unaffected (RLS row-filter, 0 rows matched, not an error)', check2.rows[0].display_name === 'HunterB', `got ${check2.rows[0].display_name}`);
  await db.exec('rollback;');
}

async function unauthenticatedTest(db) {
  await db.exec('begin;');
  await db.exec(`set local role authenticated;`);
  const r = await expectError(db, () => db.query(
    `insert into public.workout_results (user_id, monster_id, workout_id, hunt_id, canonical_weight_kg, weight_b_kg, gear_count, elapsed_seconds, is_custom_hunt) values (null,'hydra','everlasting-cycle','hydra-first-encounter',16,16,2,900,false);`
  ));
  record('R1: unauthenticated insert (no jwt claim) rejected', r.threw, r.message);
  await db.exec('rollback;');
}

const db = await freshDb();
await scenarioA(db);
await scenarioB(db);
await scenarioC(db);
await scenarioD(db);
await scenarioE(db);
await scenarioF(db);
await scenarioG(db);
await scenarioH(db);
await scenarioI(db);
await scenarioJ(db);
await scenarioK(db);
await scenarioL(db);
await scenarioM(db);
await scenarioN(db);
await scenarioO(db);
await scenarioP(db);
await profileTests(db);
await unauthenticatedTest(db);
await db.close();

const failed = results.filter(r => !r.pass);
console.log(`\n=== ${results.length - failed.length}/${results.length} PASSED ===`);
if (failed.length) {
  console.log('FAILED:', failed.map(f => f.name));
  process.exit(1);
}
