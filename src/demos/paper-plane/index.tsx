import { PatrickHand_400Regular, useFonts } from '@expo-google-fonts/patrick-hand';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  PixelRatio,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { Presets } from 'react-native-pulsar';
import Animated, { FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Canvas, type CanvasRef } from 'react-native-webgpu';

import { GlassView } from 'expo-glass-effect';
import { SymbolView } from 'expo-symbols';

import { createPaperPlaneScene, type Haptic, type PaperPlaneScene, type Phase } from './scene';

/**
 * Paper Plane: write a note on a page from your school notebook, fold it into a plane and send it
 * over the rice field at sunset, up through the clouds and down to the rice terraces of Sa Pa on a
 * bright morning, where someone writes back.
 */

const HAND = 'PatrickHand_400Regular';
const INK = '#3A2A1F';
const START = 'Meet me at the rice field after school? Bring the kite!';

const HAPTICS: Record<Haptic, () => void> = {
  crease: () => Presets.System.impactLight(),
  wing: () => Presets.System.impactMedium(),
  throw: () => Presets.propel(),
  land: () => Presets.System.impactSoft(),
  page: () => Presets.System.selection(),
  scratch: () => Presets.System.selection(),
  cloud: () => Presets.swell(),
};

const STATUS: Partial<Record<Phase, string>> = {
  folding: 'Folding…',
  aiming: 'Folding…',
  flying: 'There it goes',
  clouds: 'Up through the clouds…',
  descending: '…all the way to Sa Pa',
  unfolding: 'Landed on the terraces',
  arrived: 'Landed on the terraces',
  replying: 'Someone’s writing back…',
};

export default function PaperPlane() {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const canvasRef = useRef<CanvasRef>(null);
  const [scene, setScene] = useState<PaperPlaneScene | null>(null);
  const [phase, setPhase] = useState<Phase>('writing');
  const [text, setText] = useState(START);
  const [fonts] = useFonts({ PatrickHand_400Regular });
  const curtain = useSharedValue(1);

  useEffect(() => {
    let live: PaperPlaneScene | null = null;
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
      live = createPaperPlaneScene(context, device, {
        onPhase: setPhase,
        onHaptic: (kind) => HAPTICS[kind](),
      });
      live.setNote(START);
      live.onFirstFrame(() => (curtain.value = withTiming(0, { duration: 900 })));
      // Dev builds expose the scene for QA: planeScene.send()
      if (__DEV__) (globalThis as { planeScene?: PaperPlaneScene }).planeScene = live;
      setScene(live);
    })();
    return () => {
      cancelled = true;
      live?.dispose();
    };
  }, [curtain]);

  useEffect(() => {
    if (!scene) return;
    const show = Keyboard.addListener('keyboardWillShow', (e) => scene.setLift(e.endCoordinates.height / height));
    const hide = Keyboard.addListener('keyboardWillHide', () => scene.setLift(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, [scene, height]);

  const onChange = (value: string) => {
    setText(value);
    scene?.setNote(value);
  };
  const send = () => {
    if (!text.trim()) return;
    Keyboard.dismiss();
    scene?.send();
  };
  const flyBack = () => {
    setText('');
    scene?.setNote('');
    scene?.flyBack();
  };

  const curtainStyle = useAnimatedStyle(() => ({ opacity: curtain.value }));
  const status = STATUS[phase] ?? null;

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <Canvas ref={canvasRef} style={StyleSheet.absoluteFill} />

      <View pointerEvents="none" style={[styles.head, { top: insets.top + 10 }]}>
        <Text style={[styles.title, fonts && styles.hand]}>Paper Plane</Text>
        <Text style={[styles.subtitle, fonts && styles.hand]}>Write a note. Send it over the rice field.</Text>
      </View>

      <KeyboardAvoidingView behavior="padding" style={styles.foot} pointerEvents="box-none">
        <View style={[styles.footInner, { paddingBottom: Math.max(insets.bottom, 12) + 6 }]} pointerEvents="box-none">
          {phase === 'writing' ? (
            <Animated.View entering={FadeIn.duration(320)} exiting={FadeOut.duration(160)}>
              <GlassView glassEffectStyle="regular" style={styles.bar}>
                <TextInput
                  value={text}
                  onChangeText={onChange}
                  placeholder="Write a note…"
                  placeholderTextColor="rgba(58,42,31,0.45)"
                  style={[styles.input, fonts && styles.hand]}
                  maxLength={160}
                  returnKeyType="send"
                  onSubmitEditing={send}
                  submitBehavior="blurAndSubmit"
                />
                <Pressable onPress={send} hitSlop={8} accessibilityRole="button" accessibilityLabel="Send">
                  <View style={[styles.send, !text.trim() && styles.sendOff]}>
                    <SymbolView name="paperplane.fill" size={18} tintColor="#FFF7EA" />
                  </View>
                </Pressable>
              </GlassView>
            </Animated.View>
          ) : phase === 'resting' ? (
            <Animated.View entering={FadeIn.duration(320)} exiting={FadeOut.duration(160)}>
              <Pressable onPress={flyBack} accessibilityRole="button">
                <GlassView glassEffectStyle="regular" isInteractive style={styles.pill}>
                  <SymbolView name="cloud.fill" size={16} tintColor={INK} />
                  <Text style={[styles.pillText, fonts && styles.hand]}>Fly back</Text>
                </GlassView>
              </Pressable>
            </Animated.View>
          ) : status ? (
            <Animated.Text
              key={status}
              entering={FadeIn.duration(320)}
              exiting={FadeOut.duration(200)}
              style={[styles.status, fonts && styles.hand]}>
              {status}
            </Animated.Text>
          ) : null}
        </View>
      </KeyboardAvoidingView>

      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.curtain, curtainStyle]} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#E8B98A',
  },
  curtain: {
    backgroundColor: '#E8B98A',
  },
  hand: {
    fontFamily: HAND,
  },
  head: {
    position: 'absolute',
    left: 22,
    right: 80,
  },
  title: {
    fontSize: 38,
    color: '#FFF6E8',
    textShadowColor: 'rgba(90,40,20,0.35)',
    textShadowRadius: 8,
    textShadowOffset: { width: 0, height: 1 },
  },
  subtitle: {
    marginTop: 2,
    fontSize: 17,
    color: 'rgba(255,246,232,0.88)',
    textShadowColor: 'rgba(90,40,20,0.35)',
    textShadowRadius: 6,
    textShadowOffset: { width: 0, height: 1 },
  },
  foot: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  footInner: {
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  bar: {
    width: 360,
    maxWidth: '100%',
    minHeight: 56,
    borderRadius: 28,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 20,
    paddingRight: 6,
    gap: 8,
  },
  input: {
    flex: 1,
    fontSize: 20,
    color: INK,
    paddingVertical: 12,
  },
  send: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#C8553D',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendOff: {
    opacity: 0.4,
  },
  pill: {
    height: 52,
    borderRadius: 26,
    paddingHorizontal: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pillText: {
    fontSize: 20,
    color: INK,
  },
  status: {
    fontSize: 20,
    color: '#FFF6E8',
    textShadowColor: 'rgba(90,40,20,0.4)',
    textShadowRadius: 6,
    textShadowOffset: { width: 0, height: 1 },
    paddingBottom: 14,
  },
});
