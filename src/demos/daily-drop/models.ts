import * as TSL from 'three/tsl';
import * as THREE from 'three/webgpu';

import { RARITY } from './palette';

/**
 * The chest and everything round it, modelled in Blender (scripts/blender/daily_drop_models.py):
 * its body of oak planks bound in gold, its barrel lid on a hinge at the back, the heap of coins and
 * gems inside, the stone dais it stands on, and the loose coin and gem that fly out of it. Every
 * vertex carries its colour (shadow worked in) and what it's made of, and each kind of stuff gets
 * its own surface here: oak with a soft sheen, gold that mirrors the vault, velvet that glows at its
 * edges, gems that sparkle and burn brighter as the chest strains, runes that pulse.
 *
 * Lit by hand rather than with lights: a warm shaft from the opening high in the vault, a violet rim
 * from behind, the vault's own dark round everything; and when the chest strains or opens, the light
 * of what's inside it: out round the lid while it's held shut, up over the lid's underside and the
 * dais once it's open.
 *
 * And the seal on it (scripts/blender/daily_drop_burst.py): iron chains that glow out along their
 * length from the padlock as the hold goes on, and the padlock, cracks of light spreading over it
 * along the lines it'll break on, its broken insides white hot when it does.
 */

const {
  vec3,
  float,
  saturate,
  dot,
  normalize,
  pow,
  exp,
  max,
  mix,
  smoothstep,
  reflect,
  abs,
  step,
  sin,
  cos,
  sqrt,
  length,
} = TSL;
export type V3 = THREE.Node<'vec3'>;
export type F = THREE.Node<'float'>;

export const hex = (c: string) => {
  const k = new THREE.Color(c);
  return vec3(k.r, k.g, k.b) as unknown as V3;
};

export { RARITY, type Rarity } from './palette';

/** What every surface shares, set by the scene each frame */
export const look = {
  /** How long it's been held, 0 to 1 */
  charge: TSL.uniform(0),
  /** The light leaking out round the lid */
  leak: TSL.uniform(0),
  /** How far the lid's open: the treasure's light, 0 to 1 */
  open: TSL.uniform(0),
  /** The colour of what's inside, as far as it's shown itself */
  rarity: TSL.uniform(new THREE.Color(RARITY.common)),
  /** A glint sweeping over the gold: where it's got to, along x + y */
  glint: TSL.uniform(-10),
  /** Cards up: the chest steps back into the dark */
  focus: TSL.uniform(0),
  /** Where the treasure's light comes from: the middle of the chest's mouth, world space */
  mouth: TSL.uniform(new THREE.Vector3(0, 0.57, 0)),
  /** The seam round the lid: its height and the half sizes of the opening, world space */
  seam: TSL.uniform(new THREE.Vector3(0.52, 0.5, 0.31)),
  /** The heat in what's just broken: 1 the moment it goes, cooling to nothing */
  heat: TSL.uniform(0),
  /** The padlock's middle, at rest, world space */
  lock: TSL.uniform(new THREE.Vector3(0, 0.36, 0.38)),
  /** The shaft of light from the opening high above: how bright it is on what faces up under it */
  shaft: TSL.uniform(0.35),
  /** The magic circle cut into the dais: how much harder than at rest it glows (the hold, the burst) */
  circle: TSL.uniform(0),
  /** The key: how full of light its bulb is, and where the bulb is and how big (world space) */
  keyFill: TSL.uniform(0),
  keyBulb: TSL.uniform(new THREE.Vector3()),
  keyBulbR: TSL.uniform(0.026),
  /** The legendary egg: how hard the fire in its cracks burns */
  egg: TSL.uniform(1),
};

export type Part = { p: string; n: string; c: string; k: string; i: string; pivot: number[] };
type Models = Record<'body' | 'lid' | 'treasure' | 'dais' | 'coin' | 'gem' | 'key' | 'egg', Part> & {
  meta: { mouth: number[]; hinge: number[]; height: number };
};
export const MODELS = require('../../../assets/daily-drop/models.json') as Models;

const linear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

function bytes(b64: string) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

const cache = new Map<string, THREE.BufferGeometry>();

/** A part's geometry, its origin at its pivot (the lid's: its hinge) */
export function geometry(name: keyof Omit<Models, 'meta'>) {
  return decode(MODELS[name], name);
}

