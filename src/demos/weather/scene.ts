import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';

import { paletteOf, type Env } from './data';
import { DigitRow, glyphHeight } from './digits';
import { matcap, repaint, SKINS, SKY_MATCAPS, type MatcapSpec, type SkinId } from './matcaps';
import { titleTexture } from './titles';

/**
 * The weather screen's 3D, after (Not Boring) Weather's layout. A main view (the sky over tall
 * puffy numerals) and, behind it, a ring of six forecast pages (temperature, rain, sun, clouds,
 * air, moon). On the ring a swipe whips the next page in from the edge at full size; the pages
 * on the far side show through the haze from behind, titles mirrored. Going between the main
 * view and the ring, the camera pulls back until the whole little world is in view, then dives
 * in, with a burst of streaks on landing. Everything is lit by matcaps (see matcaps.ts), so the
 * look holds on react-native-webgpu without lights or post-processing.
 */

export const PAGES = ['temp', 'rain', 'sun', 'clouds', 'air', 'moon'] as const;
export type PageId = (typeof PAGES)[number];
export const PAGE_COUNT = PAGES.length;

/** Which ring page sits in front for a pager position (the ring wraps) */
export const pageAt = (p: number) => {
  'worklet';
  return (((Math.round(p) % PAGE_COUNT) + PAGE_COUNT) % PAGE_COUNT) as number;
};

export type SceneInput = {
  /** The sky on the main view, and the clouds page's cloud */
  sky: Env;
  cloudSky: Env;
  /** 0..1 rain on the island */
  rain: number;
  digits: { main: string; temp: string };
  windKmh: number;
  /** Degrees the wind blows from */
  windDir: number;
  /** 0 at sunrise .. 1 at sunset, or across the night when !isDay */
  sunFrac: number;
  isDay: boolean;
  /** 0 new → 0.5 full → 1 new */
  moonPhase: number;
  /** CSS colour for the titles and the landing streaks */
  ink: string;
};

/** Where things sit, in points from the top of the screen */
export type Placement = {
  heroY: number;
  heroSize: number;
  digitsY: number;
  digitsWidth: number;
  digitsHeight: number;
  /** Centre of the page title (ring pages) */
  titleY: number;
};
export type SceneLayout = { main: Placement; detail: Placement };

export type WeatherControls = {
  /** Ring position, in pages (wraps) */
  page: { get(): number };
  /** 0 = main view, 1 = the ring; animated between */
  view: { get(): number };
  /** Main view spin from a drag, radians */
  spin: { get(): number };
};

const FOV = 30;
const CAMERA_Z = 20;
/** Hero objects are modelled about this wide */
const HERO_UNITS = 2.85;

const damp = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);
const smooth = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const rand = (() => {
  let seed = 7;
  return () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
})();

const SPHERE = new THREE.SphereGeometry(1, 32, 22);
// Thin, quick streaks: real drops read as lines at this speed, not as beads
const DROP = new THREE.CapsuleGeometry(0.022, 0.3, 3, 6);
const RAY = new THREE.CapsuleGeometry(0.05, 0.22, 4, 8);
const STAR = new THREE.OctahedronGeometry(0.07, 0);

function matcapMaterial(spec: MatcapSpec, params: THREE.MeshMatcapNodeMaterialParameters = {}) {
  return new THREE.MeshMatcapNodeMaterial({ matcap: matcap(spec), ...params });
}

/** Direction the sunlight reaches the moon from, in view space: sets the phase */
const moonLightU = TSL.uniform(new THREE.Vector3(1, 0, 0));

/** The moon lit by the sun at its real phase: a crescent, a half, or a full disc */
function moonPhaseMaterial() {
  const material = new THREE.MeshBasicNodeMaterial();
  const n = TSL.normalView;
  const lit = TSL.smoothstep(-0.05, 0.05, TSL.dot(n, moonLightU));
  const shade = n.z.mul(0.35).add(0.65);
  const rim = TSL.pow(TSL.float(1).sub(n.z), 3).mul(0.22);
  material.colorNode = TSL.mix(TSL.vec3(0.1, 0.1, 0.12), TSL.vec3(0.96, 0.95, 0.91), lit)
    .mul(shade)
    .add(rim);
  return material;
}

const mtx = new THREE.Matrix4();
const quat = new THREE.Quaternion();
const vec = new THREE.Vector3();
const scl = new THREE.Vector3();
const euler = new THREE.Euler();

function setInstance(mesh: THREE.InstancedMesh, i: number, x: number, y: number, z: number, s: number, rotZ = 0) {
  euler.set(0, 0, rotZ);
  quat.setFromEuler(euler);
  mtx.compose(vec.set(x, y, z), quat, scl.setScalar(Math.max(0.0001, s)));
  mesh.setMatrixAt(i, mtx);
}

/** A damped spring around 0: kick `v`, read `x` */
type Spring = { x: number; v: number };
const spring = (): Spring => ({ x: 0, v: 0 });
function stepSpring(sp: Spring, dt: number, stiffness = 220, damping = 11) {
  sp.v += (-sp.x * stiffness - sp.v * damping) * dt;
  sp.x += sp.v * dt;
}

/** Raycast an instanced mesh whose instances move: its bounding sphere must be fresh */
function hitInstances(ray: THREE.Raycaster, mesh: THREE.InstancedMesh) {
  if (!mesh.visible) return null;
  mesh.boundingSphere = null;
  return ray.intersectObject(mesh, false)[0] ?? null;
}

export type TapResult = 'digit' | 'cloud' | 'storm' | 'sun' | 'moon' | 'gadget' | 'bubble' | null;

// ---- The sky: sun or moon, clouds, rain, snow, lightning, fog, haze, wind ----

/** Cumulus puffs [x, y, z, radius], in the order they appear as the sky clouds over */
const PUFFS: [number, number, number, number][] = [
  [0.05, 0.12, 0, 0.72],
  [-0.6, -0.12, 0.12, 0.55],
  [0.65, -0.16, 0.1, 0.52],
  [-0.15, -0.36, 0.25, 0.5],
  [0.35, 0.52, -0.1, 0.5],
  [-0.55, 0.36, -0.1, 0.45],
  [1.15, -0.3, 0, 0.4],
  [-1.12, -0.3, 0, 0.42],
  [0.55, -0.42, 0.3, 0.4],
  [-0.75, -0.42, 0.3, 0.38],
  [0.95, 0.15, -0.15, 0.42],
  [-1.0, 0.1, -0.15, 0.4],
  [1.5, -0.42, -0.1, 0.3],
  [-1.5, -0.4, -0.1, 0.3],
];

const DROPS = 90;
const FLAKES = 80;
const DUST = 50;
const STARS = 26;
const RAYS = 10;

const ZERO_ENV: Env = {
  sun: 0,
  night: 0,
  cloud: 0,
  dark: 0,
  rain: 0,
  snow: 0,
  storm: 0,
  fog: 0,
  haze: 0,
  wind: 0,
  heat: 0,
};

