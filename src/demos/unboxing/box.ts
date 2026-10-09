import * as TSL from 'three/tsl';
import * as THREE from 'three/webgpu';

/**
 * The things in the scene: a corrugated shipping box on a seamless cream backdrop under soft
 * studio light, the way a product is photographed, its four flaps on hinges, the printed packing
 * tape across the seam in two halves that can be slit apart, tissue paper and a thank-you seal
 * inside, crinkle-paper shred, the things you ordered, and a box cutter. No shadow maps on
 * react-native-webgpu, so the light is worked out in each material: the pool of light the box
 * stands in, its soft shadow, and how much light gets in over the walls once it's open.
 */

const { float, vec2, vec3, mix, smoothstep, dot, saturate, normalize, uv, pow, sin, abs, max, oneMinus } = TSL;
type F = THREE.Node<'float'>;
type V3 = THREE.Node<'vec3'>;

// ---- Sizes (metres, more or less) ----

/** The box: width across, depth front to back, height; and how thick its board is */
export const W = 1.6;
export const D = 1.1;
export const H = 0.9;
export const T = 0.016;
/** Every flap reaches halfway across the top, as on any shipping box */
export const FLAP = D / 2;
export const TAPE = 0.16;
/** Where the closed lid's top surface is */
export const LID = H + 2 * T;

// ---- Light ----

/** Toward the big softbox: overhead, a little to the left and toward you */
export const SUN = new THREE.Vector3(-0.32, 0.9, 0.28).normalize();
const LIGHT = vec3(SUN.x, SUN.y, SUN.z);
const KEY = vec3(0.64, 0.62, 0.58);
const SKY = vec3(0.96, 0.96, 0.98);
const BOUNCE = vec3(0.92, 0.86, 0.78);
/** The backdrop far away, where the floor sweeps up into it: also the clear colour */
export const BACKDROP = new THREE.Color(0.77, 0.74, 0.69);

/** Light from inside the opened box as what's in it is revealed, 0..1 */
export const glow = TSL.uniform(0);
/** How high the box is off the floor, for its shadow */
export const lift = TSL.uniform(0);
/** Dust kicked up by the box landing, 1 just landed to 0 settled */
export const puff = TSL.uniform(0);

/**
 * The normal of the flat facet a pixel is on, turned toward you: for paper that's bent and
 * crinkled every frame, where vertex normals can cancel out at a sharp crease and go black
 */
const crumpled = () => {
  const n = TSL.normalFlat.transformDirection(TSL.cameraWorldMatrix);
  return n.mul(TSL.sign(dot(n, toEye()))) as unknown as V3;
};

/**
 * Smooth vertex normals for a mesh that's bent every frame. Where a sheet folds right over on
 * itself the faces around a vertex can cancel out, leaving a zero normal that shades black: those
 * fall back to straight up.
 */
function safeNormals(g: THREE.BufferGeometry) {
  g.computeVertexNormals();
  const n = g.getAttribute('normal') as THREE.BufferAttribute;
  const a = n.array as Float32Array;
  for (let i = 0; i < a.length; i += 3) {
    if (a[i] * a[i] + a[i + 1] * a[i + 1] + a[i + 2] * a[i + 2] < 1e-8) {
      a[i] = 0;
      a[i + 1] = 1;
      a[i + 2] = 0;
    }
  }
  n.needsUpdate = true;
}

/** The face's normal, turned toward you on its back side */
const facing = () => TSL.select(TSL.frontFacing, TSL.normalWorld, TSL.normalWorld.negate()) as unknown as V3;
const toEye = () => normalize(TSL.cameraPosition.sub(TSL.positionWorld)) as unknown as V3;

/** The pool of light the box stands in, falling off gently away from it */
const pool = (p: V3) => smoothstep(5, 0.6, p.xz.length()).mul(0.2).add(0.8) as F;

