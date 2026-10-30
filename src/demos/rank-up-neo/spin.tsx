import { StyleSheet } from 'react-native';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';
import {
  Atlas,
  ColorMatrix,
  Group,
  Image,
  LinearGradient,
  Paint,
  Rect,
  useImage,
  useRectBuffer,
  useRSXformBuffer,
  vec,
} from 'react-native-skia';

import { LateCanvas } from '@/components/late-canvas';
import { GOLD_BADGE, SILVER_BADGE } from './data';
import { clamp01 } from './ui';

/**
 * The league badge as a solid thing turning round: a whole turn of it rendered in Blender
 * (scripts/blender/rank_up_spin.py), its metal rim and the light running over its face, played a
 * frame at a time for however far round it is. Facing you it cross-fades to the flat art, which is
 * sharper. It can be washed white, all of it, rim and face alike, and it can shimmer like a holographic
 * foil card: bands of rainbow and a glint running across it as the phone tilts.
 */

const SILVER_SPIN = require('../../../assets/rank-up-neo/art/spin-silver.png');
const GOLD_SPIN = require('../../../assets/rank-up-neo/art/spin-gold.png');
const FRAMES = 48;
const COLS = 8;
const CELL = 320;
/** How far the white-hot line glows above where it's building */
const GLOW = 10;

/** Degrees round from facing you, 0 to 360 */
const wrap = (a: number) => {
  'worklet';
  return ((a % 360) + 360) % 360;
};

