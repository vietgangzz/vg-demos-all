import { Image } from 'expo-image';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  useAnimatedStyle,
  useDerivedValue,
  useFrameCallback,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { Presets } from 'react-native-pulsar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { NumericText } from '@/components/numeric-text';
import { Burst } from '../daily-drop/fx';
import { Aurora } from '../rank-up/aurora';
import { Chunky } from '../rank-up/button';
import { Motes } from '../rank-up/motes';
import { inOutCubic, mix, outCubic, settle, span } from '../rank-up/ui';
import { CAPSULE, CONFETTI, KNOB, LAYOUT, MACHINE, MOLTEN, ROUNDED, TONE, WEEK, WEEK_NAME, WORLD } from './data';
import { PrizeModel } from './prize';
import { type Cue, useSounds } from './sounds';

/**
 * Your week as a gacha machine. A glossy machine on Rank Up's deep blue world, its glass dome heaped
 * with capsules, five slots waiting at the top. Turn the knob (drag round it, or tap the button):
 * it ratchets round, the machine rattles, and with a clunk a capsule drops out of the chute and
 * bounces. It leaps up into the middle, swelling, and shakes harder and harder as specks of light are
 * pulled into it, until it pops: the top flies off, light blooms, and a prize rises out of it turning,
 * a solid thing rendered in Blender, its number counting up under it. Next, and it flies up into its
 * slot. The fifth capsule is gold: it shakes longest, and when it pops Gold's world floods out from it
 * with confetti. Then the whole week, laid out on a plate.
 */

/** A pull's beats, in seconds from the capsule dropping */
const beats = (legend: boolean) => {
  const pop = legend ? 2.75 : 1.95;
  return { land: 0.36, rise: 0.75, centre: 1.3, pop, count: pop + 0.4, words: pop + 0.6, next: pop + 1.25 };
};
const END = 6;
/** One turn of the knob drops a capsule */
const TURN = 360;
/** How long the button's turn of the knob takes, and how long a prize takes to fly to its slot */
const AUTO = 900;
const COLLECT = 650;
const SLOT = 46;
const SLOT_GAP = 12;

type Stage = 'idle' | 'reveal' | 'collect' | 'summary';

