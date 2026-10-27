import * as TSL from 'three/tsl';
import * as THREE from 'three/webgpu';

import type { Art, Painting } from './art';
import { hex, lacquer, MOON_DIR, type F, type V3 } from './look';

/**
 * Everything round the pond that isn't the stage: the painted night behind it (the sky, the hills
 * far off in the mist, the village on the far bank, its bamboo and its trees) hung on arcs round
 * the audience's seat, so they sit still at their distances as the seat sways; mist lying low
 * along the far bank; lotus leaves floating at the pond's edges, rocked by every wave; reeds at
 * its corners, stirring; and fireflies over the water.
 */

const { vec2, vec3, float, mix, smoothstep, saturate, dot, normalize, pow, sin, max, uv } = TSL;

/** The arcs' middle: about where the audience sits */
const SEAT = new THREE.Vector3(0, 0, 5);
const moonDir = vec3(MOON_DIR.x, MOON_DIR.y, MOON_DIR.z) as unknown as V3;

type Arc = {
  radius: number;
  /** How far round it reaches, in degrees */
  arc: number;
  /** Its foot, in metres above the water */
  foot: number;
  /** How many times the painting's laid along it (mirrored each time, so the joins don't show) */
  copies: number;
  order: number;
  /** Night-graded: the painting multiplied by this */
  grade: string;
  /** Mist toward its foot: its colour, how high up the painting it reaches, how thick */
  mist: [string, number, number];
  /** Solid along its very bottom, whatever's painted, so nothing shows under it */
  solidFoot: boolean;
  sky?: boolean;
};

function arcLayer(p: Painting, a: Arc) {
  const theta = THREE.MathUtils.degToRad(a.arc);
  const height = (a.radius * theta) / (p.aspect * a.copies);
  const g = new THREE.CylinderGeometry(a.radius, a.radius, height, 96, 1, true, Math.PI - theta / 2, theta);
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const v = uv().y;
  // The cylinder runs right to left seen from inside it: turned back round
  const c = TSL.texture(p.texture, vec2(float(1).sub(uv().x).mul(a.copies), v));
  m.colorNode = TSL.Fn(() => {
    let col = c.rgb.mul(hex(a.grade)) as unknown as V3;
    if (a.sky) {
      // The moon (it's here, not in the painting, so it's where the light on the water says it is)
      const d = normalize(TSL.positionWorld.sub(TSL.cameraPosition)) as unknown as V3;
      const toMoon = saturate(dot(d, moonDir));
      const disc = smoothstep(0.99905, 0.99935, toMoon);
      const seas = TSL.mx_noise_float(d.mul(260))
        .mul(0.5)
        .add(TSL.mx_noise_float(d.mul(90)).mul(0.5));
      const moon = hex('#FFF0D2')
        .mul(float(1.05).sub(smoothstep(0.1, 0.6, seas).mul(0.16)))
        .mul(disc);
      // The painted clouds right round it held down, so it stands out of its own glow
      col = col.mul(float(1).sub(pow(toMoon, 60).mul(0.45))) as unknown as V3;
      const halo = hex('#9AA8D8').mul(pow(toMoon, 160).mul(0.18).add(pow(toMoon, 9).mul(0.07)));
      // Stars where the painted sky's dark and clear
      const lum = dot(c.rgb, vec3(0.3, 0.59, 0.11));
      const cell = TSL.floor(d.mul(210));
      const h = TSL.hash(cell.x.add(cell.y.mul(157)).add(cell.z.mul(313)));
      const twinkle = sin(TSL.time.mul(float(2).add(h.mul(3))).add(h.mul(40)))
        .mul(0.35)
        .add(0.65);
      const star = TSL.step(0.9965, h)
        .mul(twinkle)
        .mul(smoothstep(0.14, 0.05, lum))
        .mul(float(1).sub(disc));
      col = col
        .mul(float(1).sub(disc))
        .add(halo)
        .add(moon)
        .add(vec3(1, 1, 1).mul(star.mul(0.85))) as unknown as V3;
    }
    const [mc, reach, thick] = a.mist;
    return mix(col, hex(mc), smoothstep(reach, 0, v).mul(thick));
  })();
  m.opacityNode = a.solidFoot ? max(c.a, smoothstep(0.05, 0.0, v)) : c.a;
  const mesh = new THREE.Mesh(g, m);
  mesh.position.set(SEAT.x, a.foot + height / 2, SEAT.z);
  mesh.renderOrder = a.order;
  mesh.frustumCulled = false;
  return mesh;
}

