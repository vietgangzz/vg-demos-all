import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  Keyframe,
  useAnimatedStyle,
  useDerivedValue,
  type SharedValue,
} from 'react-native-reanimated';
import { Atlas, BlurStyle, Skia, type SkImage, useRectBuffer, useRSXformBuffer, vec } from 'react-native-skia';

import { LateCanvas } from '@/components/late-canvas';
import { NumericText } from '@/components/numeric-text';
import { Burst } from '../daily-drop/fx';
import { BOARD, CLIMB_XP, CONFETTI, DISPLAY, FOIL, MONO, PROMOTE, ROUNDED, TONE, YOU } from './data';
import { PodiumEdge, RankChip } from './rank';
import { Title } from './title';
import { EDGES, Orbit } from './orbit';
import { type TallyStore, useTally } from './tally';
import { inOutCubic, mix, outBack, outCubic, settle, span } from './ui';

/**
 * Silver's board in the last seconds of the week, you fifth. Everyone else draws back behind a veil,
 * warm light gathers under your row, and it lifts out of the board and climbs: past fourth, over the
 * promotion line, past second, the ones you pass knocked down a place, the clock running out. At
 * the top a crown drops onto you, the board comes back in a flash and it all goes off.
 */

const CLIMB = { climb: 2.2, step: 0.62, move: 0.36 };
const TOP = CLIMB.climb + 3 * CLIMB.step + CLIMB.move;
// Plain values, worked out here: a worklet copying this over to the UI thread doesn't take getters with it
export const BOARD_SEQ = {
  header: 0.2,
  rows: 0.3,
  gap: 0.055,
  dim: 1.15,
  hunt: 1.3,
  lock: 1.75,
  lift: 1.8,
  ...CLIMB,
  top: TOP,
  crown: TOP + 0.3,
  boom: TOP + 0.54,
  done: TOP + 1.54,
};
export const BOARD_END = BOARD_SEQ.done + 0.6;

const ROW = 52;
const GAP = 8;
const ZONE = 32;

/** The top of slot s (fractional while moving), from the top of the list */
const slotTop = (s: number) => {
  'worklet';
  const at = (n: number) => n * (ROW + GAP) + (n >= PROMOTE ? ZONE : 0);
  const lo = Math.floor(s);
  return mix(at(lo), at(lo + 1), s - lo);
};

// These two sit above the worklets that read them: a worklet takes in its constants when it's defined
/**
 * How you get past the ones above: barging them aside with your row, or a leg springing out of it
 * and booting them out of the way
 */
const PASS = 'kick' as 'barge' | 'kick' | 'derezz';
/** Whether the one you pass goes to pieces as well as being booted (or barged) */
const DEREZZ = true;

/** When step k of your climb starts: k = 0 passes the one right above you */
const stepAt = (k: number) => {
  'worklet';
  return BOARD_SEQ.climb + k * BOARD_SEQ.step;
};
/**
 * When you get past the one above on step k. Kicked, they're booted out of the way just before your
 * row moves up into their place (they go to pieces, and you slide into the gap); barged, your row
 * shoulders into them part way up
 */
export const knockAt = (k: number) => {
  'worklet';
  return PASS === 'kick' ? stepAt(k) - 0.03 : stepAt(k) + BOARD_SEQ.move * 0.4;
};
/** How far a passed row is sent sideways, and how far it tips */
const SHOVE = PASS === 'kick' ? { x: 96, tip: 9 } : PASS === 'barge' ? { x: 34, tip: 5 } : { x: 0, tip: 0 };
/** Derezzing: when the one you pass starts to go, is gone, and rebuilds a place lower, from the hit */
const REZ = { flash: 0.04, gone: 0.22, back: 0.42, built: 0.7 };
/** How long a passed player's avatar is in the air: if their row derezzes, till it's built again */
const AIR = DEREZZ || PASS === 'derezz' ? REZ.built : 0.5;
/** The coins a derezzed row bursts into, flying to you */
const COINS = 9;
/** The leg: its drawing's size, its hip at the bottom middle */
const LEG = 150;
const LEG_W = 91;
const LEG_ART = require('../../../assets/rank-up-neo/art/leg.png');
/** An avatar's size, and its left edge in a row (the row's inset, padding, rank and gap) */
const AVATAR = 36;
const AVATAR_X = 16 + 14 + 22 + 12;
/**
 * How far everyone else has drawn back while you climb (0 to 1): each of them dims itself by it. (A
 * veil laid over the board blinked: it only showed in the frames React drew the board again.)
 */
const backAt = (u: number) => {
  'worklet';
  return inOutCubic(span(u, BOARD_SEQ.dim, 0.5)) * (1 - outCubic(span(u, BOARD_SEQ.boom, 0.5)));
};
const DIM = 0.6;
const moveOf = (u: number, k: number) => {
  'worklet';
  const p = span(u, stepAt(k), BOARD_SEQ.move);
  return p < 1 ? outBack(p, 1.1) : 1;
};

export function boardLayout(width: number, top: number) {
  const list = top + 228;
  return {
    park: { x: width / 2, y: top + 64 },
    header: top + 126,
    list,
    /** Your row's centre once it's on top */
    first: { x: width / 2, y: list + ROW / 2 },
  };
}

