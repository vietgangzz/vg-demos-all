import * as TSL from 'three/tsl';
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

import { hex, lacquer, notInReflection, type F, type V3 } from './look';
import type { Kind, Puppet } from './swim';

/**
 * The puppets, carved and lacquered the way water puppets are, out of shapes here, each piece
 * tagged with what it's made of (`part`) and all of a puppet in one material:
 *
 * - the dragon: a big head, all eyes and whiskers and a mane of flames, gold-leafed, and a body of
 *   short wooden sections jointed one into the next, gold scales on them, a red crest along the
 *   back, a fan of flames for a tail
 * - the snake: a cobra, long and green, banded in yellow, its hood spreading as it strikes, its
 *   forked tongue flicking
 */

/** What a piece is made of */
const SCALES = 0;
const FLAME = 1;
const GOLD = 2;
const EYE = 3;
const PUPIL = 4;
const IVORY = 5;
const MOUTH = 6;
const RED = 7;

type Palette = {
  scale: string;
  rim: string;
  belly: string;
  plate: string;
  flame: string;
  flameTip: string;
  gold: string;
  eye: string;
  red: string;
  /** How much of the scales is gold leaf */
  gild: number;
  /** Bands round the body: how many to a metre (0: none), their colour */
  bands: number;
  band: string;
};

const DRAGON_LOOK: Palette = {
  scale: '#F2B63C',
  rim: '#8E1608',
  belly: '#F2D9A0',
  plate: '#A0612A',
  flame: '#C8160C',
  flameTip: '#FF8A1E',
  gold: '#F6C04E',
  eye: '#F3EEDC',
  red: '#B5150C',
  gild: 0.85,
  bands: 0,
  band: '#000000',
};

const SNAKE_LOOK: Palette = {
  scale: '#3E9A3A',
  rim: '#0C2C12',
  belly: '#EAD47C',
  plate: '#8A7A30',
  flame: '#1E5E24',
  flameTip: '#E8C440',
  gold: '#E2B23C',
  eye: '#F4D02A',
  red: '#C0182A',
  gild: 0.25,
  bands: 2.6,
  band: '#F0C832',
};

/** A shape as one of the pieces: the attributes they all share, and what it's made of */
function piece(geometry: THREE.BufferGeometry, part: number, at?: THREE.Matrix4) {
  const g = (geometry.index ? geometry.toNonIndexed() : geometry).clone();
  if (at) g.applyMatrix4(at);
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
  if (!g.getAttribute('uv')) {
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
  }
  g.setAttribute('part', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count).fill(part), 1));
  return g;
}

const place = (x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) =>
  new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')),
    new THREE.Vector3(sx, sy, sz)
  );

/** A flame: a flat tongue, wider at the root, curling to a point (in x/y, pointing +y), extruded thin */
function flame(len: number, wide: number, curl = 0.25, thick = 0.014) {
  const s = new THREE.Shape();
  s.moveTo(-wide / 2, 0);
  s.bezierCurveTo(-wide * 0.7, len * 0.45, curl * len - wide * 0.1, len * 0.75, curl * len, len);
  s.bezierCurveTo(curl * len * 0.4 + wide * 0.25, len * 0.62, wide * 0.75, len * 0.35, wide / 2, 0);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: false, curveSegments: 8 });
  g.translate(0, 0, -thick / 2);
  return g;
}

/** A tube along points, thinning to its tip */
function strand(points: THREE.Vector3[], r: number, taper = 0.25) {
  const curve = new THREE.CatmullRomCurve3(points);
  const g = new THREE.TubeGeometry(curve, 24, r, 6, false);
  const pos = g.getAttribute('position');
  const c = new THREE.Vector3();
  const v = new THREE.Vector3();
  for (let i = 0; i < 25; i++) {
    const k = 1 - (1 - taper) * (i / 24);
    curve.getPointAt(i / 24, c);
    for (let j = 0; j < 7; j++) {
      const idx = i * 7 + j;
      v.fromBufferAttribute(pos, idx).sub(c).multiplyScalar(k).add(c);
      pos.setXYZ(idx, v.x, v.y, v.z);
    }
  }
  g.computeVertexNormals();
  return g;
}

