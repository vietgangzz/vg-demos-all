import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { Accelerometer } from 'expo-sensors';
import { StatusBar } from 'expo-status-bar';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useEffect, useRef, useState } from 'react';
import { PixelRatio, Platform, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Presets } from 'react-native-pulsar';
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Canvas, type CanvasRef } from 'react-native-webgpu';

import { useSound } from '@/hooks/use-sound';

import { createSnowGlobe, type Chapter, type GlobeHaptic, type SnowGlobe, type Stage } from './scene';
import { useMusicBox } from './music';

/**
 * Snow Globe: a snow globe on a music box, in a dark room at Christmas, Rothenburg inside it in
 * the snow. Wind the key and the music box plays and it snows in the town; shake the phone for a
 * snowstorm. Wind it far enough and let go, and the tune takes you in after Santa.
 */

const CREAM = '#FFF4E2';
const GOLD = '#FFD58A';
const SCRIPT = Platform.select({ ios: 'Snell Roundhand', default: 'serif' });
const SERIF = Platform.select({ ios: 'Baskerville', default: 'serif' });
const SERIF_ITALIC = Platform.select({ ios: 'Baskerville-Italic', default: 'serif' });
const GLASS = isLiquidGlassAvailable();

const HAPTICS: Record<GlobeHaptic, () => void> = {
  shake: () => Presets.wobble(),
  note: () => Presets.System.selection(),
  enter: () => Presets.propel(),
  land: () => Presets.thud(),
  deliver: () => Presets.System.notificationSuccess(),
  home: () => Presets.swell(),
  throw: () => Presets.System.impactLight(),
};

const CHAPTERS: Record<Exclude<Chapter, null>, string> = {
  glass: 'Into the snow globe',
  chimney: 'Down the chimney',
  morning: 'Asleep under the tree',
  home: 'Merry Christmas',
};

type Hint = 'wind' | 'shake';
const HINTS: { id: Hint; label: string; symbol: SymbolViewProps['name'] }[] = [
  { id: 'wind', label: 'Wind the key', symbol: 'key.fill' },
  { id: 'shake', label: 'Shake', symbol: 'iphone.radiowaves.left.and.right' },
];
/** How far a finger goes on the key for a whole turn of it, in points */
const KEY_TURN = 200;

