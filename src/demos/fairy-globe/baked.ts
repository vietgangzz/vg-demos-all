import * as TSL from 'three/tsl';
import * as THREE from 'three/webgpu';

import { haze, hex, radial, shade, SNOWFIELD } from './light';
import { decode, texture, type Field } from './world';

/**
 * Scenes baked in Blender (scripts/blender/xmas_kit.py): the mesh with its lightmap UVs, its colour,
 * what glows on it, and its light in layers that can each be turned up and down while it runs.
 *
 * All colour is linear here. The room's post pass turns it into the screen's; the town, which
 * stands on the globe and is drawn with it, does it in its own materials (display()).
 */

const { vec3, pow, uv, sin, smoothstep, time } = TSL;
type V3 = THREE.Node<'vec3'>;

export type Packed = {
  p: string;
  lo: number[];
  hi: number[];
  uv: string;
  i: string;
  wide: boolean;
  /** On roofs, where a point is on its slope in metres (along the rows, down from the top); 65535 off them */
  t?: string;
  tscale?: number;
};
export type Lit = { p: string; n: string; c: string; i: string; wide: boolean };
export type V = [number, number, number];
export type BakedPart = { mesh: Packed; light: Record<string, number> };

export function bytes(b64: string) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function bakedGeometry(d: Packed) {
  const q = new Uint16Array(bytes(d.p).buffer);
  const pos = new Float32Array(q.length);
  for (let k = 0; k < q.length; k++) {
    const a = k % 3;
    pos[k] = d.lo[a] + (q[k] / 65535) * (d.hi[a] - d.lo[a]);
  }
  const u16 = new Uint16Array(bytes(d.uv).buffer);
  const uvs = new Float32Array(u16.length);
  for (let k = 0; k < u16.length; k++) uvs[k] = u16[k] / 65535;
  const ib = bytes(d.i);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  if (d.t && d.tscale) {
    const t16 = new Uint16Array(bytes(d.t).buffer);
    const tile = new Float32Array(t16.length);
    for (let k = 0; k < t16.length; k++) tile[k] = t16[k] === 65535 ? OFF_ROOF : t16[k] / d.tscale;
    g.setAttribute('tile', new THREE.BufferAttribute(tile, 2));
  }
  g.setIndex(new THREE.BufferAttribute(d.wide ? new Uint32Array(ib.buffer) : new Uint16Array(ib.buffer), 1));
  g.computeBoundingSphere();
  return g;
}

/** A 'tile' coordinate that isn't on a roof */
const OFF_ROOF = 10000;

/**
 * Every tile on a roof, drawn as it's seen: beaver tails, the way Rothenburg is roofed. Staggered
 * rows of flat tiles, each with a rounded end; between two ends the tile of the row below shows,
 * in the shadow of the ends over it; a thin gap between tiles side by side; no two quite the same
 * colour. `colour` is what's baked there; this shades it tile by tile, as fine as the screen goes,
 * fading to the average where the tiles get smaller than a pixel or two.
 */
