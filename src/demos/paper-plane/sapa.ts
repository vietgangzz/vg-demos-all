import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';

/**
 * Where the plane comes down: the rice terraces of Sa Pa on a clear morning. The hillside below
 * you is cut into terraces that follow its contours, young rice bright green in most, water in
 * some, holding the sky and the mountains; mist lies in the valley, the far slope is terraced too,
 * and the Hoàng Liên Sơn range stands behind in blue layers. A few stilt houses, swallows.
 *
 * The hill is one height function, used both to build the ground and to place things on it: the
 * slope as it would be, then cut into level steps wherever it's farmed. The ground's shader reads
 * the uncut height to know, at every point, which terrace it's on and how far across it, and
 * draws the bunds, the banks between steps and the water from that.
 *
 * Same units as the field (about 21 cm). The terrace the plane lands on is at y = -6.
 */

type F = THREE.Node<'float'>;
type V2 = THREE.Node<'vec2'>;
type V3 = THREE.Node<'vec3'>;

const { float, vec2, vec3, mix, smoothstep, pow, exp, sin, fract, floor, length, dot, abs, max } = TSL;
const { oneMinus, saturate, atan, normalize, Fn, Loop, mod, step } = TSL;

export const SAPA_SUN = new THREE.Vector3(-0.5, 0.52, -0.69).normalize();
const sun = vec3(SAPA_SUN.x, SAPA_SUN.y, SAPA_SUN.z);
const time = TSL.time;
/** Height of one terrace step */
const STEP = 3.2;
/** Fields are divided into paddies this wide across the slope, and this long down it */
const PADDY = new THREE.Vector2(46, 60);

const HORIZON = vec3(0.8, 0.87, 0.95);
const ZENITH = vec3(0.24, 0.5, 0.9);

// ---- The hill, in JS ----

