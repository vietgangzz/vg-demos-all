import * as THREE from 'three/webgpu';

import {
  createBeaconMaterial,
  createBuildingMaterial,
  createNightLightMaterial,
  createWaterMaterial,
} from '../shaders';
import { mergeByMaterial } from './geometry';
import { MAP, METRES_PER_UNIT, type MapBuilding } from './map';

const M = 1 / METRES_PER_UNIT;

const find = (test: (b: MapBuilding) => boolean) => MAP.buildings.find(test);
const LANDMARK_81 = find((b) => (b.height ?? 0) * METRES_PER_UNIT > 400);
const BITEXCO = find((b) => b.name === 'Bitexco Financial Tower');
const BEN_THANH_MARKET = find((b) => b.name === 'Chợ Bến Thành');
const OPERA = find((b) => b.name === 'Nhà hát Thành phố');

/** Ground kept clear of infill houses and trees around the landmarks: x, z, radius */
export const LANDMARK_KEEP_OUT: [number, number, number][] = [];

/** OSM footprints replaced by hand-built models (skipped by the generic extrusion) */
export const LANDMARK_IDS = new Set([LANDMARK_81, BITEXCO, BEN_THANH_MARKET, OPERA].filter(Boolean).map((b) => b!.id));

/** Oriented box around a footprint: centre, unit axis along its longest edge, and extents */
function frame(ring: THREE.Vector2[]) {
  let best = 0;
  const axis = new THREE.Vector2(1, 0);
  for (let i = 0; i < ring.length; i++) {
    const e = ring[(i + 1) % ring.length].clone().sub(ring[i]);
    if (e.length() > best) {
      best = e.length();
      axis.copy(e).normalize();
    }
  }
  const side = new THREE.Vector2(-axis.y, axis.x);
  let a0 = Infinity;
  let a1 = -Infinity;
  let s0 = Infinity;
  let s1 = -Infinity;
  for (const p of ring) {
    a0 = Math.min(a0, p.dot(axis));
    a1 = Math.max(a1, p.dot(axis));
    s0 = Math.min(s0, p.dot(side));
    s1 = Math.max(s1, p.dot(side));
  }
  const center = axis
    .clone()
    .multiplyScalar((a0 + a1) / 2)
    .add(side.clone().multiplyScalar((s0 + s1) / 2));
  return { center, axis, length: a1 - a0, width: s1 - s0 };
}

/** A group placed at a footprint, local +x along `facing`, local z across */
function place(center: THREE.Vector2, facing: THREE.Vector2) {
  const g = new THREE.Group();
  g.position.set(center.x, 0, center.y);
  g.rotation.y = Math.atan2(-facing.y, facing.x);
  return g;
}

const box = (w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y + h / 2, z);
  return m;
};

for (const b of [LANDMARK_81, BITEXCO, BEN_THANH_MARKET, OPERA]) {
  if (!b) continue;
  const f = frame(b.ring);
  LANDMARK_KEEP_OUT.push([f.center.x, f.center.y, Math.max(f.length, f.width) * 0.6]);
}
if (OPERA) {
  // Lam Sơn Square in front of the façade
  const f = frame(OPERA.ring);
  const toOrigin = f.center.clone().negate().normalize();
  const facing = f.axis.dot(toOrigin) > 0 ? f.axis.clone() : f.axis.clone().negate();
  const square = f.center.clone().addScaledVector(facing, f.length / 2 + f.width * 0.75);
  LANDMARK_KEEP_OUT.push([square.x, square.y, f.width * 0.95]);
}

export function buildLandmarks(scene: THREE.Scene) {
  const root = new THREE.Group();
  if (OPERA) root.add(buildOperaHouse(OPERA));
  if (LANDMARK_81) root.add(buildLandmark81(LANDMARK_81));
  if (BITEXCO) root.add(buildBitexco(BITEXCO));
  if (BEN_THANH_MARKET) root.add(buildMarket(BEN_THANH_MARKET));
  root.updateMatrixWorld(true);
  for (const mesh of mergeByMaterial(root)) scene.add(mesh);

  // The fountain on Lam Sơn Square ripples on its own mesh (the water shader animates)
  return { update() {} };
}

