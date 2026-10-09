import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';

import { FLASH } from './model';

/**
 * The instant camera's materials, after the Instant demo's: a product studio's light (a big
 * softbox overhead and to the left, a strip light behind on the right) reflected in the brushed
 * plates, the chrome and the lens glass, by the reflection vector, so highlights slide across them
 * as the camera turns. Here the camera lives on a desk at night, so everything is multiplied by
 * `light`: dim and warm on the desk, full studio brightness when it's held up to shoot.
 */

type F = THREE.Node<'float'>;
type V3 = THREE.Node<'vec3'>;

const { float, vec2, vec3, uniform, mix, smoothstep, pow, length, dot, abs, sin, cos } = TSL;
const { oneMinus, saturate, atan, normalize, uv, Fn, step } = TSL;

export const time = uniform(0);

const KEY = new THREE.Vector3(-0.5, 0.7, 0.5).normalize();
const key = vec3(KEY.x, KEY.y, KEY.z);

export const studio = Fn(([d]: [V3]) => {
  const dir = normalize(d);
  const az = atan(dir.x, dir.z);
  const room = mix(vec3(0.2, 0.2, 0.21), vec3(0.72, 0.72, 0.73), saturate(dir.y.mul(0.55).add(0.5)));
  const box = smoothstep(0.55, 0.32, abs(az.add(0.75)))
    .mul(smoothstep(-0.1, 0.12, dir.y))
    .mul(smoothstep(0.92, 0.7, dir.y));
  const strip = smoothstep(0.12, 0.04, abs(az.sub(2.1))).mul(smoothstep(-0.3, -0.1, dir.y));
  const top = smoothstep(0.7, 0.95, dir.y);
  const floor = smoothstep(-0.05, -0.4, dir.y);
  return room
    .add(vec3(1.25, 1.22, 1.18).mul(box))
    .add(vec3(0.9, 0.9, 0.92).mul(strip))
    .add(vec3(0.7, 0.7, 0.72).mul(top))
    .mul(oneMinus(floor.mul(0.45)));
});

/** How much light falls on the camera: a colour, eased between the desk and the hand */
export function cameraLight() {
  return uniform(new THREE.Color(1, 1, 1));
}
export type Light = ReturnType<typeof cameraLight>;

const facing = () => saturate(abs(dot(TSL.normalView, TSL.positionViewDirection)));
const wrap = () => pow(saturate(dot(TSL.normalWorld, key).mul(0.5).add(0.5)), 1.3);

type Color = THREE.UniformNode<'color', THREE.Color>;
const lit = (c: V3, light: Light) => c.mul(light as unknown as V3);

/** Pebbled leatherette: a grain of little cells, each catching the light at its crown */
const leatherLook = (tint: V3) => {
  const p = TSL.positionGeometry.mul(9);
  const cell = TSL.mx_worley_noise_float(p);
  const crown = smoothstep(0.05, 0.6, cell);
  const n = TSL.normalWorld;
  const base = mix(tint.mul(0.55), tint.mul(1.12), wrap());
  const sheenDir = normalize(mix(TSL.reflectVector, n, 0.55));
  const fres = float(0.035).add(pow(oneMinus(facing()), 4).mul(0.3));
  return base.mul(float(0.7).add(crown.mul(0.4))).add(
    studio(sheenDir)
      .mul(fres)
      .mul(float(0.45).add(crown.mul(0.7)))
  );
};

/** Brushed metal, the grain running across the body */
const brushedLook = (tint: V3, satin: F) => {
  const n = TSL.normalWorld;
  const p = TSL.positionGeometry;
  const r = TSL.reflectVector;
  const env = mix(studio(r), studio(normalize(mix(r, n, 0.5))), satin);
  const strokes = TSL.mx_noise_float(vec3(p.x.mul(1.2), p.y.mul(260), p.z.mul(260)))
    .mul(0.5)
    .add(0.5);
  return env
    .mul(tint)
    .mul(float(0.9).add(strokes.mul(0.14)))
    .add(tint.mul(wrap()).mul(0.12));
};

