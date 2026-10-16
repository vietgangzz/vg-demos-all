import * as TSL from 'three/tsl';
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

import { dayness, hex, radial, shade, type V3 } from './light';
import { coastDistance, geo, groundRadius, sample, SEA, STOPS, VILLAGE, type Stop, type WorldMaps } from './world';

/**
 * What stands on the globe: forests by the thousand (snowy pines up north, round trees in the
 * middle, palms in the tropics), a little town at every stop with its windows lit and a tree in
 * the square, Santa's village in Lapland, and the striped pole at the very top.
 *
 * All of it is toy-sized for a globe, far too big for the world, the way a picture book would
 * draw it.
 */

const { vec3, float, mix, saturate, smoothstep, abs, step, time, sin, fract } = TSL;

// ---- Shapes, with their colours on the vertices ----

function painted(g: THREE.BufferGeometry, colour: string) {
  const flat = g.index ? g.toNonIndexed() : g;
  flat.deleteAttribute('uv');
  flat.computeVertexNormals();
  const c = new THREE.Color(colour);
  const n = flat.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  flat.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return flat;
}

function pineGeometry() {
  return mergeGeometries([
    painted(new THREE.CylinderGeometry(0.06, 0.08, 0.22, 6).translate(0, 0.11, 0), '#6B4429'),
    painted(new THREE.ConeGeometry(0.4, 0.42, 9).translate(0, 0.36, 0), '#24684A'),
    painted(new THREE.ConeGeometry(0.31, 0.36, 9).translate(0, 0.62, 0), '#2B7A52'),
    painted(new THREE.ConeGeometry(0.2, 0.3, 9).translate(0, 0.86, 0), '#33885A'),
  ])!;
}

function leafyGeometry() {
  return mergeGeometries([
    painted(new THREE.CylinderGeometry(0.05, 0.07, 0.3, 6).translate(0, 0.15, 0), '#76502F'),
    painted(new THREE.IcosahedronGeometry(0.3, 1).translate(0, 0.52, 0), '#5FAE48'),
    painted(new THREE.IcosahedronGeometry(0.2, 1).translate(0.16, 0.68, 0.05), '#6DBB52'),
    painted(new THREE.IcosahedronGeometry(0.18, 1).translate(-0.14, 0.66, -0.06), '#57A243'),
  ])!;
}

function palmGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  const top = new THREE.Vector3();
  for (let k = 0; k < 5; k++) {
    const y = 0.13 + k * 0.15;
    const x = 0.012 * k * k;
    parts.push(painted(new THREE.CylinderGeometry(0.045, 0.055, 0.16, 6).translate(x, y, 0), k % 2 ? '#A27C50' : '#8C6842'));
    top.set(x, y + 0.08, 0);
  }
  for (let k = 0; k < 7; k++) {
    const leaf = new THREE.ConeGeometry(0.075, 0.46, 4);
    leaf.scale(1, 1, 0.35);
    leaf.translate(0, 0.23, 0);
    leaf.rotateX(Math.PI / 2 + 0.55);
    leaf.rotateY((k / 7) * Math.PI * 2);
    leaf.translate(top.x, top.y, top.z);
    parts.push(painted(leaf, k % 2 ? '#3E9E52' : '#4AAE5C'));
  }
  parts.push(painted(new THREE.IcosahedronGeometry(0.05, 0).translate(top.x, top.y - 0.02, 0.03), '#7A5532'));
  return mergeGeometries(parts)!;
}

function wallsGeometry() {
  return mergeGeometries([
    painted(new THREE.BoxGeometry(0.62, 0.48, 0.52).translate(0, 0.24, 0), '#FFF4E4'),
    painted(new THREE.BoxGeometry(0.1, 0.24, 0.1).translate(0.17, 0.72, -0.1), '#B8664C'),
  ])!;
}

function roofGeometry() {
  const shape = new THREE.Shape([new THREE.Vector2(-0.38, 0), new THREE.Vector2(0.38, 0), new THREE.Vector2(0, 0.34)]);
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.62, bevelEnabled: false });
  g.translate(0, 0.47, -0.31);
  return painted(g, '#FFFFFF');
}

// ---- One material for every toy: vertex colour, a tint, snow on top, fairy lights ----