function roofTiles(colour: V3) {
  const { float, mix, max, fwidth, hash } = TSL;
  const t = TSL.attribute('tile', 'vec2');
  const onRoof = TSL.step(t.x, OFF_ROOF / 2);
  const ROW = 0.15;
  const WIDE = 0.18;
  const v = t.y.div(ROW);
  const row = v.floor();
  const fv = v.fract();
  // Each row half a tile along from the one above
  const uu = t.x.div(WIDE).add(row.mul(0.5));
  const fu = uu.fract().mul(2).sub(1);
  // How far down this row's tile comes: all the way at its middle, less toward its sides
  const end = float(1).sub(fu.mul(fu).mul(0.46));
  // Rows across a pixel: edges no sharper than that, and no pattern once it's finer than the screen
  const fw = fwidth(t.y).div(ROW);
  const soft = max(fw, 0.012);
  const below = smoothstep(end.sub(soft), end.add(soft), fv);
  const idHere = uu.floor().add(row.mul(97.0));
  const idBelow = t.x.div(WIDE).add(row.add(1).mul(0.5)).floor().add(row.add(1).mul(97.0));
  const id = mix(idHere, idBelow, below);
  const n = hash(id);
  // On its own tile: a little lighter toward the rounded end, which stands proud of the tile under it
  const own = mix(float(0.86), float(1.05), smoothstep(0.0, 1.0, fv.div(end)));
  // On the tile below, close under an end: its shadow
  const under = mix(float(0.58), float(0.9), smoothstep(end, end.add(0.38), fv));
  let shade = mix(own, under, below);
  // The dark of the gap at the end, and between tiles side by side in a row
  shade = shade.mul(float(1).sub(smoothstep(soft.mul(2.5), float(0), fv.sub(end).abs()).mul(0.3)));
  shade = shade.mul(float(1).sub(smoothstep(float(1).sub(soft.mul(5)), float(1), fu.abs()).mul(float(1).sub(below)).mul(0.35)));
  // No two tiles quite alike: lighter and darker, and here and there an old one gone browner
  const old = TSL.step(0.93, hash(id.add(13.7)));
  const tint = vec3(1, 1, 1).mul(n.sub(0.5).mul(0.16).add(1)).mul(mix(vec3(1, 1, 1), vec3(0.85, 0.74, 0.66), old));
  const tiled = colour.mul(tint).mul(shade);
  const near = smoothstep(0.42, 0.14, fw);
  const shown = mix(colour.mul(0.93), tiled, near);
  return mix(colour, shown, onRoof) as unknown as V3;
}

export function litGeometry(d: Lit) {
  const p = new Float32Array(bytes(d.p).buffer);
  const n8 = new Int8Array(bytes(d.n).buffer);
  const c8 = bytes(d.c);
  const ib = bytes(d.i);
  const normal = new Float32Array(n8.length);
  for (let k = 0; k < n8.length; k++) normal[k] = n8[k] / 127;
  const colour = new Float32Array(c8.length);
  // Flat colours come as sRGB; these scenes work in linear
  for (let k = 0; k < c8.length; k++) colour[k] = Math.pow(c8[k] / 255, 2.2);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  g.setAttribute('color', new THREE.BufferAttribute(colour, 3));
  g.setIndex(new THREE.BufferAttribute(d.wide ? new Uint32Array(ib.buffer) : new Uint16Array(ib.buffer), 1));
  return g;
}

/** A hex colour in linear light */
export const lin = (hex: string) => {
  const c = new THREE.Color(hex);
  return new THREE.Color(Math.pow(c.r, 2.2), Math.pow(c.g, 2.2), Math.pow(c.b, 2.2));
};

/**
 * Linear light to the screen's, the way the room's post pass does it: a soft shoulder so hot spots
 * roll off, a warm grade the way Christmas films light a night, then gamma
 */
export function display(c: V3) {
  const mapped = c.div(c.mul(0.18).add(1)).mul(vec3(1.05, 1.0, 0.93));
  return pow(TSL.max(mapped, vec3(0)), vec3(1 / 2.2)) as unknown as V3;
}

/**
 * Standing on a little round world: everything in the frame bends down with the ground, away
 * from the middle. `radius` is the world's, in the frame's units.
 */
export function bend(radius: number) {
  const p = TSL.positionLocal;
  return p.sub(vec3(0, p.x.mul(p.x).add(p.z.mul(p.z)).div(2 * radius), 0));
}

export type BakedOptions = {
  /** Map to the screen in the material (it's drawn into a scene that isn't linear) */
  screen?: boolean;
  /** Bend it onto a round world this big */
  radius?: number;
  /** Ragged-edge it at this distance from the middle, and drop all of it behind z = -behind */
  edge?: { r: number; behind: number };
  /** A floor under the baked light, moonlight blue: nothing goes quite black (the undersides of eaves) */
  ambient?: number | THREE.UniformNode<'float', number>;
  /** Cut away whatever's inside this column (x, z its middle; w, d its half-sizes) above y = from */
  hole?: { x: number; z: number; w: number; d: number; from: number };
};

