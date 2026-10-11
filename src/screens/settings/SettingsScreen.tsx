import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Switch, Pressable } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ForgeStackParamList } from '../../navigation/types';
import { Header, GlassCard, Button, ConfirmDialog } from '../../components/core';
import { useAppStore } from '../../store';
import { colors, fontFamily, fontSize, spacing } from '../../theme';

function AccountSection({ navigation }: { navigation: Props['navigation'] }) {
  const authStatus = useAppStore((state) => state.authStatus);
  const authUser = useAppStore((state) => state.authUser);
  const authError = useAppStore((state) => state.authError);
  const authSignOut = useAppStore((state) => state.authSignOut);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  if (authStatus === 'unavailable') {
    return (
      <GlassCard style={styles.card}>
        <Text style={styles.sectionLabel}>Account</Text>
        <Text style={styles.footnote}>Cloud accounts aren't available in this build.</Text>
      </GlassCard>
    );
  }

  if (authStatus === 'hydrating') {
    // Phase 2.4.3: distinguished from signed_out specifically so a user
    // with a real persisted session doesn't briefly see "Sign In /
    // Create Account" while bootstrap's non-blocking initializeAuth()
    // is still restoring it — session restoration is typically fast,
    // but this card must not claim "signed out" before that's actually
    // known one way or the other.
    return (
      <GlassCard style={styles.card}>
        <Text style={styles.sectionLabel}>Account</Text>
        <Text style={styles.footnote}>Checking account status…</Text>
      </GlassCard>
    );
  }

  if (authStatus === 'signed_in' && authUser) {
    const handleSignOut = async () => {
      setSignOutError(null);
      setIsSigningOut(true);
      const result = await authSignOut();
      setIsSigningOut(false);
      // Does not assume success — a real failure leaves the user signed
      // in (see authSlice.ts) and is reported here, not silently treated
      // as a successful sign-out.
      if (!result.ok) {
        setSignOutError(result.error.message);
      }
    };

    return (
      <GlassCard style={styles.card}>
        <Text style={styles.sectionLabel}>Account</Text>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Signed in as</Text>
          <Text style={styles.accountEmail}>{authUser.email ?? authUser.id}</Text>
        </View>
        <Button
          label={isSigningOut ? 'Signing Out…' : 'Sign Out'}
          variant="secondary"
          onPress={handleSignOut}
          disabled={isSigningOut}
          style={styles.accountButton}
        />
        {signOutError ? <Text style={styles.resetError}>{signOutError}</Text> : null}
      </GlassCard>
    );
  }

  // signed_out / signing_in / signing_up / signing_out: local training is
  // fully available regardless — this card never blocks it, it only
  // offers the optional cloud entry point.
  return (
    <GlassCard style={styles.card}>
      <Text style={styles.sectionLabel}>Account</Text>
      <Text style={styles.footnote}>
        Sign in to start tracking leaderboard results. Your local training works the same either way.
      </Text>
      {authError ? <Text style={styles.resetError}>{authError.message}</Text> : null}
      <Button label="Sign In" onPress={() => navigation.navigate('SignIn')} style={styles.accountButton} />
      <Button
        label="Create Account"
        variant="secondary"
        onPress={() => navigation.navigate('CreateAccount')}
        style={styles.accountButton}
      />
    </GlassCard>
  );
}

type Props = NativeStackScreenProps<ForgeStackParamList, 'Settings'>;

function ToggleRow({
  label,
  value,
  onValueChange,
}: {
  label: string;
  value: boolean;
  onValueChange: (next: boolean) => void;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: colors.charcoal.raised, true: colors.bronze.base }}
        thumbColor={colors.text.primary}
      />
    </View>
  );
}

