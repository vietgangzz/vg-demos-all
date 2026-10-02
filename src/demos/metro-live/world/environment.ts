import * as THREE from 'three/webgpu';

import type { LineModel } from '../line-model';
import {
  createGlowMaterial,
  createGroundMaterial,
  createLawnMaterial,
  createNightLightMaterial,
  createWaterAreaMaterial,
} from '../shaders';
import { merge, ribbonGeometry, ribbonSides } from './geometry';
import { createWaterways } from './layout';
import { isWaterArea, MAP, type LandKind, type MapPolygon } from './map';

/** Flat polygon on the ground (OSM rings are x/z; shapes are x/y, hence the flipped z) */
function polygonGeometry(poly: MapPolygon, y: number) {
  const shape = new THREE.Shape(poly.outer.map((p) => new THREE.Vector2(p.x, -p.y)));
  for (const h of poly.holes) shape.holes.push(new THREE.Path(h.map((p) => new THREE.Vector2(p.x, -p.y))));
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(-Math.PI / 2);
  g.translate(0, y, 0);
  return g;
}

/** Ground, OSM parks and green spaces, the Saigon River and every canal and lake, boats and birds */
export function buildEnvironment(scene: THREE.Scene, model: LineModel) {
  const [minX, minZ, maxX, maxZ] = MAP.bounds;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(maxX - minX + 800, maxZ - minZ + 800), createGroundMaterial());
  ground.rotation.x = -Math.PI / 2;
  ground.position.set((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
  // The ground and the flat land layers paint first and write no depth: they never hide anything,
  // so the open cuts down to the road tunnels show through, and the layers can't z-fight
  const flat = (mesh: THREE.Mesh, order: number) => {
    (mesh.material as THREE.Material).depthWrite = false;
    mesh.renderOrder = order;
    return mesh;
  };
  scene.add(flat(ground, -10));

  // Land use tints: building sites, cleared land, fields, wetland, industry
  const LAND: Partial<Record<LandKind, string>> = {
    site: '#EADFC8',
    open: '#ECE4D3',
    field: '#DDE8C9',
    wetland: '#CFE3D6',
    closed: '#E2E5DC',
    industrial: '#E4E6EA',
  };
  const lands = new Map<LandKind, THREE.BufferGeometry[]>();
  for (const l of MAP.landuse) {
    if (!LAND[l.kind]) continue;
    if (!lands.has(l.kind)) lands.set(l.kind, []);
    lands.get(l.kind)!.push(polygonGeometry(l, 0.004));
  }
  for (const [kind, geos] of lands) {
    scene.add(
      flat(new THREE.Mesh(merge(geos), new THREE.MeshStandardMaterial({ color: LAND[kind], roughness: 1 })), -9)
    );
  }

  const GREEN: Record<string, string> = {
    park: '#D2E7D0',
    forest: '#BFDDB8',
    golf: '#C9E6BF',
    grass: '#DCEDD6',
    pitch: '#BFE0B0',
  };
  const byKind = new Map<string, THREE.BufferGeometry[]>();
  for (const g of MAP.green) {
    if (!byKind.has(g.kind)) byKind.set(g.kind, []);
    byKind.get(g.kind)!.push(polygonGeometry(g, g.kind === 'pitch' ? 0.01 : 0.008));
  }
  for (const [kind, geos] of byKind) {
    const mesh = new THREE.Mesh(
      merge(geos),
      createLawnMaterial(GREEN[kind] ?? GREEN.grass, kind === 'golf' || kind === 'pitch')
    );
    scene.add(flat(mesh, kind === 'pitch' ? -7 : -8));
  }

  // Water areas and canal ribbons share one world-space material, so they meet seamlessly
  const water = createWaterAreaMaterial();
  scene.add(new THREE.Mesh(merge(MAP.water.map((w) => polygonGeometry(w, 0.02))), water));

  // Canals and creeks mapped only as centre lines: a water ribbon, narrowed beside roads (layout.ts)
  const canals = createWaterways().map((w) =>
    ribbonSides(
      w.points.map((p) => new THREE.Vector3(p.x, 0.016, p.y)),
      w.halves.map((h): [number, number] => [h, h]),
      Math.max(...w.halves)
    )
  );
  if (canals.length) scene.add(new THREE.Mesh(merge(canals), water));

  // Riverside promenade: a pale embankment line along the shores of the big water areas
  const bankMat = new THREE.MeshStandardMaterial({ color: '#E6EBF0', roughness: 1 });
  const banks: THREE.BufferGeometry[] = [];
  for (const w of MAP.water) {
    if (w.outer.length < 40) continue;
    const ring = [...w.outer, w.outer[0]];
    // Only real shores: skip edges where another water area continues on the far side (the
    // Saigon River is mapped as several pieces) and edges cut by the map boundary
    let run: THREE.Vector3[] = [];
    const flush = () => {
      if (run.length > 1) banks.push(ribbonGeometry(run, 0.35));
      run = [];
    };
    for (let i = 1; i < ring.length; i++) {
      const a = ring[i - 1];
      const b = ring[i];
      const len = a.distanceTo(b) || 1;
      const mx = (a.x + b.x) / 2;
      const mz = (a.y + b.y) / 2;
      const nx = -(b.y - a.y) / len;
      const nz = (b.x - a.x) / len;
      const seam = isWaterArea(mx + nx * 0.9, mz + nz * 0.9) && isWaterArea(mx - nx * 0.9, mz - nz * 0.9);
      const edge =
        [a, b].every((p) => Math.abs(p.x - minX) < 0.5 || Math.abs(p.x - maxX) < 0.5) ||
        [a, b].every((p) => Math.abs(p.y - minZ) < 0.5 || Math.abs(p.y - maxZ) < 0.5);
      if (seam || edge) {
        flush();
        continue;
      }
      if (!run.length) run.push(new THREE.Vector3(a.x, 0.024, a.y));
      run.push(new THREE.Vector3(b.x, 0.024, b.y));
    }
    flush();
  }
  if (banks.length) scene.add(new THREE.Mesh(merge(banks), bankMat));

  const boats = buildBoats(scene, model);
  const birds = buildBirds(scene, model);
  return {
    update(seconds: number, night: number) {
      boats.update(seconds);
      birds.update(seconds, night);
    },
    /** Boats are a few pixels from far away: skip their draw calls */
    setDetail(show: boolean) {
      boats.setVisible(show);
    },
  };
}

/** A loose flock circling over the river by day; they roost (fade out) at night */
function buildBirds(scene: THREE.Scene, model: LineModel) {
  // Circle over the river where the line crosses it, beside Cầu Sài Gòn
  const crossing = new THREE.Vector3();
  model.curve.getPointAt(model.stationU[4] + (model.stationU[5] - model.stationU[4]) * 0.5, crossing);
  const wing = new THREE.BoxGeometry(0.3, 0.02, 0.09);
  const geo = merge([
    wing.clone().translate(0.08, 0, 0).rotateZ(0.35),
    wing.clone().translate(-0.08, 0, 0).rotateZ(-0.35),
  ]);
  const count = 16;
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: '#4A5260' }), count);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(mesh);
  const birds = Array.from({ length: count }, (_, i) => ({
    phase: (i / count) * 0.9 + Math.sin(i * 7.1) * 0.08,
    radius: 22 + Math.sin(i * 3.3) * 5,
    height: 12 + Math.sin(i * 5.7) * 2,
    flap: i * 1.37,
  }));
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  return {
    update(seconds: number, night: number) {
      birds.forEach((b, i) => {
        const a = seconds * 0.16 + b.phase * Math.PI * 2;
        p.set(
          crossing.x + Math.cos(a) * b.radius,
          b.height + Math.sin(seconds * 0.9 + b.flap) * 0.4,
          crossing.z + Math.sin(a) * b.radius * 0.7
        );
        e.set(0, -a, 0);
        q.setFromEuler(e);
        const flap = 0.55 + 0.45 * Math.sin(seconds * 9 + b.flap);
        s.set(1, Math.max(0.001, flap), 1).multiplyScalar(Math.max(0.0001, 1 - night));
        m.compose(p, q, s);
        mesh.setMatrixAt(i, m);
      });
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}

type Boat = { group: THREE.Group; u: number; speed: number; lane: number };

function buildBoats(scene: THREE.Scene, model: LineModel) {
  const hullDark = new THREE.MeshStandardMaterial({ color: '#5B6470', roughness: 0.7 });
  const hullWhite = new THREE.MeshStandardMaterial({ color: '#F4F6F8', roughness: 0.5 });
  const sand = new THREE.MeshStandardMaterial({ color: '#D9C49A', roughness: 1 });
  const roofBlue = new THREE.MeshStandardMaterial({ color: '#3D7BD9', roughness: 0.5 });
  const cabinGlow = createNightLightMaterial('#FFFFFF', [1, 0.85, 0.55]);
  const wakeMat = createGlowMaterial([0.95, 0.98, 1], 0.12, 0.28);

  const makeBarge = () => {
    const g = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.16, 0.62), hullDark);
    hull.position.y = 0.08;
    const cargo = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.16, 0.48), sand);
    cargo.position.set(0.15, 0.22, 0);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.24, 0.42), cabinGlow);
    cabin.position.set(-0.92, 0.28, 0);
    g.add(hull, cargo, cabin);
    return g;
  };
  const makeFerry = () => {
    const g = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.18, 0.52), hullWhite);
    hull.position.y = 0.09;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.24, 0.44), cabinGlow);
    cabin.position.set(-0.05, 0.3, 0);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.05, 0.5), roofBlue);
    roof.position.set(-0.05, 0.45, 0);
    g.add(hull, cabin, roof);
    return g;
  };

  // Speeds in units per second along the river, turned into curve parameter rates
  const riverLength = model.river.getLength();
  const boats: Boat[] = Array.from({ length: 12 }, (_, i) => {
    const barge = i % 3 !== 1;
    const speed = (barge ? 1.6 : 3.2) * (i % 2 ? 1 : -1);
    return {
      group: barge ? makeBarge() : makeFerry(),
      u: (i + 0.37) / 12,
      speed: speed / riverLength,
      lane: (i % 2 ? 1 : -1) * (6 + (i % 4) * 3),
    };
  });
  boats.forEach((b) => {
    b.group.scale.setScalar(3);
    const wake = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.7), wakeMat);
    wake.rotation.x = -Math.PI / 2;
    wake.position.set(-1.9, 0.03, 0);
    b.group.add(wake);
    scene.add(b.group);
  });

  const p = new THREE.Vector3();
  const tan = new THREE.Vector3();
  let last = 0;
  return {
    update(seconds: number) {
      const dt = last ? Math.min(0.1, seconds - last) : 0;
      last = seconds;
      boats.forEach((b) => {
        b.u = (((b.u + b.speed * dt) % 1) + 1) % 1;
        model.river.getPointAt(b.u, p);
        model.river.getTangentAt(b.u, tan);
        const dir = Math.sign(b.speed);
        b.group.position.set(p.x + -tan.z * b.lane, 0.02, p.z + tan.x * b.lane);
        b.group.rotation.y = Math.atan2(-tan.z * dir, tan.x * dir);
      });
    },
    setVisible(show: boolean) {
      for (const b of boats) b.group.visible = show;
    },
  };
}
