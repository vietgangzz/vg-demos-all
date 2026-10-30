import { StyleSheet } from 'react-native';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';
import { Fill, ImageShader, Shader, Skia, useImage } from 'react-native-skia';

import { LateCanvas } from '@/components/late-canvas';
import { WORLD } from './data';
import { BAND } from './ribbon';

/**
 * The world everything happens in, all one shader:
 *
 * - The world of light: a storm sky lit from under the horizon, a city on the horizon drawn in lines of
 *   light round a tower, and a grid running out across a glossy black floor to it, a lane of light
 *   straight down the middle and pulses of light running out along some of its lines. The camera
 *   climbing lifts it all away below, the clouds slower, being further off. Its paintings come without
 *   colour; the world's light gives them theirs: cyan in Silver's world, gold in Gold's.
 * - Gold's world arrives as a beam across the screen on a slant, through the badge, opening out from a
 *   thin line; then, out of the tunnel, it blasts out from the middle and takes everything over.
 * - A pad of light under the badge: a ring of dashes on the floor of the air, lighting up one at a time
 *   as it charges, turning.
 * - When something's celebrated, waves of light running in along the grid from the city, one after
 *   another, and a soft light about it.
 * - Blooms: a soft disc of white light swelling out from a hit and fading.
 * - A glow round the badge.
 * - The tunnel of light the badge flies into out of the clouds, light rushing past down it to a point
 *   of gold ahead; and out of it, Gold's world blasting out from the middle.
 *
 * Its lines of light glow rather than cut, so it's drawn at half the screen's size and stretched up:
 * a quarter of the pixels to shade.
 */

const SCALE = 2;

const SKY = require('../../../assets/rank-up-neo/art/sky.webp');
const SKYLINE = require('../../../assets/rank-up-neo/art/horizon.png');
/** Where the horizon is, down the screen (0 to 1), in the sky's painting and the world */
const HORIZON = 0.64;
/** The skyline's painting: how wide it's drawn against the screen, and how tall against that (2:1) */
const SKYLINE_W = 1.0;

/** The world's light: Silver's cyan and Gold's gold */
const SILVER_LIGHT = 'float3(0.28, 0.86, 1.0)';
const GOLD_LIGHT = 'float3(1.0, 0.7, 0.24)';

const rgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => (v / 255).toFixed(4);
  return `float3(${c((n >> 16) & 255)}, ${c((n >> 8) & 255)}, ${c(n & 255)})`;
};