/** A body section: a barrel overlapping the next, a gold collar at its front */
function barrel(r: number, len: number, collar: boolean) {
  const pts: THREE.Vector2[] = [];
  for (let j = 0; j <= 12; j++) {
    const y = -len / 2 + (len * j) / 12;
    pts.push(new THREE.Vector2(r * (0.86 + 0.14 * Math.cos((Math.PI * y) / len)), y));
  }
  const g = new THREE.LatheGeometry(pts, 22);
  g.rotateX(Math.PI / 2);
  const parts = [piece(g, SCALES)];
  if (collar) parts.push(piece(new THREE.TorusGeometry(r * 0.88, r * 0.07, 6, 22), GOLD, place(0, 0, len * 0.42)));
  return parts;
}

function dragonSection(r: number, len: number, tail: boolean) {
  const parts = barrel(r, len, true);
  // The crest: a row of small flames along the back, leaning back
  for (let k = 0; k < 2; k++) {
    const f = flame(r * 0.75, len * 0.3, -0.5, 0.012);
    parts.push(piece(f, FLAME, place(0, r * 0.78, len * (0.18 - k * 0.36), 1, 1, 1, 0, Math.PI / 2, 0)));
  }
  if (tail) {
    for (let k = -2; k <= 2; k++) {
      const f = flame(0.46 - Math.abs(k) * 0.07, 0.13, 0.3 * Math.sign(k || 1));
      parts.push(piece(f, FLAME, place(k * 0.025, 0.02, -len * 0.35, 1, 1, 1, -Math.PI / 2 + 0.25, Math.PI / 2, k * 0.42)));
    }
  }
  return mergeGeometries(parts);
}

function snakeSection(r: number, len: number) {
  return mergeGeometries(barrel(r, len, false));
}

/** The dragon's head, in its own frame: forward +z, up +y, the neck at the origin. The jaw's separate. */
function dragonHead() {
  const parts: THREE.BufferGeometry[] = [];
  const sphere = new THREE.SphereGeometry(1, 28, 18);
  parts.push(piece(sphere, SCALES, place(0, 0.08, 0.06, 0.2, 0.17, 0.24)));
  parts.push(piece(sphere, RED, place(0, 0.035, 0.3, 0.13, 0.085, 0.27)));
  parts.push(piece(sphere, GOLD, place(0, 0.085, 0.52, 0.085, 0.06, 0.07)));
  for (const s of [-1, 1]) {
    parts.push(piece(sphere, MOUTH, place(s * 0.04, 0.1, 0.565, 0.022, 0.018, 0.02)));
    parts.push(piece(sphere, EYE, place(s * 0.125, 0.165, 0.2, 0.075, 0.075, 0.075)));
    parts.push(piece(sphere, PUPIL, place(s * 0.162, 0.18, 0.247, 0.036, 0.036, 0.03, 0, s * 0.55, 0)));
    parts.push(piece(new THREE.TorusGeometry(0.075, 0.012, 6, 20), GOLD, place(s * 0.125, 0.165, 0.2, 1, 1, 1, 0, s * 0.95, 0)));
    parts.push(piece(flame(0.17, 0.07, -0.5), FLAME, place(s * 0.12, 0.23, 0.18, 1, 1, 1, -1.25, Math.PI / 2 + s * 0.35, 0)));
    parts.push(
      piece(
        strand(
          [
            new THREE.Vector3(s * 0.07, 0.2, 0.02),
            new THREE.Vector3(s * 0.13, 0.36, -0.12),
            new THREE.Vector3(s * 0.2, 0.46, -0.32),
            new THREE.Vector3(s * 0.22, 0.5, -0.44),
          ],
          0.026,
          0.35
        ),
        GOLD
      )
    );
    parts.push(
      piece(
        strand(
          [new THREE.Vector3(s * 0.15, 0.4, -0.2), new THREE.Vector3(s * 0.21, 0.5, -0.16), new THREE.Vector3(s * 0.26, 0.56, -0.18)],
          0.016,
          0.3
        ),
        GOLD
      )
    );
    parts.push(
      piece(
        strand(
          [
            new THREE.Vector3(s * 0.09, 0.07, 0.5),
            new THREE.Vector3(s * 0.25, 0.12, 0.42),
            new THREE.Vector3(s * 0.4, 0.04, 0.22),
            new THREE.Vector3(s * 0.52, 0.12, -0.02),
            new THREE.Vector3(s * 0.6, 0.26, -0.18),
          ],
          0.011,
          0.3
        ),
        GOLD
      )
    );
    parts.push(piece(flame(0.2, 0.1, 0.45), FLAME, place(s * 0.17, 0.03, 0.05, 1, 1, 1, 0, Math.PI / 2, s * 1.95)));
    for (let k = 0; k < 4; k++) {
      const z = 0.24 + k * 0.065;
      parts.push(piece(new THREE.ConeGeometry(0.013, 0.045, 6), IVORY, place(s * (0.105 - k * 0.012), -0.025, z, 1, 1, 1, Math.PI, 0, 0)));
    }
    parts.push(piece(new THREE.ConeGeometry(0.018, 0.08, 6), IVORY, place(s * 0.06, -0.03, 0.47, 1, 1, 1, Math.PI, 0, 0)));
  }
  parts.push(piece(sphere, MOUTH, place(0, -0.005, 0.3, 0.105, 0.03, 0.23)));
  for (let k = 0; k < 9; k++) {
    const a = -1.25 + (k / 8) * 2.5;
    const f = flame(0.26 + 0.06 * Math.cos(a * 2), 0.09, -0.3);
    parts.push(piece(f, FLAME, place(Math.sin(a) * 0.12, 0.1 + Math.cos(a) * 0.12, -0.08, 1, 1, 1, -1.9, Math.PI / 2, -a)));
  }
  return mergeGeometries(parts);
}

