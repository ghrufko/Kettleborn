import { runInTransaction } from '../db/transaction';
import { applyAck, resetInFlight, takeBatch, type AckOutcome, type OutboxRow, type QueueConnection } from './outbox';
import { applyPulledItems, reconcileLocalState, writeStoredTotals, type PulledItem } from './apply';

/**
 * Cloud Save P7 — one sync pass: upload the queue, download what changed,
 * apply it and rebuild the stored totals. The transport is injected
 * (supabaseTransport in the app, a PGlite transport in tests), so this
 * file has no network code of its own.
 *
 * Nothing runs unless the install is linked (sync_enabled = 1), not
 * blocked (C1), and no hunt is in progress: data that arrives during a
 * hunt is applied after it ends (D5).
 */

export interface PushItem {
  device_seq: number;
  entity_type: string;
  entity_key: string;
  op: string;
  field: string | null;
  base_seq: number | null;
  payload: unknown;
}

export interface PushOutcome {
  device_seq: number;
  status: 'accepted' | 'duplicate' | 'stale' | 'claimed_elsewhere' | 'invalid';
  server_seq?: number;
  server_value?: unknown;
  error?: string;
}

export interface SyncTransport {
  push(deviceUuid: string, items: PushItem[]): Promise<PushOutcome[]>;
  pull(cursor: number, limit: number): Promise<{ items: PulledItem[]; next_cursor: number }>;
  accountStatus(): Promise<{ has_data: boolean }>;
}

export interface SyncReport {
  skipped?: 'not_linked' | 'blocked' | 'hunt_active';
  pushed: number;
  pulled: number;
  conflicts: number;
  quarantined: number;
}

let huntActive = false;
/** ActiveHuntScreen marks a hunt in progress; a sync then waits until it ends. */
export function setHuntActive(active: boolean): void {
  huntActive = active;
}
export function isHuntActive(): boolean {
  return huntActive;
}

function toOutcome(o: PushOutcome): AckOutcome {
  switch (o.status) {
    case 'accepted':
    case 'duplicate':
      return { status: o.status, serverSeq: Number(o.server_seq) };
    case 'stale':
      return { status: 'stale', serverSeq: Number(o.server_seq), serverValue: o.server_value };
    case 'claimed_elsewhere':
      return { status: 'claimed_elsewhere', serverSeq: Number(o.server_seq), serverValue: o.server_value };
    default:
      return { status: 'invalid', error: o.error ?? 'rejected by the server' };
  }
}

function toPushItem(row: OutboxRow): PushItem {
  return {
    device_seq: row.device_seq,
    entity_type: row.entity_type,
    entity_key: row.entity_key,
    op: row.op,
    field: row.field,
    base_seq: row.base_seq,
    payload: JSON.parse(row.payload_json),
  };
}

/**
 * The "recalculated" notice is shown only when merged history visibly
 * lowered a statistic (the current streak), and never twice while one is
 * still undismissed — not for ordinary new workouts from another device.
 */
async function recalculationNoticeNeeded(db: QueueConnection, userId: string, streakBefore: number): Promise<boolean> {
  const after = (await db.getFirstAsync<{ s: number }>('SELECT current_streak_days AS s FROM chronicle WHERE user_id = ?;', userId))?.s ?? 0;
  if (after >= streakBefore) return false;
  const open = await db.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM sync_notice WHERE kind = 'recalculated' AND dismissed_at IS NULL;"
  );
  return (open?.n ?? 0) === 0;
}

