import {
  Canvas,
  Group,
  LinearGradient,
  Points,
  Rect,
  rect,
  vec,
  type SkPoint,
} from 'react-native-skia';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Presets } from 'react-native-pulsar';
import Animated, {
  Easing,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LINE_1, STATIONS, toAscii } from '@/demos/metro/line-1';
import { useSound } from '@/hooks/use-sound';

import { CELL_W, GLYPH_H, textDots, textWidth } from './dot-font';

const COLS = 97; // 16 characters
const ROWS = 41;
const ROW_Y = [2, 12, 22, 32];
const TICK_MS = 2500; // one board minute
const HEADWAY = 8;
const AMBER = '#FFA51F';
const GREEN = '#46E07A';
const OFF = '#2A1C09';

const DESTINATIONS = [
  { board: toAscii(STATIONS[STATIONS.length - 1].name.replace('Bến xe ', '')), label: 'to Bến xe Suối Tiên' },
  { board: toAscii(STATIONS[0].name), label: 'to Bến Thành' },
];

const TICKER =
  'WELCOME TO HCMC METRO LINE 1 - PLEASE STAND BEHIND THE YELLOW LINE - LET PASSENGERS EXIT FIRST - THANK YOU -   ';

type Board = { clock: number; deps: [number, number]; arriving: number; train: number };

function tick(b: Board): Board {
  const clock = b.clock + 1;
  if (b.arriving > 0) {
    const arriving = b.arriving - 1;
    if (arriving === 0) {
      return { clock, deps: [b.deps[1], b.deps[1] + HEADWAY], arriving: 0, train: b.train + 1 };
    }
    return { ...b, clock, arriving };
  }
  const deps: [number, number] = [b.deps[0] - 1, b.deps[1] - 1];
  if (deps[0] <= 0) return { clock, deps: [0, deps[1]], arriving: 2, train: b.train };
  return { ...b, clock, deps };
}

export default function PlatformBoard() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [platform, setPlatform] = useState(0);
  const [board, setBoard] = useState<Board>({ clock: 8 * 60 + 42, deps: [3, 11], arriving: 0, train: 0 });
  const playTick = useSound(require('@/assets/sounds/board-tick.wav'));

  useEffect(() => {
    const id = setInterval(() => setBoard(tick), TICK_MS);
    return () => clearInterval(id);
  }, []);

  const isArriving = board.arriving > 0;
  useEffect(() => {
    if (isArriving) Presets.System.notificationWarning();
  }, [isArriving]);
  useEffect(() => {
    if (board.train > 0) {
      playTick();
      Presets.System.selection();
    }
  }, [board.train, playTick]);

  const switchPlatform = (p: number) => {
    if (p === platform) return;
    playTick();
    Presets.System.selection();
    setPlatform(p);
  };

  const panelW = width - 32;
  const innerW = panelW - 2 * 14 - 2 * 3; // padding + border
  const P = innerW / COLS;
  const dest = DESTINATIONS[platform].board;
  const hh = String(Math.floor(board.clock / 60) % 24).padStart(2, '0');
  const mm = String(board.clock % 60).padStart(2, '0');
  const wipeKey = `${platform}-${board.train}`;

  return (
    <View style={[styles.container, { paddingTop: insets.top + 56 }]}>
      <View style={styles.titleBlock}>
        <View style={styles.lineBadge}>
          <Text style={styles.lineBadgeText}>{LINE_1.number}</Text>
        </View>
        <View>
          <Text style={styles.title}>Thảo Điền Station</Text>
          <Text style={styles.subtitle}>
            Platform {platform + 1} · {DESTINATIONS[platform].label}
          </Text>
        </View>
      </View>

      <View style={[styles.bezel, { width: panelW }]}>
        <View style={[styles.bolt, { left: 5, top: 5 }]} />
        <View style={[styles.bolt, { right: 5, top: 5 }]} />
        <View style={[styles.bolt, { left: 5, bottom: 5 }]} />
        <View style={[styles.bolt, { right: 5, bottom: 5 }]} />
        <Canvas style={{ width: innerW, height: ROWS * P }}>
          <OffGrid P={P} />
          <BoardRow P={P} y={ROW_Y[0]} left="LINE 1" leftColor={GREEN} right={`${hh} ${mm}`} />
          <BlinkingColon P={P} y={ROW_Y[0]} col={COLS - textWidth('00:00') + 2 * CELL_W} />
          {isArriving ? (
            <BoardRow P={P} y={ROW_Y[1]} left="TRAIN ARRIVING" blink />
          ) : (
            <BoardRow P={P} y={ROW_Y[1]} left={dest} right={`${board.deps[0]} MIN`} wipeKey={wipeKey} />
          )}
          <BoardRow P={P} y={ROW_Y[2]} left={dest} right={`${board.deps[1]} MIN`} wipeKey={wipeKey} />
          <Ticker P={P} y={ROW_Y[3]} />
          <Rect x={0} y={0} width={innerW} height={ROWS * P}>
            <LinearGradient
              start={vec(0, 0)}
              end={vec(0, ROWS * P)}
              colors={['rgba(255,255,255,0.07)', 'rgba(255,255,255,0)', 'rgba(255,255,255,0.02)']}
              positions={[0, 0.45, 1]}
            />
          </Rect>
        </Canvas>
      </View>

      <View style={styles.segment}>
        {DESTINATIONS.map((d, i) => (
          <Pressable
            key={d.board}
            onPress={() => switchPlatform(i)}
            style={[styles.segmentItem, platform === i && styles.segmentActive]}>
            <Text style={[styles.segmentTitle, platform === i && { color: '#fff' }]}>Platform {i + 1}</Text>
            <Text style={styles.segmentSub}>{d.label}</Text>
          </Pressable>
        ))}
      </View>

      <Crowding train={board.train + platform * 5} />

      <Text style={[styles.footnote, { bottom: insets.bottom + 16 }]}>1 minute on the board = 2.5 seconds</Text>
    </View>
  );
}

