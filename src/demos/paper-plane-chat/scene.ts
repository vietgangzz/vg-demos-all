import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';

import { buildPaper, PAGE_H } from '../paper-plane/paper';
import { cardTexture } from './card';

/**
 * The 3D layer over the chat: a transparent canvas where a sent message lifts off as a card of
 * paper, folds itself into a plane, loops once through the room (close enough to fill the screen
 * on the swoop) and leaves by the top; and where an answer flies in, lands where its bubble will
 * be and opens flat. One unit is 100 points, and the chat itself lies on z = 0: the paper floats
 * above it and throws a soft shadow onto it.
 */

export type Rect = { x: number; y: number; width: number; height: number };

export type ChatPlaneEvents = {
  /** The sent plane has left the screen */
  onDeparted: (id: number) => void;
  /** The answer has opened and settled into its bubble */
  onLanded: (id: number) => void;
  onHaptic: (kind: 'lift' | 'crease' | 'wing' | 'throw' | 'whoosh' | 'catch' | 'page') => void;
};

const { vec2, vec3, mix, smoothstep, length, dot, oneMinus, saturate, normalize, uv, pow } = TSL;

const FOV = 30;
const UNIT = 100;
const LIGHT = new THREE.Vector3(-0.45, 0.62, 0.65).normalize();

const ease = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};
const easeOut = (x: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);

type Job = {
  kind: 'send' | 'receive';
  id: number;
  rect: Rect;
  text: string;
  from: string;
  time: string;
  /** Card width in points */
  w: number;
  t: number;
  stage: 'lift' | 'fold' | 'aim' | 'fly' | 'arrive' | 'face' | 'unfold' | 'settle';
  lastStep: number;
};

