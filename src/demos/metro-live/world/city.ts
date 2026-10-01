import * as THREE from 'three/webgpu';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

import type { LineModel } from '../line-model';
import {
  createBuildingMaterial,
  createContactShadowMaterial,
  createFoliageMaterial,
  createGlassMaterial,
  createGlowMaterial,
  createNightLightMaterial,
  createRoadMaterial,
} from '../shaders';
import { buildBridges } from './bridges';
import { instanced, merge, mulberry32, ribbonSides, treeCrownGeometry } from './geometry';
import { buildLandmarks, LANDMARK_IDS, LANDMARK_KEEP_OUT } from './landmarks';
import { createRoads, isWater, roadClearance, sampleRoad, TUNNEL_CLEARANCE, type Road } from './layout';
import { isBuiltUp, landKindAt } from './landuse';
import {
  GridIndex,
  MAP,
  METRES_PER_UNIT,
  pointInPolygon,
  pointInRing,
  ringArea,
  segmentDistance,
  type LandKind,
  type MapBuilding,
} from './map';
import { buildSuoiTien } from './suoi-tien';
import { buildTunnels } from './tunnels';

type Box = { x: number; z: number; w: number; d: number; h: number; color: string; yaw: number };
type Tree = { x: number; z: number; s: number; color: string };

const PASTELS = [
  '#F6E7C8',
  '#F3D9D3',
  '#DCEBDD',
  '#DCE6F2',
  '#F7F3EC',
  '#EADFF0',
  '#F2E2B8',
  '#FFFFFF',
  '#F1EDE6',
  '#F4DCC2',
];
/** Near-white tints for glass towers: the curtain wall shader paints the glass itself */
const GLASS = ['#F4F8FC', '#EEF4FA', '#F7F8FA', '#EAF1F8', '#F2F5F9'];
/** Towers above this many metres get the glass curtain wall */
const TOWER_METRES = 45;
const CAMPUS = ['#EBC3A8', '#F1D2B6', '#F6E7C8'];
const INDUSTRY = ['#EEF1F4', '#E2E8EE', '#DCE6F2'];
/** Tropical street-tree greens: me, sao, dầu, xà cừ — fresh to deep */
const LEAVES = ['#8FCB7E', '#7DBF72', '#A3D48F', '#6FB46A', '#95C982', '#84C47F'];
/** Bằng lăng (lavender), muồng hoàng yến (gold) and phượng (flame), muted so they read as trees */
const BLOSSOMS = ['#C3A6DD', '#E9CF7A', '#E58A6E'];

const M = 1 / METRES_PER_UNIT;
/** How far from the line the city is built out in detail */
const CORRIDOR = 280;
/** Merged static geometry is split into tiles this big, so off-screen tiles get culled */
const TILE = 480;

/** Distance to the metro line, for the corridor and to keep the viaduct clear */
function createTrackDistance(model: LineModel) {
  const pts = model.curve.getSpacedPoints(Math.ceil(model.length / 6));
  const index = new GridIndex<{ a: THREE.Vector3; b: THREE.Vector3 }>(40);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    index.insert({ a, b }, Math.min(a.x, b.x), Math.min(a.z, b.z), Math.max(a.x, b.x), Math.max(a.z, b.z));
  }
  return (x: number, z: number, range: number) => {
    let best = range;
    index.query(x, z, range, ({ a, b }) => {
      best = Math.min(best, segmentDistance(x, z, a.x, a.z, b.x, b.z));
    });
    return best;
  };
}

/**
 * Distance to the line, precomputed on a coarse grid (one lookup per query): "is this inside the
 * corridor" is asked for every candidate house, tree and lamp, so it must be cheap
 */
function createCorridorField(model: LineModel) {
  const CELL = 12;
  const REACH = CORRIDOR + 80;
  const [x0, z0, x1, z1] = MAP.bounds;
  const cols = Math.ceil((x1 - x0) / CELL) + 1;
  const rows = Math.ceil((z1 - z0) / CELL) + 1;
  const field = new Float32Array(cols * rows).fill(Infinity);
  const pts = model.curve.getSpacedPoints(Math.ceil(model.length / 10));
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1];
    const b = pts[k];
    const c0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - REACH - x0) / CELL));
    const c1 = Math.min(cols - 1, Math.ceil((Math.max(a.x, b.x) + REACH - x0) / CELL));
    const r0 = Math.max(0, Math.floor((Math.min(a.z, b.z) - REACH - z0) / CELL));
    const r1 = Math.min(rows - 1, Math.ceil((Math.max(a.z, b.z) + REACH - z0) / CELL));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const d = segmentDistance(x0 + (c + 0.5) * CELL, z0 + (r + 0.5) * CELL, a.x, a.z, b.x, b.z);
        const i = r * cols + c;
        if (d < field[i]) field[i] = d;
      }
    }
  }
  return (x: number, z: number) => {
    const c = Math.floor((x - x0) / CELL);
    const r = Math.floor((z - z0) / CELL);
    if (c < 0 || r < 0 || c >= cols || r >= rows) return Infinity;
    return field[r * cols + c];
  };
}

/** Dev builds record how long each build step takes (read globalThis.__cityTimings) */
const timings: Record<string, number> = {};
let lastMark = 0;
const mark = (label: string) => {
  if (!__DEV__) return;
  const now = performance.now();
  if (lastMark) timings[label] = Math.round(now - lastMark);
  lastMark = now;
};

