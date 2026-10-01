import * as THREE from 'three/webgpu';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

import {
  createContactShadowMaterial,
  createDoorLeafMaterial,
  createGlowMaterial,
  createNightLightMaterial,
  createTrainBodyMaterial,
} from '../shaders';

import { merge, mergeByMaterial } from './geometry';

/** The blue of HCMC Line 1's trains (body stripe and roof shoulders) */
export const HCMC_BLUE = '#1F5FBF';

/** Hitachi three-car set: ~20 m cars (4.5 m per unit), four doors a side */
export const CAR_COUNT = 3;
export const CAR_LENGTH = 4.4;
export const CAR_GAP = 4.52;
const NOSE = 1.0;
const HALF_WIDTH = 0.4;
const BODY_H = 0.68;
const DOORS_Z = [-1.62, -0.54, 0.54, 1.62];
const LEAF = 0.15;

/** Rounded-rectangle cross-section, like the extruded aluminium body */
function bodySection() {
  const w = HALF_WIDTH;
  const h = BODY_H / 2;
  const r = 0.17;
  const shape = new THREE.Shape();
  shape.moveTo(-w + r, -h);
  shape.lineTo(w - r, -h);
  shape.quadraticCurveTo(w, -h, w, -h + r);
  shape.lineTo(w, h - r * 1.6);
  // Fuller curve into the roof, as on modern metro cars
  shape.quadraticCurveTo(w, h, w - r * 1.6, h);
  shape.lineTo(-w + r * 1.6, h);
  shape.quadraticCurveTo(-w, h, -w, h - r * 1.6);
  shape.lineTo(-w, -h + r);
  shape.quadraticCurveTo(-w, -h, -w + r, -h);
  return shape;
}

/**
 * Car body extruded along z. A cab car tapers its +z end into a rounded nose: narrower, the roof
 * sweeping down towards a blunt front. uv.x records how far into the nose each vertex is, which
 * the livery shader turns into the wrap-around windscreen.
 */
function bodyGeometry(cab: boolean) {
  const geo = new THREE.ExtrudeGeometry(bodySection(), {
    depth: CAR_LENGTH - 0.06,
    steps: cab ? 28 : 6,
    bevelEnabled: false,
    curveSegments: 6,
  });
  geo.translate(0, 0, -(CAR_LENGTH - 0.06) / 2);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    const t = cab ? Math.max(0, (z - (CAR_LENGTH / 2 - NOSE)) / NOSE) : 0;
    uv[i * 2] = t;
    if (t <= 0) continue;
    const e = t * t;
    pos.setX(i, pos.getX(i) * (1 - 0.2 * e));
    const y = pos.getY(i);
    // Roof sweeps down; the lower body stays full so the nose reads as a rounded wedge
    if (y > -0.05) pos.setY(i, -0.05 + (y + 0.05) * (1 - 0.42 * e * e));
    // Pull the very front back at the edges for a rounded plan
    const edge = Math.abs(pos.getX(i)) / HALF_WIDTH;
    pos.setZ(i, z - 0.18 * e * edge * edge);
  }
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.deleteAttribute('normal');
  geo.computeVertexNormals();
  return geo;
}

/** Thin box spanning from a to b */
function strut(a: THREE.Vector3, b: THREE.Vector3, thickness: number, material: THREE.Material) {
  const len = a.distanceTo(b);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(thickness, len, thickness), material);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return mesh;
}

/**
 * All door leaves of one car in a single geometry. The `slide` attribute says which way a
 * leaf moves when the doors open (±1), or 0 for the side that stays shut.
 */
function leavesGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  for (const side of [1, -1]) {
    for (const dz of DOORS_Z) {
      for (const half of [-1, 1]) {
        const g = new THREE.BoxGeometry(0.012, 0.36, LEAF).toNonIndexed();
        g.translate(side * (HALF_WIDTH + 0.01), -0.02, dz + (half * LEAF) / 2);
        // Trains run on the right-hand track, so the platform is always on their right (-x)
        const slide = side === -1 ? half : 0;
        g.setAttribute(
          'slide',
          new THREE.Float32BufferAttribute(new Array(g.attributes.position.count).fill(slide), 1)
        );
        parts.push(g);
      }
    }
  }
  return merge(parts);
}

