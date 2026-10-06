import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector, type GestureType } from 'react-native-gesture-handler';
import { Presets } from 'react-native-pulsar';
import { useDerivedValue, useSharedValue, withSpring, withTiming, type SharedValue } from 'react-native-reanimated';
import { Canvas, Circle, Group, Line, LinearGradient, Path, RoundedRect, Skia, vec } from 'react-native-skia';
import { scheduleOnRN } from 'react-native-worklets';

/**
 * Time scrubbers drawn with Skia: the detail pages' chart and the main page's hour bar. The
 * marker follows the finger continuously on the UI thread; the screen only hears about it when
 * the nearest step changes, and on release the marker settles onto that step.
 */

const SNAP = { damping: 22, stiffness: 260, mass: 0.6 };

/** A scrub gesture over `n` steps laid across `width` points; `pos` is the fractional step */
function useScrub(n: number, index: number, width: number, onScrub: (i: number) => void, pager: GestureType) {
  const pos = useSharedValue(index);
  const reported = useSharedValue(index);
  const dragging = useSharedValue(false);

  // Follow the selection when it changes elsewhere (another page, a new city, day ↔ week)
  useEffect(() => {
    if (dragging.get()) return;
    reported.set(index);
    pos.set(withTiming(index, { duration: 260 }));
  }, [index, n, pos, reported, dragging]);

  const report = (i: number) => {
    Presets.System.selection();
    onScrub(i);
  };
  const scrubAt = (px: number) => {
    'worklet';
    if (width <= 0 || n < 1) return;
    const f = Math.min(1, Math.max(0, px / width)) * (n - 1);
    pos.set(f);
    const i = Math.round(f);
    if (i !== reported.get()) {
      reported.set(i);
      scheduleOnRN(report, i);
    }
  };
  const gesture = Gesture.Pan()
    .minDistance(0)
    .onBegin((e) => {
      dragging.set(true);
      scrubAt(e.x);
    })
    .onUpdate((e) => scrubAt(e.x))
    .onFinalize(() => {
      dragging.set(false);
      pos.set(withSpring(reported.get(), SNAP));
    })
    .blocksExternalGesture(pager);
  return { gesture, pos };
}

const HEIGHT = 84;
const PAD_Y = 10;
const TRACK = 16;

type ChartProps = {
  values: number[];
  index: number;
  onScrub: (index: number) => void;
  color: string;
  ink: string;
  /** Axis labels, one per value; a few are shown */
  labels: string[];
  kind?: 'line' | 'bars';
  floor?: number;
  ceil?: number;
  /** The page swipe: it waits while the chart is being scrubbed */
  pager: GestureType;
  mono: string;
};

