import * as TSL from 'three/tsl';
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

import type { Art } from './art';
import { hex, lacquer, LANTERN_ROW, LOTUS_COUNT, lotusLights, MOON_DIR, type F, type V3 } from './look';

/**
 * Where the dragon plays: a water puppet theatre on a pond at night. The stage house (the thuỷ
 * đình) stands in the water at the back, its two tiers of roof curling up at the corners, red
 * lanterns along its eaves, and across its front the bamboo screen the puppeteers stand behind,
 * lit from inside. Behind it the bamboo and the trees, black against the sky, a big low moon
 * coming up over them, and on the water the lotus lamps, drifting, rocked by every wave.
 *
 * Done the way the village theatres are: the roofs tiled, eight corners curling up; two dragons on
 * the ridge facing the moon between them (lưỡng long chầu nguyệt); a carved, gilded frieze under the
 * eaves; the band on its own platform beside the stage, stage left; and the swallow-tailed flags in
 * the five colours on their bamboo poles down both sides of the pond.
 */

const { vec2, vec3, float, saturate, dot, normalize, pow, mix, exp, smoothstep, max, abs, sin, floor } = TSL;

export const STAGE = { z: -12.5, width: 7.6, depth: 3.4, scale: 0.8 };

const moonDir = vec3(MOON_DIR.x, MOON_DIR.y, MOON_DIR.z) as unknown as V3;

/** The sky all round: dusk still low in the west, stars, the moon and its halo */
function sky() {
  const m = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false });
  m.colorNode = TSL.Fn(() => {
    const d = normalize(TSL.positionWorld.sub(TSL.cameraPosition)) as unknown as V3;
    const up = d.y;
    const base = mix(hex('#2B2236'), hex('#050A1A'), smoothstep(-0.02, 0.42, up));
    const toMoon = saturate(dot(d, moonDir));
    const halo = hex('#9AA8D8').mul(pow(toMoon, 160).mul(0.16).add(pow(toMoon, 9).mul(0.06)));
    // The moon: big and low, a little warm, its seas faintly darker
    const disc = smoothstep(0.99905, 0.99935, toMoon);
    const seas = TSL.mx_noise_float(d.mul(260)).mul(0.5).add(TSL.mx_noise_float(d.mul(90)).mul(0.5));
    const moon = hex('#FFF0D2').mul(float(1.05).sub(smoothstep(0.1, 0.6, seas).mul(0.3))).mul(disc);
    // Stars, fewer low down, twinkling
    const cell = floor(d.mul(210));
    const h = TSL.hash(cell.x.add(cell.y.mul(157)).add(cell.z.mul(313)));
    const twinkle = sin(TSL.time.mul(float(2).add(h.mul(3))).add(h.mul(40))).mul(0.35).add(0.65);
    const star = TSL.step(0.9965, h).mul(twinkle).mul(smoothstep(0.08, 0.35, up)).mul(float(1).sub(disc));
    // Wisps of cloud by the moon
    const wisp = TSL.mx_noise_float(vec3(d.x.mul(6), d.y.mul(16), d.z.mul(6)).add(vec3(TSL.time.mul(0.01), 0, 0)));
    const cloud = smoothstep(0.15, 0.6, wisp).mul(smoothstep(0.02, 0.12, up)).mul(smoothstep(0.35, 0.12, up));
    const lit = hex('#7A86B0').mul(pow(toMoon, 6).mul(0.28).add(0.02));
    const col = base.add(halo).add(vec3(1, 1, 1).mul(star.mul(0.9)));
    return mix(col, lit, cloud.mul(0.55)).add(moon);
  })();
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(400, 48, 24), m);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return mesh;
}

/**
 * A roof, hipped: its ridge along x, sagging gently between ridge and eaves, the corners curling
 * up. Width w (x), depth d (z), height h; its eaves at y = 0.
 */
