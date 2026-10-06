import * as THREE from 'three/webgpu';

/**
 * A notebook page that folds into a paper plane, the classic dart, crease by crease. The page is
 * a fine grid; each fold turns the vertices on one side of its crease about that crease, on top of
 * every fold before it. Which vertices move is decided once, on the flat stack the earlier folds
 * leave (they all fold flat), so a fold also carries the flaps already lying on its side, just as
 * paper does. Units: the page is 1 wide and √2 tall (A4), nose at the top.
 */

export const PAGE_W = 1;
export const PAGE_H = Math.SQRT2;
const NX = 40;
const NY = 56;
/** How far each new layer sits off the one under it, so stacked paper doesn't flicker */
const LAYER = 0.0024;
/** Half the keel's depth: the wings fold down along lines this far either side of the spine */
export const KEEL = 0.085;

type Fold = {
  /** Two points on the crease, in the flat stack's coordinates when this fold is made */
  a: [number, number];
  b: [number, number];
  /** Which vertices this fold moves, given their flat position then and their index */
  moves: (x: number, y: number, i: number) => boolean;
  /** Toward the viewer (+1) or away (-1) */
  toward: 1 | -1;
  angle: number;
  /** Seconds this fold takes */
  duration: number;
};

export type PaperFolds = {
  geometry: THREE.BufferGeometry;
  /** Total seconds to fold it all */
  total: number;
  /** Write the page folded `t` seconds in (0 flat, total a plane) into the geometry */
  pose: (t: number, flutter?: number) => void;
  /** Which fold `t` is in, for a haptic at each crease */
  stepAt: (t: number) => number;
  /** When fold `k` starts */
  startOf: (k: number) => number;
};