export function Board({
  clock,
  width,
  height,
  layout,
  tally,
}: {
  clock: SharedValue<number>;
  width: number;
  height: number;
  layout: ReturnType<typeof boardLayout>;
  /** How many you've passed, how many XP bumps you've had, and the week's clock */
  tally: TallyStore;
}) {
  const S = BOARD_SEQ;
  const yourSlot = useDerivedValue(() => {
    let s = YOU;
    for (let k = 0; k < YOU; k++) s -= moveOf(clock.value, k);
    return s;
  });
  const yourY = useDerivedValue(() => layout.list + slotTop(yourSlot.value) + ROW / 2);

  // ---- The header, the countdown, the winner's line ----
  const header = useAnimatedStyle(() => {
    const k = outCubic(span(clock.value, S.header, 0.4));
    return { opacity: k * (1 - DIM * backAt(clock.value)), transform: [{ translateY: (1 - k) * -16 }] };
  });
  const zone = useAnimatedStyle(() => {
    const k = span(clock.value, S.rows + PROMOTE * S.gap, 0.3);
    const hit = clock.value - stepAt(1) - S.move * 0.5;
    const flash = hit > 0 ? Math.exp(-hit * 3) : 0;
    return { opacity: k * (1 - DIM * backAt(clock.value)), transform: [{ scale: 1 + 0.08 * flash }] };
  });
  const zoneGold = useAnimatedStyle(() => {
    const hit = clock.value - stepAt(1) - S.move * 0.5;
    return { opacity: hit > 0 ? 1 : 0 };
  });

  const burst = useDerivedValue(() => Math.max(0, clock.value - S.boom));
  const late = useDerivedValue(() => Math.max(0, clock.value - S.boom - 0.12));
  const zoneY = layout.list + slotTop(PROMOTE) - (ZONE + GAP) / 2;

  return (
    <>
      <Animated.View style={[styles.header, { top: layout.header, width }, header]}>
        <Text style={styles.kicker}>SEASON 07 · WEEK 43</Text>
        <Title text="SILVER LEAGUE" cap={24} light="cyan" />
        <Countdown tally={tally} clock={clock} />
      </Animated.View>

      {BOARD.map((p, j) =>
        j === YOU ? null : <Row key={p.id} j={j} clock={clock} top={layout.list} width={width} tally={tally} />
      )}

      <Animated.View style={[styles.zone, { top: zoneY - 12, width }, zone]}>
        <View style={[styles.zoneLine, styles.zoneLineLeft]}>
          <Animated.View style={[styles.zoneLineGold, styles.zoneLineLeft, zoneGold]} />
        </View>
        <SymbolView name="chevron.up" size={8} weight="black" tintColor={TONE.neon} />
        <Text style={styles.zoneText}>PROMOTION ZONE</Text>
        <SymbolView name="chevron.up" size={8} weight="black" tintColor={TONE.neon} />
        <View style={[styles.zoneLine, styles.zoneLineRight]}>
          <Animated.View style={[styles.zoneLineGold, styles.zoneLineRight, zoneGold]} />
        </View>
      </Animated.View>

      {Array.from({ length: YOU }, (_, k) =>
        DEREZZ ? (
          <Derezz key={k} clock={clock} k={k} width={width} y={layout.list + slotTop(YOU - 1 - k) + ROW / 2} />
        ) : (
          <Knock key={k} clock={clock} k={k} x={width / 2} y={layout.list + slotTop(YOU - 1 - k) + ROW} />
        )
      )}

      <You clock={clock} y={yourY} width={width} tally={tally} />

      {PASS === 'kick'
        ? Array.from({ length: YOU }, (_, k) => <Bonk key={k} clock={clock} k={k} top={layout.list} />)
        : null}
      {DEREZZ ? <KickBits clock={clock} width={width} list={layout.list} /> : null}

      <Burst
        clock={burst}
        x={18}
        y={height + 10}
        kind="confetti"
        palette={CONFETTI}
        count={70}
        life={2.8}
        power={1.25}
      />
      <Burst
        clock={late}
        x={width - 18}
        y={height + 10}
        kind="confetti"
        palette={CONFETTI}
        count={70}
        life={2.8}
        power={1.25}
      />
      <Burst
        clock={burst}
        x={layout.first.x}
        y={layout.first.y}
        kind="sparkle"
        palette={['#FFFFFF', TONE.goldLight, TONE.goldPale]}
        count={34}
        life={1.4}
        power={1.3}
      />
    </>
  );
}

/**
 * The avatar of the one you pass on step k, bonked out of their row by the knock: flung up over your
 * row and out to the side, flipping over, swelling as it comes towards you, and dropping back into
 * their row, now a place lower
 */
function Bonk({ clock, k, top }: { clock: SharedValue<number>; k: number; top: number }) {
  const j = YOU - 1 - k;
  const side = k % 2 === 0 ? 1 : -1;
  const s = useAnimatedStyle(() => {
    const u = clock.value;
    const hit = u - knockAt(k);
    const a = hit > 0 && hit < AIR ? hit / AIR : -1;
    const up = a >= 0 ? 4 * a * (1 - a) : 0;
    const y = top + slotTop(j + moveOf(u, k)) + (ROW - AVATAR) / 2;
    return {
      opacity: a >= 0 ? 1 : 0,
      transform: [
        { translateX: AVATAR_X + side * 46 * up },
        { translateY: y - 120 * up },
        { rotate: `${a >= 0 ? side * 360 * a : 0}deg` },
        { scale: 1 + 0.7 * up },
      ],
    };
  });
  return <Animated.Image source={BOARD[j].avatar} style={[styles.bonk, s]} />;
}

/** Sparks where your row barges into the one it passes on step k */
function Knock({ clock, k, x, y }: { clock: SharedValue<number>; k: number; x: number; y: number }) {
  const since = useDerivedValue(() => Math.max(0, clock.value - knockAt(k)));
  return (
    <Burst
      clock={since}
      x={x}
      y={y}
      kind="sparkle"
      palette={['#FFFFFF', TONE.goldLight, TONE.goldPale]}
      count={16}
      life={0.6}
      power={0.7}
    />
  );
}