function OffGrid({ P }: { P: number }) {
  const points = useMemo(() => {
    const pts: SkPoint[] = [];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) pts.push(vec((c + 0.5) * P, (r + 0.5) * P));
    return pts;
  }, [P]);
  return <Points points={points} mode="points" color={OFF} strokeWidth={P * 0.72} strokeCap="round" />;
}

function toPoints(dots: [number, number][], colOffset: number, y: number, P: number) {
  return dots.map(([c, r]) => vec((c + colOffset + 0.5) * P, (r + y + 0.5) * P));
}

function useRowPoints(left: string, right: string | undefined, y: number, P: number) {
  return useMemo(() => {
    const leftPts = toPoints(textDots(left), 0, y, P);
    const rightPts = right ? toPoints(textDots(right), COLS - textWidth(right), y, P) : [];
    return { leftPts, rightPts };
  }, [left, right, y, P]);
}

function BoardRow({
  P,
  y,
  left,
  right,
  leftColor = AMBER,
  wipeKey,
  blink,
}: {
  P: number;
  y: number;
  left: string;
  right?: string;
  leftColor?: string;
  wipeKey?: string;
  blink?: boolean;
}) {
  // Keep the outgoing text around so a new train / platform wipes in column by column
  const [snap, setSnap] = useState({ key: wipeKey, left, right, prevLeft: left, prevRight: right });
  if (snap.key !== wipeKey) {
    setSnap({ key: wipeKey, left, right, prevLeft: snap.left, prevRight: snap.right });
  } else if (snap.left !== left || snap.right !== right) {
    setSnap({ ...snap, left, right });
  }

  const current = useRowPoints(left, right, y, P);
  const previous = useRowPoints(snap.prevLeft, snap.prevRight, y, P);
  const reveal = useSharedValue(1);
  const blinkValue = useSharedValue(1);

  useEffect(() => {
    if (snap.key === undefined) return;
    reveal.set(0);
    reveal.set(withTiming(1, { duration: 650, easing: Easing.inOut(Easing.quad) }));
  }, [snap.key, reveal]);

  useEffect(() => {
    if (!blink) return;
    blinkValue.set(withRepeat(withSequence(withTiming(1, { duration: 0 }), withDelay(450, withTiming(0, { duration: 0 })), withDelay(300, withTiming(1, { duration: 0 }))), -1));
  }, [blink, blinkValue]);

  const top = y * P;
  const height = GLYPH_H * P;
  const width = COLS * P;
  const nextClip = useDerivedValue(() => rect(0, top, Math.floor(reveal.value * COLS) * P, height));
  const prevClip = useDerivedValue(() => {
    const x = Math.floor(reveal.value * COLS) * P;
    return rect(x, top, width - x, height);
  });
  const opacity = useDerivedValue(() => (blink ? blinkValue.value : 1));

  return (
    <Group opacity={opacity}>
      <Group clip={nextClip}>
        <Points points={current.leftPts} mode="points" color={leftColor} strokeWidth={P * 0.8} strokeCap="round" />
        <Points points={current.rightPts} mode="points" color={AMBER} strokeWidth={P * 0.8} strokeCap="round" />
      </Group>
      <Group clip={prevClip}>
        <Points points={previous.leftPts} mode="points" color={leftColor} strokeWidth={P * 0.8} strokeCap="round" />
        <Points points={previous.rightPts} mode="points" color={AMBER} strokeWidth={P * 0.8} strokeCap="round" />
      </Group>
    </Group>
  );
}

function BlinkingColon({ P, y, col }: { P: number; y: number; col: number }) {
  const points = useMemo(() => toPoints(textDots(':'), col, y, P), [col, y, P]);
  const on = useSharedValue(1);
  useEffect(() => {
    on.set(withRepeat(withSequence(withDelay(500, withTiming(0, { duration: 0 })), withDelay(500, withTiming(1, { duration: 0 }))), -1));
  }, [on]);
  return <Points points={points} mode="points" color={AMBER} strokeWidth={P * 0.8} strokeCap="round" opacity={on} />;
}

