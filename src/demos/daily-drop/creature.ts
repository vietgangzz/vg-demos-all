import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as TSL from 'three/tsl';
import * as THREE from 'three/webgpu';

import { hex, KEY_C, lighting, type F, type V3 } from './models';

/**
 * Ember Drake, alive: Quaternius's rigged, animated baby dragon (CC0, assets/daily-drop/creature),
 * recoloured in embers. Its scales get the vault's light, a warm sheen at its edges; its wings and
 * belly glow through like coals; the end of its tail burns (how much each vertex burns comes from
 * how much the tail's last bones move it), the fire flickering up it; its eyes catch the light.
 * While it's coming into being it burns in from the bottom up (`reveal`).
 *
 * Its animations (Flying_Idle, Fast_Flying, Yes, No, Headbutt, Punch, HitReact, Death) play
 * through `play`, cross-faded. It's 1 across, centred on its origin, facing +z.
 */

const { vec3, float, mix, pow, saturate, smoothstep, exp, step, sin } = TSL;

const DATA = require('../../../assets/daily-drop/creature/dragon.json') as { glb: string };

/** What burns, and how hard, by bone */
const BURNS: Record<string, number> = { Body3: 0.3, Body4: 1 };

/** Its mouth, in the mesh's own space (x across, z up, -y forward) */
const MOUTH = new THREE.Vector3(0, -0.009, 0.0182);

/** The tip of its tail, in the mesh's own space: the burning vertex furthest back */
function tailTip(body: THREE.SkinnedMesh | undefined) {
  const out = new THREE.Vector3();
  if (!body) return out;
  const p = body.geometry.getAttribute('position');
  const f = body.geometry.getAttribute('flame');
  let best = -Infinity;
  for (let i = 0; i < p.count; i++) {
    if ((f?.getX(i) ?? 0) < 0.8 || p.getY(i) <= best) continue;
    best = p.getY(i);
    out.set(p.getX(i), p.getY(i), p.getZ(i));
  }
  return out;
}

export type Creature = Awaited<ReturnType<typeof loadCreature>>;

function bytes(b64: string) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out.buffer;
}

export async function loadCreature() {
  const gltf = await new Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }>((resolve, reject) =>
    new GLTFLoader().parse(bytes(DATA.glb), '', resolve as never, reject)
  );

  // Centred on the origin, 1 across, facing +z
  const model = gltf.scene;
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model, true);
  const size = box.getSize(new THREE.Vector3());
  const across = Math.max(size.x, size.y, size.z);
  const pivot = new THREE.Group();
  pivot.add(model);
  model.position.copy(box.getCenter(new THREE.Vector3()).negate());
  pivot.scale.setScalar(1 / across);
  const root = new THREE.Group();
  root.add(pivot);

  const reveal = TSL.uniform(1);
  const base = TSL.uniform(0);
  const height = TSL.uniform(0.6);
  fierce(model);
  model.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh) return;
    m.frustumCulled = false;
    // How much each vertex burns: the weight of the burning bones on it
    const burn = m.skeleton.bones.map((b) => BURNS[b.name] ?? 0);
    const index = m.geometry.getAttribute('skinIndex');
    const weight = m.geometry.getAttribute('skinWeight');
    const flame = new Float32Array(index.count);
    for (let i = 0; i < index.count; i++) {
      let f = 0;
      for (let k = 0; k < 4; k++) f += (burn[index.getComponent(i, k)] ?? 0) * weight.getComponent(i, k);
      flame[i] = Math.min(1, f);
    }
    m.geometry.setAttribute('flame', new THREE.BufferAttribute(flame, 1));
    const name = (Array.isArray(m.material) ? m.material[0] : m.material).name;
    m.material = coat(name, reveal, base, height);
  });

  const mixer = new THREE.AnimationMixer(model);
  const clips = new Map(gltf.animations.map((c) => [c.name.split('|').pop()!, mixer.clipAction(c)] as const));
  let current: THREE.AnimationAction | null = null;

  /** Play an animation, cross-fading from what was playing; once (holding its end) or looping */
  function play(name: string, o: { once?: boolean; fade?: number; speed?: number } = {}) {
    const next = clips.get(name);
    if (!next) return 0;
    next.reset();
    next.setLoop(o.once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    next.clampWhenFinished = !!o.once;
    next.timeScale = o.speed ?? 1;
    next.play();
    if (current && current !== next) current.crossFadeTo(next, o.fade ?? 0.25, false);
    current = next;
    return next.getClip().duration / (o.speed ?? 1);
  }

  // Points carried on its bones (its mouth, the tip of its tail), found in the mesh's own space and
  // moved the way the skinning moves the mesh. (This rig's bones aren't where the mesh shows: the
  // mesh is scaled up a hundred times over them, so a bone's own position won't do.)
  const body = model.getObjectByProperty('isSkinnedMesh', true) as THREE.SkinnedMesh | undefined;
  const bonesOf = body?.skeleton.bones ?? [];
  const pin = (name: string, at: THREE.Vector3) => ({ bone: bonesOf.findIndex((b) => b.name === name), at });
  const mouth = pin('Head', MOUTH);
  const back = pin('Head', MOUTH.clone().add(new THREE.Vector3(0, 0.006, 0.002)));
  const tail = pin('Body4', tailTip(body));
  const m4 = new THREE.Matrix4();
  function place(p: { bone: number; at: THREE.Vector3 }, out: THREE.Vector3) {
    if (!body || p.bone < 0) return out.setFromMatrixPosition(root.matrixWorld);
    const s = body.skeleton;
    m4.multiplyMatrices(s.bones[p.bone].matrixWorld, s.boneInverses[p.bone]);
    return out
      .copy(p.at)
      .applyMatrix4(body.bindMatrix)
      .applyMatrix4(m4)
      .applyMatrix4(body.bindMatrixInverse)
      .applyMatrix4(body.matrixWorld);
  }
  /** Where its fire is (the tip of its tail), world space */
  function flames(out: THREE.Vector3[]) {
    root.updateMatrixWorld(true);
    out[0] = place(tail, out[0] ?? new THREE.Vector3());
    return out.slice(0, 1);
  }
  const behind = new THREE.Vector3();
  /** Where its mouth is, and which way it opens (from the back of its head through it), world space */
  function mouthAt(out: THREE.Vector3, facing: THREE.Vector3) {
    root.updateMatrixWorld(true);
    place(mouth, out);
    place(back, behind);
    return facing.subVectors(out, behind).normalize();
  }

  return { root, mixer, play, flames, mouthAt, reveal, base, height, names: [...clips.keys()] };
}

