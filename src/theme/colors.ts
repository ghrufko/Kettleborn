/**
 * Kettleborn color palette.
 * Source of truth: Motion Design Bible v1.0 / Mobile Architecture v1.0 Section 6.
 * Do not redefine these values anywhere else in the app.
 */
export const colors = {
  void: {
    base: '#0A0908',
    surface: '#141210',
  },
  charcoal: {
    base: '#1C1917',
    raised: '#242019',
  },
  bronze: {
    base: '#B87333',
    active: '#D4914A',
  },
  ember: {
    base: '#E8622C',
    glow: '#FF8A4C',
  },
  steel: '#4A453F',
  blood: '#8B1E1E',
  gold: '#D4AF37',

  text: {
    primary: '#F5EFE6',
    secondary: '#C9C2B6',
    muted: '#8A8478',
    onBronze: '#1C1917',
  },

  border: {
    hairline: 'rgba(184, 115, 51, 0.12)',
    hairlineStrong: 'rgba(184, 115, 51, 0.28)',
  },

  rarity: {
    common: '#4A453F',
    elite: '#B87333',
    boss: '#E8622C',
    legendary: '#D4AF37',
  },

  difficulty: {
    1: '#6B8E6B',
    2: '#B8A342',
    3: '#B87333',
    4: '#E8622C',
    5: '#8B1E1E',
  },
} as const;

export type DifficultyTier = keyof typeof colors.difficulty;
export type RarityTier = keyof typeof colors.rarity;
