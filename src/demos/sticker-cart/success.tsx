import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { SymbolView } from 'expo-symbols';
import { useEffect, useMemo } from 'react';
import { Image, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Presets } from 'react-native-pulsar';
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  useDerivedValue,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Atlas,
  BlurMask,
  Circle,
  Group,
  LinearGradient,
  Path,
  Skia,
  useColorBuffer,
  useRectBuffer,
  useRSXformBuffer,
  vec,
  type SkImage,
} from 'react-native-skia';

import { LateCanvas } from '@/components/late-canvas';
import { NumericText } from '@/components/numeric-text';

import { formatVnd, PRODUCTS } from './catalog';

const INK = '#17171B';
const SUB = 'rgba(23,23,27,0.5)';
const GREEN = '#1F9D57';
const GLASS = isLiquidGlassAvailable();

export type Placed = { id: string; items: number; total: number; products: number[] };

/** The emblem: its canvas, and the circle's radius in it */
const BOX = 240;
const R = 50;

/**
 * Paid: the moment at the end. Drawn in Skia, a green disc springs up out of nothing, a check is
 * written across it stroke by stroke, a ring ripples out from it and a burst of confetti goes up
 * and drifts down. Under it, what was ordered and when it's coming, and the way back to the shop.
 */
export function Success({ order, heroes, onDone }: { order: Placed; heroes: string[] | null; onDone: () => void }) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const disc = useSharedValue(0);
  const tick = useSharedValue(0);
  const ring = useSharedValue(0);
  const clock = useSharedValue(0);

  useEffect(() => {
    disc.set(withSpring(1, { damping: 11, stiffness: 170, mass: 0.9 }));
    tick.set(withDelay(200, withTiming(1, { duration: 420, easing: Easing.out(Easing.cubic) })));
    ring.set(withDelay(120, withTiming(1, { duration: 900, easing: Easing.out(Easing.quad) })));
    clock.set(withTiming(CONFETTI_LIFE, { duration: CONFETTI_LIFE * 1000, easing: Easing.linear }));
    const t = setTimeout(() => Presets.System.impactMedium(), 240);
    return () => clearTimeout(t);
  }, [disc, tick, ring, clock]);

  const c = BOX / 2;
  const discTurn = useDerivedValue(() => [{ scale: Math.max(0.001, disc.get()) }]);
  const ringR = useDerivedValue(() => R + ring.get() * 70);
  // Nothing until it starts, so there's no empty outline waiting for the disc
  const ringOpacity = useDerivedValue(() => Math.min(1, ring.get() * 10) * (1 - ring.get()) * 0.55);
  const glowOpacity = useDerivedValue(() => Math.min(1, disc.get()) * 0.45);

  // Where the emblem sits on the screen, for the confetti to burst from
  const emblemTop = insets.top + height * 0.16;
  const burstY = emblemTop + BOX / 2;

  const shown = order.products.slice(0, 4);
  const more = order.products.length - shown.length;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* Skia 3.0.3 can hand a canvas mounted mid-scene a blank surface: LateCanvas records it again */}
      <LateCanvas style={[styles.emblem, { top: emblemTop, left: (width - BOX) / 2 }]}>
        <Group opacity={glowOpacity}>
          <Circle cx={c} cy={c + 10} r={R + 8} color="rgba(31,157,87,0.55)">
            <BlurMask blur={26} style="normal" />
          </Circle>
        </Group>
        <Circle cx={c} cy={c} r={ringR} style="stroke" strokeWidth={2.5} color={GREEN} opacity={ringOpacity} />
        <Group transform={discTurn} origin={vec(c, c)}>
          <Circle cx={c} cy={c} r={R}>
            <LinearGradient start={vec(c - R, c - R)} end={vec(c + R, c + R)} colors={['#3CCB7F', GREEN]} />
          </Circle>
          <Path
            path={CHECK(c)}
            style="stroke"
            strokeWidth={8.5}
            strokeCap="round"
            strokeJoin="round"
            color="#FFFFFF"
            start={0}
            end={tick}
          />
        </Group>
      </LateCanvas>

      <View style={[styles.copy, { top: emblemTop + BOX - 18 }]}>
        <Animated.Text
          entering={FadeInDown.delay(260).duration(420).easing(Easing.out(Easing.cubic))}
          style={styles.title}>
          Order placed
        </Animated.Text>
        <Animated.Text
          entering={FadeInDown.delay(340).duration(420).easing(Easing.out(Easing.cubic))}
          style={styles.sub}>
          {order.id} · arriving tomorrow, 9–12h
        </Animated.Text>

        <Animated.View
          entering={FadeInDown.delay(440).duration(460).easing(Easing.out(Easing.cubic))}
          style={styles.summary}>
          <View style={styles.thumbs}>
            {shown.map((p, k) =>
              heroes ? (
                <View key={p} style={[styles.thumb, { marginLeft: k ? -14 : 0, backgroundColor: PRODUCTS[p].tint }]}>
                  <Image source={{ uri: heroes[p] }} style={styles.thumbArt} />
                </View>
              ) : null
            )}
            {more > 0 ? (
              <View style={[styles.thumb, styles.more, { marginLeft: -14 }]}>
                <Text style={styles.moreText}>+{more}</Text>
              </View>
            ) : null}
          </View>
          <View style={styles.summaryText}>
            <Text style={styles.items}>
              {order.items} {order.items === 1 ? 'item' : 'items'} · paid
            </Text>
            <NumericText value={formatVnd(order.total)} fontSize={20} color={INK} weight="bold" />
          </View>
        </Animated.View>
      </View>

      <Animated.View entering={FadeIn.delay(900).duration(360)} style={[styles.foot, { bottom: insets.bottom + 12 }]}>
        <Pressable
          onPress={() => {
            Presets.System.selection();
            onDone();
          }}
          accessibilityRole="button"
          accessibilityLabel="Continue shopping">
          <GlassView
            glassEffectStyle="regular"
            isInteractive
            colorScheme="light"
            style={[styles.done, !GLASS && styles.frost]}>
            <SymbolView name="bag" size={16} weight="semibold" tintColor={INK} />
            <Text style={styles.doneText}>Continue shopping</Text>
          </GlassView>
        </Pressable>
      </Animated.View>

      <Confetti clock={clock} x={width / 2} y={burstY} />
    </View>
  );
}

