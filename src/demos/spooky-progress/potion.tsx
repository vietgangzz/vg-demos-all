import { StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, useDerivedValue, type SharedValue } from 'react-native-reanimated';
import { BlurMask, Fill, Group, LinearGradient, Rect, RoundedRect, rrect, Shader, Skia, vec } from 'react-native-skia';

import { LateCanvas } from '@/components/late-canvas';
import { Burst } from '../daily-drop/fx';
import { mix, span } from '../rank-up/ui';
import { FINALE, levelAt, SPOOK, STEPS } from './data';
import { Flyers, Smoke } from './fx';
import type { BarProps, Cue } from './types';

/**
 * The potion: the bar's a glass test tube on its side, corked, and the bar's a brew of toxic green
 * filling it, glowing, bubbling, its front edge rolling. Each right answer an ingredient drops in (an
 * eye, a toadstool, a spider, a bone, a sweet) with a splash, and the brew surges along and turns,
 * green to gold. Full, it boils, rattling the tube, until the cork shoots out and smoke, bats and
 * ghosts pour out of it.
 */

export const POTION_LAG = 0.38;
const INGREDIENTS = ['👁️', '🍄', '🕷️', '🦴', '🍬'];
const H = 60;
const CORK = 30;

/** The brew's colour as it fills: green, then lime, then gold */
const STOPS: [number, number, number][] = [
  [0.31, 0.86, 0.17],
  [0.62, 0.95, 0.2],
  [1.0, 0.62, 0.12],
];
export const potionColour = (level: number): [number, number, number] => {
  'worklet';
  const k = Math.min(1, Math.max(0, level)) * 2;
  const i = Math.min(1, Math.floor(k));
  const f = k - i;
  const a = STOPS[i];
  const b = STOPS[i + 1];
  return [mix(a[0], b[0], f), mix(a[1], b[1], f), mix(a[2], b[2], f)];
};

const BREW = Skia.RuntimeEffect.Make(`
uniform float4 box;
uniform float level;
uniform float time;
uniform float slosh;
uniform float boil;
uniform float3 col;

float hash(float2 p) {
  return fract(sin(dot(p, float2(127.1, 311.7))) * 43758.5453);
}

half4 main(float2 px) {
  float w = box.z - box.x;
  float h = box.w - box.y;
  float2 q = (px - box.xy) / float2(w, h);
  float wob = (0.01 + 0.035 * slosh + 0.02 * boil) * sin(q.y * 8.0 + time * 6.0) + 0.006 * sin(q.y * 21.0 - time * 9.0);
  float front = level + wob;
  float edge = (front - q.x) * w;
  if (edge < 0.0) return half4(0.0);
  float3 c = col * (0.55 + 0.6 * (1.0 - q.y));
  // Glowing hot along its front edge
  c += col * 0.7 * exp(-edge / 12.0);
  c += float3(1.0) * 0.35 * exp(-edge / 3.0);
  // Swirls in it
  c += col * 0.12 * sin(q.x * w * 0.08 + time * 1.7 + sin(q.y * 7.0 + time * 1.3) * 2.0);
  // Bubbles rising, more and faster as it boils
  float2 g = float2(q.x * w, q.y * h) / 10.0;
  g.y += time * (1.2 + boil * 4.0);
  float2 id = floor(g);
  float2 f = fract(g) - 0.5;
  float r = hash(id);
  float size = 0.18 + 0.2 * hash(id + 7.3);
  float2 off = (float2(hash(id + 1.7), hash(id + 3.1)) - 0.5) * 0.4;
  float bub = r > 0.78 - boil * 0.35 ? smoothstep(size, size - 0.08, length(f - off)) : 0.0;
  float rim = r > 0.78 - boil * 0.35 ? smoothstep(size - 0.1, size, length(f - off)) * bub : 0.0;
  c = mix(c, c * 0.6 + float3(0.4), bub * 0.5);
  c += float3(1.0) * rim * 0.5;
  return half4(half3(c), 0.95);
}`)!;

