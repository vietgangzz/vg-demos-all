import { SymbolView } from 'expo-symbols';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Presets } from 'react-native-pulsar';
import Animated, {
  Easing,
  Keyframe,
  useAnimatedReaction,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { BlurMask, Group, LinearGradient, Path, Skia, useClock, vec } from 'react-native-skia';
import { scheduleOnRN } from 'react-native-worklets';

import { LateCanvas } from '@/components/late-canvas';
import { NumericText } from '@/components/numeric-text';

import { formatVnd } from './catalog';

const INK = '#17171B';
const H = 58;
/** How long to hold it */
const HOLD = 900;

/** The label popping in when it's paid */
const POP = new Keyframe({
  0: { opacity: 0, transform: [{ scale: 0.6 }] },
  60: { opacity: 1, transform: [{ scale: 1.08 }] },
  100: { opacity: 1, transform: [{ scale: 1 }] },
}).duration(320);

/**
 * Hold to pay. Pressed, the button fills with green from the left like a glass filling up, its
 * front a soft glowing ripple, ticking under your thumb faster and faster as it goes. Let go early
 * and it drains back. Held to the end, the ripple settles flat, the whole button is green and it
 * says Paid.
 *
 * The liquid is a Skia path rebuilt every frame on the UI thread from two numbers, how full it is
 * and the time: the front is two sine waves running against each other, so it never repeats, and
 * it calms as the button fills.
 */
export function HoldToPay({ amount, onDone }: { amount: number; onDone: () => void }) {
  const fill = useSharedValue(0);
  const press = useSharedValue(0);
  const done = useSharedValue(0);
  const shine = useSharedValue(0);
  const width = useSharedValue(0);
  const clock = useClock();
  /** Set on the UI thread the moment it's through, so nothing after that can drain it */
  const through = useSharedValue(0);
  const [paid, setPaid] = useState(false);
  // Pressing re-renders it, which hands its canvas a fresh recording: a canvas mounted inside the
  // foot as it slides in can be left with a blank surface until it's next rendered
  const [, setHeld] = useState(false);

  const pay = () => {
    setPaid(true);
    done.set(withTiming(1, { duration: 360, easing: Easing.out(Easing.cubic) }));
    onDone();
  };

  // A glint runs across it every so often while it waits
  useEffect(() => {
    shine.set(
      withRepeat(
        withSequence(
          withDelay(1600, withTiming(1, { duration: 1000, easing: Easing.inOut(Easing.quad) })),
          withTiming(0, { duration: 0 })
        ),
        -1
      )
    );
  }, [shine]);

  // A tick under the thumb at each step of the fill; it eases in, so they come faster and faster
  useAnimatedReaction(
    () => Math.floor(fill.get() * 16),
    (n, was) => {
      if (was !== null && n > was && n < 16) Presets.System.impactLight();
    }
  );

  const gesture = Gesture.LongPress()
    .enabled(!paid)
    .minDuration(HOLD)
    .onBegin(() => {
      if (through.get()) return;
      press.set(withTiming(1, { duration: 140, easing: Easing.out(Easing.cubic) }));
      fill.set(withTiming(1, { duration: HOLD, easing: Easing.in(Easing.quad) }));
      scheduleOnRN(setHeld, true);
    })
    .onStart(() => {
      through.set(1);
      fill.set(1);
      scheduleOnRN(pay);
    })
    .onFinalize(() => {
      press.set(withTiming(0, { duration: 260, easing: Easing.out(Easing.cubic) }));
      // Let go early, it drains back; once it's through it stays full, even as it's switched off
      if (!through.get()) fill.set(withTiming(0, { duration: 340, easing: Easing.out(Easing.cubic) }));
      scheduleOnRN(setHeld, false);
    });

  // ---- The liquid ----
  /** The front's ripple: big while it's filling, nothing once it's full and paid */
  const amp = useDerivedValue(() => 5 * Math.min(1, fill.get() * 5) * (1 - done.get()));
  /** Where the front is: past the right edge, ripple and all, once it's full */
  const front = (w: number, f: number, a: number) => {
    'worklet';
    return f * (w + a * 2 + 10) - a - 5;
  };
  const ripple = (y: number, t: number, a: number) => {
    'worklet';
    return a * (0.65 * Math.sin(y * 0.15 + t * 6.5) + 0.35 * Math.sin(y * 0.33 - t * 4.1));
  };
  const liquid = useDerivedValue(() => {
    const w = width.get();
    const f = fill.get();
    const p = Skia.PathBuilder.Make();
    if (w <= 0 || f <= 0.002) return p.detach();
    const t = clock.get() / 1000;
    const a = amp.get();
    const x = front(w, f, a);
    p.moveTo(-4, -4);
    for (let y = -4; y <= H + 4; y += 3) p.lineTo(x + ripple(y, t, a), y);
    p.lineTo(-4, H + 4);
    p.close();
    return p.detach();
  });
  /** Just the front, for its glow and the light along it */
  const meniscus = useDerivedValue(() => {
    const w = width.get();
    const f = fill.get();
    const p = Skia.PathBuilder.Make();
    if (w <= 0 || f <= 0.002) return p.detach();
    const t = clock.get() / 1000;
    const a = amp.get();
    const x = front(w, f, a);
    for (let y = -4; y <= H + 4; y += 3) {
      if (y === -4) p.moveTo(x + ripple(y, t, a), y);
      else p.lineTo(x + ripple(y, t, a), y);
    }
    return p.detach();
  });
  const edge = useDerivedValue(() => Math.min(1, fill.get() * 8) * (1 - done.get()));
  const pill = useDerivedValue(() => Skia.RRectXY(Skia.XYWHRect(0, 0, width.get(), H), H / 2, H / 2));
  const across = useDerivedValue(() => vec(width.get(), 0));

  const body = useAnimatedStyle(() => ({ transform: [{ scale: 1 - press.get() * 0.035 }] }));
  const glint = useAnimatedStyle(() => ({
    opacity: Math.max(0, 1 - fill.get() * 6) * (1 - done.get()),
    transform: [{ translateX: -120 + shine.get() * 460 }, { skewX: '-20deg' }],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        onLayout={(e) => width.set(e.nativeEvent.layout.width)}
        style={[styles.pay, body]}
        accessibilityRole="button"
        accessibilityLabel={paid ? 'Paid' : `Hold to pay ${formatVnd(amount)}`}>
        <LateCanvas style={StyleSheet.absoluteFill}>
          <Group clip={pill}>
            <Path path={liquid}>
              <LinearGradient start={vec(0, 0)} end={across} colors={['#0E7A40', '#23B865']} />
            </Path>
            <Group opacity={edge}>
              <Path path={meniscus} style="stroke" strokeWidth={10} strokeCap="round" color="rgba(94,227,155,0.55)">
                <BlurMask blur={7} style="normal" />
              </Path>
              <Path path={meniscus} style="stroke" strokeWidth={1.6} strokeCap="round" color="rgba(255,255,255,0.6)" />
            </Group>
          </Group>
        </LateCanvas>
        <Animated.View pointerEvents="none" style={[styles.glint, glint]} />
        {paid ? (
          <Animated.View key="paid" entering={POP} style={styles.label}>
            <SymbolView name="checkmark" size={16} weight="heavy" tintColor="#FFFFFF" />
            <Text style={styles.text}>Paid</Text>
          </Animated.View>
        ) : (
          <View style={styles.label}>
            <SymbolView name="lock.fill" size={14} tintColor="#FFFFFF" />
            <Text style={styles.text}>Hold to pay</Text>
            <NumericText value={formatVnd(amount)} fontSize={16} color="rgba(255,255,255,0.72)" weight="semibold" />
          </View>
        )}
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  pay: {
    flex: 1,
    height: H,
    borderRadius: H / 2,
    borderCurve: 'continuous',
    backgroundColor: INK,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  text: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
  },
  glint: {
    position: 'absolute',
    left: 0,
    top: -10,
    bottom: -10,
    width: 60,
    experimental_backgroundImage:
      'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.14) 50%, rgba(255,255,255,0) 100%)',
  },
});