/**
 * Nhà hát Thành phố (1900, Félix Olivier, after the Petit Palais): cream Flamboyant façade on
 * Lam Sơn Square with three arched entrances, a balustraded balcony, the great arched window
 * under a curved pediment, two corner pavilions with slate mansard caps, caryatids by the
 * door, the lyre angels on top, and the main hall and stage house behind.
 */
function buildOperaHouse(b: MapBuilding) {
  const f = frame(b.ring);
  // The façade faces Lam Sơn Square, at the end of Lê Lợi towards Bến Thành (the origin)
  const toOrigin = f.center.clone().negate().normalize();
  const facing = f.axis.dot(toOrigin) > 0 ? f.axis.clone() : f.axis.clone().negate();
  const g = place(f.center, facing);
  const L = f.length;
  const W = f.width;
  const H = (b.height ?? 26 * M) * 0.92;

  // Floodlit cream stone at night
  const stone = createNightLightMaterial('#F4EAD5', [0.55, 0.42, 0.24], 0);
  const trim = new THREE.MeshStandardMaterial({ color: '#FBF6EC', roughness: 0.5 });
  const slate = new THREE.MeshStandardMaterial({ color: '#6F8597', roughness: 0.6 });
  const glass = createNightLightMaterial('#5F6F80', [1.0, 0.78, 0.42], 0.05);
  const gold = new THREE.MeshStandardMaterial({ color: '#D9B25C', roughness: 0.35, metalness: 0.5 });
  const paving = new THREE.MeshStandardMaterial({ color: '#EDE4D3', roughness: 0.9 });

  const front = L / 2;
  // Main hall and the taller stage house behind it
  g.add(box(L * 0.62, H * 0.82, W * 0.84, stone, -L * 0.05, 0, 0));
  g.add(box(L * 0.3, H * 1.02, W * 0.72, stone, -L * 0.34, 0, 0));
  g.add(box(L * 0.58, H * 0.1, W * 0.74, slate, -L * 0.05, H * 0.82, 0));
  // Façade block
  const fd = L * 0.2;
  const fx = front - fd / 2;
  g.add(box(fd, H * 0.78, W, stone, fx, 0, 0));
  // Corner pavilions with mansard caps
  for (const side of [-1, 1]) {
    const z = side * W * 0.39;
    g.add(box(fd * 1.08, H * 0.94, W * 0.2, stone, fx + fd * 0.04, 0, z));
    const cap = new THREE.Mesh(new THREE.ConeGeometry(W * 0.15, H * 0.2, 4), slate);
    cap.position.set(fx + fd * 0.04, H * 0.94 + H * 0.1, z);
    cap.rotation.y = Math.PI / 4;
    g.add(cap);
    // Second-floor windows on the pavilions
    g.add(box(0.05, H * 0.2, W * 0.08, glass, front + fd * 0.08, H * 0.45, z));
  }
  // Central frontispiece with the great arched window under a curved pediment
  const cw = W * 0.38;
  g.add(box(fd * 1.15, H * 0.9, cw, stone, fx + fd * 0.075, 0, 0));
  const pediment = new THREE.Mesh(
    new THREE.CylinderGeometry(cw / 2, cw / 2, fd * 1.15, 20, 1, false, 0, Math.PI),
    stone
  );
  // Axis along the depth, the half-disc standing up on the frontispiece
  pediment.rotation.z = Math.PI / 2;
  pediment.position.set(fx + fd * 0.075, H * 0.9, 0);
  g.add(pediment);
  const arch = new THREE.Mesh(new THREE.CircleGeometry(cw * 0.32, 18, 0, Math.PI), glass);
  arch.rotation.y = Math.PI / 2;
  arch.position.set(front + fd * 0.155, H * 0.62, 0);
  g.add(arch);
  g.add(box(0.05, H * 0.2, cw * 0.64, glass, front + fd * 0.155, H * 0.42, 0));
  // Ground-floor portico: three arched entrances
  for (const z of [-cw * 0.32, 0, cw * 0.32]) {
    g.add(box(0.06, H * 0.22, cw * 0.2, glass, front + fd * 0.16, 0.05, z));
    const top = new THREE.Mesh(new THREE.CircleGeometry(cw * 0.1, 12, 0, Math.PI), glass);
    top.rotation.y = Math.PI / 2;
    top.position.set(front + fd * 0.165, 0.05 + H * 0.22, z);
    g.add(top);
  }
  // Balcony with balustrade across the front, and the columns between the bays
  g.add(box(fd * 0.35, 0.12, W * 0.8, trim, front + fd * 0.18, H * 0.34, 0));
  g.add(box(0.06, 0.22, W * 0.8, trim, front + fd * 0.34, H * 0.34 + 0.12, 0));
  for (let k = -3; k <= 3; k++) {
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, H * 0.42, 8), trim);
    col.position.set(front + fd * 0.22, H * 0.36 + H * 0.21, k * W * 0.11);
    g.add(col);
  }
  // Caryatids flanking the main door, the lyre angels on the pediment
  for (const side of [-1, 1]) {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 0.9, 8), trim);
    body.position.set(front + fd * 0.22, 0.5, side * cw * 0.2);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), trim);
    head.position.set(front + fd * 0.22, 1.05, side * cw * 0.2);
    g.add(body, head);
  }
  const angel = new THREE.Mesh(new THREE.ConeGeometry(0.35, 1.0, 6), gold);
  angel.position.set(fx + fd * 0.1, H * 0.9 + cw / 2 + 0.45, 0);
  const lyre = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.06, 6, 12, Math.PI), gold);
  lyre.position.set(fx + fd * 0.1, H * 0.9 + cw / 2 + 1.1, 0);
  lyre.rotation.y = Math.PI / 2;
  g.add(angel, lyre);
  // Front steps down to the square
  for (let k = 0; k < 3; k++)
    g.add(box(0.5, 0.21 - k * 0.07, cw * (1.1 - k * 0.08), trim, front + fd * 0.45 + k * 0.45));

  // Lam Sơn Square: paving and the round fountain in front of the steps
  const square = new THREE.Mesh(new THREE.CircleGeometry(W * 0.9, 40), paving);
  square.rotation.x = -Math.PI / 2;
  square.position.set(front + W * 0.75, 0.015, 0);
  g.add(square);
  const basin = new THREE.Mesh(new THREE.TorusGeometry(W * 0.16, 0.12, 6, 32), trim);
  basin.rotation.x = Math.PI / 2;
  basin.position.set(front + W * 0.8, 0.12, 0);
  const pool = new THREE.Mesh(new THREE.CircleGeometry(W * 0.16, 32), createWaterMaterial());
  pool.rotation.x = -Math.PI / 2;
  pool.position.set(front + W * 0.8, 0.1, 0);
  const jet = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.14, 0.8, 6),
    createNightLightMaterial('#EAF6FF', [0.5, 0.8, 1.0], 0.15)
  );
  jet.position.set(front + W * 0.8, 0.5, 0);
  g.add(basin, pool, jet);
  return g;
}

