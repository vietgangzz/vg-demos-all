import { useMemo } from 'react';
import { StyleSheet, type ViewStyle } from 'react-native';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';
import {
  Atlas,
  BlurMask,
  Circle,
  Group,
  Path,
  RadialGradient,
  Skia,
  type SkImage,
  useColorBuffer,
  useRectBuffer,
  useRSXformBuffer,
  vec,
} from 'react-native-skia';

import { LateCanvas } from '@/components/late-canvas';

/**
 * The 2D flourishes over the screen, drawn in Skia on the UI thread: bursts (confetti that flies up
 * and tumbles down, or sparkles that fly out and twinkle away), each a closed-form function of a
 * clock so nothing's stored per piece; and rays, a fan of light turning behind something.
 */

/** The sprites, drawn once in white and tinted per piece: four bits of paper, a sparkle, a soft dot */
const SHAPES = [
  { w: 14, h: 6 },
  { w: 9, h: 9 },
  { w: 8, h: 8 },
  { w: 18, h: 4 },
  { w: 30, h: 30 },
  { w: 30, h: 30 },
];
const CELL = 32;
const STAR = 4;
const SOFT = 5;

let sheet: SkImage | null = null;
function sprites() {
  if (sheet) return sheet;
  const surface = Skia.Surface.Make(CELL * SHAPES.length, CELL);
  if (!surface) return null;
  const canvas = surface.getCanvas();
  const paint = Skia.Paint();
  paint.setColor(Skia.Color('#FFFFFF'));
  paint.setAntiAlias(true);
  SHAPES.forEach((s, k) => {
    const x = k * CELL + (CELL - s.w) / 2;
    const y = (CELL - s.h) / 2;
    const cx = k * CELL + CELL / 2;
    const cy = CELL / 2;
    if (k === 2) canvas.drawCircle(cx, cy, s.w / 2, paint);
    else if (k === STAR) {
      // A four-pointed sparkle, its sides drawn in, a bright dot in the middle
      const r = s.w / 2;
      const star = Skia.PathBuilder.Make()
        .moveTo(cx, cy - r)
        .quadTo(cx, cy, cx + r, cy)
        .quadTo(cx, cy, cx, cy + r)
        .quadTo(cx, cy, cx - r, cy)
        .quadTo(cx, cy, cx, cy - r)
        .close()
        .detach();
      canvas.drawPath(star, paint);
    } else if (k === SOFT) {
      const soft = Skia.Paint();
      soft.setShader(
        Skia.Shader.MakeRadialGradient(
          vec(cx, cy),
          s.w / 2,
          [Skia.Color('#FFFFFF'), Skia.Color('rgba(255,255,255,0)')],
          null,
          0
        )
      );
      canvas.drawCircle(cx, cy, s.w / 2, soft);
    } else canvas.drawRRect(Skia.RRectXY(Skia.XYWHRect(x, y, s.w, s.h), 1.5, 1.5), paint);
  });
  surface.flush();
  sheet = surface.makeImageSnapshot();
  return sheet;
}

/** A fixed random number for piece i, draw k */
const rnd = (i: number, k: number) => {
  'worklet';
  const s = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return s - Math.floor(s);
};

const GRAVITY = 1500;

/**
 * A burst from (x, y) as `clock` runs (seconds; 0 hides it). Confetti: launched up and out, air
 * drag pulling it back to a tumbling fall. Sparkles: flung out in a ring, slowing, twinkling, gone.
 */
