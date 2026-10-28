import * as TSL from 'three/tsl';
import * as THREE from 'three/webgpu';

/**
 * The vault's air: dust lit gold in the shaft of light, at three depths. Far back, tiny sharp specks;
 * round the chest, soft motes; right up at the lens, big out-of-focus discs drifting across. Gusts
 * come and go. While the orb charges, it all drifts in toward it (each mote toward the line from the
 * camera through the orb, at its own depth); when the chest bursts, a blast blows it all away.
 *
 * Quads built on the CPU each frame facing the camera, like the sparks.
 */

const { exp, length, uv, smoothstep, mix } = TSL;

type Mote = {
  p: THREE.Vector3;
  v: THREE.Vector3;
  size: number;
  /** 0: far speck, 1: mote, 2: bokeh */
  layer: number;
  seed: number;
  bright: number;
  /** How far it's faded in (a new one comes in slowly, rather than popping up) */
  a: number;
};

/** Each layer: how many, how big, how bright, where (a box round the chest, world space) */
const LAYERS = [
  {
    n: 70,
    size: [0.006, 0.012],
    bright: [0.5, 1.1],
    box: [
      [-2.6, 2.6],
      [-0.2, 3.4],
      [-3.4, -1.0],
    ],
  },
  {
    n: 60,
    size: [0.014, 0.03],
    bright: [0.35, 0.8],
    box: [
      [-1.6, 1.6],
      [-0.1, 2.4],
      [-0.9, 1.5],
    ],
  },
  {
    n: 10,
    size: [0.035, 0.075],
    bright: [0.05, 0.11],
    box: [
      [-1.0, 1.0],
      [0.6, 2.8],
      [2.6, 4.6],
    ],
  },
] as const;

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const within = ([a, b]: readonly [number, number]) => rand(a, b);

/**
 * `shaft`: the shaft of light falling on the chest, a cone from the dais's top (radius r0) up to
 * `top` (radius r1), its axis at x 0, z `z`: the motes round the chest light up as they drift
 * through it, and dim out of it
 */