/** A packed part (models.json, burst.json) as a geometry, kept under `key` */
export function decode(part: Part, key: string) {
  const hit = cache.get(key);
  if (hit) return hit;
  const p = new Float32Array(bytes(part.p).buffer);
  const n8 = new Int8Array(bytes(part.n).buffer);
  const c8 = bytes(part.c);
  const k8 = bytes(part.k);
  const ib = bytes(part.i);
  const count = p.length / 3;
  const index = count < 65535 ? new Uint16Array(ib.buffer) : new Uint32Array(ib.buffer);
  const normal = new Float32Array(n8.length);
  for (let k = 0; k < n8.length; k++) normal[k] = n8[k] / 127;
  const colour = new Float32Array(c8.length);
  // Painted in sRGB: lit in linear
  for (let k = 0; k < c8.length; k++) colour[k] = linear(c8[k] / 255);
  const kind = new Float32Array(count);
  kind.set(k8);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  g.setAttribute('color', new THREE.BufferAttribute(colour, 3));
  g.setAttribute('kind', new THREE.BufferAttribute(kind, 1));
  g.setIndex(new THREE.BufferAttribute(index, 1));
  g.computeBoundingSphere();
  cache.set(key, g);
  return g;
}

// What a surface is made of (daily_drop_models.py)
const WOOD = 1;
const END = 2;
const GOLD = 3;
const IRON = 4;
const VELVET = 5;
const COIN = 6;
const GEM = 7;
const STONE = 8;
const RUNE = 9;
const GLOW = 10;

/** Toward the light from the opening high in the vault: warm, from above and a little in front, left */
const KEY = normalize(vec3(-0.32, 0.86, 0.5)) as unknown as V3;
export const KEY_C = hex('#FFE0B2');
/** The violet rim from behind, right */
const RIM = normalize(vec3(0.55, 0.32, -0.77)) as unknown as V3;
const RIM_C = hex('#8F7CFF');
const GOLDEN = hex('#FFC766');
/** The warm shaft of light from the opening high above */
export const SHAFT_C = hex('#FFD08A');

/**
 * The magic circle cut into the dais's top, glowing: a ring at its edge, a ring inside with ticks
 * turning round it, and in that, two squares turning against each other, an eight-pointed star.
 * Violet at rest. The hold turns it the colour of what's coming and fills the outer ring round from
 * the front to the back, both ways, as far as the hold's got; the burst flashes it (`look.circle`).
 */
function magicCircle(p: V3, n: V3, angle: F) {
  const r = length(p.xz);
  const t = TSL.time;
  const top = smoothstep(0.7, 0.95, n.y).mul(step(-0.01, p.y));
  const thin = (at: number, w: number) => exp(r.sub(at).div(w).pow(2).negate());
  // 0 at the front, 1 at the back, either way round
  const fromFront = abs(TSL.mod(angle.add(Math.PI / 2), Math.PI * 2).sub(Math.PI)).div(Math.PI);
  const filled = smoothstep(look.charge.add(0.015), look.charge.sub(0.015), fromFront).mul(step(0.01, look.charge));
  // Two comets of light chasing each other round the outer ring
  const comet = pow(
    cos(angle.sub(t.mul(1.1)))
      .mul(0.5)
      .add(0.5),
    40
  )
    .add(
      pow(
        cos(angle.sub(t.mul(1.1)).add(Math.PI))
          .mul(0.5)
          .add(0.5),
        40
      )
    )
    .mul(1.6);
  const outer = thin(0.905, 0.0045).mul(float(0.45).add(filled.mul(2.2)).add(comet));
  const inner = thin(0.66, 0.004).add(thin(0.6, 0.0025).mul(0.6));
  const ticks = smoothstep(0.9, 0.98, cos(angle.add(t.mul(0.12)).mul(48)))
    .mul(smoothstep(0.668, 0.672, r))
    .mul(smoothstep(0.725, 0.721, r));
  const square = (phase: F) => {
    const a = TSL.mod(angle.sub(phase), Math.PI / 2).sub(Math.PI / 4);
    return exp(
      r
        .mul(cos(a))
        .sub(0.6 * Math.cos(Math.PI / 4))
        .div(0.0035)
        .pow(2)
        .negate()
    );
  };
  const turn = t.mul(0.07) as unknown as F;
  const star = square(turn)
    .add(square(turn.add(Math.PI / 4) as unknown as F))
    .mul(step(r, 0.6));
  const colour = mix(hex('#9B6BFF'), look.rarity as unknown as V3, look.charge);
  const breathe = sin(t.mul(2.4)).mul(0.15).add(0.85);
  const lines = outer.add(inner.mul(0.6)).add(ticks.mul(0.5)).add(star.mul(0.75));
  return colour.mul(
    lines
      .mul(top)
      .mul(breathe)
      .mul(float(1.15).add(look.charge.mul(1.2)).add(look.circle))
  ) as unknown as V3;
}