const rgbHex = (c: [number, number, number]) => {
  'worklet';
  const h = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255);
  return `rgb(${h(c[0])}, ${h(c[1])}, ${h(c[2])})`;
};

export function Potion({ t, ambient, width, y }: BarProps) {
  const x0 = 26;
  const x1 = width - 26 - CORK + 10;
  const top = y - H / 2;
  const box = { x0: x0 + 6, y0: top + 6, x1: x1 - 2, y1: top + H - 6 };
  const len = box.x1 - box.x0;
  const tube = rrect(Skia.XYWHRect(x0, top, x1 - x0, H), H / 2, H / 2);
  const inner = rrect(Skia.XYWHRect(box.x0, box.y0, len, box.y1 - box.y0), H / 2 - 6, H / 2 - 6);

  const level = useDerivedValue(() => levelAt(t.value, POTION_LAG));
  const col = useDerivedValue(() => potionColour(level.value));
  const slosh = useDerivedValue(() => {
    let s = 0;
    for (let k = 0; k < 5; k++) {
      const d = t.value - STEPS[k] - POTION_LAG;
      if (d > 0) s += Math.exp(-d * 2.5);
    }
    return Math.min(1.5, s);
  });
  const boil = useDerivedValue(() => {
    const u = t.value;
    return span(u, STEPS[4] + 0.8, FINALE - STEPS[4] - 0.8) * (1 - 0.7 * span(u, FINALE + 0.4, 1.5));
  });
  const uniforms = useDerivedValue(() => ({
    box: [box.x0, box.y0, box.x1, box.y1],
    level: level.value,
    time: ambient.value,
    slosh: slosh.value,
    boil: boil.value,
    col: col.value,
  }));
  // Rattling as it comes to the boil
  const rattle = useDerivedValue(() => {
    const b = boil.value * (t.value < FINALE ? 1 : Math.exp(-(t.value - FINALE) * 6));
    return [
      { translateX: Math.sin(ambient.value * 71) * 2.5 * b },
      { translateY: Math.cos(ambient.value * 63) * 2 * b },
    ];
  });
  const glowColour = useDerivedValue(() => rgbHex(col.value));
  const glowOn = useDerivedValue(() => 0.25 + 0.55 * level.value + 0.4 * boil.value);
  // The cork shooting out, spinning, falling away
  const cork = useDerivedValue(() => {
    const a = Math.max(0, t.value - FINALE);
    return [{ translateX: x1 - 10 + 260 * a }, { translateY: top + 4 - 620 * a + 900 * a * a }, { rotate: a * 14 }];
  });

  const popped = useDerivedValue(() => Math.max(0, t.value - FINALE));
  const mouth = { x: x1 + 6, y };
  return (
    <>
      <LateCanvas style={StyleSheet.absoluteFill}>
        <Group transform={rattle}>
          <Group opacity={glowOn}>
            <RoundedRect rect={tube} color={glowColour}>
              <BlurMask blur={26} style="normal" />
            </RoundedRect>
          </Group>
          <RoundedRect rect={tube} color="rgba(255,255,255,0.07)" />
          <Group clip={inner}>
            <Fill>
              <Shader source={BREW} uniforms={uniforms} />
            </Fill>
          </Group>
          {[0.2, 0.4, 0.6, 0.8].map((k) => (
            <Rect key={k} x={box.x0 + k * len} y={top + 9} width={2} height={12} color="rgba(255,255,255,0.4)" />
          ))}
          <RoundedRect rect={tube} style="stroke" strokeWidth={2.5} color="rgba(255,255,255,0.6)" />
          <RoundedRect x={x0 + 22} y={top + 8} width={x1 - x0 - 60} height={6} r={3} color="rgba(255,255,255,0.32)" />
          <RoundedRect x={x0 + 10} y={top + 16} width={6} height={H - 32} r={3} color="rgba(255,255,255,0.18)" />
        </Group>
        <Group transform={cork}>
          <RoundedRect x={0} y={0} width={CORK} height={H - 8} r={7}>
            <LinearGradient start={vec(0, 0)} end={vec(0, H - 8)} colors={['#C98D55', '#9A5F2E', '#6E3E19']} />
          </RoundedRect>
          {[8, 16, 24].map((cx) => (
            <Rect key={cx} x={cx} y={6} width={1.5} height={H - 20} color="rgba(60,30,10,0.35)" />
          ))}
        </Group>
      </LateCanvas>

      {INGREDIENTS.map((e, k) => (
        <Ingredient key={k} k={k} t={t} emoji={e} x={box.x0 + 0.2 * k * len + 18} y={y} />
      ))}
      {INGREDIENTS.map((_, k) => (
        <Splash key={k} k={k} t={t} x={box.x0 + 0.2 * k * len + 18} y={top + 8} />
      ))}

      <Smoke
        t={t}
        at={FINALE}
        x={mouth.x}
        y={mouth.y}
        colour="rgba(255, 170, 80, 0.8)"
        count={10}
        size={34}
        rise={220}
      />
      <Burst
        clock={popped}
        x={mouth.x}
        y={mouth.y}
        kind="sparkle"
        palette={['#FFFFFF', SPOOK.flame, SPOOK.pumpkin]}
        count={40}
        life={1.3}
        power={1.4}
      />
      <Flyers t={t} at={FINALE + 0.05} x={mouth.x - 20} y={mouth.y} items={['🦇']} count={12} kind="bats" size={30} />
      <Flyers
        t={t}
        at={FINALE + 0.25}
        x={mouth.x - 30}
        y={mouth.y - 10}
        items={['👻']}
        count={4}
        kind="ghosts"
        size={44}
      />
    </>
  );
}

