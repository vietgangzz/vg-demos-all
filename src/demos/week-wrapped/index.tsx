import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SymbolView } from 'expo-symbols';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, {
  FadeInDown,
  SensorType,
  useAnimatedReaction,
  useAnimatedSensor,
  useAnimatedStyle,
  useDerivedValue,
  useFrameCallback,
  useSharedValue,
} from 'react-native-reanimated';
import { Presets } from 'react-native-pulsar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { Burst } from '../daily-drop/fx';
import { Aurora } from '../rank-up/aurora';
import { Chunky } from '../rank-up/button';
import { Motes } from '../rank-up/motes';
import { SpinBadge } from '../rank-up/spin';
import { inOutCubic, mix, outBack, outCubic, span } from '../rank-up/ui';
import { Card } from './card';
import { CONFETTI, ROUNDED, TONE, WORLD } from './data';
import { Drop, Pill } from './parts';
import {
  Board,
  boardLayout,
  FIN,
  Header,
  MONDAY,
  OPEN,
  PLAY_AT,
  Rewind,
  REWIND_AT,
  Scrubber,
  Stickers,
  storyAt,
  yourY,
} from './replay';
import { type Cue, useSounds } from './sounds';
import { BUMP_AT, DAY_TICKS, dayAt, FINAL, KICK_AT, placesAt, PLAYERS, SLOW, stamp, xpOf, ZONE_AT } from './week';

/**
 * Your week, wrapped as a replay of Silver's board, the way Rank Up tells a promotion: it all plays
 * by itself, and it starts at the end.
 *
 * It opens on Gold: your row in gold foil wearing the crown, Gold's badge, GOLD LEAGUE, confetti in
 * the air. FINAL. Then the tape winds back: the confetti flies back down into the cannons, GOLD
 * LEAGUE lifts away a letter at a time, the badge whirls backwards off into the distance, the board
 * flies back up off the bottom of the screen and slots back together, Gold's world draws back into
 * your row and the crown lifts off your head; then the whole week runs backwards, fast, every kick
 * undone, everyone's XP spinning back down to Monday morning, you sixth. Then the week plays, a day
 * every couple of seconds along the scrubber, a sticker over it for each one: the rows sliding past
 * each other as the XP comes in, a leg springing out of your row to boot each one you pass, a slow
 * Wednesday as two slip past you, a three-kick comeback on Thursday, into the promotion zone on
 * Friday. Sunday night it goes into slow motion, Mina still ahead, and at 11:42 pm the last kick
 * sends her flying: everything stops dead, the crown drops back on, Gold's world floods out from
 * your row and the board falls away. Gold's badge whirls in and slams down, GOLD LEAGUE, and the
 * week ends on one card.
 */

/** The kicks, then Gold's badge landing: where the clock stops dead for a beat, and for how long */
const SLAMS = [...KICK_AT, FIN.slam];
const HOLD = SLAMS.map((at) => (at === FINAL ? 0.32 : at === FIN.slam ? 0.14 : 0.07));
const LAST_KICK = KICK_AT.length - 1;

/** The numbers on the board `t` into the replay */
function numbersAt(t: number) {
  const p = dayAt(t);
  return {
    xp: Array.from({ length: PLAYERS }, (_, i) => Math.round(xpOf(i, p))),
    places: placesAt(p),
    stamp: stamp(p),
    day: Math.floor(Math.min(6.9999, p)),
  };
}

