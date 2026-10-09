/**
 * Three ways to make the same shop, each its own concept:
 *
 * - Flat-pack: brown corrugated carton printed in one flexo ink, at night on a dark wood table,
 *   lit by the lamp by the door and, once it's open, its own string lights. Shipping-box honest.
 * - Paper Studio: coloured papercraft in daylight on a seamless backdrop, the way a product shoot
 *   or a keynote slide would show it. Soft and bright, so the products pop.
 * - Riso: off-white board printed in fluorescent pink and blue risograph ink, halftone and slightly
 *   off-register, against a deep blue night. Loud, poster-like.
 */

export type Look = 'kraft' | 'paper' | 'riso';

export type Theme = {
  look: Look;
  label: string;
  /** Board colours by part; null means the raw baked kraft */
  board: {
    /** The base: the pavement out front and the shop floor */
    page: string | null;
    /** The shop's front */
    wall: string | null;
    shelf: string | null;
    counter: string | null;
    /** The walls inside */
    side: string | null;
    door: string | null;
    /** Round the door and the window */
    trim: string | null;
  };
  /** The cut edge: corrugated, or a solid paper core of this colour */
  edge: 'corrugated' | string;
  ink: string;
  accent: string;
  accent2: string;
  stripeA: string;
  stripeB: string;
  signBg: string;
  signInk: string;
  posterA: string;
  posterB: string;
  /** The lettering on the door's glass */
  gilt: string;
  /** The doormat, and the ink of the checkered shop floor */
  mat: string;
  floorInk: string;
  /** Home: the hall outside the flat, its door, the floorboards inside */
  home: {
    wall: string | null;
    room: string | null;
    door: string;
    trim: string | null;
    floor: string;
    planks: string;
    curtain: string;
    desk: string | null;
  };
  /** Behind it all: a table, or a seamless backdrop of these two colours (top, bottom) */
  ground: { kind: 'table' } | { kind: 'sweep'; top: string; bottom: string };
  clear: string;
  light: {
    sky: string;
    groundColor: string;
    hemi: number;
    key: string;
    keyAt: [number, number, number];
    keyPower: number;
    rim: string;
    rimPower: number;
    /** The lamp by the door, always on */
    lamp: string;
    lampPower: number;
    /** The warm light of the bulbs inside, once they're all on */
    bulbs: string;
    inside: number;
  };
  neon: [number, number, number];
  /** How much the scene's darkened toward its edges */
  vignette: number;
  bloom: { strength: number; radius: number; threshold: number };
  /** The tint applied to the whole graded image */
  grade: [number, number, number];
};

