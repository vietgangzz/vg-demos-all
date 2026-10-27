import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Accelerometer } from 'expo-sensors';
import { StatusBar } from 'expo-status-bar';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useCallback, useEffect, useRef, useState } from 'react';
import { PixelRatio, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Presets } from 'react-native-pulsar';
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  ZoomIn,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Canvas, type CanvasRef } from 'react-native-webgpu';

import { loadArt, POSTER } from './art';
import { createShow, type Show, type ShowCue, type ShowHaptic, type Who } from './scene';

/**
 * Water Puppets: a dragon and a cobra on a pond at night, in front of their stage, played sideways.
 * The dragon's worked the way the puppeteers work theirs, from behind the screen: its bamboo pole
 * (the pad on the left, a map of the pond seen from behind the screen; the dragon goes where the
 * pole's end is) and its cords (on the right): one holds its head up, one squeezes the pump for
 * water from its mouth, one presses the pole down so it dives, and let go, it leaps out. The cobra
 * hunts it by itself. A hit knocks the other back under the water.
 */

const CREAM = '#FFF1DC';
const GOLD = '#FFC86A';
const JADE = '#8FE08A';
const BAMBOO = '#D2A867';
const SERIF = Platform.select({ ios: 'Baskerville', default: 'serif' });
const SERIF_ITALIC = Platform.select({ ios: 'Baskerville-Italic', default: 'serif' });
const GLASS = isLiquidGlassAvailable();

const HAPTICS: Record<ShowHaptic, () => void> = {
  splash: () => Presets.plunk(),
  bigSplash: () => Presets.breakingWave(),
  leap: () => Presets.propel(),
  spray: () => Presets.waterfall(),
  ripple: () => Presets.dewdrop(),
  hit: () => Presets.impact(),
  strike: () => Presets.flick(),
};

/** Made from scratch (scripts/water_dragon_sounds.py); a few players for the ones that overlap */
const SOUNDS: Record<ShowCue, { source: number; voices: number; volume: number }> = {
  drum: { source: require('../../../assets/water-dragon/drum.wav'), voices: 2, volume: 0.9 },
  splash: { source: require('../../../assets/water-dragon/splash.wav'), voices: 4, volume: 0.7 },
  bigSplash: { source: require('../../../assets/water-dragon/big-splash.wav'), voices: 2, volume: 1 },
  plop: { source: require('../../../assets/water-dragon/plop.wav'), voices: 4, volume: 0.55 },
  spray: { source: require('../../../assets/water-dragon/spray.wav'), voices: 2, volume: 0.8 },
  flute: { source: require('../../../assets/water-dragon/flute.wav'), voices: 1, volume: 0.6 },
  hit: { source: require('../../../assets/water-dragon/hit.wav'), voices: 2, volume: 1 },
};

/** The pole's pad: a map of the pond from behind the screen */
const PAD_W = 196;
const PAD_H = 128;
const KNOB = 36;

/** Sound off stays off, while the app's open */
let quietFor = { now: false };

/**
 * The sounds: `play(cue)`, each from the next of its players; the night's sounds, looping, under it
 * all. All of it hushed while `quiet`.
 */
function useSounds(quiet: boolean) {
  const players = useRef<Partial<Record<ShowCue, { list: ReturnType<typeof createAudioPlayer>[]; next: number }>>>({});
  const night = useRef<ReturnType<typeof createAudioPlayer> | null>(null);
  const hushed = useRef(quiet);
  useEffect(() => {
    hushed.current = quiet;
    if (night.current) night.current.volume = quiet ? 0 : 0.5;
  }, [quiet]);
  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'mixWithOthers' });
    const made: ReturnType<typeof createAudioPlayer>[] = [];
    for (const [cue, s] of Object.entries(SOUNDS) as [ShowCue, (typeof SOUNDS)[ShowCue]][]) {
      const list = Array.from({ length: s.voices }, () => {
        const p = createAudioPlayer(s.source);
        p.volume = s.volume;
        made.push(p);
        return p;
      });
      players.current[cue] = { list, next: 0 };
    }
    const ambience = createAudioPlayer(require('../../../assets/water-dragon/night.wav'));
    ambience.loop = true;
    ambience.volume = hushed.current ? 0 : 0.5;
    ambience.play();
    made.push(ambience);
    night.current = ambience;
    return () => {
      for (const p of made) p.remove();
      players.current = {};
      night.current = null;
    };
  }, []);
  return useCallback((cue: ShowCue) => {
    const set = players.current[cue];
    if (!set || hushed.current) return;
    const p = set.list[set.next];
    set.next = (set.next + 1) % set.list.length;
    p.seekTo(0);
    p.play();
  }, []);
}