export default function WeekWrapped() {
  const { width: W, height: H } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const play = useSounds();

  const [numbers, setNumbers] = useState(() => numbersAt(OPEN));
  const [ended, setEnded] = useState(false);

  /**
   * The screen's clock and the story's (the tape winding the story back, then playing it, stopping
   * dead at each slam), seconds always running (stopping with them), and where each is up to: in its
   * cues, its slams, and the day it's on while it winds back
   */
  const r = useSharedValue(0);
  const t = useSharedValue(OPEN);
  const ambient = useSharedValue(0);
  const hold = useSharedValue(0);
  const nextCue = useSharedValue(0);
  const nextTape = useSharedValue(0);
  const nextSlam = useSharedValue(0);
  const backDay = useSharedValue(6);

  const L = boardLayout(W, H, insets.top, insets.bottom);
  /** Your row on top, where Gold floods out from; Gold's badge, above the stage */
  const top = { x: W / 2, y: L.list + 26 };
  const badgeAt = { x: W / 2, y: H * 0.25 };

  // ---- Everything that's heard and felt, at its moment ----

  const cues = useMemo(() => {
    const list: { at: number; fire: () => void }[] = [];
    const sound = (at: number, c: Cue, gain = 1) => list.push({ at, fire: () => play(c, gain) });
    const feel = (at: number, kind: 'light' | 'medium' | 'heavy') =>
      list.push({
        at,
        fire: () =>
          kind === 'heavy'
            ? Presets.System.impactHeavy()
            : kind === 'medium'
              ? Presets.System.impactMedium()
              : Presets.System.impactLight(),
      });
    for (const tick of DAY_TICKS) sound(tick.at, 'tick', 0.35);
    KICK_AT.forEach((at, k) => {
      const last = k === LAST_KICK;
      sound(at, 'knock', last ? 1 : 0.8);
      sound(at, `climb${k % 4}` as Cue, last ? 1 : 0.7);
      if (last) sound(at, 'boom', 0.6);
      feel(at, last ? 'heavy' : 'medium');
    });
    for (const at of BUMP_AT) {
      sound(at, 'drop', 0.5);
      feel(at, 'light');
    }
    sound(ZONE_AT + 0.1, 'zone', 0.8);
    sound(SLOW, 'charge', 0.7);
    sound(FIN.crown + 0.25, 'pop', 0.8);
    sound(FIN.flood, 'promote');
    sound(FIN.flood + 0.02, 'cannon', 0.9);
    sound(FIN.flood + 0.16, 'cannon', 0.8);
    feel(FIN.flood, 'heavy');
    feel(FIN.flood + 0.08, 'heavy');
    sound(FIN.fall, 'fall', 0.5);
    sound(FIN.badge, 'launch', 0.5);
    sound(FIN.slam, 'drop', 0.9);
    sound(FIN.slam, 'boom', 0.45);
    feel(FIN.slam, 'heavy');
    sound(FIN.words + 0.15, 'fanfare', 0.8);
    sound(FIN.card, 'swish', 0.7);
    sound(FIN.card + 0.2, 'drop', 0.6);
    list.push({ at: FIN.card + 1.1, fire: () => setEnded(true) });
    return list.sort((a, b) => a.at - b.at);
  }, [play]);
  const cueAt = useMemo(() => cues.map((c) => c.at), [cues]);
  const fire = useCallback((i: number) => cues[i].fire(), [cues]);

  /** The tape's own, on the screen's clock: FINAL, the rewind starting with a suck of air, and play */
  const tape = useMemo(() => {
    const list: { at: number; fire: () => void }[] = [
      { at: 0.2, fire: () => play('pop', 0.5) },
      { at: REWIND_AT, fire: () => play('swish', 0.9) },
      { at: REWIND_AT + 0.05, fire: () => play('whoosh', 0.6) },
      { at: REWIND_AT, fire: () => Presets.System.impactMedium() },
      { at: REWIND_AT + 0.2, fire: () => play('charge', 0.5) },
      { at: PLAY_AT - 0.05, fire: () => play('pop', 0.8) },
      { at: PLAY_AT - 0.05, fire: () => Presets.System.impactMedium() },
    ];
    return list.sort((a, b) => a.at - b.at);
  }, [play]);
  const tapeAt = useMemo(() => tape.map((c) => c.at), [tape]);
  const fireTape = useCallback((i: number) => tape[i].fire(), [tape]);
  /** A tick for each day the rewind runs back over */
  const tickBack = useCallback(() => {
    play('tick', 0.7);
    Presets.System.impactLight();
  }, [play]);

  useFrameCallback((f) => {
    const dt = Math.min(1 / 20, (f.timeSincePreviousFrame ?? 16) / 1000);
    // Stopped dead on a slam, everything with it
    if (hold.value > 0) {
      hold.value -= dt;
      return;
    }
    ambient.value += dt;
    let now = r.value + dt;
    let story = storyAt(now);
    const playing = now >= PLAY_AT;
    const k = nextSlam.value;
    if (playing && k < SLAMS.length && story >= SLAMS[k]) {
      story = SLAMS[k];
      now = PLAY_AT + (story - MONDAY);
      hold.value = HOLD[k];
      nextSlam.value = k + 1;
    }
    r.value = now;
    t.value = story;
    while (nextTape.value < tapeAt.length && tapeAt[nextTape.value] <= now) {
      scheduleOnRN(fireTape, nextTape.value);
      nextTape.value += 1;
    }
    if (playing) {
      while (nextCue.value < cueAt.length && cueAt[nextCue.value] <= story) {
        scheduleOnRN(fire, nextCue.value);
        nextCue.value += 1;
      }
    } else if (now > REWIND_AT) {
      const day = Math.floor(Math.min(6.9999, dayAt(story)));
      if (day !== backDay.value) {
        backDay.value = day;
        scheduleOnRN(tickBack);
      }
    }
  });

  // The XP, places and clock catching up twenty times a second
  const sync = useCallback((at: number) => setNumbers(numbersAt(at)), []);
  useAnimatedReaction(
    () => Math.floor(t.value * 20),
    (q, prev) => {
      if (q !== prev && t.value < FIN.card) scheduleOnRN(sync, t.value);
    }
  );

  const replay = () => {
    play('tap');
    setEnded(false);
    setNumbers(numbersAt(OPEN));
    r.set(0);
    t.set(OPEN);
    hold.set(0);
    nextCue.set(0);
    nextTape.set(0);
    nextSlam.set(0);
    backDay.set(6);
  };

  // ---- The world ----

  /** Seconds since the last slam, and which one it was */
  const since = useDerivedValue(() => {
    let last = -1;
    for (let i = 0; i < SLAMS.length; i++) if (t.value >= SLAMS[i]) last = i;
    return last < 0 ? { d: -1, i: -1 } : { d: t.value - SLAMS[last], i: last };
  });
  const you = useDerivedValue(() => ({ x: W / 2, y: yourY(t.value, L) }));
  const youY = useDerivedValue(() => you.value.y);
  const flood = useDerivedValue(() => outCubic(span(t.value, FIN.flood, 1)));
  const band = useDerivedValue(() => 0);
  const glow = useDerivedValue(() => {
    const s = since.value;
    const kick = s.d >= 0 && s.i <= LAST_KICK ? 0.6 * Math.exp(-s.d * 3) : 0;
    return (0.3 + kick + 0.4 * span(t.value, SLOW, FINAL - SLOW)) * (1 - span(t.value, FIN.card, 0.5) * 0.6);
  });
  const raysAt = useDerivedValue(() => ({
    x: W / 2,
    y: mix(top.y, badgeAt.y, span(t.value, FIN.badge, FIN.slam - FIN.badge)),
  }));
  const rays = useDerivedValue(
    () => Math.max(flood.value * 0.8, span(t.value, FIN.slam, 0.4)) * (1 - 0.45 * span(t.value, FIN.card, 0.8))
  );
  const spin = useDerivedValue(() => ambient.value * 0.25);
  const kickBloom = useDerivedValue(() => span(t.value, FINAL, 0.9));
  const goldBloom = useDerivedValue(() => span(t.value, FIN.flood, 1.2));
  /** Light pulled in to you through Sunday's slow motion, and drifting up once you're Gold */
  const pull = useDerivedValue(() => {
    const d = t.value - SLOW;
    return d > 0 && t.value < FINAL ? span(d, 0, FINAL - SLOW) : 0;
  });
  const dust = useDerivedValue(() => 0.25 + 0.75 * flood.value);
  const burst = useDerivedValue(() => Math.max(0, t.value - FIN.flood));
  const late = useDerivedValue(() => Math.max(0, t.value - FIN.flood - 0.12));
  const slamBurst = useDerivedValue(() => Math.max(0, t.value - FIN.slam));
  /** More confetti with the words, still in the air as it opens, so the rewind sucks it back down */
  const wordsBurst = useDerivedValue(() => Math.max(0, t.value - FIN.words + 0.1));
  const wordsLate = useDerivedValue(() => Math.max(0, t.value - FIN.words));
  const live = useDerivedValue((): number => (r.value >= PLAY_AT ? 1 : 0));

  const gravity = useAnimatedSensor(SensorType.GRAVITY, { interval: 'auto' });
  const tilt = useDerivedValue(() => {
    const g = gravity.sensor.value;
    const n = Math.max(1e-3, Math.hypot(g.x, g.y, g.z));
    const a = ambient.value;
    return { x: g.x / n + 0.35 * Math.sin(a * 0.9), y: (g.y / n + 0.6) * 0.8 + 0.25 * Math.cos(a * 0.7) };
  });

  // The camera, shooting it like a match: tracking in close on your row all week, punching in and
  // tipping with each kick; through Sunday's slow motion pushing right in on you and Mina above you,
  // in tighter still on the last kick, then whipping back out as Gold floods; rolling and juddering
  // while the tape winds back
  const camera = useAnimatedStyle(() => {
    const u = t.value;
    const s = since.value;
    const kick = s.i >= 0 && s.i <= LAST_KICK;
    const last = s.i === LAST_KICK;
    const big = last ? 2.2 : s.i === SLAMS.length - 1 ? 1.4 : 0.8;
    const j = s.d >= 0 && s.d < 0.6 ? Math.exp(-s.d * 9) * big : 0;
    const punch = s.d >= 0 ? (last ? 0.3 : kick ? 0.14 : 0.08) * Math.exp(-s.d * (last ? 2.5 : 6)) : 0;
    const tip = kick && s.d >= 0 ? (s.i % 2 === 0 ? 1 : -1) * 1.6 * Math.exp(-s.d * 5) * Math.cos(s.d * 14) : 0;
    const out = outBack(span(u, FIN.flood - 0.05, 0.5), 1.4);
    const track = inOutCubic(span(u, MONDAY, 1.2)) * (1 - out);
    const close = inOutCubic(span(u, SLOW - 0.4, 1.6)) * (1 - out);
    const rewinding = Math.sin(Math.PI * span(r.value, REWIND_AT, PLAY_AT - REWIND_AT));
    // Between you and the row above you, through the slow motion
    const focusY = you.value.y - 30 * close;
    const zoom = 1 + 0.06 * track + 0.42 * close + punch + 0.04 * rewinding;
    const centre = 0.35 * track + 0.5 * close;
    return {
      transform: [
        { translateX: Math.sin(s.d * 70) * j * 9 + Math.sin(u * 83) * rewinding * 3 },
        {
          translateY:
            (H * 0.47 - focusY) * Math.min(1, centre) + Math.cos(s.d * 55) * j * 8 + Math.sin(u * 61) * rewinding * 4,
        },
        { translateY: focusY - H / 2 },
        { scale: zoom },
        { rotate: `${tip + 0.6 * Math.sin(u * 0.9) * close}deg` },
        { translateY: H / 2 - focusY },
      ],
    };
  });
  // Letterboxing through the slow motion, a broadcast's caption in the bars
  const bars = useDerivedValue(() => inOutCubic(span(t.value, SLOW - 0.3, 0.7)) * (1 - span(t.value, FIN.flood, 0.35)));
  const barTop = useAnimatedStyle(() => ({ transform: [{ translateY: -(1 - bars.value) * H * 0.13 }] }));
  const barBottom = useAnimatedStyle(() => ({ transform: [{ translateY: (1 - bars.value) * H * 0.13 }] }));
  const rec = useAnimatedStyle(() => ({ opacity: 0.4 + 0.6 * (Math.cos(ambient.value * 6) > 0 ? 1 : 0) }));
  // Gold's world, turned down from glaring once it's taken over
  const warmth = useAnimatedStyle(() => ({ opacity: span(t.value, FIN.flood + 0.3, 1) }));
  const flash = useAnimatedStyle(() => {
    const s = since.value;
    const strong = s.i === LAST_KICK ? 0.85 : s.i === SLAMS.length - 1 ? 0.6 : 0.12;
    return { opacity: s.d >= 0 ? strong * Math.exp(-s.d * 8) : 0 };
  });

  // Gold's badge whirling in from far off and slamming down above the stage
  const size = W * 0.5;
  const badge = useAnimatedStyle(() => {
    const d = t.value - FIN.badge;
    if (d < 0) return { opacity: 0 };
    const e = span(d, 0, FIN.slam - FIN.badge);
    const land = t.value - FIN.slam;
    const squash = land > 0 ? 0.32 * Math.exp(-land * 8) * Math.cos(land * 24) : 0;
    const k = mix(0.04, 1, e * e * e);
    return {
      opacity: 1,
      transform: [
        { translateX: badgeAt.x - size / 2 },
        { translateY: badgeAt.y - size / 2 },
        { scaleX: k * (1 + squash) },
        { scaleY: k * (1 - squash) },
      ],
    };
  });
  const angle = useDerivedValue(() => {
    const e = span(t.value, FIN.badge, FIN.slam - FIN.badge);
    return 2160 * (1 - e) * (1 - e) + Math.sin(ambient.value * 0.8) * 10 * span(t.value, FIN.slam + 0.4, 0.5);
  });
  const gold = useDerivedValue(() => 1);
  const white = useDerivedValue(() => {
    const d = t.value - FIN.slam;
    return d > 0 ? 0.9 * Math.exp(-d * 5) : 0.35;
  });
  const holo = useDerivedValue(() => span(t.value, FIN.slam + 0.5, 0.6));

  const cardIn = useDerivedValue(() => t.value - FIN.card);
  const beats = useAnimatedStyle(() => ({ opacity: 1 - span(t.value, FIN.card - 0.1, 0.3) }));

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <Aurora
        width={W}
        height={H}
        clock={ambient}
        focus={you}
        glow={glow}
        band={band}
        flood={flood}
        bandAt={you}
        floodAt={top}
        rays={rays}
        raysAt={raysAt}
        spin={spin}
        blooms={[kickBloom, top, goldBloom, top]}
      />
      <Animated.View style={[StyleSheet.absoluteFill, styles.warmth, warmth]} pointerEvents="none" />
      <Animated.View style={[StyleSheet.absoluteFill, camera]}>
        <Motes width={W} height={H} x={W / 2} y={youY} ambient={ambient} charge={pull} dust={dust} />

        <Animated.View style={[StyleSheet.absoluteFill, beats]} pointerEvents="none">
          <Board t={t} layout={L} xp={numbers.xp} places={numbers.places} />
          <Header t={t} live={live} layout={L} stamp={numbers.stamp} />
          <Stickers t={t} live={live} layout={L} />
          <Scrubber t={t} layout={L} day={numbers.day} />
          {/* Flat, so the badge's turn doesn't sink behind the sky's canvases */}
          <View collapsable={false} style={StyleSheet.absoluteFill}>
            <Animated.View style={[styles.abs, { width: size, height: size }, badge]}>
              <SpinBadge size={size} angle={angle} gold={gold} white={white} tilt={tilt} holo={holo} />
            </Animated.View>
          </View>
          <View style={[styles.words, { top: H * 0.4 }]}>
            <Pill text="PROMOTED" icon="chevron.up.2" clock={t} at={FIN.words} />
            <Drop text="GOLD LEAGUE" clock={t} at={FIN.words + 0.15} size={46} />
          </View>
        </Animated.View>

        <Burst
          clock={burst}
          x={top.x}
          y={top.y}
          kind="sparkle"
          palette={['#FFFFFF', TONE.goldLight, TONE.goldPale]}
          count={40}
          life={1.4}
          power={1.4}
        />
        <Burst clock={burst} x={14} y={H + 10} kind="confetti" palette={CONFETTI} count={70} life={2.8} power={1.25} />
        <Burst
          clock={wordsBurst}
          x={14}
          y={H + 10}
          kind="confetti"
          palette={CONFETTI}
          count={60}
          life={2.8}
          power={1.2}
        />
        <Burst
          clock={wordsLate}
          x={W - 14}
          y={H + 10}
          kind="confetti"
          palette={CONFETTI}
          count={60}
          life={2.8}
          power={1.2}
        />
        <Burst
          clock={late}
          x={W - 14}
          y={H + 10}
          kind="confetti"
          palette={CONFETTI}
          count={70}
          life={2.8}
          power={1.25}
        />
        <Burst
          clock={slamBurst}
          x={badgeAt.x}
          y={badgeAt.y}
          kind="sparkle"
          palette={['#FFFFFF', TONE.goldLight, TONE.goldPale]}
          count={34}
          life={1.3}
          power={1.3}
        />

        <View style={[styles.cardTitle, { top: insets.top + 48 }]} pointerEvents="none">
          <Drop text="THAT'S YOUR WEEK" clock={cardIn} at={0.05} size={30} />
        </View>
        {/* Flat, so the card's 3D turn doesn't sink behind the sky's canvases */}
        <View collapsable={false} style={StyleSheet.absoluteFill} pointerEvents="none">
          <Card clock={cardIn} width={W} top={insets.top + 104} tilt={tilt} />
        </View>
      </Animated.View>

      <Animated.View style={[styles.bar, { top: 0, height: H * 0.13 }, barTop]} pointerEvents="none">
        <View style={[styles.barRow, { paddingTop: insets.top }]}>
          <Animated.View style={[styles.recDot, rec]} />
          <Text style={styles.barText}>SLOW-MO</Text>
          <View style={styles.grow} />
          <Text style={styles.barText}>SUN · {numbers.stamp.time}</Text>
        </View>
      </Animated.View>
      <Animated.View style={[styles.bar, { bottom: 0, height: H * 0.13 }, barBottom]} pointerEvents="none">
        <Text style={styles.barCaption}>One lesson left. Mina leads by a hair.</Text>
      </Animated.View>
      <Rewind r={r} ambient={ambient} layout={L} />
      <Animated.View style={[StyleSheet.absoluteFill, styles.flash, flash]} pointerEvents="none" />

      <Pressable onPress={() => router.back()} style={[styles.close, { top: insets.top + 8 }]} hitSlop={10}>
        <SymbolView name="xmark" size={16} weight="bold" tintColor={TONE.white} />
      </Pressable>

      {ended ? (
        <Animated.View entering={FadeInDown} style={[styles.footer, { bottom: insets.bottom + 26 }]}>
          <Chunky look="molten" icon="arrow.counterclockwise" onPress={replay} style={styles.again} />
          <Chunky
            look="molten"
            icon="square.and.arrow.up"
            label="Share my week"
            onPress={() => {
              play('tap');
              Presets.System.impactMedium();
            }}
            style={styles.grow}
          />
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // Gold's, as it opens on Gold before the sky's drawn
  root: { flex: 1, backgroundColor: WORLD.gold.bottom, overflow: 'hidden' },
  abs: { position: 'absolute', left: 0, top: 0 },
  flash: { backgroundColor: '#FFFFFF' },
  words: { position: 'absolute', left: 0, right: 0, alignItems: 'center', gap: 8 },
  close: {
    position: 'absolute',
    right: 14,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: TONE.glass,
    borderWidth: 1,
    borderColor: TONE.glassEdge,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  footer: { position: 'absolute', left: 24, right: 24, flexDirection: 'row', gap: 14 },
  warmth: {
    experimental_backgroundImage:
      'linear-gradient(180deg, rgba(150, 40, 0, 0.18) 0%, rgba(150, 50, 0, 0.06) 40%, rgba(120, 36, 0, 0.42) 100%)',
  },
  bar: { position: 'absolute', left: 0, right: 0, backgroundColor: '#07091F', justifyContent: 'center' },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 22 },
  recDot: { width: 9, height: 9, borderRadius: 4.5, backgroundColor: '#FF3B30' },
  barText: { fontFamily: ROUNDED, fontWeight: '900', fontSize: 13, letterSpacing: 2, color: TONE.white },
  barCaption: {
    textAlign: 'center',
    fontFamily: ROUNDED,
    fontWeight: '800',
    fontSize: 15,
    color: TONE.goldLight,
    paddingBottom: 12,
  },
  grow: { flex: 1 },
  again: { width: 58 },
});
