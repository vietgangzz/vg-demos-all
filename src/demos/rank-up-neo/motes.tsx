import { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { type SharedValue } from 'react-native-reanimated';
import {
  Atlas,
  BlurStyle,
  Group,
  Skia,
  type SkImage,
  type SkRSXform,
  useRectBuffer,
  useRSXformBuffer,
} from 'react-native-skia';

import { LateCanvas } from '@/components/late-canvas';
import { useSettled } from './ui';
import { PALETTE } from './data';

/**
 * Specks of light, each a voxel: a little square of light, white hot inside, glowing, twinkling. While the badge charges
 * they're pulled in from all round it, spiralling faster as they near it; once it's promoted they
 * drift up the sky like dust in sunlight, and keep going.
 */

const COUNT = 46;
const CELL = 48;
/** The glints' colours, one cell of the sprite each: the charge's two, then the dust's */
const COLOURS = [...PALETTE.charge, ...PALETTE.dust];

/** The voxels, drawn once: a square edged in colour round a white-hot middle, in a square glow, in each colour */
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
    paint.setColor(Skia.Color(colour));
    paint.setAlphaf(0.4);
    paint.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, c * 0.12, true));
    canvas.drawRect(Skia.XYWHRect(x - c * 0.36, c - c * 0.36, c * 0.72, c * 0.72), paint);
    paint.setMaskFilter(null);
    paint.setAlphaf(1);
    paint.setColor(Skia.Color(colour));
    canvas.drawRect(Skia.XYWHRect(x - c * 0.3, c - c * 0.3, c * 0.6, c * 0.6), paint);
    paint.setColor(Skia.Color('#FFFFFF'));
    canvas.drawRect(Skia.XYWHRect(x - c * 0.17, c - c * 0.17, c * 0.34, c * 0.34), paint);
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

/** How big glint `i` is just now, twinkling: small ones and bigger ones, half each */
const twinkle = (i: number, t: number) => {
  'worklet';
  const base = i % 2 === 0 ? 0.18 + rnd(i, 9) * 0.12 : 0.33 + rnd(i, 9) * 0.2;
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
  // Each lot only moving while it shows, so the canvas isn't redrawn every frame neither does
  const chargeOpacity = useSettled(() => {
    'worklet';
    return charge.value;
  });
  const dustOpacity = useSettled(() => {
    'worklet';
    return dust.value * 0.85;
  });
  const pullT = useSettled(() => {
    'worklet';
    return charge.value > 0 ? ambient.value : 0;
  });
  const pullY = useSettled(() => {
    'worklet';
    return charge.value > 0 ? y.value : 0;
  });
  const driftT = useSettled(() => {
    'worklet';
    return dust.value > 0 ? ambient.value : 0;
  });

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
    const t = pullT.get();
    const cycle = 0.55 + rnd(i, 1) * 0.45;
    const k = (t / cycle + rnd(i, 2)) % 1;
    const r = reach * (0.25 + rnd(i, 3) * 0.75) * Math.pow(1 - k, 1.6);
    const a = rnd(i, 4) * Math.PI * 2 + k * k * 2.4;
    place(val, i, x + Math.cos(a) * r, pullY.get() + Math.sin(a) * r, t);
  });
  const drifting = useRSXformBuffer(COUNT, (val, i) => {
    'worklet';
    const t = driftT.get();
    const speed = 22 + rnd(i, 5) * 46;
    const span = height + 60;
    const py = height + 30 - ((t * speed + rnd(i, 6) * span) % span);
    const px = rnd(i, 7) * width + Math.sin(t * (0.6 + rnd(i, 8)) + i) * 16;
    place(val, i, px, py, t);
  });

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
