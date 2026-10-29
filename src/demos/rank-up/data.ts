import { Platform } from 'react-native';

/**
 * The two leagues, the week's standings in Silver, the people on them, and the colours. Each league
 * is a world of its own, cool for Silver and warm for Gold, and going up turns one into the other.
 */

export const SILVER_BADGE = require('../../../assets/rank-up/art/league-silver.png');
export const GOLD_BADGE = require('../../../assets/rank-up/art/league-gold.png');

type World = { top: string; bottom: string; a: string; b: string; c: string };
type Palette = {
  /** Drawn in aurora.tsx: a gradient top to bottom and three pools of light drifting in it */
  silver: World;
  gold: World;
  /** Type on white in Silver's world, and in Gold's */
  cool: string;
  warm: string;
  /** Dark enough to read on white and on gold foil */
  ink: string;
  /** The shadows under white type and under white buttons, in each world */
  shade: string;
  shadeWarm: string;
  drop: string;
  dropWarm: string;
  /** Silver's world drawing back behind you */
  veil: string;
  /** The specks of light: pulled in while the badge charges, and drifting up once it's Gold */
  charge: [string, string];
  dust: [string, string];
  confetti: string[];
  /** The deep edge under a button, and type on gold */
  lip: string;
};

const GOLDS = {
  gold: '#FFC93C',
  goldLight: '#FFE07A',
  goldPale: '#FFF1BF',
  goldDeep: '#F29A0E',
  /** The edge under molten gold, and the burnt brown it's lettered in */
  amber: '#B4520A',
  umber: '#5E2600',
};

/** Ways the two worlds could look; PALETTE picks one */
const PALETTES = {
  /** Brushed steel turning to molten gold: each world made of its league's metal */
  steel: {
    silver: { top: '#1C2433', bottom: '#4A5A74', a: '#9DB8E0', b: '#F2F6FF', c: '#6F86AD' },
    gold: { top: '#C2410C', bottom: '#FFB01F', a: '#FFE066', b: '#FFFFFF', c: '#FF7A1A' },
    cool: '#34435E',
    warm: '#C2410C',
    ink: '#1A2130',
    shade: 'rgba(10, 16, 30, 0.4)',
    shadeWarm: 'rgba(120, 30, 0, 0.45)',
    drop: 'rgba(10, 16, 30, 0.3)',
    dropWarm: 'rgba(140, 40, 0, 0.25)',
    veil: 'rgba(14, 20, 32, 0.5)',
    charge: ['#FFFFFF', '#BFD4FF'],
    dust: ['#FFE27A', '#FFFFFF'],
    confetti: ['#FFFFFF', GOLDS.gold, GOLDS.goldLight, '#FF8A3D', '#C9D6EA', GOLDS.goldPale],
    lip: '#161D2A',
  },
  /** Deep ultramarine bursting into saffron, as far apart as two colours go */
  ultramarine: {
    silver: { top: '#16207A', bottom: '#2F50D6', a: '#6FD3FF', b: '#FFFFFF', c: '#8B9CFF' },
    gold: { top: '#FF4A1C', bottom: '#FFC21A', a: '#FFE36B', b: '#FFFFFF', c: '#FF7B3A' },
    cool: '#2438C2',
    warm: '#E0400F',
    ink: '#141A4A',
    shade: 'rgba(8, 12, 60, 0.4)',
    shadeWarm: 'rgba(150, 30, 0, 0.45)',
    drop: 'rgba(8, 12, 60, 0.3)',
    dropWarm: 'rgba(160, 40, 0, 0.25)',
    veil: 'rgba(10, 14, 70, 0.45)',
    charge: ['#FFFFFF', '#8FE3FF'],
    dust: ['#FFE27A', '#FFFFFF'],
    confetti: ['#FFFFFF', GOLDS.gold, GOLDS.goldLight, '#FF6A3D', '#7FD6FF', '#4F6BFF'],
    lip: '#111766',
  },
  /** Jewels: jade going up into ruby and fire */
  jade: {
    silver: { top: '#053D33', bottom: '#0E7F62', a: '#5CF0B4', b: '#E9FFF5', c: '#22B8C9' },
    gold: { top: '#A3082F', bottom: '#FF7A1A', a: '#FFCF3F', b: '#FFFFFF', c: '#FF3D57' },
    cool: '#0A7457',
    warm: '#C0122F',
    ink: '#0C2A24',
    shade: 'rgba(0, 30, 24, 0.4)',
    shadeWarm: 'rgba(110, 0, 20, 0.5)',
    drop: 'rgba(0, 30, 24, 0.3)',
    dropWarm: 'rgba(120, 0, 20, 0.25)',
    veil: 'rgba(2, 30, 24, 0.45)',
    charge: ['#FFFFFF', '#9CFFD9'],
    dust: ['#FFE27A', '#FFFFFF'],
    confetti: ['#FFFFFF', GOLDS.gold, GOLDS.goldLight, '#FF3D57', '#5CF0B4', '#FF9A3D'],
    lip: '#043A2B',
  },
} satisfies Record<string, Palette>;

