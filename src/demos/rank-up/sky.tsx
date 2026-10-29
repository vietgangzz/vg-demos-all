import { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';
import {
  Atlas,
  BlurStyle,
  Group,
  Image,
  Skia,
  type SkImage,
  type SkRSXform,
  useRectBuffer,
  useRSXformBuffer,
  vec,
} from 'react-native-skia';

import { LateCanvas } from '@/components/late-canvas';
import { span } from './ui';

/**
 * The sky the badge flies up through, and what it comes back down as.
 *
 * - Clouds: soft puffs streaming down past as the camera climbs with the badge, the near ones fast
 *   and big and over it, the far ones slow and small and under it, with a thick bank to burst through
 *   halfway, and streaks of wind. Above the bank they're lit warm.
 * - Up there, where it's flown off to, a star: a four-pointed flare, twinkling.
 * - The meteor it comes back down as: a blazing trail behind it, shedding sparks.
 *
 * Each is one Atlas or a single image off a sprite sheet drawn once, moved on the UI thread.
 */

const rnd = (i: number, k: number) => {
  'worklet';
  const s = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return s - Math.floor(s);
};

/** The sprite sheet: a cloud puff white and warm, a streak of wind, a glint, and a meteor's trail */
const PUFF = { w: 200, h: 110 };
/** A cloud's billows, in its cell: x, y and radius */
const BILLOWS = [
  [52, 66, 26],
  [82, 50, 34],
  [118, 44, 38],
  [150, 60, 28],
  [172, 74, 18],
  [32, 78, 16],
];
const WIND = { x: PUFF.w * 2, w: 8, h: 140 };
const GLINT = { x: WIND.x + WIND.w, s: 128 };
const TRAIL = { x: GLINT.x + GLINT.s, w: 256, h: 64 };
const SHEET = { w: TRAIL.x + TRAIL.w, h: Math.max(PUFF.h, WIND.h, GLINT.s, TRAIL.h) };
const GLINT_CELL = Skia.XYWHRect(GLINT.x, 0, GLINT.s, GLINT.s);
const TRAIL_CELL = Skia.XYWHRect(TRAIL.x, 0, TRAIL.w, TRAIL.h);

let sheet: SkImage | null = null;
function sprites() {
  if (sheet) return sheet;
  const surface = Skia.Surface.Make(SHEET.w, SHEET.h);
  if (!surface) return null;
  const c = surface.getCanvas();
  const clear = (hex: string) => {
    const col = Skia.Color(hex);
    col[3] = 0;
    return col;
  };
  // Clouds: a heap of round billows on a flat base, soft-edged, lit from above and shaded under
  ['#FFFFFF', '#FFE6B8'].forEach((hex, i) => {
    const x0 = i * PUFF.w;
    const body = Skia.Paint();
    body.setAntiAlias(true);
    body.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, 5, true));
    body.setShader(
      Skia.Shader.MakeLinearGradient(
        vec(0, 14),
        vec(0, PUFF.h - 10),
        [Skia.Color(hex), Skia.Color(hex), Skia.Color(i ? '#E8A878' : '#B9C8EA')],
        [0, 0.45, 1],
        0
      )
    );
    for (const [x, y, r] of BILLOWS) c.drawCircle(x0 + x, y, r, body);
    c.drawRRect(Skia.RRectXY(Skia.XYWHRect(x0 + 20, 58, PUFF.w - 40, 30), 15, 15), body);
  });
  // Wind: a thin streak, bright in the middle
  const wind = Skia.Paint();
  wind.setShader(
    Skia.Shader.MakeLinearGradient(
      vec(0, 0),
      vec(0, WIND.h),
      [Skia.Color('rgba(255,255,255,0)'), Skia.Color('rgba(255,255,255,0.9)'), Skia.Color('rgba(255,255,255,0)')],
      null,
      0
    )
  );
  c.drawRRect(Skia.RRectXY(Skia.XYWHRect(WIND.x + 2, 0, WIND.w - 4, WIND.h), 2, 2), wind);
  // The glint: a warm halo, four long points, a white-hot core
  const g = GLINT.x + GLINT.s / 2;
  const r = GLINT.s / 2;
  const halo = Skia.Paint();
  halo.setShader(
    Skia.Shader.MakeRadialGradient(
      vec(g, r),
      r,
      [Skia.Color('rgba(255,236,170,0.7)'), Skia.Color('rgba(255,190,80,0.25)'), clear('#FFBE50')],
      [0, 0.3, 1],
      0
    )
  );
  c.drawCircle(g, r, r, halo);
  const star = Skia.PathBuilder.Make()
    .moveTo(g, 0)
    .quadTo(g, r, g + r, r)
    .quadTo(g, r, g, GLINT.s)
    .quadTo(g, r, g - r, r)
    .quadTo(g, r, g, 0)
    .close()
    .detach();
  const points = Skia.Paint();
  points.setAntiAlias(true);
  points.setShader(
    Skia.Shader.MakeRadialGradient(
      vec(g, r),
      r,
      [Skia.Color('#FFFFFF'), Skia.Color('#FFE7A0'), clear('#FFC34D')],
      [0, 0.2, 1],
      0
    )
  );
  c.drawPath(star, points);
  // The trail: fading in from its tail, saffron to a white-hot head, rounded
  const trail = Skia.Paint();
  trail.setAntiAlias(true);
  trail.setShader(
    Skia.Shader.MakeLinearGradient(
      vec(TRAIL.x, 0),
      vec(TRAIL.x + TRAIL.w, 0),
      [Skia.Color('rgba(255,120,30,0)'), Skia.Color('rgba(255,170,40,0.8)'), Skia.Color('#FFF6D8')],
      [0, 0.7, 1],
      0
    )
  );
  c.drawRRect(Skia.RRectXY(Skia.XYWHRect(TRAIL.x, 0, TRAIL.w, TRAIL.h), TRAIL.h / 2, TRAIL.h / 2), trail);
  surface.flush();
  sheet = surface.makeImageSnapshot();
  return sheet;
}

