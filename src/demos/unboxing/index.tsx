import { GlassView } from 'expo-glass-effect';
import { StatusBar } from 'expo-status-bar';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { router } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated as Native, PixelRatio, Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Presets } from 'react-native-pulsar';
import Animated, {
  Easing,
  FadeInDown,
  FadeIn,
  FadeOut,
  FadeOutDown,
  SensorType,
  useAnimatedReaction,
  useAnimatedSensor,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Canvas, type CanvasRef } from 'react-native-webgpu';
import { scheduleOnRN } from 'react-native-worklets';

import { lastShipped } from '../sticker-cart/order';
import { formatVnd, PRODUCTS } from '../sticker-cart/catalog';
import { Review } from './review';
import { createUnboxingScene, type Haptic, type Phase, type UnboxingScene } from './scene';

/**
 * Unboxing: what you bought in Market Bag turns up as a real box. Slit the tape with a box
 * cutter, flick the flaps open, peel the seal, sweep the tissue aside, and it floats up out of the
 * shred into the light. Then stamp your rating on the delivery slip.
 */

const DARK = '#2A1E16';

const HAPTICS: Record<Haptic, () => void> = {
  thud: () => Presets.thud(),
  zip: () => Presets.zipper(),
  tick: () => Presets.System.selection(),
  snap: () => Presets.snap(),
  flap: () => Presets.System.impactMedium(),
  flop: () => Presets.System.impactSoft(),
  peel: () => Presets.peck(),
  rustle: () => Presets.rustle(),
  chime: () => Presets.chime(),
  spin: () => Presets.System.impactLight(),
};

/** What to do next, and a little gesture showing how */
const HINTS: Partial<Record<Phase, { icon: SFSymbol; text: string }>> = {
  sealed: { icon: 'scissors', text: 'Run a finger along the tape' },
  flaps: { icon: 'hand.draw.fill', text: 'Flick the flaps open' },
  seal: { icon: 'hand.tap.fill', text: 'Peel off the seal' },
  tissue: { icon: 'hand.point.up.left.fill', text: 'Sweep the tissue paper aside' },
};

