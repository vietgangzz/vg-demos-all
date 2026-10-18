import { setAudioModeAsync } from 'expo-audio';
import { GlassView } from 'expo-glass-effect';
import { Accelerometer } from 'expo-sensors';
import { StatusBar } from 'expo-status-bar';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useEffect, useRef, useState } from 'react';
import { PixelRatio, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Presets } from 'react-native-pulsar';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Canvas, type CanvasRef } from 'react-native-webgpu';

import { NumericText } from '@/components/numeric-text';
import { useSound } from '@/hooks/use-sound';

import { chargeCss } from './palette';
import { chargeRate, clockIn, duration, minutesToCharge, TYPICAL_DRAIN, useBattery, type PowerState } from './power';
import { createJuice, type Frame, type Juice } from './scene';
import { tipsFor } from './tips';

/**
 * Juice: plug your phone in and watch it drink. The battery is a glass capsule of liquid light;
 * the charge comes in from the port, across the floor and up through it. Around it, what's worth
 * knowing: how long to full (or how long it'll last), how fast it's charging, and how to keep the
 * battery healthy, a tip at a time for what it's doing right now.
 *
 * On a phone it's the real battery and the real cable. On the simulator (no battery) a stand-in
 * charges in time-lapse: tap the bottom edge, where the port is, to plug it in.
 */

const INK = '#F6F3EE';
const DIM = 'rgba(246,243,238,0.62)';
const FAINT = 'rgba(246,243,238,0.42)';

