import type { ClaimStatus } from '../projections/rebuild';

/**
 * First-clear claim status transitions (2.0.9 §4). Pure and NOT used by the
 * app yet: D3 is schema-only until sync exists, so every claim made today
 * is 'local_final'. Kept here, tested, for the sync engine (P7).
 *
 * - local_final: awarded while the install was not linked; counts in XP; never changed by a server answer.
 * - pending: awarded on a linked install; shown separately, not counted.
 * - confirmed: the server accepted it first; counts.
 * - lost: another device's claim was accepted first; never counted, so nothing is taken back.
 */
export type ClaimEvent = 'server_accepted' | 'server_claimed_elsewhere' | 'server_rejected' | 'retry' | 'account_deleted';

export function initialClaimStatus(installIsLinked: boolean): ClaimStatus {
  return installIsLinked ? 'pending' : 'local_final';
}

export function nextClaimStatus(current: ClaimStatus, event: ClaimEvent): ClaimStatus {
  if (current !== 'pending') return current; // local_final, confirmed and lost are final
  switch (event) {
    case 'server_accepted':
      return 'confirmed';
    case 'server_claimed_elsewhere':
      return 'lost';
    case 'account_deleted':
      return 'local_final';
    case 'server_rejected':
    case 'retry':
      return 'pending';
  }
}
