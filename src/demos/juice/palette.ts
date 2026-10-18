import * as THREE from 'three/webgpu';

/**
 * The light inside at each level, in three tones from the bottom of the liquid up to its surface,
 * the way a flame runs through colours rather than holding one: low it's a fire (deep magenta-red
 * into ember into gold), half full a sun (orange into gold into pale yellow), nearly full a spring
 * (teal into green into lime), topped up a cool mint (blue into mint into white). Mixed in sRGB
 * (it looks even to the eye), handed to the GPU in linear light.
 */
const TONES: [number, number, number, number][] = [
  [0.0, 0xb0124e, 0xff2e3a, 0xff8a3c],
  [0.15, 0xc2185b, 0xff4a2a, 0xffb13b],
  [0.3, 0xe0306a, 0xff7f1e, 0xffd045],
  [0.5, 0xff5a2a, 0xffb616, 0xffee7a],
  [0.65, 0xf09a1a, 0xd8ee32, 0xf4ff9a],
  [0.8, 0x0fa88f, 0x4fea5e, 0xd8ff70],
  [1.0, 0x1477e0, 0x26eab0, 0xc6fff0],
];

const channels = (hex: number) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255] as const;

/** One of the three tones (1 deep, 2 the body, 3 the surface) at `level`, in sRGB 0..255 */
function srgb(level: number, tone: 1 | 2 | 3) {
  const l = Math.min(1, Math.max(0, level));
  let i = 0;
  while (i < TONES.length - 2 && l > TONES[i + 1][0]) i++;
  const t = (l - TONES[i][0]) / (TONES[i + 1][0] - TONES[i][0]);
  const s = t * t * (3 - 2 * t);
  const a = channels(TONES[i][tone]);
  const b = channels(TONES[i + 1][tone]);
  return [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s] as const;
}

const toLinear = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};

function linear(level: number, tone: 1 | 2 | 3, out: THREE.Color) {
  const [r, g, b] = srgb(level, tone);
  return out.setRGB(toLinear(r), toLinear(g), toLinear(b));
}

/** The charge's colour at `level` (0..1): the body of the liquid, in linear light */
export function chargeColour(level: number, out = new THREE.Color()) {
  return linear(level, 2, out);
}

/** The colour it runs to at the surface, where it's hottest */
export function hotColour(level: number, out = new THREE.Color()) {
  return linear(level, 3, out);
}

/** The colour it deepens to at the bottom, and out at the edges of its glow */
export function deepColour(level: number, out = new THREE.Color()) {
  return linear(level, 1, out);
}

/** The charge's colour for the interface, as a CSS string, optionally see-through */
export function chargeCss(level: number, alpha = 1) {
  const [r, g, b] = srgb(level, 2);
  return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${alpha})`;
}
