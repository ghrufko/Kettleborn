import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, GlassCard } from '../../components/core';
import { useAppStore } from '../../store';
import { colors, fontFamily, fontSize, spacing } from '../../theme';

/**
 * Shows the store's authNotice (an email link that expired or couldn't be
 * used, a confirmation that just signed the player in, a sign-in this
 * device couldn't save). Rendered once at App.tsx's top level so it works
 * whichever screen — or error screen — is showing. Single-button sibling
 * of components/core/ConfirmDialog, built from the same Modal, GlassCard,
 * Button and theme tokens so it introduces no new visual style.
 */
export function AuthNoticeDialog() {
  const notice = useAppStore((state) => state.authNotice);
  const dismiss = useAppStore((state) => state.dismissAuthNotice);

  return (
    <Modal visible={notice !== null} transparent animationType="fade" onRequestClose={dismiss}>
      <View style={styles.overlay}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={dismiss}
          accessibilityRole="button"
          accessibilityLabel="Close message"
        />
        {notice ? (
          <GlassCard style={styles.dialog}>
            <Text style={styles.title}>{notice.title}</Text>
            <Text style={styles.message}>{notice.message}</Text>
            <Button label="OK" onPress={dismiss} style={styles.button} />
          </GlassCard>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
  },
  dialog: {
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
    padding: spacing.lg,
  },
  title: {
    fontFamily: fontFamily.displayBold,
    fontSize: fontSize.lg,
    color: colors.text.primary,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  message: {
    marginTop: spacing.sm,
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.base,
    color: colors.text.secondary,
    lineHeight: 22,
  },
  button: {
    width: '100%',
    marginTop: spacing.lg,
  },
});