export function dust(shaft?: { top: number; r0: number; r1: number; z: number }) {
  const motes: Mote[] = [];
  LAYERS.forEach((L, layer) => {
    for (let i = 0; i < L.n; i++) {
      motes.push({
        p: new THREE.Vector3(within(L.box[0]), within(L.box[1]), within(L.box[2])),
        v: new THREE.Vector3(),
        size: within(L.size),
        layer,
        seed: Math.random() * 100,
        bright: within(L.bright),
        a: 1,
      });
    }
  });
  const N = motes.length;
  const pos = new Float32Array(N * 4 * 3);
  const tint = new Float32Array(N * 4 * 4);
  const corners = new Float32Array(N * 4 * 2);
  const index = new Uint32Array(N * 6);
  for (let i = 0; i < N; i++) {
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
  });
  const t = TSL.attribute('tint', 'vec4');
  const r = length(uv().mul(2).sub(1));
  // A speck: a hot point; a mote: soft; bokeh: a flat disc with a brighter rim, as a lens makes it
  const speck = exp(r.mul(r).mul(-14)).add(exp(r.mul(r).mul(-60)));
  const disc = smoothstep(1, 0.86, r).mul(mix(TSL.float(0.55), TSL.float(1), smoothstep(0.55, 0.92, r)));
  material.colorNode = t.xyz.mul(mix(speck, disc, TSL.step(1.5, t.w)));
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 8;

  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const toward = new THREE.Vector3();
  const onLine = new THREE.Vector3();
  const warm = new THREE.Color('#FFD9A0');
  const cool = new THREE.Color('#B8A4FF');
  /** Somewhere else in its box, fading in */
  function respawn(m: Mote) {
    const L = LAYERS[m.layer];
    m.p.set(within(L.box[0]), within(L.box[1]), within(L.box[2]));
    m.v.set(0, 0, 0);
    m.a = 0;
  }
  let gust = 0;
  let gustTo = 0;
  let nextGust = 2;

  /**
   * Drift them on. `pull`: how hard they're drawn to the orb (0 to 1), `orb`: a point on the line
   * from the camera through it (world space). `colour`: the hold's colour, which they take on as
   * they're drawn in. `fade`: how bright they are (the cards up, they keep out of the way).
   */
  function update(
    dt: number,
    time: number,
    camera: THREE.PerspectiveCamera,
    pull: number,
    orb: THREE.Vector3 | null,
    colour: THREE.Color,
    fade = 1
  ) {
    right.setFromMatrixColumn(camera.matrixWorld, 0);
    up.setFromMatrixColumn(camera.matrixWorld, 1);
    camera.getWorldDirection(fwd);
    nextGust -= dt;
    if (nextGust <= 0) {
      gustTo = rand(-0.5, 0.5);
      nextGust = rand(2.5, 5);
    }
    gust += (gustTo - gust) * (1 - Math.exp(-dt * 0.8));
    for (let i = 0; i < N; i++) {
      const m = motes[i];
      const L = LAYERS[m.layer];
      // Drifting: rising a little in the warm air, wandering, swept by the gusts
      m.v.x += (Math.sin(time * 0.3 + m.seed) * 0.02 + gust * (0.05 + m.layer * 0.04)) * dt;
      m.v.y += (Math.sin(time * 0.23 + m.seed * 1.7) * 0.015 + 0.006) * dt;
      m.v.z += Math.cos(time * 0.27 + m.seed * 1.3) * 0.012 * dt;
      // Drawn toward the orb: toward where the line through it is at this mote's depth, brighter as
      // it nears it, and swallowed when it gets there (and another comes in somewhere else)
      let near = 0;
      if (pull > 0 && orb) {
        const depth = toward.subVectors(m.p, camera.position).dot(fwd);
        onLine.subVectors(orb, camera.position).normalize();
        const scale = depth / Math.max(0.2, onLine.dot(fwd));
        onLine.multiplyScalar(scale).add(camera.position);
        toward.subVectors(onLine, m.p);
        const d = toward.length();
        if (d < 0.05 + m.layer * 0.05) respawn(m);
        else {
          m.v.addScaledVector(toward.normalize(), pull * pull * (1.4 + m.layer * 0.4) * dt * Math.min(1, d * 2));
          near = pull * Math.exp(-d * 2.5);
        }
      }
      m.v.multiplyScalar(Math.exp(-dt * (pull > 0 ? 1.6 : 0.9)));
      m.p.addScaledVector(m.v, dt);
      // Out of its box (blown, or drawn): gone, and another comes in somewhere else
      if (
        m.p.x < L.box[0][0] ||
        m.p.x > L.box[0][1] ||
        m.p.y < L.box[1][0] ||
        m.p.y > L.box[1][1] ||
        m.p.z < L.box[2][0] ||
        m.p.z > L.box[2][1]
      )
        respawn(m);
      m.a = Math.min(1, m.a + dt * 0.7);
      const twinkle = 0.7 + 0.3 * Math.sin(time * (1.5 + (m.seed % 2)) + m.seed);
      let lit = 1;
      if (shaft && m.layer === 1) {
        const h = Math.min(1, Math.max(0, m.p.y / shaft.top));
        const r = shaft.r0 + (shaft.r1 - shaft.r0) * h;
        const d = Math.hypot(m.p.x, m.p.z - shaft.z);
        lit = 0.4 + 1.7 * Math.min(1, Math.max(0, (r - d) / (r * 0.45)));
      }
      const b = m.bright * twinkle * lit * (1 + pull * 0.6 + near * 1.5) * m.a * fade;
      const c = m.layer === 2 ? cool : warm;
      const s = m.size;
      const base = i * 12;
      for (let k = 0; k < 4; k++) {
        const cx = k === 1 || k === 2 ? 1 : -1;
        const cy = k >= 2 ? 1 : -1;
        pos[base + k * 3] = m.p.x + (right.x * cx + up.x * cy) * s;
        pos[base + k * 3 + 1] = m.p.y + (right.y * cx + up.y * cy) * s;
        pos[base + k * 3 + 2] = m.p.z + (right.z * cx + up.z * cy) * s;
        const o = (i * 4 + k) * 4;
        tint[o] = (c.r + (colour.r - c.r) * pull) * b;
        tint[o + 1] = (c.g + (colour.g - c.g) * pull) * b;
        tint[o + 2] = (c.b + (colour.b - c.b) * pull) * b;
        tint[o + 3] = m.layer;
      }
    }
    posAttr.needsUpdate = true;
    tintAttr.needsUpdate = true;
  }

  /** A blast from `at`: everything thrown away from it, the nearer the harder */
  function blast(at: THREE.Vector3, power: number) {
    for (const m of motes) {
      toward.subVectors(m.p, at);
      const d = Math.max(0.3, toward.length());
      m.v.addScaledVector(toward.normalize(), (power * (1 + m.layer * 0.6)) / (d * d));
    }
  }

  return { mesh, update, blast };
}

export type Dust = ReturnType<typeof dust>;
