import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  Easing,
  interpolate,
  useAnimatedReaction,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { Canvas, Image as SkiaImage, Rect, Shader, Skia, useImage } from 'react-native-skia';
import { scheduleOnRN } from 'react-native-worklets';

import { CARD_ART } from './art';
import { CoinIcon, GemIcon } from './hud';
import { CREAM, FONT, glow, RARITY, RARITY_NAME, type Reward } from './palette';

/**
 * The cards that come up out of the chest: arcing out of its mouth into a fan, spinning twice round
 * as they come, face down, their edges already glowing the colour of what's on them. Tap one and it
 * spins over, a turn and a half, face up; the legendary one has a holographic foil that runs with the
 * phone's tilt. Turned over, a card can be spun with a finger: flicked, it keeps going, slows, and
 * settles face on; a click in the hand each time it goes edge on. Collected, the plain ones fade up
 * and away; the legendary one comes to the middle to be admired, then flies up into your face at the
 * top of the screen.
 */

export type Slot = { x: number; y: number; rot: number; scale: number };
export type Place = { x: number; y: number };
export type Leaving = 'none' | 'fade' | 'feature' | 'fly';

/** The foil: rainbow bands that slide with the tilt, a sheen, glitter */
const HOLO = Skia.RuntimeEffect.Make(`
uniform float2 size;
uniform float2 tilt;
uniform float time;
half4 main(float2 p) {
  float2 uv = p / size;
  float band = uv.x * 1.1 + uv.y * 0.8 + tilt.x * 0.9 - tilt.y * 0.7 + time * 0.04;
  half3 rainbow = half3(0.5 + 0.5 * cos(6.2831 * (band * 1.35 + float3(0.0, 0.33, 0.67))));
  float sheen = pow(0.5 + 0.5 * sin(band * 9.0 - 1.2), 8.0);
  float2 cell = floor(p / 3.0);
  float h = fract(sin(dot(cell, float2(12.9898, 78.233))) * 43758.5453);
  float glitter = step(0.988, fract(h + time * 0.12 + tilt.x * 0.4 + tilt.y * 0.3));
  float a = 0.12 + 0.46 * sheen;
  return half4(rainbow * a + half3(glitter), a + glitter * 0.7);
}`)!;

