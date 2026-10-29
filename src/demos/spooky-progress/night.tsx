import { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';
import { Fill, Group, LinearGradient, Path, Shader, Skia, vec } from 'react-native-skia';

import { LateCanvas } from '@/components/late-canvas';
import { SPOOK } from './data';

/**
 * The night it all happens in: a deep plum sky, a big low moon with a halo, fog rolling slowly
 * along the bottom, a glow of the bar's own colour behind it, and at the finale that colour flaring
 * out over everything. In front, the black line of a graveyard: a hill, leaning headstones, a dead
 * tree, a crooked fence.
 */

const SCALE = 4;

const rgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => (v / 255).toFixed(4);
  return `float3(${c((n >> 16) & 255)}, ${c((n >> 8) & 255)}, ${c(n & 255)})`;
};

const SKY = Skia.RuntimeEffect.Make(`
uniform float2 res;
uniform float time;
uniform float3 accent;
uniform float glow;
uniform float barY;
uniform float flare;

float hash(float2 p) {
  return fract(sin(dot(p, float2(127.1, 311.7))) * 43758.5453);
}

float noise(float2 p) {
  float2 i = floor(p);
  float2 f = fract(p);
  float2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + float2(1.0, 0.0)), u.x), mix(hash(i + float2(0.0, 1.0)), hash(i + float2(1.0, 1.0)), u.x), u.y);
}

float fbm(float2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p = p * 2.03 + float2(1.7, 9.2);
    a *= 0.5;
  }
  return v;
}

half4 main(float2 px) {
  float2 uv = px / res;
  float asp = res.x / res.y;
  float2 p = float2(uv.x * asp, uv.y);
  float3 col = mix(${rgb(SPOOK.night)}, ${rgb(SPOOK.dusk)}, smoothstep(0.0, 1.0, uv.y));

  // The moon, a halo round it, a few faint seas on its face
  float2 m = float2(0.8 * asp, 0.83);
  float d = length(p - m);
  col += ${rgb(SPOOK.moon)} * exp(-d * d / 0.05) * 0.22;
  float disc = smoothstep(0.08, 0.074, d);
  float seas = fbm((p - m) * 22.0) * 0.35;
  col = mix(col, ${rgb(SPOOK.moon)} * (1.0 - seas), disc);

  // Stars, faint, twinkling
  float2 g = floor(p * 90.0);
  float s = hash(g);
  float tw = 0.5 + 0.5 * sin(time * (1.0 + s * 3.0) + s * 40.0);
  col += float3(1.0) * step(0.994, s) * tw * 0.55 * (1.0 - smoothstep(0.3, 0.7, uv.y));

  // The bar's glow, and its colour flaring out at the finale
  col += accent * glow * exp(-pow((uv.y - barY) / 0.13, 2.0)) * 0.32;
  col += accent * flare * 0.45 * exp(-pow((uv.y - barY) / 0.5, 2.0));

  // Fog rolling along the bottom, two layers drifting opposite ways
  float f1 = fbm(float2(p.x * 2.2 + time * 0.06, p.y * 4.0 - time * 0.02));
  float f2 = fbm(float2(p.x * 3.5 - time * 0.09 + 4.0, p.y * 6.0));
  float fog = smoothstep(0.5, 1.0, uv.y) * (0.6 * f1 + 0.4 * f2);
  col = mix(col, ${rgb(SPOOK.fog)}, fog * 0.42);

  return half4(half3(col), 1.0);
}`)!;

