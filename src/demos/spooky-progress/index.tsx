import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SymbolView } from 'expo-symbols';
import { useCallback, useMemo, useState, type ComponentType } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, {
  FadeInDown,
  useAnimatedStyle,
  useDerivedValue,
  useFrameCallback,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import { Presets } from 'react-native-pulsar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { NumericText } from '@/components/numeric-text';
import { Chunky } from '../rank-up/button';
import { mix, outCubic, settle, span } from '../rank-up/ui';
import { CHEERS, FINALE, levelAt, ROUNDED, SPOOK, STEPS } from './data';
import { Fuse, FUSE_CUES, FUSE_LAG } from './fuse';
import { Night } from './night';
import { Potion, POTION_CUES, POTION_LAG } from './potion';
import { PUMPKIN_CUES, PUMPKIN_LAG, Pumpkins } from './pumpkins';
import { Slime, SLIME_CUES, SLIME_LAG } from './slime';
import { type Sound, useSounds } from './sounds';
import { type Hang, Spiders } from './spiders';
import type { BarProps, Cue } from './types';
import { GhostWeb, WEB_CUES, WEB_LAG } from './web';

/**
 * Spooky Progress: a lesson's progress bar, Halloween edition, five ways at once, stacked down a
 * graveyard night under a big moon, fog rolling along the bottom, spiders letting themselves down
 * over it all on their threads. They slide in from either side, and five right answers fill them a
 * fifth at a time, each one a beat behind the one above so every answer ripples down the stack. Then
 * the lesson's done and they go off one after another, top to bottom:
 *
 * - Potion: a corked test tube filling with a glowing brew, an ingredient splashing in with each
 *   answer; it boils, the cork shoots out, smoke, bats and ghosts pour out.
 * - Pumpkins: five pumpkins on a vine, each carved and lit in turn; they flare into ghostly green fire.
 * - Ghost run: a ghost gliding along a thread of spider silk lighting lanterns; a spider drops in on
 *   it and gets BOOed.
 * - Fuse: a spark burning along a fuse to a pumpkin bomb, which swells and bursts into sweets.
 * - Slime: slime oozing along a hollow bone, dripping; it heaves up into a goggling blob and splats
 *   all over the screen.
 *
 * Then LESSON COMPLETE drops in over it all, and the spiders shoot back up out of sight.
 */

type Bar = {
  id: string;
  label: string;
  emoji: string;
  lag: number;
  Component: ComponentType<BarProps>;
  cues: Cue[];
};

const BARS: Bar[] = [
  { id: 'potion', label: 'Potion', emoji: '🧪', lag: POTION_LAG, Component: Potion, cues: POTION_CUES },
  { id: 'pumpkins', label: 'Pumpkins', emoji: '🎃', lag: PUMPKIN_LAG, Component: Pumpkins, cues: PUMPKIN_CUES },
  { id: 'web', label: 'Ghost run', emoji: '👻', lag: WEB_LAG, Component: GhostWeb, cues: WEB_CUES },
  { id: 'fuse', label: 'Fuse', emoji: '💣', lag: FUSE_LAG, Component: Fuse, cues: FUSE_CUES },
  { id: 'slime', label: 'Slime', emoji: '🦴', lag: SLIME_LAG, Component: Slime, cues: SLIME_CUES },
];

/** How far behind the one above each bar runs */
const DELAY = 0.3;
/** Each bar going off, then the title, then the buttons */
const BOOMS = BARS.map((_, k) => FINALE + k * DELAY);
const TITLE = BOOMS[BOOMS.length - 1] + 1.5;
const END = TITLE + 2.2;
/** Every answer, as each bar gets it */
const RIPPLES = STEPS.flatMap((s) => BARS.map((b, k) => s + k * DELAY + b.lag));

export default function SpookyProgress() {
  const { width: W, height: H } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const play = useSounds();
  const [run, setRun] = useState(0);
  const [percent, setPercent] = useState(0);
  const [ended, setEnded] = useState(false);

  const t = useSharedValue(-0.2);
  const ambient = useSharedValue(0);
  const nextCue = useSharedValue(0);

  const rowTop = insets.top + 104;
  const rowH = (H - rowTop - insets.bottom - 92) / BARS.length;
  const rowY = (k: number) => rowTop + rowH * (k + 0.5);
  const hangs: Hang[] = useMemo(
    () => [
      { x: W * 0.14, depth: rowH * 1.1, size: 72 },
      { x: W * 0.43, depth: rowH * 2.05, size: 90 },
      { x: W * 0.66, depth: rowH * 0.7, size: 64 },
      { x: W * 0.88, depth: rowH * 2.9, size: 100 },
    ],
    [W, rowH]
  );

  // ---- What's heard and felt: each bar's own, a beat apart, and the lesson's ----
  const cues = useMemo(() => {
    const list: { at: number; fire: () => void }[] = [];
    const add = (c: Cue, gain = 1) => {
      if (c.sound) {
        const s: Sound = c.sound;
        list.push({ at: c.at, fire: () => play(s, (c.gain ?? 1) * gain) });
      }
      if (c.feel) {
        const f = c.feel;
        list.push({
          at: c.at,
          fire: () =>
            f === 'heavy'
              ? Presets.System.impactHeavy()
              : f === 'medium'
                ? Presets.System.impactMedium()
                : Presets.System.impactLight(),
        });
      }
    };
    BARS.forEach((b, k) => b.cues.forEach((c) => add({ ...c, at: c.at + k * DELAY }, 0.7)));
    STEPS.forEach((s, k) => {
      add({ at: s + 0.3, sound: 'correct', gain: 0.5 });
      list.push({ at: s + 0.3, fire: () => setPercent((k + 1) * 20) });
    });
    add({ at: TITLE - 0.2, sound: 'finale', gain: 0.95, feel: 'heavy' });
    add({ at: TITLE + 0.9, sound: 'spider', gain: 0.6 });
    list.push({ at: END, fire: () => setEnded(true) });
    return list.sort((a, b) => a.at - b.at);
  }, [play]);
  const cueAt = useMemo(() => cues.map((c) => c.at), [cues]);
  const fire = useCallback((i: number) => cues[i]?.fire(), [cues]);

  useFrameCallback((f) => {
    const dt = Math.min(1 / 20, (f.timeSincePreviousFrame ?? 16) / 1000);
    ambient.value += dt;
    t.value += dt;
    while (nextCue.value < cueAt.length && cueAt[nextCue.value] <= t.value) {
      scheduleOnRN(fire, nextCue.value);
      nextCue.value += 1;
    }
  });

  const again = () => {
    play('tap');
    setRun((n) => n + 1);
    setPercent(0);
    setEnded(false);
    t.set(-0.2);
    nextCue.set(0);
  };

  // ---- The night: glowing up as the bars fill, flaring as each goes off ----
  const accent = useDerivedValue((): [number, number, number] => [1, 0.52, 0.14]);
  const glow = useDerivedValue(() => 0.2 + 0.5 * levelAt(t.value, 0.3));
  const flare = useDerivedValue(() => {
    let f = 0;
    for (let k = 0; k < BOOMS.length; k++) {
      const d = t.value - BOOMS[k];
      if (d > 0) f += 0.5 * Math.exp(-d * 1.6);
    }
    return Math.min(1.2, f);
  });
  const flash = useAnimatedStyle(() => {
    let f = 0;
    for (let k = 0; k < BOOMS.length; k++) {
      const d = t.value - BOOMS[k];
      if (d > 0) f += 0.22 * Math.exp(-d * 8);
    }
    const d = t.value - TITLE;
    if (d > 0) f += 0.5 * Math.exp(-d * 6);
    return { opacity: Math.min(0.7, f) };
  });
  // The whole stack jolted by each bar going off, and breathing a little the rest of the time
  const camera = useAnimatedStyle(() => {
    let j = 0;
    let sx = 0;
    let sy = 0;
    for (let k = 0; k < BOOMS.length; k++) {
      const d = t.value - BOOMS[k];
      if (d > 0 && d < 0.8) {
        const a = Math.exp(-d * 6) * (k === BOOMS.length - 1 ? 1.6 : 1);
        j += a;
        sx += Math.sin(d * 70 + k) * 9 * a;
        sy += Math.cos(d * 55 + k) * 7 * a;
      }
    }
    const drift = Math.sin(ambient.value * 0.4) * 3;
    return {
      transform: [{ translateX: sx }, { translateY: sy + drift }, { scale: 1 + 0.02 * Math.min(1, j) }],
    };
  });
  const veil = useAnimatedStyle(() => ({ opacity: 0.55 * span(t.value, TITLE - 0.3, 0.5) }));

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <Night width={W} height={H} clock={ambient} accent={accent} glow={glow} barY={H * 0.5} flare={flare} />

      <Animated.View key={run} style={[StyleSheet.absoluteFill, camera]} pointerEvents="none">
        {BARS.map((b, k) => (
          <Row key={b.id} k={k} bar={b} t={t} ambient={ambient} width={W} height={H} y={rowY(k)} rowH={rowH} />
        ))}
        <Spiders t={t} ambient={ambient} width={W} hangs={hangs} bumps={RIPPLES} drops={BOOMS} away={TITLE + 0.8} />
      </Animated.View>

      <Animated.View style={[StyleSheet.absoluteFill, styles.veil, veil]} pointerEvents="none" />
      <FinaleTitle t={t} top={H * 0.4} />
      <Animated.View style={[StyleSheet.absoluteFill, styles.flash, flash]} pointerEvents="none" />

      <View style={[styles.head, { top: insets.top + 8 }]} pointerEvents="box-none">
        <View style={styles.headText}>
          <Text style={styles.kicker}>LESSON 13 · HALLOWEEN WORDS</Text>
          <Text style={styles.title}>Spooky Progress</Text>
        </View>
        <View style={styles.percent}>
          <NumericText value={`${percent}%`} fontSize={20} color={SPOOK.white} weight="black" />
        </View>
        <Pressable onPress={() => router.back()} style={styles.close} hitSlop={10}>
          <SymbolView name="xmark" size={15} weight="bold" tintColor={SPOOK.white} />
        </Pressable>
      </View>
      {STEPS.map((_, k) => (
        <Stamp key={`${run}-${k}`} k={k} t={t} top={insets.top + 64} />
      ))}

      {ended ? (
        <Animated.View entering={FadeInDown} style={[styles.footer, { bottom: insets.bottom + 24 }]}>
          <Chunky
            look="pumpkin"
            icon="arrow.counterclockwise"
            label="Play it again"
            onPress={again}
            style={styles.grow}
          />
        </Animated.View>
      ) : null}
    </View>
  );
}