/** An RSXform putting a sprite w by h, scaled k and turned a, centred on (x, y) */
const centred = (val: SkRSXform, x: number, y: number, w: number, h: number, k: number, a = 0) => {
  'worklet';
  const sc = Math.cos(a) * k;
  const ss = Math.sin(a) * k;
  val.set(sc, ss, x - (sc * w) / 2 + (ss * h) / 2, y - (ss * w) / 2 - (sc * h) / 2);
};

const LAYERS = {
  /** Far off: slow, small, under the badge */
  back: { count: 44, parallax: 0.55, size: [110, 250], alpha: 0.7, wind: 0 },
  /** Close: fast, big, over the badge, and the wind streaking past */
  front: { count: 30, parallax: 1.5, size: [240, 520], alpha: 0.92, wind: 22 },
};

export function Clouds({
  width,
  height,
  layer,
  climb,
  reach,
  bank,
  speed,
  warm,
}: {
  width: number;
  height: number;
  layer: keyof typeof LAYERS;
  /** How far the camera's climbed (px), how far it climbs in all, and how far it's climbed going through the bank */
  climb: SharedValue<number>;
  reach: number;
  bank: number;
  /** How fast it's climbing (0 to 1), and how warm the clouds are lit (0 to 1) */
  speed: SharedValue<number>;
  warm: SharedValue<number>;
}) {
  const image = useMemo(() => sprites(), []);
  const L = LAYERS[layer];
  // Each puff placed somewhere it's off the top of the screen to begin with and off the bottom once
  // the climb's done; half of them crowded into the bank, crossing the middle of the screen together
  const puffs = useMemo(() => {
    const seed = layer === 'back' ? 1 : 2;
    const lo = height + L.size[1] - reach * L.parallax;
    const hi = -L.size[1];
    const mid = height / 2 - bank * L.parallax;
    return Array.from({ length: L.count }, (_, i) => {
      const inBank = layer === 'front' && i % 2 === 0;
      const y0 = inBank ? mid + (rnd(i, seed + 1) - 0.5) * height * 0.9 : lo + rnd(i, seed + 2) * (hi - lo);
      return {
        x: -0.15 * width + rnd(i, seed + 3) * width * 1.3,
        y0: Math.min(hi, y0),
        k: (L.size[0] + rnd(i, seed + 4) * (L.size[1] - L.size[0])) / PUFF.w,
        warmth: rnd(i, seed + 5),
      };
    });
  }, [layer, width, height, reach, bank, L]);

  const cells = useRectBuffer(L.count, (r, i) => {
    'worklet';
    r.setXYWH(puffs[i].warmth < warm.get() ? PUFF.w : 0, 0, PUFF.w, PUFF.h);
  });
  const placed = useRSXformBuffer(L.count, (val, i) => {
    'worklet';
    const p = puffs[i];
    centred(val, p.x, p.y0 + climb.get() * L.parallax, PUFF.w, PUFF.h, p.k);
  });
  const windCells = useRectBuffer(Math.max(1, L.wind), (r) => {
    'worklet';
    r.setXYWH(WIND.x, 0, WIND.w, WIND.h);
  });
  // Wind wrapping round the screen, so it streams past for as long as the climb lasts
  const windPlaced = useRSXformBuffer(Math.max(1, L.wind), (val, i) => {
    'worklet';
    const run = height + WIND.h * 3;
    const y = ((rnd(i, 7) * run + climb.get() * (2 + rnd(i, 8) * 1.5)) % run) - WIND.h * 1.5;
    centred(val, rnd(i, 9) * width, y, WIND.w, WIND.h, 1 + rnd(i, 10) * 1.6);
  });
  const windOpacity = useDerivedValue(() => speed.value * 0.8);

  if (!image) return null;
  return (
    <LateCanvas style={StyleSheet.absoluteFill}>
      <Group opacity={L.alpha}>
        <Atlas image={image} sprites={cells} transforms={placed} />
      </Group>
      {L.wind ? (
        <Group opacity={windOpacity}>
          <Atlas image={image} sprites={windCells} transforms={windPlaced} />
        </Group>
      ) : null}
    </LateCanvas>
  );
}

