import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  PixelRatio,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { Presets } from 'react-native-pulsar';
import Animated, {
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Canvas as SkiaCanvas, LinearGradient, Rect, RadialGradient, vec } from 'react-native-skia';
import { Canvas, type CanvasRef } from 'react-native-webgpu';

import { GlassView } from 'expo-glass-effect';
import { SymbolView } from 'expo-symbols';

import { createChatPlaneScene, type ChatPlaneEvents, type ChatPlaneScene, type Rect as Box } from './scene';

/**
 * Paper Plane, in a chat: send a message and its bubble lifts off as a card of paper, folds
 * itself into a plane and loops out of the screen. Bin's answer flies in the same way, lands where
 * its bubble goes and opens flat into it.
 */

type Message = {
  id: number;
  from: 'me' | 'bin';
  text: string;
  time: string;
  /** Hidden while it's paper */
  away?: boolean;
  delivered?: boolean;
};

const BLUE = '#2F7BFF';
const SEED: Message[] = [
  { id: 1, from: 'bin', text: 'do you still have that notebook from grade 5?', time: '18:02' },
  { id: 2, from: 'me', text: 'the one with planes drawn all over the back? obviously', time: '18:03' },
  { id: 3, from: 'bin', text: 'send me one. for old times', time: '18:03' },
];
const REPLIES = [
  'it flew all the way here?? okay you win. rice field at 5',
  'caught it. bringing the kite',
  'still the best folder in class. see you after school',
];

const HAPTICS: Record<Parameters<ChatPlaneEvents['onHaptic']>[0], () => void> = {
  lift: () => Presets.System.impactLight(),
  crease: () => Presets.System.impactLight(),
  wing: () => Presets.System.impactMedium(),
  throw: () => Presets.propel(),
  whoosh: () => Presets.sweep(),
  catch: () => Presets.feather(),
  page: () => Presets.System.selection(),
};

const clock = () => {
  const d = new Date();
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export default function PaperPlaneChat() {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const canvasRef = useRef<CanvasRef>(null);
  const scroll = useRef<ScrollView>(null);
  const bubbles = useRef(new Map<number, View>());
  const nextId = useRef(10);
  const replyIndex = useRef(0);
  const [scene, setScene] = useState<ChatPlaneScene | null>(null);
  const [messages, setMessages] = useState<Message[]>(SEED);
  const [text, setText] = useState('Meet me at the rice field after school. Bring the kite!');
  const [typing, setTyping] = useState(false);
  const [busy, setBusy] = useState(false);

  const patch = (id: number, change: Partial<Message>) =>
    setMessages((list) => list.map((m) => (m.id === id ? { ...m, ...change } : m)));

  const measure = (id: number) =>
    new Promise<Box | null>((resolve) => {
      const view = bubbles.current.get(id);
      if (!view) return resolve(null);
      view.measureInWindow((x, y, w, h) => resolve({ x, y, width: w, height: h }));
    });

  useEffect(() => {
    let live: ChatPlaneScene | null = null;
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
      const ratio = Math.min(PixelRatio.get(), 3);
      canvas.width = canvas.clientWidth * ratio;
      canvas.height = canvas.clientHeight * ratio;
      live = createChatPlaneScene(context, device, {
        onDeparted: (id) => {
          patch(id, { away: false, delivered: true });
          // Bin reads it, and answers the same way
          setTimeout(() => setTyping(true), 900);
          setTimeout(() => {
            setTyping(false);
            const reply = REPLIES[replyIndex.current++ % REPLIES.length];
            const rid = nextId.current++;
            setMessages((list) => [...list, { id: rid, from: 'bin', text: reply, time: clock(), away: true }]);
            setTimeout(async () => {
              const rect = await measure(rid);
              if (rect) live?.receive(rid, rect, reply, 'Bin', clock());
            }, 420);
          }, 3200);
        },
        onLanded: (id) => {
          patch(id, { away: false });
          setBusy(false);
        },
        onHaptic: (kind) => HAPTICS[kind](),
      });
      if (__DEV__) (globalThis as { chatPlane?: ChatPlaneScene }).chatPlane = live;
      setScene(live);
    })();
    return () => {
      cancelled = true;
      live?.dispose();
    };
  }, []);

  const send = () => {
    const body = text.trim();
    if (!body || busy || !scene) return;
    setBusy(true);
    Keyboard.dismiss();
    const id = nextId.current++;
    const time = clock();
    setMessages((list) => [...list, { id, from: 'me', text: body, time }]);
    setText('');
    // Let it land in the thread, then it lifts off as paper
    setTimeout(async () => {
      const rect = await measure(id);
      if (!rect) return setBusy(false);
      patch(id, { away: true });
      scene.send(id, rect, body, time);
    }, 650);
  };

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <SkiaCanvas style={StyleSheet.absoluteFill} pointerEvents="none">
        <Rect x={0} y={0} width={width} height={height}>
          <LinearGradient start={vec(0, 0)} end={vec(0, height)} colors={['#0C1124', '#0A0D18', '#0F1020']} />
        </Rect>
        <Rect x={0} y={0} width={width} height={height}>
          <RadialGradient
            c={vec(width * 0.95, height * 0.08)}
            r={width * 0.9}
            colors={['rgba(120,90,255,0.28)', 'rgba(120,90,255,0)']}
          />
        </Rect>
        <Rect x={0} y={0} width={width} height={height}>
          <RadialGradient
            c={vec(width * 0.05, height * 0.85)}
            r={width}
            colors={['rgba(40,170,200,0.18)', 'rgba(40,170,200,0)']}
          />
        </Rect>
      </SkiaCanvas>

      <KeyboardAvoidingView behavior="padding" style={styles.fill}>
        <ScrollView
          ref={scroll}
          style={styles.fill}
          contentContainerStyle={{ paddingTop: insets.top + 86, paddingBottom: 16, paddingHorizontal: 14, gap: 8 }}
          onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}
          keyboardDismissMode="interactive">
          <Text style={styles.day}>Today</Text>
          {messages.map((m) => (
            <View key={m.id} style={[styles.row, m.from === 'me' ? styles.right : styles.left]}>
              <View
                ref={(v) => {
                  if (v) bubbles.current.set(m.id, v);
                  else bubbles.current.delete(m.id);
                }}
                collapsable={false}
                style={[styles.bubbleWrap, m.away && styles.away]}>
                <GlassView
                  glassEffectStyle="regular"
                  colorScheme="dark"
                  tintColor={m.from === 'me' ? 'rgba(47,123,255,0.62)' : 'rgba(255,255,255,0.06)'}
                  style={[styles.bubble, m.from === 'me' ? styles.mine : styles.theirs]}>
                  <Text style={styles.text}>{m.text}</Text>
                </GlassView>
              </View>
              {m.delivered ? (
                <Animated.View entering={FadeIn.duration(400)} style={styles.delivered}>
                  <SymbolView name="paperplane.fill" size={10} tintColor="rgba(255,255,255,0.45)" />
                  <Text style={styles.deliveredText}>Delivered by paper plane</Text>
                </Animated.View>
              ) : null}
            </View>
          ))}
          {typing ? (
            <Animated.View
              entering={FadeIn.duration(200)}
              exiting={FadeOut.duration(150)}
              style={[styles.row, styles.left]}>
              <GlassView
                glassEffectStyle="regular"
                colorScheme="dark"
                style={[styles.bubble, styles.theirs, styles.typing]}>
                {[0, 1, 2].map((i) => (
                  <Dot key={i} delay={i * 160} />
                ))}
              </GlassView>
            </Animated.View>
          ) : null}
        </ScrollView>

        <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, 10) + 4 }]}>
          <GlassView glassEffectStyle="regular" colorScheme="dark" style={styles.bar}>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder="Write a note…"
              placeholderTextColor="rgba(255,255,255,0.4)"
              style={styles.input}
              multiline
              maxLength={140}
            />
            <Pressable onPress={send} hitSlop={8} accessibilityRole="button" accessibilityLabel="Send as a paper plane">
              <View style={[styles.send, (!text.trim() || busy) && styles.sendOff]}>
                <SymbolView name="paperplane.fill" size={17} tintColor="#FFFFFF" />
              </View>
            </Pressable>
          </GlassView>
        </View>
      </KeyboardAvoidingView>

      <View pointerEvents="none" style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <GlassView glassEffectStyle="regular" colorScheme="dark" style={styles.headerGlass}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>B</Text>
          </View>
          <View>
            <Text style={styles.name}>Bin</Text>
            <Text style={styles.status}>{typing ? 'folding a reply…' : 'paper planes only'}</Text>
          </View>
        </GlassView>
      </View>

      <Canvas ref={canvasRef} style={StyleSheet.absoluteFill} pointerEvents="none" />
    </View>
  );
}

