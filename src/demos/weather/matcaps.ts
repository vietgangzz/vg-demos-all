import * as THREE from 'three/webgpu';

/**
 * Procedural matcaps: each material's whole lighting baked into a little sphere image, looked up
 * by the surface normal. They look like a studio product render (soft key, rim, glossy
 * highlights) at the cost of one texture read, and need no lights, shadow maps or environment
 * maps, none of which survive react-native-webgpu's direct-to-canvas rendering.
 */

type RGB = [number, number, number];

export type MatcapSpec = {
  base: string;
  /** Colour on the side turned away from the key light */
  shade: string;
  /** Fresnel edge light */
  rim: string;
  rimStrength?: number;
  /** Light bounced up from below */
  bounce?: string;
  /** 0..1 highlight strength, and its sharpness */
  spec: number;
  gloss: number;
  /** 0..1 mother-of-pearl rainbow sheen */
  pearl?: number;
};

const SIZE = 128;

const rgb = (hex: string): RGB => [
  parseInt(hex.slice(1, 3), 16) / 255,
  parseInt(hex.slice(3, 5), 16) / 255,
  parseInt(hex.slice(5, 7), 16) / 255,
];

function hue(h: number): RGB {
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    return 0.5 - 0.5 * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

const KEY = new THREE.Vector3(-0.45, 0.62, 0.64).normalize();
const FILL = new THREE.Vector3(0.75, 0.15, 0.64).normalize();
const halfway = (l: THREE.Vector3) =>
  l
    .clone()
    .add(new THREE.Vector3(0, 0, 1))
    .normalize();
const H_KEY = halfway(KEY);
const H_FILL = halfway(FILL);

/** Write the matcap for `spec` into `out` (SIZE × SIZE RGBA) */
function paint(spec: MatcapSpec, out: Uint8Array) {
  const base = rgb(spec.base);
  const shade = rgb(spec.shade);
  const rim = rgb(spec.rim);
  const bounce = rgb(spec.bounce ?? spec.shade);
  const rimStrength = spec.rimStrength ?? 0.6;
  const pearl = spec.pearl ?? 0;
  for (let j = 0; j < SIZE; j++) {
    for (let i = 0; i < SIZE; i++) {
      let x = ((i + 0.5) / SIZE) * 2 - 1;
      let y = ((j + 0.5) / SIZE) * 2 - 1;
      const r = Math.hypot(x, y);
      if (r > 0.995) {
        x *= 0.995 / r;
        y *= 0.995 / r;
      }
      const z = Math.sqrt(Math.max(0, 1 - x * x - y * y));
      const key = x * KEY.x + y * KEY.y + z * KEY.z;
      // Half-Lambert: soft, wrapping light like a big softbox
      const wrap = Math.pow(Math.max(0, key * 0.5 + 0.5), 1.6);
      const c: RGB = [
        shade[0] + (base[0] - shade[0]) * wrap,
        shade[1] + (base[1] - shade[1]) * wrap,
        shade[2] + (base[2] - shade[2]) * wrap,
      ];
      if (pearl > 0) {
        const sheen = hue((0.58 + (1 - z) * 0.85 + y * 0.18 + x * 0.1) % 1);
        const amount = pearl * (0.25 + 0.75 * (1 - z));
        for (let k = 0; k < 3; k++) c[k] = c[k] * (1 - amount * 0.55) + sheen[k] * amount * 0.55 * (0.6 + wrap * 0.6);
      }
      const under = Math.max(0, -y) * (1 - z) * 0.5;
      const fresnel = Math.pow(1 - z, 3) * rimStrength;
      const sKey = Math.pow(Math.max(0, x * H_KEY.x + y * H_KEY.y + z * H_KEY.z), spec.gloss) * spec.spec;
      const sFill =
        Math.pow(Math.max(0, x * H_FILL.x + y * H_FILL.y + z * H_FILL.z), spec.gloss * 0.7) * spec.spec * 0.35;
      const p = (j * SIZE + i) * 4;
      for (let k = 0; k < 3; k++) {
        const v = c[k] + bounce[k] * under + rim[k] * fresnel + sKey + sFill;
        out[p + k] = Math.round(Math.min(1, Math.max(0, v)) * 255);
      }
      out[p + 3] = 255;
    }
  }
}

export function matcap(spec: MatcapSpec) {
  const data = new Uint8Array(SIZE * SIZE * 4);
  paint(spec, data);
  const texture = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

/** Repaint an existing matcap in place: no new texture, no shader rebuild */
export function repaint(texture: THREE.DataTexture, spec: MatcapSpec) {
  paint(spec, texture.image.data as Uint8Array);
  texture.needsUpdate = true;
}

/**
 * Skins for the numerals and gadgets, after Vietnamese craft materials: porcelain, lacquer,
 * jade and mother-of-pearl inlay.
 */
export type SkinId = 'su' | 'sonmai' | 'ngoc' | 'xacu';

export const SKINS: Record<SkinId, MatcapSpec & { swatch: string }> = {
  su: {
    swatch: '#F3F1EC',
    base: '#F7F5F0',
    shade: '#9BA7BA',
    rim: '#FFFFFF',
    bounce: '#B9CBE6',
    spec: 0.85,
    gloss: 70,
  },
  sonmai: {
    swatch: '#1B1416',
    base: '#2A1E20',
    shade: '#070405',
    rim: '#D9A441',
    rimStrength: 0.9,
    bounce: '#8C2A1A',
    spec: 1,
    gloss: 110,
  },
  ngoc: {
    swatch: '#5DBE98',
    base: '#6FCBA6',
    shade: '#1D5A47',
    rim: '#D8FFF0',
    bounce: '#2D8C6A',
    spec: 0.9,
    gloss: 80,
  },
  xacu: {
    swatch: '#E6E1F0',
    base: '#EEEAF5',
    shade: '#8A86A6',
    rim: '#FFFFFF',
    spec: 0.9,
    gloss: 90,
    pearl: 0.9,
  },
};

export const SKIN_ORDER: SkinId[] = ['su', 'sonmai', 'ngoc', 'xacu'];

/** Fixed materials of the sky itself */
export const SKY_MATCAPS = {
  cloud: {
    base: '#FFFFFF',
    shade: '#B3BFD2',
    rim: '#FFFFFF',
    rimStrength: 0.35,
    bounce: '#DCE6F5',
    spec: 0.12,
    gloss: 6,
  },
  sun: {
    base: '#FFD25A',
    shade: '#F26A2E',
    rim: '#FFF1B8',
    rimStrength: 0.7,
    bounce: '#FF9A3C',
    spec: 0.55,
    gloss: 30,
  },
  moon: { base: '#F1EFE6', shade: '#7F879E', rim: '#FFFFFF', rimStrength: 0.5, spec: 0.15, gloss: 10 },
  drop: { base: '#7CC4FF', shade: '#1F5FD1', rim: '#D7EEFF', rimStrength: 0.8, spec: 1, gloss: 80 },
  snow: { base: '#FFFFFF', shade: '#BCCBE0', rim: '#FFFFFF', spec: 0.3, gloss: 12 },
  dust: { base: '#E8C792', shade: '#9C7448', rim: '#FFF0D2', spec: 0.2, gloss: 10 },
  bubble: { base: '#FFFFFF', shade: '#9EA9BC', rim: '#FFFFFF', rimStrength: 1, spec: 1, gloss: 90, pearl: 0.6 },
} satisfies Record<string, MatcapSpec>;
