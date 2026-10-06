import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

import { handTypeface, noteTexture, type Page } from './note';
import { buildPaper, PAGE_H } from './paper';
import { buildSapa, SAPA_SUN, sapaSkyMesh, swallowsMesh } from './sapa';
import {
  egretsMesh,
  fieldMesh,
  kiteGroup,
  kiteSway,
  motesMesh,
  reedsMesh,
  riceMesh,
  skyMesh,
  SUN,
  treelineMesh,
} from './world';

/**
 * You're at the edge of the rice field at sunset with a page from your notebook. Write on it and
 * send it: it folds into a plane crease by crease, you throw it, and your eyes go with it, low over
 * the rice, then up into the clouds. Out the other side it's morning in the mountains: the rice
 * terraces of Sa Pa below, mist in the valley. The plane glides down to a terrace, skids to a stop
 * and opens, and someone writes back on it, under your note. Fly back through the clouds to write
 * another.
 */

export type Phase =
  | 'writing'
  | 'folding'
  | 'aiming'
  | 'flying'
  | 'clouds'
  | 'descending'
  | 'landing'
  | 'unfolding'
  | 'arrived'
  | 'replying'
  | 'resting'
  | 'leaving';

export type Haptic = 'crease' | 'wing' | 'throw' | 'land' | 'page' | 'scratch' | 'cloud';

export type PlaneEvents = {
  onPhase: (phase: Phase) => void;
  onHaptic: (kind: Haptic) => void;
};

const { float, vec2, vec3, vec4, mix, smoothstep, length, dot, oneMinus, saturate, normalize, uv, pow, sin } = TSL;
type V3 = THREE.Node<'vec3'>;

const FOV = 46;
/** Where the page is held: in front, a little below eye level */
const HOLD = new THREE.Vector3(0, -0.5, -4.1);
const HOLD_TILT = -0.16;
const REPLIES = [
  'It flew all the way up here?? Come visit — the rice is so green this year.',
  'Got it on our terrace. Grandma says come for New Year.',
  'Caught it by the water. Write again soon!',
];
const FRIEND = '— Mỷ, Sa Pa';

const ease = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};

/** Light on the paper, set for whichever world it's in */
const light = {
  sun: TSL.uniform(new THREE.Vector3().copy(SUN)),
  sky: TSL.uniform(new THREE.Color(0.46, 0.42, 0.52)),
  skyUp: TSL.uniform(new THREE.Color(0.86, 0.7, 0.58)),
  key: TSL.uniform(new THREE.Color(1.0, 0.8, 0.55)),
  through: TSL.uniform(new THREE.Color(1.0, 0.7, 0.44)),
};

function paperMaterial(map: THREE.Texture) {
  const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  const v = uv();
  const front = TSL.texture(map, v).rgb;
  // From behind you see the sheet's own colour, the ink and rules faint through it
  const back = mix(vec3(0.95, 0.91, 0.82), TSL.texture(map, vec2(oneMinus(v.x), v.y)).rgb, 0.24);
  const albedo = TSL.select(TSL.frontFacing, front, back);
  // Each flat facet lit on its own, so every fold reads
  const flat = TSL.normalFlat.transformDirection(TSL.cameraWorldMatrix);
  const toEye = normalize(TSL.cameraPosition.sub(TSL.positionWorld));
  const n = flat.mul(TSL.sign(dot(flat, toEye)));
  const ndl = dot(n, light.sun as unknown as V3);
  const sky = mix(light.sky as unknown as V3, light.skyUp as unknown as V3, n.y.mul(0.5).add(0.5)).mul(0.62);
  const key = (light.key as unknown as V3).mul(saturate(ndl)).mul(0.5);
  const through = (light.through as unknown as V3).mul(saturate(ndl.negate())).mul(0.3);
  const edge = pow(oneMinus(saturate(dot(n, toEye))), 3).mul(0.12);
  material.colorNode = albedo.mul(sky.add(key).add(through)).add((light.key as unknown as V3).mul(edge));
  return material;
}

