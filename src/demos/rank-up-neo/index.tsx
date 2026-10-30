import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing,
  SensorType,
  useAnimatedSensor,
  useAnimatedStyle,
  useDerivedValue,
  useFrameCallback,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { Presets } from 'react-native-pulsar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { Burst } from '../daily-drop/fx';
import { Aurora, type Deck, type Pad, type Tunnel } from './aurora';
import { Board, BOARD_END, BOARD_SEQ, boardLayout, knockAt } from './board';
import { Chunky } from './button';
import { CONFETTI, MONO, TONE, WORLD, YOU } from './data';
import { GOLD, Ladder, ladderX } from './ladder';
import { Motes } from './motes';
import { Wind } from './sky';
import { SpinBadge } from './spin';
import { Streaks } from './ribbon';
import { HoloTitle, type Pose } from './holo';
import { titleLayout } from './title';
import { type Cue, useSounds } from './sounds';
import { makeTally } from './tally';
import { inOutCubic, mix, outBack, outCubic, settle, span } from './ui';

/**
 * Rank Up Neo: Rank Up (src/demos/rank-up) from the future, the same week and promotion in a world made
 * of light, a storm sky over a city of light and a grid floor running out to it, its board a hologram
 * HUD, its leg a light-suited one, its badges the set in assets/rank-up-neo. What follows is Rank Up's story, told the same way:
 *
 * Rank Up: the last seconds of a league week, and the promotion that comes of it.
 *
 * Each league is a world of its own colour, and going up changes the world. Silver's board, deep
 * blue, you fifth, the clock running out. Everyone else draws back and your row lifts out and climbs,
 * barging the ones above you aside a place each, over the promotion line, to the top. A crown drops
 * onto you and light blooms out in a burst of confetti. Claim it, and Silver's badge, which has sat
 * over the board all along, comes down into the middle and a ribbon of Gold's world opens out across
 * the screen under it.
 *
 * Then it winds itself up on a pad of light: it starts to turn, ticking, faster and faster, and every
 * turn charges it, lighting the pad's ring a dash at a time: light is pulled into it, it trembles.
 * Charged, it crouches and rockets up, the pad bursting out under it, and the camera goes with it, the
 * world dropping away below. (Neo's own way up from here.) It climbs up through a deck of grid, its
 * lines spreading out overhead as it comes down on you, a sheet of light as you pass through, then
 * falling away below; and through a second, straight into a tunnel of light, rushing past faster and
 * faster, cyan turning gold, and the badge flies off down it, away from you, into the point of gold
 * light at the end. Out of that Gold's badge is built out of light, a line at a time from the top
 * down, a ghost of it below the line, on a pad lighting up gold under it; and everything stops dead
 * for a beat as it's done while Gold's world blasts out from the middle. GOLD LEAGUE drops in a letter at a time and a glare sweeps across
 * it; then the leagues line up, the track lights from Silver to Gold, and Gold's badge stamps down.
 */

/** The promotion's beats, in seconds */
const SEQ = {
  fly: 0,
  band: 0.3,
  hit: 0.5,
  /** The clock waits here while you spin the badge up */
  wait: 0.8,
  /** Charged, it crouches and rockets up; the camera climbs with it, through the bank of cloud */
  launch: 0.98,
  rise: 1.12,
  /** Out of the clouds into the tunnel; the badge flies off down it, gone at the end of it */
  bank: 1.55,
  apex: 1.95,
  swallow: 2.4,
  /** It comes back out of the tunnel Gold and lands */
  emerge: 2.95,
  smash: 3.45,
  boom: 3.48,
  pill: 3.8,
  title: 3.95,
  shine: 4.5,
  sub: 4.55,
  ladder: 4.8,
  fill: 5.25,
  stamp: 5.7,
  buttons: 6.2,
};
/** How long replaying waits on the empty world before it starts over */
const REPLAY_WAIT = 1.5;
const END = 6.85;
/** When the tunnel starts to show, through the bank of cloud */
const TUNNEL = SEQ.bank - 0.1;
/** How long the glare takes to sweep across the screen, and how far past either side it starts and ends */
const SHINE = 0.7;
/** The freeze as it lands: the promotion's clock stops there for HOLD seconds, then lets go */
const FREEZE = SEQ.smash;
const HOLD = 0.14;
/** How long the ribbon takes to open out */
const BAND_IN = 0.35;
const SHINE_PAD = 200;
const TITLE = 'GOLD LEAGUE';
/** How tall the title's capitals are (pt), and where each letter of it goes */
const TITLE_CAP = 32;
const TITLE_AT = titleLayout(TITLE, TITLE_CAP);
/** Degrees of spinning it takes to charge the badge */
const CHARGE = 1600;
/** How hard it winds itself up (degrees a second, each second) */
const SPIN_UP = 1600;
/** How big the badge is parked over the board */
const PARK = 0.5;
/** How far the badge crouches before it launches */
const CROUCH = 26;
/** How far the camera climbs, in screen heights */
const CLIMB = 5;
/** No tunnel */
const NO_TUNNEL: Tunnel = { on: 0, warp: 0, run: 0 };
/** No pad of light */
const NO_PAD: Pad = { x: 0, y: 0, r: 0, on: 0, charge: 0, turn: 0 };
/** How far the world drops away below for each screen height the camera climbs */
const LIFT = 0.25;

/** How far through the climb (0 to 1) the camera is at `t` */
const climbAt = (t: number) => {
  'worklet';
  return inOutCubic(span(t, SEQ.rise - 0.08, SEQ.apex - SEQ.rise + 0.08));
};