/** How far through derezzing a row is, `hit` seconds after you pass it: whether it shows, and how rebuilt */
const derezzed = (hit: number) => {
  'worklet';
  if (!(DEREZZ || PASS === 'derezz') || hit < 0) return { shown: 1, built: 1 };
  // Dissolving as it's booted away, no strobing
  if (hit < REZ.back) return { shown: 1 - outCubic(span(hit, REZ.flash, REZ.gone - REZ.flash)), built: 1 };
  // Building back from the middle out, fading in as it goes
  const k = span(hit, REZ.back, REZ.built - REZ.back);
  return { shown: inOutCubic(Math.min(1, k * 1.6)), built: Math.max(0.02, outCubic(k)) };
};

/** The one you pass on step k going to pieces: voxels of it bursting out all along its row */
function Derezz({ clock, k, width, y }: { clock: SharedValue<number>; k: number; width: number; y: number }) {
  const since = useDerivedValue(() => Math.max(0, clock.value - knockAt(k) - REZ.gone * 0.7));
  const side = k % 2 === 0 ? 1 : -1;
  // Where the boot connects: out along its arc from the hip, level with the struck row's middle
  const hx = width / 2 - side * (width - 32) * 0.14 + side * 128;
  const hy = y + 6;
  const palette = [TONE.rival, TONE.rivalLight, '#FFFFFF'];
  return (
    <>
      <Impact clock={clock} at={knockAt(k)} x={hx} y={hy} />
      {[0.22, 0.5, 0.78].map((f) => (
        <Burst
          key={f}
          clock={since}
          x={width * f + side * SHOVE.x * 0.5}
          y={y}
          kind="confetti"
          palette={palette}
          count={22}
          life={0.9}
          power={0.75}
        />
      ))}
    </>
  );
}

/** The impact lines: which way each shoots off, and how long it is */
const LINES = Array.from({ length: 10 }, (_, i) => ({
  angle: (i / 10) * Math.PI * 2 + (i % 2 ? 0.18 : -0.12),
  long: i % 3 === 0 ? 1 : i % 3 === 1 ? 0.72 : 0.5,
}));
/** How long the flare's streak is, and the impact lines */
const FLARE = 300;
const LINE = 44;

/**
 * Where the boot connects, `at` on the clock: a flash of white-hot light flaring out flat along the
 * row like a lens flare, crossed by a shorter one (and impact lines shooting out all round, KickBits)
 */
function Impact({ clock, at, x, y }: { clock: SharedValue<number>; at: number; x: number; y: number }) {
  const flat = useAnimatedStyle(() => {
    const a = span(clock.value, at, 0.3);
    const on = a > 0 && a < 1;
    return {
      opacity: on ? Math.pow(1 - a, 1.4) : 0,
      transform: [{ scaleX: on ? mix(0.15, 1.25, outCubic(Math.min(1, a * 3))) : 0 }, { scaleY: mix(1.8, 0.35, a) }],
    };
  });
  const cross = useAnimatedStyle(() => {
    const a = span(clock.value, at, 0.2);
    const on = a > 0 && a < 1;
    return {
      opacity: on ? 1 - a : 0,
      transform: [{ scaleY: on ? mix(0.2, 1, outCubic(Math.min(1, a * 3))) : 0 }, { scaleX: mix(1.6, 0.4, a) }],
    };
  });
  const core = useAnimatedStyle(() => {
    const a = span(clock.value, at, 0.16);
    const on = a > 0 && a < 1;
    return { opacity: on ? 1 - a * a : 0, transform: [{ scale: on ? mix(1.5, 0.3, outCubic(a)) : 0 }] };
  });
  return (
    <>
      <Animated.View style={[styles.flare, { left: x - FLARE / 2, top: y - 2 }, flat]} pointerEvents="none" />
      <Animated.View style={[styles.flareCross, { left: x - 1.5, top: y - 60 }, cross]} pointerEvents="none" />
      <Animated.View style={[styles.impactCore, { left: x - 12, top: y - 12 }, core]} pointerEvents="none" />
    </>
  );
}

/** Where the boot connects with the row you pass on step k */
const hitAt = (k: number, width: number, list: number) => {
  'worklet';
  const side = k % 2 === 0 ? 1 : -1;
  return {
    x: width / 2 - side * (width - 32) * 0.14 + side * 128,
    y: list + slotTop(YOU - 1 - k) + ROW / 2 + 6,
  };
};

/** The sprites: a coin face on, turned part way and nearly edge on, and an impact line */
const CELL = 30;
const COIN = 18;
const TURNS = [1, 0.55, 0.18];
const LINE_AT = CELL * TURNS.length;
const SHEET = { w: LINE_AT + LINE, h: CELL };

