import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * Visual audit sprint — the display helpers shared screens now use:
 * volume formatting, count agreement and the Header's title fitting.
 */
const { formatVolume } = await import(new URL('../weight.ts', import.meta.url).href);
const { formatCount } = await import(new URL('../countFormat.ts', import.meta.url).href);
const { fitHeaderTitleSize } = await import(new URL('../headerTitleSize.ts', import.meta.url).href);

test('formatVolume groups thousands and keeps the lower-case unit', () => {
  assert.equal(formatVolume(2400, 'kg'), '2,400 kg');
  assert.equal(formatVolume(9944.4, 'kg'), '9,944 kg');
  assert.equal(formatVolume(0, 'kg'), '0 kg');
  assert.equal(formatVolume(120, 'kg'), '120 kg');
});

test('formatVolume converts to the player\'s unit', () => {
  // 2,400 kg × 2.20462 = 5,291 lb
  assert.equal(formatVolume(2400, 'lb'), '5,291 lb');
});

test('formatCount agrees with its number', () => {
  assert.equal(formatCount(1, 'day'), '1 day');
  assert.equal(formatCount(2, 'day'), '2 days');
  assert.equal(formatCount(0, 'day'), '0 days');
});

test('Header titles keep 20pt when short and shrink, never below 15pt, when long', () => {
  assert.equal(fitHeaderTitleSize('Hunter', 320), 20);
  assert.equal(fitHeaderTitleSize('Forge', 390), 20);
  const long360 = fitHeaderTitleSize('Second Encounter', 360);
  assert.ok(long360 < 20 && long360 >= 15, `got ${long360}`);
  assert.ok(fitHeaderTitleSize('Second Encounter', 320) <= long360);
  assert.equal(fitHeaderTitleSize('An Absurdly Long Screen Title Indeed', 320), 15);
});
