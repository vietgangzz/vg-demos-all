import { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';
import {
  Atlas,
  Group,
  Skia,
  type SkImage,
  type SkRSXform,
  useRectBuffer,
  useRSXformBuffer,
  vec,
} from 'react-native-skia';

import { LateCanvas } from '@/components/late-canvas';
import { PALETTE } from './data';

/**
 * Specks of light, each a four-pointed glint in a soft halo, twinkling. While the badge charges
 * they're pulled in from all round it, spiralling faster as they near it; once it's promoted they
 * drift up the sky like dust in sunlight, and keep going.
 */

const COUNT = 46;
const CELL = 48;
/** The glints' colours, one cell of the sprite each: the charge's two, then the dust's */
const COLOURS = [...PALETTE.charge, ...PALETTE.dust];

/** The glints, drawn once: a white-hot core, four long tapering points and a halo, in each colour */
let sprite: SkImage | null = null;
function glints() {
  if (sprite) return sprite;
  const surface = Skia.Surface.Make(CELL * COLOURS.length, CELL);
  if (!surface) return null;
  const canvas = surface.getCanvas();
  const c = CELL / 2;
  const paint = Skia.Paint();
  paint.setAntiAlias(true);
  COLOURS.forEach((colour, i) => {
    const x = i * CELL + c;
    const clear = Skia.Color(colour);
    clear[3] = 0;
    paint.setShader(Skia.Shader.MakeRadialGradient(vec(x, c), c, [Skia.Color(colour), clear], [0, 1], 0));
    paint.setAlphaf(0.35);
    canvas.drawCircle(x, c, c * 0.6, paint);
    paint.setAlphaf(1);
    const star = Skia.PathBuilder.Make()
      .moveTo(x, 0)
      .quadTo(x, c, x + c, c)
      .quadTo(x, c, x, CELL)
      .quadTo(x, c, x - c, c)
      .quadTo(x, c, x, 0)
      .close()
      .detach();
    paint.setShader(
      Skia.Shader.MakeRadialGradient(vec(x, c), c, [Skia.Color('#FFFFFF'), Skia.Color(colour), clear], [0, 0.25, 1], 0)
    );
    canvas.drawPath(star, paint);
  });
  surface.flush();
  sprite = surface.makeImageSnapshot();
  return sprite;
}

const rnd = (i: number, k: number) => {
  'worklet';
  const s = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return s - Math.floor(s);
};

/** How big glint `i` is just now, twinkling: small ones and big ones, half each */
const twinkle = (i: number, t: number) => {
  'worklet';
  const base = i % 2 === 0 ? 0.3 + rnd(i, 9) * 0.2 : 0.55 + rnd(i, 9) * 0.35;
  return base * (0.55 + 0.45 * Math.sin(t * (3 + rnd(i, 10) * 4) + rnd(i, 11) * 6.28));
};

/** Glint `i` at a point, turned a little and scaled to its twinkle, about its centre */
const place = (val: SkRSXform, i: number, px: number, py: number, t: number) => {
  'worklet';
  const k = twinkle(i, t);
  const a = rnd(i, 12) * 0.6 - 0.3;
  const sc = Math.cos(a) * k;
  const ss = Math.sin(a) * k;
  const h = CELL / 2;
  val.set(sc, ss, px - sc * h + ss * h, py - ss * h - sc * h);
};

export function Motes({
  width,
  height,
  x,
  y,
  ambient,
  charge,
  dust,
}: {
  width: number;
  height: number;
  /** The badge's centre */
  x: number;
  y: SharedValue<number>;
  /** Seconds, always running */
  ambient: SharedValue<number>;
  /** How hard they're being pulled in (0 to 1), and how much dust is in the air */
  charge: SharedValue<number>;
  dust: SharedValue<number>;
}) {
  const image = useMemo(() => glints(), []);
  const reach = Math.max(width, height) * 0.62;

  const chargeCells = useRectBuffer(COUNT, (r, i) => {
    'worklet';
    r.setXYWH((i % 2) * CELL, 0, CELL, CELL);
  });
  const dustCells = useRectBuffer(COUNT, (r, i) => {
    'worklet';
    r.setXYWH((2 + (i % 2)) * CELL, 0, CELL, CELL);
  });
  const pulled = useRSXformBuffer(COUNT, (val, i) => {
    'worklet';
    const t = ambient.get();
    const cycle = 0.55 + rnd(i, 1) * 0.45;
    const k = (t / cycle + rnd(i, 2)) % 1;
    const r = reach * (0.25 + rnd(i, 3) * 0.75) * Math.pow(1 - k, 1.6);
    const a = rnd(i, 4) * Math.PI * 2 + k * k * 2.4;
    place(val, i, x + Math.cos(a) * r, y.get() + Math.sin(a) * r, t);
  });
  const drifting = useRSXformBuffer(COUNT, (val, i) => {
    'worklet';
    const t = ambient.get();
    const speed = 22 + rnd(i, 5) * 46;
    const span = height + 60;
    const py = height + 30 - ((t * speed + rnd(i, 6) * span) % span);
    const px = rnd(i, 7) * width + Math.sin(t * (0.6 + rnd(i, 8)) + i) * 16;
    place(val, i, px, py, t);
  });
  const chargeOpacity = useDerivedValue(() => charge.value);
  const dustOpacity = useDerivedValue(() => dust.value * 0.85);

  if (!image) return null;
  return (
    <LateCanvas style={StyleSheet.absoluteFill}>
      <Group opacity={chargeOpacity}>
        <Atlas image={image} sprites={chargeCells} transforms={pulled} />
      </Group>
      <Group opacity={dustOpacity}>
        <Atlas image={image} sprites={dustCells} transforms={drifting} />
      </Group>
    </LateCanvas>
  );
}