function toyMaterial(opts: { windows?: boolean } = {}) {
  const m = new THREE.MeshBasicNodeMaterial();
  const base = TSL.attribute('color', 'vec3') as unknown as V3;
  const tint = TSL.attribute('tint', 'vec3') as unknown as V3;
  const snow = TSL.attribute('snow', 'float');
  const lit = TSL.attribute('lit', 'float');
  const lp = TSL.positionGeometry;
  const ng = TSL.normalGeometry;
  let albedo = base.mul(tint) as unknown as V3;
  const cap = smoothstep(0.3, 0.75, ng.y).mul(snow);
  albedo = mix(albedo, hex('#F5F9FF'), cap) as unknown as V3;
  const n = TSL.normalize(TSL.normalWorld) as unknown as V3;
  const up = radial();
  let colour = shade(albedo, n, up, 0.45);
  const night = float(1).sub(dayness(up));
  if (opts.windows) {
    // Two windows on the front and back, one on each end, a door at the front
    const front = step(0.255, abs(lp.z));
    const side = step(0.305, abs(lp.x));
    const winFront = step(abs(abs(lp.x).sub(0.16)), 0.055).mul(step(abs(lp.y.sub(0.29)), 0.06));
    const winSide = step(abs(lp.z), 0.06).mul(step(abs(lp.y.sub(0.29)), 0.06));
    const door = step(abs(lp.x), 0.055).mul(step(lp.y, 0.19)).mul(step(0, lp.z));
    const glass = saturate(front.mul(winFront.add(door.mul(0.6))).add(side.mul(winSide)));
    const flicker = sin(time.mul(3.1).add(TSL.instanceIndex.toFloat().mul(1.7))).mul(0.06).add(0.94);
    const warm = hex('#FFC66E').mul(night.mul(1.5).add(0.25)).mul(flicker);
    colour = mix(colour, mix(hex('#3B4A7A'), warm, night.mul(0.9).add(0.1)), glass) as unknown as V3;
  }
  // Fairy lights on the town trees: dots in four colours, blinking in turn
  const cell = lp.mul(vec3(26, 30, 26)).floor();
  const h = TSL.hash(cell.x.mul(7.1).add(cell.y.mul(13.7)).add(cell.z.mul(3.3)));
  const dot = step(0.86, h).mul(step(0.2, lp.y));
  const which = fract(h.mul(37));
  const bulb = mix(
    mix(hex('#FF4D5E'), hex('#FFD34D'), step(0.25, which)),
    mix(hex('#4DD3FF'), hex('#7CFF6B'), step(0.75, which)),
    step(0.5, which)
  );
  const blink = smoothstep(-0.3, 0.6, sin(time.mul(2.4).add(h.mul(50))));
  colour = colour.add(bulb.mul(dot.mul(lit).mul(blink).mul(night.mul(1.2).add(0.6)))) as unknown as V3;
  m.colorNode = colour;
  return m;
}

// ---- Placing them ----

type Placed = { at: THREE.Vector3; up: THREE.Vector3; yaw: number; size: number; tint: THREE.Color; snow: number; lit: number };

function instanced(geometry: THREE.BufferGeometry, material: THREE.Material, items: Placed[], scaleY = 1) {
  const g = geometry.clone();
  const n = Math.max(1, items.length);
  const tint = new Float32Array(n * 3).fill(1);
  const snow = new Float32Array(n);
  const lit = new Float32Array(n);
  const mesh = new THREE.InstancedMesh(g, material, n);
  const q = new THREE.Quaternion();
  const turn = new THREE.Quaternion();
  const Y = new THREE.Vector3(0, 1, 0);
  const s = new THREE.Vector3();
  const m = new THREE.Matrix4();
  items.forEach((it, i) => {
    q.setFromUnitVectors(Y, it.up);
    turn.setFromAxisAngle(Y, it.yaw);
    q.multiply(turn);
    s.set(it.size, it.size * scaleY, it.size);
    m.compose(it.at, q, s);
    mesh.setMatrixAt(i, m);
    tint.set([it.tint.r, it.tint.g, it.tint.b], i * 3);
    snow[i] = it.snow;
    lit[i] = it.lit;
  });
  g.setAttribute('tint', new THREE.InstancedBufferAttribute(tint, 3));
  g.setAttribute('snow', new THREE.InstancedBufferAttribute(snow, 1));
  g.setAttribute('lit', new THREE.InstancedBufferAttribute(lit, 1));
  mesh.count = items.length;
  mesh.frustumCulled = false;
  return mesh;
}

export type Town = {
  stop: Stop | typeof VILLAGE;
  /** Globe-local: the square in the middle, the chimney the present goes down, the top of the tree */
  centre: THREE.Vector3;
  chimney: THREE.Vector3;
  treeTop: THREE.Vector3;
};