/** Sun and sky on a surface: `ao` darkens all of it, `lit` only the sun */
export function shade(albedo: V3, n: V3, p: V3, ao: F | number = 1, lit: F | number = 1) {
  const ndl = saturate(dot(n, LIGHT));
  const direct = KEY.mul(ndl).mul(lit);
  const ambient = mix(BOUNCE, SKY, n.y.mul(0.5).add(0.5)).mul(0.55);
  return albedo.mul(direct.add(ambient)).mul(ao).mul(pool(p)) as unknown as V3;
}

/** A highlight: the sun's reflection, `power` how tight, `k` how bright */
const gloss = (n: V3, power: number, k: number) => {
  const half = normalize(LIGHT.add(toEye()));
  return KEY.mul(pow(saturate(dot(n, half)), power).mul(k)) as unknown as V3;
};

/** How much sun gets into the open box past its walls, at a point inside it */
const intoBox = (p: V3) => {
  const up = max(float(H).sub(p.y), 0).div(SUN.y);
  const q = p.xz.add(vec2(SUN.x, SUN.z).mul(up));
  return smoothstep(W / 2 + 0.03, W / 2 - 0.05, abs(q.x)).mul(smoothstep(D / 2 + 0.03, D / 2 - 0.05, abs(q.y))) as F;
};

// ---- Board ----

/** Kraft board: a little fibre, a little mottling, stuck to the surface it's on */
const kraft = (tone: number) => {
  const p = TSL.positionLocal;
  const fibre = TSL.mx_noise_float(p.mul(46)).mul(0.012);
  const mottle = TSL.mx_noise_float(p.mul(3.1)).mul(0.018);
  return vec3(0.74, 0.56, 0.37).mul(tone).add(fibre).add(mottle) as unknown as V3;
};

/** The outside of the box, with the carrier's print on it if it has any */
function outerMaterial(print?: THREE.Texture) {
  const m = new THREE.MeshBasicNodeMaterial();
  let base = kraft(1);
  if (print) {
    const ink = TSL.texture(print, uv());
    base = mix(base, ink.rgb, ink.a.mul(0.86)) as unknown as V3;
  }
  const p = TSL.positionWorld as unknown as V3;
  const ao = smoothstep(0, 0.16, p.y).mul(0.22).add(0.78) as F;
  m.colorNode = shade(base, facing(), p, ao);
  return m;
}

/** The inside: paler board, darker the deeper you look, lit where the sun gets in */
function innerMaterial() {
  const m = new THREE.MeshBasicNodeMaterial();
  const p = TSL.positionWorld as unknown as V3;
  const depth = smoothstep(0.02, H, p.y);
  const ao = depth.mul(0.5).add(0.36) as F;
  const warm = vec3(1.0, 0.78, 0.5).mul(glow.mul(oneMinus(depth).mul(0.45).add(0.2)));
  m.colorNode = shade(kraft(1.14), facing(), p, ao, intoBox(p)).add(warm);
  return m;
}

/** The underside of a flap: inside-the-box board, but out in the light once it's open */
function undersideMaterial() {
  const m = new THREE.MeshBasicNodeMaterial();
  m.colorNode = shade(kraft(1.12), facing(), TSL.positionWorld as unknown as V3, 0.92);
  return m;
}

/** Cut edges, where the corrugation shows */
function fluteMaterial() {
  const m = new THREE.MeshBasicNodeMaterial();
  const q = TSL.positionLocal;
  const wave = sin(q.x.add(q.z).add(q.y).mul(620)).mul(0.5).add(0.5);
  const base = vec3(0.6, 0.43, 0.27).mul(wave.mul(0.24).add(0.78)) as unknown as V3;
  m.colorNode = shade(base, facing(), TSL.positionWorld as unknown as V3, 0.9);
  return m;
}