function dragonJaw() {
  const parts: THREE.BufferGeometry[] = [];
  const sphere = new THREE.SphereGeometry(1, 24, 14);
  parts.push(piece(sphere, RED, place(0, -0.03, 0.18, 0.11, 0.045, 0.23)));
  parts.push(piece(sphere, MOUTH, place(0, -0.005, 0.18, 0.085, 0.02, 0.19)));
  parts.push(piece(sphere, RED, place(0, 0.01, 0.16, 0.05, 0.016, 0.15)));
  for (const s of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      parts.push(piece(new THREE.ConeGeometry(0.012, 0.04, 6), IVORY, place(s * (0.085 - k * 0.012), 0.005, 0.14 + k * 0.07)));
    }
  }
  for (let k = -1; k <= 1; k++) {
    parts.push(piece(flame(0.22, 0.07, 0.4), FLAME, place(k * 0.04, -0.06, 0.1, 1, 1, 1, Math.PI - 0.6, Math.PI / 2, k * 0.3)));
  }
  return mergeGeometries(parts);
}

/** The cobra's head: flat and wide at the back, slit-eyed; its fangs; the jaw's separate */
function snakeHead() {
  const parts: THREE.BufferGeometry[] = [];
  const sphere = new THREE.SphereGeometry(1, 26, 16);
  parts.push(piece(sphere, SCALES, place(0, 0.035, 0.1, 0.11, 0.065, 0.19)));
  parts.push(piece(sphere, SCALES, place(0, 0.03, 0.22, 0.085, 0.05, 0.12)));
  for (const s of [-1, 1]) {
    parts.push(piece(sphere, EYE, place(s * 0.075, 0.07, 0.17, 0.034, 0.034, 0.034)));
    parts.push(piece(sphere, PUPIL, place(s * 0.098, 0.076, 0.185, 0.008, 0.026, 0.012, 0, s * 0.6, 0)));
    parts.push(piece(new THREE.ConeGeometry(0.01, 0.06, 6), IVORY, place(s * 0.045, -0.02, 0.27, 1, 1, 1, Math.PI + 0.2, 0, 0)));
    // A yellow brow ridge
    parts.push(piece(sphere, GOLD, place(s * 0.07, 0.095, 0.15, 0.03, 0.012, 0.06, 0, s * 0.3, 0)));
  }
  parts.push(piece(sphere, MOUTH, place(0, -0.0, 0.18, 0.08, 0.02, 0.13)));
  return mergeGeometries(parts);
}

function snakeJaw() {
  const parts: THREE.BufferGeometry[] = [];
  const sphere = new THREE.SphereGeometry(1, 22, 12);
  parts.push(piece(sphere, SCALES, place(0, -0.015, 0.1, 0.085, 0.03, 0.16)));
  parts.push(piece(sphere, MOUTH, place(0, 0.0, 0.1, 0.065, 0.015, 0.13)));
  return mergeGeometries(parts);
}

