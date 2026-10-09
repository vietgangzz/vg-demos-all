import { GlassView } from 'expo-glass-effect';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Presets } from 'react-native-pulsar';
import Animated, {
  Easing,
  FadeInDown,
  FadeInUp,
  Keyframe,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

/**
 * Rating the order the way a delivery slip is signed off: a foil stamp hangs over a row of five
 * empty stars. Tap how many and it hops along the row pressing a gold star into each, thump, thump, then
 * the big round ĐÃ NHẬN HÀNG stamp comes down across the slip, and a few coins for your trouble.
 */

const INK = '#C8242F';
const PAPER = '#FBF6EC';
const DARK = '#2A1E16';
const SLOT = 58;
const PAD = 12;
const CARD_W = SLOT * 5 + PAD * 2;

/** Gold foil: its deep edge, its face, and the light along its top */
const GOLD_DEEP = '#C98A00';
const GOLD = '#F5B70A';
const GOLD_LIGHT = '#FFE07A';

/** The approval stamp slamming down: too big, then hard onto the paper, a little crooked */
const SLAM = new Keyframe({
  0: { opacity: 0, transform: [{ scale: 2.4 }, { rotate: '-4deg' }] },
  55: { opacity: 1, transform: [{ scale: 0.92 }, { rotate: '-13deg' }] },
  100: { opacity: 0.92, transform: [{ scale: 1 }, { rotate: '-12deg' }] },
}).duration(380);

/** A foil star pressed onto the card: lifted off the paper, then flat down onto it */
const PRESS = new Keyframe({
  0: { opacity: 0, transform: [{ scale: 1.35 }] },
  60: { opacity: 1, transform: [{ scale: 0.97 }], easing: Easing.in(Easing.quad) },
  100: { opacity: 1, transform: [{ scale: 1 }], easing: Easing.out(Easing.quad) },
}).duration(240);

export function Review({ orderId, onAgain }: { orderId: string; onAgain: () => void }) {
  const [rating, setRating] = useState(0);
  const [inked, setInked] = useState(0);
  const [approved, setApproved] = useState(false);
  const hover = useSharedValue(2);
  const press = useSharedValue(0);
  const bob = useSharedValue(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const later = (ms: number, fn: () => void) => timers.current.push(setTimeout(fn, ms));
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  useEffect(() => {
    bob.set(
      withRepeat(
        withSequence(
          withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) }),
          withTiming(0, { duration: 900, easing: Easing.inOut(Easing.quad) })
        ),
        -1
      )
    );
  }, [bob]);

  const stamp = (n: number) => {
    if (rating) return;
    setRating(n);
    Presets.System.selection();
    // Along the row, pressing a star into each on the way
    for (let i = 0; i < n; i++) {
      later(i * 260, () => hover.set(withTiming(i, { duration: 160, easing: Easing.out(Easing.cubic) })));
      later(i * 260 + 150, () =>
        press.set(
          withSequence(
            withTiming(1, { duration: 70, easing: Easing.in(Easing.quad) }),
            withTiming(0, { duration: 180, easing: Easing.out(Easing.quad) })
          )
        )
      );
      later(i * 260 + 220, () => {
        Presets.stamp();
        setInked(i + 1);
      });
    }
    later(n * 260 + 420, () => {
      Presets.gavel();
      setApproved(true);
    });
    later(n * 260 + 1000, () => Presets.coinDrop());
  };

  const tool = useAnimatedStyle(() => ({
    opacity: approved ? withTiming(0, { duration: 250 }) : 1,
    transform: [
      { translateX: PAD + hover.get() * SLOT + SLOT / 2 - 26 },
      { translateY: -58 + press.get() * 44 - bob.get() * 4 * (1 - press.get()) },
      { scaleY: 1 - press.get() * 0.06 },
    ],
  }));

  return (
    <Animated.View entering={FadeInDown.duration(460).easing(Easing.out(Easing.cubic))} style={styles.wrap}>
      <GlassView glassEffectStyle="regular" style={styles.sheet}>
        <Text style={styles.title}>{approved ? 'Order received' : 'Everything there?'}</Text>
        <Text style={styles.sub}>
          {approved ? `${orderId} · thanks for shopping with us` : 'Stamp your rating: tap how many stars'}
        </Text>
        <View style={styles.card}>
          {[0, 1, 2, 3, 4].map((i) => (
            <Pressable
              key={i}
              onPress={() => stamp(i + 1)}
              accessibilityRole="button"
              accessibilityLabel={`${i + 1} star${i ? 's' : ''}`}
              style={[styles.slot, { left: PAD + i * SLOT }]}>
              <SymbolView name="star" size={34} tintColor="rgba(201,138,0,0.28)" />
              {i < inked ? <InkStar seed={i} /> : null}
            </Pressable>
          ))}
          <Animated.View pointerEvents="none" style={[styles.tool, tool]}>
            <View style={styles.knob} />
            <View style={styles.neck} />
            <View style={styles.block} />
            <View style={styles.rubber} />
          </Animated.View>
          {approved ? (
            <Animated.View entering={SLAM} pointerEvents="none" style={styles.approval}>
              <View style={styles.ringInner}>
                <Text style={styles.approvalSmall}>★ VG MARKET ★</Text>
                <Text style={styles.approvalBig}>ĐÃ NHẬN</Text>
                <Text style={styles.approvalBig}>HÀNG</Text>
                <Text style={styles.approvalSmall}>{orderId}</Text>
              </View>
            </Animated.View>
          ) : null}
        </View>
        {approved ? (
          <View style={styles.after}>
            <Animated.View
              entering={FadeInUp.delay(450).duration(380).easing(Easing.out(Easing.cubic))}
              style={styles.reward}>
              <SymbolView name="dollarsign.circle.fill" size={18} tintColor="#E8A317" />
              <Text style={styles.rewardText}>+200 xu</Text>
            </Animated.View>
            <Animated.View
              entering={FadeInUp.delay(620).duration(380).easing(Easing.out(Easing.cubic))}
              style={styles.actions}>
              <Pressable onPress={onAgain} accessibilityRole="button" accessibilityLabel="Unbox it again">
                <GlassView glassEffectStyle="regular" isInteractive style={styles.again}>
                  <SymbolView name="arrow.counterclockwise" size={15} weight="semibold" tintColor={DARK} />
                </GlassView>
              </Pressable>
              {/* The last stop: into the fridge */}
              <Pressable
                onPress={() => router.replace({ pathname: '/demo/[id]', params: { id: 'fridge' } })}
                accessibilityRole="button"
                accessibilityLabel="Put it away">
                <View style={styles.putAway}>
                  <SymbolView name="refrigerator.fill" size={15} tintColor="#FFFFFF" />
                  <Text style={styles.putAwayText}>Put it away</Text>
                </View>
              </Pressable>
            </Animated.View>
          </View>
        ) : null}
      </GlassView>
    </Animated.View>
  );
}