let sheet: SkImage | null = null;
function kickSprites() {
  if (sheet) return sheet;
  const surface = Skia.Surface.Make(SHEET.w, SHEET.h);
  if (!surface) return null;
  const c = surface.getCanvas();
  const paint = Skia.Paint();
  paint.setAntiAlias(true);
  TURNS.forEach((w, n) => {
    const r = Skia.XYWHRect(n * CELL + (CELL - COIN * w) / 2, (CELL - COIN) / 2, COIN * w, COIN);
    paint.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, 4, true));
    paint.setColor(Skia.Color(TONE.goldLight));
    paint.setAlphaf(0.7);
    c.drawOval(r, paint);
    paint.setMaskFilter(null);
    paint.setAlphaf(1);
    paint.setColor(Skia.Color(TONE.goldDeep));
    c.drawOval(r, paint);
    paint.setColor(Skia.Color(TONE.gold));
    c.drawOval(Skia.XYWHRect(r.x + 2.5 * w, r.y + 2.5, Math.max(0.5, r.width - 5 * w), r.height - 5), paint);
  });
  paint.setShader(
    Skia.Shader.MakeLinearGradient(
      vec(LINE_AT, 0),
      vec(LINE_AT + LINE, 0),
      [Skia.Color('rgba(255, 106, 26, 0)'), Skia.Color(TONE.rivalLight), Skia.Color('#FFFFFF')],
      [0, 0.45, 1],
      0
    )
  );
  c.drawRRect(Skia.RRectXY(Skia.XYWHRect(LINE_AT, CELL / 2 - 1.5, LINE, 3), 1.5, 1.5), paint);
  surface.flush();
  sheet = surface.makeImageSnapshot();
  return sheet;
}

const BITS_COINS = YOU * COINS;
const BITS = BITS_COINS + YOU * LINES.length;

/**
 * The bits that fly off each kick, all in one Atlas moved on the UI thread rather than a view each:
 * impact lines shooting straight out from where the boot connects, thinning to nothing; and the coins
 * out of the one you pass, flung up out of where they were and arcing over to your XP, a beat behind
 * one another, turning over as they go
 */
function KickBits({ clock, width, list }: { clock: SharedValue<number>; width: number; list: number }) {
  const image = useMemo(() => kickSprites(), []);
  // Each coin's where and how far round it's turned; each line's how long it is just now
  const cells = useRectBuffer(BITS, (r, n) => {
    'worklet';
    const u = clock.value;
    if (n < BITS_COINS) {
      const k = Math.floor(n / COINS);
      const i = n % COINS;
      const a = span(u, knockAt(k) + REZ.gone * 0.5 + i * 0.035, 0.62);
      const face = Math.abs(Math.cos(a * 18 + i));
      const turn = face > 0.75 ? 0 : face > 0.35 ? 1 : 2;
      r.setXYWH(turn * CELL, 0, CELL, CELL);
      return;
    }
    const m = n - BITS_COINS;
    const l = LINES[m % LINES.length];
    const a = span(u, knockAt(Math.floor(m / LINES.length)), 0.28);
    const w = Math.max(1, LINE * l.long * mix(1, 0.15, outCubic(a)) * (1 - a));
    r.setXYWH(LINE_AT + LINE - w, 0, w, CELL);
  });
  const placed = useRSXformBuffer(BITS, (val, n) => {
    'worklet';
    const u = clock.value;
    if (n < BITS_COINS) {
      const k = Math.floor(n / COINS);
      const i = n % COINS;
      const launch = knockAt(k) + REZ.gone * 0.5 + i * 0.035;
      const a = span(u, launch, 0.62);
      if (u < launch || a >= 1) {
        val.set(0, 0, -100, -100);
        return;
      }
      const j = YOU - 1 - k;
      const x0 = 40 + ((i + 0.5) / COINS) * (width - 80);
      const y0 = list + slotTop(j + 0.4) + ROW / 2;
      // Where your XP is just now: your row's right-hand end
      let slot = YOU;
      for (let q = 0; q < YOU; q++) slot -= moveOf(u, q);
      const x1 = width - 70;
      const y1 = list + slotTop(slot) + ROW / 2;
      const e = a * a * (3 - 2 * a);
      const cx = (x0 + x1) / 2 + (i - COINS / 2) * 8;
      const cy = Math.min(y0, y1) - 110 - (i % 3) * 18;
      const x = (1 - e) * (1 - e) * x0 + 2 * (1 - e) * e * cx + e * e * x1;
      const y = (1 - e) * (1 - e) * y0 + 2 * (1 - e) * e * cy + e * e * y1;
      const s = (0.6 + 0.6 * Math.sin(Math.PI * a)) * (a < 0.9 ? 1 : (1 - a) * 10);
      val.set(s, 0, x - (CELL / 2) * s, y - (CELL / 2) * s);
      return;
    }
    const m = n - BITS_COINS;
    const k = Math.floor(m / LINES.length);
    const l = LINES[m % LINES.length];
    const a = span(u, knockAt(k), 0.28);
    if (a <= 0 || a >= 1) {
      val.set(0, 0, -100, -100);
      return;
    }
    const hit = hitAt(k, width, list);
    const d = mix(10, 70 + 40 * l.long, outCubic(a));
    const cos = Math.cos(l.angle);
    const sin = Math.sin(l.angle);
    // Its inner end at d out from the hit, turned about the middle of that end
    const px = hit.x + d * cos;
    const py = hit.y + d * sin;
    val.set(cos, sin, px + sin * (CELL / 2), py - cos * (CELL / 2));
  });
  if (!image) return null;
  return (
    <LateCanvas style={StyleSheet.absoluteFill}>
      <Atlas image={image} sprites={cells} transforms={placed} />
    </LateCanvas>
  );
}

/** The rank someone above you shows: one lower once you've passed them */
function rankOf(j: number, passed: number) {
  return j < YOU && passed >= YOU - j ? j + 2 : j + 1;
}

// The bits of text that follow the tally, each re-rendering on its own

/** How the week's end comes in: fading up and settling from a touch small, no bounce */
const OVER_IN = new Keyframe({
  0: { opacity: 0, transform: [{ scale: 0.9 }] },
  100: { opacity: 1, transform: [{ scale: 1 }], easing: Easing.out(Easing.cubic) },
}).duration(320);