function roofGeometry(w: number, d: number, h: number, curl: number) {
  const nu = 48;
  const nv = 24;
  const pos: number[] = [];
  const uvs: number[] = [];
  const idx: number[] = [];
  const k = d / w;
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      const u = (i / nu) * 2 - 1;
      const v = (j / nv) * 2 - 1;
      const e = Math.min(1, Math.max(Math.abs(v), (Math.abs(u) - (1 - k)) / k));
      const y = h * Math.pow(1 - e, 1.45) + curl * Math.pow(Math.abs(u * v), 5) + curl * 0.25 * Math.pow(Math.abs(u), 12);
      pos.push((u * w) / 2, y, (v * d) / 2);
      uvs.push(e, (u + 1) / 2);
    }
  }
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i;
      const b = a + 1;
      const c = a + nu + 1;
      const e = c + 1;
      idx.push(a, c, b, b, c, e);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function roofMaterial(tiles: THREE.Texture, width: number) {
  const m = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  m.colorNode = TSL.Fn(() => {
    // The tiles in rows down the slope (a tile about a span across); under the eaves, the rafters,
    // lit warm by the lanterns
    const e = TSL.uv().x;
    const across = TSL.uv().y;
    const tile = TSL.texture(tiles, vec2(across.mul(width / 2.2), e.mul(1.6))).rgb;
    const rafters = mix(hex('#3A160C'), hex('#5A2412'), smoothstep(0.6, 0.9, abs(sin(across.mul(width * 9)))));
    const below = TSL.normalWorld.y.lessThan(0);
    const base = TSL.select(below, rafters, tile.mul(0.9)) as unknown as V3;
    return lacquer(base, float(0) as unknown as F, float(0.15) as unknown as F);
  })();
  return m;
}

/** Red-lacquered wood: pillars, beams */
function woodMaterial(colour: string, gild = 0) {
  const m = new THREE.MeshBasicNodeMaterial();
  m.colorNode = TSL.Fn(() => lacquer(hex(colour), float(gild) as unknown as F, float(0.1) as unknown as F))();
  return m;
}

/** The bamboo screen (the mành): slats of split bamboo, the light inside showing between them */
function screenMaterial(blind: THREE.Texture, glow: F) {
  const m = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  m.colorNode = TSL.Fn(() => {
    const p = TSL.positionWorld;
    const c = TSL.texture(blind, vec2(p.x.mul(0.42), p.y.mul(0.42))).rgb;
    const lum = dot(c, vec3(0.3, 0.59, 0.11));
    const gap = smoothstep(0.16, 0.04, lum);
    const lit = lacquer(c.mul(0.85) as unknown as V3, float(0.05) as unknown as F, float(0.05) as unknown as F);
    // Wet and dark where it dips in the water
    const wet = smoothstep(0.5, 0.0, p.y);
    const inside = hex('#FF8A36').mul(gap.mul(glow).mul(0.7));
    return lit.mul(float(1).sub(wet.mul(0.6))).add(inside);
  })();
  return m;
}

/** Gold where it's gilded (yellow), lacquer red or black where it isn't */
const gilded = (c: V3) => smoothstep(0.28, 0.5, c.y).mul(smoothstep(0.05, 0.2, c.x.sub(c.z))) as unknown as F;

/** A painted, carved board: the frieze, the ridge's dragons, laid `copies` times along it */
function carvedMaterial(art: THREE.Texture, copies: number, cutout: boolean, glow = 0) {
  const m = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  const c = TSL.texture(art, vec2(TSL.uv().x.mul(copies), TSL.uv().y));
  m.colorNode = TSL.Fn(() => {
    const col = c.rgb as unknown as V3;
    const lit = lacquer(col.mul(1.1) as unknown as V3, gilded(col).mul(0.9) as unknown as F, float(0.05) as unknown as F);
    // The pearl, the flames round it: warm, catching the lantern light
    const warm = smoothstep(0.55, 0.85, col.x).mul(smoothstep(0.35, 0.6, col.y));
    return lit.add(hex('#FFB060').mul(warm.mul(glow)));
  })();
  if (cutout) {
    m.opacityNode = c.a;
    m.alphaTest = 0.4;
  }
  return m;
}

/** A lantern: red silk on a gold frame, lit from within */
function lanternGeometry() {
  const parts = [
    new THREE.SphereGeometry(0.17, 18, 12).scale(1, 1.3, 1),
    new THREE.CylinderGeometry(0.09, 0.11, 0.05, 12).translate(0, 0.23, 0),
    new THREE.CylinderGeometry(0.11, 0.09, 0.05, 12).translate(0, -0.23, 0),
    new THREE.ConeGeometry(0.035, 0.2, 8).rotateX(Math.PI).translate(0, -0.36, 0),
    new THREE.CylinderGeometry(0.006, 0.006, 0.5, 4).translate(0, 0.5, 0),
  ].map((g) => (g.index ? g.toNonIndexed() : g));
  return mergeGeometries(parts);
}