export default function WaterPuppetsDemo() {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  // Played sideways: on a phone held upright, everything's turned a quarter, the top of it to the
  // right, so it's the right way up with the phone on its side, its top to the left
  const turned = height > width;
  const W = turned ? height : width;
  const H = turned ? width : height;
  const safe = turned
    ? { left: insets.top, right: insets.bottom, top: insets.right, bottom: insets.left }
    : { left: insets.left, right: insets.right, top: insets.top, bottom: insets.bottom };
  const canvasRef = useRef<CanvasRef>(null);
  const [show, setShow] = useState<Show | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [score, setScore] = useState<Record<Who, number>>({ dragon: 0, snake: 0 });
  const [played, setPlayed] = useState(false);
  // The painted title card, over everything until the show's lit, then lifting away
  const [curtain, setCurtain] = useState(true);
  const [quiet, setQuiet] = useState(
    () => quietFor.now || (__DEV__ && !!(globalThis as { waterPuppetsQuiet?: boolean }).waterPuppetsQuiet)
  );
  const play = useSounds(quiet);
  // The players live as long as the screen does: the show can hold on to this
  const sound = useRef(play);

  useEffect(() => {
    let live: Show | null = null;
    let cancelled = false;
    (async () => {
      const [adapter, art] = await Promise.all([navigator.gpu.requestAdapter(), loadArt()]);
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
      live = createShow(
        context,
        device,
        {
          onHaptic: (kind) => HAPTICS[kind](),
          onCue: (cue) => sound.current(cue),
          onScore: (s) => setScore(s),
        },
        art
      );
      live.onFirstFrame(() => {
        setLoaded(true);
        setTimeout(() => setCurtain(false), 500);
      });
      // Dev builds expose the show for QA: waterPuppets.pole(0, 0.5), waterPuppets.dive(true), waterPuppets.debug()
      if (__DEV__) (globalThis as { waterPuppets?: Show }).waterPuppets = live;
      setShow(live);
    })();
    return () => {
      cancelled = true;
      live?.dispose();
    };
  }, []);

  useEffect(() => {
    show?.resize(W, H, Math.min(PixelRatio.get(), 2.5));
  }, [show, W, H]);

  // The tip, read or not, goes after a while
  useEffect(() => {
    if (!loaded) return;
    const id = setTimeout(() => setPlayed(true), 14000);
    return () => clearTimeout(id);
  }, [loaded]);

  // The phone's tilt leans the seat a little (on its side, the phone's up is the picture's left)
  useEffect(() => {
    if (!show) return;
    Accelerometer.setUpdateInterval(33);
    const g = { x: 0, y: -1, z: 0 };
    const sub = Accelerometer.addListener((a) => {
      g.x += (a.x - g.x) * 0.1;
      g.y += (a.y - g.y) * 0.1;
      g.z += (a.z - g.z) * 0.1;
      if (turned) show.motion(-g.y, g.x, g.z);
      else show.motion(g.x, g.y, g.z);
    });
    return () => sub.remove();
  }, [show, turned]);

  // A tap on the water rings it
  const tap = Gesture.Tap()
    .runOnJS(true)
    .onEnd((e) => show?.tap(e.x, e.y));

  const stageStyle = turned
    ? {
        position: 'absolute' as const,
        width: W,
        height: H,
        left: (width - W) / 2,
        top: (height - H) / 2,
        transform: [{ rotate: '90deg' }],
      }
    : StyleSheet.absoluteFill;

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <View style={stageStyle}>
        <GestureDetector gesture={tap}>
          <View style={StyleSheet.absoluteFill}>
            <Canvas ref={canvasRef} style={StyleSheet.absoluteFill} />
          </View>
        </GestureDetector>

        {loaded ? (
          <Animated.View
            entering={FadeIn.delay(2600).duration(1200)}
            pointerEvents="none"
            style={[styles.head, { top: safe.top + 12, left: safe.left + 20 }]}>
            <Text style={styles.kicker}>WATER PUPPETS · HANOI</Text>
            <Text style={styles.title}>Dragon & Cobra</Text>
          </Animated.View>
        ) : null}

        <View style={[styles.corner, { top: safe.top + 12, right: safe.right + 16 }]}>
          {loaded ? (
            <Animated.View entering={FadeIn.delay(3200).duration(900)} pointerEvents="none">
              <GlassView
                glassEffectStyle="clear"
                tintColor="rgba(8,16,24,0.35)"
                style={[styles.scoreboard, !GLASS && styles.frost]}>
                <Text style={[styles.name, { color: GOLD }]}>DRAGON</Text>
                <Animated.Text
                  key={`d${score.dragon}`}
                  entering={ZoomIn.springify()}
                  style={[styles.score, { color: GOLD }]}>
                  {score.dragon}
                </Animated.Text>
                <Text style={styles.dash}>·</Text>
                <Animated.Text
                  key={`s${score.snake}`}
                  entering={ZoomIn.springify()}
                  style={[styles.score, { color: JADE }]}>
                  {score.snake}
                </Animated.Text>
                <Text style={[styles.name, { color: JADE }]}>COBRA</Text>
              </GlassView>
            </Animated.View>
          ) : null}
          <Pressable
            onPress={() => {
              quietFor = { now: !quiet };
              setQuiet(!quiet);
              Presets.System.selection();
            }}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={quiet ? 'Sound on' : 'Sound off'}>
            <GlassView
              glassEffectStyle="clear"
              tintColor="rgba(8,16,24,0.35)"
              style={[styles.closeButton, !GLASS && styles.frost]}>
              <SymbolView
                name={quiet ? 'speaker.slash.fill' : 'speaker.wave.2.fill'}
                size={14}
                weight="semibold"
                tintColor={CREAM}
              />
            </GlassView>
          </Pressable>
          <Pressable
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
            hitSlop={10}
            accessibilityLabel="Close demo">
            <GlassView
              glassEffectStyle="clear"
              tintColor="rgba(8,16,24,0.35)"
              style={[styles.closeButton, !GLASS && styles.frost]}>
              <SymbolView name="xmark" size={14} weight="semibold" tintColor={CREAM} />
            </GlassView>
          </Pressable>
        </View>

        {loaded && !played ? (
          <Animated.View
            entering={FadeIn.delay(5200).duration(900)}
            exiting={FadeOut.duration(500)}
            pointerEvents="none"
            style={[styles.tip, { bottom: safe.bottom + 108 }]}>
            <GlassView
              glassEffectStyle="clear"
              tintColor="rgba(8,16,24,0.3)"
              style={[styles.tipPill, !GLASS && styles.frost]}>
              <Text style={styles.tipText}>
                Work the dragon from behind the screen: its pole on the left, its cords on the right
              </Text>
            </GlassView>
          </Animated.View>
        ) : null}

        {loaded && show ? (
          <Animated.View
            entering={FadeInDown.delay(3600).duration(800).easing(Easing.out(Easing.cubic))}
            style={[styles.console, { left: safe.left + 16, right: safe.right + 16, bottom: safe.bottom + 12 }]}
            pointerEvents="box-none">
            <PolePad show={show} onUse={() => setPlayed(true)} />
            <View style={styles.cords}>
              <CordButton
                label="Head"
                symbol="arrow.up.circle"
                hint="hold"
                onHold={(on) => {
                  show.raise(on);
                  if (on) setPlayed(true);
                }}
              />
              <CordButton label="Pump" symbol="drop.fill" hint="hold" onHold={(on) => show.pump(on)} />
              <CordButton
                label="Dive"
                symbol="arrow.down.to.line"
                hint="hold · let go to leap"
                onHold={(on) => show.dive(on)}
                charge={() => show.charge}
              />
            </View>
          </Animated.View>
        ) : null}

        {curtain ? (
          <Animated.View
            exiting={FadeOut.duration(1600).easing(Easing.inOut(Easing.quad))}
            style={styles.curtain}
            pointerEvents="none">
            <Image source={POSTER} style={StyleSheet.absoluteFill} contentFit="cover" contentPosition="right" />
            <View style={styles.curtainShade} />
            <Animated.View
              entering={FadeIn.duration(900)}
              style={[styles.curtainText, { left: safe.left + 40, bottom: safe.bottom + 36 }]}>
              <Text style={styles.kicker}>WATER PUPPETS · HANOI</Text>
              <Text style={styles.curtainTitle}>Dragon & Cobra</Text>
              <Text style={styles.curtainSub}>Múa rối nước</Text>
              <Text style={styles.curtainWait}>{loaded ? ' ' : 'Lighting the lanterns…'}</Text>
            </Animated.View>
          </Animated.View>
        ) : null}
      </View>
    </View>
  );
}