export function createPaperPlaneScene(
  context: GPUCanvasContext & { present: () => void },
  device: GPUDevice,
  events: PlaneEvents
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
  const camera = new THREE.PerspectiveCamera(FOV, width / height, 0.05, 4000);
  scene.add(camera);

  // ---- Two places ----
  const field = new THREE.Group();
  const fieldSky = skyMesh();
  const kite = kiteGroup();
  field.add(fieldSky, fieldMesh(), treelineMesh(), riceMesh(), reedsMesh(), egretsMesh(), kite, motesMesh());
  const sapa = buildSapa();
  const mountains = new THREE.Group();
  const sapaSky = sapaSkyMesh();
  mountains.add(sapaSky, sapa.group, swallowsMesh());
  mountains.visible = false;
  scene.add(field, mountains);
  let place: 'field' | 'mountains' = 'field';
  // Where it lands, where you watch from, and what you look at: down the terraces and across
  const LAND = sapa.landing.clone();
  const SPOT = LAND.clone().add(new THREE.Vector3(0, 0.03, 0));
  // Crouched on the same terrace, just behind the page, looking out over the edge
  const EYE = LAND.clone().add(new THREE.Vector3(0.05, 1.5, 3.4));
  EYE.y = Math.max(EYE.y, sapa.heightAt(EYE.x, EYE.z) + 1.2);
  const VIEW = EYE.clone().add(new THREE.Vector3(0, -1.76, -10));

  // ---- The page ----
  const folds = buildPaper();
  let page: Page = { text: '' };
  let texture = noteTexture(null, page);
  const sheet = new THREE.Mesh(folds.geometry, paperMaterial(texture));
  sheet.position.set(-0.03, -PAGE_H * 0.44, 0);
  sheet.frustumCulled = false;
  const plane = new THREE.Group();
  plane.add(sheet);
  scene.add(plane);
  // A soft shadow under the page when it lies on the ground
  const shadowMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  const shadowOn = TSL.uniform(0);
  shadowMat.colorNode = vec3(0.1, 0.16, 0.06);
  shadowMat.opacityNode = smoothstep(0.5, 0.15, length(uv().sub(0.5)))
    .mul(0.45)
    .mul(shadowOn);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.9).rotateX(-Math.PI / 2), shadowMat);
  shadow.position.copy(LAND).add(new THREE.Vector3(0.12, 0.012, 0.1));
  shadow.renderOrder = 2;
  mountains.add(shadow);

  let typeface: Awaited<ReturnType<typeof handTypeface>> = null;
  let note = '';
  let replyIndex = 0;
  const draw = (next: Page) => {
    page = next;
    texture = noteTexture(typeface, page, texture);
  };
  handTypeface().then((face) => {
    typeface = face;
    draw(page);
  });
  let reply = '';

  // ---- Post: sun shafts and bloom, a cloud you fly through, a film look ----
  const post = new THREE.RenderPipeline(renderer);
  const scenePass = TSL.pass(scene, camera);
  const color = scenePass.getTextureNode('output');
  const colorTex = scenePass.getTexture('output');
  const s = TSL.screenUV;
  const sunUV = TSL.uniform(new THREE.Vector2(0.2, 0.4));
  const raysOn = TSL.uniform(1);
  const cloud = TSL.uniform(0);
  const morning = TSL.uniform(0);
  /** The cloud's colour on the way through: sunset pink going to morning white */
  const tint = TSL.uniform(0);
  const aspectU = TSL.uniform(width / height);
  // Light shafts: each pixel looks back toward the sun and adds up the bright sky it passes
  const shafts = TSL.Fn(() => {
    const at = vec2(s).toVar();
    const step = s
      .sub(sunUV)
      .mul(1 / 18)
      .mul(0.85);
    const sum = float(0).toVar();
    const weight = float(1).toVar();
    TSL.Loop(18, () => {
      at.subAssign(step);
      const lum = TSL.luminance(TSL.texture(colorTex, at).rgb);
      sum.addAssign(smoothstep(0.62, 0.95, lum).mul(weight));
      weight.mulAssign(0.93);
    });
    return sum.div(18);
  })();
  const rays = vec3(1.0, 0.4, 0.18).mul(shafts).mul(0.42).mul(raysOn);
  const lit = color.rgb.add(bloom(color, 0.3, 0.45, 0.94).rgb).add(rays);
  // Flying through a cloud: layers of it rushing out from the middle of the screen
  const c = s.sub(0.5).mul(vec2(aspectU, 1));
  const r = length(c);
  const dense = TSL.Fn(() => {
    const sum = float(0).toVar();
    for (let i = 0; i < 3; i++) {
      const k = i / 3;
      const z = TSL.fract(TSL.time.mul(0.45).add(k));
      const q = c
        .div(z.mul(2.2).add(0.25))
        .mul(2.2)
        .add(vec2(k * 7.3, k * 3.1));
      const n = TSL.mx_noise_float(vec3(q, k * 5))
        .mul(0.5)
        .add(0.5)
        .add(TSL.mx_noise_float(vec3(q.mul(2.4), k * 9)).mul(0.25));
      sum.addAssign(n.mul(sin(z.mul(Math.PI))));
    }
    return sum.div(1.6);
  })();
  const edge0 = oneMinus(cloud).mul(1.05);
  // Patches of cloud first, thickening until there's nothing but white for a moment
  const fog = saturate(
    smoothstep(edge0, edge0.add(0.5), dense.mul(0.9).add(cloud.mul(0.35))).add(smoothstep(0.93, 1.0, cloud))
  );
  const cloudColor = mix(vec3(1.0, 0.84, 0.76), vec3(0.98, 0.99, 1.0), tint)
    .mul(float(0.9).add(dense.mul(0.1)))
    .sub(r.mul(0.08));
  const misted = mix(lit, cloudColor, fog);
  // Film: warm and a little faded at sunset, clean and bright in the mountains
  const l = TSL.luminance(misted);
  const sunset = mix(vec3(l), misted, 0.86)
    .mul(vec3(1.04, 1.0, 0.9))
    .add(vec3(0.04, 0.026, 0.034).mul(oneMinus(l)));
  const bright = mix(vec3(l), misted, 1.14).mul(vec3(1.0, 1.01, 1.02));
  const graded = mix(sunset, bright, morning);
  const vignette = smoothstep(0.98, 0.35, length(s.sub(0.5).mul(vec2(1.0, 1.2))));
  const frame = TSL.floor(TSL.time.mul(24));
  const grain = TSL.hash(TSL.screenCoordinate.x.add(TSL.screenCoordinate.y.mul(4099)).add(frame.mul(7919)))
    .sub(0.5)
    .mul(mix(float(0.045), float(0.02), morning));
  post.outputNode = vec4(graded.mul(mix(mix(float(0.68), float(0.84), morning), float(1), vignette)).add(grain), 1);

  // ---- Flight paths ----
  const out = new THREE.CatmullRomCurve3(
    [
      // Low over the rice, an S, then up toward the clouds
      HOLD.clone(),
      new THREE.Vector3(0.3, 0.15, -8),
      new THREE.Vector3(2.2, 0.9, -18),
      new THREE.Vector3(-1.6, 1.6, -31),
      new THREE.Vector3(-2.6, 3.4, -46),
      new THREE.Vector3(0.4, 7.5, -63),
      new THREE.Vector3(2.4, 14, -80),
      new THREE.Vector3(1.0, 24, -96),
      new THREE.Vector3(0.0, 36, -110),
    ],
    false,
    'centripetal'
  );
  // Out of the cloud above the hill, a long glide down to the terrace, never closer than a little
  // above the ground
  const down = new THREE.CatmullRomCurve3(
    [
      new THREE.Vector3(9, 30, 52),
      new THREE.Vector3(6, 19, 26),
      new THREE.Vector3(1.8, 9, 6),
      new THREE.Vector3(-1.4, 2, -4),
      LAND.clone().add(new THREE.Vector3(-1.1, 1.4, 2.6)),
      LAND.clone().add(new THREE.Vector3(0, 0.25, 0.9)),
    ].map((v, i, all) => {
      if (i < all.length - 1) v.y = Math.max(v.y, sapa.heightAt(v.x, v.z) + (i === all.length - 2 ? 1.1 : 2.5));
      return v;
    }),
    false,
    'centripetal'
  );
  const FLY = 6.2;
  const DESCEND = 5.6;
  const CLOUDS_AT = 0.72;

  // ---- State ----
  let phase: Phase = 'writing';
  let phaseT = 0;
  let foldT = 0;
  let lastStep = -1;
  let lift = 0;
  let liftNow = 0;
  let shown = 0;
  let swapped = false;
  let frozen = -1;
  const holdQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(HOLD_TILT, 0, 0));
  /** Lying on the ground, its top toward the valley */
  const sandQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0.12, 0, 'YXZ'));
  const fromQ = new THREE.Quaternion();
  const fromP = new THREE.Vector3();
  const hold = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const tan = new THREE.Vector3();
  const tan2 = new THREE.Vector3();
  const upV = new THREE.Vector3();
  const across = new THREE.Vector3();
  const basis = new THREE.Matrix4();
  const flightQ = new THREE.Quaternion();
  const rollQ = new THREE.Quaternion();
  const heroQ = new THREE.Quaternion();
  {
    const nose = new THREE.Vector3(0.86, 0.32, -0.38).normalize();
    const toward = new THREE.Vector3(0, 0.6, 0.8);
    const up = toward.addScaledVector(nose, -toward.dot(nose)).normalize();
    heroQ.setFromRotationMatrix(new THREE.Matrix4().makeBasis(up, nose, new THREE.Vector3().crossVectors(up, nose)));
  }
  const halfway = folds.startOf(4);

  // The camera: where it is and what it looks at, each eased toward a goal
  const eye = new THREE.Vector3();
  const look = new THREE.Vector3(0, -0.35, -10);
  const eyeGoal = new THREE.Vector3();
  const lookGoal = new THREE.Vector3();
  const facing = new THREE.Vector3();
  /** 0 your eyes at the field's edge, 1 riding behind the plane */
  let chase = 0;

  const setPhase = (p: Phase) => {
    phase = p;
    phaseT = 0;
    events.onPhase(p);
  };

  const setPlace = (p: 'field' | 'mountains') => {
    place = p;
    field.visible = p === 'field';
    mountains.visible = p === 'mountains';
    morning.value = p === 'mountains' ? 1 : 0;
    // A wider view in the mountains, to take in the terraces and the sky above them
    camera.fov = p === 'mountains' ? 56 : FOV;
    camera.updateProjectionMatrix();
    if (p === 'field') {
      light.sun.value.copy(SUN);
      light.sky.value.setRGB(0.46, 0.42, 0.52);
      light.skyUp.value.setRGB(0.86, 0.7, 0.58);
      light.key.value.setRGB(1.0, 0.8, 0.55);
      light.through.value.setRGB(1.0, 0.7, 0.44);
    } else {
      light.sun.value.copy(SAPA_SUN);
      light.sky.value.setRGB(0.66, 0.74, 0.7);
      light.skyUp.value.setRGB(0.95, 0.97, 1.0);
      light.key.value.setRGB(0.95, 0.92, 0.84);
      light.through.value.setRGB(0.5, 0.56, 0.4);
    }
  };

  /** The plane's attitude flying along `curve` at `at`: nose down the path, banked into turns */
  const attitude = (curve: THREE.CatmullRomCurve3, at: number, t: number, target: THREE.Quaternion) => {
    curve.getTangentAt(Math.min(0.999, at), tan);
    curve.getTangentAt(Math.min(0.999, at + 0.02), tan2);
    across.crossVectors(tan, upV.set(0, 1, 0)).normalize();
    const turn = tan2.sub(tan).dot(across);
    upV.set(0, 1, 0).addScaledVector(tan, -tan.y).normalize();
    // Local axes: +x is up through the keel, +y the nose, z across the wings
    across.crossVectors(upV, tan);
    basis.makeBasis(upV, tan, across);
    target.setFromRotationMatrix(basis);
    rollQ.setFromAxisAngle(tan, Math.max(-0.9, Math.min(0.9, -turn * 14)) + Math.sin(t * 5.3) * 0.06);
    target.premultiply(rollQ);
    rollQ.setFromAxisAngle(across.normalize(), Math.sin(t * 3.7) * 0.05);
    target.premultiply(rollQ);
  };

  /** Behind and a little above the plane, looking past it the way it's going */
  const chaseGoal = (curve: THREE.CatmullRomCurve3, at: number) => {
    curve.getTangentAt(Math.min(0.999, at), tan);
    eyeGoal
      .copy(plane.position)
      .addScaledVector(tan, -3.4)
      .add(tmp.set(0, 0.85, 0));
    lookGoal.copy(plane.position).addScaledVector(tan, 3);
  };

  let last = performance.now();
  const start = last;
  let warmed = false;
  let onFirstFrame: (() => void) | null = null;
  const gaps: number[] = [];

  renderer.setAnimationLoop(() => {
    const now = performance.now();
    gaps.push(now - last);
    if (gaps.length > 240) gaps.shift();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const t = (now - start) / 1000;
    phaseT += dt;

    if (canvas.clientWidth !== width || canvas.clientHeight !== height) {
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
      renderer.setSize(canvas.width, canvas.height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      aspectU.value = width / height;
    }

    // The page rides up out of the keyboard's way while you write
    liftNow += (lift - liftNow) * Math.min(1, dt * 8);
    hold.copy(HOLD).add(tmp.set(0, liftNow * 0.62, -liftNow * 0.9));
    // Your eyes, by default: the edge of the field, looking out over it
    eyeGoal.set(0, 0, 0);
    lookGoal.set(0, -0.35, -10);
    let rate = 3;

    switch (phase) {
      case 'writing': {
        folds.pose(0, t);
        plane.position.copy(hold).add(tmp.set(0, Math.sin(t * 1.1) * 0.02, 0));
        plane.quaternion.copy(holdQ);
        plane.rotateZ(Math.sin(t * 0.7) * 0.012);
        break;
      }
      case 'folding': {
        foldT = frozen >= 0 ? frozen : foldT + dt;
        folds.pose(foldT);
        const step = folds.stepAt(foldT);
        if (step !== lastStep) {
          if (lastStep >= 0) events.onHaptic(lastStep >= 5 ? 'wing' : 'crease');
          lastStep = step;
        }
        plane.position.copy(hold);
        // Turned a touch as it's folded, so you see each fold in depth; once it's folded in
        // half it turns three-quarters on so you see the wings go down
        plane.quaternion.copy(holdQ);
        plane.rotateY(Math.sin((Math.min(foldT, halfway) / halfway) * Math.PI) * 0.3);
        const k = ease((foldT - halfway) / (folds.total - halfway));
        if (k > 0) plane.quaternion.slerp(heroQ, k);
        if (foldT >= folds.total + 0.25) {
          events.onHaptic('wing');
          fromQ.copy(plane.quaternion);
          fromP.copy(plane.position);
          setPhase('aiming');
        }
        break;
      }
      case 'aiming': {
        // Wind up: back toward you and up a little, nose swinging round to the field
        const k = ease(phaseT / 0.55);
        attitude(out, 0, t, flightQ);
        plane.quaternion.slerpQuaternions(fromQ, flightQ, k);
        plane.position
          .copy(fromP)
          .add(tmp.set(0.15 * k, 0.28 * Math.sin(Math.PI * k * 0.5), 0.55 * Math.sin(Math.PI * k)));
        if (phaseT >= 0.55) {
          events.onHaptic('throw');
          setPhase('flying');
        }
        break;
      }
      case 'flying':
      case 'clouds': {
        const u = Math.min(1, (phase === 'clouds' ? CLOUDS_AT * FLY + phaseT : phaseT) / FLY);
        const at = 1 - Math.pow(1 - u, 1.35);
        out.getPointAt(at, plane.position);
        attitude(out, at, t, plane.quaternion);
        // Your eyes leave the edge of the field and go with it
        chase = Math.min(1, chase + dt / 1.6);
        chaseGoal(out, at);
        const k = ease(chase);
        eyeGoal.lerpVectors(tmp.set(0, 0, 0), eyeGoal, k);
        lookGoal.lerpVectors(plane.position, lookGoal, k);
        if (phase === 'flying' && u >= CLOUDS_AT) {
          events.onHaptic('cloud');
          swapped = false;
          setPhase('clouds');
        }
        if (phase === 'clouds') {
          cloud.value = Math.pow(Math.min(1, phaseT / 0.95), 1.6);
          tint.value = 0.5 * Math.min(1, phaseT / 0.95);
          if (phaseT >= 0.98 && !swapped) {
            // In the white: the world on the other side
            swapped = true;
            setPlace('mountains');
            down.getPointAt(0, plane.position);
            chaseGoal(down, 0);
            eye.copy(eyeGoal);
            look.copy(lookGoal);
            setPhase('descending');
          }
        }
        break;
      }
      case 'descending': {
        cloud.value = 1 - ease(phaseT / 1.5);
        tint.value = 0.5 + 0.5 * Math.min(1, phaseT / 0.6);
        const u = Math.min(1, phaseT / DESCEND);
        const at = ease(u * 0.75 + 0.25 * u * u);
        down.getPointAt(at, plane.position);
        attitude(down, at, t, plane.quaternion);
        chaseGoal(down, at);
        // Out of the cloud you look out at the whole of it, the valley and the mountains, and only
        // then down to follow the plane in
        const vista = 1 - ease((u - 0.12) / 0.5);
        down.getTangentAt(Math.min(0.999, at), tan);
        tmp.set(tan.x, 0, tan.z).normalize().multiplyScalar(220).add(plane.position);
        tmp.y = LAND.y - 30;
        lookGoal.lerp(tmp, vista);
        // Toward the end, the view settles where you'll watch it land
        const settle = ease((u - 0.72) / 0.28);
        eyeGoal.lerp(EYE, settle);
        lookGoal.lerp(VIEW, settle);
        if (u >= 1) {
          events.onHaptic('land');
          fromQ.copy(plane.quaternion);
          fromP.copy(plane.position);
          setPhase('landing');
        }
        break;
      }
      case 'landing': {
        // Touches down nose first, skids a little, settles flat
        const k = ease(phaseT / 0.9);
        plane.position.copy(fromP).lerp(SPOT, k);
        plane.position.y += Math.sin(Math.PI * Math.min(1, phaseT / 0.45)) * 0.12 * (1 - k);
        plane.quaternion.slerpQuaternions(fromQ, sandQ, ease(phaseT / 1.1));
        shadowOn.value = k;
        eyeGoal.copy(EYE);
        lookGoal.copy(VIEW);
        rate = 2;
        if (phaseT >= 1.2) {
          foldT = folds.total;
          lastStep = folds.stepAt(foldT);
          setPhase('unfolding');
        }
        break;
      }
      case 'unfolding': {
        foldT -= dt * 1.3;
        folds.pose(Math.max(0, foldT));
        const step = folds.stepAt(Math.max(0, foldT));
        if (step !== lastStep) {
          events.onHaptic('crease');
          lastStep = step;
        }
        plane.position.copy(SPOT).add(tmp.set(0, Math.max(0, foldT / folds.total) * 0.25, 0));
        plane.quaternion.copy(sandQ);
        eyeGoal.copy(EYE);
        lookGoal.copy(VIEW);
        if (foldT <= 0) {
          events.onHaptic('page');
          setPhase('arrived');
        }
        break;
      }
      case 'arrived':
      case 'replying':
      case 'resting': {
        folds.pose(0, t * 0.6);
        plane.position.copy(SPOT);
        plane.quaternion.copy(sandQ);
        eyeGoal.copy(EYE);
        lookGoal.copy(VIEW);
        if (phase === 'arrived' && phaseT >= 1.2) {
          shown = 0;
          setPhase('replying');
        }
        if (phase === 'replying') {
          // Someone writes back, under your note, a few letters at a time
          const want = Math.min(reply.length, Math.floor(Math.max(0, phaseT - 0.4) * 16));
          if (want > shown + 1 || (want === reply.length && shown < reply.length)) {
            shown = want;
            draw({ text: note, reply, shown, sign: FRIEND });
            events.onHaptic('scratch');
          }
          if (shown >= reply.length && phaseT > reply.length / 16 + 1.2) setPhase('resting');
        }
        break;
      }
      case 'leaving': {
        // Look up into the sky, and through the cloud back to the field
        if (place === 'mountains') {
          plane.position.copy(SPOT);
          eyeGoal.copy(EYE).add(tmp.set(0, phaseT * 1.6, -phaseT * 2));
          lookGoal.set(VIEW.x, VIEW.y + phaseT * 14, VIEW.z - 6);
          rate = 1.6;
          cloud.value = ease(phaseT / 1.6);
          tint.value = 1 - 0.5 * ease(phaseT / 1.6);
          if (phaseT >= 1.65) {
            setPlace('field');
            shadowOn.value = 0;
            chase = 0;
            eye.set(0, 0, 0);
            look.set(0, -0.35, -10);
            draw({ text: note });
          }
        } else {
          cloud.value = Math.max(0, 1 - (phaseT - 1.65) / 1.2);
          tint.value = 0.5 * cloud.value;
          folds.pose(0, t);
          plane.position.copy(hold);
          plane.quaternion.copy(holdQ);
          if (phaseT >= 2.9) setPhase('writing');
        }
        break;
      }
    }

    // ---- The camera ----
    if (phase === 'writing' || phase === 'folding' || phase === 'aiming') chase = 0;
    const ka = 1 - Math.exp(-dt * rate);
    eye.lerp(eyeGoal, ka);
    look.lerp(lookGoal, Math.min(1, ka * 1.3));
    camera.position.copy(eye);
    camera.lookAt(look);
    camera.updateMatrixWorld();
    fieldSky.position.copy(camera.position);
    sapaSky.position.copy(camera.position);
    kiteSway(t, kite);

    // Where the sun is on screen, for the shafts, and whether it's in front of you at all
    const sunDir = place === 'field' ? SUN : SAPA_SUN;
    const ahead = camera.getWorldDirection(facing).dot(sunDir);
    tmp.copy(sunDir).multiplyScalar(1000).add(camera.position).project(camera);
    sunUV.value.set(tmp.x * 0.5 + 0.5, 0.5 - tmp.y * 0.5);
    raysOn.value = place === 'field' ? Math.max(0, Math.min(1, (ahead - 0.2) * 3)) * (1 - cloud.value) : 0;

    if (!warmed) {
      // Compile both places now, not mid-flight
      warmed = true;
      mountains.visible = true;
      post.render();
      mountains.visible = false;
    }
    post.render();
    context.present();
    if (onFirstFrame) {
      const cb = onFirstFrame;
      onFirstFrame = null;
      cb();
    }
  });

  return {
    /** What's written on the page */
    setNote(text: string) {
      note = text;
      if (phase === 'writing') draw({ text: note });
    },
    /** Dev: show the fold `t` seconds in and hold it there (negative lets it run) */
    peek(t: number) {
      frozen = t;
      if (t >= 0) {
        foldT = t;
        setPhase('folding');
      }
    },
    send() {
      if (phase !== 'writing') return;
      foldT = 0;
      lastStep = -1;
      lift = 0;
      reply = REPLIES[replyIndex++ % REPLIES.length];
      setPhase('folding');
    },
    /** From the terraces, back through the clouds to the field */
    /** Dev: jump to the terraces, the page already down and open */
    peekMountains() {
      setPlace('mountains');
      folds.pose(0);
      shadowOn.value = 1;
      eye.copy(EYE);
      look.copy(VIEW);
      reply = REPLIES[0];
      setPhase('arrived');
    },
    flyBack() {
      if (phase !== 'resting') return;
      events.onHaptic('cloud');
      setPhase('leaving');
    },
    /** 0..1: how much of the screen the keyboard takes, so the page can rise above it */
    setLift(k: number) {
      lift = k;
    },
    onFirstFrame(cb: () => void) {
      onFirstFrame = cb;
    },
    stats() {
      const total = gaps.reduce((a, b) => a + b, 0);
      return {
        fps: Math.round((gaps.length * 1000) / Math.max(1, total)),
        worstMs: Math.round(Math.max(0, ...gaps)),
        over20: gaps.filter((g) => g > 20).length,
      };
    },
    dispose() {
      renderer.setAnimationLoop(null);
      post.dispose();
      renderer.dispose();
    },
  };
}

export type PaperPlaneScene = ReturnType<typeof createPaperPlaneScene>;