export function buildPaper(): PaperFolds {
  const geometry = new THREE.PlaneGeometry(PAGE_W, PAGE_H, NX, NY);
  geometry.translate(0, PAGE_H / 2, 0);
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  position.setUsage(THREE.DynamicDrawUsage);
  const flat = new Float32Array(position.array as Float32Array);
  const count = position.count;
  /** Which half of the spine each vertex ended on before folding in half */
  const half = new Int8Array(count);

  const tan = Math.tan(Math.PI / 8);
  const yB = PAGE_H - PAGE_W / 2 / tan;
  const left = (ax: number, ay: number, bx: number, by: number, x: number, y: number) =>
    (bx - ax) * (y - ay) - (by - ay) * (x - ax);

  const folds: Fold[] = [
    // Top corners down to the spine
    {
      a: [0, PAGE_H],
      b: [-PAGE_W / 2, PAGE_H - PAGE_W / 2],
      moves: (x, y) => left(0, PAGE_H, -PAGE_W / 2, PAGE_H - PAGE_W / 2, x, y) < -1e-6,
      toward: 1,
      angle: Math.PI,
      duration: 0.46,
    },
    {
      a: [0, PAGE_H],
      b: [PAGE_W / 2, PAGE_H - PAGE_W / 2],
      moves: (x, y) => left(0, PAGE_H, PAGE_W / 2, PAGE_H - PAGE_W / 2, x, y) > 1e-6,
      toward: 1,
      angle: Math.PI,
      duration: 0.46,
    },
    // The new slanted edges to the spine again: a sharper nose
    {
      a: [0, PAGE_H],
      b: [-PAGE_W / 2, yB],
      moves: (x, y) => left(0, PAGE_H, -PAGE_W / 2, yB, x, y) < -1e-6,
      toward: 1,
      angle: Math.PI,
      duration: 0.42,
    },
    {
      a: [0, PAGE_H],
      b: [PAGE_W / 2, yB],
      moves: (x, y) => left(0, PAGE_H, PAGE_W / 2, yB, x, y) > 1e-6,
      toward: 1,
      angle: Math.PI,
      duration: 0.42,
    },
    // In half along the spine, away from you
    {
      a: [0, 0],
      b: [0, PAGE_H],
      moves: (x) => x < -1e-6,
      toward: -1,
      angle: Math.PI,
      duration: 0.52,
    },
    // The wings, one out toward you, one away, a little short of flat for some dihedral
    {
      a: [KEEL, 0],
      b: [KEEL, PAGE_H],
      moves: (x, _y, i) => half[i] > 0 && x > KEEL + 1e-6,
      toward: 1,
      angle: Math.PI / 2 - 0.12,
      duration: 0.38,
    },
    {
      a: [KEEL, 0],
      b: [KEEL, PAGE_H],
      moves: (x, _y, i) => half[i] < 0 && x > KEEL + 1e-6,
      toward: -1,
      angle: Math.PI / 2 - 0.12,
      duration: 0.38,
    },
  ];

  // Lay the grid onto the creases: a crease that cuts across cells leaves a sawtooth edge, so
  // every vertex within half a cell of a crease is moved onto it. Creases after the first lie on
  // folded paper, so each vertex carries the reflection that takes it from the flat page to
  // where it lies now, and is moved there and mapped back.
  const CELL = Math.max(PAGE_W / NX, PAGE_H / NY);
  const m = new Float64Array(count * 6);
  const snapped = new Uint8Array(count);
  for (let i = 0; i < count; i++) m.set([1, 0, 0, 1, 0, 0], i * 6);
  const apply = (i: number, x: number, y: number): [number, number] => {
    const k = i * 6;
    return [m[k] * x + m[k + 1] * y + m[k + 4], m[k + 2] * x + m[k + 3] * y + m[k + 5]];
  };
  folds.forEach((f, k) => {
    const ux0 = f.b[0] - f.a[0];
    const uy0 = f.b[1] - f.a[1];
    const len = Math.hypot(ux0, uy0);
    const ux = ux0 / len;
    const uy = uy0 / len;
    // A slanted crease passes further from the grid's vertices than a straight one
    const snap = 0.56 * CELL * (Math.abs(ux) + Math.abs(uy));
    for (let i = 0; i < count; i++) {
      const [px, py] = apply(i, flat[i * 3], flat[i * 3 + 1]);
      if (k === 4) half[i] = px < 0 ? -1 : 1;
      const d = (px - f.a[0]) * -uy + (py - f.a[1]) * ux;
      // The page's own edge stays put: moving it would dent the outline
      const ox = flat[i * 3];
      const oy = flat[i * 3 + 1];
      const rim = Math.abs(Math.abs(ox) - PAGE_W / 2) < 1e-6 || oy < 1e-6 || Math.abs(oy - PAGE_H) < 1e-6;
      if (rim || snapped[i] || Math.abs(d) > snap || Math.abs(d) < 1e-9) continue;
      // Onto the crease, then back through the vertex's reflection (an isometry: its inverse
      // is its transpose)
      const qx = px + d * uy;
      const qy = py - d * ux;
      const j = i * 6;
      const dx = qx - m[j + 4];
      const dy = qy - m[j + 5];
      flat[i * 3] = m[j] * dx + m[j + 2] * dy;
      flat[i * 3 + 1] = m[j + 1] * dx + m[j + 3] * dy;
      snapped[i] = 1;
    }
    if (f.angle < 3) return;
    // Who this flat fold reflects, and the reflection, added to theirs
    const r00 = 2 * ux * ux - 1;
    const r01 = 2 * ux * uy;
    const r11 = 2 * uy * uy - 1;
    const tx = f.a[0] - (r00 * f.a[0] + r01 * f.a[1]);
    const ty = f.a[1] - (r01 * f.a[0] + r11 * f.a[1]);
    for (let i = 0; i < count; i++) {
      const [px, py] = apply(i, flat[i * 3], flat[i * 3 + 1]);
      if (!f.moves(px, py, i)) continue;
      const j = i * 6;
      const [a, b, c, d, e, g] = [m[j], m[j + 1], m[j + 2], m[j + 3], m[j + 4], m[j + 5]];
      m[j] = r00 * a + r01 * c;
      m[j + 1] = r00 * b + r01 * d;
      m[j + 2] = r01 * a + r11 * c;
      m[j + 3] = r01 * b + r11 * d;
      m[j + 4] = r00 * e + r01 * g + tx;
      m[j + 5] = r01 * e + r11 * g + ty;
    }
  });
  // The texture follows the moved vertices
  const uvs = geometry.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < count; i++) uvs.setXY(i, flat[i * 3] / PAGE_W + 0.5, flat[i * 3 + 1] / PAGE_H);
  uvs.needsUpdate = true;

  // Fold it all once, flat, to learn who moves at each fold and where everything ends up
  const stages: Float32Array[] = [flat];
  const members: Uint8Array[] = [];
  const signs: number[] = [];
  const v = new THREE.Vector3();
  const axisD = new THREE.Vector3();
  const axisP = new THREE.Vector3();
  const q = new THREE.Quaternion();

  const rotate = (src: Float32Array, dst: Float32Array, k: number, theta: number, layer: number) => {
    const f = folds[k];
    axisP.set(f.a[0], f.a[1], 0);
    axisD.set(f.b[0] - f.a[0], f.b[1] - f.a[1], 0).normalize();
    q.setFromAxisAngle(axisD, theta * signs[k]);
    const m = members[k];
    dst.set(src);
    for (let i = 0; i < count; i++) {
      if (!m[i]) continue;
      v.set(src[i * 3] - axisP.x, src[i * 3 + 1] - axisP.y, src[i * 3 + 2]);
      v.applyQuaternion(q);
      dst[i * 3] = v.x + axisP.x;
      dst[i * 3 + 1] = v.y + axisP.y;
      dst[i * 3 + 2] = v.z + f.toward * layer;
    }
  };

  folds.forEach((f, k) => {
    const src = stages[k];
    if (k === 4) for (let i = 0; i < count; i++) half[i] = src[i * 3] < 0 ? -1 : 1;
    const m = new Uint8Array(count);
    let probe = -1;
    for (let i = 0; i < count; i++) {
      if (f.moves(src[i * 3], src[i * 3 + 1], i)) {
        m[i] = 1;
        if (probe < 0) probe = i;
      }
    }
    members.push(m);
    // Turn the way that takes the flap toward `toward`: try a quarter turn on one moving vertex
    axisD.set(f.b[0] - f.a[0], f.b[1] - f.a[1], 0).normalize();
    v.set(src[probe * 3] - f.a[0], src[probe * 3 + 1] - f.a[1], 0).applyAxisAngle(axisD, Math.PI / 2);
    signs.push(Math.sign(v.z) === f.toward ? 1 : -1);
    const dst = new Float32Array(src.length);
    rotate(src, dst, k, f.angle, f.angle > 3 ? LAYER * (k + 1) : 0);
    stages.push(dst);
  });

  const starts: number[] = [];
  let total = 0;
  for (const f of folds) {
    starts.push(total);
    total += f.duration + 0.07;
  }

  const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  const out = position.array as Float32Array;

  const stepAt = (t: number) => {
    let k = 0;
    while (k + 1 < folds.length && t >= starts[k + 1]) k++;
    return k;
  };

  const pose = (t: number, flutter = 0) => {
    if (t <= 0) {
      out.set(flat);
      // A page held in a breeze: a slow ripple, stronger toward the top
      if (flutter > 0) {
        for (let i = 0; i < count; i++) {
          const x = flat[i * 3];
          const y = flat[i * 3 + 1];
          out[i * 3 + 2] =
            Math.sin(y * 2.4 + flutter * 1.7 + x * 1.3) * 0.018 * (y / PAGE_H) + Math.sin(x * 3 + flutter) * 0.006;
        }
      }
    } else if (t >= total) {
      out.set(stages[folds.length]);
    } else {
      const k = stepAt(t);
      const p = Math.min(1, (t - starts[k]) / folds[k].duration);
      const e = ease(p);
      const f = folds[k];
      rotate(stages[k], out, k, f.angle * e, f.angle > 3 ? LAYER * (k + 1) * e : 0);
    }
    position.needsUpdate = true;
    geometry.computeBoundingSphere();
  };

  pose(0);
  return { geometry, total, pose, stepAt, startOf: (k) => starts[k] };
}
