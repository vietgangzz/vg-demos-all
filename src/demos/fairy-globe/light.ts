import * as TSL from 'three/tsl';
import * as THREE from 'three/webgpu';

/**
 * Light for what's drawn rather than baked, inside the snow globe (Santa, his sleigh and his team)
 * and outside it (the globe's base): a winter night in a little town under glass, in a dark room.
 *
 * Inside, a cool moon from high behind, the lamplight of the room coming in warm from the front,
 * warm light bouncing up off the lit snow, and a soft blue floor so nothing goes black. Everything
 * here stands the right way up: up is +y.
 */

const { vec3, saturate, dot } = TSL;
export type V3 = THREE.Node<'vec3'>;
export type F = THREE.Node<'float'>;

export const light = {
  /** Toward the moon, world space: high and behind, a little to the left */
  moon: TSL.uniform(new THREE.Vector3(-0.38, 0.78, -0.5).normalize()),
  /** Toward the room's lamp, world space: in front, up and to the right */
  lamp: TSL.uniform(new THREE.Vector3(0.45, 0.5, 0.74).normalize()),
};

export const hex = (c: string) => {
  const k = new THREE.Color(c);
  return vec3(k.r, k.g, k.b) as unknown as V3;
};

/** Which way is up where a thing stands: always straight up, in here */
export const radial = () => vec3(0, 1, 0) as unknown as V3;

const MOON = hex('#B9C6F0');
const LAMP = hex('#FFD6A8');
const BOUNCE = hex('#FFB27A');
const NIGHT = hex('#6E78B0');

export function shade(albedo: V3, n: V3, up: V3, wrap = 0.35) {
  const moon = saturate(dot(n, light.moon as unknown as V3).add(wrap).div(1 + wrap));
  const lamp = saturate(dot(n, light.lamp as unknown as V3).add(wrap).div(1 + wrap));
  const facingUp = dot(n, up);
  const bounce = saturate(facingUp.negate().mul(0.5).add(0.5));
  const sky = saturate(facingUp.mul(0.5).add(0.5));
  const lit = MOON.mul(moon.mul(0.55))
    .add(LAMP.mul(lamp.mul(0.72)))
    .add(BOUNCE.mul(bounce.mul(0.28)))
    .add(NIGHT.mul(sky.mul(0.22).add(0.2)));
  return albedo.mul(lit) as unknown as V3;
}
