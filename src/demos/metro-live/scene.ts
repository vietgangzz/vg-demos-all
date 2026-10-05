import * as THREE from 'three/webgpu';

import { LINE_1 } from '@/demos/metro/line-1';

import {
  CINEMATIC_COUNTDOWN,
  DWELL_WARP,
  lightningOf,
  rainShotAt,
  shotAt,
  weatherAt,
  type WeatherPreset,
} from './cinematic';
import { createLineModel, createTimetable, type TrainState } from './line-model';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

import {
  autumnUniform,
  createLeavesMaterial,
  createRainMaterial,
  createXrayMaterial,
  leavesUniform,
  nightUniform,
  rainUniform,
  windDirUniform,
  windTravelUniform,
  windUniform,
} from './shaders';
import { buildCity } from './world/city';
import { buildEnvironment } from './world/environment';
import { ribbonGeometry } from './world/geometry';
import { FORWARD, RIGHT } from './world/layout';
import { tr, type Lang } from './i18n';
import { labelSprite, setSpriteLabel, sizeSprite, stationLabel, trainPin } from './labels';
import { BEN_THANH_MARKET_CENTRE } from './world/landmarks';
import { MAP } from './world/map';
import { buildPassengers } from './world/people';
import { buildRailway, TRACK_OFFSET } from './world/railway';
import { buildTrains, CAR_COUNT, CAR_GAP, CAR_LENGTH } from './world/trains';

export const TRAIN_COUNT = 6;
export const YOUR_TRAIN = 1;
/** Camera distance per unit of zoom; zoom 1 frames a couple of hundred metres around the train */
const DISTANCE_PER_ZOOM = 58;
const LINE_SPAN = MAP.stations[0].distanceTo(MAP.stations[MAP.stations.length - 1]);
/** Zoom that fits the whole line, Bến Thành to Suối Tiên */
export const OVERVIEW_ZOOM = Math.round((LINE_SPAN * 1.8) / DISTANCE_PER_ZOOM);

export type CameraControls = {
  /** Cumulative world-space pan written by the pan gesture (and its fling) */
  panX: { get(): number };
  panZ: { get(): number };
  /** Zoom target written by the pinch gesture; the camera eases towards it */
  zoom: { get(): number; set(v: number): void };
  /** Visible height of the bottom sheet in points */
  sheet: { get(): number };
  /** Width covered by a side sheet on wide layouts (points); the focus centres in the map beside it */
  side: { get(): number };
  /** Orbit around the focus point, radians, relative to the default view (two-finger twist / drag) */
  yaw: { get(): number; set(v: number): void };
  /** Camera elevation, radians above the ground (two-finger vertical drag) */
  pitch: { get(): number; set(v: number): void };
};

/** Default camera direction (from the focus point towards the camera) */
const BASE_DIR = new THREE.Vector3()
  .addScaledVector(FORWARD, -0.62)
  .addScaledVector(RIGHT, 0.1)
  .add(new THREE.Vector3(0, 0.78, 0))
  .normalize();
export const DEFAULT_PITCH = Math.asin(BASE_DIR.y);
export const PITCH_RANGE: [number, number] = [0.42, 1.38];
export const BASE_YAW = Math.atan2(BASE_DIR.z, BASE_DIR.x);

/** Showcase run (cinematic.ts): waiting for Start, counting down, running, arrived */
export type CinematicMode = 'ready' | 'countdown' | 'run' | 'done';

export type FrameInfo = {
  /** Per station: screen x, y, opacity, busy (a train is at the platform) */
  stations: number[];
  /** Per train: screen x, y, opacity */
  trains: number[];
};

const DAY = {
  clear: new THREE.Color('#E9F0F6'),
  sky: new THREE.Color('#FFFFFF'),
  ground: new THREE.Color('#CBD5E1'),
  hemi: 1.6,
  sun: new THREE.Color('#FFF4E5'),
  sunIntensity: 2.3,
};
/** Seconds of a terminus dwell the showcase runs in real time before departure: doors open, then close */
const DOOR_LEAD = 4.5;

/** Golden hour and an overcast sky, for the rain run's weather (cinematic.ts) */
const SUNSET = {
  clear: new THREE.Color('#F4E0D0'),
  sky: new THREE.Color('#FFF3E6'),
  ground: new THREE.Color('#D8D0C8'),
  hemi: 1.55,
  sun: new THREE.Color('#FFD2A8'),
  sunIntensity: 2.2,
};
const STORM = {
  clear: new THREE.Color('#9CA8B5'),
  sky: new THREE.Color('#C4CDD8'),
  ground: new THREE.Color('#8A94A0'),
  hemi: 1.25,
  sun: new THREE.Color('#D3DCE6'),
  sunIntensity: 0.7,
};
const WHITE = new THREE.Color('#FFFFFF');
const NIGHT = {
  clear: new THREE.Color('#151C2C'),
  sky: new THREE.Color('#5E6E9C'),
  ground: new THREE.Color('#1B2232'),
  hemi: 0.75,
  sun: new THREE.Color('#9DB2FF'),
  sunIntensity: 0.5,
};

const OVERVIEW_TARGET = new THREE.Vector3(
  (MAP.stations[0].x + MAP.stations[MAP.stations.length - 1].x) / 2,
  0,
  (MAP.stations[0].y + MAP.stations[MAP.stations.length - 1].y) / 2
);
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/** Frame-rate independent exponential approach */
const damp = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);

/** Doors open shortly after the train stops and close before it leaves */
function doorOpening(s: TrainState) {
  if (s.phase !== 'dwell') return 0;
  return smooth(0.08, 0.22, s.progress) * (1 - smooth(0.78, 0.92, s.progress));
}