function lanternMaterial() {
  const m = new THREE.MeshBasicNodeMaterial();
  m.colorNode = TSL.Fn(() => {
    const n = normalize(TSL.normalWorld);
    const v = normalize(TSL.cameraPosition.sub(TSL.positionWorld));
    const facing = saturate(dot(n, v));
    const local = TSL.positionLocal;
    const silk = smoothstep(0.24, 0.2, abs(local.y));
    // Brightest through the middle of the silk, where it's thinnest seen
    const glow = hex('#FF4A1C').mul(pow(facing, 1.5).mul(2.6).add(0.4));
    const ribs = smoothstep(0.85, 1.0, abs(sin(TSL.atan(local.x, local.z).mul(6))));
    const frame = hex('#3A2008');
    return mix(frame, glow.mul(float(1).sub(ribs.mul(0.45))), silk);
  })();
  return m;
}

/** A lotus lamp: two rings of petals round a candle */
function lotusGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  const rings = [
    { n: 8, len: 0.16, tilt: 1.05, y: 0.0, r: 0.05 },
    { n: 7, len: 0.13, tilt: 0.55, y: 0.02, r: 0.03 },
  ];
  rings.forEach((ring, ri) => {
    for (let i = 0; i < ring.n; i++) {
      const a = (i / ring.n) * Math.PI * 2 + ri * 0.4;
      const petal = new THREE.SphereGeometry(1, 10, 8);
      petal.translate(0, 1, 0);
      petal.scale(0.055, ring.len / 2, 0.022);
      petal.rotateX(ring.tilt);
      petal.rotateY(a);
      petal.translate(Math.sin(a) * ring.r, ring.y, Math.cos(a) * ring.r);
      parts.push(petal.toNonIndexed());
    }
  });
  parts.push(new THREE.CylinderGeometry(0.045, 0.06, 0.05, 12).translate(0, 0.0, 0).toNonIndexed());
  return mergeGeometries(parts);
}

function lotusMaterial() {
  const m = new THREE.MeshBasicNodeMaterial();
  m.colorNode = TSL.Fn(() => {
    const local = TSL.positionLocal;
    const r = TSL.length(local.xz);
    // Pink at the tips, glowing cream near the candle
    const petal = mix(hex('#FFE8C4'), hex('#F06A8E'), smoothstep(0.03, 0.16, r.add(local.y.mul(0.5))));
    const lit = lacquer(petal as unknown as V3, float(0) as unknown as F, float(0.2) as unknown as F);
    const inner = hex('#FFB055').mul(exp(r.mul(r).mul(-90)).mul(1.6).add(exp(r.mul(-14)).mul(0.5)));
    return lit.mul(0.6).add(inner);
  })();
  return m;
}

function flameMaterial() {
  const m = new THREE.MeshBasicNodeMaterial();
  m.colorNode = TSL.Fn(() => {
    const n = normalize(TSL.normalWorld);
    const v = normalize(TSL.cameraPosition.sub(TSL.positionWorld));
    const core = pow(saturate(dot(n, v)), 1.2);
    return mix(hex('#FF7A1A'), hex('#FFF4C8'), core).mul(3.2);
  })();
  return m;
}

export type Lotus = { mesh: THREE.Group; x: number; z: number; vx: number; vz: number; spin: number; tilt: THREE.Vector2; seed: number };

/** Flag colours, the five: red, yellow, blue, white, green */
const FIVE = ['#C2161C', '#E9B11E', '#1E4CA6', '#EFE8D6', '#2C8A3A'];

/**
 * A swallow-tailed flag (cờ đuôi nheo): a long pennant hung from a crossbar near the top of its
 * pole, its edges cut in teeth of the next colour, its foot forked; it lifts and ripples in the
 * breeze, more toward its foot.
 */
