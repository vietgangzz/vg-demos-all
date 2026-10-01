import * as THREE from 'three/webgpu';

/**
 * Real map of the Line 1 corridor, generated from OpenStreetMap by scripts/osm/build.mjs
 * (© OpenStreetMap contributors, ODbL). Stored in metres on a local plane centred on
 * Bến Thành (x = east, z = south); converted here to scene units.
 */
type RawMap = {
  attribution: string;
  origin: [number, number];
  bounds: [number, number, number, number];
  line: number[];
  stations: [number, number][];
  roads: { c: string; w: number; p: number[]; o?: 1; b?: number; t?: 1; n?: string }[];
  buildings: { id: number; p: number[]; h?: number; n?: string; t?: string }[];
  water: { o: number[]; i?: number[][] }[];
  rivers: { n: string; w: number; p: number[] }[];
  green: { o: number[]; i?: number[][]; k: string }[];
  themePark: number[] | null;
  landuse: { o: number[]; i?: number[][]; k: LandKind }[];
};

/**
 * OSM land use, reduced: `site` construction, `open` cleared land, `field` meadow / scrub / farmland,
 * `wetland`, `closed` military; `built` residential, commercial and similar; `industrial`
 */
export type LandKind = 'site' | 'open' | 'field' | 'wetland' | 'closed' | 'built' | 'industrial';

const RAW: RawMap = require('../data/line1-map.json');

/** Metres per scene unit. Trains, decks and houses were modelled at this scale. */
export const METRES_PER_UNIT = 4.5;
const S = 1 / METRES_PER_UNIT;

export const MAP_ATTRIBUTION = RAW.attribution;

const toPoints = (flat: number[]) => {
  const out: THREE.Vector2[] = [];
  for (let i = 0; i < flat.length; i += 2) out.push(new THREE.Vector2(flat[i] * S, flat[i + 1] * S));
  return out;
};

export type MapRoad = {
  kind: 'motorway' | 'trunk' | 'primary' | 'secondary' | 'tertiary' | 'local';
  link: boolean;
  /** Carriageway width in scene units */
  width: number;
  oneway: boolean;
  /** OSM bridge layer (1, 2…) or 0 */
  bridge: number;
  /** Road tunnel or underpass */
  tunnel: boolean;
  name: string;
  points: THREE.Vector2[];
};

const ROAD_KIND: Record<string, MapRoad['kind']> = {
  m: 'motorway',
  t: 'trunk',
  p: 'primary',
  s: 'secondary',
  r: 'tertiary',
  l: 'local',
};

export type MapPolygon = { outer: THREE.Vector2[]; holes: THREE.Vector2[][] };
export type MapBuilding = { id: number; ring: THREE.Vector2[]; height?: number; name?: string; type?: string };

export const MAP = {
  bounds: RAW.bounds.map((v) => v * S) as [number, number, number, number],
  /** Track centre line, Bến Thành → Suối Tiên, with OSM level: -1 tunnel, 1 viaduct */
  track: Array.from({ length: RAW.line.length / 3 }, (_, i) => ({
    x: RAW.line[i * 3] * S,
    z: RAW.line[i * 3 + 1] * S,
    level: RAW.line[i * 3 + 2],
  })),
  stations: RAW.stations.map(([x, z]) => new THREE.Vector2(x * S, z * S)),
  roads: RAW.roads.map((r): MapRoad => ({
    kind: ROAD_KIND[r.c[0]],
    link: r.c.endsWith('k'),
    width: r.w * S,
    oneway: r.o === 1,
    bridge: r.b ?? 0,
    tunnel: r.t === 1,
    name: r.n ?? '',
    points: toPoints(r.p),
  })),
  buildings: RAW.buildings.map((b): MapBuilding => ({
    id: b.id,
    ring: toPoints(b.p),
    height: b.h && b.h * S,
    name: b.n,
    type: b.t,
  })),
  water: RAW.water.map((w): MapPolygon => ({ outer: toPoints(w.o), holes: (w.i ?? []).map(toPoints) })),
  rivers: RAW.rivers.map((r) => ({ name: r.n, width: r.w * S, points: toPoints(r.p) })),
  green: RAW.green.map((g) => ({ kind: g.k, outer: toPoints(g.o), holes: (g.i ?? []).map(toPoints) })),
  themePark: RAW.themePark ? toPoints(RAW.themePark) : null,
  landuse: RAW.landuse.map((l) => ({ kind: l.k, outer: toPoints(l.o), holes: (l.i ?? []).map(toPoints) })),
};

// ---------------------------------------------------------------------------
// Spatial helpers
// ---------------------------------------------------------------------------

