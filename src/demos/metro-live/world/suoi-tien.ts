import * as THREE from 'three/webgpu';

import { createFoliageMaterial, createNightLightMaterial, createWaterMaterial } from '../shaders';
import { strut } from './bridges';
import { instanced, mergeByMaterial, mulberry32, treeCrownGeometry } from './geometry';
import { isWater } from './layout';
import { MAP, METRES_PER_UNIT, pointInRing, ringCentroid } from './map';

const M = 1 / METRES_PER_UNIT;

/**
 * Khu du lịch Suối Tiên, inside its real OSM boundary across Xa lộ Hà Nội from the line:
 * the tam quan gate facing the road, Biển Tiên Đồng (the wave pool under the 70 m mountain
 * with Lạc Long Quân's face and its waterfalls), the golden Bodhisattva, the dragon, a Ferris
 * wheel, a roller coaster and temple pavilions among the trees.
 */
export function buildSuoiTien(scene: THREE.Scene) {
  const ring = MAP.themePark;
  if (!ring) return { update() {} };
  const rand = mulberry32(2026);
  const center = ringCentroid(ring);
  // Gate on the boundary point nearest the line's last two stations
  const stations = MAP.stations.slice(-2);
  const station = stations.reduce((a, s) => (s.distanceTo(center) < a.distanceTo(center) ? s : a));
  const gate = ring.reduce((a, p) => (p.distanceTo(station) < a.distanceTo(station) ? p : a)).clone();
  const inward = center.clone().sub(gate).normalize();
  const across = new THREE.Vector2(-inward.y, inward.x);
  const depth = gate.distanceTo(center) * 2;
  /** Park-local point: `a` along the entrance axis (0 = gate), `c` across */
  const at = (a: number, c: number) => {
    const p = gate.clone().addScaledVector(inward, a).addScaledVector(across, c);
    // Pull points that fall outside the boundary back towards the middle
    for (let i = 0; i < 8 && !pointInRing(p.x, p.y, ring); i++) p.lerp(center, 0.25);
    return p;
  };
  /**
   * Find room for an attraction of radius `r` near a preferred spot: inside the boundary, off
   * the park's own lakes, and clear of everything placed so far (spiral search outwards).
   */
  const placed: { p: THREE.Vector2; r: number }[] = [];
  const fits = (p: THREE.Vector2, r: number) => {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const x = p.x + Math.cos(a) * r;
      const z = p.y + Math.sin(a) * r;
      if (!pointInRing(x, z, ring) || isWater(x, z)) return false;
    }
    return !isWater(p.x, p.y) && placed.every((o) => o.p.distanceTo(p) > o.r + r);
  };
  const claim = (preferred: THREE.Vector2, r: number) => {
    for (let step = 0; step < 400; step++) {
      const a = step * 2.4;
      const d = Math.sqrt(step) * 3;
      const p = preferred.clone().add(new THREE.Vector2(Math.cos(a) * d, Math.sin(a) * d));
      if (fits(p, r)) {
        placed.push({ p, r });
        return p;
      }
    }
    placed.push({ p: preferred, r });
    return preferred;
  };

  const root = new THREE.Group();
  const v3 = (p: THREE.Vector2, y = 0) => new THREE.Vector3(p.x, y, p.y);

  // Lawns inside the boundary
  const lawn = new THREE.Mesh(
    new THREE.ShapeGeometry(new THREE.Shape(ring.map((p) => new THREE.Vector2(p.x, -p.y)))),
    new THREE.MeshStandardMaterial({ color: '#D3E8C9', roughness: 1 })
  );
  lawn.rotation.x = -Math.PI / 2;
  lawn.position.y = 0.012;
  root.add(lawn);

  // ---- Tam quan gate facing the road ----
  const red = new THREE.MeshStandardMaterial({ color: '#C8402E', roughness: 0.6 });
  const tile = new THREE.MeshStandardMaterial({ color: '#D9792E', roughness: 0.7 });
  const gold = new THREE.MeshStandardMaterial({ color: '#E2B13C', roughness: 0.3, metalness: 0.6 });
  const lantern = createNightLightMaterial('#F25F3A', [1, 0.45, 0.2], 0.1);
  const gateCenter = at(4, 0);
  placed.push({ p: gateCenter, r: 9 });
  const wheelC = claim(at(depth * 0.15, depth * 0.3), 11);
  const gateGroup = new THREE.Group();
  gateGroup.position.copy(v3(gateCenter));
  gateGroup.rotation.y = Math.atan2(-across.y, across.x);
  for (const [x, w, h] of [
    [0, 5, 4.2],
    [-5.2, 3, 3.2],
    [5.2, 3, 3.2],
  ] as const) {
    for (const side of [-1, 1]) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.45, h, 0.45), red);
      pillar.position.set(x + side * (w / 2 - 0.2), h / 2, 0);
      gateGroup.add(pillar);
    }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 1, 0.35, 1.8), tile);
    roof.position.set(x, h + 0.2, 0);
    const ridge = new THREE.Mesh(new THREE.BoxGeometry(w * 0.7, 0.5, 0.9), tile);
    ridge.position.set(x, h + 0.6, 0);
    gateGroup.add(roof, ridge);
    // Upturned eave tips
    for (const side of [-1, 1]) {
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.7, 4), tile);
      tip.position.set(x + side * (w / 2 + 0.55), h + 0.55, 0);
      tip.rotation.z = -side * 0.6;
      gateGroup.add(tip);
    }
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6), lantern);
    lamp.position.set(x, h - 0.5, 0.5);
    gateGroup.add(lamp);
  }
  const plaque = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.7, 0.12), gold);
  plaque.position.set(0, 3.4, 0.3);
  gateGroup.add(plaque);
  root.add(gateGroup);

  // ---- Biển Tiên Đồng: the wave pool, its beach and the mountain with the king's face ----
  // The pool and its mountain are one attraction: claim room for both together
  const beachC = claim(at(depth * 0.45, -depth * 0.1), 34);
  const lagoonC = beachC.clone().addScaledVector(inward, -8);
  const lagoon = new THREE.Mesh(new THREE.CircleGeometry(16, 40), createWaterMaterial());
  lagoon.rotation.x = -Math.PI / 2;
  lagoon.scale.set(1.5, 1, 1);
  lagoon.position.copy(v3(lagoonC, 0.05));
  const beach = new THREE.Mesh(
    new THREE.RingGeometry(16, 20, 40, 1, Math.PI * 0.9, Math.PI * 1.2),
    new THREE.MeshStandardMaterial({ color: '#EEDDB5', roughness: 1 })
  );
  beach.rotation.x = -Math.PI / 2;
  beach.scale.set(1.5, 1, 1);
  beach.position.copy(v3(lagoonC, 0.04));
  root.add(lagoon, beach);

  const rock = new THREE.MeshStandardMaterial({ color: '#A08E7A', roughness: 1, flatShading: true });
  const rockLight = new THREE.MeshStandardMaterial({ color: '#BCA88F', roughness: 1, flatShading: true });
  const mountainC = lagoonC.clone().addScaledVector(inward, 21);
  const height = 70 * M;
  for (const [da, dc, r, h] of [
    [0, 0, 9, 1],
    [3, -9, 6.5, 0.72],
    [2, 9.5, 7, 0.66],
    [7, 3, 7.5, 0.84],
  ] as const) {
    const p = mountainC.clone().addScaledVector(inward, da).addScaledVector(across, dc);
    // Faceted crags rather than blobs
    const peak = new THREE.Mesh(new THREE.DodecahedronGeometry(1, 0), rock);
    peak.scale.set(r, height * h, r * 0.9);
    peak.position.copy(v3(p, height * h * 0.45));
    peak.rotation.y = rand() * Math.PI;
    root.add(peak);
  }
  // Lạc Long Quân's face carved into the rock, looking over the pool
  const faceGroup = new THREE.Group();
  faceGroup.position.copy(v3(mountainC.clone().addScaledVector(inward, -9), height * 0.62));
  faceGroup.rotation.y = Math.atan2(inward.y, -inward.x) + Math.PI;
  const face = new THREE.Mesh(new THREE.SphereGeometry(4.2, 12, 10), rockLight);
  face.scale.set(0.45, 1.1, 0.85);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.7, 2.2, 6), rockLight);
  nose.rotation.z = Math.PI / 2;
  nose.position.set(-1.9, -0.4, 0);
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 3, 2.6, 8), gold);
  crown.position.set(0.3, 4.6, 0);
  faceGroup.add(face, nose, crown);
  root.add(faceGroup);
  // Waterfalls down the rock into the pool
  const fall = createNightLightMaterial('#EAF6FF', [0.45, 0.75, 1.0], 0.15);
  for (const dc of [-7, -2.5, 5]) {
    const top = mountainC.clone().addScaledVector(inward, -6).addScaledVector(across, dc);
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(1.4, height * 0.5), fall);
    strip.position.copy(v3(top, height * 0.25));
    strip.rotation.y = Math.atan2(-inward.y, inward.x) + Math.PI / 2;
    root.add(strip);
  }

  // ---- Golden Bodhisattva on a lotus pedestal ----
  const statueC = claim(at(depth * 0.25, depth * 0.2), 6);
  const lotus = new THREE.Mesh(
    new THREE.CylinderGeometry(3.2, 2.4, 1.6, 12),
    new THREE.MeshStandardMaterial({ color: '#F2B8C6' })
  );
  lotus.position.copy(v3(statueC, 0.8));
  const robe = new THREE.Mesh(new THREE.ConeGeometry(2.2, 6.5, 12), gold);
  robe.position.copy(v3(statueC, 1.6 + 3.25));
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.95, 12, 10), gold);
  head.position.copy(v3(statueC, 1.6 + 6.5 + 0.5));
  const halo = new THREE.Mesh(
    new THREE.TorusGeometry(1.5, 0.12, 6, 24),
    createNightLightMaterial('#F8E3A0', [1, 0.8, 0.35], 0.2)
  );
  halo.position.copy(v3(statueC, 1.6 + 6.9));
  halo.rotation.y = Math.atan2(-inward.y, inward.x);
  root.add(lotus, robe, head, halo);

  // ---- The dragon: a long body weaving over a lake ----
  const dragonC = claim(at(depth * 0.6, depth * 0.22), 24);
  const spine = Array.from({ length: 14 }, (_, i) => {
    const t = i / 13;
    const p = dragonC
      .clone()
      .addScaledVector(across, (t - 0.5) * 44)
      .addScaledVector(inward, Math.sin(t * Math.PI * 3) * 5);
    return v3(p, 1.2 + Math.max(0, Math.sin(t * Math.PI * 4)) * 3.2);
  });
  const dragonCurve = new THREE.CatmullRomCurve3(spine);
  const scales = new THREE.MeshStandardMaterial({ color: '#3E9E5C', roughness: 0.5, metalness: 0.2 });
  root.add(new THREE.Mesh(new THREE.TubeGeometry(dragonCurve, 80, 0.85, 8), scales));
  const headPos = spine[spine.length - 1];
  const dragonHead = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.4, 1.5), gold);
  dragonHead.position.copy(headPos).setY(headPos.y + 0.6);
  root.add(dragonHead);
  for (const side of [-1, 1]) {
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.18, 1.2, 5), gold);
    horn.position.copy(dragonHead.position).add(new THREE.Vector3(0, 1.0, side * 0.5));
    root.add(horn);
  }

  // ---- Temple pavilions (Đền Vua Hùng) ----
  for (let k = 0; k < 4; k++) {
    const p = claim(at(depth * (0.2 + k * 0.16), -depth * (0.3 - (k % 2) * 0.1)), 6);
    const yaw = Math.atan2(-inward.y, inward.x);
    const g = new THREE.Group();
    g.position.copy(v3(p));
    g.rotation.y = yaw;
    const hall = new THREE.Mesh(new THREE.BoxGeometry(6, 2.4, 4), new THREE.MeshStandardMaterial({ color: '#F4E3C3' }));
    hall.position.y = 1.2;
    const roof1 = new THREE.Mesh(new THREE.BoxGeometry(7.4, 0.5, 5.2), tile);
    roof1.position.y = 2.6;
    const roof2 = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.5, 3.2), tile);
    roof2.position.y = 3.5;
    g.add(hall, roof1, roof2);
    root.add(g);
  }

  // ---- Roller coaster: a closed loop with hills, on red columns ----
  const coasterC = claim(at(depth * 0.8, -depth * 0.2), 15);
  const loop = Array.from({ length: 16 }, (_, i) => {
    const a = (i / 16) * Math.PI * 2;
    const p = coasterC
      .clone()
      .addScaledVector(inward, Math.cos(a) * 13)
      .addScaledVector(across, Math.sin(a) * 7);
    return v3(p, 1.5 + (Math.sin(a * 2) * 0.5 + 0.5) * 5.5 + (i === 3 ? 3 : 0));
  });
  const coaster = new THREE.CatmullRomCurve3(loop, true);
  const coasterMat = new THREE.MeshStandardMaterial({ color: '#E8553B', roughness: 0.4 });
  root.add(new THREE.Mesh(new THREE.TubeGeometry(coaster, 160, 0.16, 6, true), coasterMat));
  for (let i = 0; i < 24; i++) {
    const p = coaster.getPointAt(i / 24);
    root.add(strut(new THREE.Vector3(p.x, 0, p.z), p, 0.08, coasterMat));
  }

  // ---- Trees ----
  const trees: { position: THREE.Vector3; scale: THREE.Vector3; color: string }[] = [];
  const xs = ring.map((p) => p.x);
  const zs = ring.map((p) => p.y);
  const minX = Math.min(...xs);
  const minZ = Math.min(...zs);
  const w = Math.max(...xs) - minX;
  const d = Math.max(...zs) - minZ;
  for (let i = 0; i < 900 && trees.length < 280; i++) {
    const x = minX + rand() * w;
    const z = minZ + rand() * d;
    const p = new THREE.Vector2(x, z);
    if (!pointInRing(x, z, ring) || isWater(x, z) || placed.some((o) => o.p.distanceTo(p) < o.r + 1)) continue;
    const s = 0.6 + rand() * 0.6;
    trees.push({
      position: new THREE.Vector3(x, 0, z),
      scale: new THREE.Vector3(s, s, s),
      color: ['#86BD7C', '#7FB574', '#9CCB8F', '#F2C94C'][Math.floor(rand() * 4)],
    });
  }
  scene.add(instanced(treeCrownGeometry(), createFoliageMaterial(), trees));

  for (const mesh of mergeByMaterial(root)) scene.add(mesh);

  // ---- Ferris wheel (spins, so it stays its own group) ----
  const wheel = new THREE.Group();
  const R = 21 * M * 2;
  const white = new THREE.MeshStandardMaterial({ color: '#F5F7FA', roughness: 0.5 });
  wheel.add(
    new THREE.Mesh(new THREE.TorusGeometry(R, 0.14, 6, 64), createNightLightMaterial('#F25F8B', [1, 0.4, 0.6], 0.15))
  );
  const podMats = ['#F2C94C', '#4FB3E8', '#7BD389', '#F25F8B'].map(
    (color) => new THREE.MeshStandardMaterial({ color })
  );
  const podGeo = new THREE.BoxGeometry(0.7, 0.6, 0.7);
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    const pod = new THREE.Mesh(podGeo, podMats[i % 4]);
    pod.position.set(Math.cos(a) * R, Math.sin(a) * R, 0);
    wheel.add(pod);
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.08, R, 0.08), white);
    spoke.position.set(Math.cos(a) * R * 0.5, Math.sin(a) * R * 0.5, 0);
    spoke.rotation.z = a - Math.PI / 2;
    wheel.add(spoke);
  }
  const spinning = new THREE.Group();
  for (const mesh of mergeByMaterial(wheel, wheel)) spinning.add(mesh);
  spinning.position.copy(v3(wheelC, R + 1.2));
  spinning.rotation.y = Math.atan2(-inward.y, inward.x);
  scene.add(spinning);
  const legs = new THREE.Group();
  for (const side of [-1, 1]) {
    const foot = v3(wheelC.clone().addScaledVector(inward, side * R * 0.45), 0);
    legs.add(strut(foot, v3(wheelC, R + 1.2), 0.18, white));
  }
  for (const mesh of mergeByMaterial(legs)) scene.add(mesh);

  return {
    update(seconds: number) {
      spinning.rotation.z = seconds * 0.08;
    },
  };
}