class Sky {
  readonly group = new THREE.Group();
  readonly env: Env = { ...ZERO_ENV, sun: 1 };
  target: Env = { ...ZERO_ENV, sun: 1 };
  /** 0..1 lightning flash, for the backdrop */
  flash = 0;
  /** Show the sun or the moon (the clouds page shows the cloud alone) */
  celestial = true;

  private sun: THREE.Mesh;
  private rays: THREE.InstancedMesh;
  private moon: THREE.Group;
  private stars: THREE.InstancedMesh;
  private clouds: THREE.InstancedMesh;
  private cloudMat: THREE.MeshMatcapNodeMaterial;
  private drops: THREE.InstancedMesh;
  private flakes: THREE.InstancedMesh;
  private dust: THREE.InstancedMesh;
  private bolt: THREE.Mesh;
  private boltMat: THREE.MeshBasicNodeMaterial;
  private fog: { mesh: THREE.Mesh; mat: THREE.MeshMatcapNodeMaterial; y: number }[] = [];
  private streaks: { mesh: THREE.Mesh; mat: THREE.MeshBasicNodeMaterial; y: number; speed: number; off: number }[] = [];
  private seeds = {
    drops: Array.from({ length: DROPS }, () => [rand() * 2.8 - 1.4, rand(), rand() * 0.8 - 0.2, 0.8 + rand() * 0.4]),
    flakes: Array.from({ length: FLAKES }, () => [rand() * 3 - 1.5, rand(), rand() * 0.8 - 0.2, 0.6 + rand() * 0.8]),
    dust: Array.from({ length: DUST }, () => [rand() * 3.6 - 1.8, rand() * 3.4 - 2.2, rand() - 0.5, rand()]),
    stars: Array.from({ length: STARS }, () => [rand() * 3.8 - 1.9, rand() * 1.6 - 0.1, -1.4, rand()]),
  };
  private strike = { next: 2, phase: -1, t: 0 };
  // Touch: puffs jiggle, the cloud bobs, a tap wrings out a shower; the sun spins up its rays
  private puffs = PUFFS.map(() => spring());
  private bob = spring();
  private burst = 0;
  private sunPop = spring();
  private raySpin = 0;
  private raySpinV = 0;
  private wobble = spring();

  constructor(materials: { sun: THREE.Material; moon: THREE.Material; drop: THREE.Material }) {
    this.sun = new THREE.Mesh(SPHERE, materials.sun);
    this.sun.position.set(0.62, 0.5, -0.9);
    this.rays = new THREE.InstancedMesh(RAY, materials.sun, RAYS);
    this.rays.position.copy(this.sun.position);
    this.group.add(this.sun, this.rays);

    this.moon = new THREE.Group();
    const moonBall = new THREE.Mesh(SPHERE, materials.moon);
    moonBall.scale.setScalar(0.82);
    this.moon.add(moonBall);
    this.moon.position.set(0.5, 0.5, -0.9);
    this.group.add(this.moon);

    const starMat = new THREE.MeshBasicNodeMaterial({ color: '#FFF6D6' });
    this.stars = new THREE.InstancedMesh(STAR, starMat, STARS);
    this.group.add(this.stars);

    this.cloudMat = matcapMaterial(SKY_MATCAPS.cloud);
    this.clouds = new THREE.InstancedMesh(SPHERE, this.cloudMat, PUFFS.length);
    this.group.add(this.clouds);

    this.drops = new THREE.InstancedMesh(DROP, materials.drop, DROPS);
    this.flakes = new THREE.InstancedMesh(SPHERE, matcapMaterial(SKY_MATCAPS.snow), FLAKES);
    this.dust = new THREE.InstancedMesh(SPHERE, matcapMaterial(SKY_MATCAPS.dust), DUST);
    this.group.add(this.drops, this.flakes, this.dust);

    // A zigzag bolt with hard corners
    const path = new THREE.CurvePath<THREE.Vector3>();
    const zig = [
      [0.1, -0.45],
      [-0.16, -0.95],
      [0.12, -1.02],
      [-0.12, -1.52],
      [0.06, -1.56],
      [-0.2, -2.05],
    ];
    for (let i = 1; i < zig.length; i++) {
      path.add(
        new THREE.LineCurve3(
          new THREE.Vector3(zig[i - 1][0], zig[i - 1][1], 0),
          new THREE.Vector3(zig[i][0], zig[i][1], 0)
        )
      );
    }
    this.boltMat = new THREE.MeshBasicNodeMaterial({ color: '#FFE45C', transparent: true });
    this.bolt = new THREE.Mesh(new THREE.TubeGeometry(path, 60, 0.045, 8, false), this.boltMat);
    this.bolt.position.z = 0.35;
    this.bolt.visible = false;
    this.group.add(this.bolt);

    const bar = new THREE.CapsuleGeometry(0.17, 2.6, 6, 16).rotateZ(Math.PI / 2);
    for (const y of [-0.15, -0.58, -0.95]) {
      const mat = matcapMaterial(SKY_MATCAPS.cloud, { transparent: true, depthWrite: false });
      const mesh = new THREE.Mesh(bar, mat);
      mesh.position.set(0, y, 0.75);
      this.fog.push({ mesh, mat, y });
      this.group.add(mesh);
    }

    const swoosh = new THREE.CatmullRomCurve3(
      [
        [-1.2, 0],
        [-0.4, 0.08],
        [0.4, -0.04],
        [0.9, 0.05],
        [1.1, 0.2],
        [0.98, 0.34],
        [0.84, 0.25],
      ].map(([x, y]) => new THREE.Vector3(x, y, 0))
    );
    const swooshGeo = new THREE.TubeGeometry(swoosh, 80, 0.022, 6, false);
    [
      [-0.95, 1.0, 0.3],
      [0.25, 0.8, 2.6],
      [-0.25, 1.25, 1.2],
      [0.85, 0.7, 3.7],
    ].forEach(([y, speed, off]) => {
      const mat = new THREE.MeshBasicNodeMaterial({ color: '#FFFFFF', transparent: true, depthWrite: false });
      const mesh = new THREE.Mesh(swooshGeo, mat);
      mesh.position.set(0, y, 0.9);
      this.streaks.push({ mesh, mat, y, speed, off });
      this.group.add(mesh);
    });
  }

  /** Respond to a tap along `ray`; what was hit, or null */
  poke(ray: THREE.Raycaster): TapResult {
    const cloud = this.clouds.visible ? hitInstances(ray, this.clouds) : null;
    const sun = this.sun.visible ? (ray.intersectObject(this.sun, false)[0] ?? null) : null;
    const moon = this.moon.visible ? (ray.intersectObject(this.moon, true)[0] ?? null) : null;
    const nearest = [cloud, sun, moon].filter(Boolean).sort((a, b) => a!.distance - b!.distance)[0];
    if (!nearest) return null;
    if (nearest === cloud && cloud?.instanceId !== undefined) {
      const [hx, hy] = PUFFS[cloud.instanceId];
      PUFFS.forEach(([x, y], i) => {
        this.puffs[i].v += 10 * Math.exp(-Math.hypot(x - hx, y - hy) * 1.3);
      });
      this.bob.v -= 4.5;
      this.burst = 1.8;
      if (this.env.storm > 0.3 || this.env.dark > 0.6) {
        this.strikeNow();
        return 'storm';
      }
      return 'cloud';
    }
    if (nearest === sun) {
      this.raySpinV += 10;
      this.sunPop.v += 4.5;
      return 'sun';
    }
    this.wobble.v += 7;
    return 'moon';
  }

