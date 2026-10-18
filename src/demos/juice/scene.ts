import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import * as TSL from 'three/tsl';
import * as THREE from 'three/webgpu';

import { chargeColour, deepColour, hotColour } from './palette';
import type { PowerState } from './power';
import { Slosh } from './slosh';
import { BUBBLE, MOTE, STREAK, sparks, type Particle } from './sparks';

/**
 * Juice: the battery as a cell of liquid light, a clear glass cylinder between metal end caps with
 * its + terminal on top, standing in a dock on a dark, glossy floor.
 *
 * Plug the phone in and the charge comes in where the cable does: a flash at the bottom edge of
 * the screen, right where the real plug went in, a stream of light racing across the floor into
 * the dock, and the cell drinks it: a jet up through the liquid that breaks the surface, a plume
 * of bubbles, the level gulping up and settling, the glass lit from inside and rays thrown out
 * behind it. Unplug and the stream drains back to the port, the glow burns out into embers and the
 * liquid calms.
 *
 * The surface stays level with the world as the phone turns (the accelerometer), and sloshes when
 * it's shoved or tapped.
 *
 * World units are about a decimetre: the cell stands 2.32 tall on its dock, on the floor (y = 0)
 * at the origin, the camera in front of it down +z.
 */

const { vec2, vec3, float, mix, exp, abs, sin, pow, dot, length, normalize, saturate, smoothstep, max, min, clamp, step, uv } = TSL;
type V3 = THREE.Node<'vec3'>;
type F = THREE.Node<'float'>;

const sq = <T extends F | V3>(x: T) => x.mul(x) as T;