function flagMaterial(main: string, edge: string) {
  const m = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  const u = TSL.uv().x.sub(0.5).abs();
  const v = TSL.uv().y;
  const teeth = TSL.fract(v.mul(26)).sub(0.5).abs().mul(0.08);
  const phase = TSL.modelPosition.x.mul(0.9).add(TSL.modelPosition.z.mul(0.7));
  const t = TSL.time;
  const pl = TSL.positionLocal;
  const loose = pow(float(1).sub(v), 1.4);
  const flutter = sin(t.mul(2.4).add(v.mul(5)).add(phase)).mul(0.12).add(sin(t.mul(4.1).add(v.mul(9)).add(phase.mul(2))).mul(0.04));
  m.positionNode = vec3(pl.x.add(loose.mul(0.18)).add(flutter.mul(loose).mul(0.3)), pl.y.add(loose.mul(0.06)), pl.z.add(flutter.mul(loose)));
  m.colorNode = TSL.Fn(() => {
    // The fork at its foot, the toothed edges
    TSL.If(u.greaterThan(float(0.5).sub(teeth)).or(v.lessThan(float(0.2).sub(u.mul(0.4))).and(u.lessThan(0.22))), () => {
      TSL.Discard();
    });
    const border = smoothstep(0.31, 0.33, u.add(teeth));
    const band = smoothstep(0.012, 0.0, abs(v.sub(0.86)).sub(0.03));
    const cloth = mix(hex(main), hex(edge), max(border, band));
    // Thin: lit from either side, the light behind it glowing through
    return lacquer(cloth as unknown as V3, float(0) as unknown as F, float(0) as unknown as F).mul(0.85).add(cloth.mul(0.08));
  })();
  return m;
}