/** Ingredient k dropping in from above, spinning, and sinking into the brew */
function Ingredient({ k, t, emoji, x, y }: { k: number; t: SharedValue<number>; emoji: string; x: number; y: number }) {
  const s = useAnimatedStyle(() => {
    const d = t.value - STEPS[k];
    if (d < 0 || d > POTION_LAG + 0.3) return { opacity: 0 };
    const fall = Math.min(1, d / POTION_LAG);
    const sink = span(d, POTION_LAG, 0.3);
    return {
      opacity: 1 - sink,
      transform: [
        { translateX: x - 22 },
        { translateY: y - 140 + 130 * fall * fall + sink * 10 - 22 },
        { rotate: `${(1 - fall) * 260 * (k % 2 ? -1 : 1)}deg` },
        { scale: 1 - 0.6 * sink },
      ],
    };
  });
  return <Animated.Text style={[styles.item, s]}>{emoji}</Animated.Text>;
}

/** The splash ingredient k makes going in */
function Splash({ k, t, x, y }: { k: number; t: SharedValue<number>; x: number; y: number }) {
  const since = useDerivedValue(() => Math.max(0, t.value - STEPS[k] - POTION_LAG));
  return (
    <Burst
      clock={since}
      x={x}
      y={y}
      kind="sparkle"
      palette={['#FFFFFF', SPOOK.toxic, '#D7FF8A']}
      count={18}
      life={0.8}
      power={0.8}
    />
  );
}

export const POTION_CUES: Cue[] = [
  ...STEPS.flatMap((s, k) => [
    { at: s, sound: 'whoosh' as const, gain: 0.3 },
    { at: s + POTION_LAG, sound: 'plop' as const, gain: 0.9, feel: 'medium' as const },
    { at: s + POTION_LAG + 0.08, sound: 'bubble' as const, gain: 0.25 + k * 0.05 },
  ]),
  { at: FINALE - 0.9, sound: 'bubble', gain: 0.8 },
  { at: FINALE - 0.45, sound: 'bubble', gain: 0.9, feel: 'light' },
  { at: FINALE, sound: 'cork', gain: 1, feel: 'heavy' },
  { at: FINALE + 0.05, sound: 'bats', gain: 0.8 },
  { at: FINALE + 0.3, sound: 'ghost', gain: 0.6 },
];

const styles = StyleSheet.create({
  item: { position: 'absolute', left: 0, top: 0, fontSize: 38, lineHeight: 44, width: 44, textAlign: 'center' },
});