export default function FairyGlobeDemo() {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const canvasRef = useRef<CanvasRef>(null);
  const [scene, setScene] = useState<SnowGlobe | null>(null);
  const [stage, setStage] = useState<Stage>('shelf');
  const [chapter, setChapter] = useState<Chapter>(null);
  const [done, setDone] = useState<Record<Hint, boolean>>({ wind: false, shake: false });
  const [loaded, setLoaded] = useState(false);
  const curtain = useSharedValue(1);
  // Made from scratch (scripts/fairy_globe_sounds.py, scripts/snow_globe_sounds.py)
  const whoosh = useSound(require('../../../assets/fairy-globe/whoosh.wav'));
  const crackle = useSound(require('../../../assets/fairy-globe/crackle.wav'));
  const eep = useSound(require('../../../assets/fairy-globe/eep.wav'));
  const twinkle = useSound(require('../../../assets/fairy-globe/twinkle.wav'));
  const bells = useSound(require('../../../assets/fairy-globe/bells.wav'));
  const hohoho = useSound(require('../../../assets/fairy-globe/hohoho.wav'));
  const shimmer = useSound(require('../../../assets/fairy-globe/shimmer.wav'));
  const music = useMusicBox();
  // The players live as long as the screen does: the scene can hold on to these
  const sounds = useRef({ whoosh, crackle, eep, twinkle, bells, hohoho, shimmer, music });
  const lastTick = useRef(0);

  const mark = (h: Hint) => setDone((d) => (d[h] ? d : { ...d, [h]: true }));

  useEffect(() => {
    let live: SnowGlobe | null = null;
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
      live = createSnowGlobe(context, device, {
        onStage: setStage,
        onChapter: setChapter,
        onHaptic: (kind) => HAPTICS[kind](),
        onCue: (cue) => sounds.current[cue](),
        onNote: (pitch, bass) => {
          sounds.current.music(pitch, bass);
          // A tick under the thumb with the tune, but no faster than a fingertip can feel
          const now = Date.now();
          if (!bass && now - lastTick.current > 70) {
            lastTick.current = now;
            Presets.System.selection();
          }
        },
      });
      live.onFirstFrame(() => {
        curtain.value = withTiming(0, { duration: 1400, easing: Easing.out(Easing.cubic) });
        setLoaded(true);
      });
      // Dev builds expose the scene for QA: snowGlobe.debug(), snowGlobe.shake(1), snowGlobe.dive()
      if (__DEV__) (globalThis as { snowGlobe?: SnowGlobe }).snowGlobe = live;
      setScene(live);
    })();
    return () => {
      cancelled = true;
      live?.dispose();
    };
  }, [curtain]);

  // Folding or unfolding the phone changes the screen under the scene
  useEffect(() => {
    scene?.resize(width, height, Math.min(PixelRatio.get(), 2.5));
  }, [scene, width, height]);

  // The phone's motion: its tilt leans the camera and drifts the snow; a shake makes it snow
  useEffect(() => {
    if (!scene) return;
    Accelerometer.setUpdateInterval(16);
    const g = { x: 0, y: -1, z: 0 };
    let lastShake = 0;
    const sub = Accelerometer.addListener((a) => {
      g.x += (a.x - g.x) * 0.12;
      g.y += (a.y - g.y) * 0.12;
      g.z += (a.z - g.z) * 0.12;
      scene.motion(g.x, g.y, g.z);
      const jolt = Math.hypot(a.x - g.x, a.y - g.y, a.z - g.z);
      const now = Date.now();
      if (jolt > 0.85 && now - lastShake > 450) {
        lastShake = now;
        scene.shake(Math.min(1.5, jolt * 0.75));
        mark('shake');
      }
    });
    return () => sub.remove();
  }, [scene]);

  // On the key, a finger winds it, round or back and forth, a click of the ratchet each quarter turn;
  // anywhere else it turns the globe sideways, and a quick flick up or down shakes it
  const turn = Gesture.Pan()
    .runOnJS(true)
    .minDistance(2)
    .onBegin((e) => {
      scene?.holdKey(e.x, e.y);
    })
    .onChange((e) => {
      if (!scene) return;
      if (scene.holdingKey()) {
        if (scene.windKey(Math.hypot(e.changeX, e.changeY) / KEY_TURN) > 0) Presets.System.impactRigid();
        if (scene.keyTurns() > 0.75) mark('wind');
        return;
      }
      if (Math.abs(e.translationY) > Math.abs(e.translationX) * 1.4) return;
      scene.turnBy(e.changeX * 0.012);
    })
    .onEnd((e) => {
      if (!scene || scene.holdingKey()) return;
      if (Math.abs(e.velocityY) > 700 && Math.abs(e.translationY) > Math.abs(e.translationX) * 1.4) {
        scene.letGo(0);
        scene.shake(Math.min(1.4, Math.abs(e.velocityY) / 1800));
        mark('shake');
        return;
      }
      scene.letGo(e.velocityX * 0.012);
    })
    .onFinalize(() => {
      if (!scene?.letGoKey()) scene?.letGo(0);
    });
  const tap = Gesture.Tap()
    .runOnJS(true)
    .onEnd((e) => {
      scene?.tap(e.x, e.y);
    });

  const curtainStyle = useAnimatedStyle(() => ({ opacity: curtain.value }));
  const onShelf = stage === 'shelf' && chapter !== 'home';
  const allDone = done.wind && done.shake;

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <GestureDetector gesture={Gesture.Exclusive(turn, tap)}>
        <View style={StyleSheet.absoluteFill}>
          <Canvas ref={canvasRef} style={StyleSheet.absoluteFill} />
        </View>
      </GestureDetector>

      {/* The title, quietly, over the room */}
      {onShelf ? (
        <Animated.View
          entering={FadeIn.delay(loaded ? 0 : 900).duration(900)}
          exiting={FadeOut.duration(500)}
          pointerEvents="none"
          style={[styles.head, { top: insets.top + 18 }]}>
          <Text style={styles.kicker}>ROTHENBURG · 24 DECEMBER</Text>
          <Text style={styles.title}>Silent Night</Text>
        </Animated.View>
      ) : null}

      {/* How to play with it: three quiet hints, each lighting up once it's been done */}
      {onShelf && loaded && !allDone ? (
        <Animated.View
          entering={FadeInDown.delay(1600).duration(700).easing(Easing.out(Easing.cubic))}
          exiting={FadeOut.duration(400)}
          pointerEvents="none"
          style={[styles.hints, { bottom: insets.bottom + 18 }]}>
          {HINTS.map((h) => (
            <HintChip key={h.id} label={h.label} symbol={h.symbol} on={done[h.id]} />
          ))}
        </Animated.View>
      ) : null}

      {/* Where you are, on the way in and out */}
      {chapter ? (
        <Animated.View
          key={chapter}
          entering={FadeIn.duration(900)}
          exiting={FadeOut.duration(700)}
          pointerEvents="none"
          style={[styles.chapter, chapter === 'home' ? { top: insets.top + 40 } : { bottom: insets.bottom + 40 }]}>
          {chapter === 'home' ? (
            <Text style={styles.merry}>{CHAPTERS.home}</Text>
          ) : (
            <Text style={styles.caption}>{CHAPTERS[chapter]}</Text>
          )}
        </Animated.View>
      ) : null}
      <ChapterTimer chapter={chapter} onDone={() => setChapter(null)} />

      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.curtain, curtainStyle]}>
        {!loaded ? <Loading /> : null}
      </Animated.View>
    </View>
  );
}

