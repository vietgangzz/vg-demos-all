import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
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
import { Aurora } from './aurora';
import { Board, BOARD_END, BOARD_SEQ, boardLayout, knockAt } from './board';
import { Chunky } from './button';
import { CONFETTI, MOLTEN, ROUNDED, TONE, WORLD, YOU } from './data';
import { GOLD, Ladder, ladderX } from './ladder';
import { Motes } from './motes';
import { Clouds, Meteor, meteorAt } from './sky';
import { SpinBadge } from './spin';
import { Streaks } from './ribbon';
import { type Cue, useSounds } from './sounds';
import { inOutCubic, mix, outBack, outCubic, settle, span } from './ui';

/**
 * Rank Up: the last seconds of a league week, and the promotion that comes of it.
 *
 * Each league is a world of its own colour, and going up changes the world. Silver's board, deep
 * blue, you fifth, the clock running out. Everyone else draws back and your row lifts out and climbs,
 * barging the ones above you aside a place each, over the promotion line, to the top. A crown drops
 * onto you and light blooms out in a burst of confetti. Claim it, and Silver's badge, which has sat
 * over the board all along, comes down into the middle and a ribbon of Gold's world opens out across
 * the screen under it.
 *
 * Then it winds itself up: it starts to turn, ticking, faster and faster, and every turn charges it:
 * light is pulled into it, it trembles, the camera leans in. Charged, it crouches and
 * rockets up, and the camera goes with it: clouds stream past, thicker and thicker, until it bursts
 * through a bank of them into Gold's sky, warm above the clouds. There it flies on up into the
 * distance until it's a star, twinkling; then it comes back down as a meteor, Gold, blazing, faster
 * and faster, and everything stops dead for a beat as it lands. GOLD LEAGUE drops in a letter at a
 * time and a glare sweeps across it; then the leagues line up, the track lights from Silver to Gold,
 * and Gold's badge stamps down.
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
  bank: 1.6,
  /** Above the clouds it flies on into the distance and shines there as a star */
  apex: 1.95,
  star: 2.2,
  /** It falls as a meteor, Gold, lands, and bursts */
  fall: 2.42,
  smash: 2.7,
  boom: 2.73,
  pill: 3.05,
  title: 3.2,
  shine: 3.75,
  sub: 3.8,
  ladder: 4.05,
  fill: 4.5,
  stamp: 4.95,
  buttons: 5.45,
};
const END = 6.1;
/** How long the glare takes to sweep across the screen, and how far past either side it starts and ends */
const SHINE = 0.7;
/** The freeze as it lands: the promotion's clock stops there for HOLD seconds, then lets go */
const FREEZE = SEQ.smash;
const HOLD = 0.14;
/** How far the camera leans in on the badge once it's fully charged */
const PUSH = 0.3;
/** How long the ribbon takes to open out */
const BAND_IN = 0.35;
const SHINE_PAD = 200;
const TITLE = 'GOLD LEAGUE';
/** Degrees of spinning it takes to charge the badge */
const CHARGE = 1600;
/** How hard it winds itself up (degrees a second, each second) */
const SPIN_UP = 1600;
/** How big the badge is parked over the board */
const PARK = 0.36;
/** How far the badge crouches before it launches */
const CROUCH = 26;
/** How far the camera climbs, in screen heights */
const CLIMB = 5;
/** How small the badge is, far off as a star */
const FAR = 0.07;

/** How far through the climb (0 to 1) the camera is at `t` */
const climbAt = (t: number) => {
  'worklet';
  return inOutCubic(span(t, SEQ.rise - 0.08, SEQ.apex - SEQ.rise + 0.08));
};

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

