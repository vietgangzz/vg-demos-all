import * as TSL from 'three/tsl';
import * as THREE from 'three/webgpu';

/**
 * The light on the pond, at night: a low moon behind the stage to the left, warm light thrown on
 * the water from the audience's side (the way a water puppet stage is lit), the row of red
 * lanterns under the eaves, and the lotus lamps floating on the water, each with its candle.
 *
 * Everything's lit here by hand, in its own material, so it all sits in the one picture.
 */

const { vec3, float, saturate, dot, normalize, pow, max, mix, exp, smoothstep, clamp } = TSL;
export type V3 = THREE.Node<'vec3'>;
export type F = THREE.Node<'float'>;

export const hex = (c: string) => {
  const k = new THREE.Color(c);
  return vec3(k.r, k.g, k.b) as unknown as V3;
};

/** Toward the moon: just up over the trees, left of the stage, in the clear sky between the title and the roof */
export const MOON_DIR = new THREE.Vector3(-0.258, 0.098, -0.961).normalize();
/** Toward the light on the stage: from the audience, high up, a little to the right */
export const KEY_DIR = new THREE.Vector3(0.32, 0.78, 0.72).normalize();
/** The lanterns along the eaves of the stage: a line of warm light from a to b */
export const LANTERN_ROW = { a: new THREE.Vector3(-2.6, 2.3, -10.65), b: new THREE.Vector3(2.6, 2.3, -10.65) };
export const LOTUS_COUNT = 7;
/** Where the lotus lamps' candles are, written each frame (far away while they're not out yet) */
export const lotusLights = Array.from({ length: LOTUS_COUNT }, () => TSL.uniform(new THREE.Vector3(0, -80, 0)));

const MOON = hex('#AFC2F2');
const KEY = hex('#FFC995');
const LANTERN = hex('#FF6A2A');
const CANDLE = hex('#FFB04A');
const NIGHT = hex('#1A2440');
const moonDir = vec3(MOON_DIR.x, MOON_DIR.y, MOON_DIR.z) as unknown as V3;
const keyDir = vec3(KEY_DIR.x, KEY_DIR.y, KEY_DIR.z) as unknown as V3;
const rowA = vec3(LANTERN_ROW.a.x, LANTERN_ROW.a.y, LANTERN_ROW.a.z) as unknown as V3;
const rowAB = vec3(
  LANTERN_ROW.b.x - LANTERN_ROW.a.x,
  LANTERN_ROW.b.y - LANTERN_ROW.a.y,
  LANTERN_ROW.b.z - LANTERN_ROW.a.z
) as unknown as V3;
const rowLen2 = LANTERN_ROW.a.distanceToSquared(LANTERN_ROW.b);

/** Warm light from the lanterns at p, turned to n (null: as it falls on the flat water) */
export function lanternLight(p: V3, n: V3 | null): V3 {
  // The row: the nearest point on it
  const t = clamp(dot(p.sub(rowA), rowAB).div(rowLen2), 0, 1);
  const d = rowA.add(rowAB.mul(t)).sub(p);
  const d2 = dot(d, d);
  const facing = n ? saturate(dot(n, normalize(d)).mul(0.8).add(0.2)) : float(1);
  let lit = LANTERN.mul(facing.mul(float(2.2).div(d2.add(1.4)))) as unknown as V3;
  for (const u of lotusLights) {
    const e = (u as unknown as V3).sub(p);
    const e2 = dot(e, e);
    const f = n ? saturate(dot(n, normalize(e)).mul(0.7).add(0.3)) : float(1);
    lit = lit.add(CANDLE.mul(f.mul(float(0.22).div(e2.add(0.08))))) as unknown as V3;
  }
  return lit;
}

/** The night all round, as seen reflected in something shiny looking along r */
export function nightAround(r: V3): V3 {
  const up = r.y;
  const sky = mix(hex('#3A2A3A'), hex('#060B1C'), smoothstep(0.0, 0.45, up));
  const toMoon = saturate(dot(r, moonDir));
  const moon = MOON.mul(pow(toMoon, 600).mul(9).add(pow(toMoon, 24).mul(0.35)));
  // The lit stage behind, a warm band low down in front of the dragon
  const stage = LANTERN.mul(
    exp(
      r.x
        .mul(r.x)
        .mul(-3)
        .sub(up.sub(0.12).mul(up.sub(0.12)).mul(90))
    ).mul(0.9)
  ).mul(smoothstep(0.2, -0.4, r.z));
  // The audience side, where the light comes from
  const key = KEY.mul(pow(saturate(dot(r, keyDir)), 18).mul(1.6));
  const water = hex('#040C0B');
  return mix(water, sky.add(moon).add(stage).add(key), smoothstep(-0.06, 0.04, up)) as unknown as V3;
}

/**
 * Painted, lacquered wood (the dragon, the stage): `base` lit by the moon, the stage light and
 * the lanterns; `gild` of it gold leaf, which shows the night reflected in it; `wet` for how much
 * water's still running off it. Under the water it goes dim and green, then gone; it isn't seen
 * at all in the water's reflection from below.
 */
export function lacquer(base: V3, gild: F, wet: F): V3 {
  const p = TSL.positionWorld as unknown as V3;
  const n = normalize(TSL.normalWorld) as unknown as V3;
  const v = normalize(TSL.cameraPosition.sub(p)) as unknown as V3;
  const r = TSL.reflect(v.negate(), n) as unknown as V3;
  const key = saturate(dot(n, keyDir).mul(0.75).add(0.25));
  const moon = saturate(dot(n, moonDir).add(0.15).div(1.15));
  const sky = saturate(n.y.mul(0.5).add(0.5));
  const lit = KEY.mul(key.mul(0.95))
    .add(MOON.mul(moon.mul(0.42)))
    .add(NIGHT.mul(sky.mul(0.35).add(0.12)))
    .add(lanternLight(p, n).mul(0.75));
  const diffuse = base.mul(lit);
  const ndv = saturate(dot(n, v));
  const fres = float(0.04).add(pow(float(1).sub(ndv), 5).mul(0.96));
  const around = nightAround(r);
  const glint = KEY.mul(
    pow(saturate(dot(r, keyDir)), float(70).add(wet.mul(160))).mul(float(0.7).add(wet.mul(1.6)))
  ).add(MOON.mul(pow(saturate(dot(r, moonDir)), 140).mul(0.8)));
  // Gold: the light it's lit by and the night round it, both in gold
  const gold = base.mul(lit.mul(0.55).add(around.mul(1.6))).add(glint.mul(base.mul(0.6).add(0.4)));
  // Lacquer: the paint under a clear, glossy coat (glossier wet)
  const coat = around.mul(fres.mul(float(0.55).add(wet.mul(0.6)))).add(glint);
  const col = mix(diffuse.add(coat), gold, gild);
  // Under the water: murkier the deeper it goes
  const depth = max(p.y.negate(), 0);
  const murk = hex('#06201A');
  const under = mix(col.mul(vec3(0.45, 0.75, 0.6)), murk, float(1).sub(exp(depth.mul(-2.4))));
  return mix(col, under, smoothstep(0.0, 0.03, depth)) as unknown as V3;
}

/** Don't draw what's under the water into the water's reflection (its camera is down under it) */
export function notInReflection() {
  TSL.If(TSL.cameraPosition.y.lessThan(0).and(TSL.positionWorld.y.lessThan(0.0)), () => {
    TSL.Discard();
  });
}