  private strikeNow() {
    const s = this.strike;
    s.phase = 0;
    s.t = 0;
    this.bolt.position.x = rand() * 1.0 - 0.5;
    this.bolt.scale.x = rand() < 0.5 ? -1 : 1;
  }

  update(dt: number, t: number) {
    const e = this.env;
    const k = damp(3, dt);
    for (const p of this.puffs) stepSpring(p, dt, 260, 9);
    stepSpring(this.bob, dt, 120, 7);
    stepSpring(this.sunPop, dt, 200, 9);
    stepSpring(this.wobble, dt, 90, 4);
    this.raySpinV *= Math.exp(-dt * 1.4);
    this.raySpin += this.raySpinV * dt;
    this.burst = Math.max(0, this.burst - dt);
    for (const key of Object.keys(e) as (keyof Env)[]) e[key] += (this.target[key] - e[key]) * k;

    // Sun: shrinks behind thick cloud, swells in a heatwave
    const sky = this.celestial ? 1 : 0;
    const sunScale = sky * e.sun * (0.82 + e.heat * 0.22) * (1 - e.night) * (1 + this.sunPop.x * 0.25);
    this.sun.scale.setScalar(Math.max(0.0001, sunScale));
    this.sun.visible = sunScale > 0.01;
    this.rays.visible = this.sun.visible;
    if (this.rays.visible) {
      const spin = t * 0.25 + this.raySpin;
      const reach = 1.12 + Math.sin(t * 2.2) * 0.04 * (1 + e.heat * 2);
      for (let i = 0; i < RAYS; i++) {
        const a = spin + (i / RAYS) * Math.PI * 2;
        setInstance(
          this.rays,
          i,
          Math.cos(a) * reach * sunScale,
          Math.sin(a) * reach * sunScale,
          0,
          sunScale * (1 + e.heat * 0.4),
          a - Math.PI / 2
        );
      }
      this.rays.instanceMatrix.needsUpdate = true;
    }
    const moonScale = sky * e.night;
    this.moon.visible = moonScale > 0.01;
    this.moon.scale.setScalar(Math.max(0.0001, moonScale));
    this.moon.rotation.z = Math.sin(t * 0.3) * 0.08 + this.wobble.x * 0.35;

    const starAmount = e.night * (1 - e.cloud * 0.7) * (1 - e.fog);
    this.stars.visible = starAmount > 0.01;
    if (this.stars.visible) {
      this.seeds.stars.forEach(([x, y, z, p], i) => {
        setInstance(this.stars, i, x, y, z, starAmount * (0.55 + 0.45 * Math.sin(t * 2.3 + p * 20)), t * 0.5 + p * 6);
      });
      this.stars.instanceMatrix.needsUpdate = true;
    }

    // Clouds: puffs appear one by one as the sky fills, and breathe
    const drift = Math.sin(t * 0.3) * 0.06 + e.wind * Math.sin(t * 0.8) * 0.05;
    const reveal = e.cloud * (PUFFS.length + 2);
    PUFFS.forEach(([x, y, z, r], i) => {
      const s = smooth(0, 1, (reveal - i) / 1.6) * r * (1 + Math.sin(t * 1.3 + i * 1.7) * 0.03 + this.puffs[i].x * 0.3);
      setInstance(this.clouds, i, x + drift, y + Math.sin(t * 0.7 + i) * 0.015 + this.bob.x * 0.12, z, s);
    });
    this.clouds.instanceMatrix.needsUpdate = true;
    this.clouds.visible = e.cloud > 0.01;
    const grey = Math.min(1, e.dark * 0.62 + e.rain * 0.18 + e.haze * 0.1);
    this.cloudMat.color.setRGB(1 - grey * 0.55, 1 - grey * 0.52, 1 - grey * 0.45);
    if (e.night > 0) this.cloudMat.color.lerp(new THREE.Color(0.55, 0.6, 0.78), e.night * 0.7);
    if (e.haze > 0) this.cloudMat.color.lerp(new THREE.Color(0.95, 0.85, 0.7), e.haze * 0.5);

    // Rain: streaks slanted by the wind, fading as they land
    const slant = 0.12 + e.wind * 0.45;
    // A tapped cloud lets go of a short shower even under a dry sky
    const rain = Math.max(e.rain, e.cloud > 0.05 ? 0.6 * smooth(0, 0.5, this.burst) : 0);
    const rainCount = Math.round(rain * DROPS);
    this.drops.visible = rainCount > 0;
    if (this.drops.visible) {
      const top = -0.3;
      const span = 2.1;
      this.seeds.drops.forEach(([x0, p, z, sp], i) => {
        if (i >= rainCount) return setInstance(this.drops, i, 0, 0, 0, 0);
        const fall = (t * 5.2 * sp + p * span) % span;
        const y = top - fall;
        const fade = smooth(0, 0.15, fall) * (1 - smooth(span * 0.82, span, fall));
        setInstance(this.drops, i, x0 * 0.92 + fall * slant, y, z, fade, Math.atan(slant));
      });
      this.drops.count = DROPS;
      this.drops.instanceMatrix.needsUpdate = true;
    }

    const snowCount = Math.round(e.snow * FLAKES);
    this.flakes.visible = snowCount > 0;
    if (this.flakes.visible) {
      const span = 2.6;
      this.seeds.flakes.forEach(([x0, p, z, sp], i) => {
        if (i >= snowCount) return setInstance(this.flakes, i, 0, 0, 0, 0);
        const fall = (t * 0.42 * sp + p * span) % span;
        const fade = smooth(0, 0.2, fall) * (1 - smooth(span * 0.8, span, fall));
        const x = x0 + Math.sin(t * 1.4 + p * 9) * 0.1 + fall * e.wind * 0.3;
        setInstance(this.flakes, i, x, -0.25 - fall, z, 0.055 * sp * fade);
      });
      this.flakes.instanceMatrix.needsUpdate = true;
    }

    const dustCount = Math.round(e.haze * DUST);
    this.dust.visible = dustCount > 0;
    if (this.dust.visible) {
      this.seeds.dust.forEach(([x0, y0, z, p], i) => {
        if (i >= dustCount) return setInstance(this.dust, i, 0, 0, 0, 0);
        const x = ((x0 + t * 0.06 * (0.5 + p) + 1.9) % 3.8) - 1.9;
        const y = y0 + Math.sin(t * 0.8 + p * 10) * 0.08;
        setInstance(this.dust, i, x, y, z, (0.025 + p * 0.03) * e.haze);
      });
      this.dust.instanceMatrix.needsUpdate = true;
    }

    // Lightning: a double flicker every few seconds in a storm
    this.flash *= Math.exp(-dt * 9);
    const s = this.strike;
    if (e.storm > 0.5) {
      s.next -= dt;
      if (s.next <= 0 && s.phase < 0) {
        s.phase = 0;
        s.t = 0;
        this.bolt.position.x = rand() * 1.0 - 0.5;
        this.bolt.scale.x = rand() < 0.5 ? -1 : 1;
      }
    }
    if (s.phase >= 0) {
      s.t += dt;
      const on = s.t < 0.08 || (s.t > 0.15 && s.t < 0.28);
      this.bolt.visible = on;
      if (on) this.flash = 1;
      if (s.t > 0.4) {
        s.phase = -1;
        s.next = 1.8 + rand() * 2.8;
        this.bolt.visible = false;
      }
    } else {
      this.bolt.visible = false;
    }

    for (const [i, f] of this.fog.entries()) {
      f.mat.opacity = e.fog * 0.82;
      f.mesh.visible = e.fog > 0.02;
      f.mesh.position.x = Math.sin(t * 0.22 + i * 2.1) * 0.4;
      f.mesh.position.y = f.y + Math.sin(t * 0.5 + i) * 0.03;
    }

    const windy = smooth(0.18, 0.5, e.wind);
    for (const st of this.streaks) {
      const x = -2.6 + ((t * st.speed * (0.7 + e.wind * 1.4) + st.off) % 5.2);
      st.mesh.position.x = x;
      st.mat.opacity = windy * 0.85 * smooth(-2.6, -1.6, x) * (1 - smooth(1.4, 2.4, x));
      st.mesh.visible = st.mat.opacity > 0.01;
    }
  }
}