export const THEMES: Record<Look, Theme> = {
  kraft: {
    look: 'kraft',
    label: 'Flat-pack',
    board: {
      page: null,
      wall: null,
      shelf: null,
      counter: null,
      side: '#D9C2A2',
      door: '#3F6F78',
      trim: '#F1E6D4',
    },
    edge: 'corrugated',
    ink: '#2B2420',
    accent: '#C9442F',
    accent2: '#2F6E8E',
    stripeA: '#C9442F',
    stripeB: '#F1E6D4',
    signBg: '#C9442F',
    signInk: '#FFF4E4',
    posterA: '#2F6E8E',
    posterB: '#3E8E55',
    gilt: '#F2C35A',
    mat: '#6E4A2C',
    floorInk: 'rgba(43,36,32,0.82)',
    home: {
      wall: '#B9A27E',
      room: '#D8C7A8',
      door: '#B4533B',
      trim: '#F1E6D4',
      floor: '#B98B5E',
      planks: 'rgba(60,36,20,0.55)',
      curtain: '#C9442F',
      desk: null,
    },
    ground: { kind: 'table' },
    clear: '#100C0A',
    light: {
      sky: '#B9C8EE',
      groundColor: '#3A2A1E',
      hemi: 0.55,
      key: '#C9D6FF',
      keyAt: [-1.8, 3.6, 3.0],
      keyPower: 0.75,
      rim: '#9FB6FF',
      rimPower: 0.5,
      lamp: '#FFB866',
      lampPower: 1.4,
      bulbs: '#FFB45E',
      inside: 2.6,
    },
    neon: [3.0, 0.75, 1.5],
    vignette: 0.55,
    bloom: { strength: 0.36, radius: 0.42, threshold: 0.85 },
    grade: [1.03, 1.0, 0.95],
  },
  paper: {
    look: 'paper',
    label: 'Paper Studio',
    board: {
      page: '#F5F0E8',
      wall: '#BFD8C6',
      shelf: '#FFFFFF',
      counter: '#F6C9B8',
      side: '#FBF6EE',
      door: '#E8735A',
      trim: '#FFF8EF',
    },
    edge: '#E9E1D3',
    ink: '#24302A',
    accent: '#E8735A',
    accent2: '#3C7A62',
    stripeA: '#F08B76',
    stripeB: '#FFF8EF',
    signBg: '#FFF8EF',
    signInk: '#2F5E4C',
    posterA: '#F6D46B',
    posterB: '#9CC7E8',
    gilt: '#FFF8EF',
    mat: '#3C7A62',
    floorInk: 'rgba(60,122,98,0.5)',
    home: {
      wall: '#F3E3D3',
      room: '#FBF3E8',
      door: '#3C7A62',
      trim: '#FFF8EF',
      floor: '#E7D2B4',
      planks: 'rgba(120,90,60,0.35)',
      curtain: '#F6D46B',
      desk: '#FFFFFF',
    },
    ground: { kind: 'sweep', top: '#F1E8DB', bottom: '#E3D6C3' },
    clear: '#EFE6D8',
    light: {
      sky: '#FFFFFF',
      groundColor: '#D9CBB5',
      hemi: 1.45,
      key: '#FFF6EA',
      keyAt: [-2.4, 4.0, 3.0],
      keyPower: 1.5,
      rim: '#FFFFFF',
      rimPower: 0.5,
      lamp: '#FFD9A0',
      lampPower: 0.3,
      bulbs: '#FFD9A0',
      inside: 1.4,
    },
    neon: [2.4, 0.9, 0.7],
    vignette: 0.85,
    bloom: { strength: 0.18, radius: 0.35, threshold: 1.1 },
    grade: [1.0, 1.0, 0.99],
  },
  riso: {
    look: 'riso',
    label: 'Riso',
    board: {
      page: '#EFE6D4',
      wall: '#F2EADB',
      shelf: '#F7F1E6',
      counter: '#F2EADB',
      side: '#F7F1E6',
      door: '#FF4F8B',
      trim: '#2440C8',
    },
    edge: '#E2D7C2',
    ink: '#2440C8',
    accent: '#FF4F8B',
    accent2: '#2440C8',
    stripeA: '#FF4F8B',
    stripeB: '#F7F1E6',
    signBg: '#2440C8',
    signInk: '#FF7FAD',
    posterA: '#FF4F8B',
    posterB: '#2440C8',
    gilt: '#FFE14D',
    mat: '#2440C8',
    floorInk: 'rgba(36,64,200,0.6)',
    home: {
      wall: '#FFD3E2',
      room: '#F7F1E6',
      door: '#2440C8',
      trim: '#F7F1E6',
      floor: '#F2EADB',
      planks: 'rgba(36,64,200,0.45)',
      curtain: '#FF4F8B',
      desk: '#F7F1E6',
    },
    ground: { kind: 'sweep', top: '#1A2470', bottom: '#0D133F' },
    clear: '#0D133F',
    light: {
      sky: '#C9D3FF',
      groundColor: '#2A2050',
      hemi: 0.8,
      key: '#FFF0F6',
      keyAt: [-2.0, 3.4, 2.6],
      keyPower: 1.0,
      rim: '#7F9BFF',
      rimPower: 0.9,
      lamp: '#FF9CC2',
      lampPower: 0.9,
      bulbs: '#FF9CC2',
      inside: 1.8,
    },
    neon: [3.2, 0.6, 1.6],
    vignette: 0.7,
    bloom: { strength: 0.3, radius: 0.45, threshold: 0.9 },
    grade: [1.02, 0.99, 1.03],
  },
};

export const LOOKS: Look[] = ['kraft', 'paper', 'riso'];
