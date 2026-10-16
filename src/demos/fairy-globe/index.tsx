import { MountainsofChristmas_700Bold, useFonts } from '@expo-google-fonts/mountains-of-christmas';
import { GlassView } from 'expo-glass-effect';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { PixelRatio, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Presets } from 'react-native-pulsar';
import Animated, {
  FadeIn,
  FadeOut,
  ZoomIn,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Canvas, type CanvasRef } from 'react-native-webgpu';

import { NumericText } from '@/components/numeric-text';
import { useSound } from '@/hooks/use-sound';

import { createFairyGlobe, type FairyGlobe, type GlobeHaptic, type Leg, type Stage } from './scene';
import { STOPS } from './world';

/**
 * Fairy Globe: Christmas Eve on a storybook globe. Santa races midnight round the world from his
 * village under the northern lights; tap a sparkle to send him there and go down to the rooftops.
 */

const STORY = 'MountainsofChristmas_700Bold';
const CREAM = '#FFF6E6';
const GOLD = '#FFD873';

const HAPTICS: Record<GlobeHaptic, () => void> = {
  takeoff: () => Presets.propel(),
  deliver: () => Presets.System.notificationSuccess(),
  select: () => Presets.System.selection(),
  home: () => Presets.swell(),
};

const STATUS: Record<Leg['phase'], string> = {
  flying: 'Next stop',
  delivering: 'Down the chimney',
  home: 'Back at the North',
  visiting: 'Down the chimney',
};

