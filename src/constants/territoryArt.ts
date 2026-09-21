import { ImageSourcePropType } from 'react-native';

/**
 * Territory Hub redesign: no territory artwork exists in the project yet
 * (confirmed — assets/images has monster portraits only, no location
 * art). Left empty rather than requiring a `require()` for a file that
 * doesn't exist, which would break the Metro bundle. When real artwork
 * is ready, add e.g. `wilds: require('../../assets/images/territories/territory-wilds.jpg')`
 * using the same `heroImageAsset` keys already set in
 * content/campaigns/*.json ('territory-wilds' / 'territory-ruins' /
 * 'territory-abyss') — no other code changes needed; every screen that
 * renders a hero image already goes through getTerritoryArt and already
 * has a themed-gradient fallback for the `undefined` case.
 */
export const TERRITORY_ART: Record<string, ImageSourcePropType> = {};

export function getTerritoryArt(heroImageAsset?: string): ImageSourcePropType | undefined {
  if (!heroImageAsset) {
    return undefined;
  }
  return TERRITORY_ART[heroImageAsset];
}

/**
 * Territory Hub redesign: each territory's accent color for its hero
 * panel, keyed by the existing content `Campaign.id` (never a display
 * name, which can change — see The Two-Faced rename). Reuses the
 * existing palette exactly (theme/colors.ts: "Do not redefine these
 * values anywhere else in the app") rather than inventing new hex
 * values — ember for the Wilds' primal heat, bronze for the Ruins'
 * already-established "Iron Trials" association, blood for the Abyss'
 * darker, corrupted register. A campaign id missing from this map falls
 * back to steel in every caller below, so a future fourth territory
 * doesn't crash, it just renders neutral until given a real color.
 */
export const TERRITORY_ACCENT: Record<string, string> = {
  'main-campaign': '#E8622C', // colors.ember.base
  'iron-trials': '#B87333', // colors.bronze.base
  'forgotten-trials': '#8B1E1E', // colors.blood
};