/**
 * A star pressed in gold foil: a deeper gold edge, the face, a lighter gold catching the light
 * along its top, and a glint that runs across it once as it lands
 */
function InkStar({ seed }: { seed: number }) {
  const turn = ((seed * 37) % 10) - 5;
  const shine = useSharedValue(0);
  useEffect(() => {
    shine.set(withTiming(1, { duration: 700, easing: Easing.out(Easing.quad) }));
  }, [shine]);
  const glint = useAnimatedStyle(() => ({
    opacity: Math.sin(shine.get() * Math.PI),
    transform: [{ translateX: -26 + shine.get() * 52 }, { rotate: '20deg' }],
  }));
  return (
    // The pop on the outside, the tilt on the inside, so the entering animation doesn't undo the tilt
    <Animated.View entering={PRESS} pointerEvents="none" style={styles.ink}>
      <View style={[styles.inkTurn, { transform: [{ rotate: `${turn}deg` }] }]}>
        <View style={styles.layer}>
          <SymbolView name="star.fill" size={44} tintColor={GOLD_DEEP} />
        </View>
        <View style={[styles.layer, styles.face]}>
          <SymbolView name="star.fill" size={40} tintColor={GOLD} />
        </View>
        <View style={[styles.layer, styles.highlight]}>
          <SymbolView name="star.fill" size={26} tintColor={GOLD_LIGHT} />
        </View>
        <Animated.View style={[styles.glint, glint]} />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 12,
  },
  sheet: {
    borderRadius: 30,
    borderCurve: 'continuous',
    // A warm paper fill under the glass, so the slip reads as one even where the glass can't draw
    backgroundColor: 'rgba(255,250,242,0.72)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.9)',
    paddingTop: 18,
    paddingBottom: 18,
    alignItems: 'center',
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: DARK,
    letterSpacing: -0.4,
  },
  sub: {
    marginTop: 3,
    fontSize: 14,
    color: 'rgba(42,30,22,0.6)',
  },
  card: {
    marginTop: 64,
    width: CARD_W,
    height: 92,
    borderRadius: 16,
    backgroundColor: PAPER,
    boxShadow: '0 8px 20px -10px rgba(60,40,20,0.35)',
  },
  slot: {
    position: 'absolute',
    top: 17,
    width: SLOT,
    height: SLOT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ink: {
    position: 'absolute',
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inkTurn: {
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  layer: {
    position: 'absolute',
    inset: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  face: {
    top: 1,
  },
  highlight: {
    top: -5,
    opacity: 0.75,
  },
  glint: {
    position: 'absolute',
    top: -6,
    width: 8,
    height: 58,
    backgroundColor: 'rgba(255,255,255,0.75)',
    borderRadius: 4,
  },
  tool: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 52,
    alignItems: 'center',
  },
  knob: {
    width: 30,
    height: 30,
    borderRadius: 15,
    experimental_backgroundImage: 'linear-gradient(160deg, #B7835A 0%, #6E4528 100%)',
  },
  neck: {
    width: 14,
    height: 16,
    marginTop: -3,
    experimental_backgroundImage: 'linear-gradient(90deg, #6E4528 0%, #A2724B 50%, #6E4528 100%)',
  },
  block: {
    width: 52,
    height: 18,
    borderRadius: 4,
    experimental_backgroundImage: 'linear-gradient(180deg, #A2724B 0%, #6E4528 100%)',
  },
  rubber: {
    width: 46,
    height: 7,
    borderBottomLeftRadius: 3,
    borderBottomRightRadius: 3,
    backgroundColor: GOLD_DEEP,
  },
  approval: {
    position: 'absolute',
    right: -14,
    top: -40,
    width: 116,
    height: 116,
    borderRadius: 58,
    borderWidth: 3.5,
    borderColor: INK,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringInner: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 1.5,
    borderColor: INK,
    alignItems: 'center',
    justifyContent: 'center',
  },
  approvalBig: {
    fontSize: 17,
    lineHeight: 19,
    fontWeight: '900',
    color: INK,
    letterSpacing: 0.5,
  },
  approvalSmall: {
    fontSize: 8,
    fontWeight: '800',
    color: INK,
    letterSpacing: 1,
    marginVertical: 2,
  },
  after: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  reward: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 40,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: 'rgba(232,163,23,0.16)',
  },
  rewardText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#9A6A08',
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  again: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  putAway: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 40,
    paddingHorizontal: 18,
    borderRadius: 20,
    backgroundColor: DARK,
  },
  putAwayText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
