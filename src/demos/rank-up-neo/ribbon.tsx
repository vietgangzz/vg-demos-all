import { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { type SharedValue } from 'react-native-reanimated';
import { Atlas, Group, Skia, type SkImage, useRectBuffer, useRSXformBuffer, vec } from 'react-native-skia';

import { LateCanvas } from '@/components/late-canvas';
import { useSettled } from './ui';

/**
 * The ribbon Gold's world arrives on. It's drawn in aurora.tsx, a band of the sunrise across the
 * screen on a slant, through the badge, opening out from a thin line; here are its measurements, and
 * the faint streaks of light rushing along it so it looks like it's going somewhere fast.
 */

/** Its slant (radians, rising to the right) and half its width, as a fraction of the screen's height */
export const BAND = { angle: 0.26, half: 0.1 };

const DIR = { x: Math.cos(BAND.angle), y: -Math.sin(BAND.angle) };
const ACROSS = { x: -DIR.y, y: DIR.x };
const COUNT = 18;

/** One streak, drawn once in white: fading in from its tail to a bright rounded head */
const SPRITE = { w: 200, h: 4 };
let sprite: SkImage | null = null;
function streak() {
  if (sprite) return sprite;
  const surface = Skia.Surface.Make(SPRITE.w, SPRITE.h);
  if (!surface) return null;
  const paint = Skia.Paint();
  paint.setAntiAlias(true);
  paint.setShader(
    Skia.Shader.MakeLinearGradient(
      vec(0, 0),
      vec(SPRITE.w, 0),
      [Skia.Color('rgba(255,255,255,0)'), Skia.Color('#FFFFFF')],
      null,
      0
    )
  );
  surface
    .getCanvas()
    .drawRRect(Skia.RRectXY(Skia.XYWHRect(0, 0, SPRITE.w, SPRITE.h), SPRITE.h / 2, SPRITE.h / 2), paint);
  surface.flush();
  sprite = surface.makeImageSnapshot();
  return sprite;
}

const rnd = (i: number, k: number) => {
  'worklet';
  const s = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return s - Math.floor(s);
};

export function Streaks({
  width,
  height,
  x,
  y,
  clock,
  band,
  flood,
}: {
  width: number;
  height: number;
  /** Where the ribbon crosses, through the badge */
  x: number;
  y: number;
  /** Seconds, always running */
  clock: SharedValue<number>;
  /** How far in the ribbon has slammed (0 to 1), and how far it's flooded out over everything */
  band: SharedValue<number>;
  flood: SharedValue<number>;
}) {
  const image = useMemo(() => streak(), []);
  const run = (width + height) * 0.75;
  const half = BAND.half * height;
  // Only moving while they show, so the canvas isn't redrawn every frame they don't
  const opacity = useSettled(() => {
    'worklet';
    return band.value > 0 ? 0.5 * Math.min(1, band.value) * (1 - Math.min(1, flood.value * 2.5)) : 0;
  });
  const live = useSettled(() => {
    'worklet';
    return band.value > 0 && flood.value < 0.4 ? clock.value : 0;
  });
  const open = useSettled(() => {
    'worklet';
    return Math.min(1, band.value);
  });
  const rects = useRectBuffer(COUNT, (r) => {
    'worklet';
    r.setXYWH(0, 0, SPRITE.w, SPRITE.h);
  });
  // Each streak rushing along the ribbon, scaled to its length, inside it however far it's opened
  const transforms = useRSXformBuffer(COUNT, (val, i) => {
    'worklet';
    const t = live.get();
    const len = 120 + rnd(i, 2) * 260;
    const head = ((t * (1100 + rnd(i, 1) * 1300) + rnd(i, 3) * 2 * run) % (2 * run)) - run;
    const k = len / SPRITE.w;
    const o = (rnd(i, 4) * 2 - 1) * half * 0.86 * open.get();
    const tx = x + ACROSS.x * o + DIR.x * (head - len);
    const ty = y + ACROSS.y * o + DIR.y * (head - len);
    const sc = DIR.x * k;
    const ss = DIR.y * k;
    val.set(sc, ss, tx + (ss * SPRITE.h) / 2, ty - (sc * SPRITE.h) / 2);
  });
  if (!image) return null;
  return (
    <LateCanvas style={StyleSheet.absoluteFill}>
      <Group opacity={opacity}>
        <Atlas image={image} sprites={rects} transforms={transforms} />
      </Group>
    </LateCanvas>
  );
}
