import * as THREE from 'three/webgpu';

import { createNightLightMaterial } from '../shaders';
import { mergeByMaterial } from './geometry';
import { TUNNEL_CLEARANCE, type Road } from './layout';

/** Retaining walls rise a little above the street, like the parapets along a real open cut */
const PARAPET = 0.16;

/**
 * Road tunnels and underpasses (Thủ Thiêm tunnel under the Saigon River, the Nguyễn Hữu Cảnh and
 * HC1 underpasses, Xa lộ Hà Nội's side roads…). The approach roads slope down an open cut between
 * retaining walls (layout.ts lowers them); at the portal a headwall frames the dark mouth and the
 * covered part stays underground. The ground writes no depth (environment.ts), so cuts read as holes.
 */
export function buildTunnels(scene: THREE.Scene, roads: Road[]) {
  const concrete = new THREE.MeshStandardMaterial({ color: '#EEF0F3', roughness: 0.9, side: THREE.DoubleSide });
  const headwall = new THREE.MeshStandardMaterial({ color: '#E7EAEE', roughness: 0.7 });
  const mouth = new THREE.MeshBasicMaterial({ color: '#1A1E24', side: THREE.DoubleSide });
  const lamps = createNightLightMaterial('#F2D9A0', [1.0, 0.8, 0.45], 0.25);
  const root = new THREE.Group();

  // Retaining walls along the sunken part of every approach
  for (const road of roads) {
    if (!road.cut) continue;
    const wallOff = road.halfWidth + 0.3;
    let run: number[] = [];
    const flush = () => {
      if (run.length > 1)
        for (const side of [1, -1]) root.add(new THREE.Mesh(wall(road.points, run, wallOff * side), concrete));
      run = [];
    };
    road.points.forEach((p, i) => {
      if (p.y < -0.03) run.push(i);
      else {
        if (run.length) run.push(i); // close the wall at street level
        flush();
      }
    });
    flush();
  }

  // Portals where a tunnel meets its open cut
  const cutEnds = roads.filter((r) => r.cut).flatMap((r) => [r.points[0], r.points[r.points.length - 1]]);
  for (const t of roads) {
    if (!t.tunnel || t.points.length < 2) continue;
    for (const [end, next] of [
      [t.points[0], t.points[1]],
      [t.points[t.points.length - 1], t.points[t.points.length - 2]],
    ]) {
      if (!cutEnds.some((c) => Math.hypot(c.x - end.x, c.z - end.z) < 0.3)) continue;
      const dir = new THREE.Vector3(next.x - end.x, 0, next.z - end.z).normalize();
      const width = (t.halfWidth + 0.3) * 2 + 0.3;
      const group = new THREE.Group();
      group.position.set(end.x, 0, end.z);
      group.rotation.y = Math.atan2(-dir.z, dir.x); // local +x points into the tunnel
      const lintel = new THREE.Mesh(new THREE.BoxGeometry(0.5, PARAPET + 0.4, width), headwall);
      lintel.position.set(0, PARAPET / 2 - 0.12, 0);
      const opening = new THREE.Mesh(new THREE.PlaneGeometry(width - 0.25, TUNNEL_CLEARANCE + 0.05), mouth);
      opening.rotation.y = Math.PI / 2;
      opening.position.set(0.15, -TUNNEL_CLEARANCE / 2, 0);
      group.add(lintel, opening);
      for (let k = -2; k <= 2; k++) {
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.2), lamps);
        lamp.position.set(-0.27, -0.2, (k * (width - 0.7)) / 4);
        group.add(lamp);
      }
      root.add(group);
    }
  }

  for (const mesh of mergeByMaterial(root)) scene.add(mesh);
}

/** Vertical strip from the parapet down to the road, offset `off` from the centre line */
function wall(points: THREE.Vector3[], run: number[], off: number) {
  const pos: number[] = [];
  const idx: number[] = [];
  run.forEach((i, k) => {
    const p = points[i];
    const q = points[Math.min(points.length - 1, i + 1)];
    const o = points[Math.max(0, i - 1)];
    const len = Math.hypot(q.x - o.x, q.z - o.z) || 1;
    const x = p.x + (-(q.z - o.z) / len) * off;
    const z = p.z + ((q.x - o.x) / len) * off;
    pos.push(x, PARAPET, z, x, p.y - 0.05, z);
    if (k < run.length - 1) idx.push(k * 2, k * 2 + 2, k * 2 + 1, k * 2 + 1, k * 2 + 2, k * 2 + 3);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