/** Paper stuck on the box: a label or a sticker, a touch glossy */
function decalMaterial(map: THREE.Texture, shine: number) {
  const m = new THREE.MeshBasicNodeMaterial({ alphaTest: 0.5 });
  const tex = TSL.texture(map, uv());
  const n = facing();
  m.colorNode = shade(tex.rgb as unknown as V3, n, TSL.positionWorld as unknown as V3).add(gloss(n, 50, shine));
  m.opacityNode = tex.a;
  return m;
}

/** Packing tape: tinted, glossy film, printed with the carrier's name */
function tapeMaterial(print?: THREE.Texture, cuttable = false) {
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const n = facing();
  const tint = vec3(0.9, 0.77, 0.55);
  let film = tint as unknown as V3;
  let ink = float(0) as F;
  if (print) {
    const t = TSL.texture(print, uv());
    ink = t.a as F;
    film = mix(tint, t.rgb.div(max(t.a, 0.001)), t.a) as unknown as V3;
  }
  // Light catching the film unevenly, where it's not quite flat
  const ripple = TSL.mx_noise_float(TSL.positionLocal.mul(vec3(9, 9, 40)))
    .mul(0.5)
    .add(0.5);
  const sheen = gloss(n, 90, 1.15)
    .mul(ripple.mul(0.7).add(0.3))
    .add(gloss(n, 10, 0.1));
  // Where it's been cut: the fresh edge catches the light, and the film there has curled off the
  // board, so it's brighter and you see more of it
  const edge = (cuttable ? TSL.attribute('aEdge', 'float') : float(0)) as F;
  m.colorNode = shade(film, n, TSL.positionWorld as unknown as V3)
    .add(sheen)
    .add(vec3(1.0, 0.97, 0.9).mul(edge.mul(0.06)));
  m.opacityNode = max(ink.mul(0.95), float(0.36).add(sheen.x.mul(0.5)).add(edge.mul(0.3)));
  return m;
}

// ---- The box ----

export type Hinged = {
  /** Where the hinge is, turned to face the way the flap lies */
  pivot: THREE.Group;
  /** Turned about x to open the flap */
  hinge: THREE.Group;
  mesh: THREE.Mesh;
};

export type TapeHalf = {
  mesh: THREE.Mesh;
  /** 1 the half on the back flap, -1 the one on the front */
  side: 1 | -1;
  /** How ragged the cut edge comes out, per column */
  jag: Float32Array;
};

/** Columns along the tape: fine enough that the slit follows every wobble of the finger */
export const SLITS = 160;
const TAPE_ROWS = 6;
const TAPE_HALF = W / 2 + 0.006;