const HOUSE_WALLS = ['#FFF1DE', '#FFE3D3', '#E9F1FF', '#FFF7C9', '#E8F7E4', '#F7E1F1'];
const ROOFS_WARM = ['#D9483B', '#E07A3C', '#3B78C9', '#2F9C8F', '#C2465F'];

export function buildFlora(maps: WorldMaps) {
  const { shapeField: shape, lifeField: life, colorField: colour } = maps;
  const group = new THREE.Group();
  let seed = 11;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const whiteness = (lon: number, lat: number) =>
    Math.min(sample(colour, 0, lon, lat), sample(colour, 1, lon, lat), sample(colour, 2, lon, lat));
  // Round the town you go down into, the trees come down to its size (it's built life-size)
  const hero = STOPS.find((st) => st.hero);
  const heroDir = hero ? geo(hero.lon, hero.lat) : null;
  const near = (at: THREE.Vector3) => {
    if (!heroDir) return 1;
    const deg = (heroDir.angleTo(at) * 180) / Math.PI;
    return THREE.MathUtils.lerp(0.22, 1, THREE.MathUtils.smoothstep(deg, 6.5, 14));
  };
  const place = (lon: number, lat: number, size: number, sink = 0.0015): Placed => {
    const r = Math.max(groundRadius(shape, lon, lat), SEA + 0.004) - sink;
    const at = geo(lon, lat, r);
    const k = near(at);
    size *= k;
    at.setLength(r + sink * (1 - k));
    // Nothing right on top of the town itself
    if (heroDir && (heroDir.angleTo(at) * 180) / Math.PI < 6.2) size = 0;
    return {
      at,
      up: at.clone().normalize(),
      yaw: rand() * Math.PI * 2,
      size,
      tint: new THREE.Color(1, 1, 1),
      snow: THREE.MathUtils.smoothstep(whiteness(lon, lat), 0.7, 0.88),
      lit: 0,
    };
  };

  // ---- Forests ----
  const pines: Placed[] = [];
  const leafy: Placed[] = [];
  const palms: Placed[] = [];
  for (let k = 0; k < 90000; k++) {
    const lon = rand() * 360 - 180;
    const lat = (Math.asin(rand() * 2 - 1) * 180) / Math.PI;
    if (coastDistance(shape, lon, lat) < 0.35) continue;
    const p = sample(life, 0, lon, lat);
    const l = sample(life, 1, lon, lat);
    const a = sample(life, 2, lon, lat);
    const roll = rand();
    if (roll < p * 0.09 && pines.length < 1500) {
      const it = place(lon, lat, 0.03 + rand() * 0.016);
      it.tint.setRGB(1.05 + rand() * 0.2, 1.15 + rand() * 0.2, 1.0 + rand() * 0.2);
      pines.push(it);
    } else if (roll < p * 0.09 + l * 0.06 && leafy.length < 1100) {
      const it = place(lon, lat, 0.03 + rand() * 0.016);
      it.tint.setRGB(0.9 + rand() * 0.2, 0.92 + rand() * 0.16, 0.85 + rand() * 0.2);
      leafy.push(it);
    } else if (roll < p * 0.09 + l * 0.06 + a * 0.08 && palms.length < 420) {
      palms.push(place(lon, lat, 0.03 + rand() * 0.012));
    }
  }

  // ---- Towns ----
  const walls: Placed[] = [];
  const roofs: Placed[] = [];
  const towns: Town[] = [];
  const islets: THREE.Vector3[] = [];
  const settle = (stop: Stop | typeof VILLAGE, houses: number, spread: number, scale: number, village: boolean) => {
    const centre = geo(stop.lon, stop.lat, Math.max(groundRadius(shape, stop.lon, stop.lat), SEA + 0.004));
    if (coastDistance(shape, stop.lon, stop.lat) < 0.25) {
      // An island too small for the map: a disc of sand with a palm or two on it
      islets.push(centre.clone().normalize());
      for (let k = 0; k < 2; k++) {
        const palm = place(stop.lon + (k - 0.5) * 0.5, stop.lat + 0.3, 0.02 + k * 0.004);
        palm.at.copy(geo(stop.lon + (k - 0.5) * 0.5, stop.lat + 0.3, SEA + 0.012));
        palm.up.copy(palm.at).normalize();
        palms.push(palm);
      }
    }
    let chimney = centre.clone();
    if ('hero' in stop && stop.hero) {
      // Built in full elsewhere (town.ts) and set down here; the scene fills in where its chimney is
      towns.push({ stop, centre, chimney, treeTop: centre.clone() });
      return;
    }
    for (let h = 0; h < houses; h++) {
      let lon = stop.lon;
      let lat = stop.lat;
      for (let tries = 0; tries < 12; tries++) {
        const a = rand() * Math.PI * 2;
        const d = spread * (h === 0 ? 0.3 : 0.4 + 0.6 * Math.sqrt(rand()));
        lon = stop.lon + (Math.cos(a) * d) / Math.max(0.2, Math.cos((stop.lat * Math.PI) / 180));
        lat = stop.lat + Math.sin(a) * d;
        if (coastDistance(shape, lon, lat) > 0.12) break;
      }
      const big = village && h === 0;
      const size = scale * (big ? 1.9 : 0.8 + rand() * 0.4);
      const wall = place(lon, lat, size);
      wall.tint.set(big ? '#D8414F' : HOUSE_WALLS[Math.floor(rand() * HOUSE_WALLS.length)]);
      const roof = { ...wall, tint: new THREE.Color(big ? '#2A7A4E' : ROOFS_WARM[Math.floor(rand() * ROOFS_WARM.length)]) };
      roof.snow = Math.max(roof.snow, 'snowy' in stop && stop.snowy ? 0.95 : village ? 1 : 0);
      wall.snow = 0;
      walls.push(wall);
      roofs.push(roof);
      if (h === 0) {
        // The chimney: where it sits on the house, turned with it
        const local = new THREE.Vector3(0.17, 0.86, -0.1).multiplyScalar(size);
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), wall.up);
        q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), wall.yaw));
        chimney = wall.at.clone().add(local.applyQuaternion(q));
      }
    }
    // The tree in the square, lit
    const tree = place(stop.lon, stop.lat, scale * (village ? 3.4 : 1.9));
    tree.tint.set('#FFFFFF');
    tree.snow = 'snowy' in stop && stop.snowy ? 0.8 : village ? 1 : tree.snow;
    tree.lit = 1;
    pines.push(tree);
    const treeTop = tree.at.clone().addScaledVector(tree.up, tree.size * 1.04);
    towns.push({ stop, centre, chimney, treeTop });
  };
  settle(VILLAGE, 9, 0.9, 0.011, true);
  for (const stop of STOPS) settle(stop, 7, 0.55, 0.0085, false);

  const toys = toyMaterial();
  group.add(instanced(pineGeometry(), toys, pines));
  group.add(instanced(leafyGeometry(), toys, leafy));
  group.add(instanced(palmGeometry(), toys, palms));
  group.add(instanced(wallsGeometry(), toyMaterial({ windows: true }), walls));
  group.add(instanced(roofGeometry(), toys, roofs));

  // Sand under the towns on islands too small for the map to raise
  for (const at of islets) {
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.02, 0.012, 24), islandMaterial());
    disc.position.copy(at).multiplyScalar(SEA + 0.001);
    disc.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), at);
    group.add(disc);
  }
  group.add(northPole());
  return { group, towns };
}