/** Captions stay a few seconds, "Merry Christmas" a little longer */
function ChapterTimer({ chapter, onDone }: { chapter: Chapter; onDone: () => void }) {
  useEffect(() => {
    if (!chapter) return;
    const id = setTimeout(onDone, chapter === 'home' ? 5200 : 3400);
    return () => clearTimeout(id);
  }, [chapter, onDone]);
  return null;
}

function HintChip({ label, symbol, on }: { label: string; symbol: SymbolViewProps['name']; on: boolean }) {
  return (
    <GlassView
      glassEffectStyle="clear"
      tintColor="rgba(30,18,12,0.35)"
      style={[styles.chip, !GLASS && styles.chipFrost]}>
      <SymbolView
        name={on ? 'checkmark' : symbol}
        size={13}
        weight="semibold"
        tintColor={on ? GOLD : 'rgba(255,244,226,0.85)'}
      />
      <Text style={[styles.chipText, on && { color: GOLD }]}>{label}</Text>
    </GlassView>
  );
}

/** While the town's being built: a snowflake, breathing */
function Loading() {
  const breath = useSharedValue(0);
  useEffect(() => {
    breath.value = withRepeat(withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.sin) }), -1, true);
  }, [breath]);
  const style = useAnimatedStyle(() => ({
    opacity: 0.35 + breath.value * 0.5,
    transform: [{ scale: 0.92 + breath.value * 0.1 }],
  }));
  return (
    <View style={styles.loading}>
      <Animated.View style={style}>
        <SymbolView name="snowflake" size={30} weight="light" tintColor={CREAM} />
      </Animated.View>
      <Text style={styles.loadingText}>Building the town under the glass</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0D0809',
  },
  curtain: {
    backgroundColor: '#0D0809',
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
  },
  loadingText: {
    fontFamily: SERIF_ITALIC,
    fontSize: 15,
    color: 'rgba(255,244,226,0.6)',
  },
  head: {
    position: 'absolute',
    left: 24,
    right: 24,
    alignItems: 'center',
  },
  kicker: {
    fontFamily: SERIF,
    fontSize: 11,
    letterSpacing: 3.2,
    color: 'rgba(255,244,226,0.6)',
  },
  title: {
    fontFamily: SCRIPT,
    fontSize: 46,
    color: CREAM,
    marginTop: 2,
    textShadowColor: 'rgba(255,190,110,0.5)',
    textShadowRadius: 16,
    textShadowOffset: { width: 0, height: 0 },
  },
  hints: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 34,
    paddingHorizontal: 13,
    borderRadius: 17,
  },
  chipFrost: {
    backgroundColor: 'rgba(30,18,12,0.55)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,244,226,0.18)',
  },
  chipText: {
    fontFamily: SERIF,
    fontSize: 14,
    color: 'rgba(255,244,226,0.9)',
  },
  chapter: {
    position: 'absolute',
    left: 24,
    right: 24,
    alignItems: 'center',
  },
  caption: {
    fontFamily: SERIF_ITALIC,
    fontSize: 19,
    color: CREAM,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowRadius: 10,
    textShadowOffset: { width: 0, height: 1 },
  },
  merry: {
    fontFamily: SCRIPT,
    fontSize: 52,
    color: CREAM,
    textShadowColor: 'rgba(255,190,110,0.6)',
    textShadowRadius: 18,
    textShadowOffset: { width: 0, height: 0 },
  },
});