// ---- The cell ----
/** The glass, outer radius */
const R = 0.5;
/** The liquid inside it (the glass is 4.5 cm thick) */
const R_IN = 0.455;
/** The dock it stands in */
const DOCK_R = 0.78;
const DOCK_H = 0.14;
/** The end caps (the flat negative one sits in the dock) and the + terminal on top */
const CAP_H = 0.13;
const NUB_H = 0.09;
/** Where the glass runs, between the caps */
const GLASS_LOW = DOCK_H + CAP_H;
const GLASS_HIGH = 2.1;
const GLASS_H = GLASS_HIGH - GLASS_LOW;
const Y_MID = (GLASS_LOW + GLASS_HIGH) / 2;
const TOP = GLASS_HIGH + CAP_H + NUB_H;
/** The surface at 0% and at 100% (a little air left under the cap) */
const EMPTY = GLASS_LOW + 0.03;
const BRIM = GLASS_HIGH - 0.09;
/** Where the charge comes into the liquid, at the bottom of the glass */
const INLET = new THREE.Vector3(0, GLASS_LOW + 0.05, 0);
/** What the camera frames */
const CENTER = new THREE.Vector3(0, 1.2, 0);
const SHOW_HEIGHT = 2.62;
/** When the stream reaches the dock after the plug goes in */
const HIT = 0.44;
/** How bright a colour looks (the green end of the gauge would glare at the red end's strength) */
const luminance = (c: THREE.Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

const levelY = (level: number) => EMPTY + (BRIM - EMPTY) * level;
const easeOut = (x: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
const easeInOut = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;

export type JuiceCue = 'hit' | 'splash' | 'pop';
export type JuiceEvents = {
  onCue: (cue: JuiceCue) => void;
  /** The level the liquid is showing, in whole percent: the number counts up with the fill */
  onShown: (percent: number) => void;
};
/** Where the capsule goes on screen (fractions of it) and how tall; where the phone's port is along the bottom */
export type Frame = { x: number; y: number; size: number; portX: number };

type Act = { kind: 'intro' | 'plug' | 'unplug' | 'full'; t: number; fired: number };

export function createJuice(context: GPUCanvasContext & { present: () => void }, device: GPUDevice, events: JuiceEvents) {
  const canvas = context.canvas as unknown as { width: number; height: number; clientWidth: number; clientHeight: number };
  let width = canvas.clientWidth;
  let height = canvas.clientHeight;
  const renderer = new THREE.WebGPURenderer({
    antialias: true,
    alpha: false,
    canvas: context.canvas as HTMLCanvasElement,
    context,
    device,
  });
  renderer.setPixelRatio(1);
  renderer.setSize(canvas.width, canvas.height, false);
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(20, width / height, 0.1, 80);
  scene.add(camera);

  // ---- What the shaders share ----
  /** The charge's colours: the body of the liquid, what it runs to at the surface, what it deepens to below */
  const uColour = TSL.uniform(new THREE.Color(1, 0.3, 0.1));
  const uHot = TSL.uniform(new THREE.Color(1, 0.7, 0.5));
  const uDeep = TSL.uniform(new THREE.Color(0.4, 0.01, 0.07));
  /** How alive it all is: 1 charging, about a third on battery */
  const uPower = TSL.uniform(0.3);
  /** The flare when the charge arrives */
  const uBurst = TSL.uniform(0);
  /** The surface's height on the axis, its slope (x, z) */
  const uLevel = TSL.uniform(EMPTY);
  const uSlope = TSL.uniform(new THREE.Vector2());
  /** The opening: the glass shows below this height */
  const uReveal = TSL.uniform(-1);
  /** A band of light running up the glass: height, strength */
  const uBand = TSL.uniform(new THREE.Vector2(-10, 0));
  /** The jet inside: top, strength, width */
  const uJet = TSL.uniform(new THREE.Vector3(INLET.y, 0, 0.03));
  /** The stream along the floor: from, to (0 at the port, 1 at the dock), and how strongly it flows */
  const uStream = TSL.uniform(new THREE.Vector3(0, 0, 0));
  const uHead = TSL.uniform(new THREE.Vector3(0, -10, 0));
  const uHeadGlow = TSL.uniform(0);
  /** The port's spot on the floor (the bottom edge of the screen), its flash */
  const uPort = TSL.uniform(new THREE.Vector3(0, 0, 3));
  const uFlash = TSL.uniform(0);
  /** A ring of light running out over the floor: radius, strength */
  const uShock = TSL.uniform(new THREE.Vector2(0, 0));
  const uDock = TSL.uniform(0);
  const uBolt = TSL.uniform(0);
  /** The glass flexing out at the bottom as the charge hits it */
  const uBulge = TSL.uniform(0);
  const time = TSL.time;

  const colour = uColour as unknown as V3;
  const hot = uHot as unknown as V3;
  const deep = uDeep as unknown as V3;
  const power = uPower as unknown as F;
  const burst = uBurst as unknown as F;

  const slosh = new Slosh(R_IN);
  const rippleAt = (xz: THREE.Node<'vec2'>, vertex = false) => {
    const t = TSL.texture(slosh.texture, xz.div(R_IN * 2).add(0.5));
    return (vertex ? t.level(float(0)) : t).r as unknown as F;
  };
  const surfaceAt = (p: V3, vertex = false) =>
    (uLevel as unknown as F)
      .add(uSlope.x.mul(p.x))
      .add(uSlope.y.mul(p.z))
      .add(rippleAt(p.xz, vertex)) as unknown as F;
  /** Distance outside the inside of the glass, across (negative within) */
  const insideGlass = (p: V3) => length(p.xz).sub(R_IN) as unknown as F;
  const viewDir = () => normalize(TSL.cameraPosition.sub(TSL.positionWorld)) as unknown as V3;

  // ---- The room: near black, warming toward the charge's colour behind the capsule ----
  const bgMat = new THREE.MeshBasicNodeMaterial();
  {
    const p = TSL.positionWorld;
    const q = p.xy.sub(vec2(0, 1.4)).mul(vec2(0.6, 1));
    const glow = exp(dot(q, q).mul(-0.035));
    const haze = mix(deep, colour, glow);
    bgMat.colorNode = vec3(0.0025, 0.0022, 0.004).add(
      haze.mul(glow.mul(float(0.01).add(power.mul(0.035)).add(burst.mul(0.09))))
    );
  }
  const bg = new THREE.Mesh(new THREE.PlaneGeometry(120, 60), bgMat);
  bg.position.set(0, 10, -18);
  scene.add(bg);

  // ---- The floor: dark polished stone, the cell mirrored in it ----
  const mirror = TSL.reflector({ resolutionScale: 0.55 });
  const floorMat = new THREE.MeshBasicNodeMaterial();
  {
    const p = TSL.positionWorld;
    const d = length(p.xz);
    const wobble = vec2(TSL.mx_noise_float(vec3(p.x.mul(7), p.z.mul(7), 0)), TSL.mx_noise_float(vec3(p.x.mul(7), p.z.mul(7), 5)));
    mirror.uvNode = (mirror.uvNode as THREE.Node<'vec2'>).add(wobble.mul(0.0035));
    const fade = exp(max(d.sub(1.0), 0).mul(-0.3));
    const pool = exp(sq(d).mul(-1.3)).mul(float(0.03).add(power.mul(0.1)).add(burst.mul(0.3)));
    // The stream's light on the floor, along the line from the port to the dock
    const a = uPort.xz;
    const ab = vec2(0, DOCK_R).sub(a);
    const t = clamp(dot(p.xz.sub(a), ab).div(dot(ab, ab)), 0, 1);
    const ds = length(p.xz.sub(a.add(ab.mul(t))));
    const lit = step(uStream.x, t).mul(step(t, uStream.y));
    const along = exp(sq(ds).mul(-180)).mul(lit).mul(uStream.z.mul(0.45));
    const head = p.sub(uHead);
    const headGlow = exp(dot(head, head).mul(-10)).mul(uHeadGlow);
    const port = p.xz.sub(uPort.xz);
    const flash = exp(dot(port, port).mul(-2.6)).mul(uFlash);
    const ring = exp(sq(d.sub(uShock.x)).mul(-22)).mul(uShock.y);
    const grain = TSL.mx_noise_float(vec3(p.x.mul(40), p.z.mul(40), 2)).mul(0.0025);
    const base = vec3(0.006, 0.0055, 0.009).add(grain);
    const lit2 = colour.mul(pool.add(along).add(ring.mul(1.2))).add(hot.mul(headGlow.add(flash).mul(1.6)));
    const col = base.add(mirror.rgb.mul(fade.mul(0.62))).add(lit2);
    const far = smoothstep(7.0, 20.0, length(TSL.cameraPosition.xz.sub(p.xz)));
    floorMat.colorNode = mix(col, vec3(0.0035, 0.003, 0.006), far);
  }
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.add(mirror.target);
  scene.add(floor);

  // ---- The dock: a graphite puck with a ring of light in its top, a slot in front for the stream ----
  const dockMat = new THREE.MeshBasicNodeMaterial();
  {
    const p = TSL.positionWorld;
    const n = TSL.normalWorld;
    const top = smoothstep(0.6, 0.95, n.y);
    const ndv = saturate(dot(n, viewDir()));
    const fres = pow(float(1).sub(ndv), 4);
    const rr = length(p.xz);
    const ring = exp(abs(rr.sub(0.6)).mul(-85)).mul(top);
    const ang = TSL.atan(p.z, p.x);
    const sweep = pow(TSL.fract(ang.div(Math.PI * 2).sub(time.mul(0.45))), 10);
    const glow = float(0.15).add(power.mul(0.8)).add(sweep.mul(power).mul(1.8)).add(burst.mul(2.2)).add(uDock.mul(3.5));
    const slot = top
      .oneMinus()
      .mul(smoothstep(0.08, 0.035, abs(p.x)))
      .mul(step(0, p.z))
      .mul(smoothstep(0.05, 0.015, abs(p.y.sub(0.055))));
    const edge = exp(abs(rr.sub(DOCK_R)).mul(-110)).mul(top);
    const body = mix(vec3(0.014, 0.014, 0.018), vec3(0.028, 0.028, 0.034), top);
    dockMat.colorNode = body
      .add(vec3(0.5, 0.55, 0.7).mul(fres.mul(0.1)))
      .add(vec3(1, 1, 1).mul(edge.mul(0.1)))
      .add(colour.mul(ring.mul(glow)))
      .add(hot.mul(slot.mul(uStream.z.mul(1.6).add(uDock.mul(2.5)))))
      .add(colour.mul(fres.mul(power.mul(0.22))));
  }
  const dock = new THREE.Mesh(new THREE.CylinderGeometry(DOCK_R, DOCK_R + 0.04, DOCK_H, 128, 1), dockMat);
  dock.position.y = DOCK_H / 2;
  scene.add(dock);

  // ---- The rays and halo behind the cell (the flare when the charge lands, a glow while charging) ----
  const raysMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  {
    // Distance from the cell's outline: a box from the dock up to the terminal
    const q = TSL.positionWorld.xy.sub(vec2(0, (DOCK_H + TOP) / 2));
    const box = abs(q).sub(vec2(R + 0.01, (TOP - DOCK_H) / 2));
    const dseg = length(max(box, vec2(0, 0))).add(min(max(box.x, box.y), 0));
    const d = max(dseg, 0);
    const halo = exp(d.mul(-3.2))
      .mul(smoothstep(0.0, 0.06, dseg))
      .mul(float(0.03).add(power.mul(0.13)).add(burst.mul(0.55)));
    const haloTone = mix(hot, deep, smoothstep(0.0, 0.9, d));
    const ang = TSL.atan(q.y, q.x);
    const wander = TSL.mx_noise_float(vec3(TSL.cos(ang).mul(3.0), TSL.sin(ang).mul(3.0), time.mul(0.3)));
    const fine = pow(saturate(sin(ang.mul(23).add(wander.mul(4.0)).add(time.mul(0.15))).mul(0.5).add(0.5)), 16);
    const broad = pow(saturate(sin(ang.mul(9).sub(wander.mul(2.0)).sub(time.mul(0.08))).mul(0.5).add(0.5)), 6).mul(0.45);
    const reach = exp(d.mul(float(-2.8).add(burst.mul(1.2)))).mul(smoothstep(0.0, 0.12, d));
    const rayAmt = fine.add(broad).mul(reach).mul(power.mul(0.012).add(burst.mul(0.5)));
    raysMat.colorNode = haloTone.mul(halo).add(mix(hot, colour, 0.35).mul(rayAmt));
  }
  const rays = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), raysMat);
  rays.position.set(0, (DOCK_H + TOP) / 2, -1.1);
  rays.renderOrder = 0;
  scene.add(rays);

  // ---- The cell: glass, the liquid, its surface, the jet, the caps ----
  const capsule = new THREE.Group();
  scene.add(capsule);

  // The glass, a clear cylinder between the caps. Front: what it reflects (two tall softboxes), a
  // line of light where it meets each cap, its rim, the liquid's light caught in it, and what's
  // etched on it (a + under the terminal, marks at a quarter, half and three quarters). Back: the
  // inside of the far wall, seen through the air above the liquid.
  const glassGeometry = new THREE.CylinderGeometry(R, R, GLASS_H, 128, 1, true);
  const glassBack = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
  });
  const glassFront = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  {
    const p = TSL.positionWorld;
    const nv = TSL.normalView;
    const tint = vec3(0.78, 0.86, 1.0);
    const along = smoothstep(GLASS_LOW, GLASS_LOW + 0.18, p.y).mul(smoothstep(GLASS_HIGH, GLASS_HIGH - 0.18, p.y));
    const shown = smoothstep(uReveal, uReveal.sub(0.15), p.y);
    const edge = exp(sq(p.y.sub(uReveal).div(0.035)).negate()).mul(step(uReveal, TOP + 0.1));
    {
      const ndv = saturate(dot(TSL.normalWorld, viewDir()));
      const fres = pow(float(1).sub(ndv), 3);
      const left = exp(sq(nv.x.add(0.6).div(0.1)).negate()).mul(0.42);
      const right = exp(sq(nv.x.sub(0.5).div(0.045)).negate()).mul(0.85);
      const rims = exp(sq(p.y.sub(GLASS_HIGH - 0.012).div(0.01)).negate())
        .add(exp(sq(p.y.sub(GLASS_LOW + 0.012).div(0.01)).negate()))
        .mul(0.3);
      const caught = mix(colour, hot, 0.35).mul(float(0.16).add(power.mul(0.38)).add(burst.mul(0.7)));
      const band = exp(sq(p.y.sub(uBand.x).div(0.07)).negate()).mul(uBand.y);
      // Etched: measured round the glass from the line facing the camera, and up it
      const arc = TSL.atan(p.x, p.z).mul(R) as unknown as F;
      const bar = (cx: F, cy: F, hx: number, hy: number) =>
        smoothstep(0.005, 0.0, max(abs(cx).sub(hx), abs(cy).sub(hy))) as unknown as F;
      const plusY = p.y.sub(GLASS_HIGH - 0.2) as unknown as F;
      const plus = max(bar(arc, plusY, 0.06, 0.012), bar(arc, plusY, 0.012, 0.06));
      const marks: [number, number][] = [
        [0.25, 0.05],
        [0.5, 0.09],
        [0.75, 0.05],
      ];
      const ticks = marks.reduce<F>(
        (sum, [lv, w]) => sum.add(bar(arc.sub(0.24 + w / 2) as F, p.y.sub(levelY(lv)) as unknown as F, w / 2, 0.006)) as F,
        float(0) as F
      );
      const etched = plus.add(ticks);
      glassFront.colorNode = tint
        .mul(left.add(right).mul(along).add(rims))
        .add(fres.mul(tint.mul(0.2)).add(fres.mul(caught)))
        .add(hot.mul(band.mul(fres.mul(1.6).add(0.3))))
        .add(vec3(0.85, 0.9, 1).mul(etched.mul(0.26)).add(caught.mul(etched.mul(0.5))))
        .mul(shown)
        .add(hot.mul(edge.mul(fres.add(0.4)).mul(1.6)));
    }
    {
      const far = exp(sq(nv.x.sub(0.55).div(0.12)).negate())
        .mul(0.1)
        .add(exp(sq(nv.x.add(0.5).div(0.06)).negate()).mul(0.16));
      glassBack.colorNode = tint.mul(far.mul(along)).add(colour.mul(0.02)).mul(shown);
    }
    // Flexing out at the bottom as the charge hits
    const bulge = exp(sq(TSL.positionLocal.y.add(GLASS_H / 2).div(0.35)).negate()).mul(uBulge);
    const flex = TSL.positionLocal.add(TSL.normalLocal.mul(bulge.mul(0.05)));
    glassFront.positionNode = flex;
    glassBack.positionNode = flex;
  }
  const back = new THREE.Mesh(glassGeometry, glassBack);
  const front = new THREE.Mesh(glassGeometry, glassFront);
  back.position.y = front.position.y = Y_MID;
  back.renderOrder = 1;
  front.renderOrder = 5;
  capsule.add(back, front);

  // The liquid: lit from within, brightest where it's deepest (the middle, seen through the most
  // of it) and just under the surface, slow currents of light rising through it
  const liquidMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  liquidMat.colorNode = TSL.Fn(() => {
    const p = TSL.positionWorld as unknown as V3;
    const surface = surfaceAt(p);
    TSL.If(p.y.greaterThan(surface), () => {
      TSL.Discard();
    });
    const ndv = saturate(dot(TSL.normalWorld, viewDir()));
    const below = surface.sub(p.y);
    const a = TSL.mx_noise_float(vec3(p.x.mul(2.6), p.y.mul(2.0).sub(time.mul(0.5)), p.z.mul(2.6).add(time.mul(0.15))));
    const b = TSL.mx_noise_float(vec3(p.x.mul(6.5).add(3.1), p.y.mul(5.5).sub(time.mul(1.2)), p.z.mul(6.5)));
    const swirl = a.mul(0.6).add(b.mul(0.3));
    // Its tones from the bottom up: deep, then the charge's colour, then hot under the surface
    const height = saturate(p.y.sub(EMPTY).div(max(surface.sub(EMPTY), 0.06)));
    const tone = mix(mix(deep, colour, smoothstep(0.0, 0.6, height)), hot, smoothstep(0.55, 1.0, height));
    const energy = float(0.5).add(power.mul(0.65)).add(burst.mul(0.6));
    const core = mix(tone, mix(tone, hot, 0.45).mul(1.12), saturate(ndv.mul(ndv).mul(0.6).add(swirl.mul(0.45))));
    const body = mix(mix(deep, tone, 0.35).mul(0.32), core, smoothstep(0.0, 0.9, ndv));
    // Veins of brighter light rising through it
    const vein = float(1).sub(abs(TSL.mx_noise_float(vec3(p.x.mul(5.0), p.y.mul(3.0).sub(time.mul(0.9)), p.z.mul(5.0)))));
    const veins = pow(vein, 9).mul(ndv);
    const under = exp(below.mul(-10)).mul(0.45);
    const inlet = p.sub(vec3(INLET.x, INLET.y, INLET.z));
    const entry = exp(dot(inlet, inlet).mul(-12)).mul(uJet.y);
    return body
      .mul(energy)
      .mul(float(1.0).add(swirl.mul(0.6)))
      .add(hot.mul(veins.mul(energy).mul(0.7)))
      .add(hot.mul(under.mul(energy)))
      .add(hot.mul(entry.mul(1.6)));
  })();
  liquidMat.opacityNode = float(0.95);
  const liquid = new THREE.Mesh(new THREE.CylinderGeometry(R_IN, R_IN, GLASS_H - 0.01, 128, 8), liquidMat);
  liquid.position.y = Y_MID;
  liquid.renderOrder = 2;
  capsule.add(liquid);

  // The surface: level with the world, rippling; bright where it meets the glass
  const surfaceGeometry = new THREE.PlaneGeometry(2, 2, 72, 72);
  surfaceGeometry.rotateX(-Math.PI / 2);
  const surfaceMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
  surfaceMat.positionNode = TSL.Fn(() => {
    const q = TSL.positionLocal.xz.mul(R_IN * 1.05);
    const y = (uLevel as unknown as F).add(uSlope.x.mul(q.x)).add(uSlope.y.mul(q.y)).add(rippleAt(q, true));
    return vec3(q.x, y, q.y);
  })();
  surfaceMat.colorNode = TSL.Fn(() => {
    const p = TSL.positionWorld as unknown as V3;
    const sd = insideGlass(p);
    TSL.If(sd.greaterThan(0), () => {
      TSL.Discard();
    });
    const at = p.xz.div(R_IN * 2).add(0.5);
    const e = 1 / 40;
    const tex = (o: THREE.Node<'vec2'>) => TSL.texture(slosh.texture, at.add(o)).r;
    const hx = tex(vec2(e, 0)).sub(tex(vec2(-e, 0)));
    const hz = tex(vec2(0, e)).sub(tex(vec2(0, -e)));
    const span = R_IN * 2 * e * 2;
    const n = normalize(vec3(uSlope.x.add(hx.div(span)).negate(), 1, uSlope.y.add(hz.div(span)).negate()));
    const v = viewDir();
    const fres = pow(float(1).sub(saturate(dot(n, v))), 2.5);
    const r = TSL.reflect(v.negate(), n);
    const spec = pow(saturate(dot(r, normalize(vec3(-0.35, 1, 0.75)))), 70);
    const strip = smoothstep(0.1, 0.0, abs(r.x.sub(0.35))).mul(smoothstep(-0.2, 0.3, r.y)).mul(0.25);
    const meniscus = exp(sd.mul(32));
    const energy = float(0.5).add(power.mul(0.65)).add(burst.mul(0.6));
    const below = mix(colour.mul(0.9), hot, 0.6).mul(energy);
    const room = vec3(0.02, 0.018, 0.024).add(vec3(0.9, 0.92, 1).mul(strip));
    return mix(below, room, fres.mul(0.75))
      .add(vec3(1, 1, 1).mul(spec.mul(1.2)))
      .add(hot.mul(meniscus.mul(1.1).mul(energy)));
  })();
  surfaceMat.opacityNode = float(0.96);
  const surface = new THREE.Mesh(surfaceGeometry, surfaceMat);
  surface.frustumCulled = false;
  surface.renderOrder = 4;
  capsule.add(surface);

  // The jet: the charge coming up through the liquid from the bottom, in pulses
  const jetMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  jetMat.positionNode = TSL.Fn(() => {
    const pl = TSL.positionLocal;
    const t = pl.y.add(0.5);
    const y = mix(float(INLET.y), uJet.x, t);
    const wobble = sin(t.mul(22).sub(time.mul(16))).mul(0.18).add(1);
    const w = uJet.z.mul(float(1).sub(t.mul(0.5))).mul(wobble);
    return vec3(pl.x.mul(w), y, pl.z.mul(w));
  })();
  {
    const along = uv().y;
    const flow = sin(along.mul(34).sub(time.mul(26))).mul(0.45).add(0.55);
    const core = pow(saturate(dot(TSL.normalWorld, viewDir())), 1.5);
    jetMat.colorNode = hot
      .mul(core.mul(3.2).add(0.6))
      .mul(flow)
      .mul(uJet.y)
      .mul(smoothstep(1.0, 0.75, along));
  }
  const jet = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 24, 40, true), jetMat);
  jet.frustumCulled = false;
  jet.renderOrder = 3;
  capsule.add(jet);

  // A bolt floating in the middle while it charges, like the icon on a battery
  const boltMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  {
    const s = TSL.texture(boltTexture(), uv()).r;
    const shape = smoothstep(0.46, 0.54, s);
    const halo = pow(smoothstep(0.0, 0.5, s), 2.0);
    const pulse = sin(time.mul(4.5)).mul(0.12).add(0.88);
    boltMat.colorNode = vec3(1, 0.97, 0.9)
      .mul(shape.mul(1.1))
      .add(hot.mul(halo.mul(0.5)))
      .mul(uBolt)
      .mul(pulse);
  }
  const bolt = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.56), boltMat);
  bolt.position.set(0, Y_MID + 0.12, 0.08);
  bolt.renderOrder = 3;
  capsule.add(bolt);

  // The caps: brushed metal, the flat negative end in the dock, the positive end on top with its
  // raised terminal, dark seals where they meet the glass
  const metalMat = new THREE.MeshBasicNodeMaterial();
  const sealMat = new THREE.MeshBasicNodeMaterial();
  {
    const nv = TSL.normalView;
    const n = TSL.normalWorld;
    const ndv = saturate(dot(n, viewDir()));
    const fres = pow(float(1).sub(ndv), 3);
    const top = smoothstep(0.6, 0.95, n.y);
    const softbox = exp(sq(nv.x.sub(0.45).div(0.14)).negate()).mul(0.75).add(exp(sq(nv.x.add(0.55).div(0.2)).negate()).mul(0.22));
    const brushed = TSL.mx_noise_float(vec3(TSL.positionWorld.y.mul(260), 0, 0)).mul(0.04);
    const env = mix(vec3(0.05, 0.05, 0.06), vec3(0.72, 0.74, 0.8), softbox.add(brushed));
    const shownCap = smoothstep(uReveal, uReveal.sub(0.12), TSL.positionWorld.y);
    metalMat.colorNode = mix(env, env.mul(0.55).add(vec3(0.05, 0.05, 0.06)), top)
      .add(colour.mul(fres.mul(power.mul(0.35))))
      .mul(shownCap);
  }
  {
    const fres = pow(float(1).sub(saturate(dot(TSL.normalWorld, viewDir()))), 3);
    const shownSeal = smoothstep(uReveal, uReveal.sub(0.12), TSL.positionWorld.y);
    sealMat.colorNode = vec3(0.01, 0.01, 0.014)
      .add(vec3(0.5, 0.55, 0.7).mul(fres.mul(0.14)))
      .add(colour.mul(fres.mul(power.mul(0.25))))
      .mul(shownSeal);
  }
  const capGeometry = new THREE.CylinderGeometry(R + 0.008, R + 0.008, CAP_H, 128);
  const lowCap = new THREE.Mesh(capGeometry, metalMat);
  lowCap.position.y = DOCK_H + CAP_H / 2;
  const highCap = new THREE.Mesh(capGeometry, metalMat);
  highCap.position.y = GLASS_HIGH + CAP_H / 2;
  const nub = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.205, NUB_H, 96), metalMat);
  nub.position.y = GLASS_HIGH + CAP_H + NUB_H / 2;
  const sealGeometry = new THREE.TorusGeometry(R + 0.005, 0.016, 12, 128);
  const lowSeal = new THREE.Mesh(sealGeometry, sealMat);
  const highSeal = new THREE.Mesh(sealGeometry, sealMat);
  lowSeal.rotation.x = highSeal.rotation.x = Math.PI / 2;
  lowSeal.position.y = GLASS_LOW;
  highSeal.position.y = GLASS_HIGH;
  capsule.add(lowCap, highCap, nub, lowSeal, highSeal);

  // ---- The stream: from the port across the floor into the dock ----
  const streamMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  {
    const s = uv().x;
    const shown = step(uStream.x, s).mul(step(s, uStream.y));
    const toHead = uStream.y.sub(s);
    const head = exp(toHead.mul(-28)).mul(uHeadGlow);
    const flow = sin(s.mul(90).sub(time.mul(24))).mul(0.4).add(0.6);
    streamMat.colorNode = hot.mul(flow.mul(uStream.z).mul(2.2).add(head.mul(6))).mul(shown);
  }
  const stream = new THREE.Mesh(new THREE.BufferGeometry(), streamMat);
  stream.frustumCulled = false;
  stream.renderOrder = 3;
  scene.add(stream);
  let path: THREE.CatmullRomCurve3 | null = null;

  // ---- Sparks, embers, bubbles ----
  const fx = sparks(1100);
  scene.add(fx.mesh);

  // ---- Post: the glow, a film tone curve, the corners closing in ----
  const post = new THREE.RenderPipeline(renderer);
  const scenePass = TSL.pass(scene, camera);
  const color = scenePass.getTextureNode('output');
  const glowing = bloom(color, 0.72, 0.8, 0.42);
  const exposure = TSL.uniform(1.0);
  /** Light spilling in at the bottom edge of the screen, right where the plug is */
  const uEdge = TSL.uniform(0);
  const uPortX = TSL.uniform(0.5);
  const uAspect = TSL.uniform(width / height);
  const s0 = TSL.screenUV;
  const fromBottom = float(1).sub(s0.y);
  const sideways = s0.x.sub(uPortX).mul(uAspect);
  const edge = exp(fromBottom.mul(-9)).mul(exp(sideways.mul(sideways).mul(-9))).mul(uEdge);
  const hdr = color.rgb.add(glowing.rgb).add(hot.mul(edge.mul(1.4))).mul(exposure);
  // The curve goes on the brightest channel, so bright gold stays gold rather than going white;
  // only the very hottest light runs a little toward white, as it does
  const peak = max(max(hdr.r, hdr.g), max(hdr.b, 0.0001));
  const curve = float(1).sub(exp(peak.mul(-1.35)));
  const kept = hdr.mul(curve.div(peak));
  const mapped = mix(kept, vec3(curve, curve, curve), smoothstep(1.6, 5.0, peak).mul(0.4)) as unknown as V3;
  const s = s0;
  const vignette = smoothstep(1.12, 0.28, length(s.sub(0.5).mul(vec2(1.0, 1.2))));
  const grain = TSL.hash(TSL.screenCoordinate.x.add(TSL.screenCoordinate.y.mul(4099)).add(TSL.floor(time.mul(30)).mul(7919)))
    .sub(0.5)
    .mul(0.012);
  const graded = TSL.sRGBTransferOETF(mapped.mul(mix(float(0.62), float(1), vignette))) as unknown as V3;
  post.outputNode = TSL.vec4(graded.add(grain), 1);

  // ---- State ----
  let frame: Frame = { x: 0.5, y: 0.55, size: 0.4, portX: 0.5 };
  let started = false;
  let state: PowerState = 'unplugged';
  let target = 0.5;
  let shown = 0;
  let shownPercent = -1;
  let gulp = 0;
  let gulpV = 0;
  let powerNow = 0.3;
  let burstNow = 0;
  let headS = 0;
  let tailS = 0;
  let flow = 0;
  let headGlow = 0;
  let flash = 0;
  let dockFlash = 0;
  let jetTop = INLET.y;
  let jetOn = 0;
  let jetW = 0.028;
  let band = { y: -10, a: 0 };
  let shock = { r: 0, a: 0 };
  let boltOn = 0;
  let bulge = 0;
  let bulgeV = 0;
  let reveal = -0.4;
  let plume = 0;
  let spawn = 0;
  let fizz = 0;

  let act: Act | null = null;
  /** The light stuttering as the charge goes */
  let flicker = 1;
  /** Dev: the edge light held at a level */
  let edgeHeld: number | null = null;
  const gRaw = new THREE.Vector3(0, -1, 0);
  const gLow = new THREE.Vector3(0, -1, 0);
  const orbit = { yaw: 0, pitch: 0 };
  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();
  const white = new THREE.Color(1, 1, 1);
  const c1 = new THREE.Color();
  const c2 = new THREE.Color();

  const charging = () => state === 'charging' || state === 'full';
  const fired = (a: Act, bit: number, at: number) => {
    if (a.t < at || a.fired & bit) return false;
    a.fired |= bit;
    return true;
  };

  // ---- Little bursts of light ----
  /** Sparks out of the port, along the floor and up off it, and the crackle of an arc */
  function portBurst() {
    const at = uPort.value;
    for (let i = 0; i < 70; i++) {
      const a = rand(-Math.PI, 0) + gauss() * 0.2;
      const speed = rand(1.2, 4.2);
      fx.emit({
        p: tmp.set(at.x + gauss() * 0.04, 0.03, at.z),
        v: tmp2.set(Math.cos(a) * speed * 0.8, rand(0.4, 2.6), Math.sin(a) * speed * 0.6 - rand(0, 1)),
        life: rand(0.35, 0.9),
        size: rand(0.008, 0.016),
        colour: c1.copy(Math.random() < 0.4 ? white : uHot.value).multiplyScalar(rand(1.5, 3)),
        gravity: 7,
        bounce: 0.35,
        drag: 0.5,
        stretch: 0.03,
      });
    }
  }
  /** A jagged arc of light near the port, for a frame or two */
  function arc() {
    const at = uPort.value;
    let x = at.x + gauss() * 0.05;
    let y = 0.02;
    let z = at.z;
    const dir = rand(-Math.PI, 0);
    for (let i = 0; i < 9; i++) {
      x += Math.cos(dir) * 0.045 + gauss() * 0.03;
      y += rand(0.0, 0.05);
      z += Math.sin(dir) * 0.03 + gauss() * 0.03;
      fx.emit({
        p: tmp.set(x, y, z),
        v: tmp2.set(0, 0, 0),
        life: rand(0.05, 0.11),
        size: rand(0.012, 0.02),
        colour: c1.copy(white).lerp(uHot.value, 0.3).multiplyScalar(2.2),
        kind: MOTE,
        soft: 0.01,
      });
    }
  }
  /** The charge landing in the dock: a ring of sparks off its rim, a flash in the glass */
  function landing() {
    for (let i = 0; i < 90; i++) {
      const a = rand(0, Math.PI * 2);
      const speed = rand(0.8, 3.0);
      fx.emit({
        p: tmp.set(Math.cos(a) * DOCK_R, DOCK_H + 0.01, Math.sin(a) * DOCK_R),
        v: tmp2.set(Math.cos(a) * speed, rand(0.6, 3.2), Math.sin(a) * speed),
        life: rand(0.4, 1.1),
        size: rand(0.007, 0.015),
        colour: c1.copy(Math.random() < 0.3 ? white : uColour.value).multiplyScalar(rand(1.6, 3.2)),
        gravity: 6,
        bounce: 0.3,
        drag: 0.45,
        stretch: 0.035,
      });
    }
    // Motes of light hanging round the capsule after the flare, drifting up
    for (let i = 0; i < 26; i++) {
      const a = rand(0, Math.PI * 2);
      fx.emit({
        p: tmp.set(Math.cos(a) * rand(0.6, 1.4), rand(0.2, TOP + 0.3), Math.sin(a) * rand(0.2, 0.8)),
        v: tmp2.set(gauss() * 0.15, rand(0.05, 0.3), gauss() * 0.1),
        life: rand(1.2, 2.6),
        size: rand(0.02, 0.05),
        colour: c1.copy(uColour.value).multiplyScalar(rand(0.25, 0.7)),
        kind: MOTE,
        soft: 0.3,
        drag: 0.8,
      });
    }
  }
  /** The jet breaking the surface: drops thrown up inside the glass */
  function breach() {
    const y = levelY(shown) + gulp;
    slosh.splash(0, 0, 0.05, 0.1);
    for (let i = 0; i < 34; i++) {
      const a = rand(0, Math.PI * 2);
      const out = rand(0.1, 0.9);
      fx.emit({
        p: tmp.set(gauss() * 0.03, y + 0.02, gauss() * 0.03),
        v: tmp2.set(Math.cos(a) * out, rand(1.2, 2.6), Math.sin(a) * out * 0.6),
        life: 1.6,
        size: rand(0.012, 0.024),
        colour: c1.copy(uHot.value).multiplyScalar(rand(1.0, 1.8)),
        kind: MOTE,
        gravity: 5.5,
        drag: 0.8,
        tag: 1,
      });
    }
  }
  /** The glow burning out: embers peeling off the glass and drifting up */
  function embers(count: number) {
    for (let i = 0; i < count; i++) {
      const a = rand(-Math.PI * 0.9, Math.PI * 0.9) + Math.PI / 2;
      const y = rand(GLASS_LOW, TOP);
      const r = y > GLASS_HIGH + CAP_H ? 0.2 : R;
      fx.emit({
        p: tmp.set(Math.cos(a) * r, y, Math.sin(a) * r),
        v: tmp2.set(Math.cos(a) * rand(0.05, 0.3), rand(0.15, 0.6), Math.sin(a) * rand(0.05, 0.25)),
        life: rand(0.9, 2.2),
        size: rand(0.01, 0.026),
        colour: c1.copy(uHot.value).lerp(c2.setRGB(1, 0.3, 0.05), 0.4).multiplyScalar(rand(1.6, 3.4)),
        kind: Math.random() < 0.6 ? STREAK : MOTE,
        gravity: -0.35,
        drag: 0.55,
        swirl: 1.4,
        stretch: 0.06,
        soft: 0.05,
      });
    }
  }
  function bubble(x: number, z: number, size: number) {
    const y = INLET.y + 0.03;
    fx.emit({
      p: tmp.set(x, y, z),
      v: tmp2.set(0, rand(0.05, 0.2), 0),
      life: 8,
      size,
      colour: c1.copy(white).lerp(uHot.value, 0.4).multiplyScalar(1.7),
      kind: BUBBLE,
      tag: 2,
    });
  }

  /** Bubbles rise and pop at the surface; drops fall back into it; neither leaves the glass */
  function custom(s: Particle, dt: number) {
    if (s.tag === 0) return true;
    const sx = slosh.sx;
    const sz = slosh.sz;
    const level = levelY(shown) + gulp;
    const top = level + sx * s.p.x + sz * s.p.z + slosh.ripple(s.p.x, s.p.z);
    if (s.tag === 2) {
      if (s.p.y >= top - s.size * 0.5) {
        slosh.splash(s.p.x, s.p.z, s.size * 0.22, 0.05);
        if (Math.random() < 0.35) {
          fx.emit({
            p: tmp.set(s.p.x, top + 0.01, s.p.z),
            v: tmp2.set(gauss() * 0.1, rand(0.1, 0.35), gauss() * 0.1),
            life: rand(0.3, 0.7),
            size: rand(0.008, 0.016),
            colour: c1.copy(uHot.value).multiplyScalar(1.4),
            kind: MOTE,
            gravity: 0.6,
            soft: 0.1,
          });
        }
        return false;
      }
      // Up through the liquid (up being across its surface), faster the bigger it is, wobbling
      const terminal = 0.2 + s.size * 10;
      s.v.y += (terminal - s.v.y) * (1 - Math.exp(-dt * 3));
      const n = Math.hypot(sx, 1, sz);
      s.p.x += ((-sx / n) * s.v.y + Math.sin(s.age * 11 + s.seed) * 0.05) * dt;
      s.p.z += ((-sz / n) * s.v.y + Math.cos(s.age * 9 + s.seed) * 0.03) * dt;
      s.p.y += (s.v.y / n) * dt;
    } else if (s.tag === 1) {
      // A drop: back into the liquid with a ripple
      if (s.v.y < 0 && s.p.y < top) {
        slosh.splash(s.p.x, s.p.z, 0.008 + s.size * 0.3, 0.05);
        return false;
      }
      if (s.p.y > GLASS_HIGH - 0.05 && s.v.y > 0) s.v.y *= -0.3;
    }
    // Inside the glass
    const room = R_IN - s.size;
    const r = Math.hypot(s.p.x, s.p.z);
    if (r > room && r > 1e-5) {
      const k = Math.max(0, room) / r;
      s.p.x *= k;
      s.p.z *= k;
      if (s.tag === 1) {
        s.v.x *= -0.4;
        s.v.z *= -0.4;
      }
    }
    return true;
  }

  // ---- The acts ----
  function startAct(kind: Act['kind']) {
    act = { kind, t: 0, fired: 0 };
  }

  function runAct(a: Act, dt: number) {
    a.t += dt;
    const t = a.t;
    if (a.kind === 'intro') {
      reveal = -0.4 + (TOP + 0.8) * easeOut(t / 0.95);
      const fill = easeOut((t - 0.35) / 1.25);
      shown = target * fill;
      jetOn = t > 0.32 && t < 1.45 ? Math.min(1, (t - 0.32) * 5) * 0.8 : Math.max(0, jetOn - dt * 2);
      jetTop = levelY(shown) + 0.05;
      jetW = 0.04;
      plume = t > 0.35 && t < 1.4 ? 60 : 0;
      if (charging()) {
        const k = easeInOut((t - 0.3) / 0.45);
        headS = k;
        flow = k;
        if (fired(a, 1, 0.75)) {
          burstNow = Math.max(burstNow, 0.55);
          dockFlash = 0.7;
          shock = { r: DOCK_R, a: 0.6 };
          events.onCue('hit');
        }
      }
      if (t > 1.9) act = null;
      return;
    }
    if (a.kind === 'plug') {
      if (fired(a, 1, 0)) {
        flash = 1;
        portBurst();
      }
      if (t < 0.2 && Math.random() < 0.7) arc();
      const k = Math.min(1, Math.max(0, (t - 0.04) / (HIT - 0.04)));
      headS = k * k;
      tailS = 0;
      flow = Math.min(1, k * 1.2);
      headGlow = t < HIT ? 1 : Math.max(0, headGlow - dt * 5);
      if (t < HIT && path) {
        path.getPointAt(Math.min(1, headS), tmp);
        uHead.value.copy(tmp);
        for (let i = 0; i < 3; i++) {
          fx.emit({
            p: tmp2.copy(tmp).add(new THREE.Vector3(gauss() * 0.02, 0.01, gauss() * 0.02)),
            v: new THREE.Vector3(gauss() * 0.7, rand(0.3, 1.6), gauss() * 0.7),
            life: rand(0.2, 0.5),
            size: rand(0.006, 0.012),
            colour: c1.copy(uHot.value).multiplyScalar(2.2),
            gravity: 6,
            bounce: 0.3,
            stretch: 0.025,
          });
        }
      }
      if (fired(a, 2, HIT)) {
        events.onCue('hit');
        dockFlash = 1;
        shock = { r: DOCK_R, a: 1 };
        bulgeV += 9;
        gulpV += 0.75;
        landing();
      }
      if (t >= HIT) {
        const j = t - HIT;
        const level = levelY(shown) + gulp;
        if (j < 0.16) {
          jetTop = THREE.MathUtils.lerp(INLET.y, level + 0.55, easeOut(j / 0.16));
          jetW = 0.065;
        } else if (j < 0.75) {
          const k2 = easeInOut((j - 0.16) / 0.59);
          jetTop = THREE.MathUtils.lerp(level + 0.55, level, k2);
          jetW = THREE.MathUtils.lerp(0.065, 0.03, k2);
        } else {
          jetTop = level;
          jetW = 0.03;
        }
        jetOn = j < 0.75 ? 1 : THREE.MathUtils.lerp(1, 0.6, Math.min(1, (j - 0.75) * 2));
        if (fired(a, 4, HIT + 0.08)) breach();
        plume = j < 0.7 ? 160 : 0;
        burstNow = j < 0.07 ? Math.max(burstNow, j / 0.07) : Math.exp(-(j - 0.07) * 1.5);
        band = { y: THREE.MathUtils.lerp(GLASS_LOW, TOP + 0.15, easeOut(j / 0.55)), a: j < 0.6 ? 1 - j : 0 };
      }
      if (t > 2.6) act = null;
      return;
    }
    if (a.kind === 'unplug') {
      const k = easeInOut(t / 0.5);
      headS = 1 - k;
      tailS = 0;
      flow = (1 - k) * (0.6 + 0.4 * Math.sin(t * 90));
      jetOn = Math.max(0, jetOn - dt * 4);
      jetTop = Math.max(INLET.y, jetTop - dt * 2.2);
      if (fired(a, 1, 0)) {
        embers(150);
        dockFlash = 0.35;
        for (let i = 0; i < 24; i++) {
          fx.emit({
            p: tmp.set(gauss() * 0.06, 0.06, DOCK_R + 0.02),
            v: tmp2.set(gauss() * 0.6, rand(0.2, 1.2), rand(0.2, 1.4)),
            life: rand(0.3, 0.8),
            size: rand(0.006, 0.012),
            colour: c1.copy(uHot.value).multiplyScalar(2),
            gravity: 6,
            bounce: 0.3,
            stretch: 0.03,
          });
        }
      }
      if (t < 0.9) embers(Math.round(rand(0, 2)));
      flicker = t < 0.5 ? 0.55 + 0.45 * Math.abs(Math.sin(t * 47) * Math.sin(t * 29 + 1)) : 1;
      // The last drop off the jet
      if (fired(a, 2, 0.24)) {
        fx.emit({
          p: tmp.set(0, Math.max(levelY(shown) + 0.25, INLET.y + 0.3), 0),
          v: tmp2.set(0, -0.2, 0),
          life: 2,
          size: 0.02,
          colour: c1.copy(uHot.value).multiplyScalar(1.6),
          kind: MOTE,
          gravity: 6,
          tag: 1,
        });
      }
      if (t > 2.2) act = null;
      return;
    }
    if (a.kind === 'full') {
      if (fired(a, 1, 0)) {
        burstNow = Math.max(burstNow, 0.6);
        shock = { r: DOCK_R, a: 0.7 };
        band = { y: GLASS_LOW, a: 0.8 };
        landing();
      }
      band.y += dt * 4;
      band.a = Math.max(0, band.a - dt * 1.2);
      if (t > 1.6) act = null;
    }
  }

  // ---- Every frame ----
  function advance(dt: number) {
    // Gravity: the slow part is which way is down, the quick part is the phone being moved
    gLow.lerp(gRaw, 1 - Math.exp(-dt * 5));
    slosh.aim(gLow.x, gLow.y, gLow.z);
    slosh.shove((gRaw.x - gLow.x) * dt * 1.6, (gRaw.z - gLow.z) * dt * 1.0);

    const wasAct = act;
    if (act) runAct(act, dt);
    const plugging = wasAct?.kind === 'plug' || wasAct?.kind === 'intro';
    const draining = wasAct?.kind === 'unplug';

    // Settled: the stream on while charging, the jet a steady trickle
    if (!wasAct || wasAct.kind === 'full') {
      const on = charging() ? 1 : 0;
      headS += (on - headS) * (1 - Math.exp(-dt * 4));
      flow += ((state === 'full' ? 0.45 : on) - flow) * (1 - Math.exp(-dt * 3));
      tailS = 0;
      headGlow = Math.max(0, headGlow - dt * 4);
      jetOn += ((state === 'charging' ? 0.6 : state === 'full' ? 0.25 : 0) - jetOn) * (1 - Math.exp(-dt * 3));
      jetTop += (levelY(shown) + gulp - jetTop) * (1 - Math.exp(-dt * 6));
      jetW += (0.028 - jetW) * (1 - Math.exp(-dt * 3));
      plume = 0;
      burstNow *= Math.exp(-dt * 1.4);
      band.a = Math.max(0, band.a - dt);
    }
    if (!wasAct || wasAct.kind !== 'intro') {
      reveal = Math.max(reveal, TOP + 1);
      shown += (target - shown) * (1 - Math.exp(-dt * 2.2));
    }
    // A gulp: the level overshoots as the charge pours in, and settles
    gulpV += (-90 * gulp - 7 * gulpV) * dt;
    gulp += gulpV * dt;
    bulgeV += (-260 * bulge - 9 * bulgeV) * dt;
    bulge += bulgeV * dt;

    const powerTarget = state === 'charging' ? 1 : state === 'full' ? 0.75 : 0.3;
    powerNow += (powerTarget - powerNow) * (1 - Math.exp(-dt * (plugging ? 5 : draining ? 3.2 : 1.6)));
    if (draining) burstNow *= Math.exp(-dt * 4);
    boltOn += ((state === 'charging' ? 1 : 0) * (act?.kind === 'plug' && act.t < HIT ? 0 : 1) - boltOn) * (1 - Math.exp(-dt * 3));
    flash *= Math.exp(-dt * 7);
    dockFlash *= Math.exp(-dt * 4);
    shock.r += dt * (3.2 + shock.r * 1.2);
    shock.a *= Math.exp(-dt * 2.2);

    // Bubbles: a plume when the charge pours in, a steady stream while it charges, the odd one otherwise
    const rate = plume + (state === 'charging' ? 16 : state === 'full' ? 5 : 0.8);
    spawn += rate * dt;
    while (spawn >= 1) {
      spawn -= 1;
      const big = Math.random() < 0.12;
      if (plume > 0 || (state === 'charging' && Math.random() < 0.75)) bubble(gauss() * 0.06, gauss() * 0.06, big ? rand(0.028, 0.042) : rand(0.011, 0.022));
      else bubble(gauss() * 0.22, gauss() * 0.16, rand(0.009, 0.018));
    }
    // A fizz of light above the surface while it charges, and motes in the air round it
    fizz += (state === 'charging' ? 7 : 0) * dt;
    while (fizz >= 1) {
      fizz -= 1;
      const y = levelY(shown) + gulp;
      const room = R_IN * 0.8;
      const a = rand(0, Math.PI * 2);
      const r = Math.sqrt(Math.random()) * room;
      fx.emit({
        p: tmp.set(Math.cos(a) * r, y + 0.02, Math.sin(a) * r),
        v: tmp2.set(gauss() * 0.04, rand(0.08, 0.22), gauss() * 0.04),
        life: rand(0.6, 1.3),
        size: rand(0.008, 0.016),
        colour: c1.copy(uHot.value).multiplyScalar(0.9),
        kind: MOTE,
        soft: 0.25,
        drag: 0.7,
        tag: 1,
      });
      if (Math.random() < 0.25) {
        const b = rand(0, Math.PI * 2);
        fx.emit({
          p: tmp.set(Math.cos(b) * rand(0.7, 1.6), rand(0.3, 2.6), Math.sin(b) * rand(0.2, 1.0) - 0.2),
          v: tmp2.set(gauss() * 0.05, rand(0.03, 0.12), 0),
          life: rand(2, 3.5),
          size: rand(0.02, 0.045),
          colour: c1.copy(uColour.value).multiplyScalar(rand(0.15, 0.35)),
          kind: MOTE,
          soft: 0.4,
          drag: 0.9,
        });
      }
    }

    // Colours follow the level the liquid is showing
    chargeColour(shown, uColour.value);
    hotColour(shown, uHot.value);
    deepColour(shown, uDeep.value);
    // Each tone held near one brightness whatever its hue: green at red's strength would glare
    const even = (c: THREE.Color, target: number, most: number) =>
      c.multiplyScalar(THREE.MathUtils.clamp(Math.pow(target / luminance(c), 0.8), 0.45, most));
    even(uColour.value, 0.34, 1.5);
    even(uHot.value, 0.6, 1.5);
    even(uDeep.value, 0.1, 1.8);

    const percent = Math.round(Math.min(1, Math.max(0, shown)) * 100);
    if (percent !== shownPercent) {
      shownPercent = percent;
      events.onShown(percent);
    }

    // Uniforms
    uLevel.value = levelY(shown) + gulp;
    uSlope.value.set(slosh.sx, slosh.sz);
    uPower.value = powerNow * flicker;
    if (!draining) flicker = 1;
    uBurst.value = burstNow;
    uReveal.value = reveal;
    uBand.value.set(band.y, band.a);
    uJet.value.set(jetTop, jetOn, jetW);
    uStream.value.set(tailS, headS, flow);
    uHeadGlow.value = headGlow;
    uFlash.value = flash;
    uEdge.value = edgeHeld ?? flash * 0.9 + headGlow * 0.25 * Math.max(0, 1 - headS * 1.6);
    uShock.value.set(shock.r, shock.a);
    uDock.value = dockFlash;
    uBolt.value = boltOn;
    uBulge.value = bulge;
    jet.visible = jetOn > 0.01;
    stream.visible = headS > 0.002;
  }

  // ---- The camera: framing the capsule where the layout wants it, leaning a little as the phone does ----
  const ray = new THREE.Raycaster();
  const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const DIST = 9.5;
  /**
   * Sideways the camera moves rather than shifting its lens: the floor's mirror is sampled
   * flipped across the screen, so a lens shift sideways would put the reflection on the wrong side
   */
  let shiftX = 0;
  const aim = new THREE.Vector3();
  function placeCamera(dt: number) {
    const roll = Math.atan2(gLow.x, -gLow.y);
    const yawTarget = THREE.MathUtils.clamp(roll * 0.18, -0.09, 0.09);
    const pitchTarget = THREE.MathUtils.clamp(-gLow.z * 0.05, -0.05, 0.05);
    orbit.yaw += (yawTarget - orbit.yaw) * (1 - Math.exp(-dt * 3));
    orbit.pitch += (pitchTarget - orbit.pitch) * (1 - Math.exp(-dt * 3));
    const pitch = 0.11 + orbit.pitch;
    aim.set(CENTER.x + shiftX, CENTER.y, CENTER.z);
    camera.position.set(
      aim.x + Math.sin(orbit.yaw) * Math.cos(pitch) * DIST,
      aim.y + Math.sin(pitch) * DIST,
      aim.z + Math.cos(orbit.yaw) * Math.cos(pitch) * DIST
    );
    camera.lookAt(aim);
  }
  function fit() {
    camera.aspect = width / height;
    camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(SHOW_HEIGHT / frame.size / 2 / DIST));
    const half = (SHOW_HEIGHT / frame.size / 2) * camera.aspect;
    shiftX = -(frame.x - 0.5) * 2 * half;
    camera.setViewOffset(width, height, 0, -(frame.y - 0.5) * height, width, height);
    camera.updateProjectionMatrix();
    placeCamera(1);
    camera.updateMatrixWorld();
    // The port: where the bottom edge of the screen meets the floor, right below where the plug is
    ray.setFromCamera(new THREE.Vector2(frame.portX * 2 - 1, -1.08), camera);
    const hit = ray.ray.intersectPlane(ground, tmp);
    const port = hit ? hit.clone() : new THREE.Vector3(0, 0, 3);
    port.z = Math.min(port.z, 7);
    uPort.value.copy(port);
    // The stream lies on the floor like a cable, a lazy S from the port to the dock's slot
    const end = new THREE.Vector3(0, 0.026, DOCK_R - 0.005);
    const start = port.clone().setY(0.02);
    const along = end.clone().sub(start);
    const side = new THREE.Vector3(-along.z, 0, along.x).normalize();
    const lean = Math.min(0.12, along.length() * 0.05);
    path = new THREE.CatmullRomCurve3(
      [
        start,
        start.clone().lerp(end, 0.3).addScaledVector(side, lean),
        start.clone().lerp(end, 0.65).addScaledVector(side, -lean * 0.7),
        start.clone().lerp(end, 0.9).addScaledVector(side, lean * 0.1),
        end,
      ],
      false,
      'centripetal'
    );
    stream.geometry.dispose();
    stream.geometry = new THREE.TubeGeometry(path, 220, 0.016, 10, false);
  }
  fit();

  // ---- The loop ----
  let last = performance.now();
  let failed = false;
  let onFirstFrame: (() => void) | null = null;
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (failed || !started) return;
    try {
      advance(dt);
      placeCamera(dt);
      camera.updateMatrixWorld();
      fx.update(dt, now / 1000, camera, custom);
      slosh.step(dt);
      post.render();
      context.present();
    } catch (e) {
      if (__DEV__) console.error('[juice]', e);
      failed = true;
      return;
    }
    if (onFirstFrame) {
      const cb = onFirstFrame;
      onFirstFrame = null;
      cb();
    }
  });

  const project = (y: number) => {
    tmp.set(0, y, 0).project(camera);
    return { x: (tmp.x * 0.5 + 0.5) * width, y: (-tmp.y * 0.5 + 0.5) * height };
  };

  return {
    /** The first reading: the glass draws itself and fills to it */
    start(level: number, now: PowerState) {
      target = level;
      state = now;
      powerNow = now === 'charging' ? 0.6 : 0.3;
      started = true;
      startAct('intro');
    },
    /** A new reading. Plugging in or out (or filling up) plays its moment */
    setPower(level: number, now: PowerState) {
      target = level;
      if (!started || now === state) return;
      const was = state;
      state = now;
      if (was === 'unplugged' && now !== 'unplugged') startAct('plug');
      else if (was !== 'unplugged' && now === 'unplugged') startAct('unplug');
      else if (was === 'charging' && now === 'full') startAct('full');
    },
    /** Gravity in the phone's frame, in g (the accelerometer) */
    setGravity(x: number, y: number, z: number) {
      gRaw.set(x, y, z);
    },
    /** A finger flicking sideways across the screen, points a second: the liquid sloshes */
    nudge(vx: number) {
      slosh.shove(THREE.MathUtils.clamp(vx / 2500, -0.6, 0.6));
    },
    /** A tap at (x, y) in points: on the capsule it splashes; near the bottom edge it's the port */
    tap(x: number, y: number): 'capsule' | 'port' | null {
      if (y > height - 120 && Math.abs(x - frame.portX * width) < 110) return 'port';
      const a = project(GLASS_LOW);
      const b = project(GLASS_HIGH);
      const side = project(Y_MID);
      tmp.set(R, Y_MID, 0).project(camera);
      const radius = Math.abs((tmp.x * 0.5 + 0.5) * width - side.x) * 1.15;
      const t = THREE.MathUtils.clamp(((x - a.x) * (b.x - a.x) + (y - a.y) * (b.y - a.y)) / ((b.x - a.x) ** 2 + (b.y - a.y) ** 2), 0, 1);
      const d = Math.hypot(x - (a.x + (b.x - a.x) * t), y - (a.y + (b.y - a.y) * t));
      if (d > radius) return null;
      const offset = THREE.MathUtils.clamp(((x - side.x) / radius) * R_IN, -R_IN * 0.8, R_IN * 0.8);
      slosh.splash(offset, 0.05, 0.06, 0.1);
      slosh.shove(offset > 0 ? -0.18 : 0.18);
      const level = levelY(shown) + gulp;
      for (let i = 0; i < 14; i++) {
        fx.emit({
          p: tmp.set(offset * 0.8 + gauss() * 0.03, level + 0.02, gauss() * 0.05),
          v: tmp2.set(gauss() * 0.4, rand(0.6, 1.5), gauss() * 0.2),
          life: 1.4,
          size: rand(0.01, 0.02),
          colour: c1.copy(uHot.value).multiplyScalar(1.3),
          kind: MOTE,
          gravity: 5.5,
          drag: 0.8,
          tag: 1,
        });
      }
      events.onCue('splash');
      return 'capsule';
    },
    layout(w: number, h: number, ratio: number, f: Frame) {
      width = w;
      height = h;
      frame = f;
      renderer.setSize(w * ratio, h * ratio, false);
      uPortX.value = f.portX;
      uAspect.value = w / h;
      fit();
    },
    /** Dev: the glow (strength, threshold), exposure, and the edge light held on (to check where it sits) */
    tune(o: { bloom?: number; threshold?: number; exposure?: number; edge?: number } = {}) {
      if (o.edge !== undefined) edgeHeld = o.edge < 0 ? null : o.edge;
      if (o.bloom !== undefined) glowing.strength.value = o.bloom;
      if (o.threshold !== undefined) glowing.threshold.value = o.threshold;
      if (o.exposure !== undefined) exposure.value = o.exposure;
      return { bloom: glowing.strength.value, threshold: glowing.threshold.value, exposure: exposure.value };
    },
    debug() {
      return {
        started,
        failed,
        state,
        target,
        shown,
        act: act && { kind: act.kind, t: act.t },
        power: powerNow,
        burst: burstNow,
        headS,
        particles: fx.count,
        slope: [slosh.sx, slosh.sz],
        port: uPort.value.toArray(),
        camera: camera.position.toArray(),
      };
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

export type Juice = ReturnType<typeof createJuice>;

/** A lightning bolt as a distance field (0.5 on its edge), for a crisp shape with a glow round it */
function boltTexture(size = 96) {
  const pts = [
    [0.18, 1],
    [-0.52, -0.08],
    [-0.04, -0.08],
    [-0.22, -1],
    [0.52, 0.12],
    [0.04, 0.12],
  ].map(([x, y]) => [x * 0.8, y * 0.8]);
  const data = new Uint8Array(size * size * 4);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const x = ((i + 0.5) / size) * 2 - 1;
      const y = ((j + 0.5) / size) * 2 - 1;
      let d = Infinity;
      let inside = false;
      for (let k = 0, m = pts.length - 1; k < pts.length; m = k++) {
        const [ax, ay] = pts[m];
        const [bx, by] = pts[k];
        if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
        const ex = bx - ax;
        const ey = by - ay;
        const t = Math.min(1, Math.max(0, ((x - ax) * ex + (y - ay) * ey) / (ex * ex + ey * ey)));
        d = Math.min(d, Math.hypot(x - ax - ex * t, y - ay - ey * t));
      }
      const v = Math.round(Math.min(1, Math.max(0, 0.5 - (inside ? -d : d) * 1.6)) * 255);
      data.set([v, v, v, 255], (j * size + i) * 4);
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}