/**
 * The decks of grid the camera climbs up through on the way up, as how far through the climb (0 to 1)
 * each is: one soon after it launches, and the last as the tunnel opens out of it
 */
const DECKS = [climbAt(SEQ.rise + 0.16), climbAt(SEQ.bank)];
/** How far apart, in camera heights, a deck is from the camera for the whole climb */
const DECK_H = 5;
/** No deck */
const NO_DECK: Deck = { h: 0, on: 0 };

/** A jolt, `d` seconds after a hit: nothing before it, dying away fast */
const jolt = (d: number, hz: number) => {
  'worklet';
  return d > 0 && d < 0.6 ? Math.sin(d * hz) * Math.exp(-d * 9) : 0;
};

/** When the glare sweeping across passes x, on a screen `width` wide */
const shineAt = (x: number, width: number) => {
  'worklet';
  return SEQ.shine + (SHINE * (x + SHINE_PAD)) / (width + SHINE_PAD * 2);
};

export default function RankUpNeo() {
  const { width: W, height: H } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const play = useSounds();

  /** The board's clock, the promotion's, and one that's always running for things that drift */
  const u = useSharedValue(0);
  const t = useSharedValue(0);
  const ambient = useSharedValue(0);
  /**
   * Spinning up: 0 before it starts, 1 while it winds up, 2 once it's charged. How far round it's
   * turned and how fast it's going (degrees, a second), how charged it is (0 to 1), and, once it's
   * charged, the turn it went from and the face-on turn it ends on
   */
  const phase = useSharedValue(0);
  const turn = useSharedValue(0);
  const vel = useSharedValue(0);
  const energy = useSharedValue(0);
  const lastTurn = useSharedValue(0);
  const quarter = useSharedValue(0);
  const goFrom = useSharedValue(0);
  const goTo = useSharedValue(0);

  const lastTick = useRef(0);
  const tick = useCallback(
    (e: number) => {
      // A tick each quarter turn, as fast as they can be told apart
      const now = Date.now();
      if (now - lastTick.current < 55) return;
      lastTick.current = now;
      play('tick', 0.5 + 0.5 * e);
      if (e > 0.6) Presets.System.impactMedium();
      else Presets.System.impactLight();
    },
    [play]
  );
  const launchRef = useRef(() => {});
  const charged = useCallback(() => launchRef.current(), []);

  useFrameCallback((f) => {
    const dt = (f.timeSincePreviousFrame ?? 0) / 1000;
    // Stopping with everything else in the freeze as it lands
    if (t.value !== FREEZE) ambient.value += dt;
    if (phase.value !== 1) return;
    // Faster and faster
    vel.value += SPIN_UP * dt;
    turn.value += vel.value * dt;
    energy.value = Math.min(1, energy.value + Math.abs(turn.value - lastTurn.value) / CHARGE);
    lastTurn.value = turn.value;
    const q = Math.floor(turn.value / 90);
    if (q !== quarter.value) {
      quarter.value = q;
      scheduleOnRN(tick, energy.value);
    }
    if (energy.value >= 1) {
      phase.value = 2;
      // On round, fast, to face you as the camera starts to climb
      goFrom.value = turn.value;
      goTo.value = (vel.value < 0 ? Math.floor((turn.value - 540) / 360) : Math.ceil((turn.value + 540) / 360)) * 360;
      scheduleOnRN(charged);
    }
  });

  const [stage, setStage] = useState<'board' | 'promote'>('board');
  const [tally] = useState(makeTally);
  const [claim, setClaim] = useState(false);
  const [done, setDone] = useState(false);
  /** The board, kept only while it's on screen: out of the tree once it's gone, so every frame's commit is lighter */
  const [boardShown, setBoardShown] = useState(true);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const HERO = Math.min(W * 0.56, 230);
  const board = boardLayout(W, insets.top);
  const boardFirst = board.first;
  const centreY = insets.top + H * 0.3;
  const pillY = centreY + HERO * 0.56 + 8;
  const titleY = pillY + 40;
  const subY = titleY + TITLE_AT.height + 16;
  const ladderY = subY + 84;
  /** Where the badge hangs as the camera climbs with it */
  const hoverY = centreY + H * 0.02;
  const landAt = { x: W / 2, y: centreY };
  const reach = H * CLIMB;

  const at = useCallback((s: number, fn: () => void) => {
    timers.current.push(setTimeout(fn, s * 1000));
  }, []);
  const clear = useCallback(() => {
    for (const id of timers.current) clearTimeout(id);
    timers.current = [];
  }, []);

  const runBoard = useCallback(() => {
    const B = BOARD_SEQ;
    const cue = (s: number, c: Cue, gain = 1) => at(s, () => play(c, gain));
    t.set(0);
    u.set(0);
    u.set(withTiming(BOARD_END, { duration: BOARD_END * 1000, easing: Easing.linear }));
    cue(0.05, 'swish', 0.7);
    for (let j = 0; j < 8; j++) cue(B.rows + j * B.gap, 'drop', 0.6);
    cue(B.dim, 'lights');
    at(B.dim + 0.05, () => Presets.System.impactMedium());
    cue(B.hunt, 'spot');
    at(B.hunt, () => Presets.System.impactLight());
    at(B.hunt + 0.09, () => Presets.System.impactLight());
    cue(B.lock + 0.05, 'lift');
    at(B.lift, () => Presets.System.impactMedium());
    for (let k = 0; k < YOU; k++) {
      const s = B.climb + k * B.step;
      // Your XP ticking up as the coins knocked out of them land on it
      at(knockAt(k) + 0.6, () => {
        tally.set({ xpStep: k + 1 });
        play('xp', 0.8);
      });
      cue(s, `climb${k}` as Cue);
      // The leg swinging through, and landing
      cue(knockAt(k) - 0.13, 'swing');
      at(knockAt(k), () => {
        tally.set({ passed: k + 1, seconds: 4 - k });
        play('knock', 0.8);
        if (k === YOU - 1) Presets.System.impactHeavy();
        else Presets.System.impactMedium();
      });
      if (k === 1) {
        cue(s + B.move * 0.5, 'zone');
        at(s + B.move * 0.5, () => Presets.System.impactLight());
      }
    }
    cue(B.crown, 'drop', 0.9);
    at(B.boom, () => {
      tally.set({ seconds: 0, gold: 1 });
      play('boom');
      Presets.System.impactHeavy();
    });
    at(B.boom + 0.08, () => Presets.System.impactHeavy());
    cue(B.boom + 0.02, 'cannon', 0.9);
    cue(B.boom + 0.14, 'cannon', 0.8);
    cue(B.done, 'pop', 0.6);
    at(B.done, () => setClaim(true));
  }, [at, play, t, tally, u]);

  const resetSpin = () => {
    phase.set(0);
    turn.set(0);
    vel.set(0);
    energy.set(0);
    lastTurn.set(0);
    quarter.set(0);
  };

  const promote = () => {
    clear();
    resetSpin();
    setClaim(false);
    setStage('promote');
    play('tap');
    Presets.System.impactMedium();
    t.set(0);
    t.set(withTiming(SEQ.wait, { duration: SEQ.wait * 1000, easing: Easing.linear }));
    const cue = (s: number, c: Cue, gain = 1) => at(s, () => play(c, gain));
    cue(SEQ.fly, 'swish');
    cue(SEQ.band, 'swish', 0.9);
    cue(SEQ.hit, 'drop', 0.9);
    at(SEQ.hit, () => Presets.System.impactMedium());
    // Gone by now, faded out under the badge
    at(0.6, () => setBoardShown(false));
    at(SEQ.wait, () => {
      phase.set(1);
      play('pop', 0.5);
    });
  };

  const launch = () => {
    clear();
    t.set(
      withSequence(
        withTiming(FREEZE, { duration: (FREEZE - SEQ.wait) * 1000, easing: Easing.linear }),
        withDelay(HOLD * 1000, withTiming(END, { duration: (END - FREEZE) * 1000, easing: Easing.linear }))
      )
    );
    // From where the clock is now, waiting out the freeze from the burst on
    const later = (s: number) => (s >= SEQ.boom ? s + HOLD : s) - SEQ.wait;
    const cue = (s: number, c: Cue, gain = 1) => at(later(s), () => play(c, gain));
    const tap = (s: number, fn: () => void) => at(later(s), fn);
    cue(SEQ.wait, 'spin');
    tap(SEQ.wait, () => Presets.System.impactMedium());
    cue(SEQ.launch, 'launch');
    tap(SEQ.launch, () => Presets.System.impactHeavy());
    cue(SEQ.rise, 'whoosh');
    // A rumble all the way up, hardest through the bank
    for (let s = SEQ.rise; s < SEQ.apex; s += 0.07) {
      const near = Math.abs(s - SEQ.bank) < 0.15;
      tap(s, () => (near ? Presets.System.impactMedium() : Presets.System.impactLight()));
    }
    // Through a deck of grid; then through the last and the jump into space, its VOOM 0.2s into it
    cue(SEQ.rise + 0.13, 'deck');
    tap(SEQ.rise + 0.16, () => Presets.System.impactHeavy());
    cue(SEQ.bank - 0.2, 'warp');
    tap(SEQ.bank, () => Presets.System.impactHeavy());
    // Flying through space down the tunnel, the light rushing past felt going by, and the badge gone at
    // the end of it: the sound's ting as it reaches the light 0.85s in, its swell up to Gold's badge 1.4s in
    cue(SEQ.swallow - 0.85, 'tunnel');
    for (let s = SEQ.apex; s < SEQ.emerge; s += 0.07) tap(s, () => Presets.System.impactLight());
    tap(SEQ.swallow, () => Presets.System.impactMedium());
    cue(SEQ.emerge, 'rez');
    // Faster and faster taps as it rushes out at you
    for (let k = 0, s = SEQ.emerge; s < SEQ.smash; k++, s += Math.max(0.03, 0.09 * Math.pow(0.8, k))) {
      tap(s, () => Presets.System.impactLight());
    }
    cue(SEQ.smash, 'boom');
    tap(SEQ.smash, () => Presets.System.impactHeavy());
    cue(SEQ.boom, 'promote');
    tap(SEQ.boom, () => Presets.System.impactHeavy());
    tap(SEQ.boom + 0.07, () => Presets.System.impactHeavy());
    tap(SEQ.boom + 0.16, () => Presets.System.impactMedium());
    cue(SEQ.boom + 0.05, 'cannon', 0.8);
    for (let i = 0; i < TITLE.length; i++) if (TITLE[i] !== ' ') cue(SEQ.title + i * 0.04, 'drop', 0.45);
    cue(SEQ.title + 0.2, 'fanfare');
    cue(SEQ.shine, 'spot', 0.6);
    for (let i = 0; i < 5; i++) cue(SEQ.ladder + 0.1 + i * 0.07, 'pop', 0.4);
    tap(SEQ.ladder + 0.1, () => Presets.System.impactLight());
    cue(SEQ.fill, 'xp');
    cue(SEQ.stamp + 0.14, 'knock');
    cue(SEQ.stamp + 0.14, 'zone', 0.7);
    tap(SEQ.stamp + 0.14, () => Presets.System.impactHeavy());
    cue(SEQ.buttons, 'pop', 0.5);
    tap(SEQ.buttons, () => setDone(true));
  };
  // Charging finishes on the UI thread, which calls back through this
  useEffect(() => {
    launchRef.current = launch;
  });

  const replay = () => {
    clear();
    resetSpin();
    play('tap');
    setStage('board');
    setBoardShown(true);
    tally.reset();
    setDone(false);
    setClaim(false);
    // Back to before anything's come in, and a beat of the empty world before it starts over, so
    // there's time to get a recording going
    t.set(0);
    u.set(0);
    at(REPLAY_WAIT, runBoard);
  };

  useEffect(() => {
    runBoard();
    return clear;
  }, [runBoard, clear]);

  // ---- The tunnel ----

  // Out of the clouds straight into it, and down it faster and faster, cyan turning gold, till the badge
  // comes back out of it and Gold's world has blasted out over it
  const tunnel = useDerivedValue((): Tunnel => {
    const now = t.value;
    const into = now - TUNNEL;
    if (into < 0 || now > SEQ.smash + 0.4) return NO_TUNNEL;
    const long = SEQ.smash - TUNNEL;
    return {
      on: span(now, TUNNEL, 0.4),
      warp: span(now, TUNNEL, long),
      // Rushing past at 3, and 12 by the end of it
      run: 3 * into + (4.5 * into * into) / long,
    };
  });
  /** How far down the tunnel the badge has flown (0 to 1), away from you, to the point of light */
  const dived = useDerivedValue(() => span(t.value, SEQ.bank, SEQ.swallow - SEQ.bank));

  // ---- The badge: parked over the board, then down into the middle of the sky ----

  const fly = useDerivedValue(() => inOutCubic(span(t.value, SEQ.fly, SEQ.hit)));
  // The board done and the promotion waiting to be claimed: the badge grown, and calling for the tap
  const beckon = useDerivedValue(() => span(u.value, BOARD_SEQ.done, 0.5) * (1 - fly.value));
  const heroY = useDerivedValue(() => {
    const now = t.value;
    // Crouching; rocketing up and hanging there as the camera climbs with it; flying off down the
    // tunnel to the point of light in the middle of it; and built again, Gold, in the middle
    if (now >= SEQ.wait && now < SEQ.launch) {
      return centreY + CROUCH * Math.sin(span(now, SEQ.wait, SEQ.launch - SEQ.wait) * 1.57);
    }
    if (now >= SEQ.launch && now < SEQ.bank) {
      const rumble = Math.sin(ambient.value * 47) * 3 * span(now, SEQ.rise, 0.2);
      return mix(centreY + CROUCH, hoverY, outCubic(span(now, SEQ.launch, SEQ.rise - SEQ.launch + 0.1))) + rumble;
    }
    if (now >= SEQ.bank && now < SEQ.swallow) return mix(hoverY, H / 2, outCubic(dived.value));
    if (now >= SEQ.emerge && now < SEQ.smash) return landAt.y;
    const enter = settle(u.value - 0.05, 1.6, 6);
    const parked = board.park.y - (1 - enter) * 140 - 10 * beckon.value;
    const bob = Math.sin(ambient.value * 2) * 5 * fly.value * span(now, SEQ.boom + 0.4, 0.6);
    return mix(parked, centreY, fly.value) + bob;
  });
  // How far off it is: dwindling to nothing as it flies off down the tunnel, and swelling a touch as
  // it's finished being built
  const near = useDerivedValue(() => {
    const now = t.value;
    if (now >= SEQ.bank && now < SEQ.swallow) return Math.pow(1 - dived.value, 1.6);
    if (now >= SEQ.smash && now < SEQ.boom) return 1.08;
    return 1;
  });
  /**
   * Gold's badge built out of light, top down, as it comes out of the tunnel (0 to 1): solid above a
   * line of white-hot light sweeping down it, a ghost of light below
   */
  const rez = useDerivedValue(() =>
    t.value < SEQ.emerge ? 1 : inOutCubic(span(t.value, SEQ.emerge + 0.04, SEQ.smash - SEQ.emerge - 0.06))
  );
  // Gone from when it reaches the end of the tunnel till it comes back out
  const shown = useDerivedValue((): number => {
    const now = t.value;
    return now > SEQ.swallow - 0.03 && now < SEQ.emerge ? 0 : 1;
  });

  // ---- The sky it climbs through ----

  const climb = useDerivedValue(() => reach * climbAt(t.value));
  // The world held down behind the board so it reads, coming up full for the promotion, and held down a
  // little again behind the title
  const dim = useDerivedValue(() => mix(0.55, 1, span(t.value, 0, 0.5)) * (1 - 0.2 * span(t.value, SEQ.title, 0.6)));
  // The world dropping away below as the camera climbs, and Gold's there all round once it's out of the tunnel
  const lift = useDerivedValue(() => (t.value < SEQ.emerge ? (LIFT * climb.value) / H : 0));
  // The pad of light under the badge: lit as it lands on the ribbon, lighting a dash at a time as it
  // charges and bursting out as it launches; and under Gold's, lighting up as it's built
  const pad = useDerivedValue((): Pad => {
    const now = t.value;
    const silver = span(now, SEQ.hit - 0.1, 0.3) * (1 - span(now, SEQ.launch, 0.3));
    const gold = span(now, SEQ.emerge, 0.3);
    const on = Math.max(silver, gold);
    if (on <= 0) return NO_PAD;
    return {
      x: W / 2,
      y: centreY + HERO * 0.47,
      // Bursting out as it launches; back to its size under Gold's
      r: HERO * 0.62 * (now < SEQ.emerge ? 1 + 1.2 * outCubic(span(now, SEQ.launch, 0.3)) : 1),
      on,
      charge: now >= SEQ.emerge ? rez.value : energy.value,
      turn: ambient.value * 0.04 + turn.value / 3600,
    };
  });
  // How fast it's climbing, for the wind: up as it launches, gone by the time it's in the tunnel
  const speed = useDerivedValue(() => Math.sin(Math.PI * span(t.value, SEQ.rise - 0.08, SEQ.apex - SEQ.rise + 0.08)));
  // The nearest deck of grid the camera's climbing up through, above it or below
  const deck = useDerivedValue((): Deck => {
    const now = t.value;
    if (now < SEQ.launch || now > TUNNEL + 0.3) return NO_DECK;
    const k = climbAt(now);
    const d = Math.abs(k - DECKS[0]) < Math.abs(k - DECKS[1]) ? DECKS[0] : DECKS[1];
    return { h: (d - k) * DECK_H, on: span(now, SEQ.launch, 0.15) * (1 - span(now, TUNNEL, 0.3)) };
  });
  const bandAt = useDerivedValue(() => ({ x: W / 2, y: centreY + climb.value * 0.5 }));
  // How charged it is, sinking away as it launches
  const charge = useDerivedValue(() => energy.value * (1 - span(t.value, SEQ.launch, 0.12)));
  const boomed = useDerivedValue(() => t.value - SEQ.boom);

  // ---- The world ----

  const focus = useDerivedValue(() => ({ x: W / 2, y: heroY.value }));
  const glow = useDerivedValue(() => {
    const d = boomed.value;
    if (d > 0) return 0.3 + 0.9 * Math.exp(-d * 2.5);
    // None in the tunnel
    const lit = Math.max(0.25 + 0.65 * charge.value * charge.value, 0.3 * (1 - span(u.value, BOARD_SEQ.dim, 0.3)));
    return lit * (1 - tunnel.value.on);
  });
  // Opening out from a thin line, springing a little past and back; the badge lands on it
  const band = useDerivedValue(() => outBack(span(t.value, SEQ.band, BAND_IN), 1.6));
  // The streaks along the ribbon gone once it's left behind
  const streaking = useDerivedValue(() => band.value * (1 - span(t.value, SEQ.launch, 0.15)));
  // Gold's world blasting out of the middle as the badge comes out of the tunnel, held mid-blast in the freeze
  const flood = useDerivedValue(() => outCubic(span(t.value, SEQ.smash - 0.1, 0.35)));
  const rays = useDerivedValue(() => {
    const now = t.value;
    const board = outCubic(span(u.value, BOARD_SEQ.boom, 0.6)) * (1 - span(now, 0, 0.4));
    return Math.max(board, outCubic(span(now, SEQ.boom, 0.6)));
  });
  const raysAt = useDerivedValue(() => (t.value <= 0.2 ? boardFirst : landAt));
  // Which way the phone's tipped, for the Gold badge's foil: drifting a little on its own as well, so
  // it shimmers lying flat on a table too
  const gravity = useAnimatedSensor(SensorType.GRAVITY, { interval: 'auto' });
  const tilt = useDerivedValue(() => {
    const g = gravity.sensor.value;
    const n = Math.max(1e-3, Math.hypot(g.x, g.y, g.z));
    const a = ambient.value;
    return { x: g.x / n + 0.35 * Math.sin(a * 0.9), y: (g.y / n + 0.6) * 0.8 + 0.25 * Math.cos(a * 0.7) };
  });
  const bloomBoard = useDerivedValue(() => span(u.value, BOARD_SEQ.boom, 1));
  const bloomPromote = useDerivedValue(() => span(t.value, SEQ.boom, 1.1));
  const motesIn = useDerivedValue(() => Math.min(1, energy.value * 2.5) * (1 - span(t.value, SEQ.launch, 0.15)));
  const dust = useDerivedValue(() => Math.max(span(u.value, BOARD_SEQ.boom, 0.8), span(t.value, SEQ.boom, 0.8)));

  // ---- Everything shakes when something goes off ----

  const shake = useAnimatedStyle(() => {
    const a = boomed.value;
    const b = u.value - BOARD_SEQ.boom;
    const c = t.value - SEQ.hit;
    // Rumbling the whole way up, and on down the tunnel
    const down = Math.sin(Math.PI * span(t.value, SEQ.apex, SEQ.emerge - SEQ.apex));
    const rumble = Math.sin(ambient.value * 61) * (2.5 * speed.value + 2 * down);
    // Your row barging past each one on the board
    let knocks = 0;
    for (let k = 0; k < YOU; k++) knocks += jolt(u.value - knockAt(k), 60);
    return {
      transform: [
        { translateX: jolt(a, 70) * 20 + jolt(b, 64) * 7 + jolt(c, 60) * 4 + knocks * 4 + rumble },
        { translateY: jolt(a + 0.02, 55) * 18 + jolt(b + 0.02, 52) * 6 + jolt(c + 0.02, 50) * 6 },
      ],
    };
  });
  const flash = useAnimatedStyle(() => {
    const a = boomed.value;
    const b = u.value - BOARD_SEQ.boom;
    return { opacity: Math.max(a > 0 ? 0.6 * Math.exp(-a * 9) : 0, b > 0 ? 0.4 * Math.exp(-b * 8) : 0) };
  });
  const pillar = useAnimatedStyle(() => {
    const k = span(t.value, SEQ.boom, 0.8);
    return {
      opacity: k > 0 && k < 1 ? Math.pow(1 - k, 1.5) : 0,
      transform: [{ scaleX: mix(0.04, 1.5, outCubic(k)) }],
    };
  });
  const boardOut = useAnimatedStyle(() => {
    const k = inOutCubic(span(t.value, 0, 0.5));
    return { opacity: 1 - k, transform: [{ translateY: k * 80 }, { scale: mix(1, 0.94, k) }] };
  });

  const burst = useDerivedValue(() => Math.max(0, boomed.value));
  const stamped = useDerivedValue(() => Math.max(0, t.value - SEQ.stamp - 0.14));
  // A glare sweeping across everything once the title's down
  const shine = useAnimatedStyle(() => {
    const k = span(t.value, SEQ.shine, SHINE);
    return {
      opacity: k > 0 && k < 1 ? 1 : 0,
      transform: [{ translateX: mix(-SHINE_PAD, W + SHINE_PAD, k) - 95 }, { rotate: '18deg' }],
    };
  });

  // ---- The words ----

  const pill = useAnimatedStyle(() => {
    const d = t.value - SEQ.pill;
    return {
      opacity: d > 0 ? 1 : 0,
      transform: [{ scale: settle(d, 2, 6) }, { rotate: `${(1 - settle(d, 1.4, 6)) * -12}deg` }],
    };
  });
  // Each letter of the title dropping in big and slamming down; then hopping as the glare passes it
  const pose = (now: number, i: number, centre: number): Pose => {
    'worklet';
    const d = now - SEQ.title - i * 0.04;
    const k = settle(d, 1.9, 6.5);
    const wave = Math.exp(-Math.pow((now - shineAt(centre, W)) / 0.07, 2));
    return {
      y: (1 - k) * -70 - wave * 7,
      scale: mix(2.2, 1, outBack(Math.min(1, d * 4), 1.2)) + wave * 0.16,
      opacity: d > 0 ? Math.min(1, d * 12) : 0,
    };
  };
  // The glare over the title's foil: sweeping across with the glare over everything, then again every
  // few seconds
  const glint = useDerivedValue(() => {
    const now = t.value;
    const into = now - SEQ.shine;
    if (into < SHINE) return (into / SHINE) * 1.4 - 0.2;
    return ((ambient.value * 0.4) % 1.6) - 0.3;
  });
  // A band of shade behind the title, so its lines of light read over the city on the horizon
  const shade = useAnimatedStyle(() => ({ opacity: span(t.value, SEQ.title - 0.1, 0.4) }));
  const sub = useAnimatedStyle(() => {
    const k = outCubic(span(t.value, SEQ.sub, 0.45));
    return { opacity: k, transform: [{ translateY: (1 - k) * 16 }] };
  });
  const buttons = useAnimatedStyle(() => {
    const d = t.value - SEQ.buttons;
    return { opacity: d > 0 ? 1 : 0, transform: [{ translateY: (1 - settle(d, 1.4, 6.5)) * 160 }] };
  });
  const claimIn = useAnimatedStyle(() => {
    const d = u.value - BOARD_SEQ.done;
    const out = span(t.value, 0, 0.25);
    return {
      opacity: (d > 0 ? 1 : 0) * (1 - out),
      transform: [{ translateY: (1 - settle(d, 1.4, 6.5)) * 160 + out * 40 }],
    };
  });

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      {/* No camera zoom: scaling the whole screen up blurred every image and line of text on it */}
      <View style={StyleSheet.absoluteFill}>
        <Aurora
          width={W}
          height={H}
          clock={ambient}
          focus={focus}
          glow={glow}
          band={band}
          flood={flood}
          bandAt={bandAt}
          floodAt={landAt}
          rays={rays}
          raysAt={raysAt}
          blooms={[bloomBoard, board.first, bloomPromote, landAt]}
          tunnel={tunnel}
          lift={lift}
          dim={dim}
          deck={deck}
          pad={pad}
        />

        <Animated.View style={[StyleSheet.absoluteFill, shake]}>
          <Streaks width={W} height={H} x={W / 2} y={centreY} clock={ambient} band={streaking} flood={flood} />
          <Motes width={W} height={H} x={W / 2} y={heroY} ambient={ambient} charge={motesIn} dust={dust} />

          {boardShown ? (
            <Animated.View style={[StyleSheet.absoluteFill, boardOut]} pointerEvents="none">
              <Board clock={u} width={W} height={H} layout={board} tally={tally} />
            </Animated.View>
          ) : null}

          <Animated.View style={[styles.pillar, { left: W / 2 - W * 0.3, width: W * 0.6, height: H }, pillar]} />
          <Wind width={W} height={H} layer="back" climb={climb} speed={speed} />
          <Badge
            clock={t}
            board={u}
            ambient={ambient}
            y={heroY}
            near={near}
            shown={shown}
            size={HERO}
            rez={rez}
            beckon={beckon}
            charge={charge}
            width={W}
            spin={{ phase, turn, from: goFrom, to: goTo }}
            tilt={tilt}
          />
          <Wind width={W} height={H} layer="front" climb={climb} speed={speed} />

          <Burst
            clock={burst}
            x={W / 2}
            y={centreY}
            kind="confetti"
            palette={CONFETTI}
            count={110}
            life={3}
            power={1.15}
          />
          <Burst
            clock={burst}
            x={W / 2}
            y={centreY}
            kind="sparkle"
            palette={['#FFFFFF', TONE.goldLight, TONE.goldPale]}
            count={40}
            life={1.5}
            power={1.6}
          />

          {/* Mounted from the start, hidden until their beats, so claiming doesn't hitch building them */}
          <>
            <Animated.View
              style={[styles.shade, { top: titleY - 30, height: subY - titleY + 64, width: W }, shade]}
              pointerEvents="none"
            />
            <Animated.View style={[styles.centre, { top: pillY, width: W }, pill]}>
              <View style={styles.pill}>
                <SymbolView name="chevron.up.2" size={10} weight="bold" tintColor={TONE.goldLight} />
                <Text style={styles.pillText}>PROMOTED</Text>
                <SymbolView name="chevron.up.2" size={10} weight="bold" tintColor={TONE.goldLight} />
              </View>
            </Animated.View>
            <HoloTitle
              text={TITLE}
              cap={TITLE_CAP}
              light="gold"
              width={W}
              top={titleY}
              ambient={ambient}
              tilt={tilt}
              glint={glint}
              clock={t}
              from={SEQ.title}
              pose={pose}
            />
            <Animated.Text style={[styles.sub, { top: subY, width: W }, sub]}>
              Silver cleared. Gold League unlocked.
            </Animated.Text>
            <Ladder clock={t} width={W} y={ladderY} start={SEQ.ladder} fill={SEQ.fill} stamp={SEQ.stamp} />
            <Burst
              clock={stamped}
              x={ladderX(W, GOLD)}
              y={ladderY}
              kind="sparkle"
              palette={['#FFFFFF', TONE.goldLight, TONE.goldPale]}
              count={26}
              life={1.2}
              power={0.6}
            />
          </>
          <Animated.View style={[styles.shine, { top: -H * 0.25, height: H * 1.5 }, shine]} pointerEvents="none" />
        </Animated.View>
      </View>

      <Animated.View style={[StyleSheet.absoluteFill, styles.flash, flash]} pointerEvents="none" />

      {stage === 'board' ? (
        <Animated.View style={[styles.footer, { bottom: insets.bottom + 20 }, claimIn]}>
          <Chunky look="neon" icon="bolt.fill" label="Claim promotion" disabled={!claim} onPress={promote} />
        </Animated.View>
      ) : (
        <Animated.View style={[styles.footer, styles.row, { bottom: insets.bottom + 20 }, buttons]}>
          <Chunky
            look="molten"
            icon="arrow.counterclockwise"
            quiet
            disabled={!done}
            onPress={replay}
            style={styles.again}
          />
          <Chunky
            look="molten"
            label="Let's go"
            trailing="arrow.right"
            disabled={!done}
            onPress={() => router.back()}
            style={styles.grow}
          />
        </Animated.View>
      )}
    </View>
  );
}

