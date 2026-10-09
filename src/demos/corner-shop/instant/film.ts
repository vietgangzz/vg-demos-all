import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';

import { studio, time } from './materials';
import { FILM } from './model';

/**
 * Instant film, after the Instant demo's: the picture graded like Fujifilm colour film — four
 * looks, after an instant print, a classic negative, a muted chrome slide and a vivid slide — with
 * grain, a red halation round the highlights, soft focus and a vignette. It develops like the real
 * thing: out of the camera it's a dark slate grey; the dye layers come up one after another, cyan
 * first and the warm reds last. Shaking it stirs the chemistry into swirls and hurries it along.
 *
 * Made per scene (`createFilm`), so each scene's live print has its own photo and chemistry.
 */

type F = THREE.Node<'float'>;
type V2 = THREE.Node<'vec2'>;
type V3 = THREE.Node<'vec3'>;

const { float, vec2, vec3, uniform, mix, smoothstep, pow, length, dot, abs, max, min, floor } = TSL;
const { oneMinus, saturate, uv, Fn } = TSL;

export type Look = {
  id: string;
  name: string;
  sat: number;
  contrast: number;
  /** Black lift: film never quite reaches black */
  lift: number;
  /** Split toning: added to the shadows and to the highlights */
  shadow: [number, number, number];
  high: [number, number, number];
  /** Greens pushed toward teal (the negative's cool greens) */
  teal: number;
  /** Blues and cyans pushed deeper and less saturated (the chrome's slate skies) */
  slate: number;
  halation: number;
  grain: number;
  vignette: number;
};

export const LOOKS: Look[] = [
  {
    id: 'instant',
    name: 'Instant',
    sat: 1.12,
    contrast: 1.06,
    lift: 0.055,
    shadow: [-0.02, 0.012, 0.05],
    high: [0.045, 0.02, -0.025],
    teal: 0.25,
    slate: 0,
    halation: 0.55,
    grain: 0.04,
    vignette: 0.28,
  },
  {
    id: 'neg',
    name: 'Classic Neg',
    sat: 0.92,
    contrast: 1.2,
    lift: 0.045,
    shadow: [-0.035, 0.03, 0.045],
    high: [0.05, 0.005, 0.02],
    teal: 0.6,
    slate: 0.15,
    halation: 0.45,
    grain: 0.035,
    vignette: 0.22,
  },
  {
    id: 'chrome',
    name: 'Chrome',
    sat: 0.72,
    contrast: 1.24,
    lift: 0.03,
    shadow: [0.0, 0.004, 0.02],
    high: [0.03, 0.022, -0.008],
    teal: 0.2,
    slate: 0.55,
    halation: 0.3,
    grain: 0.045,
    vignette: 0.32,
  },
  {
    id: 'vivid',
    name: 'Vivid',
    sat: 1.45,
    contrast: 1.26,
    lift: 0.01,
    shadow: [0.008, -0.012, 0.035],
    high: [0.025, 0.004, -0.004],
    teal: 0,
    slate: -0.15,
    halation: 0.35,
    grain: 0.03,
    vignette: 0.24,
  },
];

const color = (c: [number, number, number]) => uniform(new THREE.Color(...c));

/** A look as uniforms, so it can be eased, swept in, or frozen onto a print */
function lookUniforms(l: Look) {
  return {
    sat: uniform(l.sat),
    contrast: uniform(l.contrast),
    lift: uniform(l.lift),
    shadow: color(l.shadow),
    high: color(l.high),
    teal: uniform(l.teal),
    slate: uniform(l.slate),
    halation: uniform(l.halation),
    grain: uniform(l.grain),
    vignette: uniform(l.vignette),
  };
}
type LookUniforms = ReturnType<typeof lookUniforms>;

function applyLook(u: LookUniforms, l: Look) {
  u.sat.value = l.sat;
  u.contrast.value = l.contrast;
  u.lift.value = l.lift;
  u.shadow.value.setRGB(...l.shadow);
  u.high.value.setRGB(...l.high);
  u.teal.value = l.teal;
  u.slate.value = l.slate;
  u.halation.value = l.halation;
  u.grain.value = l.grain;
  u.vignette.value = l.vignette;
}

function copyLook(from: LookUniforms, to: LookUniforms) {
  (Object.keys(from) as (keyof LookUniforms)[]).forEach((k) => {
    const v = from[k].value;
    if (typeof v === 'number') (to[k] as { value: number }).value = v;
    else (to[k].value as THREE.Color).copy(v as THREE.Color);
  });
}

function chemUniforms() {
  return {
    dev: uniform(0),
    swirl: uniform(0),
    flow: uniform(new THREE.Vector2(0, 0)),
    /** 1 for a photo whose rows run top first (a render target), 0 for one bottom first */
    flip: uniform(0),
    exposure: uniform(1),
  };
}
type Chem = ReturnType<typeof chemUniforms>;

const v3 = (n: unknown) => n as V3;