/** Landmark 81: the stacked, stepped glass tower on the river in Bình Thạnh (461 m) */
function buildLandmark81(b: MapBuilding) {
  const f = frame(b.ring);
  const g = place(f.center, f.axis);
  const size = Math.min(f.length, f.width) * 0.95;
  const H = b.height ?? 461 * M;
  const tower = createBuildingMaterial();
  const white = new THREE.MeshStandardMaterial({ color: '#F5F7FA', roughness: 0.5 });
  const crown = createNightLightMaterial('#E8EEF5', [0.6, 0.8, 1.0], 0.05);
  // Nine bundled tubes rising to different heights read as a stack of setbacks
  const tiers = [
    [1, 0.3],
    [0.86, 0.22],
    [0.73, 0.16],
    [0.6, 0.12],
    [0.46, 0.08],
    [0.32, 0.06],
  ];
  let y = 0;
  for (const [s, h] of tiers) {
    g.add(box(size * s, H * h, size * s, tower, 0, y, 0));
    y += H * h;
  }
  g.add(box(size * 0.34, H * 0.012, size * 0.34, crown, 0, y, 0));
  const spire = new THREE.Mesh(new THREE.ConeGeometry(size * 0.08, H - y, 8), white);
  spire.position.set(0, y + (H - y) / 2, 0);
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 8), createBeaconMaterial([1, 0.25, 0.25]));
  light.position.set(0, H + 0.3, 0);
  g.add(spire, light);
  return g;
}