/** The cobra's tongue: forked, red, flicking out from the jaw */
function snakeTongue() {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(piece(new THREE.CylinderGeometry(0.006, 0.008, 0.12, 6), RED, place(0, 0, 0.06, 1, 1, 1, Math.PI / 2, 0, 0)));
  for (const s of [-1, 1]) {
    parts.push(piece(new THREE.ConeGeometry(0.005, 0.06, 5), RED, place(s * 0.012, 0, 0.14, 1, 1, 1, Math.PI / 2, 0, -s * 0.35)));
  }
  return mergeGeometries(parts);
}

/** The hood: a wide, thin fan of skin behind the head, the spectacle mark on its back */
function hood() {
  const g = new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  return mergeGeometries([piece(g, SCALES, place(0, 0.02, -0.08, 0.2, 0.025, 0.24, -Math.PI / 2 + 0.25, 0, 0))]);
}

function puppetMaterial(look: Palette) {
  const m = new THREE.MeshBasicNodeMaterial();
  const part = TSL.attribute('part', 'float') as unknown as F;
  const wet = TSL.uniform(0).onObjectUpdate(({ object }) => (object?.userData.wet as number) ?? 0) as unknown as F;
  const is = (k: number) => TSL.step(k - 0.5, part).mul(TSL.step(part, k + 0.5)) as unknown as F;
  const pl = TSL.positionLocal as unknown as V3;
  // The flames flutter a little
  const flutter = TSL.sin(TSL.time.mul(6.5).add(pl.z.mul(14)).add(pl.y.mul(9))).mul(0.008).mul(is(FLAME));
  m.positionNode = pl.add(TSL.vec3(flutter, flutter.mul(0.5), 0));
  m.colorNode = TSL.Fn(() => {
    notInReflection();
    // Scales: rows along the body, staggered, each a scallop edged darker
    const around = TSL.atan(pl.x, pl.y.negate());
    const q = TSL.vec2(around.mul(13 / (2 * Math.PI)), pl.z.mul(30));
    const row = TSL.floor(q.y);
    const cell = TSL.fract(TSL.vec2(q.x.add(TSL.mod(row, 2).mul(0.5)), q.y));
    const d = TSL.length(TSL.vec2(cell.x.sub(0.5), cell.y.mul(0.95)));
    const rim = TSL.smoothstep(0.38, 0.5, d);
    const belly = TSL.smoothstep(-0.25, -0.65, TSL.normalLocal.y);
    const plates = TSL.smoothstep(0.82, 0.95, TSL.fract(pl.z.mul(26)));
    let scaleCol = TSL.mix(hex(look.scale), hex(look.rim), rim.mul(0.85)) as unknown as V3;
    if (look.bands > 0) {
      // A band round the front of each section
      const band = TSL.smoothstep(0.03, 0.018, TSL.abs(pl.z.sub(0.035)));
      scaleCol = TSL.mix(scaleCol, hex(look.band), band.mul(TSL.float(1).sub(rim.mul(0.6)))) as unknown as V3;
    }
    const bellyCol = TSL.mix(hex(look.belly), hex(look.plate), plates);
    const scales = TSL.mix(scaleCol, bellyCol, belly);
    const scalesGild = TSL.mix(TSL.mix(TSL.float(look.gild), TSL.float(0.12), rim), TSL.float(0.1), belly);
    const tip = TSL.smoothstep(0.0, 1.0, TSL.uv().y);
    const flameCol = TSL.mix(hex(look.flame), hex(look.flameTip), tip.mul(0.7));
    const base = scales
      .mul(is(SCALES))
      .add(flameCol.mul(is(FLAME)))
      .add(hex(look.gold).mul(is(GOLD)))
      .add(hex(look.eye).mul(is(EYE)))
      .add(hex('#0B0705').mul(is(PUPIL)))
      .add(hex('#F2E6C8').mul(is(IVORY)))
      .add(hex('#3A0606').mul(is(MOUTH)))
      .add(hex(look.red).mul(is(RED))) as unknown as V3;
    const gild = scalesGild
      .mul(is(SCALES))
      .add(TSL.float(0.12).mul(is(FLAME)))
      .add(is(GOLD)) as unknown as F;
    const lit = lacquer(base, gild, wet.add(is(PUPIL).mul(0.8)) as unknown as F);
    // The eyes glow a little, so they read in the dark
    return lit.add(hex(look.eye).mul(is(EYE).mul(0.2)));
  })();
  return m;
}