/** The body: brushed metal top plate and base plate, leatherette between, a chrome line where they meet */
export function cameraBody(
  leather: Color,
  plate: Color,
  plateTop: number,
  plateBottom: number,
  top: number,
  light: Light
) {
  const material = new THREE.MeshBasicNodeMaterial();
  const y = TSL.positionGeometry.y;
  const upper = smoothstep(top - plateTop - 0.01, top - plateTop + 0.01, y);
  const lower = smoothstep(-top + plateBottom + 0.01, -top + plateBottom - 0.01, y);
  const metal = saturate(upper.add(lower));
  const seam = smoothstep(0.05, 0.0, abs(y.sub(top - plateTop)))
    .add(smoothstep(0.05, 0.0, abs(y.sub(-top + plateBottom))))
    .mul(0.6);
  const plateColor = plate as unknown as V3;
  const satin = smoothstep(0.5, 0.15, TSL.luminance(plateColor)).mul(0.5).add(0.35);
  const c = mix(leatherLook(leather as unknown as V3), brushedLook(plateColor, satin), metal);
  material.colorNode = lit(c.add(studio(TSL.reflectVector).mul(seam)), light);
  return material;
}

export function leatherette(leather: Color, light: Light) {
  const material = new THREE.MeshBasicNodeMaterial();
  material.colorNode = lit(leatherLook(leather as unknown as V3), light);
  return material;
}

/** Polished metal for the dials and buttons, knurled with fine ridges round `axis` near `rim` */
export function knurled(plate: Color, center: [number, number], rim: number, axis: 'y' | 'z', light: Light) {
  const material = new THREE.MeshBasicNodeMaterial();
  const p = TSL.positionGeometry;
  const a = axis === 'z' ? atan(p.y.sub(center[1]), p.x.sub(center[0])) : atan(p.z.sub(center[1]), p.x.sub(center[0]));
  const r = axis === 'z' ? length(p.xy.sub(vec2(...center))) : length(vec2(p.x, p.z).sub(vec2(...center)));
  const ridges = sin(a.mul(150)).mul(0.5).add(0.5);
  const onRim = smoothstep(rim - 0.25, rim - 0.12, r);
  const env = studio(normalize(mix(TSL.reflectVector, TSL.normalWorld, 0.12)));
  const tint = mix(vec3(1, 1, 1), plate as unknown as V3, 0.35);
  material.colorNode = lit(
    env
      .mul(tint)
      .mul(mix(float(1), float(0.55).add(ridges.mul(0.6)), onRim))
      .add(tint.mul(wrap()).mul(0.06)),
    light
  );
  return material;
}

/** The lens's black ring, its face marked in white like a focusing scale */
export function markedRing(light: Light) {
  const material = new THREE.MeshBasicNodeMaterial();
  const p = TSL.positionGeometry;
  const a = atan(p.y, p.x);
  const r = length(p.xy);
  const tick = smoothstep(0.475, 0.49, abs(TSL.fract(a.mul(48 / 6.2832)).sub(0.5)));
  const band = smoothstep(2.12, 2.18, r)
    .mul(smoothstep(2.42, 2.36, r))
    .mul(smoothstep(0.3, 0.38, p.z));
  const major = step(0.75, TSL.fract(a.mul(6 / 6.2832)));
  const f = facing();
  const env = studio(TSL.reflectVector);
  const base = vec3(0.03, 0.03, 0.035)
    .mul(wrap().mul(0.6).add(0.5))
    .add(env.mul(float(0.05).add(pow(oneMinus(f), 4).mul(0.6))).mul(0.7));
  material.colorNode = lit(mix(base, vec3(0.88, 0.88, 0.86), tick.mul(band).mul(major.mul(0.4).add(0.6))), light);
  return material;
}

