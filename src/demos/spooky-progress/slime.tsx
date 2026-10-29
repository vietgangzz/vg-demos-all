import { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';
import {
  BlurMask,
  Circle,
  Fill,
  Group,
  Oval,
  Path,
  RadialGradient,
  RoundedRect,
  rrect,
  Shader,
  Skia,
  vec,
} from 'react-native-skia';

import { LateCanvas } from '@/components/late-canvas';
import { outBack, span } from '../rank-up/ui';
import { FINALE, levelAt, SPOOK, STEPS } from './data';
import type { BarProps, Cue } from './types';

/**
 * The slime: the bar's a bone, hollow, and the bar's toxic slime oozing along inside it, glossy,
 * its front edge bulging and wobbling, a pair of eyes swimming in it watching where it's going,
 * drips stretching off its underside and falling. Each right answer it surges on with a squelch. Full,
 * it heaves up out of the middle of the bone into a blob with great goggling eyes, burps, and bursts:
 * slime splattered all over the screen, running down it.
 */

export const SLIME_LAG = 0.08;
const H = 34;
const RISE = FINALE;
const BURST = FINALE + 1.15;

const GOO = Skia.RuntimeEffect.Make(`
uniform float4 box;
uniform float level;
uniform float time;
uniform float surge;

half4 main(float2 px) {
  float w = box.z - box.x;
  float h = box.w - box.y;
  float2 q = (px - box.xy) / float2(w, h);
  float bulge = (5.0 + 8.0 * surge) * exp(-pow((q.y - 0.55) / 0.35, 2.0));
  float front = level * w + bulge + 3.0 * sin(q.y * 9.0 + time * 4.0) + 2.0 * sin(q.y * 17.0 - time * 6.0);
  float edge = front - q.x * w;
  if (edge < 0.0) return half4(0.0);
  float a = smoothstep(0.0, 1.5, edge);
  float3 c = mix(float3(0.18, 0.62, 0.11), float3(0.49, 0.94, 0.23), 1.0 - q.y);
  // Lit through from inside near its front
  c += float3(0.6, 1.0, 0.4) * 0.35 * exp(-edge / 10.0);
  // Glossy: a highlight along the top, and moving glints
  c += float3(1.0) * 0.45 * smoothstep(0.32, 0.18, abs(q.y - 0.22)) * (0.6 + 0.4 * sin(q.x * w * 0.05 - time * 2.0));
  c += float3(1.0) * 0.25 * smoothstep(0.92, 1.0, sin(q.x * w * 0.09 + time * 1.4 + q.y * 3.0));
  // Darker in its depths
  c *= 0.75 + 0.25 * sin(q.x * w * 0.03 + time) * q.y;
  return half4(half3(c) * a, a);
}`)!;

/** A splat of slime: an irregular blob with lobes, `r` across its half */
function splat(r: number, seed: number) {
  const b = Skia.PathBuilder.Make();
  const n = 40;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 1 + 0.22 * Math.sin(5 * a + seed) + 0.12 * Math.sin(9 * a + seed * 2) + 0.06 * Math.sin(17 * a + seed);
    const x = Math.cos(a) * r * k;
    const y = Math.sin(a) * r * k;
    if (i === 0) b.moveTo(x, y);
    else b.lineTo(x, y);
  }
  b.close();
  for (let i = 0; i < 5; i++) {
    const a = seed * 3 + i * 1.3;
    b.addCircle(Math.cos(a) * r * 1.5, Math.sin(a) * r * 1.5, r * (0.08 + 0.06 * ((i * 7) % 3)));
  }
  return b.detach();
}

const SPLATS = [
  { x: 0.18, y: 0.2, r: 46, seed: 1 },
  { x: 0.82, y: 0.15, r: 38, seed: 2.4 },
  { x: 0.1, y: 0.62, r: 34, seed: 3.1 },
  { x: 0.88, y: 0.55, r: 52, seed: 4.2 },
  { x: 0.55, y: 0.78, r: 40, seed: 5.5 },
  { x: 0.4, y: 0.1, r: 28, seed: 6.3 },
  { x: 0.7, y: 0.86, r: 30, seed: 7.7 },
];

