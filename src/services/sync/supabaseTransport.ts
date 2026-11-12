import { getSupabaseClient } from '../supabase/client';
import type { PushItem, PushOutcome, SyncTransport } from './engine';
import type { PulledItem } from './apply';

/**
 * The app's SyncTransport: the three RPCs from the generated sync
 * migration, called with the signed-in user's session through the
 * publishable key. No privileged credential is ever used here.
 */
export function createSupabaseTransport(): SyncTransport {
  const client = () => {
    const c = getSupabaseClient();
    if (!c) throw new Error('Supabase is not configured');
    return c;
  };
  return {
    async push(deviceUuid: string, items: PushItem[]) {
      const { data, error } = await client().rpc('sync_push', { p_device: deviceUuid, p_items: items } as never);
      if (error) throw new Error(`sync_push failed: ${error.message}`);
      return data as unknown as PushOutcome[];
    },
    async pull(cursor: number, limit: number) {
      const { data, error } = await client().rpc('sync_pull', { p_cursor: cursor, p_limit: limit } as never);
      if (error) throw new Error(`sync_pull failed: ${error.message}`);
      return data as unknown as { items: PulledItem[]; next_cursor: number };
    },
    async accountStatus() {
      const { data, error } = await client().rpc('sync_account_status' as never);
      if (error) throw new Error(`sync_account_status failed: ${error.message}`);
      return data as unknown as { has_data: boolean };
    },
  };
}
