import { getSupabaseClient } from './client';

/**
 * Cloud Save P10 — asks the delete-account Edge Function to delete the
 * signed-in player's own account. The request carries only the player's
 * own session; the privileged deletion happens server-side.
 */
export async function deleteMyCloudAccount(): Promise<{ ok: true } | { ok: false; error: string }> {
  const client = getSupabaseClient();
  if (!client) return { ok: false, error: 'Cloud accounts are not available in this build.' };
  const { error } = await client.functions.invoke('delete-account', { method: 'POST' });
  if (error) return { ok: false, error: 'Your account could not be deleted. Please try again.' };
  return { ok: true };
}
