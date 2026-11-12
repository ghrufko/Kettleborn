import test from 'node:test';
import assert from 'node:assert/strict';

/** Cloud Save P9 — the approved wording, exactly (Phase 2.0.12 + 2.0.13 corrections), and when each line appears. */
const M = await import(new URL('../syncMessages.ts', import.meta.url).href);
const T = M.SYNC_TEXT;

test('approved wording, verbatim', () => {
  assert.equal(T.bonusPending(100), 'First clear bonus +100 XP · pending until your account confirms it');
  assert.equal(T.bonusConfirmed(100), 'First clear bonus confirmed: +100 XP');
  assert.equal(T.bonusEarnedElsewhere, 'First clear bonus already earned on another device');
  assert.equal(T.xpPending(300), "+300 XP pending · will be confirmed when you're back online");
  assert.equal(T.lastSynced(9), 'Last synced 9 days ago');
  assert.equal(
    T.campaignResetElsewhere('12/11/2026', 1),
    'Your campaign was reset on another device on 12/11/2026. 1 hunt(s) finished here belong to your previous campaign and are kept in your history.'
  );
  assert.equal(T.recalculated, 'Workouts from your other device were added. Your current streak and rank history were recalculated.');
  assert.equal(T.conflictLine(2), "2 change(s) weren't saved because they were also changed on another device · Review");
  assert.equal(T.keepOther, "Keep other device's version");
  assert.equal(T.useThisDevice, "Use this device's version");
  assert.equal(T.saveAsNewWorkout, 'Save my version as a new workout');
  assert.equal(T.keepIt, 'Keep it');
  assert.equal(T.deleteAnyway, 'Delete anyway');
  assert.equal(T.offerLink, "Back up this device's progress to your account?");
  assert.equal(T.offerRestore, 'Restore your progress from your account?');
  assert.equal(T.refused, 'This device already has its own progress, and your account has different progress. This device keeps playing without syncing.');
  assert.equal(T.otherAccount, "This device's progress belongs to another account. Sign in with that account to sync.");
  assert.equal(
    T.signOutUnsynced(3),
    "3 changes haven't been backed up yet. They'll stay on this device and upload when you sign in to the linked account."
  );
  assert.equal(T.blocked, "This device's history can't be synced yet. Your progress is safe and the game works normally.");
  assert.equal(T.resetAllDevices, 'This resets your campaign on all your devices.');
});

test('"Last synced" appears only after 7 full days', () => {
  const now = new Date('2026-11-20T12:00:00.000Z');
  assert.equal(M.lastSyncedLine(null, now), null);
  assert.equal(M.lastSyncedLine('2026-11-14T12:00:00.000Z', now), null);
  assert.equal(M.lastSyncedLine('2026-11-13T12:00:00.000Z', now), 'Last synced 7 days ago');
  assert.equal(M.lastSyncedLine('2026-11-11T12:00:00.000Z', now), 'Last synced 9 days ago');
});

test('conflict choices: edits, deletions, and a custom workout deleted elsewhere', () => {
  assert.deepEqual(M.conflictChoices({ entityType: 'hunt_result', field: 'notes', localValue: { value: 'x' }, serverValue: 'y' }), {
    keepServer: "Keep other device's version",
    useLocal: "Use this device's version",
  });
  assert.deepEqual(M.conflictChoices({ entityType: 'equipment', field: null, localValue: { deleted_at: 'd' }, serverValue: { deleted_at: null } }), {
    keepServer: 'Keep it',
    useLocal: 'Delete anyway',
  });
  assert.deepEqual(M.conflictChoices({ entityType: 'custom_workout', field: null, localValue: { name: 'a' }, serverValue: { deleted_at: 'd' } }), {
    keepServer: "Keep other device's version",
    useLocal: 'Save my version as a new workout',
  });
});

test('notices map to their approved sentences; unknown kinds are not shown', () => {
  assert.equal(M.noticeText({ kind: 'bonus_confirmed', data: { xp: 100 } }), 'First clear bonus confirmed: +100 XP');
  assert.equal(M.noticeText({ kind: 'bonus_lost', data: {} }), 'First clear bonus already earned on another device');
  assert.equal(M.noticeText({ kind: 'recalculated', data: {} }), T.recalculated);
  assert.match(M.noticeText({ kind: 'campaign_reset_elsewhere', data: { huntsMovedToHistory: 2, resetAt: '2026-11-12T10:00:00.000Z' } }), /2 hunt\(s\) finished here/);
  assert.equal(M.noticeText({ kind: 'something_new', data: {} }), null);
});