function tapeHalf(parent: THREE.Object3D, material: THREE.Material, side: 1 | -1): TapeHalf {
  const cols = SLITS;
  const rows = TAPE_ROWS;
  const count = (cols + 1) * (rows + 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
  g.setAttribute('aEdge', new THREE.BufferAttribute(new Float32Array(count), 1));
  const idx: number[] = [];
  for (let c = 0; c < cols; c++)
    for (let r = 0; r < rows; r++) {
      const a = c * (rows + 1) + r;
      const b = a + rows + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  g.setIndex(idx);
  const mesh = new THREE.Mesh(g, material);
  mesh.renderOrder = 2;
  mesh.frustumCulled = false;
  parent.add(mesh);
  const jag = new Float32Array(cols + 1);
  for (let c = 0; c <= cols; c++) jag[c] = Math.random();
  const half = { mesh, side, jag };
  slitTape(half, new Float32Array(cols + 1), new Float32Array(cols + 1), null);
  return half;
}

/** Where the blade is pressing into the tape, and how hard */
export type Press = { x: number; z: number; depth: number } | null;

/**
 * Lay a tape half out for where it's been cut. `cutZ[c]` is where the blade crossed column c
 * (across the tape, 0 at the seam between the flaps) and `open[c]` how far that bit has come
 * apart since: the two halves pull back from the line, their edges curling up, ragged where the
 * blade went. Uncut, both halves meet along `cutZ` and read as one strip. `press` dimples the
 * tape around the blade.
 */
export function slitTape(half: TapeHalf, cutZ: Float32Array, open: Float32Array, press: Press) {
  const g = half.mesh.geometry;
  const pos = (g.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
  const uvs = (g.getAttribute('uv') as THREE.BufferAttribute).array as Float32Array;
  const edges = (g.getAttribute('aEdge') as THREE.BufferAttribute).array as Float32Array;
  const rows = TAPE_ROWS;
  const s = half.side;
  for (let c = 0; c <= SLITS; c++) {
    const x = -TAPE_HALF + (2 * TAPE_HALF * c) / SLITS;
    const o = open[c];
    const j = half.jag[c];
    // A knife never cuts quite straight: the edge comes out a hair ragged
    const e = cutZ[c] + (j - 0.5) * 0.0024 * o;
    const outer = -s * (TAPE / 2);
    for (let r = 0; r <= rows; r++) {
      const f = r / rows;
      // Where this bit of tape is on the box, before it's pulled anywhere: the print goes with it
      const z0 = outer + (e - outer) * f;
      const pull = o * (0.004 + j * 0.003) * f * f;
      const curl = o * (0.01 + j * 0.007) * f * f * f;
      let dip = 0;
      if (press) {
        const dx = (x - press.x) / 0.04;
        const dz = (z0 - press.z) / 0.05;
        dip = press.depth * Math.exp(-dx * dx - dz * dz) * (1 - o);
      }
      const zw = z0 - s * pull;
      const y = T + 0.0016 + curl - dip;
      const v = c * (rows + 1) + r;
      // Into the flap's own space: the back flap's hinge is behind, the front's turned around
      pos[v * 3] = s > 0 ? x : -x;
      pos[v * 3 + 1] = y;
      pos[v * 3 + 2] = s > 0 ? zw + FLAP : FLAP - zw;
      uvs[v * 2] = (x + TAPE_HALF) / 1.68;
      uvs[v * 2 + 1] = 0.5 - z0 / TAPE;
      edges[v] = o * Math.pow(f, 8);
    }
  }
  g.getAttribute('position').needsUpdate = true;
  g.getAttribute('uv').needsUpdate = true;
  g.getAttribute('aEdge').needsUpdate = true;
  g.computeVertexNormals();
}

export function buildBox(art: {
  side: THREE.Texture;
  label: THREE.Texture;
  tape: THREE.Texture;
  fragile: THREE.Texture;
}) {
  const root = new THREE.Group();
  const outer = outerMaterial();
  const printed = outerMaterial(art.side);
  const inner = innerMaterial();
  const under = undersideMaterial();
  const flute = fluteMaterial();
  const film = tapeMaterial(art.tape, true);
  const plainFilm = tapeMaterial();

  const slab = (geo: THREE.BufferGeometry, mats: THREE.Material[], x: number, y: number, z: number) => {
    const m = new THREE.Mesh(geo, mats);
    m.position.set(x, y, z);
    root.add(m);
    return m;
  };
  // Faces in BoxGeometry order: +x, -x, +y, -y, +z, -z
  slab(new THREE.BoxGeometry(W, H, T), [flute, flute, flute, flute, printed, inner], 0, H / 2, D / 2 - T / 2);
  slab(new THREE.BoxGeometry(W, H, T), [flute, flute, flute, flute, inner, outer], 0, H / 2, -D / 2 + T / 2);
  slab(new THREE.BoxGeometry(T, H, D - 2 * T), [inner, outer, flute, flute, flute, flute], -W / 2 + T / 2, H / 2, 0);
  slab(new THREE.BoxGeometry(T, H, D - 2 * T), [outer, inner, flute, flute, flute, flute], W / 2 - T / 2, H / 2, 0);
  slab(new THREE.BoxGeometry(W - 2 * T, T, D - 2 * T), [flute, flute, inner, outer, flute, flute], 0, T / 2, 0);

  /** A flap lying flat from its hinge along its local +z; `yaw` turns it to face its way */
  const flap = (yaw: number, hx: number, hz: number, y: number, length: number): Hinged => {
    const pivot = new THREE.Group();
    pivot.position.set(hx, y, hz);
    pivot.rotation.y = yaw;
    const hinge = new THREE.Group();
    pivot.add(hinge);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(length, T, FLAP), [flute, flute, outer, under, flute, flute]);
    mesh.position.set(0, T / 2, FLAP / 2);
    hinge.add(mesh);
    root.add(pivot);
    return { pivot, hinge, mesh };
  };
  // The two long flaps on top meet over the middle; the short ones fold in under them first
  const back = flap(0, 0, -D / 2, H + T, W);
  const front = flap(Math.PI, 0, D / 2, H + T, W);
  const left = flap(Math.PI / 2, -W / 2, 0, H, D - 2 * T - 0.004);
  const right = flap(-Math.PI / 2, W / 2, 0, H, D - 2 * T - 0.004);

  const decal = (
    parent: THREE.Object3D,
    map: THREE.Texture,
    w: number,
    h: number,
    x: number,
    z: number,
    spin: number
  ) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), decalMaterial(map, 0.25));
    m.rotation.set(-Math.PI / 2, 0, spin);
    m.position.set(x, T + 0.0012, z);
    parent.add(m);
    return m;
  };
  // The label on the flap nearest you, the right way up; FRAGILE on the far one
  decal(front.hinge, art.label, 0.64, 0.42, 0.3, FLAP * 0.47, Math.PI + 0.025);
  decal(back.hinge, art.fragile, 0.36, 0.18, 0.46, FLAP * 0.42, -0.1);

  const tape = [tapeHalf(back.hinge, film, 1), tapeHalf(front.hinge, film, -1)];

  // Where the tape runs on over the ends and down the sides
  const tabs: THREE.Mesh[] = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(TAPE / 2, 0.26), plainFilm);
      m.rotation.y = (sx * Math.PI) / 2;
      m.position.set(sx * (W / 2 + 0.0014), LID - 0.13, (sz * TAPE) / 4);
      m.renderOrder = 2;
      root.add(m);
      tabs.push(m);
    }
  }

  return { root, flaps: { back, front, left, right }, tape, tabs };
}

