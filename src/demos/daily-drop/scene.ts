import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import * as TSL from 'three/tsl';
import * as THREE from 'three/webgpu';

import type { Painting } from './art';
import { BAKE, lidAt, pose, SHAPES, type Kind } from './burst';
import { loadCreature, type Creature } from './creature';
import { dust } from './dust';
import {
  contactShadow,
  eggMaterial,
  geometry,
  hex,
  keyMaterial,
  look,
  MODELS,
  RARITY,
  seal,
  SHAFT_C,
  surface,
  type Rarity,
  type V3,
} from './models';
import { GLINT, MOTE, STREAK, sparks, type Particle } from './sparks';

/**
 * Daily Drop's stage: a treasure chest bound shut in chains, a padlock hung on it, on a dais cut
 * with a magic circle, in a vault, a shaft of warm light falling on it from an opening high above;
 * and everything it does.
 *
 * Idle, it breathes: dust turns gold as it drifts through the shaft of light, a glint runs over the
 * gold now and then, the circle on the dais turns and glows, motes rise off its runes, now and then
 * the chest stirs. Held (the app says where the thumb is and how far the hold's got), a gold key is
 * over the thumb, the glass bulb in its bow filling with light; the chest strains, shaking and
 * hopping, the chains rattling, glow running out along them from the padlock, cracks of light
 * spreading over the padlock, the circle filling round the dais, the dust drawn in to the key, the
 * light running from gold through blue and violet to legendary orange. Let go early and it drains
 * away.
 *
 * Full: the key flies to the padlock, the camera swinging round and in after it; it slides into
 * the keyhole and turns with a clack, and it all goes: a flash, a starburst and an anamorphic
 * streak, a shockwave rippling out across the screen, the picture bulging and splitting into its
 * colours, a pillar of light up out of the chest, and time slowed right down: the padlock flying
 * apart in pieces trailing sparks, glowing white hot where they broke, the chains whipping off,
 * hundreds of sparks, the dust blown away; then speeding up again as the lid flies open and the
 * treasure goes up in a fountain and rains down, knocking on the dais. All of that motion was
 * simulated in Blender and baked (burst.ts); the rest is drawn here.
 *
 * Then either the cards come up (the app draws those), or the legendary egg rises out of the chest
 * up the pillar of light, turning twice, and hangs in front of it to be spun by a finger, settling
 * face on. Collect: the coins and gems fly up out of the scene to where the wallet and the gem
 * count are on the screen, the XP to the level bar, the egg to the avatar, each one told as it
 * arrives. Replay: the whole burst runs backwards, the chains flying back round the chest, the
 * padlock coming back together, the lid slamming shut.
 *
 * World units are about a metre: the chest is 1 wide, its lid's hinge 0.52 up at the back, on a dais
 * whose top is y = 0, facing +z, the camera in front, a little above.
 */

const { vec2, vec3, float, mix, exp, abs, sin, cos, pow, length, saturate, smoothstep, max, uv, dot, normalize, atan } =
  TSL;
type V2 = THREE.Node<'vec2'>;

export type DropCue =
  'dive' | 'unlock' | 'impact' | 'chains' | 'erupt' | 'rise' | 'land' | 'hatch' | 'hatched' | 'close' | 'rewind';
export type DropHaptic = 'impact' | 'land' | 'close' | 'insert' | 'unlock';
export type Loot = 'coin' | 'gem' | 'xp' | 'egg';
/** What comes out of it: the legendary egg (and the rest as items), or the cards */
export type Reveal = 'items' | 'cards';
export type DropEvents = {
  onCue: (cue: DropCue) => void;
  onHaptic: (kind: DropHaptic) => void;
  /** One more of `kind` has got to where it was sent */
  onArrive: (kind: Loot) => void;
  /** Something knocked something, this hard (a change of speed, m/s) */
  onKnock: (kind: Kind, strength: number) => void;
  /** It's open: time for what's in it (the cards to come up; or the egg's risen and settled) */
  onOpen: () => void;
  /** The egg's been spun past one of its faces */
  onEdge: () => void;
  /** Rewound and shut again */
  onSealed: () => void;
};
/** Points on the screen, in the canvas's own points (not pixels) */
export type Point = { x: number; y: number };

const MOUTH = new THREE.Vector3(...MODELS.meta.mouth);
const HINGE = new THREE.Vector3(...MODELS.meta.hinge);
const LOCK = BAKE.lockCentre;
/** The keyhole in the padlock's face, at rest; the key goes in along -z */
const KEYHOLE = new THREE.Vector3(0, LOCK.y + 0.012, LOCK.z + 0.04);
/** The key, from its bow's middle (its origin) to its tip, and how far into the lock it goes */
const KEY_LEN = 0.176;
const KEY_IN = 0.05;
/** How big the key is in the lock: a little over life size, so it reads close up (it still fits) */
const KEY_LOCKED = 1.3;
/** How big the key is in the hand (it's life size in the lock), and how far in front of the camera */
const KEY_HELD = 1.6;
const KEY_DIST = 2.3;
/** The key's flight to the padlock, sliding in, turning, the beat before it goes (seconds) */
const FLY = 0.46;
const INSERT = 0.1;
const TURN = 0.24;
const BEAT = 0.16;
/** What the camera centres on: above the chest, so the chest sits a little below the middle */
const TARGET = new THREE.Vector3(0, 0.8, 0);
const FOV = 34;
/** How far the camera looks down */
const PITCH = 0.25;
const FLOOR = -0.2;
/** The shaft of light: from the dais's top up to the opening in the painting, wider at the bottom */
const SHAFT_TOP = 2.35;
const SHAFT_R0 = 0.95;
const SHAFT_R1 = 0.3;
/** How hard bright things glow, and how hard for a moment when it bursts */
const GLOW = 0.5;
const GLOW_BURST = 0.68;
/** The burst is played slow at first (bullet time), speeding up to real time */
const SLOW = 0.12;
/** When, in the burst's own time, the cards come up, or the egg starts up out of the chest */
const CARDS_AT = 1.45;
const EGG_AT = 0.95;
/** The egg's rise (seconds), how big it's shown, where (a fraction of the screen) and how far off */
const RISE = 1.25;
const EGG_SHOW = 1.2;
/** How big what hatches is shown (across its wings) */
const DRAKE_SHOW = 0.8;
/** Which way it faces at rest: a little turned, toward us */
const FACE = 0.3;
/** Its burst up out of the shell, turning, to where it hovers (seconds) */
const LEAP = 0.75;
const EGG_AT_SCREEN = { x: 0.5, y: 0.38 };
const EGG_DIST = 3.2;
/** Replay runs it backwards this much faster than it happened */
const REWIND = 2.3;
/** Where Replay's rewind starts from: the bake's end, but for what's still settling off the screen */
const REWIND_FROM = 1.8;
/** The rarities' colours, and where along the hold each shows */
const STOPS: [number, string][] = [
  [0, RARITY.common],
  [0.42, RARITY.rare],
  [0.72, RARITY.epic],
  [0.94, RARITY.legendary],
];

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);
const backOut = (x: number) => 1 + 2.7 * Math.pow(x - 1, 3) + 1.7 * Math.pow(x - 1, 2);

/**
 * The key in the hand, against the camera: its shaft up, right and away from us, so its bow (a
 * medallion round the bulb, square to the shaft) is turned half toward us, the bit side on
 */
const HELD = (() => {
  const back = new THREE.Vector3(0.38, 0.62, -0.69).normalize().negate();
  const up = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 0, 1), back).normalize();
  const side = new THREE.Vector3().crossVectors(up, back);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(side, up, back));
})();

type Flyer = {
  kind: 'coin' | 'gem';
  index: number;
  p: THREE.Vector3;
  q: THREE.Quaternion;
  axis: THREE.Vector3;
  spin: number;
  /** baked: where the burst has it; go: on its way to the screen; off: gone; sink: going away */
  state: 'baked' | 'go' | 'off' | 'sink';
  delay: number;
  t: number;
  scale: number;
  from: THREE.Vector3;
  ctrl: THREE.Vector3;
  to: THREE.Vector3;
};

type XpOrb = {
  s: Particle;
  from: THREE.Vector3;
  ctrl: THREE.Vector3;
  to: THREE.Vector3;
  delay: number;
  t: number;
  done: boolean;
};

