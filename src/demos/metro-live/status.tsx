import { useSyncExternalStore } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { NumericText } from '@/components/numeric-text';
import { STATIONS } from '@/demos/metro/line-1';

import { type TrainState } from './line-model';
import { TRAIN_COUNT, YOUR_TRAIN, type LiveScene } from './scene';
import { BLUE, GREEN, INK, MUTED, SPRING } from './theme';

export type Row = {
  train: number;
  status: string;
  statusColor: string;
  title: string;
  subtitle: string;
  etaLabel: string;
};

export function describe(k: number, s: TrainState): Row {
  const toward = s.dir === 1 ? 'Suối Tiên' : 'Bến Thành';
  const mine = k === YOUR_TRAIN;
  const station = STATIONS[s.station].name;
  let status: string;
  let statusColor = MUTED;
  let subtitle: string;
  let etaLabel: string;
  if (s.phase === 'dwell') {
    status = s.progress > 0.78 ? 'Doors closing' : 'Boarding';
    statusColor = s.progress > 0.78 ? '#E08A00' : MUTED;
    subtitle = `At ${station}`;
    etaLabel = 'departs';
  } else {
    status = s.progress > 0.7 ? 'Arriving' : 'Departed';
    if (s.progress > 0.7) statusColor = BLUE;
    subtitle = `Next: ${station}`;
    etaLabel = 'arrives';
  }
  if (mine) {
    status = `Your train · ${status}`;
    statusColor = GREEN;
  }
  return {
    train: k,
    status,
    statusColor,
    title: `Train ${String(k + 1).padStart(2, '0')} · to ${toward}`,
    subtitle,
    etaLabel,
  };
}

/**
 * One shared 4 Hz clock. Every subscriber updates from the same tick, so React batches them
 * into a single commit, and the 3D screen component itself never re-renders.
 */
export const lineClock = (() => {
  let now = performance.now() / 1000;
  let timer: ReturnType<typeof setInterval> | null = null;
  const listeners = new Set<() => void>();
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      timer ??= setInterval(() => {
        now = performance.now() / 1000;
        listeners.forEach((l) => l());
      }, 250);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && timer) {
          clearInterval(timer);
          timer = null;
        }
      };
    },
    get: () => now,
  };
})();

/** Re-render only when `select` returns a different string, however often the clock ticks */
export function useLineKey(select: (now: number) => string) {
  return useSyncExternalStore(lineClock.subscribe, () => select(lineClock.get()));
}

export function StatusRows({
  scene,
  follow,
  onPress,
  only = 'all',
}: {
  scene: LiveScene;
  follow: number | null;
  onPress: (k: number) => void;
  /** Split your train from the rest, e.g. to pin it in a collapsed sheet */
  only?: 'all' | 'mine' | 'others';
}) {
  // Rows only change when a status changes; the countdowns tick on the UI thread
  const key = useLineKey((now) =>
    Array.from({ length: TRAIN_COUNT }, (_, k) => {
      const r = describe(k, scene.timetable.stateAt(now, k));
      return `${r.status}|${r.subtitle}|${r.etaLabel}`;
    }).join('#')
  );
  const rows = key.split('#').map((part, k) => {
    const [status, subtitle, etaLabel] = part.split('|');
    const base = describe(k, scene.timetable.stateAt(lineClock.get(), k));
    return { ...base, status, subtitle, etaLabel };
  });
  rows.sort((a, b) => (a.train === YOUR_TRAIN ? -1 : b.train === YOUR_TRAIN ? 1 : a.train - b.train));
  const shown = rows.filter((r) => only === 'all' || (only === 'mine') === (r.train === YOUR_TRAIN));
  return (
    <>
      {shown.map((row) => (
        <TrainRow
          key={row.train}
          row={row}
          scene={scene}
          active={follow === row.train}
          onPress={() => onPress(row.train)}
        />
      ))}
    </>
  );
}

export function TrainRow({
  row,
  scene,
  active,
  onPress,
}: {
  row: Row;
  scene: LiveScene;
  active: boolean;
  onPress: () => void;
}) {
  const mine = row.train === YOUR_TRAIN;
  const pressed = useSharedValue(0);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: 1 - pressed.get() * 0.025 }] }));
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => pressed.set(withTiming(1, { duration: 90 }))}
      onPressOut={() => pressed.set(withSpring(0, SPRING))}>
      <Animated.View style={[styles.row, active && { backgroundColor: '#F4F6F9' }, style]}>
        <View style={[styles.trainBadge, mine && { backgroundColor: '#E6F6EC' }]}>
          <Text style={[styles.trainBadgeLabel, mine && { color: GREEN }]}>TRAIN</Text>
          <Text style={[styles.trainBadgeNumber, mine && { color: GREEN }]}>
            {String(row.train + 1).padStart(2, '0')}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <View style={styles.statusSlot}>
            <Animated.Text
              key={row.status}
              entering={FadeIn.duration(220)}
              exiting={FadeOut.duration(120)}
              style={[styles.status, { color: row.statusColor }]}>
              {row.status}
            </Animated.Text>
          </View>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {row.title}
          </Text>
          <Text style={styles.rowSub}>{row.subtitle}</Text>
        </View>
        <View style={styles.etaBox}>
          <Countdown scene={scene} index={row.train} fontSize={17} color={mine ? GREEN : INK} />
          <Text style={styles.etaLabel}>{row.etaLabel}</Text>
        </View>
        <Text style={styles.chevron}>›</Text>
      </Animated.View>
    </Pressable>
  );
}

export function useCountdown(scene: LiveScene, index: number) {
  return useLineKey((now) => {
    const total = Math.max(0, Math.ceil(scene.timetable.stateAt(now, index).remaining));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  });
}

/** "m:ss" countdown. Re-renders once a second; SwiftUI rolls the changed digits. */
export function Countdown({
  scene,
  index,
  fontSize,
  color,
}: {
  scene: LiveScene;
  index: number;
  fontSize: number;
  color: string;
}) {
  const value = useCountdown(scene, index);
  return <NumericText value={value} fontSize={fontSize} color={color} countsDown />;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 6,
    borderRadius: 14,
    borderCurve: 'continuous',
  },
  trainBadge: {
    width: 48,
    height: 48,
    borderRadius: 12,
    borderCurve: 'continuous',
    backgroundColor: '#F2F4F7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  trainBadgeLabel: {
    color: MUTED,
    fontSize: 8,
    fontWeight: 800,
    letterSpacing: 0.8,
  },
  trainBadgeNumber: {
    color: INK,
    fontSize: 21,
    fontWeight: 800,
    letterSpacing: -0.3,
    fontVariant: ['tabular-nums'],
  },
  statusSlot: {
    height: 15,
  },
  status: {
    position: 'absolute',
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  rowTitle: {
    color: INK,
    fontSize: 16,
    fontWeight: 600,
    marginTop: 2,
  },
  rowSub: {
    color: MUTED,
    fontSize: 13,
    marginTop: 1,
  },
  etaBox: {
    alignItems: 'flex-end',
    minWidth: 52,
  },
  etaLabel: {
    color: MUTED,
    fontSize: 11,
    marginTop: -2,
  },
  chevron: {
    color: '#B5BBC4',
    fontSize: 20,
  },
});
