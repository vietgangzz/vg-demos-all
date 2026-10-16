import * as TSL from 'three/tsl';
import * as THREE from 'three/webgpu';

/**
 * Light for the whole globe, storybook rather than physical: a warm sun on the day side, a blue
 * moon over the night side so it never goes black, and a rosy band along the dusk line.
 *
 * Every lit thing calls shade() with its colour, its normal and which way is up where it stands
 * (the direction out from the globe's centre), all in world space.
 */

const { vec3, float, mix, saturate, smoothstep, dot, normalize, pow, exp, oneMinus } = TSL;
export type V3 = THREE.Node<'vec3'>;
export type F = THREE.Node<'float'>;

export const light = {
  /** Toward the sun, world space */
  sun: TSL.uniform(new THREE.Vector3(1, 0, 0)),
  /** Toward the moon, world space: from the front so the night side reads */
  moon: TSL.uniform(new THREE.Vector3(-0.45, 0.6, 0.66).normalize()),
};

export const hex = (c: string) => {
  const k = new THREE.Color(c);
  return vec3(k.r, k.g, k.b) as unknown as V3;
};

const sun = light.sun as unknown as V3;
const moon = light.moon as unknown as V3;

/** Out from the centre of the globe (it sits at the origin) */
export const radial = () => normalize(TSL.positionWorld) as unknown as V3;

/** 1 in daylight, 0 at night, soft across the dusk line */
export const dayness = (up: V3) => smoothstep(-0.1, 0.22, dot(up, sun)) as unknown as F;

/** The rosy band either side of the line between day and night */
export const dusk = (up: V3) => exp(dot(up, sun).mul(dot(up, sun)).mul(-38)) as unknown as F;

/** Snow lying on open ground: the globe's round the town, and the town's own out at its edge */
export const SNOWFIELD = '#E3EAF5';

const SUN = hex('#FFF0D2');
const SKY = hex('#9FC6FF');
const MOON = hex('#C2CDF2');
const NIGHT = hex('#7680B8');
const ROSE = hex('#FF9C86');

export function shade(albedo: V3, n: V3, up: V3, wrap = 0.35) {
  const day = dayness(up);
  const ndl = dot(n, sun);
  const lit = saturate(ndl.add(wrap).div(1 + wrap));
  const daylight = SUN.mul(lit.mul(1.05)).add(SKY.mul(float(0.32).add(dot(n, up).mul(0.08))));
  const mdl = saturate(dot(n, moon).add(0.5).div(1.5));
  const night = MOON.mul(mdl.mul(0.85)).add(NIGHT.mul(0.5));
  const glow = ROSE.mul(dusk(up).mul(0.5));
  return albedo.mul(mix(night, daylight, day).add(glow)) as unknown as V3;
}

/** The air at the edge of the globe: a pale blue haze by day, violet by night */
export function haze(n: V3, up: V3) {
  const view = normalize(TSL.cameraPosition.sub(TSL.positionWorld));
  const edge = pow(oneMinus(saturate(dot(n, view))), 3);
  const tint = mix(hex('#6D63FF'), hex('#9EE3FF'), dayness(up)).add(ROSE.mul(dusk(up).mul(0.6)));
  return tint.mul(edge.mul(0.3)) as unknown as V3;
}
