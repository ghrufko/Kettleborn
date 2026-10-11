export { getSupabaseClient, isSupabaseConfigured, getSupabaseConfigState } from './client';
export type { SupabaseConfigState, SupabaseConfigInvalidReason, Database } from './client';

export {
  signUp,
  signIn,
  signOut,
  getSession,
  onAuthStateChange,
  isAuthAvailable,
  requestPasswordReset,
  exchangeCodeForSession,
  updatePassword,
} from './auth';
export type {
  AuthErrorReason,
  AuthFailure,
  AuthResult,
  AppAuthUser,
  SignUpResult,
  AuthChangeEvent,
  AuthChangeListener,
  Unsubscribe,
} from './auth';

export { getLeaderboard, getMyLeaderboardEntry } from './leaderboard';
export type {
  LeaderboardErrorReason,
  LeaderboardFailure,
  LeaderboardResult,
  LeaderboardEntry,
  MyLeaderboardEntry,
} from './leaderboard';
