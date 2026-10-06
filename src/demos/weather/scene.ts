import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

import { AQI_COLORS, aqiBand, paletteOf, type Env } from './data';
import { buildFaceDigits, buildPillDigits, DigitRow, glyphHeight } from './digits';
import {
  arcGlowMaterial,
  cloudMaterial,
  createBackdrop,
  glowMaterial,
  glows,
  gpuInstances,
  haloMaterial,
  moonMaterial,
  placed,
  seed,
  shown,
  skinLook,
  skinMaterial,
  skyLight,
  sunColors,
  sunMaterial,
  waterfallMaterial,
  waterMaterial,
} from './fx';
import { matcap, repaint, SKY_MATCAPS, type MatcapSpec } from './matcaps';
import { themeBackdrop, themeById, type Theme, type ThemeId } from './themes';
import { numeralTypeface, titleGeometry } from './titles';

/**
 * The weather screen's 3D, after (Not Boring) Weather's layout. A main view (the sky over tall
 * puffy numerals) and, behind it, a ring of six forecast pages (temperature, rain, sun, clouds,
 * air, moon). On the ring a swipe whips the next page in from the edge at full size; the pages
 * on the far side show through the haze from behind, titles mirrored. Going between the main
 * view and the ring, the camera pulls back until the whole little world is in view, then dives
 * in through a rush of light streaks, landing with a shockwave and a pop of glossy beads.
 *
 * The toys are lit by matcaps (matcaps.ts); fx.ts adds the world around them: a sky shader
 * behind everything, a sun and moon that travel with the hour and glow, clouds lit by the sun,
 * branching lightning, fireflies, and particles that move on the GPU. A bloom pass picks out
 * everything brighter than white.
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
  /** °C, for the temperature page's glow */
  tempC: number;
  windKmh: number;
  /** Degrees the wind blows from */
  windDir: number;
  /** US AQI, for the specks in the air */
  aqi: number;
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

type F = THREE.Node<'float'>;
type V3 = THREE.Node<'vec3'>;
const { float, vec3, fract, sin, abs, pow, smoothstep, oneMinus, atan, mix } = TSL;

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

const mtx = new THREE.Matrix4();
const quat = new THREE.Quaternion();
const vec = new THREE.Vector3();
const scl = new THREE.Vector3();
const euler = new THREE.Euler();

/** Seconds since the scene started, for every shader that moves */
const timeU = TSL.uniform(0);
/** 0..1 golden hour: the sun and its rays redden */
const warmU = TSL.uniform(0);
/** 0..1 lightning flash, for the materials that catch it */
const flashU = TSL.uniform(0);
/** Direction the sunlight reaches the moon from, in view space: sets the phase */
const moonLightU = TSL.uniform(new THREE.Vector3(1, 0, 0));

const SPHERE = new THREE.SphereGeometry(1, 32, 22);
const SMALL_SPHERE = new THREE.SphereGeometry(1, 12, 8);
// Thin, quick streaks: real drops read as lines at this speed, not as beads
const DROP = new THREE.CapsuleGeometry(0.022, 0.3, 3, 6);
const RAY = new THREE.CapsuleGeometry(0.05, 0.22, 4, 8);
const STAR = new THREE.OctahedronGeometry(0.07, 0);

function matcapMaterial(spec: MatcapSpec, params: THREE.MeshMatcapNodeMaterialParameters = {}) {
  return new THREE.MeshMatcapNodeMaterial({ matcap: matcap(spec), ...params });
}

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

// ---- The sky: sun or moon, clouds, rain, snow, lightning, fog, haze, wind, fireflies ----

