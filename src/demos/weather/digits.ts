import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Puffy numerals: each glyph is a few strokes swept with a fat round tube and capped with
 * spheres, like a balloon twisted into a digit. Glyph boxes are 1 wide (narrower for 1, °, %,
 * -, .) and 1.6 tall, origin at the bottom left; geometries are centred and cached.
 */

/** Fat strokes: chunky, toy-like numerals rather than neon tubes */
const TUBE = 0.24;
export const GLYPH_HEIGHT = 1.6 + TUBE * 2;

type P = [number, number];

function arc(cx: number, cy: number, r: number, from: number, to: number, n = 28): P[] {
  const pts: P[] = [];
  for (let i = 0; i <= n; i++) {
    const a = THREE.MathUtils.degToRad(from + ((to - from) * i) / n);
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return pts;
}

/** A polyline with every corner rounded off by a quadratic fillet of size `f` */
function rounded(corners: P[], f: number, closed = false): P[] {
  const out: P[] = [];
  const n = corners.length;
  for (let i = 0; i < n; i++) {
    const b = corners[i];
    const a = corners[(i - 1 + n) % n];
    const c = corners[(i + 1) % n];
    if (!closed && (i === 0 || i === n - 1)) {
      out.push(b);
      continue;
    }
    const la = Math.hypot(a[0] - b[0], a[1] - b[1]);
    const lc = Math.hypot(c[0] - b[0], c[1] - b[1]);
    const fa = Math.min(f, la / 2);
    const fc = Math.min(f, lc / 2);
    const p0: P = [b[0] + ((a[0] - b[0]) / la) * fa, b[1] + ((a[1] - b[1]) / la) * fa];
    const p2: P = [b[0] + ((c[0] - b[0]) / lc) * fc, b[1] + ((c[1] - b[1]) / lc) * fc];
    for (let k = 0; k <= 8; k++) {
      const t = k / 8;
      const u = 1 - t;
      out.push([u * u * p0[0] + 2 * u * t * b[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * b[1] + t * t * p2[1]]);
    }
  }
  return out;
}

function bezier(a: P, c: P, b: P, n = 20): P[] {
  const pts: P[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    pts.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]);
  }
  return pts;
}

type Stroke = { pts: P[]; closed?: boolean; tube?: number };
type Glyph = { width: number; strokes: Stroke[]; dots?: { at: P; r: number }[] };

const SIX: Stroke[] = [
  { pts: arc(0.5, 0.5, 0.5, 0, 360, 48).slice(0, -1), closed: true },
  { pts: bezier([0.82, 1.6], [0.12, 1.3], [0.02, 0.5]) },
];
const rotate180 = (s: Stroke): Stroke => ({ ...s, pts: s.pts.map(([x, y]) => [1 - x, 1.6 - y] as P) });

