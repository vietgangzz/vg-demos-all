import * as TSL from 'three/tsl';
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

import { dayness, dusk, hex, radial, shade, type V3 } from './light';
import { geo } from './world';

/**
 * Everything above the ground: the night sky with its stars and the moon, the northern lights
 * hanging round the top of the world, and fat cotton clouds drifting over it all.
 */

const { vec2, vec3, float, mix, saturate, smoothstep, normalize, uv, time, pow, sin } = TSL;

// ---- The sky ----

/** Where the moon hangs in the sky: up and over to the left, behind the globe */
export const MOON_SKY = new THREE.Vector3(-0.52, 0.62, -0.59).normalize();

export function skyMesh() {
  const m = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false });
  const dir = normalize(TSL.positionWorld.sub(TSL.cameraPosition)) as unknown as V3;
  const s = TSL.screenUV;
  // Deep blue overhead, violet low down, a little teal haze in the middle of the screen
  let sky = mix(hex('#24164A'), hex('#081033'), smoothstep(0.15, 0.95, s.y.oneMinus())) as unknown as V3;
  const mid = smoothstep(0.75, 0.0, s.sub(vec2(0.5, 0.55)).length());
  sky = sky.add(hex('#143E66').mul(mid.mul(0.35))) as unknown as V3;
  // A drift of milky light across it
  const band = TSL.mx_fractal_noise_float(dir.mul(2.2), 4, 2.0, 0.5);
  sky = sky.add(hex('#3B2B7A').mul(smoothstep(0.0, 0.6, band).mul(0.35))) as unknown as V3;
  // Stars: one maybe in every cell of a grid wrapped round the sky
  const stars = (scale: number, chance: number, size: number, bright: number, salt: number) => {
    const cell = dir.mul(scale).floor();
    const h = TSL.hash(cell.x.mul(127.1).add(cell.y.mul(311.7)).add(cell.z.mul(74.7)).add(salt));
    const j = vec3(
      TSL.hash(cell.x.add(salt).mul(1.7)),
      TSL.hash(cell.y.add(salt).mul(2.3)),
      TSL.hash(cell.z.add(salt).mul(3.1))
    );
    const centre = normalize(cell.add(j.mul(0.7).add(0.15)));
    const d = dir.sub(centre).length().mul(scale);
    const on = smoothstep(1 - chance, 1, h);
    const twinkle = sin(time.mul(h.mul(3).add(1.5)).add(h.mul(60))).mul(0.35).add(0.65);
    return smoothstep(size, 0, d).mul(on).mul(twinkle).mul(bright);
  };
  const tiny = stars(160, 0.12, 0.22, 1.0, 0);
  const big = stars(48, 0.05, 0.16, 1.6, 7);
  sky = sky.add(hex('#FFF6E0').mul(tiny.add(big))) as unknown as V3;
  // The moon: a pale disc with soft seas on it, and a halo
  const moon = TSL.uniform(MOON_SKY) as unknown as V3;
  const md = dir.sub(moon).length();
  const disc = smoothstep(0.075, 0.07, md);
  const seas = TSL.mx_noise_float(dir.mul(40)).mul(0.12).add(0.9);
  const halo = pow(saturate(float(1).sub(md.div(0.6))), 3).mul(0.5);
  sky = mix(sky, hex('#FFF7DE').mul(seas), disc).add(hex('#8E9BFF').mul(halo)) as unknown as V3;
  m.colorNode = sky;
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(60, 48, 24), m);
  mesh.renderOrder = -1;
  mesh.frustumCulled = false;
  return mesh;
}

// ---- Northern lights ----

/** The magnetic pole the lights circle, off toward Canada */
const AURORA_POLE = geo(-72.7, 80.7);