export function buildCity(scene: THREE.Scene, model: LineModel) {
  lastMark = 0;
  mark('start');
  /** Small things (rooftop clutter, trunks, lamps, signals, vehicles) dropped when seen from far away */
  const details: THREE.Object3D[] = [];
  let detailShown = true;
  const rand = mulberry32(81);
  const roads = createRoads();
  const trackDistance = createTrackDistance(model);
  mark('roads');
  const corridor = createCorridorField(model);
  const near = (x: number, z: number, range = CORRIDOR) => corridor(x, z) < range;
  const parks = MAP.green.filter((g) => g.kind === 'park' || g.kind === 'golf' || g.kind === 'forest');
  const parkIndex = new GridIndex<(typeof parks)[number]>(60);
  for (const g of parks) {
    const xs = g.outer.map((p) => p.x);
    const zs = g.outer.map((p) => p.y);
    parkIndex.insert(g, Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs));
  }
  const inPark = (x: number, z: number) => parkIndex.query(x, z, 0, (g) => pointInPolygon(x, z, g));
  const inThemePark = (x: number, z: number) =>
    (!!MAP.themePark && pointInRing(x, z, MAP.themePark)) ||
    LANDMARK_KEEP_OUT.some(([lx, lz, r]) => Math.hypot(x - lx, z - lz) < r);

  // ---- 1. Real buildings from OpenStreetMap footprints ----
  const footprints = new GridIndex<MapBuilding>(12);
  const real: (MapBuilding & { h: number; color: string })[] = [];
  for (const b of MAP.buildings) {
    const xs = b.ring.map((p) => p.x);
    const zs = b.ring.map((p) => p.y);
    footprints.insert(b, Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs));
    if (b.type === 'train_station' || b.type === 'roof' || LANDMARK_IDS.has(b.id)) continue;
    const c = b.ring[0];
    // Suối Tiên's attractions are modelled by hand
    if (MAP.themePark && pointInRing(c.x, c.y, MAP.themePark)) continue;
    if (trackDistance(c.x, c.y, 3) < 3) continue;
    real.push({ ...b, ...styleBuilding(b, rand, landKindAt(c.x, c.y)) });
  }
  const inFootprint = (x: number, z: number, pad: number) =>
    footprints.query(
      x,
      z,
      pad,
      (b) => pointInRing(x, z, b.ring) || pointInRing(x + pad, z, b.ring) || pointInRing(x, z + pad, b.ring)
    );
  scene.add(...extrudeBuildings(real));
  mark('osmBuildings');

  // ---- 2. Infill: nhà ống (tube houses) lining real streets where OSM has no footprints ----
  const boxes: Box[] = [];
  const boxIndex = new GridIndex<Box>(6);
  const boxFree = (b: Box) =>
    !boxIndex.query(
      b.x,
      b.z,
      Math.max(b.w, b.d),
      (o) => Math.hypot(o.x - b.x, o.z - b.z) < (Math.max(o.w, o.d) + Math.max(b.w, b.d)) * 0.42
    );
  for (const road of roads) {
    if (road.bridge || road.tunnel || road.osm === 'motorway') continue;
    const fronted =
      road.osm === 'local' || road.osm === 'tertiary' || road.osm === 'secondary' || road.osm === 'primary';
    if (!fronted) continue;
    for (const side of [1, -1]) {
      let s = rand() * 1.5;
      while (s < road.length) {
        const w = 0.85 + rand() * 0.55; // 4–6.5 m frontages
        s += w * 0.5;
        if (rand() < 0.1) {
          s += 1 + rand() * 2.5; // alley (hẻm)
          continue;
        }
        const p = new THREE.Vector3();
        const yaw = sampleRoad(road, s, p);
        const depth = 2.6 + rand() * 2.4;
        const off = road.halfWidth + 0.45 + depth / 2;
        const nx = Math.sin(yaw) * side;
        const nz = Math.cos(yaw) * side;
        const x = p.x + nx * off;
        const z = p.z + nz * off;
        s += w * 0.5 + 0.03;
        if (!near(x, z)) continue;
        const busy = road.osm === 'primary' || road.osm === 'secondary';
        const floors = busy ? 3 + Math.floor(rand() * rand() * 6) : 2 + Math.floor(rand() * rand() * 5);
        const b: Box = {
          x,
          z,
          w: w * 0.97,
          d: depth,
          h: (floors * 3.3 + 0.8) * M,
          color: PASTELS[Math.floor(rand() * PASTELS.length)],
          yaw,
        };
        if (
          // Only where the map shows a town (not Thủ Thiêm's cleared land, sites or industry)
          !isBuiltUp(x, z) ||
          trackDistance(x, z, 6) < 4.5 ||
          // The whole house on dry land, not just its centre
          isWater(x, z, Math.max(b.w, b.d) * 0.6 + 0.3) ||
          inPark(x, z) ||
          inThemePark(x, z) ||
          roadClearance(x, z, 6) < depth * 0.45 ||
          inFootprint(x, z, depth * 0.4) ||
          !boxFree(b)
        ) {
          continue;
        }
        boxes.push(b);
        boxIndex.insert(b, x, z, x, z);
      }
    }
  }
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  boxGeo.translate(0, 0.5, 0);
  scene.add(
    instanced(
      boxGeo,
      createBuildingMaterial(),
      boxes.map((b) => ({
        position: new THREE.Vector3(b.x, 0, b.z),
        yaw: b.yaw,
        scale: new THREE.Vector3(b.w, b.h, b.d),
        color: b.color,
      }))
    )
  );
  let from = scene.children.length;
  buildRooftops(scene, boxes, real, rand);
  details.push(...scene.children.slice(from));
  mark('infill');

  // ---- 3. Landmarks, the Suối Tiên theme park and the bridges ----
  const landmarks = buildLandmarks(scene);
  mark('landmarks');
  const suoiTien = buildSuoiTien(scene);
  mark('suoiTien');
  buildBridges(scene, roads);
  mark('bridges');
  buildTunnels(scene, roads);
  mark('tunnels');

  // ---- 4. Roads, trees, lights, traffic ----
  buildRoads(scene, roads);
  mark('roadMeshes');
  const trees = buildTrees(scene, roads, { near, trackDistance, inFootprint, inPark, inThemePark, rand });
  details.push(scene.children[scene.children.length - 1]); // trunks; crowns swap LOD below
  const lodNear = scene.children.filter((o) => o.userData.lod === 'near');
  const lodFar = scene.children.filter((o) => o.userData.lod === 'far');
  mark('trees');
  buildContactShadows(scene, boxes, real, trees);
  details.push(scene.children[scene.children.length - 1]); // soft shadows: invisible from far away
  mark('shadows');
  from = scene.children.length;
  buildStreetLights(scene, roads, near);
  mark('lights');
  const signals = buildTrafficLights(scene, roads, near);
  mark('signals');
  const traffic = buildTraffic(scene, roads, near, rand);
  details.push(...scene.children.slice(from));
  mark('traffic');

  if (__DEV__) (globalThis as { __cityTimings?: object }).__cityTimings = timings;
  return {
    roads,
    /** Level of detail: hide sub-pixel clutter beyond `distance` from the camera's focus */
    setCameraDistance(distance: number) {
      const show = distance < 470;
      if (show === detailShown) return;
      detailShown = show;
      for (const o of details) o.visible = show;
      for (const o of lodNear) o.visible = show;
      for (const o of lodFar) o.visible = !show;
    },
    update(seconds: number) {
      traffic.update(seconds);
      signals.update(seconds);
      suoiTien.update(seconds);
      landmarks.update();
    },
  };
}