type Pt = { x: number; y: number };

/** Where the meteor is, `k` (0 to 1) of the way down from the star to where it lands */
export const meteorAt = (k: number, from: Pt, to: Pt) => {
  'worklet';
  // Accelerating all the way down
  const e = k * k;
  return { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e };
};

const SPARKS = 28;

export function Meteor({
  width,
  clock,
  star,
  land,
  apex,
  shine,
  fall,
  hit,
}: {
  width: number;
  clock: SharedValue<number>;
  /** Where the star shines, and where the meteor lands */
  star: Pt;
  land: Pt;
  /** When it's flown off into the distance, when the star's out, when it falls and when it hits */
  apex: number;
  shine: number;
  fall: number;
  hit: number;
}) {
  const image = useMemo(() => sprites(), []);

  // The star: swelling out of the badge as it dwindles, twinkling, flaring as it starts to fall
  const flare = useDerivedValue(() => {
    const t = clock.value;
    const on = span(t, shine - 0.12, 0.16) * (1 - span(t, fall + 0.04, 0.08));
    const twinkle = 1 + 0.18 * Math.sin(t * 34) + 0.6 * Math.exp(-Math.pow((t - fall) / 0.05, 2));
    const k = (on * twinkle * width * 0.32) / GLINT.s;
    return [
      { translateX: star.x },
      { translateY: star.y },
      { rotate: t * 0.8 },
      { scale: k },
      { translateX: -GLINT.x - GLINT.s / 2 },
      { translateY: -GLINT.s / 2 },
    ];
  });
  const flareOn = useDerivedValue(() => (clock.value > apex && clock.value < fall + 0.14 ? 1 : 0));

  // The trail: from the meteor's head back the way it came, longer and fatter the faster it goes
  const angle = Math.atan2(land.y - star.y, land.x - star.x);
  const trail = useDerivedValue(() => {
    const k = span(clock.value, fall, hit - fall);
    const head = meteorAt(k, star, land);
    const len = 40 + 420 * k;
    const thick = 14 + 70 * k * k;
    return [
      { translateX: head.x },
      { translateY: head.y },
      { rotate: angle },
      { translateX: -len },
      { translateY: -thick / 2 },
      { scaleX: len / TRAIL.w },
      { scaleY: thick / TRAIL.h },
      { translateX: -TRAIL.x },
    ];
  });
  const trailOn = useDerivedValue(() => (clock.value > fall && clock.value < hit + 0.02 ? 1 : 0));

  // Sparks shed along the way, drifting off and falling, fading
  const cells = useRectBuffer(SPARKS, (r) => {
    'worklet';
    r.setXYWH(GLINT.x, 0, GLINT.s, GLINT.s);
  });
  const sparks = useRSXformBuffer(SPARKS, (val, i) => {
    'worklet';
    const t = clock.get();
    const shed = fall + ((hit - fall) * (i + 0.5)) / SPARKS;
    const age = t - shed;
    if (age < 0 || age > 0.7) {
      val.set(0, 0, -999, -999);
      return;
    }
    const p = meteorAt((shed - fall) / (hit - fall), star, land);
    const side = rnd(i, 1) - 0.5;
    const x = p.x + side * 160 * age;
    const y = p.y + (rnd(i, 2) - 0.7) * 90 * age + 260 * age * age;
    centred(val, x, y, GLINT.s, GLINT.s, (0.12 + rnd(i, 3) * 0.14) * (1 - age / 0.7), t * 3 + i);
  });
  const sparksOn = useDerivedValue(() => (clock.value > fall && clock.value < hit + 0.8 ? 1 : 0));

  if (!image) return null;
  return (
    <LateCanvas style={StyleSheet.absoluteFill}>
      <Group opacity={sparksOn}>
        <Atlas image={image} sprites={cells} transforms={sparks} />
      </Group>
      {/* Each its own cell of the sheet, clipped out of it */}
      <Group transform={trail} opacity={trailOn} clip={TRAIL_CELL}>
        <Image image={image} x={0} y={0} width={SHEET.w} height={SHEET.h} />
      </Group>
      <Group transform={flare} opacity={flareOn} clip={GLINT_CELL}>
        <Image image={image} x={0} y={0} width={SHEET.w} height={SHEET.h} />
      </Group>
    </LateCanvas>
  );
}
