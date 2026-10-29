import { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';
import {
  BlurMask,
  ColorMatrix,
  Group,
  Oval,
  Path,
  RadialGradient,
  RoundedRect,
  Skia,
  type SkPath,
  vec,
} from 'react-native-skia';

import { LateCanvas } from '@/components/late-canvas';
import { Burst } from '../daily-drop/fx';
import { mix, span } from '../rank-up/ui';
import { FINALE, levelAt, SPOOK, STEPS } from './data';
import { Flyers } from './fx';
import type { BarProps, Cue } from './types';

/**
 * The pumpkins: the bar's five pumpkins in a row on a vine, dull and dark. Each right answer a knife
 * flashes across the next one and its face is carved, then a candle catches inside and it lights up,
 * jumping, seeds flying, the vine glowing along to it, each face a different mood. All five lit, their
 * candles flare up into ghostly green fire, flames leaping off their tops, the row jumping in a wave,
 * bats bursting out from behind them.
 */

export const PUMPKIN_LAG = 0.25;
/** The knife's moment, then the candle's */
const carveAt = (k: number) => {
  'worklet';
  return STEPS[k] + 0.04;
};
const lightAt = (k: number) => {
  'worklet';
  return STEPS[k] + PUMPKIN_LAG;
};

/** The five faces, each drawn about the pumpkin's middle for a pumpkin `r` across its half */
function face(k: number, r: number): SkPath {
  const b = Skia.PathBuilder.Make();
  const tri = (x: number, y: number, w: number, h: number, tilt = 0) => {
    b.moveTo(x - w / 2, y + h / 2 + tilt);
    b.lineTo(x + w / 2, y + h / 2 - tilt);
    b.lineTo(x, y - h / 2);
    b.close();
  };
  const ey = -r * 0.18;
  const ex = r * 0.34;
  if (k === 0) {
    tri(-ex, ey, r * 0.34, r * 0.3);
    tri(ex, ey, r * 0.34, r * 0.3);
    // A wide smile
    b.moveTo(-r * 0.5, r * 0.18);
    b.quadTo(0, r * 0.62, r * 0.5, r * 0.18);
    b.quadTo(0, r * 0.4, -r * 0.5, r * 0.18);
    b.close();
  } else if (k === 1) {
    b.addOval(Skia.XYWHRect(-ex - r * 0.14, ey - r * 0.14, r * 0.28, r * 0.28));
    b.addOval(Skia.XYWHRect(ex - r * 0.14, ey - r * 0.14, r * 0.28, r * 0.28));
    // A zigzag grin
    b.moveTo(-r * 0.48, r * 0.16);
    const teeth = 5;
    for (let i = 0; i <= teeth; i++) b.lineTo(-r * 0.48 + (i * r * 0.96) / teeth, r * (i % 2 ? 0.3 : 0.16));
    b.lineTo(r * 0.4, r * 0.42);
    b.quadTo(0, r * 0.56, -r * 0.4, r * 0.42);
    b.close();
  } else if (k === 2) {
    // Angry: slanted eyes, a mouth with two fangs
    tri(-ex, ey, r * 0.36, r * 0.26, r * 0.08);
    tri(ex, ey, r * 0.36, r * 0.26, -r * 0.08);
    b.moveTo(-r * 0.46, r * 0.2);
    b.lineTo(-r * 0.22, r * 0.2);
    b.lineTo(-r * 0.16, r * 0.34);
    b.lineTo(-r * 0.1, r * 0.2);
    b.lineTo(r * 0.1, r * 0.2);
    b.lineTo(r * 0.16, r * 0.34);
    b.lineTo(r * 0.22, r * 0.2);
    b.lineTo(r * 0.46, r * 0.2);
    b.quadTo(0, r * 0.62, -r * 0.46, r * 0.2);
    b.close();
  } else if (k === 3) {
    // A wink and a lopsided grin
    tri(-ex, ey, r * 0.3, r * 0.32);
    b.moveTo(ex - r * 0.17, ey + r * 0.02);
    b.quadTo(ex, ey - r * 0.12, ex + r * 0.17, ey + r * 0.02);
    b.quadTo(ex, ey - r * 0.04, ex - r * 0.17, ey + r * 0.02);
    b.close();
    b.moveTo(-r * 0.4, r * 0.26);
    b.quadTo(r * 0.1, r * 0.66, r * 0.48, r * 0.12);
    b.quadTo(r * 0.06, r * 0.44, -r * 0.4, r * 0.26);
    b.close();
  } else {
    // A huge grin, all teeth
    tri(-ex, ey - r * 0.02, r * 0.3, r * 0.36);
    tri(ex, ey - r * 0.02, r * 0.3, r * 0.36);
    tri(0, r * 0.03, r * 0.14, r * 0.14);
    b.moveTo(-r * 0.56, r * 0.14);
    for (let i = 0; i <= 8; i++) b.lineTo(-r * 0.56 + (i * r * 1.12) / 8, r * (0.14 + (i % 2 ? 0.1 : 0)));
    b.quadTo(0, r * 0.82, -r * 0.56, r * 0.14);
    b.close();
  }
  return b.detach();
}

/** A tongue of flame, its base at (0, 0), pointing up */
function tongue(r: number): SkPath {
  const b = Skia.PathBuilder.Make();
  b.moveTo(-r * 0.32, 0);
  b.cubicTo(-r * 0.46, -r * 0.5, -r * 0.05, -r * 0.7, 0, -r * 1.3);
  b.cubicTo(r * 0.08, -r * 0.7, r * 0.46, -r * 0.5, r * 0.32, 0);
  b.quadTo(0, r * 0.2, -r * 0.32, 0);
  b.close();
  return b.detach();
}

export function Pumpkins({ t, ambient, width, y }: BarProps) {
  const span5 = (width - 40) / 5;
  const R = Math.min(34, span5 / 2 - 3);
  const xs = Array.from({ length: 5 }, (_, k) => 20 + (k + 0.5) * span5);
  const level = useDerivedValue(() => levelAt(t.value, PUMPKIN_LAG));
  const vine = useMemo(() => {
    const b = Skia.PathBuilder.Make();
    const vy = y + R * 0.9;
    b.moveTo(6, vy - 6);
    for (let k = 0; k < 5; k++) {
      const x = xs[k];
      b.quadTo(x - span5 * 0.25, vy + 10, x, vy);
      b.quadTo(x + span5 * 0.25, vy - 10, x + span5 / 2, vy);
    }
    b.lineTo(width - 6, vy - 4);
    return b.detach();
  }, [width, y, R, span5, xs]);
  const vineLit = useDerivedValue(() => Math.min(1, 0.04 + level.value * 0.94));
  const vineGreen = useDerivedValue(() => span(t.value, FINALE, 0.3));
  const done = useDerivedValue(() => Math.max(0, t.value - FINALE));
  return (
    <>
      <LateCanvas style={StyleSheet.absoluteFill}>
        <Path path={vine} style="stroke" strokeWidth={5} strokeCap="round" color="#2F4A17" />
        <Path path={vine} style="stroke" strokeWidth={6} strokeCap="round" color={SPOOK.flame} end={vineLit}>
          <BlurMask blur={6} style="normal" />
        </Path>
        <Group opacity={vineGreen}>
          <Path path={vine} style="stroke" strokeWidth={6} strokeCap="round" color={SPOOK.toxic}>
            <BlurMask blur={8} style="normal" />
          </Path>
        </Group>
        {xs.map((x, k) => (
          <Pumpkin key={k} k={k} t={t} ambient={ambient} x={x} y={y} r={R} />
        ))}
      </LateCanvas>
      {xs.map((x, k) => (
        <Seeds key={k} k={k} t={t} x={x} y={y} />
      ))}
      <Burst
        clock={done}
        x={width / 2}
        y={y - R}
        kind="sparkle"
        palette={['#FFFFFF', SPOOK.toxic, '#D7FF8A']}
        count={44}
        life={1.4}
        power={1.6}
      />
      <Flyers t={t} at={FINALE + 0.1} x={width / 2} y={y} items={['🦇']} count={14} kind="bats" size={30} />
      <Flyers t={t} at={FINALE + 0.3} x={width / 2} y={y - 20} items={['👻']} count={3} kind="ghosts" size={42} />
    </>
  );
}

function Pumpkin({
  k,
  t,
  ambient,
  x,
  y,
  r,
}: {
  k: number;
  t: SharedValue<number>;
  ambient: SharedValue<number>;
  x: number;
  y: number;
  r: number;
}) {
  const mouth = useMemo(() => face(k, r), [k, r]);
  const flame = useMemo(() => tongue(r), [r]);
  // Lit, and the green fire at the end
  const lit = useDerivedValue(() => span(t.value, lightAt(k), 0.18));
  const ghostly = useDerivedValue(() => span(t.value, FINALE + k * 0.07, 0.25));
  const carved = useDerivedValue(() => span(t.value, carveAt(k) + 0.1, 0.08));
  // Dull until it's lit, glowing from inside once it is
  const shade = useDerivedValue(() => {
    const m = mix(0.38, 1.08, lit.value);
    const g = ghostly.value;
    return [
      m * (1 - 0.25 * g),
      0,
      0,
      0,
      0.02 * (1 - lit.value),
      0,
      m,
      0,
      0,
      0.12 * g,
      0,
      0,
      m,
      0,
      0.06 * (1 - lit.value),
      0,
      0,
      0,
      1,
      0,
    ];
  });
  // Jumping as it's lit, and again in the wave at the end
  const body = useDerivedValue(() => {
    const u = t.value;
    const d = u - lightAt(k);
    const squash = d > 0 ? 0.16 * Math.exp(-d * 6) * Math.cos(d * 20) : 0;
    const hop = d > 0 && d < 0.45 ? Math.sin((Math.PI * d) / 0.45) * 16 : 0;
    const w = u - FINALE - k * 0.08;
    const wave = w > 0 ? Math.abs(Math.sin(w * 7)) * 22 * Math.exp(-w * 1.2) : 0;
    return [{ translateX: x }, { translateY: y - hop - wave }, { scaleX: 1 + squash }, { scaleY: 1 - squash }];
  });
  const flicker = useDerivedValue(() => {
    const a = ambient.value;
    return lit.value * (0.82 + 0.1 * Math.sin(a * 13 + k * 2) + 0.08 * Math.sin(a * 29 + k));
  });
  const fire = useDerivedValue(() => ghostly.value * (0.85 + 0.15 * Math.sin(ambient.value * 21 + k)));
  const fireShape = useDerivedValue(() => {
    const a = ambient.value;
    return [
      { translateY: -r * 0.86 },
      { scaleX: 0.9 + 0.12 * Math.sin(a * 17 + k) },
      { scaleY: (0.3 + 0.9 * ghostly.value) * (0.9 + 0.2 * Math.sin(a * 23 + k * 3)) },
      { skewX: 0.15 * Math.sin(a * 9 + k) },
    ];
  });
  // The knife flashing across it
  const slash = useDerivedValue(() => {
    const k2 = span(t.value, carveAt(k), 0.16);
    return k2 > 0 && k2 < 1 ? 1 - Math.abs(k2 * 2 - 1) : 0;
  });
  const slashMove = useDerivedValue(() => {
    const k2 = span(t.value, carveAt(k), 0.16);
    return [{ translateX: mix(-r * 1.1, r * 1.1, k2) }, { translateY: mix(-r * 0.7, r * 0.5, k2) }, { rotate: 0.6 }];
  });
  const ribs = [
    { dx: -0.6, w: 0.62 },
    { dx: 0.6, w: 0.62 },
    { dx: -0.3, w: 0.72 },
    { dx: 0.3, w: 0.72 },
    { dx: 0, w: 0.74 },
  ];
  const h = r * 1.72;
  return (
    <Group transform={body}>
      <Group opacity={flicker}>
        <Oval x={-r * 1.5} y={-r * 1.3} width={r * 3} height={r * 2.6} color="rgba(255, 170, 60, 0.4)">
          <BlurMask blur={r * 0.6} style="normal" />
        </Oval>
      </Group>
      <Group opacity={fire}>
        <Group transform={fireShape}>
          <Path path={flame} color={SPOOK.toxic}>
            <BlurMask blur={r * 0.25} style="normal" />
          </Path>
          <Path path={flame} color="#E8FFC2" transform={[{ scale: 0.55 }]} />
        </Group>
      </Group>
      <Group>
        <ColorMatrix matrix={shade} />
        {ribs.map((rib, i) => (
          <Oval key={i} x={rib.dx * r - rib.w * r} y={-h / 2} width={rib.w * r * 2} height={h}>
            <RadialGradient
              c={vec(rib.dx * r - rib.dx * r * 0.3, -h * 0.2)}
              r={r * 1.1}
              colors={[SPOOK.pumpkinLight, SPOOK.pumpkin, SPOOK.pumpkinDeep]}
              positions={[0, 0.55, 1]}
            />
          </Oval>
        ))}
        <RoundedRect
          x={-r * 0.1}
          y={-h / 2 - r * 0.32}
          width={r * 0.2}
          height={r * 0.42}
          r={r * 0.07}
          color="#4E6B22"
        />
      </Group>
      <Group opacity={carved}>
        <Path path={mouth} color="#2A0C02" />
      </Group>
      <Group opacity={flicker}>
        <Path path={mouth} color={SPOOK.flame}>
          <BlurMask blur={6} style="solid" />
        </Path>
        <Path path={mouth}>
          <RadialGradient c={vec(0, 0)} r={r * 0.7} colors={['#FFF6C8', SPOOK.flame, SPOOK.pumpkin]} />
        </Path>
      </Group>
      <Group opacity={ghostly}>
        <Path path={mouth}>
          <RadialGradient c={vec(0, 0)} r={r * 0.7} colors={['#F2FFD8', SPOOK.toxic, SPOOK.toxicDeep]} />
        </Path>
      </Group>
      <Group opacity={slash} transform={slashMove}>
        <RoundedRect x={-r * 0.5} y={-1.5} width={r} height={3} r={1.5} color="#FFFFFF">
          <BlurMask blur={2} style="solid" />
        </RoundedRect>
      </Group>
    </Group>
  );
}

/** Seeds and sparks flying as pumpkin k lights */
function Seeds({ k, t, x, y }: { k: number; t: SharedValue<number>; x: number; y: number }) {
  const since = useDerivedValue(() => Math.max(0, t.value - lightAt(k)));
  return (
    <Burst
      clock={since}
      x={x}
      y={y - 10}
      kind="sparkle"
      palette={['#FFFFFF', SPOOK.flame, SPOOK.pumpkinLight]}
      count={16}
      life={0.8}
      power={0.75}
    />
  );
}

export const PUMPKIN_CUES: Cue[] = [
  ...STEPS.flatMap((_, k) => [
    { at: carveAt(k), sound: 'carve' as const, gain: 0.8, feel: 'light' as const },
    { at: lightAt(k), sound: 'ignite' as const, gain: 0.7, feel: 'medium' as const },
  ]),
  { at: FINALE, sound: 'ignite', gain: 1, feel: 'heavy' },
  { at: FINALE + 0.1, sound: 'bats', gain: 0.8 },
  { at: FINALE + 0.35, sound: 'ghost', gain: 0.5 },
];
