import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const { EXTRA_EXERCISE_IDS } = await import(new URL('../extraExercises.ts', import.meta.url).href);

test('defines exactly the three initial exercise ids, in order', () => {
  assert.deepEqual(EXTRA_EXERCISE_IDS, ['double-kb-pushup', 'single-kb-pushup', 'vertical-pullup']);
});

test('every id corresponds to a real entry in the exercise library', () => {
  // fileURLToPath(import.meta.url) — a plain string, not `new URL(...)` —
  // deliberately avoids passing a URL object to a node:fs path argument:
  // this project's tsconfig pulls in both DOM and Node lib types, whose
  // two separate `URL` declarations are structurally incompatible for
  // that specific overload, even though both resolve identically at
  // runtime.
  const testDir = dirname(fileURLToPath(import.meta.url));
  const libraryPath = join(testDir, '../../../content/exercises/library.json');
  const library = JSON.parse(readFileSync(libraryPath, 'utf8'));
  const libraryIds = new Set(library.map((entry: { id: string }) => entry.id));
  for (const id of EXTRA_EXERCISE_IDS as string[]) {
    assert.ok(libraryIds.has(id), `${id} is not present in content/exercises/library.json`);
  }
});