/** The graveyard along the bottom, a black silhouette, drawn once for a screen this size */
function graveyard(w: number, h: number) {
  const b = Skia.PathBuilder.Make();
  const ground = h * 0.86;
  // The hill
  b.moveTo(0, ground + 10);
  b.cubicTo(w * 0.2, ground - 30, w * 0.45, ground - 10, w * 0.62, ground + 4);
  b.cubicTo(w * 0.8, ground + 16, w * 0.92, ground - 6, w, ground);
  b.lineTo(w, h);
  b.lineTo(0, h);
  b.close();
  // Headstones, leaning this way and that
  const stone = (x: number, y: number, sw: number, sh: number, lean: number) => {
    const c = Math.cos(lean);
    const s = Math.sin(lean);
    const pt = (dx: number, dy: number) => [x + dx * c - dy * s, y + dx * s + dy * c] as const;
    const r = sw / 2;
    const [ax, ay] = pt(-r, 0);
    b.moveTo(ax, ay);
    const [bx, by] = pt(-r, -sh + r);
    b.lineTo(bx, by);
    const [cx, cy] = pt(0, -sh - r * 0.3);
    const [dx, dy] = pt(r, -sh + r);
    b.quadTo(cx, cy, dx, dy);
    const [ex, ey] = pt(r, 0);
    b.lineTo(ex, ey);
    b.close();
  };
  stone(w * 0.1, ground - 4, 30, 42, -0.12);
  stone(w * 0.24, ground - 12, 22, 30, 0.08);
  stone(w * 0.7, ground + 6, 26, 36, 0.14);
  stone(w * 0.84, ground + 2, 20, 26, -0.1);
  // A cross
  const cx = w * 0.53;
  const cy = ground - 4;
  b.addRect(Skia.XYWHRect(cx - 3, cy - 40, 6, 42));
  b.addRect(Skia.XYWHRect(cx - 12, cy - 30, 24, 6));
  // A dead tree, bare branches reaching
  const tx = w * 0.92;
  const ty = ground - 2;
  b.moveTo(tx - 7, ty);
  b.cubicTo(tx - 4, ty - 50, tx - 10, ty - 90, tx - 2, ty - 120);
  b.lineTo(tx + 2, ty - 118);
  b.cubicTo(tx - 4, ty - 80, tx + 4, ty - 50, tx + 7, ty);
  b.close();
  const branch = (x0: number, y0: number, x1: number, y1: number, wd: number) => {
    b.moveTo(x0, y0 - wd);
    b.quadTo((x0 + x1) / 2, (y0 + y1) / 2 - 14, x1, y1);
    b.quadTo((x0 + x1) / 2, (y0 + y1) / 2 - 14 + wd * 1.6, x0, y0 + wd);
    b.close();
  };
  branch(tx - 3, ty - 70, tx - 46, ty - 104, 3);
  branch(tx - 4, ty - 92, tx - 30, ty - 132, 2.2);
  branch(tx, ty - 100, tx + 26, ty - 128, 2);
  branch(tx - 54 + 14, ty - 98, tx - 62, ty - 92, 1.2);
  // A crooked fence along the left
  for (let i = 0; i < 6; i++) {
    const x = w * 0.3 + i * 13;
    const tip = ground - 26 - (i % 2) * 5;
    b.moveTo(x - 2.5, ground + 4);
    b.lineTo(x - 2.5, tip + 5);
    b.lineTo(x, tip);
    b.lineTo(x + 2.5, tip + 5);
    b.lineTo(x + 2.5, ground + 4);
    b.close();
  }
  b.addRect(Skia.XYWHRect(w * 0.3 - 6, ground - 14, 6 * 13 + 4, 3));
  return b.detach();
}

export function Night({
  width,
  height,
  clock,
  accent,
  glow,
  barY,
  flare,
}: {
  width: number;
  height: number;
  clock: SharedValue<number>;
  /** The bar's colour (0 to 1 each), how strongly it glows, where the bar is, and the finale's flare */
  accent: SharedValue<[number, number, number]>;
  glow: SharedValue<number>;
  barY: number;
  flare: SharedValue<number>;
}) {
  const uniforms = useDerivedValue(() => ({
    res: [width / SCALE, height / SCALE],
    time: clock.value,
    accent: accent.value,
    glow: glow.value,
    barY: barY / height,
    flare: flare.value,
  }));
  const yard = useMemo(() => graveyard(width, height), [width, height]);
  return (
    <>
      <LateCanvas style={[styles.small, { width: width / SCALE, height: height / SCALE }]}>
        <Fill>
          <Shader source={SKY} uniforms={uniforms} />
        </Fill>
      </LateCanvas>
      <LateCanvas style={StyleSheet.absoluteFill}>
        <Group>
          <Path path={yard}>
            <LinearGradient start={vec(0, height * 0.75)} end={vec(0, height)} colors={['#07040D', '#030206']} />
          </Path>
        </Group>
      </LateCanvas>
    </>
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