/** The big cumulus puffs [x, y, z, radius], in the order they appear as the sky clouds over */
const BASE_PUFFS: [number, number, number, number][] = [
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

/** Each big puff followed by a few small ones budding on its upper side */
const PUFFS: [number, number, number, number][] = (() => {
  const out: [number, number, number, number][] = [];
  BASE_PUFFS.forEach(([x, y, z, r], i) => {
    out.push([x, y, z, r]);
    for (let k = 0; k < (i < 10 ? 2 : 1); k++) {
      const up = 0.4 + rand() * 0.6;
      const a = rand() * Math.PI * 2;
      const side = Math.sqrt(1 - up * up);
      out.push([
        x + Math.cos(a) * side * r * 0.74,
        y + up * r * 0.74,
        z + (Math.abs(Math.sin(a)) * side * 0.8 + 0.12) * r * 0.6,
        r * (0.36 + rand() * 0.16),
      ]);
    }
  });
  return out;
})();
/** A fixed random turn per puff, so their lumps never line up */
const PUFF_TURN = PUFFS.map(() =>
  new THREE.Quaternion().setFromEuler(new THREE.Euler(rand() * 6.3, rand() * 6.3, rand() * 6.3))
);

const DROPS = 140;
const FLAKES = 120;
const DUST = 70;
const STARS = 34;
const RAYS = 10;
const FIREFLIES = 28;
const MOTES = 26;

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

// Cloud colours by light: golden hour, night, dusk, haze
const GOLD_LIT = new THREE.Color(1, 0.8, 0.62);
const GOLD_SHADE = new THREE.Color(0.66, 0.5, 0.62);
const GOLD_RIM = new THREE.Color(1, 0.68, 0.38);
const NIGHT_LIT = new THREE.Color(0.5, 0.56, 0.76);
const NIGHT_SHADE = new THREE.Color(0.19, 0.22, 0.35);
const NIGHT_RIM = new THREE.Color(0.55, 0.65, 0.95);
const DUSK_LIT = new THREE.Color(0.86, 0.62, 0.78);
const HAZE_LIT = new THREE.Color(0.95, 0.85, 0.7);
const DAY_RIM = new THREE.Color(1, 0.82, 0.5);

/** A lightning bolt: a jagged main channel and a couple of forks, as polylines */
function boltPaths() {
  const main = [new THREE.Vector3(0.08, -0.4, 0)];
  let x = 0.08;
  let y = -0.4;
  for (let i = 0; i < 9; i++) {
    y -= 0.16 + rand() * 0.08;
    x += (rand() - 0.5) * 0.34;
    main.push(new THREE.Vector3(x, y, 0));
  }
  const paths = [main];
  for (let b = 0; b < 2; b++) {
    const from = main[2 + Math.floor(rand() * 4)];
    const side = rand() < 0.5 ? -1 : 1;
    const fork = [from.clone()];
    let fx = from.x;
    let fy = from.y;
    const n = 3 + Math.floor(rand() * 2);
    for (let i = 0; i < n; i++) {
      fy -= 0.11 + rand() * 0.06;
      fx += side * (0.08 + rand() * 0.1);
      fork.push(new THREE.Vector3(fx, fy, 0));
    }
    paths.push(fork);
  }
  return paths;
}

/** Hard-cornered tubes along the bolt's paths; the forks are thinner */
function boltGeometry(paths: THREE.Vector3[][], radius: number) {
  const tubes = paths.map((pts, i) => {
    const path = new THREE.CurvePath<THREE.Vector3>();
    for (let k = 1; k < pts.length; k++) path.add(new THREE.LineCurve3(pts[k - 1], pts[k]));
    return new THREE.TubeGeometry(path, pts.length * 6, i === 0 ? radius : radius * 0.55, 6, false);
  });
  return mergeGeometries(tubes) ?? tubes[0];
}

type SkyMaterials = { sun: THREE.Material; rays: THREE.Material; moon: THREE.Material; glow: V3 };

class Sky {
  readonly group = new THREE.Group();
  readonly env: Env = { ...ZERO_ENV, sun: 1 };
  target: Env = { ...ZERO_ENV, sun: 1 };
  /** 0..1 lightning flash, for the backdrop */
  flash = 0;
  /** Show the sun or the moon (the clouds page shows the cloud alone) */
  celestial = true;
  /** A skin's cloud colours, or null for the sky's own */
  tint: Theme['cloud'] = null;
  /** 0..1 golden hour and dusk light, from the scene */
  golden = 0;
  twilight = 0;
  /** How much the sun and the moon show (for the sky's glow round them) */
  sunShown = 0;
  moonShown = 0;
  readonly sun: THREE.Mesh;
  readonly moon: THREE.Group;
  readonly bolt: THREE.Mesh;
  readonly cloud = cloudMaterial();

  private rays: THREE.InstancedMesh;
  private corona: THREE.Sprite;
  private coronaU = TSL.uniform(0);
  private moonHalo: THREE.Sprite;
  private moonHaloU = TSL.uniform(0);
  private stars: THREE.InstancedMesh;
  private clouds: THREE.InstancedMesh;
  private drops: THREE.InstancedMesh;
  private flakes: THREE.InstancedMesh;
  private dust: THREE.InstancedMesh;
  private fireflies: THREE.InstancedMesh;
  private motes: THREE.InstancedMesh;
  private boltHalo: THREE.Mesh;
  private fog: { mesh: THREE.Mesh; mat: THREE.MeshMatcapNodeMaterial; y: number }[] = [];
  private streaks: { mesh: THREE.Mesh; mat: THREE.MeshBasicNodeMaterial; y: number; speed: number; off: number }[] = [];
  /** Shader inputs for the particles */
  private u = {
    rain: TSL.uniform(0),
    slant: TSL.uniform(0.12),
    snow: TSL.uniform(0),
    wind: TSL.uniform(0),
    haze: TSL.uniform(0),
    stars: TSL.uniform(0),
    fireflies: TSL.uniform(0),
    motes: TSL.uniform(0),
  };
  /** Where the sun or moon is along its arc across the sky, 0..1 */
  private arc = 0.62;
  private arcShown = 0.62;
  private day = true;
  private strike = { next: 2, phase: -1, t: 0 };
  // Touch: puffs jiggle, the cloud bobs, a tap wrings out a shower; the sun spins up its rays
  private puffs = PUFFS.map(() => spring());
  private bob = spring();
  private burst = 0;
  private sunPop = spring();
  private raySpin = 0;
  private raySpinV = 0;
  private wobble = spring();

  constructor(materials: SkyMaterials) {
    const t = timeU;
    this.sun = new THREE.Mesh(SPHERE, materials.sun);
    this.rays = new THREE.InstancedMesh(RAY, materials.rays, RAYS);
    this.corona = new THREE.Sprite(haloMaterial(materials.glow, this.coronaU, 0.22, 0.32));
    this.group.add(this.corona, this.sun, this.rays);

    this.moon = new THREE.Group();
    const moonBall = new THREE.Mesh(SPHERE, materials.moon);
    moonBall.scale.setScalar(0.82);
    this.moon.add(moonBall);
    this.moonHalo = new THREE.Sprite(haloMaterial(new THREE.Color(0.72, 0.8, 1), this.moonHaloU, 0.55, 0.4));
    this.group.add(this.moonHalo, this.moon);

    // Stars round the sun-or-moon: little octahedra that twinkle and glow
    {
      const N = STARS;
      const twinkle = sin(t.mul(2.3).add(seed(3, N).mul(20)))
        .mul(0.45)
        .add(0.55);
      const mat = glowMaterial(vec3(1.25, 1.08, 0.7), {}, 0.45);
      mat.positionNode = placed(
        vec3(seed(0, N).mul(3.8).sub(1.9), seed(1, N).mul(1.7).sub(0.1), float(-1.4)),
        this.u.stars.mul(twinkle),
        t.mul(0.5).add(seed(3, N).mul(6))
      );
      this.stars = gpuInstances(STAR, mat, N);
      this.group.add(this.stars);
    }

    this.clouds = new THREE.InstancedMesh(SPHERE, this.cloud.material, PUFFS.length);
    this.group.add(this.clouds);

    // Rain: streaks slanted by the wind, fading as they land
    {
      const N = DROPS;
      const span = 2.1;
      const sp = seed(3, N).mul(0.4).add(0.8);
      const fall = fract(
        t
          .mul(5.2 / span)
          .mul(sp)
          .add(seed(1, N))
      ).mul(span);
      const fade = smoothstep(0, 0.15, fall)
        .mul(oneMinus(smoothstep(span * 0.82, span, fall)))
        .mul(shown(this.u.rain, N));
      const mat = matcapMaterial(SKY_MATCAPS.drop, { transparent: true, opacity: 0.8, depthWrite: false });
      mat.positionNode = placed(
        vec3(
          seed(0, N).mul(2.8).sub(1.4).mul(0.92).add(fall.mul(this.u.slant)),
          float(-0.3).sub(fall),
          seed(2, N).mul(0.8).sub(0.2)
        ),
        fade,
        atan(this.u.slant)
      );
      this.drops = gpuInstances(DROP, mat, N);
    }
    // Snow: drifting, swaying
    {
      const N = FLAKES;
      const span = 2.6;
      const sp = seed(3, N).mul(0.8).add(0.6);
      const fall = fract(
        t
          .mul(0.42 / span)
          .mul(sp)
          .add(seed(1, N))
      ).mul(span);
      const fade = smoothstep(0, 0.2, fall).mul(oneMinus(smoothstep(span * 0.8, span, fall)));
      const x = seed(0, N)
        .mul(3)
        .sub(1.5)
        .add(sin(t.mul(1.4).add(seed(1, N).mul(9))).mul(0.1))
        .add(fall.mul(this.u.wind).mul(0.3));
      const mat = matcapMaterial(SKY_MATCAPS.snow);
      mat.positionNode = placed(
        vec3(x, float(-0.25).sub(fall), seed(2, N).mul(0.8).sub(0.2)),
        sp.mul(0.055).mul(fade).mul(shown(this.u.snow, N))
      );
      this.flakes = gpuInstances(SMALL_SPHERE, mat, N);
    }
    // Haze: dust drifting across
    {
      const N = DUST;
      const x = fract(seed(0, N).add(t.mul(0.06 / 3.6).mul(seed(3, N).add(0.5))))
        .mul(3.6)
        .sub(1.8);
      const y = seed(1, N)
        .mul(3.4)
        .sub(2.2)
        .add(sin(t.mul(0.8).add(seed(3, N).mul(10))).mul(0.08));
      const mat = matcapMaterial(SKY_MATCAPS.dust);
      mat.positionNode = placed(
        vec3(x, y, seed(2, N).sub(0.5)),
        seed(3, N).mul(0.03).add(0.025).mul(this.u.haze).mul(shown(this.u.haze, N))
      );
      this.dust = gpuInstances(SMALL_SPHERE, mat, N);
    }
    // Fireflies on a clear night: wandering, blinking, glowing
    {
      const N = FIREFLIES;
      const x = seed(0, N)
        .mul(3.4)
        .sub(1.7)
        .add(sin(t.mul(seed(1, N).mul(0.3).add(0.15)).add(seed(2, N).mul(6))).mul(0.35));
      const y = seed(1, N)
        .mul(2.6)
        .sub(1.9)
        .add(sin(t.mul(seed(3, N).mul(0.4).add(0.25)).add(seed(0, N).mul(5))).mul(0.25));
      const blink = pow(
        sin(t.mul(seed(3, N).mul(1.2).add(0.8)).add(seed(0, N).mul(20)))
          .mul(0.5)
          .add(0.5),
        3
      );
      const mat = glowMaterial(vec3(2.1, 1.85, 0.62));
      mat.positionNode = placed(vec3(x, y, seed(2, N).mul(0.9).add(0.15)), blink.mul(0.045).mul(this.u.fireflies));
      this.fireflies = gpuInstances(SMALL_SPHERE, mat, N);
    }
    // Motes in the sunshine: specks rising slowly, catching the light
    {
      const N = MOTES;
      const x = seed(0, N)
        .mul(3.6)
        .sub(1.8)
        .add(sin(t.mul(0.2).add(seed(1, N).mul(6))).mul(0.3));
      const y = fract(seed(1, N).add(t.mul(0.02).mul(seed(3, N).add(0.5))))
        .mul(3.2)
        .sub(2.0);
      const twinkle = sin(t.mul(seed(3, N).mul(2).add(1)).add(seed(2, N).mul(30)))
        .mul(0.5)
        .add(0.5);
      const mat = glowMaterial(vec3(1.25, 1.18, 1));
      mat.positionNode = placed(
        vec3(x, y, seed(2, N).mul(0.8)),
        seed(3, N).add(0.5).mul(0.018).mul(twinkle).mul(this.u.motes)
      );
      this.motes = gpuInstances(SMALL_SPHERE, mat, N);
    }
    this.group.add(this.drops, this.flakes, this.dust, this.fireflies, this.motes);

    // Lightning: a white-hot channel in a violet glow, new every strike
    const paths = boltPaths();
    this.bolt = new THREE.Mesh(boltGeometry(paths, 0.04), glowMaterial(vec3(1.8, 1.8, 2.5)));
    this.boltHalo = new THREE.Mesh(
      boltGeometry(paths, 0.13),
      glows(
        new THREE.MeshBasicNodeMaterial({
          color: new THREE.Color(0.45, 0.5, 1),
          transparent: true,
          opacity: 0.5,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      )
    );
    this.bolt.add(this.boltHalo);
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

  /** Where the sun (by day) or the moon (by night) is along its arc, 0..1 */
  setArc(frac: number, isDay: boolean) {
    this.arc = THREE.MathUtils.clamp(frac, 0.03, 0.97);
    // Day turning to night: the moon rises in the east rather than sweeping back across
    if (isDay !== this.day) this.arcShown = this.arc;
    this.day = isDay;
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
    const paths = boltPaths();
    this.bolt.geometry.dispose();
    this.boltHalo.geometry.dispose();
    this.bolt.geometry = boltGeometry(paths, 0.04);
    this.boltHalo.geometry = boltGeometry(paths, 0.13);
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

    // The sun crosses the sky with the hour: low and large at either end, high at noon
    this.arcShown += (this.arc - this.arcShown) * damp(2.5, dt);
    const lift = Math.sin(Math.PI * this.arcShown);
    const sx = -0.85 + 1.7 * this.arcShown;
    const sy = 0.02 + lift * 0.5;
    const sky = this.celestial ? 1 : 0;
    const sunScale =
      sky * e.sun * (0.82 + e.heat * 0.22 + (1 - lift) * 0.12) * (1 - e.night) * (1 + this.sunPop.x * 0.25);
    this.sun.position.set(sx, sy, -0.9);
    this.sun.scale.setScalar(Math.max(0.0001, sunScale));
    this.sun.visible = sunScale > 0.01;
    this.rays.visible = this.sun.visible;
    this.corona.visible = this.sun.visible;
    this.sunShown = Math.min(1, sunScale / 0.82) * (1 - e.cloud * 0.5);
    if (this.sun.visible) {
      this.rays.position.copy(this.sun.position);
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
      this.corona.position.set(sx, sy, -0.95);
      this.corona.scale.setScalar(sunScale * (4.4 + e.heat * 1.6 + Math.sin(t * 1.7) * 0.12));
      this.coronaU.value = (1 - e.cloud * 0.55) * (1 - e.fog * 0.6) * (0.85 + e.heat * 0.4);
    }
    const moonScale = sky * e.night;
    this.moon.visible = moonScale > 0.01;
    this.moonHalo.visible = this.moon.visible;
    this.moonShown = moonScale * (1 - e.cloud * 0.6);
    if (this.moon.visible) {
      this.moon.position.set(sx * 0.85, sy, -0.9);
      this.moon.scale.setScalar(Math.max(0.0001, moonScale));
      this.moon.rotation.z = Math.sin(t * 0.3) * 0.08 + this.wobble.x * 0.35;
      this.moonHalo.position.set(sx * 0.85, sy, -0.95);
      this.moonHalo.scale.setScalar(moonScale * 3.4);
      this.moonHaloU.value = (1 - e.cloud * 0.7) * (1 - e.fog * 0.7);
    }

    this.u.stars.value = e.night * (1 - e.cloud * 0.9) * (1 - e.rain) * (1 - e.fog);
    this.stars.visible = this.u.stars.value > 0.01;

    // Clouds: puffs appear one by one as the sky fills, and breathe
    const drift = Math.sin(t * 0.3) * 0.06 + e.wind * Math.sin(t * 0.8) * 0.05;
    const reveal = e.cloud * (PUFFS.length + 2);
    PUFFS.forEach(([x, y, z, r], i) => {
      const s = smooth(0, 1, (reveal - i) / 1.6) * r * (1 + Math.sin(t * 1.3 + i * 1.7) * 0.03 + this.puffs[i].x * 0.3);
      mtx.compose(
        vec.set(x + drift, y + Math.sin(t * 0.7 + i) * 0.015 + this.bob.x * 0.12, z),
        PUFF_TURN[i],
        scl.setScalar(Math.max(0.0001, s))
      );
      this.clouds.setMatrixAt(i, mtx);
    });
    this.clouds.instanceMatrix.needsUpdate = true;
    this.clouds.visible = e.cloud > 0.01;

    // Cloud light: white by day, gold at sunrise and sunset, blue by moonlight, grey in a storm
    const cu = this.cloud.u;
    const grey = Math.min(1, e.dark * 0.62 + e.rain * 0.18 + e.haze * 0.1);
    cu.lit.value.setRGB(1 - grey * 0.5, 1 - grey * 0.48, 1 - grey * 0.42);
    cu.shade.value.setRGB(0.7 - grey * 0.32, 0.75 - grey * 0.32, 0.85 - grey * 0.3);
    // The sunward edge catches the sun's own colour
    cu.rim.value.setRGB(1, 1, 1).lerp(DAY_RIM, this.sunShown * 0.5);
    if (this.golden > 0) {
      cu.lit.value.lerp(GOLD_LIT, this.golden * 0.7);
      cu.shade.value.lerp(GOLD_SHADE, this.golden * 0.55);
      cu.rim.value.lerp(GOLD_RIM, this.golden);
    }
    if (e.night > 0) {
      cu.lit.value.lerp(NIGHT_LIT, e.night * 0.75);
      cu.shade.value.lerp(NIGHT_SHADE, e.night * 0.75);
      cu.rim.value.lerp(NIGHT_RIM, e.night * 0.8);
    }
    if (this.twilight > 0) cu.lit.value.lerp(DUSK_LIT, this.twilight * 0.5);
    if (e.haze > 0) cu.lit.value.lerp(HAZE_LIT, e.haze * 0.5);
    // A skin's own cloud colours, still darkened a little by storms and the night
    if (this.tint) {
      const dim = 1 - Math.min(0.45, e.dark * 0.35 + e.night * 0.25);
      cu.lit.value.setRGB(...this.tint.lit).multiplyScalar(dim);
      cu.shade.value.setRGB(...this.tint.shade).multiplyScalar(dim);
      cu.rim.value.setRGB(...this.tint.rim);
    }
    cu.rimStrength.value = 0.3 + 0.55 * Math.max(this.sunShown, this.moonShown * 0.6);
    if (this.celestial) cu.key.value.set(sx * 0.8, sy + 0.35, 0.75).normalize();
    cu.flash.value = this.flash * 1.1;

    // Rain (a tapped cloud lets go of a short shower even under a dry sky), snow, dust
    this.u.slant.value = 0.12 + e.wind * 0.45;
    const rain = Math.max(e.rain, e.cloud > 0.05 ? 0.6 * smooth(0, 0.5, this.burst) : 0);
    this.u.rain.value = rain;
    this.drops.visible = rain > 0.005;
    this.u.snow.value = e.snow;
    this.flakes.visible = e.snow > 0.005;
    this.u.wind.value = e.wind;
    this.u.haze.value = e.haze;
    this.dust.visible = e.haze > 0.01;
    this.u.fireflies.value =
      sky * e.night * (1 - e.rain) * (1 - e.snow) * (1 - e.storm) * (1 - e.fog * 0.6) * (1 - e.cloud * 0.4);
    this.fireflies.visible = this.u.fireflies.value > 0.01;
    this.u.motes.value =
      sky * e.sun * (1 - e.night) * (1 - e.cloud * 0.8) * (1 - e.rain) * (1 - e.fog * 0.7) * (0.6 + e.heat * 0.4);
    this.motes.visible = this.u.motes.value > 0.01;

    // Lightning: a double flicker every few seconds in a storm
    this.flash *= Math.exp(-dt * 9);
    const s = this.strike;
    if (e.storm > 0.5) {
      s.next -= dt;
      if (s.next <= 0 && s.phase < 0) this.strikeNow();
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

// ---- Air: leaves on the wind, and specks as thick as the air is dirty ----

const LEAVES = 36;
const SPECKS = 110;

class WindField {
  readonly group = new THREE.Group();
  windKmh = 0;
  aqi = 0;
  private travelU = TSL.uniform(0);
  private leavesU = TSL.uniform(0);
  private specksU = TSL.uniform(0);
  private speckColor = TSL.uniform(new THREE.Color(AQI_COLORS[0]));
  private travel = 0;

  constructor() {
    const t = timeU;
    {
      const N = LEAVES;
      const go = this.travelU.mul(seed(3, N).mul(0.6).add(0.7));
      const x = fract(seed(0, N).add(go.div(4)))
        .mul(4)
        .sub(2);
      const y = seed(1, N)
        .mul(2.4)
        .sub(1.3)
        .add(sin(go.mul(1.6).add(seed(2, N).mul(9))).mul(0.22));
      const edge = smoothstep(2, 1.5, abs(x));
      const flutter = abs(sin(go.mul(4).add(seed(1, N).mul(7))))
        .mul(0.8)
        .add(0.2);
      const leaf = new THREE.SphereGeometry(1, 10, 6).scale(0.11, 0.022, 0.065);
      const mat = matcapMaterial({
        base: '#7FD06A',
        shade: '#2E7D3A',
        rim: '#E8FFD6',
        rimStrength: 0.5,
        spec: 0.3,
        gloss: 20,
      });
      // Some leaves have turned
      mat.colorNode = TSL.vec4(mix(vec3(1, 1, 1), vec3(1.5, 1.05, 0.45), TSL.step(0.62, seed(2, N))), 1);
      const local = TSL.positionGeometry.mul(vec3(1, flutter, 1));
      const angle = go.mul(seed(3, N).sub(0.5).mul(6)).add(seed(0, N).mul(6));
      const c = TSL.cos(angle);
      const s = sin(angle);
      const turned = vec3(local.x.mul(c).sub(local.y.mul(s)), local.x.mul(s).add(local.y.mul(c)), local.z);
      mat.positionNode = turned.mul(edge.mul(shown(this.leavesU, N))).add(vec3(x, y, seed(2, N).mul(1.4).sub(0.5)));
      this.group.add(gpuInstances(leaf, mat, N));
    }
    {
      const N = SPECKS;
      const x = fract(seed(0, N).add(this.travelU.mul(0.012).mul(seed(3, N).add(0.5))))
        .mul(3.8)
        .sub(1.9);
      const y = seed(1, N)
        .mul(3)
        .sub(1.6)
        .add(sin(t.mul(0.3).add(seed(2, N).mul(7))).mul(0.12));
      const mat = new THREE.MeshBasicNodeMaterial();
      mat.colorNode = this.speckColor;
      mat.positionNode = placed(
        vec3(x, y, seed(2, N).mul(1.6).sub(0.6)),
        seed(3, N).mul(0.022).add(0.016).mul(shown(this.specksU, N))
      );
      this.group.add(gpuInstances(SMALL_SPHERE, mat, N));
    }
  }

  update(dt: number) {
    // Carried by the integral of the wind, so a change of wind never jerks what's in the air
    this.travel += dt * (0.18 + this.windKmh * 0.025);
    this.travelU.value = this.travel;
    this.leavesU.value = smooth(3, 28, this.windKmh);
    this.specksU.value = THREE.MathUtils.clamp(this.aqi / 250, 0.08, 1);
    this.speckColor.value.set(AQI_COLORS[aqiBand(this.aqi)]).lerp(new THREE.Color(0.55, 0.5, 0.45), 0.35);
  }
}

// ---- Sun: the day's arc, with the sun (or moon) where it is now ----

class SunArc {
  readonly group = new THREE.Group();
  private ball: THREE.Mesh;
  private rays: THREE.InstancedMesh;
  private halo: THREE.Sprite;
  frac = 0.5;
  isDay = true;
  /** 0..1 how squarely the page faces the camera, so the glow fades on the ghosts behind */
  facing = 1;
  private shown = 0.5;
  private pop = spring();
  private spinV = 0;
  private spinA = 0;
  private progressU = TSL.uniform(0.5);
  private glowColor = TSL.uniform(new THREE.Color(1.35, 0.82, 0.35));
  private haloU = TSL.uniform(1);

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
    private moonMat: THREE.Material,
    rayMat: THREE.Material
  ) {
    const R = 1.4;
    const arc = new THREE.Mesh(new THREE.TorusGeometry(R, 0.03, 10, 96, Math.PI), skin);
    arc.position.y = -0.55;
    // The part of the day already gone glows, warm by day and cool by night
    const glow = new THREE.Mesh(
      new THREE.TorusGeometry(R, 0.05, 10, 96, Math.PI),
      arcGlowMaterial(this.progressU, this.glowColor as unknown as V3)
    );
    glow.position.y = -0.55;
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
    this.rays = new THREE.InstancedMesh(RAY, rayMat, 8);
    this.halo = new THREE.Sprite(haloMaterial(this.glowColor as unknown as V3, this.haloU, 0.25, 0.3));
    this.group.add(arc, glow, horizon, ...ends, this.halo, this.ball, this.rays);
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
    this.progressU.value = this.shown;
    if (this.isDay) this.glowColor.value.setRGB(1.35, 0.82, 0.35);
    else this.glowColor.value.setRGB(0.55, 0.68, 1.25);
    this.halo.position.set(x, y, 0);
    this.halo.scale.setScalar(2.2 * (1 + this.pop.x * 0.3) + Math.sin(t * 1.7) * 0.05);
    this.haloU.value = (this.isDay ? 0.9 : 0.5) * this.facing;
  }
}

// ---- Rain: a floating island with a pond that catches the drops, spilling over its edge ----

const ISLAND_DROPS = 60;
const RIPPLES = 16;
const POND_Y = 0.05;
const POND_R = 1.12;
const TUFTS = 56;

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
  private flowU = TSL.uniform(0.3);
  private mist: THREE.Mesh[] = [];
  private mistAt = new THREE.Vector3();

  constructor(sky: { top: V3 }) {
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
    const moss = matcapMaterial({
      base: '#6CC36A',
      shade: '#1E5E35',
      rim: '#D9FFC8',
      rimStrength: 0.5,
      spec: 0.2,
      gloss: 14,
    });
    const pine = matcapMaterial({
      base: '#3FA25A',
      shade: '#0F3F27',
      rim: '#C9F5C0',
      rimStrength: 0.45,
      spec: 0.25,
      gloss: 16,
    });
    const pond = new THREE.Mesh(new THREE.CylinderGeometry(POND_R, POND_R, 0.1, 56), waterMaterial(timeU, sky));
    pond.position.y = POND_Y - 0.05;
    const lip = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.08, 10, 64).rotateX(Math.PI / 2), moss);
    lip.position.y = POND_Y;
    this.body.add(new THREE.Mesh(faceted, stone), pond, lip);

    // Grass tufts round the rim, and three little pines at the back
    const tufts = new THREE.InstancedMesh(new THREE.ConeGeometry(0.035, 0.16, 5).translate(0, 0.08, 0), moss, TUFTS);
    for (let i = 0; i < TUFTS; i++) {
      const a = (i / TUFTS) * Math.PI * 2 + rand() * 0.08;
      const r = 1.2 + (rand() - 0.5) * 0.09;
      euler.set(rand() * 0.5 - 0.25, 0, rand() * 0.5 - 0.25);
      quat.setFromEuler(euler);
      mtx.compose(vec.set(Math.cos(a) * r, POND_Y + 0.04, Math.sin(a) * r), quat, scl.setScalar(0.6 + rand() * 0.9));
      tufts.setMatrixAt(i, mtx);
    }
    this.body.add(tufts);
    const crown = mergeGeometries([
      new THREE.ConeGeometry(0.17, 0.34, 7).translate(0, 0.3, 0),
      new THREE.ConeGeometry(0.12, 0.26, 7).translate(0, 0.48, 0),
    ]);
    const trunk = new THREE.CylinderGeometry(0.025, 0.035, 0.18, 6).translate(0, 0.09, 0);
    [
      [-2.2, 1],
      [-1.75, 0.72],
      [-1.15, 0.86],
    ].forEach(([a, s]) => {
      const tree = new THREE.Group();
      tree.add(new THREE.Mesh(trunk, stone));
      if (crown) tree.add(new THREE.Mesh(crown, pine));
      tree.position.set(Math.cos(a) * 1.2, POND_Y + 0.02, Math.sin(a) * 1.2);
      tree.scale.setScalar(s);
      this.body.add(tree);
    });

    // A waterfall spilling over the front edge, fraying into mist as it falls
    const d = new THREE.Vector3(0.62, 0, 0.78).normalize();
    const fallPath = new THREE.CatmullRomCurve3(
      [
        [1.08, 0.05],
        [1.26, 0.03],
        [1.4, -0.2],
        [1.46, -0.65],
        [1.48, -1.3],
      ].map(([r, y]) => new THREE.Vector3(d.x * r, y, d.z * r))
    );
    const waterfall = new THREE.Mesh(
      new THREE.TubeGeometry(fallPath, 48, 0.075, 8, false),
      waterfallMaterial(timeU, this.flowU)
    );
    this.body.add(waterfall);
    this.mistAt.set(d.x * 1.48, -1.25, d.z * 1.48);
    const mistMat = matcapMaterial(SKY_MATCAPS.cloud, { transparent: true, opacity: 0.55, depthWrite: false });
    for (let i = 0; i < 5; i++) {
      const puff = new THREE.Mesh(SMALL_SPHERE, mistMat);
      this.mist.push(puff);
      this.body.add(puff);
    }

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
    this.flowU.value = 0.3 + this.rain * 0.9;
    this.mist.forEach((m, i) => {
      const k = (t * 0.35 + i / this.mist.length) % 1;
      m.position.set(
        this.mistAt.x + Math.sin(i * 2.4) * 0.12,
        this.mistAt.y - k * 0.35,
        this.mistAt.z + Math.cos(i * 1.7) * 0.1
      );
      m.scale.setScalar((0.06 + k * 0.14) * (0.6 + this.rain * 0.5));
    });
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
  /** 0..1 how squarely the page faces the camera */
  facing = 1;
  private ball: THREE.Mesh;
  private halo: THREE.Sprite;
  private haloU = TSL.uniform(0.8);
  private pop = spring();
  private stars: THREE.InstancedMesh;
  private seeds = Array.from({ length: 18 }, () => [rand() * 3.6 - 1.8, rand() * 3 - 1.5, -1.2, rand()]);

  constructor(material: THREE.Material) {
    this.ball = new THREE.Mesh(SPHERE, material);
    this.ball.scale.setScalar(1.15);
    this.halo = new THREE.Sprite(haloMaterial(new THREE.Color(0.72, 0.8, 1), this.haloU, 0.45, 0.45));
    this.halo.position.z = -0.4;
    this.halo.scale.setScalar(4.2);
    this.stars = new THREE.InstancedMesh(STAR, glowMaterial(vec3(1.3, 1.3, 1.45)), this.seeds.length);
    this.group.add(this.halo, this.ball, this.stars);
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
    this.halo.scale.setScalar(4.2 * (1 + this.pop.x * 0.25) + Math.sin(t * 1.3) * 0.06);
    this.haloU.value = 0.8 * this.facing;
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

/** The temperature page's glow behind the numerals: blue in the cold, gold when mild, red hot */
const TEMP_STOPS: [number, [number, number, number]][] = [
  [0, [0.42, 0.62, 1]],
  [14, [0.45, 0.82, 1]],
  [22, [1, 0.86, 0.5]],
  [30, [1, 0.58, 0.3]],
  [38, [1, 0.32, 0.22]],
];
function tempColor(c: number, out: THREE.Color) {
  const i = TEMP_STOPS.findIndex(([at]) => at > c);
  if (i <= 0) return out.setRGB(...TEMP_STOPS[i === 0 ? 0 : TEMP_STOPS.length - 1][1]);
  const [a, ca] = TEMP_STOPS[i - 1];
  const [b, cb] = TEMP_STOPS[i];
  const k = (c - a) / (b - a);
  return out.setRGB(ca[0] + (cb[0] - ca[0]) * k, ca[1] + (cb[1] - ca[1]) * k, ca[2] + (cb[2] - ca[2]) * k);
}

// Sky light: golden hour and dusk
const GOLD_TOP = new THREE.Color(0.36, 0.46, 0.8);
const GOLD_BOTTOM = new THREE.Color(1, 0.7, 0.5);
const GOLD_HORIZON = new THREE.Color(1, 0.55, 0.32);
const DUSK_TOP = new THREE.Color(0.12, 0.13, 0.32);
const DUSK_BOTTOM = new THREE.Color(0.55, 0.36, 0.56);
const DUSK_HORIZON = new THREE.Color(0.95, 0.45, 0.48);
const SUN_LIGHT = new THREE.Color(1, 0.86, 0.52);
const WHITE = new THREE.Color(1, 1, 1);
/** Page titles' cap height, in points */
const TITLE_PT = 34;
// Numbers, not a hex string: at module load colour management is still on and would convert it
const DAY_DEEP = new THREE.Color(0.37, 0.66, 1);
const GOLD_LIGHT = new THREE.Color(1, 0.55, 0.28);

/** Signed distance from `i` to `p` around the ring, in pages: -PAGE_COUNT/2 .. PAGE_COUNT/2 */
const ringOffset = (i: number, p: number) => {
  const d = (((i - p) % PAGE_COUNT) + PAGE_COUNT) % PAGE_COUNT;
  return d > PAGE_COUNT / 2 ? d - PAGE_COUNT : d;
};

const easeOut = (x: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);

// ---- The flight's effects, riding in front of the camera: a tunnel of light streaks rushing past
// while the camera travels, then on landing a shockwave ring and a handful of glossy beads that
// pop out, bounce off the air and shrink away. All sized for their distance from the lens ----

const TUNNEL = 36;
const BEADS = 10;
const TUNNEL_FAR = -34;

class Flight {
  readonly group = new THREE.Group();
  private lineMat = new THREE.MeshBasicNodeMaterial({
    color: '#FFFFFF',
    transparent: true,
    depthWrite: false,
    fog: false,
  });
  private lines: THREE.InstancedMesh;
  private tunnel = Array.from({ length: TUNNEL }, () => ({
    angle: rand() * Math.PI * 2,
    // Out round the edges, clear of what's on screen
    r: 2.3 + rand() * 2.2,
    z: TUNNEL_FAR + rand() * -TUNNEL_FAR,
    len: 0.6 + rand() * 0.9,
  }));
  private ringMat = new THREE.MeshBasicNodeMaterial({
    color: '#FFFFFF',
    transparent: true,
    depthWrite: false,
    depthTest: false,
    fog: false,
  });
  private ring: THREE.Mesh;
  private beads: THREE.InstancedMesh;
  private bead = Array.from({ length: BEADS }, () => ({ x: 0, y: 0, vx: 0, vy: 0, size: 0, life: 0 }));
  private age = 1;
  /** 0..1 how fast the camera is travelling, eased */
  private rush = 0;
  /** A zoom kick on landing, springing back: degrees of field of view */
  readonly punch = spring();

  constructor(beadMaterial: THREE.Material) {
    const streak = new THREE.CapsuleGeometry(0.007, 1, 2, 4).rotateX(Math.PI / 2);
    this.lines = new THREE.InstancedMesh(streak, this.lineMat, TUNNEL);
    this.lines.frustumCulled = false;
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.992, 1, 128), this.ringMat);
    this.ring.renderOrder = 20;
    this.ring.position.z = -6;
    this.beads = new THREE.InstancedMesh(SMALL_SPHERE, beadMaterial, BEADS);
    this.beads.frustumCulled = false;
    this.beads.renderOrder = 21;
    this.group.add(this.lines, this.ring, this.beads);
  }

  set color(c: THREE.Color) {
    this.lineMat.color.copy(c);
    this.ringMat.color.copy(c);
  }

  fire() {
    this.age = 0;
    this.punch.v += 26;
    this.bead.forEach((b, i) => {
      const a = (i / BEADS) * Math.PI * 2 + rand() * 0.4;
      const speed = 2.6 + rand() * 2.4;
      b.x = Math.cos(a) * 0.25;
      b.y = Math.sin(a) * 0.25;
      b.vx = Math.cos(a) * speed;
      b.vy = Math.sin(a) * speed;
      b.size = 0.035 + rand() * 0.045;
      b.life = 0.55 + rand() * 0.35;
    });
  }

  /** `speed`: the flight's progress per second; `reach`: units from the centre to a corner at z = -6 */
  update(dt: number, speed: number, reach: number) {
    stepSpring(this.punch, dt, 160, 13);

    // The tunnel: streaks rush towards the lens, longer and brighter the faster the flight
    const goal = smooth(0.2, 1.1, speed);
    this.rush += (goal - this.rush) * damp(goal > this.rush ? 10 : 4, dt);
    this.lines.visible = this.rush > 0.01;
    if (this.lines.visible) {
      const v = 10 + this.rush * 70;
      this.tunnel.forEach((l, i) => {
        l.z += v * dt;
        if (l.z > 1) {
          l.z = TUNNEL_FAR;
          l.angle = rand() * Math.PI * 2;
        }
        const fade = smooth(TUNNEL_FAR, TUNNEL_FAR + 8, l.z) * (1 - smooth(-3, 0.5, l.z));
        const len = l.len * (0.4 + this.rush * 4);
        mtx.compose(
          vec.set(Math.cos(l.angle) * l.r, Math.sin(l.angle) * l.r, l.z),
          quat.identity(),
          scl.set(fade, fade, len * fade + 0.0001)
        );
        this.lines.setMatrixAt(i, mtx);
      });
      this.lines.instanceMatrix.needsUpdate = true;
      this.lineMat.opacity = this.rush * 0.32;
    }

    // Landing: the shockwave and the beads
    this.age += dt;
    const ringT = this.age / 0.6;
    this.ring.visible = ringT < 1;
    if (this.ring.visible) {
      const e = easeOut(ringT);
      this.ring.scale.setScalar(reach * (0.15 + e * 1.05));
      this.ringMat.opacity = (1 - ringT) * (1 - ringT) * 0.4;
    }
    this.beads.visible = this.age < 1;
    if (this.beads.visible) {
      const k = Math.exp(-dt * 3.2);
      this.bead.forEach((b, i) => {
        b.vx *= k;
        b.vy = b.vy * k - dt * 1.6;
        b.x += b.vx * dt * reach * 0.2;
        b.y += b.vy * dt * reach * 0.2;
        const t = this.age / b.life;
        // Pop up fast, hang, then shrink away
        const s = t >= 1 ? 0 : b.size * reach * 0.42 * Math.min(1, t * 9) * (1 - smooth(0.55, 1, t));
        setInstance(this.beads, i, b.x, b.y, -6, s);
      });
      this.beads.instanceMatrix.needsUpdate = true;
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

  // As in Line 1 Live: opaque canvas, no tone mapping, colours as authored
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

  // The sky: one shader on a card riding the camera, behind everything
  const backdrop = createBackdrop();
  const bu = backdrop.u;
  backdrop.mesh.position.z = -150;
  camera.add(backdrop.mesh);
  // The flight's effects, built once the skin exists (the beads wear it): see below

  // Bloom: anything brighter than white (the sun, lightning, stars, fireflies, glints) glows
  // Bloom: only what's marked as glowing (the sun, lightning, stars, fireflies, glints), written
  // to a second target alongside the colour
  const post = new THREE.RenderPipeline(renderer);
  const scenePass = TSL.pass(scene, camera);
  scenePass.setMRT(TSL.mrt({ output: TSL.output, bloomIntensity: float(0) }));
  const sceneColor = scenePass.getTextureNode('output');
  const glowAmount = scenePass.getTextureNode('bloomIntensity');
  const glow = bloom(sceneColor.mul(glowAmount), 0.6, 0.45, 0);
  post.outputNode = sceneColor.add(glow);
  let bloomOn = true;

  const skyColors = { top: bu.top as unknown as V3, bottom: bu.bottom as unknown as V3, flash: flashU as F };
  let theme = themeById('sky');
  let plain = 0;
  const flatTop = new THREE.Color();
  const flatBottom = new THREE.Color();
  const skinTex = matcap(theme.skin);
  const skin = skinMaterial(skinTex, skyColors);
  const skinDouble = skinMaterial(skinTex, skyColors, THREE.DoubleSide);
  const sunMat = sunMaterial(timeU, warmU);
  // The rays are the same toy material as the ball
  const moonMat = moonMaterial(moonLightU);
  const sunGlow = bu.lightColor as unknown as V3;
  const accent = matcapMaterial({ ...SKY_MATCAPS.sun, base: '#FF6B5A', shade: '#C2263A', rim: '#FFD1C7' });
  const shadowMat = new THREE.MeshBasicNodeMaterial({ map: shadowTexture(), transparent: true, depthWrite: false });
  const shadowGeo = new THREE.PlaneGeometry(1, 1);
  // Solid titles: the face in the ink colour, the sides darker, as in the original
  const titleFace = new THREE.MeshBasicNodeMaterial();
  const titleSide = new THREE.MeshBasicNodeMaterial();
  const titleMats = [titleFace, titleSide];

  // The pill numerals, before any row of them is made
  buildPillDigits();

  const flight = new Flight(skin);
  camera.add(flight.group);

  // ---- The main view ----
  const mainSky = new Sky({ sun: sunMat, rays: sunMat, moon: moonMat, glow: sunGlow });
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
  const cloudSky = new Sky({ sun: sunMat, rays: sunMat, moon: moonMat, glow: sunGlow });
  cloudSky.celestial = false;
  const island = new Island(skyColors);
  const anemometer = new Anemometer(skin, skinDouble, accent);
  const windField = new WindField();
  const airHero = new THREE.Group();
  airHero.add(anemometer.group, windField.group);
  const sunArc = new SunArc(skin, sunMat, moonMat, sunMat);
  const moon = new MoonBall(moonMat);
  const heroes: Record<PageId, THREE.Object3D | null> = {
    temp: null,
    rain: island.group,
    sun: sunArc.group,
    clouds: cloudSky.group,
    air: airHero,
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
    const title = new THREE.Mesh(new THREE.BufferGeometry(), titleMats);
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
      tiltX: spring(),
      tiltY: spring(),
    };
  });
  // The temperature page's glow behind its numerals
  const auraColor = TSL.uniform(new THREE.Color(1, 0.86, 0.5));
  const auraU = TSL.uniform(0.55);
  const aura = new THREE.Sprite(haloMaterial(auraColor as unknown as V3, auraU, 0.5, 0.85, true));
  aura.renderOrder = -2;
  pages[0].root.add(aura);
  let tempC = 25;

  // The original's numerals once their face is in (the pills stand in until then)
  const buildNumerals = (amount?: number) =>
    numeralTypeface().then((typeface) => {
      if (!typeface || !buildFaceDigits(typeface, amount)) return;
      main.digits.refresh();
      pages[0].digits?.refresh();
    });
  buildNumerals();

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
  let warmed = false;
  const light = { sunFrac: 0.5, isDay: true };
  let golden = 0;
  let twilight = 0;
  let sunGlowShown = 0;
  let moonGlowShown = 0;

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

  /** Screen uv of an object's centre (or a point in its space) */
  const screenUv = (obj: THREE.Object3D, out: THREE.Vector2, local?: THREE.Vector3) => {
    if (local) obj.localToWorld(vec.copy(local));
    else obj.getWorldPosition(vec);
    vec.project(camera);
    out.set(vec.x * 0.5 + 0.5, vec.y * 0.5 + 0.5);
  };
  const boltFoot = new THREE.Vector3(0, -1, 0);

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
    timeU.value = t;

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
    // Land with a shockwave: on the ring on the way in, on the main view on the way out
    if ((lastView < 0.86 && view >= 0.86) || (lastView > 0.14 && view <= 0.14)) flight.fire();
    const flightSpeed = Math.abs(view - lastView) / Math.max(1e-3, dt);
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
    // Haze from just behind the front page; the far side of the ring fades to a ghost. On the
    // main view it stays out of the way, so the sky keeps its colour
    fog.near = CAMERA_Z + 0.6 * ringScale + (1 - ringScale) * 8;
    fog.far = Math.max(fog.near + 4, CAMERA_Z + (0.6 + R * 2.3) * Math.max(0.25, ringScale));
    const d = layout.detail;
    if (ring.visible) {
      pages.forEach((page, i) => {
        const off = ringOffset(i, p + flyTurn);
        const angle = off * step;
        page.root.position.set(R * Math.sin(angle), 0, R * (Math.cos(angle) - 1));
        // Facing out from the ring: the pages behind show their backs
        page.root.rotation.y = angle;
        const facing = smooth(0.3, 1, Math.cos(angle)) * smooth(0.6, 1, view);
        if (page.id === 'sun') sunArc.facing = facing;
        if (page.id === 'moon') moon.facing = facing;
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
          aura.position.set(0, (height / 2 - d.digitsY) * k, -0.6);
          aura.scale.setScalar(d.digitsWidth * k * (1.45 + Math.sin(t * 1.1) * 0.03));
          auraU.value = 0.55 * facing;
        } else {
          page.shadow.position.set(0, (height / 2 - d.heroY - d.heroSize * 0.55) * k, -0.5);
          page.shadow.scale.set(d.heroSize * 0.9 * k, d.heroSize * 0.1 * k, 1);
        }
        if (page.title.visible) {
          page.title.position.set(0, (height / 2 - d.titleY) * k, 0.1);
          page.title.scale.setScalar(TITLE_PT * k);
          // Turned a touch so the sides show below and to the left, like a block of type
          page.title.rotation.set(-0.13, 0.17, 0);
        }
      });
    }

    // ---- Light: golden hour round sunrise and sunset, dusk and dawn either side of night ----
    const f = THREE.MathUtils.clamp(light.sunFrac, 0, 1);
    const goldenGoal = light.isDay ? Math.max(0, 1 - Math.min(f, 1 - f) / 0.17) : 0;
    const duskGoal = light.isDay ? 0 : Math.max(0, 1 - Math.min(f, 1 - f) / 0.12);
    golden += (goldenGoal - golden) * damp(3, dt);
    twilight += (duskGoal - twilight) * damp(3, dt);
    const e = mainSky.env;
    const g = golden * (1 - e.cloud * 0.45) * (1 - e.fog * 0.5) * (1 - e.storm);
    const w = twilight * (1 - e.cloud * 0.5) * (1 - e.fog * 0.5);
    warmU.value = golden;
    for (const s of [mainSky, cloudSky]) {
      s.golden = g;
      s.twilight = w;
    }
    cloudSky.cloud.u.key.value.set(-0.45, 0.62, 0.64).normalize();

    mainSky.update(dt, t);
    cloudSky.update(dt, t);
    island.update(dt, t);
    anemometer.update(dt, t);
    windField.update(dt);
    sunArc.update(dt, t);
    moon.update(dt, t);
    tempColor(tempC, auraColor.value);

    // ---- The sky behind ----
    const a = paletteOf(e);
    top.setRGB(...a.top);
    bottom.setRGB(...a.bottom);
    // A deeper blue overhead on a clear day, so the white toys stand out against it
    top.lerp(
      DAY_DEEP,
      0.5 * e.sun * (1 - e.night) * (1 - e.cloud * 0.8) * (1 - e.fog) * (1 - e.haze) * (1 - e.heat * 0.5)
    );
    top.lerp(GOLD_TOP, g * 0.4).lerp(DUSK_TOP, w * 0.35);
    bottom.lerp(GOLD_BOTTOM, g * 0.55).lerp(DUSK_BOTTOM, w * 0.5);
    // A skin's flat backdrop eases in over the sky
    const flat = themeBackdrop(theme, e.night);
    plain += ((flat ? 1 : 0) - plain) * damp(4, dt);
    if (flat) {
      flatTop.setRGB(...flat.top);
      flatBottom.setRGB(...flat.bottom);
    }
    top.lerp(flatTop, plain);
    bottom.lerp(flatBottom, plain);
    bu.plain.value = plain;
    bu.top.value.copy(top);
    bu.bottom.value.copy(bottom);
    bu.horizon.value.copy(GOLD_HORIZON).lerp(DUSK_HORIZON, w / (g + w + 1e-4));
    bu.horizonAmount.value = Math.max(g, w);
    bu.lightColor.value.copy(SUN_LIGHT).lerp(GOLD_LIGHT, golden);
    bu.time.value = t;
    bu.aspect.value = width / Math.max(1, height);
    bu.night.value = e.night;
    bu.cloud.value = e.cloud;
    bu.dark.value = e.dark;
    bu.rain.value = e.rain;
    bu.snow.value = e.snow;
    bu.fog.value = e.fog;
    bu.haze.value = e.haze;
    bu.heat.value = e.heat;
    bu.wind.value = e.wind;
    bu.cloudLit.value.copy(mainSky.cloud.u.lit.value);
    bu.cloudShade.value.copy(mainSky.cloud.u.shade.value);
    // The glow follows the sun or moon: the main sky's, or the sun and moon pages'
    const mainW = 1 - smooth(0.15, 0.55, view);
    const ringW = smooth(0.6, 1, view);
    let sunGoal = 0;
    let moonGoal = 0;
    if (mainW >= ringW) {
      if (mainSky.sunShown >= mainSky.moonShown) {
        screenUv(mainSky.sun, bu.light.value);
        sunGoal = mainSky.sunShown * mainW;
      } else {
        screenUv(mainSky.moon, bu.light.value);
        moonGoal = mainSky.moonShown * mainW;
      }
    } else {
      const id = PAGES[currentPage()];
      if (id === 'sun') {
        screenUv(sunArc.target, bu.light.value);
        if (sunArc.isDay) sunGoal = 0.7 * ringW * (1 - e.cloud * 0.5);
        else moonGoal = 0.6 * ringW;
      } else if (id === 'moon') {
        screenUv(moon.target, bu.light.value);
        moonGoal = 0.9 * ringW;
      }
    }
    sunGlowShown += (sunGoal - sunGlowShown) * damp(6, dt);
    moonGlowShown += (moonGoal - moonGlowShown) * damp(6, dt);
    bu.sunGlow.value = sunGlowShown;
    bu.moonGlow.value = moonGlowShown;
    // Lightning: the sky flashes round the bolt
    const flashSky = view < 0.5 ? mainSky : PAGES[currentPage()] === 'clouds' ? cloudSky : null;
    const flash = flashSky?.flash ?? 0;
    bu.flash.value = flash;
    flashU.value = flash;
    if (flashSky && flash > 0.05) screenUv(flashSky.bolt, bu.flashAt.value, boltFoot);

    // The sun or moon lights the numerals and gadgets; on the ring, a key from above and behind
    const lightFrom = mainSky.sunShown >= mainSky.moonShown ? mainSky.sun : mainSky.moon;
    if (mainW >= ringW && main.root.visible) lightFrom.getWorldPosition(vec);
    else vec.set(2.2, 5.5, -4);
    skyLight.pos.value.copy(vec.applyMatrix4(camera.matrixWorldInverse));
    if (mainSky.sunShown >= mainSky.moonShown) skyLight.color.value.copy(bu.lightColor.value);
    else skyLight.color.value.setRGB(0.62, 0.72, 1);
    skyLight.amount.value =
      mainW * Math.max(mainSky.sunShown, mainSky.moonShown * 0.6) +
      ringW * 0.45 * (1 - e.night * 0.4) * (1 - e.cloud * 0.5);
    // The cloud's underside, and its shadow on the numerals below
    skyLight.shadowY.value = mainSky.group.localToWorld(vec.set(0, -0.7, 0)).y;
    skyLight.shadow.value = e.cloud * mainW * 0.9;

    fog.color.copy(top).lerp(bottom, 0.6);
    shadowMat.opacity = 0.28 * (1 - Math.max(e.night, e.storm) * 0.6);
    flight.color = inkColor;
    // The shockwave rides 6 units in front of the camera: size it for that distance
    const kNear = (2 * 6 * Math.tan(THREE.MathUtils.degToRad(FOV) / 2)) / Math.max(1, height);
    flight.update(dt, flightSpeed, Math.hypot(width, height) * 0.5 * kNear);
    // A zoom kick on landing
    const fov = FOV + flight.punch.x * 0.12;
    if (Math.abs(camera.fov - fov) > 1e-4) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    // Size the backdrop to cover the view at its distance
    const h = 2 * 150 * Math.tan(THREE.MathUtils.degToRad(FOV) / 2) * 1.05;
    backdrop.mesh.scale.set(h * camera.aspect, h, 1);

    // The first frame, under the loading screen: draw everything once, the whole ring and every
    // hidden effect included, so their shaders compile now rather than in the first fly-over
    if (!warmed) {
      warmed = true;
      const hidden: THREE.Object3D[] = [];
      scene.traverse((o) => {
        // (a title still waiting for its letters has no geometry to draw)
        const empty = (o as THREE.Mesh).isMesh && !(o as THREE.Mesh).geometry.attributes.position;
        if (!o.visible && !empty) {
          hidden.push(o);
          o.visible = true;
        }
      });
      const ringScale = ring.scale.x;
      ring.scale.setScalar(1);
      const spots = pages.map((pg) => pg.root.position.clone());
      pages.forEach((pg) => pg.root.position.set(0, 0, 0));
      post.render();
      renderer.render(scene, camera);
      hidden.forEach((o) => (o.visible = false));
      ring.scale.setScalar(ringScale);
      pages.forEach((pg, i) => pg.root.position.copy(spots[i]));
    }
    if (bloomOn) post.render();
    else renderer.render(scene, camera);
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
      mainSky.setArc(input.sunFrac, input.isDay);
      light.sunFrac = input.sunFrac;
      light.isDay = input.isDay;
      island.rain = input.rain;
      main.digits.setText(input.digits.main);
      pages[0].digits?.setText(input.digits.temp);
      tempC = input.tempC;
      anemometer.speed = input.windKmh;
      anemometer.direction = input.windDir;
      windField.windKmh = input.windKmh;
      windField.aqi = input.aqi;
      sunArc.frac = input.sunFrac;
      sunArc.isDay = input.isDay;
      const angle = input.moonPhase * Math.PI * 2;
      moonLightU.value.set(Math.sin(angle), 0, -Math.cos(angle));
      inkColor.set(input.ink);
      // Dark ink: a charcoal face on black sides. Light ink: white on a soft grey
      const dark = inkColor.r + inkColor.g + inkColor.b < 1.5;
      titleFace.color.copy(inkColor).lerp(WHITE, dark ? 0.1 : 0);
      titleSide.color.copy(inkColor).multiplyScalar(dark ? 0.3 : 0.62);
    },
    /** Page titles, in PAGES order (redrawn when the language changes) */
    setTitles(titles: string[]) {
      if (titles.join('|') === titleText.join('|')) return;
      titleText = titles;
      titles.forEach(async (text, i) => {
        const solid = await titleGeometry(text);
        if (!solid || titleText !== titles) return;
        const page = pages[i];
        page.title.geometry.dispose();
        page.title.geometry = solid.geometry;
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
    /** Reskin the world: numerals, gadgets, clouds, sun and backdrop */
    setTheme(id: ThemeId) {
      theme = themeById(id);
      repaint(skinTex, theme.skin);
      mainSky.tint = theme.cloud;
      cloudSky.tint = theme.cloud;
      sunColors.lit.value.setRGB(...theme.sun.lit);
      sunColors.shade.value.setRGB(...theme.sun.shade);
      sunColors.warmth.value = theme.backdrop ? 0.3 : 1;
      skinLook.sheen.value = theme.sheen;
      skinLook.dots.value = theme.dots;
      skinLook.dotColor.value.setRGB(...theme.dotColor);
    },
    /** Dev: what the sky is doing */
    debug() {
      return {
        env: mainSky.env,
        golden,
        twilight,
        top: bu.top.value.getHexString(),
        bottom: bu.bottom.value.getHexString(),
        sunGlow: bu.sunGlow.value,
        light: bu.light.value.toArray(),
        fog: [fog.near, fog.far],
        sun: mainSky.sun.position.toArray(),
      };
    },
    /** Dev: the live objects, for poking at from the debugger */
    dev: { scene, camera, mainSky, cloudSky, backdrop },
    /** Dev: rebuild the numerals swollen by `amount` (fraction of the 0's width), to tune them */
    setSwell(amount: number) {
      buildNumerals(amount);
    },
    /** Dev: bloom on or off, to compare */
    setBloom(on: boolean) {
      bloomOn = on;
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
      post.dispose();
      renderer.dispose();
    },
  };
}

export type WeatherScene = ReturnType<typeof createWeatherScene>;