// ---- Inside ----

/** Crinkle-paper shred filling the box under everything, kraft, pink and cream */
export function buildShreds(count = 240) {
  const seg = 10;
  const len = 0.17;
  const wid = 0.014;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= seg; i++) {
    const x = -len / 2 + (len * i) / seg;
    const zig = (i % 2 ? 1 : -1) * 0.006;
    const curl = Math.sin((i / seg) * Math.PI) * 0.012;
    pos.push(x, zig + curl, -wid / 2, x, zig + curl, wid / 2);
    if (i < seg) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();

  const m = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  const h = TSL.hash(TSL.instanceIndex);
  const color = TSL.select(
    h.lessThan(0.5),
    vec3(0.72, 0.53, 0.33),
    TSL.select(h.lessThan(0.78), vec3(0.97, 0.74, 0.78), vec3(0.97, 0.94, 0.86))
  ) as unknown as V3;
  const p = TSL.positionWorld as unknown as V3;
  const depth = smoothstep(0.02, H * 0.55, p.y);
  m.colorNode = shade(color, facing(), p, depth.mul(0.55).add(0.4) as F, intoBox(p)).add(
    vec3(1.0, 0.8, 0.55).mul(glow.mul(0.25))
  );

  const mesh = new THREE.InstancedMesh(g, m, count);
  const mat = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const s = new THREE.Vector3();
  const at = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    at.set(
      (Math.random() - 0.5) * (W - 2 * T - 0.14),
      0.06 + Math.pow(Math.random(), 0.6) * 0.36,
      (Math.random() - 0.5) * (D - 2 * T - 0.14)
    );
    e.set(Math.random() * Math.PI, Math.random() * Math.PI * 2, Math.random() * Math.PI);
    q.setFromEuler(e);
    s.setScalar(0.8 + Math.random() * 0.5);
    mat.compose(at, q, s);
    mesh.setMatrixAt(i, mat);
  }
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