export function SpinBadge({
  size,
  angle,
  gold,
  white,
  tilt,
  holo,
  rez,
}: {
  size: number;
  /** How far round it's turned about its upright, in degrees (as rotateY) */
  angle: SharedValue<number>;
  /** 0 while it's Silver's badge, 1 once it's Gold's */
  gold: SharedValue<number>;
  /** How far it's washed white (0 to 1) */
  white: SharedValue<number>;
  /** Which way the phone's tipped (each about -1 to 1), and how strongly the foil shows (0 to 1) */
  tilt: SharedValue<{ x: number; y: number }>;
  holo: SharedValue<number>;
  /**
   * How much of it's been built (0 to 1, top down): solid down to a line of white-hot light, and below
   * it a ghost of gold light still to be filled in
   */
  rez: SharedValue<number>;
}) {
  const silverFlat = useImage(SILVER_BADGE);
  const goldFlat = useImage(GOLD_BADGE);
  const silverSpin = useImage(SILVER_SPIN);
  const goldSpin = useImage(GOLD_SPIN);

  const frame = useDerivedValue(() => Math.round((wrap(angle.value) / 360) * FRAMES) % FRAMES);
  // The flat art within a few degrees of facing you, the turning frames beyond
  const flat = useDerivedValue(() => {
    const a = wrap(angle.value);
    return 1 - clamp01((Math.min(a, 360 - a) - 1.5) / 6);
  });
  const sprites = useRectBuffer(1, (r) => {
    'worklet';
    const f = frame.value;
    r.setXYWH((f % COLS) * CELL, Math.floor(f / COLS) * CELL, CELL, CELL);
  });
  const transforms = useRSXformBuffer(1, (v) => {
    'worklet';
    v.set(size / CELL, 0, 0, 0);
  });
  const silverTurning = useDerivedValue(() => (1 - gold.value) * (1 - flat.value));
  const goldTurning = useDerivedValue(() => gold.value * (1 - flat.value));
  const silverFacing = useDerivedValue(() => (1 - gold.value) * flat.value);
  const goldFacing = useDerivedValue(() => gold.value * flat.value);
  const wash = useDerivedValue(() => {
    const w = white.value;
    const k = 1 - w;
    return [k, 0, 0, 0, w, 0, k, 0, 0, w, 0, 0, k, 0, w, 0, 0, 0, 1, 0];
  });

  // The foil's bands across it on a slant, and a glint, sliding as it tilts, the glint further
  const bands = useDerivedValue(() => holo.value * 0.35);
  const shift = useDerivedValue(() => (tilt.value.x * 0.7 + tilt.value.y * 0.45) * size);
  const bandFrom = useDerivedValue(() => vec(shift.value, 0));
  const bandTo = useDerivedValue(() => vec(shift.value + size * 0.5, size * 0.5));
  const glintFrom = useDerivedValue(() => vec(shift.value * 2.2 - size * 0.1, 0));
  const glintTo = useDerivedValue(() => vec(shift.value * 2.2 + size * 0.1, size * 0.2));

  // The line being built at, from just above the top to just below the bottom
  const scan = useDerivedValue(() => -GLOW + rez.value * (size + GLOW * 2));
  const solidFrom = useDerivedValue(() => vec(0, scan.value - 1));
  const solidTo = useDerivedValue(() => vec(0, scan.value + 1));
  const ghostFrom = useDerivedValue(() => vec(0, scan.value - GLOW));
  const ghostTo = useDerivedValue(() => vec(0, scan.value + size * 0.4));
  const ghostAt = GLOW / (GLOW + size * 0.4);

  return (
    <LateCanvas style={StyleSheet.absoluteFill}>
      <Group
        layer={
          <Paint>
            <ColorMatrix matrix={wash} />
          </Paint>
        }>
        {silverSpin ? (
          <Group opacity={silverTurning}>
            <Atlas image={silverSpin} sprites={sprites} transforms={transforms} />
          </Group>
        ) : null}
        {goldSpin ? (
          <Group opacity={goldTurning}>
            <Atlas image={goldSpin} sprites={sprites} transforms={transforms} />
          </Group>
        ) : null}
        {silverFlat ? (
          <Image image={silverFlat} x={0} y={0} width={size} height={size} fit="contain" opacity={silverFacing} />
        ) : null}
        {goldFlat ? (
          <Image image={goldFlat} x={0} y={0} width={size} height={size} fit="contain" opacity={goldFacing} />
        ) : null}
        {/* On the badge alone; opacity on each, as a group's would start a fresh layer with no badge in it */}
        <Rect x={0} y={0} width={size} height={size} blendMode="srcATop" opacity={bands}>
          <LinearGradient
            start={bandFrom}
            end={bandTo}
            mode="mirror"
            // Thin bands of colour with clear foil between, so the art still reads through it
            colors={[
              'rgba(255,120,210,0)',
              'rgba(255,120,210,0)',
              'rgba(255,120,210,0.9)',
              'rgba(120,230,255,0.9)',
              'rgba(120,230,255,0)',
              'rgba(255,240,130,0)',
              'rgba(255,240,130,0.8)',
              'rgba(255,240,130,0)',
              'rgba(255,240,130,0)',
            ]}
            positions={[0, 0.22, 0.3, 0.38, 0.46, 0.62, 0.68, 0.74, 1]}
          />
        </Rect>
        <Rect x={0} y={0} width={size} height={size} blendMode="srcATop" opacity={holo}>
          <LinearGradient
            start={glintFrom}
            end={glintTo}
            colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.6)', 'rgba(255,255,255,0)']}
          />
        </Rect>
        {/* Built down to the line, a ghost below it; all of it, once it's built */}
        <Rect x={0} y={0} width={size} height={size} blendMode="dstIn">
          <LinearGradient start={solidFrom} end={solidTo} colors={['rgba(0,0,0,1)', 'rgba(0,0,0,0.32)']} />
        </Rect>
        {/* The line white hot, and the ghost under it gold light */}
        <Rect x={0} y={0} width={size} height={size} blendMode="srcATop">
          <LinearGradient
            start={ghostFrom}
            end={ghostTo}
            colors={['rgba(255,255,255,0)', 'rgba(255,255,255,1)', 'rgba(255,200,90,0.95)', 'rgba(255,190,70,0.6)']}
            positions={[0, ghostAt, ghostAt + 0.06, 1]}
          />
        </Rect>
      </Group>
    </LateCanvas>
  );
}
