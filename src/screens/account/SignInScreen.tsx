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
import { requestPasswordReset } from '../../services/supabase';
import { colors, fontFamily, fontSize, spacing } from '../../theme';

type Props = NativeStackScreenProps<ForgeStackParamList, 'SignIn'>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function SignInScreen({ navigation }: Props) {
  const authStatus = useAppStore((state) => state.authStatus);
  const authError = useAppStore((state) => state.authError);
  const authSignIn = useAppStore((state) => state.authSignIn);
  const clearAuthError = useAppStore((state) => state.clearAuthError);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [resetMessage, setResetMessage] = useState<string | null>(null);

  const isSubmitting = authStatus === 'signing_in';

  const handleSubmit = async () => {
    setLocalError(null);
    setResetMessage(null);
    clearAuthError();
    const trimmedEmail = email.trim();
    if (!EMAIL_PATTERN.test(trimmedEmail)) {
      setLocalError('Enter a valid email address.');
      return;
    }
    if (password.length === 0) {
      setLocalError('Enter your password.');
      return;
    }
    const result = await authSignIn(trimmedEmail, password);
    if (result.ok) {
      // Clear the password out of local component state immediately on
      // success — nothing in this screen holds onto it beyond this point.
      setPassword('');
      navigation.goBack();
    }
    // On failure, authError is already set by the store (see authSlice.ts)
    // and rendered below — no separate local copy needed.
  };

  const handleForgotPassword = async () => {
    setLocalError(null);
    setResetMessage(null);
    const trimmedEmail = email.trim();
    if (!EMAIL_PATTERN.test(trimmedEmail)) {
      setLocalError('Enter your email above first.');
      return;
    }
    const result = await requestPasswordReset(trimmedEmail);
    if (result.ok) {
      setResetMessage('If an account exists for this email, a reset link has been sent.');
    } else {
      setLocalError(result.error.message);
    }
  };

  const displayedError = localError ?? authError?.message ?? null;

  return (
    <AppBackground style={styles.container}>
      <Header title="Sign In" onBack={() => navigation.goBack()} />
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
                placeholder="Password"
                placeholderTextColor={colors.text.muted}
                secureTextEntry={!passwordVisible}
                autoCapitalize="none"
                autoCorrect={false}
                textContentType="password"
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

            <Pressable
              onPress={handleForgotPassword}
              disabled={isSubmitting}
              style={styles.forgotLink}
              accessibilityRole="button"
              accessibilityLabel="Forgot password"
            >
              <Text style={styles.forgotLinkText}>Forgot password?</Text>
            </Pressable>

            {displayedError ? <Text style={styles.errorText}>{displayedError}</Text> : null}
            {resetMessage ? <Text style={styles.successText}>{resetMessage}</Text> : null}

            <Button
              label={isSubmitting ? 'Signing In…' : 'Sign In'}
              onPress={handleSubmit}
              disabled={isSubmitting}
              style={styles.submitButton}
            />
          </GlassCard>

          <Pressable
            onPress={() => navigation.navigate('CreateAccount')}
            disabled={isSubmitting}
            style={styles.switchLink}
            accessibilityRole="button"
            accessibilityLabel="Create an account"
          >
            <Text style={styles.switchLinkText}>Need an account? Create one</Text>
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
  forgotLink: {
    marginTop: spacing.sm,
    alignSelf: 'flex-end',
  },
  forgotLinkText: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.sm,
    color: colors.bronze.active,
  },
  errorText: {
    marginTop: spacing.sm,
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.sm,
    color: colors.ember.base,
  },
  successText: {
    marginTop: spacing.sm,
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.sm,
    color: colors.text.secondary,
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
