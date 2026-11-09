import React, { useCallback, useEffect, useState } from 'react';
import { View, Linking, Platform } from 'react-native';
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
import { AuthNoticeDialog } from './src/screens/account/AuthNoticeDialog';
import { hasCompletedOnboarding, markOnboardingComplete } from './src/utils/onboardingStorage';
import { colors } from './src/theme';
import { bootstrapApp } from './src/store/bootstrap';
import { useAppStore } from './src/store';

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

  // Native auth email links: kettleborn://reset-password?code=... and
  // kettleborn://confirm-email?code=... (PKCE), or an error redirect such
  // as kettleborn://reset-password#error_code=otp_expired&... Covers cold
  // start (getInitialURL) and warm start (the 'url' event). All parsing,
  // de-duplication and ordering against session restoration live in
  // handleAuthCallbackUrl (authSlice.ts) — independent of SQLite
  // bootstrap and onboarding state.
  //
  // Not on web: there the "deep link" is the page URL itself, which
  // supabase-js consumes during client initialization (detectSessionInUrl)
  // and initializeAuth finishes — running this handler too would race it.
  useEffect(() => {
    if (Platform.OS === 'web') {
      return undefined;
    }
    const handleUrl = (url: string | null) => {
      if (url) {
        useAppStore.getState().handleAuthCallbackUrl(url).catch(() => undefined);
      }
    };
    Linking.getInitialURL().then(handleUrl).catch(() => undefined);
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

  const recoveryVisible = passwordRecoveryPending && fontsReady;

  useEffect(() => {
    if (ready || bootstrapError || recoveryVisible) {
      SplashScreen.hideAsync().catch(() => undefined);
    }
  }, [ready, bootstrapError, recoveryVisible]);

  const onLayoutRootView = useCallback(async () => {
    if (ready || bootstrapError || recoveryVisible) {
      await SplashScreen.hideAsync().catch(() => undefined);
    }
  }, [ready, bootstrapError, recoveryVisible]);

  // A password-reset link must be completable even when the local
  // database failed to open (auth no longer depends on it — see
  // bootstrap.ts): the recovery screen takes priority over the error
  // screen, and only needs fonts, not bootstrap.
  if (recoveryVisible) {
    return (
      <SafeAreaProvider>
        <View style={{ flex: 1, backgroundColor: colors.void.base }} onLayout={onLayoutRootView}>
          <StatusBar style="light" />
          <UpdatePasswordScreen />
          <AuthNoticeDialog />
        </View>
      </SafeAreaProvider>
    );
  }

  if (bootstrapError) {
    return (
      <SafeAreaProvider>
        <View style={{ flex: 1, backgroundColor: colors.void.base }} onLayout={onLayoutRootView}>
          <StatusBar style="light" />
          <ErrorScreen onRetry={runBootstrap} />
          <AuthNoticeDialog />
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
        <AuthNoticeDialog />
        {showOnboarding ? (
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