/** Mist lying low across the pond at z: drifting, thin */
function mistBank(z: number, width: number, height: number, thick: number, order: number) {
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  const p = TSL.positionWorld;
  const drift = TSL.mx_noise_float(vec3(p.x.mul(0.09).add(TSL.time.mul(0.025)), p.y.mul(0.5), z))
    .mul(0.5)
    .add(0.5);
  const wisp = TSL.mx_noise_float(vec3(p.x.mul(0.31).sub(TSL.time.mul(0.04)), p.y.mul(1.4), z + 9))
    .mul(0.5)
    .add(0.5);
  const rise = smoothstep(height, 0, p.y).mul(smoothstep(-0.2, 0.25, p.y));
  m.colorNode = hex('#7C88AE');
  m.opacityNode = rise.mul(drift.mul(0.7).add(wisp.mul(0.5))).mul(thick);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height + 0.4), m);
  mesh.position.set(0, (height + 0.4) / 2 - 0.2, z);
  mesh.renderOrder = order;
  return mesh;
}

type Leaf = {
  x: number;
  z: number;
  hx: number;
  hz: number;
  vx: number;
  vz: number;
  size: number;
  spin: number;
  tilt: THREE.Vector2;
  seed: number;
};
type Water = {
  heightAt: (x: number, z: number) => number;
  slopeAt: (x: number, z: number, out: { x: number; z: number }) => { x: number; z: number };
};

/** Lotus leaves along the pond's edges, out of the puppets' way: clumps of them */
const CLUMPS: [number, number, number, number][] = [
  // x, z, how many, how spread out
  [-4.7, -0.9, 5, 0.75],
  [4.6, -1.6, 4, 0.7],
  [-5.6, -4.4, 4, 0.8],
  [5.8, -5.6, 5, 0.9],
  [-4.6, -9.6, 3, 0.7],
  [4.9, -10.4, 3, 0.7],
];

/** Reeds: where, how tall */
const REEDS: [number, number, number][] = [
  [-5.6, 0.4, 1.7],
  [-4.9, -0.4, 1.25],
  [5.3, 0.1, 1.6],
  [6.0, -1.1, 1.3],
  [-7.2, -6.5, 1.9],
  [7.4, -7.8, 1.8],
  [-5.6, -12.4, 1.5],
  [5.9, -13.0, 1.6],
];

