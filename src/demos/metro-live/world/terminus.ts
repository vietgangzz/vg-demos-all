import * as THREE from 'three/webgpu';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

import type { LineModel } from '../line-model';
import { createLeafMaterial, createNightLightMaterial } from '../shaders';
import { foliageTexture, leafCrownGeometry } from './foliage';
import { instanced, merge, mulberry32 } from './geometry';
import { isWater, roadClearance } from './layout';

/**
 * The new Miền Đông bus station beside the Bến xe Suối Tiên terminus (the station is named
 * after it). OSM leaves the plot empty, so it is laid out by hand in the track's frame at the
 * terminus: along = towards Suối Tiên, across = away from the line on the open side. A vaulted
 * passenger hall, rows of bus bays with coaches, a car park, and a planted forecourt.
 */
export function buildTerminus(scene: THREE.Scene, model: LineModel) {
  const last = model.stationU.length - 1;
  const origin = model.curve.getPointAt(model.stationU[last]).setY(0);
  const t = model.curve.getTangentAt(model.stationU[last]).setY(0).normalize();
  const p = new THREE.Vector3(-t.z, 0, t.x);
  // Local x along the track, local z across it
  const yaw = Math.atan2(-t.z, t.x);
  const at = (along: number, across: number, y = 0) =>
    origin.clone().addScaledVector(t, along).addScaledVector(p, across).setY(y);
  const clear = (along: number, across: number, pad = 1) => {
    const w = at(along, across);
    return !isWater(w.x, w.z, pad) && roadClearance(w.x, w.z, pad + 2) > pad;
  };
  const place = (geo: THREE.BufferGeometry, along: number, across: number, y = 0) => {
    const w = at(along, across, y);
    return geo.rotateY(yaw).translate(w.x, w.y, w.z);
  };
  const box = (sx: number, sy: number, sz: number, along: number, across: number, y: number) =>
    place(new THREE.BoxGeometry(sx, sy, sz), along, across, y);

  // ---- Ground: forecourt paving, a lawn strip beside the viaduct, the car park ----
  const flat = (geos: THREE.BufferGeometry[], color: string, order: number) => {
    const mesh = new THREE.Mesh(
      merge(geos),
      new THREE.MeshStandardMaterial({ color, roughness: 1, depthWrite: false })
    );
    mesh.renderOrder = order;
    scene.add(mesh);
  };
  const plane = (w: number, d: number, along: number, across: number, y: number) =>
    place(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), along, across, y);
  flat([plane(80, 4, -6, 5.5, 0.012)], '#C9E2BC', -7);
  flat([plane(52, 7, -8, 11, 0.014)], '#E9E4DA', -7);
  flat([plane(28, 30, 33, 25, 0.014), plane(46, 24, -8, 43, 0.014)], '#C4C8CE', -7);

  // ---- Passenger hall: white box, a lit glass band, a long shallow vault with green trim ----
  const white = new THREE.MeshStandardMaterial({ color: '#F2F4F7', roughness: 0.6 });
  const trim = new THREE.MeshStandardMaterial({ color: '#2E8B57', roughness: 0.5 });
  const glass = createNightLightMaterial('#8FB3CC', [1.0, 0.86, 0.6], 0.05);
  const HALL = { along: -8, across: 22, length: 46, depth: 15 };
  scene.add(new THREE.Mesh(merge([box(HALL.length, 3.2, HALL.depth, HALL.along, HALL.across, 1.6)]), white));
  scene.add(
    new THREE.Mesh(merge([box(HALL.length + 0.2, 1.1, HALL.depth + 0.2, HALL.along, HALL.across, 1.55)]), glass)
  );
  // Vault: an open cylinder segment, its axis along the track (x' = y, y' = z, z' = x)
  const R = 10;
  const vault = new THREE.CylinderGeometry(R, R, HALL.length + 6, 28, 1, true, -0.8, 1.6);
  vault.applyMatrix4(new THREE.Matrix4().set(0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 1));
  vault.translate(0, 6.4 - R, 0);
  scene.add(
    new THREE.Mesh(
      merge([place(vault, HALL.along, HALL.across)]),
      new THREE.MeshStandardMaterial({ color: '#E7EDF2', roughness: 0.45, side: THREE.DoubleSide })
    )
  );
  const eave = R * Math.sin(0.8);
  const eaveY = 6.4 - R * (1 - Math.cos(0.8));
  scene.add(
    new THREE.Mesh(
      merge([
        box(HALL.length + 6, 0.22, 0.3, HALL.along, HALL.across - eave, eaveY),
        box(HALL.length + 6, 0.22, 0.3, HALL.along, HALL.across + eave, eaveY),
      ]),
      trim
    )
  );
  const posts: THREE.BufferGeometry[] = [];
  for (let a = -HALL.length / 2 - 2; a <= HALL.length / 2 + 2; a += 7) {
    for (const side of [-1, 1]) {
      posts.push(
        place(new THREE.CylinderGeometry(0.12, 0.12, eaveY, 6), HALL.along + a, HALL.across + side * eave, eaveY / 2)
      );
    }
  }

  // ---- Bus bays: canopies on posts, coaches nosed in under them ----
  const canopies: THREE.BufferGeometry[] = [];
  const buses: { position: THREE.Vector3; yaw: number; color: string }[] = [];
  const BUS_COLORS = ['#F07A2B', '#F4F6F8', '#2FA25A', '#F07A2B', '#3F7BD9', '#F4F6F8'];
  const rand = mulberry32(51);
  for (const [k, across] of [34, 41, 48].entries()) {
    canopies.push(box(40, 0.16, 3.6, -8, across, 2));
    for (let a = -27; a <= 11; a += 5) {
      posts.push(place(new THREE.CylinderGeometry(0.07, 0.07, 2, 6), a, across - 1.5, 1));
      posts.push(place(new THREE.CylinderGeometry(0.07, 0.07, 2, 6), a, across + 1.5, 1));
    }
    for (let a = -26; a <= 10; a += 3.2) {
      if (rand() < 0.22 || !clear(a, across + 2.6)) continue;
      buses.push({
        position: at(a, across + 2.4, 0.42),
        yaw,
        color: BUS_COLORS[(k * 3 + Math.round(a)) % BUS_COLORS.length],
      });
    }
  }
  scene.add(new THREE.Mesh(merge(canopies), white));
  scene.add(new THREE.Mesh(merge(posts), trim));
  const coach = new RoundedBoxGeometry(0.62, 0.74, 2.7, 2, 0.12);
  scene.add(instanced(coach, new THREE.MeshStandardMaterial({ roughness: 0.4 }), buses));

  // ---- Car park ----
  const cars: { position: THREE.Vector3; yaw: number; color: string }[] = [];
  const CAR_COLORS = ['#F4F6F8', '#2B2F36', '#B8BEC6', '#C0392B', '#F4F6F8', '#5A6B7D'];
  for (const across of [14, 19.5, 28, 33.5]) {
    for (let a = 21; a <= 45; a += 1.25) {
      if (rand() < 0.3 || !clear(a, across, 0.5)) continue;
      cars.push({
        position: at(a, across, 0.2),
        yaw: yaw + Math.PI / 2,
        color: CAR_COLORS[Math.floor(rand() * CAR_COLORS.length)],
      });
    }
  }
  scene.add(
    instanced(
      new RoundedBoxGeometry(0.95, 0.36, 0.44, 2, 0.08),
      new THREE.MeshStandardMaterial({ roughness: 0.35 }),
      cars
    )
  );

  // ---- Forecourt: rows of trees and lamps, a lawn of bushes along the hall ----
  const trees: { position: THREE.Vector3; yaw: number; scale: THREE.Vector3; color: string }[] = [];
  const GREENS = ['#8FCB7E', '#7DBF72', '#A3D48F', '#6FB46A'];
  for (const across of [9]) {
    for (let a = -31; a <= 14; a += 4.5) {
      if (!clear(a, across)) continue;
      const s = 0.65 + rand() * 0.25;
      trees.push({
        position: at(a, across),
        yaw: rand() * 6.28,
        scale: new THREE.Vector3(s, s, s),
        color: GREENS[Math.floor(rand() * 4)],
      });
    }
  }
  for (let a = -36; a <= 20; a += 3.4) {
    if (!clear(a, 56)) continue;
    const s = 0.7 + rand() * 0.3;
    trees.push({
      position: at(a, 56),
      yaw: rand() * 6.28,
      scale: new THREE.Vector3(s, s, s),
      color: GREENS[Math.floor(rand() * 4)],
    });
  }
  scene.add(instanced(leafCrownGeometry(), createLeafMaterial(foliageTexture('leaf')), trees));
  const trunk = new THREE.CylinderGeometry(0.07, 0.11, 1, 6).translate(0, 0.5, 0);
  scene.add(
    instanced(
      trunk,
      new THREE.MeshStandardMaterial({ color: '#9C8A76', roughness: 0.9 }),
      trees.map((tr) => ({ position: tr.position, scale: new THREE.Vector3(tr.scale.x, tr.scale.y * 1.3, tr.scale.z) }))
    )
  );
  const lampPosts: THREE.BufferGeometry[] = [];
  const heads: { position: THREE.Vector3 }[] = [];
  for (let a = -30; a <= 14; a += 7) {
    if (!clear(a, 12.5)) continue;
    lampPosts.push(place(new THREE.CylinderGeometry(0.04, 0.05, 1.6, 6), a, 12.5, 0.8));
    heads.push({ position: at(a, 12.5, 1.65) });
  }
  if (lampPosts.length) {
    scene.add(new THREE.Mesh(merge(lampPosts), new THREE.MeshStandardMaterial({ color: '#5A6470', roughness: 0.6 })));
    scene.add(
      instanced(new THREE.SphereGeometry(0.12, 8, 6), createNightLightMaterial('#E8ECF0', [1.0, 0.82, 0.55]), heads)
    );
  }
}