/** The countdown, and once the week's over, how it ended: first, promoted, in gold */
function Countdown({ tally, clock }: { tally: TallyStore; clock: SharedValue<number> }) {
  const over = useTally(tally, (t) => t.gold);
  const live = useAnimatedStyle(() => ({ opacity: 0.35 + 0.65 * (0.5 + 0.5 * Math.cos(clock.value * 5)) }));
  if (over) {
    return (
      <Animated.View key="over" entering={OVER_IN} style={[styles.clock, styles.clockOver]}>
        <SymbolView name="chevron.up.2" size={9} weight="black" tintColor={TONE.goldLight} />
        <Text style={styles.overText}>FINISHED 1ST · PROMOTED</Text>
        <SymbolView name="chevron.up.2" size={9} weight="black" tintColor={TONE.goldLight} />
      </Animated.View>
    );
  }
  return (
    <View style={styles.clock}>
      <Animated.View style={[styles.liveDot, live]} />
      <Text style={styles.clockText}>ENDS IN</Text>
      <Seconds tally={tally} />
    </View>
  );
}

function Seconds({ tally }: { tally: TallyStore }) {
  const seconds = useTally(tally, (t) => t.seconds);
  return <Text style={styles.clockTime}>00:0{seconds}</Text>;
}

function RowRank({ tally, j }: { tally: TallyStore; j: number }) {
  const rank = useTally(tally, (t) => rankOf(j, t.passed));
  return <RankChip rank={rank} plain="rgba(255, 140, 80, 0.85)" />;
}

/** A rival's row's edge of light while it's in the top three */
function RowEdge({ tally, j }: { tally: TallyStore; j: number }) {
  const rank = useTally(tally, (t) => rankOf(j, t.passed));
  return <PodiumEdge rank={rank} />;
}

/** Your row's ink once it's gone gold: light gold, and a dimmer one for the small print */
const INK = '#FFE08A';
const INK_SOFT = 'rgba(255, 224, 138, 0.6)';

function YourRank({ tally }: { tally: TallyStore }) {
  const rank = useTally(tally, (t) => YOU + 1 - t.passed);
  const gold = useTally(tally, (t) => t.gold);
  // In its chip once you're in the top three, gold, silver or bronze
  if (rank <= 3) return <RankChip rank={rank} plain={TONE.neon} />;
  return (
    <NumericText
      value={String(rank).padStart(2, '0')}
      fontSize={14}
      color={gold ? INK : TONE.neon}
      weight="heavy"
      countsDown
    />
  );
}

function YourXp({ tally }: { tally: TallyStore }) {
  const xp = useTally(tally, (t) => (t.xpStep ? CLIMB_XP[t.xpStep - 1] : BOARD[YOU].xp));
  return <NumericText value={xp.toLocaleString('en-US')} fontSize={15} color={TONE.white} weight="heavy" />;
}

/** Your row's edge of light, cyan as you climb and gold once you're on top */
function YourEdge({ tally, width }: { tally: TallyStore; width: number }) {
  const gold = useTally(tally, (t) => t.gold);
  return <Orbit width={width} height={ROW} radius={14} edge={gold ? EDGES.gold : EDGES.cyan} period={3} />;
}

function YourName({ tally }: { tally: TallyStore }) {
  const gold = useTally(tally, (t) => t.gold);
  return (
    <View style={styles.who}>
      <Text style={[styles.name, styles.youName, gold ? { color: INK } : null]}>You</Text>
      <Text style={[styles.meta, styles.youMeta, gold ? { color: INK_SOFT } : null]}>
        LVL {BOARD[YOU].level} · {BOARD[YOU].streak}D STREAK
      </Text>
    </View>
  );
}

function YourUnit({ tally }: { tally: TallyStore }) {
  const gold = useTally(tally, (t) => t.gold);
  return <Text style={[styles.unit, styles.youUnit, gold ? { color: INK_SOFT } : null]}>XP</Text>;
}

function Row({
  j,
  clock,
  top,
  width,
  tally,
}: {
  j: number;
  clock: SharedValue<number>;
  top: number;
  width: number;
  tally: TallyStore;
}) {
  const p = BOARD[j];
  const at = BOARD_SEQ.rows + j * BOARD_SEQ.gap;
  // Knocked down a place when you pass: the step that passes row j. Your row barges it aside, one
  // way then the other, and it springs back; or it derezzes, gone in a flash, and rebuilds a place lower
  const k = YOU - 1 - j;
  const side = k % 2 === 0 ? 1 : -1;
  const s = useAnimatedStyle(() => {
    const u = clock.value;
    const d = u - at;
    const enter = settle(d, 1.8, 7);
    const slot = j + (k >= 0 ? moveOf(u, k) : 0);
    const hit = k >= 0 ? u - knockAt(k) : -1;
    const shove = hit > 0 ? Math.sin(hit * 14) * Math.exp(-hit * 5) : 0;
    const rez = derezzed(hit);
    return {
      opacity: Math.min(1, Math.max(0, d * 7)) * rez.shown * (1 - DIM * backAt(u)),
      transform: [
        { translateY: top + slotTop(slot) + (1 - enter) * 26 },
        { translateX: side * shove * SHOVE.x - (1 - rez.built) * (width - 32) * 0.5 },
        { rotate: `${side * shove * SHOVE.tip}deg` },
        { scale: mix(0.92, 1, enter) },
        { scaleX: rez.built },
        { translateX: (1 - rez.built) * (width - 32) * 0.5 },
      ],
    };
  });
  const flash = useAnimatedStyle(() => {
    const hit = k >= 0 ? clock.value - knockAt(k) : -1;
    const a = hit > 0 ? 1 - hit / REZ.gone : 0;
    return { opacity: a > 0 ? a * a : 0 };
  });
  // Their avatar's away in the air (Bonk, over everything) after the knock, and lands back with a squash
  const bonk = useAnimatedStyle(() => {
    const hit = k >= 0 ? clock.value - knockAt(k) : -1;
    const land = hit - AIR;
    const squash = land > 0 ? 0.28 * Math.exp(-land * 8) * Math.cos(land * 26) : 0;
    return {
      opacity: PASS === 'kick' && hit > 0 && hit < AIR ? 0 : 1,
      transform: [{ scaleX: 1 + squash }, { scaleY: 1 - squash }],
    };
  });
  return (
    <Animated.View style={[styles.row, { width: width - 32 }, s]}>
      <RowEdge tally={tally} j={j} />
      <Animated.View style={[styles.rowFlash, flash]} pointerEvents="none" />
      <RowRank tally={tally} j={j} />
      <Animated.View style={[styles.avatarBox, bonk]}>
        <Image source={p.avatar} style={styles.avatar} contentFit="cover" />
      </Animated.View>
      <View style={styles.who}>
        <Text style={styles.name} numberOfLines={1}>
          {p.name}
        </Text>
        <Text style={styles.meta}>
          LVL {p.level} · {p.streak}D STREAK
        </Text>
      </View>
      <View style={styles.score}>
        <Text style={styles.xp}>{p.xp.toLocaleString('en-US')}</Text>
        <Text style={styles.unit}>XP</Text>
      </View>
    </Animated.View>
  );
}