export function createLiveScene(
  context: GPUCanvasContext & { present: () => void },
  device: GPUDevice,
  controls: CameraControls
) {
  const canvas = context.canvas as unknown as {
    width: number;
    height: number;
    clientWidth: number;
    clientHeight: number;
  };
  // Points; updated when the canvas changes size (rotation, folding an iPhone Duo)
  let width = canvas.clientWidth;
  let height = canvas.clientHeight;
  const pixelRatio = canvas.width / Math.max(1, canvas.clientWidth);

  // alpha: false → opaque canvas. With the default premultiplied alpha the output pass
  // leaves alpha at 0 on react-native-webgpu and the whole canvas turns transparent.
  const renderer = new THREE.WebGPURenderer({
    antialias: true,
    alpha: false,
    canvas: context.canvas as HTMLCanvasElement,
    context,
    device,
  });
  renderer.setPixelRatio(1);
  renderer.setSize(canvas.width, canvas.height, false);
  // On react-native-webgpu (iOS 27 simulator, three r186) shadow maps, the output pass
  // (tone mapping / sRGB conversion through an intermediate framebuffer) and Color scene
  // backgrounds all turn the frame black. Render straight to the canvas instead: no shadows,
  // no tone mapping, linear output, and colours used as authored.
  renderer.shadowMap.enabled = false;
  THREE.ColorManagement.enabled = false;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

  const scene = new THREE.Scene();
  const clear = DAY.clear.clone();
  renderer.setClearColor(clear, 1);
  const fog = new THREE.Fog(clear, 60, 150);
  scene.fog = fog;

  const camera = new THREE.PerspectiveCamera(36, width / height, 0.5, 400);
  let viewOffset = '';

  const hemi = new THREE.HemisphereLight(DAY.sky, DAY.ground, DAY.hemi);
  const sun = new THREE.DirectionalLight(DAY.sun, DAY.sunIntensity);
  scene.add(hemi, sun, sun.target);

  const model = createLineModel();
  const timetable = createTimetable(model, TRAIN_COUNT);

  const t0 = performance.now();
  const environment = buildEnvironment(scene, model);
  const t1 = performance.now();
  const city = buildCity(scene, model);
  if (__DEV__) (globalThis as { __envMs?: number }).__envMs = Math.round(t1 - t0);
  const { deckUniforms, stationAnchors, platformSpots } = buildRailway(scene, model);
  const trains = buildTrains(scene, TRAIN_COUNT, YOUR_TRAIN);
  // Far LOD: each car as one plain block in a single instanced draw (red line trains, yours green),
  // instead of seven materials per car
  const proxies = new THREE.InstancedMesh(
    // Unit block, sized per frame to stay legible over the route ribbon
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color: '#FFFFFF' }),
    TRAIN_COUNT * CAR_COUNT
  );
  proxies.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  proxies.frustumCulled = false;
  proxies.visible = false;
  for (let k = 0; k < TRAIN_COUNT; k++) {
    for (let c = 0; c < CAR_COUNT; c++) {
      proxies.setColorAt(k * CAR_COUNT + c, new THREE.Color(k === YOUR_TRAIN ? '#1FA35B' : '#FFFFFF'));
    }
  }
  scene.add(proxies);
  // Underground: each car drawn through the street as one clean rounded block (line colour, yours
  // green) instead of the detailed model faded out, whose overlapping layers smear
  const xray = new THREE.InstancedMesh(
    new RoundedBoxGeometry(0.84, 0.6, CAR_LENGTH * 0.97, 2, 0.24),
    createXrayMaterial(),
    TRAIN_COUNT * CAR_COUNT
  );
  xray.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  xray.frustumCulled = false;
  xray.renderOrder = 6;
  for (let k = 0; k < TRAIN_COUNT; k++) {
    for (let c = 0; c < CAR_COUNT; c++) {
      // White like the real trains, seen through the red tunnel band; yours green
      xray.setColorAt(k * CAR_COUNT + c, new THREE.Color(k === YOUR_TRAIN ? '#3CC27A' : '#F7F9FC'));
    }
  }
  scene.add(xray);
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  const undergroundNow = new Array<boolean>(TRAIN_COUNT).fill(false);
  let farView = false;
  // Far LOD: the line drawn as a bold route ribbon, a constant few pixels wide whatever the zoom
  const routePts = model.curve.getSpacedPoints(Math.ceil(model.length / 8)).map((p) => new THREE.Vector3(p.x, 3, p.z));
  const route = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshBasicMaterial({ color: LINE_1.color, depthWrite: false })
  );
  route.renderOrder = 5;
  route.visible = false;
  scene.add(route);
  let routeWidth = 0;
  const proxyMatrix = new THREE.Matrix4();
  const proxyPos = new THREE.Vector3();
  const proxyScale = new THREE.Vector3();
  const passengers = buildPassengers(scene, platformSpots);

  // Rain for the rain run: streaks of two crossed quads, placed and animated by the shader
  const RAIN_STREAKS = 9000;
  const rainShader = createRainMaterial();
  const rainPos = new Float32Array(RAIN_STREAKS * 8 * 3);
  const rainOrigin = new Float32Array(RAIN_STREAKS * 8 * 3);
  const rainIndex: number[] = [];
  const quad = [
    [-0.016, 0, 0],
    [0.016, 0, 0],
    [0.016, 1, 0],
    [-0.016, 1, 0],
    [0, 0, -0.016],
    [0, 0, 0.016],
    [0, 1, 0.016],
    [0, 1, -0.016],
  ];
  const rainRand = (() => {
    let seed = 7;
    return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  })();
  for (let i = 0; i < RAIN_STREAKS; i++) {
    const o = [rainRand(), rainRand(), rainRand()];
    quad.forEach((q, v) => {
      rainPos.set(q, (i * 8 + v) * 3);
      rainOrigin.set(o, (i * 8 + v) * 3);
    });
    const b = i * 8;
    rainIndex.push(b, b + 1, b + 2, b, b + 2, b + 3, b + 4, b + 5, b + 6, b + 4, b + 6, b + 7);
  }
  const rainGeometry = new THREE.BufferGeometry();
  rainGeometry.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
  rainGeometry.setAttribute('origin', new THREE.BufferAttribute(rainOrigin, 3));
  rainGeometry.setIndex(rainIndex);
  const rain = new THREE.Mesh(rainGeometry, rainShader.material);
  rain.frustumCulled = false;
  rain.renderOrder = 30;
  rain.visible = false;
  scene.add(rain);

  // Autumn leaves for the rain run: flat cards, tumbled and blown by the shader
  const LEAVES = 1400;
  const leavesShader = createLeavesMaterial();
  const leafPos = new Float32Array(LEAVES * 4 * 3);
  const leafUv = new Float32Array(LEAVES * 4 * 2);
  const leafOrigin = new Float32Array(LEAVES * 4 * 3);
  const leafSeed = new Float32Array(LEAVES * 4 * 3);
  const leafIndex: number[] = [];
  for (let i = 0; i < LEAVES; i++) {
    const s = 0.11 + rainRand() * 0.07;
    const o = [rainRand(), rainRand(), rainRand()];
    const seed = [rainRand(), rainRand(), rainRand()];
    [
      [-s, 0, -s * 0.6, 0, 0],
      [s, 0, -s * 0.6, 0, 1],
      [s, 0, s * 0.6, 1, 1],
      [-s, 0, s * 0.6, 1, 0],
    ].forEach(([x, y, z, u, v], k) => {
      // uv.y runs along the leaf (x), uv.x across it
      leafPos.set([x, y, z], (i * 4 + k) * 3);
      leafUv.set([u, v], (i * 4 + k) * 2);
      leafOrigin.set(o, (i * 4 + k) * 3);
      leafSeed.set(seed, (i * 4 + k) * 3);
    });
    leafIndex.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
  }
  const leafGeometry = new THREE.BufferGeometry();
  leafGeometry.setAttribute('position', new THREE.BufferAttribute(leafPos, 3));
  leafGeometry.setAttribute('uv', new THREE.BufferAttribute(leafUv, 2));
  // Lit from above like the ground, so leaves catch the low sun
  const leafNormal = new Float32Array(LEAVES * 4 * 3);
  for (let i = 1; i < leafNormal.length; i += 3) leafNormal[i] = 1;
  leafGeometry.setAttribute('normal', new THREE.BufferAttribute(leafNormal, 3));
  leafGeometry.setAttribute('origin', new THREE.BufferAttribute(leafOrigin, 3));
  leafGeometry.setAttribute('seed', new THREE.BufferAttribute(leafSeed, 3));
  leafGeometry.setIndex(leafIndex);
  const leaves = new THREE.Mesh(leafGeometry, leavesShader.material);
  leaves.frustumCulled = false;
  leaves.visible = false;
  scene.add(leaves);

  // ---- Camera ------------------------------------------------------------
  const target = new THREE.Vector3(MAP.stations[0].x, 0, MAP.stations[0].y);
  let zoom = controls.zoom.get();
  type Focus = { kind: 'train'; index: number } | { kind: 'point'; point: THREE.Vector3 } | { kind: 'free' };
  let focus: Focus = { kind: 'train', index: YOUR_TRAIN };
  // A flight eases the target from where it was to the new focus with a zoom "hop"
  let flight: { from: THREE.Vector3; fromZoom: number; start: number; duration: number; hop: number } | null = null;
  let lastPanX = controls.panX.get();
  let lastPanZ = controls.panZ.get();
  let idleSince = 0;
  const cameraDir = BASE_DIR.clone();
  let yaw = controls.yaw.get();
  let pitch = controls.pitch.get();

  // Day / night blend
  let nightTarget = 0;
  let autumnTarget = 0;
  let night = 0;

  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();
  const tmp3 = new THREE.Vector3();
  const projected = new THREE.Vector3();
  const desired = new THREE.Vector3();

  /** Cab to last car, as a fraction of the line */
  const trainSpan = ((CAR_COUNT - 1) * CAR_GAP) / model.length;
  const placeTrain = (k: number, seconds: number) => {
    const s = timetable.stateAt(seconds, k);
    const train = trains[k];
    const underground = s.u < model.portalU - 3 / model.length;
    const moving = s.phase === 'move' ? Math.sin(Math.PI * s.progress) : 0;
    // The timetable gives the cab's position; the cars trail behind it. A terminus is the end of
    // the line, so a train there is already set for the trip back (cab at the far end, on the
    // track it leaves by) and pulls out with its whole length inside the platform, instead of
    // trailing cars that would pile up against the buffers
    let dir = s.dir;
    let front = s.u;
    const last = model.stationU.length - 1;
    if (s.phase === 'dwell' && (s.station === 0 || s.station === last)) {
      dir = s.station === 0 ? 1 : -1;
      front = s.u + dir * trainSpan;
    } else if (s.phase === 'move' && (s.from === 0 || s.from === last)) {
      const a = model.stationU[s.from];
      const b = model.stationU[s.station];
      front = s.u + s.dir * trainSpan * (1 - (s.u - a) / (b - a || 1));
    }
    train.cars.forEach((car, c) => {
      const u = THREE.MathUtils.clamp(front - dir * c * (CAR_GAP / model.length), 0, 1);
      model.curve.getPointAt(u, tmp);
      model.curve.getTangentAt(u, tmp2);
      // Right-hand running on the double track
      const off = TRACK_OFFSET * dir;
      tmp.x += -tmp2.z * off;
      tmp.z += tmp2.x * off;
      tmp2.multiplyScalar(dir);
      car.position.set(tmp.x, tmp.y + (underground ? 0.02 : 0.38), tmp.z);
      car.lookAt(tmp.x + tmp2.x, car.position.y + tmp2.y, tmp.z + tmp2.z);
      // Lean into curves a little, proportional to speed
      model.curve.getTangentAt(Math.min(1, u + 6 / model.length), tmp3).multiplyScalar(dir);
      const turn = tmp2.x * tmp3.z - tmp2.z * tmp3.x;
      car.rotateZ(THREE.MathUtils.clamp(turn * 1.6, -0.06, 0.06) * moving);
    });
    undergroundNow[k] = underground;
    train.setDoors(doorOpening(s));
    return s;
  };

  /** Writes screen x, y (points) and NDC z into `projected` */
  const projectInto = (p: THREE.Vector3) => {
    projected.copy(p).project(camera);
    projected.set(((projected.x + 1) / 2) * width, ((1 - projected.y) / 2) * height, projected.z);
  };

  const focusPoint = (out: THREE.Vector3) => {
    if (focus.kind === 'train') {
      const lead = trains[focus.index].cars[0].position;
      return out.set(lead.x, 0, lead.z);
    }
    if (focus.kind === 'point') return out.copy(focus.point);
    return out.copy(target);
  };

  const startFlight = (seconds: number, hop: number) => {
    // Longer hops take a little longer, like Maps flying between places
    // The hop only adds what neither end of the flight already shows: none out of the overview
    const peak = Math.max(0, hop - Math.max(zoom, controls.zoom.get()));
    flight = {
      from: target.clone(),
      fromZoom: zoom,
      start: seconds,
      duration: 1.15 + Math.min(1.1, hop * 0.08),
      hop: peak,
    };
  };
  /** Zoom-out "hop" for a flight: pull back enough to see where you are going */
  const flightHop = (from: THREE.Vector3, to: THREE.Vector3) =>
    Math.max(0.35, Math.min(OVERVIEW_ZOOM * 0.6, Math.hypot(to.x - from.x, to.z - from.z) / DISTANCE_PER_ZOOM));

  // ---- Showcase run ------------------------------------------------------
  // The trains run on their own clock: real speed, with your train's station stops sped up by
  // DWELL_WARP. It starts with your train in the terminus dwell at Suối Tiên, CINEMATIC_COUNTDOWN
  // seconds before it leaves; the other trains keep their timetable around it.
  type Cinematic = {
    mode: CinematicMode;
    clock: number;
    rate: number;
    since: number;
    snap: boolean;
    azimuth: number;
    zoom: number;
    pitch: number;
    market: number;
    /** Units the framing is raised above the train */
    rise: number;
    /** Station position of your train last frame */
    at: number;
    /** Your train was stopped at a station last frame (its stops run faster) */
    dwelling: boolean;
    /** Extra elevation that keeps the camera itself out of a tower, eased */
    clear: number;
    /** The train's heading, smoothed so a curve in the track turns the shot gently */
    heading: number;
    /** The camera follows the shots; false once the viewer takes over (pan, a station…) */
    directed: boolean;
    /**
     * 0..1: how tightly the focus is locked to the train. A time-lapsed train moves far too fast
     * for an eased follow (it would leave the frame), so the lock is rigid, ramping up over a
     * second only when the director takes the camera back from the viewer.
     */
    lock: number;
    /** When Start was pressed (the rain run's weather is timed from it) */
    started: number;
  };
  let cine: Cinematic | null = null;
  /** The rain run: weather on, and the train a little slower than real time */
  let cineWeather = false;
  let cinePreset: WeatherPreset = 'storm';
  /** Station your train starts from (13 = Suối Tiên), heading for Bến Thành */
  const lastStation = model.stationU.length - 1;
  let cineFrom = lastStation;
  /** -1 towards Bến Thành (the default), 1 out towards Suối Tiên */
  let cineDir: 1 | -1 = -1;
  /** Station stops sped up (DWELL_WARP) or at the timetable's own length */
  let cineWarpStops = true;
  /** Seconds into the run that Start jumps to (a cut that begins mid-run), 0 for the whole run */
  let cineSkip = 0;
  let cineSpeed = 1;
  /** Seconds from Start to departure (the showcase run's countdown, or the rain run's hold) */
  let cineHold = CINEMATIC_COUNTDOWN;
  let flash = 0;
  let onCinematic: ((mode: CinematicMode) => void) | null = null;
  const market = BEN_THANH_MARKET_CENTRE
    ? new THREE.Vector3(BEN_THANH_MARKET_CENTRE.x, 0, BEN_THANH_MARKET_CENTRE.y)
    : new THREE.Vector3(MAP.stations[0].x, 0, MAP.stations[0].y);
  const cineFocus = new THREE.Vector3();
  /** Where your train stopped at Bến Thành: the closing shot stays on it after the train moves on */
  const arrival = new THREE.Vector3();
  const setCineMode = (mode: CinematicMode, seconds: number) => {
    if (!cine || cine.mode === mode) return;
    cine.mode = mode;
    cine.since = seconds;
    onCinematic?.(mode);
  };
  const resetCinematic = (mode: CinematicMode) => {
    const seconds = performance.now() / 1000;
    cine = {
      mode,
      // Your train in its terminus dwell at Suối Tiên, doors open, at most DOOR_LEAD seconds from
      // leaving (stateAt() shifts each train by k × cycle / TRAIN_COUNT; undo that for yours)
      clock:
        timetable.departs(cineFrom, cineDir) -
        Math.min(cineHold, DOOR_LEAD) -
        (YOUR_TRAIN * timetable.cycle) / TRAIN_COUNT,
      rate: 0,
      since: seconds,
      snap: true,
      azimuth: 0,
      zoom: 0,
      pitch: 0,
      market: 0,
      rise: 0,
      at: cineFrom,
      directed: true,
      lock: 1,
      started: seconds,
      dwelling: true,
      clear: 0,
      heading: NaN,
    };
    focus = { kind: 'free' };
    flight = null;
    onCinematic?.(mode);
  };
  /**
   * One frame of the run's clock: frozen until Start, real time from then on, station stops sped
   * up once under way. A hold longer than the dwell left waits with the clock stopped, doors
   * open, then runs the last DOOR_LEAD seconds in real time so the doors close just before the
   * train leaves. Also moves the run on from countdown to run to done.
   */
  const stepCinematic = (c: Cinematic, seconds: number, dt: number) => {
    const holding = c.mode === 'countdown' && seconds - c.started < cineHold - DOOR_LEAD;
    const goal =
      c.mode === 'ready' || holding ? 0 : c.mode !== 'run' ? 1 : c.dwelling && cineWarpStops ? DWELL_WARP : cineSpeed;
    c.rate += (goal - c.rate) * damp(4, dt);
    if (c.mode === 'ready' || holding) c.rate = 0;
    c.clock += dt * c.rate;
    const hero = timetable.stateAt(c.clock, YOUR_TRAIN);
    c.dwelling = hero.phase === 'dwell';
    if (c.mode === 'countdown' && hero.phase === 'move') setCineMode('run', seconds);
    else if (c.mode === 'run' && hero.phase === 'dwell' && hero.station === (cineDir === -1 ? 0 : lastStation)) {
      setCineMode('done', seconds);
    }
  };
  // Last camera angles, so control can pass between the director and the viewer without a jump
  let lastAzimuth = BASE_YAW;
  let lastPitch = DEFAULT_PITCH;
  /** The viewer takes the camera: the gesture controls continue from the directed shot */
  const releaseDirector = () => {
    if (!cine?.directed) return;
    cine.directed = false;
    const turn = lastAzimuth - BASE_YAW - yaw;
    yaw += Math.atan2(Math.sin(turn), Math.cos(turn));
    controls.yaw.set(yaw);
    pitch = lastPitch;
    controls.pitch.set(THREE.MathUtils.clamp(lastPitch, PITCH_RANGE[0], PITCH_RANGE[1]));
    controls.zoom.set(zoom);
  };
  /** Back to the directed shots, easing in from wherever the camera is now */
  const resumeDirector = () => {
    if (!cine || cine.directed) return;
    cine.directed = true;
    cine.lock = 0;
    cine.zoom = zoom;
    cine.pitch = lastPitch;
    cine.azimuth = lastAzimuth;
    focus = { kind: 'free' };
    flight = null;
  };
  /** Station position of a point along the line: 0 = Bến Thành … 13 = Suối Tiên */
  const stationAt = (u: number) => {
    const su = model.stationU;
    let i = 0;
    while (i < su.length - 2 && su[i + 1] < u) i++;
    return i + THREE.MathUtils.clamp((u - su[i]) / (su[i + 1] - su[i]), 0, 1);
  };

  let onFrame: ((info: FrameInfo) => void) | null = null;
  let lastSeconds = 0;
  const busy = new Uint8Array(stationAnchors.length);
  // ---- Station labels and train pins, as sprites in the scene (labels.ts) ----
  const stationSprites = stationAnchors.map((anchor, i) => {
    const idle = labelSprite(stationLabel(i, false), 100);
    const full = labelSprite(stationLabel(i, true), 100);
    idle.position.copy(anchor);
    full.position.copy(anchor);
    scene.add(idle, full);
    return { idle, full, busy: 0 };
  });
  const pinSprites = trains.map((_, k) => {
    const sprite = labelSprite(k === YOUR_TRAIN ? trainPin(' ', true) : trainPin(`T${k + 1}`, false), 101);
    scene.add(sprite);
    return { sprite, covered: 0, text: '' };
  });
  // Screen positions this frame: per station x, y, opacity; per train x, y
  const labelScreen = new Float32Array(stationAnchors.length * 3);
  const pinScreen = new Float32Array(TRAIN_COUNT * 2);
  let labelLang: Lang = 'en';
  const updateLabels = (states: TrainState[], dt: number) => {
    camera.updateMatrixWorld();
    busy.fill(0);
    for (const s of states) if (s.phase === 'dwell') busy[s.station] = 1;
    stationAnchors.forEach((anchor, i) => {
      projectInto(anchor);
      const { x, y, z } = projected;
      const dist = Math.hypot(anchor.x - target.x, anchor.z - target.z);
      const near = THREE.MathUtils.clamp(1 - (dist - 16 * zoom) / (12 * zoom), 0, 1);
      const onScreen = z < 1 && x > -40 && x < width + 40 && y > -20 && y < height + 20 ? 1 : 0;
      const o = near * onScreen;
      labelScreen[i * 3] = x;
      labelScreen[i * 3 + 1] = y;
      labelScreen[i * 3 + 2] = o;
      const label = stationSprites[i];
      label.busy += (busy[i] - label.busy) * damp(9, dt);
      (label.idle.material as THREE.SpriteNodeMaterial).opacity = o * (1 - label.busy);
      (label.full.material as THREE.SpriteNodeMaterial).opacity = o * label.busy;
      label.idle.visible = o * (1 - label.busy) > 0.01;
      label.full.visible = o * label.busy > 0.01;
      sizeSprite(label.idle, camera, height);
      sizeSprite(label.full, camera, height);
    });
    trains.forEach((t, k) => {
      const pin = pinSprites[k];
      pin.sprite.position.copy(t.cars[0].position);
      pin.sprite.position.y += 1.1;
      projectInto(pin.sprite.position);
      const { x, y, z } = projected;
      pinScreen[k * 2] = x;
      pinScreen[k * 2 + 1] = y;
      if (k === YOUR_TRAIN) {
        // Your train's pin counts down to its next departure or arrival
        const total = Math.max(
          0,
          Math.ceil(timetable.stateAt(cine ? cine.clock : performance.now() / 1000, k).remaining)
        );
        const text = tr(labelLang).pin(`${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`);
        if (text !== pin.text) {
          pin.text = text;
          const material = pin.sprite.material as THREE.SpriteNodeMaterial;
          setSpriteLabel(pin.sprite, trainPin(text, true, material.map as THREE.DataTexture));
        }
      } else {
        // Other trains step aside when they would sit on a station label (its green dot already
        // says a train is there); two chips on top of each other read as clutter
        let hit = false;
        for (let i = 0; i < stationAnchors.length && !hit; i++) {
          if (labelScreen[i * 3 + 2] < 0.25) continue;
          const [lw] = stationSprites[i].idle.userData.size as [number, number];
          const lx = labelScreen[i * 3] - 12;
          const ly = labelScreen[i * 3 + 1] - 30;
          hit = x + 15 > lx && x - 15 < lx + lw - 16 && y > ly && y - 26 < ly + 24;
        }
        pin.covered += ((hit ? 1 : 0) - pin.covered) * damp(12, dt);
      }
      const o = (z < 1 ? 1 : 0) * (1 - pin.covered);
      (pin.sprite.material as THREE.SpriteNodeMaterial).opacity = o;
      pin.sprite.visible = o > 0.01;
      sizeSprite(pin.sprite, camera, height);
    });
  };

  // Paused while a full-height sheet covers the map: the JS thread then belongs to the UI
  let paused = false;
  renderer.setAnimationLoop(() => {
    if (paused) return;
    // Same clock as the status sheet, so the list and the 3D view agree
    const seconds = performance.now() / 1000;
    const dt = lastSeconds ? Math.min(0.05, seconds - lastSeconds) : 1 / 60;
    lastSeconds = seconds;

    if (cine) stepCinematic(cine, seconds, dt);
    const states = trains.map((_, k) => placeTrain(k, cine ? cine.clock : seconds));
    if (cine?.mode === 'done' && cine.since === seconds) arrival.copy(trains[YOUR_TRAIN].cars[1].position).setY(0);
    trains.forEach((t, k) =>
      t.cars.forEach((car, c) => {
        const ug = undergroundNow[k] && !farView;
        car.visible = !farView && !undergroundNow[k];
        if (ug) {
          car.updateMatrix();
          xray.setMatrixAt(k * CAR_COUNT + c, car.matrix);
        } else {
          xray.setMatrixAt(k * CAR_COUNT + c, hidden);
        }
      })
    );
    xray.instanceMatrix.needsUpdate = true;
    environment.update(seconds, night);
    city.update(seconds);
    passengers.update(seconds, states);

    // Weather (the rain run): golden hour, then wind, clouds and rain, timed from Start
    let sunset = 0;
    let cloud = 0;
    if (cine && cineWeather) {
      const t = cine.mode === 'ready' ? 0 : seconds - cine.started;
      const w = weatherAt(t, cinePreset);
      sunset = w.sunset;
      cloud = w.cloud;
      windUniform.value = w.wind;
      rainUniform.value = w.rain;
      leavesUniform.value = w.leaves;
      // The wind blows across the view (towards screen right: last frame's camera), turning
      // slowly as the camera pans; leaves travel 3.3 units/s per unit of wind (~15 m/s in a gale)
      const across = Math.atan2(-cameraDir.x, cameraDir.z);
      const dirNow = Math.atan2(windDirUniform.value.y, windDirUniform.value.x);
      const turn = Math.atan2(Math.sin(across - dirNow), Math.cos(across - dirNow));
      const angle = dirNow + turn * damp(0.5, dt);
      windDirUniform.value.set(Math.cos(angle), Math.sin(angle));
      windTravelUniform.value.addScaledVector(windDirUniform.value, w.wind * 3.3 * dt);
      night = w.night;
      flash *= Math.exp(-dt * 9);
      for (const at of lightningOf(cinePreset)) if (t >= at && t - dt < at) flash = 1;
    } else {
      windUniform.value = 0;
      rainUniform.value = 0;
      leavesUniform.value = 0;
      night += (nightTarget - night) * damp(2.4, dt);
    }

    // Autumn crowns turn over a few seconds, tree by tree (shaders.ts autumnTint)
    autumnUniform.value += (autumnTarget - autumnUniform.value) * damp(0.8, dt);

    // Day / night, through the weather's palettes; a lightning flash washes over everything
    const mix = (out: THREE.Color, k: keyof typeof DAY) =>
      out
        .copy(DAY[k] as THREE.Color)
        .lerp(SUNSET[k] as THREE.Color, sunset)
        .lerp(STORM[k] as THREE.Color, cloud)
        .lerp(NIGHT[k] as THREE.Color, night)
        .lerp(WHITE, flash * 0.55);
    const level = (k: 'hemi' | 'sunIntensity') =>
      THREE.MathUtils.lerp(
        THREE.MathUtils.lerp(THREE.MathUtils.lerp(DAY[k], SUNSET[k], sunset), STORM[k], cloud),
        NIGHT[k],
        night
      );
    nightUniform.value = night;
    mix(clear, 'clear');
    renderer.setClearColor(clear, 1);
    fog.color.copy(clear);
    mix(hemi.color, 'sky');
    mix(hemi.groundColor, 'ground');
    hemi.intensity = level('hemi') + flash * 1.8;
    mix(sun.color, 'sun');
    sun.intensity = level('sunIntensity') + flash * 1.2;

    // Route glow ahead of the followed (or your) train
    const glowTrain = focus.kind === 'train' ? focus.index : YOUR_TRAIN;
    const fs = states[glowTrain];
    const head = fs.u * model.length;
    const nextIndex =
      fs.phase === 'dwell' ? THREE.MathUtils.clamp(fs.station + fs.dir, 0, model.stationU.length - 1) : fs.station;
    const next = model.stationU[nextIndex] * model.length;
    deckUniforms.lo.value = Math.min(head, next);
    deckUniforms.hi.value = Math.max(head, next);
    deckUniforms.dir.value = fs.dir;
    // uv.x = 0 is the right-hand edge of the deck (looking towards Suối Tiên)
    deckUniforms.track.value = fs.dir === 1 ? 0.26 : 0.74;

    // ---- Camera: pan (with fling), flights, follow ----
    const dx = controls.panX.get() - lastPanX;
    const dz = controls.panZ.get() - lastPanZ;
    lastPanX = controls.panX.get();
    lastPanZ = controls.panZ.get();
    if (Math.abs(controls.yaw.get() - yaw) > 0.002 || Math.abs(controls.pitch.get() - pitch) > 0.002) {
      idleSince = seconds;
    }
    if (dx !== 0 || dz !== 0) {
      releaseDirector();
      focus = { kind: 'free' };
      flight = null;
      target.x += dx;
      target.z += dz;
      idleSince = seconds;
    }
    let hop = 0;
    let camPitch = -1;
    let camAzimuth = 0;
    if (cine) cine.at = stationAt(states[YOUR_TRAIN].u);
    if (cine?.directed) {
      // Directed camera: the shot for where the train is, eased so the moves stay calm
      const hero = states[YOUR_TRAIN];
      const sinceStart = cine.mode === 'ready' ? 0 : seconds - cine.started;
      // The song runs follow the music's timeline; the others key their shots to the stations
      const river = cineFrom !== lastStation;
      const shot =
        cineWeather && !river
          ? rainShotAt(sinceStart)
          : shotAt(cine.mode === 'done' && cineDir === -1 ? 0 : cine.at, river);
      model.curve.getTangentAt(hero.u, tmp2);
      // Inbound the train runs against the curve, so "behind it" is along the tangent. The rain
      // run smooths it over several seconds: the shot turns with the line, never with each bend
      // Inbound the train runs against the curve (behind it is along the tangent), outbound with it
      const behindNow = Math.atan2(tmp2.z, tmp2.x) + (cineDir === 1 ? Math.PI : 0);
      if (Number.isNaN(cine.heading) || cine.snap) cine.heading = behindNow;
      const bend = Math.atan2(Math.sin(behindNow - cine.heading), Math.cos(behindNow - cine.heading));
      cine.heading += bend * (cineWeather ? damp(0.35, dt) : 1);
      const behind = cine.heading;
      const held = seconds - cine.since;
      // No endless spin: still while waiting for Start; through the platform hold a slow glide out
      // and back that lands on the departure angle as the train leaves; a capped drift to close
      const orbit = cineWeather
        ? 0
        : cine.mode === 'countdown'
          ? Math.sin(Math.PI * Math.min(1, held / cineHold)) * 0.22
          : cine.mode === 'done'
            ? Math.min(0.6, held * 0.03)
            : 0;
      const goal = behind + shot.side + orbit + Math.sin(seconds * 0.2) * (cineWeather ? 0.015 : 0.05);
      // The rain run's shots are already eased; follow them softly but without lag building up
      const ease = cineWeather ? 1.3 : 0.9;
      const k = cine.snap ? 1 : damp(ease, dt);
      const turn = Math.atan2(Math.sin(goal - cine.azimuth), Math.cos(goal - cine.azimuth));
      cine.azimuth += turn * k;
      cine.zoom +=
        ((cine.mode === 'done' ? shot.zoom + Math.min(1, held * 0.08) : shot.zoom) - cine.zoom) *
        (cine.snap ? 1 : damp(ease, dt));
      cine.pitch += (shot.pitch - cine.pitch) * (cine.snap ? 1 : damp(ease, dt));
      cine.market += (shot.market - cine.market) * (cine.snap ? 1 : damp(1.2, dt));
      cine.rise += ((shot.rise ?? 0) - cine.rise) * (cine.snap ? 1 : damp(1.2, dt));
      if (cine.mode === 'done') cineFocus.copy(arrival);
      else cineFocus.copy(trains[YOUR_TRAIN].cars[1].position);
      cineFocus.lerp(market, cine.market);
      cineFocus.y += cine.rise;
      cine.lock = Math.min(1, cine.lock + dt / 1.2);
      target.lerp(cineFocus, cine.snap ? 1 : THREE.MathUtils.lerp(damp(4, dt), 1, smooth(0, 1, cine.lock)));
      // Towers may pass in front of the train (that is part of the shot), but the camera itself
      // must never end up inside one, or the whole frame turns grey. The lowest pitch that clears
      // every roof around (and a little ahead of) the camera is solved directly, then eased, so
      // the camera rises over a tower in one smooth move instead of in steps
      const reach = DISTANCE_PER_ZOOM * cine.zoom;
      const across = Math.cos(cine.pitch) * reach;
      let need = -Infinity;
      for (let t = 0.6; t <= 1.3; t += 0.05) {
        const x = target.x + Math.cos(cine.azimuth) * across * t;
        const z = target.z + Math.sin(cine.azimuth) * across * t;
        const roof = city.skylineAt(x, z) + 2;
        if (roof <= target.y) continue;
        need = Math.max(need, Math.asin(Math.min(1, (roof - target.y) / (reach * t))));
      }
      const lift = Math.max(0, need - cine.pitch);
      cine.clear += (lift - cine.clear) * (cine.snap ? 1 : damp(lift > cine.clear ? 2.2 : 0.6, dt));
      zoom = cine.zoom;
      camPitch = Math.min(1.3, cine.pitch + cine.clear);
      camAzimuth = cine.azimuth;
      cine.snap = false;
    } else if (flight) {
      // Pan and zoom share the flight, like Maps: flying in, the camera travels while still high
      // and settles in at the end; flying out, it pulls back first. Zoom eases in log space, so
      // the city scales at an even rate instead of snapping in before the camera moves.
      const t = Math.min(1, (seconds - flight.start) / flight.duration);
      const toZoom = controls.zoom.get();
      const zoomingIn = toZoom < flight.fromZoom * 0.9;
      const zoomingOut = toZoom > flight.fromZoom * 1.1;
      const move = easeInOut(zoomingIn ? Math.min(1, t / 0.75) : zoomingOut ? Math.max(0, (t - 0.25) / 0.75) : t);
      const scale = easeInOut(zoomingIn ? Math.max(0, (t - 0.2) / 0.8) : zoomingOut ? Math.min(1, t / 0.75) : t);
      target.lerpVectors(flight.from, focusPoint(desired), move);
      zoom = Math.exp(THREE.MathUtils.lerp(Math.log(flight.fromZoom), Math.log(toZoom), scale));
      hop = Math.sin(Math.PI * t) * flight.hop;
      if (t >= 1) flight = null;
    } else {
      if (focus.kind !== 'free') target.lerp(focusPoint(desired), damp(5, dt));
      zoom += (controls.zoom.get() - zoom) * damp(9, dt);
    }
    const distance = DISTANCE_PER_ZOOM * (zoom + hop);
    city.setCameraDistance(distance);
    const distant = distance > 470;
    if (distant !== farView) {
      farView = distant;
      environment.setDetail(!distant);
      proxies.visible = distant;
      route.visible = distant;
    }
    if (distant) {
      const w = distance * 0.0032;
      if (Math.abs(w - routeWidth) > routeWidth * 0.2) {
        routeWidth = w;
        route.geometry.dispose();
        route.geometry = ribbonGeometry(routePts, w);
      }
      proxyScale.set(routeWidth * 3.2, 3, Math.max(CAR_GAP, routeWidth * 2.4));
      trains.forEach((t, k) =>
        t.cars.forEach((car, c) => {
          proxyPos.set(car.position.x, 4.5, car.position.z);
          proxyMatrix.compose(proxyPos, car.quaternion, proxyScale);
          proxies.setMatrixAt(k * CAR_COUNT + c, proxyMatrix);
        })
      );
      proxies.instanceMatrix.needsUpdate = true;
    }
    // Close directed shots look out over the city, so their fog starts no nearer than 70 units
    // (~300 m); rain and cloud still close it in
    // (a clear day sees much further: the river run keeps Landmark 81 out of the haze)
    const reachOut = cine?.directed ? (cineWeather && cinePreset === 'clear' ? 170 : 70) : 0;
    fog.near = Math.max(distance * 0.95, reachOut);
    fog.far = Math.max(distance * 2.3, reachOut * 2.6) * (1 - cloud * 0.25 - Math.min(1.5, rainUniform.value) * 0.12);
    // Nothing past the fog is visible, so clip there: depth precision and fewer tiles to draw
    const far = Math.max(distance * 2.6, reachOut * 2.8) + 60;
    const nearPlane = Math.max(0.3, distance * 0.008);
    if (Math.abs(camera.far - far) > far * 0.02 || camera.near !== nearPlane) {
      camera.far = far;
      camera.near = nearPlane;
      camera.updateProjectionMatrix();
    }

    // Orbit + tilt ease towards the gesture targets
    yaw += (controls.yaw.get() - yaw) * damp(12, dt);
    pitch += (controls.pitch.get() - pitch) * damp(12, dt);
    // A slow breathing drift so the city never looks frozen; calms down while interacting
    const calm = smooth(0, 3, seconds - idleSince);
    const a = cine?.directed ? camAzimuth : BASE_YAW + yaw + Math.sin(seconds * 0.11) * 0.035 * calm;
    const el = cine?.directed ? camPitch : pitch;
    lastAzimuth = a;
    lastPitch = el;
    cameraDir.set(Math.cos(el) * Math.cos(a), Math.sin(el), Math.cos(el) * Math.sin(a));
    camera.position.copy(target).addScaledVector(cameraDir, distance);
    camera.lookAt(target);

    // Keep the focus point centred in the area above the sheet
    // Follow the canvas when the window changes shape
    if (canvas.clientWidth !== width || canvas.clientHeight !== height) {
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
      renderer.setSize(canvas.width, canvas.height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      viewOffset = '';
    }
    // Keep the focus point centred in the map area: above a bottom sheet, beside a side sheet
    const offset = Math.round(controls.sheet.get() * 0.42);
    const side = -Math.round(controls.side.get() * 0.5);
    const key = `${offset},${side},${width},${height}`;
    if (key !== viewOffset) {
      viewOffset = key;
      camera.setViewOffset(width, height, side, offset, width, height);
    }

    // A golden-hour sun sits low
    sun.position.set(target.x - 24, 46 - sunset * 28, target.z + 18);
    // In the rain run both layers draw from the start (fully transparent until the weather calls
    // for them), so their shaders compile while the train waits instead of stalling a frame later
    rain.visible = cineWeather || rainUniform.value > 0.01;
    leaves.visible = cineWeather || leavesUniform.value > 0.01;
    if (leaves.visible) {
      leavesShader.uniforms.center.value.copy(target);
      leavesShader.uniforms.size.value = THREE.MathUtils.clamp(distance * 1.4, 40, 140);
    }
    if (rain.visible) {
      rainShader.uniforms.center.value.copy(target);
      rainShader.uniforms.size.value = THREE.MathUtils.clamp(distance * 1.5, 50, 180);
    }
    sun.target.position.copy(target);

    updateLabels(states, dt);
    renderer.render(scene, camera);
    context.present();

    if (onFrame) {
      // Fresh arrays every frame: objects handed to a shared value are frozen by Worklets. The
      // labels themselves are sprites in the scene; React Native keeps an invisible tap target on
      // each station, and a frame of lag doesn't matter for a tap
      const stationInfo: number[] = new Array(stationAnchors.length * 4);
      const trainInfo: number[] = new Array(TRAIN_COUNT * 3);
      for (let i = 0; i < stationAnchors.length; i++) {
        stationInfo[i * 4] = labelScreen[i * 3];
        stationInfo[i * 4 + 1] = labelScreen[i * 3 + 1];
        stationInfo[i * 4 + 2] = labelScreen[i * 3 + 2];
        stationInfo[i * 4 + 3] = busy[i];
      }
      for (let k = 0; k < TRAIN_COUNT; k++) {
        trainInfo[k * 3] = pinScreen[k * 2];
        trainInfo[k * 3 + 1] = pinScreen[k * 2 + 1];
        trainInfo[k * 3 + 2] = 1;
      }
      onFrame({ stations: stationInfo, trains: trainInfo });
    }
  });

  return {
    timetable,
    model,
    /** The timetable clock: real time, or the showcase run's time-lapse */
    now() {
      return cine ? cine.clock : performance.now() / 1000;
    },
    /** Showcase run: park your train at Suối Tiên and frame it, waiting for startCinematic() */
    setCinematic(
      cb: (mode: CinematicMode) => void,
      options: {
        weather?: WeatherPreset;
        speed?: number;
        hold?: number;
        from?: number;
        skip?: number;
        dir?: 1 | -1;
        warpStops?: boolean;
        meet?: number;
      } = {}
    ) {
      onCinematic = cb;
      cineWeather = !!options.weather;
      cinePreset = options.weather ?? 'storm';
      cineFrom = options.from ?? lastStation;
      cineDir = options.dir ?? -1;
      cineWarpStops = options.warpStops ?? true;
      // Stage a meeting: shift one other train's timetable so it passes yours, on the other
      // track, at `meet` (a station position, e.g. 4.2 = over the Saigon River)
      for (let k = 0; k < TRAIN_COUNT; k++) timetable.setShift(k, 0);
      if (options.meet !== undefined) {
        const i = Math.floor(options.meet);
        const su = model.stationU;
        const u = su[i] + (su[i + 1] - su[i]) * (options.meet - i);
        const [a, b] = cineDir === 1 ? [i, i + 1] : [i + 1, i];
        const other = (YOUR_TRAIN + 3) % TRAIN_COUNT;
        const mine = timetable.passes(u, a, b);
        const theirs = timetable.passes(u, b, a);
        timetable.setShift(other, theirs - mine + ((YOUR_TRAIN - other) * timetable.cycle) / TRAIN_COUNT);
      }
      cineSkip = options.skip ?? 0;
      cineSpeed = options.speed ?? 1;
      cineHold = options.hold ?? CINEMATIC_COUNTDOWN;
      // No cars or motorbikes in the showcase runs: at these close angles they read as toys
      city.setTraffic(false);
      resetCinematic('ready');
    },
    /** Dev: camera target and position, and where your train is */
    debugCamera() {
      const car = trains[YOUR_TRAIN].cars[1].position;
      const r = (v: THREE.Vector3) => [v.x, v.y, v.z].map((n) => Math.round(n * 10) / 10);
      projectInto(car);
      return { target: r(target), camera: r(camera.position), car: r(car), screen: [projected.x, projected.y] };
    },
    /** Start (or replay) the showcase run: CINEMATIC_COUNTDOWN seconds, then the train leaves */
    startCinematic() {
      resetCinematic('countdown');
      if (!cine || cineSkip <= 0) return;
      // A cut that opens partway into the run: replay the clock frame by frame up to `cineSkip`
      // seconds after Start, so the train, the weather and the lightning are exactly where the
      // full run has them at that moment; the camera then snaps to that shot
      const c: Cinematic = cine;
      const now = c.started;
      const dt = 1 / 60;
      for (let t = 0; t < cineSkip; t += dt) stepCinematic(c, now + t, dt);
      const shift = cineSkip;
      c.started = now - shift;
      c.since -= shift;
      c.snap = true;
    },
    setFollow(k: number) {
      // In the showcase run, following your train hands the camera back to the director
      if (cine && k === YOUR_TRAIN) return resumeDirector();
      releaseDirector();
      const seconds = performance.now() / 1000;
      focus = { kind: 'train', index: k };
      if (controls.zoom.get() > 1.6) controls.zoom.set(1);
      startFlight(seconds, flightHop(target, trains[k].cars[0].position));
    },
    focusStation(i: number) {
      releaseDirector();
      const seconds = performance.now() / 1000;
      const a = stationAnchors[i];
      focus = { kind: 'point', point: new THREE.Vector3(a.x, 0, a.z) };
      if (controls.zoom.get() > 1.2) controls.zoom.set(0.85);
      startFlight(seconds, flightHop(target, a));
    },
    /** Dev: set zoom (and optionally pitch) without changing focus */
    zoomTo(zoomLevel: number, pitchAngle?: number) {
      controls.zoom.set(zoomLevel);
      if (pitchAngle !== undefined) controls.pitch.set(pitchAngle);
    },
    /** Fly to any ground point (used by dev tooling and QA) */
    /** Dev: how many meshes would be drawn from the current camera */
    debugDrawCalls() {
      const frustum = new THREE.Frustum().setFromProjectionMatrix(
        new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
      );
      let total = 0;
      let inView = 0;
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh || !mesh.visible) return;
        total++;
        if (!mesh.frustumCulled || frustum.intersectsObject(mesh)) inView++;
      });
      return { total, inView };
    },
    /** Dev: drawn meshes grouped by material type and colour */
    debugGroups() {
      const groups: Record<string, number> = {};
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh || !mesh.visible) return;
        const mat = mesh.material as THREE.Material & { color?: THREE.Color };
        const key = `${mat.type}:${mat.color ? mat.color.getHexString() : ''}:${mesh.parent === scene ? 'root' : 'child'}`;
        groups[key] = (groups[key] ?? 0) + 1;
      });
      return Object.entries(groups)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 14);
    },
    /** Dev: triangles per mesh, largest first */
    debugTriangles() {
      const rows: { name: string; tris: number; count: number }[] = [];
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh & { count?: number; isInstancedMesh?: boolean };
        if (!mesh.isMesh || !mesh.visible) return;
        const g = mesh.geometry;
        const base = (g.index ? g.index.count : g.getAttribute('position').count) / 3;
        const count = mesh.isInstancedMesh ? (mesh.count ?? 1) : 1;
        const mat = mesh.material as THREE.Material & { color?: THREE.Color };
        rows.push({
          name: `${mat.type}:${mat.color ? mat.color.getHexString() : ''}`,
          tris: Math.round(base * count),
          count,
        });
      });
      return rows.sort((a, b) => b.tris - a.tris).slice(0, 15);
    },
    lookAt(x: number, z: number, zoomLevel = 1, pitchAngle?: number) {
      const seconds = performance.now() / 1000;
      const point = new THREE.Vector3(x, 0, z);
      focus = { kind: 'point', point };
      controls.zoom.set(zoomLevel);
      if (pitchAngle !== undefined) controls.pitch.set(pitchAngle);
      startFlight(seconds, flightHop(target, point));
    },
    showOverview() {
      releaseDirector();
      const seconds = performance.now() / 1000;
      controls.yaw.set(0);
      controls.pitch.set(DEFAULT_PITCH);
      focus = { kind: 'point', point: OVERVIEW_TARGET.clone() };
      controls.zoom.set(OVERVIEW_ZOOM);
      startFlight(seconds, 0);
    },
    /** Autumn colours for the broadleaf trees */
    setAutumn(on: boolean) {
      autumnTarget = on ? 1 : 0;
    },
    /** The language of the pins' text */
    setLanguage(lang: Lang) {
      labelLang = lang;
    },
    setNight(on: boolean) {
      nightTarget = on ? 1 : 0;
    },
    /** Stop drawing (and simulating) while the map is hidden; the timetable keeps real time */
    setPaused(next: boolean) {
      paused = next;
    },
    setOnFrame(cb: ((info: FrameInfo) => void) | null) {
      onFrame = cb;
    },
    dispose() {
      renderer.setAnimationLoop(null);
      renderer.dispose();
      nightUniform.value = 0;
      // Workaround for a three r18x leak where the shared QuadMesh keeps the renderer alive
      // (https://github.com/wcandillon/react-native-webgpu/issues/445)
      const quad = new (THREE as unknown as { QuadMesh: new () => THREE.Mesh }).QuadMesh();
      const g = quad.geometry as THREE.BufferGeometry & { _listeners?: object };
      for (const t of [g, g.index, ...Object.values(g.attributes)] as { _listeners?: object }[]) {
        if (t && t._listeners) t._listeners = {};
      }
    },
  };
}

export type LiveScene = ReturnType<typeof createLiveScene>;