export default function Unboxing() {
  const insets = useSafeAreaInsets();
  const canvasRef = useRef<CanvasRef>(null);
  const [order] = useState(lastShipped);
  const [scene, setScene] = useState<UnboxingScene | null>(null);
  const [phase, setPhase] = useState<Phase>('arriving');
  const [round, setRound] = useState(0);
  // Up until the box's first frame is on screen, then gone for good (state, not a shared value, so
  // nothing can bring it back)
  const [arrived, setArrived] = useState(false);
  /** The product up close, if one is */
  const [detail, setDetail] = useState<number | null>(null);
  const gravity = useAnimatedSensor(SensorType.GRAVITY, { interval: 'auto' });

  useEffect(() => {
    let live: UnboxingScene | null = null;
    let cancelled = false;
    (async () => {
      const adapter = await navigator.gpu.requestAdapter();
      const device = await adapter?.requestDevice();
      const context = canvasRef.current?.getContext('webgpu');
      if (cancelled || !device || !context) return;
      const canvas = context.canvas as unknown as {
        width: number;
        height: number;
        clientWidth: number;
        clientHeight: number;
      };
      const ratio = Math.min(PixelRatio.get(), 2.5);
      canvas.width = canvas.clientWidth * ratio;
      canvas.height = canvas.clientHeight * ratio;
      live = createUnboxingScene(context, device, order, {
        onPhase: setPhase,
        onHaptic: (kind) => HAPTICS[kind](),
        onFocus: setDetail,
      });
      live.onFirstFrame(() => setArrived(true));
      // Dev builds expose the scene for QA: unboxScene.debug()
      if (__DEV__) (globalThis as { unboxScene?: UnboxingScene }).unboxScene = live;
      setScene(live);
    })();
    return () => {
      cancelled = true;
      live?.dispose();
    };
  }, [order]);

  // The foil follows the phone's tilt; only told when it's moved enough to matter
  const pushTilt = (packed: number) => scene?.setTilt(Math.floor(packed / 100) / 10 - 1, (packed % 100) / 10 - 1);
  useAnimatedReaction(
    () => {
      const g = gravity.sensor.get();
      const x = Math.round(Math.max(-1, Math.min(1, g.x / 9.8)) * 10) + 10;
      const y = Math.round(Math.max(-1, Math.min(1, g.y / 9.8)) * 10) + 10;
      return x * 100 + y;
    },
    (packed, was) => {
      if (packed !== was) scheduleOnRN(pushTilt, packed);
    }
  );

  const pan = Gesture.Pan()
    .runOnJS(true)
    .minDistance(0)
    .onBegin((e) => scene?.touch('start', e.x, e.y))
    .onUpdate((e) => scene?.touch('move', e.x, e.y))
    .onFinalize((e) => scene?.touch('end', e.x, e.y));

  const again = () => {
    setDetail(null);
    setRound((r) => r + 1);
    scene?.again();
  };

  // The slip slides away while something's up close, and comes back after. Core Animated on the
  // native driver: glass under a view Reanimated styles stops drawing.
  const [slip] = useState(() => new Native.Value(0));
  useEffect(() => {
    Native.timing(slip, {
      toValue: detail === null ? 0 : 420,
      duration: detail === null ? 460 : 320,
      easing: detail === null ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [detail, slip]);

  const hint = HINTS[phase];
  const countOf = (product: number) => order.items.filter((p) => p === product).length;
  // Who it's from, on the close button's line, while the box is still shut; gone once it opens
  const heading = phase === 'sealed' || phase === 'flaps' || phase === 'seal';

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      <GestureDetector gesture={pan}>
        <View style={StyleSheet.absoluteFill}>
          <Canvas ref={canvasRef} style={StyleSheet.absoluteFill} />
        </View>
      </GestureDetector>

      {heading ? (
        <Animated.View
          entering={FadeIn.duration(500)}
          exiting={FadeOut.duration(300)}
          pointerEvents="none"
          style={[styles.heading, { top: insets.top + 8 }]}>
          <Text style={styles.headingTitle}>Delivered</Text>
          <Text style={styles.headingSub}>
            {order.id} · {order.items.length} {order.items.length === 1 ? 'item' : 'items'}
          </Text>
        </Animated.View>
      ) : null}

      {hint ? (
        <Animated.View
          key={phase}
          entering={FadeInDown.duration(380).easing(Easing.out(Easing.cubic))}
          exiting={FadeOut.duration(160)}
          pointerEvents="none"
          style={[styles.hintWrap, { bottom: insets.bottom + 18 }]}>
          <GlassView glassEffectStyle="regular" style={styles.hint}>
            <Nudge phase={phase}>
              <SymbolView name={hint.icon} size={18} tintColor={DARK} />
            </Nudge>
            <Text style={styles.hintText}>{hint.text}</Text>
          </GlassView>
        </Animated.View>
      ) : null}

      {phase === 'done' ? (
        <Native.View
          style={[styles.reviewWrap, { paddingBottom: insets.bottom, transform: [{ translateY: slip }] }]}
          pointerEvents={detail === null ? 'box-none' : 'none'}>
          <Review key={round} orderId={order.id} onAgain={again} />
        </Native.View>
      ) : null}

      {detail !== null ? (
        <Detail
          key={detail}
          product={detail}
          count={countOf(detail)}
          bottom={insets.bottom}
          onClose={() => scene?.focusOn(null)}
        />
      ) : null}

      {arrived ? null : (
        <Animated.View
          exiting={FadeOut.duration(700)}
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, styles.curtain]}>
          <Nudge phase="arriving">
            <SymbolView name="box.truck.fill" size={30} tintColor="rgba(42,30,22,0.7)" />
          </Nudge>
          <Text style={styles.curtainText}>Your order’s on its way…</Text>
        </Animated.View>
      )}
    </View>
  );
}

/**
 * What's up close, on a sheet under it: what it is, a line about it, what you paid, and a way to
 * buy another. The model above it is the one from the box, flown out of its seat.
 */