/**
 * Its eyes made fierce. The model's own "pupil" is a thin dark sliver across the middle of each eye,
 * which makes it look sleepy: instead each eye (its white and the sliver) is given where it is round
 * the eye's middle (`eye`: across toward the nose, up, each over half the eye's size), so its surface
 * can draw a slit pupil, an amber iris and an angry brow cutting down across it toward the nose.
 * (The mesh's own space: x across, z up, -y forward.)
 */
function fierce(model: THREE.Object3D) {
  let whites: THREE.BufferGeometry | null = null;
  let sliver: THREE.BufferGeometry | null = null;
  model.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const name = (Array.isArray(m.material) ? m.material[0] : m.material).name;
    if (name === 'Eye_Black') sliver = m.geometry;
    if (name === 'Eye_White') whites = m.geometry;
  });
  if (!whites || !sliver) return;
  // Where the model looks out of each eye: the middle of its sliver
  const s = (sliver as THREE.BufferGeometry).getAttribute('position') as THREE.BufferAttribute;
  const look = [new THREE.Vector2(), new THREE.Vector2()];
  const n = [0, 0];
  for (let i = 0; i < s.count; i++) {
    const side = s.getX(i) < 0 ? 0 : 1;
    look[side].add(new THREE.Vector2(s.getX(i), s.getZ(i)));
    n[side]++;
  }
  look.forEach((c, k) => c.divideScalar(Math.max(1, n[k])));
  const w = (whites as THREE.BufferGeometry).getAttribute('position') as THREE.BufferAttribute;
  // Each eye's box
  const lo = [new THREE.Vector2(Infinity, Infinity), new THREE.Vector2(Infinity, Infinity)];
  const hi = [new THREE.Vector2(-Infinity, -Infinity), new THREE.Vector2(-Infinity, -Infinity)];
  for (let i = 0; i < w.count; i++) {
    const side = w.getX(i) < 0 ? 0 : 1;
    lo[side].min(new THREE.Vector2(w.getX(i), w.getZ(i)));
    hi[side].max(new THREE.Vector2(w.getX(i), w.getZ(i)));
  }
  // (The sliver sits in a gap in the white: it's drawn as the same eye, so the gap's filled)
  for (const g of [whites as THREE.BufferGeometry, sliver as THREE.BufferGeometry]) {
    const at = g.getAttribute('position') as THREE.BufferAttribute;
    const eye = new Float32Array(at.count * 2);
    for (let i = 0; i < at.count; i++) {
      const side = at.getX(i) < 0 ? 0 : 1;
      const cx = look[side].x;
      const cz = look[side].y;
      const rx = Math.max(1e-6, (hi[side].x - lo[side].x) / 2);
      const rz = Math.max(1e-6, (hi[side].y - lo[side].y) / 2);
      // (Toward the nose is toward x = 0)
      eye[i * 2] = ((cx - at.getX(i)) * Math.sign(cx || 1)) / rx;
      eye[i * 2 + 1] = (at.getZ(i) - cz) / rz;
    }
    g.setAttribute('eye', new THREE.BufferAttribute(eye, 2));
  }
}

