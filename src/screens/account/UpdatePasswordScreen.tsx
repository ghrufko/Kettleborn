import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { GlassCard, Button, AppBackground } from '../../components/core';
import { useAppStore } from '../../store';
import { colors, fontFamily, fontSize, spacing } from '../../theme';

const MIN_PASSWORD_LENGTH = 6;

/**
 * Rendered top-level by App.tsx (same pattern as OnboardingScreen) when
 * passwordRecoveryPending is true — reached via the
 * kettleborn://reset-password deep link, not through normal navigation,
 * so this screen takes no navigation props.
 */
export function UpdatePasswordScreen() {
  const authError = useAppStore((state) => state.authError);
  const completePasswordRecovery = useAppStore((state) => state.completePasswordRecovery);
  const cancelPasswordRecovery = useAppStore((state) => state.cancelPasswordRecovery);
  const clearAuthError = useAppStore((state) => state.clearAuthError);

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const handleSubmit = async () => {
    setLocalError(null);
    clearAuthError();
    if (password.length < MIN_PASSWORD_LENGTH) {
      setLocalError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirmPassword) {
      setLocalError('Passwords do not match.');
      return;
    }
    setIsSubmitting(true);
    const result = await completePasswordRecovery(password);
    setIsSubmitting(false);
    setPassword('');
    setConfirmPassword('');
    if (result.ok) {
      setDone(true);
    }
    // On failure, authError is already set by the store — rendered below.
  };

  const displayedError = localError ?? authError?.message ?? null;

  if (done) {
    return (
      <AppBackground style={styles.container}>
        <View style={styles.content}>
          <GlassCard style={styles.card}>
            <Text style={styles.title}>Password Updated</Text>
            <Text style={styles.body}>Your password has been changed. Continue into Kettleborn.</Text>
            <Button label="Continue" onPress={cancelPasswordRecovery} style={styles.submitButton} />
          </GlassCard>
        </View>
      </AppBackground>
    );
  }

  return (
    <AppBackground style={styles.container}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <GlassCard style={styles.card}>
            <Text style={styles.title}>Set a New Password</Text>
            <Text style={[styles.label, styles.labelSpaced]}>New Password</Text>
            <View style={styles.passwordRow}>
              <TextInput
                style={[styles.input, styles.passwordInput]}
                value={password}
                onChangeText={setPassword}
                placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
                placeholderTextColor={colors.text.muted}
                secureTextEntry={!passwordVisible}
                autoCapitalize="none"
                autoCorrect={false}
                textContentType="newPassword"
                accessibilityLabel="New password"
                editable={!isSubmitting}
              />
              <Pressable
                onPress={() => setPasswordVisible((v) => !v)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={passwordVisible ? 'Hide password' : 'Show password'}
              >
                <Ionicons name={passwordVisible ? 'eye-off' : 'eye'} size={20} color={colors.text.muted} />
              </Pressable>
            </View>

            <Text style={[styles.label, styles.labelSpaced]}>Confirm Password</Text>
            <TextInput
              style={styles.input}
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              placeholder="Re-enter password"
              placeholderTextColor={colors.text.muted}
              secureTextEntry={!passwordVisible}
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="newPassword"
              accessibilityLabel="Confirm new password"
              editable={!isSubmitting}
            />

            {displayedError ? <Text style={styles.errorText}>{displayedError}</Text> : null}

            <Button
              label={isSubmitting ? 'Updating…' : 'Update Password'}
              onPress={handleSubmit}
              disabled={isSubmitting}
              style={styles.submitButton}
            />
          </GlassCard>

          <Pressable
            onPress={cancelPasswordRecovery}
            disabled={isSubmitting}
            style={styles.switchLink}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
          >
            <Text style={styles.switchLinkText}>Cancel</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  content: {
    padding: spacing.md,
    gap: spacing.md,
    flexGrow: 1,
    justifyContent: 'center',
  },
  card: {
    width: '100%',
  },
  title: {
    fontFamily: fontFamily.displayBold,
    fontSize: fontSize.lg,
    color: colors.text.primary,
    marginBottom: spacing.sm,
  },
  body: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.base,
    color: colors.text.secondary,
  },
  label: {
    fontFamily: fontFamily.displayRegular,
    fontSize: fontSize.xs,
    letterSpacing: 2,
    color: colors.text.muted,
    textTransform: 'uppercase',
    marginBottom: spacing.xs,
  },
  labelSpaced: {
    marginTop: spacing.md,
  },
  input: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.base,
    color: colors.text.primary,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.hairline,
    paddingBottom: spacing.xs,
    minHeight: 40,
  },
  passwordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  passwordInput: {
    flex: 1,
  },
  errorText: {
    marginTop: spacing.sm,
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.sm,
    color: colors.ember.base,
  },
  submitButton: {
    marginTop: spacing.md,
  },
  switchLink: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  switchLinkText: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.sm,
    color: colors.text.secondary,
  },
});
