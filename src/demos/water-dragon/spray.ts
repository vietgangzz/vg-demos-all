import * as TSL from 'three/tsl';
import * as THREE from 'three/webgpu';

import { LANTERN_ROW, MOON_DIR } from './look';

/**
 * Water thrown up: drops (streaks along the way they fly, catching the light) and mist (soft, faint,
 * hanging in the air a moment). They fall back under gravity, and where a drop lands on the water
 * it's reported, for its ring.
 *
 * Quads built on the CPU each frame, facing the camera: plenty for a couple of thousand.
 */

export const DROP = 0;
export const MIST = 1;

type Drop = {
  p: THREE.Vector3;
  v: THREE.Vector3;
  age: number;
  life: number;
  size: number;
  kind: number;
  /** How much it catches the light: most a little, a few a lot */
  glint: number;
  live: boolean;
};

const { vec3, exp, uv, smoothstep, mix, float } = TSL;
const lanternMid = LANTERN_ROW.a.clone().add(LANTERN_ROW.b).multiplyScalar(0.5);

export function createSpray(capacity: number) {
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
  geometry.setDrawRange(0, 0);

  const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  {
    const t = TSL.attribute('tint', 'vec4');
    // kind in the alpha's whole part: 0 a drop, 1 mist; how strong in its fraction
    const kind = t.w.floor();
    const a = TSL.fract(t.w);
    const across = uv().x.sub(0.5).mul(2);
    const along = uv().y;
    const drop = exp(across.mul(across).mul(-3.2)).mul(smoothstep(0, 0.35, along)).mul(float(0.35).add(along.mul(0.65)));
    const r2 = across.mul(across).add(along.sub(0.5).mul(2).pow(2));
    const mist = exp(r2.mul(-2.6));
    const shape = mix(drop, mist, kind);
    material.colorNode = vec3(t.x, t.y, t.z);
    material.opacityNode = shape.mul(a).mul(1.25);
  }
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 6;

  const drops: Drop[] = Array.from({ length: capacity }, () => ({
    p: new THREE.Vector3(),
    v: new THREE.Vector3(),
    age: 0,
    life: 1,
    size: 0.02,
    kind: DROP,
    glint: 0,
    live: false,
  }));
  let cursor = 0;
  const tail = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const side = new THREE.Vector3();
  const view = new THREE.Vector3();
  const corner = new THREE.Vector3();
  const colour = new THREE.Color();
  const heading = new THREE.Vector3();

  const spawn = (p: THREE.Vector3, v: THREE.Vector3, size: number, kind = DROP, life = 2.5) => {
    // The oldest goes if they're all out
    let d = drops[cursor];
    for (let n = 0; n < capacity; n++) {
      const k = (cursor + n) % capacity;
      if (!drops[k].live) {
        d = drops[k];
        cursor = (k + 1) % capacity;
        break;
      }
    }
    if (d === drops[cursor]) cursor = (cursor + 1) % capacity;
    d.p.copy(p);
    d.v.copy(v);
    d.age = 0;
    d.life = life;
    d.size = size;
    d.kind = kind;
    const r = Math.random();
    d.glint = r > 0.93 ? 2.6 + Math.random() * 2 : 0.55 + r * 0.6;
    d.live = true;
  };

  return {
    mesh,
    spawn,
    /** A burst of water where something broke the surface at (x, z): `energy` about 0 to 8 */
    burst(x: number, z: number, energy: number, size: number, carry: THREE.Vector3) {
      const n = Math.round(Math.min(90, (5 + energy * 7) * (size / 0.13)));
      const p = new THREE.Vector3();
      const v = new THREE.Vector3();
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const out = (0.4 + Math.random() * 1.4) * (0.6 + energy * 0.12);
        const up = 1.2 + Math.random() * (1.2 + energy * 0.55);
        const r = size * (0.5 + Math.random() * 0.7);
        p.set(x + Math.cos(a) * r, 0.02, z + Math.sin(a) * r);
        v.set(Math.cos(a) * out, up, Math.sin(a) * out).addScaledVector(carry, 0.35);
        spawn(p, v, 0.011 + Math.random() * 0.013);
      }
      for (let i = 0; i < Math.min(8, 1 + energy); i++) {
        const a = Math.random() * Math.PI * 2;
        p.set(x + Math.cos(a) * size, 0.08, z + Math.sin(a) * size);
        v.set(Math.cos(a) * 0.5, 0.6 + Math.random() * 0.8, Math.sin(a) * 0.5).addScaledVector(carry, 0.2);
        spawn(p, v, 0.18 + Math.random() * 0.2 + energy * 0.02, MIST, 1.2 + Math.random() * 0.6);
      }
    },
    /**
     * Fly, fall, land. `surface(x, z)` is the water's height; `landed` hears of each drop that
     * falls back in.
     */
    update(dt: number, camera: THREE.Camera, surface: (x: number, z: number) => number, landed: (x: number, z: number, size: number) => void) {
      let q = 0;
      camera.getWorldPosition(view);
      for (const d of drops) {
        if (!d.live) continue;
        d.age += dt;
        if (d.kind === DROP) {
          d.v.y -= 9.8 * dt;
          d.v.multiplyScalar(Math.exp(-dt * 0.25));
        } else {
          d.v.y -= 0.6 * dt;
          d.v.multiplyScalar(Math.exp(-dt * 1.6));
        }
        d.p.addScaledVector(d.v, dt);
        if (d.kind === DROP && d.p.y < surface(d.p.x, d.p.z) && d.v.y < 0) {
          d.live = false;
          landed(d.p.x, d.p.z, d.size);
          continue;
        }
        if (d.age > d.life) {
          d.live = false;
          continue;
        }
        if (q >= capacity) continue;
        // Its light: the moon's cool, warmer toward the lanterns, a few drops lit right up
        const warm = Math.exp(-d.p.distanceToSquared(lanternMid) * 0.02);
        const moonward = Math.max(0, heading.copy(d.v).normalize().dot(MOON_DIR)) * 0.35;
        colour.setRGB(0.62 + warm * 0.4, 0.72 + warm * 0.12, 0.86 - warm * 0.25).multiplyScalar(d.glint + moonward);
        const fadeOut = 1 - Math.max(0, (d.age - d.life * 0.7) / (d.life * 0.3));
        const fadeIn = d.kind === MIST ? Math.min(1, d.age / 0.25) : 1;
        let strength = d.kind === MIST ? 0.2 : 0.85;
        strength *= fadeOut * fadeIn;
        // Quad: from where it was a moment ago to where it is, as wide as it is
        if (d.kind === DROP) {
          tail.copy(d.p).addScaledVector(d.v, -0.028);
        } else {
          tail.copy(d.p).addScaledVector(d.v, -0.001);
          tail.y -= d.size;
        }
        dir.subVectors(d.p, tail);
        const len = dir.length();
        if (len < 1e-5) dir.set(0, 1, 0);
        else dir.divideScalar(len);
        side.subVectors(view, d.p).cross(dir).normalize().multiplyScalar(d.size);
        const head = corner.copy(d.p).addScaledVector(dir, d.kind === MIST ? d.size : d.size * 0.8);
        const tx = tail.x - dir.x * d.size * 0.5;
        const ty = tail.y - dir.y * d.size * 0.5;
        const tz = tail.z - dir.z * d.size * 0.5;
        const o = q * 12;
        pos[o] = tx - side.x;
        pos[o + 1] = ty - side.y;
        pos[o + 2] = tz - side.z;
        pos[o + 3] = tx + side.x;
        pos[o + 4] = ty + side.y;
        pos[o + 5] = tz + side.z;
        pos[o + 6] = head.x + side.x;
        pos[o + 7] = head.y + side.y;
        pos[o + 8] = head.z + side.z;
        pos[o + 9] = head.x - side.x;
        pos[o + 10] = head.y - side.y;
        pos[o + 11] = head.z - side.z;
        const w = d.kind + Math.min(0.999, Math.max(0.001, strength));
        for (let c = 0; c < 4; c++) {
          const t = q * 16 + c * 4;
          tint[t] = colour.r;
          tint[t + 1] = colour.g;
          tint[t + 2] = colour.b;
          tint[t + 3] = w;
        }
        q++;
      }
      geometry.setDrawRange(0, q * 6);
      // (nothing to draw: not drawn at all)
      mesh.visible = q > 0;
      posAttr.needsUpdate = true;
      tintAttr.needsUpdate = true;
    },
    get count() {
      let n = 0;
      for (const d of drops) if (d.live) n++;
      return n;
    },
  };
}

export type Spray = ReturnType<typeof createSpray>;