const GLYPHS: Record<string, Glyph> = {
  '0': {
    width: 1,
    strokes: [
      {
        pts: rounded(
          [
            [0, 0],
            [1, 0],
            [1, 1.6],
            [0, 1.6],
          ],
          0.5,
          true
        ),
        closed: true,
      },
    ],
  },
  '1': {
    width: 0.7,
    strokes: [
      {
        pts: rounded(
          [
            [0, 1.25],
            [0.45, 1.6],
            [0.45, 0],
          ],
          0.14
        ),
      },
    ],
  },
  '2': {
    width: 1,
    strokes: [
      {
        pts: [
          ...arc(0.5, 1.1, 0.5, 165, -35, 28),
          ...rounded(
            [
              [0.9, 0.81],
              [0, 0],
              [1, 0],
            ],
            0.12
          ).slice(1),
        ],
      },
    ],
  },
  '3': {
    width: 1,
    strokes: [{ pts: arc(0.5, 1.2, 0.4, 150, -90, 26) }, { pts: arc(0.5, 0.4, 0.42, 90, -150, 30) }],
  },
  '4': {
    width: 1,
    strokes: [
      {
        pts: rounded(
          [
            [0.76, 0],
            [0.76, 1.6],
            [0, 0.5],
            [1.02, 0.5],
          ],
          0.1
        ),
      },
    ],
  },
  '5': {
    width: 1,
    strokes: [
      {
        pts: rounded(
          [
            [0.92, 1.6],
            [0.12, 1.6],
            [0.06, 0.92],
          ],
          0.12
        ),
      },
      { pts: arc(0.5, 0.5, 0.5, 125, -150, 34) },
    ],
  },
  '6': { width: 1, strokes: SIX },
  '7': {
    width: 1,
    strokes: [
      {
        pts: rounded(
          [
            [0, 1.6],
            [1, 1.6],
            [0.32, 0],
          ],
          0.1
        ),
      },
    ],
  },
  '8': {
    width: 1,
    strokes: [
      { pts: arc(0.5, 1.22, 0.38, 0, 360, 40).slice(0, -1), closed: true },
      { pts: arc(0.5, 0.46, 0.46, 0, 360, 44).slice(0, -1), closed: true },
    ],
  },
  '9': { width: 1, strokes: SIX.map(rotate180) },
  '-': {
    width: 0.75,
    strokes: [
      {
        pts: [
          [0.05, 0.8],
          [0.7, 0.8],
        ],
      },
    ],
  },
  '°': { width: 0.6, strokes: [{ pts: arc(0.3, 1.32, 0.25, 0, 360, 28).slice(0, -1), closed: true, tube: 0.14 }] },
  '%': {
    width: 1,
    strokes: [
      { pts: arc(0.2, 1.36, 0.22, 0, 360, 24).slice(0, -1), closed: true, tube: 0.13 },
      { pts: arc(0.8, 0.24, 0.22, 0, 360, 24).slice(0, -1), closed: true, tube: 0.13 },
      {
        pts: [
          [0.95, 1.6],
          [0.05, 0],
        ],
        tube: 0.13,
      },
    ],
  },
  '.': { width: 0.3, strokes: [], dots: [{ at: [0.15, 0.08], r: 0.22 }] },
};

/** Height of a numeral in glyph units, tube included */
export const glyphHeight = () => GLYPH_HEIGHT;

export function glyphWidth(ch: string) {
  return GLYPHS[ch]?.width ?? 0.6;
}

const cache = new Map<string, THREE.BufferGeometry>();

/** Centred geometry for a character */
export function glyphGeometry(ch: string) {
  const hit = cache.get(ch);
  if (hit) return hit;
  const g = GLYPHS[ch];
  const parts: THREE.BufferGeometry[] = [];
  if (g) {
    for (const s of g.strokes) {
      const r = s.tube ?? TUBE;
      const pts = s.pts.map(([x, y]) => new THREE.Vector3(x, y, 0));
      const curve = new THREE.CatmullRomCurve3(pts, !!s.closed, 'centripetal');
      const segments = Math.max(12, Math.ceil(curve.getLength() * 44));
      parts.push(new THREE.TubeGeometry(curve, segments, r, 14, !!s.closed));
      if (!s.closed) {
        for (const end of [pts[0], pts[pts.length - 1]]) {
          parts.push(new THREE.SphereGeometry(r, 16, 12).translate(end.x, end.y, end.z));
        }
      }
    }
    for (const d of g.dots ?? []) parts.push(new THREE.SphereGeometry(d.r, 18, 14).translate(d.at[0], d.at[1], 0));
  }
  const geometry = parts.length ? mergeGeometries(parts) : new THREE.BufferGeometry();
  geometry.translate(-(g?.width ?? 0) / 2, -0.8, 0);
  geometry.computeBoundingSphere();
  cache.set(ch, geometry);
  return geometry;
}

/** Space between glyphs: the fat strokes need room */
const GAP = 0.6;

type Slot = {
  ch: string;
  mesh: THREE.Mesh;
  s: number;
  v: number;
  target: number;
  x: number;
  phase: number;
  /** Spin about the vertical axis, springing towards `spinTo` (a tap adds a full turn) */
  spin: number;
  spinV: number;
  spinTo: number;
  /** Squash and stretch from a tap */
  squash: number;
  squashV: number;
};

/**
 * A row of numerals that swaps characters with a springy pop: a changed glyph shrinks away
 * while its replacement bounces in.
 */