// ---- Wind: a cup anemometer over a wind vane ----

class Anemometer {
  readonly group = new THREE.Group();
  private rotor = new THREE.Group();
  private vane = new THREE.Group();
  private spin = 0;
  speed = 0;
  direction = 0;
  private dirNow = 0;
  /** Extra spin from a tap or a flick, easing off */
  private boost = 0;
  readonly parts: THREE.Object3D[] = [];

  kick(amount: number) {
    this.boost = Math.min(40, this.boost + amount);
  }

  constructor(skin: THREE.Material, skinDouble: THREE.Material, accent: THREE.Material) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.07, 1.55, 16), skin);
    pole.position.y = -0.36;
    const hub = new THREE.Mesh(SPHERE, skin);
    hub.scale.setScalar(0.14);
    this.rotor.position.y = 0.42;
    this.rotor.add(hub);
    const cup = new THREE.SphereGeometry(0.22, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2).rotateZ(Math.PI / 2);
    for (let i = 0; i < 3; i++) {
      const arm = new THREE.Group();
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.85, 10).rotateZ(Math.PI / 2), skin);
      rod.position.x = 0.45;
      const c = new THREE.Mesh(cup, skinDouble);
      c.position.set(0.9, 0, 0);
      c.rotation.y = Math.PI / 2;
      arm.add(rod, c);
      arm.rotation.y = (i / 3) * Math.PI * 2;
      this.rotor.add(arm);
    }
    this.vane.position.y = -0.32;
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.2, 10).rotateZ(Math.PI / 2), skin);
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.32, 18).rotateZ(-Math.PI / 2), accent);
    head.position.x = 0.7;
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.26, 0.035), skin);
    fin.position.x = -0.62;
    this.vane.add(shaft, head, fin);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.018, 8, 80).rotateX(Math.PI / 2), skin);
    ring.position.y = -0.32;
    const north = new THREE.Mesh(SPHERE, accent);
    north.scale.setScalar(0.06);
    north.position.set(0, -0.32, -0.95);
    this.group.add(pole, this.rotor, this.vane, ring, north);
    this.parts.push(this.group);
    this.group.rotation.x = 0.38;
    this.group.position.y = 0.15;
  }

  update(dt: number, t: number) {
    const target = 0.5 + this.speed * 0.22;
    this.boost *= Math.exp(-dt * 0.7);
    this.spin += (target + this.boost) * dt;
    this.rotor.rotation.y = -this.spin;
    // The vane points where the wind goes (from + 180°), north away from the viewer
    const heading = THREE.MathUtils.degToRad(this.direction + 180);
    const goal = Math.PI / 2 - heading;
    let delta = goal - this.dirNow;
    delta = Math.atan2(Math.sin(delta), Math.cos(delta));
    this.dirNow += delta * damp(3, dt);
    this.vane.rotation.y = this.dirNow + Math.sin(t * 2.1) * 0.04 * (0.3 + this.speed / 30);
    this.group.rotation.y = Math.sin(t * 0.35) * 0.25;
  }
}

// ---- Sun: the day's arc, with the sun (or moon) where it is now ----

class SunArc {
  readonly group = new THREE.Group();
  private ball: THREE.Mesh;
  private rays: THREE.InstancedMesh;
  frac = 0.5;
  isDay = true;
  private shown = 0.5;
  private pop = spring();
  private spinV = 0;
  private spinA = 0;

  get target() {
    return this.ball;
  }

  poke() {
    this.pop.v += 5;
    this.spinV += 9;
  }

  constructor(
    skin: THREE.Material,
    private sunMat: THREE.Material,
    private moonMat: THREE.Material
  ) {
    const R = 1.4;
    const arc = new THREE.Mesh(new THREE.TorusGeometry(R, 0.03, 10, 96, Math.PI), skin);
    arc.position.y = -0.55;
    this.group.position.y = -0.35;
    const horizon = new THREE.Mesh(new THREE.CapsuleGeometry(0.03, 3.3, 4, 10).rotateZ(Math.PI / 2), skin);
    horizon.position.y = -0.55;
    const ends = [-R, R].map((x) => {
      const m = new THREE.Mesh(SPHERE, skin);
      m.scale.setScalar(0.08);
      m.position.set(x, -0.55, 0);
      return m;
    });
    this.ball = new THREE.Mesh(SPHERE, sunMat);
    this.ball.scale.setScalar(0.34);
    this.rays = new THREE.InstancedMesh(RAY, sunMat, 8);
    this.group.add(arc, horizon, ...ends, this.ball, this.rays);
  }

  update(dt: number, t: number) {
    this.shown += (THREE.MathUtils.clamp(this.frac, 0, 1) - this.shown) * damp(3, dt);
    const a = Math.PI * (1 - this.shown);
    const x = Math.cos(a) * 1.4;
    const y = -0.55 + Math.sin(a) * 1.4;
    this.ball.position.set(x, y, 0.05);
    stepSpring(this.pop, dt, 200, 9);
    this.spinV *= Math.exp(-dt * 1.4);
    this.spinA += this.spinV * dt;
    this.ball.scale.setScalar(0.34 * (1 + this.pop.x * 0.3));
    this.ball.material = this.isDay ? this.sunMat : this.moonMat;
    this.rays.visible = this.isDay;
    this.rays.position.set(x, y, 0.05);
    for (let i = 0; i < 8; i++) {
      const ang = t * 0.4 + this.spinA + (i / 8) * Math.PI * 2;
      setInstance(this.rays, i, Math.cos(ang) * 0.5, Math.sin(ang) * 0.5, 0, 0.5, ang - Math.PI / 2);
    }
    this.rays.instanceMatrix.needsUpdate = true;
  }
}

