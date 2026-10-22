import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFrameCallback, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const thousands = (n: number) => n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** Off for clean UI tests and recordings, a pill for the video, the full panel for digging in */
export type HudMode = 'off' | 'compact' | 'full';

type Reading = { ui: number; js: number; dropped: number; worst: number; rows: number };

/** Half-second readings kept for the graphs: 40 of them is the last 20 seconds */
const HISTORY = 40;

/**
 * The numbers behind the claim, live on screen: frames a second on the UI thread (where the list
 * scrolls and the player opens), frames a second on the JS thread, frames dropped since it
 * opened, and how many rows exist out of how many songs.
 *
 * The UI thread is counted by a Reanimated frame callback, which runs on it every frame; a frame
 * that takes over 1.6 times the usual time counts as dropped. The JS thread is counted with
 * requestAnimationFrame. It reads both twice a second, so it costs next to nothing to watch.
 * Tap it to switch between the pill and the full panel, hold it to hide it. Mount it only while it's
 * shown: hidden, nothing counts.
 */
export function PerfHud({
  mode,
  onModeChange,
  rows,
  total,
  shown,
}: {
  mode: Exclude<HudMode, 'off'>;
  onModeChange: (mode: HudMode) => void;
  rows: () => number;
  /** Songs in the library, and in the list right now */
  total: number;
  shown: number;
}) {
  const insets = useSafeAreaInsets();
  const uiFrames = useSharedValue(0);
  const dropped = useSharedValue(0);
  const worst = useSharedValue(0);
  const usual = useSharedValue(0);

  useFrameCallback((frame) => {
    'worklet';
    const dt = frame.timeSincePreviousFrame;
    if (dt == null || dt <= 0) return;
    uiFrames.set(uiFrames.get() + 1);
    if (dt > worst.get()) worst.set(dt);
    const typical = usual.get();
    if (typical === 0) usual.set(dt);
    else if (dt > typical * 1.6) dropped.set(dropped.get() + Math.round(dt / typical) - 1);
    else usual.set(typical * 0.95 + dt * 0.05);
  });

  const [reading, setReading] = useState<Reading>({ ui: 0, js: 0, dropped: 0, worst: 0, rows: 0 });
  const [history, setHistory] = useState<{ ui: number[]; js: number[] }>({ ui: [], js: [] });

  useEffect(() => {
    let jsFrames = 0;
    let raf = 0;
    const count = () => {
      jsFrames++;
      raf = requestAnimationFrame(count);
    };
    raf = requestAnimationFrame(count);

    uiFrames.set(0);
    let last = Date.now();
    const timer = setInterval(() => {
      const now = Date.now();
      const seconds = (now - last) / 1000;
      last = now;
      const ui = Math.round(uiFrames.get() / seconds);
      const js = Math.round(jsFrames / seconds);
      setReading({ ui, js, dropped: dropped.get(), worst: Math.round(worst.get()), rows: rows() });
      setHistory((h) => ({ ui: [...h.ui, ui].slice(-HISTORY), js: [...h.js, js].slice(-HISTORY) }));
      uiFrames.set(0);
      worst.set(0);
      jsFrames = 0;
    }, 500);

    return () => {
      cancelAnimationFrame(raf);
      clearInterval(timer);
    };
  }, [rows, uiFrames, dropped, worst]);

  const reset = () => {
    dropped.set(0);
    usual.set(0);
    setHistory({ ui: [], js: [] });
    setReading((r) => ({ ...r, dropped: 0 }));
  };

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { top: insets.top + 6 }]}>
      <Pressable
        onPress={() => onModeChange(mode === 'compact' ? 'full' : 'compact')}
        onLongPress={() => onModeChange('off')}
        accessibilityRole="button"
        accessibilityLabel="Performance meter"
        accessibilityHint="Tap for more detail, hold to hide">
        {mode === 'compact' ? (
          <View style={styles.pill}>
            <Text style={styles.text}>
              <Text style={{ color: tone(reading.ui) }}>●</Text>
              {` UI ${pad(reading.ui)}  `}
              <Text style={{ color: tone(reading.js) }}>●</Text>
              {` JS ${pad(reading.js)}  ·  ${reading.dropped} dropped  ·  ${reading.rows} rows / ${thousands(total)}`}
            </Text>
          </View>
        ) : (
          <View style={styles.panel}>
            <Section title="UI THREAD" note="scrolling, the player, every native frame">
              <Big value={reading.ui} unit="fps" />
              <Graph values={history.ui} />
            </Section>
            <Section title="JS THREAD" note="React: search, filters, the clock">
              <Big value={reading.js} unit="fps" />
              <Graph values={history.js} />
            </Section>
            <View style={styles.grid}>
              <Stat label="DROPPED" value={String(reading.dropped)} hint="since reset" />
              <Stat label="WORST FRAME" value={`${reading.worst} ms`} hint="last ½ s" />
              <Stat label="ROWS LIVE" value={String(reading.rows)} hint={`of ${thousands(shown)} shown`} />
              <Stat label="LIBRARY" value={thousands(total)} hint="songs" />
            </View>
            <View style={styles.actions}>
              <Pressable onPress={reset} hitSlop={8}>
                <Text style={styles.action}>Reset</Text>
              </Pressable>
              <Pressable onPress={() => onModeChange('off')} hitSlop={8}>
                <Text style={styles.action}>Hide</Text>
              </Pressable>
            </View>
          </View>
        )}
      </Pressable>
    </View>
  );
}