export default function JuiceDemo() {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const canvasRef = useRef<CanvasRef>(null);
  const [scene, setScene] = useState<Juice | null>(null);
  const [shown, setShown] = useState<number | null>(null);
  const [tip, setTip] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [revealed, setRevealed] = useState(false);
  const battery = useBattery();
  const { source, level, state, lowPower, gauge, since } = battery;
  const curtain = useSharedValue(1);
  const bob = useSharedValue(0);
  /** The bottom of the screen clears out of the way while the charge comes in from the port */
  const clear = useSharedValue(0);
  /** The number jumps when the charge lands */
  const pop = useSharedValue(0);
  /** The scene that's had its first reading (a new one, after a fast refresh say, starts over) */
  const started = useRef<Juice | null>(null);
  const lastState = useRef<PowerState | null>(null);

  // Made from scratch (scripts/juice_sounds.py)
  const plugIn = useSound(require('../../../assets/juice/plug.wav'));
  const surge = useSound(require('../../../assets/juice/surge.wav'));
  const plugOut = useSound(require('../../../assets/juice/unplug.wav'));
  const chime = useSound(require('../../../assets/juice/full.wav'));
  const splash = useSound(require('../../../assets/juice/splash.wav'));
  const sounds = useRef({ plugIn, surge, plugOut, chime, splash });

  const wide = width > height * 0.95;
  const frame = frameFor(width, height);

  useEffect(() => {
    let live: Juice | null = null;
    let cancelled = false;
    (async () => {
      const adapter = await navigator.gpu.requestAdapter();
      const device = await adapter?.requestDevice();
      const context = canvasRef.current?.getContext('webgpu');
      if (cancelled || !device || !context) return;
      const canvas = context.canvas as unknown as { width: number; height: number; clientWidth: number; clientHeight: number };
      const ratio = Math.min(PixelRatio.get(), 2.5);
      canvas.width = canvas.clientWidth * ratio;
      canvas.height = canvas.clientHeight * ratio;
      live = createJuice(context, device, {
        onCue: (cue) => {
          if (cue === 'hit') {
            Presets.surge();
            sounds.current.surge();
            pop.value = withSequence(withTiming(1, { duration: 90 }), withSpring(0, { damping: 9, stiffness: 170 }));
          } else if (cue === 'splash') {
            Presets.dewdrop();
            sounds.current.splash();
          }
        },
        onShown: setShown,
      });
      live.onFirstFrame(() => {
        curtain.value = withTiming(0, { duration: 700 });
        setRevealed(true);
      });
      setScene(live);
    })();
    return () => {
      cancelled = true;
      live?.dispose();
    };
  }, [curtain, pop]);

  useEffect(() => {
    scene?.layout(width, height, Math.min(PixelRatio.get(), 2.5), frameFor(width, height));
  }, [scene, width, height]);

  // The first reading starts it; after that, plugging in or out plays its moment
  useEffect(() => {
    if (!scene || !source) return;
    if (started.current !== scene) {
      started.current = scene;
      lastState.current = state;
      scene.start(level, state);
      return;
    }
    scene.setPower(level, state);
    const was = lastState.current;
    lastState.current = state;
    if (was === state) return;
    if (was === 'unplugged') {
      Presets.spark();
      sounds.current.plugIn();
      clear.value = withSequence(
        withTiming(1, { duration: 180 }),
        withDelay(1500, withTiming(0, { duration: 520, easing: Easing.out(Easing.cubic) }))
      );
    } else if (state === 'unplugged') {
      Presets.powerDown();
      sounds.current.plugOut();
    } else if (state === 'full') {
      Presets.triumph();
      sounds.current.chime();
    }
  }, [scene, source, level, state, clear]);

  // The audio session is set up now, not on the first sound: that one plays as the cable goes in
  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'mixWithOthers' });
  }, []);

  // Tilt: the liquid stays level with the world
  useEffect(() => {
    if (!scene) return;
    let sub: { remove: () => void } | null = null;
    let live = true;
    Accelerometer.isAvailableAsync().then((ok) => {
      if (!ok || !live) return;
      Accelerometer.setUpdateInterval(16);
      sub = Accelerometer.addListener(({ x, y, z }) => scene.setGravity(x, y, z));
    });
    return () => {
      live = false;
      sub?.remove();
    };
  }, [scene]);

  // Times move on; a new tip every few seconds
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(id);
  }, []);
  const tips = tipsFor(state, level, lowPower);
  useEffect(() => {
    const id = setInterval(() => setTip((n) => n + 1), 6500);
    return () => clearInterval(id);
  }, []);
  const current = tips[tip % tips.length];

  useEffect(() => {
    bob.value = withRepeat(
      withSequence(withTiming(1, { duration: 650, easing: Easing.inOut(Easing.quad) }), withTiming(0, { duration: 650 })),
      -1
    );
  }, [bob]);

  // Dev: plug the stand-in in and out, set its level, look inside the scene
  useEffect(() => {
    if (!__DEV__ || !scene) return;
    (globalThis as { juice?: unknown }).juice = {
      plug: battery.plug,
      unplug: battery.unplug,
      level: battery.setLevel,
      scene,
    };
  }, [scene, battery.plug, battery.unplug, battery.setLevel]);

  const tap = Gesture.Tap()
    .runOnJS(true)
    .onEnd((e) => {
      const hit = scene?.tap(e.x, e.y);
      if (hit === 'port' && source === 'demo') {
        if (state === 'unplugged') battery.plug();
        else battery.unplug();
      }
    });
  const pan = Gesture.Pan()
    .runOnJS(true)
    .minDistance(8)
    .onEnd((e) => scene?.nudge(e.velocityX));

  const percent = shown ?? Math.round(level * 100);
  const accent = chargeCss(level);
  const charging = state === 'charging';
  const rate = chargeRate(level) * gauge.scale;
  const toFull = minutesToCharge(level, 1) / gauge.scale;
  const drain = gauge.drain ?? TYPICAL_DRAIN;
  const left = (level * 100) / drain;
  const goal = level < 0.8 ? 0.8 : 1;
  const toGoal = minutesToCharge(level, goal) / (charging ? gauge.scale : 1);

  const status: { icon: SymbolViewProps['name']; label: string } =
    state === 'charging'
      ? { icon: 'bolt.fill', label: 'Charging' }
      : state === 'full'
        ? { icon: 'checkmark.circle.fill', label: 'Charged' }
        : lowPower
          ? { icon: 'leaf.fill', label: 'Low Power Mode' }
          : { icon: batteryIcon(level), label: 'On battery' };

  const time =
    state === 'charging'
      ? { main: `Full in ${duration(toFull)}`, sub: `by ${clockIn(toFull, now)}` }
      : state === 'full'
        ? { main: 'Fully charged', sub: 'unplug any time' }
        : { main: `About ${duration(left)} left`, sub: gauge.drain ? 'at this pace' : 'with typical use' };

  const stats: { label: string; value: string; sub: string }[] =
    state === 'unplugged'
      ? [
          {
            label: 'ON BATTERY',
            value: `${Math.max(0, Math.round((since.level - level) * 100))}% used`,
            sub: `since ${clockIn(0, since.at)}`,
          },
          { label: 'LOW POWER', value: lowPower ? 'On' : 'Off', sub: 'Settings › Battery' },
          { label: 'PLUG IN NOW', value: clockIn(toGoal, now), sub: `${Math.round(goal * 100)}% by then` },
        ]
      : [
          {
            label: 'SPEED',
            value: state === 'full' ? 'Holding' : rate >= 1.3 ? 'Fast' : rate >= 0.6 ? 'Steady' : 'Trickle',
            sub: state === 'full' ? 'tops up gently' : `+${rate.toFixed(1)}% a min`,
          },
          {
            label: 'THIS CHARGE',
            value: `+${Math.max(0, Math.round((level - since.level) * 100))}%`,
            sub: `since ${clockIn(0, since.at)}`,
          },
          state === 'full'
            ? { label: 'DAILY LIMIT', value: '80%', sub: 'kinder to the cells' }
            : { label: `${Math.round(goal * 100)}% AT`, value: clockIn(toGoal, now), sub: `in ${duration(toGoal)}` },
        ];

  const hint = state === 'unplugged' ? (source === 'demo' ? 'Tap the port to plug in' : 'Plug in to charge') : null;

  const curtainStyle = useAnimatedStyle(() => ({ opacity: curtain.value }));
  const bobStyle = useAnimatedStyle(() => ({ transform: [{ translateY: bob.value * 5 }] }));
  const popStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + pop.value * 0.09 }, { translateY: -pop.value * 4 }],
  }));
  const clearStyle = useAnimatedStyle(() => ({ opacity: 1 - clear.value, transform: [{ translateY: clear.value * 150 }] }));
  const bottom = Math.max(insets.bottom, 12);

  const head = (
    <View style={[styles.head, wide ? { width: Math.min(420, width * 0.42) } : null]}>
      <View style={styles.statusRow}>
        <GlassView glassEffectStyle="regular" tintColor={chargeCss(level, 0.22)} style={styles.chip}>
          <Animated.View key={status.label} entering={FadeIn.duration(300)} style={styles.chipInner}>
            <SymbolView name={status.icon} size={13} weight="bold" tintColor={charging ? accent : INK} />
            <Text style={styles.chipText}>{status.label}</Text>
          </Animated.View>
        </GlassView>
      </View>
      <Animated.View style={[styles.levelRow, popStyle]}>
        <NumericText value={`${percent}`} fontSize={wide ? 104 : 88} color={INK} weight="bold" />
        <Text style={[styles.percent, { color: accent }]}>%</Text>
      </Animated.View>
      <Animated.View key={time.main.split(' ')[0]} entering={FadeIn.duration(400)} style={styles.timeRow}>
        <Text style={styles.time}>{time.main}</Text>
        <Text style={styles.timeSub}> · {time.sub}</Text>
      </Animated.View>
      <View style={styles.stats}>
        {stats.map((s, i) => (
          <StatCard key={i} {...s} wave={since.at} delay={state === 'unplugged' ? i * 60 : 520 + i * 90} />
        ))}
      </View>
    </View>
  );

  const tipCard = current ? (
    <GlassView glassEffectStyle="regular" tintColor="rgba(30,26,34,0.4)" style={styles.tip}>
      <Animated.View key={current.id} entering={FadeIn.delay(170).duration(380)} exiting={FadeOut.duration(160)} style={styles.tipInner}>
        <View style={[styles.tipIcon, { backgroundColor: chargeCss(level, 0.18) }]}>
          <SymbolView name={current.icon} size={18} weight="semibold" tintColor={accent} />
        </View>
        <View style={styles.tipText}>
          <Text style={styles.tipTitle}>{current.title}</Text>
          <Text style={styles.tipBody}>{current.body}</Text>
        </View>
      </Animated.View>
    </GlassView>
  ) : null;

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <GestureDetector gesture={Gesture.Exclusive(pan, tap)}>
        <View style={StyleSheet.absoluteFill}>
          <Canvas ref={canvasRef} style={StyleSheet.absoluteFill} />
        </View>
      </GestureDetector>

      {revealed ? (
        <Animated.View
          entering={FadeIn.delay(350).duration(600)}
          pointerEvents="box-none"
          style={[
            StyleSheet.absoluteFill,
            wide
              ? { paddingTop: insets.top + 18, paddingLeft: insets.left + 28, paddingBottom: bottom + 8 }
              : { paddingTop: insets.top + 6, paddingHorizontal: 16, paddingBottom: bottom + 4 },
          ]}>
          <View pointerEvents="none" style={wide ? styles.columnWide : styles.column}>
            {head}
            <View style={styles.spacer} />
            <Animated.View style={clearStyle}>
              {hint && !wide ? (
                <Animated.View entering={FadeIn.duration(400)} exiting={FadeOut.duration(200)} style={[styles.hint, bobStyle]}>
                  <Text style={styles.hintText}>{hint}</Text>
                  <SymbolView name="arrow.down" size={13} weight="semibold" tintColor={FAINT} />
                </Animated.View>
              ) : null}
              <View style={wide ? { width: Math.min(420, width * 0.42) } : null}>{tipCard}</View>
            </Animated.View>
          </View>
          {hint && wide ? (
            <Animated.View
              entering={FadeIn.duration(400)}
              exiting={FadeOut.duration(200)}
              pointerEvents="none"
              style={[styles.hint, styles.hintWide, { left: width * frame.portX - 110, bottom: bottom + 6 }, bobStyle]}>
              <Text style={styles.hintText}>{hint}</Text>
              <SymbolView name="arrow.down" size={13} weight="semibold" tintColor={FAINT} />
            </Animated.View>
          ) : null}
        </Animated.View>
      ) : null}

      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.curtain, curtainStyle]} />
    </View>
  );
}