/**
 * The dragon's pole, seen from behind the screen: the screen along the top of the pad, the pond
 * spread out below it toward the audience. Drag the knob, the pole's end, and the dragon goes
 * there; the pole runs to it from the puppeteer's hands, who moves along behind the screen after it.
 */
function PolePad({ show, onUse }: { show: Show; onUse: () => void }) {
  const kx = useSharedValue(PAD_W / 2);
  const ky = useSharedValue(PAD_H * 0.6);
  const hand = useSharedValue(PAD_W / 2);
  const holding = useSharedValue(0);
  const cx = useSharedValue(PAD_W / 2);
  const cy = useSharedValue(PAD_H * 0.4);
  const cobra = useSharedValue(0);

  // Not in the hand: the knob follows wherever the dragon's got to
  useEffect(() => {
    const id = setInterval(() => {
      const w = show.where();
      // The cobra, a jade dot, wherever it's got to
      cobra.set(withTiming(w.cobra ? 1 : 0, { duration: 300 }));
      if (w.cobra) {
        cx.set(withTiming(PAD_W / 2 + Math.max(-1, Math.min(1, w.cobra.u)) * (PAD_W / 2 - 8), { duration: 140 }));
        cy.set(withTiming(14 + Math.max(0, Math.min(1, w.cobra.v)) * (PAD_H - 22), { duration: 140 }));
      }
      if (holding.get()) return;
      const x = PAD_W / 2 + Math.max(-1, Math.min(1, w.u)) * (PAD_W / 2 - KNOB / 2);
      const y = 14 + Math.max(0, Math.min(1, w.v)) * (PAD_H - 14 - KNOB / 2);
      kx.set(withTiming(x, { duration: 140 }));
      ky.set(withTiming(y, { duration: 140 }));
      hand.set(withTiming(PAD_W / 2 + (x - PAD_W / 2) * 0.55, { duration: 400 }));
    }, 140);
    return () => clearInterval(id);
  }, [show, kx, ky, hand, holding, cx, cy, cobra]);

  const send = (x: number, y: number) => {
    const u = (x - PAD_W / 2) / (PAD_W / 2 - KNOB / 2);
    const v = (y - 14) / (PAD_H - 14 - KNOB / 2);
    show.pole(u, v);
  };

  const drag = Gesture.Pan()
    .runOnJS(true)
    .minDistance(0)
    .onBegin(() => {
      holding.set(1);
      Presets.System.selection();
      onUse();
    })
    .onChange((e) => {
      const x = Math.max(KNOB / 2, Math.min(PAD_W - KNOB / 2, kx.get() + e.changeX));
      const y = Math.max(14, Math.min(PAD_H - KNOB / 2, ky.get() + e.changeY));
      kx.set(x);
      ky.set(y);
      hand.set(PAD_W / 2 + (x - PAD_W / 2) * 0.55);
      send(x, y);
    })
    .onFinalize(() => {
      holding.set(0);
    });

  const knob = useAnimatedStyle(() => ({
    transform: [
      { translateX: kx.value - KNOB / 2 },
      { translateY: ky.value - KNOB / 2 },
      { scale: withSpring(holding.value ? 1.12 : 1) },
    ],
  }));
  const pole = useAnimatedStyle(() => {
    const dx = kx.value - hand.value;
    const dy = ky.value - 8;
    return {
      width: Math.hypot(dx, dy),
      transform: [{ translateX: hand.value }, { translateY: 8 }, { rotate: `${Math.atan2(dy, dx)}rad` }],
    };
  });
  const handStyle = useAnimatedStyle(() => ({ transform: [{ translateX: hand.value - 9 }] }));
  const cobraStyle = useAnimatedStyle(() => ({
    opacity: cobra.value,
    transform: [{ translateX: cx.value - 5 }, { translateY: cy.value - 5 }],
  }));

  return (
    <GestureDetector gesture={drag}>
      <View>
        <GlassView glassEffectStyle="clear" tintColor="rgba(10,22,24,0.4)" style={[styles.pad, !GLASS && styles.frost]}>
          {/* The screen along the top, the puppeteer's hands at it */}
          <View style={styles.screenBar} />
          <Animated.View style={[styles.hands, handStyle]} />
          {/* Rings out across the pond, for a sense of where's near and far */}
          <View
            style={[
              styles.ring,
              { width: PAD_W * 0.7, height: PAD_W * 0.7, left: PAD_W * 0.15, top: -PAD_W * 0.35 + 8 },
            ]}
          />
          <View
            style={[
              styles.ring,
              { width: PAD_W * 1.3, height: PAD_W * 1.3, left: -PAD_W * 0.15, top: -PAD_W * 0.65 + 8 },
            ]}
          />
          <Animated.View style={[styles.cobraDot, cobraStyle]} />
          <Animated.View style={[styles.pole, pole]} />
          <Animated.View style={[styles.knob, knob]}>
            <View style={styles.knobInner} />
          </Animated.View>
        </GlassView>
        <Text style={styles.padLabel}>POLE</Text>
      </View>
    </GestureDetector>
  );
}