function You({
  clock,
  y,
  width,
  tally,
}: {
  clock: SharedValue<number>;
  y: SharedValue<number>;
  width: number;
  tally: TallyStore;
}) {
  const S = BOARD_SEQ;
  const at = S.rows + YOU * S.gap;
  const w = width - 32;
  const body = useAnimatedStyle(() => {
    const u = clock.value;
    const d = u - at;
    const enter = settle(d, 1.8, 7);
    const boom = u - S.boom;
    const pop = boom > 0 ? 0.1 * Math.exp(-boom * 5) * Math.cos(boom * 18) : 0;
    // A lean into each step up
    let lean = 0;
    for (let k = 0; k < YOU; k++) lean += Math.sin(Math.PI * span(u, stepAt(k), S.move)) * 1.4;
    return {
      opacity: Math.min(1, Math.max(0, d * 7)),
      transform: [
        { translateY: y.value - ROW / 2 + (1 - enter) * 26 },
        { scale: mix(0.92, 1, enter) * (1 + pop) },
        { rotate: `${-lean}deg` },
      ],
    };
  });
  const gold = useAnimatedStyle(() => ({ opacity: span(clock.value, S.boom, 0.18) }));
  const shine = useAnimatedStyle(() => {
    const k = span(clock.value, S.boom + 0.25, 0.6);
    return {
      opacity: k > 0 && k < 1 ? 1 : 0,
      transform: [{ translateX: mix(-120, w + 60, inOutCubic(k)) }, { skewX: '-20deg' }],
    };
  });
  const kick = useDerivedValue(() => kickOf(clock.value));
  // Dropping onto your head, landing as the board comes back
  const crown = useAnimatedStyle(() => {
    const u = clock.value;
    const fall = span(u, S.crown, S.boom - S.crown);
    const land = u - S.boom;
    const squash = land > 0 ? Math.exp(-land * 7) * Math.sin(land * 30) * 0.25 : 0;
    return {
      opacity: u > S.crown ? 1 : 0,
      transform: [
        { translateY: (1 - fall * fall) * -220 },
        { rotate: `${mix(40, -14, fall) + (land > 0 ? -squash * 30 : 0)}deg` },
        { scaleX: 1 + squash },
        { scaleY: 1 - squash },
      ],
    };
  });
  return (
    <Animated.View style={[styles.you, { width: w }, body]}>
      {PASS === 'kick' ? <Leg kick={kick} width={w} /> : null}
      <YourEdge tally={tally} width={w} />
      <View style={styles.youFill}>
        <Animated.View style={[styles.youGold, gold]} />
        <Animated.View style={[styles.shine, shine]} />
      </View>
      <View style={styles.youRank}>
        <YourRank tally={tally} />
      </View>
      <View style={styles.avatarBox}>
        <Image source={BOARD[YOU].avatar} style={styles.avatar} contentFit="cover" />
      </View>
      <YourName tally={tally} />
      <View style={[styles.score, styles.youScore]}>
        <YourXp tally={tally} />
        <YourUnit tally={tally} />
      </View>
      <Animated.View style={[styles.crown, crown]}>
        <SymbolView name="crown.fill" size={30} tintColor={TONE.goldLight} />
      </Animated.View>
    </Animated.View>
  );
}

/**
 * A leg springing up out from behind your row as it reaches each one above: cocked back, it swings
 * through and boots them off to the side, then ducks back in. A striped sock and a sneaker, kicking
 * one way then the other.
 */
export function Leg({
  kick,
  width,
}: {
  /** Which kick is under way (k, -1 for none: the leg kicks one way then the other), and how far from its hit */
  kick: SharedValue<{ k: number; d: number }>;
  width: number;
}) {
  const s = useAnimatedStyle(() => {
    const { k, d } = kick.value;
    return k >= 0 ? { opacity: 1, transform: legPose(k, d, width) } : { opacity: 0, transform: [{ scaleY: 0 }] };
  });
  // The whole leg flaring white as it connects
  const hot = useAnimatedStyle(() => {
    const { k, d } = kick.value;
    return { opacity: k >= 0 && d > -0.01 && d < 0.12 ? Math.pow(1 - (d + 0.01) / 0.13, 2) : 0 };
  });
  return (
    <>
      {GHOSTS.map((g) => (
        <Ghost key={g.lag} kick={kick} width={width} lag={g.lag} alpha={g.alpha} />
      ))}
      <Animated.View style={[styles.leg, s]} pointerEvents="none">
        <Image source={LEG_ART} style={styles.legArt} contentFit="contain" />
        <Animated.View style={[StyleSheet.absoluteFill, hot]}>
          <Image source={LEG_ART} style={styles.legArt} contentFit="contain" tintColor="#F2FEFF" />
        </Animated.View>
      </Animated.View>
    </>
  );
}

