import * as THREE from 'three/webgpu';

import { GridIndex, isWaterArea, MAP, segmentDistance, type MapRoad } from './map';

export { FORWARD, RIGHT } from './map';

export type Road = {
  points: THREE.Vector3[];
  /** Cumulative arc length at each point */
  lengths: number[];
  length: number;
  halfWidth: number;
  kind: 'highway' | 'avenue' | 'street';
  /** OSM class, for widths, traffic mix and lighting */
  osm: MapRoad['kind'];
  oneway: boolean;
  name: string;
  /** Bridge deck: the points carry the deck height in y */
  bridge?: { layer: number; overWater: boolean };
  /** Tunnel or underpass (covered): the points carry the (negative) depth in y */
  tunnel?: boolean;
  /** Approach road sloping down an open cut to a tunnel portal (y below the street) */
  cut?: boolean;
};

/** Depth of a road tunnel below the surface, the clearance at its portals and its ramp length */
export const TUNNEL_DEPTH = 1.6;
export const TUNNEL_CLEARANCE = 1.05;
const TUNNEL_RAMP = 24;

/** Deck height per OSM bridge layer, and how far the ramps reach at each end */
const LAYER_HEIGHT = 1.35;
const RAMP = 26;

const KIND: Record<MapRoad['kind'], Road['kind']> = {
  motorway: 'highway',
  trunk: 'highway',
  primary: 'avenue',
  secondary: 'avenue',
  tertiary: 'street',
  local: 'street',
};

function withLengths(points: THREE.Vector3[]) {
  const lengths = [0];
  for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1] + points[i].distanceTo(points[i - 1]));
  return { points, lengths, length: lengths[lengths.length - 1] };
}

/** Insert points so no segment is longer than `max` (keeps ramps and cambers smooth) */
function densify(points: THREE.Vector2[], max: number) {
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (i > 0) {
      const q = points[i - 1];
      const n = Math.floor(p.distanceTo(q) / max);
      for (let k = 1; k <= n; k++) {
        const t = k / (n + 1);
        out.push(new THREE.Vector3(q.x + (p.x - q.x) * t, 0, q.y + (p.y - q.y) * t));
      }
    }
    out.push(new THREE.Vector3(p.x, 0, p.y));
  }
  return out;
}

let cached: Road[] | null = null;

/** Every road in the corridor from OpenStreetMap, with bridge decks lifted over water and junctions */
export function createRoads() {
  if (cached) return cached;
  const roads: Road[] = [];
  for (const r of MAP.roads) {
    const pts = densify(r.points, r.bridge || r.tunnel ? 4 : 30);
    let bridge: Road['bridge'];
    if (r.bridge) {
      const base = withLengths(pts);
      const ramp = Math.min(RAMP, base.length * 0.35);
      const height = LAYER_HEIGHT * Math.min(r.bridge, 3);
      let overWater = false;
      pts.forEach((p, i) => {
        const s = base.lengths[i];
        const edge = Math.min(s, base.length - s);
        const t = Math.min(1, edge / ramp);
        // Eased ramps and a gentle crown over the middle, like a real vertical curve
        const crown = Math.sin((Math.PI * s) / base.length);
        p.y = height * (t * t * (3 - 2 * t)) + height * 0.12 * crown;
        if (!overWater && isWaterArea(p.x, p.z)) overWater = true;
      });
      bridge = { layer: r.bridge, overWater };
    } else if (r.tunnel) {
      // The OSM way is the covered part: portal clearance at its ends, deeper in the middle
      const base = withLengths(pts);
      const dip = Math.min(10, base.length * 0.4);
      pts.forEach((p, i) => {
        const s = base.lengths[i];
        const t = Math.min(1, Math.min(s, base.length - s) / dip);
        p.y = -(TUNNEL_CLEARANCE + (TUNNEL_DEPTH - TUNNEL_CLEARANCE) * (t * t * (3 - 2 * t)));
      });
    }
    roads.push({
      ...withLengths(pts),
      halfWidth: r.width / 2,
      kind: KIND[r.kind],
      osm: r.kind,
      oneway: r.oneway,
      name: r.name,
      bridge,
      tunnel: r.tunnel || undefined,
    });
  }
  cutApproaches(roads);
  cached = roads;
  return roads;
}

/**
 * The open cut down to each tunnel portal lies on the road leading in: lower the ground-level way
 * that meets the tunnel's end, easing from the street down to the portal clearance.
 */
function cutApproaches(roads: Road[]) {
  const ends = roads.filter((r) => r.tunnel).flatMap((t) => [t.points[0], t.points[t.points.length - 1]]);
  for (const portal of ends) {
    for (const r of roads) {
      if (r.tunnel || r.bridge) continue;
      const first = r.points[0];
      const last = r.points[r.points.length - 1];
      const atStart = Math.hypot(first.x - portal.x, first.z - portal.z) < 0.3;
      const atEnd = Math.hypot(last.x - portal.x, last.z - portal.z) < 0.3;
      if (!atStart && !atEnd) continue;
      // Fine steps along the ramp so it reads as a smooth slope
      const pts = densify(
        r.points.map((p) => new THREE.Vector2(p.x, p.z)),
        2
      );
      const base = withLengths(pts);
      const ramp = Math.min(TUNNEL_RAMP, base.length * 0.9);
      pts.forEach((p, i) => {
        const fromPortal = atStart ? base.lengths[i] : base.length - base.lengths[i];
        const t = Math.max(0, 1 - fromPortal / ramp);
        p.y = -TUNNEL_CLEARANCE * (t * t * (3 - 2 * t));
      });
      Object.assign(r, withLengths(pts), { cut: true });
    }
  }
}

