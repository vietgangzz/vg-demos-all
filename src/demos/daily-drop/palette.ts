/**
 * Daily Drop's colours, type and rewards, shared by the 3D scene and the screens over it.
 */

/** The rarities, in the order the chest's light runs through them as it's held */
export const RARITY = {
  common: '#FFE6A8',
  rare: '#4FB6FF',
  epic: '#B36BFF',
  legendary: '#FFB020',
} as const;
export type Rarity = keyof typeof RARITY;

export const RARITY_NAME: Record<Rarity, string> = {
  common: 'Common',
  rare: 'Rare',
  epic: 'Epic',
  legendary: 'Legendary',
};

export const INK = '#0B0716';
export const CREAM = '#FFF4E0';
export const GOLD = '#FFC24A';
export const GOLD_DEEP = '#C27A12';
export const VIOLET = '#9B6BFF';
export const XP = '#62E6FF';
export const DIM = 'rgba(255,244,224,0.62)';

/**
 * A glow round some text that isn't cut off square: iOS draws a text's shadow inside the text's own
 * box, so the box is grown by the glow's reach (padding) and given back outside it (margin), leaving
 * the text where it was
 */
export const glow = (colour: string, radius: number) => ({
  textShadowColor: colour,
  textShadowRadius: radius,
  textShadowOffset: { width: 0, height: 0 },
  padding: radius * 1.5,
  margin: -radius * 1.5,
});

/** Fredoka, rounded and chunky, the way game type is */
export const FONT = {
  medium: 'Fredoka_500Medium',
  semibold: 'Fredoka_600SemiBold',
  bold: 'Fredoka_700Bold',
};

/** What's in today's chest, left to right as the cards fan out */
export type Reward = {
  id: 'coins' | 'fox' | 'gems';
  rarity: Rarity;
  name: string;
  /** What it adds, shown on the card */
  amount: string;
};

export const REWARDS: Reward[] = [
  { id: 'coins', rarity: 'common', name: 'Coin Sack', amount: '+500' },
  { id: 'fox', rarity: 'legendary', name: 'Ember Fox', amount: 'Companion' },
  { id: 'gems', rarity: 'epic', name: 'Gem Pouch', amount: '+40' },
];

/** The wallet before today's chest, and what the chest adds */
export const START = { coins: 12480, gems: 340, level: 11, xp: 0.62 };
export const AWARD = { coins: 500, gems: 40, xp: 0.56 };
