import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as TSL from 'three/tsl';
import * as THREE from 'three/webgpu';

import { hex, light, radial, shade, type V3 } from './light';

/**
 * Santa's sleigh and the team pulling it, modelled in Blender (scripts/blender/fairy_globe_models.py):
 * eight reindeer in pairs and Rudolph out in front with his nose lit, galloping on air.
 *
 * The team's own frame: facing +z, up +y, in model units (a reindeer is about 1.7 tall); the whole
 * thing is scaled down to fly over the globe.
 */

type Joint = { at: number[]; joint: number[]; front: boolean };
type Part = {
  p: string;
  n: string;
  c: string;
  /** What each vertex is made of (fur, fluff, felt, skin, leather, metal, gloss, wood, bone) */
  k?: string;
  i: string;
  pivot: number[];
  neck?: number[];
  legs?: Joint[];
  nose?: number[];
  /** Santa: his right shoulder (the arm hangs from it), his hands */
  arm?: number[];
  hand_r?: number[];
  hand_l?: number[];
};

const MODELS = require('../../../assets/fairy-globe/models.json') as Record<string, Part>;

function bytes(b64: string) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

const cache = new Map<string, THREE.BufferGeometry>();

function geometry(name: string) {
  const hit = cache.get(name);
  if (hit) return hit;
  const part = MODELS[name];
  const p = new Float32Array(bytes(part.p).buffer);
  const n8 = new Int8Array(bytes(part.n).buffer);
  const c8 = bytes(part.c);
  const ib = bytes(part.i);
  const count = p.length / 3;
  const index = count < 65535 ? new Uint16Array(ib.buffer) : new Uint32Array(ib.buffer);
  const normal = new Float32Array(n8.length);
  for (let k = 0; k < n8.length; k++) normal[k] = n8[k] / 127;
  const colour = new Float32Array(c8.length);
  for (let k = 0; k < c8.length; k++) colour[k] = c8[k] / 255;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  g.setAttribute('color', new THREE.BufferAttribute(colour, 3));
  const kind = new Float32Array(count);
  if (part.k) kind.set(bytes(part.k));
  g.setAttribute('kind', new THREE.BufferAttribute(kind, 1));
  g.setIndex(new THREE.BufferAttribute(index, 1));
  g.computeBoundingSphere();
  cache.set(name, g);
  return g;
}

/** A geometry painted one colour, of one stuff, for the toy material */
function painted(g: THREE.BufferGeometry, colour: string, kind: number) {
  const c = new THREE.Color(colour);
  const n = g.attributes.position.count;
  const rgb = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) rgb.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(rgb, 3));
  g.setAttribute('kind', new THREE.BufferAttribute(new Float32Array(n).fill(kind), 1));
  g.deleteAttribute('uv');
  return g;
}

let harnessGeo: THREE.BufferGeometry | null = null;
/**
 * A deer's collar: a red leather strap round the base of the neck, sleigh bells along it, in the
 * deer's own frame
 */
function harness() {
  if (harnessGeo) return harnessGeo;
  const strap = painted(new THREE.TorusGeometry(0.17, 0.028, 6, 20), '#9E1F1F', LEATHER);
  // Round the neck where it leans forward out of the chest
  strap
    .scale(1, 1.15, 1)
    .rotateX(Math.PI / 2 - 0.75)
    .translate(0, 1.13, 0.6);
  const bells = [-0.8, -0.4, 0, 0.4, 0.8].map((a) => {
    const b = painted(new THREE.SphereGeometry(0.038, 10, 8), '#E9B949', METAL);
    // Hung under the strap, round the front of it
    return b.translate(Math.sin(a) * 0.17, 1.13 - Math.cos(a) * 0.2 * 0.7, 0.6 + Math.cos(a) * 0.17 * 0.75);
  });
  harnessGeo = mergeGeometries([strap, ...bells], false) ?? strap;
  return harnessGeo;
}

// What a surface is made of (fairy_globe_models.py)
const FUR = 1;
const FLUFF = 2;
const FELT = 3;
const SKIN = 4;
const LEATHER = 5;
const METAL = 6;
const GLOSS = 7;
const WOOD = 8;
const BONE = 9;