// ---- Rain: a floating island with a pond that catches the drops ----

const ISLAND_DROPS = 60;
const RIPPLES = 16;
const POND_Y = 0.05;
const POND_R = 1.12;

class Island {
  readonly group = new THREE.Group();
  readonly body = new THREE.Group();
  rain = 0;
  private drops: THREE.InstancedMesh;
  private seeds = Array.from({ length: ISLAND_DROPS }, () => [rand(), rand(), rand(), 0.8 + rand() * 0.4]);
  private last = new Float32Array(ISLAND_DROPS);
  private ripples: { mesh: THREE.Mesh; mat: THREE.MeshBasicNodeMaterial; age: number }[] = [];
  private nextRipple = 0;
  private bounce = spring();

  constructor() {
    // A rough, faceted rock tapering to a point, jittered by position so its seams stay closed
    const rock = new THREE.CylinderGeometry(1.25, 0.12, 1.15, 11, 3).translate(0, -0.58, 0);
    const pos = rock.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      if (y > -0.02) continue;
      const h = Math.sin(x * 12.9898 + z * 78.233 + y * 37.719) * 43758.5453;
      const j = h - Math.floor(h);
      pos.setXYZ(i, x * (0.85 + j * 0.3), y - j * 0.18, z * (0.85 + j * 0.3));
    }
    const faceted = rock.toNonIndexed();
    faceted.computeVertexNormals();
    const stone = matcapMaterial({
      base: '#4A4E57',
      shade: '#101115',
      rim: '#9AA4B8',
      rimStrength: 0.5,
      spec: 0.25,
      gloss: 18,
    });
    const pond = new THREE.Mesh(
      new THREE.CylinderGeometry(POND_R, POND_R, 0.1, 56),
      matcapMaterial(
        { base: '#86CBFF', shade: '#2C78DE', rim: '#E8F7FF', rimStrength: 0.7, spec: 1, gloss: 70 },
        { transparent: true, opacity: 0.94 }
      )
    );
    pond.position.y = POND_Y - 0.05;
    const lip = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.07, 10, 64).rotateX(Math.PI / 2), stone);
    lip.position.y = POND_Y;
    this.body.add(new THREE.Mesh(faceted, stone), pond, lip);
    for (let i = 0; i < RIPPLES; i++) {
      const mat = new THREE.MeshBasicNodeMaterial({ color: '#FFFFFF', transparent: true, depthWrite: false });
      const mesh = new THREE.Mesh(new THREE.TorusGeometry(1, 0.035, 6, 40).rotateX(Math.PI / 2), mat);
      mesh.visible = false;
      this.body.add(mesh);
      this.ripples.push({ mesh, mat, age: 1 });
    }
    // Chunky drops, like the rest of the toy world
    this.drops = new THREE.InstancedMesh(
      new THREE.CapsuleGeometry(0.045, 0.2, 4, 8),
      matcapMaterial(SKY_MATCAPS.drop),
      ISLAND_DROPS
    );
    this.group.add(this.body, this.drops);
    this.group.rotation.x = 0.42;
    this.group.position.y = -0.2;
  }

  private ripple(x: number, z: number) {
    const r = this.ripples[this.nextRipple];
    this.nextRipple = (this.nextRipple + 1) % RIPPLES;
    r.age = 0;
    r.mesh.position.set(x, POND_Y + 0.01, z);
    r.mesh.visible = true;
  }

  /** A tap: the island bobs and the pond splashes */
  poke() {
    this.bounce.v -= 3;
    for (let i = 0; i < 6; i++) {
      const a = rand() * Math.PI * 2;
      const d = Math.sqrt(rand()) * 0.8;
      this.ripple(Math.cos(a) * d, Math.sin(a) * d);
    }
  }

  update(dt: number, t: number) {
    stepSpring(this.bounce, dt, 120, 7);
    this.body.position.y = this.bounce.x * 0.25 + Math.sin(t * 0.9) * 0.04;
    const count = Math.round(this.rain * ISLAND_DROPS);
    const top = 2.4;
    const span = top - POND_Y;
    this.seeds.forEach(([a, d, p, sp], i) => {
      if (i >= count) return setInstance(this.drops, i, 0, 0, 0, 0);
      const fall = (t * 2.6 * sp + p * span) % span;
      // A drop that just wrapped around has landed: ripple where it hit
      if (fall < this.last[i]) {
        const ang = a * Math.PI * 2;
        const rr = Math.sqrt(d) * (POND_R - 0.1);
        this.ripple(Math.cos(ang) * rr, Math.sin(ang) * rr);
      }
      this.last[i] = fall;
      const ang = a * Math.PI * 2;
      const rr = Math.sqrt(d) * (POND_R - 0.1);
      const fade = smooth(0, 0.3, fall);
      setInstance(this.drops, i, Math.cos(ang) * rr, top - fall + this.body.position.y, Math.sin(ang) * rr, fade);
    });
    this.drops.instanceMatrix.needsUpdate = true;
    for (const r of this.ripples) {
      if (!r.mesh.visible) continue;
      r.age += dt / 0.9;
      if (r.age >= 1) {
        r.mesh.visible = false;
        continue;
      }
      r.mesh.scale.setScalar(0.05 + r.age * 0.32);
      r.mat.opacity = (1 - r.age) * 0.8;
    }
  }
}

// ---- Moon: the phase, big ----

class MoonBall {
  readonly group = new THREE.Group();
  private ball: THREE.Mesh;
  private pop = spring();
  private stars: THREE.InstancedMesh;
  private seeds = Array.from({ length: 18 }, () => [rand() * 3.6 - 1.8, rand() * 3 - 1.5, -1.2, rand()]);

  constructor(material: THREE.Material) {
    this.ball = new THREE.Mesh(SPHERE, material);
    this.ball.scale.setScalar(1.15);
    this.stars = new THREE.InstancedMesh(
      STAR,
      new THREE.MeshBasicNodeMaterial({ color: '#C9CCD6' }),
      this.seeds.length
    );
    this.group.add(this.ball, this.stars);
  }

  get target() {
    return this.ball;
  }

  poke() {
    this.pop.v += 5;
  }

  update(dt: number, t: number) {
    stepSpring(this.pop, dt, 180, 8);
    this.ball.scale.setScalar(1.15 * (1 + this.pop.x * 0.2));
    this.seeds.forEach(([x, y, z, p], i) => {
      // Keep the stars clear of the disc
      const out = Math.hypot(x, y) > 1.45 ? 1 : 0;
      setInstance(this.stars, i, x, y, z, out * (0.5 + 0.5 * Math.sin(t * 2 + p * 20)), t * 0.4 + p * 5);
    });
    this.stars.instanceMatrix.needsUpdate = true;
  }
}

// ---- The scene ----

