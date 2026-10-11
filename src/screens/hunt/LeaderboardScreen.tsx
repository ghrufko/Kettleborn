import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, FlatList, RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { HuntStackParamList } from '../../navigation/types';
import { Header, GlassCard, Button, AppBackground } from '../../components/core';
import { contentEngine } from '../../../engines/content';
import { useAppStore } from '../../store';
import { getLeaderboard, LeaderboardEntry, LeaderboardFailure } from '../../services/supabase';
import { colors, fontFamily, fontSize, spacing } from '../../theme';

type Props = NativeStackScreenProps<HuntStackParamList, 'Leaderboard'>;

function formatElapsed(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

type LoadState =
  | { phase: 'loading' }
  | { phase: 'loaded'; entries: LeaderboardEntry[] }
  | { phase: 'error'; error: LeaderboardFailure };

export function LeaderboardScreen({ route, navigation }: Props) {
  const { workoutId, monsterId } = route.params;
  const authStatus = useAppStore((state) => state.authStatus);
  const [state, setState] = useState<LoadState>({ phase: 'loading' });
  const [refreshing, setRefreshing] = useState(false);

  const workout = contentEngine.getWorkout(workoutId);
  const monster = contentEngine.getMonster(monsterId);

  const load = useCallback(async () => {
    const result = await getLeaderboard(workoutId);
    if (result.ok) {
      setState({ phase: 'loaded', entries: result.data });
    } else {
      setState({ phase: 'error', error: result.error });
    }
  }, [workoutId]);

  useFocusEffect(
    useCallback(() => {
      setState({ phase: 'loading' });
      load();
    }, [load])
  );

  // Phase 2.4.3: bootstrap's session restoration (initializeAuth) is
  // deliberately non-blocking, so a user with a real persisted session
  // can land on this screen before it finishes — the first fetch above
  // would then correctly-but-misleadingly see auth_required (no session
  // attached yet), and nothing would re-fetch afterward without this.
  // Edge-triggered on the *transition* into signed_in (via the ref),
  // not on every render/state change — fires at most once per
  // transition, so a persistent server-side auth_required (should one
  // ever occur despite authStatus saying signed_in) cannot retry-loop.
  const prevAuthStatusRef = useRef(authStatus);
  useEffect(() => {
    const prevStatus = prevAuthStatusRef.current;
    prevAuthStatusRef.current = authStatus;
    if (
      prevStatus !== 'signed_in' &&
      authStatus === 'signed_in' &&
      state.phase === 'error' &&
      state.error.reason === 'auth_required'
    ) {
      load();
    }
    // Deliberately omits `state` from deps — this must react only to
    // authStatus transitioning, not to the load it itself triggers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authStatus]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const renderBody = () => {
    if (authStatus === 'unavailable') {
      return (
        <GlassCard style={styles.card}>
          <Text style={styles.message}>Leaderboards aren't available in this build.</Text>
        </GlassCard>
      );
    }

    if (state.phase === 'loading') {
      return (
        <GlassCard style={styles.card}>
          <Text style={styles.message}>Loading leaderboard…</Text>
        </GlassCard>
      );
    }

    if (state.phase === 'error') {
      // auth_required is distinct from a genuine network/unknown failure
      // — see leaderboard.ts's header comment: this table's RLS makes any
      // permission error mean "not signed in," never "wrong user."
      if (state.error.reason === 'auth_required') {
        return (
          <GlassCard style={styles.card}>
            <Text style={styles.message}>{state.error.message}</Text>
            <Text style={styles.hint}>Sign in from Forge → Settings → Account, then come back.</Text>
          </GlassCard>
        );
      }
      return (
        <GlassCard style={styles.card}>
          <Text style={styles.message}>{state.error.message}</Text>
          <Button label="Retry" onPress={load} style={styles.retryButton} />
        </GlassCard>
      );
    }

    if (state.entries.length === 0) {
      return (
        <GlassCard style={styles.card}>
          <Text style={styles.message}>No times recorded for this Hunt yet. Be the first.</Text>
        </GlassCard>
      );
    }

    return (
      <FlatList
        data={state.entries}
        keyExtractor={(entry) => entry.userId}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.bronze.base} />}
        renderItem={({ item }) => (
          <View style={styles.entryRow}>
            <Text style={styles.position}>{item.position}</Text>
            <Text style={styles.displayName} numberOfLines={1}>
              {item.displayName}
            </Text>
            <Text style={styles.grade}>{item.grade}</Text>
            <Text style={styles.time}>{formatElapsed(item.elapsedSeconds)}</Text>
          </View>
        )}
      />
    );
  };

  return (
    <AppBackground style={styles.container}>
      <Header title="Leaderboard" onBack={() => navigation.goBack()} />
      <View style={styles.subheaderWrap}>
        <Text style={styles.subheader}>
          {monster?.name ?? 'Unknown'} · {workout?.name ?? workoutId}
        </Text>
      </View>
      {renderBody()}
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  subheaderWrap: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  subheader: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.sm,
    color: colors.text.muted,
    textAlign: 'center',
  },
  card: {
    margin: spacing.md,
  },
  message: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.base,
    color: colors.text.secondary,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: spacing.md,
  },
  hint: {
    marginTop: spacing.sm,
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.sm,
    color: colors.text.muted,
    textAlign: 'center',
  },
  listContent: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xl,
    gap: spacing.xs,
  },
  entryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.hairline,
  },
  position: {
    width: 28,
    fontFamily: fontFamily.monoBold,
    fontSize: fontSize.sm,
    color: colors.text.muted,
  },
  displayName: {
    flex: 1,
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.base,
    color: colors.text.primary,
  },
  grade: {
    width: 24,
    textAlign: 'center',
    fontFamily: fontFamily.displayBold,
    fontSize: fontSize.sm,
    color: colors.gold,
  },
  time: {
    width: 56,
    textAlign: 'right',
    fontFamily: fontFamily.monoBold,
    fontSize: fontSize.sm,
    color: colors.text.secondary,
  },
});
