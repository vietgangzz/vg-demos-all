import { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';
import {
  Atlas,
  BlurMask,
  Circle,
  DashPathEffect,
  Group,
  Oval,
  Path,
  RadialGradient,
  RoundedRect,
  Skia,
  type SkImage,
  useRectBuffer,
  useRSXformBuffer,
  vec,
} from 'react-native-skia';

import { LateCanvas } from '@/components/late-canvas';
import { Burst } from '../daily-drop/fx';
import { mix, span } from '../rank-up/ui';
import { FINALE, levelAt, SPOOK, STEPS } from './data';
import { Flyers, Smoke } from './fx';
import type { BarProps, Cue } from './types';

/**
 * The fuse: the bar's a braided fuse snaking across to a black pumpkin bomb, its face carved and
 * grinning. Each right answer the spark surges along it, spitting sparks, the fuse burnt to ash
 * behind it. The bomb shivers more the nearer it gets. At the end the spark disappears into the
 * bomb, which swells, glowing hotter and hotter, and goes off: a flash, a ring of blast, the bomb
 * gone, and a shower of sweets.
 */

export const FUSE_LAG = 0;
const SAMPLES = 160;
const SPARKS = 40;
const CELL = 24;

let sheet: SkImage | null = null;
/** A spark: a white-hot dot in an orange halo */
function spark() {
  if (sheet) return sheet;
  const surface = Skia.Surface.Make(CELL, CELL);
  if (!surface) return null;
  const canvas = surface.getCanvas();
  const paint = Skia.Paint();
  paint.setAntiAlias(true);
  const c = CELL / 2;
  paint.setShader(
    Skia.Shader.MakeRadialGradient(
      vec(c, c),
      c,
      [Skia.Color('#FFFFFF'), Skia.Color('#FFD34D'), Skia.Color('rgba(255,122,26,0)')],
      [0, 0.3, 1],
      0
    )
  );
  canvas.drawCircle(c, c, c, paint);
  surface.flush();
  sheet = surface.makeImageSnapshot();
  return sheet;
}

const rnd = (i: number, k: number) => {
  'worklet';
  const s = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return s - Math.floor(s);
};

/** A four-pointed star, for the spark's head */
function star(r: number) {
  const b = Skia.PathBuilder.Make();
  b.moveTo(0, -r);
  b.quadTo(0, 0, r, 0);
  b.quadTo(0, 0, 0, r);
  b.quadTo(0, 0, -r, 0);
  b.quadTo(0, 0, 0, -r);
  b.close();
  return b.detach();
}

/** The bomb's grin */
function grin(r: number) {
  const b = Skia.PathBuilder.Make();
  const tri = (x: number, y: number, w: number, h: number) => {
    b.moveTo(x - w / 2, y + h / 2);
    b.lineTo(x + w / 2, y + h / 2);
    b.lineTo(x, y - h / 2);
    b.close();
  };
  tri(-r * 0.34, -r * 0.12, r * 0.3, r * 0.28);
  tri(r * 0.34, -r * 0.12, r * 0.3, r * 0.28);
  b.moveTo(-r * 0.52, r * 0.2);
  for (let i = 0; i <= 6; i++) b.lineTo(-r * 0.52 + (i * r * 1.04) / 6, r * (0.2 + (i % 2 ? 0.1 : 0)));
  b.quadTo(0, r * 0.75, -r * 0.52, r * 0.2);
  b.close();
  return b.detach();
}

export function Fuse({ t, ambient, width, y }: BarProps) {
  const B = 36;
  const bomb = { x: width - 58, y: y + 6 };
  const shapes = useMemo(() => {
    const b = Skia.PathBuilder.Make();
    b.moveTo(26, y + 10);
    b.cubicTo(width * 0.3, y - 30, width * 0.55, y + 44, bomb.x - B * 0.7, bomb.y - B * 0.72);
    const rope = b.detach();
    const xs: number[] = [];
    const ys: number[] = [];
    const it = Skia.ContourMeasureIter(rope, false, 1);
    const c = it.next();
    if (c) {
      const len = c.length();
      for (let i = 0; i <= SAMPLES; i++) {
        const [p] = c.getPosTan((i / SAMPLES) * len);
        xs.push(p.x);
        ys.push(p.y);
      }
    }
    return { rope, xs, ys, star: star(16), grin: grin(B) };
  }, [width, y, bomb.x, bomb.y]);
  const { xs, ys } = shapes;
  const image = useMemo(() => spark(), []);

  const level = useDerivedValue(() => levelAt(t.value, FUSE_LAG));
  /** Where on the fuse the spark is when it's `k` (0 to 1) of the way */
  const pointAt = (k: number) => {
    'worklet';
    const f = Math.min(1, Math.max(0, k)) * SAMPLES;
    const i = Math.min(SAMPLES - 1, Math.floor(f));
    const e = f - i;
    return { x: mix(xs[i], xs[i + 1], e), y: mix(ys[i], ys[i + 1], e) };
  };
  const burning = useDerivedValue(() => (t.value < FINALE - 0.25 ? 1 : 0));
  const head = useDerivedValue(() => pointAt(level.value));
  const headMove = useDerivedValue(() => [
    { translateX: head.value.x },
    { translateY: head.value.y },
    { rotate: ambient.value * 9 },
    { scale: 0.8 + 0.35 * Math.sin(ambient.value * 37) * Math.sin(ambient.value * 23) },
  ]);
  const burnt = useDerivedValue(() => Math.max(0.001, level.value));
  const ember = useDerivedValue(() => Math.max(0, level.value - 0.05));

  // The sparks it spits: each one shed from wherever the head was when it left
  const cells = useRectBuffer(SPARKS, (r) => {
    'worklet';
    r.setXYWH(0, 0, CELL, CELL);
  });
  const sparks = useRSXformBuffer(SPARKS, (val, i) => {
    'worklet';
    const life = 0.5;
    const u = t.value;
    const phase = (ambient.get() * 2.4 + i / SPARKS) % 1;
    const age = phase * life;
    const born = u - age;
    let surge = 0;
    for (let k = 0; k < 5; k++) surge += Math.sin(Math.PI * span(born, STEPS[k], 0.55));
    if (born < STEPS[0] - 0.4 || born > FINALE - 0.25 || (surge < 0.05 && rnd(i, 9) > 0.45)) {
      val.set(0, 0, -999, -999);
      return;
    }
    const k = levelAt(born, 0);
    const o = pointAt(k);
    const cycle = Math.floor(ambient.get() * 2.4 + i / SPARKS);
    const ang = -Math.PI / 2 + (rnd(i + cycle * 7, 1) - 0.5) * 3;
    const v = (90 + rnd(i, 2) * 180) * (1 + surge);
    const x = o.x + Math.cos(ang) * v * age;
    const y2 = o.y + Math.sin(ang) * v * age + 420 * age * age;
    const s = (0.35 + rnd(i, 3) * 0.5) * (1 - phase);
    val.set(s, 0, x - (CELL / 2) * s, y2 - (CELL / 2) * s);
  });

  // The bomb: shivering as the spark nears, swelling and glowing at the end, then gone
  const bombMove = useDerivedValue(() => {
    const u = t.value;
    const near = span(level.value, 0.55, 0.45);
    const hot = span(u, STEPS[4] + 0.5, FINALE - STEPS[4] - 0.5);
    const shake = (near * 1.5 + hot * 4) * Math.sin(ambient.value * 60);
    return [
      { translateX: bomb.x + shake },
      { translateY: bomb.y + Math.cos(ambient.value * 53) * shake * 0.6 },
      { scale: 1 + 0.35 * hot * hot + 0.05 * hot * Math.sin(ambient.value * 30) },
    ];
  });
  const hot = useDerivedValue(() => span(t.value, STEPS[4] + 0.5, FINALE - STEPS[4] - 0.5));
  const bombOn = useDerivedValue(() => (t.value < FINALE ? 1 : 0));
  const grinGlow = useDerivedValue(() => 0.55 + 0.45 * hot.value + 0.1 * Math.sin(ambient.value * 13));
  const ring = useDerivedValue(() => {
    const a = t.value - FINALE;
    return a > 0 ? 20 + 520 * (1 - Math.exp(-a * 3.2)) : 0;
  });
  const ringOn = useDerivedValue(() => {
    const a = t.value - FINALE;
    return a > 0 ? Math.max(0, 1 - a / 0.9) : 0;
  });
  const done = useDerivedValue(() => Math.max(0, t.value - FINALE));

  if (!image) return null;
  return (
    <>
      <LateCanvas style={StyleSheet.absoluteFill}>
        <Path path={shapes.rope} style="stroke" strokeWidth={8} strokeCap="round" color="#5A3418" />
        <Path path={shapes.rope} style="stroke" strokeWidth={8} color="#B07A43">
          <DashPathEffect intervals={[4, 5]} />
        </Path>
        <Path path={shapes.rope} style="stroke" strokeWidth={8.5} strokeCap="round" color="#231C20" end={burnt} />
        <Path
          path={shapes.rope}
          style="stroke"
          strokeWidth={6}
          strokeCap="round"
          color={SPOOK.pumpkin}
          start={ember}
          end={burnt}>
          <BlurMask blur={3} style="solid" />
        </Path>

        <Group transform={bombMove} opacity={bombOn}>
          <Oval x={-B} y={B * 0.75} width={B * 2} height={B * 0.4} color="rgba(0,0,0,0.45)">
            <BlurMask blur={6} style="normal" />
          </Oval>
          <Group opacity={hot}>
            <Circle cx={0} cy={0} r={B * 1.3} color="rgba(255,80,30,0.65)">
              <BlurMask blur={22} style="normal" />
            </Circle>
          </Group>
          <Circle cx={0} cy={0} r={B}>
            <RadialGradient c={vec(-B * 0.35, -B * 0.4)} r={B * 1.4} colors={['#5B4670', '#241830', '#0D0812']} />
          </Circle>
          <Oval x={-B * 0.6} y={-B * 0.78} width={B * 0.5} height={B * 0.3} color="rgba(255,255,255,0.22)" />
          <Group transform={[{ translateX: -B * 0.62 }, { translateY: -B * 0.62 }, { rotate: -0.78 }]}>
            <RoundedRect x={-9} y={-8} width={18} height={14} r={3} color="#3E3448" />
            <RoundedRect x={-9} y={-8} width={18} height={4} r={2} color="#5E5268" />
          </Group>
          <Group opacity={grinGlow}>
            <Path path={shapes.grin} color={SPOOK.flame}>
              <BlurMask blur={5} style="solid" />
            </Path>
            <Path path={shapes.grin}>
              <RadialGradient c={vec(0, 0)} r={B * 0.8} colors={['#FFF6C8', SPOOK.flame, SPOOK.pumpkin]} />
            </Path>
          </Group>
        </Group>

        <Atlas image={image} sprites={cells} transforms={sparks} />
        <Group opacity={burning}>
          <Group transform={headMove}>
            <Circle cx={0} cy={0} r={18} color="rgba(255,160,40,0.55)">
              <BlurMask blur={10} style="normal" />
            </Circle>
            <Path path={shapes.star} color="#FFF3C4" />
            <Circle cx={0} cy={0} r={4} color="#FFFFFF" />
          </Group>
        </Group>

        <Group opacity={ringOn}>
          <Circle cx={bomb.x} cy={bomb.y} r={ring} style="stroke" strokeWidth={10} color={SPOOK.flame}>
            <BlurMask blur={6} style="solid" />
          </Circle>
        </Group>
      </LateCanvas>

      {STEPS.map((s, k) => (
        <Surge key={k} k={k} t={t} at={s} pointAt={pointAt} />
      ))}
      <Smoke
        t={t}
        at={FINALE}
        x={bomb.x}
        y={bomb.y}
        colour="rgba(120, 100, 130, 0.85)"
        count={12}
        size={44}
        rise={180}
        life={2.2}
      />
      <Burst
        clock={done}
        x={bomb.x}
        y={bomb.y}
        kind="sparkle"
        palette={['#FFFFFF', SPOOK.flame, SPOOK.pumpkin]}
        count={50}
        life={1.4}
        power={1.9}
      />
      <Flyers
        t={t}
        at={FINALE}
        x={bomb.x}
        y={bomb.y}
        items={['🍬', '🍭', '🍫', '🍩', '🧁', '🍪']}
        count={26}
        kind="burst"
        size={32}
        power={1.1}
      />
    </>
  );
}

/** A puff of smoke and sparks where the spark surges off from on answer k */
function Surge({
  k,
  t,
  at,
  pointAt,
}: {
  k: number;
  t: SharedValue<number>;
  at: number;
  pointAt: (k: number) => { x: number; y: number };
}) {
  const p = pointAt(k * 0.2);
  const since = useDerivedValue(() => Math.max(0, t.value - at));
  return (
    <>
      <Smoke t={t} at={at} x={p.x} y={p.y} colour="rgba(140, 125, 150, 0.6)" count={4} size={16} rise={60} life={1.2} />
      <Burst
        clock={since}
        x={p.x}
        y={p.y}
        kind="sparkle"
        palette={['#FFFFFF', SPOOK.flame, SPOOK.pumpkin]}
        count={14}
        life={0.6}
        power={0.6}
      />
    </>
  );
}

export const FUSE_CUES: Cue[] = [
  ...STEPS.map((s) => ({ at: s, sound: 'sizzle' as const, gain: 0.7, feel: 'light' as const })),
  { at: STEPS[4] + 0.55, sound: 'sizzle', gain: 0.9, feel: 'light' },
  { at: FINALE, sound: 'boom', gain: 1, feel: 'heavy' },
  { at: FINALE + 0.12, sound: 'candy', gain: 0.8, feel: 'heavy' },
];
