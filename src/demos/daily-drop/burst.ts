import * as THREE from 'three/webgpu';

import { decode, type Part } from './models';

/**
 * The burst, as simulated in Blender (scripts/blender/daily_drop_burst.py) and baked: the padlock
 * thrown apart, the chains whipped off, the lid flung open, the treasure going up and coming down,
 * everything knocking and tumbling and settling. Here it's read back: for any moment of it, where
 * each body is and how it's turned (between the baked frames, blended), the lid's angle, and the
 * knocks it makes along the way.
 */

export type Kind = 'link' | 'lock' | 'shackle' | 'coin' | 'gem';
type Data = {
  fps: number;
  frames: number;
  motion: Record<Kind, { n: number; data: string }>;
  lid: number[];
  knocks: [number, Kind, number, number, number, number][];
  link: Part;
  linkGlow: number[];
  lock: (Part & { rest: number[]; planes: number[][] })[];
  shackle: (Part & { rest: number[] })[];
  lockCentre: number[];
  burst: number;
  erupt: number;
};

const DATA = require('../../../assets/daily-drop/burst.json') as Data;

function bytes(b64: string) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

const tracks = Object.fromEntries(
  (Object.keys(DATA.motion) as Kind[]).map((k) => [k, new Int16Array(bytes(DATA.motion[k].data).buffer)])
) as Record<Kind, Int16Array>;

export const BAKE = {
  fps: DATA.fps,
  frames: DATA.frames,
  /** How long it runs, in seconds */
  duration: (DATA.frames - 1) / DATA.fps,
  /** When everything's let go (before it, the bodies are held where they are) */
  burstAt: DATA.burst,
  /** When the treasure goes up (before it, the coins and gems are hidden) */
  eruptAt: DATA.erupt,
  count: Object.fromEntries((Object.keys(DATA.motion) as Kind[]).map((k) => [k, DATA.motion[k].n])) as Record<
    Kind,
    number
  >,
  /** Every hard knock: when, what, how hard (a change of speed, m/s), where */
  knocks: DATA.knocks.map(([t, kind, strength, x, y, z]) => ({ t, kind, strength, at: new THREE.Vector3(x, y, z) })),
  /** For each link, how far along the chains it is from the padlock */
  linkGlow: new Float32Array(DATA.linkGlow),
  lockCentre: new THREE.Vector3(...DATA.lockCentre),
};

export const SHAPES = {
  link: decode(DATA.link, 'burst-link'),
  lock: DATA.lock.map((l, i) => ({
    geometry: decode(l, `burst-lock${i}`),
    rest: new THREE.Vector3(...l.rest),
    planes: l.planes,
  })),
  shackle: DATA.shackle.map((s, i) => ({
    geometry: decode(s, `burst-shackle${i}`),
    rest: new THREE.Vector3(...s.rest),
  })),
};

const q0 = new THREE.Quaternion();
const q1 = new THREE.Quaternion();

/** Where body `i` of `kind` is at time t (seconds into the bake), and how it's turned */
export function pose(kind: Kind, i: number, t: number, at: THREE.Vector3, turn: THREE.Quaternion) {
  const n = BAKE.count[kind];
  const data = tracks[kind];
  const f = Math.min(BAKE.frames - 1, Math.max(0, t * BAKE.fps));
  const f0 = Math.floor(f);
  const f1 = Math.min(BAKE.frames - 1, f0 + 1);
  const a = f - f0;
  const o0 = (f0 * n + i) * 7;
  const o1 = (f1 * n + i) * 7;
  at.set(
    (data[o0] + (data[o1] - data[o0]) * a) / 3000,
    (data[o0 + 1] + (data[o1 + 1] - data[o0 + 1]) * a) / 3000,
    (data[o0 + 2] + (data[o1 + 2] - data[o0 + 2]) * a) / 3000
  );
  // Stored w, x, y, z; kept on one side frame to frame, so a straight blend goes the short way round
  q0.set(data[o0 + 4], data[o0 + 5], data[o0 + 6], data[o0 + 3]);
  q1.set(data[o1 + 4], data[o1 + 5], data[o1 + 6], data[o1 + 3]);
  turn.set(q0.x + (q1.x - q0.x) * a, q0.y + (q1.y - q0.y) * a, q0.z + (q1.z - q0.z) * a, q0.w + (q1.w - q0.w) * a);
  return turn.normalize();
}

/** The lid's hinge angle at time t (three's: negative, open) */
export function lidAt(t: number) {
  const f = Math.min(DATA.lid.length - 1, Math.max(0, t * BAKE.fps));
  const f0 = Math.floor(f);
  const f1 = Math.min(DATA.lid.length - 1, f0 + 1);
  return DATA.lid[f0] + (DATA.lid[f1] - DATA.lid[f0]) * (f - f0);
}
