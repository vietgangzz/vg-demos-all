import { Fredoka_500Medium, Fredoka_600SemiBold, Fredoka_700Bold, useFonts } from '@expo-google-fonts/fredoka';
import { router, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  PixelRatio,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type ViewInstance,
} from 'react-native';
import { Presets, useRealtimeComposer } from 'react-native-pulsar';
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  FadeOut,
  FadeOutUp,
  SensorType,
  useAnimatedReaction,
  useAnimatedSensor,
  useAnimatedStyle,
  useFrameCallback,
  useDerivedValue,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Canvas, type CanvasRef } from 'react-native-webgpu';
import { scheduleOnRN } from 'react-native-worklets';

import { loadBackdrop } from './art';
import { BAKE, type Kind } from './burst';
import { Banner, Card, type Leaving, type Place, type Slot } from './cards';
import { Burst, Rays } from './fx';
import { GameButton, HoldHint } from './hold';
import { CloseButton, CurrencyPill, Header, kick, Profile } from './hud';
import { AWARD, CREAM, DIM, FONT, glow, GOLD, RARITY, REWARDS, START, VIOLET, XP } from './palette';
import { EggTitle, OtherRewards, RevealSwitch } from './reveal';
import { createDrop, type Drop, type DropEvents, type Point, type Reveal } from './scene';
import { useSounds, type Cue } from './sounds';

/**
 * Daily Drop: the reward at the end of a seven-day streak, as a moment.
 *
 * A treasure chest on a dais in a vault, bound shut in chains, a padlock on it, a shaft of light
 * falling on it. Hold anywhere and a gold key comes up over the thumb, the glass bulb in its bow
 * filling with light; the chest strains, shaking and hopping, its chains rattling and glowing out
 * from the padlock, cracks of light spreading over the padlock, the circle round the dais filling,
 * the light running from gold through blue and violet to legendary orange the longer it's held, the
 * key's note rising, the phone ticking quicker and humming harder in the hand. Let go early and it
 * all drains away. Hold it to the end: the key flies to the padlock, slides in and turns with a
 * clack, and it all goes, in slow motion: a flash, a shockwave across the screen, the padlock in
 * pieces, the chains whipped off, the lid flung open, the treasure going up in a fountain and raining
 * down on the dais, every knock heard and felt (simulated in Blender, scene.ts).
 *
 * Then, as items (after Rare Box): the legendary egg rises out of the chest up a pillar of light,
 * turning twice, and hangs there to be spun with a finger, the other rewards in tiles under it;
 * Claim. Or as cards: three come up into a fan, face down, their edges glowing the colour of what's
 * on them, each tapped over, the legendary one with a fanfare and a holographic foil. Collect: the
 * coins and gems fly up out of the scene into the wallet, the count rolling up as each one lands;
 * the egg (or the legendary card) flies up into your face at the top of the screen; light pours into
 * the level bar until it overflows: level up. The day's stamped done, and the next drop's counted
 * down to.
 *
 * The chest, its coins and gems and the dais are modelled in Blender and drawn with three.js
 * (scene.ts); everything over them is React Native, Reanimated and Skia.
 */

type Phase = 'idle' | 'burst' | 'items' | 'cards' | 'collect' | 'levelup' | 'done' | 'rewind';

/** How long the chest has to be held to burst, in seconds */
const HOLD = 1.6;
/** Where along the hold the light changes colour (a thump in the hand each time) */
const TIERS = [0.42, 0.72, 0.94];
/** How far above the thumb the key floats, so the thumb doesn't hide it */
const KEY_LIFT = 96;
const COIN_COUNT = BAKE.count.coin;
const GEM_COUNT = BAKE.count.gem;
const ORB_COUNT = 9;
/** What each kind of knock sounds like */
const KNOCK: Record<Kind, Cue> = { link: 'clank', shackle: 'clank', lock: 'tink', coin: 'clink', gem: 'clink' };

/** The time, for spacing out sounds and buzzes (outside the component: it's read in handlers) */
const timeNow = () => performance.now();

const until = () => {
  const now = new Date();
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  const s = Math.max(0, Math.floor((next.getTime() - now.getTime()) / 1000));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
};