function Ticker({ P, y }: { P: number; y: number }) {
  const loopCols = TICKER.length * CELL_W;
  const points = useMemo(() => {
    const dots = textDots(TICKER);
    return [...toPoints(dots, 0, y, P), ...toPoints(dots, loopCols, y, P)];
  }, [P, y, loopCols]);
  const offset = useSharedValue(0);

  useEffect(() => {
    offset.set(withRepeat(withTiming(loopCols, { duration: loopCols * 45, easing: Easing.linear }), -1, false));
  }, [offset, loopCols]);

  // Snap to whole columns so the text steps like a real LED board instead of gliding
  const transform = useDerivedValue(() => [{ translateX: -Math.floor(offset.value) * P }]);

  return (
    <Group clip={rect(0, y * P, COLS * P, GLYPH_H * P)}>
      <Group transform={transform}>
        <Points points={points} mode="points" color={AMBER} strokeWidth={P * 0.8} strokeCap="round" />
      </Group>
    </Group>
  );
}

function Crowding({ train }: { train: number }) {
  const loads = Array.from({ length: 6 }, (_, i) => 0.18 + (((train * 7 + i * 13 + 3) % 10) / 10) * 0.8);
  const best = loads.indexOf(Math.min(...loads));

  return (
    <View style={styles.crowding}>
      <View style={styles.crowdingHeader}>
        <Text style={styles.crowdingTitle}>Next train · 6 cars</Text>
        <Text style={styles.crowdingHint}>Car {best + 1} has the most space</Text>
      </View>
      <View style={styles.cars}>
        {loads.map((load, i) => (
          <Car key={i} index={i} load={load} best={i === best} />
        ))}
      </View>
    </View>
  );
}

function Car({ index, load, best }: { index: number; load: number; best: boolean }) {
  const level = useSharedValue(0);
  useEffect(() => {
    level.set(withDelay(index * 70, withSpring(load, { damping: 14, stiffness: 120 })));
  }, [load, index, level]);

  const color = load < 0.45 ? GREEN : load < 0.75 ? AMBER : '#FF5A4E';
  const fillStyle = useAnimatedStyle(() => ({ height: `${level.value * 100}%` }));

  return (
    <View style={styles.car}>
      <View style={[styles.carBody, best && { borderColor: GREEN }]}>
        <Animated.View style={[styles.carFill, { backgroundColor: color }, fillStyle]} />
      </View>
      <Text style={[styles.carLabel, best && { color: GREEN }]}>{index + 1}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B0C0E',
    alignItems: 'center',
  },
  titleBlock: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  lineBadge: {
    width: 40,
    height: 40,
    borderRadius: 10,
    borderCurve: 'continuous',
    backgroundColor: LINE_1.color,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lineBadgeText: {
    color: '#fff',
    fontSize: 22,
    fontWeight: 800,
  },
  title: {
    color: '#F4F5F7',
    fontSize: 22,
    fontWeight: 700,
  },
  subtitle: {
    color: '#8C929A',
    fontSize: 13,
    marginTop: 1,
  },
  bezel: {
    padding: 14,
    borderRadius: 14,
    borderCurve: 'continuous',
    backgroundColor: '#050505',
    borderWidth: 3,
    borderColor: '#2B2E33',
    boxShadow: '0 10px 30px rgba(0,0,0,0.6), inset 0 0 0 1px #000',
  },
  bolt: {
    position: 'absolute',
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#3A3E44',
  },
  segment: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 20,
  },
  segmentItem: {
    flex: 1,
    padding: 12,
    borderRadius: 14,
    borderCurve: 'continuous',
    backgroundColor: '#16181C',
    borderWidth: 1,
    borderColor: '#23262B',
  },
  segmentActive: {
    borderColor: AMBER,
    backgroundColor: '#1D1910',
  },
  segmentTitle: {
    color: '#B7BCC3',
    fontSize: 15,
    fontWeight: 700,
  },
  segmentSub: {
    color: '#7A8088',
    fontSize: 12,
    marginTop: 2,
  },
  crowding: {
    alignSelf: 'stretch',
    marginHorizontal: 16,
    marginTop: 12,
    padding: 16,
    borderRadius: 16,
    borderCurve: 'continuous',
    backgroundColor: '#16181C',
    borderWidth: 1,
    borderColor: '#23262B',
  },
  crowdingHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  crowdingTitle: {
    color: '#E8EAED',
    fontSize: 14,
    fontWeight: 700,
  },
  crowdingHint: {
    color: '#8C929A',
    fontSize: 12,
  },
  cars: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 14,
  },
  car: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
  },
  carBody: {
    alignSelf: 'stretch',
    height: 56,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: '#2E3238',
    overflow: 'hidden',
    justifyContent: 'flex-end',
    padding: 3,
  },
  carFill: {
    borderRadius: 4,
  },
  carLabel: {
    color: '#7A8088',
    fontSize: 12,
    fontWeight: 700,
  },
  footnote: {
    position: 'absolute',
    color: '#4E535A',
    fontSize: 12,
  },
});