/**
 * A cord hanging down from under the screen with a wooden toggle on its end: held, it's pulled
 * down (and the puppet holds its trick); let go, it springs back up.
 */
function CordButton({
  label,
  symbol,
  hint,
  onHold,
  charge,
}: {
  label: string;
  symbol: SymbolViewProps['name'];
  hint: string;
  onHold: (on: boolean) => void;
  /** Held, how much it's built up (0 to 1): shown filling along the toggle */
  charge?: () => number;
}) {
  const pull = useSharedValue(0);
  const fill = useSharedValue(0);
  const frame = useRef(0);
  const fillStyle = useAnimatedStyle(() => ({ width: `${fill.value * 100}%`, opacity: fill.value > 0 ? 1 : 0 }));
  const watch = useCallback(() => {
    if (!charge) return;
    const tick = () => {
      fill.set(charge());
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  }, [charge, fill]);
  const unwatch = useCallback(() => {
    cancelAnimationFrame(frame.current);
    fill.set(withTiming(0, { duration: 220 }));
  }, [fill]);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  const toggle = useAnimatedStyle(() => ({ transform: [{ translateY: pull.value * 12 }] }));
  const rope = useAnimatedStyle(() => ({ transform: [{ scaleY: 1 + pull.value * 0.45 }] }));
  return (
    <Pressable
      onPressIn={() => {
        onHold(true);
        Presets.System.impactMedium();
        pull.set(withTiming(1, { duration: 110 }));
        watch();
      }}
      onPressOut={() => {
        onHold(false);
        unwatch();
        Presets.System.impactLight();
        pull.set(withSpring(0, { damping: 6, stiffness: 260 }));
      }}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${hint}`}>
      <View style={styles.cord}>
        <Animated.View style={[styles.rope, rope]} />
        <Animated.View style={toggle}>
          <GlassView
            glassEffectStyle="clear"
            tintColor="rgba(40,24,10,0.45)"
            style={[styles.toggle, !GLASS && styles.frost]}>
            <SymbolView name={symbol} size={16} weight="semibold" tintColor={GOLD} />
            <Text style={styles.toggleText}>{label}</Text>
            {charge ? <Animated.View style={[styles.charge, fillStyle]} /> : null}
          </GlassView>
        </Animated.View>
        <Text style={styles.hint}>{hint}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#050A14',
    overflow: 'hidden',
  },
  head: {
    position: 'absolute',
  },
  kicker: {
    fontFamily: SERIF,
    fontSize: 10,
    letterSpacing: 3.2,
    color: 'rgba(255,241,220,0.6)',
  },
  title: {
    fontFamily: SERIF_ITALIC,
    fontSize: 28,
    color: CREAM,
    marginTop: 2,
    textShadowColor: 'rgba(255,150,70,0.45)',
    textShadowRadius: 14,
    textShadowOffset: { width: 0, height: 0 },
  },
  corner: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  scoreboard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 18,
  },
  name: {
    fontFamily: SERIF,
    fontSize: 11,
    letterSpacing: 2.6,
  },
  score: {
    fontFamily: SERIF,
    fontSize: 22,
    fontVariant: ['tabular-nums'],
  },
  dash: {
    fontFamily: SERIF,
    fontSize: 20,
    color: 'rgba(255,241,220,0.5)',
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  frost: {
    backgroundColor: 'rgba(20,16,10,0.55)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,220,160,0.25)',
  },
  tip: {
    position: 'absolute',
    alignSelf: 'center',
    maxWidth: 300,
  },
  tipPill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 14,
  },
  tipText: {
    fontFamily: SERIF_ITALIC,
    fontSize: 13,
    lineHeight: 17,
    textAlign: 'center',
    color: 'rgba(255,241,220,0.9)',
  },
  curtain: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#140806',
  },
  curtainShade: {
    ...StyleSheet.absoluteFill,
    experimental_backgroundImage:
      'linear-gradient(90deg, rgba(10,4,2,0.82) 0%, rgba(10,4,2,0.35) 45%, rgba(10,4,2,0) 70%)',
  },
  curtainText: {
    position: 'absolute',
  },
  curtainTitle: {
    fontFamily: SERIF_ITALIC,
    fontSize: 44,
    color: CREAM,
    marginTop: 4,
    textShadowColor: 'rgba(255,150,70,0.5)',
    textShadowRadius: 18,
    textShadowOffset: { width: 0, height: 0 },
  },
  curtainSub: {
    fontFamily: SERIF,
    fontSize: 16,
    letterSpacing: 1.5,
    color: GOLD,
    marginTop: 2,
  },
  curtainWait: {
    fontFamily: SERIF_ITALIC,
    fontSize: 12,
    color: 'rgba(255,241,220,0.55)',
    marginTop: 18,
  },
  cobraDot: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: JADE,
    borderWidth: 1.5,
    borderColor: 'rgba(10,30,14,0.8)',
  },
  charge: {
    position: 'absolute',
    left: 0,
    bottom: 0,
    height: 3,
    backgroundColor: GOLD,
  },
  console: {
    position: 'absolute',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  pad: {
    width: PAD_W,
    height: PAD_H,
    borderRadius: 18,
    overflow: 'hidden',
  },
  padLabel: {
    position: 'absolute',
    left: 12,
    bottom: 8,
    fontFamily: SERIF,
    fontSize: 10,
    letterSpacing: 2.4,
    color: 'rgba(255,241,220,0.45)',
  },
  screenBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: 8,
    backgroundColor: 'rgba(160,110,50,0.75)',
  },
  hands: {
    position: 'absolute',
    top: 2,
    width: 18,
    height: 12,
    borderRadius: 6,
    backgroundColor: 'rgba(255,220,170,0.85)',
  },
  ring: {
    position: 'absolute',
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,241,220,0.16)',
  },
  pole: {
    position: 'absolute',
    left: 0,
    top: 0,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: BAMBOO,
    transformOrigin: 'left center',
  },
  knob: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: KNOB,
    height: KNOB,
    borderRadius: KNOB / 2,
    backgroundColor: 'rgba(255,200,106,0.25)',
    borderWidth: 2,
    borderColor: GOLD,
    alignItems: 'center',
    justifyContent: 'center',
  },
  knobInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: GOLD,
  },
  cords: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
  },
  cord: {
    alignItems: 'center',
    width: 82,
  },
  rope: {
    width: 1.5,
    height: 30,
    backgroundColor: 'rgba(214,176,112,0.75)',
    transformOrigin: 'top',
  },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 44,
    paddingHorizontal: 12,
    borderRadius: 14,
    overflow: 'hidden',
  },
  toggleText: {
    fontFamily: SERIF,
    fontSize: 15,
    color: 'rgba(255,241,220,0.92)',
  },
  hint: {
    marginTop: 4,
    fontFamily: SERIF_ITALIC,
    fontSize: 10,
    color: 'rgba(255,241,220,0.5)',
    textAlign: 'center',
  },
});