function Dot({ delay }: { delay: number }) {
  const o = useSharedValue(0.3);
  useEffect(() => {
    o.value = withDelay(
      delay,
      withRepeat(withSequence(withTiming(1, { duration: 380 }), withTiming(0.3, { duration: 380 })), -1)
    );
  }, [o, delay]);
  const style = useAnimatedStyle(() => ({ opacity: o.value, transform: [{ translateY: (1 - o.value) * 2 }] }));
  return <Animated.View style={[styles.dot, style]} />;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0A0D18',
  },
  fill: {
    flex: 1,
  },
  day: {
    alignSelf: 'center',
    color: 'rgba(255,255,255,0.4)',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
  },
  row: {
    maxWidth: '82%',
  },
  right: {
    alignSelf: 'flex-end',
    alignItems: 'flex-end',
  },
  left: {
    alignSelf: 'flex-start',
    alignItems: 'flex-start',
  },
  bubbleWrap: {
    borderRadius: 20,
  },
  away: {
    opacity: 0,
  },
  bubble: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
  },
  mine: {
    borderBottomRightRadius: 6,
  },
  theirs: {
    borderBottomLeftRadius: 6,
  },
  text: {
    color: '#FFFFFF',
    fontSize: 16,
    lineHeight: 21,
  },
  delivered: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
    marginRight: 4,
  },
  deliveredText: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 11,
    fontWeight: '500',
  },
  typing: {
    flexDirection: 'row',
    gap: 5,
    paddingVertical: 14,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: 'rgba(255,255,255,0.85)',
  },
  composer: {
    paddingHorizontal: 12,
    paddingTop: 6,
  },
  bar: {
    minHeight: 50,
    borderRadius: 25,
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingLeft: 18,
    paddingRight: 5,
    paddingVertical: 5,
    gap: 8,
  },
  input: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 16,
    paddingTop: 10,
    paddingBottom: 10,
    maxHeight: 110,
  },
  send: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: BLUE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendOff: {
    opacity: 0.4,
  },
  header: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    alignItems: 'center',
  },
  headerGlass: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingLeft: 6,
    paddingRight: 18,
    height: 52,
    borderRadius: 26,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F2B544',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#3A2400',
    fontSize: 18,
    fontWeight: '800',
  },
  name: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  status: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 12,
    fontWeight: '500',
  },
});