export function SettingsScreen({ navigation }: Props) {
  const settings = useAppStore((state) => state.settings);
  const updateSettings = useAppStore((state) => state.updateSettings);
  const resetCampaignProgress = useAppStore((state) => state.resetCampaignProgress);
  const [isResetting, setIsResetting] = useState(false);
  const [resetDialogVisible, setResetDialogVisible] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  const confirmResetCampaign = () => {
    setResetError(null);
    setResetDialogVisible(true);
  };

  const handleResetCampaign = async () => {
    setResetDialogVisible(false);
    setIsResetting(true);
    try {
      await resetCampaignProgress();
    } catch {
      setResetError('Campaign progress could not be reset. Please try again.');
    } finally {
      setIsResetting(false);
    }
  };

  if (!settings) {
    return (
      <View style={styles.container}>
        <Header title="Settings" onBack={() => navigation.goBack()} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Header title="Settings" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.content}>
        <AccountSection navigation={navigation} />

        <GlassCard style={styles.card}>
          <Text style={styles.sectionLabel}>Units</Text>
          <View style={styles.unitRow}>
            {(['kg', 'lb'] as const).map((unit) => (
              <Pressable
                key={unit}
                onPress={() => updateSettings({ unitPreference: unit })}
                style={[
                  styles.unitOption,
                  settings.unitPreference === unit && styles.unitOptionActive,
                ]}
              >
                <Text
                  style={[
                    styles.unitOptionText,
                    settings.unitPreference === unit && styles.unitOptionTextActive,
                  ]}
                >
                  {unit.toUpperCase()}
                </Text>
              </Pressable>
            ))}
          </View>
        </GlassCard>

        <GlassCard style={styles.card}>
          <Text style={styles.sectionLabel}>Timer</Text>
          <ToggleRow
            label="Sounds"
            value={settings.soundEnabled}
            onValueChange={(value) => updateSettings({ soundEnabled: value })}
          />
          <ToggleRow
            label="Vibration"
            value={settings.hapticsEnabled}
            onValueChange={(value) => updateSettings({ hapticsEnabled: value })}
          />
        </GlassCard>

        <GlassCard style={styles.card}>
          <Text style={styles.sectionLabel}>Display</Text>
          <ToggleRow
            label="Keep Screen Awake"
            value={settings.keepScreenAwake}
            onValueChange={(value) => updateSettings({ keepScreenAwake: value })}
          />
        </GlassCard>

        <Text style={styles.footnote}>
          Sound and vibration apply to both Hunts and the Timer. Keep Screen Awake applies while a
          Hunt or Timer is actively running.
        </Text>

        <GlassCard style={styles.card}>
          <Text style={styles.sectionLabel}>Danger Zone</Text>
          <Button
            label={isResetting ? 'Resetting…' : 'Reset Campaign Progress'}
            variant="destructive"
            onPress={confirmResetCampaign}
            disabled={isResetting}
          />
          <Text style={styles.dangerCaption}>
            Erases campaign progress, defeated/unlocked monster state, and Personal Best records.
            Your app settings and equipment are kept.
          </Text>
          {resetError ? <Text style={styles.resetError}>{resetError}</Text> : null}
        </GlassCard>
      </ScrollView>
      <ConfirmDialog
        visible={resetDialogVisible}
        title="Reset Campaign Progress?"
        message="This will erase your campaign progress and Personal Best records, and start Campaign I over as a new player. This cannot be undone."
        cancelLabel="Cancel"
        confirmLabel="Reset"
        confirmDisabled={isResetting}
        onCancel={() => setResetDialogVisible(false)}
        onConfirm={handleResetCampaign}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.void.base,
  },
  content: {
    padding: spacing.md,
    // Bottom-nav clearance fix — see MonsterDetailScreen.tsx's identical
    // comment; same spacing.xxl convention every tab-bar-visible
    // scrollable screen now uses.
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
  card: {
    width: '100%',
  },
  sectionLabel: {
    fontFamily: fontFamily.displayRegular,
    fontSize: fontSize.xs,
    letterSpacing: 2,
    color: colors.text.muted,
    textTransform: 'uppercase',
    marginBottom: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  rowLabel: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.base,
    color: colors.text.primary,
  },
  unitRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  unitOption: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border.hairlineStrong,
  },
  unitOptionActive: {
    backgroundColor: colors.bronze.base,
    borderColor: colors.bronze.base,
  },
  unitOptionText: {
    fontFamily: fontFamily.monoBold,
    fontSize: fontSize.base,
    color: colors.text.secondary,
  },
  unitOptionTextActive: {
    color: colors.text.onBronze,
  },
  footnote: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.sm,
    color: colors.text.muted,
    textAlign: 'center',
    paddingHorizontal: spacing.md,
  },
  dangerCaption: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.sm,
    color: colors.text.muted,
    marginTop: spacing.sm,
  },
  resetError: {
    marginTop: spacing.sm,
    color: colors.ember.base,
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.sm,
  },
  accountButton: {
    marginTop: spacing.sm,
  },
  accountEmail: {
    fontFamily: fontFamily.monoBold,
    fontSize: fontSize.sm,
    color: colors.text.primary,
  },
});
