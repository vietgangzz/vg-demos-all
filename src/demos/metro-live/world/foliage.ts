import * as THREE from 'three/webgpu';

import { mulberry32 } from './geometry';

/**
 * Foliage assets: leaf, palm and flower textures plus five palm tree meshes from Quaternius'
 * CC0 "Ultimate Stylized Nature" pack, baked by scripts/foliage/build.mjs. Textures arrive as raw
 * RGBA (no image decoder on react-native-webgpu) and every mesh carries a `leaf` attribute:
 * 0 for solid parts (canopy core, trunk), > 0 for alpha-tested leaf cards, scaled as brightness.
 */
type Part = { p: number[]; n: number[]; uv: number[]; i: number[] };
type FoliageData = {
  textures: Record<'leaf' | 'palm' | 'flowers', { w: number; h: number; rgba: string }>;
  palms: { trunk: Part; fronds: Part }[];
};
const DATA: FoliageData = require('../data/foliage.json');

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function decode(base64: string) {
  const lookup = new Uint8Array(128);
  for (let i = 0; i < B64.length; i++) lookup[B64.charCodeAt(i)] = i;
  const clean = base64.replace(/=+$/, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = lookup[clean.charCodeAt(i)];
    const b = lookup[clean.charCodeAt(i + 1)];
    const c = lookup[clean.charCodeAt(i + 2)];
    const d = lookup[clean.charCodeAt(i + 3)];
    out[o++] = (a << 2) | (b >> 4);
    if (o < out.length) out[o++] = ((b & 15) << 4) | (c >> 2);
    if (o < out.length) out[o++] = ((c & 3) << 6) | d;
  }
  return out;
}

const textures = new Map<string, THREE.DataTexture>();
export function foliageTexture(name: keyof FoliageData['textures']) {
  let tex = textures.get(name);
  if (!tex) {
    const { w, h, rgba } = DATA.textures[name];
    tex = new THREE.DataTexture(decode(rgba), w, h, THREE.RGBAFormat);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.needsUpdate = true;
    textures.set(name, tex);
  }
  return tex;
}

function withLeaf(geo: THREE.BufferGeometry, leaf: number[] | number) {
  const count = geo.getAttribute('position').count;
  const values = typeof leaf === 'number' ? new Float32Array(count).fill(leaf) : new Float32Array(leaf);
  geo.setAttribute('leaf', new THREE.BufferAttribute(values, 1));
  return geo;
}

function concat(parts: THREE.BufferGeometry[]) {
  const names = ['position', 'normal', 'uv', 'leaf'] as const;
  const out = new THREE.BufferGeometry();
  for (const name of names) {
    const arrays = parts.map((g) => g.getAttribute(name).array as Float32Array);
    const merged = new Float32Array(arrays.reduce((n, a) => n + a.length, 0));
    let o = 0;
    for (const a of arrays) {
      merged.set(a, o);
      o += a.length;
    }
    out.setAttribute(name, new THREE.BufferAttribute(merged, parts[0].getAttribute(name).itemSize));
  }
  return out;
}

/**
 * A broadleaf crown about 2.4 units across, centred 1.45 up: a dark, lumpy core that fills the
 * gaps, wrapped in ~30 leaf-cluster cards facing every way. Card normals point out from the crown
 * centre, so the whole tree lights as one soft ball while the cut-out leaves fray its outline.
 * Cards are two single-sided quads back to back (no double-sided normal flip).
 */