export default function FairyGlobeDemo() {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const canvasRef = useRef<CanvasRef>(null);
  const [scene, setScene] = useState<FairyGlobe | null>(null);
  const [leg, setLeg] = useState<Leg | null>(null);
  const [gifts, setGifts] = useState(0);
  const [delivered, setDelivered] = useState(0);
  const [hint, setHint] = useState(true);
  const [stage, setStage] = useState<Stage>('globe');
  const [hoho, setHoho] = useState<{ x: number; y: number; key: number } | null>(null);
  const [fonts] = useFonts({ MountainsofChristmas_700Bold });
  const curtain = useSharedValue(1);
  // All made from scratch (scripts/fairy_globe_sounds.py)
  const laugh = useSound(require('../../../assets/fairy-globe/hohoho.wav'));
  const jingle = useSound(require('../../../assets/fairy-globe/bells.wav'));
  const whoosh = useSound(require('../../../assets/fairy-globe/whoosh.wav'));
  const crackle = useSound(require('../../../assets/fairy-globe/crackle.wav'));
  const eep = useSound(require('../../../assets/fairy-globe/eep.wav'));
  const twinkle = useSound(require('../../../assets/fairy-globe/twinkle.wav'));
  // The players live as long as the screen does: the scene can hold on to these
  const sounds = useRef({ laugh, jingle, whoosh, crackle, eep, twinkle });

  useEffect(() => {
    let live: FairyGlobe | null = null;
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
      live = createFairyGlobe(context, device, {
        onLeg: setLeg,
        onGifts: (n, d) => {
          setGifts(n);
          setDelivered(d);
        },
        onHaptic: (kind) => {
          HAPTICS[kind]();
          // Bells as the team sets off
          if (kind === 'takeoff') sounds.current.jingle();
        },
        onStage: setStage,
        onHoHo: (x, y) => {
          setHoho({ x, y, key: Date.now() });
          sounds.current.laugh();
        },
        onCue: (cue) => sounds.current[cue](),
      });
      live.onFirstFrame(() => (curtain.value = withTiming(0, { duration: 1200 })));
      // Dev builds expose the scene for QA: fairyGlobe.debug()
      if (__DEV__) (globalThis as { fairyGlobe?: FairyGlobe }).fairyGlobe = live;
      setScene(live);
    })();
    return () => {
      cancelled = true;
      live?.dispose();
    };
  }, [curtain]);

  useEffect(() => {
    if (!hoho) return;
    const id = setTimeout(() => setHoho(null), 2400);
    return () => clearTimeout(id);
  }, [hoho]);

  useEffect(() => {
    if (!hint) return;
    const id = setTimeout(() => setHint(false), 9000);
    return () => clearTimeout(id);
  }, [hint]);

  const pan = Gesture.Pan()
    .runOnJS(true)
    .minDistance(6)
    .onChange((e) => scene?.panBy(e.changeX, e.changeY))
    .onEnd((e) => scene?.release(e.velocityX, e.velocityY))
    .onFinalize(() => scene?.release(0, 0));
  const tap = Gesture.Tap()
    .runOnJS(true)
    .onEnd((e) => {
      if (scene?.tap(e.x, e.y)) setHint(false);
    });

  // Folding or unfolding the phone changes the screen under the scene
  useEffect(() => {
    scene?.resize(width, height, Math.min(PixelRatio.get(), 2.5));
  }, [scene, width, height]);

  const curtainStyle = useAnimatedStyle(() => ({ opacity: curtain.value }));
  const story = fonts ? styles.story : null;
  // Open on a folding phone the screen is wide: the words go to the corners, the globe has the middle
  const wide = width > height;

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <GestureDetector gesture={Gesture.Exclusive(pan, tap)}>
        <View style={StyleSheet.absoluteFill}>
          <Canvas ref={canvasRef} style={StyleSheet.absoluteFill} />
        </View>
      </GestureDetector>

      <View
        pointerEvents="none"
        style={[
          styles.head,
          wide && styles.headWide,
          { top: insets.top + 6, opacity: stage === 'globe' ? 1 : 0 },
          wide && { left: insets.left + 28 },
        ]}>
        <Text style={[styles.title, story]}>Christmas Eve</Text>
        <Text style={[styles.subtitle, story]}>Santa is racing midnight round the world</Text>
      </View>

      {hint && stage === 'globe' && leg?.phase === 'flying' && !STOPS[leg.stop]?.hero ? (
        <Animated.Text
          entering={FadeIn.duration(500)}
          exiting={FadeOut.duration(300)}
          pointerEvents="none"
          style={[
            styles.hint,
            story,
            wide
              ? { left: insets.left + 28, right: undefined, bottom: Math.max(insets.bottom, 12) + 30, textAlign: 'left' }
              : { top: height * 0.5 + width * 0.52 },
          ]}>
          Tap a sparkle to send him there
        </Animated.Text>
      ) : null}

      <View
        pointerEvents="none"
        style={[
          styles.foot,
          wide && styles.footWide,
          { paddingBottom: Math.max(insets.bottom, 12) + 4, opacity: stage === 'globe' ? 1 : 0 },
          wide && { paddingRight: insets.right + 24 },
        ]}>
        <GlassView glassEffectStyle="regular" tintColor="rgba(20,16,60,0.35)" style={styles.card}>
          <View style={styles.cardLeft}>
            <Text style={styles.label}>{leg ? STATUS[leg.phase].toUpperCase() : ' '}</Text>
            {leg ? (
              <Animated.View key={`${leg.name}-${leg.phase}`} entering={FadeIn.duration(400)}>
                <Text style={[styles.place, story]} numberOfLines={1}>
                  {leg.name}
                </Text>
                <Text style={styles.note} numberOfLines={1}>
                  {leg.note}
                </Text>
              </Animated.View>
            ) : null}
          </View>
          <View style={styles.cardRight}>
            <Text style={styles.label}>PRESENTS</Text>
            <NumericText value={gifts.toLocaleString('en-US')} fontSize={22} color={GOLD} weight="bold" />
            <Text style={styles.note}>{delivered} of {STOPS.length} towns</Text>
          </View>
        </GlassView>
      </View>

      {hoho ? (
        <Animated.View
          key={hoho.key}
          entering={ZoomIn.springify().damping(9).stiffness(160)}
          exiting={FadeOut.duration(500)}
          pointerEvents="none"
          style={[
            styles.hohoBox,
            {
              left: Math.min(width - 300, Math.max(16, hoho.x - 150)),
              top: Math.min(height - 120, Math.max(insets.top + 8, hoho.y - 150)),
            },
          ]}>
          <Text style={[styles.hoho, story]}>Ho ho ho!</Text>
        </Animated.View>
      ) : null}

      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.curtain, curtainStyle]} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0A0F2E',
  },
  curtain: {
    backgroundColor: '#0A0F2E',
  },
  story: {
    fontFamily: STORY,
  },
  head: {
    position: 'absolute',
    left: 20,
    right: 20,
    alignItems: 'center',
  },
  headWide: {
    right: undefined,
    alignItems: 'flex-start',
  },
  footWide: {
    alignItems: 'flex-end',
  },
  title: {
    fontSize: 44,
    color: CREAM,
    textShadowColor: 'rgba(255,200,120,0.55)',
    textShadowRadius: 14,
    textShadowOffset: { width: 0, height: 0 },
  },
  subtitle: {
    marginTop: -4,
    fontSize: 18,
    color: 'rgba(255,246,230,0.82)',
    textAlign: 'center',
  },
  hohoBox: {
    position: 'absolute',
    width: 300,
  },
  hoho: {
    textAlign: 'center',
    fontSize: 56,
    color: '#FFF3DA',
    transform: [{ rotate: '-8deg' }],
    textShadowColor: 'rgba(255,90,70,0.9)',
    textShadowRadius: 18,
    textShadowOffset: { width: 0, height: 0 },
  },
  hint: {
    position: 'absolute',
    left: 0,
    right: 0,
    textAlign: 'center',
    fontSize: 20,
    color: GOLD,
    textShadowColor: 'rgba(255,200,90,0.6)',
    textShadowRadius: 10,
    textShadowOffset: { width: 0, height: 0 },
  },
  foot: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  card: {
    width: 380,
    maxWidth: '100%',
    borderRadius: 26,
    paddingHorizontal: 20,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  cardLeft: {
    flex: 1,
  },
  cardRight: {
    alignItems: 'flex-end',
  },
  label: {
    fontSize: 11,
    letterSpacing: 1.4,
    fontWeight: '700',
    color: 'rgba(255,246,230,0.6)',
  },
  place: {
    fontSize: 28,
    color: CREAM,
    marginTop: -2,
  },
  note: {
    fontSize: 13,
    color: 'rgba(255,246,230,0.75)',
    marginTop: 1,
  },
});