const hashJ = (x: number, z: number) => {
  let h = (x * 374761393 + z * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};
const vnoise = (x: number, z: number) => {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const u = fx * fx * (3 - 2 * fx);
  const v = fz * fz * (3 - 2 * fz);
  const a = hashJ(ix, iz);
  const b = hashJ(ix + 1, iz);
  const c = hashJ(ix, iz + 1);
  const d = hashJ(ix + 1, iz + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
};
const fbmJ = (x: number, z: number, octaves: number) => {
  let s = 0;
  let a = 0.5;
  for (let i = 0; i < octaves; i++) {
    s += a * vnoise(x, z);
    x = x * 2.03 + 17.1;
    z = z * 2.03 + 9.2;
    a *= 0.5;
  }
  return s;
};
const smoothJ = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** The hillside before it was terraced: down into the valley ahead, up the far side */
function slope(x: number, z: number) {
  const u = -z + 50;
  // Spurs and gullies, so the terraces wrap round the hill in long curves
  const warp =
    (Math.sin(x * 0.018 + 0.6) * 38 + Math.sin(x * 0.0065 + 2.1) * 30 + (fbmJ(x * 0.008, z * 0.008, 3) - 0.5) * 70) *
    smoothJ(70, 150, u);
  const v = u + warp;
  const spurs = (fbmJ(x * 0.014, z * 0.014, 4) - 0.5) * 34 * smoothJ(80, 160, u);
  const wiggle = (fbmJ(x * 0.05, z * 0.05, 3) - 0.5) * 3;
  return -118 * smoothJ(12, 260, v) + 120 * smoothJ(290, 560, v) + spurs + wiggle;
}

/** How terraced the ground is at a height: the slopes are, the hilltop and the valley floor not */
const farmed = (h: number) => smoothJ(-1, -4, h) * smoothJ(-118, -110, h);

/** The ground's height: the slope cut into level steps, each rising to the next in a short bank */
function ground(x: number, z: number) {
  const h = slope(x, z);
  const k = farmed(h);
  const t = h / STEP;
  const f = t - Math.floor(t);
  const stepped = (Math.floor(t) + smoothJ(0.8, 1, f)) * STEP;
  return { h, k, f, idx: Math.floor(t), y: h + (stepped - h) * k };
}

/** Each terrace's paddies are offset from the next one's, so their divisions don't line up */
const shiftJ = (idx: number) => ((((idx * 37) % 23) + 23) % 23) / 23;
/** Which paddies hold water: a pattern of whole numbers, so JS and the shader agree exactly */
const floodedJ = (idx: number, x: number, z: number) => {
  const zone = Math.floor(x / PADDY.x + shiftJ(idx)) + Math.floor(z / PADDY.y) * 7;
  return (((idx * 7 + zone * 3) % 5) + 5) % 5 < 1;
};

// ---- The sky, shared by the sky dome and every reflection in the paddies ----

const hash21 = (p: V2) => TSL.hash(p.x.add(p.y.mul(157)).add(8192)) as F;
const noise2 = Fn(([q]: [V2]) => {
  const i = floor(q);
  const f = fract(q);
  const u = f.mul(f).mul(f.mul(-2).add(3));
  const a = hash21(i);
  const b = hash21(i.add(vec2(1, 0)));
  const c = hash21(i.add(vec2(0, 1)));
  const d = hash21(i.add(vec2(1, 1)));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
});
const fbm2 = Fn(([q]: [V2]) => {
  const p = vec2(q).toVar();
  const v = float(0).toVar();
  const a = float(0.5).toVar();
  Loop(5, () => {
    v.addAssign(a.mul(noise2(p)));
    p.assign(p.mul(2.03).add(vec2(17.1, 9.2)));
    a.mulAssign(0.5);
  });
  return v;
});

/** The morning sky along a direction: blue, cumulus, and the mountains layered in haze */
const skyColor = Fn(([d]: [V3]) => {
  const dir = normalize(d);
  const e = dir.y;
  const mu = dot(dir, sun);
  const base = mix(HORIZON, ZENITH, smoothstep(-0.02, 0.6, e));
  const glow = vec3(1.0, 0.96, 0.86).mul(pow(saturate(mu), 10).mul(0.22));
  // Cumulus over the mountains
  const q = dir.xz.div(e.add(0.2)).mul(1.2);
  const c = fbm2(q.add(vec2(time.mul(0.006), 0)));
  const lump = smoothstep(0.52, 0.68, c).mul(smoothstep(0.06, 0.18, e));
  const cloud = mix(vec3(0.72, 0.78, 0.88), vec3(1.0, 1.0, 1.0), smoothstep(0.52, 0.8, c));
  const sky = mix(base.add(glow), cloud, lump.mul(0.9)).add(vec3(1.6, 1.55, 1.4).mul(smoothstep(0.99935, 0.9997, mu)));
  // The range: three ridges, each nearer one darker and greener, a band of cloud between them
  const az = atan(dir.x, dir.z.negate());
  const r1 = float(0.07)
    .add(fbm2(vec2(az.mul(3.2), 1.7)).mul(0.08))
    .add(pow(noise2(vec2(az.mul(22), 4.1)), 3).mul(0.025));
  const r2 = float(0.035).add(fbm2(vec2(az.mul(5.5), 6.3)).mul(0.05));
  const r3 = float(0.012).add(fbm2(vec2(az.mul(9), 2.9)).mul(0.03));
  const m1 = smoothstep(r1.add(0.0016), r1, e);
  const m2 = smoothstep(r2.add(0.0014), r2, e);
  const m3 = smoothstep(r3.add(0.0012), r3, e);
  const far = mix(sky, mix(vec3(0.52, 0.6, 0.74), HORIZON, 0.38), m1);
  const band = smoothstep(0.012, 0.03, e)
    .mul(smoothstep(0.06, 0.03, e))
    .mul(fbm2(vec2(az.mul(6), time.mul(0.01))));
  const misty = mix(far, vec3(0.94, 0.96, 0.98), band.mul(m1).mul(0.85));
  const mid = mix(misty, mix(vec3(0.36, 0.48, 0.52), HORIZON, 0.3), m2);
  return mix(mid, mix(vec3(0.24, 0.36, 0.32), HORIZON, 0.22), m3);
});

export function sapaSkyMesh() {
  const material = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false, fog: false });
  material.colorNode = skyColor(normalize(TSL.positionWorld.sub(TSL.cameraPosition)));
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1400, 48, 24), material);
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  return mesh;
}

// ---- The terraces ----

export type Sapa = {
  group: THREE.Group;
  /** Where the page lands (world), on a dry terrace below where you stand */
  landing: THREE.Vector3;
  /** The ground's world height at a point */
  heightAt: (x: number, z: number) => number;
};