/** What a mirror sees in the vault: dark violet stone, the warm shaft from above, lamplight off to the left, violet behind */
export function vault(r: V3) {
  const up = saturate(r.y.mul(0.5).add(0.5));
  const base = mix(hex('#120A20'), hex('#3A2A60'), up);
  const shaft = pow(saturate(dot(r, normalize(vec3(-0.1, 1, 0.3)))), 24).mul(1.5);
  const lamp = pow(saturate(dot(r, normalize(vec3(-0.85, 0.15, 0.5)))), 6).mul(0.7);
  const behind = pow(saturate(dot(r, normalize(vec3(0.7, 0.25, -0.65)))), 5).mul(0.9);
  return base.add(hex('#FFD7A0').mul(shaft)).add(hex('#FFAE62').mul(lamp)).add(RIM_C.mul(behind)) as unknown as V3;
}

/**
 * A surface for the chest's stuff. `gemTint`: the loose gems, coloured one of three by which one
 * they are (an InstancedMesh)
 */
export function surface(o: { gemTint?: boolean } = {}) {
  const m = new THREE.MeshBasicNodeMaterial();
  const kind = TSL.attribute('kind', 'float') as unknown as F;
  const is = (k: number) => step(abs(kind.sub(k)), 0.5) as unknown as F;
  let albedo = TSL.attribute('color', 'vec3') as unknown as V3;
  if (o.gemTint) {
    const h = TSL.hash(TSL.instanceIndex.toFloat().add(3));
    albedo = mix(mix(hex('#E02E66'), hex('#8A4DFF'), step(0.33, h)), hex('#35D0FF'), step(0.66, h)) as unknown as V3;
  }
  const p = TSL.positionWorld as unknown as V3;
  const n = normalize(TSL.normalWorld) as unknown as V3;
  const v = normalize(TSL.cameraPosition.sub(p)) as unknown as V3;
  const ndv = saturate(dot(n, v));
  const r = reflect(v.negate(), n) as unknown as V3;
  const env = vault(r);

  // ---- Light from outside ----
  const key = saturate(dot(n, KEY).mul(0.8).add(0.2));
  const fill = mix(hex('#170F2C'), hex('#3D3070'), n.y.mul(0.5).add(0.5));
  const rim = pow(float(1).sub(ndv), 2.5).mul(saturate(dot(n, RIM).add(0.35)));
  const half = normalize(KEY.add(v));
  const spec = (shine: number) => pow(saturate(dot(n, half)), shine);

  // ---- Light from inside ----
  const rarity = look.rarity as unknown as V3;
  // Round the lid while it's held shut: a glow hugging the seam, whatever way a surface faces
  const seam = look.seam as unknown as V3;
  const out = vec3(max(abs(p.x).sub(seam.y), 0), p.y.sub(seam.x), max(abs(p.z).sub(seam.z), 0));
  const near = length(out);
  const leak = rarity.mul(exp(near.mul(near).mul(-260)).mul(look.leak).mul(1.7));
  // Once it's open: the treasure lights what faces it, the lid's underside and the dais round it
  const toMouth = (look.mouth as unknown as V3).sub(p);
  const d2 = dot(toMouth, toMouth);
  const warm = mix(GOLDEN, rarity, 0.45);
  const treasure = warm.mul(
    saturate(dot(n, normalize(toMouth)).mul(0.7).add(0.3))
      .mul(look.open)
      .mul(float(2.4).div(d2.mul(5).add(1)))
  );

  // The shaft of light from the opening above: on whatever faces up under it, warm, taking on the
  // colour of the hold as it goes
  const pool = smoothstep(1.05, 0.25, length(p.xz)).mul(saturate(n.y)).mul(look.shaft);
  const shaft = mix(SHAFT_C, rarity, look.charge.mul(0.6)).mul(pool.mul(1.5));

  const lit = KEY_C.mul(key.mul(1.05))
    .add(fill.mul(0.85))
    .add(RIM_C.mul(rim.mul(1.2)))
    .add(treasure)
    .add(shaft) as unknown as V3;

  // ---- Each kind of stuff ----
  const oak = albedo
    .mul(lit)
    .add(KEY_C.mul(spec(28).mul(0.07)))
    // The light round the seam: partly its own colour (so blue light on oak reads blue, not green)
    .add(leak.mul(0.45))
    .add(albedo.mul(leak).mul(0.6));
  const sweep = exp(p.x.mul(0.55).add(p.y).sub(look.glint).mul(22).pow(2).negate()).mul(pow(ndv, 1.5)).mul(0.55);
  const metal = albedo
    .mul(env.mul(1.25).add(lit.mul(0.18)))
    .add(mix(albedo, vec3(1, 1, 1), 0.4).mul(spec(90).mul(1.7)))
    .add(mix(albedo, vec3(1, 1, 1), 0.35).mul(sweep))
    .add(leak.mul(0.6))
    .add(albedo.mul(leak))
    .add(albedo.mul(treasure).mul(0.6));
  const iron = albedo.mul(lit).mul(0.7).add(env.mul(0.12));
  const velvet = albedo
    .mul(lit)
    .add(albedo.mul(pow(float(1).sub(ndv), 3).mul(1.6)))
    .add(leak.mul(0.35))
    .add(albedo.mul(leak).mul(0.6));
  const cell = TSL.floor(p.mul(150));
  const twinkle = step(
    0.986,
    TSL.fract(TSL.hash(cell.x.add(cell.y.mul(57)).add(cell.z.mul(113))).add(TSL.time.mul(0.35)))
  );
  const gem = albedo
    .mul(lit.mul(0.3).add(env.mul(0.9)))
    .add(vec3(1, 1, 1).mul(pow(float(1).sub(ndv), 3).mul(0.55)))
    .add(vec3(1, 1, 1).mul(twinkle.mul(2.2)))
    .add(albedo.mul(float(0.35).add(look.charge.mul(0.9)).add(look.open.mul(0.8))));
  const angle = TSL.atan(p.z, p.x);
  const stone = albedo
    .mul(lit)
    .add(KEY_C.mul(spec(22).mul(0.035)))
    .add(hex('#8E63FF').mul(exp(length(p.xz).sub(0.8).div(0.09).pow(2).negate()).mul(0.12)))
    .add(magicCircle(p, n, angle));
  // The runes: a wave of light running round them, in the colour of the hold as it goes
  const rune = mix(hex('#B98CFF'), rarity, look.charge.mul(0.8)).mul(
    float(1.3)
      .add(sin(TSL.time.mul(2.2).add(angle.mul(3))).mul(0.5))
      .mul(float(1).add(look.charge.mul(2.2)).add(look.open.mul(1.2)).add(look.circle.mul(1.5)))
  );
  const glow = rarity.mul(look.leak.mul(9).add(look.open.mul(1.8))).add(albedo.mul(0.15));
  const plain = albedo.mul(lit);

  const colour = plain
    .mul(is(0))
    .add(oak.mul(is(WOOD).add(is(END))))
    .add(metal.mul(is(GOLD).add(is(COIN))))
    .add(iron.mul(is(IRON)))
    .add(velvet.mul(is(VELVET)))
    .add(gem.mul(is(GEM)))
    .add(stone.mul(is(STONE)))
    .add(rune.mul(is(RUNE)))
    .add(glow.mul(is(GLOW))) as unknown as V3;
  // Cards up: everything but what glows steps back
  const keepsLit = is(RUNE).add(is(GLOW)).add(is(GEM).mul(0.5));
  m.colorNode = colour.mul(mix(float(1), float(0.42), look.focus.mul(float(1).sub(keepsLit)))) as unknown as V3;
  return m;
}