export default function RankUp() {
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
  const [passed, setPassed] = useState(0);
  const [xpStep, setXpStep] = useState(0);
  const [seconds, setSeconds] = useState(5);
  const [claim, setClaim] = useState(false);
  const [done, setDone] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const HERO = Math.min(W * 0.56, 230);
  const board = boardLayout(W, insets.top);
  const boardFirst = board.first;
  const centreY = insets.top + H * 0.3;
  const pillY = centreY + HERO * 0.56 + 8;
  const titleY = pillY + 40;
  const subY = titleY + 60;
  const ladderY = subY + 92;
  /** Where the badge hangs as the camera climbs with it, and where it shines as a star */
  const hoverY = centreY - H * 0.08;
  const star = { x: W * 0.72, y: insets.top + H * 0.11 };
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
      at(s - 0.18, () => {
        setXpStep(k + 1);
        play('xp', 0.8);
      });
      cue(s, `climb${k}` as Cue);
      at(s + B.move * 0.4, () => {
        setPassed(k + 1);
        setSeconds(4 - k);
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
      setSeconds(0);
      play('boom');
      Presets.System.impactHeavy();
    });
    at(B.boom + 0.08, () => Presets.System.impactHeavy());
    cue(B.boom + 0.02, 'cannon', 0.9);
    cue(B.boom + 0.14, 'cannon', 0.8);
    cue(B.done, 'pop', 0.6);
    at(B.done, () => setClaim(true));
  }, [at, play, t, u]);

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
    cue(SEQ.bank - 0.05, 'swish');
    cue(SEQ.star - 0.1, 'twinkle');
    tap(SEQ.star - 0.1, () => Presets.System.impactLight());
    cue(SEQ.fall, 'fall');
    // Faster and faster taps as it comes down
    for (let k = 0, s = SEQ.fall; s < SEQ.smash; k++, s += Math.max(0.03, 0.09 * Math.pow(0.8, k))) {
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
    setPassed(0);
    setXpStep(0);
    setSeconds(5);
    setDone(false);
    setClaim(false);
    runBoard();
  };

  useEffect(() => {
    runBoard();
    return clear;
  }, [runBoard, clear]);

  // ---- The badge: parked over the board, then down into the middle of the sky ----

  const fly = useDerivedValue(() => inOutCubic(span(t.value, SEQ.fly, SEQ.hit)));
  const heroY = useDerivedValue(() => {
    const now = t.value;
    // Crouching; rocketing up and hanging there as the camera climbs with it; flying off into the
    // distance; and falling back down as a meteor
    if (now >= SEQ.wait && now < SEQ.launch) {
      return centreY + CROUCH * Math.sin(span(now, SEQ.wait, SEQ.launch - SEQ.wait) * 1.57);
    }
    if (now >= SEQ.launch && now < SEQ.apex) {
      const rumble = Math.sin(ambient.value * 47) * 3 * span(now, SEQ.rise, 0.2);
      return mix(centreY + CROUCH, hoverY, outCubic(span(now, SEQ.launch, SEQ.rise - SEQ.launch + 0.1))) + rumble;
    }
    if (now >= SEQ.apex && now < SEQ.fall)
      return mix(hoverY, star.y, inOutCubic(span(now, SEQ.apex, SEQ.star - SEQ.apex)));
    if (now >= SEQ.fall && now < SEQ.smash) return meteorAt(span(now, SEQ.fall, SEQ.smash - SEQ.fall), star, landAt).y;
    const enter = settle(u.value - 0.05, 1.6, 6);
    const parked = board.park.y - (1 - enter) * 140;
    const bob = Math.sin(ambient.value * 2) * 5 * fly.value * span(now, SEQ.boom + 0.4, 0.6);
    return mix(parked, centreY, fly.value) + bob;
  });
  const heroX = useDerivedValue(() => {
    const now = t.value;
    if (now >= SEQ.apex && now < SEQ.fall)
      return mix(W / 2, star.x, inOutCubic(span(now, SEQ.apex, SEQ.star - SEQ.apex)));
    if (now >= SEQ.fall && now < SEQ.smash) return meteorAt(span(now, SEQ.fall, SEQ.smash - SEQ.fall), star, landAt).x;
    return W / 2;
  });
  // How far off it is: dwindling to a point as it flies into the distance, swelling back as it falls
  const near = useDerivedValue(() => {
    const now = t.value;
    if (now >= SEQ.apex && now < SEQ.fall) return mix(1, FAR, Math.pow(span(now, SEQ.apex, SEQ.star - SEQ.apex), 1.6));
    if (now >= SEQ.fall && now < SEQ.smash)
      return mix(FAR, 1.12, Math.pow(span(now, SEQ.fall, SEQ.smash - SEQ.fall), 2));
    if (now >= SEQ.smash && now < SEQ.boom) return 1.12;
    return 1;
  });
  // Gone while it's the star
  const shown = useDerivedValue((): number => {
    const now = t.value;
    return now > SEQ.star - 0.06 && now < SEQ.fall ? 0 : 1;
  });

  // ---- The sky it climbs through ----

  const climb = useDerivedValue(() => reach * climbAt(t.value));
  // How fast it's climbing, for the wind: up as it launches, gone by the time it's above the clouds
  const speed = useDerivedValue(() => Math.sin(Math.PI * span(t.value, SEQ.rise - 0.08, SEQ.apex - SEQ.rise + 0.08)));
  const warm = useDerivedValue(() => span(t.value, SEQ.bank, 0.25));
  const bandAt = useDerivedValue(() => ({ x: W / 2, y: centreY + climb.value * 0.5 }));
  // How charged it is, sinking away as it launches
  const charge = useDerivedValue(() => energy.value * (1 - span(t.value, SEQ.launch, 0.12)));
  const boomed = useDerivedValue(() => t.value - SEQ.boom);

  // ---- The world ----

  const focus = useDerivedValue(() => ({ x: heroX.value, y: heroY.value }));
  const glow = useDerivedValue(() => {
    const d = boomed.value;
    if (d > 0) return 0.3 + 0.9 * Math.exp(-d * 2.5);
    return Math.max(0.25 + 0.65 * charge.value * charge.value, 0.3 * (1 - span(u.value, BOARD_SEQ.dim, 0.3)));
  });
  // Opening out from a thin line, springing a little past and back; the badge lands on it
  const band = useDerivedValue(() => outBack(span(t.value, SEQ.band, BAND_IN), 1.6));
  // The streaks along the ribbon gone once it's left behind
  const streaking = useDerivedValue(() => band.value * (1 - span(t.value, SEQ.launch, 0.15)));
  // Gold's sky pouring in from overhead, behind the bank of cloud
  const flood = useDerivedValue(() => outCubic(span(t.value, SEQ.bank - 0.02, 0.3)));
  const rays = useDerivedValue(() => {
    const now = t.value;
    const board = outCubic(span(u.value, BOARD_SEQ.boom, 0.6)) * (1 - span(now, 0, 0.4));
    const shining = 0.8 * span(now, SEQ.apex + 0.1, 0.3) * (1 - span(now, SEQ.fall, 0.12));
    return Math.max(board, shining, outCubic(span(now, SEQ.boom, 0.6)));
  });
  const raysAt = useDerivedValue(() => {
    const now = t.value;
    if (now <= 0.2) return boardFirst;
    return now > SEQ.apex && now < SEQ.fall + 0.1 ? star : landAt;
  });
  const spin = useDerivedValue(() => ambient.value * 0.22);
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
    // Rumbling the whole way up
    const rumble = Math.sin(ambient.value * 61) * 2.5 * speed.value;
    // Your row barging past each one on the board
    let knocks = 0;
    for (let k = 0; k < YOU; k++) knocks += jolt(u.value - knockAt(k), 60);
    return {
      transform: [
        { translateX: jolt(a, 70) * 20 + jolt(b, 64) * 7 + jolt(c, 60) * 4 + knocks * 6 + rumble },
        { translateY: jolt(a + 0.02, 55) * 18 + jolt(b + 0.02, 52) * 6 + jolt(c + 0.02, 50) * 6 },
      ],
    };
  });
  // The camera leaning in on the badge as it's spun up, easing back out as it crouches, pushed a
  // little as it climbs, and punched in when it lands, pulsing back out (never past the edges)
  const camera = useAnimatedStyle(() => {
    const d = boomed.value;
    const lean = PUSH * Math.pow(energy.value, 2.2) * (1 - inOutCubic(span(t.value, SEQ.wait, 0.2)));
    const zoom = d > 0 ? 1 + 0.14 * Math.exp(-d * 5) * (0.5 + 0.5 * Math.cos(d * 12)) : 1 + lean + 0.05 * speed.value;
    const lift = centreY - H / 2;
    return { transform: [{ translateY: lift }, { scale: zoom }, { translateY: -lift }] };
  });
  const flash = useAnimatedStyle(() => {
    const a = boomed.value;
    const b = u.value - BOARD_SEQ.boom;
    return { opacity: Math.max(a > 0 ? 0.6 * Math.exp(-a * 9) : 0, b > 0 ? 0.7 * Math.exp(-b * 6) : 0) };
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
      <Animated.View style={[StyleSheet.absoluteFill, camera]}>
        <Aurora
          width={W}
          height={H}
          clock={ambient}
          focus={focus}
          glow={glow}
          band={band}
          flood={flood}
          bandAt={bandAt}
          floodAt={{ x: W / 2, y: -H * 0.4 }}
          rays={rays}
          raysAt={raysAt}
          spin={spin}
          blooms={[bloomBoard, board.first, bloomPromote, landAt]}
        />

        <Animated.View style={[StyleSheet.absoluteFill, shake]}>
          <Streaks width={W} height={H} x={W / 2} y={centreY} clock={ambient} band={streaking} flood={flood} />
          <Motes width={W} height={H} x={W / 2} y={heroY} ambient={ambient} charge={motesIn} dust={dust} />

          <Animated.View style={[StyleSheet.absoluteFill, boardOut]} pointerEvents="none">
            <Board
              clock={u}
              width={W}
              height={H}
              layout={board}
              passed={passed}
              xpStep={xpStep}
              secondsLeft={seconds}
            />
          </Animated.View>

          <Animated.View style={[styles.pillar, { left: W / 2 - W * 0.3, width: W * 0.6, height: H }, pillar]} />
          <Clouds
            width={W}
            height={H}
            layer="back"
            climb={climb}
            reach={reach}
            bank={reach * climbAt(SEQ.bank)}
            speed={speed}
            warm={warm}
          />
          <Meteor
            width={W}
            clock={t}
            star={star}
            land={landAt}
            apex={SEQ.apex}
            shine={SEQ.star}
            fall={SEQ.fall}
            hit={SEQ.smash}
          />
          <Badge
            clock={t}
            board={u}
            ambient={ambient}
            y={heroY}
            x={heroX}
            near={near}
            shown={shown}
            size={HERO}
            charge={charge}
            width={W}
            spin={{ phase, turn, from: goFrom, to: goTo }}
            tilt={tilt}
          />
          <Clouds
            width={W}
            height={H}
            layer="front"
            climb={climb}
            reach={reach}
            bank={reach * climbAt(SEQ.bank)}
            speed={speed}
            warm={warm}
          />

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
            <Animated.View style={[styles.centre, { top: pillY, width: W }, pill]}>
              <View style={styles.pill}>
                <SymbolView name="chevron.up.2" size={12} weight="black" tintColor={TONE.umber} />
                <Text style={styles.pillText}>PROMOTED</Text>
                <SymbolView name="chevron.up.2" size={12} weight="black" tintColor={TONE.umber} />
              </View>
            </Animated.View>
            <View style={[styles.letters, { top: titleY, width: W }]}>
              {TITLE.split('').map((c, i) => (
                <Letter key={i} c={c} i={i} clock={t} width={W} />
              ))}
            </View>
            <Animated.Text style={[styles.sub, { top: subY, width: W }, sub]}>
              You won Silver. A tougher week starts now.
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
      </Animated.View>

      <Animated.View style={[StyleSheet.absoluteFill, styles.flash, flash]} pointerEvents="none" />

      <Pressable onPress={() => router.back()} style={[styles.round, { top: insets.top + 8, left: 18 }]} hitSlop={8}>
        <SymbolView name="chevron.left" size={18} weight="bold" tintColor={TONE.white} />
      </Pressable>

      {stage === 'board' ? (
        <Animated.View style={[styles.footer, { bottom: insets.bottom + 20 }, claimIn]}>
          <Chunky look="foil" icon="gift.fill" label="Claim promotion" disabled={!claim} onPress={promote} />
        </Animated.View>
      ) : (
        <Animated.View style={[styles.footer, styles.row, { bottom: insets.bottom + 20 }, buttons]}>
          <Chunky look="molten" icon="arrow.counterclockwise" disabled={!done} onPress={replay} style={styles.again} />
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
 * it. It flies off into the distance; it comes back Gold, spinning hard, white hot, swelling as it
 * falls, squashes flat as it lands, and springs back out big.
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
  x,
  y,
  near,
  shown,
  size,
  charge,
  width,
  spin,
  tilt,
}: {
  clock: SharedValue<number>;
  board: SharedValue<number>;
  ambient: SharedValue<number>;
  x: SharedValue<number>;
  y: SharedValue<number>;
  /** How near it is (1 as it is, smaller far off), and whether it's showing */
  near: SharedValue<number>;
  shown: SharedValue<number>;
  size: number;
  charge: SharedValue<number>;
  /** The screen's, for when the glare passes it */
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
    if (t < SEQ.fall) return to + 360 * inOutCubic(span(t, SEQ.rise, SEQ.apex - SEQ.rise));
    // Whirling as it falls, slowing to face you as it lands, and rocking after
    if (t < SEQ.boom) return mix(to + 360, to + 1440, outCubic(span(t, SEQ.fall, SEQ.smash - SEQ.fall)));
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
    else if (t >= SEQ.launch && t < SEQ.apex) squash = -0.24 * (1 - span(t, SEQ.rise, 0.2));
    else if (t >= SEQ.fall && t < SEQ.smash) squash = -0.16 * span(t, SEQ.fall, SEQ.smash - SEQ.fall);
    else if (t >= SEQ.smash && t < SEQ.boom) squash = 0.34;
    else if (t >= SEQ.boom) squash = landing(d);
    return {
      opacity: shown.value,
      transform: [
        { translateX: x.value - size / 2 + Math.sin(a * 53) * 4 * c * c },
        { translateY: y.value - size / 2 },
        // On the screen's axes, not the badge's, so it reads the same however far round it's turned
        { scaleX: 1 + squash },
        { scaleY: 1 - squash },
        { rotateZ: `${Math.sin(a * 41) * 3 * c * c}deg` },
        { scale: mix(PARK * enter, 1, fly) * (1 + 0.1 * c + pop) * breathe * near.value },
      ],
    };
  });
  // Gold from when it's the star, out of sight
  const gold = useDerivedValue((): number => (clock.value < SEQ.star ? 0 : 1));
  // Gold's foil, once it's landed
  const holo = useDerivedValue(() => span(clock.value, SEQ.boom + 0.4, 0.6));
  // Washed white: glowing as it charges, hot as it falls, as it bursts, and as the glare sweeps past
  const white = useDerivedValue(() => {
    const t = clock.value;
    const d = t - SEQ.boom;
    const swept = 0.55 * Math.exp(-Math.pow((t - shineAt(width / 2, width)) / 0.07, 2));
    const glowing = 0.25 * Math.pow(charge.value, 3);
    const hot = t > SEQ.fall && d < 0 ? 0.5 * Math.pow(span(t, SEQ.fall, SEQ.smash - SEQ.fall), 2) : 0;
    return Math.max(d > 0 ? 0.8 * Math.exp(-d * 6) : 0, swept, glowing, hot);
  });
  return (
    <Animated.View style={[styles.badge, { width: size, height: size }, body]} pointerEvents="none">
      <SpinBadge size={size} angle={angle} gold={gold} white={white} tilt={tilt} holo={holo} />
    </Animated.View>
  );
}

/** Roughly how far across the screen each letter of the title sits */
const LETTER = 31;

/** One letter of the title, dropping in big and slamming down; then hopping as the glare passes it */
function Letter({ c, i, clock, width }: { c: string; i: number; clock: SharedValue<number>; width: number }) {
  const s = useAnimatedStyle(() => {
    const t = clock.value;
    const d = t - SEQ.title - i * 0.04;
    const k = settle(d, 1.9, 6.5);
    const x = width / 2 + (i - (TITLE.length - 1) / 2) * LETTER;
    const wave = Math.exp(-Math.pow((t - shineAt(x, width)) / 0.07, 2));
    return {
      opacity: d > 0 ? Math.min(1, d * 12) : 0,
      transform: [
        { translateY: (1 - k) * -70 - wave * 7 },
        { scale: mix(2.2, 1, outBack(Math.min(1, d * 4), 1.2)) + wave * 0.16 },
      ],
    };
  });
  if (c === ' ') return <View style={styles.space} />;
  return <Animated.Text style={[styles.letter, s]}>{c}</Animated.Text>;
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
    height: 32,
    paddingHorizontal: 16,
    borderRadius: 16,
    experimental_backgroundImage: MOLTEN,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.85)',
    boxShadow: `inset 0 2px 1px -0.5px rgba(255,255,255,0.85), 0 4px 0 ${TONE.amber}, 0 10px 18px ${TONE.dropWarm}`,
  },
  pillText: { fontFamily: ROUNDED, fontWeight: '900', fontSize: 13, letterSpacing: 2.5, color: TONE.umber },
  letters: { position: 'absolute', left: 0, flexDirection: 'row', justifyContent: 'center' },
  letter: {
    fontFamily: ROUNDED,
    fontWeight: '900',
    fontSize: 46,
    color: TONE.white,
    textShadowColor: TONE.shadeWarm,
    textShadowOffset: { width: 0, height: 3 },
    textShadowRadius: 10,
  },
  space: { width: 14 },
  sub: {
    position: 'absolute',
    left: 0,
    textAlign: 'center',
    fontFamily: ROUNDED,
    fontWeight: '700',
    fontSize: 16,
    color: TONE.soft,
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
