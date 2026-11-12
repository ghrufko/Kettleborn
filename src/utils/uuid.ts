import { randomUUID } from 'expo-crypto';

/**
 * A cryptographically random RFC 4122 v4 UUID — the permanent, globally
 * unique identity a record keeps for life (and, later, across devices and
 * in Supabase). Uses expo-crypto: the platform CSPRNG on iOS/Android and
 * `crypto.randomUUID()` on web.
 *
 * Deliberately separate from each table's legacy `id` (e.g.
 * `${workoutId}-${Date.now()}`), which stays the local primary key so no
 * existing reference, screen or saved row has to change.
 */
export function newUuid(): string {
  return randomUUID();
}
