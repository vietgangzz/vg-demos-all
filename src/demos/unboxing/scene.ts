import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import * as TSL from 'three/tsl';
import * as THREE from 'three/webgpu';

import type { ShippedOrder } from '../sticker-cart/order';
import { buildProduct, HERO_YAW, studioLights } from '../sticker-cart/products3d';
import { fragileTexture, labelTexture, sealTexture, sideTexture, tapeTexture } from './art';
import {
  BACKDROP,
  buildBillboards,
  buildBox,
  buildFloor,
  buildKnife,
  buildSeal,
  buildShaft,
  buildShreds,
  buildTissue,
  D,
  glow,
  H,
  ITEM,
  LID,
  lift,
  puff,
  slitTape,
  SLITS,
  TAPE,
  W,
  type Hinged,
} from './box';

/**
 * Your order arrives: a box drops onto the floor by the window. Run a finger along the tape and a
 * box cutter slits it, the halves curling apart; the flaps spring up a little, and you flick them
 * open, the short ones underneath following on their own. Peel the thank-you seal off the tissue
 * paper, sweep the tissue aside, and light comes up out of the box as what you ordered rises up
 * out of the shred, one thing after another, turning slowly so you see all of it.
 */

export type Phase = 'arriving' | 'sealed' | 'flaps' | 'seal' | 'tissue' | 'reveal' | 'done';
export type Haptic = 'thud' | 'zip' | 'tick' | 'snap' | 'flap' | 'flop' | 'peel' | 'rustle' | 'chime' | 'spin';

export type BoxEvents = {
  onPhase: (phase: Phase) => void;
  onHaptic: (kind: Haptic) => void;
  /** The `index`th thing out of the box, which is `product` */
  onItem?: (index: number, product: number) => void;
  /** A product brought up close to look at, or put back (null) */
  onFocus: (product: number | null) => void;
};

const { vec2, vec3, vec4, mix, smoothstep, length } = TSL;

const FOV = 40;
const DROP = 2.4;
/** How far in front of the camera a product hangs when it's brought up close */
const FOCUS_D = 3;
/** How far the blade's tip sits into the tape */
const BLADE_IN = 0.0;
/** Flap angles: lying shut, sprung up a little once the tape's cut, and flopped open outside */
const SHUT = 0;
const SPRUNG = 0.14;
const OPEN_OUTER = 3.62;
const OPEN_INNER = 3.5;
const OPEN_SHEET = 2.75;

type View = { fit: number; elevation: number; look: THREE.Vector3 };
/** Where the camera wants to be in each phase: how wide a view, how far above, looking at what */
const VIEWS: Record<Phase, View> = {
  arriving: { fit: 2.4, elevation: 0.92, look: new THREE.Vector3(0, 0.5, 0) },
  sealed: { fit: 2.0, elevation: 1.12, look: new THREE.Vector3(0, 0.78, 0.02) },
  flaps: { fit: 2.45, elevation: 1.0, look: new THREE.Vector3(0, 0.62, 0) },
  seal: { fit: 2.3, elevation: 1.08, look: new THREE.Vector3(0, 0.72, 0) },
  tissue: { fit: 2.7, elevation: 1.1, look: new THREE.Vector3(0, 0.7, 0) },
  reveal: { fit: 3.2, elevation: 0.42, look: new THREE.Vector3(0, 1.42, 0) },
  // Raised up the screen, clear of the delivery slip that comes up under it
  done: { fit: 3.2, elevation: 0.4, look: new THREE.Vector3(0, 0.84, 0) },
};

type Flap = {
  h: Hinged;
  angle: number;
  speed: number;
  target: number;
  open: number;
  outer: boolean;
  /** Which way a finger moves to open it, on screen */
  pull: 'up' | 'down' | 'left' | 'right';
  landed: boolean;
};

type Item = {
  group: THREE.Group;
  product: number;
  home: THREE.Vector3;
  homeQ: THREE.Quaternion;
  goal: THREE.Vector3;
  goalQ: THREE.Quaternion;
  /** When it starts to rise (scene time), and how far through the rise it is */
  at: number;
  rise: number;
  spin: number;
  spinSpeed: number;
  /** Its size in its seat */
  scale: number;
  /** 0 in its seat, 1 up close, linear; eased where it's used */
  focusT: number;
};