export function createDrop(
  context: GPUCanvasContext & { present: () => void },
  device: GPUDevice,
  backdrop: Painting,
  getCharge: () => number,
  events: DropEvents
) {
  const canvas = context.canvas as unknown as {
    width: number;
    height: number;
    clientWidth: number;
    clientHeight: number;
  };
  let width = canvas.clientWidth;
  let height = canvas.clientHeight;
  const renderer = new THREE.WebGPURenderer({
    antialias: true,
    alpha: false,
    canvas: context.canvas as HTMLCanvasElement,
    context,
    device,
  });
  renderer.setPixelRatio(1);
  renderer.setSize(canvas.width, canvas.height, false);
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, width / height, 0.05, 60);
  scene.add(camera);
  const base = new THREE.Vector3();

  // ---- The vault, painted, behind it all: cover-fitted to the screen, drifting with the tilt ----
  // The painting has a round, gold-ringed floor of its own where the dais stands: so the dais is the
  // only stage, that's melted away, a soft dark blur of itself, a floor glinting with the light.
  const uAspect = TSL.uniform(width / height);
  const uTilt = TSL.uniform(new THREE.Vector2());
  const uDim = TSL.uniform(1);
  {
    const s = TSL.screenUV;
    const k = uAspect.div(backdrop.aspect);
    const zoom = float(0.95);
    const u = s.x.sub(0.5).mul(TSL.min(k, 1)).mul(zoom).add(0.5).add(uTilt.x.mul(0.012));
    const v = float(0.5)
      .sub(s.y)
      .mul(TSL.min(float(1).div(k), 1))
      .mul(zoom)
      .add(0.5)
      .add(uTilt.y.mul(0.008));
    const at = vec2(u, v);
    const sharp = TSL.texture(backdrop.texture, at).rgb;
    const melted = TSL.texture(backdrop.texture, at).level(float(5.5)).rgb.mul(0.3);
    const fromFloor = length(vec2(u, float(1).sub(v)).sub(vec2(0.5, 0.607)).div(vec2(0.6, 0.07)));
    scene.backgroundNode = mix(sharp, melted, smoothstep(1.2, 0.7, fromFloor)).mul(uDim);
  }

  // ---- The chest, the dais, a shadow under it ----
  const material = surface();
  const dais = new THREE.Mesh(geometry('dais'), material);
  scene.add(dais);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 3.6), contactShadow());
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = FLOOR - 0.002;
  shadow.renderOrder = -1;
  scene.add(shadow);
  const chest = new THREE.Group();
  scene.add(chest);
  chest.add(new THREE.Mesh(geometry('body'), material));
  chest.add(new THREE.Mesh(geometry('treasure'), material));
  const hinge = new THREE.Group();
  hinge.position.copy(HINGE);
  chest.add(hinge);
  hinge.add(new THREE.Mesh(geometry('lid'), material));

  // ---- The seal: the chains' links, the padlock in its pieces, the shackle in its halves ----
  // On the chest while it's whole (shaking with it); in the world once it's blown off
  const sealGroup = new THREE.Group();
  chest.add(sealGroup);
  const links = new THREE.InstancedMesh(
    SHAPES.link,
    seal({ along: new THREE.InstancedBufferAttribute(BAKE.linkGlow, 1) }),
    BAKE.count.link
  );
  links.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  links.frustumCulled = false;
  sealGroup.add(links);
  look.lock.value.copy(LOCK);
  const lockPieces = SHAPES.lock.map((l) => {
    const m = new THREE.Mesh(l.geometry, seal({ rest: l.rest, planes: l.planes }));
    m.frustumCulled = false;
    sealGroup.add(m);
    return m;
  });
  const shackles = SHAPES.shackle.map((s) => {
    const m = new THREE.Mesh(s.geometry, seal({}));
    m.frustumCulled = false;
    sealGroup.add(m);
    return m;
  });
  // Where everything rests, sealed (the bake's first frame)
  const linkRest: THREE.Matrix4[] = [];
  const restPos: Record<Kind, THREE.Vector3[]> = { link: [], lock: [], shackle: [], coin: [], gem: [] };
  const restQuat: Record<Kind, THREE.Quaternion[]> = { link: [], lock: [], shackle: [], coin: [], gem: [] };
  for (const kind of ['link', 'lock', 'shackle'] as Kind[]) {
    for (let i = 0; i < BAKE.count[kind]; i++) {
      const p = new THREE.Vector3();
      const q = new THREE.Quaternion();
      pose(kind, i, 0, p, q);
      restPos[kind].push(p);
      restQuat[kind].push(q);
      if (kind === 'link') linkRest.push(new THREE.Matrix4().compose(p, q, new THREE.Vector3(1, 1, 1)));
    }
  }
  /** Per link: a random phase and axis for its rattle */
  const rattle = Array.from({ length: BAKE.count.link }, () => ({
    phase: rand(0, 6.28),
    speed: rand(30, 52),
    axis: new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize(),
  }));

  // ---- The shaft of light from the opening high above, falling on the dais ----
  // A soft cone of lit air: brightest where we look through most of it (its middle), fading at its
  // edges, its top and where it meets the dais; dust drifting up it. With the hold it takes on the
  // colour of what's coming; the burst flares it.
  const uShaft = TSL.uniform(0.3);
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(SHAFT_R1, SHAFT_R0, SHAFT_TOP, 64, 1, true), additive());
  {
    const n = normalize(TSL.normalWorld);
    const v = normalize(TSL.cameraPosition.sub(TSL.positionWorld));
    const through = pow(abs(dot(n, v)), 1.6);
    const h = TSL.positionLocal.y.div(SHAFT_TOP).add(0.5);
    const a = atan(TSL.positionLocal.z, TSL.positionLocal.x);
    // (Faint low down, where it'd only wash over the chest: its light's on the chest's top instead)
    const ends = smoothstep(0.08, 0.5, h).mul(smoothstep(1, 0.55, h));
    const bands = sin(a.mul(9).add(TSL.time.mul(0.2)))
      .mul(0.1)
      .add(0.9);
    const drift = TSL.mx_noise_float(vec3(a.mul(2), h.mul(5).sub(TSL.time.mul(0.12)), TSL.time.mul(0.1)))
      .mul(0.12)
      .add(0.88);
    const tint = mix(SHAFT_C, look.rarity as unknown as V3, look.charge.mul(0.35));
    (shaft.material as THREE.MeshBasicNodeMaterial).colorNode = tint.mul(
      through.mul(ends).mul(bands).mul(drift).mul(uShaft)
    );
  }
  shaft.position.set(0, SHAFT_TOP / 2, -0.08);
  shaft.renderOrder = 4;
  scene.add(shaft);

  // ---- The dais's light spilling out over the floor round it ----
  const uUnder = TSL.uniform(0.4);
  const under = new THREE.Mesh(new THREE.RingGeometry(1.06, 2.2, 128, 1), additive());
  {
    const r = length(TSL.positionLocal.xy);
    const a = atan(TSL.positionLocal.y, TSL.positionLocal.x);
    const ring = exp(r.sub(1.12).div(0.07).pow(2).negate());
    const spill = exp(r.sub(1.1).mul(-2.4));
    const ripple = sin(a.mul(22).add(TSL.time.mul(1.2)))
      .mul(0.12)
      .add(0.88);
    const tint = mix(hex('#8E63FF'), look.rarity as unknown as V3, look.charge);
    (under.material as THREE.MeshBasicNodeMaterial).colorNode = tint.mul(
      ring.mul(0.9).add(spill.mul(0.12)).mul(ripple).mul(uUnder)
    );
  }
  under.rotation.x = -Math.PI / 2;
  under.position.y = FLOOR + 0.004;
  scene.add(under);

  // ---- Beams of light out of the crack under the lid while it strains ----
  const beams = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.1), additive());
  {
    const q = uv();
    const n = TSL.mx_noise_float(vec3(q.x.mul(13), TSL.time.mul(1.6), 0))
      .mul(0.5)
      .add(0.5);
    const streaks = pow(n, 3).mul(1.6).add(0.18);
    const rise = exp(q.y.mul(-3.4));
    const edges = smoothstep(0.5, 0.33, abs(q.x.sub(0.5)));
    (beams.material as THREE.MeshBasicNodeMaterial).colorNode = (look.rarity as unknown as V3).mul(
      streaks.mul(rise).mul(edges).mul(look.leak).mul(1.1)
    );
  }
  beams.position.set(0, MOUTH.y + 0.5, 0.2);
  beams.renderOrder = 5;
  scene.add(beams);

  // ---- Light pouring up out of the open chest: a fan of soft rays, slowly shifting, and a slim
  // bright core; never a solid column, so what's in front of it still reads ----
  const uPillar = TSL.uniform(0);
  const RAYS_W = 4.4;
  const RAYS_H = 4.2;
  const pillar = new THREE.Mesh(new THREE.PlaneGeometry(RAYS_W, RAYS_H).translate(0, RAYS_H / 2, 0), additive());
  {
    const q = uv();
    const x = q.x.sub(0.5).mul(RAYS_W);
    const y = q.y.mul(RAYS_H).add(0.06);
    const a = atan(x, y);
    const d = length(vec2(x, y));
    // Rays: two layers of slowly drifting bands, thinned to fine shafts
    const n1 = TSL.mx_noise_float(vec3(a.mul(7), TSL.time.mul(0.18), 0))
      .mul(0.5)
      .add(0.5);
    const n2 = TSL.mx_noise_float(vec3(a.mul(17).add(3), TSL.time.mul(0.31), 1))
      .mul(0.5)
      .add(0.5);
    const shafts = pow(n1, 3).mul(0.8).add(pow(n2, 5).mul(0.6));
    const fan = exp(a.div(0.5).pow(2).negate());
    const fall = smoothstep(0.02, 0.3, d).mul(exp(d.mul(-0.75)));
    const fadeTop = smoothstep(1, 0.6, q.y);
    // The core: slim, brightest at the mouth, gone well before the top
    const core = exp(
      x
        .div(float(0.035).add(y.mul(0.03)))
        .pow(2)
        .negate()
    )
      .mul(exp(y.mul(-0.9)))
      .mul(0.4);
    const tint = mix(look.rarity as unknown as V3, vec3(1, 0.92, 0.78), 0.35);
    (pillar.material as THREE.MeshBasicNodeMaterial).colorNode = tint.mul(
      shafts.mul(fan).mul(fall).mul(0.5).add(core).mul(fadeTop).mul(uPillar)
    );
  }
  pillar.position.set(0, MOUTH.y - 0.04, 0);
  pillar.renderOrder = 2;
  pillar.visible = false;
  scene.add(pillar);

  // ---- A ring of light out across the dais when it bursts, and a dust ring rolling out after it ----
  const uWave = TSL.uniform(1);
  const wave = new THREE.Mesh(new THREE.PlaneGeometry(7, 7), additive());
  {
    const r = length(uv().sub(0.5)).mul(7);
    const at = uWave.mul(3.4);
    const ring = exp(r.sub(at).div(0.035).pow(2).negate());
    const fill = exp(r.mul(-1.8))
      .mul(exp(uWave.mul(-8)))
      .mul(0.3);
    (wave.material as THREE.MeshBasicNodeMaterial).colorNode = mix(
      vec3(1, 0.95, 0.85),
      look.rarity as unknown as V3,
      0.5
    ).mul(
      ring
        .mul(pow(float(1).sub(uWave), 1.5))
        .mul(1.4)
        .add(fill)
    );
  }
  wave.rotation.x = -Math.PI / 2;
  wave.position.y = 0.006;
  scene.add(wave);
  const uDust = TSL.uniform(1);
  const dustRing = new THREE.Mesh(
    new THREE.PlaneGeometry(7, 7),
    new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false })
  );
  {
    const q = uv().sub(0.5);
    const r = length(q).mul(7);
    const a = atan(q.y, q.x);
    const at = pow(uDust, 0.5).mul(2.6);
    const billow = TSL.mx_noise_float(vec3(a.mul(3), r.mul(2.2).sub(uDust.mul(3)), 0))
      .mul(0.5)
      .add(0.5);
    const band = exp(
      r
        .sub(at)
        .div(float(0.18).add(uDust.mul(0.35)))
        .pow(2)
        .negate()
    );
    const m = dustRing.material as THREE.MeshBasicNodeMaterial;
    m.colorNode = mix(hex('#5B4A7A'), hex('#C9A9FF'), billow.mul(0.4));
    m.opacityNode = band
      .mul(billow.mul(0.7).add(0.3))
      .mul(float(1).sub(uDust))
      .mul(smoothstep(0, 0.05, uDust))
      .mul(0.55);
  }
  dustRing.rotation.x = -Math.PI / 2;
  dustRing.position.y = 0.012;
  scene.add(dustRing);

  // ---- A ball of light where the padlock was, the moment it goes ----
  const uCore = TSL.uniform(0);
  const core = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4), additive());
  {
    const q = uv().sub(0.5);
    const r = length(q).mul(2);
    const a = atan(q.y, q.x);
    const spikes = pow(abs(cos(a.mul(2))), 160);
    const ball = exp(r.mul(r).mul(-60))
      .mul(1.3)
      .add(exp(r.mul(-8)).mul(0.15));
    const tint = mix(look.rarity as unknown as V3, vec3(1, 0.97, 0.9), exp(r.mul(-9)));
    (core.material as THREE.MeshBasicNodeMaterial).colorNode = tint.mul(
      ball.add(spikes.mul(exp(r.mul(-3.2))).mul(0.5)).mul(uCore)
    );
  }
  core.position.copy(LOCK).add(new THREE.Vector3(0, 0, 0.12));
  core.renderOrder = 9;
  scene.add(core);

  // ---- The key, over the thumb while it's held ----
  const keyMesh = new THREE.Mesh(geometry('key'), keyMaterial());
  keyMesh.visible = false;
  keyMesh.frustumCulled = false;
  keyMesh.renderOrder = 10;
  scene.add(keyMesh);

  // ---- The legendary egg, and the light behind it ----
  const egg = new THREE.Mesh(geometry('egg'), eggMaterial());
  egg.visible = false;
  egg.frustumCulled = false;
  scene.add(egg);
  const uAura = TSL.uniform(0);
  const aura = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.2), additive());
  {
    // A soft glow, and twelve even rays turning slowly round it
    const q = uv().sub(0.5);
    const r = length(q).mul(2);
    const a = atan(q.y, q.x);
    const rays = pow(abs(cos(a.mul(6).add(TSL.time.mul(0.15)))), 40)
      .mul(exp(r.mul(-2.6)))
      .mul(smoothstep(1, 0.3, r));
    const glow = exp(r.mul(r).mul(-9))
      .mul(0.45)
      .add(exp(r.mul(-3.4)).mul(0.22));
    const tint = mix(look.rarity as unknown as V3, vec3(1, 0.96, 0.88), exp(r.mul(r).mul(-20)).mul(0.5));
    (aura.material as THREE.MeshBasicNodeMaterial).colorNode = tint.mul(glow.add(rays.mul(0.3)).mul(uAura));
  }
  aura.visible = false;
  aura.renderOrder = 3;
  scene.add(aura);
  // Hatched: the shell in pieces, and Ember Drake bursting out of the fire
  const shardMaterial = eggMaterial({ shards: true });
  const shards = shatter(geometry('egg'), 26).map((piece) => {
    const mesh = new THREE.Mesh(piece.geometry, shardMaterial);
    mesh.visible = false;
    mesh.frustumCulled = false;
    scene.add(mesh);
    return { mesh, ...piece, v: new THREE.Vector3(), spin: new THREE.Vector3() };
  });
  // What hatches (centred on its origin)
  const hatched = new THREE.Group();
  hatched.visible = false;
  scene.add(hatched);
  // Ember Drake, alive (creature.ts), loaded in the background
  let creature: Creature | null = null;
  loadCreature()
    .then((c) => {
      creature = c;
      hatched.add(c.root);
      c.play('Flying_Idle');
    })
    .catch((e) => {
      if (__DEV__) console.error('[daily-drop] drake', e);
    });
  /** When it next does something (nods, butts the air), and whether it's out and hovering */
  let nextMove = 0;
  let landed = false;
  const flamePoints: THREE.Vector3[] = [];
  /** Breathing fire: how long it has left */
  let breath = 0;
  const mouthAt = new THREE.Vector3();
  const facing = new THREE.Vector3();

  // ---- Coins and gems: hidden in the chest until they go up ----
  const coinMesh = new THREE.InstancedMesh(geometry('coin'), surface(), BAKE.count.coin);
  const gemMesh = new THREE.InstancedMesh(geometry('gem'), surface({ gemTint: true }), BAKE.count.gem);
  for (const m of [coinMesh, gemMesh]) {
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false;
    scene.add(m);
  }
  const flyers: Flyer[] = [];
  for (const kind of ['coin', 'gem'] as const) {
    for (let i = 0; i < BAKE.count[kind]; i++) {
      flyers.push({
        kind,
        index: i,
        p: new THREE.Vector3(),
        q: new THREE.Quaternion(),
        axis: new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize(),
        spin: 0,
        state: 'off',
        delay: 0,
        t: 0,
        scale: 0,
        from: new THREE.Vector3(),
        ctrl: new THREE.Vector3(),
        to: new THREE.Vector3(),
      });
    }
  }

  // ---- Sparks, embers, motes; the vault's dust, lit as it drifts through the shaft ----
  const fx = sparks(1600);
  scene.add(fx.mesh);
  const air = dust({ top: SHAFT_TOP, r0: SHAFT_R0, r1: SHAFT_R1, z: shaft.position.z });
  scene.add(air.mesh);
  const xpOrbs: XpOrb[] = [];
  const XP = 7;

  // ---- Post: the blast's distortions, the glow, a film curve, the corners closing in ----
  const post = new THREE.RenderPipeline(renderer);
  const scenePass = TSL.pass(scene, camera);
  const colour = scenePass.getTextureNode('output');
  const glowing = bloom(colour, GLOW, 0.42, 0.62);
  // (Its types call this getTexture; three's own code, getTextureNode)
  const glowTex = (glowing as unknown as { getTextureNode(): THREE.TextureNode }).getTextureNode();
  const uFlash = TSL.uniform(0);
  const uVignette = TSL.uniform(0);
  /** Pulling the picture in toward a point on the screen (UV, y down) as the key flies in */
  const uPinch = TSL.uniform(0);
  const uPinchAt = TSL.uniform(new THREE.Vector2(0.5, 0.55));
  /** The blast on the screen: where, the shockwave's progress (0 to 1), the bulge, the colour split, the starburst, the streak */
  const uImpact = TSL.uniform(new THREE.Vector2(0.5, 0.55));
  const uShock = TSL.uniform(1);
  const uBulge = TSL.uniform(0);
  const uSplit = TSL.uniform(0);
  const uStar = TSL.uniform(0);
  const uStreak = TSL.uniform(0);
  {
    const s = TSL.screenUV as unknown as V2;
    const asp = vec2(uAspect, 1);
    const time = TSL.time;
    // Pulled in toward the keyhole as the key flies in
    const toPinch = uPinchAt.sub(s);
    const dPinch = length(toPinch.mul(asp));
    const pinch = toPinch.mul(uPinch.mul(0.5)).mul(exp(dPinch.mul(dPinch).mul(-7)));
    // The shockwave: a ring of bent light running out from the blast
    const fromHit = s.sub(uImpact);
    const dHit = length(fromHit.mul(asp));
    const ringR = pow(uShock, 0.7).mul(1.25);
    const ring = exp(dHit.sub(ringR).div(0.05).pow(2).negate()).mul(pow(float(1).sub(uShock), 1.4));
    const shock = normalize(fromHit.add(vec2(0.0001, 0))).mul(ring.mul(0.022));
    // The bulge: the picture swelling out from the blast like a fisheye
    const bulge = fromHit.mul(uBulge.mul(-0.22)).mul(exp(dHit.mul(dHit).mul(-3)));
    const bent = s.add(pinch).add(shock).add(bulge) as unknown as V2;
    // Split into its colours, out from the blast
    const fringeDir = normalize(fromHit.add(vec2(0.0001, 0)));
    const fringe = uSplit.mul(0.005).mul(smoothstep(0.05, 0.5, dHit));
    const sR = colour.sample(bent.add(fringeDir.mul(fringe))).r;
    const sG = colour.sample(bent).g;
    const sB = colour.sample(bent.sub(fringeDir.mul(fringe))).b;
    const glowAt = glowTex.sample(bent).rgb;
    let hdr = vec3(sR, sG, sB)
      .add(glowAt)
      .mul(float(1).add(uFlash.mul(1.1))) as unknown as V3;

    // ---- The blast: a lens glint (four fine points), a thin anamorphic streak, a small hot core ----
    const rarity = look.rarity as unknown as V3;
    const dx = abs(fromHit.x.mul(uAspect));
    const dy = abs(fromHit.y);
    const star = exp(dy.div(0.0025).negate())
      .mul(exp(dx.mul(-5.5)))
      .add(exp(dx.div(0.0025).negate()).mul(exp(dy.mul(-7))))
      .mul(uStar);
    const streak = exp(fromHit.y.div(0.0035).pow(2).negate())
      .mul(exp(dx.mul(-2.6)))
      .mul(uStreak);
    const hot = exp(dHit.mul(dHit).mul(-260)).mul(uStar);
    hdr = hdr
      .add(mix(rarity, vec3(1, 0.96, 0.9), 0.7).mul(star.mul(0.9).add(hot.mul(1.3))))
      .add(mix(vec3(0.62, 0.78, 1), rarity, 0.35).mul(streak.mul(0.7))) as unknown as V3;

    const peak = max(max(hdr.r, hdr.g), max(hdr.b, 0.0001));
    const curve = float(1).sub(exp(peak.mul(-1.3)));
    const kept = hdr.mul(curve.div(peak));
    const mapped = mix(kept, vec3(curve, curve, curve), smoothstep(2, 6, peak).mul(0.3)) as unknown as V3;
    const corner = smoothstep(1.1, 0.3, length(s.sub(0.5).mul(vec2(1.0, 0.85))));
    const shade = mix(float(0.55).sub(uVignette.mul(0.25)), float(1), corner);
    const grain = TSL.hash(
      TSL.screenCoordinate.x.add(TSL.screenCoordinate.y.mul(4099)).add(TSL.floor(time.mul(30)).mul(7919))
    )
      .sub(0.5)
      .mul(0.01);
    const graded = TSL.sRGBTransferOETF(saturate(mapped.mul(shade))) as unknown as V3;
    // (The bloom node itself is kept in the graph, so its passes run)
    post.outputNode = TSL.vec4(graded.add(grain).add(glowing.rgb.mul(0)), 1);
  }

  // ---- State ----
  type Phase = 'idle' | 'dive' | 'burst' | 'rewind';
  let phase: Phase = 'idle';
  let reveal: Reveal = 'items';
  let time = 0;
  let burstRarity: Rarity = 'legendary';
  /** The burst's own clock (seconds into the bake), and the real time since the blast */
  let bakeT = 0;
  let sinceBlast = 0;
  let rewindT = 0;
  let nextKnock = 0;
  let erupted = false;
  let opened = false;
  let collected = false;
  let lid = 0;
  let lidV = 0;
  let squash = 1;
  let squashV = 0;
  let punch = 0;
  let open = 0;
  let focus = 0;
  let focusTo = 0;
  let shaftNow = 0.3;
  let pillarNow = 0;
  let pillarWide = 0;
  let circleNow = 0;
  let waveT = 1;
  let dustT = 1;
  let flash = 0;
  /** The glow turned up as it bursts, falling back */
  let boost = 0;
  let nextGlint = 1.5;
  let glintT = -1;
  let moteClock = 0;
  let runeClock = 0;
  let hopWas = 0;
  /** How far the hold's got, read once a frame */
  let chargeNow = 0;
  let stirT = -1;
  let nextStir = 3;
  /** The camera: 0, the usual shot; 1, round and in close on the padlock as the key goes in */
  let closeUp = 0;
  // The key: in the hand (the thumb's down), where it's wanted on the screen, how much of it shows
  let keyOn = false;
  type KeyStep = 'held' | 'fly' | 'insert' | 'turn' | 'beat';
  let keyStep: KeyStep = 'held';
  let keyT = 0;
  let keyShown = 0;
  let keyShownV = 0;
  const keyWant = new THREE.Vector2(0.5, 0.8);
  const keyAt = new THREE.Vector3();
  const keyFrom = new THREE.Vector3();
  const keyFromQ = new THREE.Quaternion();
  const keyCtrl = new THREE.Vector3();
  const keyApproach = new THREE.Vector3(KEYHOLE.x, KEYHOLE.y, KEYHOLE.z + KEY_LEN * KEY_LOCKED + 0.16);
  const keyIn = new THREE.Vector3(KEYHOLE.x, KEYHOLE.y, KEYHOLE.z + KEY_LEN * KEY_LOCKED - KEY_IN);
  let keyPlaced = false;
  // The egg: hidden, rising out of the chest, shown, or on its way to the avatar
  type EggStep = 'hidden' | 'rise' | 'show' | 'tremble' | 'fox' | 'claim';
  let eggStep: EggStep = 'hidden';
  let eggT = 0;
  /** How it's been spun (degrees: face on at every quarter turn), how fast, whether a finger has it */
  let spin = 0;
  let spinV = 0;
  let spinHeld = false;
  let spinFace = 0;
  const eggFrom = new THREE.Vector3();
  const eggCtrl = new THREE.Vector3();
  const eggTo = new THREE.Vector3();
  let eggScale = 0;
  /** Since it hatched (the shards' flight); whether it has, so what's claimed is the fox */
  let shardT = -1;
  let isHatched = false;
  /** Since the hatch's blast, for its shockwave and flare (the burst's are long done by then) */
  let hatchBlast = -1;
  /** Things it'll do in a moment (back to standing) */
  const later: { at: number; what: 'idle' }[] = [];
  const shake = new THREE.Vector3();
  const tilt = new THREE.Vector2();
  const colourNow = new THREE.Color(RARITY.common);
  const tmpColour = new THREE.Color();
  const m4 = new THREE.Matrix4();
  const sc = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();
  const tmpQ = new THREE.Quaternion();
  const rq = new THREE.Quaternion();
  const ONE = new THREE.Vector3(1, 1, 1);
  const Z = new THREE.Vector3(0, 0, 1);
  const UP = new THREE.Vector3(0, 1, 0);
  const keyWorld = new THREE.Vector3();
  const lookAt = new THREE.Vector3();

  function fit() {
    camera.aspect = width / height;
    // The dais just about spans the screen
    const half = 1.0;
    const d = half / (Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * Math.min(camera.aspect, 0.75));
    base.set(0, TARGET.y + d * Math.sin(PITCH), d * Math.cos(PITCH));
    camera.position.copy(base);
    camera.lookAt(TARGET);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    uAspect.value = width / height;
  }
  fit();

  /** The colour the hold has got to */
  function rarityAt(c: number, out: THREE.Color) {
    for (let i = STOPS.length - 1; i >= 0; i--) {
      if (c >= STOPS[i][0]) {
        const next = STOPS[i + 1];
        out.set(STOPS[i][1]);
        if (next) out.lerp(tmpColour.set(next[1]), smooth(next[0] - 0.12, next[0], c));
        return out;
      }
    }
    return out.set(STOPS[0][1]);
  }

  /** The world point this far in front of the camera that's at this point on the screen */
  function worldAt(pt: Point, dist: number, out: THREE.Vector3) {
    tmp.set((pt.x / width) * 2 - 1, -((pt.y / height) * 2 - 1), 0.5).unproject(camera);
    return out.copy(tmp.sub(camera.position).normalize()).multiplyScalar(dist).add(camera.position);
  }

  /** A world point's place on the screen, as UV (y down) */
  function screenUV(p: THREE.Vector3, out: THREE.Vector2) {
    tmp.copy(p).project(camera);
    return out.set((tmp.x + 1) / 2, (1 - tmp.y) / 2);
  }

  // ---- The seal, at rest or strained (and trembling), or wherever the bake has it ----

  function placeSealAtRest(c: number) {
    const strain = c * c;
    for (let i = 0; i < linkRest.length; i++) {
      if (strain < 0.0004) {
        links.setMatrixAt(i, linkRest[i]);
        continue;
      }
      const r = rattle[i];
      const near = Math.exp(-BAKE.linkGlow[i] / 0.9);
      const amt = strain * (0.05 + 0.12 * near) * Math.sin(time * r.speed + r.phase);
      rq.setFromAxisAngle(r.axis, amt);
      tmp.copy(restPos.link[i]).addScaledVector(r.axis, amt * 0.012);
      tmpQ.copy(restQuat.link[i]).multiply(rq);
      m4.compose(tmp, tmpQ, ONE);
      links.setMatrixAt(i, m4);
    }
    links.instanceMatrix.needsUpdate = true;
    // The padlock trembling as one, its pieces just starting to part at the end
    const swing = strain * 0.07;
    rq.setFromEuler(
      new THREE.Euler(Math.sin(time * 47) * swing, Math.sin(time * 39) * swing * 0.6, Math.sin(time * 53) * swing)
    );
    const part = smooth(0.78, 1, c) * 0.018;
    lockPieces.forEach((m, i) => {
      tmp.copy(restPos.lock[i]).sub(LOCK).applyQuaternion(rq);
      tmp2.copy(restPos.lock[i]).sub(LOCK).normalize();
      m.position
        .copy(LOCK)
        .add(tmp)
        .addScaledVector(tmp2, part * (0.6 + 0.4 * Math.sin(time * 30 + i)));
      m.quaternion.copy(rq).multiply(restQuat.lock[i]);
    });
    shackles.forEach((m, i) => {
      tmp.copy(restPos.shackle[i]).sub(LOCK).applyQuaternion(rq);
      m.position.copy(LOCK).add(tmp);
      m.quaternion.copy(rq).multiply(restQuat.shackle[i]);
    });
  }

  function placeSealBaked(t: number) {
    for (let i = 0; i < BAKE.count.link; i++) {
      pose('link', i, t, tmp, tmpQ);
      m4.compose(tmp, tmpQ, ONE);
      links.setMatrixAt(i, m4);
    }
    links.instanceMatrix.needsUpdate = true;
    lockPieces.forEach((m, i) => pose('lock', i, t, m.position, m.quaternion));
    shackles.forEach((m, i) => pose('shackle', i, t, m.position, m.quaternion));
  }

  function placeFlyer(f: Flyer) {
    const mesh = f.kind === 'coin' ? coinMesh : gemMesh;
    sc.setScalar(Math.max(0.0001, f.scale));
    m4.compose(f.p, f.q, sc);
    mesh.setMatrixAt(f.index, m4);
  }

  // ---- The key ----

  /** Where the key is and how it's turned, by its step; true once it's in the lock and turning */
  function stepKey(realDt: number, c: number) {
    if (phase === 'idle') {
      // In the hand: shown while the thumb's down or the hold's draining; following the thumb
      const want = keyOn || c > 0.02 ? 1 : 0;
      keyShownV += (300 * (want - keyShown) - 20 * keyShownV) * realDt;
      keyShown = Math.max(0, keyShown + keyShownV * realDt);
      if (keyShown < 0.004 && want === 0) {
        keyMesh.visible = false;
        keyPlaced = false;
        return;
      }
      keyMesh.visible = true;
      worldAt({ x: keyWant.x * width, y: keyWant.y * height }, KEY_DIST, keyWorld);
      if (!keyPlaced) keyAt.copy(keyWorld);
      keyPlaced = true;
      keyAt.lerp(keyWorld, 1 - Math.exp(-realDt * 22));
      keyMesh.position.copy(keyAt);
      // Turning a little on its shaft to catch the light, trembling harder as it fills
      const shiver = c * c * 0.07;
      keyMesh.quaternion
        .copy(camera.quaternion)
        .multiply(HELD)
        .multiply(
          rq.setFromEuler(
            new THREE.Euler(
              Math.sin(time * 41) * shiver,
              Math.sin(time * 37) * shiver,
              Math.sin(time * 1.3) * 0.4 + Math.sin(time * 53) * shiver
            )
          )
        );
      keyMesh.scale.setScalar(KEY_HELD * keyShown * (1 + c * 0.08));
      return;
    }
    if (phase !== 'dive') {
      keyMesh.visible = false;
      return;
    }
    keyMesh.visible = true;
    keyT += realDt;
    if (keyStep === 'fly') {
      const k = Math.min(1, keyT / FLY);
      const e = easeInOut(k);
      const a = 1 - e;
      keyMesh.position
        .set(0, 0, 0)
        .addScaledVector(keyFrom, a * a)
        .addScaledVector(keyCtrl, 2 * a * e)
        .addScaledVector(keyApproach, e * e);
      keyMesh.quaternion.slerpQuaternions(keyFromQ, tmpQ.identity(), smooth(0.1, 0.85, k));
      keyMesh.scale.setScalar(KEY_HELD + (KEY_LOCKED - KEY_HELD) * e);
      // A trail of sparks off it
      for (let i = 0; i < 3; i++) {
        fx.emit({
          p: keyMesh.position.clone().add(tmp.set(rand(-0.02, 0.02), rand(-0.02, 0.02), rand(-0.02, 0.02))),
          v: new THREE.Vector3(rand(-0.2, 0.2), rand(-0.1, 0.3), rand(-0.2, 0.2)),
          life: rand(0.25, 0.5),
          size: rand(0.004, 0.009),
          colour: new THREE.Color().copy(colourNow).multiplyScalar(rand(1.8, 3)),
          kind: MOTE,
          drag: 0.3,
          soft: 0.05,
        });
      }
      if (k >= 1) {
        keyStep = 'insert';
        keyT = 0;
      }
    } else if (keyStep === 'insert') {
      const k = Math.min(1, keyT / INSERT);
      keyMesh.position.lerpVectors(keyApproach, keyIn, k * k);
      keyMesh.quaternion.identity();
      keyMesh.scale.setScalar(KEY_LOCKED);
      if (k >= 1) {
        keyStep = 'turn';
        keyT = 0;
        events.onHaptic('insert');
        sparkle(KEYHOLE, 10, '#FFE7A8', 0.6);
      }
    } else if (keyStep === 'turn') {
      const k = Math.min(1, keyT / TURN);
      keyMesh.position.copy(keyIn);
      keyMesh.quaternion.setFromAxisAngle(Z, (-Math.PI / 2) * backOut(k));
      if (k >= 1) {
        keyStep = 'beat';
        keyT = 0;
        events.onCue('unlock');
        events.onHaptic('unlock');
        flash = Math.max(flash, 0.3);
        circleNow = Math.max(circleNow, 2.2);
        squashV -= 1.2;
        uCore.value = Math.max(uCore.value, 0.35);
        sparkle(KEYHOLE, 24, '#FFF1C8', 1.2);
      }
    } else {
      // The beat: the lock shuddering round the key, then it goes
      keyMesh.position.copy(keyIn);
      keyMesh.quaternion.setFromAxisAngle(Z, -Math.PI / 2 + Math.sin(time * 70) * 0.03);
      if (keyT >= BEAT) burst();
    }
  }

  // ---- The blast ----

  function burst() {
    phase = 'burst';
    bakeT = BAKE.burstAt;
    sinceBlast = 0;
    nextKnock = 0;
    while (nextKnock < BAKE.knocks.length && BAKE.knocks[nextKnock].t < bakeT) nextKnock++;
    erupted = false;
    opened = false;
    collected = false;
    colourNow.set(RARITY[burstRarity]);
    // Off the chest, into the world, where the bake has it (the chest's still for this moment)
    chest.position.set(0, 0, 0);
    chest.rotation.set(0, 0, 0);
    chest.updateMatrixWorld();
    scene.attach(sealGroup);
    sealGroup.position.set(0, 0, 0);
    sealGroup.rotation.set(0, 0, 0);
    squashV = -4.6;
    punch = 1.4;
    flash = 0.22;
    boost = 0.7;
    waveT = 0;
    dustT = 0;
    shaftNow = 0.38;
    pillarNow = 1.1;
    pillarWide = 0.2;
    circleNow = 2.6;
    look.heat.value = 1;
    uCore.value = 0.6;
    screenUV(LOCK, uImpact.value);
    uShock.value = 0;
    uBulge.value = 1;
    uSplit.value = 1;
    uStar.value = 1;
    uStreak.value = 1;
    uPinch.value = 0;
    keyMesh.visible = false;
    air.blast(LOCK, 0.9);
    events.onCue('impact');
    events.onHaptic('impact');
    // The key gone to gold dust, twinkling
    for (let i = 0; i < 26; i++) {
      const dir = new THREE.Vector3(rand(-1, 1), rand(-0.2, 1), rand(0, 1)).normalize();
      fx.emit({
        p: keyIn.clone().add(tmp.set(0, 0, rand(-0.02, 0.15))),
        v: dir.multiplyScalar(rand(0.3, 1.4)),
        life: rand(0.7, 1.5),
        size: rand(0.014, 0.03),
        colour: new THREE.Color('#FFE3A0').multiplyScalar(rand(1.3, 2.2)),
        kind: GLINT,
        drag: 0.25,
        gravity: 0.5,
      });
    }
    blast(LOCK, new THREE.Vector3(0, 0.35, 1), 1);
    // A few slow embers drifting off after it
    for (let i = 0; i < 36; i++) {
      const dir = new THREE.Vector3(rand(-1, 1), rand(-0.1, 1), rand(-0.3, 1)).normalize();
      fx.emit({
        p: LOCK.clone(),
        v: dir.multiplyScalar(rand(0.3, 1.4)),
        life: rand(1.6, 3.2),
        size: rand(0.008, 0.018),
        colour: new THREE.Color().set(RARITY[burstRarity]).multiplyScalar(rand(1.2, 2)),
        kind: MOTE,
        drag: 0.5,
        gravity: -0.12,
        swirl: 0.8,
        soft: 0.05,
      });
    }
  }

  /**
   * A blast of light out of a point, shaped rather than a ball of lines: a few dozen hero sparks
   * thrown mostly up and toward us, short, arcing down under gravity, bouncing; and a cloud of fine
   * glitter, slower, hanging and twinkling as it falls
   */
  function blast(at: THREE.Vector3, toward: THREE.Vector3, power: number) {
    const hot = new THREE.Color(RARITY[burstRarity]);
    for (let i = 0; i < 46 * power; i++) {
      const dir = new THREE.Vector3(rand(-1, 1), rand(-0.3, 1), rand(-0.6, 1))
        .normalize()
        .lerp(toward, 0.35)
        .normalize();
      fx.emit({
        p: at.clone().addScaledVector(dir, rand(0, 0.04)),
        v: dir.multiplyScalar(rand(1.8, 5.2) * Math.sqrt(power)),
        life: rand(0.45, 1.1),
        size: rand(0.004, 0.009),
        colour: (Math.random() < 0.6 ? hot.clone() : new THREE.Color('#FFE7B0')).multiplyScalar(rand(1.6, 2.4)),
        kind: STREAK,
        drag: 0.35,
        gravity: 4.5,
        stretch: 0.022,
        bounce: 0.35,
      });
    }
    for (let i = 0; i < 90 * power; i++) {
      const dir = new THREE.Vector3(rand(-1, 1), rand(-0.5, 1), rand(-0.5, 1)).normalize();
      fx.emit({
        p: at.clone().addScaledVector(dir, rand(0, 0.08)),
        v: dir.multiplyScalar(rand(0.25, 2.2) * Math.sqrt(power)),
        life: rand(0.8, 2.2),
        size: rand(0.012, 0.03),
        colour: new THREE.Color(Math.random() < 0.5 ? '#FFF1D0' : '#FFD27A')
          .lerp(hot, rand(0, 0.4))
          .multiplyScalar(rand(1.1, 2)),
        kind: GLINT,
        drag: 0.3,
        gravity: 0.6,
        swirl: 0.25,
      });
    }
  }

  function sparkle(at: THREE.Vector3, n: number, colour: string, power: number) {
    for (let i = 0; i < n; i++) {
      const dir = new THREE.Vector3(rand(-1, 1), rand(0.2, 1), rand(-1, 1)).normalize();
      fx.emit({
        p: at.clone(),
        v: dir.multiplyScalar(rand(0.4, 1.6) * power),
        life: rand(0.2, 0.5),
        size: rand(0.004, 0.009),
        colour: new THREE.Color(colour).multiplyScalar(rand(1.6, 2.8)),
        kind: STREAK,
        drag: 0.3,
        gravity: 5,
        stretch: 0.03,
      });
    }
  }

  // ---- The egg ----

  function rise() {
    eggStep = 'rise';
    eggT = 0;
    spin = 0;
    spinV = 0;
    spinFace = 0;
    eggFrom.copy(MOUTH).add(tmp.set(0, -0.12, 0));
    worldAt({ x: EGG_AT_SCREEN.x * width, y: EGG_AT_SCREEN.y * height }, EGG_DIST, eggTo);
    eggCtrl.set(0, eggTo.y + 0.9, (eggFrom.z + eggTo.z) / 2 - 0.2);
    egg.visible = true;
    aura.visible = true;
    pillarNow = Math.max(pillarNow, 1.4);
    events.onCue('rise');
  }

  function stepEgg(realDt: number) {
    if (eggStep === 'hidden') return;
    eggT += realDt;
    if (eggStep === 'rise') {
      const k = Math.min(1, eggT / RISE);
      const e = easeOut(k);
      const a = 1 - e;
      egg.position
        .set(0, 0, 0)
        .addScaledVector(eggFrom, a * a)
        .addScaledVector(eggCtrl, 2 * a * e)
        .addScaledVector(eggTo, e * e);
      eggScale = 0.25 + (EGG_SHOW - 0.25) * backOut(Math.min(1, k * 1.1));
      // Two full turns, slowing to face on
      egg.rotation.set(0, (1 - e) * Math.PI * 4, 0);
      uAura.value = smooth(0.3, 1, k) * 0.9;
      // Embers streaming off it as it comes
      for (let i = 0; i < 3; i++) {
        fx.emit({
          p: egg.position.clone().add(tmp.set(rand(-0.15, 0.15), rand(-0.25, 0.1), rand(-0.1, 0.1))),
          v: new THREE.Vector3(rand(-0.3, 0.3), rand(-0.8, -0.2), rand(-0.2, 0.2)),
          life: rand(0.4, 0.8),
          size: rand(0.006, 0.014),
          colour: new THREE.Color(Math.random() < 0.6 ? '#FF9A3D' : '#FFE7A8').multiplyScalar(rand(1.8, 3)),
          kind: STREAK,
          drag: 0.4,
          stretch: 0.04,
        });
      }
      if (k >= 1) {
        eggStep = 'show';
        eggT = 0;
        flash = Math.max(flash, 0.35);
        punch = Math.max(punch, 0.5);
        circleNow = Math.max(circleNow, 2);
        sparkle(egg.position, 40, '#FFE7A8', 1.6);
        events.onCue('land');
        events.onOpen();
      }
    } else if (eggStep === 'show') {
      // Spun by the finger; let go, it keeps going, slows, and settles face on
      if (!spinHeld) {
        const to = Math.round(spin / 90) * 90;
        spinV += (60 * (to - spin) - 9 * spinV) * realDt;
        spin += spinV * realDt;
      }
      const face = Math.floor((spin + 45) / 90);
      if (face !== spinFace) {
        spinFace = face;
        events.onEdge();
      }
      egg.position.copy(eggTo).add(tmp.set(0, Math.sin(time * 1.6) * 0.03, 0));
      egg.rotation.set(0.12, THREE.MathUtils.degToRad(spin) + Math.sin(time * 0.7) * 0.12, 0);
      eggScale += (EGG_SHOW - eggScale) * (1 - Math.exp(-realDt * 8));
      uAura.value += (0.75 - uAura.value) * (1 - Math.exp(-realDt * 3));
      if (Math.random() < realDt * 18) {
        fx.emit({
          p: egg.position.clone().add(tmp.set(rand(-0.18, 0.18), rand(-0.3, 0.2), rand(-0.1, 0.15))),
          v: new THREE.Vector3(rand(-0.05, 0.05), rand(0.15, 0.4), rand(-0.05, 0.05)),
          life: rand(0.8, 1.6),
          size: rand(0.006, 0.014),
          colour: new THREE.Color(Math.random() < 0.6 ? '#FF9A3D' : '#FFD27A').multiplyScalar(rand(1.4, 2.4)),
          kind: MOTE,
          drag: 0.6,
          gravity: -0.1,
          swirl: 0.3,
          soft: 0.3,
        });
      }
    } else if (eggStep === 'tremble') {
      // About to hatch: shaking harder and harder, the fire in its cracks blazing
      const k = Math.min(1, eggT / 0.95);
      const amp = 0.02 + 0.09 * k * k;
      egg.position.copy(eggTo).add(tmp.set(Math.sin(time * 61) * amp * 0.4, Math.sin(time * 47) * amp * 0.25, 0));
      egg.rotation.set(Math.sin(time * 53) * amp, THREE.MathUtils.degToRad(spin), Math.sin(time * 71) * amp * 1.4);
      eggScale = EGG_SHOW * (1 + 0.06 * k + Math.sin(time * 40) * 0.015 * k);
      look.egg.value = 1 + 5 * k * k;
      uAura.value = 0.75 + 0.6 * k;
      if (Math.random() < 0.3 + k) sparkle(egg.position, 2, '#FFB347', 0.8 + k);
      if (k >= 1) hatchNow();
    } else if (eggStep === 'fox') {
      // Out of the fire it bursts, up and round in a turn, growing, burning into being as it comes;
      // it pulls up where the egg was with a happy nod; then it hovers there, bobbing, now and
      // then nodding or butting the air; a tap, and it breathes fire
      const k = Math.min(1, eggT / LEAP);
      const sz = DRAKE_SHOW;
      const bob = tmp.set(Math.sin(time * 1.3) * 0.05, Math.sin(time * 2.6) * 0.035, Math.sin(time * 0.9) * 0.03);
      if (k < 1) {
        const e = easeOut(k);
        hatched.position
          .copy(eggTo)
          .add(tmp2.set(Math.sin(e * Math.PI) * 0.18, Math.sin(e * Math.PI) * 0.22, 0))
          .addScaledVector(bob, e);
        hatched.scale.setScalar(sz * (0.3 + 0.7 * backOut(k)));
        // (Turning round once on the way out)
        spin = (1 - e) * -360;
      } else {
        hatched.position.copy(eggTo).add(bob);
        hatched.scale.setScalar(sz);
        if (!landed) {
          landed = true;
          const long = creature?.play('Yes', { once: true, fade: 0.2 }) ?? 1;
          later.push({ at: eggT + long - 0.25, what: 'idle' });
          nextMove = eggT + long + rand(3, 5);
          punch = Math.max(punch, 0.35);
          circleNow = Math.max(circleNow, 1.4);
          events.onHaptic('land');
          blast(hatched.position, UP, 0.35);
          events.onCue('hatched');
        }
        // Now and then it does something, then settles back to hovering
        if (eggT >= nextMove && creature && breath <= 0) {
          const pick = Math.random() < 0.6 ? 'Yes' : 'Headbutt';
          const long = creature.play(pick, { once: true, fade: 0.3 });
          later.push({ at: eggT + long - 0.3, what: 'idle' });
          nextMove = eggT + long + rand(3.5, 6);
        }
      }
      for (let i = later.length - 1; i >= 0; i--) {
        if (eggT >= later[i].at) {
          creature?.play('Flying_Idle', { fade: 0.4 });
          later.splice(i, 1);
        }
      }
      // Turned by a finger, settling face on; leaning with the phone's tilt
      if (!spinHeld && k >= 1) {
        const to = Math.round(spin / 360) * 360;
        spinV += (60 * (to - spin) - 9 * spinV) * realDt;
        spin += spinV * realDt;
      }
      hatched.rotation.set(
        tilt.y * 0.12 + 0.08,
        THREE.MathUtils.degToRad(spin) + FACE + tilt.x * 0.4,
        Math.sin(time * 1.3) * 0.06
      );
      eggScale = EGG_SHOW;
      uAura.value += (0.55 - uAura.value) * (1 - Math.exp(-realDt * 4));
      if (creature) {
        creature.reveal.value = Math.min(1, eggT / 0.6);
        creature.base.value = hatched.position.y - 0.35 * hatched.scale.x;
        creature.height.value = 0.7 * hatched.scale.x;
      }
      burnFlames(realDt, hatched.scale.x);
      breathe(realDt);
      // Embers drifting up round it
      if (Math.random() < realDt * 12) {
        const a = rand(0, Math.PI * 2);
        fx.emit({
          p: hatched.position.clone().add(tmp.set(Math.cos(a) * 0.3 * sz, rand(-0.2, 0.2) * sz, Math.sin(a) * 0.15)),
          v: new THREE.Vector3(rand(-0.06, 0.06), rand(0.18, 0.45), rand(-0.05, 0.05)),
          life: rand(0.8, 1.6),
          size: rand(0.006, 0.012),
          colour: new THREE.Color(Math.random() < 0.6 ? '#FF9A3D' : '#FFD27A').multiplyScalar(rand(1.4, 2.2)),
          kind: MOTE,
          drag: 0.6,
          gravity: -0.1,
          swirl: 0.35,
          soft: 0.3,
        });
      }
    } else {
      // To the avatar
      const k = Math.min(1, eggT / 0.7);
      const e = easeInOut(k);
      const a = 1 - e;
      const held = isHatched ? hatched : egg;
      held.position
        .set(0, 0, 0)
        .addScaledVector(eggFrom, a * a)
        .addScaledVector(eggCtrl, 2 * a * e)
        .addScaledVector(eggTo, e * e);
      if (isHatched) {
        burnFlames(realDt, hatched.scale.x);
        // Flying off to your face, turning to it
        hatched.rotation.y +=
          (Math.atan2(eggTo.x - hatched.position.x, eggTo.z - hatched.position.z) - hatched.rotation.y) *
          Math.min(1, realDt * 8);
        hatched.scale.setScalar(DRAKE_SHOW * (1 - e * 0.85));
      } else egg.rotation.y += realDt * (6 + 14 * e);
      eggScale = EGG_SHOW * (1 - e * 0.9);
      uAura.value = 1 - smooth(0, 0.4, k);
      if (Math.random() < 0.9) {
        fx.emit({
          p: held.position.clone(),
          v: new THREE.Vector3(rand(-0.15, 0.15), rand(-0.1, 0.2), rand(-0.15, 0.15)),
          life: rand(0.25, 0.45),
          size: rand(0.008, 0.016),
          colour: new THREE.Color('#FFB347').multiplyScalar(rand(1.5, 2.5)),
          kind: MOTE,
          drag: 0.5,
          soft: 0.05,
        });
      }
      if (k >= 1) {
        eggStep = 'hidden';
        egg.visible = false;
        hatched.visible = false;
        aura.visible = false;
        events.onArrive('egg');
      }
    }
    if (eggStep !== 'fox' && !(eggStep === 'claim' && isHatched)) egg.scale.setScalar(eggScale);
    // The light behind it, a little behind it, facing us
    const lit = isHatched ? hatched.position : egg.position;
    aura.position.copy(lit).addScaledVector(tmp.subVectors(lit, camera.position).normalize(), 0.35);
    aura.quaternion.copy(camera.quaternion);
    aura.scale.setScalar(Math.max(0.01, eggScale / EGG_SHOW));
  }

  /** Fire off the tip of its tail: flames streaming up, sparks now and then */
  function burnFlames(realDt: number, size: number) {
    if (!creature) return;
    for (const at of creature.flames(flamePoints)) {
      if (Math.random() > realDt * 55) continue;
      const spark = Math.random() < 0.15;
      fx.emit({
        p: at.clone().add(tmp.set(rand(-0.01, 0.01), 0, rand(-0.01, 0.01))),
        v: new THREE.Vector3(rand(-0.05, 0.05), rand(0.15, 0.4) * (spark ? 2 : 1), rand(-0.05, 0.05)),
        life: spark ? rand(0.4, 0.8) : rand(0.25, 0.5),
        size: (spark ? rand(0.004, 0.007) : rand(0.018, 0.032)) * size,
        colour: new THREE.Color(spark ? '#FFE7A8' : Math.random() < 0.5 ? '#FF7A1A' : '#FFB347').multiplyScalar(
          rand(1.6, 2.6)
        ),
        kind: spark ? STREAK : MOTE,
        drag: 0.5,
        gravity: -0.25,
        swirl: 0.6,
        soft: 0.15,
        stretch: 0.03,
      });
    }
  }

  /**
   * Its breath: a cone of flame out of its mouth toward us, swelling as it goes, orange to gold
   * to a white hot core, sparks thrown through it
   */
  function breathe(realDt: number) {
    if (breath <= 0 || !creature) return;
    breath -= realDt;
    const k = 1 - Math.max(0, breath) / 0.9;
    const s = hatched.scale.x;
    // Out of its mouth, the way it's opening, bent a little toward us
    creature.mouthAt(mouthAt, facing);
    facing.lerp(tmp2.subVectors(camera.position, mouthAt).normalize(), 0.35).normalize();
    const rate = Math.sin(Math.min(1, k * 1.2) * Math.PI);
    const n = Math.round(rate * 260 * realDt + Math.random());
    for (let i = 0; i < n; i++) {
      const dir = facing
        .clone()
        .add(tmp.set(rand(-0.22, 0.22), rand(-0.22, 0.22), rand(-0.22, 0.22)))
        .normalize();
      const core = Math.random() < 0.25;
      fx.emit({
        p: mouthAt.clone(),
        v: dir.multiplyScalar(rand(1.6, 2.6) * s),
        life: rand(0.3, 0.55),
        size: (core ? rand(0.02, 0.035) : rand(0.035, 0.07)) * s,
        colour: new THREE.Color(core ? '#FFF1C8' : Math.random() < 0.55 ? '#FF6A14' : '#FFB347').multiplyScalar(
          core ? rand(1.3, 1.8) : rand(0.8, 1.3)
        ),
        kind: MOTE,
        drag: 0.25,
        gravity: -0.6,
        swirl: 0.5,
        soft: 0.1,
      });
      if (Math.random() < 0.12)
        fx.emit({
          p: mouthAt.clone(),
          v: dir.multiplyScalar(1.8),
          life: rand(0.4, 0.7),
          size: rand(0.004, 0.007),
          colour: new THREE.Color('#FFE7A8').multiplyScalar(2),
          kind: STREAK,
          drag: 0.4,
          gravity: 1.5,
          stretch: 0.03,
        });
    }
  }

  /** It hatches: the shell bursts into pieces, a flash, a shockwave, and the drake bursts out */
  function hatchNow() {
    eggStep = 'fox';
    eggT = 0;
    isHatched = true;
    spin = 0;
    spinV = 0;
    shardT = 0;
    egg.updateMatrixWorld();
    for (const s of shards) {
      s.mesh.visible = true;
      s.mesh.position.copy(s.centre).applyMatrix4(egg.matrixWorld);
      s.mesh.quaternion.copy(egg.quaternion);
      s.mesh.scale.setScalar(eggScale);
      s.v
        .copy(s.dir)
        .applyQuaternion(egg.quaternion)
        .multiplyScalar(rand(1.6, 3.4))
        .add(tmp.set(0, rand(0.3, 1.2), 0.6));
      s.spin.set(rand(-9, 9), rand(-9, 9), rand(-9, 9));
    }
    egg.visible = false;
    hatched.visible = true;
    landed = false;
    nextMove = 0;
    later.length = 0;
    hatched.position.copy(eggTo);
    hatched.scale.setScalar(DRAKE_SHOW * 0.3);
    breath = 0;
    if (creature) {
      creature.reveal.value = 0;
      creature.play('Fast_Flying', { fade: 0.05 });
    }
    look.egg.value = 1;
    look.heat.value = 1;
    flash = 0.25;
    boost = 0.5;
    punch = Math.max(punch, 1);
    screenUV(eggTo, uImpact.value);
    uShock.value = 0;
    uBulge.value = 0.6;
    uSplit.value = 0.6;
    uStar.value = 0.8;
    uStreak.value = 0.7;
    hatchBlast = 0;
    blast(eggTo, tmp2.subVectors(camera.position, eggTo).normalize().clone(), 0.8);
    // A ring of flame bursting out round it, flat to us
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2 + rand(-0.05, 0.05);
      const out = new THREE.Vector3(Math.cos(a), Math.sin(a), 0).applyQuaternion(camera.quaternion);
      fx.emit({
        p: eggTo.clone().addScaledVector(out, 0.08),
        v: out.multiplyScalar(rand(1.2, 1.7)),
        life: rand(0.35, 0.55),
        size: rand(0.03, 0.05),
        colour: new THREE.Color(Math.random() < 0.5 ? '#FF7A1A' : '#FFB347').multiplyScalar(rand(1, 1.5)),
        kind: MOTE,
        drag: 0.08,
        soft: 0.05,
      });
    }
    events.onCue('hatch');
  }

  function stepShards(realDt: number) {
    if (shardT < 0) return;
    shardT += realDt;
    const fade = 1 - smooth(1.1, 1.9, shardT);
    for (const s of shards) {
      s.v.y -= 3.2 * realDt;
      s.v.multiplyScalar(Math.exp(-realDt * 0.6));
      s.mesh.position.addScaledVector(s.v, realDt);
      tmpQ.setFromEuler(new THREE.Euler(s.spin.x * realDt, s.spin.y * realDt, s.spin.z * realDt));
      s.mesh.quaternion.multiply(tmpQ);
      s.mesh.scale.setScalar(Math.max(0.0001, EGG_SHOW * fade));
      if (fade <= 0) s.mesh.visible = false;
    }
    look.heat.value = Math.max(look.heat.value, Math.exp(-shardT * 1.5));
    if (fade <= 0) shardT = -1;
  }

  // ---- Coins and gems ----

  function stepFlyers(dt: number) {
    for (const f of flyers) {
      if (f.state === 'off') {
        f.scale = 0;
      } else if (f.state === 'baked') {
        pose(f.kind, f.index, bakeT, f.p, f.q);
        f.scale = f.kind === 'gem' ? 0.95 : 1;
      } else if (f.state === 'go') {
        const size = f.kind === 'gem' ? 0.95 : 1;
        if (f.delay > 0) {
          f.delay -= dt;
        } else {
          f.t = Math.min(1, f.t + dt / 0.62);
          const t = easeInOut(f.t);
          const a = 1 - t;
          f.p
            .set(0, 0, 0)
            .addScaledVector(f.from, a * a)
            .addScaledVector(f.ctrl, 2 * a * t)
            .addScaledVector(f.to, t * t);
          tmpQ.setFromAxisAngle(f.axis, f.spin * dt * (1 + t * 2));
          f.q.premultiply(tmpQ);
          f.scale = size * (1 - t * 0.78);
          if (Math.random() < 0.55) {
            fx.emit({
              p: f.p.clone(),
              v: new THREE.Vector3(rand(-0.15, 0.15), rand(-0.1, 0.2), rand(-0.15, 0.15)),
              life: rand(0.25, 0.45),
              size: rand(0.008, 0.016) * (1 - t * 0.5),
              colour: new THREE.Color(f.kind === 'coin' ? '#FFD36A' : '#C99BFF').multiplyScalar(rand(1.5, 2.5)),
              kind: MOTE,
              drag: 0.5,
              soft: 0.05,
            });
          }
          if (f.t >= 1) {
            f.state = 'off';
            f.scale = 0;
            events.onArrive(f.kind);
          }
        }
      } else if (f.state === 'sink') {
        f.scale = Math.max(0, f.scale - dt * 4);
        f.p.y -= dt * 0.2;
        if (f.scale <= 0) f.state = 'off';
      }
      placeFlyer(f);
    }
    coinMesh.instanceMatrix.needsUpdate = true;
    gemMesh.instanceMatrix.needsUpdate = true;
  }

  /** XP: orbs of light from the chest's mouth to the level bar */
  function custom(s: Particle, dt: number) {
    if (s.tag !== XP) return true;
    const o = xpOrbs.find((x) => x.s === s);
    if (!o) return false;
    if (o.delay > 0) {
      o.delay -= dt;
      s.p.copy(o.from);
      s.v.set(0, 0, 0);
      return true;
    }
    o.t = Math.min(1, o.t + dt / 0.7);
    const t = easeInOut(o.t);
    const a = 1 - t;
    const before = tmp.copy(s.p);
    s.p
      .set(0, 0, 0)
      .addScaledVector(o.from, a * a)
      .addScaledVector(o.ctrl, 2 * a * t)
      .addScaledVector(o.to, t * t);
    s.v.subVectors(s.p, before).divideScalar(Math.max(dt, 1e-4));
    s.age = Math.min(s.age, s.life * 0.4);
    if (Math.random() < 0.8) {
      fx.emit({
        p: s.p.clone(),
        v: new THREE.Vector3(rand(-0.1, 0.1), rand(-0.1, 0.1), rand(-0.1, 0.1)),
        life: rand(0.2, 0.4),
        size: rand(0.006, 0.012),
        colour: new THREE.Color('#9FF4FF').multiplyScalar(rand(1.4, 2.4)),
        kind: MOTE,
        drag: 0.5,
        soft: 0.05,
      });
    }
    if (o.t >= 1) {
      o.done = true;
      events.onArrive('xp');
      return false;
    }
    return true;
  }

  // ---- Each frame ----

  /** How fast the world runs: slow just after the blast, speeding up to real time */
  function timeScale() {
    if (phase !== 'burst') return 1;
    return SLOW + (1 - SLOW) * smooth(0.28, 1.0, sinceBlast);
  }

  function advance(realDt: number) {
    time += realDt;
    const ts = timeScale();
    const dt = realDt * ts;
    // The light: as far as the hold's got (full while the key's on its way)
    const c = phase === 'idle' ? getCharge() : phase === 'dive' ? 1 : 0;
    chargeNow = c;
    // The strain on it: the hold; easing off as the key comes, still as it goes in
    const strain = phase === 'idle' ? c : phase === 'dive' && keyStep === 'fly' ? 1 - smooth(0, 0.75, keyT / FLY) : 0;
    const s2 = strain * strain;

    // ---- The key: in the hand, or on its way in ----
    stepKey(realDt, c);
    look.keyFill.value = phase === 'dive' ? 1 : c;
    look.keyBulb.value.copy(keyMesh.position);
    look.keyBulbR.value = 0.026 * keyMesh.scale.x;
    if (phase === 'dive') {
      screenUV(KEYHOLE, uPinchAt.value);
      uPinch.value = keyStep === 'fly' ? smooth(0.35, 1, keyT / FLY) * 0.5 : 0.3;
    }

    // ---- The chest: straining; or, left alone, every few seconds something inside wants out: two
    // hard jolts, the lid kicking up against the chains, light flaring out round it, the chains
    // rattling, the circle on the dais flashing, a clank and a knock in the hand ----
    let stir = 0;
    let jolt = 0;
    if (phase === 'idle' && c < 0.02) {
      nextStir -= realDt;
      if (nextStir <= 0 && stirT < 0) {
        stirT = 0;
        nextStir = rand(2.4, 3.8);
      }
    }
    if (stirT >= 0) {
      const was = stirT;
      stirT += realDt;
      for (const [at, k] of [
        [0.08, 1],
        [0.38, 0.75],
      ] as const) {
        jolt += k * Math.exp(-(((stirT - at) / 0.05) ** 2));
        if (was < at && stirT >= at) {
          events.onKnock('link', 1.4 + k * 0.6);
          circleNow = Math.max(circleNow, 0.9 * k);
          sparkle(tmp2.set(rand(-0.35, 0.35), MOUTH.y - 0.02, 0.33), 7, '#FFD27A', 0.8);
        }
      }
      stir = Math.sin(Math.min(1, stirT / 0.75) * Math.PI);
      if (stirT >= 0.75) stirT = -1;
    }
    if (phase === 'idle' || phase === 'dive') {
      shake.set(
        Math.sin(time * 61) * 0.014 * s2 + Math.sin(time * 37) * 0.004 * strain,
        0,
        Math.sin(time * 47) * 0.006 * s2
      );
      const hop = Math.pow(Math.max(0, Math.sin(time * 11)), 10) * 0.05 * smooth(0.45, 1, strain);
      if (hop < 0.002 && hopWas >= 0.002) events.onHaptic('land');
      hopWas = hop;
      chest.position.set(shake.x + Math.sin(time * 70) * 0.012 * jolt, hop + stir * 0.012 + jolt * 0.035, shake.z);
      chest.rotation.set(
        Math.sin(time * 29) * 0.012 * s2 + jolt * 0.025,
        Math.sin(time * 23) * 0.04 * s2,
        Math.sin(time * 53) * 0.022 * s2 + Math.sin(time * 19) * 0.006 * strain + Math.sin(time * 45) * 0.04 * jolt
      );
      rarityAt(c, colourNow);
      // Held shut by the chains: the lid only judders
      const judder =
        -(0.004 + 0.03 * s2) * Math.abs(Math.sin(time * 33)) * smooth(0, 0.15, strain) - 0.02 * stir - 0.08 * jolt;
      lidV += (900 * (judder - lid) - 34 * lidV) * realDt;
      lid += lidV * realDt;
      if (lid > 0.02) lid = 0.02;
      // (Less of it close up on the padlock, where it'd wash over everything)
      look.leak.value = Math.max(
        smooth(0, 1, c) * (0.75 + 0.25 * Math.sin(time * 40)) * (1 - closeUp * 0.55),
        stir * 0.3 + jolt * 0.9
      );
      placeSealAtRest(Math.max(strain, stir * 0.5 + jolt * 0.3));
    }

    // ---- The burst, played from the bake (forwards, or backwards for Replay) ----
    if (phase === 'burst' || phase === 'rewind') {
      if (phase === 'burst') {
        sinceBlast += realDt;
        bakeT = Math.min(BAKE.duration, bakeT + dt);
        // The knocks it makes on the way
        while (nextKnock < BAKE.knocks.length && BAKE.knocks[nextKnock].t <= bakeT) {
          const k = BAKE.knocks[nextKnock++];
          const loot = k.kind === 'coin' || k.kind === 'gem';
          // (The treasure's hidden in the chest till it goes up)
          if (loot && bakeT < BAKE.eruptAt) continue;
          if (loot) sparkle(k.at, 3, k.kind === 'coin' ? '#FFE08A' : '#D9B8FF', 0.6);
          else sparkle(k.at, 4, '#FFB65C', Math.min(1.6, 0.5 + k.strength * 0.2));
          events.onKnock(k.kind, k.strength);
        }
        // Sparks streaming off the padlock's pieces as they fly
        if (bakeT < 0.9) {
          for (const m of lockPieces) {
            if (Math.random() < 0.6 * ts + 0.15) {
              fx.emit({
                p: m.position.clone(),
                v: new THREE.Vector3(rand(-0.3, 0.3), rand(-0.1, 0.4), rand(-0.3, 0.3)),
                life: rand(0.3, 0.7),
                size: rand(0.005, 0.011),
                colour: new THREE.Color(Math.random() < 0.5 ? '#FFB347' : RARITY[burstRarity]).multiplyScalar(2.4),
                kind: MOTE,
                drag: 0.4,
                gravity: 1.2,
                soft: 0.05,
              });
            }
          }
        }
        if (!erupted && bakeT >= BAKE.eruptAt) {
          erupted = true;
          events.onCue('erupt');
          for (const f of flyers) if (f.state === 'off') f.state = 'baked';
          // A puff of gold out of the chest as it goes: a few sparks up, glitter hanging over it
          for (let i = 0; i < 36; i++) {
            const dir = new THREE.Vector3(rand(-0.5, 0.5), 1, rand(-0.3, 0.5)).normalize();
            fx.emit({
              p: MOUTH.clone().add(new THREE.Vector3(rand(-0.3, 0.3), 0, rand(-0.15, 0.15))),
              v: dir.multiplyScalar(rand(2, 4.5)),
              life: rand(0.4, 0.9),
              size: rand(0.004, 0.009),
              colour: new THREE.Color(Math.random() < 0.6 ? '#FFD36A' : RARITY[burstRarity]).multiplyScalar(
                rand(1.6, 2.4)
              ),
              kind: STREAK,
              drag: 0.5,
              gravity: 5,
              stretch: 0.022,
            });
          }
          for (let i = 0; i < 50; i++) {
            const dir = new THREE.Vector3(rand(-0.7, 0.7), 1, rand(-0.4, 0.6)).normalize();
            fx.emit({
              p: MOUTH.clone().add(new THREE.Vector3(rand(-0.35, 0.35), 0, rand(-0.15, 0.15))),
              v: dir.multiplyScalar(rand(0.5, 2.2)),
              life: rand(1, 2.2),
              size: rand(0.012, 0.026),
              colour: new THREE.Color(Math.random() < 0.6 ? '#FFE7A8' : '#FFC24D').multiplyScalar(rand(1.1, 1.9)),
              kind: GLINT,
              drag: 0.35,
              gravity: 0.7,
              swirl: 0.2,
            });
          }
        }
        if (!opened && reveal === 'cards' && bakeT >= CARDS_AT) {
          opened = true;
          events.onOpen();
        }
        if (!opened && reveal === 'items' && eggStep === 'hidden' && bakeT >= EGG_AT) {
          opened = true;
          rise();
        }
        if (sinceBlast > 0.04 && sinceBlast - realDt <= 0.04) events.onCue('chains');
      } else {
        // Slow to start, then faster and faster: sucked back together
        rewindT += realDt;
        bakeT = Math.max(BAKE.burstAt, bakeT - realDt * REWIND * (0.3 + smooth(0, 0.45, rewindT)));
        if (bakeT <= BAKE.burstAt) {
          // Whole again: back on the chest
          phase = 'idle';
          chest.attach(sealGroup);
          sealGroup.position.set(0, 0, 0);
          sealGroup.rotation.set(0, 0, 0);
          lid = 0;
          lidV = 0;
          punch = Math.max(punch, 0.6);
          look.heat.value = 0.6;
          uCore.value = 0.5;
          flash = Math.max(flash, 0.2);
          circleNow = Math.max(circleNow, 1.5);
          events.onCue('close');
          events.onHaptic('close');
          events.onSealed();
        }
      }
      if (phase !== 'idle') {
        placeSealBaked(bakeT);
        lid = lidAt(bakeT);
      }
    }
    hinge.rotation.x = lid;

    // Squash and stretch as it bursts
    squashV += (260 * (1 - squash) - 13 * squashV) * dt;
    squash += squashV * dt;
    chest.scale.set(1 + (1 - squash) * 0.5, squash, 1 + (1 - squash) * 0.5);

    // ---- Light ----
    open = Math.min(1, Math.max(0, -lid / 1.6));
    look.charge.value = c;
    look.open.value = open;
    look.rarity.value.copy(colourNow);
    if (phase === 'burst') {
      look.leak.value = Math.max(0, look.leak.value - dt * 3);
      look.heat.value = Math.max(0, Math.exp(-(bakeT - BAKE.burstAt) * 1.6));
    } else if (phase === 'rewind') {
      look.heat.value = 0.4 + 0.3 * Math.sin(time * 20);
    } else {
      look.heat.value = Math.max(0, look.heat.value - realDt * 1.5);
    }
    // The shaft from above: brighter with the hold, flaring as it bursts, settling
    const shaftTo = phase === 'burst' ? 0.18 : 0.3 + c * 0.14 + stir * 0.05;
    shaftNow += (shaftTo - shaftNow) * (1 - Math.exp(-realDt * (shaftNow > shaftTo ? 2.2 : 4)));
    // (Faded as the camera goes in close on the padlock: it'd be all you see)
    uShaft.value = shaftNow * (1 - focus * 0.4) * (1 - closeUp * 0.75);
    look.shaft.value = 0.35 + shaftNow * 0.35;
    // The pillar out of the chest: from the burst, while the egg's up (and while the cards come)
    const pillarTo = phase !== 'burst' || collected ? 0 : eggStep !== 'hidden' ? 0.5 : 0.75 * (1 - focus * 0.5);
    pillarNow += (pillarTo - pillarNow) * (1 - Math.exp(-realDt * (pillarNow > pillarTo ? 2.4 : 5)));
    pillarWide += (1 - pillarWide) * (1 - Math.exp(-realDt * 6));
    uPillar.value = pillarNow;
    pillar.visible = pillarNow > 0.01;
    // (Opening out like a fan as it comes)
    pillar.scale.set(0.35 + 0.65 * pillarWide, 0.6 + 0.4 * pillarWide, 1);
    // The magic circle: the hold, a flash as it goes, a glow while the egg's up
    const circleTo = eggStep === 'show' ? 0.6 : 0;
    circleNow += (circleTo - circleNow) * (1 - Math.exp(-realDt * 2.5));
    look.circle.value = circleNow;
    uUnder.value = 0.4 + c * 0.7 + circleNow * 0.3;
    waveT = Math.min(1, waveT + dt / 0.9);
    uWave.value = waveT;
    dustT = Math.min(1, dustT + dt / 2.2);
    uDust.value = dustT;
    uCore.value *= Math.exp(-realDt * 4);
    // The blast on the screen: in real time, so it reads even in the slow motion
    if (hatchBlast >= 0) {
      hatchBlast += realDt;
      uShock.value = Math.min(1, hatchBlast / 0.55);
      uBulge.value = 0.8 * Math.exp(-hatchBlast * 5);
      uSplit.value = 0.8 * Math.exp(-hatchBlast * 4);
      uStar.value = Math.exp(-hatchBlast * 3);
      uStreak.value = Math.exp(-hatchBlast * 2.4);
      if (hatchBlast > 1.6) hatchBlast = -1;
    } else if (phase === 'burst') {
      uShock.value = Math.min(1, sinceBlast / 0.6);
      uBulge.value = Math.exp(-sinceBlast * 4.2);
      uSplit.value = Math.exp(-sinceBlast * 3.2);
      uStar.value = Math.exp(-sinceBlast * 2.8);
      uStreak.value = Math.exp(-sinceBlast * 2.0);
      uPinch.value *= Math.exp(-realDt * 30);
    } else if (phase !== 'dive') {
      uShock.value = 1;
      uBulge.value *= Math.exp(-realDt * 8);
      // Running backwards, the picture's split a little, like a tape rewinding
      uSplit.value = phase === 'rewind' ? Math.max(uSplit.value, 0.3) : uSplit.value * Math.exp(-realDt * 8);
      uStar.value *= Math.exp(-realDt * 8);
      uStreak.value *= Math.exp(-realDt * 8);
      uPinch.value *= Math.exp(-realDt * 10);
    }
    flash *= Math.exp(-realDt * 14);
    uFlash.value = flash;
    boost *= Math.exp(-realDt * 2.2);
    glowing.strength.value = GLOW + (GLOW_BURST - GLOW) * boost;
    uVignette.value = c;
    focus += (focusTo - focus) * (1 - Math.exp(-realDt * 4));
    look.focus.value = focus;
    uDim.value = (1 - c * 0.5) * (1 - focus * 0.45);
    // A glint over the gold every few seconds
    nextGlint -= realDt;
    if (nextGlint <= 0) {
      nextGlint = rand(2.8, 4.2);
      glintT = 0;
    }
    if (glintT >= 0) {
      glintT += realDt / 0.9;
      look.glint.value = -1.2 + glintT * 3.6;
      if (glintT >= 1) {
        glintT = -1;
        look.glint.value = -10;
      }
    }
    // Motes of light rising off the circle's runes: more as the hold goes on
    runeClock += realDt * (4 + c * 36 + circleNow * 6);
    while (runeClock > 1) {
      runeClock -= 1;
      const a = rand(0, Math.PI * 2);
      const r = rand(0.78, 0.94);
      fx.emit({
        p: new THREE.Vector3(Math.cos(a) * r, 0.012, Math.sin(a) * r),
        v: new THREE.Vector3(Math.cos(a) * 0.04, rand(0.12, 0.32) * (1 + c), Math.sin(a) * 0.04),
        life: rand(1.2, 2.4),
        size: rand(0.008, 0.016),
        colour: new THREE.Color('#A884FF').lerp(colourNow, c).multiplyScalar(rand(1.3, 2.2)),
        kind: MOTE,
        drag: 0.8,
        gravity: -0.04,
        swirl: 0.2,
        soft: 0.3,
      });
    }
    // Motes of light rising round it once it's open
    moteClock += dt * (phase === 'burst' ? 9 : 0);
    while (moteClock > 1) {
      moteClock -= 1;
      fx.emit({
        p: new THREE.Vector3(rand(-1.1, 1.1), rand(-0.1, 0.5), rand(-0.6, 0.8)),
        v: new THREE.Vector3(rand(-0.05, 0.05), rand(0.08, 0.25), rand(-0.05, 0.05)),
        life: rand(2.5, 4.5),
        size: rand(0.012, 0.03),
        colour: new THREE.Color().set(RARITY[burstRarity]).multiplyScalar(rand(0.6, 1.3)),
        kind: MOTE,
        drag: 0.9,
        gravity: -0.03,
        swirl: 0.25,
        soft: 0.35,
      });
    }
    // Charging: sparks crawling off the key's bulb
    if (phase === 'idle' && keyMesh.visible && Math.random() < c * 0.9) {
      fx.emit({
        p: keyMesh.position.clone().add(tmp.set(rand(-0.04, 0.04), rand(-0.04, 0.04), rand(-0.04, 0.04))),
        v: new THREE.Vector3(rand(-0.15, 0.15), rand(0, 0.3), rand(-0.15, 0.15)),
        life: rand(0.25, 0.5),
        size: rand(0.004, 0.008),
        colour: new THREE.Color().copy(colourNow).multiplyScalar(rand(1.8, 3)),
        kind: MOTE,
        drag: 0.4,
        soft: 0.05,
      });
    }
    stepEgg(realDt);
    if (creature && hatched.visible) creature.mixer.update(realDt);
    stepShards(realDt);
    stepFlyers(dt);
    // The air: drawn to the key while it charges
    const pull = phase === 'idle' ? smooth(0.05, 1, c) * keyShown : phase === 'dive' ? 1 : 0;
    air.update(dt, time, camera, pull, pull > 0 ? keyMesh.position : null, colourNow, 1 - focus * 0.8);
    return dt;
  }

  function placeCamera(realDt: number) {
    const c = chargeNow;
    punch *= Math.exp(-realDt * 3.2);
    // In on the padlock as the key flies in, turning a touch; back out as it bursts
    const closeTo = phase === 'dive' ? smooth(0.1, 0.9, keyStep === 'fly' ? keyT / FLY : 1) : 0;
    closeUp += (closeTo - closeUp) * (1 - Math.exp(-realDt * (closeTo > closeUp ? 14 : 2.6)));
    const lean = smooth(0, 1, c) * 0.08 * (1 - closeUp);
    // In the slow motion, the camera drifts in on it
    const slow = phase === 'burst' ? (1 - smooth(0.28, 1.0, sinceBlast)) * smooth(0, 0.15, sinceBlast) : 0;
    tmp.subVectors(base, TARGET).applyAxisAngle(UP, closeUp * 0.12);
    camera.position.copy(TARGET).add(tmp);
    camera.position.lerp(LOCK, closeUp * 0.78);
    camera.position.lerp(TARGET, lean + slow * 0.1);
    camera.position.x += tilt.x * 0.08;
    camera.position.y += tilt.y * 0.05;
    const amp = c * c * 0.012 * (1 - closeUp) + punch * 0.06;
    camera.position.x += (Math.sin(time * 71) + Math.sin(time * 43) * 0.5) * amp;
    camera.position.y += (Math.sin(time * 59) + Math.sin(time * 31) * 0.5) * amp;
    lookAt.copy(TARGET).lerp(LOCK, closeUp);
    camera.lookAt(lookAt);
    camera.rotation.z += Math.sin(time * 37) * punch * 0.012;
    camera.fov = FOV + punch * 3 - lean * 6 - slow * 2.5;
    camera.updateProjectionMatrix();
    beams.lookAt(camera.position);
    core.lookAt(camera.position);
    // The rays stand up out of the chest, turned to face us
    pillar.rotation.set(0, Math.atan2(camera.position.x - pillar.position.x, camera.position.z - pillar.position.z), 0);
  }

  // ---- The loop ----
  let last = performance.now();
  let failed = false;
  let onFirstFrame: (() => void) | null = null;
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    // (Dev builds can run it slow, for QA: dailyDropSpeed = 0.1)
    const speed = __DEV__ ? ((globalThis as { dailyDropSpeed?: number }).dailyDropSpeed ?? 1) : 1;
    const realDt = Math.min(0.05, (now - last) / 1000) * speed;
    last = now;
    if (failed) return;
    try {
      const dt = advance(realDt);
      placeCamera(realDt);
      camera.updateMatrixWorld();
      fx.update(dt, time, camera, custom);
      post.render();
      context.present();
    } catch (e) {
      if (__DEV__) console.error('[daily-drop]', e);
      failed = true;
      return;
    }
    if (onFirstFrame) {
      const cb = onFirstFrame;
      onFirstFrame = null;
      cb();
    }
  });

  return {
    resize(w: number, h: number, ratio: number) {
      width = w;
      height = h;
      renderer.setSize(Math.round(w * ratio), Math.round(h * ratio), false);
      fit();
    },
    /** The phone's tilt, -1 to 1 each way: the camera and the vault drift with it */
    setTilt(x: number, y: number) {
      tilt.set(x, y);
      uTilt.value.set(x, y);
    },
    /** What comes out of it: the egg and the rest as items, or the cards */
    setReveal(mode: Reveal) {
      reveal = mode;
    },
    /** The key: where it's held (points), or null, let go (it stays where it was, draining away) */
    key(at: Point | null) {
      if (at) keyWant.set(at.x / width, at.y / height);
      keyOn = !!at;
    },
    /** Full: the key flies to the padlock, goes in and turns, and it bursts */
    dive(rarity: Rarity) {
      if (phase !== 'idle') return;
      burstRarity = rarity;
      phase = 'dive';
      keyOn = false;
      keyStep = 'fly';
      keyT = 0;
      if (keyMesh.visible) {
        keyFrom.copy(keyMesh.position);
        keyFromQ.copy(keyMesh.quaternion);
      } else {
        worldAt({ x: width / 2, y: height * 0.8 }, KEY_DIST, keyFrom);
        keyFromQ.copy(camera.quaternion).multiply(HELD);
      }
      keyCtrl
        .copy(keyFrom)
        .lerp(keyApproach, 0.5)
        .add(tmp.set(0.12, 0.28, 0.1));
      events.onCue('dive');
    },
    /** Hatch the egg: it shakes, its cracks blaze, and it bursts */
    hatch() {
      if (eggStep !== 'show') return;
      eggStep = 'tremble';
      eggT = 0;
      spinHeld = false;
    },
    /** A tap on the drake: it rears back and breathes fire at you */
    poke() {
      if (eggStep !== 'fox' || !landed || !creature || breath > 0) return;
      const long = creature.play('Headbutt', { once: true, fade: 0.1, speed: 1.2 });
      later.length = 0;
      later.push({ at: eggT + long - 0.25, what: 'idle' });
      nextMove = eggT + long + rand(3, 5);
      breath = 0.9;
      punch = Math.max(punch, 0.3);
      flash = Math.max(flash, 0.08);
      circleNow = Math.max(circleNow, 1);
    },
    /** A finger on the egg: turned this far (points), across the screen */
    spin(dx: number) {
      if (eggStep !== 'show' && eggStep !== 'fox') return;
      spinHeld = true;
      spinV = 0;
      spin += dx * 0.75;
    },
    /** Let go of the egg, moving this fast (points a second) */
    release(vx: number) {
      if (!spinHeld) return;
      spinHeld = false;
      spinV = vx * 0.75;
    },
    /** The cards (or the egg) are up: the chest steps back */
    focus(on: boolean) {
      focusTo = on ? 1 : 0;
    },
    /** Send the loot up to where these are on the screen; the egg, if it's up, to `egg` */
    collect(to: { coin: Point; gem: Point; xp: Point; egg?: Point }) {
      collected = true;
      let k = 0;
      let g = 0;
      for (const f of flyers) {
        if (f.state !== 'baked') continue;
        f.state = 'go';
        f.t = 0;
        f.delay = f.kind === 'coin' ? 0.05 + k++ * 0.022 : 0.2 + g++ * 0.06;
        f.from.copy(f.p);
        worldAt(f.kind === 'coin' ? to.coin : to.gem, 2.4, f.to);
        f.ctrl
          .copy(f.from)
          .lerp(f.to, 0.4)
          .add(tmp.set(rand(-0.6, 0.6), rand(0.6, 1.2), rand(-0.2, 0.4)));
        f.spin = rand(14, 24);
      }
      const goal = worldAt(to.xp, 2.4, new THREE.Vector3());
      for (let i = 0; i < 9; i++) {
        const s = fx.emit({
          p: MOUTH.clone(),
          v: new THREE.Vector3(),
          life: 30,
          size: rand(0.022, 0.03),
          colour: new THREE.Color('#7CF0FF').multiplyScalar(rand(1.4, 2.2)),
          kind: MOTE,
          drag: 1,
          tag: XP,
        });
        if (!s) continue;
        const from = new THREE.Vector3(rand(-0.25, 0.25), MOUTH.y + rand(0.05, 0.25), rand(-0.1, 0.15));
        xpOrbs.push({
          s,
          from,
          ctrl: from
            .clone()
            .lerp(goal, 0.5)
            .add(new THREE.Vector3(rand(-0.8, 0.8), rand(0.4, 1), 0)),
          to: goal.clone(),
          delay: 0.9 + i * 0.07,
          t: 0,
          done: false,
        });
      }
      for (let i = xpOrbs.length - 1; i >= 0; i--) if (xpOrbs[i].done) xpOrbs.splice(i, 1);
      if (to.egg && (eggStep === 'show' || eggStep === 'fox')) {
        eggStep = 'claim';
        eggT = 0;
        spinHeld = false;
        eggFrom.copy(isHatched ? hatched.position : egg.position);
        if (isHatched) creature?.play('Fast_Flying', { fade: 0.15, speed: 1.3 });
        worldAt(to.egg, 1.6, eggTo);
        eggCtrl
          .copy(eggFrom)
          .lerp(eggTo, 0.5)
          .add(tmp.set(0.4, 0.5, 0));
      }
    },
    /** Run it all backwards: the chains fly back on, the padlock comes back together, the lid slams */
    reset() {
      for (const f of flyers) if (f.state !== 'off') f.state = 'sink';
      xpOrbs.length = 0;
      focusTo = 0;
      eggStep = 'hidden';
      egg.visible = false;
      aura.visible = false;
      hatched.visible = false;
      isHatched = false;
      breath = 0;
      creature?.play('Flying_Idle');
      shardT = -1;
      for (const s of shards) s.mesh.visible = false;
      look.egg.value = 1;
      colourNow.set(RARITY.common);
      if (phase === 'burst') {
        phase = 'rewind';
        bakeT = Math.min(bakeT, REWIND_FROM);
        rewindT = 0;
        events.onCue('rewind');
      } else if (phase !== 'rewind') events.onSealed();
    },
    /** Where the chest's mouth is on the screen, in points */
    mouth(): Point {
      tmp.copy(MOUTH).applyMatrix4(chest.matrixWorld).project(camera);
      return { x: ((tmp.x + 1) / 2) * width, y: ((1 - tmp.y) / 2) * height };
    },
    onFirstFrame(cb: () => void) {
      onFirstFrame = cb;
    },
    dispose() {
      renderer.setAnimationLoop(null);
      post.dispose();
      renderer.dispose();
    },
  };
}