// What the seal's made of (daily_drop_burst.py)
const CHAIN = 11;
const LOCK = 12;
const SHARD = 13;

/**
 * The seal's surface: dark iron and gold and bright steel, lit like the chest. `along`, for the
 * chain's links (an InstancedMesh): how far each is along the chains from the padlock, for the glow
 * that runs out from it as the hold goes on. `rest` and `planes`, for a piece of the padlock: where it
 * sits at rest and the planes it'll break along (a point on each, the way out), for the cracks of
 * light that spread over it from its middle. Once it's broken, what's broken glows with `look.heat`.
 */
export function seal(o: { along?: THREE.InstancedBufferAttribute; rest?: THREE.Vector3; planes?: number[][] }) {
  const m = new THREE.MeshBasicNodeMaterial();
  const kind = TSL.attribute('kind', 'float') as unknown as F;
  const is = (k: number) => step(abs(kind.sub(k)), 0.5) as unknown as F;
  const albedo = TSL.attribute('color', 'vec3') as unknown as V3;
  const p = TSL.positionWorld as unknown as V3;
  const n = normalize(TSL.normalWorld) as unknown as V3;
  const v = normalize(TSL.cameraPosition.sub(p)) as unknown as V3;
  const ndv = saturate(dot(n, v));
  const env = vault(reflect(v.negate(), n) as unknown as V3);
  const key = saturate(dot(n, KEY).mul(0.8).add(0.2));
  const fill = mix(hex('#170F2C'), hex('#3D3070'), n.y.mul(0.5).add(0.5));
  const rim = pow(float(1).sub(ndv), 2.5).mul(saturate(dot(n, RIM).add(0.35)));
  const half = normalize(KEY.add(v));
  const spec = (shine: number) => pow(saturate(dot(n, half)), shine);
  const lit = KEY_C.mul(key.mul(1.05))
    .add(fill.mul(0.85))
    .add(RIM_C.mul(rim.mul(1.2))) as unknown as V3;
  const rarity = look.rarity as unknown as V3;

  // Iron, a dark sheen on it; gold that mirrors the vault; bright steel
  const iron = albedo
    .mul(env.mul(0.85).add(lit.mul(0.4)))
    .add(hex('#FFE9CF').mul(spec(70).mul(0.6)))
    .add(RIM_C.mul(rim.mul(0.45)));
  const gold = albedo.mul(env.mul(1.25).add(lit.mul(0.18))).add(mix(albedo, vec3(1, 1, 1), 0.4).mul(spec(90).mul(1.7)));
  const steel = albedo.mul(env.mul(1.1).add(lit.mul(0.25))).add(vec3(1, 1, 1).mul(spec(120).mul(1.4)));

  // The glow in it, as far as it's got
  let glow = float(0) as unknown as F;
  if (o.along) {
    const d = TSL.instancedBufferAttribute(o.along) as unknown as F;
    const reach = look.charge.mul(2.1);
    const flicker = sin(TSL.time.mul(17).add(d.mul(23)))
      .mul(0.25)
      .add(0.75);
    glow = smoothstep(reach, reach.sub(0.4), d).mul(pow(look.charge, 1.4)).mul(flicker).mul(1.6) as unknown as F;
  }
  if (o.rest && o.planes) {
    const at = TSL.positionLocal.add(vec3(o.rest.x, o.rest.y, o.rest.z)) as unknown as V3;
    // Jagged: the line wanders a little either side of the plane
    const wander = TSL.mx_noise_float(at.mul(70)).mul(0.0035);
    let crack = float(0) as unknown as F;
    for (const [ox, oy, oz, nx, ny, nz] of o.planes) {
      const d = abs(dot(at.sub(vec3(ox, oy, oz)), vec3(nx, ny, nz)).add(wander));
      crack = max(crack, exp(d.div(0.0024).pow(2).negate())) as unknown as F;
    }
    // Spreading out from the padlock's middle as the hold goes on
    const reach = look.charge.mul(0.15).add(0.003);
    const grown = smoothstep(reach, reach.sub(0.025), length(at.sub(look.lock as unknown as V3)));
    const flicker = TSL.mx_noise_float(vec3(at.x.mul(40), at.y.mul(40), TSL.time.mul(6)))
      .mul(0.35)
      .add(0.8);
    glow = crack.mul(grown.mul(look.charge.mul(5).add(0.5)).add(look.heat.mul(4))).mul(flicker) as unknown as F;
  }
  // Broken open: white hot, cooling through the colour of what's inside
  const shard = mix(rarity, vec3(1, 0.95, 0.85), look.heat.mul(0.5))
    .mul(look.heat.mul(2.6).add(look.charge.mul(0.6)))
    .add(albedo.mul(0.05));

  const colour = iron
    .mul(is(CHAIN).add(is(LOCK)))
    .add(gold.mul(is(GOLD)))
    .add(steel.mul(is(IRON)))
    .add(shard.mul(is(SHARD)))
    .add(rarity.mul(glow.mul(float(1).sub(is(SHARD))).mul(2.2)))
    // Still warm, a while after it's broken
    .add(rarity.mul(look.heat.mul(0.35).mul(is(CHAIN).add(is(LOCK))))) as unknown as V3;
  m.colorNode = colour.mul(mix(float(1), float(0.5), look.focus)) as unknown as V3;
  return m;
}