let toyMat: THREE.Material | null = null;
/**
 * Lit like everything else, with a warm edge so the team stands out against the night; and each
 * surface the way its stuff is: fur in strands, fluff in tufts with a soft glow at its edge, felt and
 * velvet with a sheen, a shine on leather, brass that catches the light, a glint in an eye
 */
function material() {
  if (toyMat) return toyMat;
  const { float, vec3, mix, saturate, dot, pow, step, mx_noise_float, mx_fractal_noise_float } = TSL;
  const m = new THREE.MeshBasicNodeMaterial();
  const n = TSL.normalize(TSL.normalWorld) as unknown as V3;
  const albedo = TSL.attribute('color', 'vec3') as unknown as V3;
  const kind = TSL.attribute('kind', 'float');
  const is = (k: number) => step(k - 0.5, kind).mul(step(kind, k + 0.5));
  const view = TSL.normalize(TSL.cameraPosition.sub(TSL.positionWorld)) as unknown as V3;
  const ndv = saturate(dot(n, view));
  const rim = pow(float(1).sub(ndv), 2.5);
  const p = TSL.positionLocal;
  // The fine surface: strands running down the fur, tufts in the fluff, the weave of felt, grain in bone
  const strands = mx_noise_float(p.mul(vec3(240, 60, 240)))
    .mul(0.2)
    .add(1);
  const tufts = mx_fractal_noise_float(p.mul(80), 3, 2.0, 0.5).mul(0.24).add(1);
  const weave = mx_noise_float(p.mul(520)).mul(0.06).add(1);
  const grain = mx_noise_float(p.mul(vec3(40, 260, 40)))
    .mul(0.08)
    .add(1);
  const fine = float(1)
    .add(strands.sub(1).mul(is(FUR)))
    .add(tufts.sub(1).mul(is(FLUFF)))
    .add(weave.sub(1).mul(is(FELT)))
    .add(grain.sub(1).mul(is(BONE).add(is(WOOD))));
  const up = radial();
  // Bone and antler warm, so the moonlight doesn't turn them grey-blue
  const tone = mix(vec3(1, 1, 1), vec3(1.1, 1.0, 0.84), is(BONE));
  // A reindeer's coat: pale cream under the belly and the throat, darker along the back
  const under = TSL.smoothstep(-0.1, -0.7, n.y).mul(is(FUR));
  const back = TSL.smoothstep(0.55, 0.95, n.y).mul(is(FUR));
  const coat = mix(mix(albedo, hex('#E8D2AE').mul(0.85), under.mul(0.7)), albedo.mul(0.72), back.mul(0.5));
  const lit = shade(coat.mul(fine).mul(tone) as unknown as V3, n, up, 0.45).mul(1.15);
  // Brass looks like brass: what it mirrors goes from dark below to bright above
  const r = TSL.reflect(view.negate(), n);
  const metal = albedo.mul(saturate(dot(r, up).mul(0.5).add(0.55))).mul(1.25);
  const body = mix(lit, metal, is(METAL).mul(0.6));
  // Highlights, from high over the shoulder
  const key = TSL.normalize(
    up
      .mul(0.8)
      .add(light.moon as unknown as V3)
      .add(view.mul(0.4))
  );
  const hl = saturate(dot(r, key));
  const spec = pow(hl, 26)
    .mul(is(METAL).mul(1.3))
    .add(pow(hl, 140).mul(is(GLOSS).mul(1.6)))
    .add(pow(hl, 14).mul(is(LEATHER).mul(0.22)))
    .add(pow(hl, 8).mul(is(SKIN).mul(0.07)))
    .add(pow(hl, 20).mul(is(WOOD).mul(0.16)));
  const specColour = mix(vec3(1.0, 0.97, 0.9), albedo.mul(1.4).add(0.2), is(METAL));
  // The soft edge light: strongest on fluff and fur, a velvet sheen on felt, warm through skin
  const edge = float(0.3).add(is(FLUFF).mul(0.2)).add(is(FUR).mul(0.15)).add(is(FELT).mul(0.1));
  const edgeColour = mix(hex('#FFD9A0'), hex('#FF9A80'), is(SKIN));
  m.colorNode = body.add(specColour.mul(spec)).add(edgeColour.mul(rim.mul(edge)));
  toyMat = m;
  return m;
}

