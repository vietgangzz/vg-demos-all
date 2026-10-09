import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { StatusBar } from 'expo-status-bar';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View, type StyleProp, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Presets } from 'react-native-pulsar';
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  FadeOut,
  Keyframe,
  LinearTransition,
  useAnimatedReaction,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useDerivedValue,
  useFrameCallback,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Atlas,
  Blur,
  ColorMatrix,
  DashPathEffect,
  Group,
  Oval,
  Path,
  Skia,
  useRectBuffer,
  useRSXformBuffer,
  vec,
  type SkRSXform,
} from 'react-native-skia';
import { Canvas as GPUCanvas, type CanvasRef } from 'react-native-webgpu';
import { scheduleOnRN, scheduleOnUI } from 'react-native-worklets';

import { LateCanvas } from '@/components/late-canvas';
import { NumericText } from '@/components/numeric-text';

import {
  AIR,
  BAG,
  BAG_H,
  bulgeOf,
  clearBag,
  COUNTER,
  discard,
  GONE,
  grab,
  HIDE,
  LANDED,
  LIST_S,
  makeWorld,
  MAX,
  mouthY,
  pack,
  peel,
  R0,
  release,
  sackHalf,
  sagOf,
  shakeOut,
  SPAWNED,
  spawn,
  SPILLED,
  step,
  THUD,
  tidy,
  type World,
} from './physics';
import { alreadyBaked, bakeProducts, CELL, frameOf, type Baked } from './bake';
import { CATEGORIES, formatVnd, PRODUCTS, type Category } from './catalog';
import { shipOrder } from './order';

/**
 * Market Bag: shopping where the things you buy feel like things. Every product is a little 3D
 * model, rendered once into a turntable of frames. Add one and it lifts off its card and is tossed
 * into a market net bag standing on a glass dock, spinning in depth as it flies; the bag sags and
 * swells with the weight, everything piling up in plain sight through the net. Hold a product to
 * pick it up yourself and throw it in. Tap the bag and it's turned upside down: everything slides
 * out of its mouth and tumbles onto the counter, then files itself into the cart. Step quantities
 * up and down, flick a line away; hold to pay, and the drawstring's pulled shut and the bag is
 * carried off.
 */

const BG = '#F4F1EA';
const INK = '#17171B';
const SUB = 'rgba(23,23,27,0.5)';
const GREEN = '#1F9D57';
/** The net's nylon cord, near and far, and its shadow */
const CORD = '#E5482F';
const CORD_FAR = '#A93322';
const CORD_SHADE = 'rgba(110,30,15,0.35)';
/** The light catching the top of a round nylon cord, and the twist of the rope */
const CORD_LIGHT = '#FF9F84';
const GLASS = isLiquidGlassAvailable();

/** Spend this much and delivery's on us */
const FREE_AT = 5_000_000;
const DELIVERY = 30_000;

const ART = R0 * 2;
const PAD = 16;
/** A card's product, with room round it for its shadow and its lift */
const ART_BOX = ART + PAD * 2;
const ROW = 78;
const GAP = 10;
/** Where a line's stack of products sits */
const STACK_X = 28 + R0 * LIST_S;
/** Everything below the list: the summary and the pay button */
const FOOT = 268;
/** How far round the bag turns to pour it out */
const TIP = 2.85;

