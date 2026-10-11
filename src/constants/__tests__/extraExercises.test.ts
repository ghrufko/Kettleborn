import test from 'node:test';
import assert from 'node:assert/strict';

const { EXTRA_EXERCISE_DEFINITIONS, getExtraExerciseName } = await import(
  new URL('../extraExercises.ts', import.meta.url).href
);

test('defines exactly the three initial exercise options, in order', () => {
  assert.deepEqual(
    EXTRA_EXERCISE_DEFINITIONS.map((d: { id: string }) => d.id),
    ['double-kb-pushup', 'single-kb-pushup', 'vertical-pullup']
  );
});

test('every definition has a non-empty display name', () => {
  for (const def of EXTRA_EXERCISE_DEFINITIONS as { id: string; name: string }[]) {
    assert.ok(def.name.length > 0, `missing name for ${def.id}`);
  }
});

test('getExtraExerciseName: resolves each known id to its display name', () => {
  assert.equal(getExtraExerciseName('double-kb-pushup'), 'Double-Kettlebell Push-Up');
  assert.equal(getExtraExerciseName('single-kb-pushup'), 'Single-Kettlebell Push-Up');
  assert.equal(getExtraExerciseName('vertical-pullup'), 'Vertical Pull-Up');
});

test('getExtraExerciseName: an unknown id falls back to the raw id rather than fabricating a name', () => {
  // Deliberately an id outside the known union (dynamic import() types as
  // `any` here, same as every other test file using this import pattern
  // in this repo) — exercises the defensive fallback for a value a
  // future/unexpected id could still produce at runtime.
  assert.equal(getExtraExerciseName('some-future-exercise'), 'some-future-exercise');
});