/** Height and colour from OSM tags when present, otherwise from the footprint and building type */
function styleBuilding(b: MapBuilding, rand: () => number, land: LandKind | null) {
  const areaM2 = Math.abs(ringArea(b.ring)) * METRES_PER_UNIT * METRES_PER_UNIT;
  const type = b.type ?? '';
  let floors: number;
  let color = PASTELS[Math.floor(rand() * PASTELS.length)];
  if (/industrial|warehouse|factory|manufacture/.test(type) || (land === 'industrial' && !b.type)) {
    floors = 1 + rand() * 1.5;
    color = INDUSTRY[Math.floor(rand() * INDUSTRY.length)];
  } else if (/university|school|college|hospital|public|government/.test(type)) {
    floors = 3 + rand() * 5;
    color = CAMPUS[Math.floor(rand() * CAMPUS.length)];
  } else if (areaM2 > 4500) {
    // A huge untagged outline is a mall, market hall or depot, or a whole complex mapped as one
    // shape; extruding it to tower height would raise a wall across the block
    floors = 2 + rand() * 3;
  } else if (/apartments|office|commercial|hotel/.test(type) || areaM2 > 1800) {
    floors = areaM2 > 900 ? 8 + rand() * rand() * 28 : 4 + rand() * 8;
  } else if (/retail|supermarket/.test(type)) {
    floors = 2 + rand() * 3;
  } else if (areaM2 < 160) {
    floors = 2 + Math.floor(rand() * 4); // tube house
  } else {
    floors = 2 + rand() * rand() * 7;
  }
  const h = b.height ?? (floors * 3.3 + 1) * M;
  if (h * METRES_PER_UNIT > TOWER_METRES) color = GLASS[Math.floor(rand() * GLASS.length)];
  return { h, color };
}