export type Drop = ReturnType<typeof createDrop>;

/** A shell in pieces: its triangles grouped by which way they face from its middle, each piece about its own middle */
function shatter(g: THREE.BufferGeometry, n: number) {
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  const col = g.getAttribute('color');
  const kin = g.getAttribute('kind');
  const index = g.getIndex()!;
  const dirs = Array.from({ length: n }, (_, k) => {
    const y = 1 - (2 * (k + 0.5)) / n;
    const r = Math.sqrt(1 - y * y);
    const a = k * Math.PI * (3 - Math.sqrt(5));
    return new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
  });
  const groups: number[][] = dirs.map(() => []);
  const c = new THREE.Vector3();
  const v = new THREE.Vector3();
  for (let t = 0; t < index.count; t += 3) {
    c.set(0, 0, 0);
    for (let k = 0; k < 3; k++) c.add(v.fromBufferAttribute(pos, index.getX(t + k)));
    c.normalize();
    let best = 0;
    for (let d = 1; d < n; d++) if (c.dot(dirs[d]) > c.dot(dirs[best])) best = d;
    groups[best].push(t);
  }
  return groups
    .filter((tris) => tris.length)
    .map((tris) => {
      const count = tris.length * 3;
      const P = new Float32Array(count * 3);
      const N = new Float32Array(count * 3);
      const C = new Float32Array(count * 3);
      const K = new Float32Array(count);
      const centre = new THREE.Vector3();
      let j = 0;
      for (const t of tris) {
        for (let k = 0; k < 3; k++, j++) {
          const i = index.getX(t + k);
          P.set([pos.getX(i), pos.getY(i), pos.getZ(i)], j * 3);
          N.set([nor.getX(i), nor.getY(i), nor.getZ(i)], j * 3);
          C.set([col.getX(i), col.getY(i), col.getZ(i)], j * 3);
          K[j] = kin.getX(i);
          centre.add(v.set(pos.getX(i), pos.getY(i), pos.getZ(i)));
        }
      }
      centre.divideScalar(count);
      const R = P.slice();
      for (let i = 0; i < count; i++) {
        P[i * 3] -= centre.x;
        P[i * 3 + 1] -= centre.y;
        P[i * 3 + 2] -= centre.z;
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(P, 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(N, 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(C, 3));
      geometry.setAttribute('kind', new THREE.BufferAttribute(K, 1));
      geometry.setAttribute('rest', new THREE.BufferAttribute(R, 3));
      return { geometry, centre, dir: centre.clone().normalize() };
    });
}

function additive() {
  return new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}
