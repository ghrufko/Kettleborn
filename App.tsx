import React, { useCallback, useEffect, useState } from 'react';
import { View, Linking } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { NavigationContainer, DarkTheme, Theme as NavigationTheme } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  useFonts as useCinzelFonts,
  Cinzel_400Regular,
  Cinzel_700Bold,
} from '@expo-google-fonts/cinzel';
import {
  useFonts as useCormorantFonts,
  Cormorant_400Regular,
  Cormorant_600SemiBold,
  Cormorant_700Bold,
} from '@expo-google-fonts/cormorant';
import {
  useFonts as useMonoFonts,
  JetBrainsMono_400Regular,
  JetBrainsMono_700Bold,
} from '@expo-google-fonts/jetbrains-mono';
import { RootNavigator } from './src/navigation/RootNavigator';
import { ErrorScreen } from './src/screens/shared/ErrorScreen';
import { OnboardingScreen } from './src/screens/onboarding/OnboardingScreen';
import { UpdatePasswordScreen } from './src/screens/account/UpdatePasswordScreen';
import { hasCompletedOnboarding, markOnboardingComplete } from './src/utils/onboardingStorage';
import { colors } from './src/theme';
import { bootstrapApp } from './src/store/bootstrap';
import { useAppStore } from './src/store';
import { extractResetPasswordCode } from './src/utils/resetPasswordLink';
import { extractEmailConfirmationCode } from './src/utils/emailConfirmationLink';

SplashScreen.preventAutoHideAsync().catch(() => {
  // Splash was already hidden or preventAutoHideAsync isn't supported
  // on this platform — safe to ignore, the app still renders correctly.
});

const navigationTheme: NavigationTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.void.base,
    card: colors.void.surface,
    text: colors.text.primary,
    border: colors.border.hairline,
    primary: colors.bronze.base,
  },
};

export default function App() {
  const [cinzelLoaded] = useCinzelFonts({ Cinzel_400Regular, Cinzel_700Bold });
  const [cormorantLoaded] = useCormorantFonts({
    Cormorant_400Regular,
    Cormorant_600SemiBold,
    Cormorant_700Bold,
  });
  const [monoLoaded] = useMonoFonts({ JetBrainsMono_400Regular, JetBrainsMono_700Bold });
  const fontsReady = cinzelLoaded && cormorantLoaded && monoLoaded;

  const [appReady, setAppReady] = useState(false);
  const [bootstrapError, setBootstrapError] = useState<Error | null>(null);
  const [showOnboarding, setShowOnboarding] = useState<boolean | null>(null);
  const passwordRecoveryPending = useAppStore((state) => state.passwordRecoveryPending);

  // Phase 2.4: handles the kettleborn://reset-password?code=... deep link
  // the password-reset email redirects to. Covers both cold start
  // (getInitialURL, app wasn't running) and warm start (the 'url' event,
  // app was already running in the background) — independent of
  // bootstrap/onboarding state, since the store's initializeAuth() call
  // in bootstrap.ts is what actually makes the Supabase client available
  // for this to call into; this effect only reacts to the incoming URL,
  // it doesn't gate on bootstrap having finished (handlePasswordRecoveryLink
  // itself safely no-ops via 'not_configured' if Supabase isn't ready).
  //
  // Email-confirmation fix: also handles the
  // kettleborn://confirm-email?code=... link signUp()'s emailRedirectTo
  // now points to. extractResetPasswordCode/extractEmailConfirmationCode
  // each gate on their own distinct path segment, so a given URL only
  // ever matches one of them — never both, never neither for a link this
  // app actually sent.
  useEffect(() => {
    const handleUrl = (url: string) => {
      const resetCode = extractResetPasswordCode(url);
      if (resetCode) {
        useAppStore.getState().handlePasswordRecoveryLink(resetCode);
        return;
      }
      const confirmationCode = extractEmailConfirmationCode(url);
      if (confirmationCode) {
        useAppStore.getState().handleEmailConfirmationLink(confirmationCode);
      }
    };
    Linking.getInitialURL().then((url) => {
      if (url) {
        handleUrl(url);
      }
    });
    const subscription = Linking.addEventListener('url', ({ url }) => handleUrl(url));
    return () => subscription.remove();
  }, []);

  const runBootstrap = useCallback(() => {
    setBootstrapError(null);
    bootstrapApp()
      .then(() => setAppReady(true))
      .catch((error: Error) => setBootstrapError(error));
  }, []);

  useEffect(() => {
    // App Launch sequence: Load SQLite → Initialize Zustand → Load Content → Display Hunt Screen.
    // Runs once, independent of font loading, so both can proceed in parallel.
    runBootstrap();
    hasCompletedOnboarding().then((seen) => setShowOnboarding(!seen));
  }, [runBootstrap]);

  const ready = fontsReady && appReady && showOnboarding !== null;

  useEffect(() => {
    if (ready || bootstrapError) {
      SplashScreen.hideAsync().catch(() => undefined);
    }
  }, [ready, bootstrapError]);

  const onLayoutRootView = useCallback(async () => {
    if (ready || bootstrapError) {
      await SplashScreen.hideAsync().catch(() => undefined);
    }
  }, [ready, bootstrapError]);

  if (bootstrapError) {
    return (
      <SafeAreaProvider>
        <View style={{ flex: 1, backgroundColor: colors.void.base }} onLayout={onLayoutRootView}>
          <StatusBar style="light" />
          <ErrorScreen onRetry={runBootstrap} />
        </View>
      </SafeAreaProvider>
    );
  }

  if (!ready) {
    return null;
  }

  return (
    <SafeAreaProvider>
      <View style={{ flex: 1, backgroundColor: colors.void.base }} onLayout={onLayoutRootView}>
        <StatusBar style="light" />
        {passwordRecoveryPending ? (
          <UpdatePasswordScreen />
        ) : showOnboarding ? (
          <OnboardingScreen
            onDone={() => {
              setShowOnboarding(false);
              markOnboardingComplete();
            }}
          />
        ) : (
          <NavigationContainer theme={navigationTheme}>
            <RootNavigator />
          </NavigationContainer>
        )}
      </View>
    </SafeAreaProvider>
  );
}