// The key's bulb and the egg's shell (daily_drop_models.py)
const BULB = 14;
const SHELL = 15;

/** The vault's light on a surface, as the chest's is lit: for the key and the egg */
export function lighting() {
  const p = TSL.positionWorld as unknown as V3;
  const n = normalize(TSL.normalWorld) as unknown as V3;
  const v = normalize(TSL.cameraPosition.sub(p)) as unknown as V3;
  const ndv = saturate(dot(n, v));
  const env = vault(reflect(v.negate(), n) as unknown as V3);
  const key = saturate(dot(n, KEY).mul(0.8).add(0.2));
  const fill = mix(hex('#170F2C'), hex('#3D3070'), n.y.mul(0.5).add(0.5));
  const rim = pow(float(1).sub(ndv), 2.5).mul(saturate(dot(n, RIM).add(0.35)));
  const half = normalize(KEY.add(v));
  const spec = (shine: number) => pow(saturate(dot(n, half)), shine);
  const lit = KEY_C.mul(key.mul(1.05))
    .add(fill.mul(0.85))
    .add(RIM_C.mul(rim.mul(1.2))) as unknown as V3;
  return { p, ndv, env, lit, spec };
}

/**
 * The key: gold, a ruby in each loop round its bow, and in the bow a glass bulb that fills with
 * light as it's held, the colour of what's coming (`look.keyFill`). The light's level is level in
 * the world, so it stays level as the key turns, a wave running round it. The fuller the bulb, the
 * hotter the gold glows at its edges.
 */