/**
 * Where the capsule stands: under the numbers on a phone (a little bigger on a tall one, where
 * there's room), to the right of them on an open fold
 */
function frameFor(width: number, height: number): Frame {
  if (width > height * 0.95) return { x: 0.7, y: 0.52, size: 0.62, portX: 0.7 };
  return width / height < 0.55 ? { x: 0.5, y: 0.565, size: 0.37, portX: 0.5 } : { x: 0.5, y: 0.575, size: 0.34, portX: 0.5 };
}

/**
 * A figure in a glass card. The card stays put when the battery changes state (glass is costly to
 * make, and this happens right as the charge pours in); it ducks out and drops back in instead.
 */
function StatCard({ label, value, sub, wave, delay }: { label: string; value: string; sub: string; wave: number; delay: number }) {
  const shown = useSharedValue(1);
  useEffect(() => {
    shown.value = withSequence(withTiming(0, { duration: 70 }), withDelay(delay, withSpring(1, { damping: 15, stiffness: 160 })));
  }, [wave, delay, shown]);
  const style = useAnimatedStyle(() => ({
    opacity: shown.value,
    transform: [{ translateY: (1 - shown.value) * -16 }],
  }));
  return (
    <Animated.View style={[styles.statWrap, style]}>
      <GlassView glassEffectStyle="regular" tintColor="rgba(30,26,34,0.35)" style={styles.stat}>
        <Text style={styles.statLabel}>{label}</Text>
        <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit>
          {value}
        </Text>
        <Text style={styles.statSub} numberOfLines={1}>
          {sub}
        </Text>
      </GlassView>
    </Animated.View>
  );
}