export class DigitRow {
  readonly group = new THREE.Group();
  private slots: Slot[] = [];
  private leaving: Slot[] = [];
  private text = '';
  /** Width of the current text, in glyph units */
  width = 0;
  constructor(private material: THREE.Material) {}

  get value() {
    return this.text;
  }

  setText(text: string) {
    if (text === this.text) return;
    const chars = [...text];
    const widths = chars.map(glyphWidth);
    const gap = GAP;
    const total = widths.reduce((a, w) => a + w, 0) + gap * Math.max(0, chars.length - 1);
    // The tubes bulge past the glyph boxes at both ends
    this.width = total + TUBE * 2;
    let x = -total / 2;
    const next: Slot[] = [];
    chars.forEach((ch, i) => {
      const cx = x + widths[i] / 2;
      x += widths[i] + gap;
      const old = this.slots[i];
      if (old && old.ch === ch) {
        old.x = cx;
        next.push(old);
        return;
      }
      if (old) this.retire(old);
      const mesh = new THREE.Mesh(glyphGeometry(ch), this.material);
      mesh.scale.setScalar(0.001);
      mesh.position.x = cx;
      this.group.add(mesh);
      next.push({
        ch,
        mesh,
        s: 0,
        v: 0,
        target: 1,
        x: cx,
        phase: i * 0.9 + Math.random(),
        spin: 0,
        spinV: 0,
        spinTo: 0,
        squash: 0,
        squashV: 0,
      });
    });
    for (let i = chars.length; i < this.slots.length; i++) this.retire(this.slots[i]);
    this.slots = next;
    this.text = text;
  }

  /**
   * A tapped glyph squashes, then springs up and spins a full turn. Hit-tested against each
   * glyph's whole box rather than its thin tubes, so a tap inside the "0" counts.
   */
  poke(ray: THREE.Raycaster) {
    const box = new THREE.Box3();
    const slot = this.slots.find((s) => {
      const g = s.mesh.geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      box.copy(g.boundingBox!).expandByScalar(0.08).applyMatrix4(s.mesh.matrixWorld);
      return ray.ray.intersectsBox(box);
    });
    if (!slot) return false;
    slot.spinTo += Math.PI * 2;
    slot.squashV -= 9;
    return true;
  }

  /** Every glyph hops in a wave, from the left */
  wave() {
    this.slots.forEach((slot, i) => {
      slot.squashV -= 6 + i;
      slot.spinTo += Math.PI * 2;
    });
  }

  private retire(slot: Slot) {
    slot.target = 0;
    this.leaving.push(slot);
  }

  update(dt: number, t: number) {
    const step = (slot: Slot) => {
      // Under-damped spring: a little overshoot reads as "boing"
      slot.v += ((slot.target - slot.s) * 260 - slot.v * 18) * dt;
      slot.s += slot.v * dt;
      const s = Math.max(0.001, slot.s);
      slot.squashV += (-slot.squash * 300 - slot.squashV * 13) * dt;
      slot.squash += slot.squashV * dt;
      const q = THREE.MathUtils.clamp(slot.squash, -0.45, 0.45);
      // Volume-preserving: squat and wide, then tall and thin
      slot.mesh.scale.set(s * (1 - q * 0.6), s * (1 + q), s * (1 - q * 0.6));
      slot.spinV += ((slot.spinTo - slot.spin) * 70 - slot.spinV * 11) * dt;
      slot.spin += slot.spinV * dt;
      slot.mesh.rotation.y = slot.spin;
    };
    for (const slot of this.slots) {
      step(slot);
      slot.mesh.position.x += (slot.x - slot.mesh.position.x) * Math.min(1, dt * 14);
      slot.mesh.position.y = Math.sin(t * 1.4 + slot.phase) * 0.035;
      slot.mesh.rotation.z = Math.sin(t * 0.9 + slot.phase) * 0.025;
    }
    this.leaving = this.leaving.filter((slot) => {
      step(slot);
      if (slot.s < 0.02 && slot.v <= 0) {
        this.group.remove(slot.mesh);
        return false;
      }
      return true;
    });
  }
}