export default function WeeklyGacha() {
  const { width: W, height: H } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const play = useSounds();

  const [k, setK] = useState(0);
  const [stage, setStage] = useState<Stage>('idle');
  const [shown, setShown] = useState('0');
  const [ready, setReady] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const prize = WEEK[k];
  const legend = k === WEEK.length - 1;
  const B = useMemo(() => beats(legend), [legend]);

  /** Always running, for things that drift; the pull's clock; the prize flying to its slot; Gold's flood; the summary */
  const ambient = useSharedValue(0);
  const p = useSharedValue(0);
  const back = useSharedValue(0);
  const flood = useSharedValue(0);
  const wrap = useSharedValue(0);
  const buttonIn = useSharedValue(1);
  /** How far round the knob's gone (degrees, only ever forwards), where this turn ends, and whether we're waiting on it */
  const crank = useSharedValue(0);
  const goal = useSharedValue(TURN);
  const armed = useSharedValue(1);
  const notch = useSharedValue(0);
  const lastAngle = useSharedValue(0);

  // ---- Where things are ----

  const MH = Math.min(H * 0.5, (W * 0.8) / LAYOUT.aspect);
  const MW = MH * LAYOUT.aspect;
  const MB = H - insets.bottom - 112;
  const MT = MB - MH;
  const ML = (W - MW) / 2;
  const knobX = ML + LAYOUT.knob.x * MW;
  const knobY = MT + LAYOUT.knob.y * MH;
  const knobSize = LAYOUT.knob.size * MH;
  const chuteX = ML + LAYOUT.chute.x * MW;
  const chuteY = MT + LAYOUT.chute.y * MH;
  /** The capsule's picture, full size; the capsule's 0.8 of it */
  const CS = W * 0.5;
  const SMALL = 0.36;
  const floorY = MB - CS * 0.4 * SMALL + 6;
  const Z = { x: W / 2, y: insets.top + H * 0.31 };
  const IS = W * 0.54;
  const slotsY = insets.top + 112;
  const slotX = (i: number) => (W - (SLOT * 5 + SLOT_GAP * 4)) / 2 + SLOT / 2 + i * (SLOT + SLOT_GAP);
  /** Where this capsule's prize goes once it's yours */
  const home = { x: slotX(k), y: slotsY + SLOT / 2 };

  // ---- Timing ----

  const at = useCallback((s: number, fn: () => void) => {
    timers.current.push(setTimeout(fn, s * 1000));
  }, []);
  const clear = useCallback(() => {
    for (const id of timers.current) clearTimeout(id);
    timers.current = [];
  }, []);
  useEffect(() => clear, [clear]);

  const tick = useCallback(() => {
    play('tick', 0.7);
    Presets.System.impactLight();
  }, [play]);

  const dropRef = useRef(() => {});
  const dropped = useCallback(() => dropRef.current(), []);

  useFrameCallback((f) => {
    ambient.value += (f.timeSincePreviousFrame ?? 0) / 1000;
    // A click every eighth of a turn, however it's being turned; a capsule once it's gone all the way
    const q = Math.floor(crank.value / 45);
    if (q !== notch.value) {
      notch.value = q;
      scheduleOnRN(tick);
    }
    if (armed.value === 1 && crank.value >= goal.value - 0.5) {
      armed.value = 0;
      scheduleOnRN(dropped);
    }
  });

  // Drag round the machine to turn its knob: only forwards, like a ratchet
  const turn = Gesture.Pan()
    .enabled(stage === 'idle')
    .minDistance(0)
    .onBegin((e) => {
      lastAngle.set(Math.atan2(e.absoluteY - knobY, e.absoluteX - knobX));
    })
    .onUpdate((e) => {
      const a = Math.atan2(e.absoluteY - knobY, e.absoluteX - knobX);
      let d = a - lastAngle.get();
      if (d > Math.PI) d -= 2 * Math.PI;
      if (d < -Math.PI) d += 2 * Math.PI;
      lastAngle.set(a);
      if (d > 0 && armed.get() === 1) crank.set(Math.min(goal.get(), crank.get() + (d * 180) / Math.PI));
    });

  const turnByButton = () => {
    play('tap');
    crank.set(withTiming(goal.get(), { duration: AUTO, easing: Easing.inOut(Easing.cubic) }));
  };

  useEffect(() => {
    dropRef.current = () => {
      clear();
      setStage('reveal');
      setReady(false);
      setShown(prize.show(0));
      buttonIn.set(withTiming(0, { duration: 150 }));
      p.set(0);
      p.set(withTiming(END, { duration: END * 1000, easing: Easing.linear }));
      const cue = (s: number, c: Cue, gain = 1) => at(s, () => play(c, gain));
      play('knock', 0.9);
      Presets.System.impactHeavy();
      cue(B.land, 'drop', 0.9);
      at(B.land, () => Presets.System.impactMedium());
      cue(B.land + 0.16, 'drop', 0.4);
      cue(B.rise, 'swish');
      cue(B.centre - 0.1, 'charge', legend ? 0.9 : 0.55);
      // Shaking, quicker and quicker
      const shakes = legend ? 9 : 5;
      for (let i = 0; i < shakes; i++) {
        const s = B.centre + (B.pop - B.centre) * (1 - Math.pow(1 - i / shakes, 1.6));
        at(s, () => Presets.System.impactLight());
      }
      at(B.pop, () => {
        Presets.System.impactHeavy();
        play('pop');
        play(legend ? 'promote' : 'boom', legend ? 1 : 0.45);
        if (legend) flood.set(withTiming(1, { duration: 1400, easing: Easing.out(Easing.cubic) }));
      });
      if (legend) {
        cue(B.pop + 0.05, 'cannon', 0.9);
        cue(B.pop + 0.2, 'cannon', 0.8);
        cue(B.words, 'fanfare', 0.8);
      }
      cue(B.pop + 0.15, 'twinkle', 0.7);
      // The number counting up
      const steps = 14;
      for (let i = 1; i <= steps; i++) {
        const e = 1 - Math.pow(1 - i / steps, 2.4);
        at(B.count + (i / steps) * 0.75, () => {
          setShown(prize.show(prize.value * e));
          if (i % 3 === 0) play('xp', 0.5);
        });
      }
      at(B.next, () => {
        setReady(true);
        buttonIn.set(withTiming(1, { duration: 250 }));
      });
    };
  }, [B, at, buttonIn, clear, flood, legend, p, play, prize]);

  const next = () => {
    play('whoosh', 0.6);
    Presets.System.impactMedium();
    if (legend) {
      setStage('summary');
      wrap.set(withTiming(1, { duration: 900, easing: Easing.out(Easing.cubic) }));
      at(0.25, () => play('zone', 0.7));
      return;
    }
    setStage('collect');
    buttonIn.set(withTiming(0, { duration: 120 }));
    back.set(withTiming(1, { duration: COLLECT, easing: Easing.inOut(Easing.cubic) }));
    at(COLLECT / 1000, () => {
      play('pop', 0.7);
      Presets.System.impactMedium();
      p.set(0);
      back.set(0);
      setK(k + 1);
      setStage('idle');
      goal.set((k + 2) * TURN);
      armed.set(1);
      buttonIn.set(withTiming(1, { duration: 250 }));
    });
  };

  const replay = () => {
    clear();
    play('tap');
    setK(0);
    setStage('idle');
    setReady(false);
    p.set(0);
    back.set(0);
    flood.set(0);
    wrap.set(0);
    crank.set(0);
    notch.set(0);
    goal.set(TURN);
    armed.set(1);
    buttonIn.set(withTiming(1, { duration: 250 }));
  };

  // ---- The world ----

  const focus = useDerivedValue(() => Z);
  const glow = useDerivedValue(() => {
    const t = p.value;
    const wob = span(t, B.centre, B.pop - B.centre);
    const after = t > B.pop ? Math.exp(-(t - B.pop) * 1.5) : 0;
    return (stage === 'idle' ? 0 : wob * 0.8 + after) * (1 - back.value);
  });
  const rays = useDerivedValue(() => {
    const on = stage === 'summary' ? 1 : span(p.value, B.pop, 0.4) * (1 - back.value);
    return on * (legend || stage === 'summary' ? 1 : 0.8);
  });
  const raysAt = useDerivedValue(() => Z);
  const spin = useDerivedValue(() => ambient.value * 0.25);
  const zero = useDerivedValue(() => 0);
  const popBloom = useDerivedValue(() => span(p.value, B.pop, 0.9));
  const dropBloom = useDerivedValue(() => (stage === 'reveal' ? span(p.value, 0, 0.6) * 0.6 : 0));
  const pull = useDerivedValue(() => {
    const t = p.value;
    return span(t, B.centre - 0.2, B.pop - B.centre + 0.2) * (t < B.pop ? 1 : 0);
  });
  const dust = useDerivedValue(() => 0.5 + 0.5 * flood.value);
  const capY = useDerivedValue(() => Z.y);

  // ---- The machine and its knob ----

  const machine = useAnimatedStyle(() => {
    const t = p.value;
    const r = crank.value % TURN;
    // Rattling as the knob goes round, a thump as the capsule drops, and stepping back for the reveal
    const rattle = armed.value === 1 && r > 0 ? Math.sin((r / TURN) * Math.PI * 8) * 1.2 : 0;
    const thump = stage === 'reveal' && t < 0.4 ? Math.sin(t * 30) * Math.exp(-t * 9) * 0.04 : 0;
    const away =
      stage === 'reveal' || stage === 'collect' ? inOutCubic(span(t, B.rise - 0.1, 0.5)) * (1 - back.value) : 0;
    const gone = span(wrap.value, 0, 0.5);
    return {
      opacity: mix(1, 0.32, away) * (1 - gone),
      transform: [
        { translateY: away * 24 + gone * 60 },
        { rotate: `${rattle}deg` },
        { scaleX: (1 + thump) * mix(1, 0.94, away) },
        { scaleY: (1 - thump) * mix(1, 0.94, away) },
      ],
    };
  });
  const knob = useAnimatedStyle(() => ({ transform: [{ rotate: `${crank.value}deg` }] }));
  const hint = useAnimatedStyle(() => {
    const idle = stage === 'idle' && crank.value % TURN < 1;
    return {
      opacity: withTiming(idle ? 1 : 0, { duration: 200 }),
      transform: [{ rotate: `${(ambient.value * 90) % 360}deg` }],
    };
  });

  // ---- The capsule ----

  const capsule = useAnimatedStyle(() => {
    const t = p.value;
    if (stage !== 'reveal' && stage !== 'collect') return { opacity: 0 };
    let x = chuteX;
    let y = chuteY;
    let s = SMALL;
    let r = 0;
    if (t < B.land) {
      const e = span(t, 0, B.land);
      y = mix(chuteY, floorY, e * e);
      s = mix(0.24, SMALL, e);
      r = e * 90;
    } else if (t < B.rise) {
      const b = t - B.land;
      y = floorY - Math.abs(Math.sin(b * 11)) * Math.exp(-b * 6) * 22;
      r = 90 + b * 60;
    } else if (t < B.centre) {
      const e = inOutCubic(span(t, B.rise, B.centre - B.rise));
      x = mix(chuteX, Z.x, e);
      y = mix(floorY, Z.y, e) - Math.sin(Math.PI * e) * H * 0.07;
      s = mix(SMALL, 1, outCubic(e));
      r = mix(90 + (B.rise - B.land) * 60, 720, e);
    } else {
      // Hovering, shaking harder and harder
      const w = span(t, B.centre, B.pop - B.centre);
      x = Z.x + Math.sin(t * 47) * w * w * 7;
      y = Z.y + Math.sin(t * 3) * 4;
      s = 1 + Math.sin(t * 31) * w * w * 0.05 + w * 0.06;
      r = 720 + Math.sin(t * 38) * w * w * (legend ? 20 : 13);
    }
    return {
      opacity: 1,
      transform: [{ translateX: x - CS / 2 }, { translateY: y - CS / 2 }, { rotate: `${r}deg` }, { scale: s }],
    };
  });
  const top = useAnimatedStyle(() => {
    const o = span(p.value, B.pop, 0.55);
    return {
      opacity: 1 - span(o, 0.6, 0.4),
      transform: [
        { translateX: o * CS * 0.25 },
        { translateY: -o * CS * 1.1 + o * o * CS * 0.5 },
        { rotate: `${-o * 140}deg` },
      ],
    };
  });
  const bottom = useAnimatedStyle(() => {
    const o = span(p.value, B.pop, 0.5);
    return {
      opacity: 1 - span(o, 0.35, 0.65),
      transform: [{ translateY: o * CS * 0.5 }, { scale: 1 - o * 0.25 }],
    };
  });

  // ---- The prize ----

  const angle = useDerivedValue(() => {
    const d = Math.max(0, p.value - B.pop);
    return 70 * d + 340 * (1 - Math.exp(-2.6 * d));
  });
  const item = useAnimatedStyle(() => {
    const d = p.value - B.pop;
    if (d <= 0 || stage === 'summary') return { opacity: 0 };
    const rise = settle(d, 1.5, 5.5);
    const e = inOutCubic(back.value);
    const sx = mix(Z.x, home.x, e);
    const sy = mix(Z.y - 6, home.y, e) - Math.sin(Math.PI * e) * 60;
    const scale = mix(0.25 + 0.75 * rise, (SLOT * 0.95) / IS, e);
    return {
      opacity: 1,
      transform: [
        { translateX: sx - IS / 2 },
        { translateY: sy - IS / 2 + (1 - outCubic(Math.min(1, d / 0.45))) * 40 },
        { scale },
      ],
    };
  });
  const words = useAnimatedStyle(() => {
    const k1 = outCubic(span(p.value, B.count - 0.1, 0.35));
    return {
      opacity: (stage === 'reveal' ? k1 : 0) * (1 - back.value * 3),
      transform: [{ translateY: (1 - k1) * 18 }],
    };
  });
  const line = useAnimatedStyle(() => {
    const k1 = outCubic(span(p.value, B.words, 0.4));
    return {
      opacity: (stage === 'reveal' ? k1 : 0) * (1 - back.value * 3),
      transform: [{ translateY: (1 - k1) * 12 }],
    };
  });

  // ---- The header ----

  const header = useAnimatedStyle(() => ({ opacity: 1 - span(wrap.value, 0, 0.4) }));
  const blurb = useAnimatedStyle(() => ({
    opacity: withTiming(stage === 'idle' ? 1 : 0, { duration: 200 }),
  }));
  const button = useAnimatedStyle(() => ({
    opacity: buttonIn.value,
    transform: [{ translateY: (1 - buttonIn.value) * 30 }],
  }));

  const popped = useDerivedValue(() => Math.max(0, p.value - B.pop));
  const confetti = useDerivedValue(() => (legend ? Math.max(0, p.value - B.pop) : 0));

  const left = WEEK.length - k;
  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <Aurora
        width={W}
        height={H}
        clock={ambient}
        focus={focus}
        glow={glow}
        band={zero}
        flood={flood}
        bandAt={focus}
        floodAt={Z}
        rays={rays}
        raysAt={raysAt}
        spin={spin}
        blooms={[popBloom, Z, dropBloom, { x: chuteX, y: chuteY }]}
      />
      <Motes width={W} height={H} x={Z.x} y={capY} ambient={ambient} charge={pull} dust={dust} />

      <GestureDetector gesture={turn}>
        <Animated.View style={[styles.machine, { left: ML, top: MT, width: MW, height: MH }, machine]}>
          <Image source={MACHINE} style={StyleSheet.absoluteFill} contentFit="contain" />
          <Animated.View
            style={[
              styles.abs,
              { left: knobX - ML - knobSize / 2, top: knobY - MT - knobSize / 2, width: knobSize, height: knobSize },
              knob,
            ]}>
            <Image source={KNOB} style={StyleSheet.absoluteFill} contentFit="contain" />
          </Animated.View>
          <Animated.View
            style={[
              styles.abs,
              styles.hint,
              {
                left: knobX - ML - knobSize * 0.75,
                top: knobY - MT - knobSize * 0.75,
                width: knobSize * 1.5,
                height: knobSize * 1.5,
                borderRadius: knobSize,
              },
              hint,
            ]}
            pointerEvents="none"
          />
        </Animated.View>
      </GestureDetector>

      <Burst
        clock={popped}
        x={Z.x}
        y={Z.y}
        kind="sparkle"
        palette={['#FFFFFF', TONE.goldLight, TONE.goldPale]}
        count={legend ? 46 : 30}
        life={1.3}
        power={legend ? 1.5 : 1.1}
      />
      <Burst clock={confetti} x={14} y={H + 10} kind="confetti" palette={CONFETTI} count={70} life={2.8} power={1.25} />
      <Burst
        clock={confetti}
        x={W - 14}
        y={H + 10}
        kind="confetti"
        palette={CONFETTI}
        count={70}
        life={2.8}
        power={1.25}
      />

      <Animated.View style={[styles.capsule, { width: CS, height: CS }, capsule]} pointerEvents="none">
        <Animated.View style={[StyleSheet.absoluteFill, bottom]}>
          <Image source={CAPSULE[prize.colour].bottom} style={StyleSheet.absoluteFill} />
        </Animated.View>
        <Animated.View style={[StyleSheet.absoluteFill, top]}>
          <Image source={CAPSULE[prize.colour].top} style={StyleSheet.absoluteFill} />
        </Animated.View>
      </Animated.View>

      <Animated.View style={[styles.abs, { width: IS, height: IS }, item]} pointerEvents="none">
        <PrizeModel key={prize.item} item={prize.item} size={IS} angle={angle} />
      </Animated.View>

      <Animated.View style={[styles.words, { top: Z.y + IS * 0.5 + 6, width: W }, words]} pointerEvents="none">
        <NumericText value={shown} fontSize={66} color={TONE.white} weight="black" />
        <Text style={styles.label}>{prize.label}</Text>
      </Animated.View>
      <Animated.Text style={[styles.line, { top: Z.y + IS * 0.5 + 118, width: W }, line]}>{prize.line}</Animated.Text>

      <Animated.View style={[styles.header, { top: insets.top + 6, width: W }, header]} pointerEvents="none">
        <View style={styles.pill}>
          <SymbolView name="sparkles" size={12} weight="black" tintColor={TONE.umber} />
          <Text style={styles.pillText}>WEEKLY GACHA</Text>
        </View>
        <Text style={styles.title}>{WEEK_NAME}</Text>
      </Animated.View>
      <Animated.View
        style={[styles.abs, { top: slotsY, left: 0, width: W, height: SLOT }, header]}
        pointerEvents="none">
        {WEEK.map((w, i) => (
          <View
            key={w.item}
            style={[styles.slot, { left: slotX(i) - SLOT / 2 }, i === k && stage !== 'summary' && styles.slotNext]}>
            {i < k ? (
              <View style={styles.slotIcon}>
                <PrizeModel item={w.item} size={SLOT * 0.95} />
              </View>
            ) : (
              <View style={[styles.dot, i === WEEK.length - 1 && styles.dotGold]} />
            )}
          </View>
        ))}
      </Animated.View>
      <Animated.Text style={[styles.blurb, { top: slotsY + SLOT + 12, width: W }, blurb]} pointerEvents="none">
        {k === 0 ? 'Five capsules. One for each part of your week.' : `${left} left. The last one's gold.`}
      </Animated.Text>

      {stage === 'summary' ? <Summary clock={wrap} width={W} top={insets.top + 70} /> : null}

      <Pressable onPress={() => router.back()} style={[styles.round, { top: insets.top + 8, left: 18 }]} hitSlop={8}>
        <SymbolView name="chevron.left" size={18} weight="bold" tintColor={TONE.white} />
      </Pressable>

      <Animated.View
        style={[styles.footer, styles.row, { bottom: insets.bottom + 20 }, button]}
        pointerEvents={stage === 'idle' || ready ? 'box-none' : 'none'}>
        {stage === 'summary' ? (
          <>
            <Chunky look="molten" icon="arrow.counterclockwise" onPress={replay} style={styles.again} />
            <Chunky
              look="molten"
              label="Share my week"
              icon="square.and.arrow.up"
              onPress={() => {
                play('tap');
                Presets.System.impactMedium();
              }}
              style={styles.grow}
            />
          </>
        ) : stage === 'idle' ? (
          <Chunky look="foil" label="Turn the knob" icon="arrow.clockwise" onPress={turnByButton} style={styles.grow} />
        ) : (
          <Chunky
            look={legend ? 'molten' : 'foil'}
            label={legend ? 'See my week' : 'Next capsule'}
            trailing="arrow.right"
            disabled={!ready || stage !== 'reveal'}
            onPress={next}
            style={styles.grow}
          />
        )}
      </Animated.View>
    </View>
  );
}

