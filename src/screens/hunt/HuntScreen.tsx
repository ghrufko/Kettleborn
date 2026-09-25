import React from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Image } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { HuntStackParamList } from '../../navigation/types';
import { Header, GlassCard } from '../../components/core';
import { ProgressBar } from '../../components/progress';
import { contentEngine } from '../../../engines/content';
import { getCampaignState, isCampaignComplete } from '../../utils/campaignState';
import { getTerritoryArt, TERRITORY_ACCENT } from '../../constants/territoryArt';
import { useAppStore } from '../../store';
import { colors, fontFamily, fontSize, spacing } from '../../theme';

type Props = NativeStackScreenProps<HuntStackParamList, 'Hunt'>;

const STATE_LABEL: Record<string, string> = {
  completed: 'Completed',
  available: 'Enter Territory',
  locked: 'Locked',
};

/**
 * Territory Selection (redesign, was a small-badge campaign list): the
 * Hunt tab's root screen. The three territories are explicitly
 * non-linear (see campaignState.ts and every content campaign's
 * unlockRequiresCampaignId: null) — this screen never implies one must
 * be finished before another; 'locked' is only reachable if a future
 * campaign is deliberately given a real unlock requirement, and even
 * then the UI below still renders it as a full panel (dimmed), never
 * hidden. Still enters the exact same 'WorldMap' route with the same
 * campaignId param as before — the Territory Hub on the other end is
 * the only thing that changed shape.
 */
export function HuntScreen({ navigation }: Props) {
  const monsterProgress = useAppStore((state) => state.monsterProgress);
  const campaigns = contentEngine.getAllCampaigns();

  return (
    <View style={styles.container}>
      <Header
        title="Territories"
        rightIcon="book-outline"
        rightAccessibilityLabel="Exercise Library"
        onRightPress={() => navigation.navigate('ExerciseLibrary')}
      />
      <ScrollView contentContainerStyle={styles.list}>
        {campaigns.map((campaign) => {
          const state = getCampaignState(campaigns, campaign.id, monsterProgress);
          const isLocked = state === 'locked';
          const defeatedCount = campaign.monsterIds.filter(
            (monsterId) => monsterProgress[monsterId]?.defeated
          ).length;
          const totalCount = campaign.monsterIds.length;
          const accentColor = TERRITORY_ACCENT[campaign.id] ?? colors.steel;
          const heroSource = getTerritoryArt(campaign.heroImageAsset);

          return (
            <Pressable
              key={campaign.id}
              disabled={isLocked}
              onPress={() => navigation.navigate('WorldMap', { campaignId: campaign.id })}
              style={({ pressed }) => [pressed && !isLocked && styles.pressed]}
            >
              <GlassCard padded={false} style={styles.card}>
                {/* Hero panel: real artwork if one is ever added under this
                    campaign's heroImageAsset key (see territoryArt.ts),
                    otherwise a flat accent-tinted panel — plain Views only,
                    no gradient library, matching how AppBackground's own
                    atmosphere layer is built. Either way a solid dark scrim
                    sits at the bottom so the name/tagline stay readable
                    regardless of what's behind them. */}
                <View style={[styles.hero, { backgroundColor: `${accentColor}22` }]}>
                  {heroSource ? (
                    <Image source={heroSource} style={styles.heroImage} resizeMode="cover" />
                  ) : null}
                  <View style={[styles.heroBorder, { borderColor: `${accentColor}55` }]} />
                  <View style={styles.heroScrim} />
                  <View style={styles.heroTextWrap}>
                    <Text style={[styles.territoryName, isLocked && styles.dimmed]}>{campaign.name}</Text>
                    {!isLocked ? <Text style={styles.tagline}>{campaign.tagline}</Text> : null}
                  </View>
                  {isLocked ? (
                    <View style={styles.lockBadge}>
                      <Ionicons name="lock-closed" size={16} color={colors.text.muted} />
                    </View>
                  ) : null}
                </View>

                <View style={styles.body}>
                  <Text style={[styles.stateLabel, { color: isLocked ? colors.steel : accentColor }]}>
                    {STATE_LABEL[state]}
                  </Text>

                  {!isLocked ? (
                    <>
                      <ProgressBar
                        progress={totalCount > 0 ? defeatedCount / totalCount : 0}
                        fillColor={colors.gold}
                        style={styles.progressBar}
                      />
                      <Text style={styles.progressLabel}>
                        {defeatedCount} / {totalCount} Monsters Defeated
                      </Text>
                      {isCampaignComplete(campaign, monsterProgress) ? (
                        <Text style={styles.completionMessage}>{campaign.completionText}</Text>
                      ) : null}
                    </>
                  ) : (
                    <Text style={styles.lockedHint}>This territory isn't open yet.</Text>
                  )}
                </View>
              </GlassCard>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const HERO_HEIGHT = 150;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.void.base,
  },
  list: {
    padding: spacing.md,
    gap: spacing.md,
  },
  pressed: {
    opacity: 0.85,
  },
  card: {
    width: '100%',
    overflow: 'hidden',
  },
  hero: {
    width: '100%',
    height: HERO_HEIGHT,
    justifyContent: 'flex-end',
  },
  heroImage: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%',
  },
  heroBorder: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderWidth: 1,
  },
  heroScrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: HERO_HEIGHT * 0.7,
    backgroundColor: 'rgba(10, 9, 8, 0.72)',
  },
  heroTextWrap: {
    padding: spacing.md,
  },
  lockBadge: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(10, 9, 8, 0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    padding: spacing.md,
  },
  territoryName: {
    fontFamily: fontFamily.displayBold,
    fontSize: fontSize.xl,
    color: colors.text.primary,
    textTransform: 'uppercase',
    letterSpacing: 2,
  },
  dimmed: {
    color: colors.steel,
  },
  tagline: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.sm,
    fontStyle: 'italic',
    color: colors.text.secondary,
    marginTop: 2,
  },
  completionMessage: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.sm,
    color: colors.gold,
    marginTop: spacing.xs,
    fontStyle: 'italic',
  },
  stateLabel: {
    fontFamily: fontFamily.monoBold,
    fontSize: fontSize.xs,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  progressBar: {
    marginTop: spacing.sm,
  },
  progressLabel: {
    fontFamily: fontFamily.monoRegular,
    fontSize: fontSize.xs,
    color: colors.text.muted,
    marginTop: spacing.xxs,
    textAlign: 'right',
  },
  lockedHint: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.sm,
    color: colors.text.muted,
    marginTop: spacing.sm,
  },
});