type Line = { slot: number; product: number };
type Order = { id: string; items: number; total: number };
/** The products in a cart, each once, in the order they were first added */
const groupsOf = (lines: Line[]) => [...new Set(lines.map((l) => l.product))];
const sumOf = (lines: Line[]) => lines.reduce((sum, l) => sum + PRODUCTS[l.product].price, 0);
const short = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M ₫` : `${Math.max(1, Math.round(n / 1000))}K ₫`;

/** RSXform for a product at (x, y), turned by a, at scale s */
const place = (val: SkRSXform, x: number, y: number, a: number, s: number) => {
  'worklet';
  const k = ((R0 * 2) / CELL) * s;
  const c = Math.cos(a) * k;
  const sn = Math.sin(a) * k;
  const half = CELL / 2;
  val.set(c, sn, x - (c * half - sn * half), y - (sn * half + c * half));
};

/** The net bag this frame, as plain numbers: its rim, how deep, how wide, how swollen */
function sackShape(w: World) {
  'worklet';
  const g = w.geo;
  const m = mouthY(w);
  const bottom = g.bottom + sagOf(w.bag.fill) + w.bag.y + g.hide * HIDE;
  return {
    cx: g.cx,
    m,
    bw: g.bw * (1 + w.bag.sq * 0.05),
    depth: (bottom - m) * (1 - w.bag.sq * 0.05),
    bulge: bulgeOf(w.bag.fill),
    fill: w.bag.fill,
    cinch: w.bag.cinch,
  };
}
type Sack = ReturnType<typeof sackShape>;

/**
 * A point on the net, by where it is round the bag (u, -1 to 1 across) and how deep (v). The bag
 * is round, seen a little from above: the net on the near side bows down, on the far side up, and
 * a diamond squeezes thin as the bag turns away at its edges.
 */
const sackX = (t: Sack, u: number, v: number) => {
  'worklet';
  return t.cx + Math.sin((u * Math.PI) / 2) * sackHalf(t.bw, t.bulge, v, t.cinch);
};
const sackY = (t: Sack, u: number, v: number, side: number) => {
  'worklet';
  return t.m + v * t.depth + side * 0.09 * sackHalf(t.bw, t.bulge, v, t.cinch) * Math.cos((u * Math.PI) / 2);
};

/** How far a cord drifts across per unit of depth: the net hangs looser, taller diamonds, when it's empty */
const slopeOf = (t: Sack) => {
  'worklet';
  return 1.05 - t.fill * 0.22;
};
const CORDS = 7;

/** One side of the net: two sets of cords crossing in diamonds, cut at the bag's edges */
function meshPath(t: Sack, side: number) {
  'worklet';
  const p = Skia.PathBuilder.Make();
  const K = slopeOf(t);
  const du = 2 / CORDS;
  const shift = side > 0 ? 0 : du / 2;
  for (let dir = -1; dir <= 1; dir += 2) {
    for (let c = -1 - K + shift; c <= 1 + K; c += du) {
      // u = c + dir K v, kept where it's on this side of the bag
      const a = (-1 - c) / (dir * K);
      const b = (1 - c) / (dir * K);
      const v0 = Math.max(0, Math.min(a, b));
      const v1 = Math.min(1, Math.max(a, b));
      if (v1 - v0 < 0.02) continue;
      for (let k = 0; k <= 10; k++) {
        const v = v0 + ((v1 - v0) * k) / 10;
        const u = c + dir * K * v;
        if (k === 0) p.moveTo(sackX(t, u, v), sackY(t, u, v, side));
        else p.lineTo(sackX(t, u, v), sackY(t, u, v, side));
      }
    }
  }
  return p.detach();
}

/** The knots where the near side's cords cross */
function knotPath(t: Sack) {
  'worklet';
  const p = Skia.PathBuilder.Make();
  const K = slopeOf(t);
  const du = 2 / CORDS;
  for (let c1 = -1 - K; c1 <= 1 + K; c1 += du) {
    for (let c2 = -1 - K; c2 <= 1 + K; c2 += du) {
      const v = (c2 - c1) / (2 * K);
      const u = (c1 + c2) / 2;
      if (v < 0.04 || v > 0.97 || Math.abs(u) > 0.96) continue;
      p.addCircle(sackX(t, u, v), sackY(t, u, v, 1), 2.3);
    }
  }
  // And the big one at the bottom that gathers them all
  p.addCircle(t.cx, t.m + t.depth, 4.5);
  return p.detach();
}

/** Half the rim's rope: the far half, or the near */
function rimPath(t: Sack, side: number) {
  'worklet';
  const p = Skia.PathBuilder.Make();
  for (let k = 0; k <= 24; k++) {
    const u = -1 + (2 * k) / 24;
    if (k === 0) p.moveTo(sackX(t, u, 0), sackY(t, u, 0, side));
    else p.lineTo(sackX(t, u, 0), sackY(t, u, 0, side));
  }
  return p.detach();
}

/** A rope handle, tied to the rim on one side of the bag, swinging a little as the bag bounces */
function handlePath(t: Sack, side: number, sway: number, unfurl: number) {
  'worklet';
  const u = 0.42;
  const xl = sackX(t, -u, 0);
  const xr = sackX(t, u, 0);
  const yl = sackY(t, -u, 0, side);
  const yr = sackY(t, u, 0, side);
  const lift = (side > 0 ? 56 : 64) * (1 - t.fill * 0.06) * unfurl;
  return Skia.PathBuilder.Make()
    .moveTo(xl, yl)
    .cubicTo(xl - 8 + sway, yl - lift, xr + 8 + sway, yr - lift, xr, yr)
    .detach();
}

/** A little tassel hanging from the knot at the bottom, swinging the other way to the bag */
function tasselPath(t: Sack, sway: number) {
  'worklet';
  const x = t.cx;
  const y = t.m + t.depth + 3;
  const p = Skia.PathBuilder.Make();
  for (let k = -1; k <= 1; k++) {
    const len = k === 0 ? 17 : 13;
    p.moveTo(x + k * 1.2, y).quadTo(x + k * 2.6 - sway * 0.25, y + len * 0.6, x + k * 3.4 - sway * 0.55, y + len);
  }
  return p.detach();
}

/** The bow the drawstring's tied in once it's pulled shut */
function bowPath(t: Sack) {
  'worklet';
  const k = t.cinch;
  const x = t.cx;
  const y = sackY(t, 0, 0, 1) + 2;
  return Skia.PathBuilder.Make()
    .moveTo(x, y)
    .cubicTo(x - 16 * k, y - 14 * k, x - 20 * k, y + 8 * k, x, y)
    .cubicTo(x + 16 * k, y - 14 * k, x + 20 * k, y + 8 * k, x, y)
    .moveTo(x, y)
    .lineTo(x - 6 * k, y + 16 * k)
    .moveTo(x, y)
    .lineTo(x + 8 * k, y + 15 * k)
    .detach();
}

export default function MarketBag() {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  /** The products, rendered: nothing until the bake's done (once per run of the app) */
  const [baked, setBaked] = useState<Baked | null>(null);
  const bakerRef = useRef<CanvasRef>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let job = alreadyBaked();
      if (!job) {
        const adapter = await navigator.gpu.requestAdapter();
        const device = await adapter?.requestDevice();
        // The hidden canvas may not be ready on the very first frame
        let context = bakerRef.current?.getContext('webgpu') ?? null;
        for (let tries = 0; !context && tries < 20 && !cancelled; tries++) {
          await new Promise((r) => setTimeout(r, 50));
          context = bakerRef.current?.getContext('webgpu') ?? null;
        }
        if (!device || !context) {
          if (__DEV__) (globalThis as { bakeStage?: string }).bakeStage = `no ${device ? 'context' : 'device'}`;
          return;
        }
        job = bakeProducts(context, device);
      }
      const result = await job;
      if (!cancelled) setBaked(result);
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  const atlas = baked?.atlas ?? null;
  const world = useSharedValue<World>(makeWorld());
  /** The bag dropped out of sight; turned over to pour; carried off; its drawstring pulled */
  const hide = useSharedValue(1);
  const tip = useSharedValue(0);
  /**
   * The bag popping up out of the dock, and the dock sliding up, when the first thing's added. The
   * bag rests at full size while it's hidden below the screen: recorded while scaled to nothing, the
   * canvas draws it too big until it's next recorded
   */
  const pop = useSharedValue(1);
  const dock = useSharedValue(0);
  /** The emptied bag tossed aside, off to the right */
  const aside = useSharedValue(0);
  const depart = useSharedValue(0);
  const cinch = useSharedValue(0);
  /** The cart's counter fading in over the shop */
  const counter = useSharedValue(0);
  const flash = useSharedValue(0);
  const lifted = useSharedValue(-1);
  const held = useSharedValue(-1);
  const scrollY = useSharedValue(0);
  /** Where the category bar sits in the page, before it sticks to the top */
  const [chipsAt, setChipsAt] = useState(0);
  const chipsRef = useRef<View>(null);
  const rootRef = useRef<View>(null);
  // Measured against the screen it's on, so a screen still sliding in can't skew it. Its own layout
  // events don't say where it is reliably (with the content's padding, or without, depending), and
  // can go missing while the products are being rendered, so it's measured again to be sure.
  const measureChips = useCallback(
    () =>
      rootRef.current?.measureInWindow((_rx, ry) =>
        chipsRef.current?.measureInWindow((_x, y) => {
          if (y - ry > 0) setChipsAt(y - ry + scrollY.get());
        })
      ),
    [scrollY]
  );
  useEffect(() => {
    const t = [setTimeout(measureChips, 120), setTimeout(measureChips, 700), setTimeout(measureChips, 1500)];
    return () => t.forEach(clearTimeout);
  }, [baked, measureChips]);

  const [cart, setCart] = useState<Line[]>([]);
  const [open, setOpen] = useState(false);
  const [listed, setListed] = useState(false);
  const [order, setOrder] = useState<Order | null>(null);
  const [category, setCategory] = useState<'All' | Category>('All');
  const [floaters, setFloaters] = useState<{ id: number; text: string }[]>([]);
  const [orderNo, setOrderNo] = useState(2817);
  const cartRef = useRef<Line[]>([]);
  const shownRef = useRef(false);
  const floaterId = useRef(0);
  const arts = useRef(new Map<number, View>());
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const later = (ms: number, fn: () => void) => timers.current.push(setTimeout(fn, ms));
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  /** The one way the cart changes, so the physics' events always see the latest of it */
  const commit = (next: Line[]) => {
    const before = sumOf(cartRef.current);
    cartRef.current = next;
    setCart(next);
    if (before < FREE_AT && sumOf(next) >= FREE_AT) {
      Presets.flourish();
      flash.set(withSequence(withTiming(1, { duration: 160 }), withTiming(0, { duration: 1100 })));
    }
  };

  /**
   * The bag and its dock stay out of the way until there's something to put in it: then the dock
   * slides up and the bag rises out of it, its handles lifting after it. Emptied, they go.
   */
  const reveal = () => {
    if (shownRef.current) return;
    shownRef.current = true;
    setDocked([]);
    hide.set(0);
    pop.set(0);
    dock.set(withTiming(1, { duration: 420, easing: Easing.out(Easing.cubic) }));
    pop.set(withDelay(90, withTiming(1, { duration: 460, easing: Easing.out(Easing.cubic) })));
    later(130, () => Presets.System.impactSoft());
  };
  const conceal = () => {
    if (!shownRef.current) return;
    shownRef.current = false;
    pop.set(withTiming(0, { duration: 260, easing: Easing.in(Easing.cubic) }));
    dock.set(withDelay(80, withTiming(0, { duration: 320, easing: Easing.in(Easing.cubic) })));
    later(420, () => {
      if (shownRef.current) return;
      hide.set(1);
      // Kept at full size while it's out of sight below: see `pop`
      pop.set(1);
    });
  };

  const bagBottom = height - insets.bottom - 24;
  /** How high the bag's lifted to be poured out, so its mouth hangs over the list */
  const rise = bagBottom - BAG_H - height * 0.3;
  useEffect(() => {
    world.modify((w) => {
      'worklet';
      w.geo.w = width;
      w.geo.h = height;
      w.geo.cx = width / 2;
      w.geo.bottom = bagBottom;
      w.geo.counter = height - insets.bottom - 150;
      return w;
    });
  }, [world, width, height, bagBottom, insets.bottom]);

  const counts = cart.reduce<Record<number, number>>(
    (acc, l) => ({ ...acc, [l.product]: (acc[l.product] ?? 0) + 1 }),
    {}
  );
  const total = sumOf(cart);
  const free = total >= FREE_AT;
  const grand = total + (free || total === 0 ? 0 : DELIVERY);
  // The dock keeps showing what was in the bag while it slides away empty
  const [docked, setDocked] = useState<Line[]>([]);
  if (cart.length > 0 && docked !== cart) setDocked(cart);
  const dockTotal = sumOf(docked);
  const dockFree = dockTotal >= FREE_AT;
  const groups = groupsOf(cart);
  const listTop = insets.top + 128;
  const listBottom = height - insets.bottom - FOOT;
  /** Rows get shorter, and their products smaller, when there are many */
  const layoutFor = (n: number) => {
    const pitch = Math.min(ROW + GAP, Math.floor((listBottom - listTop) / Math.max(1, n)));
    const rowH = pitch - GAP;
    return { pitch, rowH, s: LIST_S * Math.min(1, rowH / ROW) };
  };
  const rows = layoutFor(groups.length);
  const stackAt = (row: number, k: number) => ({
    x: STACK_X + k * 8,
    y: listTop + row * rows.pitch + rows.rowH / 2 - k * 4,
  });

  /** Spring every product on the counter to its line in the list: copies of a thing fan out a little */
  const tidyTo = (lines: Line[]) => {
    const order_ = groupsOf(lines);
    const { pitch, rowH, s } = layoutFor(order_.length);
    const targets: { slot: number; x: number; y: number; a: number; s: number }[] = [];
    order_.forEach((product, row) => {
      lines
        .filter((l) => l.product === product)
        .forEach((l, k) => {
          targets.push({
            slot: l.slot,
            x: STACK_X + k * 8,
            y: listTop + row * pitch + rowH / 2 - k * 4,
            a: (k % 2 ? 1 : -1) * 0.08 * k,
            s,
          });
        });
    });
    scheduleOnUI((t: typeof targets) => {
      'worklet';
      world.modify((w) => {
        'worklet';
        tidy(w, t);
        return w;
      });
    }, targets);
  };

  // What JS hears from the products' world
  const onEvent = (kind: number, slot: number, product: number) => {
    if (kind === LANDED || kind === SPAWNED) {
      if (cartRef.current.some((l) => l.slot === slot)) return;
      const next = [...cartRef.current, { slot, product }];
      commit(next);
      if (kind === LANDED) {
        Presets.coinDrop();
        const id = ++floaterId.current;
        setFloaters((f) => [...f, { id, text: `+${formatVnd(PRODUCTS[product].price)}` }]);
        later(1150, () => setFloaters((f) => f.filter((x) => x.id !== id)));
      } else {
        Presets.System.impactLight();
        tidyTo(next);
      }
    } else if (kind === THUD) {
      Presets.System.impactSoft();
    } else if (kind === SPILLED) {
      Presets.plink();
    }
  };

  useFrameCallback((frame) => {
    const dt = Math.min(1 / 30, (frame.timeSincePreviousFrame ?? 16) / 1000);
    world.modify((w) => {
      'worklet';
      w.geo.hide = hide.get();
      w.tip.a = tip.get() * TIP;
      w.tip.rise = Math.min(1, tip.get()) * rise;
      w.bag.cinch = cinch.get();
      step(w, dt);
      for (let i = 0; i < w.events.length; i += 3) scheduleOnRN(onEvent, w.events[i], w.events[i + 1], w.events[i + 2]);
      w.events.length = 0;
      return w;
    });
  });

  // ---- Adding ----
  const addFromCard = (product: number) => {
    const view = arts.current.get(product);
    if (!view || open || !baked) return;
    reveal();
    view.measureInWindow((x, y, w, h) => {
      Presets.System.impactLight();
      lifted.set(product);
      later(260, () => lifted.set(-1));
      scheduleOnUI(
        (cx: number, cy: number) => {
          'worklet';
          world.modify((wd) => {
            'worklet';
            peel(wd, product, cx, cy);
            return wd;
          });
        },
        x + w / 2,
        y + h / 2
      );
    });
  };

  // ---- The cart ----
  const openCart = () => {
    if (open) return;
    if (cart.length === 0) {
      // Nothing in it: it just shrugs
      Presets.wobble();
      scheduleOnUI(() => {
        'worklet';
        world.modify((w) => {
          'worklet';
          w.bag.sv += 5;
          w.bag.v -= 140;
          return w;
        });
      });
      return;
    }
    setOpen(true);
    Presets.swell();
    // Turned over above the counter, so it all slides out of its mouth
    tip.set(withTiming(1, { duration: 640, easing: Easing.inOut(Easing.cubic) }));
    counter.set(withDelay(360, withTiming(1, { duration: 420 })));
    later(760, () => {
      Presets.wobble();
      tip.set(
        withSequence(
          withTiming(1.07, { duration: 90 }),
          withTiming(0.95, { duration: 110 }),
          withTiming(1.05, { duration: 100 }),
          withTiming(1, { duration: 120 })
        )
      );
    });
    later(1180, () =>
      scheduleOnUI(() => {
        'worklet';
        world.modify((w) => {
          'worklet';
          shakeOut(w);
          return w;
        });
      })
    );
    // The empty bag's tossed aside, and everything files into its line
    later(1320, () => {
      Presets.System.impactLight();
      aside.set(withTiming(1, { duration: 460, easing: Easing.in(Easing.cubic) }));
      tidyTo(cartRef.current);
      later(150, () => setListed(true));
    });
    // Off screen, it's put back upright out of sight below, to come back up when the cart's closed
    later(1820, () => {
      tip.set(0);
      aside.set(0);
      hide.set(1);
    });
  };

  const closeCart = (then?: () => void) => {
    setListed(false);
    counter.set(withTiming(0, { duration: 420 }));
    later(520, () => setOpen(false));
    // Nothing left: the bag and its dock go away with the cart
    if (cartRef.current.length === 0) {
      conceal();
      return;
    }
    hide.set(withTiming(0, { duration: 460, easing: Easing.out(Easing.cubic) }));
    later(240, () =>
      scheduleOnUI(() => {
        'worklet';
        world.modify((w) => {
          'worklet';
          pack(w);
          return w;
        });
      })
    );
    if (then) later(240 + cartRef.current.length * 70 + 1000, then);
  };

  const removeLine = (product: number) => {
    Presets.flick();
    const slots = cartRef.current.filter((l) => l.product === product).map((l) => l.slot);
    scheduleOnUI((s: number[]) => {
      'worklet';
      world.modify((w) => {
        'worklet';
        for (let k = 0; k < s.length; k++) discard(w, s[k], -1400 - k * 120);
        return w;
      });
    }, slots);
    const left = cartRef.current.filter((l) => l.product !== product);
    commit(left);
    // The lines below move up to close the gap, and their products with them
    if (left.length === 0) later(400, () => closeCart());
    else later(90, () => tidyTo(left));
  };

  const stepUp = (product: number) => {
    const row = groupsOf(cartRef.current).indexOf(product);
    const { x, y } = stackAt(row, counts[product] ?? 0);
    scheduleOnUI(
      (px: number, py: number) => {
        'worklet';
        world.modify((w) => {
          'worklet';
          spawn(w, product, px, py);
          return w;
        });
      },
      x,
      y
    );
  };

  const stepDown = (product: number) => {
    const mine = cartRef.current.filter((l) => l.product === product);
    if (mine.length <= 1) return removeLine(product);
    Presets.System.selection();
    const last = mine[mine.length - 1].slot;
    scheduleOnUI((s: number) => {
      'worklet';
      world.modify((w) => {
        'worklet';
        discard(w, s, 900);
        return w;
      });
    }, last);
    const left = cartRef.current.filter((l) => l.slot !== last);
    commit(left);
    later(60, () => tidyTo(left));
  };

  const checkout = () => {
    Presets.System.notificationSuccess();
    const placed = { id: `VG-${orderNo}`, items: cart.length, total: grand };
    // On its way: the box that turns up in Unboxing holds these
    shipOrder({ id: placed.id, items: cart.map((l) => l.product) });
    setOrderNo(orderNo + 1);
    closeCart(() => {
      // Drawstring pulled shut, and the bag's carried off by its handles
      Presets.zipper();
      cinch.set(withTiming(1, { duration: 420, easing: Easing.inOut(Easing.cubic) }));
      later(520, () => {
        Presets.propel();
        scheduleOnUI(() => {
          'worklet';
          world.modify((w) => {
            'worklet';
            w.bag.v -= 260;
            return w;
          });
        });
        depart.set(withTiming(1, { duration: 820, easing: Easing.in(Easing.cubic) }));
      });
      // Gone, and what was in it went with it; the dock goes too, till next time
      later(1400, () => {
        Presets.triumph();
        scheduleOnUI(() => {
          'worklet';
          world.modify((w) => {
            'worklet';
            clearBag(w);
            return w;
          });
        });
        hide.set(1);
        depart.set(0);
        cinch.set(0);
        commit([]);
        setOrder(placed);
        conceal();
      });
      later(5000, () => setOrder(null));
    });
  };

  // ---- Drawing the products: each the frame of its turntable for the way it's turned ----
  const sprites = useRectBuffer(MAX, (r, i) => {
    'worklet';
    const b = world.get().bodies[i];
    r.setXYWH(frameOf(b.yaw) * CELL, b.product * CELL, CELL, CELL);
  });
  const inBag = useRSXformBuffer(MAX, (val, i) => {
    'worklet';
    const b = world.get().bodies[i];
    if (!b.live || b.layer !== BAG) return val.set(0, 0, -9999, -9999);
    place(val, b.x, b.y, b.a, b.s);
  });
  const above = useRSXformBuffer(MAX, (val, i) => {
    'worklet';
    const b = world.get().bodies[i];
    if (!b.live || (b.layer !== AIR && b.layer !== COUNTER && b.layer !== GONE)) return val.set(0, 0, -9999, -9999);
    place(val, b.x, b.y, b.a, b.s);
  });
  const shadows = useRSXformBuffer(MAX, (val, i) => {
    'worklet';
    const b = world.get().bodies[i];
    if (!b.live || (b.layer !== AIR && b.layer !== COUNTER && b.layer !== GONE)) return val.set(0, 0, -9999, -9999);
    // Held or thrown, it's high off the page and its shadow falls further and softer
    const up = b.layer === COUNTER ? 0.25 : 1;
    place(val, b.x + 4 + up * 10, b.y + 6 + up * 18, b.a, b.s * (1 + up * 0.04));
  });

  const sack = useDerivedValue(() => sackShape(world.get()));
  const farNet = useDerivedValue(() => meshPath(sack.get(), -1));
  const nearNet = useDerivedValue(() => meshPath(sack.get(), 1));
  const knots = useDerivedValue(() => knotPath(sack.get()));
  const farRim = useDerivedValue(() => rimPath(sack.get(), -1));
  const nearRim = useDerivedValue(() => rimPath(sack.get(), 1));
  const bow = useDerivedValue(() => bowPath(sack.get()));
  const sway = useDerivedValue(() => Math.max(-14, Math.min(14, world.get().bag.v * 0.03)));
  const unfurl = useDerivedValue(() => Math.max(0, Math.min(1.15, (pop.get() - 0.3) / 0.7)));
  const farHandle = useDerivedValue(() => handlePath(sack.get(), -1, sway.get(), unfurl.get()));
  const nearHandle = useDerivedValue(() => handlePath(sack.get(), 1, sway.get() * 1.3, unfurl.get()));
  const tassel = useDerivedValue(() => tasselPath(sack.get(), sway.get()));
  // Rising out of the dock: it grows from its bottom knot
  const popTurn = useDerivedValue(() => [
    { translateY: (1 - Math.min(1, pop.get())) * 26 },
    { scale: Math.max(0.001, pop.get()) },
  ]);
  const popPivot = useDerivedValue(() => vec(sack.get().cx, sack.get().m + sack.get().depth));
  const shadow = useDerivedValue(() => {
    const t = sack.get();
    const hw = sackHalf(t.bw, t.bulge, 0.6);
    return Skia.XYWHRect(t.cx - hw * 0.8, t.m + t.depth - 6, hw * 1.6, 14);
  });
  const shadowOpacity = useDerivedValue(() => Math.max(0, 1 - tip.get() * 2) * (1 - depart.get()));
  const lift = useDerivedValue(() => -depart.get() * (height + 200));
  // Turned about the middle of its rim, and lifted to pour; or carried off
  const bagTurn = useDerivedValue(() => [
    { translateX: aside.get() * width * 0.95 },
    { translateY: lift.get() - Math.min(1, tip.get()) * rise - aside.get() * 140 },
    { rotate: tip.get() * TIP + aside.get() * 0.9 },
  ]);
  const bagPivot = useDerivedValue(() => vec(sack.get().cx, sack.get().m));
  const bowOpacity = useDerivedValue(() => Math.min(1, cinch.get() * 3));

  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.set(e.contentOffset.y);
  });
  const chipsStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: Math.max(insets.top + 6, chipsAt - scrollY.get()) }],
  }));
  const counterStyle = useAnimatedStyle(() => ({ opacity: counter.get() }));
  const flashStyle = useAnimatedStyle(() => ({ opacity: flash.get() }));
  const dockStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, dock.get() * 1.6),
    transform: [{ translateY: (1 - dock.get()) * 120 }, { scale: 0.92 + 0.08 * dock.get() }],
  }));
  const fadeStyle = useAnimatedStyle(() => ({ opacity: Math.min(1, dock.get()) }));

  const cardW = (width - 28 - 12) / 2;
  const shown = PRODUCTS.filter((p) => category === 'All' || p.category === category);
  const pickCategory = (c: 'All' | Category) => {
    Presets.System.selection();
    setCategory(c);
  };

  return (
    <View ref={rootRef} style={styles.root}>
      <StatusBar style="dark" />
      <Animated.ScrollView
        style={StyleSheet.absoluteFill}
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={{
          paddingTop: insets.top + 64,
          paddingBottom: insets.bottom + 270,
          paddingHorizontal: 14,
        }}
        scrollEnabled={!open}>
        <Text style={styles.title}>Market</Text>
        <Text style={styles.subtitle}>Tap +, or pick one up and toss it in the bag.</Text>
        <View ref={chipsRef} style={styles.chipsSpace} onLayout={() => measureChips()} />
        <View style={styles.grid}>
          {shown.map((p) => (
            <Animated.View
              key={p.id}
              entering={FadeIn.duration(240)}
              exiting={FadeOut.duration(140)}
              layout={LinearTransition.duration(300).easing(Easing.out(Easing.cubic))}>
              <Card
                product={p.id}
                hero={baked?.heroes[p.id] ?? null}
                shadow={baked?.shadows[p.id] ?? null}
                count={counts[p.id] ?? 0}
                width={cardW}
                lifted={lifted}
                held={held}
                world={world}
                onAdd={() => addFromCard(p.id)}
                onPeel={reveal}
                artRef={(v) => {
                  if (v) arts.current.set(p.id, v);
                  else arts.current.delete(p.id);
                }}
              />
            </Animated.View>
          ))}
        </View>
      </Animated.ScrollView>

      {/* Mounted afresh once the products are rendered: that commit puts animated styles round here
          back to how they first rendered, the bar back at the top and its pill to nothing */}
      {/* The page fades out under the status bar, so cards scrolled up don't run into the clock */}
      <View pointerEvents="none" style={[styles.topFade, { height: insets.top + 30 }]} />
      <Animated.View key={baked ? 'shop' : 'baking'} style={[styles.chips, chipsStyle]}>
        <Chips value={category} onChange={pickCategory} />
      </Animated.View>

      {/* The shop fades out under the dock, and the bag stands on the dock */}
      <Animated.View pointerEvents="none" style={[styles.fade, fadeStyle]} />
      <Animated.View
        pointerEvents={cart.length > 0 ? 'auto' : 'none'}
        style={[styles.dockWrap, { bottom: insets.bottom - 6 }, dockStyle]}>
        <Pressable
          onPress={openCart}
          accessibilityRole="button"
          accessibilityLabel={`Bag, ${cart.length} items, ${formatVnd(total)}`}>
          <Glass style={styles.dock}>
            <Animated.View pointerEvents="none" style={[styles.dockFlash, flashStyle]} />
            <View style={styles.dockSide}>
              <View style={styles.dockCount}>
                {/* A new count pops in each time something lands */}
                <Animated.View key={docked.length} entering={FadeIn.duration(180)} style={styles.countDot}>
                  <Text style={styles.countText}>{docked.length}</Text>
                </Animated.View>
                <Text style={styles.dockUnit}>{docked.length === 1 ? 'item' : 'items'}</Text>
              </View>
              <Text style={[styles.dockNote, dockFree && { color: GREEN }]} numberOfLines={1}>
                {dockFree ? 'Free delivery ✓' : `${short(FREE_AT - dockTotal)} to free delivery`}
              </Text>
            </View>
            <View style={[styles.dockSide, styles.dockRight]}>
              <NumericText value={formatVnd(dockTotal)} fontSize={16} color={INK} weight="bold" />
              <View style={styles.dockCta}>
                <Text style={styles.dockNote}>View bag</Text>
                <SymbolView name="chevron.up" size={9} weight="bold" tintColor={SUB} />
              </View>
            </View>
            <Meter progress={dockTotal / FREE_AT} style={styles.dockMeter} />
          </Glass>
        </Pressable>
      </Animated.View>

      {/* The cart: the counter the bag is tipped out onto */}
      <Animated.View
        pointerEvents={open ? 'auto' : 'none'}
        style={[StyleSheet.absoluteFill, styles.counter, counterStyle]}>
        <View style={[styles.cartHead, { top: insets.top + 64 }]}>
          <Text style={styles.title}>Your bag</Text>
          <Text style={styles.subtitle}>
            {cart.length} {cart.length === 1 ? 'thing' : 'things'} · swipe one away to put it back
          </Text>
        </View>
        {listed
          ? groups.map((product, row) => (
              <LineRow
                key={product}
                product={product}
                slots={cart.filter((l) => l.product === product).map((l) => l.slot)}
                top={listTop + row * rows.pitch}
                height={rows.rowH}
                delay={row * 45}
                world={world}
                onRemove={() => removeLine(product)}
                onUp={() => stepUp(product)}
                onDown={() => stepDown(product)}
              />
            ))
          : null}
        {listed ? (
          <Animated.View
            entering={FadeInDown.delay(120).duration(360).easing(Easing.out(Easing.cubic))}
            style={[styles.foot, { paddingBottom: insets.bottom + 8 }]}>
            <Glass style={styles.summary}>
              <View style={styles.sumRow}>
                <Text style={styles.sumLabel}>Subtotal</Text>
                <NumericText value={formatVnd(total)} fontSize={15} color={INK} weight="medium" />
              </View>
              <View style={styles.sumRow}>
                <Text style={styles.sumLabel}>Delivery</Text>
                {free ? (
                  <Animated.Text entering={FadeIn.duration(220)} style={[styles.sumValue, { color: GREEN }]}>
                    Free
                  </Animated.Text>
                ) : (
                  <Text style={styles.sumValue}>{formatVnd(DELIVERY)}</Text>
                )}
              </View>
              <View style={styles.meterRow}>
                <Meter progress={total / FREE_AT} style={styles.meterWide} />
                <View style={styles.meterNote}>
                  <SymbolView
                    name="shippingbox.fill"
                    size={12}
                    tintColor={free ? GREEN : SUB}
                    animationSpec={free ? { effect: { type: 'bounce' } } : undefined}
                  />
                  <Text style={[styles.meterText, free && { color: GREEN }]}>
                    {free ? 'Free delivery unlocked' : `${formatVnd(FREE_AT - total)} more for free delivery`}
                  </Text>
                </View>
              </View>
              <View style={styles.hair} />
              <View style={styles.sumRow}>
                <Text style={styles.totalLabel}>Total</Text>
                <NumericText value={formatVnd(grand)} fontSize={26} color={INK} weight="bold" />
              </View>
            </Glass>
            <View style={styles.payRow}>
              <Pressable onPress={() => closeCart()} accessibilityRole="button" accessibilityLabel="Back to the shop">
                <Glass interactive style={styles.back}>
                  <SymbolView name="chevron.down" size={18} weight="bold" tintColor={INK} />
                </Glass>
              </Pressable>
              <HoldToPay amount={grand} onDone={checkout} />
            </View>
          </Animated.View>
        ) : null}
      </Animated.View>

      <LateCanvas style={StyleSheet.absoluteFill}>
        <Group transform={popTurn} origin={popPivot}>
          <Group opacity={shadowOpacity}>
            <Oval rect={shadow} color="rgba(60,30,20,0.2)">
              <Blur blur={6} />
            </Oval>
          </Group>
          <Group transform={bagTurn} origin={bagPivot}>
            <Path path={farHandle} style="stroke" strokeWidth={4.5} strokeCap="round" color={CORD_FAR} />
            <Path path={farRim} style="stroke" strokeWidth={4.5} strokeCap="round" color={CORD_FAR} />
            <Path path={farNet} style="stroke" strokeWidth={1.5} strokeJoin="round" color={CORD_FAR} opacity={0.75} />
            <Atlas image={atlas} sprites={sprites} transforms={inBag} />
            <Group transform={[{ translateX: 0.8 }, { translateY: 1.4 }]}>
              <Path path={nearNet} style="stroke" strokeWidth={2.8} strokeJoin="round" color={CORD_SHADE} />
            </Group>
            <Path path={nearNet} style="stroke" strokeWidth={2.2} strokeJoin="round" color={CORD} />
            {/* Light along the top of each cord, so it reads round */}
            <Group transform={[{ translateY: -0.6 }]}>
              <Path
                path={nearNet}
                style="stroke"
                strokeWidth={0.7}
                strokeJoin="round"
                color={CORD_LIGHT}
                opacity={0.75}
              />
            </Group>
            <Path path={knots} color={CORD} />
            <Path path={tassel} style="stroke" strokeWidth={2} strokeCap="round" color={CORD} />
            <Path path={nearRim} style="stroke" strokeWidth={5.5} strokeCap="round" color={CORD} />
            {/* The rope's twist */}
            <Path path={nearRim} style="stroke" strokeWidth={2.2} color={CORD_LIGHT} opacity={0.85}>
              <DashPathEffect intervals={[2.5, 3.5]} />
            </Path>
            <Path path={nearHandle} style="stroke" strokeWidth={4.5} strokeCap="round" color={CORD} />
            <Path path={nearHandle} style="stroke" strokeWidth={1.8} color={CORD_LIGHT} opacity={0.85}>
              <DashPathEffect intervals={[2.5, 3.5]} />
            </Path>
            <Path
              path={bow}
              style="stroke"
              strokeWidth={3.5}
              strokeCap="round"
              strokeJoin="round"
              color={CORD}
              opacity={bowOpacity}
            />
          </Group>
        </Group>
        <Atlas image={atlas} sprites={sprites} transforms={shadows}>
          <ColorMatrix matrix={[0, 0, 0, 0, 0.08, 0, 0, 0, 0, 0.06, 0, 0, 0, 0, 0.05, 0, 0, 0, 0.26, 0]} />
          <Blur blur={6} />
        </Atlas>
        <Atlas image={atlas} sprites={sprites} transforms={above} />
      </LateCanvas>

      {/* The bag itself is a button too: tap it to tip it out */}
      {!open && cart.length > 0 ? (
        <Pressable
          onPress={openCart}
          accessibilityRole="button"
          accessibilityLabel={`Tip out the bag, ${cart.length} items`}
          style={[styles.bagHit, { left: width / 2 - 85, top: bagBottom - BAG_H + 8, width: 170, height: BAG_H - 38 }]}
        />
      ) : null}
      {floaters.map((f) => (
        <Animated.Text
          key={f.id}
          entering={FLOAT}
          pointerEvents="none"
          style={[styles.floater, { top: bagBottom - BAG_H - 84 }]}>
          {f.text}
        </Animated.Text>
      ))}
      {order ? <Receipt order={order} top={height * 0.24} /> : null}
      {baked ? null : <GPUCanvas ref={bakerRef} style={styles.baker} />}
    </View>
  );
}

/** A price floating up out of the bag as the thing lands in it */
const FLOAT = new Keyframe({
  0: { opacity: 0, transform: [{ translateY: 10 }] },
  20: { opacity: 1, transform: [{ translateY: 0 }] },
  100: { opacity: 0, transform: [{ translateY: -44 }] },
}).duration(1100);

/** Liquid Glass where there is any, and frosted white where there isn't */
function Glass({
  style,
  children,
  tint,
  interactive = false,
}: {
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
  tint?: string;
  interactive?: boolean;
}) {
  return (
    <GlassView
      glassEffectStyle="regular"
      isInteractive={interactive}
      tintColor={tint}
      colorScheme="light"
      style={[!GLASS && styles.frost, !GLASS && tint ? { backgroundColor: tint } : null, style]}>
      {children}
    </GlassView>
  );
}

/** The categories, in a glass bar that sticks to the top; the selection slides between them */
function Chips({ value, onChange }: { value: 'All' | Category; onChange: (c: 'All' | Category) => void }) {
  // Where each chip is, kept as state so the pill always finds the selected one, however late the
  // layout comes in
  const [spots, setSpots] = useState<Partial<Record<string, { x: number; w: number }>>>({});
  const x = useSharedValue(0);
  const w = useSharedValue(0);
  const placed = useRef(false);
  const row = useRef<View>(null);
  const chips = useRef(new Map<string, View>());
  useEffect(() => {
    // Each chip against the row it's in, so nothing moving round them can throw it off
    const measure = () => {
      const within = row.current;
      if (!within) return;
      chips.current.forEach((view, c) =>
        view.measureLayout(within, (cx, _cy, cw) => {
          if (cw > 0)
            setSpots((all) => (all[c]?.x === cx && all[c]?.w === cw ? all : { ...all, [c]: { x: cx, w: cw } }));
        })
      );
    };
    const t = [setTimeout(measure, 150), setTimeout(measure, 800), setTimeout(measure, 1600)];
    return () => t.forEach(clearTimeout);
  }, []);
  const spot = spots[value];
  useEffect(() => {
    if (!spot) return;
    const glide = { duration: 280, easing: Easing.out(Easing.cubic) };
    // Straight there the first time, glides after that
    x.set(placed.current ? withTiming(spot.x, glide) : spot.x);
    w.set(placed.current ? withTiming(spot.w, glide) : spot.w);
    placed.current = true;
  }, [spot, x, w]);
  const pill = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }], width: w.get() }));
  return (
    <Glass style={styles.chipBar}>
      <View ref={row} style={styles.chipRow}>
        <Animated.View style={[styles.chipPill, pill]} />
        {CATEGORIES.map((c) => (
          <Pressable
            key={c}
            ref={(v) => {
              if (v) chips.current.set(c, v);
              else chips.current.delete(c);
            }}
            onLayout={(e) => {
              const { x: cx, width: cw } = e.nativeEvent.layout;
              setSpots((all) => ({ ...all, [c]: { x: cx, w: cw } }));
            }}
            onPress={() => onChange(c)}
            accessibilityRole="button"
            accessibilityState={{ selected: c === value }}
            style={styles.chip}>
            <Text style={[styles.chipText, c === value && styles.chipTextOn]}>{c}</Text>
          </Pressable>
        ))}
      </View>
    </Glass>
  );
}

/** How close the bag is to free delivery */
function Meter({ progress, style }: { progress: number; style?: StyleProp<ViewStyle> }) {
  const p = useSharedValue(0);
  useEffect(() => {
    p.set(withTiming(Math.min(1, progress), { duration: 520, easing: Easing.out(Easing.cubic) }));
  }, [p, progress]);
  // A spring overshoots below nothing on its way down, and a negative width would stick
  const fill = useAnimatedStyle(() => ({
    width: `${Math.max(0, Math.min(1, p.get())) * 100}%`,
    backgroundColor: p.get() >= 0.999 ? GREEN : CORD,
  }));
  return (
    <View style={[styles.meter, style]}>
      <Animated.View style={[styles.meterFill, fill]} />
    </View>
  );
}

function Card({
  product,
  hero,
  shadow,
  count,
  width,
  lifted,
  held,
  world,
  onAdd,
  onPeel,
  artRef,
}: {
  product: number;
  hero: string | null;
  shadow: string | null;
  count: number;
  width: number;
  lifted: SharedValue<number>;
  held: SharedValue<number>;
  world: SharedValue<World>;
  onAdd: () => void;
  onPeel: () => void;
  artRef: (v: View | null) => void;
}) {
  const p = PRODUCTS[product];
  const home = useSharedValue({ x: 0, y: 0 });
  const press = useSharedValue(0);
  const picked = () => {
    Presets.System.impactLight();
    onPeel();
  };

  // Hold the product to pick it up, then throw it
  const drag = Gesture.Pan()
    .enabled(hero !== null)
    .activateAfterLongPress(170)
    .onBegin(() => {
      press.set(withTiming(1, { duration: 170 }));
    })
    .onStart((e) => {
      const cx = e.absoluteX - e.x + ART_BOX / 2;
      const cy = e.absoluteY - e.y + ART_BOX / 2;
      home.set({ x: cx, y: cy });
      lifted.set(product);
      world.modify((w) => {
        'worklet';
        held.set(grab(w, product, cx, cy, e.absoluteX, e.absoluteY));
        return w;
      });
      scheduleOnRN(picked);
    })
    .onChange((e) => {
      const slot = held.get();
      if (slot < 0) return;
      world.modify((w) => {
        'worklet';
        w.bodies[slot].gx = e.absoluteX;
        w.bodies[slot].gy = e.absoluteY;
        return w;
      });
    })
    .onFinalize((e) => {
      press.set(withTiming(0, { duration: 200 }));
      const slot = held.get();
      if (slot < 0) return;
      held.set(-1);
      lifted.set(-1);
      world.modify((w) => {
        'worklet';
        release(w, slot, e.velocityX, e.velocityY, home.get().x, home.get().y);
        return w;
      });
    });

  return (
    <View style={[styles.card, { width, backgroundColor: p.tint }]}>
      {count > 0 ? (
        <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(150)} style={styles.badge}>
          <NumericText value={String(count)} fontSize={12} color="#FFFFFF" weight="bold" />
          <Text style={styles.badgeText}>in bag</Text>
        </Animated.View>
      ) : null}
      <GestureDetector gesture={drag}>
        <View ref={artRef} collapsable={false} style={styles.artBox}>
          {hero && shadow ? (
            <ProductArt index={product} hero={hero} shadow={shadow} lifted={lifted} press={press} />
          ) : (
            <View style={styles.placeholder} />
          )}
        </View>
      </GestureDetector>
      <Text style={styles.name} numberOfLines={1}>
        {p.name}
      </Text>
      <Text style={styles.note} numberOfLines={1}>
        {p.note}
      </Text>
      <View style={styles.priceRow}>
        <Text style={styles.price}>{formatVnd(p.price)}</Text>
        <AddButton onPress={onAdd} label={`Add ${p.name}`} />
      </View>
    </View>
  );
}

/**
 * A card's product, rendered from its 3D model, standing on its own soft shadow. Pressed, it rises
 * off the card and its shadow spreads under it; taken, it's gone from the card for a moment and a
 * fresh one rises quietly into its place.
 */
function ProductArt({
  index,
  hero,
  shadow,
  lifted,
  press,
}: {
  index: number;
  hero: string;
  shadow: string;
  lifted: SharedValue<number>;
  press: SharedValue<number>;
}) {
  const here = useSharedValue(1);
  useAnimatedReaction(
    () => lifted.get() === index,
    (off, was) => {
      if (off === was) return;
      here.set(
        off
          ? withTiming(0, { duration: 90 })
          : withDelay(160, withTiming(1, { duration: 460, easing: Easing.out(Easing.cubic) }))
      );
    }
  );
  const body = useAnimatedStyle(() => ({
    opacity: here.get(),
    transform: [
      { translateY: (1 - here.get()) * 12 - press.get() * 9 },
      { scale: (0.94 + 0.06 * here.get()) * (1 + press.get() * 0.06) },
    ],
  }));
  const ground = useAnimatedStyle(() => ({
    opacity: (0.3 + 0.7 * here.get()) * (1 - press.get() * 0.4),
    transform: [{ scale: 1 + press.get() * 0.14 }],
  }));
  return (
    <>
      <Animated.Image source={{ uri: shadow }} style={[styles.art, ground]} />
      <Animated.Image source={{ uri: hero }} style={[styles.art, body]} />
    </>
  );
}

/** Dark glass + that turns as it's pressed */
function AddButton({ onPress, label }: { onPress: () => void; label: string }) {
  const turn = useSharedValue(0);
  const icon = useAnimatedStyle(() => ({
    transform: [{ rotate: `${turn.get() * 90}deg` }],
  }));
  return (
    <Pressable
      onPress={() => {
        turn.set(0);
        turn.set(withTiming(1, { duration: 320, easing: Easing.out(Easing.cubic) }));
        onPress();
      }}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}>
      <Glass interactive tint="rgba(23,23,27,0.9)" style={[styles.add, !GLASS && styles.addSolid]}>
        <Animated.View style={icon}>
          <SymbolView name="plus" size={15} weight="bold" tintColor="#FFFFFF" />
        </Animated.View>
      </Glass>
    </Pressable>
  );
}

/**
 * A line in the cart, on glass. Its products sit on its left and follow it as it's swiped; swiped
 * far enough, a bin shows behind it and letting go flicks the lot away.
 */
function LineRow({
  product,
  slots,
  top,
  height,
  delay,
  world,
  onRemove,
  onUp,
  onDown,
}: {
  product: number;
  slots: number[];
  top: number;
  height: number;
  delay: number;
  world: SharedValue<World>;
  onRemove: () => void;
  onUp: () => void;
  onDown: () => void;
}) {
  const p = PRODUCTS[product];
  const x = useSharedValue(0);
  const armed = useSharedValue(0);
  const swipe = Gesture.Pan()
    .activeOffsetX([-12, 12])
    .onChange((e) => {
      const nx = Math.min(0, x.get() + e.changeX);
      x.set(nx);
      world.modify((w) => {
        'worklet';
        for (let k = 0; k < slots.length; k++) w.bodies[slots[k]].tx = STACK_X + k * 8 + nx;
        return w;
      });
      const arm = nx < -90 ? 1 : 0;
      if (arm !== armed.get()) {
        armed.set(arm);
        Presets.System.selection();
      }
    })
    .onEnd((e) => {
      if (x.get() < -90 || e.velocityX < -800) {
        x.set(withTiming(-520, { duration: 220 }));
        scheduleOnRN(onRemove);
      } else {
        x.set(withTiming(0, { duration: 260, easing: Easing.out(Easing.cubic) }));
        armed.set(0);
        world.modify((w) => {
          'worklet';
          for (let k = 0; k < slots.length; k++) w.bodies[slots[k]].tx = STACK_X + k * 8;
          return w;
        });
      }
    });
  const slide = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }] }));
  const bin = useAnimatedStyle(() => ({
    opacity: Math.min(1, -x.get() / 60),
    transform: [{ scale: withTiming(armed.get() ? 1.1 : 0.75 + Math.min(0.25, -x.get() / 360), { duration: 140 }) }],
  }));
  return (
    <Animated.View
      entering={FadeInDown.delay(delay).duration(320).easing(Easing.out(Easing.cubic))}
      layout={LinearTransition.duration(280).easing(Easing.out(Easing.cubic))}
      style={[styles.rowWrap, { top, height }]}>
      <Animated.View style={[styles.bin, bin]}>
        <SymbolView name="trash.fill" size={17} tintColor="#FFFFFF" />
      </Animated.View>
      <GestureDetector gesture={swipe}>
        <Animated.View style={[StyleSheet.absoluteFill, slide]}>
          <Glass style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.rowName} numberOfLines={1}>
                {p.name}
              </Text>
              <NumericText value={formatVnd(p.price * slots.length)} fontSize={14} color={SUB} weight="medium" />
            </View>
            <Glass style={styles.stepper}>
              <Pressable
                onPress={onDown}
                hitSlop={6}
                style={({ pressed }) => [styles.stepBtn, pressed && styles.stepPressed]}
                accessibilityRole="button"
                accessibilityLabel={slots.length > 1 ? `One less ${p.name}` : `Remove ${p.name}`}>
                <SymbolView name={slots.length > 1 ? 'minus' : 'trash'} size={13} weight="bold" tintColor={INK} />
              </Pressable>
              <NumericText value={String(slots.length)} fontSize={15} color={INK} weight="semibold" />
              <Pressable
                onPress={onUp}
                hitSlop={6}
                style={({ pressed }) => [styles.stepBtn, pressed && styles.stepPressed]}
                accessibilityRole="button"
                accessibilityLabel={`One more ${p.name}`}>
                <SymbolView name="plus" size={13} weight="bold" tintColor={INK} />
              </Pressable>
            </Glass>
          </Glass>
        </Animated.View>
      </GestureDetector>
    </Animated.View>
  );
}

/**
 * Hold to pay: it fills as you hold, ticking faster and faster under your thumb, and a glint runs
 * across it every so often while it waits
 */
function HoldToPay({ amount, onDone }: { amount: number; onDone: () => void }) {
  const fill = useSharedValue(0);
  const press = useSharedValue(0);
  const shine = useSharedValue(0);
  useEffect(() => {
    shine.set(
      withRepeat(
        withSequence(
          withDelay(1400, withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) })),
          withTiming(0, { duration: 0 })
        ),
        -1
      )
    );
  }, [shine]);
  // A tick under the thumb at each step of the fill; it eases in, so they come faster and faster
  useAnimatedReaction(
    () => Math.floor(fill.get() * 16),
    (n, was) => {
      if (was !== null && n > was && n < 16) Presets.System.impactLight();
    }
  );
  const gesture = Gesture.LongPress()
    .minDuration(900)
    .onBegin(() => {
      press.set(withTiming(1, { duration: 120 }));
      fill.set(withTiming(1, { duration: 900, easing: Easing.in(Easing.quad) }));
    })
    .onStart(() => {
      scheduleOnRN(onDone);
    })
    .onFinalize((_e, ok) => {
      press.set(withTiming(0, { duration: 200 }));
      if (!ok) fill.set(withTiming(0, { duration: 220 }));
    });
  const body = useAnimatedStyle(() => ({ transform: [{ scale: 1 - press.get() * 0.035 }] }));
  const bar = useAnimatedStyle(() => ({ width: `${fill.get() * 100}%` }));
  const glint = useAnimatedStyle(() => ({
    transform: [{ translateX: -120 + shine.get() * 420 }, { skewX: '-20deg' }],
  }));
  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[styles.pay, body]} accessibilityRole="button" accessibilityLabel="Hold to pay">
        <Animated.View style={[styles.payFill, bar]}>
          <View style={styles.payEdge} />
        </Animated.View>
        <Animated.View pointerEvents="none" style={[styles.payGlint, glint]} />
        <SymbolView name="lock.fill" size={14} tintColor="#FFFFFF" />
        <Text style={styles.payText}>Hold to pay</Text>
        <NumericText value={formatVnd(amount)} fontSize={16} color="rgba(255,255,255,0.7)" weight="semibold" />
      </Animated.View>
    </GestureDetector>
  );
}

function Receipt({ order, top }: { order: Order; top: number }) {
  return (
    <Animated.View
      entering={FadeInDown.duration(360).easing(Easing.out(Easing.cubic))}
      exiting={FadeOut.duration(240)}
      pointerEvents="none"
      style={[styles.receiptWrap, { top }]}>
      <Glass tint="rgba(255,255,255,0.55)" style={styles.receipt}>
        <SymbolView
          name="checkmark.circle.fill"
          size={48}
          tintColor={GREEN}
          animationSpec={{ effect: { type: 'bounce' } }}
        />
        <Text style={styles.receiptTitle}>Order placed</Text>
        <Text style={styles.receiptSub}>{order.id} · arriving tomorrow, 9–12h</Text>
        <View style={[styles.hair, styles.receiptHair]} />
        <View style={[styles.sumRow, styles.receiptRow]}>
          <Text style={styles.sumLabel}>
            {order.items} {order.items === 1 ? 'item' : 'items'}
          </Text>
          <Text style={styles.receiptAmount}>{formatVnd(order.total)}</Text>
        </View>
      </Glass>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BG,
  },
  frost: {
    backgroundColor: 'rgba(255,255,255,0.86)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(20,20,30,0.08)',
  },
  title: {
    fontSize: 34,
    fontWeight: '800',
    color: INK,
    letterSpacing: -0.8,
    marginLeft: 6,
  },
  subtitle: {
    fontSize: 14,
    color: SUB,
    marginTop: 4,
    marginLeft: 6,
    marginRight: 40,
  },
  chipsSpace: {
    marginTop: 14,
    height: 60,
  },
  topFade: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    experimental_backgroundImage: `linear-gradient(180deg, ${BG} 0%, ${BG} 62%, rgba(244,241,234,0) 100%)`,
  },
  chips: {
    position: 'absolute',
    top: 0,
    left: 14,
  },
  chipBar: {
    padding: 4,
    borderRadius: 22,
  },
  chipRow: {
    flexDirection: 'row',
  },
  chipPill: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    borderRadius: 18,
    backgroundColor: INK,
  },
  chip: {
    height: 36,
    paddingHorizontal: 14,
    justifyContent: 'center',
  },
  chipText: {
    fontSize: 14,
    fontWeight: '600',
    color: INK,
  },
  chipTextOn: {
    color: '#FFFFFF',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  card: {
    borderRadius: 28,
    borderCurve: 'continuous',
    padding: 14,
    paddingTop: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.85)',
    experimental_backgroundImage: 'linear-gradient(165deg, rgba(255,255,255,0.75) 0%, rgba(255,255,255,0) 58%)',
    boxShadow: '0 14px 30px -18px rgba(90, 60, 30, 0.45)',
  },
  badge: {
    position: 'absolute',
    top: 12,
    left: 12,
    zIndex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    height: 24,
    paddingHorizontal: 9,
    borderRadius: 12,
    backgroundColor: CORD,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  artBox: {
    width: ART_BOX,
    height: ART_BOX,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: -6,
  },
  art: {
    position: 'absolute',
    left: PAD,
    top: PAD,
    width: ART,
    height: ART,
  },
  placeholder: {
    width: ART * 0.7,
    height: ART * 0.7,
    borderRadius: ART,
    backgroundColor: 'rgba(255,255,255,0.45)',
  },
  baker: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: 2,
    height: 2,
    opacity: 0,
  },
  name: {
    fontSize: 15,
    fontWeight: '700',
    color: INK,
    letterSpacing: -0.2,
  },
  note: {
    fontSize: 12,
    color: SUB,
    marginTop: 1,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  price: {
    fontSize: 15,
    fontWeight: '600',
    color: INK,
    fontVariant: ['tabular-nums'],
  },
  add: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addSolid: {
    backgroundColor: INK,
  },
  fade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 200,
    experimental_backgroundImage:
      'linear-gradient(180deg, rgba(244,241,234,0) 0%, rgba(244,241,234,0.85) 60%, rgba(244,241,234,1) 100%)',
  },
  dockWrap: {
    position: 'absolute',
    left: 14,
    right: 14,
  },
  dock: {
    height: 60,
    borderRadius: 30,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    overflow: 'hidden',
  },
  dockFlash: {
    position: 'absolute',
    inset: 0,
    backgroundColor: 'rgba(31,157,87,0.22)',
  },
  dockSide: {
    width: 118,
    gap: 1,
  },
  dockRight: {
    alignItems: 'flex-end',
  },
  dockCount: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  countDot: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    backgroundColor: INK,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#FFFFFF',
    fontVariant: ['tabular-nums'],
  },
  dockCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  dockUnit: {
    fontSize: 13,
    fontWeight: '600',
    color: INK,
  },
  dockNote: {
    fontSize: 11,
    fontWeight: '500',
    color: SUB,
  },
  dockMeter: {
    position: 'absolute',
    left: 30,
    right: 30,
    bottom: 5,
  },
  meter: {
    height: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(23,23,27,0.07)',
    overflow: 'hidden',
  },
  meterFill: {
    height: 3,
    borderRadius: 2,
  },
  bagHit: {
    position: 'absolute',
  },
  floater: {
    position: 'absolute',
    alignSelf: 'center',
    fontSize: 15,
    fontWeight: '800',
    color: CORD,
    fontVariant: ['tabular-nums'],
    textShadowColor: 'rgba(255,255,255,0.9)',
    textShadowRadius: 6,
  },
  counter: {
    backgroundColor: BG,
    experimental_backgroundImage: 'linear-gradient(180deg, #F7F3EC 0%, #EFEAE1 100%)',
  },
  cartHead: {
    position: 'absolute',
    left: 14,
    right: 14,
  },
  rowWrap: {
    position: 'absolute',
    left: 14,
    right: 14,
  },
  row: {
    flex: 1,
    borderRadius: 24,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 96,
    paddingRight: 10,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowName: {
    fontSize: 15,
    fontWeight: '700',
    color: INK,
    letterSpacing: -0.2,
  },
  bin: {
    position: 'absolute',
    right: 10,
    top: '50%',
    marginTop: -22,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#E5483A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 36,
    borderRadius: 18,
    paddingHorizontal: 2,
    gap: 2,
  },
  stepBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepPressed: {
    backgroundColor: 'rgba(23,23,27,0.08)',
    transform: [{ scale: 0.86 }],
  },
  foot: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 14,
    gap: 12,
  },
  summary: {
    borderRadius: 26,
    paddingHorizontal: 18,
    paddingVertical: 14,
    gap: 8,
  },
  sumRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sumLabel: {
    fontSize: 14,
    color: SUB,
    fontWeight: '500',
  },
  sumValue: {
    fontSize: 15,
    fontWeight: '600',
    color: INK,
  },
  meterRow: {
    gap: 6,
    marginTop: 2,
  },
  meterWide: {
    height: 5,
    borderRadius: 3,
  },
  meterNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  meterText: {
    fontSize: 12,
    color: SUB,
    fontWeight: '500',
  },
  hair: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(23,23,27,0.12)',
    marginVertical: 2,
  },
  totalLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: INK,
  },
  payRow: {
    flexDirection: 'row',
    gap: 10,
  },
  back: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pay: {
    flex: 1,
    height: 58,
    borderRadius: 29,
    borderCurve: 'continuous',
    backgroundColor: INK,
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  payFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: CORD,
  },
  payEdge: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 26,
    experimental_backgroundImage: 'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.4) 100%)',
  },
  payGlint: {
    position: 'absolute',
    left: 0,
    top: -10,
    bottom: -10,
    width: 60,
    experimental_backgroundImage:
      'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.16) 50%, rgba(255,255,255,0) 100%)',
  },
  payText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
  },
  receiptWrap: {
    position: 'absolute',
    left: 28,
    right: 28,
  },
  receipt: {
    borderRadius: 30,
    borderCurve: 'continuous',
    alignItems: 'center',
    paddingVertical: 24,
    paddingHorizontal: 22,
    gap: 6,
  },
  receiptTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: INK,
    letterSpacing: -0.5,
    marginTop: 6,
  },
  receiptSub: {
    fontSize: 14,
    color: SUB,
  },
  receiptHair: {
    alignSelf: 'stretch',
    marginVertical: 10,
  },
  receiptRow: {
    alignSelf: 'stretch',
  },
  receiptAmount: {
    fontSize: 17,
    fontWeight: '700',
    color: INK,
    fontVariant: ['tabular-nums'],
  },
});