let islandMat: THREE.Material | null = null;
function islandMaterial() {
  if (islandMat) return islandMat;
  const m = new THREE.MeshBasicNodeMaterial();
  m.colorNode = shade(hex('#F7E6B5'), TSL.normalize(TSL.normalWorld) as unknown as V3, radial(), 0.8);
  islandMat = m;
  return m;
}

/** The North Pole itself: a candy-striped pole with a gold ball, standing in the sea ice */
function northPole() {
  const g = new THREE.Group();
  const m = new THREE.MeshBasicNodeMaterial();
  const lp = TSL.positionGeometry;
  const stripe = step(0.5, fract(lp.y.mul(7).add(TSL.atan(lp.x, lp.z).div(Math.PI * 2))));
  const n = TSL.normalize(TSL.normalWorld) as unknown as V3;
  m.colorNode = shade(mix(hex('#E3263D'), hex('#FFFFFF'), stripe) as unknown as V3, n, radial(), 0.5);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1, 20).translate(0, 0.5, 0), m);
  const gold = new THREE.MeshBasicNodeMaterial();
  gold.colorNode = shade(hex('#F4C34D'), n, radial(), 0.5).add(hex('#FFF2B0').mul(0.25));
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.11, 20, 14).translate(0, 1.05, 0), gold);
  g.add(pole, ball);
  g.scale.setScalar(0.055);
  g.position.set(0, SEA - 0.002, 0);
  return g;
}