function batteryIcon(level: number): SymbolViewProps['name'] {
  if (level > 0.88) return 'battery.100percent';
  if (level > 0.62) return 'battery.75percent';
  if (level > 0.37) return 'battery.50percent';
  if (level > 0.12) return 'battery.25percent';
  return 'battery.0percent';
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#050407',
  },
  curtain: {
    backgroundColor: '#050407',
  },
  column: {
    flex: 1,
  },
  columnWide: {
    flex: 1,
    alignItems: 'flex-start',
  },
  head: {
    gap: 2,
  },
  spacer: {
    flex: 1,
  },
  statusRow: {
    flexDirection: 'row',
    marginTop: 4,
  },
  chip: {
    height: 30,
    paddingHorizontal: 12,
    borderRadius: 15,
    justifyContent: 'center',
  },
  chipInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  chipText: {
    color: INK,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  levelRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    alignSelf: 'flex-start',
    marginTop: 6,
    transformOrigin: 'left bottom',
  },
  percent: {
    fontSize: 34,
    fontWeight: '700',
    marginLeft: 4,
    marginBottom: 16,
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginTop: -6,
  },
  time: {
    color: INK,
    fontSize: 17,
    fontWeight: '600',
  },
  timeSub: {
    color: DIM,
    fontSize: 15,
    fontWeight: '500',
  },
  stats: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 14,
  },
  statWrap: {
    flex: 1,
  },
  stat: {
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  statLabel: {
    color: FAINT,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.1,
  },
  statValue: {
    color: INK,
    fontSize: 19,
    fontWeight: '700',
    marginTop: 3,
  },
  statSub: {
    color: DIM,
    fontSize: 11.5,
    marginTop: 1,
  },
  tip: {
    borderRadius: 22,
    padding: 14,
  },
  tipInner: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
  },
  tipIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tipText: {
    flex: 1,
  },
  tipTitle: {
    color: INK,
    fontSize: 15,
    fontWeight: '700',
  },
  tipBody: {
    color: DIM,
    fontSize: 13.5,
    lineHeight: 18.5,
    marginTop: 2,
  },
  hint: {
    alignSelf: 'center',
    alignItems: 'center',
    gap: 2,
    marginBottom: 10,
  },
  hintWide: {
    position: 'absolute',
    width: 220,
    marginBottom: 0,
  },
  hintText: {
    color: DIM,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
});
