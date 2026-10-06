import type { MatcapSpec } from './matcaps';

/**
 * Skins for the whole little world, after (Not Boring) Weather's: each one recolours the
 * numerals and gadgets (a matcap), the clouds and the sun, and either keeps the live sky behind
 * them or paints a flat backdrop of its own. Every skin is free.
 */

type RGB = [number, number, number];

export type ThemeId =
  'sky' | 'noir' | 'andy' | 'guava' | 'graphite' | 'opal' | 'chroma' | 'mem' | 'monsters' | 'karat' | 'sonmai' | 'ngoc';

export type Theme = {
  id: ThemeId;
  name: { en: string; vi: string };
  /** Numerals and gadgets */
  skin: MatcapSpec;
  /** Cloud colours (lit side, shade, rim); null keeps the clouds the sky's own white */
  cloud: { lit: RGB; shade: RGB; rim: RGB } | null;
  /** The sun ball's lit and shaded colours */
  sun: { lit: RGB; shade: RGB };
  /** A flat backdrop, by day and by night; null keeps the live sky */
  backdrop: { day: [RGB, RGB]; night: [RGB, RGB] } | null;
  /** 0..1 rainbow thin-film sheen on the skin's edges (Chroma, Opal) */
  sheen: number;
  /** 0..1 polka dots on the skin (Mem), and their colour */
  dots: number;
  dotColor: RGB;
  /** The settings card: its background and the cube drawn on it (top, left, right faces) */
  card: { bg: string; cube: [string, string, string]; ink: string };
};

const hex = (h: string): RGB => [
  parseInt(h.slice(1, 3), 16) / 255,
  parseInt(h.slice(3, 5), 16) / 255,
  parseInt(h.slice(5, 7), 16) / 255,
];

const INK: MatcapSpec = {
  base: '#3A3B3F',
  shade: '#08080A',
  rim: '#9A9CA3',
  rimStrength: 0.55,
  bounce: '#26272B',
  spec: 0.38,
  gloss: 26,
};
const BLACK_CLOUD = { lit: hex('#3B3C40'), shade: hex('#0C0C0E'), rim: hex('#8C8E96') };
const NIGHT_GREY: [RGB, RGB] = [hex('#1D1D20'), hex('#2A2A2E')];

