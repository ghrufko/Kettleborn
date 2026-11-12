import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { GlassCard } from '../core';
import { useAppStore } from '../../store';
import { SYNC_TEXT, lastSyncedLine, noticeText } from '../../services/sync/syncMessages';
import { ConflictReviewSheet } from './ConflictReviewSheet';
import { colors, fontFamily, fontSize, spacing } from '../../theme';

/**
 * Cloud Save P9 — the Hunter screen's sync lines: pending XP, last sync,
 * conflicts to review, notices, and the blocked-install message. Renders
 * nothing when sync is off (every build today) or there is nothing to say.
 */
export function SyncStatusCard() {
  const sync = useAppStore((state) => state.sync);
  const refreshSyncStatus = useAppStore((state) => state.refreshSyncStatus);
  const dismissNotice = useAppStore((state) => state.dismissNotice);
  const [reviewing, setReviewing] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (sync.decision !== 'off') void refreshSyncStatus();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sync.decision])
  );

  if (sync.decision === 'off') return null;
  const lines: React.ReactNode[] = [];
  if (sync.blockedReason) lines.push(<Text key="blocked" style={styles.line}>{SYNC_TEXT.blocked}</Text>);
  if (sync.pendingXP > 0) lines.push(<Text key="pending" style={styles.line}>{SYNC_TEXT.xpPending(sync.pendingXP)}</Text>);
  const stale = lastSyncedLine(sync.lastSyncedAt);
  if (stale && sync.linked) lines.push(<Text key="last" style={styles.muted}>{stale}</Text>);
  if (sync.conflicts.length > 0) {
    lines.push(
      <Pressable key="conflicts" onPress={() => setReviewing(true)} accessibilityRole="button">
        <Text style={styles.link}>{SYNC_TEXT.conflictLine(sync.conflicts.length)}</Text>
      </Pressable>
    );
  }
  for (const notice of sync.notices) {
    const text = noticeText(notice);
    if (!text) continue;
    lines.push(
      <Pressable key={`notice-${notice.id}`} onPress={() => dismissNotice(notice.id)} accessibilityRole="button" accessibilityHint="Dismiss">
        <Text style={styles.line}>{text}</Text>
      </Pressable>
    );
  }
  if (lines.length === 0) return null;

  return (
    <GlassCard style={styles.card}>
      <Text style={styles.sectionLabel}>Cloud Save</Text>
      <View style={styles.lines}>{lines}</View>
      <ConflictReviewSheet visible={reviewing} onClose={() => setReviewing(false)} />
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  card: { width: '100%' },
  sectionLabel: { fontFamily: fontFamily.displayRegular, fontSize: fontSize.xs, letterSpacing: 2, color: colors.text.muted, textTransform: 'uppercase' },
  lines: { marginTop: spacing.sm, gap: spacing.sm },
  line: { fontFamily: fontFamily.bodyRegular, fontSize: fontSize.sm, color: colors.text.secondary, lineHeight: 20 },
  muted: { fontFamily: fontFamily.bodyRegular, fontSize: fontSize.sm, color: colors.text.muted },
  link: { fontFamily: fontFamily.bodyRegular, fontSize: fontSize.sm, color: colors.gold, lineHeight: 20 },
});
