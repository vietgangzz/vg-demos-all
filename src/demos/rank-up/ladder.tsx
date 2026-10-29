import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import { FOIL, GOLD_BADGE, ROUNDED, TONE } from './data';
import { inOutCubic, mix, settle, span } from './ui';

/**
 * The leagues in a row on a plate of frosted cream glass, each a flat coin: the ones you've been
 * through ticked, in their metal, the ones ahead locked. The track
 * fills with gold from Silver along to Gold, and Gold's badge stamps down onto its place, squashing
 * flat and springing back.
 */

export const LEAGUES = ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond'];
/** The leagues you've been through, each in its own metal, flat */
const METAL = ['#CD8547', '#A7B2C6', TONE.gold];
/** The ones still ahead, all alike: a muted gold, its lock and its name */
const LOCKED = { fill: '#E9C584', ink: '#A0702E' };
/** Where you are now */
export const GOLD = 2;
const NODE = 30;
const STAMP = 56;
const HALO = 64;
/** Gold's badge sits a little above the track, clear of its name */
const LIFT = 7;
/** Room either side for the end labels */
const MARGIN = 50;
/** The plate's inset from the screen's sides, and how far it reaches above and below the track */
const INSET = 16;
const ABOVE = 30;
const BELOW = 48;

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
  const plate = useAnimatedStyle(() => {
    const k = span(clock.value, start - 0.1, 0.35);
    return { opacity: k, transform: [{ translateY: (1 - inOutCubic(k)) * 24 }] };
  });
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
      <Animated.View
        style={[styles.plate, { left: INSET, right: INSET, top: y - ABOVE, height: ABOVE + BELOW }, plate]}
      />
      <Animated.View style={[styles.track, { left, top: y - 4, width: width - MARGIN * 2 }, track]} />
      <Animated.View style={[styles.lit, { left, top: y - 4 }, lit]} />
      <Animated.View style={[styles.head, { left: left - 9, top: y - 9 }, head]} />
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
    return { transform: [{ scale: 1 + on * 0.15 }], opacity: here ? mix(0.75, 1, on) : done ? 0.95 : 0.9 };
  });
  const coin = { backgroundColor: done ? METAL[i] : LOCKED.fill };
  return (
    <>
      <Animated.View style={[styles.node, { left: x - NODE / 2, top: y - NODE / 2 }, coin, pop]}>
        {done ? <SymbolView name="checkmark" size={13} weight="black" tintColor={TONE.white} /> : null}
        {i > GOLD ? <SymbolView name="lock.fill" size={12} tintColor={TONE.white} /> : null}
      </Animated.View>
      {here ? (
        <>
          <Animated.View style={[styles.halo, { left: x - HALO / 2, top: y - HALO / 2 - LIFT }, halo]} />
          <Animated.View style={[styles.stamp, { left: x - STAMP / 2, top: y - STAMP / 2 - LIFT }, badge]}>
            <Image source={GOLD_BADGE} style={StyleSheet.absoluteFill} contentFit="contain" />
          </Animated.View>
        </>
      ) : null}
      <Animated.View style={[styles.labelBox, { left: x - 40, top: y + 22 }, pop]}>
        <Animated.Text
          style={[styles.label, { color: done ? TONE.umber : LOCKED.ink }, here && styles.labelHere, label]}>
          {name}
        </Animated.Text>
      </Animated.View>
    </>
  );
}

const styles = StyleSheet.create({
  plate: {
    position: 'absolute',
    borderRadius: 24,
    backgroundColor: 'rgba(255, 249, 232, 0.5)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.9)',
    boxShadow: `inset 0 2px 1px -0.5px rgba(255,255,255,0.9), 0 4px 0 rgba(180, 82, 10, 0.3), 0 14px 24px ${TONE.dropWarm}`,
  },
  track: {
    position: 'absolute',
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(94, 38, 0, 0.16)',
    boxShadow: 'inset 0 1.5px 2px rgba(94, 38, 0, 0.3)',
    transformOrigin: 'left',
  },
  lit: {
    position: 'absolute',
    height: 8,
    borderRadius: 4,
    experimental_backgroundImage: FOIL,
    boxShadow: '0 0 12px rgba(255, 200, 60, 0.9)',
  },
  head: {
    position: 'absolute',
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: TONE.white,
    boxShadow: '0 0 16px 4px rgba(255, 240, 200, 0.9)',
  },
  node: {
    position: 'absolute',
    width: NODE,
    height: NODE,
    borderRadius: NODE / 2,
    borderWidth: 2,
    borderColor: TONE.white,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 2px 4px rgba(94, 38, 0, 0.25)',
  },
  halo: {
    position: 'absolute',
    width: HALO,
    height: HALO,
    borderRadius: HALO / 2,
    backgroundColor: 'rgba(255, 210, 90, 0.35)',
    boxShadow: '0 0 22px 8px rgba(255, 200, 60, 0.7)',
  },
  stamp: { position: 'absolute', width: STAMP, height: STAMP },
  labelBox: { position: 'absolute', width: 80, alignItems: 'center' },
  label: {
    fontFamily: ROUNDED,
    fontWeight: '800',
    fontSize: 12,
    textShadowColor: 'rgba(255,255,255,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 0,
  },
  labelHere: { fontWeight: '900', color: TONE.amber },
});
