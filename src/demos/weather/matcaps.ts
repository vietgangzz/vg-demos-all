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

/**
 * What every matcap shares, per pixel: the sphere's lighting terms. Worked out once, so a repaint
 * (a skin switch) is a few multiplies a pixel rather than a page of maths.
 */
const terms = (() => {
  const n = SIZE * SIZE;
  const t = {
    wrap: new Float32Array(n),
    under: new Float32Array(n),
    edge: new Float32Array(n),
    /** log of the half-vector dots, so a highlight of any gloss is one exp */
    logKey: new Float32Array(n),
    logFill: new Float32Array(n),
    sheen: new Float32Array(n * 3),
  };
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
      const k = j * SIZE + i;
      const key = x * KEY.x + y * KEY.y + z * KEY.z;
      // Half-Lambert: soft, wrapping light like a big softbox
      t.wrap[k] = Math.pow(Math.max(0, key * 0.5 + 0.5), 1.6);
      t.under[k] = Math.max(0, -y) * (1 - z) * 0.5;
      t.edge[k] = 1 - z;
      t.logKey[k] = Math.log(Math.max(1e-6, x * H_KEY.x + y * H_KEY.y + z * H_KEY.z));
      t.logFill[k] = Math.log(Math.max(1e-6, x * H_FILL.x + y * H_FILL.y + z * H_FILL.z));
      const sheen = hue((0.58 + (1 - z) * 0.85 + y * 0.18 + x * 0.1) % 1);
      t.sheen.set(sheen, k * 3);
    }
  }
  return t;
})();

/** Write the matcap for `spec` into `out` (SIZE × SIZE RGBA) */
function paint(spec: MatcapSpec, out: Uint8Array) {
  const base = rgb(spec.base);
  const shade = rgb(spec.shade);
  const rim = rgb(spec.rim);
  const bounce = rgb(spec.bounce ?? spec.shade);
  const rimStrength = spec.rimStrength ?? 0.6;
  const pearl = spec.pearl ?? 0;
  const { wrap, under, edge, logKey, logFill, sheen } = terms;
  for (let k = 0; k < SIZE * SIZE; k++) {
    const w = wrap[k];
    const e = edge[k];
    const fresnel = e * e * e * rimStrength;
    const spec1 =
      Math.exp(logKey[k] * spec.gloss) * spec.spec + Math.exp(logFill[k] * spec.gloss * 0.7) * spec.spec * 0.35;
    const amount = pearl * (0.25 + 0.75 * e);
    const p = k * 4;
    for (let c = 0; c < 3; c++) {
      let v = shade[c] + (base[c] - shade[c]) * w;
      if (pearl > 0) v = v * (1 - amount * 0.55) + sheen[k * 3 + c] * amount * 0.55 * (0.6 + w * 0.6);
      v += bounce[c] * under[k] + rim[c] * fresnel + spec1;
      out[p + c] = v <= 0 ? 0 : v >= 1 ? 255 : (v * 255 + 0.5) | 0;
    }
    out[p + 3] = 255;
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