/** Bar k in its row, on a clock running a beat behind the one above, sliding in from one side */
function Row({
  k,
  bar,
  t,
  ambient,
  width,
  height,
  y,
  rowH,
}: {
  k: number;
  bar: Bar;
  t: SharedValue<number>;
  ambient: SharedValue<number>;
  width: number;
  height: number;
  y: number;
  rowH: number;
}) {
  const clock = useDerivedValue(() => t.value - k * DELAY);
  const side = k % 2 === 0 ? -1 : 1;
  const slide = useAnimatedStyle(() => {
    const d = t.value - 0.05 - k * 0.09;
    const e = d > 0 ? Math.min(1.05, settle(d, 1.4, 6)) : 0;
    return { opacity: d > 0 ? 1 : 0, transform: [{ translateX: side * width * (1 - e) }] };
  });
  const label = useAnimatedStyle(() => {
    const k2 = outCubic(span(t.value, 0.4 + k * 0.09, 0.4));
    return { opacity: k2 * 0.85, transform: [{ translateX: (1 - k2) * -20 }] };
  });
  const Component = bar.Component;
  return (
    <Animated.View style={[StyleSheet.absoluteFill, slide]}>
      <Animated.View style={[styles.rowLabel, { top: y - rowH / 2 + 2 }, label]}>
        <Text style={styles.rowEmoji}>{bar.emoji}</Text>
        <Text style={styles.rowText}>{bar.label.toUpperCase()}</Text>
      </Animated.View>
      <Component t={clock} ambient={ambient} width={width} height={height} y={y + 6} />
    </Animated.View>
  );
}