export function leafCrownGeometry() {
  const rand = mulberry32(7);
  const centre = new THREE.Vector3(0, 1.45, 0);
  const core = [
    [0, 1.42, 0, 0.82],
    [0.12, 1.92, -0.06, 0.56],
  ].map(([x, y, z, r]) => withLeaf(new THREE.IcosahedronGeometry(r, 1).translate(x, y, z), 0));

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const leaf: number[] = [];
  const CARDS = 30;
  const dir = new THREE.Vector3();
  const facing = new THREE.Vector3();
  const u = new THREE.Vector3();
  const v = new THREE.Vector3();
  const corner = new THREE.Vector3();
  const n = new THREE.Vector3();
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < CARDS; i++) {
    // Fibonacci sphere, denser on top and thinned underneath where nobody looks
    const y = 1 - ((i + 0.5) / CARDS) * 1.6;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    dir.set(Math.cos(i * golden) * r, y, Math.sin(i * golden) * r);
    const reach = 0.78 + rand() * 0.2;
    const c = centre.clone().add(new THREE.Vector3(dir.x * reach, dir.y * reach * 0.88 + 0.08, dir.z * reach));
    // Mostly facing out, tilted at random so the silhouette frays from any view
    facing
      .copy(dir)
      .add(new THREE.Vector3(rand() - 0.5, rand() - 0.5 + 0.3, rand() - 0.5).multiplyScalar(1.3))
      .normalize();
    u.set(0, 1, 0).cross(facing);
    if (u.lengthSq() < 1e-3) u.set(1, 0, 0);
    u.normalize().applyAxisAngle(facing, rand() * Math.PI * 2);
    v.crossVectors(facing, u).normalize();
    const half = 0.56 + rand() * 0.16;
    const shade = 0.9 + rand() * 0.22;
    const quad = [
      [-1, -1, 0, 1],
      [1, -1, 1, 1],
      [1, 1, 1, 0],
      [-1, 1, 0, 0],
    ];
    const corners = quad.map(([a, b, cu, cv]) => {
      corner
        .copy(c)
        .addScaledVector(u, a * half)
        .addScaledVector(v, b * half);
      n.copy(corner).sub(centre).normalize();
      return { p: corner.clone(), n: n.clone(), uv: [cu, cv] };
    });
    // Front (counter-clockwise seen along -facing) and back faces
    for (const order of [
      [0, 1, 2, 0, 2, 3],
      [0, 2, 1, 0, 3, 2],
    ]) {
      for (const k of order) {
        const q = corners[k];
        positions.push(q.p.x, q.p.y, q.p.z);
        normals.push(q.n.x, q.n.y, q.n.z);
        uvs.push(q.uv[0], q.uv[1]);
        leaf.push(shade);
      }
    }
  }
  const cards = new THREE.BufferGeometry();
  cards.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  cards.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  cards.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  cards.setAttribute('leaf', new THREE.Float32BufferAttribute(leaf, 1));
  return concat([...core.map((g) => (g.index ? g.toNonIndexed() : g)), cards]);
}

/** Palm variant `i` (0–4), 1 unit tall with its trunk base at the origin: trunk leaf 0, fronds 1 */
export function palmGeometry(i: number) {
  const { trunk, fronds } = DATA.palms[i % DATA.palms.length];
  const part = (src: Part, leaf: number) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(src.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(src.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(src.uv, 2));
    g.setIndex(src.i);
    return withLeaf(g.toNonIndexed(), leaf);
  };
  return concat([part(trunk, 0), part(fronds, 1)]);
}

export const PALM_VARIANTS = DATA.palms.length;

/**
 * A flower bed about 2 units across: a low cushion of leaf cards with blossoms scattered over it,
 * drawn from the 2×3 flower atlas (four flowers on top, two leaves along the bottom row).
 */
export function flowerBedGeometry(seed: number) {
  const rand = mulberry32(seed);
  const positions: number[] = [];
  const uvs: number[] = [];
  const normals: number[] = [];
  const add = (x: number, y: number, z: number, size: number, cell: number, tilt: number) => {
    const col = cell % 2;
    const row = Math.floor(cell / 2);
    const u0 = col / 2 + 0.01;
    const u1 = (col + 1) / 2 - 0.01;
    const v0 = row / 3 + 0.01;
    const v1 = (row + 1) / 3 - 0.01;
    const yaw = rand() * Math.PI * 2;
    const ca = Math.cos(yaw) * size;
    const sa = Math.sin(yaw) * size;
    const corners: [number, number, number, number, number][] = [
      [-ca + sa, -tilt, -sa - ca, u0, v1],
      [ca + sa, -tilt, sa - ca, u1, v1],
      [ca - sa, tilt, sa + ca, u1, v0],
      [-ca - sa, tilt, -sa + ca, u0, v0],
    ];
    for (const k of [0, 2, 1, 0, 3, 2]) {
      const [dx, dy, dz, cu, cv] = corners[k];
      positions.push(x + dx, y + dy, z + dz);
      uvs.push(cu, cv);
      normals.push(0, 1, 0);
    }
  };
  for (let i = 0; i < 9; i++) {
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand()) * 0.75;
    add(Math.cos(a) * r, 0.05 + rand() * 0.03, Math.sin(a) * r, 0.42, 4 + (i % 2), 0.05);
  }
  const palette = Math.floor(rand() * 4);
  for (let i = 0; i < 16; i++) {
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand()) * 0.85;
    // Beds are planted in one or two colours, like the city's real ones
    const cell = rand() < 0.75 ? palette : Math.floor(rand() * 4);
    add(Math.cos(a) * r, 0.11 + rand() * 0.05, Math.sin(a) * r, 0.2 + rand() * 0.08, cell, 0.03);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  return g;
}
