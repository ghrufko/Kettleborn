// Edge-case + exact rank-boundary assertions, executed against a real
// PostgreSQL instance (PGlite/WASM). Run from this directory:
// npm install && npm run test:edge
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
await asUser(db, HUNTER_A);

const zero = await expectError(db, () => db.query(
  `insert into public.workout_results (user_id, monster_id, workout_id, hunt_id, canonical_weight_kg, weight_b_kg, gear_count, elapsed_seconds, is_custom_hunt) values ($1,'hydra','everlasting-cycle','hydra-first-encounter',0,0,2,900,false);`,
  [HUNTER_A]
));
record('Edge1: canonical_weight_kg=0 rejected (table CHECK)', zero.threw, zero.message);

const negative = await expectError(db, () => db.query(
  `insert into public.workout_results (user_id, monster_id, workout_id, hunt_id, canonical_weight_kg, weight_b_kg, gear_count, elapsed_seconds, is_custom_hunt) values ($1,'hydra','everlasting-cycle','hydra-first-encounter',-5,16,2,900,false);`,
  [HUNTER_A]
));
record('Edge2: canonical_weight_kg negative rejected', negative.threw, negative.message);

const over60 = await expectError(db, () => db.query(
  `insert into public.workout_results (user_id, monster_id, workout_id, hunt_id, canonical_weight_kg, weight_b_kg, gear_count, elapsed_seconds, is_custom_hunt) values ($1,'hydra','everlasting-cycle','hydra-first-encounter',61,16,2,900,false);`,
  [HUNTER_A]
));
record('Edge3: canonical_weight_kg=61 rejected (60kg ceiling)', over60.threw, over60.message);

const exactly60 = await expectError(db, () => db.query(
  `insert into public.workout_results (user_id, monster_id, workout_id, hunt_id, canonical_weight_kg, weight_b_kg, gear_count, elapsed_seconds, is_custom_hunt) values ($1,'hydra','everlasting-cycle','hydra-first-encounter',60,16,2,900,false);`,
  [HUNTER_A]
));
record('Edge4: canonical_weight_kg=60 (exact boundary) accepted', !exactly60.threw, exactly60.message || 'inserted OK');

const weightBOver60 = await expectError(db, () => db.query(
  `insert into public.workout_results (user_id, monster_id, workout_id, hunt_id, canonical_weight_kg, weight_b_kg, gear_count, elapsed_seconds, is_custom_hunt) values ($1,'hydra','everlasting-cycle','hydra-first-encounter',16,61,2,900,false);`,
  [HUNTER_A]
));
record('Edge5: weight_b_kg=61 rejected (60kg ceiling applies to both columns)', weightBOver60.threw, weightBOver60.message);

const zeroElapsed = await expectError(db, () => db.query(
  `insert into public.workout_results (user_id, monster_id, workout_id, hunt_id, canonical_weight_kg, weight_b_kg, gear_count, elapsed_seconds, is_custom_hunt) values ($1,'hydra','everlasting-cycle','hydra-first-encounter',16,16,2,0,false);`,
  [HUNTER_A]
));
record('Edge6: elapsed_seconds=0 rejected', zeroElapsed.threw, zeroElapsed.message);

const negativeElapsed = await expectError(db, () => db.query(
  `insert into public.workout_results (user_id, monster_id, workout_id, hunt_id, canonical_weight_kg, weight_b_kg, gear_count, elapsed_seconds, is_custom_hunt) values ($1,'hydra','everlasting-cycle','hydra-first-encounter',16,16,2,-1,false);`,
  [HUNTER_A]
));
record('Edge7: elapsed_seconds negative rejected', negativeElapsed.threw, negativeElapsed.message);

const badGearCount = await expectError(db, () => db.query(
  `insert into public.workout_results (user_id, monster_id, workout_id, hunt_id, canonical_weight_kg, weight_b_kg, gear_count, elapsed_seconds, is_custom_hunt) values ($1,'hydra','everlasting-cycle','hydra-first-encounter',16,16,3,900,false);`,
  [HUNTER_A]
));
record('Edge8: gear_count=3 rejected (CHECK in (1,2))', badGearCount.threw, badGearCount.message);

const nullElapsed = await expectError(db, () => db.query(
  `insert into public.workout_results (user_id, monster_id, workout_id, hunt_id, canonical_weight_kg, weight_b_kg, gear_count, elapsed_seconds, is_custom_hunt) values ($1,'hydra','everlasting-cycle','hydra-first-encounter',16,16,2,null,false);`,
  [HUNTER_A]
));
record('Edge9: NULL elapsed_seconds rejected (NOT NULL)', nullElapsed.threw, nullElapsed.message);

// Rank boundary values, independently derived:
// target=1080. 85%=918, 100%=1080, 115%=1242.
const boundaries = [
  { elapsed: 918, expect: 'S' },   // exactly 85%
  { elapsed: 919, expect: 'A' },   // just past 85%
  { elapsed: 1080, expect: 'A' },  // exactly 100%
  { elapsed: 1081, expect: 'B' },  // just past 100%
  { elapsed: 1242, expect: 'B' },  // exactly 115%
  { elapsed: 1243, expect: 'C' },  // just past 115%
];
for (const b of boundaries) {
  const r = await db.query(
    `insert into public.workout_results (user_id, monster_id, workout_id, hunt_id, canonical_weight_kg, weight_b_kg, gear_count, elapsed_seconds, is_custom_hunt) values ($1,'hydra','everlasting-cycle','hydra-first-encounter',16,16,2,$2,false) returning rank;`,
    [HUNTER_A, b.elapsed]
  );
  record(`Edge-boundary: elapsed=${b.elapsed} -> expect ${b.expect}`, r.rows[0].rank === b.expect, `got ${r.rows[0].rank}`);
}

await db.exec('rollback;');
await db.close();

const failed = results.filter(r => !r.pass);
console.log(`\n=== ${results.length - failed.length}/${results.length} PASSED ===`);
if (failed.length) { console.log('FAILED:', failed.map(f => f.name)); process.exit(1); }
