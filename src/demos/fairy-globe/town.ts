import * as TSL from 'three/tsl';
import * as THREE from 'three/webgpu';

import { bakedMesh, bulbsMesh, display, lin, starsMesh, type BakedPart, type V } from './baked';
import { dust, sprites } from './fx';
import type { Team } from './sleigh';

/**
 * Rothenburg on Christmas Eve (scripts/blender/xmas_town.py), built life-size and set under the
 * glass of the snow globe: the walled town, its square and market, the red house the room is in.
 * Baked in four parts, the detail going where you see it close (the red house; round the square;
 * the rest of the town; the wall and the fields), the fields cut round to fit the glass.
 *
 * And everything that moves in it: snow falling round you, the chimneys smoking, the lanterns and
 * the star glowing, powder kicked up and snow sliding off the roof when the sleigh comes down.
 *
 * All in the town's metres, y up; `root` carries it into the globe.
 */

const { vec3 } = TSL;

type TownData = {
  hero: BakedPart;
  core: BakedPart;
  town: BakedPart;
  outer: BakedPart;
  deco: BakedPart;
  bulbs: { at: V; c: string }[];
  /** Paper stars in windows: where, which way they face, how big, their colour */
  stars: { at: V; n: V; r: number; c: string }[];
  star: V;
  chimney: V;
  chimneys: V[];
  lanterns: V[];
  ridge: V;
  marks: Record<string, V>;
  square: V;
  window: V;
};

export type TownStage = NonNullable<Awaited<ReturnType<typeof buildTown>>>;

type Powder = {
  at: THREE.Vector3;
  v: THREE.Vector3;
  born: number;
  life: number;
  size: number;
  grow: number;
  c: THREE.Color;
  g: number;
};