export function keyMaterial() {
  const m = new THREE.MeshBasicNodeMaterial();
  const kind = TSL.attribute('kind', 'float') as unknown as F;
  const is = (k: number) => step(abs(kind.sub(k)), 0.5) as unknown as F;
  const albedo = TSL.attribute('color', 'vec3') as unknown as V3;
  const { p, ndv, env, lit, spec } = lighting();
  const rarity = look.rarity as unknown as V3;
  const fill = look.keyFill;
  const t = TSL.time;
  const gold = albedo
    .mul(env.mul(1.25).add(lit.mul(0.2)))
    .add(mix(albedo, vec3(1, 1, 1), 0.4).mul(spec(90).mul(1.8)))
    .add(rarity.mul(pow(float(1).sub(ndv), 2).mul(fill.mul(1.6))));
  const ruby = albedo.mul(lit.mul(0.3).add(env.mul(0.9))).add(albedo.mul(float(0.5).add(fill.mul(1.5))));
  // The bulb
  const toC = p.sub(look.keyBulb as unknown as V3);
  const R = look.keyBulbR;
  const level = fill
    .mul(2)
    .sub(1)
    .mul(R)
    .add(
      sin(TSL.atan(toC.z, toC.x).mul(3).add(t.mul(6)))
        .mul(R.mul(0.09))
        .mul(sin(fill.mul(Math.PI)))
    );
  const wet = smoothstep(level.add(R.mul(0.04)), level.sub(R.mul(0.04)), toC.y);
  const heart = exp(length(toC).div(R).pow(2).mul(-1.5));
  const liquid = rarity.mul(float(0.7).add(heart.mul(1.4))).mul(sin(t.mul(9)).mul(0.08).add(1));
  const glass = env.mul(0.45).add(vec3(0.08, 0.06, 0.12));
  const meniscus = exp(toC.y.sub(level).div(R.mul(0.06)).pow(2).negate()).mul(step(0.02, fill));
  const bulb = mix(glass, liquid, wet)
    .add(vec3(1, 0.97, 0.9).mul(pow(float(1).sub(ndv), 3).mul(0.9).add(spec(140).mul(2))))
    .add(mix(rarity, vec3(1, 1, 1), 0.5).mul(meniscus.mul(0.9)));
  m.colorNode = gold
    .mul(is(GOLD))
    .add(ruby.mul(is(GEM)))
    .add(bulb.mul(is(BULB))) as unknown as V3;
  return m;
}