function Detail({
  product,
  count,
  bottom,
  onClose,
}: {
  product: number;
  count: number;
  bottom: number;
  onClose: () => void;
}) {
  const p = PRODUCTS[product];
  // Each line following the one above it up into place
  const rise = (delay: number) => FadeInDown.delay(delay).duration(420).easing(Easing.out(Easing.cubic));
  return (
    <Animated.View
      entering={FadeInDown.duration(460).easing(Easing.out(Easing.cubic))}
      exiting={FadeOutDown.duration(260).easing(Easing.in(Easing.cubic))}
      style={[styles.detailWrap, { bottom: bottom + 12 }]}>
      <GlassView glassEffectStyle="regular" style={styles.detail}>
        <View style={styles.detailTop}>
          <Animated.Text entering={rise(60)} style={styles.detailEyebrow}>
            {p.category.toUpperCase()} · IN YOUR BOX{count > 1 ? ` ×${count}` : ''}
          </Animated.Text>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Put it back" hitSlop={10}>
            <GlassView glassEffectStyle="regular" isInteractive style={styles.detailClose}>
              <SymbolView name="xmark" size={13} weight="bold" tintColor={DARK} />
            </GlassView>
          </Pressable>
        </View>
        <Animated.Text entering={rise(100)} style={styles.detailName}>
          {p.name}
        </Animated.Text>
        <Animated.Text entering={rise(140)} style={styles.detailNote}>
          {p.note}
        </Animated.Text>
        <Animated.Text entering={rise(180)} style={styles.detailAbout}>
          {p.about}
        </Animated.Text>
        <Animated.View entering={rise(230)} style={styles.detailFoot}>
          <View>
            <Text style={styles.detailPaidLabel}>{count > 1 ? `Paid · ${count} × ${formatVnd(p.price)}` : 'Paid'}</Text>
            <Text style={styles.detailPrice}>{formatVnd(p.price * count)}</Text>
          </View>
          <Pressable
            onPress={() => router.replace({ pathname: '/demo/[id]', params: { id: 'sticker-cart' } })}
            accessibilityRole="button"
            accessibilityLabel="Buy again">
            <View style={styles.buy}>
              <SymbolView name="bag.fill" size={15} tintColor="#FFFFFF" />
              <Text style={styles.buyText}>Buy again</Text>
            </View>
          </Pressable>
        </Animated.View>
        <Animated.View entering={rise(300)} style={styles.detailHint}>
          <SymbolView name="hand.draw.fill" size={13} tintColor="rgba(42,30,22,0.45)" />
          <Text style={styles.detailHintText}>Drag to turn it · tap outside to put it back</Text>
        </Animated.View>
      </GlassView>
    </Animated.View>
  );
}

/** The hint's icon acting out the gesture: sliding along, flicking up, tapping */
function Nudge({ phase, children }: { phase: Phase; children: ReactNode }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.set(
      withRepeat(
        withSequence(
          withTiming(1, { duration: 650, easing: Easing.inOut(Easing.quad) }),
          withTiming(0, { duration: 650, easing: Easing.inOut(Easing.quad) })
        ),
        -1
      )
    );
  }, [t]);
  const style = useAnimatedStyle(() => {
    const k = t.get();
    if (phase === 'sealed' || phase === 'arriving') return { transform: [{ translateX: (k - 0.5) * 16 }] };
    if (phase === 'flaps') return { transform: [{ translateY: -k * 6 }, { rotate: `${-k * 14}deg` }] };
    if (phase === 'tissue') return { transform: [{ translateX: -k * 8 }, { translateY: -k * 4 }] };
    return { transform: [{ scale: 1 + k * 0.18 }] };
  });
  return <Animated.View style={style}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#E6DED3',
  },
  curtain: {
    backgroundColor: '#E6DED3',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  curtainText: {
    fontSize: 15,
    fontWeight: '600',
    color: 'rgba(42,30,22,0.6)',
  },
  heading: {
    position: 'absolute',
    left: 72,
    right: 72,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headingTitle: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: -0.2,
    color: DARK,
  },
  headingSub: {
    marginTop: 1,
    fontSize: 12,
    fontWeight: '500',
    color: 'rgba(42,30,22,0.5)',
    fontVariant: ['tabular-nums'],
  },
  detailWrap: {
    position: 'absolute',
    left: 12,
    right: 12,
  },
  detail: {
    borderRadius: 30,
    paddingHorizontal: 22,
    paddingTop: 18,
    paddingBottom: 16,
  },
  detailTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  detailEyebrow: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    color: 'rgba(42,30,22,0.5)',
  },
  detailClose: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailName: {
    marginTop: 6,
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.6,
    color: DARK,
  },
  detailNote: {
    marginTop: 2,
    fontSize: 14,
    fontWeight: '600',
    color: 'rgba(42,30,22,0.6)',
  },
  detailAbout: {
    marginTop: 12,
    fontSize: 15,
    lineHeight: 21,
    color: 'rgba(42,30,22,0.82)',
  },
  detailFoot: {
    marginTop: 18,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  detailPaidLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(42,30,22,0.5)',
  },
  detailPrice: {
    marginTop: 2,
    fontSize: 22,
    fontWeight: '800',
    color: DARK,
    fontVariant: ['tabular-nums'],
  },
  buy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 46,
    paddingHorizontal: 20,
    borderRadius: 23,
    backgroundColor: DARK,
  },
  buyText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  detailHint: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  detailHintText: {
    fontSize: 12,
    fontWeight: '500',
    color: 'rgba(42,30,22,0.45)',
  },
  hintWrap: {
    position: 'absolute',
    alignSelf: 'center',
  },
  hint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 48,
    paddingHorizontal: 20,
    borderRadius: 24,
  },
  hintText: {
    fontSize: 16,
    fontWeight: '600',
    color: DARK,
  },
  reviewWrap: {
    position: 'absolute',
    inset: 0,
    justifyContent: 'flex-end',
  },
});
