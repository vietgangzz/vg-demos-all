import { Platform } from 'react-native';

/**
 * The two leagues, the week's standings in Silver, the people on them, and the colours. Each league
 * is a world of its own, cool for Silver and warm for Gold, and going up turns one into the other.
 */

export const SILVER_BADGE = require('../../../assets/rank-up-neo/art/league-silver.png');
export const GOLD_BADGE = require('../../../assets/rank-up-neo/art/league-gold.png');

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

/** Rank Up Neo's: deep space for Silver, cyan light running through it; a gold-fire nebula for Gold */
const NEO: Palette = {
  silver: { top: '#000204', bottom: '#00101A', a: '#22E5FF', b: '#BFF6FF', c: '#003C5A' },
  gold: { top: '#030201', bottom: '#140A01', a: '#FFC83D', b: '#FFF6D6', c: '#7A3300' },
  cool: '#22E5FF',
  warm: '#FF9A1F',
  ink: '#04111C',
  shade: 'rgba(0, 12, 30, 0.6)',
  shadeWarm: 'rgba(60, 20, 0, 0.6)',
  drop: 'rgba(0, 10, 25, 0.5)',
  dropWarm: 'rgba(60, 25, 0, 0.45)',
  veil: 'rgba(1, 4, 12, 0.6)',
  charge: ['#FFFFFF', '#7FF3FF'],
  dust: ['#FFE27A', '#FFFFFF'],
  confetti: ['#FFFFFF', GOLDS.gold, GOLDS.goldLight, '#22E5FF', '#7FF3FF', '#FF9A1F'],
  lip: '#021018',
};

export const PALETTE: Palette = NEO;

export const WORLD = { silver: PALETTE.silver, gold: PALETTE.gold };

/** For things on the worlds: white type, glass, and the colours buttons and pills are lettered in */
export const TONE = {
  white: '#FFFFFF',
  soft: 'rgba(214, 248, 255, 0.86)',
  glass: 'rgba(16, 52, 84, 0.42)',
  glassEdge: 'rgba(34, 229, 255, 0.4)',
  /** Neon: the cyan the badges' lights burn in, and its glow */
  neon: '#22E5FF',
  neonSoft: 'rgba(34, 229, 255, 0.55)',
  neonGlow: 'rgba(34, 229, 255, 0.35)',
  /** The other side's colour, the way it is on the Grid: orange */
  rival: '#FF6A1A',
  rivalLight: '#FFB27A',
  rivalGlow: 'rgba(255, 106, 26, 0.38)',
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

/** Condensed and heavy for the headings (leaning forward for the big ones), DIN for the readouts: a HUD's */
export const ROUNDED = Platform.select({ ios: 'AvenirNextCondensed-Heavy', default: undefined });
export const DISPLAY = Platform.select({ ios: 'AvenirNextCondensed-HeavyItalic', default: undefined });
export const MONO = Platform.select({ ios: 'DINAlternate-Bold', default: 'monospace' });

export type Player = { id: string; name: string; xp: number; avatar: number; level: number; streak: number };

const avatar = {
  mina: require('../../../assets/rank-up-neo/art/avatar-mina.png'),
  kenji: require('../../../assets/rank-up-neo/art/avatar-kenji.png'),
  lucia: require('../../../assets/rank-up-neo/art/avatar-lucia.png'),
  theo: require('../../../assets/rank-up-neo/art/avatar-theo.png'),
  you: require('../../../assets/rank-up-neo/art/avatar-you.png'),
  ama: require('../../../assets/rank-up-neo/art/avatar-ama.png'),
  rafael: require('../../../assets/rank-up-neo/art/avatar-rafael.png'),
  priya: require('../../../assets/rank-up-neo/art/avatar-priya.png'),
};

/** Silver, with minutes left in the week: you're fifth */
export const BOARD: Player[] = [
  { id: 'mina', name: 'Mina', xp: 1880, avatar: avatar.mina, level: 31, streak: 48 },
  { id: 'kenji', name: 'Kenji', xp: 1820, avatar: avatar.kenji, level: 29, streak: 21 },
  { id: 'lucia', name: 'Lucía', xp: 1745, avatar: avatar.lucia, level: 27, streak: 33 },
  { id: 'theo', name: 'Theo', xp: 1690, avatar: avatar.theo, level: 26, streak: 9 },
  { id: 'you', name: 'You', xp: 1560, avatar: avatar.you, level: 26, streak: 12 },
  { id: 'ama', name: 'Ama', xp: 1520, avatar: avatar.ama, level: 24, streak: 17 },
  { id: 'rafael', name: 'Rafael', xp: 1475, avatar: avatar.rafael, level: 22, streak: 6 },
  { id: 'priya', name: 'Priya', xp: 1390, avatar: avatar.priya, level: 21, streak: 4 },
];

/** Where you start on the board */
export const YOU = 4;

/** Your XP after passing each of the four above you, nearest first */
export const CLIMB_XP = [1712, 1768, 1846, 1935];

/** The top three go up */
export const PROMOTE = 3;