/** The leg's pose `d` seconds from kick k's hit */
const legPose = (k: number, d: number, width: number) => {
  'worklet';
  const side = k % 2 === 0 ? 1 : -1;
  const out = outBack(span(d, -0.32, 0.14), 2) * (1 - inOutCubic(span(d, 0.16, 0.14)));
  // Cocked right back and held there quivering, whipped through, and a recoil off them
  const wind = inOutCubic(span(d, -0.3, 0.18));
  const swing = Math.pow(span(d, -0.06, 0.07), 0.6);
  const back = d > 0.01 ? 12 * Math.exp(-(d - 0.01) * 13) * Math.sin((d - 0.01) * 38) : 0;
  const angle = mix(-6, -58, wind) + (d > -0.12 && d < -0.06 ? Math.sin(d * 120) * 2 : 0);
  // Stretched out long through the swing
  const stretch = Math.sin(Math.PI * span(d, -0.06, 0.12));
  return [
    { translateX: width / 2 - side * width * 0.14 - LEG_W / 2 },
    { scaleX: side },
    { rotate: `${mix(angle, 66, swing) - back}deg` },
    { scaleY: out * (1 + 0.1 * stretch) },
    { scaleX: 1 - 0.06 * stretch },
  ];
};

/** The afterimages the leg leaves through its swing: how far behind it each is, and how bright */
const GHOSTS = [
  { lag: 0.006, alpha: 0.26 },
  { lag: 0.012, alpha: 0.17 },
  { lag: 0.018, alpha: 0.1 },
  { lag: 0.024, alpha: 0.05 },
];

/** One afterimage of the leg, in neon, where it was `lag` seconds ago, only through the swing */
function Ghost({
  kick,
  width,
  lag,
  alpha,
}: {
  kick: SharedValue<{ k: number; d: number }>;
  width: number;
  lag: number;
  alpha: number;
}) {
  const s = useAnimatedStyle(() => {
    const { k, d } = kick.value;
    const on = k >= 0 ? span(d, -0.06, 0.02) * (1 - span(d, 0.02, 0.1)) : 0;
    return on > 0
      ? { opacity: alpha * on, transform: legPose(k, d - lag, width) }
      : { opacity: 0, transform: [{ scaleY: 0 }] };
  });
  return (
    <Animated.View style={[styles.leg, s]} pointerEvents="none">
      <Image source={LEG_ART} style={styles.legArt} contentFit="contain" tintColor={TONE.neon} />
    </Animated.View>
  );
}

/** Which kick is under way at `u`, if any (k = -1), and how far from its hit */
const kickOf = (u: number) => {
  'worklet';
  for (let k = 0; k < YOU; k++) {
    const d = u - knockAt(k);
    if (d >= -0.32 && d <= 0.3) return { k, d };
  }
  return { k: -1, d: 0 };
};