/**
 * The legendary egg: a dark, glossy shell, cracked all over with fire that beats like a heart
 * (`look.egg`), in its own space so the cracks turn with it; a warm rim round it; its gold cage; the
 * amber gems in it, glittering.
 */
export function eggMaterial(o: { shards?: boolean } = {}) {
  // Its pieces, once it's hatched: both sides drawn, the cracks where they were on the whole egg
  // (`rest`), the inside of the shell molten
  const m = new THREE.MeshBasicNodeMaterial({ side: o.shards ? THREE.DoubleSide : THREE.FrontSide });
  const kind = TSL.attribute('kind', 'float') as unknown as F;
  const is = (k: number) => step(abs(kind.sub(k)), 0.5) as unknown as F;
  const albedo = TSL.attribute('color', 'vec3') as unknown as V3;
  const { p, ndv, env, lit, spec } = lighting();
  const t = TSL.time;
  const q = (o.shards ? TSL.attribute('rest', 'vec3') : TSL.positionLocal).mul(13) as unknown as V3;
  const big = TSL.mx_worley_noise_vec2(q);
  const fine = TSL.mx_worley_noise_vec2(q.mul(2.3).add(7));
  const edge = sqrt(big.y).sub(sqrt(big.x));
  const crack = smoothstep(0.07, 0, edge).add(smoothstep(0.05, 0, sqrt(fine.y).sub(sqrt(fine.x))).mul(0.5));
  const warm = smoothstep(0.32, 0, edge);
  const beat = pow(sin(t.mul(2.6)).mul(0.5).add(0.5), 3)
    .mul(0.6)
    .add(0.55);
  const fire = mix(hex('#FF4A12'), hex('#FFD27A'), crack.mul(0.6))
    .mul(crack.mul(2.2).add(warm.mul(0.35)))
    .mul(beat)
    .mul(look.egg);
  const shell = albedo
    .mul(lit.mul(0.55))
    .add(env.mul(0.32))
    .add(vec3(1, 0.85, 0.7).mul(spec(70).mul(0.9)))
    .add(hex('#FF7A3A').mul(pow(float(1).sub(ndv), 3).mul(0.8)))
    .add(fire);
  const gold = albedo
    .mul(env.mul(1.25).add(lit.mul(0.2)))
    .add(mix(albedo, vec3(1, 1, 1), 0.4).mul(spec(90).mul(1.8)))
    .add(hex('#FFB347').mul(pow(float(1).sub(ndv), 3).mul(0.5)));
  const cell = TSL.floor(p.mul(260));
  const glitter = step(0.97, TSL.fract(TSL.hash(cell.x.add(cell.y.mul(57)).add(cell.z.mul(113))).add(t.mul(0.5))));
  const amber = albedo
    .mul(lit.mul(0.3).add(env.mul(0.8)))
    .add(albedo.mul(1.3))
    .add(vec3(1, 1, 1).mul(glitter.mul(2)));
  const outside = shell
    .mul(is(SHELL))
    .add(gold.mul(is(GOLD)))
    .add(amber.mul(is(GEM))) as unknown as V3;
  m.colorNode = (o.shards
    ? mix(hex('#FF8A2A').mul(look.heat.mul(1.1).add(0.3)).add(fire.mul(0.35)), outside, TSL.frontFacing.toFloat())
    : outside) as unknown as V3;
  return m;
}

/** A soft round shadow under the dais, on the vault's floor */
export function contactShadow() {
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  const r = length(TSL.uv().sub(0.5)).mul(2);
  m.colorNode = vec3(0.01, 0.0, 0.02);
  m.opacityNode = smoothstep(1, 0.45, r).mul(0.75);
  return m;
}