const WORLDS = Skia.RuntimeEffect.Make(`
uniform shader sky;
uniform shader skyline;
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
uniform float bloomA;
uniform float2 bloomAAt;
uniform float bloomB;
uniform float2 bloomBAt;
uniform float tunnel;
uniform float warp;
uniform float run;
uniform float lift;
uniform float dim;
uniform float deck;
uniform float deckOn;
uniform float2 padAt;
uniform float padR;
uniform float pad;
uniform float padCharge;
uniform float padTurn;

float blob(float2 p, float2 c, float r) {
  float2 d = p - c;
  return exp(-dot(d, d) / (r * r));
}

float3 screen(float3 a, float3 b, float k) {
  return 1.0 - (1.0 - a) * (1.0 - b * k);
}

float2 at(float2 px) {
  return float2(px.x / res.y, px.y / res.y);
}

// The world's light in colour c: base, light that's spread (clouds, the floor's sheen), and line, light
// drawn in lines, burning white at its hottest
float3 lit(float3 c, float base, float line) {
  return c * (base + line) + float3(0.45) * line * line;
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

  // The world, its light without colour yet: the clouds, lit from under the horizon, sampled no lower
  // than the horizon, so the glow along it stays put as the floor drops away under it
  float hz = ${HORIZON} + lift;
  float sy = min(px.y - lift * 0.35 * res.y, ${HORIZON} * res.y - 2.0);
  float2 drift = float2(res.y * 0.006 * sin(t * 0.05), 0.0);
  float dy = p.y - hz;
  float cloud = dy < 0.0 ? dot(sky.eval(float2(px.x, sy) + drift).rgb, float3(0.3333)) : 0.0;
  // The city on the horizon: its black bulk, standing in front of the clouds, and its lines of light
  half4 city = skyline.eval(px - float2(0.0, lift * res.y));
  float bulk = city.a;
  float lines = max(city.r, max(city.g, city.b));
  // The grid on the floor: lines running out to the horizon and lines across them, seen in
  // perspective, each blurred to a glow once they're too close together to tell apart
  float grid = 0.0;
  float sheen = 0.0;
  if (dy > 0.0) {
    float dx = p.x - 0.5 * asp;
    float gx = dx / dy;
    float gz = 1.0 / dy;
    float s = 0.55;
    float cx = s * dy * res.y;
    float cz = s * dy * dy * res.y;
    float ax = abs(fract(gx / s + 0.5) - 0.5) * cx;
    float az = abs(fract(gz / s + 0.5) - 0.5) * cz;
    // Out of the horizon's haze, and dimming towards you, so it's brightest far off where the city is
    float near = smoothstep(0.0, 0.04, dy) * (0.25 + 0.75 * exp(-dy * 6.0));
    float lx = (exp(-ax * ax / 0.7) + 0.2 * exp(-ax / 3.0)) * smoothstep(1.5, 6.0, cx);
    float lz = (exp(-az * az / 0.7) + 0.2 * exp(-az / 3.0)) * smoothstep(1.5, 6.0, cz);
    grid = (lx + lz) * (0.3 + 0.7 * exp(-abs(gx) * 0.45)) * near * 0.6;
    // The lane straight down the middle to the tower
    float lane = abs(dx) * res.y;
    grid += (exp(-lane * lane / 1.2) * 1.1 + exp(-lane / 9.0) * 0.22) * near;
    // Light running out along some of the lines to the city
    float h = fract(sin(floor(gx / s + 0.5) * 91.7) * 4375.85);
    float pz = fract(gz * 0.12 - t * (0.22 + 0.3 * h) + h * 7.0);
    float pulse = smoothstep(0.0, 0.03, pz) * (1.0 - smoothstep(0.03, 0.22, pz)) * step(0.55, h);
    grid += exp(-ax * ax / 1.4) * pulse * 1.5 * smoothstep(1.5, 6.0, cx) * near;
    // Something celebrated: waves of light running in along the grid from the city towards you, one
    // after another, every line they cross lighting up as they go
    float wz = mix(16.0, 2.0, fract(t * 0.3));
    float wave = exp(-pow((gz - wz) / (0.1 * wz + 0.15), 2.0)) * rays;
    grid += (lx + lz) * wave * 1.8 * smoothstep(0.0, 0.04, dy);
    // The city's light caught in the glossy black floor, under the tower and along the horizon
    sheen = exp(-pow(dx / 0.05, 2.0)) * exp(-dy * 8.0) * 0.45 + exp(-dy * 28.0) * 0.3 * exp(-abs(dx) * 1.6);
  }
  float base = cloud * (1.0 - bulk) + sheen;
  float line = lines + grid;
  float3 silver = lit(${SILVER_LIGHT}, base, line);
  float3 gold = lit(${GOLD_LIGHT}, base, line);

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
  float3 col = mix(silver, gold, inside) * dim;
  // The beam drawn the Grid's way: a light trail, its two edges burning bright, its middle a soft
  // wash of light rather than a slab
  if (band > 0.0 && flood < 1.0) {
    float rim = exp(-pow((across - hw) / (2.2 * e), 2.0));
    float core = (1.0 - smoothstep(0.0, hw, across)) * ribbon;
    col = mix(col, silver, 0.45 * ribbon * (1.0 - poured));
    col += ${rgb(WORLD.gold.a)} * (core * 0.18 + rim * 0.9) * min(1.0, band) * (1.0 - poured);
  }

  // A deck of grid the camera's climbing up through: overhead, a ceiling of it, its lines spreading out
  // to the edges as it comes down on you; a sheet of light across the screen as you go through it;
  // then a floor of it falling away below
  if (deckOn > 0.0) {
    float h = max(abs(deck), 1e-3);
    float ey = p.y - 0.5;
    float sheet = exp(-pow(ey / (0.004 + h * 0.08), 2.0)) * exp(-h * 6.0);
    float dg = 0.0;
    if (deck * ey < 0.0) {
      float ay = abs(ey);
      float dx = p.x - 0.5 * asp;
      float s = 0.55;
      float cx = s * ay / h * res.y;
      float cz = s * ay * ay / h * res.y;
      float ax = abs(fract(dx / ay * h / s + 0.5) - 0.5) * cx;
      float az = abs(fract(h / ay / s + 0.5) - 0.5) * cz;
      float lx = (exp(-ax * ax / 0.7) + 0.2 * exp(-ax / 3.0)) * smoothstep(1.5, 6.0, cx);
      float lz = (exp(-az * az / 0.7) + 0.2 * exp(-az / 3.0)) * smoothstep(1.5, 6.0, cz);
      dg = (lx + lz) * smoothstep(0.0, 0.05, ay) * exp(-h / ay * 0.12) * (0.6 + 1.2 * exp(-h * 3.0));
    }
    col += deckOn * lit(mix(${SILVER_LIGHT}, ${GOLD_LIGHT}, inside), sheet * 0.5, dg + sheet);
  }

  // Up out of the decks and down a tunnel of light: streaks of it rushing past and rings going by, cyan
  // turning gold the further down it you are, and ahead, the way out, a point of gold light swelling
  if (tunnel > 0.0) {
    float2 d = p - float2(0.5 * asp, 0.5);
    float rr = length(d);
    float z = 0.08 / max(rr, 0.004);
    float f = (atan(d.y, d.x) / 6.28318 + 0.5) * 72.0;
    float lane = fract(sin(floor(f) * 12.9898) * 43758.5453);
    float along = fract(z * (0.5 + lane) + run * (0.8 + lane) + lane * 9.0);
    float streak = smoothstep(0.0, 0.04, along) * (1.0 - smoothstep(0.04, 0.3, along));
    streak *= (1.0 - smoothstep(0.0, 0.7, abs(fract(f) - 0.5) * 2.0)) * step(0.3, lane);
    float rings = pow(0.5 + 0.5 * cos((z * 1.2 + run * 1.6) * 6.28318), 10.0) * smoothstep(0.03, 0.3, rr);
    float3 hue = mix(float3(0.13, 0.9, 1.0), float3(1.0, 0.78, 0.24), smoothstep(0.25, 0.8, warp));
    float3 inner = hue * (streak * 1.4 + rings * 0.35) * smoothstep(0.0, 0.12, rr);
    inner += hue * 0.08 * (1.0 - smoothstep(0.0, 0.9, rr));
    inner += float3(1.0, 0.85, 0.5) * exp(-rr / (0.02 + 0.12 * warp * warp)) * (0.4 + 1.2 * warp);
    col = mix(col, min(inner, float3(1.0)), tunnel * (1.0 - inside));
  }

  // The pad of light under the badge: a ring of dashes, lit one at a time from the front round as it
  // charges, turning; a fainter ring inside it and a haze of light over it
  if (pad > 0.0) {
    float2 q = (p - at(padAt)) / float2(padR / res.y, padR / res.y * 0.24);
    float rr = length(q);
    float a = atan(q.y, q.x) / 6.28318 + 0.5;
    float seg = fract((a + padTurn) * 36.0);
    float dash = smoothstep(0.1, 0.2, seg) * (1.0 - smoothstep(0.7, 0.8, seg));
    float on = 0.22 + 0.78 * step(fract(a - 0.25), padCharge);
    float ring = exp(-pow((rr - 1.0) / 0.05, 2.0)) * dash * on;
    float inner = exp(-pow((rr - 0.74) / 0.025, 2.0)) * 0.4;
    float haze = (1.0 - smoothstep(0.0, 1.05, rr)) * 0.1 * (0.4 + padCharge);
    float3 c = mix(${SILVER_LIGHT}, ${GOLD_LIGHT}, inside);
    col += pad * (c * (ring * 1.3 + inner + haze) + float3(0.5) * ring * ring);
  }

  // Gold's world blasting out: a ring of white-hot light at its edge as it goes
  if (flood > 0.0 && flood < 1.0) {
    float edge = length(p - at(floodAt)) - reach;
    col += float3(1.0, 0.86, 0.5) * exp(-pow(edge / 0.035, 2.0)) * (1.0 - flood) * 1.2;
  }

  // White light is held back in Silver's world and let loose in Gold's
  float hot = mix(0.5, 1.0, inside);

  // A soft light about whatever's being celebrated, in the world's own light: pale cyan in Silver's,
  // gold in Gold's (the rest of the celebrating is the grid's, waves running in along it)
  float3 beam = mix(float3(0.75, 0.97, 1.0), ${GOLD_LIGHT}, inside);
  col = screen(col, mix(float3(1.0), beam, 0.5), hot * rays * blob(p, at(raysAt), 0.22) * 0.3);

  // The glow round the badge
  col = screen(col, float3(1.0, 0.98, 0.92), hot * glow * blob(p, at(focus), 0.3) * 0.55);

  // Blooms from the hits
  col = screen(col, float3(1.0), hot * 0.9 * bloom(p, at(bloomAAt), bloomA));
  col = screen(col, float3(1.0), hot * 0.9 * bloom(p, at(bloomBAt), bloomB));

  // A vignette closing in at the edges and corners, so the middle, where the board is, reads
  float2 v = (uv - float2(0.5, 0.46)) * float2(1.25, 1.0);
  col *= 1.0 - 0.55 * smoothstep(0.32, 0.85, length(v));
  return half4(half3(clamp(col, 0.0, 1.0)), 1.0);
}`)!;