export function createUnboxingScene(
  context: GPUCanvasContext & { present: () => void },
  device: GPUDevice,
  order: ShippedOrder,
  events: BoxEvents
) {
  const canvas = context.canvas as unknown as {
    width: number;
    height: number;
    clientWidth: number;
    clientHeight: number;
  };
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;

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
  renderer.setClearColor(BACKDROP, 1);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, width / height, 0.1, 60);
  scene.add(camera);

  // ---- Things ----
  scene.add(buildFloor());
  const box = buildBox({
    side: sideTexture(),
    label: labelTexture(order.id, order.items.length),
    tape: tapeTexture(),
    fragile: fragileTexture(),
  });
  scene.add(box.root);
  box.root.add(buildShreds());
  const tissue = buildTissue(box.root);
  const seal = buildSeal(box.root, sealTexture());
  const shaft = buildShaft();
  box.root.add(shaft);
  const sparks = buildBillboards(36, 'spark');
  const dust = buildBillboards(14, 'dust');
  const knife = buildKnife();
  scene.add(sparks, dust, knife);

  // Behind a product brought up close: a studio sweep drawn over the rest of the scene, lighter
  // where it hangs, with a soft shadow under it. It rides with the camera.
  const scrimFade = TSL.uniform(0);
  const scrimMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  {
    const q = TSL.uv();
    const spot = smoothstep(0.8, 0.0, length(q.sub(vec2(0.5, 0.64)).mul(vec2(1.0, 0.7))));
    const under = smoothstep(0.2, 0.0, length(q.sub(vec2(0.5, 0.45)).mul(vec2(1.0, 5.0))));
    const sweep = mix(vec3(BACKDROP.r, BACKDROP.g, BACKDROP.b).mul(1.06), vec3(0.99, 0.975, 0.95), spot);
    scrimMat.colorNode = sweep.mul(TSL.oneMinus(under.mul(0.2)));
    scrimMat.opacityNode = scrimFade.mul(0.95);
  }
  const scrim = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), scrimMat);
  scrim.renderOrder = 10;
  scrim.frustumCulled = false;
  scrim.visible = false;
  camera.add(scrim);

  // Lit like the products in the shop; only they take light, the rest is shaded by hand
  scene.add(studioLights());
  // One of each thing; two of the same come out as one, and the list says ×2
  const products = [...new Set(order.items)].slice(0, 6);
  const n = products.length;
  // A few float in a row over the box; more ride round it on a slow carousel
  const ring = n >= 4;
  const items: Item[] = products.map((product, k) => {
    const group = new THREE.Group();
    const model = buildProduct(product);
    const scale = ITEM * (n >= 5 ? 0.86 : ring ? 0.92 : 1);
    model.scale.setScalar(scale);
    group.add(model);
    // Nestled in the shred, lying every which way
    const home = new THREE.Vector3(
      n > 1 ? -0.48 + (0.96 * k) / (n - 1) : 0,
      0.36 + (k % 2) * 0.03,
      (k % 2 ? 1 : -1) * 0.12 + (Math.random() - 0.5) * 0.08
    );
    const homeQ = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(
        -Math.PI / 2 + (Math.random() - 0.5) * 0.5,
        (Math.random() - 0.5) * 0.4,
        Math.random() * Math.PI * 2
      )
    );
    group.position.copy(home);
    group.quaternion.copy(homeQ);
    box.root.add(group);
    // Up in a gentle arc above the box, each turned to face you
    const spread = Math.min(0.92, 2.7 / Math.max(1, n));
    const offset = k - (n - 1) / 2;
    const goal = new THREE.Vector3(offset * spread, LID + 1.0 + Math.cos(offset * 0.5) * 0.1, 0.42);
    return {
      group,
      product,
      home,
      homeQ,
      goal,
      goalQ: new THREE.Quaternion(),
      at: -1,
      rise: 0,
      spin: 0,
      spinSpeed: 0,
      scale,
      focusT: 0,
    };
  });

  const flaps: Flap[] = [
    { h: box.flaps.back, angle: 0, speed: 0, target: SHUT, open: OPEN_OUTER, outer: true, pull: 'up', landed: false },
    {
      h: box.flaps.front,
      angle: 0,
      speed: 0,
      target: SHUT,
      open: OPEN_OUTER,
      outer: true,
      pull: 'down',
      landed: false,
    },
    {
      h: box.flaps.left,
      angle: 0,
      speed: 0,
      target: SHUT,
      open: OPEN_INNER,
      outer: false,
      pull: 'left',
      landed: false,
    },
    {
      h: box.flaps.right,
      angle: 0,
      speed: 0,
      target: SHUT,
      open: OPEN_INNER,
      outer: false,
      pull: 'right',
      landed: false,
    },
  ];
  const sheets = tissue.map((s) => ({ s, angle: 0, speed: 0, target: 0 }));

  // ---- Post: a soft bloom for the light from the box, a warm grade, a vignette, grain ----
  const post = new THREE.RenderPipeline(renderer);
  const scenePass = TSL.pass(scene, camera);
  const color = scenePass.getTextureNode('output');
  const lit = color.rgb.add(bloom(color, 0.22, 0.35, 1.02).rgb);
  const s = TSL.screenUV;
  const vignette = smoothstep(1.0, 0.3, length(s.sub(0.5).mul(vec2(1.0, 1.25))));
  const l = TSL.luminance(lit);
  const graded = mix(vec3(l), lit, 1.02).mul(vec3(1.01, 1.0, 0.98));
  const grain = TSL.hash(
    TSL.screenCoordinate.x.add(TSL.screenCoordinate.y.mul(4099)).add(TSL.floor(TSL.time.mul(24)).mul(7919))
  )
    .sub(0.5)
    .mul(0.012);
  post.outputNode = vec4(graded.mul(mix(0.9, 1, vignette)).add(grain), 1);

  // ---- State ----
  let phase: Phase = 'arriving';
  let phaseT = 0;
  let clock = 0;
  const setPhase = (p: Phase) => {
    phase = p;
    phaseT = 0;
    events.onPhase(p);
  };

  // The drop
  let height_ = DROP;
  let fall = 0;
  let bounces = 0;
  let squash = 0;
  let squashSpeed = 0;
  let shake = 0;
  const dustAt: THREE.Vector3[] = Array.from({ length: 14 }, () => new THREE.Vector3());

  // The tape: which columns have been cut, and how far each has come apart
  const cut = new Float32Array(SLITS + 1);
  const open = new Float32Array(SLITS + 1);
  /** Where across the tape the blade went through each column */
  const cutZ = new Float32Array(SLITS + 1);
  let lastZ = 0;
  let cutting = false;
  let lastX = 0;
  let lastTick = 0;
  let tapeMoving = false;
  const knifeGoal = new THREE.Vector3();
  let knifeDir = 1;
  let knifeTurn = Math.PI;
  /** When the cutter was put down, lifting away; -1 while it's in use */
  let knifeGone = -1;

  // Flaps, seal, tissue
  let dragFlap: Flap | null = null;
  /** The product a finger's turning, once they're out */
  let spinning: Item | null = null;
  /** The carousel's turn, and a finger's push on it */
  let ringAngle = 0;
  let ringSpeed = 0;
  let ringHeld = false;
  /** The product brought up close, how it's turned there, and whether a finger has it */
  let focused: Item | null = null;
  let focusYaw = 0;
  let focusPitch = 0;
  let focusSpeed = 0;
  let focusHeld = false;
  /** What the finger came down on */
  let pressed: Item | null = null;
  let dragSheet: (typeof sheets)[number] | null = null;
  let drag = { x0: 0, y0: 0, a0: 0, t0: 0, x: 0, y: 0, lastY: 0, lastX: 0, vx: 0, vy: 0 };
  let innerDue = -1;
  let peel = -1;
  const sealFly = { on: false, v: new THREE.Vector3(), spin: 0 };
  let revealAt = -1;
  let glowLevel = 0;

  const eye = new THREE.Vector3();
  const look = new THREE.Vector3().copy(VIEWS.arriving.look);
  const eyeGoal = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const dummy = new THREE.Object3D();
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const mat = new THREE.Matrix4();
  const scl = new THREE.Vector3();
  const tiltNow = new THREE.Vector2();
  const focusAt = new THREE.Vector3();
  const focusQ = new THREE.Quaternion();
  const tiltGoal = new THREE.Vector2();

  /** Where the camera sits for a view: far enough back that `fit` metres fill the width */
  const place = (v: View, into: THREE.Vector3) => {
    const half = Math.atan(Math.tan(((FOV / 2) * Math.PI) / 180) * (width / height));
    const dist = v.fit / 2 / Math.tan(half);
    return into.set(0, Math.sin(v.elevation) * dist, Math.cos(v.elevation) * dist).add(v.look);
  };
  place(VIEWS.arriving, eye);

  const aim = (x: number, y: number) => {
    ndc.set((x / width) * 2 - 1, -(y / height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
  };
  /** Where the finger's ray meets the level y = `at` */
  const onLevel = (at: number) => {
    const d = ray.ray.direction;
    if (Math.abs(d.y) < 1e-4) return null;
    const t = (at - ray.ray.origin.y) / d.y;
    return t > 0 ? tmp.copy(ray.ray.origin).addScaledVector(d, t) : null;
  };

  const reset = () => {
    height_ = DROP;
    fall = 0;
    bounces = 0;
    squash = 0;
    squashSpeed = 0;
    cut.fill(0);
    open.fill(0);
    cutZ.fill(0);
    box.tape.forEach((h) => slitTape(h, cutZ, open, null));
    flaps.forEach((f) => {
      f.angle = 0;
      f.speed = 0;
      f.target = SHUT;
      f.landed = false;
      f.h.hinge.rotation.x = 0;
    });
    sheets.forEach((sh) => {
      sh.angle = 0;
      sh.speed = 0;
      sh.target = 0;
      sh.s.pose(0);
    });
    peel = -1;
    seal.peel(0);
    seal.group.visible = true;
    seal.group.position.set(0, H - 0.035 + 0.02, 0);
    seal.group.rotation.set(0, 0, 0);
    sealFly.on = false;
    spinning = null;
    ringAngle = 0;
    ringSpeed = 0;
    ringHeld = false;
    focused = null;
    focusHeld = false;
    pressed = null;
    scrimFade.value = 0;
    scrim.visible = false;
    items.forEach((it) => {
      it.at = -1;
      it.focusT = 0;
      it.group.scale.setScalar(1);
      it.rise = 0;
      it.spin = 0;
      it.spinSpeed = 0;
      it.group.position.copy(it.home);
      it.group.quaternion.copy(it.homeQ);
    });
    innerDue = -1;
    revealAt = -1;
    glowLevel = 0;
    glow.value = 0;
    knife.visible = false;
    knifeGone = -1;
    setPhase('arriving');
  };

  // ---- Touch ----

  /** Done with the cutter: it lifts off the box and away */
  const putDown = () => {
    cutting = false;
    knifeGone = clock;
  };

  const finishCut = () => {
    cut.fill(1);
    putDown();
    events.onHaptic('snap');
    // What's packed inside pushes the flaps up a little
    flaps.forEach((f) => {
      if (f.outer) {
        f.target = SPRUNG;
        f.speed = 2.4;
      }
    });
    setPhase('flaps');
  };

  /** The blade's moved from where it was to (x, z): every column it crossed is cut where it crossed */
  const cutTo = (x: number, z: number) => {
    const a = Math.min(lastX, x);
    const b = Math.max(lastX, x);
    let fresh = 0;
    for (let c = 0; c <= SLITS; c++) {
      const cx = -(W / 2 + 0.006) + ((W + 0.012) * c) / SLITS;
      if (cx >= a - 0.004 && cx <= b + 0.004 && !cut[c]) {
        const t = b - a < 1e-5 ? 1 : (cx - lastX) / (x - lastX);
        cutZ[c] = lastZ + (z - lastZ) * Math.max(0, Math.min(1, t));
        cut[c] = 1;
        fresh++;
      }
    }
    lastZ = z;
    if (fresh && clock - lastTick > 0.03) {
      lastTick = clock;
      events.onHaptic('tick');
    }
    if (x !== lastX) knifeDir = x > lastX ? 1 : -1;
    lastX = x;
    let done = 0;
    for (let c = 0; c <= SLITS; c++) done += cut[c];
    if (done / (SLITS + 1) > 0.94) finishCut();
  };

  /** The flap a finger is on, or failing that the one on its side of the box */
  const flapAt = () => {
    const outerOpen = flaps[0].angle > 2.0 && flaps[1].angle > 2.0;
    const allowed = flaps.filter((f) => (f.outer ? f.target !== f.open : outerOpen && f.target !== f.open));
    const hits = ray.intersectObjects(
      allowed.map((f) => f.h.mesh),
      false
    );
    if (hits.length) return allowed.find((f) => f.h.mesh === hits[0].object) ?? null;
    const p = onLevel(LID);
    if (!p || Math.abs(p.x) > W / 2 + 0.6 || Math.abs(p.z) > D / 2 + 0.6) return null;
    if (!outerOpen) return allowed.find((f) => (p.z < 0 ? f.pull === 'up' : f.pull === 'down')) ?? allowed[0] ?? null;
    return allowed.find((f) => (p.x < 0 ? f.pull === 'left' : f.pull === 'right')) ?? allowed[0] ?? null;
  };

  /** How far a finger's moved, in the direction that opens `pull`, as an angle */
  const pulled = (pull: Flap['pull'], dx: number, dy: number) => {
    const k = 5.2;
    if (pull === 'up') return (-dy / height) * k * 1.6;
    if (pull === 'down') return (dy / height) * k * 1.6;
    if (pull === 'left') return (-dx / width) * k;
    return (dx / width) * k;
  };

  const flingFlap = (f: Flap) => {
    f.target = f.open;
    f.speed = Math.max(f.speed, 5);
    events.onHaptic('flap');
  };

  const nextSheet = () => {
    // The one folded over last comes off first
    if (sheets[1].target === 0) return sheets[1];
    if (sheets[0].target === 0) return sheets[0];
    return null;
  };

  /** Brings a product up close to look at (null puts it back), turned the way it was in its seat */
  const focusOn = (product: number | null) => {
    const it = product === null ? null : (items.find((i) => i.product === product && i.rise > 0.9) ?? null);
    if (it === focused) return;
    if (it) {
      const k = items.indexOf(it);
      const seat = ring ? ringAngle + (k / n) * Math.PI * 2 : k * 0.4 + it.spin;
      focusYaw = Math.atan2(Math.sin(seat), Math.cos(seat));
      focusPitch = 0;
      focusSpeed = 0;
      events.onHaptic('snap');
    }
    focused = it;
    focusHeld = false;
    events.onFocus(it ? it.product : null);
  };

  /** The product drawn nearest a point on screen, if the point's within its reach: a finger near
   * a thing on the turning carousel should get it, not just one landing right on it */
  const nearest = (x: number, y: number) => {
    let best: Item | undefined;
    let bestD = Infinity;
    for (const it of items) {
      if (it.at < 0) continue;
      it.group.getWorldPosition(tmp).project(camera);
      const d = Math.hypot(((tmp.x + 1) / 2) * width - x, ((1 - tmp.y) / 2) * height - y);
      if (d < bestD) {
        bestD = d;
        best = it;
      }
    }
    return bestD < width * 0.17 ? best : undefined;
  };

  /** Across the tape, kept a little inside its edges so a cut never runs off it */
  const onTape = (z: number) => Math.max(-TAPE / 2 + 0.014, Math.min(TAPE / 2 - 0.014, z));

  const touch = (kind: 'start' | 'move' | 'end', x: number, y: number) => {
    aim(x, y);
    if (kind === 'start') {
      drag = { x0: x, y0: y, a0: 0, t0: clock, x, y, lastX: x, lastY: y, vx: 0, vy: 0 };
      if (phase === 'sealed') {
        const p = onLevel(LID);
        if (p && Math.abs(p.z) < 0.34 && Math.abs(p.x) < W / 2 + 0.25) {
          cutting = true;
          lastX = Math.max(-W / 2 - 0.006, Math.min(W / 2 + 0.006, p.x));
          lastZ = onTape(p.z);
          knifeGoal.set(lastX, LID + BLADE_IN, lastZ);
          // Comes down onto the tape from just above
          knife.position.copy(knifeGoal).add(new THREE.Vector3(0, 0.18, 0));
          knife.visible = true;
          knifeGone = -1;
          events.onHaptic('zip');
        }
      } else if (phase === 'flaps') {
        dragFlap = flapAt();
        if (dragFlap) drag.a0 = dragFlap.angle;
      } else if (phase === 'seal') {
        const hit = ray.intersectObject(seal.mesh, false).length > 0;
        const p = onLevel(H);
        if (hit || (p && Math.abs(p.x) < 0.6 && Math.abs(p.z) < 0.45)) {
          peel = 0;
          events.onHaptic('peel');
        }
      } else if (phase === 'tissue') {
        dragSheet = nextSheet();
        if (dragSheet) {
          drag.a0 = dragSheet.angle;
          events.onHaptic('rustle');
        }
      } else if (phase === 'reveal' || phase === 'done') {
        const hit = ray.intersectObjects(
          items.map((it) => it.group),
          true
        )[0];
        let o: THREE.Object3D | null = hit ? hit.object : null;
        while (o && !items.some((i) => i.group === o)) o = o.parent;
        const it = (o ? items.find((i) => i.group === o) : undefined) ?? nearest(x, y);
        pressed = it && it.at >= 0 ? it : null;
        if (focused) {
          // Up close, a finger turns it any way
          focusHeld = true;
          focusSpeed = 0;
        } else if (pressed && !ring) {
          spinning = pressed;
          pressed.spinSpeed = 0;
        } else if (ring && items.some((i) => i.at >= 0)) {
          ringHeld = true;
          ringSpeed = 0;
        }
      }
      return;
    }

    const dt = Math.max(1 / 120, clock - drag.t0);
    const dxStep = x - drag.lastX;
    const dyStep = y - drag.lastY;
    drag.vx = (x - drag.lastX) / Math.max(1 / 120, 1 / 60);
    drag.vy = (y - drag.lastY) / Math.max(1 / 120, 1 / 60);
    drag.lastX = x;
    drag.lastY = y;
    drag.x = x;
    drag.y = y;
    const dx = x - drag.x0;
    const dy = y - drag.y0;
    const tap = kind === 'end' && Math.hypot(dx, dy) < 10 && dt < 0.35;

    if (cutting) {
      const p = onLevel(LID);
      if (p) {
        const cx = Math.max(-W / 2 - 0.006, Math.min(W / 2 + 0.006, p.x));
        const cz = onTape(p.z);
        knifeGoal.set(cx, LID + BLADE_IN, cz);
        cutTo(cx, cz);
      }
      if (kind === 'end' && cutting) {
        let done = 0;
        for (let c = 0; c <= SLITS; c++) done += cut[c];
        if (done / (SLITS + 1) > 0.8) finishCut();
        else putDown();
      }
      return;
    }

    if (focusHeld) {
      if (kind === 'move') {
        focusYaw += (dxStep / width) * 6;
        focusPitch = Math.max(-0.7, Math.min(0.7, focusPitch + (dyStep / height) * 4));
      } else {
        focusHeld = false;
        focusSpeed = Math.max(-9, Math.min(9, (drag.vx / width) * 6));
        // A tap off it puts it back
        if (tap && pressed !== focused) focusOn(null);
      }
      return;
    }

    if (ringHeld) {
      // The carousel follows the finger round, and keeps going when it's let go; a tap on one of
      // them brings it up close
      if (kind === 'move') ringAngle += (dxStep / width) * 4.2;
      else {
        ringHeld = false;
        if (tap && pressed) focusOn(pressed.product);
        else ringSpeed = Math.max(-6, Math.min(6, (drag.vx / width) * 4.2));
      }
      return;
    }

    if (spinning) {
      // Turned under the finger, and let go with whatever spin it had; tapped, it comes up close
      if (kind === 'move') spinning.spin += (dxStep / width) * 5.5;
      else {
        if (tap) focusOn(spinning.product);
        else spinning.spinSpeed = (drag.vx / width) * 5.5;
        spinning = null;
      }
      return;
    }

    if (dragFlap) {
      const f = dragFlap;
      if (kind === 'move') {
        f.target = Math.max(0, Math.min(3.9, drag.a0 + pulled(f.pull, dx, dy)));
        f.angle += (f.target - f.angle) * 0.5;
        f.speed = 0;
      } else {
        const fling = pulled(f.pull, drag.vx * 0.12, drag.vy * 0.12);
        if (tap || f.angle > 1.25 || fling > 0.5) flingFlap(f);
        else f.target = f.outer ? SPRUNG : SHUT;
        dragFlap = null;
      }
      return;
    }

    if (dragSheet) {
      const sh = dragSheet;
      // The front sheet comes toward you, the back one goes away from you
      const toward = sh === sheets[1] ? dy : -dy;
      if (kind === 'move') {
        sh.target = Math.max(0, Math.min(3.0, drag.a0 + (toward / height) * 7));
        sh.angle += (sh.target - sh.angle) * 0.45;
        sh.speed = 0;
      } else {
        if (tap || sh.angle > 0.7 || toward * 0.2 > 0) {
          sh.target = OPEN_SHEET;
          sh.speed = Math.max(sh.speed, 4);
          events.onHaptic('rustle');
        } else sh.target = 0;
        dragSheet = null;
      }
    }
  };

  // ---- Frame ----

  let last = performance.now();
  let warmed = false;
  let failed = false;
  let onFirstFrame: (() => void) | null = null;

  const step = (dt: number) => {
    clock += dt;
    phaseT += dt;

    // The drop: falls, lands with a thump that squashes it, a little hop, and settles
    if (phase === 'arriving') {
      fall += 16 * dt;
      height_ -= fall * dt;
      if (height_ <= 0) {
        height_ = 0;
        if (bounces === 0) {
          events.onHaptic('thud');
          squashSpeed = 2.6;
          shake = 1;
          puff.value = 1;
          dustAt.forEach((d, i) => {
            const a = (i / dustAt.length) * Math.PI * 2;
            d.set(Math.cos(a) * (W / 2 + 0.05), 0.05 + Math.random() * 0.12, Math.sin(a) * (D / 2 + 0.05));
          });
        }
        if (bounces < 1 && fall > 2) {
          fall = -fall * 0.16;
          bounces++;
        } else fall = 0;
      }
      if (height_ === 0 && fall === 0 && phaseT > 1.6) setPhase('sealed');
    }
    squashSpeed += (-squash * 260 - squashSpeed * 13) * dt;
    squash += squashSpeed * dt;
    box.root.position.y = height_;
    box.root.scale.set(1 + squash * 0.5, 1 - squash, 1 + squash * 0.5);
    lift.value = height_;
    puff.value = Math.max(0, puff.value - dt * 0.8);
    shake = Math.max(0, shake - dt * 3);

    // The tape coming apart behind the blade
    let moving = false;
    for (let c = 0; c <= SLITS; c++) {
      const o = open[c] + (cut[c] - open[c]) * Math.min(1, dt * 6);
      if (Math.abs(o - open[c]) > 1e-4) moving = true;
      open[c] = o;
    }
    const pressing = knife.visible && knifeGone < 0;
    const press = pressing ? { x: knife.position.x, z: knife.position.z, depth: 0.004 } : null;
    if (moving || tapeMoving || pressing) box.tape.forEach((h) => slitTape(h, cutZ, open, press));
    tapeMoving = moving || pressing;

    // The cutter rides the finger, blade first, leaning into the cut
    if (knife.visible && knifeGone < 0) {
      knife.position.lerp(knifeGoal, Math.min(1, dt * 40));
      // Turned to cut the way it's going, handle trailing, a tremor in the hand while it drags
      knifeTurn += ((knifeDir > 0 ? Math.PI : 0) - knifeTurn) * Math.min(1, dt * 14);
      knife.rotation.set(0, knifeTurn, 0.5 + Math.sin(clock * 37) * 0.012);
    } else if (knife.visible) {
      const k = clock - knifeGone;
      knife.position.y += dt * (1.2 + k * 6);
      knife.position.x += dt * knifeDir * 0.6;
      knife.rotation.z -= dt * 2.4;
      if (k > 0.7) knife.visible = false;
    }

    // Flaps on their hinges: springy board, flopping over and bouncing where they land
    for (const f of flaps) {
      if (f !== dragFlap) {
        f.speed += ((f.target - f.angle) * 46 - f.speed * 6.5) * dt;
        f.angle += f.speed * dt;
        if (f.target === f.open && !f.landed && f.angle > f.open - 0.05 && f.speed > 0) {
          f.landed = true;
          events.onHaptic('flop');
        }
      }
      f.h.hinge.rotation.x = -f.angle;
    }
    if (phase === 'flaps') {
      const outerDone = flaps[0].target === flaps[0].open && flaps[1].target === flaps[1].open;
      if (outerDone && flaps[0].angle > 2.4 && flaps[1].angle > 2.4 && innerDue < 0) innerDue = clock + 0.25;
      // The short flaps underneath pop open by themselves, one then the other
      if (innerDue > 0 && clock > innerDue && flaps[2].target !== flaps[2].open) flingFlap(flaps[2]);
      if (innerDue > 0 && clock > innerDue + 0.22 && flaps[3].target !== flaps[3].open) flingFlap(flaps[3]);
      if (flaps[2].angle > 2.3 && flaps[3].angle > 2.3) setPhase('seal');
    }

    // The seal peels from its edge, then lets go and tumbles away
    if (peel >= 0 && !sealFly.on) {
      peel = Math.min(1, peel + dt * 2.4);
      seal.peel(peel);
      if (peel >= 1) {
        peel = -1;
        sealFly.on = true;
        sealFly.v.set(0.9, 2.6, 0.5);
        sealFly.spin = 7;
        setPhase('tissue');
      }
    }
    if (sealFly.on) {
      sealFly.v.y -= 7 * dt;
      seal.group.position.addScaledVector(sealFly.v, dt);
      seal.group.rotation.z += sealFly.spin * dt;
      seal.group.rotation.x += sealFly.spin * 0.6 * dt;
      if (seal.group.position.y < -1) {
        sealFly.on = false;
        seal.group.visible = false;
      }
    }

    // Tissue, folding back over the rims
    for (const sh of sheets) {
      if (sh !== dragSheet) {
        sh.speed += ((sh.target - sh.angle) * 30 - sh.speed * 6) * dt;
        sh.angle += sh.speed * dt;
      }
      if (Math.abs(sh.speed) > 1e-3 || sh === dragSheet) sh.s.pose(Math.max(0, sh.angle));
    }
    if (phase === 'tissue' && sheets[0].angle > 2.2 && sheets[1].angle > 2.2) {
      revealAt = clock + 0.15;
      setPhase('reveal');
    }

    // What's inside, rising up into the light
    if (phase === 'reveal' || phase === 'done') {
      glowLevel = Math.min(1, glowLevel + dt * 0.9);
      items.forEach((it, k) => {
        if (it.at < 0 && clock > revealAt + 0.35 + k * (ring ? 0.42 : 0.5)) {
          it.at = clock;
          // Turned to face where you'll be watching from
          if (!ring) {
            dummy.position.copy(it.goal);
            dummy.lookAt(place(VIEWS.reveal, tmp));
            it.goalQ.copy(dummy.quaternion);
          }
          events.onHaptic('chime');
          events.onItem?.(k, it.product);
        }
      });
      if (phase === 'reveal' && items.every((it) => it.rise > 0.97) && phaseT > 1) setPhase('done');
    } else glowLevel = Math.max(0, glowLevel - dt);
    glow.value = glowLevel;
    if (ring && items.some((it) => it.at >= 0)) {
      // Easing up to a slow turn, and back to it after a push
      const cruise = 0.3 * Math.min(1, (clock - revealAt) / 2.5);
      if (!ringHeld) {
        ringSpeed += (cruise - ringSpeed) * Math.min(1, dt * 1.4);
        ringAngle += ringSpeed * dt;
      }
    }
    items.forEach((it, k) => {
      if (it.at < 0) return;
      if (ring) {
        const t = Math.min(1, (clock - it.at) / 1.3);
        const e = 1 - Math.pow(1 - t, 3);
        it.rise = t;
        // Its seat on the carousel: round the box, the front one nearest you, facing out from the
        // middle so the turn shows you each of them all the way round
        const a = ringAngle + (k / n) * Math.PI * 2;
        it.goal.set(Math.sin(a) * 0.84, LID + 1.34 - Math.cos(a) * 0.1, 0.1 + Math.cos(a) * 0.5);
        it.group.position.lerpVectors(it.home, it.goal, e);
        it.group.position.y += Math.sin(t * Math.PI) * 0.3;
        // Tipped toward the camera a little, the way the shop shows them
        dummy.rotation.set(0.32 + tiltNow.y * 0.12, a + HERO_YAW + tiltNow.x * 0.35, 0, 'XYZ');
        it.goalQ.setFromEuler(dummy.rotation);
        it.group.quaternion.slerpQuaternions(it.homeQ, it.goalQ, Math.min(1, e * 1.15));
        return;
      }
      const t = Math.min(1, (clock - it.at) / 1.2);
      // Lifted out of the shred and up into its place, easing in
      const e = 1 - Math.pow(1 - t, 3);
      it.rise = t;
      it.group.position.lerpVectors(it.home, it.goal, e);
      it.group.position.y += Math.sin(t * Math.PI) * 0.22;
      it.group.quaternion.slerpQuaternions(it.homeQ, it.goalQ, Math.min(1, e * 1.2));
      // Then turning slowly, so you see it all the way round; a finger turns it faster, and tilting
      // the phone turns them all a little
      if (it !== spinning) {
        it.spinSpeed *= Math.exp(-dt * 1.6);
        it.spin += (it.spinSpeed + 0.35 * t) * dt;
      }
      it.group.rotateY((HERO_YAW + k * 0.4) * e + it.spin + tiltNow.x * 0.35 * t);
    });

    // Up close: flown out of its seat to hang in front of you, big, over a studio backdrop that
    // covers the rest; turning slowly by itself, or however a finger turns it
    if (focused && !focusHeld) {
      focusSpeed += (0.4 - focusSpeed) * Math.min(1, dt * 1.8);
      focusYaw += focusSpeed * dt;
      focusPitch += -focusPitch * Math.min(1, dt * 2.5);
    }
    const viewH = 2 * FOCUS_D * Math.tan((FOV / 2) * (Math.PI / 180));
    const viewW = viewH * camera.aspect;
    let scrimTo = 0;
    for (const it of items) {
      if (it.at < 0) continue;
      it.focusT = Math.max(0, Math.min(1, it.focusT + (it === focused ? dt : -dt) / 0.6));
      const f = it.focusT;
      const e = f < 0.5 ? 4 * f * f * f : 1 - Math.pow(-2 * f + 2, 3) / 2;
      if (e <= 0) {
        it.group.scale.setScalar(1);
        continue;
      }
      scrimTo = Math.max(scrimTo, e);
      // A little above the middle of the screen, clear of the sheet below
      focusAt
        .set(0, viewH * 0.14, -FOCUS_D)
        .applyQuaternion(camera.quaternion)
        .add(camera.position);
      box.root.worldToLocal(focusAt);
      focusAt.y += Math.sin(e * Math.PI) * 0.12;
      it.group.position.lerp(focusAt, e);
      dummy.rotation.set(0.24 + focusPitch, HERO_YAW + focusYaw, 0, 'XYZ');
      focusQ.copy(camera.quaternion).multiply(dummy.quaternion);
      it.group.quaternion.slerp(focusQ, e);
      const big = Math.min(viewW * 0.62, viewH * 0.34) / it.scale;
      it.group.scale.setScalar(1 + (big - 1) * e);
    }
    scrimFade.value = scrimTo;
    scrim.visible = scrimTo > 0.001;
    if (scrim.visible) {
      const d = FOCUS_D + 1;
      const h = 2 * d * Math.tan((FOV / 2) * (Math.PI / 180)) * 1.1;
      scrim.position.set(0, 0, -d);
      scrim.scale.set(h * camera.aspect, h, 1);
    }

    // Sparkles drifting up out of the open box
    if (glowLevel > 0) {
      for (let i = 0; i < 36; i++) {
        const ph = (i * 0.618) % 1;
        const up = (clock * 0.22 + ph) % 1;
        const a = i * 2.4 + clock * 0.3;
        const r = 0.25 + ((i * 0.37) % 1) * 0.7;
        tmp.set(Math.cos(a) * r, H + up * 1.7, Math.sin(a) * r * 0.65);
        const twinkle = Math.max(0, Math.sin(clock * 5 + i * 1.7)) * (1 - up);
        scl.setScalar(0.03 + twinkle * 0.07);
        mat.compose(tmp, camera.quaternion, scl);
        sparks.setMatrixAt(i, mat);
      }
      sparks.instanceMatrix.needsUpdate = true;
    }
    sparks.visible = glowLevel > 0.01;

    // Dust from the landing, rolling out and settling
    if (puff.value > 0) {
      const age = 1 - puff.value;
      dustAt.forEach((d, i) => {
        tmp.set(d.x * (1 + age * 0.5), d.y + age * 0.12, d.z * (1 + age * 0.5));
        scl.setScalar(0.25 + age * 0.6 + (i % 3) * 0.06);
        mat.compose(tmp, camera.quaternion, scl);
        dust.setMatrixAt(i, mat);
      });
      dust.instanceMatrix.needsUpdate = true;
    }
    dust.visible = puff.value > 0.01;

    // The camera eases to each phase's view; the landing shakes it
    const k = 1 - Math.exp(-dt * 2.4);
    place(VIEWS[phase], eyeGoal);
    eye.lerp(eyeGoal, k);
    look.lerp(VIEWS[phase].look, k);
    camera.position.copy(eye);
    if (shake > 0)
      camera.position.add(tmp.set(Math.sin(clock * 61) * 0.03 * shake, Math.sin(clock * 47) * 0.04 * shake, 0));
    camera.lookAt(look);

    tiltNow.lerp(tiltGoal, Math.min(1, dt * 6));
  };

  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    try {
      step(dt);
    } catch (e) {
      // Errors in the frame loop are otherwise swallowed
      if (__DEV__ && !failed) console.error('[unboxing]', e);
      failed = true;
    }
    if (!warmed) {
      // Compile everything that turns up later now, not mid-reveal
      warmed = true;
      sparks.visible = true;
      dust.visible = true;
      knife.visible = true;
      post.render();
      knife.visible = false;
    }
    post.render();
    context.present();
    if (onFirstFrame) {
      const cb = onFirstFrame;
      onFirstFrame = null;
      cb();
    }
  });

  setPhase('arriving');

  return {
    touch,
    focusOn,
    /** Dev: where things are */
    debug() {
      return {
        phase,
        clock: Math.round(clock * 100) / 100,
        revealAt,
        phaseT,
        failed,
        focused: focused ? focused.product : null,
        items: items.map((it) => ({ at: Math.round(it.at * 100) / 100, rise: Math.round(it.rise * 100) / 100 })),
        sheets: sheets.map((sh) => Math.round(sh.angle * 100) / 100),
      };
    },
    /** The phone's tilt from gravity, roughly -1..1 each way */
    setTilt(x: number, y: number) {
      tiltGoal.set(x, y);
    },
    /** Dev: skip straight to a stage, everything before it already done */
    peek(stage: 'flaps' | 'seal' | 'tissue' | 'reveal') {
      height_ = 0;
      fall = 0;
      cut.fill(1);
      open.fill(1);
      cutZ.fill(0);
      box.tape.forEach((h) => slitTape(h, cutZ, open, null));
      if (stage === 'flaps') {
        flaps.forEach((f) => f.outer && (f.target = SPRUNG));
        setPhase('flaps');
        return;
      }
      flaps.forEach((f) => {
        f.angle = f.target = f.open;
        f.landed = true;
      });
      if (stage === 'seal') return setPhase('seal');
      seal.group.visible = false;
      if (stage === 'tissue') return setPhase('tissue');
      sheets.forEach((sh) => {
        sh.angle = sh.target = OPEN_SHEET;
        sh.s.pose(OPEN_SHEET);
      });
      revealAt = clock + 0.15;
      setPhase('reveal');
    },
    /** Another box */
    again() {
      reset();
    },
    onFirstFrame(cb: () => void) {
      onFirstFrame = cb;
    },
    dispose() {
      renderer.setAnimationLoop(null);
      post.dispose();
      renderer.dispose();
    },
  };
}

export type UnboxingScene = ReturnType<typeof createUnboxingScene>;
