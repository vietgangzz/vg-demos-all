import { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { type SharedValue } from 'react-native-reanimated';
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
import { useSettled } from './ui';

/**
 * The wind of the climb: streaks of light rushing down past as the camera climbs with the badge, the
 * near ones fast and big and over it, the far ones slow and small and under it. (The decks of grid it
 * climbs up through are the world's, in aurora.tsx.)
 *
 * Each layer is one Atlas off a streak drawn once, moved on the UI thread.
 */

const rnd = (i: number, k: number) => {
  'worklet';
  const s = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return s - Math.floor(s);
};

/** A streak of wind */
const WIND = { w: 6, h: 320 };

let sheet: SkImage | null = null;
function sprites() {
  if (sheet) return sheet;
  const surface = Skia.Surface.Make(WIND.w, WIND.h);
  if (!surface) return null;
  const c = surface.getCanvas();
  // A thin streak, bright in the middle
  const wind = Skia.Paint();
  wind.setShader(
    Skia.Shader.MakeLinearGradient(
      vec(0, 0),
      vec(0, WIND.h),
      [Skia.Color('rgba(34,229,255,0)'), Skia.Color('rgba(220,252,255,1)'), Skia.Color('rgba(34,229,255,0)')],
      null,
      0
    )
  );
  c.drawRRect(Skia.RRectXY(Skia.XYWHRect(2, 0, WIND.w - 4, WIND.h), 2, 2), wind);
  surface.flush();
  sheet = surface.makeImageSnapshot();
  return sheet;
}

/** An RSXform putting a sprite w by h, scaled k, centred on (x, y) */
const centred = (val: SkRSXform, x: number, y: number, w: number, h: number, k: number) => {
  'worklet';
  val.set(k, 0, x - (k * w) / 2, y - (k * h) / 2);
};

const LAYERS = {
  /** Far off: slow, small, under the badge */
  back: { parallax: 0.55, count: 26 },
  /** Close: fast, big, over the badge */
  front: { parallax: 1.5, count: 46 },
};

export function Wind({
  width,
  height,
  layer,
  climb,
  speed,
}: {
  width: number;
  height: number;
  layer: keyof typeof LAYERS;
  /** How far the camera's climbed (px) */
  climb: SharedValue<number>;
  /** How fast it's climbing (0 to 1) */
  speed: SharedValue<number>;
}) {
  const image = useMemo(() => sprites(), []);
  const L = LAYERS[layer];
  // Only set as they change, so the canvas isn't redrawn every frame of the promotion they aren't moving
  const at = useSettled(() => {
    'worklet';
    return climb.value;
  });
  const opacity = useSettled(() => {
    'worklet';
    return speed.value * 0.95;
  });
  const cells = useRectBuffer(L.count, (r) => {
    'worklet';
    r.setXYWH(0, 0, WIND.w, WIND.h);
  });
  // Wrapping round the screen, so it streams past for as long as the climb lasts
  const placed = useRSXformBuffer(L.count, (val, i) => {
    'worklet';
    const run = height + WIND.h * 3;
    const y = ((rnd(i, 7) * run + at.get() * (3 + rnd(i, 8) * 2.5) * L.parallax) % run) - WIND.h * 1.5;
    centred(val, rnd(i, 9) * width, y, WIND.w, WIND.h, (0.6 + rnd(i, 10) * 1.4) * (layer === 'back' ? 0.6 : 1));
  });

  if (!image) return null;
  return (
    <LateCanvas style={StyleSheet.absoluteFill}>
      <Group opacity={opacity}>
        <Atlas image={image} sprites={cells} transforms={placed} />
      </Group>
    </LateCanvas>
  );
}