/** A ring of ribbon standing up off the globe round the aurora's pole */
function auroraRing(layers: { off: number; base: number; height: number; phase: number }[], seg: number, ringDeg: number) {
  const axis = AURORA_POLE.clone().normalize();
  const u = new THREE.Vector3().crossVectors(axis, new THREE.Vector3(0, 0, 1)).normalize();
  const v = new THREE.Vector3().crossVectors(axis, u).normalize();
  const geos: THREE.BufferGeometry[] = [];
  const dir = new THREE.Vector3();
  const tan = new THREE.Vector3();
  for (const [k, layer] of layers.entries()) {
    const pos: number[] = [];
    const uvs: number[] = [];
    const sway: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= seg; i++) {
      const t = (i / seg) * Math.PI * 2;
      // The oval wanders in and out, folding the curtain
      const theta =
        ((ringDeg + layer.off + 2.4 * Math.sin(2 * t + layer.phase) + 1.6 * Math.sin(5 * t + layer.phase * 2) + 0.7 * Math.sin(11 * t + layer.phase)) *
          Math.PI) /
        180;
      dir
        .copy(axis)
        .multiplyScalar(Math.cos(theta))
        .addScaledVector(u, Math.sin(theta) * Math.cos(t))
        .addScaledVector(v, Math.sin(theta) * Math.sin(t))
        .normalize();
      tan.copy(u).multiplyScalar(-Math.sin(t)).addScaledVector(v, Math.cos(t));
      const h = layer.height * (0.7 + 0.3 * Math.sin(3 * t + layer.phase) * Math.sin(7 * t + 1.3));
      // Curtains lean outward a little as they rise, the way they hang over the limb
      const lean = new THREE.Vector3().crossVectors(tan, dir).normalize();
      for (const [r, out] of [
        [layer.base, 0],
        [layer.base + h, h * 0.35],
      ]) {
        const pt = dir.clone().multiplyScalar(r).addScaledVector(lean, -out);
        pos.push(pt.x, pt.y, pt.z);
        sway.push(...lean.toArray());
      }
      uvs.push((i / seg) * 24 + k * 0.37, 0, (i / seg) * 24 + k * 0.37, 1);
      if (i < seg) {
        const a = i * 2;
        idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setAttribute('sway', new THREE.Float32BufferAttribute(sway, 3));
    g.setIndex(idx);
    geos.push(g);
  }
  return mergeGeometries(geos)!;
}

/**
 * The northern lights: curtains of green standing up round the top of the world, a bright mint hem
 * along the bottom, fine rays running up them and sliding sideways, fading to a teal haze high up.
 * Behind them, a softer veil of the same light, so the whole crown of the globe glows green.
 */
export function auroraMesh() {
  const group = new THREE.Group();
  const night = float(1).sub(dayness(radial()).mul(0.9));

  // The curtains
  const curtains = auroraRing(
    [
      { off: -2.2, base: 1.03, height: 0.3, phase: 0.0 },
      { off: 0.6, base: 1.035, height: 0.38, phase: 2.1 },
      { off: 3.2, base: 1.04, height: 0.26, phase: 4.4 },
    ],
    520,
    17
  );
  const m = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const q = uv();
  const swayDir = TSL.attribute('sway', 'vec3') as unknown as V3;
  m.positionNode = TSL.positionLocal.add(swayDir.mul(sin(time.mul(0.45).add(q.x.mul(1.8))).mul(0.018).mul(q.y.add(0.2))));
  const flow = TSL.mx_noise_float(vec2(q.x.mul(1.2).add(time.mul(0.04)), time.mul(0.03)));
  const bands = TSL.mx_noise_float(vec2(q.x.mul(6).sub(time.mul(0.12)), q.y.mul(0.5).add(time.mul(0.05))));
  // Rays: fine, sharp, drifting
  const rays = pow(sin(q.x.mul(260).add(flow.mul(30)).add(bands.mul(6))).mul(0.5).add(0.5), 4);
  const body = smoothstep(-0.15, 0.6, flow).mul(bands.mul(0.5).add(0.7));
  const hem = smoothstep(0.0, 0.025, q.y).mul(TSL.exp(q.y.mul(-2.6)));
  const top = smoothstep(1.0, 0.55, q.y);
  const colour = mix(mix(hex('#7DF77F'), hex('#2BD45A'), smoothstep(0.02, 0.2, q.y)), hex('#1E9E5A'), smoothstep(0.45, 0.95, q.y));
  const violet = hex('#6A4CC8').mul(smoothstep(0.8, 1.0, q.y).mul(0.12));
  m.colorNode = colour
    .mul(rays.mul(0.55).add(0.45))
    .mul(body)
    .mul(hem.mul(1.6).add(top.mul(0.35)))
    .add(violet.mul(body))
    .mul(night)
    .mul(0.62);
  const mesh = new THREE.Mesh(curtains, m);
  mesh.renderOrder = 4;
  mesh.frustumCulled = false;

  // The veil: wide, soft, slow
  const veil = auroraRing([{ off: 0.8, base: 1.02, height: 0.55, phase: 1.0 }], 260, 16);
  const vm = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const vq = uv();
  const soft = TSL.mx_noise_float(vec2(vq.x.mul(0.8).add(time.mul(0.02)), vq.y.mul(0.6).sub(time.mul(0.02))));
  const fall = smoothstep(0.0, 0.08, vq.y).mul(pow(float(1).sub(vq.y), 1.6));
  vm.colorNode = mix(hex('#36D96A'), hex('#178A55'), vq.y).mul(smoothstep(-0.3, 0.7, soft)).mul(fall).mul(night).mul(0.22);
  const veilMesh = new THREE.Mesh(veil, vm);
  veilMesh.renderOrder = 3;
  veilMesh.frustumCulled = false;

  group.add(veilMesh, mesh);
  return group;
}

// ---- Clouds ----

/**
 * One paper cloud: card cut with a flat bottom and a scalloped top, a second smaller layer stuck
 * on its face, both with a little thickness so the cut edge shows
 */
export function cloudGeometry() {
  const shape = (w: number, h: number, bumps: number[][]) => {
    const sh = new THREE.Shape();
    sh.moveTo(-w / 2, 0);
    sh.lineTo(w / 2, 0);
    for (const [cx, cy, r, a0, a1] of bumps) sh.absarc(cx, cy, r, a0, a1, false);
    sh.lineTo(-w / 2, 0);
    return sh;
  };
  const back = shape(1.6, 0.6, [
    [0.62, 0.18, 0.18, -0.3, 2.2],
    [0.28, 0.36, 0.28, 0.2, 2.6],
    [-0.12, 0.42, 0.32, 0.3, 2.8],
    [-0.5, 0.26, 0.24, 0.6, 3.2],
    [-0.68, 0.12, 0.13, 1.4, 3.5],
  ]);
  const front = shape(1.0, 0.4, [
    [0.36, 0.12, 0.13, -0.2, 2.4],
    [0.08, 0.24, 0.2, 0.3, 2.7],
    [-0.26, 0.16, 0.16, 0.6, 3.3],
  ]);
  const opts = { depth: 0.07, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 2, curveSegments: 10 };
  const g1 = new THREE.ExtrudeGeometry(back, opts);
  const g2 = new THREE.ExtrudeGeometry(front, opts).translate(0.12, 0.02, 0.085);
  const flat = (g: THREE.BufferGeometry) => (g.index ? g.toNonIndexed() : g);
  const g = mergeGeometries([flat(g1), flat(g2)])!;
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  return g;
}

export type Clouds = {
  mesh: THREE.InstancedMesh;
  /** `avoid`: a place (a direction from the centre) for them to keep off, the town you go down into */
  update: (t: number, toCamera?: THREE.Vector3, avoid?: THREE.Vector3) => void;
};

export function cloudsMesh(count = 26): Clouds {
  const m = new THREE.MeshBasicNodeMaterial();
  const n = normalize(TSL.normalWorld) as unknown as V3;
  const up = radial();
  const edge = smoothstep(0.6, 0.2, TSL.abs(TSL.normalGeometry.z));
  const albedo = mix(hex('#FBF8F2'), hex('#E7DCCB'), edge.mul(0.8));
  const lit = shade(albedo as unknown as V3, n, up, 0.7);
  m.colorNode = lit.add(hex('#FFB3C1').mul(dusk(up).mul(0.35))).add(hex('#1E2152').mul(0.25));
  const mesh = new THREE.InstancedMesh(cloudGeometry(), m, count);
  mesh.frustumCulled = false;
  let s = 7;
  const rand = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  const clouds = Array.from({ length: count }, () => ({
    lon: rand() * 360 - 180,
    lat: (Math.asin(rand() * 2 - 1) * 180) / Math.PI * 0.85,
    alt: 1.03 + rand() * 0.03,
    size: 0.05 + rand() * 0.04,
    yaw: rand() * Math.PI * 2,
    speed: 1.2 + rand() * 1.8,
  }));
  const at = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const turn = new THREE.Quaternion();
  const Y = new THREE.Vector3(0, 1, 0);
  const matrix = new THREE.Matrix4();
  const scale = new THREE.Vector3();
  const face = new THREE.Vector3();
  const side = new THREE.Vector3();
  const upV = new THREE.Vector3();
  const basis = new THREE.Matrix4();
  /** toCamera: toward the camera, in the globe's frame, so each card stands turned to face you */
  const update = (t: number, toCamera?: THREE.Vector3, avoid?: THREE.Vector3) => {
    clouds.forEach((c, i) => {
      geo(c.lon + t * c.speed, c.lat, c.alt, at);
      upV.copy(at).normalize();
      // Thinning away to nothing over the town you go down into, so the way down stays clear
      const clear = avoid ? THREE.MathUtils.smoothstep((upV.angleTo(avoid) * 180) / Math.PI, 8, 16) : 1;
      if (toCamera) {
        face.copy(toCamera).addScaledVector(upV, -toCamera.dot(upV));
        if (face.lengthSq() < 1e-6) face.set(0, 0, 1);
        face.normalize();
        side.crossVectors(upV, face).normalize();
        basis.makeBasis(side, upV, face);
        q.setFromRotationMatrix(basis);
      } else {
        q.setFromUnitVectors(Y, upV);
        turn.setFromAxisAngle(Y, c.yaw);
        q.multiply(turn);
      }
      scale.setScalar(c.size * clear);
      matrix.compose(at, q, scale);
      mesh.setMatrixAt(i, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  };
  update(0);
  return { mesh, update };
}
