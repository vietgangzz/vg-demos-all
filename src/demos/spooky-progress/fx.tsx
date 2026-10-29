import { StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, useDerivedValue, type SharedValue } from 'react-native-reanimated';
import { BlurMask, Circle, Group } from 'react-native-skia';

import { LateCanvas } from '@/components/late-canvas';

/**
 * The flourishes every bar shares, each a closed-form function of the clock: a burst of things
 * (sweets flung out and falling, bats scattering and flapping off, ghosts spiralling up and away),
 * and smoke billowing up and spreading out.
 */

const rnd = (i: number, k: number) => {
  'worklet';
  const s = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return s - Math.floor(s);
};

type Kind = 'burst' | 'bats' | 'ghosts';

export function Flyers({
  t,
  at,
  x,
  y,
  items,
  count,
  kind,
  size = 34,
  power = 1,
  life = 2.4,
}: {
  t: SharedValue<number>;
  at: number;
  x: number;
  y: number;
  /** What's flung out, emoji, picked from in turn */
  items: string[];
  count: number;
  kind: Kind;
  size?: number;
  power?: number;
  life?: number;
}) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <Flyer
          key={i}
          i={i}
          t={t}
          at={at}
          x={x}
          y={y}
          item={items[i % items.length]}
          kind={kind}
          size={size}
          power={power}
          life={life}
        />
      ))}
    </>
  );
}

function Flyer({
  i,
  t,
  at,
  x,
  y,
  item,
  kind,
  size,
  power,
  life,
}: {
  i: number;
  t: SharedValue<number>;
  at: number;
  x: number;
  y: number;
  item: string;
  kind: Kind;
  size: number;
  power: number;
  life: number;
}) {
  const s = useAnimatedStyle(() => {
    const delay = rnd(i, 1) * (kind === 'burst' ? 0.08 : 0.35);
    const a = t.value - at - delay;
    if (a < 0 || a > life) return { opacity: 0 };
    const k = a / life;
    const fade = 1 - Math.max(0, (k - 0.75) / 0.25);
    const big = 0.6 + rnd(i, 2) * 0.6;
    if (kind === 'burst') {
      // Flung out and up, tumbling, falling back down
      const ang = -Math.PI / 2 + (rnd(i, 3) - 0.5) * 2.6;
      const v = (420 + rnd(i, 4) * 520) * power;
      const px = x + Math.cos(ang) * v * a;
      const py = y + Math.sin(ang) * v * a + 900 * a * a;
      return {
        opacity: fade,
        transform: [
          { translateX: px - size / 2 },
          { translateY: py - size / 2 },
          { rotate: `${(rnd(i, 5) - 0.5) * 900 * a}deg` },
          { scale: big * Math.min(1, a * 8) },
        ],
      };
    }
    if (kind === 'bats') {
      // Scattering out, swooping, flapping, shrinking off into the distance
      const ang = -Math.PI / 2 + (rnd(i, 3) - 0.5) * 3.2;
      const v = (260 + rnd(i, 4) * 340) * power;
      const swoop = Math.sin(a * (5 + rnd(i, 6) * 4) + i) * 26;
      const px = x + Math.cos(ang) * v * a + swoop;
      const py = y + Math.sin(ang) * v * a - 60 * a * a + Math.cos(a * 7 + i) * 12;
      const flap = 0.55 + 0.45 * Math.abs(Math.sin(a * 22 + i));
      return {
        opacity: fade,
        transform: [
          { translateX: px - size / 2 },
          { translateY: py - size / 2 },
          { scaleX: big * (Math.cos(ang) < 0 ? -1 : 1) * Math.min(1, a * 6) * (1 - 0.4 * k) },
          { scaleY: big * flap * Math.min(1, a * 6) * (1 - 0.4 * k) },
        ],
      };
    }
    // Ghosts: spiralling up and out, swaying, fading
    const turn = (rnd(i, 3) - 0.5) * 2;
    const r = (40 + 140 * k) * power;
    const ang = rnd(i, 4) * 6.28 + a * 2.2 * (turn < 0 ? -1 : 1);
    const px = x + Math.cos(ang) * r;
    const py = y - (140 + rnd(i, 5) * 160) * power * a + Math.sin(ang) * r * 0.35;
    return {
      opacity: fade * Math.min(1, a * 4) * 0.95,
      transform: [
        { translateX: px - size / 2 },
        { translateY: py - size / 2 },
        { rotate: `${Math.sin(a * 4 + i) * 14}deg` },
        { scale: big * (0.4 + 0.8 * Math.min(1, a * 2)) },
      ],
    };
  });
  return (
    <Animated.Text style={[styles.flyer, { fontSize: size, lineHeight: size * 1.15, width: size * 1.3 }, s]}>
      {item}
    </Animated.Text>
  );
}

/** Smoke billowing up from (x, y) at `at`: soft puffs rising, swelling, thinning out */
export function Smoke({
  t,
  at,
  x,
  y,
  colour,
  count = 9,
  size = 40,
  rise = 160,
  life = 2,
}: {
  t: SharedValue<number>;
  at: number;
  x: number;
  y: number;
  colour: string;
  count?: number;
  size?: number;
  rise?: number;
  life?: number;
}) {
  return (
    <LateCanvas style={StyleSheet.absoluteFill}>
      {Array.from({ length: count }, (_, i) => (
        <Puff key={i} i={i} t={t} at={at} x={x} y={y} colour={colour} size={size} rise={rise} life={life} />
      ))}
    </LateCanvas>
  );
}

function Puff({
  i,
  t,
  at,
  x,
  y,
  colour,
  size,
  rise,
  life,
}: {
  i: number;
  t: SharedValue<number>;
  at: number;
  x: number;
  y: number;
  colour: string;
  size: number;
  rise: number;
  life: number;
}) {
  const move = useDerivedValue(() => {
    const a = Math.max(0, t.value - at - rnd(i, 1) * 0.3);
    const k = Math.min(1, a / life);
    const drift = (rnd(i, 2) - 0.5) * 120 * k;
    return [
      { translateX: x + drift },
      { translateY: y - rise * (1 - Math.pow(1 - k, 2)) },
      { scale: 0.3 + 1.6 * Math.pow(k, 0.6) * (0.7 + rnd(i, 3) * 0.6) },
    ];
  });
  const on = useDerivedValue(() => {
    const a = t.value - at - rnd(i, 1) * 0.3;
    if (a < 0) return 0;
    const k = a / life;
    return k > 1 ? 0 : Math.min(1, a * 6) * (1 - k) * 0.7;
  });
  return (
    <Group transform={move} opacity={on}>
      <Circle cx={0} cy={0} r={size} color={colour}>
        <BlurMask blur={size * 0.45} style="normal" />
      </Circle>
    </Group>
  );
}

const styles = StyleSheet.create({
  flyer: { position: 'absolute', left: 0, top: 0, textAlign: 'center' },
});