/** The cheer for answer k, stamped by the percentage */
function Stamp({ k, t, top }: { k: number; t: SharedValue<number>; top: number }) {
  const s = useAnimatedStyle(() => {
    const d = t.value - STEPS[k] - 0.3;
    const out = span(d, 0.75, 0.25);
    return {
      opacity: d > 0 ? 1 - out : 0,
      transform: [
        { scale: d > 0 ? settle(d, 2.2, 6) * (1 - 0.2 * out) : 0 },
        { rotate: `${-8 + (1 - Math.min(1, settle(d, 1.4, 6))) * -14}deg` },
        { translateY: -out * 12 },
      ],
    };
  });
  return (
    <Animated.View style={[styles.stamp, { top }, s]} pointerEvents="none">
      <SymbolView name="checkmark" size={13} weight="black" tintColor={SPOOK.ink} />
      <Text style={styles.stampText}>{CHEERS[k]}</Text>
    </Animated.View>
  );
}

/** LESSON COMPLETE dropping in a letter at a time, glowing, and what it's worth */
function FinaleTitle({ t, top }: { t: SharedValue<number>; top: number }) {
  const line = useAnimatedStyle(() => {
    const k = outCubic(span(t.value, TITLE + 0.7, 0.4));
    return { opacity: k, transform: [{ translateY: (1 - k) * 16 }] };
  });
  return (
    <View style={[styles.finale, { top }]} pointerEvents="none">
      <View style={styles.letters}>
        {'LESSON'.split('').map((c, i) => (
          <Letter key={i} c={c} t={t} at={TITLE + i * 0.05} />
        ))}
      </View>
      <View style={styles.letters}>
        {'COMPLETE'.split('').map((c, i) => (
          <Letter key={i} c={c} t={t} at={TITLE + 0.32 + i * 0.05} />
        ))}
      </View>
      <Animated.View style={[styles.reward, line]}>
        <Text style={styles.rewardText}>+20 XP</Text>
        <View style={styles.dot} />
        <Text style={styles.rewardText}>🎃 5 bars, 0 survivors</Text>
      </Animated.View>
    </View>
  );
}

