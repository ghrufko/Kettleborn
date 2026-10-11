import type { Equipment } from '../models';

/**
 * Phase 2.7: the default-suggested weight for a single-kettlebell Hunt —
 * the heaviest kettlebell the player has actually recorded owning in the
 * Forge. `Equipment.weight` is always stored in kg (see settingsSlice's
 * saveEquipment), so no unit conversion happens here; callers convert to
 * the player's display unit themselves, same as every other weight field.
 * Returns null when the player owns no kettlebells, so callers can fall
 * back to the existing canonical recommendation.
 */
export function getHeaviestOwnedKettlebellKg(equipment: Equipment[]): number | null {
  const owned = equipment.filter((item) => item.type === 'kettlebell' && item.owned);
  if (owned.length === 0) {
    return null;
  }
  return Math.max(...owned.map((item) => item.weight));
}

// Same 2-decimal-place rounding HuntOverviewScreen's own weight stepper
// already uses (`Math.round((base + delta) * 100) / 100`) — reused here
// rather than inventing a second precision rule, so two kettlebells that
// are the "same weight" by every other on-screen comparison are also
// treated as the same weight here.
function normalizeKg(weightKg: number): number {
  return Math.round(weightKg * 100) / 100;
}

/**
 * Phase 2.8: the default-suggested weight for a double-kettlebell Hunt —
 * the heaviest weight the player owns *at least two* of. Two arbitrary
 * kettlebells are never assumed to form a pair just because they're the
 * two heaviest owned (e.g. a 24kg + an 18kg is not a pair); only an
 * actual matched weight, owned twice or more, counts. Returns null when
 * no such pair exists (including when the player owns zero or one
 * kettlebell, or several but no two share a weight), so callers can fall
 * back to the existing canonical workout default — exactly like
 * getHeaviestOwnedKettlebellKg does for the single-bell case.
 */
export function getHeaviestMatchedKettlebellPairKg(equipment: Equipment[]): number | null {
  const owned = equipment.filter(
    (item) =>
      item.type === 'kettlebell' &&
      item.owned &&
      typeof item.weight === 'number' &&
      Number.isFinite(item.weight) &&
      item.weight > 0
  );
  const countByWeight = new Map<number, number>();
  for (const item of owned) {
    const weight = normalizeKg(item.weight);
    countByWeight.set(weight, (countByWeight.get(weight) ?? 0) + 1);
  }
  let heaviestPairKg: number | null = null;
  for (const [weight, count] of countByWeight) {
    if (count >= 2 && (heaviestPairKg === null || weight > heaviestPairKg)) {
      heaviestPairKg = weight;
    }
  }
  return heaviestPairKg;
}
