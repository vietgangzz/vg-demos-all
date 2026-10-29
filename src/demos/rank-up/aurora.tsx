import { StyleSheet } from 'react-native';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';
import { Fill, Shader, Skia } from 'react-native-skia';

import { LateCanvas } from '@/components/late-canvas';
import { WORLD } from './data';
import { BAND } from './ribbon';

/**
 * The world everything happens in, all one shader:
 *
 * - Silver's world, cool, with big soft pools of light drifting through it.
 * - Gold's world, warm. It arrives as a ribbon across the screen on a slant, through the badge,
 *   opening out from a thin line; then, high above the clouds, it pours in from above and takes the
 *   whole sky over.
 * - Broad soft rays turning slowly round whatever's being celebrated.
 * - Blooms: a soft disc of white light swelling out from a hit and fading.
 * - A glow round the badge.
 *
 * Nothing in it is sharp, so it's drawn at a quarter of the screen's size and stretched up: a
 * sixteenth of the pixels to shade, and the stretch softens the rays' edges for free.
 */

const SCALE = 4;

const rgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => (v / 255).toFixed(4);
  return `float3(${c((n >> 16) & 255)}, ${c((n >> 8) & 255)}, ${c(n & 255)})`;
};

const WORLDS = Skia.RuntimeEffect.Make(`
uniform float2 res;
uniform float time;
uniform float2 focus;
uniform float glow;
uniform float band;
uniform float flood;
uniform float2 bandAt;
uniform float2 floodAt;
uniform float rays;
uniform float2 raysAt;
uniform float spin;
uniform float bloomA;
uniform float2 bloomAAt;
uniform float bloomB;
uniform float2 bloomBAt;

float blob(float2 p, float2 c, float r) {
  float2 d = p - c;
  return exp(-dot(d, d) / (r * r));
}

float3 screen(float3 a, float3 b, float k) {
  return 1.0 - (1.0 - a) * (1.0 - b * k);
}

float3 world(float2 p, float2 uv, float asp, float t, float3 top, float3 bottom, float3 a, float3 b, float3 c) {
  float3 col = mix(top, bottom, smoothstep(0.0, 1.0, uv.y));
  col = screen(col, a, 0.32 * blob(p, float2(asp * (0.15 + 0.1 * sin(t * 0.3)), 0.14 + 0.06 * cos(t * 0.25)), 0.45));
  col = screen(col, b, 0.12 * blob(p, float2(asp * (0.9 + 0.08 * cos(t * 0.22)), 0.4 + 0.1 * sin(t * 0.33)), 0.38));
  col = screen(col, c, 0.4 * blob(p, float2(asp * (0.3 + 0.14 * cos(t * 0.18)), 0.8 + 0.07 * sin(t * 0.27)), 0.45));
  return col;
}

float2 at(float2 px) {
  return float2(px.x / res.y, px.y / res.y);
}

float bloom(float2 p, float2 c, float k) {
  if (k <= 0.0 || k >= 1.0) return 0.0;
  float r = 0.12 + 0.95 * (1.0 - pow(1.0 - k, 3.0));
  float d = length(p - c);
  return pow(1.0 - k, 2.0) * exp(-(d * d) / (r * r));
}

half4 main(float2 px) {
  float2 uv = px / res;
  float asp = res.x / res.y;
  float2 p = float2(uv.x * asp, uv.y);
  float t = time;

  float3 silver = world(p, uv, asp, t, ${rgb(WORLD.silver.top)}, ${rgb(WORLD.silver.bottom)}, ${rgb(WORLD.silver.a)}, ${rgb(WORLD.silver.b)}, ${rgb(WORLD.silver.c)});
  float3 gold = world(p, uv, asp, t + 7.0, ${rgb(WORLD.gold.top)}, ${rgb(WORLD.gold.bottom)}, ${rgb(WORLD.gold.a)}, ${rgb(WORLD.gold.b)}, ${rgb(WORLD.gold.c)});

  // Gold's world on its ribbon, the whole way across, opening out from a thin line; and above the
  // clouds, pouring in from overhead and out over everything. Flat and clean, its edges just softened
  float2 b = p - at(bandAt);
  float2 dir = float2(${Math.cos(BAND.angle).toFixed(4)}, ${(-Math.sin(BAND.angle)).toFixed(4)});
  float across = abs(dot(b, float2(-dir.y, dir.x)));
  float hw = ${BAND.half.toFixed(4)} * band;
  float e = 1.0 / res.y;
  float ribbon = band > 0.0 ? 1.0 - smoothstep(hw - 1.5 * e, hw + 1.5 * e, across) : 0.0;
  float reach = flood * 1.9;
  float poured = flood > 0.0 ? 1.0 - smoothstep(reach - 2.0 * e, reach + 2.0 * e, length(p - at(floodAt))) : 0.0;
  float inside = flood >= 1.0 ? 1.0 : max(ribbon, poured);
  float3 col = mix(silver, gold, inside);

  // White light is held back in Silver's world and let loose in Gold's
  float hot = mix(0.5, 1.0, inside);

  // Broad soft rays
  float2 q = p - at(raysAt);
  float ang = atan(q.y, q.x);
  float band = smoothstep(0.25, 0.95, 0.5 + 0.5 * cos(ang * 12.0 + spin));
  float fall = exp(-length(q) * 1.3);
  col = screen(col, float3(1.0), hot * rays * band * fall * 0.4);
  col = screen(col, float3(1.0), hot * rays * blob(p, at(raysAt), 0.26) * 0.25);

  // The glow round the badge
  col = screen(col, float3(1.0, 0.98, 0.92), hot * glow * blob(p, at(focus), 0.3) * 0.55);

  // Blooms from the hits
  col = screen(col, float3(1.0), hot * 0.9 * bloom(p, at(bloomAAt), bloomA));
  col = screen(col, float3(1.0), hot * 0.9 * bloom(p, at(bloomBAt), bloomB));

  return half4(half3(col), 1.0);
}`)!;

