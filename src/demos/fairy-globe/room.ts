import * as TSL from 'three/tsl';
import * as THREE from 'three/webgpu';

import { bakedMesh, bulbsMesh, display, lin, litGeometry, type Lit, type Packed, type V } from './baked';
import { dust, sprites } from './fx';
import { Spring } from './physics';
import { smooth, smoother, TimeSpline } from './track';

/**
 * The living room inside the red house (scripts/blender/xmas_room.py), set into the town where it
 * really is: its flue goes up into the house's chimney, its window is the house's, looking out on
 * the square. The light is baked in layers (the room's own, the fire's, the tree lights') and
 * added back together every frame, so the fire can flicker and the tree twinkle.
 *
 * And the present's story. It comes down the chimney and lands on the hearth, right by the fire;
 * opens its eyes; finds it's sitting next to the flames, yelps and hops, sprouts legs and runs.
 * Gets its breath back on the rug, toddles over to the tree, sits down under it, sighs, and drops
 * off to sleep, smiling; then the eyes and the arms and legs are gone, and it's just a present
 * under the tree, the way it should be on Christmas morning.
 *
 * Everything here is in the room's own frame (three's axes: x right, y up, the window and the
 * fireplace on the wall at z = -2), turned and moved into the town by `root`.
 */

const { vec2, vec3, float, mix, smoothstep, sin, uv, time, abs, exp, saturate } = TSL;
type V3 = THREE.Node<'vec3'>;

type RoomData = {
  room: Packed;
  light: { base: number; fire: number; tree: number };
  bulbs: { at: V; c: string }[];
  topper: V;
  candles: V[];
  fire: { at: V; w: number; h: number };
  train: { centre: V; a: number; b: number; cars: Record<string, Lit> };
  gift: V;
  camera: { at: V; look: V; fov: number };
  hearth: { at: V; look: V };
  flue: { top: V; bottom: V };
  kid: V;
  window: { at: V; sashes: { hinge: V; side: number; mesh: Lit }[] };
  place: { at: V; turn: number };
};

export type RoomStage = NonNullable<Awaited<ReturnType<typeof buildRoom>>>;