/** Footprints extruded into walls and flat roofs, merged per tile with per-building vertex colour */
function extrudeBuildings(list: (MapBuilding & { h: number; color: string })[]) {
  const tiles = new Map<string, { pos: number[]; nor: number[]; col: number[]; glass: boolean }>();
  const c = new THREE.Color();
  for (const b of list) {
    const ring = ringArea(b.ring) > 0 ? b.ring : [...b.ring].reverse();
    const cx = ring[0].x;
    const cz = ring[0].y;
    const glass = b.h * METRES_PER_UNIT > TOWER_METRES;
    const key = `${Math.floor(cx / TILE)},${Math.floor(cz / TILE)},${glass ? 'g' : 'w'}`;
    let t = tiles.get(key);
    if (!t) tiles.set(key, (t = { pos: [], nor: [], col: [], glass }));
    c.set(b.color);
    const push = (x: number, y: number, z: number, nx: number, ny: number, nz: number) => {
      t.pos.push(x, y, z);
      t.nor.push(nx, ny, nz);
      t.col.push(c.r, c.g, c.b);
    };
    const h = b.h;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const q = ring[(i + 1) % ring.length];
      const dx = q.x - a.x;
      const dz = q.y - a.y;
      const len = Math.hypot(dx, dz) || 1;
      // Counter-clockwise ring (positive area): the outward normal is (dz, -dx)
      const nx = dz / len;
      const nz = -dx / len;
      push(a.x, 0, a.y, nx, 0, nz);
      push(q.x, h, q.y, nx, 0, nz);
      push(q.x, 0, q.y, nx, 0, nz);
      push(a.x, 0, a.y, nx, 0, nz);
      push(a.x, h, a.y, nx, 0, nz);
      push(q.x, h, q.y, nx, 0, nz);
    }
    const faces = THREE.ShapeUtils.triangulateShape(ring, []);
    for (const [i0, i1, i2] of faces) {
      const p0 = ring[i0];
      let p1 = ring[i1];
      let p2 = ring[i2];
      // Face up: (p1 - p0) × (p2 - p0) must point along +y
      if ((p1.y - p0.y) * (p2.x - p0.x) - (p1.x - p0.x) * (p2.y - p0.y) < 0) [p1, p2] = [p2, p1];
      push(p0.x, h, p0.y, 0, 1, 0);
      push(p1.x, h, p1.y, 0, 1, 0);
      push(p2.x, h, p2.y, 0, 1, 0);
    }
  }
  const material = createBuildingMaterial();
  material.vertexColors = true;
  const glassMaterial = createGlassMaterial();
  glassMaterial.vertexColors = true;
  return [...tiles.values()].map((t) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(t.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(t.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(t.col, 3));
    g.computeBoundingSphere();
    return new THREE.Mesh(g, t.glass ? glassMaterial : material);
  });
}

function buildRoads(scene: THREE.Scene, roads: Road[]) {
  const LIFT: Record<Road['osm'], number> = {
    motorway: 0.034,
    trunk: 0.032,
    primary: 0.029,
    secondary: 0.026,
    tertiary: 0.023,
    local: 0.02,
  };
  const tiles = new Map<string, THREE.BufferGeometry[]>();
  for (const r of roads) {
    if (r.points.length < 2 || r.tunnel) continue;
    const lift = LIFT[r.osm] + (r.bridge ? 0.01 : 0);
    const full = r.halfWidth + (r.osm === 'local' ? 0.25 : 0.55);
    // Fine steps, so the sidewalk can follow a shoreline instead of cutting across it
    const pts = r.bridge ? r.points : resample(r.points, 3);
    const sides = pts.map((p, i): [number, number] => {
      if (r.bridge) return [full, full];
      // Down in a tunnel cut the sidewalk stops at the retaining walls
      if (r.cut && p.y < -0.03) return [r.halfWidth + 0.28, r.halfWidth + 0.28];
      const q = pts[Math.min(pts.length - 1, i + 1)];
      const o = pts[Math.max(0, i - 1)];
      const len = Math.hypot(q.x - o.x, q.z - o.z) || 1;
      const nx = -(q.z - o.z) / len;
      const nz = (q.x - o.x) / len;
      return [dryReach(p, nx, nz, full, r.halfWidth), dryReach(p, -nx, -nz, full, r.halfWidth)];
    });
    // Trim smoothly: each side takes the narrowest of its neighbours
    const smooth = sides.map((_, i): [number, number] => {
      const a = sides[Math.max(0, i - 1)];
      const b = sides[Math.min(sides.length - 1, i + 1)];
      return [Math.min(a[0], sides[i][0], b[0]), Math.min(a[1], sides[i][1], b[1])];
    });
    const geo = ribbonSides(
      pts.map((p) => new THREE.Vector3(p.x, p.y + lift, p.z)),
      smooth,
      full
    );
    const mid = r.points[Math.floor(r.points.length / 2)];
    const key = `${Math.floor(mid.x / TILE)},${Math.floor(mid.z / TILE)}`;
    if (!tiles.has(key)) tiles.set(key, []);
    tiles.get(key)!.push(geo);
  }
  const material = createRoadMaterial();
  for (const geos of tiles.values()) {
    const g = merge(geos);
    g.computeBoundingSphere();
    scene.add(new THREE.Mesh(g, material));
  }
}

/** Points every `step` units along a polyline (keeping the original corners) */
function resample(points: THREE.Vector3[], step: number) {
  const out: THREE.Vector3[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const n = Math.floor(a.distanceTo(b) / step);
    for (let k = 1; k <= n; k++) out.push(a.clone().lerp(b, k / (n + 1)));
    out.push(b);
  }
  return out;
}

/** How far a road may reach from its centre line along (nx, nz) before it would be over water */
function dryReach(p: THREE.Vector3, nx: number, nz: number, full: number, carriageway: number) {
  const least = carriageway * 0.6;
  for (let d = full; d > least; d -= 0.2) {
    if (!isWater(p.x + nx * d, p.z + nz * d)) return d;
  }
  return least;
}