/** Where the deer fly, in the sleigh's frame: four pairs and Rudolph out in front */
const TEAM = [
  [-0.55, 2.0],
  [0.55, 2.0],
  [-0.55, 3.25],
  [0.55, 3.25],
  [-0.55, 4.5],
  [0.55, 4.5],
  [-0.55, 5.75],
  [0.55, 5.75],
  [0, 7.0],
];

// ---- The gallop ----
//
// A transverse gallop, the way a deer runs: the hind legs land one just after the other and drive,
// then the forelegs, then all four are off the ground, gathered under. Each leg's swing (forward +)
// and the fold at its knee or hock, through one stride; the legs take it up a little apart.
type Key = [number, number, number];
const FORE: Key[] = [
  [0.0, 0.5, 0.1],
  [0.2, 0.08, 0.0],
  [0.4, -0.5, 0.12],
  [0.55, -0.5, 1.35],
  [0.72, 0.25, 1.75],
  [0.88, 0.85, 0.45],
];
const HIND: Key[] = [
  [0.0, 0.5, 0.35],
  [0.2, 0.05, 0.12],
  [0.4, -0.62, 0.05],
  [0.55, -0.5, 0.85],
  [0.74, 0.3, 1.0],
  [0.9, 0.62, 0.6],
];
/** Where in the stride each leg is: hinds together, then fores, then the leap */
const OFFSET = [0.42, 0.5, 0.0, 0.08];

/** Periodic Catmull-Rom through the keys at u in [0, 1) */
function sample(keys: Key[], u: number, out: [number, number]) {
  const n = keys.length;
  let i = n - 1;
  for (let k = 0; k < n; k++) if (keys[k][0] <= u) i = k;
  const k0 = keys[(i - 1 + n) % n];
  const k1 = keys[i];
  const k2 = keys[(i + 1) % n];
  const k3 = keys[(i + 2) % n];
  const span = (k2[0] - k1[0] + 1) % 1 || 1;
  const t = ((u - k1[0] + 1) % 1) / span;
  const t2 = t * t;
  const t3 = t2 * t;
  for (let j = 1; j <= 2; j++) {
    const p0 = k0[j];
    const p1 = k1[j];
    const p2 = k2[j];
    const p3 = k3[j];
    out[j - 1] =
      0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  }
}

type Leg = { upper: THREE.Group; lower: THREE.Group; front: boolean };
type Deer = { g: THREE.Group; head: THREE.Group; legs: Leg[]; phase: number; baseY: number };
const swing: [number, number] = [0, 0];

/**
 * Pose one deer at a point in its stride: `ph` in radians (one stride a turn), `stride` from 0
 * (standing) to 1 (flat out). Returns how high the body rides and how it pitches, for the caller.
 */
function gallop(d: Deer, ph: number, stride: number, idle: number) {
  const u = (((ph / (Math.PI * 2)) % 1) + 1) % 1;
  d.legs.forEach((leg, k) => {
    sample(leg.front ? FORE : HIND, (u + OFFSET[k]) % 1, swing);
    // Forward is -x in three's turn; a foreleg's knee folds the hoof back, a hind leg's hock forward
    leg.upper.rotation.x = -swing[0] * stride;
    leg.lower.rotation.x = (leg.front ? 1 : -1) * swing[1] * stride;
  });
  // The body rides highest in the leap and dips as the forelegs take it; it rocks nose-down onto
  // them and up again as the hinds drive; the head and neck swing against it to keep the eyes level
  const w = u * Math.PI * 2;
  const rise = Math.sin(w + 1.2) * 0.06 * stride;
  const pitch = Math.sin(w - 0.6) * 0.09 * stride;
  // Flying, the neck reaches out ahead
  d.head.rotation.x = -pitch * 1.6 + Math.sin(w + 0.4) * 0.08 * stride + 0.1 * stride + idle;
  return { rise, pitch, w };
}

/** A smooth wander between -1 and 1, different for every seed */
const wander = (t: number, s: number) =>
  (Math.sin(t * 0.71 + s * 3.1) + Math.sin(t * 1.37 + s * 5.3) * 0.6 + Math.sin(t * 0.29 + s * 1.7) * 0.4) / 2;
