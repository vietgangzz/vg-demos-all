import * as TSL from 'three/tsl';
import * as THREE from 'three/webgpu';

import { display } from './baked';
import type { V3 } from './light';

/**
 * Glowing things that always face the camera: the stardust off the runners, the sparkle over
 * every town still waiting, the burst when a present goes down a chimney, Rudolph's nose.
 *
 * One instanced quad for all of them. Positions are in world space, written from the CPU each
 * frame; a sprite with size 0 isn't drawn.
 */

const { vec2, float, mix, exp, abs, uv, sin, cos, max } = TSL;

export type Sprites = {
  mesh: THREE.InstancedMesh;
  set: (i: number, at: THREE.Vector3, size: number, colour: THREE.Color, star: number, spin: number) => void;
  hide: (i: number) => void;
  flush: () => void;
  capacity: number;
};

/**
 * `linear`: colours in linear light, mapped to the screen's here (the baked scenes' glow, drawn
 * into the globe's scene). The mesh may sit in a moved, turned and scaled frame (a town on the
 * globe): positions and sizes are then in that frame's units.
 */
export function sprites(capacity: number, linear = false, alpha = false): Sprites {
  const a = new Float32Array(capacity * 4);
  const b = new Float32Array(capacity * 4);
  const geometry = new THREE.PlaneGeometry(1, 1);
  const attrA = new THREE.InstancedBufferAttribute(a, 4);
  const attrB = new THREE.InstancedBufferAttribute(b, 4);
  attrA.setUsage(THREE.DynamicDrawUsage);
  attrB.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('spriteA', attrA);
  geometry.setAttribute('spriteB', attrB);
  // Glow adds light; `alpha` sprites are stuff, snow powder, soot, drawn over what's behind
  const material = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: alpha ? THREE.NormalBlending : THREE.AdditiveBlending,
  });
  const sa = TSL.attribute('spriteA', 'vec4');
  const sb = TSL.attribute('spriteB', 'vec4');
  const view = TSL.cameraViewMatrix as unknown as { element: (i: number) => THREE.Node<'vec4'> };
  // The camera's right and up, brought into the mesh's own frame
  const toLocal = (d: THREE.Node<'vec3'>) => TSL.normalize(TSL.modelWorldMatrixInverse.mul(TSL.vec4(d, 0)).xyz);
  const right = toLocal(TSL.vec3(view.element(0).x, view.element(1).x, view.element(2).x));
  const up = toLocal(TSL.vec3(view.element(0).y, view.element(1).y, view.element(2).y));
  const g = TSL.positionGeometry;
  material.positionNode = sa.xyz.add(right.mul(g.x.mul(sa.w))).add(up.mul(g.y.mul(sa.w)));
  // b: colour, then star-ness and spin packed together (spin in the whole part)
  const starness = TSL.fract(sb.w);
  const spin = sb.w.floor().mul(0.01);
  const q0 = uv().sub(0.5).mul(2);
  const q = vec2(q0.x.mul(cos(spin)).sub(q0.y.mul(sin(spin))), q0.x.mul(sin(spin)).add(q0.y.mul(cos(spin))));
  const r2 = q.dot(q);
  const core = exp(r2.mul(-14));
  const halo = exp(r2.mul(-6.0)).mul(0.12);
  const rays = exp(abs(q.x).mul(-38))
    .mul(exp(abs(q.y).mul(-3.6)))
    .add(exp(abs(q.y).mul(-38)).mul(exp(abs(q.x).mul(-3.6))));
  const diag = exp(abs(q.x.add(q.y)).mul(-30))
    .mul(exp(abs(q.x.sub(q.y)).mul(-6)))
    .add(exp(abs(q.x.sub(q.y)).mul(-30)).mul(exp(abs(q.x.add(q.y)).mul(-6))));
  const star = max(core.add(halo), rays.add(diag.mul(0.35)).add(core));
  const shape = mix(core.mul(1.1).add(halo), star, starness);
  const edge = float(1).sub(TSL.smoothstep(0.85, 1.0, r2.sqrt()));
  if (alpha) {
    // Its colour as given, how much there is of it in the 'star' slot (0..1)
    const tint = sb.xyz as unknown as V3;
    const soft = exp(r2.mul(-3.2)).mul(edge);
    material.colorNode = linear ? display(tint) : tint;
    material.opacityNode = TSL.saturate(soft.mul(starness.mul(1.001)));
  } else {
    const c = (sb.xyz as unknown as V3).mul(shape.mul(edge)) as unknown as V3;
    material.colorNode = linear ? display(c) : c;
  }
  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.frustumCulled = false;
  mesh.renderOrder = 8;
  const set = (i: number, at: THREE.Vector3, size: number, colour: THREE.Color, star: number, spinAngle: number) => {
    a[i * 4] = at.x;
    a[i * 4 + 1] = at.y;
    a[i * 4 + 2] = at.z;
    a[i * 4 + 3] = size;
    b[i * 4] = colour.r;
    b[i * 4 + 1] = colour.g;
    b[i * 4 + 2] = colour.b;
    const turns = Math.round((((spinAngle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) * 100);
    b[i * 4 + 3] = turns + Math.min(0.999, Math.max(0, star));
  };
  const hide = (i: number) => {
    a[i * 4 + 3] = 0;
  };
  const flush = () => {
    attrA.needsUpdate = true;
    attrB.needsUpdate = true;
  };
  return { mesh, set, hide, flush, capacity };
}

// ---- Stardust: particles that live a while and fade ----

type Mote = { at: THREE.Vector3; vel: THREE.Vector3; born: number; life: number; size: number; colour: THREE.Color; star: number };

export type Dust = {
  emit: (at: THREE.Vector3, vel: THREE.Vector3, life: number, size: number, colour: THREE.Color, star?: number) => void;
  /** Positions are in `frame`'s space (the globe's), drawn through its world matrix */
  /** `alpha`: the sprites are stuff, not light: the fade goes in as how much there is, not how bright */
  update: (t: number, dt: number, out: Sprites, offset: number, frame: THREE.Matrix4, alpha?: boolean) => void;
};

export function dust(capacity: number): Dust {
  const motes: (Mote | null)[] = Array.from({ length: capacity }, () => null);
  let next = 0;
  const emit = (at: THREE.Vector3, vel: THREE.Vector3, life: number, size: number, colour: THREE.Color, star = 0) => {
    motes[next] = { at: at.clone(), vel: vel.clone(), born: -1, life, size, colour: colour.clone(), star };
    next = (next + 1) % capacity;
  };
  const tmp = new THREE.Color();
  const world = new THREE.Vector3();
  const update = (t: number, dt: number, out: Sprites, offset: number, frame: THREE.Matrix4, alpha = false) => {
    for (let i = 0; i < capacity; i++) {
      const m = motes[i];
      if (!m) {
        out.hide(offset + i);
        continue;
      }
      if (m.born < 0) m.born = t;
      const age = (t - m.born) / m.life;
      if (age >= 1) {
        motes[i] = null;
        out.hide(offset + i);
        continue;
      }
      m.at.addScaledVector(m.vel, dt);
      m.vel.multiplyScalar(Math.exp(-dt * 1.4));
      const fadeIn = Math.min(1, age * 12);
      const fade = fadeIn * (1 - age) * (1 - age);
      const twinkle = 0.75 + 0.25 * Math.sin(t * 13 + i);
      if (alpha) tmp.copy(m.colour);
      else tmp.copy(m.colour).multiplyScalar(fade * twinkle);
      out.set(offset + i, world.copy(m.at).applyMatrix4(frame), m.size * (0.6 + 0.4 * (1 - age)), tmp, alpha ? fade * 0.8 : m.star, t * 1.5 + i);
    }
  };
  return { emit, update };
}
