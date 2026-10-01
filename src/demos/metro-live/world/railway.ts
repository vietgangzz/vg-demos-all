import * as THREE from 'three/webgpu';

import { LINE_1 } from '@/demos/metro/line-1';

import type { LineModel } from '../line-model';
import { createBuildingMaterial, createDeckMaterial, createNightLightMaterial, createTunnelMaterial } from '../shaders';
import { instanced, mergeByMaterial, offsetPolyline, ribbonGeometry, skirtGeometry } from './geometry';

const DECK_HALF = 1.05;
/** Double track: each direction runs on its own track, offset from the centre line */
export const TRACK_OFFSET = 0.5;

/** Platforms fit a three-car train with room to spare (real platforms take six cars) */
export const PLATFORM_LENGTH = 22;

/** Tunnel line, viaduct (deck, piers, catenary) and stations */
export function buildRailway(scene: THREE.Scene, model: LineModel) {
  // One sample every 1.5 units (~7 m) keeps curves smooth over the 20 km line
  const samples = Math.ceil(model.length / 1.5);
  const PIER_EVERY = 5; // ~34 m spans
  const MAST_EVERY = 9; // ~60 m between catenary masts
  const all = model.curve.getSpacedPoints(samples);
  const portalIndex = Math.round(model.portalU * samples);

  // Underground: dashed tunnel line on the street
  const tunnelPts = all.slice(0, portalIndex + 1).map((p) => new THREE.Vector3(p.x, 0.05, p.z));
  // Wide and soft: reads as the line running under the street from any zoom
  const tunnel = new THREE.Mesh(ribbonGeometry(tunnelPts, 1.3), createTunnelMaterial());
  tunnel.renderOrder = 1;
  scene.add(tunnel);

  // Elevated: deck + skirts, starting at the tunnel portal
  const deckPts = all.slice(portalIndex);
  const deckOffset = model.portalU * model.length;
  const deckGeometry = ribbonGeometry(deckPts, DECK_HALF);
  // Shift uv.y so it equals arc length from Bến Thành (used by the route glow)
  const uv = deckGeometry.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) + deckOffset);
  const { material: deckMaterial, uniforms } = createDeckMaterial();
  scene.add(new THREE.Mesh(deckGeometry, deckMaterial));
  scene.add(
    new THREE.Mesh(
      skirtGeometry(deckPts, DECK_HALF, 0.32),
      new THREE.MeshStandardMaterial({ color: '#DCE1E8', roughness: 0.8, side: THREE.DoubleSide })
    )
  );

  // Light concrete parapets with a line-colour coping, as on the real viaduct's branding
  const parapetMat = new THREE.MeshStandardMaterial({ color: '#EEF0F3', roughness: 0.7, side: THREE.DoubleSide });
  const stripeMat = new THREE.MeshStandardMaterial({ color: LINE_1.color, roughness: 0.5 });
  for (const side of [1, -1]) {
    const edge = offsetPolyline(deckPts, (DECK_HALF - 0.02) * side);
    const wall = skirtGeometry(
      edge.map((p) => p.clone().setY(p.y + 0.16)),
      0.0,
      0.16
    );
    scene.add(new THREE.Mesh(wall, parapetMat));
    scene.add(
      new THREE.Mesh(
        ribbonGeometry(
          edge.map((p) => p.clone().setY(p.y + 0.165)),
          0.06
        ),
        stripeMat
      )
    );
  }

  const tangentAt = (pts: THREE.Vector3[], i: number) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    return Math.atan2(-(b.z - a.z), b.x - a.x);
  };

  // Piers with T-shaped caps
  const piers: { position: THREE.Vector3; scale: THREE.Vector3 }[] = [];
  const caps: { position: THREE.Vector3; yaw: number }[] = [];
  deckPts.forEach((p, i) => {
    if (i % PIER_EVERY !== 0 || p.y < 0.9) return;
    piers.push({ position: new THREE.Vector3(p.x, 0, p.z), scale: new THREE.Vector3(1, p.y - 0.5, 1) });
    caps.push({ position: new THREE.Vector3(p.x, p.y - 0.42, p.z), yaw: tangentAt(deckPts, i) });
  });
  const pierGeo = new THREE.CylinderGeometry(0.2, 0.26, 1, 12);
  pierGeo.translate(0, 0.5, 0);
  const concrete = new THREE.MeshStandardMaterial({ color: '#E3E7ED', roughness: 0.85 });
  scene.add(instanced(pierGeo, concrete, piers));
  scene.add(instanced(new THREE.BoxGeometry(0.42, 0.2, 2.1), concrete, caps));

  // Overhead catenary: masts every few metres, cantilever arms and the contact wire
  const masts: { position: THREE.Vector3; yaw: number }[] = [];
  deckPts.forEach((p, i) => {
    if (i % MAST_EVERY !== 4 || p.y < 1.2) return;
    const yaw = tangentAt(deckPts, i);
    const side = Math.floor(i / MAST_EVERY) % 2 ? 1 : -1;
    const ox = Math.sin(yaw) * (DECK_HALF - 0.06) * side;
    const oz = Math.cos(yaw) * (DECK_HALF - 0.06) * side;
    masts.push({ position: new THREE.Vector3(p.x + ox, p.y, p.z + oz), yaw: yaw + (side > 0 ? 0 : Math.PI) });
  });
  const mastGeo = new THREE.BoxGeometry(0.05, 1.45, 0.05).translate(0, 0.72, 0);
  const armGeo = new THREE.BoxGeometry(0.03, 0.03, DECK_HALF * 1.6).translate(0, 1.38, -DECK_HALF * 0.8);
  const steel = new THREE.MeshStandardMaterial({ color: '#8F99A6', roughness: 0.5 });
  scene.add(instanced(mastGeo, steel, masts));
  scene.add(instanced(armGeo, steel, masts));
  const wireMat = new THREE.MeshBasicMaterial({ color: '#59616C' });
  for (const side of [1, -1]) {
    const wire = offsetPolyline(deckPts, TRACK_OFFSET * side).map((p) => p.setY(p.y + 1.3));
    scene.add(new THREE.Mesh(ribbonGeometry(wire, 0.012), wireMat));
  }

  const { anchors: stationAnchors, spots: platformSpots } = buildStations(scene, model);
  return { deckUniforms: uniforms, stationAnchors, platformSpots };
}

