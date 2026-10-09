import { GlassView } from 'expo-glass-effect';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SymbolView } from 'expo-symbols';
import { useEffect, useRef, useState } from 'react';
import { PixelRatio, Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Presets } from 'react-native-pulsar';
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  FadeOut,
  FadeOutUp,
  SensorType,
  useAnimatedReaction,
  useAnimatedSensor,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Canvas, type CanvasRef } from 'react-native-webgpu';
import { scheduleOnRN } from 'react-native-worklets';

import { lastShipped } from '../sticker-cart/order';
import { createFridgeScene, fridgeFriendly, ZONE_NAMES, type FridgeHaptic, type FridgeScene, type Zone } from './scene';

/**
 * Fridge: the last stop for what you bought in Market Bag and unboxed. Made for a folding phone:
 * folded, it's the fridge door; unfold it and the door swings open on the phone's own hinge. What
 * came in the box waits in front; drag each thing in and it goes where it belongs.
 */

const DARK = '#22302B';

const HAPTICS: Record<FridgeHaptic, () => void> = {
  swing: () => Presets.System.impactMedium(),
  pick: () => Presets.System.selection(),
  store: () => Presets.System.impactLight(),
  peek: () => Presets.System.selection(),
  done: () => Presets.chime(),
  shut: () => Presets.thud(),
};

/** If the order had nothing for the fridge, a basket of the usual */
const USUAL = [12, 13, 14, 15];

