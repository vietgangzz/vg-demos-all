import * as THREE from 'three/webgpu';

import type { TrainState } from '../line-model';
import { merge, mulberry32 } from './geometry';
import type { PlatformSpot } from './railway';

const SHIRTS = ['#F2C94C', '#E8553B', '#4FB3E8', '#FFFFFF', '#7BD389', '#F25F8B', '#2F80ED', '#F2994A', '#9B51E0'];

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/** Overshooting ease for the "pop" when a new passenger appears */
const easeOutBack = (t: number) => {
  const c = 1.9;
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
};

/**
 * Passengers waiting on elevated platforms. When a train dwells they walk to the platform
 * edge and board (shrink away); after it leaves, new passengers pop in one by one.
 */
export function buildPassengers(scene: THREE.Scene, spots: PlatformSpot[]) {
  const rand = mulberry32(7);
  const geo = merge([
    new THREE.BoxGeometry(0.075, 0.15, 0.06).translate(0, 0.075, 0),
    new THREE.BoxGeometry(0.055, 0.055, 0.055).translate(0, 0.185, 0),
  ]);
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.8 }), spots.length);
  const c = new THREE.Color();
  const people = spots.map((spot, i) => {
    mesh.setColorAt(i, c.set(SHIRTS[Math.floor(rand() * SHIRTS.length)]));
    return { spot, stagger: rand(), sway: rand() * Math.PI * 2 };
  });
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(mesh);

  // Per station and side: progress of the train dwelling there, and when the last one left
  const stationCount = Math.max(...spots.map((s) => s.station)) + 1;
  const dwell = new Float32Array(stationCount * 2).fill(-1);
  const leftAt = new Float32Array(stationCount * 2).fill(-100);
  const next = new Float32Array(stationCount * 2);

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();

  return {
    update(seconds: number, states: TrainState[]) {
      next.fill(-1);
      for (const st of states) {
        if (st.phase !== 'dwell' || st.station >= stationCount) continue;
        // Right-hand running: a train heading towards Suối Tiên berths at the -x platform
        next[st.station * 2 + (st.dir === 1 ? 1 : 0)] = st.progress;
      }
      for (let i = 0; i < next.length; i++) {
        if (dwell[i] >= 0 && next[i] < 0) leftAt[i] = seconds;
        dwell[i] = next[i];
      }

      people.forEach((person, i) => {
        const { spot, stagger } = person;
        const slot = spot.station * 2 + (spot.side === 1 ? 0 : 1);
        const prog = dwell[slot];
        let walk = 0;
        let scale = 1;
        if (prog >= 0) {
          walk = smooth(0.12 + stagger * 0.25, 0.38 + stagger * 0.25, prog);
          scale = 1 - smooth(0.42 + stagger * 0.25, 0.55 + stagger * 0.25, prog);
        } else {
          const since = seconds - leftAt[slot] - 1.5 - stagger * 6;
          scale = since < 0 ? 0 : since > 0.45 ? 1 : easeOutBack(since / 0.45);
        }
        p.lerpVectors(spot.home, spot.edge, walk);
        // Idle shuffle: a tiny sway while waiting
        const sway = Math.sin(seconds * 1.3 + person.sway) * 0.15 * (1 - walk);
        q.setFromAxisAngle(up, person.sway + sway);
        s.setScalar(Math.max(0.0001, scale));
        m.compose(p, q, s);
        mesh.setMatrixAt(i, m);
      });
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}