export const PALETTE: Palette = PALETTES.ultramarine;

export const WORLD = { silver: PALETTE.silver, gold: PALETTE.gold };

/** For things on the worlds: white type, glass, and the colours buttons and pills are lettered in */
export const TONE = {
  white: '#FFFFFF',
  soft: 'rgba(255,255,255,0.88)',
  glass: 'rgba(255,255,255,0.13)',
  glassEdge: 'rgba(255,255,255,0.24)',
  cool: PALETTE.cool,
  warm: PALETTE.warm,
  ink: PALETTE.ink,
  ...GOLDS,
  veil: PALETTE.veil,
  shade: PALETTE.shade,
  shadeWarm: PALETTE.shadeWarm,
  drop: PALETTE.drop,
  dropWarm: PALETTE.dropWarm,
  lip: PALETTE.lip,
};

/** Molten gold, lit from above: Gold's buttons and its pill */
export const MOLTEN = 'linear-gradient(180deg, #FFF4B8 0%, #FFD43F 48%, #FFAA0A 100%)';

/** The foil the prize moments are printed in */
export const FOIL = `linear-gradient(100deg, ${TONE.goldPale} 0%, ${TONE.goldLight} 35%, ${TONE.gold} 70%, ${TONE.goldDeep} 100%)`;

export const CONFETTI = PALETTE.confetti;

/** SF Pro Rounded on iOS, as heavy as it goes */
export const ROUNDED = Platform.select({ ios: 'ui-rounded', default: undefined });

export type Player = { id: string; name: string; xp: number; avatar: number };

const avatar = {
  mina: require('../../../assets/rank-up/art/avatar-mina.png'),
  kenji: require('../../../assets/rank-up/art/avatar-kenji.png'),
  lucia: require('../../../assets/rank-up/art/avatar-lucia.png'),
  theo: require('../../../assets/rank-up/art/avatar-theo.png'),
  you: require('../../../assets/rank-up/art/avatar-you.png'),
  ama: require('../../../assets/rank-up/art/avatar-ama.png'),
  rafael: require('../../../assets/rank-up/art/avatar-rafael.png'),
  priya: require('../../../assets/rank-up/art/avatar-priya.png'),
};

/** Silver, with minutes left in the week: you're fifth */
export const BOARD: Player[] = [
  { id: 'mina', name: 'Mina', xp: 1880, avatar: avatar.mina },
  { id: 'kenji', name: 'Kenji', xp: 1820, avatar: avatar.kenji },
  { id: 'lucia', name: 'Lucía', xp: 1745, avatar: avatar.lucia },
  { id: 'theo', name: 'Theo', xp: 1690, avatar: avatar.theo },
  { id: 'you', name: 'You', xp: 1560, avatar: avatar.you },
  { id: 'ama', name: 'Ama', xp: 1520, avatar: avatar.ama },
  { id: 'rafael', name: 'Rafael', xp: 1475, avatar: avatar.rafael },
  { id: 'priya', name: 'Priya', xp: 1390, avatar: avatar.priya },
];

/** Where you start on the board */
export const YOU = 4;

/** Your XP after passing each of the four above you, nearest first */
export const CLIMB_XP = [1712, 1768, 1846, 1935];

/** The top three go up */
export const PROMOTE = 3;
