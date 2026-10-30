import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import { GOLD_BADGE, TONE } from './data';
import { inOutCubic, mix, settle, span } from './ui';

/**
 * The divisions along a thin rail of light, no panel round them: each a small diamond, solid in its
 * metal for the ones you've been through, an empty outline for the ones ahead. The rail lights gold
 * from Silver along to Gold, a spark running at its head, and Gold's badge stamps down onto its place,
 * squashing flat and springing back.
 */

export const LEAGUES = ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond'];
/** The leagues you've been through, each in its own metal, flat */
const METAL = ['#CD8547', '#A7B2C6', TONE.gold];
/** Where you are now */
export const GOLD = 2;
/** A node's diamond (its side, before it's turned), Gold's badge, and the glow under it */
const NODE = 10;
const STAMP = 52;
const HALO = 46;
/** Gold's badge sits a little above the rail, clear of its name */
const LIFT = 6;
/** Room either side for the end labels */
const MARGIN = 46;
/** The rail's thickness */
const RAIL = 2;

/** Where each league sits along a row `width` wide */
export const ladderX = (width: number, i: number) => MARGIN + ((width - MARGIN * 2) * i) / (LEAGUES.length - 1);

export function Ladder({
  clock,
  width,
  y,
  start,
  fill,
  stamp,
}: {
  clock: SharedValue<number>;
  width: number;
  /** The track's centre line */
  y: number;
  /** When it comes in, when the track lights up from Silver to Gold, and when Gold stamps down */
  start: number;
  fill: number;
  stamp: number;
}) {
  const left = ladderX(width, 0);
  const step = ladderX(width, 1) - left;
  const track = useAnimatedStyle(() => {
    const k = inOutCubic(span(clock.value, start, 0.4));
    return { opacity: k, transform: [{ scaleX: k }] };
  });
  const lit = useAnimatedStyle(() => {
    const k = inOutCubic(span(clock.value, fill, 0.4));
    return { width: step * (GOLD - 1 + k) * span(clock.value, start + 0.2, 0.2) };
  });
  const head = useAnimatedStyle(() => {
    const t = clock.value;
    const k = inOutCubic(span(t, fill, 0.4));
    return {
      opacity: t > fill && t < stamp + 0.1 ? 1 : 0,
      transform: [{ translateX: step * (GOLD - 1 + k) }],
    };
  });
  return (
    <View style={[StyleSheet.absoluteFill]} pointerEvents="none">
      <Animated.View style={[styles.track, { left, top: y - RAIL / 2, width: width - MARGIN * 2 }, track]} />
      <Animated.View style={[styles.lit, { left, top: y - RAIL / 2 }, lit]} />
      <Animated.View style={[styles.head, { left: left - 4, top: y - 4 }, head]} />
      {LEAGUES.map((name, i) => (
        <Node key={name} name={name} i={i} x={ladderX(width, i)} y={y} clock={clock} start={start} stamp={stamp} />
      ))}
    </View>
  );
}

function Node({
  name,
  i,
  x,
  y,
  clock,
  start,
  stamp,
}: {
  name: string;
  i: number;
  x: number;
  y: number;
  clock: SharedValue<number>;
  start: number;
  stamp: number;
}) {
  const here = i === GOLD;
  const done = i < GOLD;
  const pop = useAnimatedStyle(() => {
    const d = clock.value - start - 0.1 - i * 0.07;
    return { opacity: d > 0 ? 1 : 0, transform: [{ scale: settle(d, 2.2, 6.5) }] };
  });
  // Gold's badge stamping down: dropped in big, squashed flat on landing, springing back
  const badge = useAnimatedStyle(() => {
    const d = clock.value - stamp;
    const k = Math.min(1, Math.max(0, d / 0.14));
    const land = d - 0.14;
    const squash = land > 0 ? 0.3 * Math.exp(-land * 7) * Math.cos(land * 26) : 0;
    return {
      opacity: d > 0 ? 1 : 0,
      transform: [
        { translateY: (1 - k * k) * -60 },
        { scaleX: mix(2.4, 1, k * k) * (1 + squash) },
        { scaleY: mix(2.4, 1, k * k) * (1 - squash) },
      ],
    };
  });
  // A gold glow swelling under the badge as it lands
  const halo = useAnimatedStyle(() => {
    const d = clock.value - stamp - 0.14;
    return { opacity: d > 0 ? Math.min(1, d * 5) : 0, transform: [{ scale: mix(0.4, 1, settle(d, 1.2, 5)) }] };
  });
  const label = useAnimatedStyle(() => {
    const on = here ? span(clock.value, stamp + 0.14, 0.2) : 0;
    return { transform: [{ scale: 1 + on * 0.08 }], opacity: here ? mix(0.6, 1, on) : 1 };
  });
  const node = done
    ? { backgroundColor: METAL[i], borderColor: 'rgba(255, 255, 255, 0.55)', boxShadow: `0 0 8px ${METAL[i]}` }
    : { backgroundColor: 'rgba(5, 8, 12, 0.6)', borderColor: 'rgba(255, 240, 214, 0.45)' };
  return (
    <>
      {here ? null : (
        <Animated.View style={[styles.nodeBox, { left: x - 10, top: y - 10 }, pop]}>
          <View style={[styles.node, node]} />
        </Animated.View>
      )}
      {here ? (
        <>
          <Animated.View style={[styles.halo, { left: x - HALO / 2, top: y - HALO / 2 - LIFT }, halo]} />
          <Animated.View style={[styles.stamp, { left: x - STAMP / 2, top: y - STAMP / 2 - LIFT }, badge]}>
            <Image source={GOLD_BADGE} style={StyleSheet.absoluteFill} contentFit="contain" />
          </Animated.View>
        </>
      ) : null}
      <Animated.View style={[styles.labelBox, { left: x - 40, top: y + 18 }, pop]}>
        <Animated.Text
          style={[styles.label, done ? styles.labelDone : styles.labelAhead, here && styles.labelHere, label]}>
          {name}
        </Animated.Text>
      </Animated.View>
    </>
  );
}

const styles = StyleSheet.create({
  track: {
    position: 'absolute',
    height: RAIL,
    borderRadius: RAIL / 2,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    transformOrigin: 'left',
  },
  lit: {
    position: 'absolute',
    height: RAIL,
    borderRadius: RAIL / 2,
    backgroundColor: TONE.goldLight,
    boxShadow: '0 0 8px rgba(255, 200, 60, 0.9)',
  },
  head: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: TONE.white,
    boxShadow: '0 0 12px 3px rgba(255, 236, 190, 0.9)',
  },
  nodeBox: { position: 'absolute', width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  node: { width: NODE, height: NODE, borderWidth: 1, transform: [{ rotate: '45deg' }] },
  halo: {
    position: 'absolute',
    width: HALO,
    height: HALO,
    borderRadius: HALO / 2,
    experimental_backgroundImage:
      'radial-gradient(circle, rgba(255, 214, 110, 0.55) 0%, rgba(255, 200, 60, 0.18) 45%, rgba(255, 200, 60, 0) 70.7%)',
  },
  stamp: { position: 'absolute', width: STAMP, height: STAMP },
  labelBox: { position: 'absolute', width: 80, alignItems: 'center' },
  // Heavy, so it holds up this small over the grid
  label: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.8,
    textTransform: 'uppercase',
  },
  labelDone: { color: 'rgba(255, 255, 255, 0.78)' },
  labelAhead: { color: 'rgba(255, 240, 214, 0.55)' },
  labelHere: {
    color: TONE.goldLight,
    textShadowColor: 'rgba(255, 190, 60, 0.6)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 6,
  },
});
