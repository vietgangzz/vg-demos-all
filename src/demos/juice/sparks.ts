import * as TSL from 'three/tsl';
import * as THREE from 'three/webgpu';

/**
 * Every small bright thing, in one mesh: sparks (streaks stretched along how they're flying),
 * motes of light (round, soft) and bubbles (a bright ring with a glint). Quads are built on the
 * CPU each frame facing the camera, which is plenty for a few hundred and keeps the streaks honest:
 * a spark's tail is where it was a moment ago.
 */

export const STREAK = 0;
export const MOTE = 1;
export const BUBBLE = 2;

export type Particle = {
  p: THREE.Vector3;
  v: THREE.Vector3;
  age: number;
  life: number;
  size: number;
  colour: THREE.Color;
  kind: number;
  /** Fraction of speed kept per second */
  drag: number;
  /** Down, in units per second² (negative floats up) */
  gravity: number;
  /** Bounce off the floor (y = 0), keeping this much of the speed */
  bounce: number;
  /** Streak length, in seconds of travel */
  stretch: number;
  /** Swirl: a lazy sideways wander, for embers */
  swirl: number;
  seed: number;
  /** Fade in over this fraction of the life (motes), else straight in */
  soft: number;
  /** What looks after it, for `update`'s custom step (0: nothing special) */
  tag: number;
};

const { vec2, exp, abs, uv, length, mix, step, smoothstep, max } = TSL;