/** The whole week on a plate of cream glass, a row a prize, coming in one after another */
function Summary({ clock, width, top }: { clock: SharedValue<number>; width: number; top: number }) {
  const title = useAnimatedStyle(() => {
    const e = outCubic(span(clock.value, 0.2, 0.5));
    return { opacity: e, transform: [{ translateY: (1 - e) * 20 }, { scale: mix(1.2, 1, e) }] };
  });
  const plate = useAnimatedStyle(() => {
    const e = outCubic(span(clock.value, 0.3, 0.5));
    return { opacity: e, transform: [{ translateY: (1 - e) * 40 }] };
  });
  return (
    <View style={[styles.summary, { top, width }]} pointerEvents="none">
      <Animated.View style={[styles.centre, title]}>
        <View style={styles.pill}>
          <SymbolView name="chevron.up.2" size={12} weight="black" tintColor={TONE.umber} />
          <Text style={styles.pillText}>WRAPPED</Text>
        </View>
        <Text style={styles.wrapTitle}>{WEEK_NAME}</Text>
      </Animated.View>
      <Animated.View style={[styles.plate, { width: width - 32 }, plate]}>
        {WEEK.map((w, i) => (
          <Row key={w.item} i={i} clock={clock} />
        ))}
      </Animated.View>
    </View>
  );
}