function Section({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.label}>
        {title} <Text style={styles.note}>{note}</Text>
      </Text>
      <View style={styles.row}>{children}</View>
    </View>
  );
}

function Big({ value, unit }: { value: number; unit: string }) {
  return (
    <Text style={[styles.big, { color: tone(value) }]}>
      {pad(value)}
      <Text style={styles.unit}> {unit}</Text>
    </Text>
  );
}

/** Bars for the last 20 seconds, scaled to 120 fps, coloured by how they did */
function Graph({ values }: { values: number[] }) {
  return (
    <View style={styles.graph}>
      {Array.from({ length: HISTORY }, (_, i) => {
        const v = values[i - (HISTORY - values.length)];
        return (
          <View
            key={i}
            style={[
              styles.bar,
              v == null
                ? styles.empty
                : { height: `${Math.max(4, Math.min(100, (v / 120) * 100))}%`, backgroundColor: tone(v) },
            ]}
          />
        );
      })}
    </View>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
      <Text style={styles.note}>{hint}</Text>
    </View>
  );
}

const tone = (fps: number) => (fps >= 55 ? '#34C759' : fps >= 40 ? '#FFCC00' : '#FF453A');

/** Fixed width, so the numbers don't twitch as they change */
const pad = (n: number) => String(n).padStart(3, ' ');

const MONO = 'Menlo';

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(12,12,16,0.82)',
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  text: {
    color: '#F2F2F7',
    fontSize: 11,
    fontFamily: MONO,
    fontVariant: ['tabular-nums'],
  },
  panel: {
    width: 300,
    padding: 14,
    gap: 12,
    borderRadius: 20,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(12,12,16,0.88)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  section: { gap: 4 },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 12 },
  label: { color: '#8E8E93', fontSize: 9, fontFamily: MONO, letterSpacing: 0.6 },
  note: { color: '#636366', fontSize: 9, fontFamily: MONO, letterSpacing: 0 },
  big: { fontSize: 26, fontFamily: MONO, fontWeight: '700', fontVariant: ['tabular-nums'] },
  unit: { fontSize: 11, color: '#8E8E93', fontWeight: '400' },
  graph: { flex: 1, height: 30, flexDirection: 'row', alignItems: 'flex-end', gap: 1.5 },
  bar: { flex: 1, borderRadius: 1 },
  empty: { height: 2, backgroundColor: 'rgba(255,255,255,0.08)' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 10 },
  stat: { width: '50%', gap: 1 },
  value: { color: '#F2F2F7', fontSize: 15, fontFamily: MONO, fontWeight: '600', fontVariant: ['tabular-nums'] },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 18 },
  action: { color: '#0A84FF', fontSize: 12, fontFamily: MONO },
});