function shadowTexture() {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const x = (i + 0.5) / size - 0.5;
      const y = (j + 0.5) / size - 0.5;
      const d = Math.min(1, Math.hypot(x, y) * 2);
      const p = (j * size + i) * 4;
      data[p] = 20;
      data[p + 1] = 28;
      data[p + 2] = 45;
      data[p + 3] = Math.round(255 * Math.pow(1 - d, 2.2));
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/** Signed distance from `i` to `p` around the ring, in pages: -PAGE_COUNT/2 .. PAGE_COUNT/2 */
const ringOffset = (i: number, p: number) => {
  const d = (((i - p) % PAGE_COUNT) + PAGE_COUNT) % PAGE_COUNT;
  return d > PAGE_COUNT / 2 ? d - PAGE_COUNT : d;
};

const easeOut = (x: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);

// ---- Landing streaks: thin lines flung out from the centre as the camera arrives ----

const STREAKS = 26;

class Burst {
  readonly group = new THREE.Group();
  private mat = new THREE.MeshBasicNodeMaterial({ color: '#111111', transparent: true, depthTest: false, fog: false });
  private lines: { mesh: THREE.Mesh; angle: number; speed: number; len: number }[] = [];
  private age = 1;

  constructor() {
    const geo = new THREE.CapsuleGeometry(0.012, 1, 2, 4).rotateZ(Math.PI / 2);
    for (let i = 0; i < STREAKS; i++) {
      const mesh = new THREE.Mesh(geo, this.mat);
      mesh.renderOrder = 20;
      this.group.add(mesh);
      this.lines.push({ mesh, angle: 0, speed: 0, len: 0 });
    }
    this.group.visible = false;
  }

  set color(c: THREE.Color) {
    this.mat.color.copy(c);
  }

  fire() {
    this.age = 0;
    for (const l of this.lines) {
      l.angle = rand() * Math.PI * 2;
      l.speed = 0.7 + rand() * 0.9;
      l.len = 0.12 + rand() * 0.3;
    }
  }

  /** `reach`: world units from the centre to a screen corner */
  update(dt: number, reach: number) {
    this.age += dt / 0.55;
    this.group.visible = this.age < 1;
    if (!this.group.visible) return;
    const e = easeOut(this.age);
    this.mat.opacity = 1 - this.age * this.age;
    for (const l of this.lines) {
      const r = reach * (0.18 + e * 0.95 * l.speed);
      l.mesh.position.set(Math.cos(l.angle) * r, Math.sin(l.angle) * r, 0);
      l.mesh.rotation.z = l.angle;
      l.mesh.scale.set(reach * l.len * (1 - e * 0.6), 1.4, 1);
    }
  }
}

export function createWeatherScene(
  context: GPUCanvasContext & { present: () => void },
  device: GPUDevice,
  controls: WeatherControls
) {
  const canvas = context.canvas as unknown as {
    width: number;
    height: number;
    clientWidth: number;
    clientHeight: number;
  };
  let width = canvas.clientWidth;
  let height = canvas.clientHeight;
  const pixelRatio = canvas.width / Math.max(1, canvas.clientWidth);

  // As in Line 1 Live: opaque canvas, no tone mapping or output pass, colours as authored
  const renderer = new THREE.WebGPURenderer({
    antialias: true,
    alpha: false,
    canvas: context.canvas as HTMLCanvasElement,
    context,
    device,
  });
  renderer.setPixelRatio(1);
  renderer.setSize(canvas.width, canvas.height, false);
  THREE.ColorManagement.enabled = false;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

  const scene = new THREE.Scene();
  // The far side of the ring sits in haze: those pages read as faint ghosts behind the front one
  const fog = new THREE.Fog('#FFFFFF', 0, 1);
  scene.fog = fog;
  const camera = new THREE.PerspectiveCamera(FOV, width / height, 1, 160);
  camera.position.set(0, 0, CAMERA_Z);
  scene.add(camera);

  // Backdrop: a gradient card riding the camera, behind everything
  const topU = TSL.uniform(new THREE.Color('#BFE0FF'));
  const bottomU = TSL.uniform(new THREE.Color('#FFF7EC'));
  const flashU = TSL.uniform(0);
  const bgMat = new THREE.MeshBasicNodeMaterial({ depthWrite: false, depthTest: false, fog: false });
  bgMat.colorNode = TSL.mix(bottomU, topU, TSL.smoothstep(0, 1, TSL.uv().y)).add(flashU.mul(0.35));
  const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), bgMat);
  backdrop.renderOrder = -10;
  backdrop.frustumCulled = false;
  backdrop.position.z = -150;
  camera.add(backdrop);
  const burst = new Burst();
  burst.group.position.z = -6;
  camera.add(burst.group);

  const skinTex = matcap(SKINS.su);
  const skin = new THREE.MeshMatcapNodeMaterial({ matcap: skinTex });
  const skinDouble = new THREE.MeshMatcapNodeMaterial({ matcap: skinTex, side: THREE.DoubleSide });
  const sunMat = matcapMaterial(SKY_MATCAPS.sun);
  const moonMat = moonPhaseMaterial();
  const dropMat = matcapMaterial(SKY_MATCAPS.drop, { transparent: true, opacity: 0.75, depthWrite: false });
  const accent = matcapMaterial({ ...SKY_MATCAPS.sun, base: '#FF6B5A', shade: '#C2263A', rim: '#FFD1C7' });
  const shadowMat = new THREE.MeshBasicNodeMaterial({ map: shadowTexture(), transparent: true, depthWrite: false });
  const shadowGeo = new THREE.PlaneGeometry(1, 1);
  const titleMat = (map: THREE.Texture) =>
    new THREE.MeshBasicNodeMaterial({ map, transparent: true, depthWrite: false, side: THREE.DoubleSide });

  // ---- The main view ----
  const mainSky = new Sky({ sun: sunMat, moon: moonMat, drop: dropMat });
  const main = {
    root: new THREE.Group(),
    heroHolder: new THREE.Group(),
    digits: new DigitRow(skin),
    shadow: new THREE.Mesh(shadowGeo, shadowMat),
    tiltX: spring(),
    tiltY: spring(),
  };
  main.heroHolder.add(mainSky.group);
  main.shadow.renderOrder = -1;
  main.root.add(main.heroHolder, main.digits.group, main.shadow);
  scene.add(main.root);

  // ---- The ring ----
  const cloudSky = new Sky({ sun: sunMat, moon: moonMat, drop: dropMat });
  cloudSky.celestial = false;
  const island = new Island();
  const anemometer = new Anemometer(skin, skinDouble, accent);
  const sunArc = new SunArc(skin, sunMat, moonMat);
  const moon = new MoonBall(moonMat);
  const heroes: Record<PageId, THREE.Object3D | null> = {
    temp: null,
    rain: island.group,
    sun: sunArc.group,
    clouds: cloudSky.group,
    air: anemometer.group,
    moon: moon.group,
  };
  const ring = new THREE.Group();
  scene.add(ring);
  const pages = PAGES.map((id) => {
    const root = new THREE.Group();
    const heroHolder = new THREE.Group();
    const hero = heroes[id];
    if (hero) heroHolder.add(hero);
    const digits = id === 'temp' ? new DigitRow(skin) : null;
    const shadow = new THREE.Mesh(shadowGeo, shadowMat);
    shadow.renderOrder = -1;
    const title = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), titleMat(new THREE.Texture()));
    title.visible = false;
    root.add(heroHolder, shadow, title);
    if (digits) root.add(digits.group);
    ring.add(root);
    return {
      id,
      root,
      heroHolder,
      digits,
      shadow,
      title,
      titleSize: [0, 0] as [number, number],
      tiltX: spring(),
      tiltY: spring(),
    };
  });

  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let grabbing = false;
  let grabTarget = { x: 0, y: 0 };
  const currentPage = () => pageAt(controls.page.get());
  const inRing = () => controls.view.get() > 0.5;

  const place: Placement = {
    heroY: 220,
    heroSize: 230,
    digitsY: 420,
    digitsWidth: 340,
    digitsHeight: 150,
    titleY: 120,
  };
  let layout: SceneLayout = { main: place, detail: place };
  let onFirstFrame: (() => void) | null = null;
  let last = performance.now();
  const start = last;
  const top = new THREE.Color();
  const bottom = new THREE.Color();
  const inkColor = new THREE.Color('#14181F');
  let lastView = controls.view.get();

  /** Tilt springs: held, they follow the finger stiffly; let go, they wobble back */
  const stepTilt = (tilt: { tiltX: Spring; tiltY: Spring }, held: boolean, dt: number) => {
    if (held) {
      tilt.tiltX.v += ((grabTarget.y - tilt.tiltX.x) * 160 - tilt.tiltX.v * 16) * dt;
      tilt.tiltY.v += ((grabTarget.x - tilt.tiltY.x) * 160 - tilt.tiltY.v * 16) * dt;
      tilt.tiltX.x += tilt.tiltX.v * dt;
      tilt.tiltY.x += tilt.tiltY.v * dt;
    } else {
      stepSpring(tilt.tiltX, dt, 90, 5);
      stepSpring(tilt.tiltY, dt, 90, 5);
    }
  };

  // Frame gaps, for the dev FPS readout
  const gaps: number[] = [];
  const frameLog: { at: number; ms: number }[] = [];
  let statsFrom = performance.now();
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    gaps.push(now - last);
    if (gaps.length > 240) gaps.shift();
    if (frameLog.length < 900) frameLog.push({ at: Math.round(now - statsFrom), ms: Math.round(now - last) });
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const t = (now - start) / 1000;

    if (canvas.clientWidth !== width || canvas.clientHeight !== height) {
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
      renderer.setSize(canvas.width, canvas.height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }

    // World units per point on the z = 0 plane: lay things out in screen points
    const k = (2 * CAMERA_Z * Math.tan(THREE.MathUtils.degToRad(FOV) / 2)) / Math.max(1, height);
    const view = controls.view.get();
    // Land with a burst of streaks: on the ring on the way in, on the main view on the way out
    if ((lastView < 0.86 && view >= 0.86) || (lastView > 0.14 && view <= 0.14)) burst.fire();
    lastView = view;

    // ---- Flight between the two: pull back until the whole little world is in view (the
    // main sky above, the ring of pages tilted below it) and dive in. The phases overlap, so
    // something is always moving and the flight never stalls halfway ----
    const pull = smooth(0, 0.5, view) * (1 - smooth(0.5, 1, view));
    const ringScale = Math.pow(smooth(0.08, 1, view), 1.6);
    const mainOut = smooth(0, 0.6, view);
    const mainScale = Math.max(0.0001, (1 - mainOut * 0.75) * (1 - smooth(0.28, 0.72, view)));
    // The ring turns in the swipe's direction as it arrives, landing on its page
    const flyTurn = (1 - smooth(0.1, 1, view)) * 1.2 * Math.sign(controls.spin.get() || 1);

    // ---- Main view ----
    const m = layout.main;
    main.root.visible = view < 0.7;
    if (main.root.visible) {
      stepTilt(main, grabbing && !inRing(), dt);
      main.root.scale.setScalar(mainScale);
      main.root.position.set(0, pull * height * k * 0.2, 0);
      // The drag spins the whole view, and leaving keeps it turning
      main.root.rotation.y = controls.spin.get() + mainOut * Math.sign(controls.spin.get() || 1) * Math.PI * 0.6;
      const heroScale = (m.heroSize * k) / HERO_UNITS;
      main.heroHolder.position.set(0, (height / 2 - m.heroY) * k + Math.sin(t * 0.9) * 0.04, 0);
      main.heroHolder.scale.setScalar(heroScale);
      main.heroHolder.rotation.set(main.tiltX.x, Math.sin(t * 0.4) * 0.08 + main.tiltY.x, 0);
      // Fit the box without squashing: round tubes stay round
      const ms = Math.min((m.digitsHeight * k) / glyphHeight(), (m.digitsWidth * k) / Math.max(1, main.digits.width));
      main.digits.group.position.set(0, (height / 2 - m.digitsY) * k, 0.2);
      main.digits.group.scale.setScalar(ms);
      main.digits.group.rotation.set(main.tiltX.x * 0.7, Math.sin(t * 0.5) * 0.05 + main.tiltY.x * 0.7, 0);
      main.digits.update(dt, t);
      main.shadow.position.set(0, (height / 2 - m.digitsY - m.digitsHeight * 0.55) * k, -0.5);
      main.shadow.scale.set(m.digitsWidth * 0.9 * k, m.digitsHeight * 0.1 * k, 1);
    }

    // ---- Ring: big enough that the next page waits just off screen ----
    const R = width * k * 1.25;
    const step = (Math.PI * 2) / PAGE_COUNT;
    const p = controls.page.get();
    ring.visible = view > 0.08;
    ring.scale.setScalar(Math.max(0.0001, ringScale));
    // Seen from above while pulled back, so the pages spread out round the ring
    ring.position.set(0, pull * height * k * -0.1, 0);
    ring.rotation.x = pull * 0.5;
    // Haze from just behind the front page; the far side of the ring fades to a ghost
    fog.near = CAMERA_Z + 0.6 * ringScale;
    fog.far = CAMERA_Z + (0.6 + R * 2.3) * Math.max(0.25, ringScale);
    const d = layout.detail;
    if (ring.visible) {
      pages.forEach((page, i) => {
        const off = ringOffset(i, p + flyTurn);
        const angle = off * step;
        page.root.position.set(R * Math.sin(angle), 0, R * (Math.cos(angle) - 1));
        // Facing out from the ring: the pages behind show their backs
        page.root.rotation.y = angle;
        stepTilt(page, grabbing && inRing() && i === currentPage(), dt);
        const heroScale = (d.heroSize * k) / HERO_UNITS;
        page.heroHolder.position.set(0, (height / 2 - d.heroY) * k + Math.sin(t * 0.9 + i) * 0.04, 0);
        page.heroHolder.scale.setScalar(heroScale);
        page.heroHolder.rotation.set(page.tiltX.x, Math.sin(t * 0.4 + i) * 0.08 + page.tiltY.x, 0);
        if (page.digits) {
          const ds = Math.min(
            (d.digitsHeight * k) / glyphHeight(),
            (d.digitsWidth * k) / Math.max(1, page.digits.width)
          );
          page.digits.group.position.set(0, (height / 2 - d.digitsY) * k, 0.2);
          page.digits.group.scale.setScalar(ds);
          page.digits.group.rotation.set(page.tiltX.x * 0.7, page.tiltY.x * 0.7, 0);
          page.digits.update(dt, t);
          page.shadow.position.set(0, (height / 2 - d.digitsY - d.digitsHeight * 0.55) * k, -0.5);
          page.shadow.scale.set(d.digitsWidth * 0.8 * k, d.digitsHeight * 0.1 * k, 1);
        } else {
          page.shadow.position.set(0, (height / 2 - d.heroY - d.heroSize * 0.55) * k, -0.5);
          page.shadow.scale.set(d.heroSize * 0.9 * k, d.heroSize * 0.1 * k, 1);
        }
        if (page.title.visible) {
          page.title.position.set(0, (height / 2 - d.titleY) * k, 0.1);
          page.title.scale.set(page.titleSize[0] * k, page.titleSize[1] * k, 1);
          (page.title.material as THREE.MeshBasicNodeMaterial).color.copy(inkColor);
        }
      });
    }
    mainSky.update(dt, t);
    cloudSky.update(dt, t);
    island.update(dt, t);
    anemometer.update(dt, t);
    sunArc.update(dt, t);
    moon.update(dt, t);

    const a = paletteOf(mainSky.env);
    top.setRGB(...a.top);
    bottom.setRGB(...a.bottom);
    topU.value.copy(top);
    bottomU.value.copy(bottom);
    fog.color.copy(top).lerp(bottom, 0.6);
    flashU.value = view < 0.5 ? mainSky.flash : PAGES[currentPage()] === 'clouds' ? cloudSky.flash : 0;
    shadowMat.opacity = 0.28 * (1 - Math.max(mainSky.env.night, mainSky.env.storm) * 0.6);
    burst.color = inkColor;
    // The streaks ride 6 units in front of the camera: size them for that distance
    const kBurst = (2 * 6 * Math.tan(THREE.MathUtils.degToRad(FOV) / 2)) / Math.max(1, height);
    burst.update(dt, Math.hypot(width, height) * 0.5 * kBurst);
    // Size the backdrop to cover the view at its distance
    const h = 2 * 150 * Math.tan(THREE.MathUtils.degToRad(FOV) / 2) * 1.05;
    backdrop.scale.set(h * camera.aspect, h, 1);

    renderer.render(scene, camera);
    context.present();
    if (onFirstFrame) {
      const cb = onFirstFrame;
      onFirstFrame = null;
      cb();
    }
  });

  let titleText: string[] = [];

  return {
    setInput(input: SceneInput) {
      mainSky.target = input.sky;
      cloudSky.target = input.cloudSky;
      island.rain = input.rain;
      main.digits.setText(input.digits.main);
      pages[0].digits?.setText(input.digits.temp);
      anemometer.speed = input.windKmh;
      anemometer.direction = input.windDir;
      sunArc.frac = input.sunFrac;
      sunArc.isDay = input.isDay;
      const angle = input.moonPhase * Math.PI * 2;
      moonLightU.value.set(Math.sin(angle), 0, -Math.cos(angle));
      inkColor.set(input.ink);
    },
    /** Page titles, in PAGES order (redrawn when the language changes) */
    setTitles(titles: string[]) {
      if (titles.join('|') === titleText.join('|')) return;
      titleText = titles;
      titles.forEach(async (text, i) => {
        const tex = await titleTexture(text);
        if (!tex || titleText !== titles) return;
        const page = pages[i];
        const mat = page.title.material as THREE.MeshBasicNodeMaterial;
        mat.map?.dispose();
        mat.map = tex.texture;
        mat.needsUpdate = true;
        page.titleSize = [tex.width, tex.height];
        page.title.visible = true;
      });
    },
    setLayout(next: SceneLayout) {
      layout = next;
    },
    /** A tap at (x, y) points on screen: pokes whatever 3D thing is under it */
    tap(x: number, y: number): TapResult {
      ndc.set((x / width) * 2 - 1, -(y / height) * 2 + 1);
      camera.updateMatrixWorld();
      scene.updateMatrixWorld();
      ray.setFromCamera(ndc, camera);
      if (!inRing()) {
        if (main.digits.poke(ray)) return 'digit';
        return mainSky.poke(ray);
      }
      const page = pages[currentPage()];
      if (page.digits?.poke(ray)) return 'digit';
      switch (page.id) {
        case 'clouds':
          return cloudSky.poke(ray);
        case 'rain':
          if (ray.intersectObject(island.body, true).length) {
            island.poke();
            return 'gadget';
          }
          return null;
        case 'air':
          if (ray.intersectObjects(anemometer.parts, true).length) {
            anemometer.kick(14);
            return 'gadget';
          }
          return null;
        case 'sun':
          if (ray.intersectObject(sunArc.target, false).length) {
            sunArc.poke();
            return 'sun';
          }
          return null;
        case 'moon':
          if (ray.intersectObject(moon.target, false).length) {
            moon.poke();
            return 'moon';
          }
          return null;
        default:
          return null;
      }
    },
    /** Press-and-drag tilts the 3D in front; dx, dy in points from where the press started */
    grab(dx: number, dy: number) {
      grabbing = true;
      grabTarget = {
        x: THREE.MathUtils.clamp(dx * 0.006, -0.9, 0.9),
        y: THREE.MathUtils.clamp(dy * 0.005, -0.6, 0.6),
      };
    },
    /** Let go: the tilt springs back; a flick on the air page spins the cups */
    release(vx: number) {
      grabbing = false;
      if (!inRing()) return main.digits.wave();
      const page = pages[currentPage()];
      if (page.id === 'air') anemometer.kick(Math.abs(vx) / 120);
      page.digits?.wave();
    },
    setSkin(id: SkinId) {
      repaint(skinTex, SKINS[id]);
    },
    onFirstFrame(cb: () => void) {
      onFirstFrame = cb;
    },
    /** Frame rate over the last frames, and the longest gap: for checking smoothness */
    stats(from = 0, to = Infinity) {
      const span = frameLog.filter((f) => f.at >= from && f.at <= to).map((f) => f.ms);
      if (span.length) {
        const sum = span.reduce((a, g) => a + g, 0);
        return {
          fps: Math.round((span.length * 1000) / sum),
          worstMs: Math.max(...span),
          over20: span.filter((g) => g > 20).length,
          frames: span.length,
        };
      }
      const total = gaps.reduce((a, g) => a + g, 0);
      return {
        fps: Math.round((gaps.length * 1000) / Math.max(1, total)),
        worstMs: Math.round(Math.max(0, ...gaps)),
        over20: gaps.filter((g) => g > 20).length,
        frames: gaps.length,
      };
    },
    resetStats() {
      gaps.length = 0;
      frameLog.length = 0;
      statsFrom = performance.now();
    },
    dispose() {
      renderer.setAnimationLoop(null);
      renderer.dispose();
    },
  };
}

export type WeatherScene = ReturnType<typeof createWeatherScene>;
