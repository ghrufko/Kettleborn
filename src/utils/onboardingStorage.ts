import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Sprint 17 needs a "has the player seen onboarding" flag that survives
 * app restarts but must never touch the SQLite schema (no migrations this
 * sprint). AsyncStorage is the standard, minimal tool for exactly this —
 * a single device-local UI flag, not gameplay data. Everything that IS
 * gameplay data stays in SQLite via the existing repositories; this file
 * is the one intentional exception, and it's read/written nowhere else.
 */
const ONBOARDING_COMPLETE_KEY = 'kettleborn:onboarding-complete';

export async function hasCompletedOnboarding(): Promise<boolean> {
  try {
    const value = await AsyncStorage.getItem(ONBOARDING_COMPLETE_KEY);
    return value === 'true';
  } catch {
    // If storage is unavailable for any reason, default to showing
    // onboarding rather than crashing the app on launch.
    return false;
  }
}

export async function markOnboardingComplete(): Promise<void> {
  try {
    await AsyncStorage.setItem(ONBOARDING_COMPLETE_KEY, 'true');
  } catch {
    // Best-effort — if this fails, onboarding just shows again next
    // launch, which is annoying but never breaks the app.
  }
}