/** The grade itself: saturation, the greens and blues moved, an S-curve, split toning, lifted blacks */
const gradeWith = (L: LookUniforms) =>
  Fn(([c]: [V3]) => {
    const l = TSL.luminance(c);
    const x = mix(vec3(l), c, L.sat).toVar();
    const green = saturate(x.g.sub(max(x.r, x.b)).mul(3));
    x.addAssign(vec3(-0.035, -0.02, 0.05).mul(green).mul(L.teal));
    const blue = saturate(x.b.sub(max(x.r, x.g.mul(0.9))).mul(2.5));
    x.assign(mix(x, vec3(TSL.luminance(x)).mul(vec3(0.82, 0.9, 1.05)), blue.mul(L.slate)));
    x.assign(x.sub(0.5).mul(L.contrast).add(0.5));
    x.assign(mix(x, smoothstep(0, 1, saturate(x)), 0.4));
    const l2 = TSL.luminance(saturate(x));
    x.addAssign(v3(L.shadow).mul(pow(oneMinus(l2), 2)));
    x.addAssign(v3(L.high).mul(pow(l2, 2)));
    return L.lift.add(saturate(x).mul(oneMinus(L.lift)));
  });

/** The photograph through one look: graded, halation round the highlights, vignette and grain */
function developed(L: LookUniforms, sharp: V3, soft: V3, blur: V3, at: V2, exposure: F) {
  const base = gradeWith(L)(mix(sharp, soft, 0.22).mul(exposure)) as unknown as V3;
  const hot = smoothstep(0.6, 0.95, TSL.luminance(blur));
  const halo = vec3(1, 0.32, 0.14).mul(hot).mul(L.halation).mul(0.32);
  const vig = smoothstep(0.95, 0.25, length(at.sub(0.5).mul(vec2(1.25, 1.0))));
  const graded = base.add(halo).mul(mix(oneMinus(L.vignette), float(1), vig));
  const grain = TSL.hash(floor(at.x.mul(1150)).add(floor(at.y.mul(1550)).mul(1777)))
    .sub(0.5)
    .mul(L.grain)
    .mul(float(0.65).add(oneMinus(TSL.luminance(graded)).mul(0.5)));
  return graded.add(grain);
}