export function buildBackdrop(art: Art) {
  const root = new THREE.Group();

  // ---- The painted night ----
  const moonAz = Math.atan2(MOON_DIR.x, -MOON_DIR.z);
  const sky = arcLayer(art.sky, {
    radius: 380,
    arc: 120,
    foot: -24,
    copies: 1,
    order: -9,
    // Down a little, so the moon's the brightest thing in it
    grade: '#B4B6C8',
    mist: ['#2A2840', 0.12, 0.5],
    solidFoot: true,
    sky: true,
  });
  // Turned so the moonlit clouds, painted about a third of the way along it, are round the moon
  sky.rotation.y = -(moonAz - THREE.MathUtils.degToRad(-24));
  root.add(sky);
  const hills = arcLayer(art.hills, {
    radius: 160,
    arc: 140,
    foot: -6,
    copies: 2,
    order: -8,
    grade: '#9AA2C0',
    mist: ['#3A3E5C', 0.3, 0.55],
    solidFoot: false,
  });
  // Turned so the low ridges at the painting's edge lie under the moon, the peaks either side of it
  hills.rotation.y = -moonAz;
  root.add(hills);
  root.add(mistBank(-44, 160, 5, 0.35, -7.5));
  root.add(
    arcLayer(art.village, {
      radius: 46,
      arc: 130,
      foot: -0.6,
      copies: 2,
      order: -7,
      grade: '#D8DCEC',
      mist: ['#1E2236', 0.16, 0.45],
      solidFoot: true,
    })
  );
  root.add(mistBank(-22, 70, 2.4, 0.22, -6));
  root.add(mistBank(-15.5, 40, 1.2, 0.12, -5));

  // ---- Lotus leaves ----
  const leaves: Leaf[] = [];
  let seed = 3;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (const [cx, cz, n, spread] of CLUMPS) {
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(rand()) * spread;
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      leaves.push({
        x,
        z,
        hx: x,
        hz: z,
        vx: 0,
        vz: 0,
        size: 0.38 + rand() * 0.34,
        spin: rand() * 6.3,
        tilt: new THREE.Vector2(),
        seed: rand() * 20,
      });
    }
  }
  const leafMat = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  {
    const c = TSL.texture(art.leaf.texture, uv());
    leafMat.colorNode = lacquer(
      c.rgb.mul(1.15) as unknown as V3,
      float(0) as unknown as F,
      float(0.55) as unknown as F
    );
    leafMat.opacityNode = c.a;
    leafMat.alphaTest = 0.45;
  }
  const leafMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), leafMat, leaves.length);
  leafMesh.frustumCulled = false;
  leafMesh.renderOrder = 1;
  root.add(leafMesh);

  // ---- Reeds, stirring ----
  const reedMat = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  {
    const c = TSL.texture(art.reeds.texture, uv());
    const lit = lacquer(c.rgb as unknown as V3, float(0) as unknown as F, float(0) as unknown as F);
    reedMat.colorNode = lit.mul(0.8);
    reedMat.opacityNode = c.a;
    reedMat.alphaTest = 0.4;
    const pl = TSL.positionLocal;
    const phase = TSL.modelPosition.x.mul(1.7).add(TSL.modelPosition.z);
    const bend = pow(uv().y, 2).mul(
      sin(TSL.time.mul(1.1).add(phase))
        .mul(0.05)
        .add(sin(TSL.time.mul(2.9).add(phase.mul(2))).mul(0.015))
    );
    reedMat.positionNode = vec3(pl.x.add(bend), pl.y, pl.z);
  }
  const reeds = REEDS.map(([x, z, h]) => {
    const g = new THREE.PlaneGeometry(h * art.reeds.aspect, h).translate(0, h / 2 - 0.12, 0);
    const mesh = new THREE.Mesh(g, reedMat);
    mesh.position.set(x, 0, z);
    root.add(mesh);
    return mesh;
  });

  // ---- Fireflies ----
  const flyMat = new THREE.SpriteNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  {
    const r = TSL.length(uv().sub(0.5)).mul(2);
    flyMat.colorNode = hex('#E8FF9A').mul(2.2);
    flyMat.opacityNode = TSL.exp(r.mul(r).mul(-9))
      .add(TSL.exp(r.mul(-4)).mul(0.25))
      .mul(smoothstep(1, 0.7, r));
  }
  const flies = Array.from({ length: 34 }, (_, i) => {
    const near = i < 10;
    const side = i % 2 ? 1 : -1;
    const home = near
      ? new THREE.Vector3(side * (4.6 + rand() * 2.4), 0.35 + rand() * 1.2, -0.5 - rand() * 6)
      : new THREE.Vector3((rand() - 0.5) * 34, 0.3 + rand() * 2.4, -15 - rand() * 14);
    const s = new THREE.Sprite(flyMat);
    s.renderOrder = 7;
    root.add(s);
    return { s, home, seed: rand() * 50, size: near ? 0.05 : 0.11 };
  });

  const slope = { x: 0, z: 0 };
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const at = new THREE.Vector3();
  const sc = new THREE.Vector3();
  return {
    root,
    update(
      t: number,
      dt: number,
      water: Water,
      push: (x: number, z: number) => { x: number; z: number },
      camera: THREE.Camera
    ) {
      leaves.forEach((l, i) => {
        // Rocked and carried by the waves, shoved by whatever swims through, back home slowly
        water.slopeAt(l.x, l.z, slope);
        const away = push(l.x, l.z);
        l.vx += (-slope.x * 7 + away.x * 0.7 + (l.hx - l.x) * 0.25) * dt;
        l.vz += (-slope.z * 7 + away.z * 0.7 + (l.hz - l.z) * 0.25) * dt;
        l.vx *= Math.exp(-dt * 1.6);
        l.vz *= Math.exp(-dt * 1.6);
        l.x += l.vx * dt;
        l.z += l.vz * dt;
        l.spin += (l.vx * 0.3 - l.vz * 0.2) * dt + Math.sin(t * 0.07 + l.seed) * 0.0006;
        l.tilt.x += (slope.z * 1.3 - l.tilt.x) * (1 - Math.exp(-dt * 7));
        l.tilt.y += (-slope.x * 1.3 - l.tilt.y) * (1 - Math.exp(-dt * 7));
        at.set(l.x, water.heightAt(l.x, l.z) + 0.006, l.z);
        q.setFromEuler(e.set(l.tilt.x, l.spin, l.tilt.y, 'YXZ'));
        sc.setScalar(l.size);
        leafMesh.setMatrixAt(i, m4.compose(at, q, sc));
      });
      leafMesh.instanceMatrix.needsUpdate = true;

      // The reeds face the audience, whichever way the seat leans
      for (const r of reeds)
        r.rotation.y = Math.atan2(camera.position.x - r.position.x, camera.position.z - r.position.z);

      for (const f of flies) {
        const k = t * 0.23 + f.seed;
        f.s.position.set(
          f.home.x + Math.sin(k * 1.3) * 0.8 + Math.sin(k * 3.1) * 0.2,
          f.home.y + Math.sin(k * 1.7 + 2) * 0.3,
          f.home.z + Math.cos(k * 1.1) * 0.7
        );
        // Glowing a while, then dark a while
        const on = Math.max(0, Math.sin(t * 0.9 + f.seed * 3)) ** 3;
        f.s.scale.setScalar(f.size * (0.15 + on));
      }
    },
  };
}

export type Backdrop = ReturnType<typeof buildBackdrop>;