export function Slime({ t, ambient, width, height, y }: BarProps) {
  const x0 = 46;
  const x1 = width - 46;
  const top = y - H / 2;
  const box = { x0: x0 + 5, y0: top + 5, x1: x1 - 5, y1: top + H - 5 };
  const len = box.x1 - box.x0;
  const track = rrect(Skia.XYWHRect(x0, top, x1 - x0, H), H / 2, H / 2);
  const inner = rrect(Skia.XYWHRect(box.x0, box.y0, len, box.y1 - box.y0), H / 2 - 5, H / 2 - 5);
  const splats = useMemo(() => SPLATS.map((s) => ({ ...s, path: splat(s.r, s.seed) })), []);

  const level = useDerivedValue(() => levelAt(t.value, SLIME_LAG));
  const surge = useDerivedValue(() => {
    let s = 0;
    for (let k = 0; k < 5; k++) s += Math.sin(Math.PI * span(t.value, STEPS[k] + SLIME_LAG, 0.6));
    return s;
  });
  const uniforms = useDerivedValue(() => ({
    box: [box.x0, box.y0, box.x1, box.y1],
    level: level.value,
    time: ambient.value,
    surge: surge.value,
  }));
  // The eyes swimming in it, near its front, looking ahead
  const eyes = useDerivedValue(() => {
    const fx = box.x0 + level.value * len - 26;
    const on = span(level.value, 0.08, 0.06);
    return [
      { translateX: Math.max(box.x0 + 14, fx) },
      { translateY: y + Math.sin(ambient.value * 2.3) * 3 },
      { scale: on },
    ];
  });
  const look = useDerivedValue(() => [{ translateX: 1.8 + Math.sin(ambient.value * 1.1) * 1 }]);

  // The blob heaving up out of the middle, goggling, burping, bursting
  const cx = width / 2;
  const blobY = y - 56;
  const blobR = useDerivedValue(() => {
    const u = t.value;
    const up = outBack(span(u, RISE, 0.55), 1.6);
    const burst = span(u, BURST, 0.12);
    return 46 * up * (1 + 0.6 * burst);
  });
  const blob = useDerivedValue(() => {
    const u = t.value;
    const d = u - RISE;
    const jiggle = d > 0 ? 0.1 * Math.sin(d * 14) * Math.exp(-d * 1.5) : 0;
    const burp = u - (FINALE + 0.65);
    const b = burp > 0 && burp < 0.4 ? Math.sin((Math.PI * burp) / 0.4) * 0.12 : 0;
    return [
      { translateX: cx },
      { translateY: blobY + (1 - Math.min(1, d / 0.4)) * 60 },
      { scaleX: 1 + jiggle + b },
      { scaleY: 1 - jiggle - b * 0.5 },
    ];
  });
  const blobOn = useDerivedValue(() => (t.value > RISE && t.value < BURST + 0.12 ? 1 : 0));
  const neck = useDerivedValue(() => (t.value > RISE ? Math.max(0, y - blobY - 20) * span(t.value, RISE, 0.3) : 0));
  const goggle = useDerivedValue(() => [{ scale: outBack(span(t.value, RISE + 0.3, 0.3), 3) }]);
  const pupils = useDerivedValue(() => {
    const a = ambient.value;
    return [{ translateX: Math.sin(a * 3.1) * 4 }, { translateY: Math.cos(a * 2.3) * 3 }];
  });
  const mouth = useDerivedValue(() => {
    const burp = t.value - (FINALE + 0.65);
    const open = burp > 0 && burp < 0.45 ? Math.sin((Math.PI * burp) / 0.45) : 0.15;
    return [{ scaleY: open }];
  });
  const splatOn = useDerivedValue(() => span(t.value, BURST, 0.05));

  return (
    <>
      <LateCanvas style={StyleSheet.absoluteFill}>
        {splats.map((s, i) => (
          <Splat key={i} i={i} t={t} x={s.x * width} y={s.y * height} r={s.r} path={s.path} on={splatOn} />
        ))}

        {[x0 - 2, x1 + 2].map((bx) => (
          <Group key={bx}>
            <Circle cx={bx} cy={y - 12} r={14} color={SPOOK.bone} />
            <Circle cx={bx} cy={y + 12} r={14} color={SPOOK.bone} />
          </Group>
        ))}
        <RoundedRect rect={track} color={SPOOK.bone} />
        <RoundedRect rect={inner} color="#170F1F" />
        <RoundedRect x={x0 + 16} y={top + 2} width={x1 - x0 - 32} height={3} r={1.5} color="rgba(255,255,255,0.55)" />

        {Array.from({ length: 7 }, (_, i) => (
          <Drip
            key={i}
            i={i}
            t={t}
            ambient={ambient}
            level={level}
            x={box.x0 + ((i + 0.6) / 7.4) * len}
            y={top + H - 4}
          />
        ))}

        <Group clip={inner}>
          <Fill>
            <Shader source={GOO} uniforms={uniforms} />
          </Fill>
          <Group transform={eyes}>
            {[-7, 7].map((dx) => (
              <Group key={dx}>
                <Circle cx={dx} cy={0} r={6.5} color="#FFFFFF" />
                <Group transform={look}>
                  <Circle cx={dx} cy={0.5} r={3.2} color={SPOOK.ink} />
                </Group>
              </Group>
            ))}
          </Group>
        </Group>

        <Group opacity={blobOn}>
          <RoundedRect x={cx - 22} y={blobY + 20} width={44} height={neck} r={18} color="#45B522" />
          <Group transform={blob}>
            <Circle cx={0} cy={0} r={blobR} color="rgba(124,240,58,0.6)">
              <BlurMask blur={18} style="normal" />
            </Circle>
            <Circle cx={0} cy={0} r={blobR}>
              <RadialGradient c={vec(-20, -26)} r={90} colors={['#C8FF8C', '#6BE02E', '#2B8F16']} />
            </Circle>
            <Oval x={-34} y={-50} width={30} height={16} color="rgba(255,255,255,0.45)" />
            <Group transform={goggle}>
              {[-22, 22].map((dx) => (
                <Group key={dx}>
                  <Circle cx={dx} cy={-14} r={17} color="#FFFFFF" />
                  <Group transform={pupils}>
                    <Circle cx={dx} cy={-12} r={8} color={SPOOK.ink} />
                    <Circle cx={dx - 3} cy={-16} r={2.5} color="#FFFFFF" />
                  </Group>
                </Group>
              ))}
              <Group transform={[{ translateY: 22 }]}>
                <Group transform={mouth}>
                  <Oval x={-18} y={-12} width={36} height={24} color="#123D08" />
                </Group>
              </Group>
            </Group>
          </Group>
        </Group>
      </LateCanvas>
    </>
  );
}