/** Bitexco Financial Tower: the lotus-bud tower with its helipad at the 52nd floor (262 m) */
function buildBitexco(b: MapBuilding) {
  const f = frame(b.ring);
  const g = place(f.center, f.axis);
  const r = Math.min(f.length, f.width) * 0.5;
  const H = 262 * M;
  const glass = createBuildingMaterial();
  const white = new THREE.MeshStandardMaterial({ color: '#F5F7FA', roughness: 0.5 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.45, r, H, 28), glass);
  body.scale.set(f.length / f.width > 1 ? 1.25 : 1, 1, 1);
  body.position.y = H / 2;
  const helipad = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.95, r * 0.95, 0.4, 28), white);
  helipad.position.set(r * 0.55, H * 0.73, 0);
  helipad.rotation.z = -0.12;
  const tip = new THREE.Mesh(new THREE.ConeGeometry(r * 0.45, H * 0.06, 20), white);
  tip.position.y = H + H * 0.03;
  g.add(body, helipad, tip);
  return g;
}

/** Chợ Bến Thành: the 1914 market hall with its clock tower over the south gate */
function buildMarket(b: MapBuilding) {
  const f = frame(b.ring);
  const g = place(f.center, f.axis);
  const wall = new THREE.MeshStandardMaterial({ color: '#F1E4C8' });
  const roof = new THREE.MeshStandardMaterial({ color: '#C9663F' });
  const tower = new THREE.MeshStandardMaterial({ color: '#EBD9B4' });
  const face = createNightLightMaterial('#FFFFFF', [1, 0.95, 0.8], 0.1);
  const h = 11 * M;
  g.add(box(f.length * 0.96, h, f.width * 0.96, wall));
  g.add(box(f.length * 0.84, 0.7, f.width * 0.8, roof, 0, h, 0));
  g.add(box(f.length * 0.5, 0.7, f.width * 0.3, roof, 0, h + 0.7, 0));
  // Clock tower on the gate facing the roundabout (towards the station)
  const toStation = f.center.clone().negate();
  const along = toStation.dot(f.axis) > 0 ? 1 : -1;
  const tx = along * f.length * 0.5;
  g.add(box(1.6, 28 * M, 1.6, tower, tx, 0, 0));
  const cap = new THREE.Mesh(new THREE.ConeGeometry(1.25, 1.4, 4), roof);
  cap.position.set(tx, 28 * M + 0.7, 0);
  cap.rotation.y = Math.PI / 4;
  const clock = new THREE.Mesh(new THREE.CircleGeometry(0.45, 16), face);
  clock.position.set(tx + along * 0.81, 28 * M - 1, 0);
  clock.rotation.y = along * (Math.PI / 2);
  g.add(cap, clock);
  return g;
}