export async function buildRoom() {
  const data = require('../../../assets/fairy-globe/room/room.json') as RoomData;
  const flicker = TSL.uniform(1);
  const level = TSL.uniform(0.85);
  const twinkle = TSL.uniform(1);
  const exposure = TSL.uniform(0.95);
  const baked = await bakedMesh(
    { mesh: data.room, light: data.light },
    {
      albedo: require('../../../assets/fairy-globe/room/room_albedo.jpg'),
      emit: require('../../../assets/fairy-globe/room/room_emit.jpg'),
      layers: {
        base: require('../../../assets/fairy-globe/room/room_base.png'),
        fire: require('../../../assets/fairy-globe/room/room_fire.png'),
        tree: require('../../../assets/fairy-globe/room/room_tree.png'),
      },
    },
    { fire: flicker, tree: twinkle },
    exposure,
    2.2,
    // Nothing baked across the flue (the ceiling runs over it): it's lined in brick below, all the way up
    { screen: true, hole: { x: data.flue.top[0], z: data.flue.top[2], w: 0.2, d: 0.075, from: data.flue.bottom[1] + 0.3 } }
  );
  if (!baked) return null;

  // Into the town: turned half round about y, then moved
  const root = new THREE.Group();
  root.position.set(...data.place.at);
  root.rotation.y = data.place.turn;
  root.updateMatrix();
  const place = root.matrix.clone();
  /** A point in the room to the town's metres */
  const toTown = (v: THREE.Vector3) => v.clone().applyMatrix4(place);
  root.add(baked);
  // The chimney's top, in the room
  const CHIMNEY_TOP = data.flue.top[1] + 0.52;
  const flueTopAt = new THREE.Vector3(...data.flue.top);
  // Down to just over the firebox: the baked flue walls are too coarse to be seen close up
  const flueLow = new THREE.Vector3(...data.flue.bottom).y + 0.28;
  const flueHigh = CHIMNEY_TOP - 0.03;
  const SHAFT_H = flueHigh - flueLow;
  // The flue lined all the way up in old brick, sooty: lit warm from the fire far below, a little
  // cold moonlight coming in at the top
  const shaftMat = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide });
  const sp = TSL.positionLocal;
  const rowH = 0.068;
  const row = sp.y.div(rowH).floor();
  const course = sp.x.add(sp.z).div(0.21).add(row.mul(0.5));
  const brickId = TSL.hash(course.floor().mul(17.3).add(row.mul(5.1)));
  const joint = TSL.step(TSL.fract(course), 0.05).max(TSL.step(TSL.fract(sp.y.div(rowH)), 0.1));
  const brick = mix(vec3(0.28, 0.1, 0.06), vec3(0.4, 0.16, 0.09), brickId).mul(brickId.mul(0.35).add(0.65));
  // Soot heavier toward the fire
  const soot = TSL.smoothstep(SHAFT_H * 0.5, -SHAFT_H * 0.5, sp.y).mul(0.55).add(0.25);
  const albedo = mix(brick.mul(float(1).sub(soot)), vec3(0.05, 0.045, 0.04), joint);
  const fromFire = sp.y.add(SHAFT_H / 2).mul(-0.42).exp().mul(3.0).mul(flicker);
  const fromSky = sp.y.sub(SHAFT_H / 2).mul(1.1).exp().mul(0.8);
  shaftMat.colorNode = display(
    albedo.mul(vec3(1.0, 0.55, 0.25).mul(fromFire).add(vec3(0.45, 0.52, 0.75).mul(fromSky)).add(0.22)) as unknown as V3
  );
  const shaftGeo = new THREE.CylinderGeometry(Math.SQRT1_2, Math.SQRT1_2, 1, 4, 1, true).rotateY(Math.PI / 4).scale(0.42, flueHigh - flueLow, 0.16);
  const shaft = new THREE.Mesh(shaftGeo, shaftMat);
  shaft.position.set(flueTopAt.x, (flueHigh + flueLow) / 2, flueTopAt.z);
  root.add(shaft);

  // ---- The fire: flame sheets at three depths, rising and licking ----
  const fireAt = new THREE.Vector3(...data.fire.at);
  const flames = new THREE.Group();
  for (let k = 0; k < 3; k++) {
    const fm = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const q = uv();
    const seed = k * 7.3;
    const rise = vec2(q.x.mul(3.2).add(seed), q.y.mul(2.4).sub(time.mul(1.6 + k * 0.35)));
    const n1 = TSL.mx_noise_float(rise);
    const n2 = TSL.mx_noise_float(rise.mul(2.3).add(4.1));
    const wobble = n1.mul(0.16).add(n2.mul(0.07));
    const x = q.x.sub(0.5).add(wobble.mul(q.y));
    const tongues = sin(x.mul(Math.PI * (3 + k)).add(seed)).mul(0.5).add(0.5);
    const height = mix(float(0.45), float(0.95), tongues).mul(n1.mul(0.25).add(0.85));
    const body = smoothstep(height, height.sub(0.35), q.y).mul(smoothstep(0.5, 0.18, abs(x)));
    const hot = smoothstep(0.15, 0.85, body);
    const col = mix(mix(vec3(0.55, 0.04, 0.0), vec3(1.0, 0.32, 0.03), smoothstep(0.0, 0.45, body)), vec3(1.0, 0.85, 0.45), hot.mul(hot));
    fm.colorNode = display(col.mul(body).mul(1.35 - k * 0.3).mul(level) as unknown as V3);
    const sheet = new THREE.Mesh(new THREE.PlaneGeometry(data.fire.w * (1 - k * 0.15), data.fire.h * (1 - k * 0.1)), fm);
    sheet.position.set(fireAt.x + (k - 1) * 0.05, fireAt.y + (data.fire.h * (1 - k * 0.1)) / 2 - 0.02, fireAt.z - 0.08 + k * 0.08);
    sheet.renderOrder = 5 + k;
    sheet.userData.baseY = sheet.position.y;
    sheet.userData.h = data.fire.h * (1 - k * 0.1);
    flames.add(sheet);
  }
  root.add(flames);

  // ---- Candle flames ----
  for (const c of data.candles) {
    const cm = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const q = uv().sub(vec2(0.5, 0.3));
    const sway = sin(time.mul(7.0).add(c[0] * 10)).mul(0.04).mul(q.y.add(0.3));
    const shape = exp(q.x.add(sway).mul(q.x.add(sway)).mul(-60).sub(q.y.mul(q.y).mul(q.y.lessThan(0).select(40, 9))));
    cm.colorNode = display(mix(vec3(1.0, 0.45, 0.08), vec3(1.0, 0.92, 0.7), saturate(shape.mul(1.4).sub(0.3))).mul(shape.mul(2.2)) as unknown as V3);
    const f = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.12), cm);
    f.position.set(c[0], c[1] + 0.01, c[2]);
    f.renderOrder = 6;
    root.add(f);
  }

  // Not the ones on the string across the chimney breast that would hang inside the flue
  const inFlue = (at: V) =>
    Math.abs(at[0] - data.flue.top[0]) < 0.26 && Math.abs(at[2] - data.flue.top[2]) < 0.13 && at[1] > data.flue.bottom[1] + 0.3;
  root.add(bulbsMesh(data.bulbs.filter((b) => !inFlue(b.at)), 0.019, 1.7, { screen: true }));

  // ---- Lit by the room: the firelight on one side, the tree's on the other ----
  const n = TSL.normalize(TSL.normalWorld);
  const fireWorld = TSL.uniform(new THREE.Vector3());
  const toFire = TSL.normalize(fireWorld.sub(TSL.positionWorld));
  const warm = saturate(TSL.dot(n, toFire)).mul(flicker).mul(0.85);
  const fromTree = saturate(n.y.mul(0.4).add(0.5)).mul(0.35);
  const roomLight = vec3(1.0, 0.62, 0.32).mul(warm).add(vec3(0.42, 0.4, 0.5).mul(fromTree)).add(0.08);
  const lit = (c: THREE.Color | string, extra?: THREE.Node<'vec3'>) => {
    const k = typeof c === 'string' ? lin(c) : c;
    let v = vec3(k.r, k.g, k.b).mul(roomLight) as unknown as V3;
    if (extra) v = v.add(extra) as unknown as V3;
    return display(v);
  };

  // ---- The toy train ----
  const trainMat = new THREE.MeshBasicNodeMaterial();
  trainMat.colorNode = display((TSL.attribute('color', 'vec3') as unknown as V3).mul(roomLight) as unknown as V3);
  const centre = new THREE.Vector3(...data.train.centre);
  const cars = (['engine', 'car_a', 'car_b'] as const).map((k) => {
    const mesh = new THREE.Mesh(litGeometry(data.train.cars[k]), trainMat);
    root.add(mesh);
    return mesh;
  });

  // ---- The window: two casements that swing out ----
  const sashes = data.window.sashes.map((s) => {
    const pivot = new THREE.Group();
    pivot.position.set(...s.hinge);
    pivot.add(new THREE.Mesh(litGeometry(s.mesh), trainMat));
    root.add(pivot);
    return { pivot, side: s.side, swing: new Spring(40, 4.5) };
  });

  // ---- The present: paper and ribbon, and what it grows ----
  const heat = TSL.uniform(0);
  const gift = new THREE.Group();
  const paperMat = new THREE.MeshBasicNodeMaterial();
  paperMat.colorNode = lit('#D8344A', vec3(1.0, 0.35, 0.05).mul(heat) as unknown as V3);
  const ribbonMat = new THREE.MeshBasicNodeMaterial();
  ribbonMat.colorNode = lit('#F4C64E', vec3(0.05, 0.035, 0.0) as unknown as V3);
  gift.add(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.16, 0.2), paperMat));
  gift.add(new THREE.Mesh(new THREE.BoxGeometry(0.205, 0.165, 0.045), ribbonMat));
  gift.add(new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.165, 0.205), ribbonMat));
  for (const s of [-1, 1]) {
    const loop = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.011, 8, 16), ribbonMat);
    loop.position.set(s * 0.032, 0.1, 0);
    loop.rotation.set(0, s * 0.5, 0);
    gift.add(loop);
  }
  gift.visible = false;
  root.add(gift);
  const limbMat = new THREE.MeshBasicNodeMaterial();
  limbMat.colorNode = lit('#2E7D4F');
  const bootMat = new THREE.MeshBasicNodeMaterial();
  bootMat.colorNode = lit('#3A2418');
  const mittenMat = new THREE.MeshBasicNodeMaterial();
  mittenMat.colorNode = lit('#F6F1E7', vec3(0.03, 0.025, 0.02) as unknown as V3);
  const eyeWhite = new THREE.MeshBasicNodeMaterial();
  eyeWhite.colorNode = display(vec3(0.85, 0.83, 0.8) as unknown as V3);
  const ink = new THREE.MeshBasicNodeMaterial();
  ink.colorNode = vec3(0.04, 0.03, 0.03);
  const blushMat = new THREE.MeshBasicNodeMaterial({ transparent: true });
  blushMat.colorNode = display(vec3(1.0, 0.35, 0.4) as unknown as V3);
  const blushOpacity = TSL.uniform(0);
  blushMat.opacityNode = blushOpacity;
  const legs = [-1, 1].map((side) => {
    const hip = new THREE.Group();
    hip.position.set(side * 0.05, -0.08, 0);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.07, 8), limbMat);
    leg.position.y = -0.035;
    const boot = new THREE.Mesh(new THREE.SphereGeometry(0.02, 12, 8).scale(1, 0.7, 1.5), bootMat);
    boot.position.set(0, -0.072, 0.01);
    hip.add(leg, boot);
    hip.scale.setScalar(0.001);
    gift.add(hip);
    return hip;
  });
  const arms = [-1, 1].map((side) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.1, 0.0, 0);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.06, 8), limbMat);
    arm.position.y = -0.03;
    const mitten = new THREE.Mesh(new THREE.SphereGeometry(0.016, 10, 8), mittenMat);
    mitten.position.y = -0.064;
    shoulder.add(arm, mitten);
    shoulder.scale.setScalar(0.001);
    gift.add(shoulder);
    return shoulder;
  });
  // Eyes: open (white and pupil), squeezed shut in a wince (> <), or closed asleep (a soft curve)
  const face = new THREE.Group();
  face.position.set(0, 0, 0.101);
  face.scale.setScalar(0.001);
  gift.add(face);
  const eyes = [-1, 1].map((side) => {
    const e = new THREE.Group();
    e.position.set(side * 0.034, 0.008, 0);
    // Open: a big glossy black oval, two catchlights
    const open = new THREE.Group();
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.016, 18, 12).scale(0.86, 1.15, 0.32), ink);
    const shine = new THREE.Mesh(new THREE.SphereGeometry(0.0058, 10, 6).scale(1, 1, 0.4), eyeWhite);
    shine.position.set(-0.0045, 0.007, 0.005);
    const glint = new THREE.Mesh(new THREE.SphereGeometry(0.0028, 8, 6).scale(1, 1, 0.4), eyeWhite);
    glint.position.set(0.005, -0.006, 0.005);
    open.add(ball, shine, glint);
    // Squeezed shut: > <
    const wince = new THREE.Group();
    for (const s of [-1, 1]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.0042, 0.004), ink);
      bar.position.set(0, s * 0.0045, 0.005);
      bar.rotation.z = s * side * -0.55;
      wince.add(bar);
    }
    // Asleep: a soft curve
    const asleep = new THREE.Mesh(new THREE.TorusGeometry(0.012, 0.0026, 6, 16, Math.PI), ink);
    asleep.rotation.z = Math.PI;
    asleep.position.set(0, 0.002, 0.005);
    e.add(open, wince, asleep);
    face.add(e);
    return { e, open, wince, asleep };
  });
  // A little cat mouth, two tiny curves
  const smile = new THREE.Group();
  for (const s of [-1, 1]) {
    const arc = new THREE.Mesh(new THREE.TorusGeometry(0.0055, 0.0018, 5, 12, Math.PI), ink);
    arc.rotation.z = Math.PI;
    arc.position.set(s * 0.0055, 0, 0);
    smile.add(arc);
  }
  smile.position.set(0, -0.016, 0.003);
  const mouthO = new THREE.Mesh(new THREE.SphereGeometry(0.007, 12, 8).scale(0.9, 1.15, 0.3), ink);
  mouthO.position.set(0, -0.019, 0.003);
  face.add(smile, mouthO);
  for (const s of [-1, 1]) {
    const blush = new THREE.Mesh(new THREE.CircleGeometry(0.011, 16).scale(1.3, 0.8, 1), blushMat);
    blush.position.set(s * 0.056, -0.012, 0.003);
    face.add(blush);
  }

  // ---- Glow and wisps ----
  const glow = sprites(700, true);
  const wisps = sprites(160, true, true);
  root.add(glow.mesh, wisps.mesh);
  const sparks = dust(300);
  const steam = dust(160);
  const motes = Array.from({ length: 90 }, (_, k) => ({
    at: new THREE.Vector3(-1.6 + Math.random() * 3.2, 0.2 + Math.random() * 2.6, -1.9 + Math.random() * 3.2),
    seed: k * 1.37,
  }));
  const identity = new THREE.Matrix4();
  const tmp = new THREE.Vector3();
  const tc = new THREE.Color();
  const spark = lin('#FF9A3C');
  const topper = new THREE.Vector3(...data.topper);
  const gold = lin('#FFD873').multiplyScalar(2.2);
  const rose = lin('#FF8FB8').multiplyScalar(2);
  const ice = lin('#9FE8FF').multiplyScalar(2);
  const steamTint = new THREE.Color(0.8, 0.78, 0.76);
  const sweat = lin('#9FD8FF').multiplyScalar(1.4);
  let sparkClock = 0;
  const burst = (at: THREE.Vector3, n: number, colours: THREE.Color[], up: number) => {
    for (let k = 0; k < n; k++) {
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * up, Math.random() - 0.5).multiplyScalar(0.9);
      sparks.emit(at, v, 0.6 + Math.random() * 0.8, 0.01 + Math.random() * 0.012, colours[k % colours.length], 0.85);
    }
  };

  // ---- Places in the room ----
  const flueTop = new THREE.Vector3(...data.flue.top);
  const flueBottom = new THREE.Vector3(...data.flue.bottom);
  const HEARTH_Y = 0.075;
  const hearth = new THREE.Vector3(fireAt.x + 0.15, HEARTH_Y + 0.08, fireAt.z + 0.38);
  const rug = new THREE.Vector3(-0.05, 0.08, -0.56);
  // Where it sits: in the middle of the train's loop, in front of the tree
  const spot = new THREE.Vector3(data.gift[0], 0.08, data.gift[2]);
  const hero = { at: new THREE.Vector3(...data.camera.at), look: new THREE.Vector3(...data.camera.look) };
  const windowAt = new THREE.Vector3(...data.window.at);
  const outOfArch = new THREE.Vector3(flueBottom.x + 0.05, 0.42, fireAt.z + 1.15);

  // ---- The present's fall and story ----
  let dropAt = -1;
  let landed = -1;
  let bumped = -1;
  /** Down the flue, then the hop out, seconds */
  const FALL = 1.25;
  const HOP = 0.62;
  const dropFrom = CHIMNEY_TOP + 0.5;
  const logs = fireAt.y + 0.32;
  const land = new Spring(180, 9);
  let S0 = 1e9;
  // The story's moments, from S0 (when it's landed and the camera's come out under the arch)
  const HOT = 2.0;
  const DASH = 3.3;
  const RUG = 4.1;
  const WALK = 5.0;
  const SIT = 7.0;
  const SLEEP = 8.2;
  const GONE = 9.6;
  const END = 10.8;
  /** How wide the window opens, radians */
  const OPEN = 1.95;

  const pose = (s: number, dt: number) => {
    // s: seconds since S0
    const sprout = smoother(HOT - 0.1, HOT + 0.35, s) * (1 - smoother(GONE, GONE + 0.7, s));
    const legsOut = smoother(HOT + 0.25, HOT + 0.5, s) * (1 - smoother(GONE - 0.2, GONE + 0.5, s));
    face.scale.setScalar(Math.max(0.001, sprout * (1 + 0.15 * Math.exp(-((s - HOT - 0.2) ** 2) * 60))));
    for (const l of legs) l.scale.setScalar(Math.max(0.001, legsOut));
    for (const a of arms) a.scale.setScalar(Math.max(0.001, legsOut));
    // Heat: it builds sitting by the fire, flushes as it yelps, fades as it runs off
    heat.value = smooth(0.4, HOT + 0.4, s) * (1 - smooth(DASH + 0.2, RUG + 0.6, s)) * (0.8 + 0.2 * Math.sin(s * 30));
    // Where it is: on the hearth hopping, the dash to the rug, the walk to the tree
    const at = tmp.copy(hearth);
    let yaw = Math.atan2(hero.at.x - hearth.x, hero.at.z - hearth.z);
    let hop = 0;
    for (const h0 of [HOT + 0.4, HOT + 0.85]) {
      const u = (s - h0) / 0.42;
      if (u > 0 && u < 1) hop = Math.max(hop, 4 * u * (1 - u) * 0.13);
    }
    let stepping = 0;
    let gait = 0;
    if (s >= DASH && s < RUG) {
      const u = smooth(DASH, RUG, s);
      at.lerpVectors(hearth, rug, u);
      yaw = Math.atan2(rug.x - hearth.x, rug.z - hearth.z);
      stepping = 1;
      gait = 6.5;
    } else if (s >= RUG && s < WALK) {
      at.copy(rug);
      yaw = Math.atan2(hero.at.x - rug.x, hero.at.z - rug.z);
    } else if (s >= WALK) {
      const u = smooth(WALK, SIT - 0.3, s);
      at.lerpVectors(rug, spot, u);
      const toTree = Math.atan2(spot.x - rug.x, spot.z - rug.z);
      const toCam = Math.atan2(hero.at.x - spot.x, hero.at.z - spot.z);
      yaw = s < SIT - 0.3 ? toTree : THREE.MathUtils.lerp(toTree, toCam, smooth(SIT - 0.3, SIT + 0.2, s));
      stepping = s < SIT - 0.3 ? 1 : 0;
      gait = 2.6;
    }
    if (s >= RUG - 0.5 && s < WALK + 0.4) {
      // Turning round to face you before it sets off again
      yaw = THREE.MathUtils.lerp(Math.atan2(rug.x - hearth.x, rug.z - hearth.z), yaw, smooth(RUG - 0.5, RUG, s));
    }
    const ph = s * Math.PI * 2 * gait;
    // Standing up on its new legs, sitting down at the tree
    const stand = smooth(HOT + 0.3, HOT + 0.55, s) * 0.075;
    const sit = smooth(SIT, SIT + 0.45, s);
    at.y += stand * (1 - sit * 0.8) * (1 - smoother(GONE, GONE + 0.6, s)) + hop + stepping * Math.abs(Math.sin(ph)) * 0.014;
    // Panting on the rug: quick breaths; asleep: slow ones
    const pant = s > RUG && s < WALK ? Math.sin(s * 20) * 0.04 : 0;
    const sleepBreath = s > SLEEP ? Math.sin(s * 2.2) * 0.025 * (1 - smooth(GONE, GONE + 0.5, s)) : 0;
    const sigh = Math.exp(-((s - (SIT + 0.6)) ** 2) * 6) * 0.08;
    gift.position.copy(at);
    gift.rotation.set(0, yaw, stepping * Math.sin(ph) * 0.1 + (s > HOT + 0.3 && s < DASH ? Math.sin(s * 40) * 0.08 : 0));
    gift.scale.set(1 + pant * 0.5 + sigh * 0.4, 1 - pant - sigh + sleepBreath, 1 + pant * 0.5 + sigh * 0.4);
    legs[0].rotation.x = stepping * Math.sin(ph) * 0.8 - sit * 1.45;
    legs[1].rotation.x = -stepping * Math.sin(ph) * 0.8 - sit * 1.45;
    // Arms: flapping at the heat, swinging as it runs, a mitten up to wipe its brow, folded asleep
    const flap = s > HOT + 0.3 && s < DASH ? Math.sin(s * 34) * 0.9 + 1.4 : 0;
    const wipe = smooth(RUG + 0.2, RUG + 0.45, s) * (1 - smooth(RUG + 0.9, WALK - 0.1, s));
    arms[0].rotation.set(-stepping * Math.sin(ph) * 0.7, 0, -0.35 - flap * 0.8);
    arms[1].rotation.set(stepping * Math.sin(ph) * 0.7 - wipe * 2.3, 0, 0.35 + flap * 0.8 + wipe * 0.9 + Math.sin(s * 9) * wipe * 0.15);
    if (s > SLEEP) {
      const fold = smooth(SLEEP, SLEEP + 0.8, s);
      arms[0].rotation.z = THREE.MathUtils.lerp(arms[0].rotation.z, -0.15, fold);
      arms[1].rotation.z = THREE.MathUtils.lerp(arms[1].rotation.z, 0.15, fold);
    }
    // The face: eyes pop open, look down at the flames, squeeze shut as it yelps; open again on the
    // rug, a blink or two; at the tree, the lids come slowly down and stay down
    const wincing = s > HOT + 0.35 && s < DASH + 0.15;
    const closing = smooth(SLEEP, SLEEP + 1.1, s);
    // A blink is the lids down for a moment (the curve of a closed eye), never the eye squashed flat
    const blinking = s < SLEEP && (Math.sin(s * 1.9) > 0.985 || Math.abs(s - (RUG + 0.1)) < 0.07);
    const shut = blinking || closing > 0.5;
    for (const e of eyes) {
      e.open.visible = !wincing && !shut;
      // Wide with surprise as it lands, a little sleepy as the lids grow heavy
      e.open.scale.setScalar(s < HOT + 0.3 ? 1.1 : 1 - closing * 0.25);
      e.wince.visible = wincing;
      e.asleep.visible = !wincing && shut;
      e.asleep.scale.setScalar(1);
      // Glancing down at the fire behind, at first
      const look = s < HOT + 0.35 ? smooth(HOT + 0.05, HOT + 0.25, s) : 0;
      e.open.position.set(0, -look * 0.004, 0);
    }
    mouthO.visible = (s > HOT + 0.3 && s < DASH + 0.3) || (s > RUG && s < WALK);
    mouthO.scale.setScalar(s > RUG ? 0.6 + 0.4 * Math.abs(Math.sin(s * 20)) : 1.2);
    smile.visible = !mouthO.visible;
    smile.scale.setScalar(s > SLEEP ? 0.85 : 1);
    // Pink cheeks always, rosier hot and asleep
    const rosy = 0.4 + 0.3 * smooth(HOT + 0.3, HOT + 0.6, s) * (1 - smooth(DASH, RUG + 0.5, s)) + 0.35 * smooth(SIT + 0.3, SIT + 1.2, s);
    blushOpacity.value = rosy * (1 - smooth(GONE, GONE + 0.5, s));
    if (s > GONE + 0.7) {
      // Just a present again
      gift.rotation.set(0, yaw, 0);
      gift.scale.setScalar(1);
    }
    // Heat coming off it: steam from the bottom while it's by the fire, a trail as it runs
    if (s > 0.6 && s < RUG + 0.3 && Math.random() < (s < DASH ? 0.5 : 0.8)) {
      steam.emit(
        tmp.copy(gift.position).add(new THREE.Vector3((Math.random() - 0.5) * 0.15, -0.05, (Math.random() - 0.5) * 0.15)),
        new THREE.Vector3((Math.random() - 0.5) * 0.05, 0.12 + Math.random() * 0.12, (Math.random() - 0.5) * 0.05),
        1.2 + Math.random() * 0.8,
        0.03 + Math.random() * 0.03,
        steamTint,
        0
      );
    }
    // Sweat flying off on the rug
    if (s > RUG && s < RUG + 0.8 && Math.random() < 0.25) {
      sparks.emit(
        tmp.copy(gift.position).add(new THREE.Vector3(0, 0.1, 0)),
        new THREE.Vector3((Math.random() - 0.5) * 0.4, 0.3, (Math.random() - 0.5) * 0.4),
        0.5,
        0.008,
        sweat,
        0
      );
    }
    if (s >= GONE + 0.35 && s < GONE + 0.35 + dt) burst(gift.position, 40, [gold, rose, ice], 1.0);
    if (s >= HOT + 0.35 && s < HOT + 0.35 + dt) burst(gift.position, 30, [spark.clone().multiplyScalar(2.4)], 1.2);
  };

  // ---- The camera in here ----
  // Out under the arch, then low by the hearth for the yelp, back as it runs, after it to the tree,
  // in close as it falls asleep, then back to see the whole room
  const story = (S: number) => {
    S0 = S;
    // 'hot' is the yelp (the squeak and the buzz go with it), a moment after the heat gets to it
    return { end: S + END, hot: S + HOT + 0.3, asleep: S + SLEEP };
  };
  // A little above the toys on the floor in front of the hearth, looking down past them at it
  const close = hearth.clone().add(new THREE.Vector3(0.38, 0.3, 0.72));
  const closeLook = hearth.clone().add(new THREE.Vector3(-0.05, 0.02, -0.05));
  const tour = () =>
    new TimeSpline([
      { t: 0.0, p: close.clone() },
      { t: DASH + 0.1, p: close.clone().add(new THREE.Vector3(0.02, 0.01, 0.03)) },
      { t: RUG + 0.3, p: new THREE.Vector3(0.55, 0.75, 0.35) },
      { t: WALK + 0.4, p: new THREE.Vector3(0.5, 0.72, 0.85) },
      { t: SIT + 0.2, p: new THREE.Vector3(0.95, 0.52, 0.74) },
      { t: GONE + 0.2, p: new THREE.Vector3(1.02, 0.42, 0.52) },
      { t: END + 0.6, p: hero.at.clone() },
    ]);
  const looks = () =>
    new TimeSpline([
      { t: 0.0, p: closeLook.clone() },
      { t: DASH + 0.1, p: closeLook.clone() },
      { t: RUG + 0.3, p: rug.clone() },
      { t: WALK + 0.4, p: rug.clone().lerp(spot, 0.5) },
      { t: SIT + 0.2, p: spot.clone().add(new THREE.Vector3(0, 0.06, 0)) },
      { t: GONE + 0.2, p: spot.clone().add(new THREE.Vector3(0, 0.05, 0)) },
      { t: END + 0.6, p: hero.look.clone() },
    ]);
  const camPath = tour();
  const lookPath = looks();
  const out = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: data.camera.fov };
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const view = (T: number, T_FLUE: number, T_ARCH: number) => {
    if (T < T_ARCH) {
      // Out under the arch, over the embers, turning to look back at the fire and the present
      const k = smoother(T_FLUE, T_ARCH, T);
      a.copy(flueBottom).add(new THREE.Vector3(0, 0.5, 0.02)).lerp(outOfArch, k);
      a.y = THREE.MathUtils.lerp(flueBottom.y + 0.5, outOfArch.y, Math.min(1, k * 1.4));
      b.copy(a).add(new THREE.Vector3(0, -1, -0.03)).lerp(closeLook, smooth(0.2, 1, k));
      out.pos.copy(a);
      out.look.copy(b);
      out.fov = THREE.MathUtils.lerp(54, 46, k);
    } else {
      const s = T - S0;
      const into = smoother(T_ARCH, T_ARCH + 1.4, T);
      camPath.at(Math.max(0, s), a);
      lookPath.at(Math.max(0, s), b);
      out.pos.copy(outOfArch).lerp(a, into);
      out.look.copy(closeLook).lerp(b, into);
      out.fov = THREE.MathUtils.lerp(46, data.camera.fov * 0.82, smooth(END - 0.5, END + 0.6, s));
    }
    out.pos.applyMatrix4(place);
    out.look.applyMatrix4(place);
    return out;
  };

  // ---- Running ----
  let openAt = -1;
  const update = (T: number, dt: number) => {
    const f = 0.82 + 0.1 * Math.sin(T * 7.3) + 0.06 * Math.sin(T * 13.1 + 1) + 0.05 * Math.sin(T * 2.1);
    // The fire flares as the present lands in it
    const flare = bumped >= 0 ? 0.4 * Math.exp(-(T - bumped) * 2.5) : 0;
    const lvl = 0.85 + flare;
    level.value = lvl;
    for (const sh of flames.children) {
      sh.scale.y = 0.35 + 0.65 * Math.min(1.2, lvl);
      sh.position.y = sh.userData.baseY - (sh.userData.h * (1 - sh.scale.y)) / 2;
    }
    flicker.value = f * (0.35 + 0.65 * lvl);
    twinkle.value = 0.85 + 0.15 * Math.sin(T * 1.7);
    root.updateMatrixWorld(true);
    fireWorld.value.copy(fireAt).add(new THREE.Vector3(0, 0.3, 0)).applyMatrix4(root.matrixWorld);
    cars.forEach((car, k) => {
      const ang = T * 0.45 - k * 0.32;
      car.position.set(centre.x + Math.cos(ang) * data.train.a, centre.y, centre.z - Math.sin(ang) * data.train.b);
      car.rotation.y = Math.atan2(-Math.sin(ang) * data.train.a, -Math.cos(ang) * data.train.b) + Math.PI;
    });
    // The window
    // The window: flung open, swinging out past wide and back on its hinges
    for (const s of sashes) s.pivot.rotation.y = openAt >= 0 ? -s.side * (OPEN + s.swing.step(dt)) : 0;

    // The present: falling down the flue, a flare of sparks in the fire, out onto the hearth
    if (dropAt >= 0) {
      gift.visible = true;
      const u = T - dropAt;
      const faceYaw = Math.atan2(hero.at.x - hearth.x, hero.at.z - hearth.z);
      if (u < FALL) {
        // Down the flue: gathering speed, turning slowly, rocking a little
        const k = u / FALL;
        gift.position.set(flueTop.x, THREE.MathUtils.lerp(dropFrom, logs, Math.pow(k, 1.7)), flueTop.z);
        gift.rotation.set(Math.sin(k * 9) * 0.22 * (1 - k), k * Math.PI * 1.5, Math.sin(k * 7 + 1) * 0.15 * (1 - k));
        gift.scale.set(1, 1 + 0.08 * k, 1);
      } else if (u < FALL + HOP) {
        if (bumped < 0) {
          // On the logs: a bump, a shower of sparks, the fire flares
          bumped = T;
          burst(new THREE.Vector3(flueTop.x, logs, flueTop.z), 46, [spark.clone().multiplyScalar(2.4)], 1.5);
        }
        // And a hop out onto the hearth: a somersault, landing on its feet facing out
        const k = (u - FALL) / HOP;
        const e = k * k * (3 - 2 * k);
        gift.position.set(
          THREE.MathUtils.lerp(flueTop.x, hearth.x, e),
          THREE.MathUtils.lerp(logs, hearth.y, k) + 4 * k * (1 - k) * 0.24,
          THREE.MathUtils.lerp(flueTop.z, hearth.z, e)
        );
        gift.rotation.set(-Math.PI * 2 * e, THREE.MathUtils.lerp(Math.PI * 1.5, faceYaw + Math.PI * 2, e), 0);
        const squash = Math.exp(-k * 10) * 0.25;
        gift.scale.set(1 + squash * 0.5, 1 - squash, 1 + squash * 0.5);
      } else {
        if (landed < 0) {
          landed = T;
          land.x = 0;
          land.v = 0;
          land.kick(-2.4);
        }
        pose(T - S0, dt);
        // The landing squashes it, and it springs back up
        const q = land.step(dt);
        gift.scale.x *= 1 - q * 0.5;
        gift.scale.z *= 1 - q * 0.5;
        gift.scale.y *= 1 + q;
      }
    }

    // Sparks off the fire, embers up the flue
    sparkClock += dt;
    while (sparkClock > 0.05) {
      sparkClock -= 0.05;
      tmp.set(fireAt.x + (Math.random() - 0.5) * 0.4, fireAt.y + 0.15, fireAt.z + (Math.random() - 0.3) * 0.15);
      const v = new THREE.Vector3((Math.random() - 0.5) * 0.1, 0.35 + Math.random() * 0.4, (Math.random() - 0.5) * 0.05);
      sparks.emit(tmp, v, 0.8 + Math.random() * 0.9, 0.008 + Math.random() * 0.008, spark, 0);
    }
    if (dropAt >= 0 && T - dropAt < 3) {
      for (let k = 0; k < 3; k++) {
        tmp.set(flueBottom.x + (Math.random() - 0.5) * 0.4, flueBottom.y + Math.random() * 0.6, flueBottom.z + (Math.random() - 0.5) * 0.18);
        const v = new THREE.Vector3((Math.random() - 0.5) * 0.08, 1.6 + Math.random() * 1.4, (Math.random() - 0.5) * 0.05);
        sparks.emit(tmp, v, 2.6, 0.01 + Math.random() * 0.01, spark.clone().multiplyScalar(2), 0.6);
      }
    }
    sparks.update(T, dt, glow, 0, identity);
    let i = 300;
    for (const mo of motes) {
      tmp.copy(mo.at).add(new THREE.Vector3(Math.sin(T * 0.21 + mo.seed) * 0.15, Math.sin(T * 0.17 + mo.seed * 2) * 0.12, Math.cos(T * 0.19 + mo.seed) * 0.15));
      const bright = 0.25 + 0.25 * Math.sin(T * 1.3 + mo.seed * 5);
      tc.setRGB(1.0 * bright, 0.72 * bright, 0.38 * bright);
      glow.set(i++, tmp, 0.012, tc, 0, 0);
    }
    tc.copy(lin('#FFE7A0')).multiplyScalar(1.6 + 0.4 * Math.sin(T * 2.2));
    glow.set(i++, topper, 0.32, tc, 1, T * 0.2);
    // The glow at the bottom of the flue, seen from above coming down
    if (dropAt >= 0 && T - dropAt < 3.2) {
      const k = Math.min(1, (T - dropAt) / 2.4);
      tc.copy(spark).multiplyScalar(0.9 + k * 1.4);
      glow.set(i++, tmp.copy(flueBottom).add(new THREE.Vector3(0, -0.3, 0)), 0.25 + k * 0.15, tc, 0, 0);
    }
    for (; i < glow.capacity; i++) glow.hide(i);
    glow.flush();
    steam.update(T, dt, wisps, 0, identity, true);
    wisps.flush();
  };

  const wIn = new THREE.Vector3(windowAt.x, windowAt.y - 0.02, windowAt.z + 0.55);
  const wOut = new THREE.Vector3(windowAt.x, windowAt.y + 0.04, windowAt.z - 0.75);
  return {
    root,
    toTown,
    update,
    story,
    view,
    camera: { at: toTown(hero.at), look: toTown(hero.look), fov: data.camera.fov * 0.82 },
    flue: { top: toTown(flueTop), bottom: toTown(flueBottom) },
    arch: toTown(outOfArch),
    windowIn: toTown(wIn),
    windowOut: toTown(wOut),
    windowAt: toTown(windowAt),
    /** The present comes in at the top of the chimney, at this velocity (town metres) */
    drop(T: number, v: THREE.Vector3) {
      dropAt = T;
      landed = -1;
      bumped = -1;
      void v;
      gift.visible = true;
      gift.scale.setScalar(1);
      face.scale.setScalar(0.001);
      for (const l of legs) l.scale.setScalar(0.001);
      for (const ar of arms) ar.scale.setScalar(0.001);
    },
    /** Fling the window open (once) */
    openWindow(T: number) {
      if (openAt >= 0) return;
      openAt = T;
      for (const s of sashes) {
        s.swing.x = -OPEN;
        s.swing.v = 0;
      }
    },
    reset() {
      dropAt = -1;
      landed = -1;
      openAt = -1;
      gift.visible = false;
      S0 = 1e9;
      for (const s of sashes) {
        s.swing.x = 0;
        s.swing.v = 0;
      }
    },
    fire: toTown(fireAt),
    /** The flue's lining: only wanted while you're in the chimney */
    shaft,
    /** Dev: where the present is and what it's doing */
    state: () => ({ dropAt, landed, bumped, at: gift.position.toArray(), visible: gift.visible, shown: root.visible, S0 }),
  };
}