export default function DailyDropDemo() {
  const insets = useSafeAreaInsets();
  const { width: W, height: H } = useWindowDimensions();
  const [fonts, fontError] = useFonts({ Fredoka_500Medium, Fredoka_600SemiBold, Fredoka_700Bold });
  const canvasRef = useRef<CanvasRef>(null);
  const [drop, setDrop] = useState<Drop | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [mode, setMode] = useState<Reveal>('items');
  /** The egg: not yet, hatching, hatched */
  const [egg, setEgg] = useState<'egg' | 'hatching' | 'fox'>('egg');
  const [holding, setHolding] = useState(false);
  const [tier, setTier] = useState(0);
  const [coins, setCoins] = useState(START.coins);
  const [gems, setGems] = useState(START.gems);
  const [level, setLevel] = useState(START.level);
  const [companion, setCompanion] = useState<'fox' | 'drake' | null>(null);
  const [flipped, setFlipped] = useState([false, false, false]);
  const [leaving, setLeaving] = useState<Leaving[]>(['none', 'none', 'none']);
  const [origin, setOrigin] = useState<Place>({ x: W / 2, y: H * 0.55 });
  const [flyTo, setFlyTo] = useState<Place & { size: number }>({ x: 40, y: 60, size: 42 });
  const [stamped, setStamped] = useState(false);
  const [legendary, setLegendary] = useState(false);
  const [countdown, setCountdown] = useState(until);
  const [calm, setCalm] = useState(false);
  const [deltaTick, setDeltaTick] = useState(0);

  const sounds = useSounds();
  // In the hand, played live: a hum, and knocks (it stops by itself when the screen goes)
  const { set: hum, playDiscrete: knock, stop: still } = useRealtimeComposer();

  const xp = useSharedValue(START.xp);
  const fill = useSharedValue(0);
  const bumpCoin = useSharedValue(0);
  const bumpGem = useSharedValue(0);
  const avatarPop = useSharedValue(0);
  const clock = useSharedValue(0);
  const flash = useSharedValue(0);
  const shake = useSharedValue(0);
  const spark0 = useSharedValue(0);
  const spark1 = useSharedValue(0);
  const spark2 = useSharedValue(0);
  const confetti = useSharedValue(0);
  const raysOn = useSharedValue(0);
  const raysSpin = useSharedValue(0);
  const levelUp = useSharedValue(0);
  const levelRays = useSharedValue(0);
  const avatarSpark = useSharedValue(0);
  const levelRaysOn = useDerivedValue(() => levelUp.value);
  const sparks = [spark0, spark1, spark2];

  const coinRef = useRef<ViewInstance>(null);
  const gemRef = useRef<ViewInstance>(null);
  const xpRef = useRef<ViewInstance>(null);
  const avatarRef = useRef<ViewInstance>(null);
  /** The hold, run on the JS thread with the scene: whether it's pressed, how far it's got */
  const hold = useRef({ pressed: false, value: 0, last: 0, fired: false, tier: 0, buzz: 0, tick: 0, sound: 0 });
  /** What's landed so far, and when the last coin sound played */
  const tally = useRef({ coins: 0, gems: 0, orbs: 0, leveled: false, coinSound: 0, coinBuzz: 0 });
  /** When each kind of knock was last heard, and felt, so a clatter isn't a roar */
  const knocks = useRef<Partial<Record<Cue | 'buzz' | 'edge', number>>>({});
  /** A finger spinning the egg: where it last was, when, how fast it was going (points a second) */
  const spinning = useRef({ x: 0, t: 0, v: 0, moved: 0 });
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const later = (ms: number, fn: () => void) => {
    timers.current.push(setTimeout(fn, ms));
  };
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setCalm);
  }, []);

  useFrameCallback((f) => {
    clock.set((f.timeSinceFirstFrame ?? 0) / 1000);
  });

  // ---- The scene ----
  const handlers = useRef<DropEvents>({
    onCue: () => {},
    onHaptic: () => {},
    onArrive: () => {},
    onKnock: () => {},
    onOpen: () => {},
    onEdge: () => {},
    onSealed: () => {},
  });
  const dropRef = useRef<Drop | null>(null);
  useEffect(() => {
    dropRef.current = drop;
  }, [drop]);

  /** Full: the key flies to the padlock (the scene says what happens next) */
  const open = useCallback(() => {
    const h = hold.current;
    h.fired = true;
    h.pressed = false;
    setHolding(false);
    sounds.hold(0);
    still();
    dropRef.current?.dive('legendary');
    setPhase('burst');
    fill.set(withTiming(0, { duration: 260 }));
  }, [sounds, still, fill]);

  /** How far the hold has got: stepped each frame by the scene, which calls it */
  const charge = useCallback(() => {
    const h = hold.current;
    const now = performance.now();
    const dt = h.last ? Math.min(0.05, (now - h.last) / 1000) : 0;
    h.last = now;
    if (h.fired) return 0;
    // (Dev builds can pin it, for QA: dailyDropCharge = 0.6)
    const pinned = __DEV__ ? (globalThis as { dailyDropCharge?: number }).dailyDropCharge : undefined;
    if (pinned !== undefined) return pinned;
    const was = h.value;
    h.value = Math.max(0, Math.min(1, h.value + (h.pressed ? dt / HOLD : -dt / 0.45)));
    const v = h.value;
    // The key's note and the chains' rattle follow it up, and back down if it's let go early
    if ((v > 0 && now - h.sound > 50) || (v === 0 && was > 0)) {
      h.sound = now;
      sounds.hold(v);
    }
    if (h.pressed) {
      // In the hand: a hum, harder and higher the further it's got, over a ratchet of clicks, quickening
      if (now - h.buzz > 45) {
        h.buzz = now;
        hum(0.1 + 0.75 * v * v, 0.15 + 0.7 * v);
      }
      if (now - h.tick > 150 - 115 * v) {
        h.tick = now;
        knock(0.3 + 0.65 * v, 0.35 + 0.6 * v);
      }
      while (h.tier < TIERS.length && v >= TIERS[h.tier]) {
        h.tier++;
        setTier(h.tier);
        Presets.System.impactHeavy();
      }
      if (v >= 1) open();
    }
    return v;
  }, [sounds, hum, knock, open]);

  useEffect(() => {
    let live: Drop | null = null;
    let cancelled = false;
    (async () => {
      const [adapter, backdrop] = await Promise.all([navigator.gpu.requestAdapter(), loadBackdrop()]);
      const device = await adapter?.requestDevice();
      const context = canvasRef.current?.getContext('webgpu');
      if (cancelled || !device || !context) return;
      const canvas = context.canvas as unknown as {
        width: number;
        height: number;
        clientWidth: number;
        clientHeight: number;
      };
      const ratio = Math.min(PixelRatio.get(), 2.5);
      canvas.width = canvas.clientWidth * ratio;
      canvas.height = canvas.clientHeight * ratio;
      live = createDrop(context, device, backdrop, charge, {
        onCue: (c) => handlers.current.onCue(c),
        onHaptic: (k) => handlers.current.onHaptic(k),
        onArrive: (k) => handlers.current.onArrive(k),
        onKnock: (k, s) => handlers.current.onKnock(k, s),
        onOpen: () => handlers.current.onOpen(),
        onEdge: () => handlers.current.onEdge(),
        onSealed: () => handlers.current.onSealed(),
      });
      live.onFirstFrame(() => setLoaded(true));
      // Dev builds expose the scene for QA: dailyDrop.dive('legendary'), dailyDrop.reset()
      if (__DEV__) (globalThis as { dailyDrop?: Drop }).dailyDrop = live;
      setDrop(live);
    })();
    return () => {
      cancelled = true;
      live?.dispose();
    };
    // The scene's made once; `charge` reads the hold through a ref
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    drop?.resize(W, H, Math.min(PixelRatio.get(), 2.5));
  }, [drop, W, H]);
  useEffect(() => {
    drop?.setReveal(mode);
  }, [drop, mode]);

  // The tilt, to the scene: the camera and the vault drift with it
  const gravity = useAnimatedSensor(SensorType.GRAVITY, { interval: 33 });
  const tilt = useSharedValue({ x: 0, y: 0 });
  const pushTilt = (x: number, y: number) => dropRef.current?.setTilt(x, y);
  useAnimatedReaction(
    () => {
      const g = gravity.sensor.value;
      return { x: Math.max(-1, Math.min(1, g.x / 9.81)), y: Math.max(-1, Math.min(1, -g.y / 9.81 - 0.5)) };
    },
    (now, was) => {
      tilt.set(now);
      if (!was || Math.abs(now.x - was.x) + Math.abs(now.y - was.y) > 0.01) scheduleOnRN(pushTilt, now.x, now.y);
    }
  );

  // ---- What the scene tells us ----
  const tell: DropEvents = {
    onCue: (c) => {
      if (c === 'hatch') {
        sounds.play('impact', 0.8);
        Presets.explosion();
        flash.set(withSequence(withTiming(0.35, { duration: 40 }), withTiming(0, { duration: 420 })));
        if (!calm)
          shake.set(
            withSequence(
              withTiming(1, { duration: 30 }),
              withTiming(0, { duration: 800, easing: Easing.out(Easing.quad) })
            )
          );
        return;
      }
      if (c === 'hatched') {
        setEgg('fox');
        sounds.play('levelup');
        Presets.triumph();
        return;
      }
      sounds.play(c === 'land' ? 'legendary' : c);
      // The key on its way: the hum in the hand hard, till it's in
      if (c === 'dive') hum(0.7, 0.85);
      if (c === 'impact') {
        flash.set(withSequence(withTiming(0.25, { duration: 40 }), withTiming(0, { duration: 380 })));
        if (!calm)
          shake.set(
            withSequence(
              withTiming(1, { duration: 30 }),
              withTiming(0, { duration: 900, easing: Easing.out(Easing.quad) })
            )
          );
      }
      if (c === 'erupt') Presets.cascade();
      if (c === 'rise') Presets.ascent();
      if (c === 'land') {
        Presets.triumph();
        flash.set(withSequence(withTiming(0.3, { duration: 50 }), withTiming(0, { duration: 500 })));
      }
      if (c === 'rewind') Presets.swell();
    },
    onHaptic: (k) => {
      if (k === 'insert') {
        still();
        Presets.System.impactMedium();
      }
      if (k === 'unlock') Presets.lock();
      if (k === 'impact') {
        still();
        Presets.explosion();
      }
      if (k === 'land') Presets.System.impactLight();
      if (k === 'close') Presets.thud();
    },
    onKnock: (kind, strength) => {
      const t = knocks.current;
      const now = timeNow();
      const gain = Math.min(1, Math.max(0.25, (strength - 0.8) / 2.6));
      const cue = KNOCK[kind];
      if (now - (t[cue] ?? 0) > 32) {
        t[cue] = now;
        sounds.play(cue, gain);
      }
      if (now - (t.buzz ?? 0) > 40) {
        t.buzz = now;
        knock(0.2 + 0.6 * gain, 0.3 + 0.6 * gain);
      }
    },
    onOpen: () => {
      const d = dropRef.current;
      d?.focus(true);
      if (mode === 'items') {
        setPhase('items');
        return;
      }
      if (d) setOrigin(d.mouth());
      setPhase('cards');
      // The cards spinning out of it
      [0, 120, 240].forEach((ms, i) => later(ms + 80, () => sounds.play('spin', 0.8 - i * 0.15)));
    },
    onEdge: () => edge(),
    onSealed: () => setPhase('idle'),
    onArrive: (k) => {
      const t = tally.current;
      const now = timeNow();
      if (k === 'coin') {
        t.coins++;
        setCoins(START.coins + Math.round((AWARD.coins * t.coins) / COIN_COUNT));
        kick(bumpCoin);
        if (now - t.coinSound > 55) {
          t.coinSound = now;
          sounds.play('coin');
        }
        if (now - t.coinBuzz > 70) {
          t.coinBuzz = now;
          Presets.System.selection();
        }
      } else if (k === 'gem') {
        t.gems++;
        setGems(START.gems + Math.round((AWARD.gems * t.gems) / GEM_COUNT));
        kick(bumpGem);
        sounds.play('coin');
        Presets.System.impactLight();
      } else if (k === 'egg') {
        // Into your face: there's the drake
        setCompanion('drake');
        kick(avatarPop);
        avatarSpark.set(0);
        avatarSpark.set(withTiming(1.3, { duration: 1300, easing: Easing.linear }));
        sounds.play('reveal');
        Presets.System.impactHeavy();
      } else {
        t.orbs++;
        const to = START.xp + (AWARD.xp * t.orbs) / ORB_COUNT;
        Presets.System.impactLight();
        if (to >= 1 && !t.leveled) {
          t.leveled = true;
          xp.set(withTiming(1, { duration: 160 }));
          later(220, levelUpNow);
        } else if (!t.leveled) xp.set(withTiming(to, { duration: 200, easing: Easing.out(Easing.cubic) }));
      }
    },
  };
  useEffect(() => {
    handlers.current = tell;
  });

  // ---- The flow ----
  // Held anywhere: the key comes up over the thumb and follows it. With the egg up, a finger spins it
  const pressIn = (x: number, y: number) => {
    if (phase === 'items') {
      Object.assign(spinning.current, { x, t: timeNow(), v: 0, moved: 0 });
      return;
    }
    if (phase !== 'idle' || !loaded) return;
    const h = hold.current;
    h.pressed = true;
    h.fired = false;
    h.tick = 0;
    setHolding(true);
    dropRef.current?.key({ x, y: y - KEY_LIFT });
    fill.set(withTiming(1, { duration: HOLD * 1000 * (1 - h.value), easing: Easing.linear }));
    Presets.System.impactMedium();
  };
  const drag = (x: number, y: number) => {
    if (phase === 'items') {
      const s = spinning.current;
      const now = timeNow();
      s.v = s.v * 0.4 + ((x - s.x) / Math.max(8, now - s.t)) * 1000 * 0.6;
      dropRef.current?.spin(x - s.x);
      s.moved += Math.abs(x - s.x);
      s.x = x;
      s.t = now;
      return;
    }
    if (hold.current.pressed) dropRef.current?.key({ x, y: y - KEY_LIFT });
  };
  const pressOut = () => {
    if (phase === 'items') {
      const s = spinning.current;
      // Held still before letting go: no fling
      dropRef.current?.release(timeNow() - s.t > 80 ? 0 : s.v);
      // A tap on the drake: it breathes fire
      if (s.moved < 6 && egg === 'fox') {
        dropRef.current?.poke();
        sounds.play('breath');
        Presets.buildup();
      }
      return;
    }
    const h = hold.current;
    if (!h.pressed) return;
    h.pressed = false;
    h.tier = 0;
    setTier(0);
    setHolding(false);
    still();
    dropRef.current?.key(null);
    fill.set(withTiming(0, { duration: 450, easing: Easing.out(Easing.cubic) }));
  };
  const cw = Math.min(136, W * 0.31);
  const fanY = H * 0.54;
  const slots: Slot[] = useMemo(
    () => [
      { x: W / 2 - cw * 0.98, y: fanY + 20, rot: -10, scale: 1 },
      { x: W / 2, y: fanY - 6, rot: 0, scale: 1.14 },
      { x: W / 2 + cw * 0.98, y: fanY + 20, rot: 10, scale: 1 },
    ],
    [W, cw, fanY]
  );
  const feature = { x: W / 2, y: H * 0.45 };

  const reveal = (i: number) => {
    const r = REWARDS[i];
    const s = sparks[i];
    s.set(0);
    s.set(withTiming(1.6, { duration: 1600, easing: Easing.linear }));
    if (r.rarity === 'legendary') {
      sounds.play('legendary');
      Presets.triumph();
      setLegendary(true);
      flash.set(withSequence(withTiming(0.7, { duration: 60 }), withTiming(0, { duration: 600 })));
      raysOn.set(withTiming(0.75, { duration: 500 }));
      raysSpin.set(0);
      raysSpin.set(withRepeat(withTiming(Math.PI * 2, { duration: 16000, easing: Easing.linear }), -1));
      if (!calm)
        shake.set(
          withSequence(
            withTiming(1, { duration: 40 }),
            withTiming(0, { duration: 650, easing: Easing.out(Easing.quad) })
          )
        );
    } else {
      sounds.play('reveal');
      Presets.chime();
    }
  };

  const tapCard = (i: number) => {
    if (phase !== 'cards' || flipped[i]) return;
    const next = flipped.slice();
    next[i] = true;
    setFlipped(next);
    sounds.play('flip');
    Presets.System.impactMedium();
    // Revealed as it lands face up, at the end of its turn and a half
    later(420, () => reveal(i));
  };
  const allFlipped = flipped.every(Boolean);
  /** A card's gone edge on, turning: a click in the hand */
  const edge = () => {
    const t = knocks.current;
    const now = timeNow();
    if (now - (t.edge ?? 0) < 45) return;
    t.edge = now;
    Presets.System.selection();
  };

  const measure = (ref: React.RefObject<ViewInstance | null>) =>
    new Promise<Point & { w: number }>((resolve) => {
      const v = ref.current;
      if (!v) return resolve({ x: W / 2, y: 60, w: 40 });
      v.measureInWindow((x, y, w, h) => resolve({ x: x + w / 2, y: y + h / 2, w }));
    });

  const collect = async () => {
    if (phase !== 'cards' || !allFlipped) return;
    setPhase('collect');
    Presets.System.impactMedium();
    setLeaving(['fade', 'feature', 'fade']);
    raysOn.set(withTiming(0, { duration: 400 }));
    const [coin, gem, bar, face] = await Promise.all([
      measure(coinRef),
      measure(gemRef),
      measure(xpRef),
      measure(avatarRef),
    ]);
    setFlyTo({ x: face.x, y: face.y, size: face.w });
    drop?.collect({ coin, gem, xp: bar });
    setDeltaTick((n) => n + 1);
    drop?.focus(false);
    later(1000, () => setLeaving(['fade', 'fly', 'fade']));
    later(1560, () => {
      setCompanion('fox');
      kick(avatarPop);
      avatarSpark.set(0);
      avatarSpark.set(withTiming(1.3, { duration: 1300, easing: Easing.linear }));
      sounds.play('reveal');
      Presets.System.impactHeavy();
    });
  };

  /** Items: hatch the egg first (it shakes, cracks and bursts: the scene says when it's done) */
  const hatch = () => {
    if (phase !== 'items' || egg !== 'egg') return;
    setEgg('hatching');
    drop?.hatch();
    sounds.play('rise');
    Presets.buildup();
  };

  /** Items: claim the lot. The drake goes to your face, the rest where it's counted */
  const claim = async () => {
    if (phase !== 'items') return;
    setPhase('collect');
    Presets.System.impactMedium();
    const [coin, gem, bar, face] = await Promise.all([
      measure(coinRef),
      measure(gemRef),
      measure(xpRef),
      measure(avatarRef),
    ]);
    setFlyTo({ x: face.x, y: face.y, size: face.w });
    drop?.collect({ coin, gem, xp: bar, egg: face });
    setDeltaTick((n) => n + 1);
    drop?.focus(false);
  };

  const levelUpNow = () => {
    setPhase('levelup');
    setLevel(START.level + 1);
    sounds.play('levelup');
    Presets.fanfare();
    levelUp.set(withSpring(1, { damping: 12, stiffness: 130 }));
    levelRays.set(0);
    levelRays.set(withRepeat(withTiming(Math.PI * 2, { duration: 14000, easing: Easing.linear }), -1));
    confetti.set(0);
    confetti.set(withTiming(3.2, { duration: 3200, easing: Easing.linear }));
    later(2300, () => {
      levelUp.set(withTiming(0, { duration: 380, easing: Easing.in(Easing.cubic) }));
      xp.set(0);
      xp.set(withDelay(200, withTiming(START.xp + AWARD.xp - 1, { duration: 600, easing: Easing.out(Easing.cubic) })));
    });
    later(2800, () => {
      setPhase('done');
      setStamped(true);
      // In time with the header's claim: a tink as the light reaches each day, the stamp as today's seal lands
      for (let d = 0; d < 6; d++) later(510 + d * 75, () => sounds.play('tink', 0.5));
      later(1070, () => {
        sounds.play('stamp');
        Presets.stamp();
      });
    });
  };

  useEffect(() => {
    if (phase !== 'done') return;
    const id = setInterval(() => setCountdown(until()), 1000);
    return () => clearInterval(id);
  }, [phase]);

  // Replay: the whole burst runs backwards, and the chest's sealed again (the scene says when)
  const replay = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    Object.assign(hold.current, { pressed: false, value: 0, fired: false, tier: 0 });
    Object.assign(tally.current, { coins: 0, gems: 0, orbs: 0, leveled: false });
    setTier(0);
    setEgg('egg');
    setFlipped([false, false, false]);
    setLeaving(['none', 'none', 'none']);
    setLegendary(false);
    setStamped(false);
    setCompanion(null);
    setCoins(START.coins);
    setGems(START.gems);
    setLevel(START.level);
    xp.set(withTiming(START.xp, { duration: 300 }));
    raysOn.set(0);
    setPhase('rewind');
    drop?.reset();
    Presets.System.selection();
  };

  // ---- Looks ----
  const flashStyle = useAnimatedStyle(() => ({ opacity: flash.value * 0.7 }));
  const shaking = useAnimatedStyle(() => ({
    transform: [
      { translateX: Math.sin(clock.value * 73) * shake.value * 9 },
      { translateY: Math.sin(clock.value * 59) * shake.value * 7 },
    ],
  }));
  const headerStyle = useAnimatedStyle(() => ({
    opacity: 1 - fill.value * 0.65,
    transform: [{ translateY: -fill.value * 10 }],
  }));
  const levelStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, levelUp.value * 1.5),
    transform: [{ scale: 0.4 + levelUp.value * 0.6 }],
  }));
  const dimStyle = useAnimatedStyle(() => ({ opacity: Math.min(1, levelUp.value) * 0.55 }));

  // Without the font (it failed to load), the system's: the show goes on
  const ready = (fonts || !!fontError) && loaded;
  const top = insets.top + 6;
  const legendaryAt = slots[1];

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      {/* Back only from the screen's left edge (the swipe has to start left of `end`): a swipe
          anywhere else is a hold, or spins the egg */}
      <Stack.Screen options={{ gestureResponseDistance: { end: 28 } }} />
      {/* The whole screen's the button */}
      <View
        style={StyleSheet.absoluteFill}
        onStartShouldSetResponder={() => true}
        onResponderTerminationRequest={() => false}
        onResponderGrant={(e) => pressIn(e.nativeEvent.pageX, e.nativeEvent.pageY)}
        onResponderMove={(e) => drag(e.nativeEvent.pageX, e.nativeEvent.pageY)}
        onResponderRelease={pressOut}
        onResponderTerminate={pressOut}>
        <Canvas ref={canvasRef} style={StyleSheet.absoluteFill} />
      </View>

      {ready ? (
        <>
          {/* Who you are and what you've got */}
          <Animated.View entering={FadeIn.duration(600)} style={[styles.topBar, { top, left: 16, right: 16 }, shaking]}>
            <View style={styles.topLeft}>
              <CloseButton onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
              <Profile
                level={level}
                xp={xp}
                companion={companion}
                avatarRef={avatarRef}
                xpRef={xpRef}
                pop={avatarPop}
                tick={deltaTick}
              />
            </View>
            <View style={styles.topRight}>
              <CurrencyPill
                ref={coinRef}
                icon="coin"
                value={coins}
                bump={bumpCoin}
                delta={`+${AWARD.coins}`}
                tick={deltaTick}
              />
              <CurrencyPill
                ref={gemRef}
                icon="gem"
                value={gems}
                bump={bumpGem}
                delta={`+${AWARD.gems}`}
                tick={deltaTick}
              />
            </View>
          </Animated.View>

          <Burst
            clock={avatarSpark}
            x={flyTo.x}
            y={flyTo.y}
            kind="sparkle"
            palette={['#FFE7A8', '#FFB020', '#FFFFFF']}
            count={36}
            life={1.2}
            power={0.55}
            style={styles.passThrough}
          />

          {phase === 'idle' || phase === 'done' || phase === 'rewind' ? (
            <Animated.View
              entering={FadeInDown.delay(200).duration(700).easing(Easing.out(Easing.cubic))}
              exiting={FadeOutUp.duration(300)}
              style={[styles.header, { top: insets.top + 66 }]}
              pointerEvents="none">
              {/* Dimmed while it's held: on its own view, so the entrance doesn't fight it */}
              <Animated.View style={headerStyle}>
                <Header stamped={stamped} />
              </Animated.View>
            </Animated.View>
          ) : null}

          {/* The egg: what it is, over it */}
          {phase === 'items' ? (
            <EggTitle key={egg === 'fox' ? 'fox' : 'egg'} hatched={egg === 'fox'} top={insets.top + 64} />
          ) : null}

          {/* The cards, rays behind the legendary one */}
          {mode === 'cards' && (phase === 'cards' || phase === 'collect') ? (
            <Animated.View style={[StyleSheet.absoluteFill, shaking]} pointerEvents="box-none">
              <Animated.View style={StyleSheet.absoluteFill} pointerEvents="none">
                <Rays
                  x={legendaryAt.x}
                  y={legendaryAt.y}
                  radius={W * 0.85}
                  colour={RARITY.legendary}
                  opacity={raysOn}
                  spin={raysSpin}
                />
              </Animated.View>
              {REWARDS.map((r, i) => (
                <Card
                  key={r.id}
                  reward={r}
                  w={cw}
                  slot={slots[i]}
                  origin={origin}
                  feature={feature}
                  flyTo={flyTo}
                  delay={[0, 240, 120][i]}
                  flipped={flipped[i]}
                  leaving={leaving[i]}
                  clock={clock}
                  tilt={tilt}
                  onTap={() => tapCard(i)}
                  onEdge={edge}
                />
              ))}
              {REWARDS.map((r, i) => (
                <Burst
                  key={`spark-${r.id}`}
                  clock={sparks[i]}
                  x={slots[i].x}
                  y={slots[i].y}
                  kind="sparkle"
                  palette={
                    r.rarity === 'legendary'
                      ? ['#FFE7A8', '#FFB020', '#FFFFFF', '#FF8A3D']
                      : [RARITY[r.rarity], '#FFFFFF']
                  }
                  count={r.rarity === 'legendary' ? 70 : 34}
                  life={1.5}
                  power={r.rarity === 'legendary' ? 1.6 : 1}
                  style={styles.passThrough}
                />
              ))}
              {phase === 'cards' ? (
                <View style={[styles.cardsTop, { top: fanY - cw * 1.5 * 0.62 - 74 }]} pointerEvents="none">
                  {legendary ? (
                    <Banner show={legendary} colour={RARITY.legendary} />
                  ) : (
                    <Animated.Text entering={FadeIn.delay(900).duration(500)} style={styles.hint}>
                      Tap the cards to reveal them
                    </Animated.Text>
                  )}
                </View>
              ) : null}
            </Animated.View>
          ) : null}

          {/* Along the bottom: hold, collect, or come back tomorrow */}
          <View style={[styles.bottom, { bottom: insets.bottom + 26 }]} pointerEvents="box-none">
            {phase === 'idle' ? (
              <Animated.View
                key="hold"
                entering={FadeInDown.delay(350).duration(600).easing(Easing.out(Easing.cubic))}
                exiting={FadeOut.duration(250)}
                style={styles.center}
                pointerEvents="box-none">
                <View pointerEvents="none">
                  <HoldHint holding={holding} tier={tier} />
                </View>
                {holding ? null : <RevealSwitch value={mode} onChange={setMode} />}
              </Animated.View>
            ) : null}
            {phase === 'items' ? (
              <Animated.View
                key="claim"
                entering={FadeInDown.delay(250).duration(500)}
                exiting={FadeOut.duration(200)}
                style={styles.center}
                pointerEvents="box-none">
                <OtherRewards />
                {egg === 'fox' ? (
                  <GameButton label="Claim" icon="sparkles" onPress={claim} width={Math.min(W - 80, 300)} />
                ) : (
                  <View
                    style={egg === 'hatching' ? styles.hidden : null}
                    pointerEvents={egg === 'egg' ? 'auto' : 'none'}>
                    <GameButton label="Hatch" icon="flame.fill" onPress={hatch} width={Math.min(W - 80, 300)} />
                  </View>
                )}
              </Animated.View>
            ) : null}
            {phase === 'cards' && allFlipped ? (
              <Animated.View
                key="collect"
                entering={FadeInDown.delay(500).duration(500)}
                exiting={FadeOut.duration(200)}>
                <GameButton label="Collect all" icon="sparkles" onPress={collect} width={Math.min(W - 80, 300)} />
              </Animated.View>
            ) : null}
            {phase === 'done' ? (
              <Animated.View key="done" entering={FadeInDown.delay(300).duration(600)} style={styles.center}>
                <Text style={styles.next}>Next drop in</Text>
                <Text style={styles.countdown}>{countdown}</Text>
                <GameButton label="Replay" icon="arrow.counterclockwise" tone="glass" onPress={replay} />
              </Animated.View>
            ) : null}
          </View>

          {/* Level up */}
          {phase === 'levelup' || phase === 'collect' ? (
            <>
              <Animated.View style={[StyleSheet.absoluteFill, styles.dim, dimStyle]} pointerEvents="none" />
              {phase === 'levelup' ? (
                <>
                  <Animated.View style={StyleSheet.absoluteFill} pointerEvents="none" entering={FadeIn.duration(300)}>
                    <Rays
                      x={W / 2}
                      y={H * 0.42}
                      radius={W * 1.5}
                      colour="#C9A8FF"
                      under="#2A1266"
                      opacity={levelRaysOn}
                      spin={levelRays}
                      count={12}
                      thickness={0.62}
                      soft={3}
                      glow
                    />
                  </Animated.View>
                  <Animated.View style={[styles.levelUp, { top: H * 0.42 - 110 }, levelStyle]} pointerEvents="none">
                    <Text style={styles.levelKicker}>LEVEL UP</Text>
                    <View style={styles.levelBadge}>
                      <Text style={styles.levelNumber}>{START.level + 1}</Text>
                    </View>
                    <Text style={styles.levelSub}>
                      {companion === 'fox' ? 'Ember Fox' : 'Ember Drake'} joined your party
                    </Text>
                  </Animated.View>
                  <Burst
                    clock={confetti}
                    x={W / 2}
                    y={H * 0.42}
                    kind="confetti"
                    palette={[GOLD, '#FF8A3D', XP, VIOLET, '#FFFFFF', '#7CF0A8']}
                    count={120}
                    life={3.2}
                    style={styles.passThrough}
                  />
                </>
              ) : null}
            </>
          ) : null}

          <Animated.View style={[StyleSheet.absoluteFill, styles.flash, flashStyle]} pointerEvents="none" />
        </>
      ) : null}

      {!loaded ? (
        <Animated.View exiting={FadeOut.duration(700)} style={[StyleSheet.absoluteFill, styles.curtain]} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#07040F',
  },
  hidden: {
    opacity: 0,
  },
  curtain: {
    backgroundColor: '#07040F',
  },
  passThrough: {
    ...StyleSheet.absoluteFill,
    pointerEvents: 'none',
  },
  topBar: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  topLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  topRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  header: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  cardsTop: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  hint: {
    fontFamily: FONT.medium,
    fontSize: 15,
    color: DIM,
    letterSpacing: 0.3,
  },
  bottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  center: {
    alignItems: 'center',
    gap: 14,
  },
  next: {
    fontFamily: FONT.medium,
    fontSize: 14,
    letterSpacing: 1.2,
    color: DIM,
  },
  countdown: {
    fontFamily: FONT.bold,
    fontSize: 34,
    color: CREAM,
    fontVariant: ['tabular-nums'],
    ...glow('rgba(255,170,60,0.45)', 12),
    marginTop: -10 - 18,
  },
  dim: {
    backgroundColor: '#05020C',
  },
  levelUp: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  levelKicker: {
    fontFamily: FONT.bold,
    fontSize: 22,
    letterSpacing: 4,
    color: GOLD,
    ...glow('rgba(255,170,60,0.8)', 14),
  },
  levelBadge: {
    width: 132,
    height: 132,
    borderRadius: 66,
    marginTop: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: GOLD,
    experimental_backgroundImage: 'linear-gradient(160deg, #8A5CFF 0%, #4B22B8 55%, #24105E 100%)',
    boxShadow: '0 0 34px 6px rgba(155,107,255,0.9)',
  },
  levelNumber: {
    fontFamily: FONT.bold,
    fontSize: 64,
    color: CREAM,
    ...glow('rgba(255,255,255,0.6)', 12),
  },
  levelSub: {
    fontFamily: FONT.medium,
    fontSize: 15,
    color: CREAM,
    marginTop: 14,
  },
  flash: {
    backgroundColor: '#FFF6E6',
  },
});