/** Now and then (about every `every` seconds), a moment of it: 0, up to 1 and back */
const onceIn = (t: number, s: number, every: number) =>
  Math.max(0, Math.sin((t * Math.PI * 2) / every + s * 7.7)) ** 10;

/**
 * Everything a deer does besides the gallop: flying, it rolls a little with each stride and drifts
 * on its own in the air, so the team never moves as one block; standing, it shifts its weight,
 * breathes, looks about, paws at the roof; braced, it skids in with its forelegs out; rearing, it
 * gathers itself to spring off.
 */
function live(d: Deer, pose: DeerPose, w: number) {
  const s = d.phase;
  const t = pose.t ?? 0;
  const fly = pose.stride;
  const still = 1 - fly;
  const brace = pose.brace ?? 0;
  const rear = pose.rear ?? 0;
  // Looking about: a little in the air, more standing
  d.head.rotation.y = wander(t * 0.8, s) * (0.12 + 0.3 * still);
  d.head.rotation.z = wander(t * 0.6, s + 2) * 0.06 * still;
  // Standing: hocks a little bent, weight on one side then the other, a hoof pawing now and then
  const paw = onceIn(t, s, 5.5) * still * (1 - brace);
  d.legs.forEach((leg, k) => {
    if (leg.front) {
      const pawing = k === Math.round(s * 3) % 2 ? paw : 0;
      leg.upper.rotation.x += (-0.55 * pawing - 0.5 * brace - 0.7 * rear) * (1 - fly * 0.5);
      leg.lower.rotation.x += 1.35 * pawing + 0.15 * brace + 1.7 * rear;
    } else {
      leg.upper.rotation.x += (0.1 * still - 0.2 * brace + 0.35 * rear) * (1 - fly * 0.5);
      leg.lower.rotation.x += -0.16 * still - 0.3 * rear;
    }
  });
  // The body: a roll with the stride and a drift of its own in the air; a sway and a breath standing
  const roll = Math.sin(w + s) * 0.05 * fly + wander(t * 0.9, s + 4) * 0.035 * still;
  const yaw = Math.sin(w * 0.5 + s * 1.3) * 0.045 * fly;
  const drift = (wander(t * 1.6, s + 6) * 0.1 + wander(t * 1.1, s + 9) * 0.05) * fly;
  const breath = Math.sin(t * 1.9 + s) * 0.008 * still;
  return { roll, yaw, drift, breath, pitch: -0.1 * brace - 0.28 * rear };
}

/** The deer down each side of the team, nearest the sleigh first, Rudolph last */
const SIDE: number[][] = [0, 1].map((side) =>
  TEAM.map((_, k) => k).filter((k) => k === TEAM.length - 1 || (k % 2 === 0) === (side === 0))
);
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

/** One of the team, posed on its own (a free team): where it is, which way, how big, its stride */
export type DeerPose = {
  at: THREE.Vector3;
  q: THREE.Quaternion;
  scale: number;
  /** Where in its stride, radians: a turn a stride */
  phase: number;
  /** 0 standing to 1 flat out */
  stride: number;
  lift: number;
  /** Standing: the head's nod (radians) */
  idle: number;
  /** Its clock, seconds, for the little things it does on its own */
  t?: number;
  /** Skidding in to land: forelegs out, 0 to 1 */
  brace?: number;
  /** Gathering itself to spring off: forelegs tucked up, nose up, 0 to 1 */
  rear?: number;
};

