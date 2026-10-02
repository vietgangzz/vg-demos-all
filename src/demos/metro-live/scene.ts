import * as THREE from 'three/webgpu';

import { LINE_1 } from '@/demos/metro/line-1';

import { createLineModel, createTimetable, type TrainState } from './line-model';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

import { createXrayMaterial, nightUniform } from './shaders';
import { buildCity } from './world/city';
import { buildEnvironment } from './world/environment';
import { ribbonGeometry } from './world/geometry';
import { FORWARD, RIGHT } from './world/layout';
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
  let night = 0;

  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();
  const tmp3 = new THREE.Vector3();
  const projected = new THREE.Vector3();
  const desired = new THREE.Vector3();

  const placeTrain = (k: number, seconds: number) => {
    const s = timetable.stateAt(seconds, k);
    const train = trains[k];
    const underground = s.u < model.portalU - 3 / model.length;
    const moving = s.phase === 'move' ? Math.sin(Math.PI * s.progress) : 0;
    train.cars.forEach((car, c) => {
      const u = THREE.MathUtils.clamp(s.u - s.dir * c * (CAR_GAP / model.length), 0, 1);
      model.curve.getPointAt(u, tmp);
      model.curve.getTangentAt(u, tmp2);
      // Right-hand running on the double track
      const off = TRACK_OFFSET * s.dir;
      tmp.x += -tmp2.z * off;
      tmp.z += tmp2.x * off;
      tmp2.multiplyScalar(s.dir);
      car.position.set(tmp.x, tmp.y + (underground ? 0.02 : 0.38), tmp.z);
      car.lookAt(tmp.x + tmp2.x, car.position.y + tmp2.y, tmp.z + tmp2.z);
      // Lean into curves a little, proportional to speed
      model.curve.getTangentAt(Math.min(1, u + 6 / model.length), tmp3).multiplyScalar(s.dir);
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

  let onFrame: ((info: FrameInfo) => void) | null = null;
  let lastSeconds = 0;
  const busy = new Uint8Array(stationAnchors.length);

  // Paused while a full-height sheet covers the map: the JS thread then belongs to the UI
  let paused = false;
  renderer.setAnimationLoop(() => {
    if (paused) return;
    // Same clock as the status sheet, so the list and the 3D view agree
    const seconds = performance.now() / 1000;
    const dt = lastSeconds ? Math.min(0.05, seconds - lastSeconds) : 1 / 60;
    lastSeconds = seconds;

    const states = trains.map((_, k) => placeTrain(k, seconds));
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

    // Day / night
    night += (nightTarget - night) * damp(2.4, dt);
    nightUniform.value = night;
    clear.lerpColors(DAY.clear, NIGHT.clear, night);
    renderer.setClearColor(clear, 1);
    fog.color.copy(clear);
    hemi.color.lerpColors(DAY.sky, NIGHT.sky, night);
    hemi.groundColor.lerpColors(DAY.ground, NIGHT.ground, night);
    hemi.intensity = THREE.MathUtils.lerp(DAY.hemi, NIGHT.hemi, night);
    sun.color.lerpColors(DAY.sun, NIGHT.sun, night);
    sun.intensity = THREE.MathUtils.lerp(DAY.sunIntensity, NIGHT.sunIntensity, night);

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
      focus = { kind: 'free' };
      flight = null;
      target.x += dx;
      target.z += dz;
      idleSince = seconds;
    }
    let hop = 0;
    if (flight) {
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
    fog.near = distance * 0.95;
    fog.far = distance * 2.3;
    // Nothing past the fog is visible, so clip there: depth precision and fewer tiles to draw
    const far = distance * 2.6 + 60;
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
    const a = BASE_YAW + yaw + Math.sin(seconds * 0.11) * 0.035 * calm;
    cameraDir.set(Math.cos(pitch) * Math.cos(a), Math.sin(pitch), Math.cos(pitch) * Math.sin(a));
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

    sun.position.set(target.x - 24, 46, target.z + 18);
    sun.target.position.copy(target);

    renderer.render(scene, camera);
    context.present();

    if (onFrame) {
      // Fresh arrays every frame: objects handed to a shared value are frozen by Worklets
      const stationInfo: number[] = new Array(stationAnchors.length * 4);
      const trainInfo: number[] = new Array(TRAIN_COUNT * 3);
      busy.fill(0);
      for (const s of states) if (s.phase === 'dwell') busy[s.station] = 1;
      stationAnchors.forEach((anchor, i) => {
        projectInto(anchor);
        const { x, y, z } = projected;
        const dist = Math.hypot(anchor.x - target.x, anchor.z - target.z);
        const near = THREE.MathUtils.clamp(1 - (dist - 16 * zoom) / (12 * zoom), 0, 1);
        const onScreen = z < 1 && x > -40 && x < width + 40 && y > -20 && y < height + 20 ? 1 : 0;
        stationInfo[i * 4] = x;
        stationInfo[i * 4 + 1] = y;
        stationInfo[i * 4 + 2] = near * onScreen;
        stationInfo[i * 4 + 3] = busy[i];
      });
      trains.forEach((t, k) => {
        tmp.copy(t.cars[0].position);
        tmp.y += 1.1;
        projectInto(tmp);
        trainInfo[k * 3] = projected.x;
        trainInfo[k * 3 + 1] = projected.y;
        trainInfo[k * 3 + 2] = projected.z < 1 ? 1 : 0;
      });
      onFrame({ stations: stationInfo, trains: trainInfo });
    }
  });

  return {
    timetable,
    model,
    setFollow(k: number) {
      const seconds = performance.now() / 1000;
      focus = { kind: 'train', index: k };
      if (controls.zoom.get() > 1.6) controls.zoom.set(1);
      startFlight(seconds, flightHop(target, trains[k].cars[0].position));
    },
    focusStation(i: number) {
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
      const seconds = performance.now() / 1000;
      controls.yaw.set(0);
      controls.pitch.set(DEFAULT_PITCH);
      focus = { kind: 'point', point: OVERVIEW_TARGET.clone() };
      controls.zoom.set(OVERVIEW_ZOOM);
      startFlight(seconds, 0);
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