/** The check, written left to right: down into the crook, then up and away */
const CHECK = (c: number) =>
  Skia.PathBuilder.Make()
    .moveTo(c - 21, c + 1)
    .lineTo(c - 6, c + 16)
    .lineTo(c + 22, c - 14)
    .detach();

// ---- Confetti ----

/** How long the burst lasts, in seconds */
const CONFETTI_LIFE = 3.2;
const N = 110;
/** Pieces of paper, drawn once in white and tinted per piece: a strip, a square, a dot, a ribbon */
const SHAPES = [
  { w: 14, h: 6 },
  { w: 9, h: 9 },
  { w: 8, h: 8 },
  { w: 18, h: 4 },
];
const CELLW = 24;
const PALETTE = ['#FF6B4A', '#1F9D57', '#FFC233', '#4C7DFF', '#B07CFF', '#FF8FB3', '#2BC4B6'].map((hex) => {
  const c = Skia.Color(hex);
  return [c[0], c[1], c[2]];
});

/** One sheet holding the four shapes in white, side by side */
let paper: SkImage | null = null;
function paperSheet() {
  if (paper) return paper;
  const surface = Skia.Surface.Make(CELLW * SHAPES.length, CELLW);
  if (!surface) return null;
  const canvas = surface.getCanvas();
  const paint = Skia.Paint();
  paint.setColor(Skia.Color('#FFFFFF'));
  paint.setAntiAlias(true);
  SHAPES.forEach((s, k) => {
    const x = k * CELLW + (CELLW - s.w) / 2;
    const y = (CELLW - s.h) / 2;
    if (k === 2) canvas.drawCircle(x + s.w / 2, y + s.h / 2, s.w / 2, paint);
    else canvas.drawRRect(Skia.RRectXY(Skia.XYWHRect(x, y, s.w, s.h), 1.5, 1.5), paint);
  });
  surface.flush();
  paper = surface.makeImageSnapshot();
  return paper;
}

/** A fixed random number for piece i, draw k: the same every time, so nothing's stored per piece */
const rnd = (i: number, k: number) => {
  'worklet';
  const s = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return s - Math.floor(s);
};

const GRAVITY = 1500;

/**
 * Each piece flies on a closed-form path, launched up and out with air drag pulling it back to a
 * gentle fall: x = x0 + vx (1 - e^-kt) / k, y = y0 + g t / k + (vy - g / k)(1 - e^-kt) / k. So the
 * whole burst is just a function of the clock: an Atlas of tinted sprites, each frame on the UI
 * thread, with no state per piece.
 */