type Segment = { ax: number; az: number; bx: number; bz: number; half: number; bridge: boolean };
let segmentIndex: GridIndex<Segment> | null = null;

function roadIndex() {
  if (segmentIndex) return segmentIndex;
  segmentIndex = new GridIndex<Segment>(16);
  for (const r of createRoads()) {
    // Tunnels run under whatever is above them
    if (r.tunnel) continue;
    for (let i = 1; i < r.points.length; i++) {
      const a = r.points[i - 1];
      const b = r.points[i];
      const h = r.halfWidth;
      segmentIndex.insert(
        { ax: a.x, az: a.z, bx: b.x, bz: b.z, half: h, bridge: !!r.bridge },
        Math.min(a.x, b.x) - h,
        Math.min(a.z, b.z) - h,
        Math.max(a.x, b.x) + h,
        Math.max(a.z, b.z) + h
      );
    }
  }
  return segmentIndex;
}

/**
 * Distance from a ground point to the nearest carriageway edge (negative = on the road), searched
 * within `range`. `which` limits it to roads at ground level or to bridge decks.
 */
export function roadClearance(x: number, z: number, range = 8, which: 'all' | 'ground' | 'bridges' = 'all') {
  let best = range;
  roadIndex().query(x, z, range, (s) => {
    if (which !== 'all' && s.bridge !== (which === 'bridges')) return;
    best = Math.min(best, segmentDistance(x, z, s.ax, s.az, s.bx, s.bz) - s.half);
  });
  return best;
}

// ---------------------------------------------------------------------------
// Water
// ---------------------------------------------------------------------------

/** A creek or canal OSM maps only as a centre line, with its half width at each point */
export type Waterway = { points: THREE.Vector2[]; halves: number[] };

let waterways: Waterway[] | null = null;
let waterwayIndex: GridIndex<{ a: THREE.Vector2; b: THREE.Vector2; ha: number; hb: number }> | null = null;

/**
 * Centre-line creeks and canals. OSM has no width for them, so they take a typical one, narrowed
 * wherever that would run into a road beside them: the road is surveyed, the width is a guess.
 * Under a bridge they keep their full width.
 */
export function createWaterways() {
  if (waterways) return waterways;
  waterways = MAP.rivers
    .filter((r) => r.width > 0 && r.points.length > 1)
    .map((r) => {
      const points = densify(r.points, 3).map((p) => new THREE.Vector2(p.x, p.z));
      const full = r.width / 2;
      const halves = points.map((p) => {
        if (roadClearance(p.x, p.y, full + 1, 'bridges') < full + 0.5) return full;
        return Math.max(0.35, Math.min(full, roadClearance(p.x, p.y, full + 1, 'ground') - 0.45));
      });
      return { points, halves };
    });
  waterwayIndex = new GridIndex(40);
  for (const w of waterways) {
    for (let i = 1; i < w.points.length; i++) {
      const a = w.points[i - 1];
      const b = w.points[i];
      const h = Math.max(w.halves[i - 1], w.halves[i]);
      waterwayIndex.insert(
        { a, b, ha: w.halves[i - 1], hb: w.halves[i] },
        Math.min(a.x, b.x) - h,
        Math.min(a.y, b.y) - h,
        Math.max(a.x, b.x) + h,
        Math.max(a.y, b.y) + h
      );
    }
  }
  return waterways;
}

/** Whether (x, z) is on water (area or creek), or within `margin` of a creek */
export function isWater(x: number, z: number, margin = 0) {
  if (isWaterArea(x, z)) return true;
  createWaterways();
  return waterwayIndex!.query(x, z, margin + 4, ({ a, b, ha, hb }) => {
    const dx = b.x - a.x;
    const dz = b.y - a.y;
    const t = Math.min(1, Math.max(0, ((x - a.x) * dx + (z - a.y) * dz) / (dx * dx + dz * dz || 1)));
    return Math.hypot(x - a.x - dx * t, z - a.y - dz * t) < ha + (hb - ha) * t + margin;
  });
}

/** Point and heading at arc length `s` along a road */
export function sampleRoad(road: Road, s: number, out: THREE.Vector3) {
  const { points, lengths } = road;
  let lo = 0;
  let hi = lengths.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (lengths[mid] <= s) lo = mid;
    else hi = mid;
  }
  const a = points[lo];
  const b = points[hi];
  const span = lengths[hi] - lengths[lo] || 1;
  const t = (s - lengths[lo]) / span;
  out.set(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
  return Math.atan2(-(b.z - a.z), b.x - a.x);
}