export type Sheet = {
  pivot: THREE.Group;
  mesh: THREE.Mesh;
  /** Bend it open to `angle` (radians at its free edge) */
  pose: (angle: number) => void;
};

const SHEET_COLS = 22;
const SHEET_ROWS = 12;

/**
 * A sheet of tissue paper folded over the contents from one long side, crinkled. Opening it bends
 * more toward its free edge than at the fold, so it rolls back over the rim like paper does.
 */
function sheet(root: THREE.Group, side: 1 | -1, tint: THREE.Color, lift: number): Sheet {
  const len = W - 2 * T - 0.03;
  const depth = D / 2 + 0.07;
  const cols = SHEET_COLS;
  const rows = SHEET_ROWS;
  const count = (cols + 1) * (rows + 1);
  const pos = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  const crinkle = new Float32Array(count);
  const seed = side * 3.7;
  const idx: number[] = [];
  for (let j = 0; j <= rows; j++)
    for (let i = 0; i <= cols; i++) {
      const v = j * (cols + 1) + i;
      uvs[v * 2] = i / cols;
      uvs[v * 2 + 1] = j / rows;
      crinkle[v] =
        (Math.sin(i * 1.7 + j * 2.3 + seed) * 0.5 + Math.sin(i * 0.63 - j * 1.13 + seed * 2) * 0.5) * 0.008 +
        (Math.random() - 0.5) * 0.006;
      if (i < cols && j < rows) {
        const a = v;
        const b = v + cols + 1;
        idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  g.setIndex(idx);

  const m = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  // Tissue scatters the light right through itself, so it's lit almost evenly whichever way it
  // faces; only the crinkle facets catch the light a little more or less. This needs no vertex
  // normals, which a sheet bent right over on itself can't keep sane.
  const albedo = vec3(tint.r, tint.g, tint.b).add(TSL.mx_noise_float(TSL.positionLocal.mul(60)).mul(0.02));
  const facet = abs(dot(crumpled(), LIGHT));
  const light = facet
    .mul(0.2)
    .add(0.92)
    .mul(pool(TSL.positionWorld as unknown as V3));
  m.colorNode = albedo.mul(light);

  const mesh = new THREE.Mesh(g, m);
  mesh.renderOrder = 1;
  const pivot = new THREE.Group();
  pivot.position.set(0, H - 0.035 + lift, -side * (D / 2 - T - 0.004));
  pivot.rotation.y = side > 0 ? 0 : Math.PI;
  pivot.add(mesh);
  root.add(pivot);

  const pose = (angle: number) => {
    const ds = depth / rows;
    let y = 0;
    let z = 0;
    for (let j = 0; j <= rows; j++) {
      const t = j / rows;
      // Bends more toward the free edge, and droops once it's past upright
      const a = angle * (0.42 + 0.58 * t) + Math.max(0, angle - 1.6) * 0.7 * t * t;
      const sag = angle < 0.05 ? -Math.sin(t * Math.PI) * 0.012 : 0;
      for (let i = 0; i <= cols; i++) {
        const v = j * (cols + 1) + i;
        const c = crinkle[v];
        pos[v * 3] = -len / 2 + (len * i) / cols;
        pos[v * 3 + 1] = y + sag + c * Math.cos(a);
        pos[v * 3 + 2] = z - c * Math.sin(a);
      }
      const am = angle * (0.42 + 0.58 * (t + 0.5 / rows)) + Math.max(0, angle - 1.6) * 0.7 * t * t;
      y += Math.sin(am) * ds;
      z += Math.cos(am) * ds;
    }
    (g.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    safeNormals(g);
  };
  pose(0);
  return { pivot, mesh, pose };
}

export function buildTissue(root: THREE.Group) {
  // Folded in from the back first, then the front over it
  return [
    sheet(root, 1, new THREE.Color(0.93, 0.91, 0.88), 0),
    sheet(root, -1, new THREE.Color(0.95, 0.82, 0.85), 0.005),
  ];
}

/** The thank-you seal holding the tissue shut, which peels from one edge */
export function buildSeal(root: THREE.Group, map: THREE.Texture) {
  const size = 0.3;
  const segs = 16;
  const g = new THREE.PlaneGeometry(size, size, segs, 1);
  g.rotateX(-Math.PI / 2);
  const base = (g.getAttribute('position').array as Float32Array).slice();
  const m = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide, alphaTest: 0.5 });
  const tex = TSL.texture(map, uv());
  // Shaded without its normals: bent over itself and tumbling away they go bad, and the sticker
  // went black. Printed side out, plain white backing paper behind.
  const light = pool(TSL.positionWorld as unknown as V3).mul(0.97);
  const front = tex.rgb.mul(light);
  const back = vec3(0.94, 0.93, 0.9).mul(light);
  m.colorNode = TSL.select(TSL.frontFacing, front, back);
  m.opacityNode = tex.a;
  const mesh = new THREE.Mesh(g, m);
  mesh.renderOrder = 3;
  const group = new THREE.Group();
  group.position.set(0, H - 0.035 + 0.02, 0);
  group.add(mesh);
  root.add(group);
  /** 0 stuck down, 1 peeled right back over itself from its left edge */
  const peel = (p: number) => {
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const fold = -size / 2 + size * Math.min(1, p * 1.1);
    const a = Math.min(Math.PI * 0.92, p * 4.2);
    for (let v = 0; v < arr.length / 3; v++) {
      const x = base[v * 3];
      if (x < fold) {
        const d = fold - x;
        arr[v * 3] = fold - d * Math.cos(a);
        arr[v * 3 + 1] = base[v * 3 + 1] + d * Math.sin(a);
      } else {
        arr[v * 3] = x;
        arr[v * 3 + 1] = base[v * 3 + 1];
      }
    }
    pos.needsUpdate = true;
    g.computeVertexNormals();
  };
  return { group, mesh, peel };
}

// ---- What you ordered ----

/** How big each product is, across */
export const ITEM = 0.8;

// ---- Light ----

/** Light pouring up out of the open box */
export function buildShaft() {
  const h = 1.9;
  // Opening out as it rises, wide enough to hold everything floating over the box
  const geo = new THREE.CylinderGeometry(1.0, 0.62, h, 4, 1, true);
  geo.rotateY(Math.PI / 4);
  geo.translate(0, h / 2, 0);
  const m = new THREE.MeshBasicNodeMaterial({
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const q = TSL.positionLocal;
  const t = q.y.div(h);
  const streak = sin(q.x.mul(9).add(q.z.mul(7)).add(TSL.time.mul(0.6)))
    .mul(0.25)
    .add(0.75);
  m.colorNode = vec3(1.0, 0.86, 0.62);
  m.opacityNode = pow(oneMinus(saturate(t)), 2.2)
    .mul(glow)
    .mul(0.05)
    .mul(streak);
  const mesh = new THREE.Mesh(geo, m);
  const half = 0.62 / Math.SQRT2;
  mesh.scale.set((W / 2 - T) / half, 1, (D / 2 - T) / half);
  mesh.position.y = H - 0.08;
  mesh.renderOrder = 4;
  mesh.frustumCulled = false;
  return mesh;
}

/** Quads that always face you, placed each frame: sparkles over the open box, dust as it lands */
export function buildBillboards(count: number, kind: 'spark' | 'dust') {
  const m = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });
  const c = uv().sub(0.5).mul(2);
  const r = c.length();
  if (kind === 'spark') {
    const core = pow(saturate(oneMinus(r)), 3);
    const rays = smoothstep(0.1, 0, abs(c.x))
      .add(smoothstep(0.1, 0, abs(c.y)))
      .mul(saturate(oneMinus(r)).mul(0.5));
    m.colorNode = vec3(1.0, 0.8, 0.38);
    m.opacityNode = saturate(core.mul(1.4).add(rays)).mul(glow);
  } else {
    const soft = pow(saturate(oneMinus(r)), 2).mul(
      TSL.mx_noise_float(vec3(c.mul(2.5), 1.3))
        .mul(0.4)
        .add(0.7)
    );
    m.colorNode = vec3(0.86, 0.82, 0.76);
    m.opacityNode = soft.mul(puff).mul(0.5);
  }
  const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), m, count);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  return mesh;
}