export function Burst({
  clock,
  x,
  y,
  kind,
  palette,
  count,
  life,
  power = 1,
  style,
}: {
  clock: SharedValue<number>;
  x: number;
  y: number;
  kind: 'confetti' | 'sparkle';
  palette: string[];
  count: number;
  life: number;
  power?: number;
  style?: ViewStyle;
}) {
  const image = useMemo(() => sprites(), []);
  const colours = useMemo(
    () =>
      palette.map((h) => {
        const c = Skia.Color(h);
        return [c[0], c[1], c[2]];
      }),
    [palette]
  );
  const confetti = kind === 'confetti';
  const rects = useRectBuffer(count, (r, i) => {
    'worklet';
    const k = confetti ? Math.floor(rnd(i, 1) * 4) : rnd(i, 1) < 0.72 ? STAR : SOFT;
    const s = SHAPES[k];
    r.setXYWH(k * CELL + (CELL - s.w) / 2, (CELL - s.h) / 2, s.w, s.h);
  });
  const transforms = useRSXformBuffer(count, (val, i) => {
    'worklet';
    const t = Math.max(0, clock.get() - rnd(i, 2) * (confetti ? 0.12 : 0.06));
    let px: number;
    let py: number;
    let turn: number;
    let scale: number;
    let w: number;
    let h: number;
    if (confetti) {
      const a = -Math.PI / 2 + (rnd(i, 3) - 0.5) * Math.PI * 1.2;
      const speed = (620 + rnd(i, 4) * 980) * power;
      const vx = Math.cos(a) * speed;
      const vy = Math.sin(a) * speed;
      const drag = 2.1 + rnd(i, 5) * 1.6;
      const e = 1 - Math.exp(-drag * t);
      px = x + (vx / drag) * e + Math.sin(t * (3 + rnd(i, 6) * 4) + i) * 14 * Math.min(1, t * 2);
      py = y + (GRAVITY / drag) * t + ((vy - GRAVITY / drag) * e) / drag;
      turn = rnd(i, 7) * Math.PI * 2 + (rnd(i, 8) - 0.5) * 16 * t;
      const k = Math.floor(rnd(i, 1) * 4);
      w = SHAPES[k].w;
      h = SHAPES[k].h;
      scale = (0.85 + rnd(i, 9) * 0.6) * (0.55 + 0.45 * Math.abs(Math.cos(t * (5 + rnd(i, 10) * 6) + i)));
    } else {
      const a = rnd(i, 3) * Math.PI * 2;
      const speed = (180 + rnd(i, 4) * 420) * power;
      const drag = 3.2 + rnd(i, 5) * 2;
      const e = (1 - Math.exp(-drag * t)) / drag;
      px = x + Math.cos(a) * speed * e;
      py = y + Math.sin(a) * speed * e - t * 26;
      turn = rnd(i, 7) * 0.8 + t * (rnd(i, 8) - 0.5) * 3;
      w = 30;
      h = 30;
      const twinkle = 0.65 + 0.35 * Math.sin(t * (14 + rnd(i, 10) * 10) + i);
      const k = rnd(i, 1) < 0.72 ? STAR : SOFT;
      scale = (k === STAR ? 0.35 + rnd(i, 9) * 0.65 : 0.4 + rnd(i, 9) * 0.5) * twinkle * Math.min(1, t * 12);
    }
    const sc = Math.cos(turn) * scale;
    const ss = Math.sin(turn) * scale;
    val.set(sc, ss, px - (sc * w) / 2 + (ss * h) / 2, py - (ss * w) / 2 - (sc * h) / 2);
  });
  const colors = useColorBuffer(count, (c, i) => {
    'worklet';
    const t = clock.get();
    const p = colours[Math.floor(rnd(i, 11) * colours.length)];
    const fade = 1 - Math.max(0, Math.min(1, (t - (life - 0.9 + rnd(i, 12) * 0.5)) / 0.6));
    c[0] = p[0];
    c[1] = p[1];
    c[2] = p[2];
    c[3] = t > 0 && t < life ? fade : 0;
  });
  return (
    <LateCanvas style={style ?? StyleSheet.absoluteFill}>
      <Atlas image={image} sprites={rects} transforms={transforms} colors={colors} colorBlendMode="modulate" />
    </LateCanvas>
  );
}

/** A fan of light round (x, y), turning with `spin` (radians), as bright as `opacity` */
export function Rays({
  x,
  y,
  radius,
  colour,
  opacity,
  spin,
  count = 14,
  thickness = 0.42,
  soft = 0,
  glow = false,
  under,
  style,
}: {
  x: number;
  y: number;
  radius: number;
  colour: string;
  opacity: SharedValue<number>;
  spin: SharedValue<number>;
  count?: number;
  /** How much of each ray's share of the turn it fills */
  thickness?: number;
  /** Blurred this much: soft beams of light rather than wedges */
  soft?: number;
  /** A big soft glow in the middle too */
  glow?: boolean;
  /** A darker colour filling the gaps between the rays: a sunburst of light and dark bands */
  under?: string;
  style?: ViewStyle;
}) {
  const fan = useMemo(() => {
    const b = Skia.PathBuilder.Make();
    for (let k = 0; k < count; k++) {
      const a = (k / count) * Math.PI * 2;
      const half = (Math.PI / count) * thickness;
      b.moveTo(x, y)
        .lineTo(x + Math.cos(a - half) * radius, y + Math.sin(a - half) * radius)
        .lineTo(x + Math.cos(a + half) * radius, y + Math.sin(a + half) * radius)
        .close();
    }
    return b.detach();
  }, [x, y, radius, count, thickness]);
  const turn = useDerivedValue(() => [{ rotate: spin.value }]);
  return (
    <LateCanvas style={style ?? StyleSheet.absoluteFill}>
      <Group transform={turn} origin={vec(x, y)} opacity={opacity}>
        {under ? (
          <Circle cx={x} cy={y} r={radius}>
            <RadialGradient c={vec(x, y)} r={radius} colors={[`${under}EE`, `${under}AA`, `${under}00`]} />
          </Circle>
        ) : null}
        {glow ? (
          <Circle cx={x} cy={y} r={radius * 0.62}>
            <RadialGradient c={vec(x, y)} r={radius * 0.62} colors={[`${colour}CC`, `${colour}44`, `${colour}00`]} />
          </Circle>
        ) : null}
        <Path path={fan}>
          <RadialGradient c={vec(x, y)} r={radius} colors={[colour, `${colour}00`]} />
          {soft > 0 ? <BlurMask blur={soft} style="normal" /> : null}
        </Path>
      </Group>
    </LateCanvas>
  );
}
