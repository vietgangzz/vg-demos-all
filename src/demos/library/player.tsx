import { Button, HStack, Host, Image, Rectangle, Slider, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import {
  font,
  foregroundStyle,
  frame,
  lineLimit,
  monospacedDigit,
  padding,
  tint,
  type ShapeStyle,
} from '@expo/ui/swift-ui/modifiers';
import { useHinge } from 'expo-hinge';
import { useEffect } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Presets } from 'react-native-pulsar';
import Animated, {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { Art, takesTitle } from './art';
import { playback, useElapsed, usePlayback } from './playback';
import { clock } from './songs';

/** Where a view sits in the window, in points */
export type Rect = { x: number; y: number; width: number; height: number };

const OPEN = { damping: 24, stiffness: 230, mass: 1 };
const CLOSE = { damping: 26, stiffness: 260, mass: 1 };

const mix = (a: number, b: number, t: number) => {
  'worklet';
  return a + (b - a) * t;
};

/**
 * The player, opened out of the mini player like Music's. It's one shared element: the cover in
 * the mini player grows into the big cover as the player opens, and when you drag the player down
 * it shrinks back with your finger into the mini player, exactly where it came from. Let go
 * early and it springs back open.
 *
 * Everything that moves runs on the UI thread: the drag is a Gesture Handler pan, the opening is
 * one Reanimated value `p` (0 shut, 1 open), and the cover, the backdrop and the controls are all
 * worked out from it. The pictures themselves are SwiftUI (Expo UI), carried along by the views
 * that move.
 */
export function Player({ open, from, onClosed }: { open: boolean; from: SharedValue<Rect>; onClosed: () => void }) {
  const { width: W, height: H } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { song, playing } = usePlayback();
  const t = useElapsed();
  const hinge = useHinge();
  const p = useSharedValue(0);
  const sink = useSharedValue(1);

  // The big cover: as wide as fits, under the grabber
  const S = Math.min(W - 56, H * 0.44, 380);
  const toX = (W - S) / 2;
  const toY = insets.top + 44;

  useEffect(() => {
    if (open) p.set(withSpring(1, OPEN));
  }, [open, p]);

  // Playing, the cover sits forward; paused, it sinks back, as on the Music app
  useEffect(() => {
    sink.set(withSpring(playing ? 1 : 0.82, { damping: 14, stiffness: 160 }));
  }, [playing, sink]);

  const close = (velocity = 0) => {
    'worklet';
    p.set(
      withSpring(0, { ...CLOSE, velocity }, (finished) => {
        if (finished) scheduleOnRN(onClosed);
      })
    );
  };

  const drag = Gesture.Pan()
    .activeOffsetY(12)
    .failOffsetX([-18, 18])
    .onUpdate((e) => {
      // Dragged most of the way down the screen, it's all the way back in the mini player
      p.set(Math.min(1, Math.max(0, 1 - Math.max(0, e.translationY) / (H * 0.65))));
    })
    .onEnd((e) => {
      if (e.translationY > 110 || e.velocityY > 800) close(-e.velocityY / (H * 0.65));
      else p.set(withSpring(1, OPEN));
    });

  const cover = useAnimatedStyle(() => {
    const r = from.get();
    const v = p.get();
    // Its centre and size travel from the mini player's cover to the big one; paused, it sinks
    // back around its own centre
    const size = mix(r.width, S, v) * mix(1, sink.get(), v);
    const scale = size / S;
    const cx = mix(r.x + r.width / 2, toX + S / 2, v);
    const cy = mix(r.y + r.height / 2, toY + S / 2, v);
    // The cover's corner, round in the mini player, rounded square in the player
    const corner = mix(r.width / 2, 24, v);
    return {
      borderRadius: corner / scale,
      transform: [{ translateX: cx - size / 2 }, { translateY: cy - size / 2 }, { scale }],
      shadowOpacity: 0.45 * v,
    };
  });

  // The clip inside carries the same corner, since the shadow outside can't be clipped
  const rounded = useAnimatedStyle(() => {
    const r = from.get();
    const v = p.get();
    const scale = (mix(r.width, S, v) * mix(1, sink.get(), v)) / S;
    return { borderRadius: mix(r.width / 2, 24, v) / scale };
  });

  const backdrop = useAnimatedStyle(() => ({ opacity: p.get() }));
  const controls = useAnimatedStyle(() => ({
    opacity: interpolate(p.get(), [0.6, 1], [0, 1], 'clamp'),
    transform: [{ translateY: (1 - p.get()) * 60 }],
  }));

  if (!song) return null;
  const [light, , deep] = song.album.colours;
  // Half open like a book, the cover leans with the hinge
  const lean = hinge && hinge.status === 'partiallyOpen' ? Math.min(28, (180 - hinge.angle) / 3) : 0;
  const white: ShapeStyle = '#FFFFFF';
  const dim: ShapeStyle = '#FFFFFFB3';

  return (
    <GestureDetector gesture={drag}>
      <View style={StyleSheet.absoluteFill} pointerEvents={open ? 'auto' : 'none'}>
        <Animated.View style={[StyleSheet.absoluteFill, backdrop]}>
          {/* The backdrop takes on the album's colours, and shifts with every song */}
          <Host style={StyleSheet.absoluteFill} ignoreSafeArea="all">
            <Rectangle
              modifiers={[
                foregroundStyle({
                  type: 'linearGradient',
                  colors: [deep, '#141019', '#08080C'],
                  startPoint: { x: 0.2, y: 0 },
                  endPoint: { x: 0.8, y: 1 },
                }),
              ]}
            />
          </Host>
          <View style={[styles.grabber, { top: insets.top + 8 }]} />
        </Animated.View>

        {/* The shared cover: in the mini player's place at 0, the big cover at 1 */}
        <Animated.View style={[styles.cover, { width: S, height: S, shadowColor: deep }, cover]}>
          <Animated.View
            style={[
              styles.clip,
              rounded,
              lean ? { transform: [{ perspective: 600 }, { rotateY: `${lean}deg` }] } : null,
            ]}>
            <Host style={{ width: S, height: S }}>
              <Art album={song.album} size={S} radius={0} />
            </Host>
            {takesTitle(song.album) ? (
              <Host style={[StyleSheet.absoluteFill, styles.caption]} alignment="bottomLeading">
                <VStack alignment="leading" spacing={2} modifiers={[padding({ all: S * 0.065 })]}>
                  <Text modifiers={[font({ size: S * 0.043, weight: 'semibold' }), foregroundStyle(light)]}>
                    {song.album.artist.toUpperCase()}
                  </Text>
                  <Text
                    modifiers={[font({ size: S * 0.087, weight: 'heavy', design: 'rounded' }), foregroundStyle(white)]}>
                    {song.album.title}
                  </Text>
                </VStack>
              </Host>
            ) : null}
          </Animated.View>
        </Animated.View>

        <Animated.View style={[styles.controls, { top: toY + S + 28, width: W - 56, left: 28 }, controls]}>
          <Host matchContents={{ vertical: true }} style={{ width: W - 56 }}>
            <VStack spacing={24}>
              <HStack>
                <VStack alignment="leading" spacing={3}>
                  <Text
                    modifiers={[font({ textStyle: 'title2', weight: 'bold' }), foregroundStyle(white), lineLimit(1)]}>
                    {song.title}
                  </Text>
                  <Text modifiers={[font({ textStyle: 'title3' }), foregroundStyle(dim), lineLimit(1)]}>
                    {song.album.artist}
                  </Text>
                </VStack>
                <Spacer />
                <Button label="Close" systemImage="chevron.down" onPress={() => close()} modifiers={[tint(white)]} />
              </HStack>

              <VStack spacing={6}>
                <Slider
                  value={t}
                  min={0}
                  max={song.seconds}
                  onValueChange={(v) => playback.seek(v)}
                  modifiers={[tint(white)]}
                />
                <HStack>
                  <Text
                    modifiers={[
                      font({ textStyle: 'caption', weight: 'medium' }),
                      monospacedDigit(),
                      foregroundStyle(dim),
                    ]}>
                    {clock(t)}
                  </Text>
                  <Spacer />
                  <Text
                    modifiers={[
                      font({ textStyle: 'caption', weight: 'medium' }),
                      monospacedDigit(),
                      foregroundStyle(dim),
                    ]}>
                    {`-${clock(song.seconds - t)}`}
                  </Text>
                </HStack>
              </VStack>

              <HStack spacing={52}>
                <Image
                  systemName="backward.fill"
                  size={30}
                  color="#FFFFFF"
                  onPress={() => {
                    Presets.System.impactLight();
                    playback.previous();
                  }}
                />
                <Image
                  systemName={playing ? 'pause.fill' : 'play.fill'}
                  size={46}
                  color="#FFFFFF"
                  modifiers={[frame({ width: 56, height: 56 })]}
                  onPress={() => {
                    Presets.System.impactMedium();
                    playback.toggle();
                  }}
                />
                <Image
                  systemName="forward.fill"
                  size={30}
                  color="#FFFFFF"
                  onPress={() => {
                    Presets.System.impactLight();
                    playback.next();
                  }}
                />
              </HStack>
            </VStack>
          </Host>
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  grabber: {
    position: 'absolute',
    alignSelf: 'center',
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  cover: {
    position: 'absolute',
    left: 0,
    top: 0,
    transformOrigin: 'left top',
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 20 },
  },
  clip: {
    flex: 1,
    overflow: 'hidden',
    borderCurve: 'continuous',
  },
  caption: {
    justifyContent: 'flex-end',
  },
  controls: {
    position: 'absolute',
  },
});