function Letter({ c, t, at }: { c: string; t: SharedValue<number>; at: number }) {
  const s = useAnimatedStyle(() => {
    const d = t.value - at;
    const fall = Math.min(1, Math.max(0, d / 0.14));
    const land = d - 0.14;
    const squash = land > 0 ? 0.22 * Math.exp(-land * 9) * Math.cos(land * 28) : 0;
    return {
      opacity: d > 0 ? 1 : 0,
      transform: [
        { translateY: (1 - fall * fall) * -60 },
        { scaleX: mix(2.2, 1, fall * fall) * (1 + squash) },
        { scaleY: mix(2.2, 1, fall * fall) * (1 - squash) },
      ],
    };
  });
  return <Animated.Text style={[styles.letter, s]}>{c}</Animated.Text>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: SPOOK.night, overflow: 'hidden' },
  flash: { backgroundColor: '#FFF1D2' },
  veil: { backgroundColor: '#07040D' },
  head: { position: 'absolute', left: 18, right: 14, flexDirection: 'row', alignItems: 'center', gap: 10 },
  headText: { flex: 1 },
  kicker: { fontFamily: ROUNDED, fontWeight: '900', fontSize: 11, letterSpacing: 1.6, color: SPOOK.soft },
  title: {
    fontFamily: ROUNDED,
    fontWeight: '900',
    fontSize: 26,
    color: SPOOK.pumpkinLight,
    textShadowColor: 'rgba(255, 122, 26, 0.7)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 12,
  },
  percent: {
    paddingHorizontal: 12,
    height: 34,
    borderRadius: 17,
    justifyContent: 'center',
    backgroundColor: SPOOK.glass,
    borderWidth: 1,
    borderColor: SPOOK.glassEdge,
  },
  close: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: SPOOK.glass,
    borderWidth: 1,
    borderColor: SPOOK.glassEdge,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stamp: {
    position: 'absolute',
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    height: 30,
    borderRadius: 15,
    backgroundColor: SPOOK.toxic,
    boxShadow: '0 0 18px rgba(124,240,58,0.6)',
  },
  stampText: { fontFamily: ROUNDED, fontWeight: '900', fontSize: 14, color: SPOOK.ink },
  rowLabel: { position: 'absolute', left: 20, flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowEmoji: { fontSize: 13 },
  rowText: { fontFamily: ROUNDED, fontWeight: '900', fontSize: 10, letterSpacing: 1.8, color: SPOOK.soft },
  finale: { position: 'absolute', left: 0, right: 0, alignItems: 'center', gap: 0 },
  letters: { flexDirection: 'row', justifyContent: 'center' },
  letter: {
    fontFamily: ROUNDED,
    fontWeight: '900',
    fontSize: 58,
    color: SPOOK.pumpkinLight,
    textShadowColor: 'rgba(255, 122, 26, 0.95)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 22,
  },
  reward: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 },
  rewardText: { fontFamily: ROUNDED, fontWeight: '900', fontSize: 18, color: SPOOK.bone },
  dot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: SPOOK.boneShade },
  footer: { position: 'absolute', left: 24, right: 24, flexDirection: 'row', gap: 14 },
  grow: { flex: 1 },
});