export function buildStage(art: Art) {
  const root = new THREE.Group();
  root.add(sky());

  // ---- The stage house ----
  const house = new THREE.Group();
  house.position.set(0, 0, STAGE.z);
  house.scale.setScalar(STAGE.scale);
  root.add(house);
  const red = woodMaterial('#8A140C');
  const dark = woodMaterial('#2A140C');
  const gold = woodMaterial('#E0A440', 0.85);
  const W = STAGE.width;
  const D = STAGE.depth;
  // Pillars, front and back, standing on stone in the water, gilded at their heads
  const pillar = new THREE.CylinderGeometry(0.11, 0.13, 3.4, 12);
  const plinth = new THREE.CylinderGeometry(0.2, 0.24, 0.5, 8);
  const capital = new THREE.CylinderGeometry(0.17, 0.12, 0.16, 12);
  const stone = woodMaterial('#4A4A48');
  for (const x of [-W / 2, -W / 6, W / 6, W / 2]) {
    for (const z of [D / 2, -D / 2]) {
      const p = new THREE.Mesh(pillar, red);
      p.position.set(x, 1.7, z);
      house.add(p);
      const b = new THREE.Mesh(plinth, stone);
      b.position.set(x, 0.0, z);
      house.add(b);
      const c = new THREE.Mesh(capital, gold);
      c.position.set(x, 3.3, z);
      house.add(c);
    }
  }
  // The beam over the screen, its gold edging, the carved frieze over it, the floor behind
  const beam = new THREE.Mesh(new THREE.BoxGeometry(W + 0.5, 0.36, 0.2), red);
  beam.position.set(0, 2.55, D / 2 + 0.02);
  house.add(beam);
  const trim = new THREE.Mesh(new THREE.BoxGeometry(W + 0.5, 0.05, 0.22), gold);
  trim.position.set(0, 2.36, D / 2 + 0.03);
  house.add(trim);
  const trim2 = trim.clone();
  trim2.position.y = 2.74;
  house.add(trim2);
  const fascia = new THREE.Mesh(new THREE.BoxGeometry(W + 0.5, 0.5, 0.12), dark);
  fascia.position.set(0, 3.08, D / 2 + 0.02);
  house.add(fascia);
  const frieze = new THREE.Mesh(new THREE.PlaneGeometry(W + 0.5, 0.5), carvedMaterial(art.frieze.texture, Math.round((W + 0.5) / 0.5 / art.frieze.aspect), false));
  frieze.position.set(0, 3.08, D / 2 + 0.085);
  house.add(frieze);
  const floorDeck = new THREE.Mesh(new THREE.BoxGeometry(W, 0.18, D), dark);
  floorDeck.position.set(0, 0.95, -0.15);
  house.add(floorDeck);
  const backWall = new THREE.Mesh(new THREE.BoxGeometry(W, 2.4, 0.08), dark);
  backWall.position.set(0, 2.2, -D / 2);
  house.add(backWall);
  // The bamboo screen, across the whole front, down into the water
  const glow = TSL.uniform(1);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(W, 2.4), screenMaterial(art.blind.texture, glow as unknown as F));
  screen.position.set(0, 1.1, D / 2 + 0.05);
  house.add(screen);
  // Two tiers of roof
  const lower = new THREE.Mesh(roofGeometry(W + 2.2, D + 2.0, 1.2, 0.9), roofMaterial(art.tiles.texture, W + 2.2));
  lower.position.set(0, 3.32, 0);
  house.add(lower);
  const upper = new THREE.Mesh(roofGeometry(W * 0.62, D * 0.7, 1.15, 0.75), roofMaterial(art.tiles.texture, W * 0.62));
  upper.position.set(0, 4.25, 0);
  house.add(upper);
  // A short wall between the tiers, carved too, and the ridge
  const drum = new THREE.Mesh(new THREE.BoxGeometry(W * 0.56, 0.5, D * 0.62), red);
  drum.position.set(0, 4.15, 0);
  house.add(drum);
  const drumFace = new THREE.Mesh(
    new THREE.PlaneGeometry(W * 0.56, 0.42),
    carvedMaterial(art.frieze.texture, Math.max(1, Math.round((W * 0.56) / 0.42 / art.frieze.aspect)), false)
  );
  drumFace.position.set(0, 4.15, D * 0.31 + 0.01);
  house.add(drumFace);
  const ridgeLen = W * 0.62 - D * 0.7 + 0.1;
  const ridge = new THREE.Mesh(new THREE.BoxGeometry(ridgeLen, 0.14, 0.16), dark);
  ridge.position.set(0, 5.42, 0);
  house.add(ridge);
  // On it, two dragons facing the moon between them
  const dragonsW = ridgeLen + 2.2;
  const dragons = new THREE.Mesh(new THREE.PlaneGeometry(dragonsW, dragonsW / art.ridge.aspect), carvedMaterial(art.ridge.texture, 1, true, 0.6));
  dragons.position.set(0, 5.36 + dragonsW / art.ridge.aspect / 2, 0.02);
  house.add(dragons);

  // ---- The band, on its own platform beside the stage: drums, the đàn bầu, flutes ----
  const band = new THREE.Group();
  band.position.set(-6.1, 0, -11.6);
  band.rotation.y = 0.32;
  band.scale.setScalar(0.8);
  root.add(band);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.16, 2.0), dark);
  deck.position.set(0, 0.62, 0);
  band.add(deck);
  for (const x of [-1.35, 1.35]) {
    for (const z of [-0.85, 0.85]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 3.3, 8), red);
      p.position.set(x, 1.15, z);
      band.add(p);
    }
  }
  const bandRoof = new THREE.Mesh(roofGeometry(3.9, 2.9, 0.9, 0.55), roofMaterial(art.tiles.texture, 3.9));
  bandRoof.position.set(0, 2.78, 0);
  band.add(bandRoof);
  const playersH = 2.6 / art.band.aspect;
  const playersMat = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  {
    const c = TSL.texture(art.band.texture, TSL.uv());
    // Lit by their own lantern, warm, from in front and above
    playersMat.colorNode = lacquer(c.rgb as unknown as V3, float(0) as unknown as F, float(0) as unknown as F).add(
      c.rgb.mul(hex('#FF9A50')).mul(0.55)
    );
    playersMat.opacityNode = c.a;
    playersMat.alphaTest = 0.4;
  }
  const players = new THREE.Mesh(new THREE.PlaneGeometry(2.6, playersH), playersMat);
  players.position.set(0, 0.7 + playersH / 2, 0.1);
  band.add(players);

  // ---- The flags, down both sides of the pond ----
  const flagMats = FIVE.map((c, i) => flagMaterial(c, FIVE[(i + 1) % FIVE.length]));
  const flagGeo = new THREE.PlaneGeometry(0.4, 1.8, 1, 24).translate(0, -0.9, 0);
  const caneGeo = new THREE.CylinderGeometry(0.028, 0.04, 4.2, 6).translate(0, 2.1, 0);
  const barGeo = new THREE.CylinderGeometry(0.014, 0.014, 0.6, 5).rotateZ(Math.PI / 2);
  const cane = woodMaterial('#7A5A2A');
  let k = 0;
  for (const z of [-6.4, -9.2, -12.0, -14.8]) {
    for (const side of [-1, 1]) {
      const x = side * (6.6 - (z + 6.4) * 0.12);
      const pole = new THREE.Mesh(caneGeo, cane);
      pole.position.set(x, -0.4, z);
      root.add(pole);
      const bar = new THREE.Mesh(barGeo, cane);
      bar.position.set(x - side * 0.26, 3.55, z);
      root.add(bar);
      const flag = new THREE.Mesh(flagGeo, flagMats[k++ % FIVE.length]);
      flag.position.set(x - side * 0.3, 3.55, z);
      flag.rotation.y = side * 0.5;
      flag.scale.x = -side;
      root.add(flag);
    }
  }

  // The lanterns, along the eaves
  const lanternGeo = lanternGeometry();
  const lanternMat = lanternMaterial();
  const lanterns: THREE.Mesh[] = [];
  for (let i = 0; i < 7; i++) {
    const k = i / 6;
    const l = new THREE.Mesh(lanternGeo, lanternMat);
    l.position.lerpVectors(LANTERN_ROW.a, LANTERN_ROW.b, k);
    l.userData.seed = i * 1.7;
    root.add(l);
    lanterns.push(l);
  }

  // ---- Lotus lamps on the water ----
  const lotusGeo = lotusGeometry();
  const lotusMat = lotusMaterial();
  const flameGeo = new THREE.SphereGeometry(0.022, 10, 8).scale(1, 1.9, 1);
  const flameMat = flameMaterial();
  const spots = [
    [-4.4, -6.2],
    [3.9, -7.6],
    [-2.6, -0.4],
    [3.2, -1.6],
    [-4.8, -2.4],
    [1.6, -5.4],
    [-1.6, -8.6],
  ];
  const lotus: Lotus[] = spots.slice(0, LOTUS_COUNT).map(([x, z], i) => {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(lotusGeo, lotusMat));
    const f = new THREE.Mesh(flameGeo, flameMat);
    f.position.y = 0.075;
    g.add(f);
    g.scale.setScalar(1.25);
    root.add(g);
    return { mesh: g, x, z, vx: 0, vz: 0, spin: Math.random() * 6, tilt: new THREE.Vector2(), seed: i * 2.3 + 1 };
  });

  const slope = { x: 0, z: 0 };
  return {
    root,
    lotus,
    /** The light behind the screen, 0 to 1 */
    glow,
    update(
      t: number,
      dt: number,
      water: { heightAt: (x: number, z: number) => number; slopeAt: (x: number, z: number, out: { x: number; z: number }) => { x: number; z: number } },
      push: (x: number, z: number) => { x: number; z: number }
    ) {
      for (const l of lanterns) {
        const s = l.userData.seed as number;
        l.rotation.z = Math.sin(t * 0.9 + s) * 0.05;
        l.rotation.x = Math.sin(t * 0.7 + s * 2) * 0.03;
      }
      lotus.forEach((l, i) => {
        // Carried down the waves, pushed off by the dragon, drifting slowly, never far from home
        water.slopeAt(l.x, l.z, slope);
        const away = push(l.x, l.z);
        l.vx += (-slope.x * 9 + away.x + Math.sin(t * 0.13 + l.seed) * 0.03) * dt;
        l.vz += (-slope.z * 9 + away.z + Math.cos(t * 0.11 + l.seed) * 0.03) * dt;
        const [hx, hz] = spots[i];
        l.vx += (hx - l.x) * 0.04 * dt;
        l.vz += (hz - l.z) * 0.04 * dt;
        l.vx *= Math.exp(-dt * 0.9);
        l.vz *= Math.exp(-dt * 0.9);
        l.x += l.vx * dt;
        l.z += l.vz * dt;
        const y = water.heightAt(l.x, l.z);
        l.tilt.x += (slope.z * 1.4 - l.tilt.x) * (1 - Math.exp(-dt * 6));
        l.tilt.y += (-slope.x * 1.4 - l.tilt.y) * (1 - Math.exp(-dt * 6));
        l.spin += dt * 0.08;
        l.mesh.position.set(l.x, y + 0.01, l.z);
        l.mesh.rotation.set(l.tilt.x, l.spin, l.tilt.y, 'YXZ');
        const flicker = 1 + Math.sin(t * 13 + l.seed) * 0.04 + Math.sin(t * 23 + l.seed * 3) * 0.03;
        l.mesh.children[1].scale.set(1, flicker, 1);
        (lotusLights[i].value as THREE.Vector3).set(l.x, y + 0.12, l.z);
      });
    },
  };
}

export type Stage = ReturnType<typeof buildStage>;