function Row({ i, clock }: { i: number; clock: SharedValue<number> }) {
  const w = WEEK[i];
  const s = useAnimatedStyle(() => {
    const e = settle(clock.value - 0.45 - i * 0.09, 1.6, 6.5);
    return {
      opacity: Math.min(1, Math.max(0, (clock.value - 0.45 - i * 0.09) * 6)),
      transform: [{ translateX: (1 - e) * 40 }],
    };
  });
  return (
    <Animated.View style={[styles.wrapRow, i > 0 && styles.wrapRule, s]}>
      <View style={styles.wrapIcon}>
        <PrizeModel item={w.item} size={52} />
      </View>
      <Text style={styles.wrapValue}>{w.show(w.value)}</Text>
      <Text style={styles.wrapLabel} numberOfLines={1}>
        {w.label}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: WORLD.silver.top, overflow: 'hidden' },
  abs: { position: 'absolute', left: 0, top: 0 },
  machine: { position: 'absolute' },
  hint: { borderWidth: 2.5, borderColor: 'rgba(255,255,255,0.75)', borderStyle: 'dashed' },
  capsule: { position: 'absolute', left: 0, top: 0 },
  words: { position: 'absolute', left: 0, alignItems: 'center' },
  label: {
    marginTop: 2,
    fontFamily: ROUNDED,
    fontWeight: '900',
    fontSize: 19,
    letterSpacing: 0.4,
    color: TONE.goldLight,
    textShadowColor: TONE.shade,
    textShadowRadius: 6,
  },
  line: {
    position: 'absolute',
    left: 0,
    textAlign: 'center',
    fontFamily: ROUNDED,
    fontWeight: '700',
    fontSize: 16,
    color: TONE.soft,
    textShadowColor: TONE.shade,
    textShadowRadius: 6,
  },
  header: { position: 'absolute', left: 0, alignItems: 'center', gap: 8 },
  centre: { alignItems: 'center', gap: 8 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 30,
    paddingHorizontal: 15,
    borderRadius: 15,
    experimental_backgroundImage: MOLTEN,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.85)',
    boxShadow: `inset 0 2px 1px -0.5px rgba(255,255,255,0.85), 0 4px 0 ${TONE.amber}, 0 10px 18px ${TONE.drop}`,
  },
  pillText: { fontFamily: ROUNDED, fontWeight: '900', fontSize: 12, letterSpacing: 2.4, color: TONE.umber },
  title: {
    fontFamily: ROUNDED,
    fontWeight: '900',
    fontSize: 34,
    color: TONE.white,
    textShadowColor: TONE.shade,
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  slot: {
    position: 'absolute',
    top: 0,
    width: SLOT,
    height: SLOT,
    borderRadius: SLOT / 2,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.28)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  slotNext: { borderColor: TONE.goldLight, borderWidth: 2 },
  slotIcon: { width: SLOT * 0.95, height: SLOT * 0.95 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: 'rgba(255,255,255,0.4)' },
  dotGold: { backgroundColor: TONE.gold },
  blurb: {
    position: 'absolute',
    left: 0,
    textAlign: 'center',
    fontFamily: ROUNDED,
    fontWeight: '700',
    fontSize: 15,
    color: TONE.soft,
  },
  summary: { position: 'absolute', left: 0, alignItems: 'center', gap: 22 },
  wrapTitle: {
    fontFamily: ROUNDED,
    fontWeight: '900',
    fontSize: 44,
    color: TONE.white,
    textShadowColor: TONE.shadeWarm,
    textShadowOffset: { width: 0, height: 3 },
    textShadowRadius: 10,
  },
  plate: {
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 6,
    backgroundColor: 'rgba(255, 249, 232, 0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.9)',
    boxShadow: `inset 0 2px 1px -0.5px rgba(255,255,255,0.9), 0 4px 0 rgba(180, 82, 10, 0.3), 0 14px 24px ${TONE.dropWarm}`,
  },
  wrapRow: { flexDirection: 'row', alignItems: 'center', gap: 12, height: 68 },
  wrapRule: { borderTopWidth: 1, borderTopColor: 'rgba(94, 38, 0, 0.12)' },
  wrapIcon: { width: 52, height: 52 },
  wrapValue: { fontFamily: ROUNDED, fontWeight: '900', fontSize: 26, color: TONE.umber, minWidth: 92 },
  wrapLabel: { flex: 1, fontFamily: ROUNDED, fontWeight: '800', fontSize: 15, color: TONE.amber },
  round: {
    position: 'absolute',
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: TONE.glass,
    borderWidth: 1,
    borderColor: TONE.glassEdge,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: { position: 'absolute', left: 20, right: 20 },
  row: { flexDirection: 'row', gap: 12 },
  grow: { flex: 1 },
  again: { width: 58 },
});