export function buildTrains(scene: THREE.Scene, count: number, highlight: number) {
  const middleGeo = bodyGeometry(false);
  const cabGeo = bodyGeometry(true);
  const unitGeo = new RoundedBoxGeometry(0.46, 0.08, 0.5, 2, 0.03);
  const bogieGeo = new THREE.BoxGeometry(0.62, 0.14, 0.5);
  const lightGeo = new THREE.BoxGeometry(0.12, 0.045, 0.03);
  const bellowsGeo = new THREE.BoxGeometry(0.62, 0.56, 0.14);
  const doorwayGeo = new THREE.BoxGeometry(0.01, 0.36, LEAF * 2);
  const leafGeo = leavesGeometry();
  const beamGeo = new THREE.PlaneGeometry(1.3, 2.6);
  beamGeo.rotateX(-Math.PI / 2);
  const shadowGeo = new THREE.PlaneGeometry(1.25, CAR_LENGTH + 0.5);
  shadowGeo.rotateX(-Math.PI / 2);
  const shadowMat = createContactShadowMaterial();

  return Array.from({ length: count }, (_, k) => {
    const body = createTrainBodyMaterial(k === highlight ? '#1FA35B' : HCMC_BLUE);
    const roofKit = new THREE.MeshStandardMaterial({ color: '#D5DAE0', roughness: 0.6 });
    const dark = new THREE.MeshStandardMaterial({ color: '#3A414B', roughness: 0.7 });
    const lights = createNightLightMaterial('#FFF6D6', [1, 0.95, 0.8], 0.4);
    const beamMat = createGlowMaterial([1, 0.92, 0.75], 0.75, 0.0);
    // The doorway shows the lit cabin once the leaves slide apart
    const cabinMat = createNightLightMaterial('#3A4350', [1, 0.86, 0.6], 0.35);
    const { material: leafMat, doors } = createDoorLeafMaterial(LEAF * 0.92);

    const cars = Array.from({ length: CAR_COUNT }, (_, c) => {
      // Build the car from parts, then bake them into one mesh per material
      const parts = new THREE.Group();
      const isCab = c === 0 || c === CAR_COUNT - 1;
      const shell = new THREE.Mesh(isCab ? cabGeo : middleGeo, body);
      if (c === CAR_COUNT - 1) shell.rotation.y = Math.PI;
      parts.add(shell);
      // Roof air-conditioning units
      for (const z of [-1.2, 1.2]) {
        const unit = new THREE.Mesh(unitGeo, roofKit);
        unit.position.set(0, BODY_H / 2 + 0.03, isCab ? z * 0.8 - (c === 0 ? 0.35 : -0.35) : z);
        parts.add(unit);
      }
      for (const z of [-1.55, 1.55]) {
        const bogie = new THREE.Mesh(bogieGeo, dark);
        bogie.position.set(0, -0.38, z);
        parts.add(bogie);
      }
      // Gangway bellows towards the neighbouring cars
      for (const end of [-1, 1]) {
        const inner = !isCab || (c === 0 ? end < 0 : end > 0);
        if (!inner) continue;
        const bellows = new THREE.Mesh(bellowsGeo, dark);
        bellows.position.set(0, -0.02, end * (CAR_LENGTH / 2 - 0.02));
        parts.add(bellows);
      }
      for (const side of [1, -1]) {
        for (const dz of DOORS_Z) {
          const doorway = new THREE.Mesh(doorwayGeo, cabinMat);
          doorway.position.set(side * (HALF_WIDTH + 0.003), -0.02, dz);
          parts.add(doorway);
        }
      }
      if (isCab) {
        // Cab end faces +z; the rear cab is turned around
        const cab = new THREE.Group();
        for (const x of [-0.2, 0.2]) {
          const light = new THREE.Mesh(lightGeo, lights);
          light.position.set(x, -0.17, CAR_LENGTH / 2 - 0.08);
          cab.add(light);
        }
        if (c === CAR_COUNT - 1) cab.rotation.y = Math.PI;
        parts.add(cab);
      }
      if (c === 1) {
        // Pantograph reaching up to the contact wire
        const foot = new THREE.Vector3(0, BODY_H / 2 + 0.02, -0.2);
        const knee = new THREE.Vector3(0, 0.62, 0.14);
        const head = new THREE.Vector3(0, 0.9, -0.02);
        parts.add(strut(foot, knee, 0.025, dark), strut(knee, head, 0.02, dark));
        const bar = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.018, 0.04), dark);
        bar.position.copy(head);
        const base = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.04, 0.3), dark);
        base.position.set(0, BODY_H / 2 + 0.02, -0.12);
        parts.add(bar, base);
      }

      const car = new THREE.Group();
      for (const mesh of mergeByMaterial(parts, parts)) car.add(mesh);
      car.add(new THREE.Mesh(leafGeo, leafMat));
      // Soft contact shadow on the deck, so the car sits on the track instead of floating
      const shadow = new THREE.Mesh(shadowGeo, shadowMat);
      shadow.position.y = -0.37;
      shadow.renderOrder = 1;
      car.add(shadow);
      if (c === 0) {
        const beam = new THREE.Mesh(beamGeo, beamMat);
        beam.position.set(0, -0.36, CAR_LENGTH / 2 + 1.3);
        beam.renderOrder = 2;
        car.add(beam);
        car.userData.beam = beam;
      }
      scene.add(car);
      return car;
    });

    return {
      cars,
      /** 0 = closed, 1 = fully open. Drives the leaves in the vertex shader. */
      setDoors(amount: number) {
        doors.value = amount;
      },
    };
  });
}

export type Train = ReturnType<typeof buildTrains>[number];