export default function Fridge() {
  const insets = useSafeAreaInsets();
  const canvasRef = useRef<CanvasRef>(null);
  const [order] = useState(lastShipped);
  const [bought] = useState(() => {
    const food = order.items.filter(fridgeFriendly);
    return food.length > 0 ? food : USUAL;
  });
  const [stored, setStored] = useState<number[]>([]);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [scene, setScene] = useState<FridgeScene | null>(null);
  /** The size whose scene has drawn; until it matches, the door's red covers the screen */
  const [drawn, setDrawn] = useState('');
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<Zone | null>(null);
  const [peek, setPeek] = useState<{ title: string; note: string; key: number } | null>(null);
  const gravity = useAnimatedSensor(SensorType.GRAVITY, { interval: 'auto' });
  /** Whether the last scene was the unfolded one, so a fold shows the door swinging shut */
  const wasWide = useRef(false);
  // Read once per layout, when the scene for it is made
  const storedRef = useRef(stored);
  useEffect(() => {
    storedRef.current = stored;
  }, [stored]);

  const wide = size ? size.w > size.h : false;
  const sizeKey = size ? `${Math.round(size.w)}x${Math.round(size.h)}` : '';

  useEffect(() => {
    if (!size) return;
    let live: FridgeScene | null = null;
    let cancelled = false;
    const closing = !wide && wasWide.current;
    wasWide.current = wide;
    (async () => {
      const adapter = await navigator.gpu.requestAdapter();
      const device = await adapter?.requestDevice();
      let context = canvasRef.current?.getContext('webgpu') ?? null;
      for (let tries = 0; !context && tries < 20 && !cancelled; tries++) {
        await new Promise((r) => setTimeout(r, 50));
        context = canvasRef.current?.getContext('webgpu') ?? null;
      }
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
      // What's still to put away: everything bought, less what's in already
      const left = [...bought];
      for (const p of storedRef.current) {
        const i = left.indexOf(p);
        if (i >= 0) left.splice(i, 1);
      }
      live = createFridgeScene(
        context,
        device,
        { bought: left, stored: storedRef.current, startOpen: closing, wide },
        {
          onHaptic: (kind) => HAPTICS[kind](),
          onStored: (p) => setStored((s) => [...s, p]),
          onTarget: setTarget,
          onPeek: (what) => setPeek(what ? { ...what, key: Date.now() } : null),
          onDoor: setOpen,
        }
      );
      // Folded shut: the door swings closed on the cover screen
      if (closing) live.swing(false);
      if (__DEV__) (globalThis as { fridgeScene?: FridgeScene }).fridgeScene = live;
      // Up on screen once it's drawn its first frame
      live.onFirstFrame(() => setDrawn(sizeKey));
      setScene(live);
    })();
    return () => {
      cancelled = true;
      live?.dispose();
      setScene(null);
    };
    // A new scene for each size; the rest is read as it is then
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sizeKey]);

  // Hide what was said about a thing after a moment
  useEffect(() => {
    if (!peek) return;
    const t = setTimeout(() => setPeek(null), 3200);
    return () => clearTimeout(t);
  }, [peek]);

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

  const remaining = bought.length - stored.length;
  const done = remaining <= 0;

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      <GestureDetector gesture={pan}>
        <View
          style={StyleSheet.absoluteFill}
          onLayout={(e) => {
            const { width: w, height: h } = e.nativeEvent.layout;
            setSize((s) =>
              s && Math.round(s.w) === Math.round(w) && Math.round(s.h) === Math.round(h) ? s : { w, h }
            );
          }}>
          {size ? <Canvas key={sizeKey} ref={canvasRef} style={StyleSheet.absoluteFill} /> : null}
          {/* Folding or unfolding builds the fridge again for the new screen: the red of its door
              holds the screen meanwhile, so there's never a blank one */}
          {drawn === sizeKey ? null : (
            <Animated.View
              exiting={FadeOut.duration(260)}
              pointerEvents="none"
              style={[StyleSheet.absoluteFill, styles.cover]}
            />
          )}
        </View>
      </GestureDetector>

      {/* What to do now, up top */}
      <View pointerEvents="box-none" style={[styles.top, { top: insets.top + 10 }]}>
        {!open ? (
          <Animated.View key="shut" entering={FadeIn.duration(400)} exiting={FadeOut.duration(200)}>
            <GlassView glassEffectStyle="regular" style={styles.chip}>
              <SymbolView name="iphone.gen3.radiowaves.left.and.right" size={15} tintColor={DARK} />
              <Text style={styles.chipText}>{wide ? 'Tap the door to open it' : 'Unfold the phone to open'}</Text>
            </GlassView>
          </Animated.View>
        ) : target ? (
          <Animated.View key={`to-${target}`} entering={FadeIn.duration(180)} exiting={FadeOut.duration(140)}>
            <GlassView glassEffectStyle="regular" style={styles.chip}>
              <SymbolView name="arrow.down.right.circle.fill" size={15} tintColor="#2E9E78" />
              <Text style={styles.chipText}>Into {ZONE_NAMES[target]}</Text>
            </GlassView>
          </Animated.View>
        ) : done ? (
          <Animated.View key="done" entering={FadeInDown.duration(420).easing(Easing.out(Easing.cubic))}>
            <GlassView glassEffectStyle="regular" style={styles.chip}>
              <SymbolView name="checkmark.circle.fill" size={15} tintColor="#2E9E78" />
              <Text style={styles.chipText}>All put away · fold the phone to close it</Text>
            </GlassView>
          </Animated.View>
        ) : (
          <Animated.View
            key="drag"
            entering={FadeInDown.duration(420).easing(Easing.out(Easing.cubic))}
            exiting={FadeOut.duration(160)}>
            <GlassView glassEffectStyle="regular" style={styles.chip}>
              <SymbolView name="hand.draw.fill" size={15} tintColor={DARK} />
              <Text style={styles.chipText}>
                Just bought · drag {remaining === 1 ? 'it' : `all ${remaining}`} into the fridge
              </Text>
            </GlassView>
          </Animated.View>
        )}
      </View>

      {/* What a tapped thing is */}
      {peek ? (
        <Animated.View
          key={peek.key}
          entering={FadeInDown.duration(320).easing(Easing.out(Easing.cubic))}
          exiting={FadeOutUp.duration(200)}
          pointerEvents="none"
          style={[styles.peekWrap, { top: insets.top + 58 }]}>
          <GlassView glassEffectStyle="regular" style={styles.peek}>
            <Text style={styles.peekTitle}>{peek.title}</Text>
            {peek.note ? <Text style={styles.peekNote}>{peek.note}</Text> : null}
          </GlassView>
        </Animated.View>
      ) : null}

      {open && done ? (
        <Animated.View
          entering={FadeInDown.delay(300).duration(420).easing(Easing.out(Easing.cubic))}
          style={[styles.more, { bottom: insets.bottom + 16 }]}>
          <Pressable
            onPress={() => router.replace({ pathname: '/demo/[id]', params: { id: 'sticker-cart' } })}
            accessibilityRole="button"
            accessibilityLabel="Buy more">
            <View style={styles.moreButton}>
              <SymbolView name="bag.fill" size={15} tintColor="#FFFFFF" />
              <Text style={styles.moreText}>Buy more</Text>
            </View>
          </Pressable>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#358C77',
  },
  cover: {
    backgroundColor: '#358C77',
  },
  top: {
    position: 'absolute',
    left: 70,
    right: 70,
    alignItems: 'center',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 40,
    paddingHorizontal: 16,
    borderRadius: 20,
  },
  chipText: {
    fontSize: 14,
    fontWeight: '600',
    color: DARK,
  },
  peekWrap: {
    position: 'absolute',
    alignSelf: 'center',
    maxWidth: 360,
  },
  peek: {
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 20,
    alignItems: 'center',
    backgroundColor: 'rgba(255,253,248,0.6)',
  },
  peekTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: DARK,
  },
  peekNote: {
    marginTop: 2,
    fontSize: 13,
    color: 'rgba(34,48,43,0.7)',
    textAlign: 'center',
  },
  more: {
    position: 'absolute',
    alignSelf: 'center',
  },
  moreButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 44,
    paddingHorizontal: 20,
    borderRadius: 22,
    backgroundColor: DARK,
  },
  moreText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
