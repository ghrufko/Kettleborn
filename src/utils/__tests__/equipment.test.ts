import test from 'node:test';
import assert from 'node:assert/strict';
import { getHeaviestOwnedKettlebellKg, getHeaviestMatchedKettlebellPairKg } from '../equipment';
import { convertDisplayToKg } from '../weight';
import type { Equipment } from '../../models';

function kb(overrides: Partial<Equipment>): Equipment {
  return {
    id: 'kb-test',
    userId: 'local-hunter',
    type: 'kettlebell',
    weight: 16,
    unit: 'kg',
    label: '16 KG',
    owned: true,
    ...overrides,
  };
}

test('returns null for an empty equipment list', () => {
  assert.equal(getHeaviestOwnedKettlebellKg([]), null);
});

test('returns the single kettlebell weight when only one is owned', () => {
  assert.equal(getHeaviestOwnedKettlebellKg([kb({ weight: 20 })]), 20);
});

test('returns the heaviest of several owned kettlebells, regardless of order', () => {
  const equipment = [kb({ id: 'a', weight: 16 }), kb({ id: 'b', weight: 24 }), kb({ id: 'c', weight: 20 })];
  assert.equal(getHeaviestOwnedKettlebellKg(equipment), 24);
});

test('ignores equipment that is not owned', () => {
  const equipment = [kb({ id: 'a', weight: 16, owned: true }), kb({ id: 'b', weight: 32, owned: false })];
  assert.equal(getHeaviestOwnedKettlebellKg(equipment), 16);
});

test('ignores non-kettlebell equipment types', () => {
  const equipment = [kb({ id: 'a', weight: 16, type: 'kettlebell' }), kb({ id: 'b', weight: 50, type: 'other' })];
  assert.equal(getHeaviestOwnedKettlebellKg(equipment), 16);
});

test('returns null when every item is owned but none is a kettlebell', () => {
  assert.equal(getHeaviestOwnedKettlebellKg([kb({ type: 'other' })]), null);
});

// --- getHeaviestMatchedKettlebellPairKg (Phase 2.8) ---

test('matched pair: returns null for an empty equipment list', () => {
  assert.equal(getHeaviestMatchedKettlebellPairKg([]), null);
});

test('matched pair: returns null when only one kettlebell is owned', () => {
  assert.equal(getHeaviestMatchedKettlebellPairKg([kb({ weight: 20 })]), null);
});

test('matched pair: two kettlebells at the same weight form a pair', () => {
  const equipment = [kb({ id: 'a', weight: 16 }), kb({ id: 'b', weight: 16 })];
  assert.equal(getHeaviestMatchedKettlebellPairKg(equipment), 16);
});

test('matched pair: two kettlebells at different weights never count as a pair, even though both are owned', () => {
  const equipment = [kb({ id: 'a', weight: 16 }), kb({ id: 'b', weight: 24 })];
  assert.equal(getHeaviestMatchedKettlebellPairKg(equipment), null);
});

test('matched pair: with several kettlebells, selects the heaviest weight that actually has >= 2 owned, not just the two heaviest overall', () => {
  // 24kg is the heaviest single bell, but it's a singleton — 20kg has two,
  // so 20 is the correct answer, not 24 and not the 24+20 "two heaviest".
  const equipment = [
    kb({ id: 'a', weight: 16 }),
    kb({ id: 'b', weight: 16 }),
    kb({ id: 'c', weight: 20 }),
    kb({ id: 'd', weight: 20 }),
    kb({ id: 'e', weight: 24 }),
  ];
  assert.equal(getHeaviestMatchedKettlebellPairKg(equipment), 20);
});

test('matched pair: three of the same weight still counts as a pair (heaviest valid match)', () => {
  const equipment = [kb({ id: 'a', weight: 18 }), kb({ id: 'b', weight: 18 }), kb({ id: 'c', weight: 18 })];
  assert.equal(getHeaviestMatchedKettlebellPairKg(equipment), 18);
});

test('matched pair: ignores unowned equipment when counting toward a pair', () => {
  const equipment = [kb({ id: 'a', weight: 16, owned: true }), kb({ id: 'b', weight: 16, owned: false })];
  assert.equal(getHeaviestMatchedKettlebellPairKg(equipment), null);
});

test('matched pair: ignores non-kettlebell equipment when counting toward a pair', () => {
  const equipment = [kb({ id: 'a', weight: 16, type: 'kettlebell' }), kb({ id: 'b', weight: 16, type: 'other' })];
  assert.equal(getHeaviestMatchedKettlebellPairKg(equipment), null);
});

test('matched pair: tiny floating-point drift still normalizes to the same matched weight', () => {
  const equipment = [kb({ id: 'a', weight: 16 }), kb({ id: 'b', weight: 16.0000001 })];
  assert.equal(getHeaviestMatchedKettlebellPairKg(equipment), 16);
});

test('matched pair: two kg values independently derived from the same lb display value via the existing conversion helper still match as a pair', () => {
  // Equipment.weight is always stored in kg (settingsSlice always writes
  // unit: 'kg'), but a player thinks in lb — this confirms the *real*
  // convertDisplayToKg helper (not a second, independent conversion rule)
  // produces a kg value that still matches another kettlebell genuinely
  // owned at that same kg weight, exactly as a flawless kg-to-kg
  // comparison would.
  const weightFromLbEntry = convertDisplayToKg(35, 'lb');
  const equipment = [kb({ id: 'a', weight: weightFromLbEntry }), kb({ id: 'b', weight: weightFromLbEntry })];
  assert.equal(getHeaviestMatchedKettlebellPairKg(equipment), Math.round(weightFromLbEntry * 100) / 100);
});

test('matched pair: ignores invalid weight values (NaN, zero, negative) rather than crashing or matching them', () => {
  const equipment = [
    kb({ id: 'a', weight: NaN }),
    kb({ id: 'b', weight: NaN }),
    kb({ id: 'c', weight: 0 }),
    kb({ id: 'd', weight: 0 }),
    kb({ id: 'e', weight: -16 }),
    kb({ id: 'f', weight: -16 }),
  ];
  assert.equal(getHeaviestMatchedKettlebellPairKg(equipment), null);
});
