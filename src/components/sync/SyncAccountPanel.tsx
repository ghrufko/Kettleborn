import React, { useEffect, useState } from 'react';
import { Text, StyleSheet } from 'react-native';
import { Button, ConfirmDialog } from '../core';
import { shareDataExport } from '../../services/sync/exportShare';
import { useAppStore } from '../../store';
import { SYNC_TEXT } from '../../services/sync/syncMessages';
import { colors, fontFamily, fontSize, spacing } from '../../theme';

/**
 * Cloud Save P9 — inside Settings → Account (signed in): the link /
 * restore prompts and the D4/D10/C1 explanations. Renders nothing when
 * sync is off (every build today).
 */
export function SyncAccountPanel() {
  const sync = useAppStore((state) => state.sync);
  const confirmLink = useAppStore((state) => state.confirmLink);
  const confirmRestore = useAppStore((state) => state.confirmRestore);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const deleteCloudAccount = useAppStore((state) => state.deleteCloudAccount);
  const [deleteVisible, setDeleteVisible] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);

  useEffect(() => setDismissed(null), [sync.decision]);
  if (sync.decision === 'off') return null;

  const message =
    sync.decision === 'refused'
      ? SYNC_TEXT.refused
      : sync.decision === 'other_account'
        ? SYNC_TEXT.otherAccount
        : sync.decision === 'blocked'
          ? SYNC_TEXT.blocked
          : null;

  const prompt = sync.decision === 'offer_link' ? SYNC_TEXT.offerLink : sync.decision === 'offer_restore' ? SYNC_TEXT.offerRestore : null;

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
      setDismissed(sync.decision);
    }
  };

  return (
    <>
      {message ? <Text style={styles.note}>{message}</Text> : null}
      {sync.lastError && sync.decision === 'resume' ? <Text style={styles.error}>{sync.lastError}</Text> : null}
      <Button
        label="Export my data"
        variant="secondary"
        onPress={() => {
          setAccountError(null);
          shareDataExport().catch(() => setAccountError('Your data could not be exported. Please try again.'));
        }}
        style={styles.button}
      />
      <Button label="Delete cloud account" variant="destructive" onPress={() => setDeleteVisible(true)} style={styles.button} />
      {accountError ? <Text style={styles.error}>{accountError}</Text> : null}
      <ConfirmDialog
        visible={deleteVisible}
        title="Delete cloud account?"
        message="This permanently deletes your cloud account and everything backed up to it. Your progress on this device is kept, and the game keeps working offline."
        cancelLabel="Cancel"
        confirmLabel="Delete"
        confirmDisabled={busy}
        onCancel={() => setDeleteVisible(false)}
        onConfirm={async () => {
          setBusy(true);
          const result = await deleteCloudAccount();
          setBusy(false);
          setDeleteVisible(false);
          if (!result.ok) setAccountError(result.error);
        }}
      />
      <ConfirmDialog
        visible={prompt !== null && dismissed !== sync.decision}
        title="Cloud Save"
        message={prompt ?? ''}
        cancelLabel="Not now"
        confirmLabel={sync.decision === 'offer_restore' ? 'Restore' : 'Back up'}
        confirmVariant="primary"
        confirmDisabled={busy}
        onCancel={() => setDismissed(sync.decision)}
        onConfirm={() => run(sync.decision === 'offer_restore' ? confirmRestore : confirmLink)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  note: { marginTop: spacing.sm, fontFamily: fontFamily.bodyRegular, fontSize: fontSize.sm, color: colors.text.muted },
  error: { marginTop: spacing.sm, fontFamily: fontFamily.bodyRegular, fontSize: fontSize.sm, color: colors.ember.base },
  button: { marginTop: spacing.sm },
});