function buildRooftops(
  scene: THREE.Scene,
  boxes: Box[],
  real: { ring: THREE.Vector2[]; h: number }[],
  rand: () => number
) {
  const tanks: { position: THREE.Vector3 }[] = [];
  const units: { position: THREE.Vector3; yaw: number }[] = [];
  const gardens: { position: THREE.Vector3; yaw: number; scale: THREE.Vector3 }[] = [];
  for (const b of boxes) {
    const r = rand();
    const jitter = () => (rand() - 0.5) * 0.5;
    if (r < 0.4) {
      // Stainless water tank, the classic Saigon rooftop
      tanks.push({ position: new THREE.Vector3(b.x + jitter() * b.w, b.h, b.z + jitter() * b.d) });
    } else if (r < 0.6) {
      units.push({ position: new THREE.Vector3(b.x + jitter() * b.w, b.h, b.z + jitter() * b.d), yaw: b.yaw });
    } else if (r < 0.72) {
      gardens.push({
        position: new THREE.Vector3(b.x, b.h + 0.01, b.z),
        yaw: b.yaw,
        scale: new THREE.Vector3(b.w * 0.8, 1, b.d * 0.6),
      });
    }
  }
  for (const b of real) {
    if (rand() > 0.5) continue;
    const c = b.ring[0];
    const d = b.ring[Math.floor(b.ring.length / 2)];
    const t = 0.3 + rand() * 0.4;
    const p = new THREE.Vector3(c.x + (d.x - c.x) * t, b.h, c.y + (d.y - c.y) * t);
    if (rand() < 0.5) tanks.push({ position: p });
    else units.push({ position: p, yaw: rand() * Math.PI });
  }
  const tankGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.32, 10);
  tankGeo.rotateZ(Math.PI / 2);
  tankGeo.translate(0, 0.2, 0);
  scene.add(
    instanced(tankGeo, new THREE.MeshStandardMaterial({ color: '#DDE2E8', roughness: 0.3, metalness: 0.2 }), tanks)
  );
  const unitGeo = new THREE.BoxGeometry(0.3, 0.16, 0.24);
  unitGeo.translate(0, 0.08, 0);
  scene.add(instanced(unitGeo, new THREE.MeshStandardMaterial({ color: '#C9CFD7', roughness: 0.7 }), units));
  const gardenGeo = new THREE.BoxGeometry(1, 0.06, 1);
  gardenGeo.translate(0, 0.03, 0);
  scene.add(instanced(gardenGeo, new THREE.MeshStandardMaterial({ color: '#9CCB8F', roughness: 1 }), gardens));
}

function buildTrees(
  scene: THREE.Scene,
  roads: Road[],
  ctx: {
    near: (x: number, z: number, range?: number) => boolean;
    trackDistance: (x: number, z: number, range: number) => number;
    inFootprint: (x: number, z: number, pad: number) => boolean;
    inPark: (x: number, z: number) => boolean;
    inThemePark: (x: number, z: number) => boolean;
    rand: () => number;
  }
) {
  const { near, trackDistance, inFootprint, inThemePark, rand } = ctx;
  const trees: Tree[] = [];
  const free = (x: number, z: number) =>
    trackDistance(x, z, 4) > 3.2 &&
    !isWater(x, z, 0.5) &&
    roadClearance(x, z, 3) > 0.05 &&
    !inFootprint(x, z, 0.2) &&
    !inThemePark(x, z);
  const pick = () => {
    const k = rand();
    return k < 0.03
      ? BLOSSOMS[0]
      : k < 0.05
        ? BLOSSOMS[1]
        : k < 0.065
          ? BLOSSOMS[2]
          : LEAVES[Math.floor(rand() * LEAVES.length)];
  };

  // Street trees (sao, dầu, me) on the sidewalks of the avenues
  for (const road of roads) {
    if (road.bridge || road.tunnel || road.cut || (road.kind === 'street' && road.osm !== 'tertiary')) continue;
    // Saigon's avenues are lined with big trees every ~12 m
    for (let s = 2; s < road.length; s += 2.4 + rand() * 1.2) {
      const p = new THREE.Vector3();
      const yaw = sampleRoad(road, s, p);
      if (!near(p.x, p.z)) continue;
      const side = rand() < 0.5 ? 1 : -1;
      const off = road.halfWidth + 0.35;
      const x = p.x + Math.sin(yaw) * off * side;
      const z = p.z + Math.cos(yaw) * off * side;
      if (!free(x, z)) continue;
      trees.push({ x, z, s: 0.5 + rand() * 0.35, color: pick() });
    }
  }

  // Parks, gardens and green spaces mapped in OSM
  for (const g of MAP.green) {
    const xs = g.outer.map((p) => p.x);
    const zs = g.outer.map((p) => p.y);
    const minX = Math.min(...xs);
    const minZ = Math.min(...zs);
    const w = Math.max(...xs) - minX;
    const d = Math.max(...zs) - minZ;
    if (!near(minX + w / 2, minZ + d / 2, CORRIDOR + Math.max(w, d))) continue;
    // Parks are mostly canopy (one tree per ~10 units², ~200 m²); lawns and grass verges sparser
    const density = g.kind === 'forest' ? 0.14 : g.kind === 'park' ? 0.1 : g.kind === 'pitch' ? 0 : 0.025;
    const count = Math.min(2500, Math.abs(ringArea(g.outer)) * density);
    for (let i = 0; i < count; i++) {
      const x = minX + rand() * w;
      const z = minZ + rand() * d;
      if (!pointInPolygon(x, z, g) || !near(x, z, CORRIDOR + 60) || !free(x, z)) continue;
      trees.push({ x, z, s: 0.55 + rand() * 0.55, color: pick() });
    }
  }

  // Near LOD: a canopy of four smooth leaf puffs, in tiles so off-screen trees are culled.
  // Far LOD: one 20-triangle blob per tree for distant views (city.setCameraDistance).
  const crownItems = trees.map((t, i) => ({
    position: new THREE.Vector3(t.x, 0, t.z),
    yaw: (i * 2.399) % (Math.PI * 2),
    scale: new THREE.Vector3(t.s, t.s * (0.92 + ((i * 7) % 5) * 0.04), t.s),
    color: t.color,
  }));
  const puffs = treeCrownGeometry();
  const foliage = createFoliageMaterial();
  const tiles = new Map<string, typeof crownItems>();
  for (const it of crownItems) {
    const key = `${Math.floor(it.position.x / TILE)},${Math.floor(it.position.z / TILE)}`;
    if (!tiles.has(key)) tiles.set(key, []);
    tiles.get(key)!.push(it);
  }
  for (const items of tiles.values()) {
    const mesh = instanced(puffs, foliage, items);
    mesh.computeBoundingSphere();
    mesh.userData.lod = 'near';
    scene.add(mesh);
  }
  const blob = new THREE.IcosahedronGeometry(1.15, 0).translate(0, 1.45, 0);
  const far = instanced(blob, foliage, crownItems);
  far.userData.lod = 'far';
  far.visible = false;
  scene.add(far);
  const trunkGeo = new THREE.CylinderGeometry(0.07, 0.11, 1, 6);
  trunkGeo.translate(0, 0.5, 0);
  scene.add(
    instanced(
      trunkGeo,
      new THREE.MeshStandardMaterial({ color: '#9C8A76', roughness: 0.9 }),
      trees.map((t) => ({ position: new THREE.Vector3(t.x, 0, t.z), scale: new THREE.Vector3(t.s, t.s * 1.3, t.s) }))
    )
  );
  return trees;
}