/** A dial's top face: polished metal turned in fine circles, the engraving inked in `ink`, the red figure in `accent` */
export function engraved(plate: Color, ink: Color, accent: Color, map: THREE.Texture, light: Light) {
  const material = new THREE.MeshBasicNodeMaterial();
  const v = uv();
  const r = length(v.sub(0.5));
  const turned = sin(r.mul(1400)).mul(0.5).add(0.5).mul(0.08);
  const tint = mix(vec3(1, 1, 1), plate as unknown as V3, 0.5);
  const metal = studio(normalize(mix(TSL.reflectVector, TSL.normalWorld, 0.25)))
    .mul(tint)
    .mul(float(0.92).add(turned));
  const t = TSL.texture(map, v);
  const a = t.a;
  const isAccent = saturate(t.r.sub(t.g).div(TSL.max(a, 0.01)));
  const inkColor = mix(ink as unknown as V3, accent as unknown as V3, isAccent);
  material.colorNode = lit(mix(metal, inkColor, saturate(a.mul(1.6))), light);
  return material;
}

/** Glossy black plastic for the slot and the eyepiece */
export function gloss(base: [number, number, number], shine: number, light: Light) {
  const material = new THREE.MeshBasicNodeMaterial();
  const f = facing();
  const fres = float(0.05).add(pow(oneMinus(f), 4).mul(0.6));
  const env = studio(TSL.reflectVector);
  material.colorNode = lit(
    vec3(...base)
      .mul(wrap().mul(0.6).add(0.5))
      .add(env.mul(fres).mul(shine)),
    light
  );
  return material;
}

export function chrome(light: Light) {
  const material = new THREE.MeshBasicNodeMaterial();
  material.colorNode = lit(studio(TSL.reflectVector).mul(0.95), light);
  return material;
}

/** Coated lens glass: deep and dark, the studio in it, the purple-green bloom of the coating */
export function lensGlass(light: Light) {
  const material = new THREE.MeshBasicNodeMaterial();
  const f = facing();
  const env = studio(TSL.reflectVector);
  const fres = float(0.06).add(pow(oneMinus(f), 3).mul(0.7));
  const phase = f.mul(3.2).add(length(TSL.positionGeometry.xy).mul(0.9));
  const coat = vec3(0.5).add(vec3(0.5).mul(cos(vec3(0.0, 2.2, 4.1).add(phase.mul(6.28)))));
  const deep = mix(vec3(0.01, 0.012, 0.02), vec3(0.05, 0.06, 0.09), pow(f, 2));
  material.colorNode = lit(
    deep.add(env.mul(fres).mul(0.55)).add(
      coat
        .mul(vec3(0.35, 0.18, 0.4))
        .mul(pow(oneMinus(f), 1.5))
        .mul(0.5)
    ),
    light
  );
  return material;
}

/** The flash's frosted window: fine concentric Fresnel rings; white-hot as it fires */
export function flashMaterial(fire: F, light: Light) {
  const material = new THREE.MeshBasicNodeMaterial();
  const p = TSL.positionGeometry.xy.sub(vec2(FLASH.x, FLASH.y));
  const rings = sin(length(p.mul(vec2(1, 1.7))).mul(70))
    .mul(0.5)
    .add(0.5);
  const env = studio(TSL.reflectVector);
  const frost = vec3(0.62, 0.64, 0.67).add(rings.mul(0.07)).add(env.mul(0.14));
  material.colorNode = mix(lit(frost, light), vec3(3, 3, 3), fire);
  return material;
}

/** A lamp: dark until lit, then its colour */
export function lampMaterial(color: THREE.UniformNode<'color', THREE.Color>, on: F) {
  const material = new THREE.MeshBasicNodeMaterial();
  material.colorNode = mix(vec3(0.15, 0.13, 0.12), (color as unknown as V3).mul(1.6), on);
  return material;
}

/** The eyepiece's glass and the film counter: just dark */
export function darkGlass(light: Light) {
  const material = new THREE.MeshBasicNodeMaterial();
  const env = studio(TSL.reflectVector);
  material.colorNode = lit(vec3(0.02, 0.025, 0.03).add(env.mul(0.08)), light);
  return material;
}