/**
 * Silver's badge, then Gold's, a solid thing (spin.tsx). It lands on the ribbon with a squash, and
 * winds itself up, trembling and swelling as it charges. Charged, it whirls on round to face
 * you, crouches wide, shoots up stretched tall, and turns over once, slowly, as the camera climbs with
 * it, and on, faster, as it flies off down the tunnel; it comes back out of it Gold, spinning hard, white hot, swelling as it rushes at you, squashes flat as it
 * lands, and springs back out big.
 */
/** A thing landing `e` seconds ago: squashed wide, springing back and forth, settling */
const landing = (e: number, k = 0.3) => {
  'worklet';
  return e > 0 ? k * Math.exp(-e * 8) * Math.cos(e * 24) : 0;
};

type Spin = {
  /** Whether it's not yet spinning (0), winding up (1), or charged (2) */
  phase: SharedValue<number>;
  /** How far round it's turned, and, once it's charged, the turn it went from and ends on */
  turn: SharedValue<number>;
  from: SharedValue<number>;
  to: SharedValue<number>;
};

function Badge({
  clock,
  board,
  ambient,
  y,
  near,
  shown,
  size,
  rez,
  beckon,
  charge,
  width,
  spin,
  tilt,
}: {
  clock: SharedValue<number>;
  board: SharedValue<number>;
  ambient: SharedValue<number>;
  y: SharedValue<number>;
  /** How near it is (1 as it is, smaller far off), and whether it's showing */
  near: SharedValue<number>;
  shown: SharedValue<number>;
  size: number;
  rez: SharedValue<number>;
  /** How much it's calling to be claimed (0 to 1): grown, and every so often wobbling */
  beckon: SharedValue<number>;
  charge: SharedValue<number>;
  /** The screen's, for where its middle is and when the glare passes it */
  width: number;
  spin: Spin;
  tilt: SharedValue<{ x: number; y: number }>;
}) {
  const angle = useDerivedValue(() => {
    const t = clock.value;
    const to = spin.to.value;
    if (spin.phase.value < 2) return spin.turn.value;
    if (t < SEQ.rise) {
      const k = span(t, SEQ.wait, SEQ.rise - SEQ.wait);
      return mix(spin.from.value, to, 1 - Math.pow(1 - k, 1.6));
    }
    if (t < SEQ.bank) return to + 360 * inOutCubic(span(t, SEQ.rise, SEQ.bank - SEQ.rise));
    // Turning on, faster and faster, as it flies off down the tunnel
    if (t < SEQ.emerge) return to + 360 + 540 * Math.pow(span(t, SEQ.bank, SEQ.swallow - SEQ.bank), 2);
    // Swinging round to face you as it's built, and rocking after
    if (t < SEQ.boom) return mix(to + 1440 - 70, to + 1440, outCubic(span(t, SEQ.emerge, SEQ.smash - SEQ.emerge)));
    const d = t - SEQ.boom;
    return to + 1440 + 30 * Math.exp(-d * 4) * Math.sin(d * 14);
  });
  const body = useAnimatedStyle(() => {
    const t = clock.value;
    const c = charge.value;
    const a = ambient.value;
    const d = t - SEQ.boom;
    const pop = d > 0 ? 0.32 * Math.exp(-d * 4.5) * Math.cos(d * 13) : 0;
    const fly = inOutCubic(span(t, SEQ.fly, SEQ.hit));
    const enter = settle(board.value - 0.05, 1.6, 6);
    const breathe = t < SEQ.boom + 0.4 ? 1 : 1 + 0.02 * Math.sin(t * 2.4);
    // Squash and stretch, wide positive and tall negative
    let squash = landing(t - SEQ.hit, 0.22);
    if (t >= SEQ.wait && t < SEQ.launch) squash = 0.2 * Math.sin(span(t, SEQ.wait, SEQ.launch - SEQ.wait) * 1.57);
    else if (t >= SEQ.launch && t < SEQ.bank) squash = -0.24 * (1 - span(t, SEQ.rise, 0.2));
    else if (t >= SEQ.smash && t < SEQ.boom) squash = 0.2;
    else if (t >= SEQ.boom) squash = landing(d);
    // Waiting to be claimed: a wobble, a hop and a squash every couple of seconds
    const b = beckon.value;
    const beat = a % 1.9;
    const wob = b > 0 && beat < 0.8 ? Math.sin(beat * 26) * Math.exp(-beat * 4.5) : 0;
    if (b > 0) squash += 0.08 * b * landing(beat - 0.02, 1);
    return {
      opacity: shown.value,
      transform: [
        { translateX: width / 2 - size / 2 + Math.sin(a * 53) * 4 * c * c },
        { translateY: y.value - size / 2 },
        // On the screen's axes, not the badge's, so it reads the same however far round it's turned
        { scaleX: 1 + squash },
        { scaleY: 1 - squash },
        { rotateZ: `${Math.sin(a * 41) * 3 * c * c + wob * 10 * b}deg` },
        {
          scale:
            mix(PARK * enter, 1, fly) * (1 + 0.1 * c + pop + b * (0.16 + 0.06 * Math.abs(wob))) * breathe * near.value,
        },
      ],
    };
  });
  // Gold from when it's gone, out of sight
  const gold = useDerivedValue((): number => (clock.value < SEQ.swallow ? 0 : 1));
  // Gold's foil, once it's landed
  const holo = useDerivedValue(() => span(clock.value, SEQ.boom + 0.4, 0.6));
  // Washed white: glowing as it charges, a little as it's built, as it bursts, and as the glare sweeps past
  const white = useDerivedValue(() => {
    const t = clock.value;
    const d = t - SEQ.boom;
    const swept = 0.55 * Math.exp(-Math.pow((t - shineAt(width / 2, width)) / 0.07, 2));
    const glowing = 0.25 * Math.pow(charge.value, 3);
    const hot = t > SEQ.emerge && d < 0 ? 0.12 : 0;
    return Math.max(d > 0 ? 0.8 * Math.exp(-d * 6) : 0, swept, glowing, hot);
  });
  return (
    <Animated.View style={[styles.badge, { width: size, height: size }, body]} pointerEvents="none">
      <SpinBadge size={size} angle={angle} gold={gold} white={white} tilt={tilt} holo={holo} rez={rez} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: WORLD.silver.top, overflow: 'hidden' },
  badge: { position: 'absolute', left: 0, top: 0 },
  pillar: {
    position: 'absolute',
    top: 0,
    experimental_backgroundImage:
      'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.95) 50%, rgba(255,255,255,0) 100%)',
  },
  flash: { backgroundColor: '#FFFFFF' },
  centre: { position: 'absolute', left: 0, alignItems: 'center' },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 26,
    paddingHorizontal: 14,
    borderRadius: 13,
    backgroundColor: 'rgba(24, 13, 0, 0.7)',
    borderWidth: 1,
    borderColor: 'rgba(255, 200, 61, 0.7)',
    boxShadow: '0 0 14px rgba(255, 190, 50, 0.3), inset 0 0 10px rgba(255, 200, 61, 0.14)',
  },
  pillText: { fontFamily: MONO, fontSize: 10, letterSpacing: 3, color: TONE.goldLight },
  shade: {
    position: 'absolute',
    left: 0,
    experimental_backgroundImage:
      'linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.62) 30%, rgba(0,0,0,0.62) 70%, rgba(0,0,0,0) 100%)',
  },
  sub: {
    position: 'absolute',
    left: 0,
    textAlign: 'center',
    fontFamily: MONO,
    fontSize: 11,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    color: 'rgba(255, 241, 191, 0.72)',
    textShadowColor: TONE.shadeWarm,
    textShadowRadius: 6,
  },
  shine: {
    position: 'absolute',
    left: 0,
    width: 190,
    experimental_backgroundImage:
      'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.7) 50%, rgba(255,255,255,0) 100%)',
  },
  footer: { position: 'absolute', left: 20, right: 20 },
  row: { flexDirection: 'row', gap: 12 },
  grow: { flex: 1 },
  again: { width: 56 },
});