/** A surface for one of its materials (by the name it came with) */
function coat(name: string, reveal: F, base: F, height: F) {
  const m = new THREE.MeshBasicNodeMaterial();
  m.alphaTest = 0.5;
  const t = TSL.time;
  const world = TSL.positionWorld as unknown as V3;
  const { ndv, lit, spec } = lighting();
  const flame = TSL.attribute('flame', 'float') as unknown as F;
  const rim = pow(float(1).sub(ndv), 3);

  let colour: V3;
  if (name === 'Eye_White' || name === 'Eye_Black') {
    // A burning amber iris, white gold round the pupil to deep orange at its edge; a thin slit; an
    // angry brow of scales cutting down across it toward the nose, a dark line along its edge
    const e = TSL.attribute('eye', 'vec2') as unknown as THREE.Node<'vec2'>;
    const d = TSL.length(e);
    const iris = mix(
      mix(hex('#FFF0A0'), hex('#FFB21E'), smoothstep(0.05, 0.45, d)),
      hex('#C2380A'),
      smoothstep(0.5, 1, d)
    )
      .mul(1.7)
      .add(vec3(1, 1, 1).mul(spec(220).mul(2.5)));
    // The slit: narrow, pointed top and bottom, a red-black rim round it
    const half = float(0.085).mul(float(1).sub(e.y.mul(e.y)).max(0));
    const across = TSL.abs(e.x);
    const slit = smoothstep(half.add(0.05), half, across);
    const ring = smoothstep(half.add(0.16), half.add(0.04), across).sub(slit).max(0);
    const eyeball = mix(iris.mul(float(1).sub(ring.mul(0.55))), hex('#0E0402'), slit).add(
      vec3(1, 1, 1).mul(spec(220).mul(2.5))
    );
    const browAt = e.y.add(e.x.mul(0.7)).sub(0.12);
    const brow = smoothstep(-0.03, 0.03, browAt);
    const edge = exp(browAt.div(0.07).pow(2).negate());
    const scales = hex('#8E260A').mul(lit.mul(0.9).add(0.1));
    colour = mix(eyeball, scales, brow).mul(float(1).sub(edge.mul(0.85))) as unknown as V3;
  } else if (name === 'Dragon_Horn') {
    // Polished gold-ivory horns
    const horn = hex('#F2D9A6');
    colour = horn
      .mul(lit.mul(0.9).add(0.15))
      .add(KEY_C.mul(spec(60).mul(0.6)))
      .add(hex('#FFC66B').mul(rim.mul(0.5))) as unknown as V3;
  } else {
    const membrane = name === 'Dragon_Secondary';
    const albedo = membrane ? hex('#FF9A2E') : hex('#D8431A');
    const scales = TSL.mx_noise_float(TSL.positionLocal.mul(vec3(900, 900, 900)))
      .mul(0.06)
      .add(0.97);
    const skin = albedo
      .mul(lit.mul(1.0).add(0.1))
      .mul(scales)
      .add(hex('#FFB061').mul(rim.mul(0.7)))
      .add(KEY_C.mul(spec(40).mul(0.12)));
    // Wings and belly: lit from inside like coals, breathing
    const glow = membrane
      ? hex('#FF7A1A').mul(
          pow(ndv, 0.6)
            .mul(0.35)
            .add(0.2)
            .mul(sin(t.mul(2.2)).mul(0.15).add(0.85))
        )
      : vec3(0, 0, 0);
    // The fire on its tail: deep orange through gold to white hot, flickering up
    const flicker = TSL.mx_noise_float(world.mul(vec3(30, 16, 30)).sub(vec3(0, t.mul(4.5), 0)))
      .mul(0.5)
      .add(0.5);
    const heat = flame.mul(flicker.mul(0.7).add(0.45));
    const fire = mix(
      mix(hex('#FF5A12'), hex('#FFB347'), smoothstep(0.1, 0.5, heat)),
      hex('#FFF4C8'),
      smoothstep(0.6, 1, heat)
    ).mul(heat.mul(2.4).add(1));
    colour = mix(skin.add(glow), fire, smoothstep(0.1, 0.55, flame)) as unknown as V3;
  }
  // Burning in from the bottom up
  const grain = TSL.mx_noise_float(world.mul(40)).mul(0.5).add(0.5);
  const d = saturate(world.y.sub(base).div(height)).mul(0.82).add(grain.mul(0.18));
  const front = reveal.mul(1.2).sub(0.1);
  const edge = exp(front.sub(d).div(0.03).pow(2).negate()).mul(step(reveal, 0.999));
  m.colorNode = colour.add(mix(hex('#FF7A1A'), hex('#FFF6D8'), edge).mul(edge.mul(4))) as unknown as V3;
  m.opacityNode = step(d, front) as unknown as F;
  return m;
}