export function sparks(capacity: number) {
  const pos = new Float32Array(capacity * 4 * 3);
  const tint = new Float32Array(capacity * 4 * 4);
  const corners = new Float32Array(capacity * 4 * 2);
  const index = new Uint32Array(capacity * 6);
  for (let i = 0; i < capacity; i++) {
    corners.set([0, 0, 1, 0, 1, 1, 0, 1], i * 8);
    index.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
  }
  const geometry = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(pos, 3);
  const tintAttr = new THREE.BufferAttribute(tint, 4);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  tintAttr.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', posAttr);
  geometry.setAttribute('uv', new THREE.BufferAttribute(corners, 2));
  geometry.setAttribute('tint', tintAttr);
  geometry.setIndex(new THREE.BufferAttribute(index, 1));

  const material = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const t = TSL.attribute('tint', 'vec4');
  const q = uv();
  const c = q.mul(2).sub(1);
  const r = length(c);
  // Streak: bright head (u = 1), a tail fading behind it, soft across
  const across = abs(c.y);
  const streak = exp(across.mul(across).mul(-7)).mul(q.x.pow(1.6)).add(exp(q.x.oneMinus().mul(-9)).mul(exp(across.mul(-6))).mul(0.6));
  // Mote: a soft round glow with a hot middle
  const mote = exp(r.mul(r).mul(-5)).mul(0.75).add(exp(r.mul(r).mul(-28)).mul(0.7));
  // Bubble: a thin bright ring, a glint up and to the left, almost nothing inside
  const off = r.sub(0.74);
  const ring = exp(off.mul(off).mul(-90));
  const g = c.sub(vec2(-0.32, 0.34));
  const glint = exp(g.dot(g).mul(-70));
  const bubble = ring.mul(0.7).add(glint.mul(0.9)).add(exp(r.mul(r).mul(-2.5)).mul(0.05));
  const kind = t.w;
  const shape = mix(streak, mix(mote, bubble, step(1.5, kind)), step(0.5, kind)).mul(
    max(step(kind, 0.5), smoothstep(1.0, 0.86, r))
  );
  material.colorNode = t.xyz.mul(shape);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 6;

  const list: Particle[] = [];
  const free: Particle[] = [];

  function emit(o: {
    p: THREE.Vector3;
    v: THREE.Vector3;
    life: number;
    size: number;
    colour: THREE.Color;
    kind?: number;
    drag?: number;
    gravity?: number;
    bounce?: number;
    stretch?: number;
    swirl?: number;
    soft?: number;
    tag?: number;
  }) {
    if (list.length >= capacity) return null;
    const s = free.pop() ?? ({ p: new THREE.Vector3(), v: new THREE.Vector3(), colour: new THREE.Color() } as Particle);
    s.p.copy(o.p);
    s.v.copy(o.v);
    s.colour.copy(o.colour);
    s.age = 0;
    s.life = o.life;
    s.size = o.size;
    s.kind = o.kind ?? STREAK;
    s.drag = o.drag ?? 0.35;
    s.gravity = o.gravity ?? 0;
    s.bounce = o.bounce ?? 0;
    s.stretch = o.stretch ?? 0.04;
    s.swirl = o.swirl ?? 0;
    s.soft = o.soft ?? 0;
    s.tag = o.tag ?? 0;
    s.seed = Math.random() * 100;
    list.push(s);
    return s;
  }

  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const look = new THREE.Vector3();
  const tail = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const side = new THREE.Vector3();

  /**
   * Move them on and lay out the quads. `custom` runs first for each particle and returns false
   * when it's done with it (the bubbles: they rise in the liquid and pop at the surface).
   */
  function update(dt: number, time: number, camera: THREE.Camera, custom?: (s: Particle, dt: number) => boolean) {
    right.setFromMatrixColumn(camera.matrixWorld, 0);
    up.setFromMatrixColumn(camera.matrixWorld, 1);
    let n = 0;
    for (let i = list.length - 1; i >= 0; i--) {
      const s = list[i];
      s.age += dt;
      let alive = s.age < s.life;
      if (alive && custom) alive = custom(s, dt);
      if (!alive) {
        list[i] = list[list.length - 1];
        list.pop();
        free.push(s);
        continue;
      }
      if (s.kind !== BUBBLE) {
        s.v.multiplyScalar(Math.pow(s.drag, dt));
        s.v.y -= s.gravity * dt;
        if (s.swirl) {
          s.v.x += Math.sin(time * 2.3 + s.seed) * s.swirl * dt;
          s.v.z += Math.cos(time * 1.7 + s.seed * 1.3) * s.swirl * dt;
        }
        s.p.addScaledVector(s.v, dt);
        if (s.bounce && s.p.y < 0.004) {
          s.p.y = 0.004;
          if (s.v.y < 0) s.v.y *= -s.bounce;
          s.v.x *= 0.7;
          s.v.z *= 0.7;
        }
      }
      const k = s.age / s.life;
      // Sparks are brightest born; motes swell in and out; bubbles stay until they pop
      const fade = s.kind === STREAK ? (1 - k) * (1 - k) : s.kind === BUBBLE ? Math.min(1, s.age * 8) : Math.min(1, k / Math.max(0.01, s.soft)) * (1 - k);
      const w = s.size;
      const base = n * 12;
      if (s.kind === STREAK) {
        tail.copy(s.p).addScaledVector(s.v, -s.stretch);
        dir.subVectors(s.p, tail);
        if (dir.lengthSq() < w * w * 4) tail.copy(s.p).addScaledVector(dir.lengthSq() > 1e-10 ? dir.normalize() : up, -w * 2);
        look.subVectors(s.p, camera.position);
        side.crossVectors(dir.subVectors(s.p, tail), look).normalize().multiplyScalar(w);
        // tail-left, head-left, head-right, tail-right (u runs tail to head)
        pos[base] = tail.x - side.x;
        pos[base + 1] = tail.y - side.y;
        pos[base + 2] = tail.z - side.z;
        pos[base + 3] = s.p.x - side.x;
        pos[base + 4] = s.p.y - side.y;
        pos[base + 5] = s.p.z - side.z;
        pos[base + 6] = s.p.x + side.x;
        pos[base + 7] = s.p.y + side.y;
        pos[base + 8] = s.p.z + side.z;
        pos[base + 9] = tail.x + side.x;
        pos[base + 10] = tail.y + side.y;
        pos[base + 11] = tail.z + side.z;
      } else {
        for (let c = 0; c < 4; c++) {
          const cx = c === 1 || c === 2 ? 1 : -1;
          const cy = c >= 2 ? 1 : -1;
          pos[base + c * 3] = s.p.x + (right.x * cx + up.x * cy) * w;
          pos[base + c * 3 + 1] = s.p.y + (right.y * cx + up.y * cy) * w;
          pos[base + c * 3 + 2] = s.p.z + (right.z * cx + up.z * cy) * w;
        }
      }
      for (let c = 0; c < 4; c++) {
        const o = (n * 4 + c) * 4;
        tint[o] = s.colour.r * fade;
        tint[o + 1] = s.colour.g * fade;
        tint[o + 2] = s.colour.b * fade;
        tint[o + 3] = s.kind;
      }
      n++;
    }
    geometry.setDrawRange(0, n * 6);
    posAttr.needsUpdate = true;
    tintAttr.needsUpdate = true;
  }

  return {
    mesh,
    emit,
    update,
    get count() {
      return list.length;
    },
    clear() {
      while (list.length) free.push(list.pop()!);
    },
  };
}

export type Sparks = ReturnType<typeof sparks>;