type Point = { x: number; y: number };

/** A point on screen to one on the quarter-size canvas */
const s = (p: Point) => {
  'worklet';
  return [p.x / SCALE, p.y / SCALE];
};

export function Aurora({
  width,
  height,
  clock,
  focus,
  glow,
  band,
  flood,
  bandAt,
  floodAt,
  rays,
  raysAt,
  spin,
  blooms,
}: {
  width: number;
  height: number;
  clock: SharedValue<number>;
  /** The badge's centre, and how bright the glow round it is */
  focus: SharedValue<Point>;
  glow: SharedValue<number>;
  /** How far Gold's ribbon has opened (0 to 1, a little past it as it springs), how far it's flooded out, and where it crosses */
  band: SharedValue<number>;
  flood: SharedValue<number>;
  bandAt: SharedValue<Point>;
  /** Where Gold's world pours in from when it floods */
  floodAt: Point;
  /** How bright the rays are, where they turn about, and how far round they've turned */
  rays: SharedValue<number>;
  raysAt: SharedValue<Point>;
  spin: SharedValue<number>;
  /** Two blooms: how far through each one is (0 to 1), and where */
  blooms: [SharedValue<number>, Point, SharedValue<number>, Point];
}) {
  const [bloomA, bloomAAt, bloomB, bloomBAt] = blooms;
  const uniforms = useDerivedValue(() => {
    return {
      res: [width / SCALE, height / SCALE],
      time: clock.value,
      focus: s(focus.value),
      glow: glow.value,
      band: band.value,
      flood: flood.value,
      bandAt: s(bandAt.value),
      floodAt: s(floodAt),
      rays: rays.value,
      raysAt: s(raysAt.value),
      spin: spin.value,
      bloomA: bloomA.value,
      bloomAAt: s(bloomAAt),
      bloomB: bloomB.value,
      bloomBAt: s(bloomBAt),
    };
  });
  return (
    <LateCanvas style={[styles.small, { width: width / SCALE, height: height / SCALE }]}>
      <Fill>
        <Shader source={WORLDS} uniforms={uniforms} />
      </Fill>
    </LateCanvas>
  );
}

const styles = StyleSheet.create({
  small: {
    position: 'absolute',
    left: 0,
    top: 0,
    transformOrigin: 'top left',
    transform: [{ scale: SCALE }],
  },
});