/** `disc`: the circle of ground that fits under the glass (its middle and radius, in metres) */
export async function buildTown(disc: { x: number; z: number; r: number }) {
  const data = require('../../../assets/fairy-globe/town/town.json') as TownData;
  // Bright and warm, the way a Christmas film lights a town at night
  const exposure = TSL.uniform(1.1);
  // Moonlight under everything, so nothing in shadow goes black
  const ambient = TSL.uniform(0.16);
  const twinkle = TSL.uniform(1);
  const gains = { base: TSL.uniform(1), tree: twinkle };
  // Out in the fields there's no lamplight: lift it a little so the woods read
  const fields = TSL.uniform(2.0);
  const part = (name: keyof typeof ASSETS, round = false) =>
    bakedMesh(
      data[name],
      {
        albedo: ASSETS[name].albedo,
        emit: ASSETS[name].emit,
        layers: { base: ASSETS[name].base, tree: ASSETS[name].tree },
      },
      gains,
      name === 'outer' ? fields : exposure,
      3.2,
      { screen: true, ambient, disc: round ? disc : undefined }
    );
  const [hero, core, town, outer, deco] = await Promise.all([
    part('hero'),
    part('core'),
    part('town'),
    part('outer', true),
    // The garlands, wreaths, stars and strings of lights, in maps of their own
    part('deco'),
  ]);
  if (!hero || !core || !town || !outer || !deco) return null;

  const vec = (v: V) => new THREE.Vector3(...v);
  const root = new THREE.Group();
  root.add(
    hero,
    core,
    town,
    outer,
    deco,
    bulbsMesh(data.bulbs, 0.08, 1.7, { screen: true }),
    starsMesh(data.stars, { screen: true })
  );

  // ---- The present, while it's in the air on its way to the chimney ----
  const present = new THREE.Group();
  const paper = new THREE.MeshBasicNodeMaterial();
  const ribbon = new THREE.MeshBasicNodeMaterial();
  paper.colorNode = display(vec3(0.6, 0.04, 0.07).mul(1.25));
  ribbon.colorNode = display(vec3(0.9, 0.6, 0.12).mul(1.15));
  present.add(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.16, 0.2), paper));
  present.add(new THREE.Mesh(new THREE.BoxGeometry(0.205, 0.165, 0.045), ribbon));
  present.add(new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.165, 0.205), ribbon));
  present.visible = false;
  root.add(present);

  // ---- Glow and stuff in the air ----
  const glow = sprites(1500, true);
  const powder = sprites(1400, true, true);
  root.add(glow.mesh, powder.mesh);
  const trail = dust(720);
  const smoke = dust(220);
  const lanterns = data.lanterns.map(vec);
  const chimney0 = vec(data.chimney);
  // Every chimney smokes but the one he's going down
  const chimneys = data.chimneys.map(vec).filter((c) => c.distanceTo(chimney0) > 1.5);
  const star = vec(data.star);
  const chimney = vec(data.chimney);
  const ridge = vec(data.ridge);
  const tree = vec(data.marks.tree);
  const square = vec(data.square);
  const marks = Object.fromEntries(Object.entries(data.marks).map(([k, v]) => [k, vec(v)]));
  const identity = new THREE.Matrix4();
  const tc = new THREE.Color();
  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();
  const gold = lin('#FFD873').multiplyScalar(2.4);
  const rose = lin('#FF8FB8').multiplyScalar(2);
  const ice = lin('#9FE8FF').multiplyScalar(2);
  const smokeTint = lin('#9FA9C8').multiplyScalar(0.12);
  const snowWhite = new THREE.Color(0.86, 0.9, 1.0).multiplyScalar(0.95);
  let smokeClock = 0;

  // Snow and soot that falls: a few hundred bits, each under gravity with a little air drag
  const bits: (Powder | null)[] = Array.from({ length: 900 }, () => null);
  let nextBit = 0;
  const shed = (
    at: THREE.Vector3,
    v: THREE.Vector3,
    life: number,
    size: number,
    grow: number,
    c: THREE.Color,
    g = 9.81
  ) => {
    bits[nextBit] = { at: at.clone(), v: v.clone(), born: -1, life, size, grow, c, g };
    nextBit = (nextBit + 1) % bits.length;
  };
  // Falling snow, all round wherever you are: a box of it that moves with you
  const FLAKES = 500;
  const BOX = 36;
  const flakes = Array.from({ length: FLAKES }, () => ({
    at: new THREE.Vector3((Math.random() - 0.5) * BOX, Math.random() * BOX, (Math.random() - 0.5) * BOX),
    speed: 0.7 + Math.random() * 0.9,
    size: 0.035 + Math.random() * 0.05,
    seed: Math.random() * 10,
  }));

  /** Inside the red house: no snow falls in there */
  const indoors = (p: THREE.Vector3) => Math.abs(p.x) < 3.7 && Math.abs(p.z) < 2.9 && p.y < 7;

  let baseFov = 44;
  const update = (dt: number, t: number, cam: THREE.Vector3, team: Team | null, flying: number) => {
    twinkle.value = 0.85 + 0.15 * Math.sin(t * 1.7);
    root.updateMatrixWorld(true);
    // Stardust off the runners while he flies
    if (team && flying > 0) {
      const k = team.sleigh.scale.x / 0.9;
      for (const r of team.runners) {
        r.getWorldPosition(tmp);
        root.worldToLocal(tmp);
        for (let j = 0; j < 3; j++) {
          if (Math.random() > flying) continue;
          const c = [gold, gold, rose, ice][Math.floor(Math.random() * 4)];
          tmp2
            .set((Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.3)
            .multiplyScalar(k);
          trail.emit(
            tmp,
            tmp2,
            1.6 + Math.random(),
            (0.06 + Math.random() * 0.08) * k,
            c,
            Math.random() < 0.3 ? 0.9 : 0
          );
        }
      }
      // And a little off every deer's hooves, finer and shorter-lived
      for (const h of team.hooves) {
        if (Math.random() > flying * 0.4) continue;
        h.getWorldPosition(tmp);
        root.worldToLocal(tmp);
        tmp2
          .set((Math.random() - 0.5) * 0.2, -0.1 - Math.random() * 0.2, (Math.random() - 0.5) * 0.2)
          .multiplyScalar(k);
        trail.emit(
          tmp,
          tmp2,
          0.7 + Math.random() * 0.5,
          (0.03 + Math.random() * 0.04) * k,
          Math.random() < 0.7 ? gold : ice,
          0.9
        );
      }
    }
    smokeClock += dt;
    while (smokeClock > 0.06) {
      smokeClock -= 0.06;
      const c = chimneys[Math.floor(Math.random() * chimneys.length)];
      if (c.distanceTo(cam) > 160) continue;
      tmp2.set(0.25 + Math.random() * 0.2, 0.7 + Math.random() * 0.4, (Math.random() - 0.5) * 0.2);
      smoke.emit(c, tmp2, 4 + Math.random() * 2, 0.5 + Math.random() * 0.4, smokeTint, 0);
    }
    trail.update(t, dt, glow, 0, identity);
    smoke.update(t, dt, glow, 360, identity);
    let i = 580;
    for (const l of lanterns) {
      tc.copy(lin('#FFC77A')).multiplyScalar(1.2 + 0.08 * Math.sin(t * 3 + l.x));
      glow.set(i++, l, 0.9, tc, 0, 0);
    }
    tc.copy(lin('#FFE7A0')).multiplyScalar(1.8 + 0.3 * Math.sin(t * 2.2));
    glow.set(i++, star, 2.4, tc, 1, t * 0.2);
    if (team && team.group.visible) {
      const k = team.sleigh.scale.x / 0.9;
      team.nose.getWorldPosition(tmp);
      root.worldToLocal(tmp);
      tc.copy(lin('#FF3B3B')).multiplyScalar(1.8 + 0.4 * Math.sin(t * 4));
      glow.set(i++, tmp, 0.32 * k, tc, 0, 0);
      for (const lamp of team.lamps) {
        lamp.getWorldPosition(tmp);
        root.worldToLocal(tmp);
        tc.copy(lin('#FFC873')).multiplyScalar(1.5 + 0.1 * Math.sin(t * 9 + tmp.x));
        glow.set(i++, tmp, 0.36 * k, tc, 0, 0);
      }
    }
    for (; i < glow.capacity; i++) glow.hide(i);
    glow.flush();

    // Powder, soot, snow falling off the roof
    let j = 0;
    for (let b = 0; b < bits.length; b++) {
      const p = bits[b];
      if (!p) {
        powder.hide(j++);
        continue;
      }
      if (p.born < 0) p.born = t;
      const age = (t - p.born) / p.life;
      if (age >= 1) {
        bits[b] = null;
        powder.hide(j++);
        continue;
      }
      p.v.y -= p.g * dt;
      p.v.multiplyScalar(Math.exp(-dt * (p.g > 3 ? 0.6 : 2.2)));
      p.at.addScaledVector(p.v, dt);
      const fade = Math.min(1, age * 10) * (1 - age * age);
      powder.set(j++, p.at, p.size * (1 + p.grow * age), p.c, fade * 0.9, 0);
    }
    // Snow falling: round the camera, thinning out as you go up and away
    const low = 1 - THREE.MathUtils.smoothstep(cam.y, 80, 220);
    const near = 1 - THREE.MathUtils.smoothstep(Math.hypot(cam.x, cam.z), 160, 320);
    const amount = low * near;
    for (const f of flakes) {
      f.at.y -= f.speed * dt;
      f.at.x += Math.sin(t * 0.6 + f.seed) * 0.35 * dt;
      f.at.z += Math.cos(t * 0.5 + f.seed * 1.3) * 0.25 * dt;
      // Wrap round the camera
      tmp.copy(f.at).sub(cam);
      tmp.x = THREE.MathUtils.euclideanModulo(tmp.x + BOX / 2, BOX) - BOX / 2;
      tmp.y = THREE.MathUtils.euclideanModulo(tmp.y + BOX / 2, BOX) - BOX / 2;
      tmp.z = THREE.MathUtils.euclideanModulo(tmp.z + BOX / 2, BOX) - BOX / 2;
      f.at.copy(tmp).add(cam);
      if (amount <= 0 || indoors(f.at) || j >= powder.capacity) {
        if (j < powder.capacity) powder.hide(j++);
        continue;
      }
      // Flakes right in front of the lens would be blots: they fade as they come that close
      const close = THREE.MathUtils.smoothstep(tmp.length(), 0.6, 1.8);
      powder.set(j++, f.at, f.size, snowWhite, 0.85 * amount * close, 0);
    }
    for (; j < powder.capacity; j++) powder.hide(j);
    powder.flush();
  };

  return {
    root,
    /** The baked parts, for what needs their shapes (where snow can lie) */
    parts: [hero, core, town, outer] as THREE.Mesh[],
    /** The red house's own walls and roof: gone while you're in the room inside it */
    hero,
    update,
    chimney,
    ridge,
    tree,
    square,
    marks,
    window: vec(data.window),
    get fov() {
      return baseFov;
    },
    /** The lens for this screen: the shots open it up or close it down from here */
    setFov(f: number) {
      baseFov = f;
    },
    /** How bright the town is lit (down a little with the camera down among the snow), and how much
     *  moonlight lies under it */
    tune(e?: number, a?: number) {
      if (e !== undefined) exposure.value = e;
      if (a !== undefined) ambient.value = a;
      return { exposure: exposure.value, ambient: ambient.value };
    },
    /** Snow everywhere as the sleigh comes down on the roof: powder up, snow sliding off the eaves */
    landed(at: THREE.Vector3, team: Team) {
      for (const r of team.runners) {
        r.getWorldPosition(tmp);
        root.worldToLocal(tmp);
        for (let k = 0; k < 40; k++) {
          const a = Math.random() * Math.PI * 2;
          const sp = 0.6 + Math.random() * 1.8;
          shed(
            tmp,
            tmp2.set(Math.cos(a) * sp, 0.8 + Math.random() * 2.2, Math.sin(a) * sp),
            0.9 + Math.random() * 0.9,
            0.05 + Math.random() * 0.06,
            1.5,
            snowWhite,
            2.5
          );
        }
      }
      // The jolt shakes the snow loose along both eaves: it slides, tips over the edge, and falls
      // in clumps that burst into powder on the way down
      for (const sgn of [-1, 1]) {
        for (let k = 0; k < 70; k++) {
          const x = at.x - 4 + Math.random() * 8;
          tmp.set(x, ridge.y - 3.4 - Math.random() * 0.4, sgn * (3.15 + Math.random() * 0.2));
          tmp2.set((Math.random() - 0.5) * 0.4, -0.2 - Math.random() * 0.6, sgn * (0.6 + Math.random() * 1.2));
          const big = Math.random() < 0.35;
          shed(
            tmp,
            tmp2,
            1.4 + Math.random() * 0.8,
            big ? 0.22 + Math.random() * 0.15 : 0.08,
            big ? 0.6 : 3.5,
            snowWhite,
            big ? 9.81 : 3
          );
        }
      }
      // A cloud of it off the ridge
      for (let k = 0; k < 60; k++) {
        tmp.set(at.x - 2 + Math.random() * 4, ridge.y + 0.2, (Math.random() - 0.5) * 1.2);
        tmp2.set((Math.random() - 0.5) * 2.4, 0.4 + Math.random() * 1.2, (Math.random() - 0.5) * 2.4);
        shed(tmp, tmp2, 1.5 + Math.random(), 0.1 + Math.random() * 0.1, 2.0, snowWhite, 0.6);
      }
    },
    /** Kicked up off the runners as it slides */
    spray(at: THREE.Vector3, n: number, speed: number) {
      for (let k = 0; k < n; k++) {
        const a = Math.random() * Math.PI * 2;
        tmp2.set(
          Math.cos(a) * speed * Math.random(),
          speed * (0.5 + Math.random()),
          Math.sin(a) * speed * Math.random()
        );
        shed(at, tmp2, 0.8 + Math.random() * 0.6, 0.08 + Math.random() * 0.08, 2, snowWhite, 3);
      }
    },
    /** The present on its way, or not (null) */
    present(p: THREE.Vector3 | null, q: THREE.Quaternion | null) {
      present.visible = !!p;
      if (p && q) {
        present.position.copy(p);
        present.quaternion.copy(q);
      }
    },
    /** In: a twinkle out of the chimney pot (no soot: the camera goes down through here) */
    puff() {
      // Out to the sides, and short: the camera follows the present straight down through here
      for (let k = 0; k < 14; k++) {
        const a = Math.random() * Math.PI * 2;
        tmp2.set(Math.cos(a) * 1.4, 0.5 + Math.random() * 0.5, Math.sin(a) * 1.4);
        trail.emit(chimney, tmp2, 0.55, 0.025, k % 2 ? gold : ice, 0.9);
      }
    },
    /** Snow blowing in through an open window */
    gust(at: THREE.Vector3, dir: THREE.Vector3) {
      for (let k = 0; k < 6; k++) {
        tmp.copy(at).add(tmp2.set((Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 1.1, 0));
        tmp2
          .copy(dir)
          .multiplyScalar(1.2 + Math.random() * 1.5)
          .add(new THREE.Vector3((Math.random() - 0.5) * 0.6, (Math.random() - 0.3) * 0.5, 0));
        shed(tmp, tmp2, 1.2 + Math.random(), 0.02 + Math.random() * 0.03, 0.5, snowWhite, 0.4);
      }
    },
    sparkle(at: THREE.Vector3, n: number) {
      for (let k = 0; k < n; k++) {
        tmp2.set(Math.random() - 0.5, Math.random() * 1.2, Math.random() - 0.5);
        trail.emit(at, tmp2, 0.8 + Math.random() * 0.8, 0.04 + Math.random() * 0.04, [gold, rose, ice][k % 3], 0.9);
      }
    },
  };
}

const ASSETS = {
  hero: {
    albedo: require('../../../assets/fairy-globe/town/hero_albedo.jpg'),
    emit: require('../../../assets/fairy-globe/town/hero_emit.png'),
    base: require('../../../assets/fairy-globe/town/hero_base.png'),
    tree: require('../../../assets/fairy-globe/town/hero_tree.png'),
  },
  core: {
    albedo: require('../../../assets/fairy-globe/town/core_albedo.jpg'),
    emit: require('../../../assets/fairy-globe/town/core_emit.png'),
    base: require('../../../assets/fairy-globe/town/core_base.png'),
    tree: require('../../../assets/fairy-globe/town/core_tree.png'),
  },
  town: {
    albedo: require('../../../assets/fairy-globe/town/town_albedo.jpg'),
    emit: require('../../../assets/fairy-globe/town/town_emit.png'),
    base: require('../../../assets/fairy-globe/town/town_base.png'),
    tree: require('../../../assets/fairy-globe/town/town_tree.png'),
  },
  outer: {
    albedo: require('../../../assets/fairy-globe/town/outer_albedo.jpg'),
    emit: require('../../../assets/fairy-globe/town/outer_emit.png'),
    base: require('../../../assets/fairy-globe/town/outer_base.png'),
    tree: require('../../../assets/fairy-globe/town/outer_tree.png'),
  },
  deco: {
    albedo: require('../../../assets/fairy-globe/town/deco_albedo.jpg'),
    emit: require('../../../assets/fairy-globe/town/deco_emit.png'),
    base: require('../../../assets/fairy-globe/town/deco_base.png'),
    tree: require('../../../assets/fairy-globe/town/deco_tree.png'),
  },
};