/** Ground offset per unit of height, away from the sun (sun sits up and to the north-west) */
const SHADOW_DIR = { x: 0.5, z: -0.38 };

/**
 * Real shadow maps are unavailable here, so each building and tree gets a soft blob on the
 * ground, stretched away from the sun. One instanced quad, shaded by a TypeGPU function.
 */
function buildContactShadows(
  scene: THREE.Scene,
  boxes: Box[],
  real: { ring: THREE.Vector2[]; h: number }[],
  trees: Tree[]
) {
  const items = [
    ...boxes.map((b) => ({ x: b.x, z: b.z, w: b.w, d: b.d, h: Math.min(b.h, 8), yaw: b.yaw })),
    ...real.map((b) => {
      const xs = b.ring.map((p) => p.x);
      const zs = b.ring.map((p) => p.y);
      const minX = Math.min(...xs);
      const minZ = Math.min(...zs);
      const w = Math.max(...xs) - minX;
      const d = Math.max(...zs) - minZ;
      return { x: minX + w / 2, z: minZ + d / 2, w, d, h: Math.min(b.h, 12), yaw: 0 };
    }),
    ...trees.map((t) => ({ x: t.x, z: t.z, w: t.s * 2, d: t.s * 2, h: t.s * 2.4, yaw: 0 })),
  ];
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.rotateX(-Math.PI / 2);
  const mesh = instanced(
    geo,
    createContactShadowMaterial(),
    items.map((it) => ({
      position: new THREE.Vector3(it.x + it.h * SHADOW_DIR.x * 0.5, 0.012, it.z + it.h * SHADOW_DIR.z * 0.5),
      yaw: it.yaw,
      scale: new THREE.Vector3(it.w + it.h * 0.45 + 0.4, 1, it.d + it.h * 0.45 + 0.4),
    }))
  );
  mesh.renderOrder = 1;
  scene.add(mesh);
}

function buildStreetLights(scene: THREE.Scene, roads: Road[], near: (x: number, z: number, range?: number) => boolean) {
  const poles: { position: THREE.Vector3 }[] = [];
  const heads: { position: THREE.Vector3 }[] = [];
  const pools: { position: THREE.Vector3 }[] = [];
  for (const road of roads) {
    if (road.kind === 'street' || road.tunnel) continue;
    let side = 1;
    for (let s = 3; s < road.length; s += 8.5) {
      const p = new THREE.Vector3();
      const yaw = sampleRoad(road, s, p);
      if (!near(p.x, p.z, CORRIDOR + 40)) continue;
      const off = road.halfWidth + 0.15;
      const x = p.x + Math.sin(yaw) * off * side;
      const z = p.z + Math.cos(yaw) * off * side;
      // On the ground a pole needs dry land; on a bridge it stands on the deck
      if (!road.bridge && isWater(x, z, 0.25)) continue;
      poles.push({ position: new THREE.Vector3(x, p.y, z) });
      heads.push({ position: new THREE.Vector3(x, p.y + 1.9, z) });
      pools.push({
        position: new THREE.Vector3(x - Math.sin(yaw) * 0.8 * side, p.y + 0.045, z - Math.cos(yaw) * 0.8 * side),
      });
      if (!road.oneway) side = -side;
    }
  }
  const poleGeo = new THREE.CylinderGeometry(0.035, 0.05, 1.9, 5);
  poleGeo.translate(0, 0.95, 0);
  scene.add(instanced(poleGeo, new THREE.MeshStandardMaterial({ color: '#8F99A6' }), poles));
  scene.add(
    instanced(new THREE.SphereGeometry(0.1, 6, 6), createNightLightMaterial('#E8ECF0', [1.0, 0.82, 0.55]), heads)
  );
  const poolGeo = new THREE.PlaneGeometry(4.5, 4.5);
  poolGeo.rotateX(-Math.PI / 2);
  const poolMesh = instanced(poolGeo, createGlowMaterial([1.0, 0.72, 0.38], 0.55), pools);
  poolMesh.renderOrder = 2;
  scene.add(poolMesh);
}