// ---- The box cutter ----

export function buildKnife() {
  const g = new THREE.Group();
  const plastic = new THREE.MeshBasicNodeMaterial();
  const pn = facing();
  plastic.colorNode = shade(vec3(0.96, 0.72, 0.1), pn, TSL.positionWorld as unknown as V3).add(gloss(pn, 30, 0.45));
  const grip = new THREE.MeshBasicNodeMaterial();
  grip.colorNode = shade(vec3(0.16, 0.16, 0.17), pn, TSL.positionWorld as unknown as V3).add(gloss(pn, 20, 0.2));
  const steel = new THREE.MeshBasicNodeMaterial();
  steel.colorNode = shade(vec3(0.72, 0.74, 0.78), pn, TSL.positionWorld as unknown as V3).add(gloss(pn, 70, 1.4));
  // The blade stands on its edge in the line of the cut, its tip at the group's origin; the
  // handle runs back and up from it
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.024, 0.0025), steel);
  blade.position.set(0.065, 0.012, 0);
  const snap = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.024, 0.003), grip);
  snap.position.set(0.05, 0.012, 0);
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.05, 0.075), plastic);
  handle.position.set(0.33, 0.022, 0);
  const band = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.054, 0.046), grip);
  band.position.set(0.37, 0.022, 0);
  const slider = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.016, 0.03), grip);
  slider.position.set(0.2, 0.054, 0);
  g.add(blade, snap, handle, band, slider);
  g.visible = false;
  return g;
}