/** Where passengers wait on a platform, and the spot at the platform edge they walk to */
export type PlatformSpot = { station: number; side: 1 | -1; home: THREE.Vector3; edge: THREE.Vector3 };

function buildStations(scene: THREE.Scene, model: LineModel) {
  const spots: PlatformSpot[] = [];
  const white = new THREE.MeshStandardMaterial({ color: '#FFFFFF', roughness: 0.4 });
  const platformMat = new THREE.MeshStandardMaterial({ color: '#E9ECF1', roughness: 0.8 });
  const edgeMat = new THREE.MeshStandardMaterial({ color: '#F2C94C' });
  const accentMat = new THREE.MeshStandardMaterial({ color: LINE_1.color, roughness: 0.5 });
  const entranceMat = createNightLightMaterial('#CFE0EE', [0.9, 0.95, 1.0], 0.05);
  const concourseMat = createBuildingMaterial();
  // Glass canopy: the train stays visible underneath from the top-down camera
  const canopyMat = createNightLightMaterial('#F4F8FC', [0.55, 0.62, 0.7]);
  canopyMat.transparent = true;
  // Clear enough to see the trains at the platform, like the reference renders
  canopyMat.opacity = 0.2;
  canopyMat.depthWrite = false;

  const R = 3.0;
  const roofTop = 1.8;
  const L = PLATFORM_LENGTH;
  const panelGeo = new THREE.BoxGeometry(0.66, 0.03, L + 0.4);
  const ribGeo = new THREE.TorusGeometry(R, 0.025, 4, 18, 1.5);
  // Ribs span the same arc as the glass slats

  const anchors: THREE.Vector3[] = [];
  const p = new THREE.Vector3();
  const tan = new THREE.Vector3();
  // Stations are built as ordinary groups, then baked into a few merged meshes
  const root = new THREE.Group();

  model.stationU.forEach((u, stationIndex) => {
    model.curve.getPointAt(u, p);
    model.curve.getTangentAt(u, tan);
    const group = new THREE.Group();
    group.position.copy(p);
    group.lookAt(p.x + tan.x, p.y, p.z + tan.z);

    if (p.y > 1) {
      for (const side of [1, -1]) {
        const platform = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.32, L), platformMat);
        platform.position.set(1.5 * side, -0.06, 0);
        const edge = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, L), edgeMat);
        edge.position.set(1.12 * side, 0.11, 0);
        group.add(platform, edge);
      }
      // Curved glass roof made of slats, with white ribs
      for (let k = -3; k <= 3; k++) {
        const a = k * 0.205;
        const panel = new THREE.Mesh(panelGeo, canopyMat);
        panel.position.set(Math.sin(a) * R, roofTop - R + Math.cos(a) * R, 0);
        panel.rotation.z = -a;
        panel.renderOrder = 3;
        group.add(panel);
      }
      // White fascia beams along both eaves give the roof a crisp outline from above
      for (const side of [1, -1]) {
        const a = side * 0.72;
        const fascia = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, L + 0.5), white);
        fascia.position.set(Math.sin(a) * R, roofTop - R + Math.cos(a) * R, 0);
        fascia.rotation.z = -a;
        group.add(fascia);
      }
      const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, L + 0.5), white);
      ridge.position.set(0, roofTop + 0.02, 0);
      group.add(ridge);
      for (let z = -L / 2; z <= L / 2 + 0.01; z += L / 10) {
        const rib = new THREE.Mesh(ribGeo, white);
        rib.position.set(0, roofTop - R, z);
        rib.rotation.z = Math.PI / 2 - 0.75;
        rib.scale.setScalar(1);
        group.add(rib);
      }
      const posts: [number, number][] = [];
      for (let z = -L / 2 + 0.4; z <= L / 2; z += L / 5) posts.push([1.88, z], [-1.88, z]);
      for (const [x, z] of posts) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.25, 0.07), white);
        post.position.set(x, 0.62, z);
        group.add(post);
      }
      // Concourse box under the platforms and an escalator tower down to the street
      const concourse = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.8, L * 0.7), concourseMat);
      concourse.position.y = -0.85;
      // Line-colour stripe wrapped round the concourse, set into the wall (only its edge shows)
      const band = new THREE.Mesh(new THREE.BoxGeometry(4.64, 0.07, L * 0.7 + 0.04), accentMat);
      band.position.y = -0.62;
      // Spans from the street (local y = -p.y) up to the concourse floor (local y = -1.25)
      const towerHeight = p.y - 1.25;
      const tower = new THREE.Mesh(new THREE.BoxGeometry(0.7, towerHeight, 0.9), concourseMat);
      tower.position.set(2.75, -1.25 - towerHeight / 2, L * 0.2);
      const tower2 = tower.clone();
      tower2.position.set(-2.75, -1.25 - towerHeight / 2, -L * 0.2);
      group.add(concourse, band, tower, tower2);
      anchors.push(new THREE.Vector3(p.x, p.y + 2.3, p.z));
      group.updateMatrixWorld(true);
      for (const side of [1, -1] as const) {
        for (let k = 0; k < 9; k++) {
          const z = -L * 0.38 + k * (L * 0.095) + ((k * 37 + stationIndex * 11) % 7) * 0.06;
          const x = side * (1.48 + ((k * 13 + stationIndex) % 5) * 0.04);
          spots.push({
            station: stationIndex,
            side,
            home: group.localToWorld(new THREE.Vector3(x, 0.1, z)),
            edge: group.localToWorld(new THREE.Vector3(side * 1.2, 0.1, z)),
          });
        }
      }
    } else {
      // Underground station: glass entrance pavilions on the street
      for (const side of [1, -1]) {
        for (const end of [-1, 1]) {
          const z = end * L * 0.35;
          const entrance = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.7, 2.4), entranceMat);
          entrance.position.set(4 * side, 0.35, z);
          const roof = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.08, 2.7), white);
          roof.position.set(4 * side, 0.74, z);
          const sign = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.08, 0.16), accentMat);
          sign.position.set(4 * side, 0.68, z + 1.25);
          group.add(entrance, roof, sign);
        }
      }
      anchors.push(new THREE.Vector3(p.x, 1.4, p.z));
    }
    root.add(group);
  });
  for (const mesh of mergeByMaterial(root)) scene.add(mesh);
  return { anchors, spots };
}