const styles = StyleSheet.create({
  leg: {
    position: 'absolute',
    left: 0,
    top: -LEG + 10,
    width: LEG_W,
    height: LEG,
    transformOrigin: 'bottom',
  },
  legArt: { width: LEG_W, height: LEG },
  /** The flare's streak: white-hot in the middle, cyan out along it, fading to nothing at the ends */
  flare: {
    position: 'absolute',
    width: FLARE,
    height: 4,
    borderRadius: 2,
    experimental_backgroundImage:
      'linear-gradient(90deg, rgba(34, 229, 255, 0) 0%, rgba(34, 229, 255, 0.85) 30%, #FFFFFF 50%, rgba(34, 229, 255, 0.85) 70%, rgba(34, 229, 255, 0) 100%)',
    boxShadow: `0 0 10px ${TONE.neon}`,
  },
  flareCross: {
    position: 'absolute',
    width: 3,
    height: 120,
    borderRadius: 1.5,
    experimental_backgroundImage:
      'linear-gradient(180deg, rgba(34, 229, 255, 0) 0%, rgba(214, 252, 255, 0.9) 50%, rgba(34, 229, 255, 0) 100%)',
  },
  impactCore: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    boxShadow: `0 0 18px 6px ${TONE.neon}`,
  },
  /** An impact line, pivoting on the hit: white at its head, burning down to the rival's orange */
  header: {
    position: 'absolute',
    left: 0,
    alignItems: 'center',
  },
  kicker: {
    fontFamily: MONO,
    fontSize: 9,
    letterSpacing: 3.2,
    color: 'rgba(34, 229, 255, 0.6)',
    marginBottom: 2,
  },
  clock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    paddingLeft: 10,
    paddingRight: 11,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(2, 12, 20, 0.72)',
    borderWidth: 1,
    borderColor: 'rgba(34, 229, 255, 0.24)',
  },
  liveDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: TONE.rival,
    boxShadow: `0 0 6px ${TONE.rival}`,
  },
  clockText: {
    fontFamily: MONO,
    fontSize: 9,
    letterSpacing: 1.8,
    color: 'rgba(214, 248, 255, 0.5)',
  },
  clockTime: { fontFamily: MONO, fontSize: 12, letterSpacing: 0.6, color: TONE.neon },
  clockOver: {
    paddingHorizontal: 12,
    backgroundColor: 'rgba(24, 13, 0, 0.8)',
    borderColor: 'rgba(255, 200, 61, 0.75)',
    boxShadow: '0 0 14px rgba(255, 190, 50, 0.35), inset 0 0 10px rgba(255, 200, 61, 0.16)',
  },
  overText: { fontSize: 10, fontWeight: '800', letterSpacing: 1.8, color: TONE.goldLight },
  winner: {
    position: 'absolute',
    left: 0,
    alignItems: 'center',
    gap: 10,
  },
  winnerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 28,
    paddingHorizontal: 14,
    borderRadius: 4,
    experimental_backgroundImage: FOIL,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.7)',
    boxShadow: `0 4px 0 ${TONE.goldDeep}, 0 10px 18px ${TONE.drop}`,
  },
  winnerPillText: {
    fontFamily: MONO,
    fontSize: 11,
    letterSpacing: 2.2,
    color: TONE.lip,
  },
  winnerText: {
    fontFamily: DISPLAY,
    fontSize: 40,
    letterSpacing: 1.5,
    color: TONE.white,
    textShadowColor: TONE.goldDeep,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 16,
  },
  zone: {
    position: 'absolute',
    left: 0,
    height: 24,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 22,
    gap: 7,
  },
  zoneLine: {
    flex: 1,
    height: 1,
    overflow: 'hidden',
  },
  zoneLineGold: {
    ...StyleSheet.absoluteFill,
  },
  zoneLineLeft: {
    experimental_backgroundImage: 'linear-gradient(90deg, rgba(34,229,255,0) 0%, rgba(34,229,255,0.65) 100%)',
  },
  zoneLineRight: {
    experimental_backgroundImage: 'linear-gradient(90deg, rgba(34,229,255,0.65) 0%, rgba(34,229,255,0) 100%)',
  },
  zoneText: {
    fontFamily: MONO,
    fontSize: 8.5,
    letterSpacing: 3,
    color: 'rgba(34, 229, 255, 0.85)',
  },
  row: {
    position: 'absolute',
    top: 0,
    left: 16,
    height: ROW,
    borderRadius: 14,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(3, 6, 10, 0.92)',
    borderWidth: 1,
    borderColor: 'rgba(255, 120, 50, 0.26)',
    boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.05)',
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 14,
    paddingRight: 16,
    gap: 12,
  },
  /** The row struck: its edge going white-hot, burning orange inside, rather than a slab of light */
  rowFlash: {
    ...StyleSheet.absoluteFill,
    borderRadius: 14,
    borderCurve: 'continuous',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
    boxShadow: `0 0 16px ${TONE.rival}, inset 0 0 22px rgba(255, 178, 122, 0.45)`,
  },

  avatarBox: { width: AVATAR, height: AVATAR },
  who: { flex: 1, gap: 1 },
  meta: { fontFamily: MONO, fontSize: 8.5, letterSpacing: 1.1, color: 'rgba(255, 255, 255, 0.4)' },
  youMeta: { color: 'rgba(160, 248, 255, 0.6)' },
  score: { flexDirection: 'row', alignItems: 'baseline', gap: 3 },
  /** Its XP rolls in a SwiftUI view, which has no baseline to line the unit up on */
  youScore: { alignItems: 'center' },
  unit: { fontSize: 10, fontWeight: '800', letterSpacing: 0.6, color: 'rgba(255, 150, 90, 0.9)' },
  youUnit: { color: 'rgba(170, 250, 255, 0.9)' },
  bonk: { position: 'absolute', left: 0, top: 0, width: AVATAR, height: AVATAR, borderRadius: 8 },
  avatar: { width: AVATAR, height: AVATAR },
  name: {
    fontFamily: ROUNDED,
    fontSize: 16,
    lineHeight: 19,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: 'rgba(255, 255, 255, 0.95)',
  },
  // The numbers heavy, in even widths, so they read at a glance over the dark glass
  xp: {
    fontSize: 15,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    color: 'rgba(255, 240, 230, 0.96)',
  },
  you: {
    position: 'absolute',
    top: 0,
    left: 16,
    height: ROW,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 14,
    paddingRight: 16,
    gap: 12,
  },
  /** A wash of cyan down from the top, inside the edge of light (which paints the row's dark glass) */
  youFill: {
    position: 'absolute',
    top: 2,
    left: 2,
    right: 2,
    bottom: 2,
    borderRadius: 12,
    borderCurve: 'continuous',
    experimental_backgroundImage:
      'linear-gradient(180deg, rgba(34, 229, 255, 0.14) 0%, rgba(34, 229, 255, 0.02) 60%, rgba(34, 229, 255, 0) 100%)',
    overflow: 'hidden',
    boxShadow: '0 0 24px rgba(34, 229, 255, 0.18)',
  },
  /** Gold's wash over your row once you're on top, in place of the cyan */
  youGold: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#0C0802',
    experimental_backgroundImage:
      'linear-gradient(180deg, rgba(255, 200, 61, 0.22) 0%, rgba(255, 200, 61, 0.05) 60%, rgba(255, 200, 61, 0) 100%)',
  },
  shine: {
    position: 'absolute',
    top: -10,
    bottom: -10,
    width: 60,
    experimental_backgroundImage:
      'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,240,200,0.35) 50%, rgba(255,255,255,0) 100%)',
  },
  youRank: {
    width: 34,
    alignItems: 'center',
  },
  youName: {
    color: TONE.neon,
  },
  crown: {
    position: 'absolute',
    left: 54,
    top: -30,
    width: 44,
    alignItems: 'center',
  },
});