/**
 * One baked part as a mesh: colour × (the sum of its light layers, each with its own gain) + glow.
 * `layers` maps a layer's name to its texture asset; `gains` to a uniform that scales it.
 */
export async function bakedMesh(
  part: BakedPart,
  assets: { albedo: number; emit: number; layers: Record<string, number> },
  gains: Record<string, THREE.UniformNode<'float', number>>,
  exposure: THREE.UniformNode<'float', number>,
  glowGain = 2.2,
  opts: BakedOptions = {}
) {
  const names = Object.keys(assets.layers);
  const fields = await Promise.all([decode(assets.albedo), decode(assets.emit), ...names.map((n) => decode(assets.layers[n]))]);
  if (fields.some((f) => !f)) return null;
  const [albedo, emit, ...layers] = (fields as Field[]).map((f, k) => texture(f, k === 0, false));
  const m = new THREE.MeshBasicNodeMaterial();
  const v = uv();
  const plain = pow(TSL.texture(albedo, v).rgb, vec3(2.2)) as unknown as V3;
  const a = part.mesh.t ? roofTiles(plain) : plain;
  let light: V3 | null = null;
  names.forEach((n, k) => {
    const l = pow(TSL.texture(layers[k], v).rgb, vec3(2))
      .mul(part.light[n])
      .mul(gains[n] ?? 1) as unknown as V3;
    light = light ? (light.add(l) as unknown as V3) : l;
  });
  const glowing = pow(TSL.texture(emit, v).rgb, vec3(2.2)).mul(glowGain);
  let lit = (light ?? vec3(1)) as V3;
  if (opts.ambient) lit = lit.add(vec3(0.55, 0.62, 0.9).mul(opts.ambient)) as unknown as V3;
  const c = a.mul(lit).mul(exposure).add(glowing) as unknown as V3;
  let shown = opts.screen ? display(c) : c;
  if (opts.edge) {
    // Toward its edge the town's ground takes on the snow of the country round it, lit the way the
    // globe lights it, so there's no seam where one meets the other
    const p = TSL.positionGeometry;
    const r = p.xz.length().add(TSL.mx_noise_float(p.xz.mul(0.09)).mul(8));
    const up = radial();
    const field = shade(hex(SNOWFIELD), up, up).add(haze(up, up));
    // Only the ground itself (and what lies low on it): the farms and trees out there keep their colours
    const low = smoothstep(4.0, 1.6, p.y);
    shown = TSL.mix(shown, field, smoothstep(opts.edge.r - 46, opts.edge.r - 4, r).mul(low)) as unknown as V3;
  }
  m.colorNode = shown;
  if (opts.radius) m.positionNode = bend(opts.radius);
  if (opts.edge) {
    // The set's backdrop (hills and moon cut from card) goes; the ground frays out into the world's
    const p = TSL.positionGeometry;
    const r = p.xz.length();
    const fray = TSL.mx_noise_float(p.xz.mul(0.22)).mul(5).add(TSL.mx_noise_float(p.xz.mul(1.3)).mul(1.2));
    m.maskNode = r.add(fray).lessThan(opts.edge.r).and(p.z.greaterThan(-opts.edge.behind));
  }
  if (opts.hole) {
    const p = TSL.positionGeometry;
    const h = opts.hole;
    const within = p.x.sub(h.x).abs().lessThan(h.w).and(p.z.sub(h.z).abs().lessThan(h.d)).and(p.y.greaterThan(h.from));
    m.maskNode = within.not();
  }
  const mesh = new THREE.Mesh(bakedGeometry(part.mesh), m);
  mesh.frustumCulled = false;
  return mesh;
}