export function pointInRing(x: number, z: number, ring: THREE.Vector2[]) {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.y > z !== b.y > z && x < ((b.x - a.x) * (z - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

export function pointInPolygon(x: number, z: number, poly: { outer: THREE.Vector2[]; holes: THREE.Vector2[][] }) {
  return pointInRing(x, z, poly.outer) && !poly.holes.some((h) => pointInRing(x, z, h));
}

export function ringArea(ring: THREE.Vector2[]) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export function ringCentroid(ring: THREE.Vector2[]) {
  const c = new THREE.Vector2();
  for (const p of ring) c.add(p);
  return c.divideScalar(ring.length);
}

/** Uniform grid over bounding boxes: cheap "what is near this point" queries over thousands of items */
export class GridIndex<T> {
  private cells = new Map<number, T[]>();
  constructor(private size: number) {}
  private key(i: number, j: number) {
    return i * 100003 + j;
  }
  insert(item: T, minX: number, minZ: number, maxX: number, maxZ: number) {
    const s = this.size;
    for (let i = Math.floor(minX / s); i <= Math.floor(maxX / s); i++) {
      for (let j = Math.floor(minZ / s); j <= Math.floor(maxZ / s); j++) {
        const k = this.key(i, j);
        let list = this.cells.get(k);
        if (!list) this.cells.set(k, (list = []));
        list.push(item);
      }
    }
  }
  /** Items whose boxes touch the square of half-size `r` around (x, z); may repeat items */
  query(x: number, z: number, r: number, visit: (item: T) => boolean | void) {
    const s = this.size;
    for (let i = Math.floor((x - r) / s); i <= Math.floor((x + r) / s); i++) {
      for (let j = Math.floor((z - r) / s); j <= Math.floor((z + r) / s); j++) {
        const list = this.cells.get(this.key(i, j));
        if (!list) continue;
        for (const item of list) if (visit(item) === true) return true;
      }
    }
    return false;
  }
}

/** Distance from (x, z) to segment a–b */
export function segmentDistance(x: number, z: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz || 1;
  const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / len2));
  return Math.hypot(x - (ax + dx * t), z - (az + dz * t));
}

/** Spatial index over the OSM water areas */
const waterIndex = new GridIndex<MapPolygon>(60);
for (const w of MAP.water) {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const p of w.outer) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.y);
    maxZ = Math.max(maxZ, p.y);
  }
  waterIndex.insert(w, minX, minZ, maxX, maxZ);
}
/**
 * Coarse "maybe water" raster over the map: polygons are scan-filled into 2-unit cells, then grown
 * by one cell. Points in clear cells skip the exact polygon test, which most queries never need.
 */
const CELL = 2;
const [gx0, gz0, gx1, gz1] = MAP.bounds;
const cols = Math.ceil((gx1 - gx0) / CELL) + 1;
const rows = Math.ceil((gz1 - gz0) / CELL) + 1;
const maybeWater = (() => {
  const fill = new Uint8Array(cols * rows);
  for (const w of MAP.water) {
    const ring = [w.outer, ...w.holes];
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const p of w.outer) {
      minZ = Math.min(minZ, p.y);
      maxZ = Math.max(maxZ, p.y);
    }
    const r0 = Math.max(0, Math.floor((minZ - gz0) / CELL));
    const r1 = Math.min(rows - 1, Math.ceil((maxZ - gz0) / CELL));
    for (let r = r0; r <= r1; r++) {
      const z = gz0 + (r + 0.5) * CELL;
      // Even-odd crossings of this row against the outer ring and its holes
      const xs: number[] = [];
      for (const rg of ring) {
        for (let i = 0, j = rg.length - 1; i < rg.length; j = i++) {
          const a = rg[i];
          const b = rg[j];
          if (a.y > z !== b.y > z) xs.push(a.x + ((z - a.y) * (b.x - a.x)) / (b.y - a.y));
        }
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const c0 = Math.max(0, Math.floor((xs[k] - gx0) / CELL));
        const c1 = Math.min(cols - 1, Math.floor((xs[k + 1] - gx0) / CELL));
        fill.fill(1, r * cols + c0, r * cols + c1 + 1);
      }
    }
  }
  // Grow by one cell (plus every shoreline vertex's cell), so cells the exact test might hit are marked
  const grown = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!fill[r * cols + c]) continue;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const rr = r + dr;
          const cc = c + dc;
          if (rr >= 0 && rr < rows && cc >= 0 && cc < cols) grown[rr * cols + cc] = 1;
        }
      }
    }
  }
  for (const w of MAP.water) {
    for (const p of w.outer) {
      const c = Math.floor((p.x - gx0) / CELL);
      const r = Math.floor((p.y - gz0) / CELL);
      if (r >= 0 && r < rows && c >= 0 && c < cols) grown[r * cols + c] = 1;
    }
  }
  return grown;
})();

/** Water drawn as areas in OSM (the Saigon River, wide canals, lakes). Centre-line creeks live in layout.ts. */
export function isWaterArea(x: number, z: number) {
  const c = Math.floor((x - gx0) / CELL);
  const r = Math.floor((z - gz0) / CELL);
  if (c < 0 || r < 0 || c >= cols || r >= rows || !maybeWater[r * cols + c]) return false;
  return waterIndex.query(x, z, 0, (w) => pointInPolygon(x, z, w));
}

/** Overall heading of the line (Bến Thành → Suối Tiên) on the ground plane; the default camera follows it */
const first = MAP.stations[0];
const last = MAP.stations[MAP.stations.length - 1];
export const FORWARD = new THREE.Vector3(last.x - first.x, 0, last.y - first.y).normalize();
export const RIGHT = new THREE.Vector3(-FORWARD.z, 0, FORWARD.x);
