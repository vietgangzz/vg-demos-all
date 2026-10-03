import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { LINE_1, STATIONS } from '@/demos/metro/line-1';

import { tr, useLang } from './i18n';
import { GREEN, INK, MUTED } from './theme';

const TRACK_W = 180;
const TRAIN_W = 34;
/** Stops drawn on the mini line: a few, evenly spaced, so it reads as a route not a ruler */
const STOPS = 6;

/**
 * Shown while the city is built and the first WebGPU frame compiles. Building blocks the JS
 * thread, so everything here animates on the UI thread and keeps moving through it.
 */
export function LoadingOverlay({ bottomInset }: { bottomInset: number }) {
  const t = tr(useLang());
  const run = useSharedValue(0);
  const pulse = useSharedValue(0);
  useEffect(() => {
    run.set(
      withRepeat(
        withSequence(
          withTiming(1, { duration: 1500, easing: Easing.inOut(Easing.cubic) }),
          withTiming(0, { duration: 1500, easing: Easing.inOut(Easing.cubic) })
        ),
        -1
      )
    );
    pulse.set(withRepeat(withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) }), -1, true));
  }, [run, pulse]);

  const train = useAnimatedStyle(() => ({
    transform: [{ translateX: run.get() * (TRACK_W - TRAIN_W) }],
  }));
  // The stretch of line the train has covered turns solid red behind it
  const done = useAnimatedStyle(() => ({
    width: TRAIN_W / 2 + run.get() * (TRACK_W - TRAIN_W),
  }));
  const subtitle = useAnimatedStyle(() => ({ opacity: 0.55 + pulse.get() * 0.45 }));

  return (
    <Animated.View exiting={FadeOut.duration(450)} style={[styles.overlay, { paddingBottom: bottomInset }]}>
      <View style={styles.card}>
        <View style={styles.track}>
          <View style={styles.trackBase} />
          <Animated.View style={[styles.trackDone, done]} />
          {Array.from({ length: STOPS }, (_, i) => (
            <View key={i} style={[styles.stop, { left: (i / (STOPS - 1)) * (TRACK_W - 8) }]} />
          ))}
          <Animated.View style={[styles.train, train]}>
            <View style={styles.window} />
            <View style={styles.window} />
            <View style={styles.window} />
          </Animated.View>
        </View>
        <Text style={styles.title}>{t.building}</Text>
        <Animated.Text style={[styles.subtitle, subtitle]}>
          {t.loadingSub(STATIONS.length, STATIONS[0].name, STATIONS[STATIONS.length - 1].name)}
        </Animated.Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E9F0F6',
  },
  card: {
    alignItems: 'center',
    gap: 6,
  },
  track: {
    width: TRACK_W,
    height: 14,
    justifyContent: 'center',
    marginBottom: 18,
  },
  trackBase: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(228, 37, 44, 0.18)',
  },
  trackDone: {
    position: 'absolute',
    left: 0,
    height: 4,
    borderRadius: 2,
    backgroundColor: LINE_1.color,
  },
  stop: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: LINE_1.color,
    backgroundColor: '#fff',
  },
  train: {
    position: 'absolute',
    left: 0,
    width: TRAIN_W,
    height: 14,
    borderRadius: 7,
    borderCurve: 'continuous',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    backgroundColor: GREEN,
    boxShadow: '0 3px 8px rgba(31, 163, 91, 0.45)',
  },
  window: {
    width: 6,
    height: 4,
    borderRadius: 1.5,
    backgroundColor: 'rgba(255, 255, 255, 0.85)',
  },
  title: {
    color: INK,
    fontSize: 17,
    fontWeight: 700,
  },
  subtitle: {
    color: MUTED,
    fontSize: 13,
  },
});
