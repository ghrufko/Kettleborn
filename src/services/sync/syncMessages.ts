/**
 * Cloud Save P9 — every player-facing sync sentence, exactly as approved
 * (Phase 2.0.12 wording with the Phase 2.0.13 corrections). Kept in one
 * pure module so tests can check the exact text without rendering a screen.
 */

export const SYNC_TEXT = {
  bonusPending: (xp: number) => `First clear bonus +${xp} XP · pending until your account confirms it`,
  bonusConfirmed: (xp: number) => `First clear bonus confirmed: +${xp} XP`,
  bonusEarnedElsewhere: 'First clear bonus already earned on another device',
  xpPending: (xp: number) => `+${xp} XP pending · will be confirmed when you're back online`,
  lastSynced: (days: number) => `Last synced ${days} days ago`,
  campaignResetElsewhere: (date: string, hunts: number) =>
    `Your campaign was reset on another device on ${date}. ${hunts} hunt(s) finished here belong to your previous campaign and are kept in your history.`,
  recalculated: 'Workouts from your other device were added. Your current streak and rank history were recalculated.',
  conflictLine: (n: number) => `${n} change(s) weren't saved because they were also changed on another device · Review`,
  keepOther: "Keep other device's version",
  useThisDevice: "Use this device's version",
  saveAsNewWorkout: 'Save my version as a new workout',
  keepIt: 'Keep it',
  deleteAnyway: 'Delete anyway',
  offerLink: "Back up this device's progress to your account?",
  offerRestore: 'Restore your progress from your account?',
  refused:
    'This device already has its own progress, and your account has different progress. This device keeps playing without syncing.',
  otherAccount: "This device's progress belongs to another account. Sign in with that account to sync.",
  signOutUnsynced: (n: number) =>
    `${n} changes haven't been backed up yet. They'll stay on this device and upload when you sign in to the linked account.`,
  blocked: "This device's history can't be synced yet. Your progress is safe and the game works normally.",
  resetAllDevices: 'This resets your campaign on all your devices.',
} as const;

/** "Last synced N days ago" appears only after 7 full days without a successful sync (D3). */
export function lastSyncedLine(lastSyncedAt: string | null, now: Date = new Date()): string | null {
  if (!lastSyncedAt) return null;
  const days = Math.floor((now.getTime() - new Date(lastSyncedAt).getTime()) / 86_400_000);
  return days >= 7 ? SYNC_TEXT.lastSynced(days) : null;
}

/** One line per notice, or null for a kind this version doesn't display. */
export function noticeText(notice: { kind: string; data: any }): string | null {
  switch (notice.kind) {
    case 'campaign_reset_elsewhere':
      return SYNC_TEXT.campaignResetElsewhere(
        notice.data?.resetAt ? new Date(notice.data.resetAt).toLocaleDateString() : '',
        notice.data?.huntsMovedToHistory ?? 0
      );
    case 'recalculated':
      return SYNC_TEXT.recalculated;
    case 'bonus_confirmed':
      return SYNC_TEXT.bonusConfirmed(notice.data?.xp ?? 0);
    case 'bonus_lost':
      return SYNC_TEXT.bonusEarnedElsewhere;
    default:
      return null;
  }
}

/** The two choices offered for one conflict (D9), as button labels. */
export function conflictChoices(conflict: { entityType: string; field: string | null; localValue: any; serverValue: any }): {
  keepServer: string;
  useLocal: string;
} {
  if (conflict.field === null && conflict.localValue?.deleted_at) {
    // Deleted here, changed on another device.
    return { keepServer: SYNC_TEXT.keepIt, useLocal: SYNC_TEXT.deleteAnyway };
  }
  if (conflict.entityType === 'custom_workout' && conflict.serverValue?.deleted_at) {
    return { keepServer: SYNC_TEXT.keepOther, useLocal: SYNC_TEXT.saveAsNewWorkout };
  }
  return { keepServer: SYNC_TEXT.keepOther, useLocal: SYNC_TEXT.useThisDevice };
}

/** A short, human description of what conflicted. */
export function conflictTitle(conflict: { entityType: string; field: string | null; localValue: any; serverValue: any }): string {
  if (conflict.field === 'notes') return 'Hunt notes';
  if (conflict.field === 'rpe') return 'Hunt effort (RPE)';
  const name = conflict.localValue?.name ?? conflict.localValue?.label ?? conflict.serverValue?.name ?? conflict.serverValue?.label;
  const kind: Record<string, string> = {
    custom_workout: 'Custom workout',
    timer_preset: 'Timer',
    equipment: 'Kettlebell',
    custom_hunt_preset: 'Custom Hunt settings',
    settings_account: 'Weight unit',
  };
  return name ? `${kind[conflict.entityType] ?? 'Item'}: ${name}` : kind[conflict.entityType] ?? 'Item';
}