// ---- The floor ----

/** A seamless cream sweep under the box, its soft shadow under it, fading into the backdrop */
export function buildFloor() {
  const m = new THREE.MeshBasicNodeMaterial();
  const p = TSL.positionWorld as unknown as V3;
  const paper = vec3(0.86, 0.83, 0.78).add(TSL.mx_noise_float(vec3(p.xz.mul(9), 1)).mul(0.008)) as unknown as V3;
  // Its shadow: under it and a little away from the light, soft as a big light makes it
  const reach = H / SUN.y;
  const centre = vec2(-SUN.x * reach * 0.35, -SUN.z * reach * 0.35);
  const halfSize = vec2(W / 2 + 0.04, D / 2 + 0.04);
  const rel = abs(p.xz.sub(centre)).sub(halfSize);
  const box = max(rel, vec2(0))
    .length()
    .add(TSL.min(max(rel.x, rel.y), 0));
  const blur = lift.mul(0.6).add(0.32);
  const shadow = smoothstep(blur, blur.negate().mul(0.5), box).mul(float(0.42).div(lift.mul(1.4).add(1)));
  // And right at its foot, the darker line where it meets the floor
  const footRel = abs(p.xz).sub(vec2(W / 2, D / 2));
  const foot = max(footRel, vec2(0))
    .length()
    .add(TSL.min(max(footRel.x, footRel.y), 0));
  const contact = smoothstep(0.1, 0, foot).mul(0.32).div(lift.mul(6).add(1));
  const dist = p.xz.length();
  const lit = shade(paper, vec3(0, 1, 0), p, oneMinus(contact).mul(oneMinus(shadow)) as F);
  m.colorNode = mix(lit, vec3(BACKDROP.r, BACKDROP.g, BACKDROP.b), smoothstep(4, 9, dist));
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), m);
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}
