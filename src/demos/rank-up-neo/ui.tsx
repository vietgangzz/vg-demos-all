import { StyleSheet } from 'react-native';
import Animated, {
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';

/** The little bits every beat is made of: easing, and a ring rippling out */

export const clamp01 = (x: number) => {
  'worklet';
  return Math.min(1, Math.max(0, x));
};

/** How far through (0 to 1) a span `d` long starting at `a` the clock `t` is */
export const span = (t: number, a: number, d: number) => {
  'worklet';
  return Math.min(1, Math.max(0, (t - a) / d));
};

export const outCubic = (k: number) => {
  'worklet';
  return 1 - Math.pow(1 - k, 3);
};

export const inOutCubic = (k: number) => {
  'worklet';
  return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
};

/** Overshooting a little and settling back */
export const outBack = (k: number, s = 1.9) => {
  'worklet';
  return 1 + (s + 1) * Math.pow(k - 1, 3) + s * Math.pow(k - 1, 2);
};

/** A thing landing: overshoots, springs back and forth, settles (k from 0, in seconds) */
export const settle = (k: number, hz = 9, damp = 7) => {
  'worklet';
  return k <= 0 ? 0 : 1 - Math.exp(-k * damp) * Math.cos(k * hz * Math.PI);
};

export const mix = (a: number, b: number, k: number) => {
  'worklet';
  return a + (b - a) * k;
};

/**
 * A number worked out on the UI thread from whatever it reads, kept in a shared value that's only set
 * when it changes. A Skia canvas drawn from these is redrawn only when something on it moves, not
 * every frame a clock it reads ticks over while it's hidden or holding still. (`compute` is a worklet.)
 */
export function useSettled(compute: () => number) {
  const out = useSharedValue(0);
  useAnimatedReaction(compute, (v, last) => {
    if (v !== last) out.set(v);
  });
  return out;
}

/** A thin ring rippling out from (x, y) at `at` on the clock and fading as it goes */
export function Ripple({
  clock,
  at,
  x,
  y,
  size,
  grow = 2.4,
  life = 0.7,
  width = 2.5,
  colour = '#FFFFFF',
}: {
  clock: SharedValue<number>;
  at: number;
  x: number;
  y: number;
  size: number;
  grow?: number;
  life?: number;
  width?: number;
  colour?: string;
}) {
  const s = useAnimatedStyle(() => {
    const k = span(clock.value, at, life);
    return {
      opacity: k > 0 && k < 1 ? (1 - k) * 0.9 : 0,
      transform: [{ scale: mix(0.6, grow, outCubic(k)) }],
    };
  });
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.ring,
        { left: x - size / 2, top: y - size / 2, width: size, height: size, borderRadius: size / 2 },
        { borderWidth: width, borderColor: colour },
        s,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  ring: {
    position: 'absolute',
  },
});
