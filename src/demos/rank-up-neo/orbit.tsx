import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

/**
 * An edge of light round a box: a gradient border, brighter at two corners and dimmer between, and
 * a comet of light orbiting it at a steady speed, a white-hot head with a tail of the edge's colour
 * fading out behind. It's a ring cut out of a box of light: dots of light run round inside a
 * clipped box, and the box's own fill covers all but a thin edge of it, so only the edge shows them.
 * (Plain views: a Skia canvas here didn't redraw as its comet moved.)
 *
 * It sits under whatever it's the edge of, and paints that thing's background (`fill`) too.
 */

export type Edge = {
  /** The border's gradient, corner to corner and back */
  from: string;
  to: string;
  /** The comet's tail, and its head */
  tail: string;
  head: string;
  /** The box's own fill, inside the edge: opaque, since it's what hides the light everywhere else */
  fill: string;
};

/**
 * The comet: dots of light close together along the edge, the head's white-hot and the rest fading
 * back along the tail. Only the stroke-wide strip of each shows, so together they read as one streak.
 */
const DOT = 14;
const TRAIL = Array.from({ length: 18 }, (_, i) => ({
  back: i * 7,
  alpha: Math.pow(1 - i / 18, 1.4),
  head: i < 3,
}));

export function Orbit({
  width,
  height,
  radius,
  edge,
  period = 3.4,
  stroke = 2,
}: {
  width: number;
  height: number;
  radius: number;
  edge: Edge;
  /** Seconds the comet takes to go round once */
  period?: number;
  stroke?: number;
}) {
  const run = useSharedValue(0);
  useEffect(() => {
    run.set(withRepeat(withTiming(1, { duration: period * 1000, easing: Easing.linear }), -1, false));
  }, [run, period]);
  if (width <= 0 || height <= 0) return null;
  return (
    <View style={[styles.ring, { width, height, borderRadius: radius }]} pointerEvents="none">
      <View
        style={[
          StyleSheet.absoluteFill,
          {
            experimental_backgroundImage: `linear-gradient(135deg, ${edge.from} 0%, ${edge.to} 50%, ${edge.from} 100%)`,
          },
        ]}
      />
      {TRAIL.map((b) => (
        <Blob
          key={b.back}
          run={run}
          width={width}
          height={height}
          back={b.back}
          alpha={b.alpha}
          colour={b.head ? edge.head : edge.tail}
        />
      ))}
      <View
        style={[
          styles.fill,
          {
            top: stroke,
            left: stroke,
            right: stroke,
            bottom: stroke,
            borderRadius: radius - stroke,
            backgroundColor: edge.fill,
          },
        ]}
      />
    </View>
  );
}

/** One blob of the comet, `back` points behind its head along the edge */
function Blob({
  run,
  width,
  height,
  back,
  alpha,
  colour,
}: {
  run: SharedValue<number>;
  width: number;
  height: number;
  back: number;
  alpha: number;
  colour: string;
}) {
  const s = useAnimatedStyle(() => {
    // Round the edge at a steady speed, clockwise from the top left
    const P = 2 * (width + height);
    let d = (((run.value * P - back) % P) + P) % P;
    let x = 0;
    let y = 0;
    if (d < width) x = d;
    else if ((d -= width) < height) [x, y] = [width, d];
    else if ((d -= height) < width) [x, y] = [width - d, height];
    else [x, y] = [0, height - (d - width)];
    return { transform: [{ translateX: x - DOT / 2 }, { translateY: y - DOT / 2 }] };
  });
  return <Animated.View style={[styles.blob, { opacity: alpha, backgroundColor: colour }, s]} />;
}

const styles = StyleSheet.create({
  ring: { position: 'absolute', left: 0, top: 0, overflow: 'hidden', borderCurve: 'continuous' },
  fill: { position: 'absolute', borderCurve: 'continuous' },
  blob: { position: 'absolute', left: 0, top: 0, width: DOT, height: DOT, borderRadius: DOT / 2 },
});

/** The edges, one for each world */
export const EDGES = {
  cyan: {
    from: 'rgba(34, 229, 255, 0.75)',
    to: 'rgba(34, 229, 255, 0.16)',
    tail: 'rgba(34, 229, 255, 1)',
    head: '#F4FEFF',
    fill: '#05090D',
  },
  gold: {
    from: 'rgba(255, 205, 80, 0.85)',
    to: 'rgba(255, 170, 40, 0.18)',
    tail: 'rgba(255, 196, 64, 1)',
    head: '#FFF9EA',
    fill: '#0C0802',
  },
} satisfies Record<string, Edge>;