export function createFilm() {
  /** The live print's look, and the one it's sweeping away from */
  const look = lookUniforms(LOOKS[0]);
  const lookFrom = lookUniforms(LOOKS[0]);
  /** 0 → 1 as a new look sweeps across the print */
  const sweep = uniform(1);
  /** The live print's chemistry */
  const chem = chemUniforms();
  /** How much light falls on a print: full held up close, dimmer and warm on the line */
  const lineLight = uniform(new THREE.Color(1, 1, 1));
  const held = uniform(new THREE.Color(1, 1, 1));

  const samplers: THREE.TextureNode[] = [];
  let current: THREE.Texture = new THREE.DataTexture(new Uint8Array([64, 70, 76, 255]), 1, 1);
  current.needsUpdate = true;

  /** The picture side; given `own`, a finished print that stays as it is */
  const front = (own?: { photo: THREE.Texture; look: LookUniforms; chem: Chem }) => {
    const material = new THREE.MeshBasicNodeMaterial();
    const C = own?.chem ?? chem;
    const L = own?.look ?? look;
    const sample = (at: V2, level?: number) => {
      const node = TSL.texture(own?.photo ?? current, at) as unknown as THREE.TextureNode;
      if (!own) samplers.push(node);
      return (level === undefined
        ? node
        : (node as unknown as { level: (l: F) => unknown }).level(float(level))) as unknown as THREE.Node<'vec4'>;
    };
    const u = uv();
    const px = u.x.mul(FILM.w);
    const py = u.y.mul(FILM.h);
    const iw = FILM.w - FILM.side * 2;
    const ih = FILM.h - FILM.top - FILM.bottom;
    const ix = px.sub(FILM.side).div(iw);
    const iy = py.sub(FILM.bottom).div(ih);
    const at = vec2(saturate(ix), saturate(iy));
    const read = vec2(at.x, mix(at.y, oneMinus(at.y), C.flip));
    const edge = min(min(ix, oneMinus(ix)).mul(iw), min(iy, oneMinus(iy)).mul(ih));
    const inside = smoothstep(-0.004, 0.004, edge);

    const sharp = sample(read).rgb;
    const soft = sample(read, 1.5).rgb;
    const blur = sample(read, 4.5).rgb;
    let photo: V3 = developed(L, sharp, soft, blur, at, C.exposure);
    if (!own) {
      const before = developed(lookFrom, sharp, soft, blur, at, C.exposure);
      const across = at.x.mul(0.55).add(oneMinus(at.y).mul(0.85)).div(1.4);
      const fr = sweep.mul(1.5).sub(0.25);
      const reveal = smoothstep(across.add(0.07), across.sub(0.07), fr);
      const leak = TSL.exp(across.sub(fr).div(0.09).pow(2).negate()).mul(oneMinus(pow(sweep, 3)));
      photo = mix(before, photo, reveal).add(vec3(1, 0.5, 0.18).mul(leak).mul(0.55));
    }

    // Developing: the reagent spreads from the bottom; shaking stirs it
    const flow = C.flow as unknown as V2;
    const warp = TSL.mx_noise_float(vec3(at.mul(2.3).add(flow), time.mul(0.35)));
    const fine = TSL.mx_noise_float(vec3(at.mul(6).sub(flow.mul(1.7)), time.mul(0.6).add(4)));
    const stir = warp
      .mul(0.65)
      .add(fine.mul(0.35))
      .mul(C.swirl)
      .mul(oneMinus(C.dev.mul(0.8)));
    const local = saturate(
      C.dev
        .mul(1.14)
        .sub(0.07)
        .add(stir.mul(0.32))
        .add(oneMinus(at.y).sub(0.5).mul(0.08).mul(oneMinus(C.dev)))
    );
    const fresh = vec3(0.19, 0.24, 0.27);
    const pR = smoothstep(0.24, 0.98, local);
    const pG = smoothstep(0.1, 0.8, local);
    const pB = smoothstep(0.0, 0.58, local);
    const developing = vec3(mix(fresh.x, photo.x, pR), mix(fresh.y, photo.y, pG), mix(fresh.z, photo.z, pB));
    const streak = smoothstep(0.45, 0.9, warp.mul(0.5).add(0.5)).mul(C.swirl).mul(oneMinus(C.dev));
    const picture = developing.add(vec3(0.03, 0.07, 0.1).mul(streak).mul(0.6));

    // The frame: warm white, the picture a hair recessed
    const n = TSL.normalWorld;
    const lit = saturate(
      dot(n, vec3(-0.45, 0.7, 0.55))
        .mul(0.4)
        .add(0.75)
    );
    const tooth = TSL.mx_noise_float(vec3(u.mul(vec2(260, 410)), 2)).mul(0.012);
    const shade = smoothstep(0.06, 0.0, max(edge.negate(), 0)).mul(oneMinus(inside)).mul(0.06);
    const frame = vec3(0.965, 0.955, 0.925).mul(lit).sub(shade).add(tooth);
    const face = mix(frame, picture, inside);

    // The glossy skin over all of it
    const facing = saturate(abs(dot(TSL.normalView, TSL.positionViewDirection)));
    const fresnel = float(0.04).add(pow(oneMinus(facing), 5).mul(0.96));
    const env = studio(TSL.reflectVector);
    const sheen = smoothstep(1.0, 1.25, TSL.luminance(env)).mul(0.35);
    const light = (own ? lineLight : held) as unknown as V3;
    material.colorNode = face
      .mul(oneMinus(fresnel.mul(0.6)))
      .add(env.mul(fresnel).mul(0.6))
      .add(sheen.mul(mix(float(0.4), float(1), inside)))
      .mul(light);
    return material;
  };

  return {
    look,
    chem,
    sweep,
    lineLight,
    held,
    /** Swap a new photo into the live print */
    setPhoto(texture: THREE.Texture) {
      current = texture;
      samplers.forEach((s) => (s.value = texture));
    },
    /** The live print's picture side */
    front: () => front(),
    /** A finished print as it is now, to hang up: its own photo, its look and chemistry frozen */
    frozen(photo: THREE.Texture) {
      const L = lookUniforms(LOOKS[0]);
      copyLook(look, L);
      const C = chemUniforms();
      C.dev.value = 1;
      C.flip.value = chem.flip.value;
      C.exposure.value = chem.exposure.value;
      return front({ photo, look: L, chem: C });
    },
    /** A new look sweeps in over the old one */
    setLook(l: Look) {
      copyLook(look, lookFrom);
      applyLook(look, l);
      sweep.value = 0;
    },
    /** The back of a print: black, faintly glossy */
    back(onLine = false) {
      const material = new THREE.MeshBasicNodeMaterial();
      const env = studio(TSL.reflectVector);
      const facing = saturate(abs(dot(TSL.normalView, TSL.positionViewDirection)));
      material.colorNode = vec3(0.035, 0.035, 0.04)
        .add(env.mul(pow(oneMinus(facing), 3).mul(0.4).add(0.03)))
        .mul((onLine ? lineLight : held) as unknown as V3);
      return material;
    },
    /** The print's edges: the same white as the frame */
    edge(onLine = false) {
      const material = new THREE.MeshBasicNodeMaterial();
      material.colorNode = vec3(0.9, 0.89, 0.86).mul((onLine ? lineLight : held) as unknown as V3);
      return material;
    },
  };
}

export type Film = ReturnType<typeof createFilm>;

export function filmGeometry() {
  return new THREE.BoxGeometry(FILM.w, FILM.h, FILM.t, 1, 1, 1);
}
