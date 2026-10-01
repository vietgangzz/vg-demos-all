import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Presets } from 'react-native-pulsar';
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  FadeOut,
  FadeOutUp,
  scrollTo,
  useAnimatedReaction,
  useAnimatedRef,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { LINE_1, STATIONS, type Station } from '@/demos/metro/line-1';
import { useSound } from '@/hooks/use-sound';

const ROW_H = 60;
const TRAVEL_MS = 6000;
const DWELL_MS = 4200;
const CLOSING_MS = 1800;
const LAST = STATIONS.length - 1;
const START_MINUTES = 8 * 60 + 40;

type Phase = 'dwell' | 'closing' | 'moving' | 'terminus';

const C = {
  bg: '#0A0B0D',
  panel: '#15171B',
  text: '#F4F5F7',
  dim: '#5E636B',
  muted: '#9AA0A8',
  rail: '#2A2D33',
};

export default function OnboardDisplay() {
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>('dwell');
  const [arriving, setArriving] = useState(false);
  const pos = useSharedValue(0);
  const playChime = useSound(require('@/assets/sounds/door-chime.wav'));

  const arrive = () => {
    setIndex((i) => i + 1);
    setArriving(false);
    setPhase('dwell');
    Presets.System.notificationSuccess();
  };

  useEffect(() => {
    if (phase === 'dwell') {
      const timer = setTimeout(() => {
        if (index === LAST) {
          setPhase('terminus');
          return;
        }
        setPhase('closing');
        playChime();
        Presets.chime();
      }, DWELL_MS);
      return () => clearTimeout(timer);
    }
    if (phase === 'closing') {
      const timer = setTimeout(() => {
        setPhase('moving');
        Presets.ramp();
      }, CLOSING_MS);
      return () => clearTimeout(timer);
    }
    if (phase === 'moving') {
      pos.set(
        withTiming(index + 1, { duration: TRAVEL_MS, easing: Easing.inOut(Easing.cubic) }, (done) => {
          if (done) scheduleOnRN(arrive);
        })
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, index]);

  // Flip to "Arriving" for the last stretch of each segment
  useAnimatedReaction(
    () => pos.value - Math.floor(pos.value) > 0.78,
    (near, wasNear) => {
      if (near && !wasNear) {
        scheduleOnRN(setArriving, true);
        Presets.System.impactLight();
      }
    }
  );

  const rideAgain = () => {
    Presets.System.impactMedium();
    pos.set(
      withTiming(0, { duration: 1400, easing: Easing.inOut(Easing.quad) }, (done) => {
        if (done) scheduleOnRN(setPhase, 'dwell');
      })
    );
    setIndex(0);
  };

  const shownIndex = phase === 'moving' ? Math.min(index + 1, LAST) : index;
  const station = STATIONS[shownIndex];
  const label =
    phase === 'terminus'
      ? 'Terminus'
      : phase === 'closing'
        ? 'Doors closing'
        : phase === 'dwell'
          ? 'Now at'
          : arriving
            ? 'Arriving at'
            : 'Next stop';
  const doorsOpen = phase === 'dwell' || phase === 'terminus';
  const showDoors = phase !== 'moving' || arriving;

  return (
    <View style={[styles.container, { paddingTop: insets.top + 12 }]}>
      <Header minutes={START_MINUTES + STATIONS[index].minutes} />

      <View style={styles.hero}>
        <View style={styles.labelSlot}>
          <Animated.Text
            key={label}
            entering={FadeIn.duration(300)}
            exiting={FadeOut.duration(150)}
            style={[styles.label, phase === 'closing' && { color: '#FFB020' }]}>
            {label}
          </Animated.Text>
        </View>

        <View style={styles.nameSlot}>
          <Animated.View
            key={station.code}
            entering={FadeInDown.duration(520).easing(Easing.out(Easing.cubic))}
            exiting={FadeOutUp.duration(220)}
            style={styles.nameInner}>
            <StationBadge code={station.code} size={44} />
            <View style={{ flex: 1 }}>
              <Text style={styles.name} numberOfLines={1} adjustsFontSizeToFit>
                {station.name}
              </Text>
              <Text style={styles.english}>{station.english ?? `Station ${station.code}`}</Text>
            </View>
          </Animated.View>
        </View>

        <View style={styles.infoRow}>
          {showDoors ? (
            <Animated.View entering={FadeIn} exiting={FadeOut} style={styles.infoRow}>
              <DoorIcon open={doorsOpen} side={station.doorSide} />
              <Text style={styles.info}>
                {phase === 'closing' ? 'Please stand clear' : `Doors open on the ${station.doorSide}`}
              </Text>
            </Animated.View>
          ) : (
            <Animated.Text entering={FadeIn} exiting={FadeOut} style={styles.info}>
              {station.minutes - STATIONS[index].minutes} min · {station.underground ? 'Underground' : 'Elevated'} station
            </Animated.Text>
          )}
        </View>
      </View>

      <Route pos={pos} index={shownIndex} currentMinutes={STATIONS[index].minutes} />

      {phase === 'terminus' ? (
        <Animated.View
          entering={FadeInDown}
          exiting={FadeOut}
          style={[styles.terminus, { paddingBottom: insets.bottom + 16 }]}>
          <Text style={styles.terminusText}>Thank you for riding Line 1</Text>
          <Pressable onPress={rideAgain} style={styles.terminusButton}>
            <Text style={styles.terminusButtonText}>Ride again</Text>
          </Pressable>
        </Animated.View>
      ) : null}
    </View>
  );
}

function Header({ minutes }: { minutes: number }) {
  const blink = useSharedValue(1);
  useEffect(() => {
    blink.set(withRepeat(withSequence(withTiming(1, { duration: 500 }), withTiming(0.15, { duration: 500 })), -1));
  }, [blink]);
  const colonStyle = useAnimatedStyle(() => ({ opacity: blink.value }));

  const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');

  return (
    <View style={styles.header}>
      <View style={styles.lineBadge}>
        <Text style={styles.lineBadgeText}>{LINE_1.number}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.headerTitle}>{LINE_1.name} · For Bến xe Suối Tiên</Text>
        <View style={styles.clock}>
          <Text style={styles.clockText}>{hh}</Text>
          <Animated.Text style={[styles.clockText, colonStyle]}>:</Animated.Text>
          <Text style={styles.clockText}>{mm}</Text>
          <Text style={styles.clockMeta}> · 6 cars · Car 3</Text>
        </View>
      </View>
    </View>
  );
}

function StationBadge({ code, size }: { code: string; size: number }) {
  return (
    <View style={[styles.badge, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[styles.badgeLine, { fontSize: size * 0.22 }]}>L{LINE_1.number}</Text>
      <Text style={[styles.badgeCode, { fontSize: size * 0.36 }]}>{code}</Text>
    </View>
  );
}

function DoorIcon({ open, side }: { open: boolean; side: Station['doorSide'] }) {
  const progress = useSharedValue(open ? 1 : 0);
  const blink = useSharedValue(1);

  useEffect(() => {
    progress.set(withTiming(open ? 1 : 0, { duration: open ? 700 : 1200, easing: Easing.inOut(Easing.cubic) }));
  }, [open, progress]);
  useEffect(() => {
    blink.set(withRepeat(withSequence(withTiming(0.2, { duration: 420 }), withTiming(1, { duration: 420 })), -1));
  }, [blink]);

  const leftPanel = useAnimatedStyle(() => ({ transform: [{ translateX: -progress.value * 9 }] }));
  const rightPanel = useAnimatedStyle(() => ({ transform: [{ translateX: progress.value * 9 }] }));
  const arrowStyle = useAnimatedStyle(() => ({ opacity: blink.value }));

  const arrow = <Animated.Text style={[styles.doorArrow, arrowStyle]}>{side === 'left' ? '‹‹' : '››'}</Animated.Text>;

  return (
    <View style={styles.doorWrap}>
      {side === 'left' ? arrow : null}
      <View style={styles.doorFrame}>
        <Animated.View style={[styles.doorPanel, { left: 2 }, leftPanel]} />
        <Animated.View style={[styles.doorPanel, { right: 2 }, rightPanel]} />
      </View>
      {side === 'right' ? arrow : null}
    </View>
  );
}

function Route({
  pos,
  index,
  currentMinutes,
}: {
  pos: SharedValue<number>;
  index: number;
  currentMinutes: number;
}) {
  const scrollRef = useAnimatedRef<Animated.ScrollView>();

  useAnimatedReaction(
    () => pos.value,
    (p) => {
      scrollTo(scrollRef, 0, Math.max(0, p * ROW_H - ROW_H * 1.2), false);
    }
  );

  const fillStyle = useAnimatedStyle(() => ({ height: pos.value * ROW_H }));
  const trainStyle = useAnimatedStyle(() => ({ transform: [{ translateY: pos.value * ROW_H }] }));

  return (
    <View style={styles.routePanel}>
      <Animated.ScrollView ref={scrollRef} scrollEnabled={false} showsVerticalScrollIndicator={false}>
        <View style={{ height: STATIONS.length * ROW_H + ROW_H * 4 }}>
          <View style={[styles.rail, { height: (STATIONS.length - 1) * ROW_H }]} />
          <Animated.View style={[styles.rail, styles.railFill, fillStyle]} />
          {STATIONS.map((station, i) => (
            <RouteRow
              key={station.code}
              station={station}
              i={i}
              pos={pos}
              past={i < index}
              eta={i > index ? station.minutes - currentMinutes : null}
            />
          ))}
          <Animated.View style={[styles.train, trainStyle]} />
        </View>
      </Animated.ScrollView>
    </View>
  );
}

function RouteRow({
  station,
  i,
  pos,
  past,
  eta,
}: {
  station: Station;
  i: number;
  pos: SharedValue<number>;
  past: boolean;
  eta: number | null;
}) {
  const pulse = useSharedValue(0);
  useEffect(() => {
    pulse.set(withRepeat(withTiming(1, { duration: 1400, easing: Easing.out(Easing.quad) }), -1));
  }, [pulse]);

  const dotStyle = useAnimatedStyle(() => {
    const reached = pos.value >= i - 0.02;
    return {
      backgroundColor: reached ? LINE_1.color : C.bg,
      borderColor: reached ? LINE_1.color : C.muted,
    };
  });
  const ringStyle = useAnimatedStyle(() => {
    const isNext = i === Math.floor(pos.value + 0.001) + 1;
    return {
      opacity: isNext ? (1 - pulse.value) * 0.8 : 0,
      transform: [{ scale: 1 + pulse.value * 1.6 }],
    };
  });

  return (
    <View style={styles.row}>
      <Text style={styles.eta}>{eta !== null && eta > 0 ? `${eta} min` : ''}</Text>
      <View style={styles.dotSlot}>
        <Animated.View style={[styles.ring, ringStyle]} />
        <Animated.View style={[styles.dot, dotStyle]} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowName, past && { color: C.dim }]} numberOfLines={1}>
          {station.name}
        </Text>
        {station.english ? (
          <Text style={[styles.rowEnglish, past && { color: C.dim }]}>{station.english}</Text>
        ) : null}
      </View>
      {station.underground ? (
        <View style={styles.ugTag}>
          <Text style={styles.ugText}>UG</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingLeft: 20,
    paddingRight: 68,
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
  headerTitle: {
    color: C.text,
    fontSize: 14,
    fontWeight: 600,
  },
  clock: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginTop: 2,
  },
  clockText: {
    color: C.muted,
    fontSize: 13,
    fontWeight: 600,
    fontVariant: ['tabular-nums'],
  },
  clockMeta: {
    color: C.dim,
    fontSize: 13,
  },
  hero: {
    marginTop: 20,
    marginHorizontal: 16,
    padding: 20,
    borderRadius: 24,
    borderCurve: 'continuous',
    backgroundColor: C.panel,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#2A2D33',
  },
  labelSlot: {
    height: 20,
  },
  label: {
    position: 'absolute',
    color: LINE_1.color,
    fontSize: 13,
    fontWeight: 700,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  nameSlot: {
    height: 76,
    marginTop: 8,
  },
  nameInner: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  name: {
    color: C.text,
    fontSize: 34,
    fontWeight: 700,
    letterSpacing: -0.5,
  },
  english: {
    color: C.muted,
    fontSize: 15,
    marginTop: 2,
  },
  infoRow: {
    height: 30,
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  info: {
    color: C.muted,
    fontSize: 14,
    fontWeight: 500,
  },
  badge: {
    borderWidth: 3,
    borderColor: LINE_1.color,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeLine: {
    color: '#111',
    fontWeight: 700,
    lineHeight: 11,
  },
  badgeCode: {
    color: '#111',
    fontWeight: 800,
    lineHeight: 18,
    fontVariant: ['tabular-nums'],
  },
  doorWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  doorFrame: {
    width: 30,
    height: 22,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: C.muted,
    overflow: 'hidden',
  },
  doorPanel: {
    position: 'absolute',
    top: 2,
    bottom: 2,
    width: 11,
    borderRadius: 1.5,
    backgroundColor: C.text,
  },
  doorArrow: {
    color: '#FFB020',
    fontSize: 16,
    fontWeight: 800,
  },
  routePanel: {
    flex: 1,
    marginTop: 16,
    marginHorizontal: 16,
    overflow: 'hidden',
  },
  rail: {
    position: 'absolute',
    left: 70,
    top: ROW_H / 2,
    width: 4,
    marginLeft: -2,
    borderRadius: 2,
    backgroundColor: C.rail,
  },
  railFill: {
    backgroundColor: LINE_1.color,
  },
  train: {
    position: 'absolute',
    left: 70 - 8,
    top: ROW_H / 2 - 13,
    width: 16,
    height: 26,
    borderRadius: 8,
    backgroundColor: '#fff',
    borderWidth: 3,
    borderColor: LINE_1.color,
    boxShadow: `0 0 16px ${LINE_1.color}`,
  },
  row: {
    height: ROW_H,
    flexDirection: 'row',
    alignItems: 'center',
  },
  eta: {
    width: 52,
    color: C.muted,
    fontSize: 12,
    fontWeight: 600,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  dotSlot: {
    width: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2.5,
  },
  ring: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: LINE_1.color,
  },
  rowName: {
    color: C.text,
    fontSize: 17,
    fontWeight: 600,
  },
  rowEnglish: {
    color: C.muted,
    fontSize: 12,
    marginTop: 1,
  },
  ugTag: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: C.dim,
  },
  ugText: {
    color: C.muted,
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: 0.6,
  },
  terminus: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: 20,
    paddingHorizontal: 20,
    gap: 12,
    backgroundColor: 'rgba(10, 11, 13, 0.94)',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#2A2D33',
  },
  terminusText: {
    color: C.text,
    fontSize: 17,
    fontWeight: 600,
    textAlign: 'center',
  },
  terminusButton: {
    height: 52,
    borderRadius: 16,
    borderCurve: 'continuous',
    backgroundColor: LINE_1.color,
    alignItems: 'center',
    justifyContent: 'center',
  },
  terminusButtonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: 700,
  },
});