export type Team = {
  group: THREE.Group;
  /** Rudolph's nose, for the glow */
  nose: THREE.Object3D;
  /** Under the runners, where the sparkle trail comes off */
  runners: THREE.Object3D[];
  /** Under each deer, where a little stardust comes off its hooves */
  hooves: THREE.Object3D[];
  /** Over the sack, where a present leaves from */
  sack: THREE.Object3D;
  /** Santa himself, so he can climb out */
  santa: THREE.Group;
  /** His right arm, from the shoulder: for the throw */
  santaArm: THREE.Group;
  /** His right hand, where a present is held (and his right rein, unless he's using it) */
  handRight: THREE.Object3D;
  /** How much his right rein is in his left hand (while the right one's busy), 0 to 1 */
  hold: { right: number };
  /** The lanterns' flames, for their glow */
  lamps: THREE.Object3D[];
  /** A team that isn't free: the deer galloping, `pace` from 0 (easy) to 1 (flat out) */
  update: (t: number, pace: number) => void;
  /** A free team: the sleigh moved by itself, so the deer can each be put where they're going */
  sleigh: THREE.Group;
  deer: Deer[];
  /** Where each deer stands in the team's own frame (to place them by, when they're not free) */
  slots: [number, number][];
  /** Free team: pose each deer (in the team group's frame), then the reins follow */
  poseDeer: (k: number, pose: DeerPose) => void;
  poseSleigh: (at: THREE.Vector3, q: THREE.Quaternion, scale: number, t: number, bob: number) => void;
  /** Santa from the hips, radians: lean forward (+), turn to his left (+), rock to his right (+); lift, model units */
  poseSanta: (lean: number, twist: number, rock: number, lift: number) => void;
};

/** Where Santa bends, sitting: his hips */
const HIP = new THREE.Vector3(0, 0.62, -0.2);

/**
 * The team; `toy` lights them (the globe's light by default). A `free` team's group is just a
 * frame: the sleigh and every deer in it are posed separately (poseSleigh, poseDeer), so the team
 * can bend round a turn the way a real one strings out behind its leader, and the reins stretch
 * between them.
 */