export type PuppetModel = { root: THREE.Group; pose: (p: Puppet) => void };

function sections(kind: Kind, material: THREE.Material, make: (r: number, len: number, i: number) => THREE.BufferGeometry) {
  return Array.from({ length: kind.segments }, (_, i) => {
    const r = kind.girth(i / (kind.segments - 1));
    const mesh = new THREE.Mesh(make(r, kind.spacing * 1.18, i), material);
    mesh.userData.wet = 0;
    return mesh;
  });
}

function poseBody(meshes: THREE.Mesh[], p: Puppet) {
  for (let i = 0; i < meshes.length; i++) {
    const seg = p.body[i];
    meshes[i].position.copy(seg.pos);
    meshes[i].quaternion.copy(seg.quat);
    meshes[i].userData.wet = seg.wet;
  }
}

export function buildDragon(kind: Kind): PuppetModel {
  const material = puppetMaterial(DRAGON_LOOK);
  const root = new THREE.Group();
  const head = new THREE.Group();
  const headMesh = new THREE.Mesh(dragonHead(), material);
  const jaw = new THREE.Group();
  jaw.position.set(0, -0.02, 0.1);
  const jawMesh = new THREE.Mesh(dragonJaw(), material);
  jaw.add(jawMesh);
  head.add(headMesh, jaw);
  head.scale.setScalar(1.6);
  root.add(head);
  const body = sections(kind, material, (r, len, i) => dragonSection(r, len, i === kind.segments - 1));
  root.add(...body);
  root.traverse((o) => {
    o.frustumCulled = false;
  });
  return {
    root,
    pose(p) {
      head.position.copy(p.head.pos);
      head.quaternion.copy(p.head.quat);
      jaw.rotation.x = p.head.jaw;
      headMesh.userData.wet = jawMesh.userData.wet = p.body[0].wet;
      poseBody(body, p);
    },
  };
}

export function buildSnake(kind: Kind): PuppetModel {
  const material = puppetMaterial(SNAKE_LOOK);
  const root = new THREE.Group();
  const head = new THREE.Group();
  const headMesh = new THREE.Mesh(snakeHead(), material);
  const jaw = new THREE.Group();
  jaw.position.set(0, -0.015, 0.06);
  const jawMesh = new THREE.Mesh(snakeJaw(), material);
  const tongue = new THREE.Mesh(snakeTongue(), material);
  tongue.position.set(0, 0.0, 0.08);
  jaw.add(jawMesh, tongue);
  const hoodMesh = new THREE.Mesh(hood(), material);
  head.add(headMesh, jaw, hoodMesh);
  head.scale.setScalar(1.95);
  root.add(head);
  const body = sections(kind, material, (r, len) => snakeSection(r, len));
  root.add(...body);
  root.traverse((o) => {
    o.frustumCulled = false;
  });
  let flick = 0;
  return {
    root,
    pose(p) {
      head.position.copy(p.head.pos);
      head.quaternion.copy(p.head.quat);
      jaw.rotation.x = p.head.jaw * 0.85;
      // The hood spreads as it strikes or rears, folded flat otherwise
      const angry = Math.min(1, Math.max(0, (p.head.jaw - 0.25) * 2.2));
      hoodMesh.scale.set(0.35 + angry * 0.95, 1, 0.75 + angry * 0.25);
      // The tongue: out and in, in quick flicks every second or so
      flick = (p.t * 1.1) % 1;
      const out = flick < 0.25 ? Math.sin((flick / 0.25) * Math.PI) : 0;
      tongue.scale.set(1, 1, 0.2 + out * 1.4);
      tongue.rotation.x = Math.sin(p.t * 40) * 0.15 * out;
      headMesh.userData.wet = jawMesh.userData.wet = tongue.userData.wet = hoodMesh.userData.wet = p.body[0].wet;
      poseBody(body, p);
    },
  };
}