export async function syncOnce(
  db: QueueConnection,
  transport: SyncTransport,
  userId: string,
  huntsTotalByMonster: Record<string, number>
): Promise<SyncReport> {
  const report: SyncReport = { pushed: 0, pulled: 0, conflicts: 0, quarantined: 0 };
  const state = await db.getFirstAsync<{ device_uuid: string; sync_enabled: number; sync_blocked_reason: string | null; pull_cursor: number | null }>(
    'SELECT device_uuid, sync_enabled, sync_blocked_reason, pull_cursor FROM sync_state WHERE id = 1;'
  );
  if (!state || state.sync_enabled !== 1) return { ...report, skipped: 'not_linked' };
  if (state.sync_blocked_reason !== null) return { ...report, skipped: 'blocked' };
  if (huntActive) return { ...report, skipped: 'hunt_active' };

  // ---- upload (rows a crash left in flight are resent unchanged)
  await resetInFlight(db);
  for (let round = 0; round < 1000; round += 1) {
    const batch = await takeBatch(db, 100);
    if (batch.length === 0) break;
    let outcomes: PushOutcome[];
    try {
      outcomes = await transport.push(state.device_uuid, batch.map(toPushItem));
    } catch (error) {
      await resetInFlight(db); // nothing was acknowledged: resend later, unchanged
      throw error;
    }
    const bySeq = new Map(outcomes.map((o) => [Number(o.device_seq), o]));
    for (const row of batch) {
      const o = bySeq.get(row.device_seq);
      if (!o) continue; // unanswered: stays in flight, resent on the next pass
      await applyAck(db, row.device_seq, toOutcome(o));
      report.pushed += 1;
      if (o.status === 'stale') report.conflicts += 1;
      if (o.status === 'invalid') report.quarantined += 1;
    }
  }
  // Claim confirmations change confirmed XP: rewrite the totals (never lowering them).
  await runInTransaction(db, () => writeStoredTotals(db, userId, huntsTotalByMonster, { allowXpDecrease: false }));

  // ---- download
  let cursor = state.pull_cursor ?? 0;
  for (let round = 0; round < 10000; round += 1) {
    const page = await transport.pull(cursor, 500);
    if (page.items.length === 0) break;
    await runInTransaction(db, async () => {
      const streakBefore = (await db.getFirstAsync<{ s: number }>('SELECT current_streak_days AS s FROM chronicle WHERE user_id = ?;', userId))?.s ?? 0;
      const applied = await applyPulledItems(db, userId, page.items);
      const reconciled = await reconcileLocalState(db, userId, huntsTotalByMonster, {
        campaignResetsApplied: applied.campaignResets,
      });
      if (applied.campaignResets > 0) {
        await db.runAsync(
          'INSERT INTO sync_notice (kind, data_json, created_at) VALUES (?, ?, ?);',
          'campaign_reset_elsewhere',
          JSON.stringify({ huntsMovedToHistory: reconciled.voidedByOtherDevices, resetAt: applied.latestCampaignResetAt }),
          new Date().toISOString()
        );
      } else if (applied.foreignHunts > 0 && (await recalculationNoticeNeeded(db, userId, streakBefore))) {
        await db.runAsync(
          'INSERT INTO sync_notice (kind, data_json, created_at) VALUES (?, ?, ?);',
          'recalculated',
          JSON.stringify({ addedHunts: applied.foreignHunts }),
          new Date().toISOString()
        );
      }
      await db.runAsync('UPDATE sync_state SET pull_cursor = ? WHERE id = 1;', Number(page.next_cursor));
    });
    report.pulled += page.items.length;
    cursor = Number(page.next_cursor);
  }
  await db.runAsync('UPDATE sync_state SET last_sync_at = ? WHERE id = 1;', new Date().toISOString());
  return report;
}

/**
 * Runs syncOnce when asked, one pass at a time, retrying failures with
 * exponential backoff (5 s doubling to 15 min, with jitter).
 */
export class SyncScheduler {
  private running = false;
  private again = false;
  private failures = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  private readonly run: () => Promise<SyncReport>;
  private readonly onReport?: (r: SyncReport | Error) => void;

  constructor(run: () => Promise<SyncReport>, onReport?: (r: SyncReport | Error) => void) {
    this.run = run;
    this.onReport = onReport;
  }

  request(): void {
    if (this.stopped) return;
    if (this.running) {
      this.again = true;
      return;
    }
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    void this.loop();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  static backoffMs(failures: number, random: number = Math.random()): number {
    const base = Math.min(5_000 * 2 ** Math.max(0, failures - 1), 15 * 60_000);
    return Math.round(base * (0.8 + 0.4 * random));
  }

  private async loop(): Promise<void> {
    this.running = true;
    try {
      do {
        this.again = false;
        const report = await this.run();
        this.failures = 0;
        this.onReport?.(report);
      } while (this.again && !this.stopped);
    } catch (error) {
      this.failures += 1;
      this.onReport?.(error as Error);
      if (!this.stopped) {
        this.timer = setTimeout(() => this.request(), SyncScheduler.backoffMs(this.failures));
        // A pending retry must never keep a process alive on its own (Node); harmless where unref doesn't exist.
        (this.timer as { unref?: () => void }).unref?.();
      }
    } finally {
      this.running = false;
    }
  }
}