export function buildTeam(toy: THREE.Material = material(), free = false): Team {
  const group = new THREE.Group();
  const sleigh = new THREE.Group();
  // In a free team the sleigh's things hang off the sleigh, not the frame
  const body = free ? sleigh : group;
  sleigh.add(new THREE.Mesh(geometry('sleigh'), toy));
  const santa = new THREE.Group();
  santa.add(new THREE.Mesh(geometry('santa'), toy));
  const shoulder = MODELS.santa.arm!;
  const santaArm = new THREE.Group();
  santaArm.position.set(shoulder[0], shoulder[1], shoulder[2]);
  santaArm.add(new THREE.Mesh(geometry('santa_arm'), toy));
  santa.add(santaArm);
  const handRight = new THREE.Object3D();
  handRight.position.fromArray(MODELS.santa.hand_r!);
  santaArm.add(handRight);
  const handLeftAt = new THREE.Vector3().fromArray(MODELS.santa.hand_l!);
  const hold = { right: 0 };
  sleigh.add(santa);
  sleigh.add(new THREE.Mesh(geometry('sack'), toy));
  group.add(sleigh);

  const joints = MODELS.deer.legs!;
  const neckAt = MODELS.deer.neck!;
  const noseAt = MODELS.deer.nose!;
  const hooves: THREE.Object3D[] = [];
  const deer: Deer[] = TEAM.map(([x, z], i) => {
    const g = new THREE.Group();
    g.position.set(x, 0.35, z);
    g.add(new THREE.Mesh(geometry('deer'), toy));
    const head = new THREE.Group();
    head.position.set(neckAt[0], neckAt[1], neckAt[2]);
    head.add(new THREE.Mesh(geometry('deer_head'), toy));
    g.add(head);
    const legs = joints.map((j) => {
      const upper = new THREE.Group();
      upper.position.set(j.at[0], j.at[1], j.at[2]);
      // A little sturdier than modelled: a toy deer's legs, not a real one's
      const thigh = new THREE.Mesh(geometry(j.front ? 'leg_fu' : 'leg_hu'), toy);
      thigh.scale.set(1.35, 1, 1.35);
      upper.add(thigh);
      const lower = new THREE.Group();
      lower.position.set(j.joint[0], j.joint[1], j.joint[2]);
      const shin = new THREE.Mesh(geometry(j.front ? 'leg_fl' : 'leg_hl'), toy);
      shin.scale.set(1.3, 1, 1.3);
      lower.add(shin);
      upper.add(lower);
      g.add(upper);
      return { upper, lower, front: j.front };
    });
    g.add(new THREE.Mesh(harness(), toy));
    const hoof = new THREE.Object3D();
    hoof.position.set(0, 0.45, 0.05);
    g.add(hoof);
    hooves.push(hoof);
    group.add(g);
    // Each a little out of step with the others, the way a real team runs
    return { g, head, legs, phase: i * 0.55 + (i % 2) * 0.3, baseY: 0.35 + (i === TEAM.length - 1 ? 0.15 : 0) };
  });
  const rudolph = deer[deer.length - 1].head;
  const noseMat = new THREE.MeshBasicNodeMaterial();
  noseMat.colorNode = hex('#FF2A2A').mul(TSL.sin(TSL.time.mul(4)).mul(0.25).add(1.6));
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 12), noseMat);
  nose.position.set(noseAt[0], noseAt[1], noseAt[2] + 0.01);
  rudolph.add(nose);

  // Reins: red leather from Santa's hands out to every collar, sagging a little (dark enough not to
  // glow: lit gold, under the bloom they read as beams of light)
  const reinMat = new THREE.MeshBasicNodeMaterial();
  reinMat.colorNode = hex('#7A1F1C').mul(0.8);
  // A free team's reins are straight runs, restretched every frame between the hands and the collars
  const reins = free
    ? new THREE.InstancedMesh(
        new THREE.CylinderGeometry(1, 1, 1, 5, 1, true).translate(0, 0.5, 0),
        reinMat,
        TEAM.length * 2
      )
    : null;
  if (reins) {
    reins.frustumCulled = false;
    group.add(reins);
  }
  for (const [x, z] of free ? [] : TEAM) {
    for (const side of [-1, 1]) {
      const from = new THREE.Vector3(side * 0.25, 0.78, 0.1);
      const to = new THREE.Vector3(x + side * 0.14, 0.35 + 1.1, z + 0.6);
      const mid = from.clone().lerp(to, 0.5);
      mid.y -= 0.12;
      const curve = new THREE.QuadraticBezierCurve3(from, mid, to);
      group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.009, 4, false), reinMat));
    }
  }

  const runners = [-0.42, 0.42].map((x) => {
    const o = new THREE.Object3D();
    o.position.set(x, 0.02, -0.6);
    body.add(o);
    return o;
  });
  const sack = new THREE.Object3D();
  sack.position.set(0, 1.25, -0.95);
  body.add(sack);

  // Two carriage lanterns on brass posts at the front corners, and a lit lamp on the back
  const brass = new THREE.MeshBasicNodeMaterial();
  brass.colorNode = hex('#E3B04B').mul(0.9);
  const flame = new THREE.MeshBasicNodeMaterial();
  flame.colorNode = hex('#FFD38A').mul(TSL.sin(TSL.time.mul(11)).mul(0.08).add(1.8));
  const lamps: THREE.Object3D[] = [];
  for (const [x, y, z] of [
    [-0.46, 0.92, 0.66],
    [0.46, 0.92, 0.66],
    [0, 1.32, -1.08],
  ]) {
    const lamp = new THREE.Group();
    lamp.position.set(x, y, z);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.32, 8), brass);
    post.position.y = -0.2;
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.07, 4).rotateY(Math.PI / 4), brass);
    cap.position.y = 0.1;
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.025, 0.1), brass);
    base.position.y = -0.065;
    const glass = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.11, 0.075), flame);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.006, 6, 12), brass);
    ring.position.y = 0.15;
    // Corner bars over the glass
    for (const [bx, bz] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.12, 0.012), brass);
      bar.position.set(bx * 0.04, 0, bz * 0.04);
      lamp.add(bar);
    }
    lamp.add(post, cap, base, glass, ring);
    body.add(lamp);
    const glowAt = new THREE.Object3D();
    lamp.add(glowAt);
    lamps.push(glowAt);
  }

  // ---- A free team, posed piece by piece ----
  const hand = new THREE.Vector3();
  const handL = new THREE.Vector3();
  const handR = new THREE.Vector3();
  const collar = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const mtx = new THREE.Matrix4();
  const qr = new THREE.Quaternion();
  const UP = new THREE.Vector3(0, 1, 0);
  const sc = new THREE.Vector3();
  const poseDeer = (k: number, pose: DeerPose) => {
    const d = deer[k];
    d.g.position.copy(pose.at);
    d.g.quaternion.copy(pose.q);
    d.g.scale.setScalar(pose.scale);
    // Galloping; standing (stride near 0), just the head going up and down now and then
    const idle = (1 - pose.stride) * pose.idle;
    const { rise, pitch, w } = gallop(d, pose.phase, pose.stride, idle);
    const l = live(d, pose, w);
    d.g.position.y += (rise + pose.lift + l.drift + l.breath) * pose.scale;
    d.g.rotateY(l.yaw);
    d.g.rotateX(pitch + l.pitch);
    d.g.rotateZ(l.roll);
  };
  /** Santa from the hips: leaning, turning, rocking, bouncing in his seat */
  const santaTurn = new THREE.Euler(0, 0, 0, 'YXZ');
  const poseSanta = (lean: number, twist: number, rock: number, lift: number) => {
    santa.quaternion.setFromEuler(santaTurn.set(lean, twist, rock, 'YXZ'));
    santa.position.copy(HIP).applyQuaternion(santa.quaternion).negate().add(HIP);
    santa.position.y += lift;
  };
  const poseSleigh = (at: THREE.Vector3, q: THREE.Quaternion, scale: number, t: number, bob: number) => {
    sleigh.position.copy(at);
    sleigh.quaternion.copy(q);
    sleigh.scale.setScalar(scale);
    // A gentle bob and sway in the air, none on the ground
    sleigh.position.y += Math.sin(t * 2.1) * 0.05 * scale * bob;
    sleigh.rotateZ(Math.sin(t * 1.3) * 0.04 * bob);
    if (!reins) return;
    sleigh.updateMatrix();
    // The reins from his hands wherever they are: the right one in his left while he throws
    santa.updateMatrix();
    santaArm.updateMatrix();
    handL.copy(handLeftAt).applyMatrix4(santa.matrix).applyMatrix4(sleigh.matrix);
    handR.copy(handRight.position).applyMatrix4(santaArm.matrix).applyMatrix4(santa.matrix).applyMatrix4(sleigh.matrix);
    handR.lerp(handL, hold.right);
    for (const d of deer) d.g.updateMatrix();
    // Two long reins, one each side, from his hand on through the collars of that side's deer to
    // Rudolph's, the way they're run on a team: not a fan of lines to every one of them
    let n = 0;
    const segment = (from: THREE.Vector3, to: THREE.Vector3) => {
      dir.subVectors(to, from);
      const len = dir.length();
      qr.setFromUnitVectors(UP, dir.normalize());
      sc.set(0.008 * scale, len, 0.008 * scale);
      mtx.compose(from, qr, sc);
      reins.setMatrixAt(n++, mtx);
    };
    for (const side of [-1, 1]) {
      // Santa's right is the team's -x
      hand.copy(side < 0 ? handR : handL);
      for (const k of SIDE[side < 0 ? 0 : 1]) {
        const ring = k === TEAM.length - 1 ? side * 0.12 : side * 0.17;
        collar.set(ring, 1.12, 0.62).applyMatrix4(deer[k].g.matrix);
        segment(hand, collar);
        hand.copy(collar);
      }
    }
    for (; n < reins.count; n++) reins.setMatrixAt(n, HIDDEN);
    reins.instanceMatrix.needsUpdate = true;
  };

  const update = (t: number, pace: number) => {
    for (const d of deer) {
      const { rise, pitch } = gallop(d, t * 9.5 + d.phase, 0.35 + 0.65 * pace, 0);
      d.g.position.y = d.baseY + rise;
      d.g.rotation.x = pitch;
    }
    if (free) return;
    sleigh.position.y = Math.sin(t * 2.1) * 0.05;
    sleigh.rotation.z = Math.sin(t * 1.3) * 0.04;
  };
  update(0, 1);
  return {
    group,
    nose,
    runners,
    hooves,
    sack,
    santa,
    santaArm,
    handRight,
    hold,
    lamps,
    update,
    sleigh,
    deer,
    slots: TEAM.map(([x, z]) => [x, z] as [number, number]),
    poseDeer,
    poseSleigh,
    poseSanta,
  };
}