export function Card({
  reward,
  w,
  slot,
  origin,
  feature,
  flyTo,
  delay,
  flipped,
  leaving,
  clock,
  tilt,
  onTap,
  onEdge,
}: {
  reward: Reward;
  w: number;
  slot: Slot;
  origin: Place;
  feature: Place;
  flyTo: Place & { size: number };
  delay: number;
  flipped: boolean;
  leaving: Leaving;
  clock: SharedValue<number>;
  tilt: SharedValue<{ x: number; y: number }>;
  onTap: () => void;
  /** It's gone edge on, turning */
  onEdge: () => void;
}) {
  const h = w * 1.5;
  const colour = RARITY[reward.rarity];
  const legendary = reward.rarity === 'legendary';
  const e = useSharedValue(0);
  const flip = useSharedValue(0);
  const pop = useSharedValue(0);
  const leave = useSharedValue(0);
  const feat = useSharedValue(0);
  const fly = useSharedValue(0);
  /** Spun by a finger, in degrees (face on at every whole turn) */
  const turn = useSharedValue(0);
  const turnFrom = useSharedValue(0);
  const dragY = useSharedValue(0);
  const seed = slot.rot * 7 + slot.x * 0.013;
  /** How it's turned about its upright, in degrees: two turns out of the chest, a turn and a half over, and the finger's */
  const angle = useDerivedValue(() => (1 - e.value) * 720 + flip.value * 540 + turn.value);
  // Face up once it's turning over; till then, its back whichever way it faces
  const showsFront = useDerivedValue(() => flip.value > 0.15 && Math.cos((angle.value * Math.PI) / 180) < 0);
  useAnimatedReaction(
    () => Math.floor((angle.value + 90) / 180),
    (now, was) => {
      if (was !== null && now !== was) scheduleOnRN(onEdge);
    }
  );

  useEffect(() => {
    e.set(withDelay(delay, withSpring(1, { damping: 15, stiffness: 95, mass: 1 })));
  }, [e, delay]);
  useEffect(() => {
    if (!flipped) return;
    flip.set(withTiming(1, { duration: 900, easing: Easing.out(Easing.cubic) }));
    pop.set(withSequence(withTiming(1, { duration: 200 }), withSpring(0, { damping: 8, stiffness: 160 })));
  }, [flipped, flip, pop]);
  useEffect(() => {
    if (leaving === 'fade') leave.set(withTiming(1, { duration: 420, easing: Easing.in(Easing.cubic) }));
    if (leaving === 'feature') feat.set(withSpring(1, { damping: 16, stiffness: 120 }));
    if (leaving === 'fly') fly.set(withTiming(1, { duration: 560, easing: Easing.in(Easing.cubic) }));
  }, [leaving, leave, feat, fly]);

  const body = useAnimatedStyle(() => {
    const k = e.value;
    // Out of the chest's mouth in an arc, turning as it comes
    const ex = interpolate(k, [0, 1], [origin.x, slot.x]);
    const ey = interpolate(k, [0, 1], [origin.y, slot.y]) - Math.sin(Math.min(1, k) * Math.PI) * 90;
    const fx = interpolate(feat.value, [0, 1], [ex, feature.x]);
    const fy = interpolate(feat.value, [0, 1], [ey, feature.y]);
    const px = interpolate(fly.value, [0, 1], [fx, flyTo.x]);
    const py = interpolate(fly.value, [0, 1], [fy, flyTo.y]);
    const settled = (1 - feat.value) * (1 - fly.value);
    const bob = Math.sin(clock.value * 1.7 + seed) * 4 * Math.min(1, k) * settled;
    let s = interpolate(k, [0, 1], [0.12, slot.scale]);
    s = interpolate(feat.value, [0, 1], [s, 1.32]);
    s = interpolate(fly.value, [0, 1], [s, flyTo.size / w]);
    s *= (1 + pop.value * 0.09) * (1 - leave.value * 0.35);
    const spin = interpolate(k, [0, 1], [seed * 40 - 30, slot.rot]) * (1 - feat.value) * (1 - fly.value);
    return {
      opacity: Math.min(1, k * 5) * (1 - leave.value) * (1 - fly.value * fly.value),
      transform: [
        { translateX: px - slot.x },
        { translateY: py - slot.y + bob - leave.value * 40 },
        { perspective: 900 },
        { rotateZ: `${spin}deg` },
        { rotateY: `${angle.value}deg` },
        { rotateX: `${-dragY.value * 16}deg` },
        { scale: s },
      ],
    };
  });
  const back = useAnimatedStyle(() => ({ opacity: showsFront.value ? 0 : 1 }));
  const front = useAnimatedStyle(() => ({ opacity: showsFront.value ? 1 : 0 }));
  const glow = useAnimatedStyle(() => {
    const breathe = 0.5 + 0.5 * Math.sin(clock.value * 3 + seed);
    const lit = flip.value >= 0.5 ? (legendary ? 0.85 + breathe * 0.15 : 0.55) : 0.45 + breathe * 0.35;
    return { opacity: lit * (1 - leave.value), transform: [{ scale: 1 + breathe * 0.015 + pop.value * 0.05 }] };
  });
  // A sheen sliding across the back now and then, asking to be touched
  const sweep = useAnimatedStyle(() => {
    // Across the card for the first part of each round, then a rest off its edge
    const t = (((clock.value * 0.45 + seed * 0.1) % 1.6) + 1.6) % 1.6;
    return { transform: [{ translateX: -60 + t * (w + 120) }, { rotate: '20deg' }] };
  });

  const tap = Gesture.Tap()
    .runOnJS(true)
    .onEnd(() => onTap());
  // Turned over: spun round by the finger, flicked on, settling face on
  const twirl = Gesture.Pan()
    .minDistance(4)
    .onStart(() => {
      cancelAnimation(turn);
      turnFrom.set(turn.get());
    })
    .onUpdate((ev) => {
      turn.set(turnFrom.get() + ev.translationX * 0.9);
      dragY.set(Math.max(-1, Math.min(1, ev.translationY / 140)));
    })
    .onEnd((ev) => {
      const v = ev.velocityX * 0.9;
      const to = Math.round((turn.get() + v * 0.32) / 360) * 360;
      turn.set(withSpring(to, { velocity: v, damping: 15, stiffness: 70 }));
    })
    .onFinalize(() => {
      dragY.set(withSpring(0, { damping: 9, stiffness: 140 }));
    });

  return (
    <GestureDetector gesture={flipped ? twirl : tap}>
      <Animated.View
        style={[styles.card, { left: slot.x - w / 2, top: slot.y - h / 2, width: w, height: h }, body]}
        accessible
        accessibilityRole="button"
        accessibilityLabel={
          flipped ? `${RARITY_NAME[reward.rarity]}: ${reward.name}, ${reward.amount}` : 'Face-down card, tap to reveal'
        }>
        <Animated.View style={[styles.glow, { boxShadow: `0 0 26px 4px ${colour}` }, glow]} />
        <Animated.View style={[styles.face, back]}>
          <Image source={CARD_ART.back} style={StyleSheet.absoluteFill} contentFit="cover" />
          <View style={[styles.rim, { borderColor: `${colour}CC` }]} />
          <Animated.View style={[styles.sweep, { height: h * 1.6, top: -h * 0.3 }, sweep]} />
        </Animated.View>
        <Animated.View style={[styles.face, { transform: [{ scaleX: -1 }] }, front]}>
          {legendary ? (
            <Foil w={w} h={h} clock={clock} tilt={tilt} turn={turn} dragY={dragY} />
          ) : (
            <Image source={CARD_ART[reward.id]} style={StyleSheet.absoluteFill} contentFit="cover" />
          )}
          <View style={styles.plate} />
          <View style={styles.copy}>
            <Text style={[styles.rarity, { color: colour }]}>{RARITY_NAME[reward.rarity].toUpperCase()}</Text>
            <Text style={styles.name} numberOfLines={1}>
              {reward.name}
            </Text>
            <View style={styles.amount}>
              {reward.id === 'coins' ? <CoinIcon size={17} /> : null}
              {reward.id === 'gems' ? <GemIcon size={17} /> : null}
              {reward.id === 'fox' ? <SymbolView name="pawprint.fill" size={13} tintColor={colour} /> : null}
              <Text style={[styles.amountText, reward.id === 'fox' && { color: colour, fontSize: 14 }]}>
                {reward.amount}
              </Text>
            </View>
          </View>
          <View style={[styles.rim, { borderColor: colour, borderWidth: legendary ? 2.5 : 2 }]} />
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}

/** The legendary art in Skia, the foil laid over it with a screen blend */
function Foil({
  w,
  h,
  clock,
  tilt,
  turn,
  dragY,
}: {
  w: number;
  h: number;
  clock: SharedValue<number>;
  tilt: SharedValue<{ x: number; y: number }>;
  turn: SharedValue<number>;
  dragY: SharedValue<number>;
}) {
  const art = useImage(CARD_ART.fox);
  // The bands slide as it's turned, as well as with the tilt
  const uniforms = useDerivedValue(() => ({
    size: [w, h],
    tilt: [tilt.value.x + Math.sin((turn.value * Math.PI) / 180) * 1.2, tilt.value.y + dragY.value * 0.9],
    time: clock.value,
  }));
  return (
    <Canvas style={StyleSheet.absoluteFill}>
      {art ? <SkiaImage image={art} x={0} y={0} width={w} height={h} fit="cover" /> : null}
      <Rect x={0} y={0} width={w} height={h} blendMode="screen">
        <Shader source={HOLO} uniforms={uniforms} />
      </Rect>
    </Canvas>
  );
}

/** "Legendary!": slammed in over the fan when the legendary card turns, then settled */
export function Banner({ show, colour }: { show: boolean; colour: string }) {
  const k = useSharedValue(0);
  const shimmer = useSharedValue(0);
  useEffect(() => {
    k.set(show ? withSpring(1, { damping: 10, stiffness: 170 }) : withTiming(0, { duration: 200 }));
    if (show) shimmer.set(withRepeat(withTiming(1, { duration: 1800, easing: Easing.inOut(Easing.sin) }), -1, true));
  }, [show, k, shimmer]);
  const style = useAnimatedStyle(() => ({
    opacity: Math.min(1, k.value * 2),
    transform: [{ scale: interpolate(k.value, [0, 1], [2.4, 1]) }],
  }));
  const pulse = useAnimatedStyle(() => ({ transform: [{ scale: 1 + shimmer.value * 0.04 }] }));
  return (
    <Animated.View style={[styles.banner, style]} pointerEvents="none">
      <Animated.Text style={[styles.bannerText, { color: colour }, pulse]}>LEGENDARY!</Animated.Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
  },
  glow: {
    ...StyleSheet.absoluteFill,
    borderRadius: 16,
  },
  face: {
    ...StyleSheet.absoluteFill,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#140C26',
  },
  rim: {
    ...StyleSheet.absoluteFill,
    borderRadius: 16,
    borderWidth: 1.5,
  },
  sweep: {
    position: 'absolute',
    width: 44,
    experimental_backgroundImage:
      'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,240,210,0.28) 50%, rgba(255,255,255,0) 100%)',
  },
  plate: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '46%',
    experimental_backgroundImage:
      'linear-gradient(180deg, rgba(12,7,24,0) 0%, rgba(12,7,24,0.82) 45%, rgba(12,7,24,0.96) 100%)',
  },
  copy: {
    position: 'absolute',
    left: 11,
    right: 11,
    bottom: 11,
  },
  rarity: {
    fontFamily: FONT.semibold,
    fontSize: 9.5,
    letterSpacing: 1.8,
  },
  name: {
    fontFamily: FONT.semibold,
    fontSize: 16,
    color: CREAM,
    marginTop: 1,
  },
  amount: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 4,
  },
  amountText: {
    fontFamily: FONT.bold,
    fontSize: 17,
    color: CREAM,
  },
  banner: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  bannerText: {
    fontFamily: FONT.bold,
    fontSize: 34,
    letterSpacing: 1.5,
    ...glow('rgba(255,150,30,0.9)', 16),
  },
});
