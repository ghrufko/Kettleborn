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
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ForgeStackParamList } from '../../navigation/types';
import { Header, GlassCard, Button, AppBackground } from '../../components/core';
import { useAppStore } from '../../store';
import { resendConfirmation } from '../../services/supabase';
import { colors, fontFamily, fontSize, spacing } from '../../theme';

type Props = NativeStackScreenProps<ForgeStackParamList, 'CreateAccount'>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Supabase's own default minimum (Auth settings, "Minimum password
// length") is 6 — this mirrors that default. If a real project changes
// it, this client-side check only ever adds a stricter local hint; the
// server is still the actual source of truth (see AuthErrorReason
// 'weak_password' in auth.ts for what happens when the server disagrees).
const MIN_PASSWORD_LENGTH = 6;

export function CreateAccountScreen({ navigation }: Props) {
  const authStatus = useAppStore((state) => state.authStatus);
  const authError = useAppStore((state) => state.authError);
  const authSignUp = useAppStore((state) => state.authSignUp);
  const clearAuthError = useAppStore((state) => state.clearAuthError);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [confirmationNeeded, setConfirmationNeeded] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const [resendError, setResendError] = useState<string | null>(null);

  const isSubmitting = authStatus === 'signing_up';

  const handleResend = async () => {
    setResendMessage(null);
    setResendError(null);
    setIsResending(true);
    const result = await resendConfirmation(email.trim());
    setIsResending(false);
    if (result.ok) {
      // Supabase does not reveal whether a signup is pending for this
      // address, so this only claims the request was accepted.
      setResendMessage('If a confirmation is pending for this email, a new link is on its way.');
    } else {
      setResendError(result.error.message);
    }
  };

  const handleSubmit = async () => {
    setLocalError(null);
    clearAuthError();
    const trimmedEmail = email.trim();
    if (!EMAIL_PATTERN.test(trimmedEmail)) {
      setLocalError('Enter a valid email address.');
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setLocalError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirmPassword) {
      setLocalError('Passwords do not match.');
      return;
    }
    const result = await authSignUp(trimmedEmail, password);
    setPassword('');
    setConfirmPassword('');
    if (!result.ok) {
      // authError already set by the store — rendered below.
      return;
    }
    if (result.data.emailConfirmationRequired) {
      // No false assumption of an authenticated session — or of a new
      // account: with email confirmation on, Supabase returns this same
      // response for an address that is already registered (by design,
      // to prevent account enumeration), so the screen below is worded
      // to be true either way.
      setConfirmationNeeded(true);
      return;
    }
    navigation.goBack();
  };

  const displayedError = localError ?? authError?.message ?? null;

  if (confirmationNeeded) {
    return (
      <AppBackground style={styles.container}>
        <Header title="Create Account" onBack={() => navigation.goBack()} />
        <View style={styles.content}>
          <GlassCard style={styles.card}>
            <Text style={styles.confirmTitle}>Check your email</Text>
            <Text style={styles.confirmBody}>
              If {email.trim()} can be registered, a confirmation link is on its way. Open it on this
              device to finish signing in.
            </Text>
            <Text style={[styles.confirmBody, styles.confirmNote]}>
              Already have an account with this email? Sign in instead, or use Forgot password? on the
              Sign In screen.
            </Text>
            {resendError ? <Text style={styles.errorText}>{resendError}</Text> : null}
            {resendMessage ? <Text style={styles.confirmNote}>{resendMessage}</Text> : null}
            <Button label="Done" onPress={() => navigation.goBack()} style={styles.submitButton} />
          </GlassCard>
          <Pressable
            onPress={handleResend}
            disabled={isResending}
            style={styles.switchLink}
            accessibilityRole="button"
            accessibilityLabel="Resend confirmation email"
          >
            <Text style={styles.switchLinkText}>
              {isResending ? 'Sending…' : "Didn't get it? Resend confirmation email"}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => navigation.navigate('SignIn')}
            style={styles.switchLink}
            accessibilityRole="button"
            accessibilityLabel="Sign in to an existing account"
          >
            <Text style={styles.switchLinkText}>Already have an account? Sign in</Text>
          </Pressable>
        </View>
      </AppBackground>
    );
  }

  return (
    <AppBackground style={styles.container}>
      <Header title="Create Account" onBack={() => navigation.goBack()} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <GlassCard style={styles.card}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor={colors.text.muted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
              accessibilityLabel="Email"
              editable={!isSubmitting}
            />

            <Text style={[styles.label, styles.labelSpaced]}>Password</Text>
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
                accessibilityLabel="Password"
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
              accessibilityLabel="Confirm password"
              editable={!isSubmitting}
            />

            {displayedError ? <Text style={styles.errorText}>{displayedError}</Text> : null}

            <Button
              label={isSubmitting ? 'Creating Account…' : 'Create Account'}
              onPress={handleSubmit}
              disabled={isSubmitting}
              style={styles.submitButton}
            />
          </GlassCard>

          <Pressable
            onPress={() => navigation.navigate('SignIn')}
            disabled={isSubmitting}
            style={styles.switchLink}
            accessibilityRole="button"
            accessibilityLabel="Sign in to an existing account"
          >
            <Text style={styles.switchLinkText}>Already have an account? Sign in</Text>
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
  },
  card: {
    width: '100%',
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
  confirmTitle: {
    fontFamily: fontFamily.displayBold,
    fontSize: fontSize.lg,
    color: colors.text.primary,
    marginBottom: spacing.sm,
  },
  confirmBody: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.base,
    color: colors.text.secondary,
  },
  confirmNote: {
    marginTop: spacing.sm,
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.sm,
    color: colors.text.secondary,
  },
});