/** Signals where three or more main-road ways meet (OSM splits ways at junctions) */
function buildTrafficLights(
  scene: THREE.Scene,
  roads: Road[],
  near: (x: number, z: number, range?: number) => boolean
) {
  const ends = new Map<string, { x: number; z: number; count: number; half: number }>();
  for (const r of roads) {
    if (r.bridge || r.tunnel || r.osm === 'local' || r.osm === 'motorway') continue;
    for (const p of [r.points[0], r.points[r.points.length - 1]]) {
      const key = `${Math.round(p.x)},${Math.round(p.z)}`;
      const e = ends.get(key) ?? { x: p.x, z: p.z, count: 0, half: 0 };
      e.count++;
      e.half = Math.max(e.half, r.halfWidth);
      ends.set(key, e);
    }
  }
  const spots: THREE.Vector3[] = [];
  for (const e of ends.values()) {
    if (e.count < 3 || !near(e.x, e.z)) continue;
    for (const [sx, sz] of [
      [1, 1],
      [-1, -1],
    ]) {
      const x = e.x + sx * (e.half + 0.5);
      const z = e.z + sz * (e.half + 0.5);
      if (!isWater(x, z, 0.25)) spots.push(new THREE.Vector3(x, 0, z));
    }
  }
  const poleGeo = new THREE.CylinderGeometry(0.03, 0.04, 1.2, 5).translate(0, 0.6, 0);
  scene.add(
    instanced(
      poleGeo,
      new THREE.MeshStandardMaterial({ color: '#59616C' }),
      spots.map((position) => ({ position }))
    )
  );
  const heads = instanced(
    new THREE.BoxGeometry(0.14, 0.14, 0.14),
    new THREE.MeshBasicMaterial({ color: '#FFFFFF' }),
    spots.map((p) => ({ position: new THREE.Vector3(p.x, 1.24, p.z), color: '#34C759' }))
  );
  scene.add(heads);

  const GREEN = new THREE.Color('#34C759');
  const AMBER = new THREE.Color('#FFB020');
  const RED = new THREE.Color('#FF3B30');
  let lastStep = -1;
  return {
    update(seconds: number) {
      const step = Math.floor(seconds * 4);
      if (step === lastStep) return;
      lastStep = step;
      spots.forEach((_, i) => {
        // Both poles of a junction share a phase
        const t = (seconds + Math.floor(i / 2) * 0.77) % 9;
        heads.setColorAt(i, t < 4 ? GREEN : t < 4.8 ? AMBER : RED);
      });
      if (heads.instanceColor) heads.instanceColor.needsUpdate = true;
    },
  };
}

type Vehicle = { road: Road; s: number; speed: number; lane: number; kind: 0 | 1 | 2; index: number };

/** Most vehicles are scooters; cars on the avenues; green city buses on the main roads */
const MAX_VEHICLES = 1600;

