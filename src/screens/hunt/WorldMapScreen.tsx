import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Image, Pressable, useWindowDimensions } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { HuntStackParamList } from '../../navigation/types';
import { Header, Button, GlassCard, AppBackground } from '../../components/core';
import { contentEngine } from '../../../engines/content';
import { getMonsterPortrait } from '../../constants/monsterPortraits';
import { getTerritoryArt, TERRITORY_ACCENT } from '../../constants/territoryArt';
import { getCampaignMonsterState, isCampaignComplete } from '../../utils/campaignState';
import { getCombatPersonality } from '../../utils/bossPersonality';
import { flavorTextFor } from '../../utils/flavorText';
import { useAppStore } from '../../store';
import { colors, fontFamily, fontSize, radii, spacing, glow } from '../../theme';

type Props = NativeStackScreenProps<HuntStackParamList, 'WorldMap'>;

type HubTab = 'hunts' | 'lore' | 'trophies';

type Monster = NonNullable<ReturnType<typeof contentEngine.getMonster>>;

interface BossPageEntry {
  monster: Monster;
  isLocked: boolean;
  isDefeated: boolean;
  isCurrentTarget: boolean;
  isFinalBoss: boolean;
  huntsCompleted: number;
  huntsTotal: number;
}

/**
 * Territory Hub: a large hero header — territory name/tagline over an
 * accent-tinted panel, real artwork if `campaign.heroImageAsset` ever
 * resolves to one (see territoryArt.ts) — with three tabs underneath.
 *
 * HUNTS is a full-screen, horizontally paged boss selector (one boss per
 * page, portrait as the hero image, swipe left/right, dot indicator) —
 * a presentation-only redesign of what used to be a vertical scroll of
 * MonsterCard rows. The underlying data and logic are unchanged: same
 * `nodes`/`nodeStates` (locked/available/defeated) from
 * campaignState.ts, same final-boss placement, same current-target
 * detection, and every navigation call below still points at the exact
 * same `MonsterDetail` route it always did — only the layout changed.
 * Several monsters have no `portraitAsset` yet; those pages fall back to
 * the same accent-tinted initial-letter treatment MonsterCard already
 * used for a missing portrait.
 *
 * LORE and TROPHIES are unchanged from the previous redesign — purely
 * presentational, reading only from data that already exists
 * (Campaign.territoryLore, and monster.title/description +
 * monsterProgress[id].defeated for Trophies — there is no separate
 * Trophy/Arsenal data model in the project to reuse).
 */
