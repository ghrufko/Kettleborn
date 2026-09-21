const KG_TO_LB = 2.20462;

export function convertKgToDisplay(weightKg: number, unit: 'kg' | 'lb'): number {
  if (unit === 'lb') {
    return Math.round(weightKg * KG_TO_LB);
  }
  return weightKg;
}

/** Inverse of convertKgToDisplay — a value the player typed/adjusted in their display unit, back to kg for storage/validation. */
export function convertDisplayToKg(displayValue: number, unit: 'kg' | 'lb'): number {
  if (unit === 'lb') {
    return displayValue / KG_TO_LB;
  }
  return displayValue;
}

export function formatWeight(weightKg: number, unit: 'kg' | 'lb'): string {
  return `${convertKgToDisplay(weightKg, unit)} ${unit.toUpperCase()}`;
}

/**
 * Kettlebell weight audit: display for a saved result's weight(s).
 * `weightBKg` (a genuinely independent second bell — 16kg + 18kg is
 * valid, never assumed equal to `weightAKg`) shows as "16 + 18 KG"
 * whenever it actually differs; a matched pair still shows the old,
 * more compact "16 × 2 KG" shorthand, since that IS accurate for
 * every result saved with both bells the same weight (the common case,
 * and everything saved before this feature existed).
 */
export function formatWeightPair(
  weightAKg: number,
  weightBKg: number | null,
  unit: 'kg' | 'lb'
): string {
  if (weightBKg === null) {
    return formatWeight(weightAKg, unit);
  }
  const a = convertKgToDisplay(weightAKg, unit);
  const b = convertKgToDisplay(weightBKg, unit);
  if (a === b) {
    return `${a} × 2 ${unit.toUpperCase()}`;
  }
  return `${a} + ${b} ${unit.toUpperCase()}`;
}