/** A detail page's chart with a slider track beneath it */
export function HourChart({
  values,
  index,
  onScrub,
  color,
  ink,
  labels,
  kind = 'line',
  floor,
  ceil,
  pager,
  mono,
}: ChartProps) {
  const [width, setWidth] = useState(0);
  const n = values.length;
  const lo = floor ?? Math.min(...values);
  const hi = Math.max(ceil ?? -Infinity, ...values, lo + 1);
  const x = (i: number) => (n <= 1 ? 0 : (i / (n - 1)) * width);
  const y = (v: number) => PAD_Y + (1 - (v - lo) / (hi - lo)) * (HEIGHT - PAD_Y * 2);
  const { gesture, pos } = useScrub(n, index, width, onScrub, pager);

  let line = null;
  let area = null;
  if (width > 0 && kind === 'line' && n > 1) {
    // Catmull-Rom through the steps, as cubic Béziers
    const b = Skia.PathBuilder.Make().moveTo(x(0), y(values[0]));
    for (let i = 0; i < n - 1; i++) {
      const p0 = Math.max(0, i - 1);
      const p3 = Math.min(n - 1, i + 2);
      b.cubicTo(
        x(i) + (x(i + 1) - x(p0)) / 6,
        y(values[i]) + (y(values[i + 1]) - y(values[p0])) / 6,
        x(i + 1) - (x(p3) - x(i)) / 6,
        y(values[i + 1]) - (y(values[p3]) - y(values[i])) / 6,
        x(i + 1),
        y(values[i + 1])
      );
    }
    line = b.build();
    area = b
      .lineTo(x(n - 1), HEIGHT)
      .lineTo(0, HEIGHT)
      .close()
      .detach();
  }
  const barW = width > 0 ? Math.max(3, Math.min(18, width / n - 4)) : 0;
  const mx = useDerivedValue(() => (n <= 1 ? 0 : (pos.get() / (n - 1)) * width));
  const top = useDerivedValue(() => vec(mx.get(), 2));
  const bottom = useDerivedValue(() => vec(mx.get(), HEIGHT - 2));
  // The line's height between steps, for the dot riding it
  const my = useDerivedValue(() => {
    if (n < 2) return HEIGHT / 2;
    const f = Math.min(n - 1, Math.max(0, pos.get()));
    const i = Math.min(n - 2, Math.floor(f));
    const v = values[i] + (values[i + 1] - values[i]) * (f - i);
    return PAD_Y + (1 - (v - lo) / (hi - lo)) * (HEIGHT - PAD_Y * 2);
  });
  const shown = n > 8 ? [0, 6, 12, 18, n - 1] : values.map((_, i) => i);

  return (
    <View>
      <GestureDetector gesture={gesture}>
        <View style={{ height: HEIGHT + TRACK }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
          {width > 0 ? (
            <Canvas style={StyleSheet.absoluteFill}>
              {area ? (
                <Path path={area}>
                  <LinearGradient start={vec(0, 0)} end={vec(0, HEIGHT)} colors={[`${color}55`, `${color}00`]} />
                </Path>
              ) : null}
              {line ? <Path path={line} style="stroke" strokeWidth={2.5} color={color} strokeCap="round" /> : null}
              {kind === 'bars'
                ? values.map((v, i) => {
                    const t = y(v);
                    return (
                      <RoundedRect
                        key={i}
                        x={x(i) - barW / 2}
                        y={Math.min(t, HEIGHT - PAD_Y - 2)}
                        width={barW}
                        height={Math.max(2, HEIGHT - PAD_Y - t)}
                        r={Math.min(4, barW / 2)}
                        color={i === index ? color : `${color}88`}
                      />
                    );
                  })
                : null}
              <Line p1={top} p2={bottom} color={ink} strokeWidth={1} opacity={0.3} />
              {kind === 'line' ? (
                <>
                  <Circle cx={mx} cy={my} r={7} color={color} opacity={0.25} />
                  <Circle cx={mx} cy={my} r={4.5} color={color} />
                </>
              ) : null}
              {/* The slider: a hairline track with a knob, like a scrubber */}
              <Line
                p1={vec(0, HEIGHT + TRACK / 2)}
                p2={vec(width, HEIGHT + TRACK / 2)}
                color={ink}
                strokeWidth={1.5}
                opacity={0.25}
              />
              <Knob x={mx} y={HEIGHT + TRACK / 2} ink={ink} />
            </Canvas>
          ) : null}
        </View>
      </GestureDetector>
      <View style={styles.labels}>
        {shown.map((i) => (
          <Text key={i} style={[styles.label, { color: ink, fontFamily: mono }]}>
            {labels[i] ?? ''}
          </Text>
        ))}
      </View>
    </View>
  );
}

function Knob({ x, y, ink }: { x: SharedValue<number>; y: number; ink: string }) {
  return (
    <>
      <Circle cx={x} cy={y} r={7} color={ink} />
      <Circle cx={x} cy={y} r={3} color={ink === '#FFFFFF' ? '#14181F' : '#FFFFFF'} />
    </>
  );
}

const BAR_H = 34;

/**
 * The main page's 24-hour bar: one rounded capsule, a colour per hour (sun, cloud, rain, night),
 * the day's low and high written where they fall, and a knob riding it.
 */
export function HourBar({
  colors,
  index,
  onScrub,
  marks,
  labels,
  ink,
  pager,
  mono,
  onLabelsPress,
}: {
  /** One colour per hour */
  colors: string[];
  index: number;
  onScrub: (index: number) => void;
  /** Text written inside the bar at a step (the low and the high) */
  marks: { at: number; text: string }[];
  labels: string[];
  ink: string;
  pager: GestureType;
  mono: string;
  /** Tapping the hour labels (opens the week) */
  onLabelsPress?: () => void;
}) {
  const [width, setWidth] = useState(0);
  const n = colors.length;
  const { gesture, pos } = useScrub(n, index, width, onScrub, pager);
  const seg = n > 0 ? width / n : 0;
  const knobX = useDerivedValue(() => (n <= 1 ? 0 : seg / 2 + (pos.get() / (n - 1)) * (width - seg)));
  const clip = Skia.RRectXY(Skia.XYWHRect(0, 0, width, BAR_H), BAR_H / 2, BAR_H / 2);

  return (
    <View>
      <GestureDetector gesture={gesture}>
        <View style={{ height: BAR_H }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
          {width > 0 ? (
            <Canvas style={StyleSheet.absoluteFill}>
              {/* Hour segments clipped to the capsule */}
              <Group clip={clip}>
                {colors.map((c, i) => (
                  <RoundedRect key={i} x={i * seg - 0.5} y={0} width={seg + 1} height={BAR_H} r={0} color={c} />
                ))}
              </Group>
              <Knob x={knobX} y={BAR_H / 2} ink="#FFFFFF" />
            </Canvas>
          ) : null}
          {width > 0
            ? marks.map((m) => (
                <Text
                  key={m.at}
                  pointerEvents="none"
                  style={[
                    styles.mark,
                    { left: Math.min(width - 40, Math.max(12, m.at * seg + seg / 2 - 16)), fontFamily: mono },
                  ]}>
                  {m.text}
                </Text>
              ))
            : null}
        </View>
      </GestureDetector>
      <Pressable style={styles.barLabels} hitSlop={10} onPress={onLabelsPress}>
        {labels.map((l, i) => (
          <Text key={i} style={[styles.barLabel, { color: ink, fontFamily: mono }]}>
            {l}
          </Text>
        ))}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  labels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  label: {
    fontSize: 12,
    letterSpacing: 0.4,
    opacity: 0.85,
  },
  mark: {
    position: 'absolute',
    top: 6,
    fontSize: 16,
    color: '#FFFFFF',
    letterSpacing: -0.6,
  },
  barLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    marginTop: 8,
  },
  barLabel: {
    fontSize: 11,
    opacity: 0.8,
  },
});