export const THEMES: Theme[] = [
  {
    id: 'sky',
    name: { en: 'Sky', vi: 'Trời' },
    skin: INK,
    cloud: null,
    sun: { lit: hex('#FFD952'), shade: hex('#F7731A') },
    backdrop: null,
    sheen: 0,
    dots: 0,
    dotColor: [0, 0, 0],
    card: { bg: '#8EC5FF', cube: ['#4B4C51', '#2A2B2F', '#17181B'], ink: '#14181F' },
  },
  {
    id: 'noir',
    name: { en: 'Classic', vi: 'Cổ điển' },
    skin: INK,
    cloud: BLACK_CLOUD,
    sun: { lit: hex('#FF3B47'), shade: hex('#D9112A') },
    backdrop: { day: [hex('#F3F3F1'), hex('#FFFFFF')], night: NIGHT_GREY },
    sheen: 0,
    dots: 0,
    dotColor: [0, 0, 0],
    card: { bg: '#F2F2F0', cube: ['#4B4C51', '#2A2B2F', '#17181B'], ink: '#14181F' },
  },
  {
    id: 'andy',
    name: { en: 'Andy', vi: 'Andy' },
    skin: INK,
    cloud: BLACK_CLOUD,
    sun: { lit: hex('#FFF6E4'), shade: hex('#E9D7B8') },
    backdrop: { day: [hex('#F7A51C'), hex('#F49B0E')], night: [hex('#7A4A06'), hex('#8E5608')] },
    sheen: 0,
    dots: 0,
    dotColor: [0, 0, 0],
    card: { bg: '#F7A51C', cube: ['#4B4C51', '#2A2B2F', '#17181B'], ink: '#2A1A04' },
  },
  {
    id: 'guava',
    name: { en: 'Guava', vi: 'Ổi' },
    skin: {
      base: '#FF5E8E',
      shade: '#C0154F',
      rim: '#FFD3E1',
      rimStrength: 0.7,
      bounce: '#FF8FAE',
      spec: 1,
      gloss: 70,
    },
    cloud: { lit: hex('#FF8FB0'), shade: hex('#D93A6E'), rim: hex('#FFE0EA') },
    sun: { lit: hex('#FFFFFF'), shade: hex('#FFD8E3') },
    backdrop: { day: [hex('#FFD640'), hex('#FFCE2E')], night: [hex('#6E5208'), hex('#7E5E0A')] },
    sheen: 0,
    dots: 0,
    dotColor: [0, 0, 0],
    card: { bg: '#FFD23F', cube: ['#FF7FA5', '#FF4F84', '#D62461'], ink: '#C2185B' },
  },
  {
    id: 'graphite',
    name: { en: 'Graphite', vi: 'Than chì' },
    skin: {
      base: '#6B6C72',
      shade: '#141417',
      rim: '#C9CBD2',
      rimStrength: 0.6,
      bounce: '#3A3B40',
      spec: 0.9,
      gloss: 60,
    },
    cloud: { lit: hex('#5C5D63'), shade: hex('#1A1A1D'), rim: hex('#A9ABB2') },
    sun: { lit: hex('#E9E9EC'), shade: hex('#9C9DA3') },
    backdrop: { day: [hex('#2B2B2F'), hex('#3A3A3F')], night: [hex('#141416'), hex('#1E1E21')] },
    sheen: 0,
    dots: 0,
    dotColor: [0, 0, 0],
    card: { bg: '#2E2E32', cube: ['#55565B', '#323337', '#1E1F22'], ink: '#FFFFFF' },
  },
  {
    id: 'opal',
    name: { en: 'Opal', vi: 'Opal' },
    skin: {
      base: '#ECE8FF',
      shade: '#9C8FD8',
      rim: '#FFFFFF',
      rimStrength: 0.9,
      spec: 0.9,
      gloss: 80,
      pearl: 1,
    },
    cloud: { lit: hex('#FFFFFF'), shade: hex('#C9C2EC'), rim: hex('#FFFFFF') },
    sun: { lit: hex('#FFE9F6'), shade: hex('#B6A8F5') },
    backdrop: { day: [hex('#2A2440'), hex('#3B3260')], night: [hex('#141022'), hex('#221B3A')] },
    sheen: 0.8,
    dots: 0,
    dotColor: [0, 0, 0],
    card: { bg: '#2A2440', cube: ['#B8F3FF', '#C59BFF', '#FF9BDB'], ink: '#FFFFFF' },
  },
  {
    id: 'chroma',
    name: { en: 'Chroma', vi: 'Chroma' },
    skin: { ...INK, rim: '#5A5C64', rimStrength: 0.3 },
    cloud: BLACK_CLOUD,
    sun: { lit: hex('#FFCF3A'), shade: hex('#F59A0B') },
    backdrop: { day: [hex('#F6F6F4'), hex('#FFFFFF')], night: NIGHT_GREY },
    sheen: 1,
    dots: 0,
    dotColor: [0, 0, 0],
    card: { bg: '#F2F2F0', cube: ['#1B1C20', '#3B2BFF', '#FF4D2E'], ink: '#14181F' },
  },
  {
    id: 'mem',
    name: { en: 'Mem', vi: 'Xúc xắc' },
    skin: { base: '#F7F7F5', shade: '#A9ABB3', rim: '#FFFFFF', bounce: '#D7D9DF', spec: 0.6, gloss: 40 },
    cloud: { lit: hex('#FFFFFF'), shade: hex('#B9BCC6'), rim: hex('#FFFFFF') },
    sun: { lit: hex('#2A2B2F'), shade: hex('#0B0B0D') },
    backdrop: { day: [hex('#E6E6E3'), hex('#F4F4F2')], night: NIGHT_GREY },
    sheen: 0,
    dots: 1,
    dotColor: [0.07, 0.07, 0.08],
    card: { bg: '#E9E9E6', cube: ['#FFFFFF', '#E3E4E8', '#C9CBD2'], ink: '#14181F' },
  },
  {
    id: 'monsters',
    name: { en: 'Monsters', vi: 'Quái vật' },
    skin: {
      base: '#5DD8FF',
      shade: '#0A7FC2',
      rim: '#D9F6FF',
      rimStrength: 0.7,
      bounce: '#36B7F0',
      spec: 0.9,
      gloss: 60,
    },
    cloud: { lit: hex('#FFFFFF'), shade: hex('#A7D9F2'), rim: hex('#FFFFFF') },
    sun: { lit: hex('#FFE45C'), shade: hex('#FFAA1F') },
    backdrop: { day: [hex('#1F8FE0'), hex('#2AA4F0')], night: [hex('#07284A'), hex('#0B3A66')] },
    sheen: 0,
    dots: 0,
    dotColor: [0, 0, 0],
    card: { bg: '#1E8EE0', cube: ['#8BE6FF', '#4FD0FF', '#1BA5E6'], ink: '#FFFFFF' },
  },
  {
    id: 'karat',
    name: { en: 'Karat', vi: 'Vàng' },
    skin: {
      base: '#F2C04E',
      shade: '#7A4A0A',
      rim: '#FFF1C2',
      rimStrength: 0.8,
      bounce: '#B97A16',
      spec: 1,
      gloss: 90,
    },
    cloud: { lit: hex('#F7D57A'), shade: hex('#9C6516'), rim: hex('#FFF4CF') },
    sun: { lit: hex('#FFFFFF'), shade: hex('#F4E3BD') },
    backdrop: { day: [hex('#F3EDE2'), hex('#FBF8F2')], night: [hex('#1E1A12'), hex('#2B251A')] },
    sheen: 0,
    dots: 0,
    dotColor: [0, 0, 0],
    card: { bg: '#F1EBDF', cube: ['#FFE08A', '#E6AE36', '#A86C12'], ink: '#5A3A06' },
  },
  {
    id: 'sonmai',
    name: { en: 'Lacquer', vi: 'Sơn mài' },
    skin: {
      base: '#2A1E20',
      shade: '#070405',
      rim: '#D9A441',
      rimStrength: 0.9,
      bounce: '#8C2A1A',
      spec: 1,
      gloss: 110,
    },
    cloud: null,
    sun: { lit: hex('#FFD952'), shade: hex('#F7731A') },
    backdrop: null,
    sheen: 0,
    dots: 0,
    dotColor: [0, 0, 0],
    card: { bg: '#8C1D12', cube: ['#4A3236', '#2A1E20', '#140C0E'], ink: '#F4C76A' },
  },
  {
    id: 'ngoc',
    name: { en: 'Jade', vi: 'Ngọc' },
    skin: {
      base: '#6FCBA6',
      shade: '#1D5A47',
      rim: '#D8FFF0',
      bounce: '#2D8C6A',
      spec: 0.9,
      gloss: 80,
    },
    cloud: null,
    sun: { lit: hex('#FFD952'), shade: hex('#F7731A') },
    backdrop: null,
    sheen: 0,
    dots: 0,
    dotColor: [0, 0, 0],
    card: { bg: '#2D6E58', cube: ['#9AE3C4', '#6FCBA6', '#3E9C78'], ink: '#FFFFFF' },
  },
];

export const themeById = (id: ThemeId) => THEMES.find((t) => t.id === id) ?? THEMES[0];

const lum = (c: RGB) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const mix = (a: RGB, b: RGB, t: number): RGB => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/** A flat backdrop at a given night amount, as the sky palette's shape: top, bottom, dark */
export function themeBackdrop(theme: Theme, night: number) {
  if (!theme.backdrop) return null;
  const top = mix(theme.backdrop.day[0], theme.backdrop.night[0], night);
  const bottom = mix(theme.backdrop.day[1], theme.backdrop.night[1], night);
  return { top, bottom, dark: lum(mix(top, bottom, 0.5)) < 0.45 };
}