function Confetti({ clock, x, y }: { clock: SharedValue<number>; x: number; y: number }) {
  const image = useMemo(() => paperSheet(), []);
  const sprites = useRectBuffer(N, (r, i) => {
    'worklet';
    const k = Math.floor(rnd(i, 1) * 4);
    const s = SHAPES[k];
    r.setXYWH(k * CELLW + (CELLW - s.w) / 2, (CELLW - s.h) / 2, s.w, s.h);
  });
  const transforms = useRSXformBuffer(N, (val, i) => {
    'worklet';
    const t = Math.max(0, clock.get() - rnd(i, 2) * 0.12);
    const a = -Math.PI / 2 + (rnd(i, 3) - 0.5) * Math.PI * 1.15;
    const speed = 620 + rnd(i, 4) * 980;
    const vx = Math.cos(a) * speed;
    const vy = Math.sin(a) * speed;
    const drag = 2.1 + rnd(i, 5) * 1.6;
    const e = 1 - Math.exp(-drag * t);
    const px = x + (vx / drag) * e + Math.sin(t * (3 + rnd(i, 6) * 4) + i) * 14 * Math.min(1, t * 2);
    const py = y + (GRAVITY / drag) * t + ((vy - GRAVITY / drag) * e) / drag;
    const turn = rnd(i, 7) * Math.PI * 2 + (rnd(i, 8) - 0.5) * 16 * t;
    const k = Math.floor(rnd(i, 1) * 4);
    const w = SHAPES[k].w;
    const h = SHAPES[k].h;
    // Tumbling: its width flickers as it turns over, like paper does
    const scale = (0.85 + rnd(i, 9) * 0.6) * (0.55 + 0.45 * Math.abs(Math.cos(t * (5 + rnd(i, 10) * 6) + i)));
    const sc = Math.cos(turn) * scale;
    const ss = Math.sin(turn) * scale;
    val.set(sc, ss, px - (sc * w) / 2 + (ss * h) / 2, py - (ss * w) / 2 - (sc * h) / 2);
  });
  const colors = useColorBuffer(N, (c, i) => {
    'worklet';
    const t = clock.get();
    const p = PALETTE[Math.floor(rnd(i, 11) * PALETTE.length)];
    const fade = 1 - Math.max(0, Math.min(1, (t - (CONFETTI_LIFE - 1.1 + rnd(i, 12) * 0.5)) / 0.6));
    c[0] = p[0];
    c[1] = p[1];
    c[2] = p[2];
    c[3] = t > 0 ? fade : 0;
  });
  return (
    <LateCanvas style={StyleSheet.absoluteFill}>
      <Atlas image={image} sprites={sprites} transforms={transforms} colors={colors} colorBlendMode="modulate" />
    </LateCanvas>
  );
}

const styles = StyleSheet.create({
  emblem: {
    position: 'absolute',
    width: BOX,
    height: BOX,
  },
  copy: {
    position: 'absolute',
    left: 24,
    right: 24,
    alignItems: 'center',
    gap: 6,
  },
  title: {
    fontSize: 32,
    fontWeight: '800',
    color: INK,
    letterSpacing: -0.8,
  },
  sub: {
    fontSize: 15,
    color: SUB,
  },
  summary: {
    marginTop: 26,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 12,
    paddingLeft: 12,
    paddingRight: 20,
    borderRadius: 26,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(255,255,255,0.7)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(23,23,27,0.08)',
    boxShadow: '0 10px 30px -16px rgba(90,60,30,0.35)',
  },
  thumbs: {
    flexDirection: 'row',
  },
  thumb: {
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 2.5,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  thumbArt: {
    width: 52,
    height: 52,
  },
  more: {
    backgroundColor: INK,
  },
  moreText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  summaryText: {
    gap: 1,
  },
  items: {
    fontSize: 13,
    fontWeight: '600',
    color: SUB,
  },
  foot: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  done: {
    height: 54,
    paddingHorizontal: 26,
    borderRadius: 27,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  frost: {
    backgroundColor: 'rgba(255,255,255,0.86)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(20,20,30,0.08)',
  },
  doneText: {
    fontSize: 16,
    fontWeight: '700',
    color: INK,
  },
});
