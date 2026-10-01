import * as THREE from 'three/webgpu';

import { createBeaconMaterial, createNightLightMaterial } from '../shaders';
import { mergeByMaterial, ribbonGeometry, skirtGeometry } from './geometry';
import { isWater, type Road } from './layout';
import { METRES_PER_UNIT } from './map';

const M = 1 / METRES_PER_UNIT;

/** A cylinder from a to b */
export function strut(a: THREE.Vector3, b: THREE.Vector3, radius: number, material: THREE.Material, radiusB = radius) {
  const len = a.distanceTo(b);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radiusB, radius, len, 6, 1), material);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return mesh;
}

/**
 * Bridge structure under every OSM bridge way: box girder, parapets and piers (river bridges
 * stand on piers in the water, flyovers on single columns). Cầu Ba Son also gets its curved
 * pylon and stay cables.
 */
export function buildBridges(scene: THREE.Scene, roads: Road[]) {
  const concrete = new THREE.MeshStandardMaterial({ color: '#D9DEE5', roughness: 0.85, side: THREE.DoubleSide });
  const parapet = new THREE.MeshStandardMaterial({ color: '#F2F4F7', roughness: 0.6, side: THREE.DoubleSide });
  const root = new THREE.Group();
  const pierGeo = new THREE.CylinderGeometry(0.32, 0.4, 1, 10);
  pierGeo.translate(0, 0.5, 0);

  for (const road of roads) {
    if (!road.bridge) continue;
    const deck = road.points.filter((p) => p.y > 0.06);
    if (deck.length < 2) continue;
    const half = road.halfWidth + 0.55;
    const big = road.bridge.overWater;
    const depth = big ? 0.6 : 0.4;
    const top = deck.map((p) => new THREE.Vector3(p.x, p.y + 0.03, p.z));
    root.add(new THREE.Mesh(skirtGeometry(top, half, depth), concrete));
    root.add(
      new THREE.Mesh(
        ribbonGeometry(
          top.map((p) => p.clone().setY(p.y - depth)),
          half
        ),
        concrete
      )
    );
    root.add(
      new THREE.Mesh(
        skirtGeometry(
          top.map((p) => p.clone().setY(p.y + 0.26)),
          half,
          0.26
        ),
        parapet
      )
    );

    // Piers every ~36 m under the deck, set out across its width on wide decks
    let next = 6;
    let s = 0;
    for (let i = 1; i < deck.length; i++) {
      s += deck[i].distanceTo(deck[i - 1]);
      if (s < next) continue;
      next = s + 8;
      const p = deck[i];
      if (p.y - depth < 0.35) continue;
      const q = deck[i - 1];
      const tx = p.x - q.x;
      const tz = p.z - q.z;
      const len = Math.hypot(tx, tz) || 1;
      const columns = road.halfWidth > 2 ? [-0.55, 0.55] : [0];
      for (const c of columns) {
        const x = p.x + (-tz / len) * road.halfWidth * c;
        const z = p.z + (tx / len) * road.halfWidth * c;
        const pier = new THREE.Mesh(pierGeo, concrete);
        pier.position.set(x, isWater(x, z) ? -0.2 : 0, z);
        pier.scale.set(big ? 1.2 : 0.8, p.y - depth + 0.2, big ? 1.2 : 0.8);
        root.add(pier);
      }
      // Cap beam across the deck
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, half * 1.7), concrete);
      cap.position.set(p.x, p.y - depth - 0.15, p.z);
      cap.rotation.y = Math.atan2(-tz, tx);
      root.add(cap);
    }
  }

  const baSon = roads.filter((r) => r.bridge && /Cầu Ba Son/.test(r.name));
  if (baSon.length) buildBaSonPylon(root, baSon);

  for (const mesh of mergeByMaterial(root)) scene.add(mesh);
}

/**
 * Cầu Ba Son (Thủ Thiêm 2): one 113 m pylon on the Thủ Thiêm bank, curved and leaning back
 * away from the river, holding the main span with a fan of stays and anchored by back stays.
 */
function buildBaSonPylon(root: THREE.Group, ways: Road[]) {
  // The pylon stands where the deck reaches the Thủ Thiêm (east) bank
  const shore: THREE.Vector3[] = [];
  const dirs: THREE.Vector3[] = [];
  for (const w of ways) {
    const pts = w.points;
    // Orient each carriageway west → east
    const ordered = pts[0].x < pts[pts.length - 1].x ? pts : [...pts].reverse();
    let lastWater = -1;
    ordered.forEach((p, i) => {
      if (isWater(p.x, p.z)) lastWater = i;
    });
    if (lastWater < 0) continue;
    // The OSM way may stop right at the embankment: then the pylon stands at its east end
    const at = Math.min(ordered.length - 1, lastWater + 1);
    shore.push(ordered[at].clone());
    dirs.push(
      ordered[at]
        .clone()
        .sub(ordered[Math.max(0, at - 4)])
        .setY(0)
        .normalize()
    );
  }
  if (!shore.length) return;
  const base = shore.reduce((a, p) => a.add(p), new THREE.Vector3()).divideScalar(shore.length);
  const back = dirs.reduce((a, d) => a.add(d), new THREE.Vector3()).normalize();
  // Stays land on the deck at its full height, whatever the ramp does at the very end
  const deckY = Math.max(...ways.flatMap((w) => w.points.map((p) => p.y))) * 0.95;
  base.y = 0;

  const white = new THREE.MeshStandardMaterial({ color: '#F4F6F9', roughness: 0.4 });
  // Washed in cool light after dark, like the bridge's LED façade lighting
  const lit = createNightLightMaterial('#F4F6F9', [0.45, 0.65, 1.0], 0);
  const cable = new THREE.MeshStandardMaterial({ color: '#E3E7EC', roughness: 0.5 });

  const height = 113 * M;
  const curve = new THREE.QuadraticBezierCurve3(
    base.clone(),
    base
      .clone()
      .addScaledVector(back, 2.2)
      .setY(height * 0.55),
    base.clone().addScaledVector(back, 9.5).setY(height)
  );
  const segments = 14;
  for (let i = 0; i < segments; i++) {
    const a = curve.getPoint(i / segments);
    const b = curve.getPoint((i + 1) / segments);
    const r0 = THREE.MathUtils.lerp(1.3, 0.45, i / segments);
    const r1 = THREE.MathUtils.lerp(1.3, 0.45, (i + 1) / segments);
    root.add(strut(a, b, r0, i > segments * 0.55 ? lit : white, r1));
  }
  const tip = curve.getPoint(1);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 8), createBeaconMaterial([1, 0.25, 0.25]));
  beacon.position.copy(tip).setY(tip.y + 0.4);
  root.add(beacon);

  // Stays: a fan over the main span (towards the river) and back stays behind the pylon
  const across = new THREE.Vector3(-back.z, 0, back.x);
  for (let k = 0; k < 13; k++) {
    const anchor = curve.getPoint(0.5 + k * 0.038);
    for (const side of [-1, 1]) {
      const out = base
        .clone()
        .addScaledVector(back, -(5 + k * 3.1))
        .addScaledVector(across, side * 1.6)
        .setY(deckY + 0.3);
      root.add(strut(anchor, out, 0.05, cable));
    }
    if (k % 2 === 0) {
      const anchorBack = curve.getPoint(0.55 + k * 0.034);
      const tail = base
        .clone()
        .addScaledVector(back, 12 + k * 1.3)
        .setY(Math.max(0.4, deckY * 0.6));
      root.add(strut(anchorBack, tail, 0.07, cable));
    }
  }
}