export function createChatPlaneScene(
  context: GPUCanvasContext & { present: () => void },
  device: GPUDevice,
  events: ChatPlaneEvents
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

  const renderer = new THREE.WebGPURenderer({
    antialias: true,
    alpha: true,
    canvas: context.canvas as HTMLCanvasElement,
    context,
    device,
  });
  renderer.setPixelRatio(1);
  renderer.setSize(canvas.width, canvas.height, false);
  renderer.setClearColor(0x000000, 0);
  THREE.ColorManagement.enabled = false;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, width / height, 0.1, 200);
  const place = () => {
    // Far enough back that z = 0 shows exactly the screen, point for point
    camera.position.set(0, 0, height / UNIT / 2 / Math.tan(THREE.MathUtils.degToRad(FOV / 2)));
    camera.lookAt(0, 0, 0);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  place();

  /** A point on screen, in points, at depth z */
  const world = (x: number, y: number, z = 0, out = new THREE.Vector3()) =>
    out.set((x - width / 2) / UNIT, (height / 2 - y) / UNIT, z);

  // ---- The paper ----
  const folds = buildPaper();
  let texture = cardTexture('', '', '', 200);
  const map = TSL.texture(texture, uv());
  const mapBack = TSL.texture(texture, vec2(oneMinus(uv().x), uv().y));
  const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide, transparent: true });
  {
    const front = map.rgb;
    const back = mix(vec3(0.95, 0.93, 0.88), mapBack.rgb, 0.12);
    const albedo = TSL.select(TSL.frontFacing, front, back);
    const flat = TSL.normalFlat.transformDirection(TSL.cameraWorldMatrix);
    const toEye = normalize(TSL.cameraPosition.sub(TSL.positionWorld));
    const n = flat.mul(TSL.sign(dot(flat, toEye)));
    const ndl = dot(n, vec3(LIGHT.x, LIGHT.y, LIGHT.z));
    // A soft key from the top left: every facet of a fold catches it differently
    const light = vec3(0.62, 0.63, 0.68).add(vec3(0.48, 0.46, 0.42).mul(saturate(ndl)));
    material.colorNode = albedo.mul(light).add(vec3(0.06).mul(pow(oneMinus(saturate(dot(n, toEye))), 3)));
  }
  const opacity = TSL.uniform(1);
  material.opacityNode = opacity;
  const sheet = new THREE.Mesh(folds.geometry, material);
  sheet.position.set(0, -PAGE_H / 2, 0);
  sheet.frustumCulled = false;
  const plane = new THREE.Group();
  plane.add(sheet);
  plane.visible = false;
  scene.add(plane);

  // ---- Its shadow on the chat ----
  const shadowAmount = TSL.uniform(0);
  const shadowMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  shadowMat.colorNode = vec3(0.0, 0.01, 0.04);
  shadowMat.opacityNode = smoothstep(0.5, 0.0, length(uv().sub(0.5))).mul(shadowAmount);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), shadowMat);
  shadow.renderOrder = -1;
  scene.add(shadow);

  // ---- Paths, in screen fractions and depth ----
  const path = (pts: [number, number, number][], start?: THREE.Vector3, end?: THREE.Vector3) => {
    const v = pts.map(([x, y, z]) => world(x * width, y * height, z));
    if (start) v.unshift(start.clone());
    if (end) v.push(end.clone());
    return new THREE.CatmullRomCurve3(v, false, 'centripetal');
  };

  const holdQ = new THREE.Quaternion();
  const heroQ = new THREE.Quaternion();
  {
    const nose = new THREE.Vector3(0.62, 0.62, 0.48).normalize();
    const toward = new THREE.Vector3(0, 0.2, 1);
    const up = toward.addScaledVector(nose, -toward.dot(nose)).normalize();
    heroQ.setFromRotationMatrix(new THREE.Matrix4().makeBasis(up, nose, new THREE.Vector3().crossVectors(up, nose)));
  }
  const halfway = folds.startOf(4);
  const fromQ = new THREE.Quaternion();
  const fromP = new THREE.Vector3();
  const flightQ = new THREE.Quaternion();
  const tan = new THREE.Vector3();
  const tan2 = new THREE.Vector3();
  const upV = new THREE.Vector3();
  const across = new THREE.Vector3();
  const basis = new THREE.Matrix4();
  const rollQ = new THREE.Quaternion();
  const tmp = new THREE.Vector3();

  const attitude = (curve: THREE.CatmullRomCurve3, at: number, t: number, target: THREE.Quaternion) => {
    curve.getTangentAt(Math.min(0.999, at), tan);
    curve.getTangentAt(Math.min(0.999, at + 0.02), tan2);
    // "Up" for a plane flying around a screen is mostly out of the glass, toward you
    const ref = tmp.set(0, 0.35, 1).normalize();
    across.crossVectors(tan, ref).normalize();
    const turn = tan2.sub(tan).dot(across);
    upV.copy(ref).addScaledVector(tan, -tan.dot(ref)).normalize();
    across.crossVectors(upV, tan);
    basis.makeBasis(upV, tan, across);
    target.setFromRotationMatrix(basis);
    rollQ.setFromAxisAngle(tan, Math.max(-1, Math.min(1, -turn * 9)) + Math.sin(t * 6) * 0.05);
    target.premultiply(rollQ);
  };

  /** The card for a job, drawn when its job starts */
  const load = (text: string, from: string, time: string, w: number) => {
    const next = cardTexture(text, from, time, w, texture);
    if (next !== texture) {
      texture = next;
      map.value = texture;
      mapBack.value = texture;
    }
  };

  let job: Job | null = null;
  let curve: THREE.CatmullRomCurve3 | null = null;
  const queue: Job[] = [];
  /** Card size and where it sits for a job, in world units */
  const cardAt = (j: Job, out: THREE.Vector3) => {
    const cx = j.rect.x + j.rect.width / 2;
    const cy = j.rect.y + j.rect.height / 2 - j.w * 0.18;
    return world(cx, cy, 0.9, out);
  };
  const bubbleAt = (j: Job, out: THREE.Vector3) =>
    world(j.rect.x + j.rect.width / 2, j.rect.y + j.rect.height / 2, 0, out);

  const start = (j: Job) => {
    job = j;
    load(j.text, j.from, j.time, j.w);
    plane.visible = true;
    if (j.kind === 'send') {
      events.onHaptic('lift');
      cardAt(j, fromP);
      curve = path(
        [
          [0.56, 0.4, 1.2],
          [0.28, 0.24, 2.2],
          [0.16, 0.46, 3.4],
          [0.5, 0.64, 4.4],
          [0.84, 0.46, 2.6],
          [0.74, 0.16, 0.5],
          [0.5, -0.32, -9],
        ],
        fromP
      );
    } else {
      cardAt(j, fromP);
      curve = path(
        [
          [1.35, -0.25, -10],
          [0.9, 0.18, 1.6],
          [0.42, 0.3, 3.6],
          [0.18, 0.5, 2.2],
        ],
        undefined,
        fromP
      );
      folds.pose(folds.total);
      events.onHaptic('whoosh');
    }
  };

  /** Squash the card between bubble shape (k = 0) and a sheet (k = 1) */
  const morph = (j: Job, k: number) => {
    const w = j.w / UNIT;
    const bw = j.rect.width / UNIT;
    const bh = j.rect.height / UNIT;
    plane.scale.set(mix1(bw, w, k), mix1(bh / PAGE_H, w, k), w);
    const a = bubbleAt(j, tmp);
    const b = cardAt(j, new THREE.Vector3());
    plane.position.copy(a).lerp(b, k);
    plane.quaternion.identity();
  };
  const mix1 = (a: number, b: number, k: number) => a + (b - a) * k;

  let last = performance.now();
  const begin = last;
  let onFirstFrame: (() => void) | null = null;
  let warmed = false;
  const gaps: number[] = [];

  renderer.setAnimationLoop(() => {
    const now = performance.now();
    gaps.push(now - last);
    if (gaps.length > 240) gaps.shift();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const t = (now - begin) / 1000;

    if (canvas.clientWidth !== width || canvas.clientHeight !== height) {
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
      renderer.setSize(canvas.width, canvas.height, false);
      place();
    }

    if (!job && queue.length) start(queue.shift()!);
    if (job) {
      const j = job;
      j.t += dt;
      switch (j.stage) {
        case 'lift': {
          // The bubble lifts off the chat and opens out into a sheet of paper
          const k = ease(j.t / 0.55);
          folds.pose(0);
          morph(j, k);
          opacity.value = Math.min(1, j.t / 0.15);
          if (j.t >= 0.6) {
            j.stage = 'fold';
            j.t = 0;
            j.lastStep = -1;
          }
          break;
        }
        case 'fold': {
          const ft = j.t * 1.45;
          folds.pose(ft);
          const step = folds.stepAt(ft);
          if (step !== j.lastStep) {
            if (j.lastStep >= 0) events.onHaptic(j.lastStep >= 5 ? 'wing' : 'crease');
            j.lastStep = step;
          }
          plane.position.copy(cardAt(j, tmp));
          plane.quaternion.identity();
          plane.rotateY(Math.sin((Math.min(ft, halfway) / halfway) * Math.PI) * 0.35);
          const k = ease((ft - halfway) / (folds.total - halfway));
          if (k > 0) plane.quaternion.slerp(heroQ, k);
          if (ft >= folds.total + 0.3) {
            fromQ.copy(plane.quaternion);
            fromP.copy(plane.position);
            j.stage = 'aim';
            j.t = 0;
            events.onHaptic('wing');
          }
          break;
        }
        case 'aim': {
          const k = ease(j.t / 0.45);
          attitude(curve!, 0, t, flightQ);
          plane.quaternion.slerpQuaternions(fromQ, flightQ, k);
          plane.position.copy(fromP).add(tmp.set(0.1 * k, -0.25 * Math.sin(Math.PI * k), -0.4 * Math.sin(Math.PI * k)));
          if (j.t >= 0.45) {
            j.stage = 'fly';
            j.t = 0;
            events.onHaptic('throw');
          }
          break;
        }
        case 'fly': {
          const u = Math.min(1, j.t / 3.4);
          const at = u < 0.15 ? easeOut(u / 0.15) * 0.12 : 0.12 + ((u - 0.15) / 0.85) * 0.88;
          curve!.getPointAt(Math.min(1, at), plane.position);
          attitude(curve!, at, t, plane.quaternion);
          if (u > 0.42 && u - dt / 3.4 <= 0.42) events.onHaptic('whoosh');
          if (u >= 1) {
            plane.visible = false;
            events.onDeparted(j.id);
            job = null;
          }
          break;
        }
        case 'arrive': {
          const u = Math.min(1, j.t / 2.6);
          const at = ease(u * 0.85 + 0.15 * u * u);
          curve!.getPointAt(at, plane.position);
          attitude(curve!, at, t, plane.quaternion);
          opacity.value = 1;
          if (u >= 1) {
            events.onHaptic('catch');
            fromQ.copy(plane.quaternion);
            j.stage = 'face';
            j.t = 0;
          }
          break;
        }
        case 'face': {
          const k = ease(j.t / 0.45);
          plane.quaternion.slerpQuaternions(fromQ, holdQ, k);
          plane.position.copy(cardAt(j, tmp));
          if (j.t >= 0.5) {
            j.stage = 'unfold';
            j.t = 0;
            j.lastStep = folds.stepAt(folds.total);
          }
          break;
        }
        case 'unfold': {
          const ft = folds.total - j.t * 1.7;
          folds.pose(Math.max(0, ft));
          const step = folds.stepAt(Math.max(0, ft));
          if (step !== j.lastStep) {
            events.onHaptic('crease');
            j.lastStep = step;
          }
          plane.position.copy(cardAt(j, tmp));
          plane.quaternion.identity();
          plane.rotateY(Math.sin((Math.max(0, ft) / folds.total) * Math.PI) * -0.3);
          if (ft <= 0) {
            events.onHaptic('page');
            j.stage = 'settle';
            j.t = 0;
          }
          break;
        }
        case 'settle': {
          // The sheet lies down into its bubble and hands over to it
          const k = ease(j.t / 0.5);
          folds.pose(0);
          morph(j, 1 - k);
          opacity.value = 1 - Math.max(0, (j.t - 0.3) / 0.25);
          if (j.t >= 0.55) {
            plane.visible = false;
            events.onLanded(j.id);
            job = null;
          }
          break;
        }
      }
      if (job && j.stage !== 'lift' && j.stage !== 'settle') {
        plane.scale.setScalar(j.w / UNIT);
        opacity.value = 1;
      }
    }

    // The shadow falls down and to the right, further and softer the higher the paper is
    if (plane.visible) {
      const z = Math.max(0, plane.position.z);
      const s = (job?.w ?? 200) / UNIT;
      shadow.position.set(plane.position.x + 0.12 + z * 0.06, plane.position.y - 0.22 - z * 0.08, -0.02);
      shadow.scale.set(s * (1.1 + z * 0.12), s * PAGE_H * 0.9 * (1 + z * 0.1), 1);
      shadowAmount.value = (0.32 / (1 + z * 0.35)) * opacity.value;
      shadow.visible = true;
    } else shadow.visible = false;

    if (!warmed) {
      warmed = true;
      plane.visible = true;
      renderer.render(scene, camera);
      plane.visible = false;
    }
    renderer.render(scene, camera);
    context.present();
    if (onFirstFrame) {
      const cb = onFirstFrame;
      onFirstFrame = null;
      cb();
    }
  });

  const cardWidth = (rect: Rect) => Math.min(186, Math.max(150, rect.width * 0.72));

  return {
    /** Send a message: its bubble (where it sits on screen, in points) lifts off and flies */
    send(id: number, rect: Rect, text: string, time: string) {
      queue.push({
        kind: 'send',
        id,
        rect,
        text,
        from: 'You',
        time,
        w: cardWidth(rect),
        t: 0,
        stage: 'lift',
        lastStep: -1,
      });
    },
    /** An answer flies in and opens where its bubble will be */
    receive(id: number, rect: Rect, text: string, from: string, time: string) {
      queue.push({
        kind: 'receive',
        id,
        rect,
        text,
        from,
        time,
        w: cardWidth(rect),
        t: 0,
        stage: 'arrive',
        lastStep: -1,
      });
    },
    onFirstFrame(cb: () => void) {
      onFirstFrame = cb;
    },
    stats() {
      const total = gaps.reduce((a, b) => a + b, 0);
      return {
        fps: Math.round((gaps.length * 1000) / Math.max(1, total)),
        worstMs: Math.round(Math.max(0, ...gaps)),
      };
    },
    dispose() {
      renderer.setAnimationLoop(null);
      renderer.dispose();
    },
  };
}

export type ChatPlaneScene = ReturnType<typeof createChatPlaneScene>;