type Point = { x: number; y: number };

/**
 * The tunnel: how much of the screen it is (0 to 1), how far down it you've gone (0 to 1, cyan to
 * gold), and how far the light in it has rushed past
 */
export type Tunnel = { on: number; warp: number; run: number };

/**
 * The pad of light under the badge: its middle and radius (px), how much it's there (0 to 1), how
 * much of it's lit (0 to 1, from the front round) and how far round it's turned (turns)
 */
/** The deck of grid the camera's climbing through: how far above (+) or below (-) it is, and how much it's there */
export type Deck = { h: number; on: number };

export type Pad = { x: number; y: number; r: number; on: number; charge: number; turn: number };

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
  blooms,
  tunnel,
  lift,
  dim,
  deck,
  pad,
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
  /** How much something's being celebrated (the waves along the grid, the soft light), and where */
  rays: SharedValue<number>;
  raysAt: SharedValue<Point>;
  /** Two blooms: how far through each one is (0 to 1), and where */
  blooms: [SharedValue<number>, Point, SharedValue<number>, Point];
  tunnel: SharedValue<Tunnel>;
  /** How far the camera's climbed, in screen heights */
  lift: SharedValue<number>;
  /** How bright the world is, held down behind text that has to be read over it */
  dim: SharedValue<number>;
  deck: SharedValue<Deck>;
  pad: SharedValue<Pad>;
}) {
  const [bloomA, bloomAAt, bloomB, bloomBAt] = blooms;
  const sky = useImage(SKY);
  const skyline = useImage(SKYLINE);
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
      bloomA: bloomA.value,
      bloomAAt: s(bloomAAt),
      bloomB: bloomB.value,
      bloomBAt: s(bloomBAt),
      tunnel: tunnel.value.on,
      warp: tunnel.value.warp,
      run: tunnel.value.run,
      lift: lift.value,
      dim: dim.value,
      deck: deck.value.h,
      deckOn: deck.value.on,
      padAt: s(pad.value),
      padR: pad.value.r / SCALE,
      pad: pad.value.on,
      padCharge: pad.value.charge,
      padTurn: pad.value.turn,
    };
  });
  if (!sky || !skyline) return null;
  const w = width / SCALE;
  const h = height / SCALE;
  const city = {
    x: (w - w * SKYLINE_W) / 2,
    y: h * HORIZON - (w * SKYLINE_W) / 2,
    width: w * SKYLINE_W,
    height: (w * SKYLINE_W) / 2,
  };
  return (
    <LateCanvas style={[styles.small, { width: w, height: h }]}>
      <Fill>
        <Shader source={WORLDS} uniforms={uniforms}>
          {/* The sky stretched to the screen, so its horizon is the world's */}
          <ImageShader image={sky} fit="fill" rect={{ x: 0, y: 0, width: w, height: h }} />
          <ImageShader image={skyline} fit="fill" rect={city} />
        </Shader>
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
