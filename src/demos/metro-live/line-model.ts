import * as THREE from 'three/webgpu';

import { STATIONS } from '@/demos/metro/line-1';

import { MAP } from './world/map';

/**
 * HCMC Metro Line 1 on its real alignment (OpenStreetMap, see world/map.ts; x = east,
 * z = south, 1 unit = 4.5 m): underground under District 1, up onto the viaduct after Ba Son,
 * across the Saigon River beside Cầu Sài Gòn, then along Xa lộ Hà Nội to Suối Tiên.
 */
export const ELEVATED_Y = 2.4;
export const SURFACE_Y = 0.06;
/** Length of the ramp between the tunnel portal and the viaduct, in units */
const RAMP = 70;

export function createLineModel() {
  const track = MAP.track;
  // Arc length of the raw polyline, to place the portal ramp
  const along: number[] = [0];
  for (let i = 1; i < track.length; i++) {
    along.push(along[i - 1] + Math.hypot(track[i].x - track[i - 1].x, track[i].z - track[i - 1].z));
  }
  const lastTunnel = track.findLastIndex((p) => p.level < 0);
  const portalAt = along[Math.max(0, lastTunnel)];
  const smooth = (x: number) => x * x * (3 - 2 * x);
  const heightAt = (s: number) => {
    const t = Math.min(1, Math.max(0, (s - portalAt) / RAMP));
    return SURFACE_Y + (ELEVATED_Y - SURFACE_Y) * smooth(t);
  };

  // Resample at even spacing so the spline has no long straight gaps, with the ramp profile in y
  const points: THREE.Vector3[] = [];
  const total = along[along.length - 1];
  const step = 12;
  let seg = 1;
  for (let s = 0; s <= total; s += step) {
    while (seg < along.length - 1 && along[seg] < s) seg++;
    const a = track[seg - 1];
    const b = track[seg];
    const t = (s - along[seg - 1]) / (along[seg] - along[seg - 1] || 1);
    points.push(new THREE.Vector3(a.x + (b.x - a.x) * t, heightAt(s), a.z + (b.z - a.z) * t));
  }
  const end = track[track.length - 1];
  points.push(new THREE.Vector3(end.x, heightAt(total), end.z));

  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  // Use one arc-length resolution everywhere so u stays within 0..1 (getPointAt relies on it)
  const divisions = Math.ceil(total / 1.5);
  curve.arcLengthDivisions = divisions;
  const length = curve.getLength();

  // Each station sits where its platform projects onto the track
  const samples = curve.getSpacedPoints(divisions);
  const nearestU = (x: number, z: number) => {
    let best = 0;
    let bestD = Infinity;
    samples.forEach((p, i) => {
      const d = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best / divisions;
  };
  const stationU = MAP.stations.map((p) => nearestU(p.x, p.y));
  const portalU = Math.min(1, (portalAt + RAMP * 0.5) / total);

  // The Saigon River's centre line, for boats and birds
  const saigon = MAP.rivers
    .filter((r) => r.name === 'Sông Sài Gòn')
    .sort((a, b) => b.points.length - a.points.length)[0];
  const river = new THREE.CatmullRomCurve3(
    saigon.points.map((p) => new THREE.Vector3(p.x, 0, p.y)),
    false,
    'centripetal'
  );

  return { curve, length, stationU, portalU, river };
}

export type LineModel = ReturnType<typeof createLineModel>;

// ---------------------------------------------------------------------------
// Timetable: trains shuttle end to end, dwelling at every station.
// Times are in real seconds, heavily sped up so the demo stays lively.
// ---------------------------------------------------------------------------

const DWELL = 5;
const TERMINUS_DWELL = 9;

type Segment =
  | { kind: 'dwell'; station: number; start: number; end: number; dir: 1 | -1 }
  | { kind: 'move'; from: number; to: number; start: number; end: number; dir: 1 | -1 };

export type TrainState = {
  /** Arc-length position along the line, 0..1 */
  u: number;
  dir: 1 | -1;
  phase: 'dwell' | 'move';
  /** Station the train is at (dwell) or heading to (move) */
  station: number;
  /** Station it left from (move) */
  from: number;
  /** 0..1 progress of the current segment */
  progress: number;
  /** Seconds until the current segment ends */
  remaining: number;
};

export function createTimetable(model: LineModel, trainCount: number) {
  const segments: Segment[] = [];
  let t = 0;
  const n = model.stationU.length;
  // Real distances at about 1.5× the real trains (80 km/h ≈ 5 units/s): quick enough to watch
  // the line work, slow enough to follow a train with your eyes
  const travel = (a: number, b: number) => 8 + (Math.abs(model.stationU[b] - model.stationU[a]) * model.length) / 7.5;

  // Each run starts by leaving a terminus (the previous run already dwelled there)
  // and ends with a longer dwell at the other terminus.
  const run = (order: number[], dir: 1 | -1) => {
    order.forEach((station, k) => {
      const isEnd = k === order.length - 1;
      if (k > 0) {
        const dwell = isEnd ? TERMINUS_DWELL : DWELL;
        segments.push({ kind: 'dwell', station, start: t, end: t + dwell, dir });
        t += dwell;
      }
      if (!isEnd) {
        const to = order[k + 1];
        const duration = travel(station, to);
        segments.push({ kind: 'move', from: station, to, start: t, end: t + duration, dir });
        t += duration;
      }
    });
  };

  const forward = Array.from({ length: n }, (_, i) => i);
  run(forward, 1);
  /** When the run back from Suối Tiên to Bến Thành leaves (after the terminus dwell) */
  const inbound = t;
  run([...forward].reverse(), -1);
  const cycle = t;

  const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

  /** Extra timetable offset per train (seconds), set by a showcase run to stage a meeting */
  const shifts = new Float64Array(trainCount);
  const stateAt = (seconds: number, train: number): TrainState => {
    const time = (((seconds + (train * cycle) / trainCount + shifts[train]) % cycle) + cycle) % cycle;
    const seg = segments.find((s) => time >= s.start && time < s.end) ?? segments[segments.length - 1];
    const progress = (time - seg.start) / (seg.end - seg.start);
    const remaining = seg.end - time;
    if (seg.kind === 'dwell') {
      return {
        u: model.stationU[seg.station],
        dir: seg.dir,
        phase: 'dwell',
        station: seg.station,
        from: seg.station,
        progress,
        remaining,
      };
    }
    const a = model.stationU[seg.from];
    const b = model.stationU[seg.to];
    return {
      u: a + (b - a) * ease(progress),
      dir: seg.dir,
      phase: 'move',
      station: seg.to,
      from: seg.from,
      progress,
      remaining,
    };
  };

  /** When a train heading `dir` leaves `station` (seconds into the cycle) */
  const departs = (station: number, dir: 1 | -1) =>
    segments.find((g) => g.kind === 'dwell' && g.station === station && g.dir === dir)?.end ?? inbound;

  /** When a train moving from station `from` to `to` passes `u` (seconds into the cycle) */
  const passes = (u: number, from: number, to: number) => {
    const seg = segments.find((g) => g.kind === 'move' && g.from === from && g.to === to);
    if (!seg || seg.kind !== 'move') return 0;
    const a = model.stationU[from];
    const b = model.stationU[to];
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if ((a + (b - a) * ease(mid) - u) * Math.sign(b - a) < 0) lo = mid;
      else hi = mid;
    }
    return seg.start + ((lo + hi) / 2) * (seg.end - seg.start);
  };
  const setShift = (train: number, seconds: number) => {
    shifts[train] = seconds;
  };

  return { stateAt, cycle, inbound, departs, passes, setShift };
}

export type Timetable = ReturnType<typeof createTimetable>;

export function stationName(i: number) {
  return STATIONS[i].name;
}