function buildTraffic(
  scene: THREE.Scene,
  roads: Road[],
  near: (x: number, z: number, range?: number) => boolean,
  rand: () => number
) {
  const vehicles: Vehicle[] = [];
  let bikes = 0;
  let cars = 0;
  let buses = 0;
  const DENSITY: Record<Road['osm'], number> = {
    motorway: 0.22,
    trunk: 0.3,
    primary: 0.3,
    secondary: 0.22,
    tertiary: 0.14,
    local: 0.05,
  };
  const candidates = roads.filter((r) =>
    near(r.points[Math.floor(r.points.length / 2)].x, r.points[Math.floor(r.points.length / 2)].z, 170)
  );
  const wanted = candidates.reduce((a, r) => a + r.length * DENSITY[r.osm], 0);
  const share = Math.min(1, MAX_VEHICLES / Math.max(1, wanted));
  for (const road of candidates) {
    const count = Math.floor(road.length * DENSITY[road.osm] * share + rand());
    for (let i = 0; i < count; i++) {
      const r = rand();
      const big = road.kind !== 'street';
      const kind: 0 | 1 | 2 = !big ? (r < 0.92 ? 0 : 1) : r < 0.7 ? 0 : r < 0.95 ? 1 : 2;
      const dir = road.oneway ? 1 : rand() < 0.5 ? 1 : -1;
      // Two-way roads drive on the right; one-way carriageways use their full width
      const lane = road.oneway
        ? (rand() - 0.5) * road.halfWidth * 1.4
        : Math.min(road.halfWidth * (0.25 + rand() * 0.6), road.halfWidth - 0.25);
      vehicles.push({
        road,
        s: rand() * road.length,
        speed: dir * (kind === 0 ? 2.2 + rand() * 1.4 : kind === 1 ? 2.8 + rand() * 1.6 : 2.2),
        lane,
        kind,
        index: kind === 0 ? bikes++ : kind === 1 ? cars++ : buses++,
      });
    }
  }

  // Motorbike: dark bike + coloured rider and helmet (instance colour)
  const bikeGeo = new THREE.BoxGeometry(0.42, 0.13, 0.11);
  bikeGeo.translate(0, 0.12, 0);
  const riderGeo = merge([
    new THREE.BoxGeometry(0.15, 0.22, 0.17).translate(-0.03, 0.3, 0),
    new THREE.BoxGeometry(0.12, 0.11, 0.12).translate(-0.02, 0.47, 0),
  ]);
  const bikeMesh = new THREE.InstancedMesh(
    bikeGeo,
    new THREE.MeshStandardMaterial({ color: '#3A3F47' }),
    Math.max(1, bikes)
  );
  const riderMesh = new THREE.InstancedMesh(
    riderGeo,
    new THREE.MeshStandardMaterial({ roughness: 0.8 }),
    Math.max(1, bikes)
  );
  const shirts = ['#F2C94C', '#E8553B', '#4FB3E8', '#FFFFFF', '#7BD389', '#F25F8B', '#2F80ED', '#F2994A'];
  const c = new THREE.Color();
  for (let i = 0; i < bikes; i++) riderMesh.setColorAt(i, c.set(shirts[Math.floor(rand() * shirts.length)]));

  const carGeo = merge([
    new RoundedBoxGeometry(1.0, 0.3, 0.42, 2, 0.08).translate(0, 0.19, 0),
    new RoundedBoxGeometry(0.56, 0.2, 0.38, 2, 0.07).translate(-0.06, 0.4, 0),
  ]);
  const carMesh = new THREE.InstancedMesh(
    carGeo,
    new THREE.MeshStandardMaterial({ roughness: 0.4 }),
    Math.max(1, cars)
  );
  const paints = ['#FFFFFF', '#F4F6F8', '#C8CED6', '#E8553B', '#2E9E58', '#2F3B48', '#F2C94C'];
  for (let i = 0; i < cars; i++) carMesh.setColorAt(i, c.set(paints[Math.floor(rand() * paints.length)]));

  const busGeo = merge([new RoundedBoxGeometry(2.6, 0.7, 0.56, 2, 0.08).translate(0, 0.42, 0)]);
  const busMesh = new THREE.InstancedMesh(
    busGeo,
    new THREE.MeshStandardMaterial({ color: '#2F9E5E', roughness: 0.5 }),
    Math.max(1, buses)
  );

  const lights = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.04, 0.05, 0.18),
    createNightLightMaterial('#FFF6D6', [1.0, 0.95, 0.75], 0.25),
    Math.max(1, vehicles.length)
  );
  bikeMesh.count = bikes;
  riderMesh.count = bikes;
  carMesh.count = cars;
  busMesh.count = buses;
  lights.count = vehicles.length;
  for (const mesh of [bikeMesh, riderMesh, carMesh, busMesh, lights]) {
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Instances move every frame; skip the stale bounding sphere and always draw
    mesh.frustumCulled = false;
  }
  scene.add(bikeMesh, riderMesh, carMesh, busMesh, lights);

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const p = new THREE.Vector3();
  const ahead = new THREE.Vector3();
  const lp = new THREE.Vector3();
  const tilt = new THREE.Quaternion();
  const zAxis = new THREE.Vector3(0, 0, 1);
  const scale = new THREE.Vector3(1, 1, 1);
  const front = [0.22, 0.5, 1.3];
  const lightY = [0.18, 0.22, 0.34];
  let last = 0;

  return {
    update(seconds: number) {
      const dt = last ? Math.min(0.1, seconds - last) : 0;
      last = seconds;
      vehicles.forEach((v, i) => {
        v.s += v.speed * dt;
        if (v.s > v.road.length) v.s -= v.road.length;
        if (v.s < 0) v.s += v.road.length;
        const yaw = sampleRoad(v.road, v.s, p);
        const dir = Math.sign(v.speed);
        // Right-hand traffic: offset to the right of the direction of travel
        p.x += Math.sin(yaw) * v.lane * dir;
        p.z += Math.cos(yaw) * v.lane * dir;
        const heading = dir > 0 ? yaw : yaw + Math.PI;
        // Pitch up and down the bridge ramps
        sampleRoad(v.road, Math.min(v.road.length, Math.max(0, v.s + dir * 0.8)), ahead);
        q.setFromAxisAngle(up, heading);
        if (v.road.bridge || v.road.tunnel || v.road.cut)
          q.multiply(tilt.setFromAxisAngle(zAxis, Math.atan2(ahead.y - p.y, 0.8)));
        // Ways end at junctions and the map edge: shrink away near the ends, then reappear
        const edge = Math.min(v.s, v.road.length - v.s);
        const fade = Math.min(1, Math.max(0.0001, (edge - 0.3) / 1.6));
        // Into the tunnel mouth and gone: past the portal the road is under cover
        const covered = v.road.tunnel && p.y < -TUNNEL_CLEARANCE;
        scale.setScalar(covered ? 0.0001 : fade);
        m.compose(p, q, scale);
        if (v.kind === 0) {
          bikeMesh.setMatrixAt(v.index, m);
          riderMesh.setMatrixAt(v.index, m);
        } else if (v.kind === 1) {
          carMesh.setMatrixAt(v.index, m);
        } else {
          busMesh.setMatrixAt(v.index, m);
        }
        lp.set(p.x + Math.cos(heading) * front[v.kind], p.y + lightY[v.kind], p.z - Math.sin(heading) * front[v.kind]);
        q.setFromAxisAngle(up, heading + Math.PI / 2);
        m.compose(lp, q, scale);
        lights.setMatrixAt(i, m);
      });
      bikeMesh.instanceMatrix.needsUpdate = true;
      riderMesh.instanceMatrix.needsUpdate = true;
      carMesh.instanceMatrix.needsUpdate = true;
      busMesh.instanceMatrix.needsUpdate = true;
      lights.instanceMatrix.needsUpdate = true;
    },
  };
}