export function buildSapa(): Sapa {
  const group = new THREE.Group();
  // The landing: near the outer edge of the nearest terrace to (0.55, -10.8), so there's room
  // behind it on the same terrace to watch from
  let land = { x: 0.55, z: -10.8, y: 0, idx: 0 };
  for (let dz = 0; dz <= 4; dz += 0.05) {
    const z = -10.8 + dz;
    const g = ground(0.55, z);
    if (g.k > 0.9 && g.f > 0.12 && g.f < 0.24) {
      land = { x: 0.55, z, y: g.y, idx: g.idx };
      break;
    }
  }
  const offset = -6 - land.y;
  group.position.y = offset;
  const heightAt = (x: number, z: number) => ground(x, z).y + offset;

  // A grid finer near you, coarse toward the far slope
  const COLS = 420;
  const ROWS = 380;
  const count = (COLS + 1) * (ROWS + 1);
  const pos = new Float32Array(count * 3);
  const hs = new Float32Array(count);
  const ks = new Float32Array(count);
  for (let j = 0; j <= ROWS; j++) {
    const b = j / ROWS;
    const z = 40 - (b * 120 + 650 * b * b * b);
    for (let i = 0; i <= COLS; i++) {
      const a = (i / COLS) * 2 - 1;
      const x = a * 90 + Math.sign(a) * 410 * Math.abs(a) ** 3;
      const g = ground(x, z);
      const n = j * (COLS + 1) + i;
      // Far off, the grid is too coarse for steps (they'd zigzag): the slope stays smooth there
      // and the shader draws the terraces on it
      const near = smoothJ(190, 100, Math.hypot(x * 0.6, z + 11));
      pos[n * 3] = x;
      pos[n * 3 + 1] = g.h + (g.y - g.h) * near;
      pos[n * 3 + 2] = z;
      hs[n] = g.h;
      ks[n] = g.k;
    }
  }
  const index: number[] = [];
  for (let j = 0; j < ROWS; j++) {
    for (let i = 0; i < COLS; i++) {
      const a = j * (COLS + 1) + i;
      const b = a + COLS + 1;
      index.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('aH', new THREE.Float32BufferAttribute(hs, 1));
  geometry.setAttribute('aK', new THREE.Float32BufferAttribute(ks, 1));
  geometry.setIndex(index);
  geometry.computeVertexNormals();

  const material = new THREE.MeshBasicNodeMaterial();
  const H = TSL.attribute('aH', 'float') as F;
  const K = TSL.attribute('aK', 'float') as F;
  const p = TSL.positionWorld.xz;
  const t = H.div(STEP);
  const idx = floor(t);
  const f = fract(t);
  const aa = max(TSL.fwidth(t), 0.004);
  // The bank up to the next terrace, and the bund along each terrace's outer edge
  const bank = smoothstep(0.76, 0.84, f).mul(K);
  const bund = smoothstep(0.0, aa, f)
    .mul(smoothstep(aa.mul(2.5).add(0.03), aa.add(0.02), f))
    .mul(K);
  // Paddies divided across the slope, with a bund at each division
  const shift = mod(mod(idx.mul(37), 23).add(23), 23).div(23);
  const zone = floor(p.x.div(PADDY.x).add(shift)).add(floor(p.y.div(PADDY.y)).mul(7));
  const across = abs(fract(p.x.div(PADDY.x).add(shift).add(0.5)).sub(0.5)).mul(PADDY.x);
  const divide = smoothstep(0.35, 0.15, across).mul(K).mul(oneMinus(bank));
  const flooded = step(mod(mod(idx.mul(7).add(zone.mul(3)), 5).add(5), 5), 0.5)
    .mul(K)
    .mul(
      oneMinus(
        smoothstep(0.5, 0.0, abs(idx.sub(land.idx))).mul(smoothstep(30, 18, length(p.sub(vec2(land.x, land.z)))))
      )
    );
  const hue = TSL.hash(idx.mul(13).add(zone.mul(5)).add(4096)) as F;
  // The terrace you land on is left to grass this year
  const fallow = smoothstep(0.5, 0.0, abs(idx.sub(land.idx))).mul(
    smoothstep(26, 14, length(p.sub(vec2(land.x, land.z))))
  );
  const view = normalize(TSL.positionWorld.sub(TSL.cameraPosition));
  const dist = length(p.sub(TSL.cameraPosition.xz));
  const near = smoothstep(90, 10, dist);
  // Young rice: green, a little different in every paddy, in rows you see close up
  const rows = sin(noise2(p.mul(0.25)).mul(6).add(H.mul(9)))
    .mul(0.5)
    .add(0.5);
  const speck = noise2(p.mul(4.5));
  const rice = mix(vec3(0.4, 0.68, 0.18), vec3(0.66, 0.78, 0.26), hue)
    .mul(float(0.9).add(speck.mul(0.18).mul(near)))
    .mul(oneMinus(rows.mul(near).mul(0.12)));
  // Water: the sky and the mountains in it, a breeze across it, a little silt
  const ripple = noise2(p.mul(0.7).add(vec2(time.mul(0.3), 0)))
    .sub(0.5)
    .mul(0.04);
  const reflected = skyColor(vec3(view.x.add(ripple), abs(view.y), view.z.add(ripple)));
  const glint = pow(saturate(dot(normalize(vec3(view.x, view.y.negate(), view.z)), sun)), 300).mul(2);
  const water = mix(reflected.mul(0.8), vec3(0.3, 0.4, 0.36), 0.22).add(vec3(1.0, 0.97, 0.9).mul(glint));
  const bankColor = vec3(0.26, 0.4, 0.14).mul(float(0.85).add(speck.mul(0.15)));
  const bundColor = vec3(0.46, 0.44, 0.26);
  const grass = mix(vec3(0.34, 0.52, 0.17), vec3(0.48, 0.6, 0.22), noise2(p.mul(0.6)));
  const forest = mix(vec3(0.08, 0.2, 0.09), vec3(0.16, 0.3, 0.12), noise2(p.mul(0.35)));
  const terrace = mix(mix(mix(rice, grass, fallow), water, flooded), bankColor, bank);
  const edged = mix(terrace, bundColor, max(bund, divide).mul(oneMinus(bank)));
  // Forest on the tops; down in the valley, the village's own fields under the mist
  const wild = mix(mix(grass, vec3(0.3, 0.5, 0.2), smoothstep(-110, -118, H)), forest, smoothstep(10, 40, H));
  const surface = mix(wild, edged, K);
  // Sun on the slope (not on the water, which only reflects)
  const lit = float(0.74).add(saturate(dot(TSL.normalWorld, sun)).mul(0.42));
  const shaded = mix(surface.mul(lit), surface, flooded.mul(oneMinus(bank)));
  // Mist in the valley, drifting; haze with distance, the colour of the sky at the horizon
  // Cloud lying in the valley and drifting along the far slope in a long, torn band
  const drift = vec2(time.mul(0.9), 0);
  const torn = smoothstep(
    0.42,
    0.72,
    noise2(p.add(drift).mul(vec2(0.008, 0.02)))
      .mul(0.7)
      .add(noise2(p.add(drift).mul(0.03)).mul(0.3))
  );
  const band = smoothstep(-40, -62, H)
    .mul(smoothstep(-108, -84, H))
    .mul(torn)
    .mul(smoothstep(140, 260, dist));
  const mist = smoothstep(-80, -118, H).mul(0.75).add(band.mul(0.85));
  const hazed = mix(shaded, HORIZON, oneMinus(exp(dist.mul(-0.0011))));
  material.colorNode = mix(hazed, vec3(0.95, 0.97, 0.99), saturate(mist));
  const terrain = new THREE.Mesh(geometry, material);
  terrain.renderOrder = -5;
  terrain.frustumCulled = false;
  group.add(terrain);

  // ---- Young rice close by, as plants ----
  const blades: number[] = [];
  for (let b = 0; b < 6; b++) {
    const a = (b / 6) * Math.PI * 2;
    const lean = 0.25 + (b % 3) * 0.08;
    const cx = Math.cos(a);
    const cz = Math.sin(a);
    const w = 0.035;
    // A thin blade from the root out and up
    blades.push(-w * cz, 0, w * cx, w * cz, 0, -w * cx, cx * lean, 1, cz * lean);
  }
  const tuftGeo = new THREE.BufferGeometry();
  tuftGeo.setAttribute('position', new THREE.Float32BufferAttribute(blades, 3));
  tuftGeo.computeVertexNormals();
  const tuftMat = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  const gy = TSL.positionGeometry.y;
  const sway = sin(time.mul(1.6).add(TSL.hash(TSL.instanceIndex).mul(6.28)))
    .mul(0.12)
    .add(
      noise2(TSL.positionWorld.xz.mul(0.08).add(vec2(time.mul(0.5), 0)))
        .sub(0.5)
        .mul(0.3)
    );
  tuftMat.positionNode = TSL.positionLocal.add(vec3(sway.mul(gy).mul(gy), 0, sway.mul(0.4).mul(gy).mul(gy)));
  tuftMat.colorNode = mix(vec3(0.16, 0.32, 0.08), vec3(0.55, 0.78, 0.26), gy).add(
    vec3(0.3, 0.32, 0.12)
      .mul(pow(saturate(dot(view, sun)), 3))
      .mul(gy)
  );
  const spots: THREE.Matrix4[] = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const v = new THREE.Vector3();
  let seed = 7;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let tries = 0; tries < 30000 && spots.length < 5200; tries++) {
    const x = (rand() - 0.5) * 60;
    const z = -9 - rand() * 46;
    const g = ground(x, z);
    if (g.k < 0.95 || g.f > 0.74 || g.f < 0.07) continue;
    if (floodedJ(g.idx, x, z)) continue;
    // On the fallow terrace you land on, only short grass, and none under the page or by you
    const fallow = g.idx === land.idx && Math.hypot(x - land.x, z - land.z) < 26;
    if (fallow && (Math.hypot(x - land.x, z - land.z) < 1.2 || (Math.abs(x - land.x) < 1.2 && z > land.z))) continue;
    const across = Math.abs(((((x / PADDY.x + shiftJ(g.idx) + 0.5) % 1) + 1) % 1) - 0.5) * PADDY.x;
    if (across < 0.4) continue;
    const size = (0.75 + rand() * 0.5) * (fallow ? 0.32 : 1);
    m.compose(
      v.set(x, g.y, z),
      q.setFromAxisAngle(s.set(0, 1, 0), rand() * 6.28),
      s.set(size, size * (1.1 + rand() * 0.6), size)
    );
    spots.push(m.clone());
  }
  const tufts = new THREE.InstancedMesh(tuftGeo, tuftMat, spots.length);
  spots.forEach((mm, i) => tufts.setMatrixAt(i, mm));
  tufts.frustumCulled = false;
  group.add(tufts);

  // ---- Stilt houses on the far terraces ----
  const wood = new THREE.MeshBasicNodeMaterial();
  const woodLit = float(0.6).add(saturate(dot(TSL.normalWorld, sun)).mul(0.5));
  wood.colorNode = mix(
    vec3(0.36, 0.25, 0.16).mul(woodLit),
    HORIZON,
    oneMinus(exp(length(TSL.positionWorld.xz.sub(TSL.cameraPosition.xz)).mul(-0.0024)))
  );
  const roof = new THREE.MeshBasicNodeMaterial();
  roof.colorNode = mix(
    vec3(0.24, 0.24, 0.26).mul(woodLit),
    HORIZON,
    oneMinus(exp(length(TSL.positionWorld.xz.sub(TSL.cameraPosition.xz)).mul(-0.0024)))
  );
  const body = new THREE.BoxGeometry(9, 5, 6).translate(0, 5.5, 0);
  const roofGeo = new THREE.CylinderGeometry(0.01, 6.2, 4.2, 4, 1)
    .rotateY(Math.PI / 4)
    .scale(1.25, 1, 0.85)
    .translate(0, 10, 0);
  const stilts = new THREE.BoxGeometry(8, 3, 5).translate(0, 1.5, 0);
  const houses: [number, number][] = [
    [-38, -120],
    [-30, -134],
    [44, -150],
    [18, -300],
    [-70, -330],
  ];
  for (const [x, z] of houses) {
    const y = ground(x, z).y;
    const house = new THREE.Group();
    house.add(new THREE.Mesh(body, wood), new THREE.Mesh(roofGeo, roof), new THREE.Mesh(stilts, wood));
    house.position.set(x, y, z);
    house.rotation.y = x * 0.02;
    group.add(house);
  }

  return { group, landing: new THREE.Vector3(land.x, -6.0, land.z), heightAt };
}

// ---- Swallows ----

const BIRDS = 9;

export function swallowsMesh() {
  const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  const g = TSL.positionGeometry;
  const k = (n: number) => TSL.hash(TSL.instanceIndex.add(n * BIRDS + 11)) as F;
  const flap = sin(time.mul(9).add(k(0).mul(6)));
  const wing = abs(g.x);
  const local = vec3(g.x, g.y.add(wing.mul(flap).mul(0.4)), g.z);
  const a = time.mul(float(0.25).add(k(1).mul(0.2))).add(k(2).mul(6.28));
  const r = float(14).add(k(3).mul(26));
  const center = vec3(
    sin(a).mul(r),
    float(2)
      .add(k(4).mul(10))
      .add(sin(time.mul(0.7).add(k(5).mul(9))).mul(2)),
    TSL.cos(a).mul(r).sub(40)
  );
  const heading = a.add(Math.PI / 2);
  const c = TSL.cos(heading);
  const sn = sin(heading);
  material.positionNode = center.add(
    vec3(local.x.mul(c).add(local.z.mul(sn)), local.y, local.z.mul(c).sub(local.x.mul(sn))).mul(0.9)
  );
  material.colorNode = vec3(0.1, 0.11, 0.14);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [
        -1, 0, -0.3, 0, 0.03, 0.3, 0, 0, -0.1, 1, 0, -0.3, 0, 0.03, 0.3, 0, 0, -0.1, -0.25, 0, -0.5, 0, 0.03, 0.2, 0.25,
        0, -0.5,
      ],
      3
    )
  );
  const mesh = new THREE.InstancedMesh(geometry, material, BIRDS);
  mesh.frustumCulled = false;
  return mesh;
}
