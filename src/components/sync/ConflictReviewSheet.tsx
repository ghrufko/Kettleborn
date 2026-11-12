import React from 'react';
import { Modal, View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { GlassCard, Button } from '../core';
import { useAppStore } from '../../store';
import { SYNC_TEXT, conflictChoices, conflictTitle } from '../../services/sync/syncMessages';
import { colors, fontFamily, fontSize, spacing } from '../../theme';

function describe(value: any, field: string | null): string {
  if (field === 'notes') return value?.value ? String(value.value) : '(empty)';
  if (field === 'rpe') return value?.value === null || value?.value === undefined ? '(none)' : String(value.value);
  if (field === null && value?.deleted_at) return 'Deleted';
  if (!value || typeof value !== 'object') return '—';
  if ('value' in value) return String(value.value ?? '');
  if (value.weight !== undefined) return `${value.weight} ${value.unit ?? 'kg'}${value.label ? ` · ${value.label}` : ''}`;
  if (value.unit_preference) return String(value.unit_preference).toUpperCase();
  return value.name ?? value.label ?? 'Changed';
}

/**
 * Cloud Save D9 — the one review sheet: each conflict with both versions
 * and the two approved choices. Nothing is resolved without a choice.
 */
export function ConflictReviewSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const conflicts = useAppStore((state) => state.sync.conflicts);
  const resolveConflict = useAppStore((state) => state.resolveConflict);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close review" />
        <GlassCard style={styles.sheet}>
          <Text style={styles.title}>Review changes</Text>
          <ScrollView style={styles.list}>
            {conflicts.length === 0 ? <Text style={styles.body}>Nothing to review.</Text> : null}
            {conflicts.map((conflict) => {
              const choices = conflictChoices(conflict);
              return (
                <View key={conflict.conflictUuid} style={styles.item}>
                  <Text style={styles.itemTitle}>{conflictTitle(conflict)}</Text>
                  <Text style={styles.label}>Other device</Text>
                  <Text style={styles.body}>{describe(conflict.serverValue, conflict.field)}</Text>
                  <Text style={styles.label}>This device</Text>
                  <Text style={styles.body}>{describe(conflict.localValue, conflict.field)}</Text>
                  <View style={styles.actions}>
                    <View style={styles.action}>
                      <Button label={choices.keepServer} variant="secondary" onPress={() => resolveConflict(conflict.conflictUuid, 'keep_server')} />
                    </View>
                    <View style={styles.action}>
                      <Button label={choices.useLocal} variant="primary" onPress={() => resolveConflict(conflict.conflictUuid, 'use_local')} />
                    </View>
                  </View>
                </View>
              );
            })}
          </ScrollView>
          <Button label="Close" variant="secondary" onPress={onClose} style={styles.close} />
        </GlassCard>
      </View>
    </Modal>
  );
}

export const CONFLICT_LINE = SYNC_TEXT.conflictLine;

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'center', padding: spacing.lg, backgroundColor: 'rgba(0, 0, 0, 0.72)' },
  sheet: { width: '100%', maxWidth: 480, maxHeight: '85%', alignSelf: 'center', padding: spacing.lg },
  title: { fontFamily: fontFamily.displayBold, fontSize: fontSize.lg, color: colors.text.primary, textTransform: 'uppercase', letterSpacing: 1 },
  list: { marginTop: spacing.md },
  item: { marginBottom: spacing.lg },
  itemTitle: { fontFamily: fontFamily.bodyBold ?? fontFamily.bodyRegular, fontSize: fontSize.base, color: colors.text.primary },
  label: { marginTop: spacing.sm, fontFamily: fontFamily.displayRegular, fontSize: fontSize.xs, letterSpacing: 2, color: colors.text.muted, textTransform: 'uppercase' },
  body: { fontFamily: fontFamily.bodyRegular, fontSize: fontSize.base, color: colors.text.secondary, lineHeight: 22 },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  action: { flex: 1 },
  close: { marginTop: spacing.md },
});
