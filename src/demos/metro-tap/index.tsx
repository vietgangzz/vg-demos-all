import {
  BlurMask,
  Canvas,
  Circle,
  Group,
  LinearGradient,
  Path,
  RoundedRect,
  Skia,
  vec,
} from 'react-native-skia';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Presets, useRealtimeComposer } from 'react-native-pulsar';
import Animated, {
  Easing,
  interpolate,
  interpolateColor,
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { RollingNumber } from '@/components/rolling-number';
import { fareBetween, formatVnd, LINE_1, STATIONS } from '@/demos/metro/line-1';
import { useSound } from '@/hooks/use-sound';

const CARD_W = 280;
const CARD_H = 176;
const READER = 156;
const SENSE_RANGE = 220;
const SNAP_DISTANCE = 46;
const ENTRY = 0;
const MIN_FARE = fareBetween(0, 1);

type Tone = 'idle' | 'ok' | 'error';
type Screen = { tone: Tone; title: string; subtitle: string };

const IDLE: Screen = { tone: 'idle', title: 'Tap your card', subtitle: 'Bến Thành · Gate 3 · Entry' };
const TONE = {
  idle: '#E8EAED',
  ok: '#3DDC84',
  error: '#FF4D4F',
};

export default function TapToRide() {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [balance, setBalance] = useState(30000);
  const [entry, setEntry] = useState<number | null>(null);
  const [exitAt, setExitAt] = useState(3);
  const [screen, setScreen] = useState<Screen>(IDLE);
  const beep = useSound(require('@/assets/sounds/card-beep.wav'));
  const errorBeep = useSound(require('@/assets/sounds/card-error.wav'));
  const composer = useRealtimeComposer();

  // Geometry: card translation is relative to its home slot at the bottom
  const readerCY = insets.top + 268;
  const cardHomeCY = height - insets.bottom - 28 - CARD_H / 2;
  const readerDY = readerCY - cardHomeCY;

  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const lift = useSharedValue(0);
  const proximity = useSharedValue(0);
  const locked = useSharedValue(false);
  const ripple = useSharedValue(0);
  const shake = useSharedValue(0);
  const tone = useSharedValue(0); // 0 idle, 1 ok, -1 error

  const show = (next: Screen) => {
    setScreen(next);
    tone.set(withTiming(next.tone === 'ok' ? 1 : next.tone === 'error' ? -1 : 0, { duration: 180 }));
  };

  // Validator screen falls back to idle a few seconds after each result
  useEffect(() => {
    if (screen.tone === 'idle') return;
    const timer = setTimeout(() => {
      setScreen(IDLE);
      tone.set(withTiming(0, { duration: 400 }));
    }, 3200);
    return () => clearTimeout(timer);
  }, [screen, tone]);

  const fail = (title: string, subtitle: string) => {
    errorBeep();
    Presets.System.notificationError();
    shake.set(withSequence(...[10, -10, 7, -7, 3, 0].map((x) => withTiming(x, { duration: 55 }))));
    ripple.set(0);
    ripple.set(withTiming(1, { duration: 900, easing: Easing.out(Easing.quad) }));
    show({ tone: 'error', title, subtitle });
  };

  const succeed = (title: string, subtitle: string) => {
    beep();
    Presets.System.notificationSuccess();
    ripple.set(0);
    ripple.set(withTiming(1, { duration: 900, easing: Easing.out(Easing.quad) }));
    show({ tone: 'ok', title, subtitle });
  };

  const onTap = () => {
    if (entry === null) {
      if (balance < MIN_FARE) {
        fail('Insufficient balance', `Minimum fare ${formatVnd(MIN_FARE)}`);
        return;
      }
      setEntry(ENTRY);
      succeed('Welcome aboard', `Tap in · ${STATIONS[ENTRY].name} · 08:42`);
      return;
    }
    const fare = fareBetween(entry, exitAt);
    if (balance < fare) {
      fail('Please top up', `Fare ${formatVnd(fare)} · Balance ${formatVnd(balance)}`);
      return;
    }
    setBalance((b) => b - fare);
    setEntry(null);
    succeed('Have a nice day', `${STATIONS[exitAt].name} · −${formatVnd(fare)}`);
  };

  const topUp = () => {
    Presets.coinDrop();
    setBalance((b) => b + 100000);
  };

  const pan = Gesture.Pan()
    .onBegin(() => {
      lift.value = withSpring(1, { damping: 14 });
      Presets.System.impactLight();
    })
    .onChange((e) => {
      if (locked.value) return;
      tx.value += e.changeX;
      ty.value += e.changeY;
      const d = Math.hypot(tx.value, ty.value - readerDY);
      const p = Math.max(0, Math.min(1, 1 - d / SENSE_RANGE));
      proximity.value = p;
      if (p > 0.05) {
        // Haptic "field" that thickens as the card nears the reader
        composer.set(0.12 + p * p * 0.75, 0.25 + p * 0.6);
      } else {
        composer.stop();
      }
      if (d < SNAP_DISTANCE) {
        locked.value = true;
        composer.stop();
        tx.value = withSpring(0, { damping: 18, stiffness: 260 });
        ty.value = withSpring(readerDY, { damping: 18, stiffness: 260 });
        lift.value = withSpring(0.4);
        scheduleOnRN(onTap);
      }
    })
    .onFinalize(() => {
      composer.stop();
      locked.value = false;
      proximity.value = withTiming(0, { duration: 300 });
      lift.value = withSpring(0);
      tx.value = withSpring(0, { damping: 16, stiffness: 140 });
      ty.value = withSpring(0, { damping: 16, stiffness: 140 });
    });

  const cardStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value + shake.value },
      { translateY: ty.value },
      { rotate: `${interpolate(tx.value, [-200, 200], [-8, 8])}deg` },
      { scale: interpolate(lift.value, [0, 1], [1, 1.04]) },
    ],
    boxShadow: `0 ${8 + lift.value * 18}px ${18 + lift.value * 28}px rgba(0,0,0,${0.35 + lift.value * 0.2})`,
  }));

  const sheenX = useDerivedValue(() => CARD_W * 0.5 - tx.value * 0.9);
  const sheenStart = useDerivedValue(() => vec(sheenX.value - 120, 0));
  const sheenEnd = useDerivedValue(() => vec(sheenX.value + 120, CARD_H));

  const exitOptions = STATIONS.slice(1);
  const lcd: Screen =
    screen.tone === 'idle' && entry !== null
      ? { tone: 'idle', title: 'Tap out at your exit', subtitle: `In at ${STATIONS[entry].name} · 08:42` }
      : screen;

  return (
    <View style={styles.container}>
      {/* Validator body */}
      <View style={[styles.validator, { top: insets.top + 60, height: readerCY - insets.top - 60 + READER / 2 + 30 }]}>
        <View style={styles.lcd}>
          <Text style={[styles.lcdTitle, { color: TONE[lcd.tone] }]}>{lcd.title}</Text>
          <Text style={styles.lcdSubtitle} numberOfLines={1}>
            {lcd.subtitle}
          </Text>
        </View>
        <LedStrip tone={screen.tone} />
      </View>

      <Reader cx={width / 2} cy={readerCY} proximity={proximity} ripple={ripple} tone={tone} />

      {/* Trip controls */}
      <View style={[styles.controls, { top: readerCY + READER / 2 + 48 }]}>
        <View style={styles.balanceRow}>
          <View>
            <Text style={styles.caption}>Balance</Text>
            <RollingNumber text={formatVnd(balance)} fontSize={28} color="#F4F5F7" style={{ fontWeight: 700 }} />
          </View>
          <Pressable onPress={topUp} style={({ pressed }) => [styles.topUp, pressed && { opacity: 0.6 }]}>
            <Text style={styles.topUpText}>+ 100.000 ₫</Text>
          </Pressable>
        </View>

        <Text style={[styles.caption, { marginTop: 14 }]}>
          {entry === null ? 'Tap in at Bến Thành' : `Riding from ${STATIONS[entry].name} · Exit at`}
        </Text>
        {entry !== null ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {exitOptions.map((s, idx) => {
              const i = idx + 1;
              const active = i === exitAt;
              return (
                <Pressable
                  key={s.code}
                  onPress={() => {
                    Presets.System.selection();
                    setExitAt(i);
                  }}
                  style={[styles.chip, active && styles.chipActive]}>
                  <Text style={[styles.chipText, active && { color: '#fff' }]}>{s.name}</Text>
                  <Text style={[styles.chipFare, active && { color: 'rgba(255,255,255,0.8)' }]}>
                    {formatVnd(fareBetween(ENTRY, i))}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : (
          <Text style={styles.hint}>Drag the card up to the reader</Text>
        )}
      </View>

      {/* Card */}
      <GestureDetector gesture={pan}>
        <Animated.View
          style={[
            styles.card,
            { left: (width - CARD_W) / 2, top: cardHomeCY - CARD_H / 2 },
            cardStyle,
          ]}>
          <Canvas style={StyleSheet.absoluteFill}>
            <RoundedRect x={0} y={0} width={CARD_W} height={CARD_H} r={18}>
              <LinearGradient start={vec(0, 0)} end={vec(CARD_W, CARD_H)} colors={[LINE_1.color, LINE_1.colorDeep]} />
            </RoundedRect>
            <Circle cx={CARD_W * 0.92} cy={CARD_H * 0.1} r={150} color="rgba(255,255,255,0.07)" />
            <Circle cx={CARD_W * 0.98} cy={CARD_H * 0.05} r={95} color="rgba(255,255,255,0.06)" />
            <RoundedRect x={0} y={0} width={CARD_W} height={CARD_H} r={18}>
              <LinearGradient
                start={sheenStart}
                end={sheenEnd}
                colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.22)', 'rgba(255,255,255,0)']}
              />
            </RoundedRect>
          </Canvas>
          <View style={styles.cardContent}>
            <View style={styles.cardTop}>
              <Text style={styles.cardBrand}>METRO CARD</Text>
              <View style={styles.cardLine}>
                <Text style={styles.cardLineText}>{LINE_1.number}</Text>
              </View>
            </View>
            <View style={styles.chip3}>
              <View style={styles.chipLine} />
              <View style={[styles.chipLine, { top: 14 }]} />
            </View>
            <View style={styles.cardBottom}>
              <Text style={styles.cardCity}>Ho Chi Minh City · Line 1</Text>
              <Text style={styles.cardNumber}>•••• 0291</Text>
            </View>
          </View>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

function Reader({
  cx,
  cy,
  proximity,
  ripple,
  tone,
}: {
  cx: number;
  cy: number;
  proximity: SharedValue<number>;
  ripple: SharedValue<number>;
  tone: SharedValue<number>;
}) {
  const size = READER + 160;
  const c = size / 2;
  const breathe = useSharedValue(0);

  useEffect(() => {
    breathe.set(withRepeat(withTiming(1, { duration: 1800, easing: Easing.inOut(Easing.sin) }), -1, true));
  }, [breathe]);

  const builder = Skia.PathBuilder.Make();
  [22, 36, 50].forEach((r) => {
    builder.addArc({ x: c - 30 - r, y: c - r, width: r * 2, height: r * 2 }, -45, 90);
  });
  const waves = builder.detach();

  const toneColor = useDerivedValue(() =>
    interpolateColor(tone.value, [-1, 0, 1], [TONE.error, '#9AA3AD', TONE.ok])
  );
  const glowR = useDerivedValue(() => READER / 2 - 6 + proximity.value * 26 + breathe.value * 3);
  const glowOpacity = useDerivedValue(() => 0.08 + proximity.value * 0.45 + Math.abs(tone.value) * 0.3);

  return (
    <Canvas pointerEvents="none" style={{ position: 'absolute', width: size, height: size, left: cx - c, top: cy - c }}>
      <Circle cx={c} cy={c} r={glowR} color={toneColor} opacity={glowOpacity}>
        <BlurMask blur={24} style="normal" />
      </Circle>
      {[0, 1, 2].map((k) => (
        <RippleRing key={k} k={k} c={c} ripple={ripple} color={toneColor} />
      ))}
      <Circle cx={c} cy={c} r={READER / 2} color="#1C1F24" />
      <Circle cx={c} cy={c} r={READER / 2} color="#2F343B" style="stroke" strokeWidth={1.5} />
      <Circle cx={c} cy={c} r={READER / 2 - 14} color="#24282E" style="stroke" strokeWidth={1} />
      <Group>
        <Path path={waves} color={toneColor} style="stroke" strokeWidth={6} strokeCap="round" />
      </Group>
    </Canvas>
  );
}

function RippleRing({
  k,
  c,
  ripple,
  color,
}: {
  k: number;
  c: number;
  ripple: SharedValue<number>;
  color: SharedValue<string>;
}) {
  const r = useDerivedValue(() => READER / 2 + Math.max(0, ripple.value - k * 0.18) * 90);
  const opacity = useDerivedValue(() => {
    const t = Math.max(0, ripple.value - k * 0.18);
    return ripple.value === 0 || ripple.value === 1 ? 0 : (1 - t) * 0.7;
  });
  return <Circle cx={c} cy={c} r={r} color={color} opacity={opacity} style="stroke" strokeWidth={2} />;
}

function LedStrip({ tone }: { tone: Tone }) {
  return (
    <View style={styles.leds}>
      {[0, 1, 2, 3, 4].map((i) => (
        <Led key={i} i={i} tone={tone} />
      ))}
    </View>
  );
}

function Led({ i, tone }: { i: number; tone: Tone }) {
  const level = useSharedValue(0);
  useEffect(() => {
    if (tone === 'idle') {
      level.set(withDelay(i * 120, withRepeat(withSequence(withTiming(0.35, { duration: 900 }), withTiming(0.1, { duration: 900 })), -1)));
    } else if (tone === 'ok') {
      level.set(withDelay(i * 55, withTiming(1, { duration: 120 })));
    } else {
      level.set(withRepeat(withSequence(withTiming(1, { duration: 90 }), withTiming(0.15, { duration: 160 })), 3));
    }
  }, [tone, i, level]);

  const color = TONE[tone === 'idle' ? 'idle' : tone];
  const style = useAnimatedStyle(() => ({
    opacity: 0.25 + level.value * 0.75,
    boxShadow: `0 0 ${level.value * 10}px ${color}`,
  }));

  return <Animated.View style={[styles.led, { backgroundColor: color }, style]} />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0E0F12',
  },
  validator: {
    position: 'absolute',
    left: 28,
    right: 28,
    borderRadius: 28,
    borderCurve: 'continuous',
    backgroundColor: '#17191D',
    borderWidth: 1,
    borderColor: '#24272C',
    padding: 14,
    alignItems: 'center',
  },
  lcd: {
    alignSelf: 'stretch',
    height: 76,
    borderRadius: 14,
    borderCurve: 'continuous',
    backgroundColor: '#090B0A',
    borderWidth: 1,
    borderColor: '#000',
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  lcdTitle: {
    fontSize: 20,
    fontWeight: 700,
  },
  lcdSubtitle: {
    color: '#8C939B',
    fontSize: 13,
    marginTop: 3,
  },
  leds: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  led: {
    width: 26,
    height: 5,
    borderRadius: 3,
  },
  controls: {
    position: 'absolute',
    left: 24,
    right: 0,
  },
  balanceRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingRight: 24,
  },
  caption: {
    color: '#80868E',
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  topUp: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2E3238',
  },
  topUpText: {
    color: '#C9CDD2',
    fontSize: 13,
    fontWeight: 600,
  },
  chips: {
    gap: 8,
    paddingRight: 24,
    marginTop: 4,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderCurve: 'continuous',
    backgroundColor: '#1A1D21',
    borderWidth: 1,
    borderColor: '#262A30',
  },
  chipActive: {
    backgroundColor: LINE_1.color,
    borderColor: LINE_1.color,
  },
  chipText: {
    color: '#E8EAED',
    fontSize: 14,
    fontWeight: 600,
  },
  chipFare: {
    color: '#80868E',
    fontSize: 11,
    marginTop: 1,
    fontVariant: ['tabular-nums'],
  },
  hint: {
    color: '#5E636B',
    fontSize: 14,
    marginTop: 4,
  },
  card: {
    position: 'absolute',
    width: CARD_W,
    height: CARD_H,
    borderRadius: 18,
    borderCurve: 'continuous',
  },
  cardContent: {
    flex: 1,
    padding: 18,
    justifyContent: 'space-between',
  },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardBrand: {
    color: '#fff',
    fontSize: 15,
    fontWeight: 800,
    letterSpacing: 2,
  },
  cardLine: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardLineText: {
    color: LINE_1.colorDeep,
    fontSize: 15,
    fontWeight: 800,
  },
  chip3: {
    width: 42,
    height: 32,
    borderRadius: 6,
    backgroundColor: '#E9C46A',
    borderWidth: 1,
    borderColor: '#C9A447',
  },
  chipLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 8,
    height: 1,
    backgroundColor: '#B8913A',
  },
  cardBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  cardCity: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 12,
    fontWeight: 600,
  },
  cardNumber: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 600,
    letterSpacing: 1,
    fontVariant: ['tabular-nums'],
  },
});