export function WorldMapScreen({ route, navigation }: Props) {
  const { campaignId } = route.params;
  const monsterProgress = useAppStore((state) => state.monsterProgress);
  const campaign = contentEngine.getCampaign(campaignId);
  const orderedMonsterIds = campaign?.monsterIds ?? [];
  const [tab, setTab] = useState<HubTab>('hunts');

  const nodes = orderedMonsterIds
    .map((monsterId) => contentEngine.getMonster(monsterId))
    .filter((monster): monster is NonNullable<typeof monster> => !!monster);

  const nodeStates = nodes.map((monster) =>
    getCampaignMonsterState(campaign!, monster.id, monsterProgress)
  );
  // The current objective: the first monster that's unlocked but not yet
  // defeated. If every monster is defeated, there is no current target —
  // the campaign-complete banner takes over instead.
  const currentTargetIndex = nodeStates.findIndex((state) => state === 'available');
  const campaignComplete = campaign ? isCampaignComplete(campaign, monsterProgress) : false;
  const accentColor = campaign ? TERRITORY_ACCENT[campaign.id] ?? colors.steel : colors.steel;
  const heroSource = campaign ? getTerritoryArt(campaign.heroImageAsset) : undefined;

  const { width: windowWidth } = useWindowDimensions();
  const [pageIndex, setPageIndex] = useState(0);

  // Same monster set / same states / same final-boss placement as before —
  // just flattened into one array so it can be paged through instead of
  // stacked vertically. No progression/locking/defeated logic changed.
  const bossPages: BossPageEntry[] = nodes.map((monster, index) => {
    const progress = monsterProgress[monster.id];
    const state = nodeStates[index];
    return {
      monster,
      isLocked: state === 'locked',
      isDefeated: state === 'defeated',
      isCurrentTarget: index === currentTargetIndex,
      isFinalBoss: false,
      huntsCompleted: progress?.huntsCompleted ?? 0,
      huntsTotal: progress?.huntsTotal ?? monster.hunts.length,
    };
  });

  if (campaign?.finalBossId) {
    const boss = contentEngine.getMonster(campaign.finalBossId);
    if (boss) {
      const bossState = getCampaignMonsterState(campaign, boss.id, monsterProgress);
      const bossProgress = monsterProgress[boss.id];
      bossPages.push({
        monster: boss,
        isLocked: bossState === 'locked',
        isDefeated: bossState === 'defeated',
        isCurrentTarget: false,
        isFinalBoss: true,
        huntsCompleted: bossProgress?.huntsCompleted ?? 0,
        huntsTotal: bossProgress?.huntsTotal ?? boss.hunts.length,
      });
    }
  }

  return (
    <AppBackground style={styles.container}>
      <Header
        title=""
        onBack={() => navigation.navigate('Hunt')}
        rightIcon="book-outline"
        rightAccessibilityLabel="Exercise Library"
        onRightPress={() => navigation.navigate('ExerciseLibrary')}
      />

      {/* Hero: same accent-panel + plain-View scrim technique as the
          Territory Selection cards (HuntScreen.tsx) — no gradient
          library, real artwork slots in via heroImageAsset with zero
          layout change once it exists. */}
      <View style={[styles.hero, { backgroundColor: `${accentColor}22` }]}>
        {heroSource ? <Image source={heroSource} style={styles.heroImage} resizeMode="cover" /> : null}
        <View style={styles.heroScrim} />
        <View style={styles.heroTextWrap}>
          <Text style={styles.territoryName}>{campaign?.name ?? 'Territory'}</Text>
          {campaign ? <Text style={styles.tagline}>{campaign.tagline}</Text> : null}
        </View>
      </View>

      <View style={styles.tabBar}>
        {(
          [
            ['hunts', 'Hunts'],
            ['lore', 'Lore'],
            ['trophies', 'Trophies'],
          ] as [HubTab, string][]
        ).map(([key, label]) => (
          <Pressable
            key={key}
            onPress={() => setTab(key)}
            style={[styles.tabButton, tab === key && { borderBottomColor: accentColor }]}
            hitSlop={8}
          >
            <Text style={[styles.tabLabel, tab === key && { color: colors.text.primary }]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      {tab === 'hunts' ? (
        <View style={styles.huntsTab}>
          {campaignComplete ? (
            <View style={styles.huntsTabHeader}>
              <GlassCard style={[styles.completeBanner, glow.md]}>
                <Ionicons name="trophy" size={28} color={colors.gold} />
                <Text style={styles.completeTitle}>Territory Cleared</Text>
                <Text style={styles.completeSubtitle}>{campaign?.completionText}</Text>
                <Button
                  label="Return to Territories"
                  onPress={() => navigation.navigate('Hunt')}
                  style={styles.completeButton}
                />
              </GlassCard>
            </View>
          ) : null}

          {bossPages.length > 0 ? (
            <>
              {/* Plain horizontal ScrollView with pagingEnabled — one boss
                  fills the screen per page, no extra pager/carousel
                  dependency needed for 7-8 items. */}
              <ScrollView
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                onMomentumScrollEnd={(event) => {
                  const nextIndex = Math.round(event.nativeEvent.contentOffset.x / windowWidth);
                  setPageIndex(Math.max(0, Math.min(nextIndex, bossPages.length - 1)));
                }}
                style={styles.pager}
              >
                {bossPages.map((entry) => (
                  <BossHeroPage
                    key={entry.monster.id}
                    entry={entry}
                    pageWidth={windowWidth}
                    accentColor={accentColor}
                    onPress={() => navigation.navigate('MonsterDetail', { monsterId: entry.monster.id })}
                  />
                ))}
              </ScrollView>

              {bossPages.length > 1 ? (
                <View style={styles.dotsRow}>
                  {bossPages.map((entry, index) => (
                    <View
                      key={entry.monster.id}
                      style={[
                        styles.dot,
                        index === pageIndex && [styles.dotActive, { backgroundColor: accentColor }],
                      ]}
                    />
                  ))}
                </View>
              ) : null}
            </>
          ) : null}
        </View>
      ) : null}

      {tab === 'lore' ? (
        <ScrollView contentContainerStyle={styles.list}>
          {campaign?.introText ? <Text style={styles.campaignIntro}>{campaign.introText}</Text> : null}
          {campaign?.territoryLore ? (
            <>
              <GlassCard style={styles.loreCard}>
                <Text style={[styles.loreSectionLabel, { color: accentColor }]}>The Territory</Text>
                <Text style={styles.loreBody}>{campaign.territoryLore.theTerritory}</Text>
              </GlassCard>
              <GlassCard style={styles.loreCard}>
                <Text style={[styles.loreSectionLabel, { color: accentColor }]}>What Dwells Here</Text>
                <Text style={styles.loreBody}>{campaign.territoryLore.whatDwellsHere}</Text>
              </GlassCard>
              <GlassCard style={styles.loreCard}>
                <Text style={[styles.loreSectionLabel, { color: accentColor }]}>The Hunter's Purpose</Text>
                <Text style={styles.loreBody}>{campaign.territoryLore.huntersPurpose}</Text>
              </GlassCard>
              <Text style={styles.loreTransition}>{campaign.territoryLore.transition}</Text>
            </>
          ) : (
            <Text style={styles.loreBody}>No lore recorded for this territory yet.</Text>
          )}
        </ScrollView>
      ) : null}

      {tab === 'trophies' ? (
        <ScrollView contentContainerStyle={styles.list}>
          {/*
            No separate Trophy/Arsenal data model exists in the project
            (Forge is equipment management, not trophies — see completion
            report). This reuses what already exists per monster
            (title/description) as the trophy's name/flavor, gated purely
            by the same monsterProgress[id].defeated flag every other
            screen already reads — no new persistence, no inventory
            mechanic invented.
          */}
          {nodes.map((monster) => {
            const defeated = !!monsterProgress[monster.id]?.defeated;
            return (
              <GlassCard key={monster.id} style={styles.trophyCard}>
                <View style={styles.trophyHeader}>
                  <Ionicons
                    name={defeated ? 'ribbon' : 'help-circle-outline'}
                    size={20}
                    color={defeated ? colors.gold : colors.steel}
                  />
                  <Text style={[styles.trophyMonster, !defeated && styles.dimmed]}>
                    {defeated ? monster.name : '????'}
                  </Text>
                </View>
                {defeated ? (
                  <>
                    <Text style={styles.trophyName}>{monster.title}</Text>
                    <Text style={styles.trophyDescription}>{monster.description}</Text>
                  </>
                ) : (
                  <Text style={styles.trophyLockedHint}>Defeat this monster to claim its trophy.</Text>
                )}
              </GlassCard>
            );
          })}
        </ScrollView>
      ) : null}
    </AppBackground>
  );
}

const HERO_HEIGHT = 130;

/**
 * One full-screen page of the Hunts-tab boss pager. Same underlying data
 * (locked/defeated/current-target/final-boss, portraitAsset, progress)
 * that the old MonsterCard rows used — this only changes how it's laid
 * out: the portrait (or, for the several monsters with no portraitAsset
 * yet, the same accent-tinted initial-letter fallback MonsterCard already
 * used) fills the page, with name/title/focus/progress overlaid at the
 * bottom over a scrim so the upper artwork — the monster's face — stays
 * clear.
 */
function BossHeroPage({
  entry,
  pageWidth,
  accentColor,
  onPress,
}: {
  entry: BossPageEntry;
  pageWidth: number;
  accentColor: string;
  onPress: () => void;
}) {
  const { monster, isLocked, isDefeated, isCurrentTarget, isFinalBoss, huntsCompleted, huntsTotal } = entry;
  const portraitSource = isLocked ? undefined : getMonsterPortrait(monster.portraitAsset);

  return (
    <Pressable
      onPress={isLocked ? undefined : onPress}
      disabled={isLocked}
      accessibilityRole="button"
      accessibilityLabel={isLocked ? 'Unknown Creature' : monster.name}
      style={[styles.heroPage, { width: pageWidth }]}
    >
      <View style={styles.heroPageArtWrap}>
        {portraitSource ? (
          <Image source={portraitSource} style={styles.heroPageImage} resizeMode="cover" />
        ) : (
          <View style={[styles.heroPageFallback, { backgroundColor: `${accentColor}33` }]}>
            <Text style={styles.heroPageFallbackInitial}>{isLocked ? '?' : monster.name.charAt(0)}</Text>
          </View>
        )}
        <View style={[styles.heroPageScrim, isDefeated && styles.heroPageScrimDefeated]} />
        {isLocked ? (
          <View style={styles.heroPageLockOverlay}>
            <Ionicons name="lock-closed" size={36} color={colors.text.secondary} />
          </View>
        ) : null}
      </View>

      <View style={styles.heroPageTopBadges}>
        {isFinalBoss ? (
          <View style={styles.finalBossBadge}>
            <Text style={styles.finalBossBadgeText}>Final Boss</Text>
          </View>
        ) : (
          <View />
        )}
        {isDefeated ? (
          <View style={styles.defeatedBadge}>
            <Ionicons name="checkmark-circle" size={14} color={colors.gold} />
            <Text style={styles.defeatedBadgeText}>Defeated</Text>
          </View>
        ) : (
          <View />
        )}
      </View>

      <View style={styles.heroPageTextWrap}>
        <Text style={styles.heroPageName} numberOfLines={1}>
          {isLocked ? '????' : monster.name}
        </Text>
        <Text style={styles.heroPageTitle} numberOfLines={1}>
          {isLocked ? 'Unknown Creature' : monster.title}
        </Text>
        {!isLocked ? (
          <Text style={styles.heroPageFocus}>{getCombatPersonality(monster.personality).label}</Text>
        ) : null}
        {isCurrentTarget && !isLocked ? (
          <Text style={styles.heroPageFlavor} numberOfLines={2}>
            {flavorTextFor(monster.id)}
          </Text>
        ) : null}
        <Text style={styles.heroPageProgress}>
          {huntsCompleted} / {huntsTotal} Hunts
        </Text>
      </View>

      {isCurrentTarget ? (
        <View style={styles.currentTargetBadge}>
          <Ionicons name="locate" size={11} color={colors.ember.base} />
          <Text style={styles.currentTargetBadgeText}>Current Target</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
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
  heroScrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: HERO_HEIGHT * 0.75,
    backgroundColor: 'rgba(10, 9, 8, 0.72)',
  },
  heroTextWrap: {
    padding: spacing.md,
  },
  territoryName: {
    fontFamily: fontFamily.displayBold,
    fontSize: fontSize.xl,
    color: colors.text.primary,
    textTransform: 'uppercase',
    letterSpacing: 2,
  },
  tagline: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.sm,
    fontStyle: 'italic',
    color: colors.text.secondary,
    marginTop: 2,
  },
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: colors.border.hairline,
  },
  tabButton: {
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabLabel: {
    fontFamily: fontFamily.displayRegular,
    fontSize: fontSize.sm,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.text.muted,
  },
  list: {
    padding: spacing.md,
    gap: spacing.sm,
  },
  huntsTab: {
    flex: 1,
  },
  huntsTabHeader: {
    paddingTop: spacing.sm,
  },
  campaignIntro: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.sm,
    fontStyle: 'italic',
    color: colors.text.muted,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.xs,
  },
  completeBanner: {
    alignItems: 'center',
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  completeTitle: {
    fontFamily: fontFamily.displayBold,
    fontSize: fontSize.lg,
    color: colors.text.primary,
    textTransform: 'uppercase',
    letterSpacing: 2,
    marginTop: spacing.xs,
  },
  completeSubtitle: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.sm,
    color: colors.text.secondary,
    textAlign: 'center',
    marginTop: spacing.xxs,
  },
  completeButton: {
    width: '100%',
    marginTop: spacing.md,
  },
  loreCard: {
    width: '100%',
  },
  loreSectionLabel: {
    fontFamily: fontFamily.displayRegular,
    fontSize: fontSize.xs,
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: spacing.xs,
  },
  loreBody: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.base,
    lineHeight: 22,
    color: colors.text.secondary,
  },
  loreTransition: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.sm,
    fontStyle: 'italic',
    color: colors.text.muted,
    textAlign: 'center',
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
  },
  trophyCard: {
    width: '100%',
  },
  trophyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  trophyMonster: {
    fontFamily: fontFamily.displayBold,
    fontSize: fontSize.base,
    color: colors.text.primary,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  dimmed: {
    color: colors.steel,
  },
  trophyName: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.sm,
    fontStyle: 'italic',
    color: colors.gold,
    marginTop: spacing.xs,
  },
  trophyDescription: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.sm,
    color: colors.text.secondary,
    marginTop: spacing.xxs,
    lineHeight: 20,
  },
  trophyLockedHint: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.sm,
    color: colors.text.muted,
    marginTop: spacing.xs,
    fontStyle: 'italic',
  },
  pager: {
    flex: 1,
  },
  heroPage: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  heroPageArtWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  heroPageImage: {
    width: '100%',
    height: '100%',
  },
  heroPageFallback: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroPageFallbackInitial: {
    fontFamily: fontFamily.displayBold,
    fontSize: 96,
    color: colors.text.secondary,
  },
  heroPageScrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '25%',
    backgroundColor: 'rgba(10, 9, 8, 0.82)',
  },
  heroPageScrimDefeated: {
    backgroundColor: 'rgba(10, 9, 8, 0.62)',
  },
  heroPageLockOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(10, 9, 8, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroPageTopBadges: {
    position: 'absolute',
    top: spacing.md,
    left: spacing.md,
    right: spacing.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  finalBossBadge: {
    backgroundColor: 'rgba(10, 9, 8, 0.6)',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.gold,
  },
  finalBossBadgeText: {
    fontFamily: fontFamily.monoBold,
    fontSize: fontSize.xs,
    color: colors.gold,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  defeatedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
    backgroundColor: 'rgba(10, 9, 8, 0.6)',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    borderRadius: 999,
  },
  defeatedBadgeText: {
    fontFamily: fontFamily.monoRegular,
    fontSize: fontSize.xs,
    color: colors.gold,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  heroPageTextWrap: {
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  currentTargetBadge: {
    position: 'absolute',
    right: spacing.lg,
    bottom: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
    paddingHorizontal: spacing.xs,
    paddingVertical: 3,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(10, 9, 8, 0.6)',
  },
  currentTargetBadgeText: {
    fontFamily: fontFamily.monoBold,
    fontSize: fontSize.xs,
    color: colors.ember.base,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  heroPageName: {
    fontFamily: fontFamily.displayBold,
    fontSize: fontSize.display,
    color: colors.text.primary,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  heroPageTitle: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.lg,
    fontStyle: 'italic',
    color: colors.text.secondary,
    marginTop: spacing.xxs,
  },
  heroPageFocus: {
    fontFamily: fontFamily.monoRegular,
    fontSize: fontSize.sm,
    color: colors.bronze.active,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginTop: spacing.sm,
  },
  heroPageFlavor: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: fontSize.sm,
    fontStyle: 'italic',
    color: colors.text.muted,
    marginTop: spacing.xs,
  },
  heroPageProgress: {
    fontFamily: fontFamily.monoRegular,
    fontSize: fontSize.xs,
    color: colors.text.muted,
    marginTop: spacing.sm,
  },
  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.steel,
  },
  dotActive: {
    width: 14,
    height: 14,
    borderRadius: 7,
  },
});