/** Bulbs, each its own colour, twinkling out of step with the rest */
export function bulbsMesh(bulbs: { at: V; c: string }[], radius: number, speed = 1.7, opts: BakedOptions = {}) {
  const geo = new THREE.SphereGeometry(radius, 10, 8);
  const m = new THREE.MeshBasicNodeMaterial();
  const colour = TSL.attribute('bulbColour', 'vec3') as unknown as V3;
  const phase = TSL.attribute('bulbPhase', 'float');
  const on = smoothstep(-0.6, 0.4, sin(time.mul(speed).add(phase.mul(6.28))));
  const c = colour.mul(on.mul(3.2).add(0.5)) as unknown as V3;
  m.colorNode = opts.screen ? display(c) : c;
  const mesh = new THREE.InstancedMesh(geo, m, Math.max(1, bulbs.length));
  const cols = new Float32Array(Math.max(1, bulbs.length) * 3);
  const phases = new Float32Array(Math.max(1, bulbs.length));
  const mtx = new THREE.Matrix4();
  bulbs.forEach((b, k) => {
    const drop = opts.radius ? (b.at[0] * b.at[0] + b.at[2] * b.at[2]) / (2 * opts.radius) : 0;
    mtx.makeTranslation(b.at[0], b.at[1] - drop, b.at[2]);
    mesh.setMatrixAt(k, mtx);
    const c = lin(b.c);
    cols.set([c.r, c.g, c.b], k * 3);
    phases[k] = (k * 0.618) % 1;
  });
  geo.setAttribute('bulbColour', new THREE.InstancedBufferAttribute(cols, 3));
  geo.setAttribute('bulbPhase', new THREE.InstancedBufferAttribute(phases, 1));
  mesh.frustumCulled = false;
  return mesh;
}

/**
 * Paper stars lit from inside, hanging in windows: drawn as they are, not baked (each is only a few
 * texels in the town's maps), glowing a little unevenly
 */
export function starsMesh(stars: { at: V; n: V; r: number; c: string }[], opts: BakedOptions = {}) {
  const shape = new THREE.Shape();
  for (let k = 0; k <= 16; k++) {
    const a = (k / 16) * Math.PI * 2 + Math.PI / 2;
    const r = k % 2 ? 0.43 : 1;
    if (k === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const geo = new THREE.ShapeGeometry(shape);
  const m = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  const colour = TSL.attribute('starColour', 'vec3') as unknown as V3;
  const phase = TSL.attribute('starPhase', 'float');
  const c = colour.mul(sin(time.mul(1.3).add(phase.mul(6.28))).mul(0.25).add(2.1)) as unknown as V3;
  m.colorNode = opts.screen ? display(c) : c;
  const n = Math.max(1, stars.length);
  const mesh = new THREE.InstancedMesh(geo, m, n);
  const cols = new Float32Array(n * 3);
  const phases = new Float32Array(n);
  const mtx = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const Z = new THREE.Vector3(0, 0, 1);
  const dir = new THREE.Vector3();
  const pos = new THREE.Vector3();
  const size = new THREE.Vector3();
  stars.forEach((s, k) => {
    const drop = opts.radius ? (s.at[0] * s.at[0] + s.at[2] * s.at[2]) / (2 * opts.radius) : 0;
    pos.set(s.at[0], s.at[1] - drop, s.at[2]);
    q.setFromUnitVectors(Z, dir.set(...s.n).normalize());
    mtx.compose(pos, q, size.setScalar(s.r));
    mesh.setMatrixAt(k, mtx);
    const c = lin(s.c);
    cols.set([c.r, c.g, c.b], k * 3);
    phases[k] = (k * 0.381) % 1;
  });
  geo.setAttribute('starColour', new THREE.InstancedBufferAttribute(cols, 3));
  geo.setAttribute('starPhase', new THREE.InstancedBufferAttribute(phases, 1));
  mesh.frustumCulled = false;
  return mesh;
}