/** Drip i off the slime's underside, once the slime's reached it: stretching, falling, splashing */
function Drip({
  i,
  t,
  ambient,
  level,
  x,
  y,
}: {
  i: number;
  t: SharedValue<number>;
  ambient: SharedValue<number>;
  level: SharedValue<number>;
  x: number;
  y: number;
}) {
  const reach = (i + 0.6) / 7.4;
  const phase = useDerivedValue(() => (ambient.value / (1.4 + (i % 3) * 0.35) + i * 0.37) % 1);
  const on = useDerivedValue(() => (level.value > reach + 0.03 && t.value < BURST ? 1 : 0));
  const hang = useDerivedValue(() => {
    const p = phase.value;
    return p < 0.55 ? 4 + 16 * (p / 0.55) : 0;
  });
  const dropY = useDerivedValue(() => {
    const p = phase.value;
    if (p < 0.55) return -100;
    const a = (p - 0.55) * 1.6;
    return y + 20 + 300 * a * a;
  });
  const dropOn = useDerivedValue(() => (phase.value >= 0.55 ? on.value * (1 - (phase.value - 0.55) / 0.45) : 0));
  const tip = useDerivedValue(() => y - 2 + hang.value);
  return (
    <Group opacity={on}>
      <RoundedRect x={x - 4} y={y - 2} width={8} height={hang} r={4} color="#3DAA1E" />
      <Circle cx={x} cy={tip} r={4.5} color="#4CC423" />
      <Group opacity={dropOn}>
        <Circle cx={x} cy={dropY} r={4} color="#5CD62A" />
      </Group>
    </Group>
  );
}

/** Splat i on the screen once the blob bursts, slapping on and running down */
function Splat({
  i,
  t,
  x,
  y,
  r,
  path,
  on,
}: {
  i: number;
  t: SharedValue<number>;
  x: number;
  y: number;
  r: number;
  path: ReturnType<typeof splat>;
  on: SharedValue<number>;
}) {
  const move = useDerivedValue(() => {
    const d = t.value - BURST - i * 0.03;
    return [{ translateX: x }, { translateY: y }, { scale: d > 0 ? outBack(Math.min(1, d / 0.18), 2.5) : 0 }];
  });
  const run = useDerivedValue(() => {
    const d = Math.max(0, t.value - BURST - 0.3);
    return Math.min(r * 2.4, d * 40);
  });
  const fade = useDerivedValue(() => on.value * (1 - span(t.value, BURST + 2.2, 0.8)));
  return (
    <Group opacity={fade}>
      <RoundedRect x={x - r * 0.18} y={y} width={r * 0.36} height={run} r={r * 0.18} color="rgba(92,214,42,0.85)" />
      <Group transform={move}>
        <Path path={path} color="rgba(92,214,42,0.88)" />
        <Path
          path={path}
          color="rgba(200,255,140,0.35)"
          transform={[{ translateX: -r * 0.12 }, { translateY: -r * 0.14 }, { scale: 0.55 }]}
        />
      </Group>
    </Group>
  );
}

export const SLIME_CUES: Cue[] = [
  ...STEPS.flatMap((s) => [
    { at: s + SLIME_LAG, sound: 'squelch' as const, gain: 0.9, feel: 'medium' as const },
    { at: s + SLIME_LAG + 0.5, sound: 'drip' as const, gain: 0.5 },
  ]),
  { at: RISE, sound: 'squelch', gain: 1, feel: 'heavy' },
  { at: FINALE + 0.65, sound: 'boo', gain: 0.6, feel: 'medium' },
  { at: BURST, sound: 'splat', gain: 1, feel: 'heavy' },
  { at: BURST + 0.08, sound: 'splat', gain: 0.6 },
  { at: BURST + 0.4, sound: 'drip', gain: 0.6 },
];
