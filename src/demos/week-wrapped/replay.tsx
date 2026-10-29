import { Image } from 'expo-image';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useDerivedValue, type SharedValue } from 'react-native-reanimated';

import { NumericText } from '@/components/numeric-text';
import { Burst } from '../daily-drop/fx';
import { Leg } from '../rank-up/board';
import { BOARD, FOIL } from '../rank-up/data';
import { inOutCubic, mix, settle, span } from '../rank-up/ui';
import { MOLTEN, ROUNDED, TONE } from './data';
import {
  BUMP_AT,
  DAY_LETTERS,
  dayAt,
  dayStart,
  FINAL,
  KICK_AT,
  KICK_WHO,
  ME,
  MOVE,
  MOVE_AT,
  MOVE_BY,
  placeOf,
  REPLAY,
  SLOW,
  SUNDAY,
  ZONE_AT,
} from './week';

/**
 * Silver's board, replayed, everything on it a function of the story's clock, so it plays as well
 * backwards as forwards. The week: rows sliding past each other as the XP comes in, a leg springing
 * out of yours to boot each one you pass out of the way, a sticker over the scrubber for each day,
 * Sunday in slow motion for the last kick. Then the finale: the crown, Gold flooding out from your
 * row, the board falling away. The screen opens at the end of all that and winds it back first.
 */

/** The finale, from the last kick: the crown, Gold flooding out, the board falling away, Gold's badge, the card */
export const FIN = {
  crown: FINAL + 0.32,
  flood: FINAL + 0.62,
  fall: FINAL + 1.45,
  badge: FINAL + 1.7,
  slam: FINAL + 2.55,
  words: FINAL + 2.75,
  card: FINAL + 5,
};

/**
 * The tape, on the screen's own clock: it opens on the story's end (Gold, the badge, GOLD LEAGUE,
 * confetti in the air) and holds there; winds the finale back, slowly at first, then the whole week
 * back, fast, to Monday morning; a breath there; then plays the story forwards
 */
export const TAPE = { hold: 1.5, unwind: 2.2, week: 2.5, pause: 0.65 };
/** Where the story stands as it opens, and where the rewind leaves it */
export const OPEN = FIN.words + 0.9;
export const MONDAY = REPLAY.play - 0.35;
export const REWIND_AT = TAPE.hold;
const WEEK_AT = TAPE.hold + TAPE.unwind;
const MONDAY_AT = WEEK_AT + TAPE.week;
/** When the story starts playing forwards */
export const PLAY_AT = MONDAY_AT + TAPE.pause;

/** Where the story is when the screen's clock reads `r` (before it starts playing forwards) */
export const storyAt = (r: number) => {
  'worklet';
  if (r < REWIND_AT) return OPEN;
  if (r < WEEK_AT) {
    // The finale winding back, picking up speed
    const k = (r - REWIND_AT) / TAPE.unwind;
    return OPEN - (OPEN - FINAL) * k * k;
  }
  if (r < MONDAY_AT) {
    // The week, from the speed the finale left off at, flying back and easing into Monday
    const k = (r - WEEK_AT) / TAPE.week;
    const m0 = (-2 * (OPEN - FINAL) * TAPE.week) / TAPE.unwind;
    const h00 = 2 * k * k * k - 3 * k * k + 1;
    const h10 = k * k * k - 2 * k * k + k;
    const h01 = -2 * k * k * k + 3 * k * k;
    return h00 * FINAL + h10 * m0 + h01 * MONDAY;
  }
  if (r < PLAY_AT) return MONDAY;
  return MONDAY + (r - PLAY_AT);
};

const ROW = 52;
const GAP = 6;
const ZONE = 28;
const PROMOTE = 3;
const AVATAR = 38;
/** An avatar's left edge in a row: the row's inset, padding, rank and gap */
const AVATAR_X = 16 + 10 + 24 + 12;
/** How long a booted player's avatar is in the air */
const AIR = 0.5;

/** The top of place s on the board (fractional while moving), from the top of the list */
const slotTop = (s: number) => {
  'worklet';
  const at = (n: number) => n * (ROW + GAP) + (n >= PROMOTE ? ZONE : 0);
  const lo = Math.max(0, Math.min(7, Math.floor(s)));
  return mix(at(lo), at(lo + 1), s - lo);
};

/** Which kick is under way at `t` (k = -1 for none), and how far from its hit */
const kickOf = (t: number) => {
  'worklet';
  for (let k = 0; k < KICK_AT.length; k++) {
    const d = t - KICK_AT[k];
    if (d >= -0.22 && d <= 0.42) return { k, d };
  }
  return { k: -1, d: 0 };
};

/** Each kick boots its row off to one side and then the other */
const sideOf = (k: number) => {
  'worklet';
  return k % 2 === 0 ? 1 : -1;
};

export type Layout = {
  width: number;
  height: number;
  /** The header's top, the list's top, the scrubber's track */
  header: number;
  list: number;
  track: number;
  /** Where your row ends up for the finale */
  stage: number;
};

export function boardLayout(width: number, height: number, top: number, bottom: number): Layout {
  return {
    width,
    height,
    header: top + 8,
    list: top + 118,
    track: height - bottom - 44,
    stage: height * 0.6,
  };
}

/** Your row's centre at `t`, following it up and down the board and out onto the stage at the end */
export const yourY = (t: number, l: Layout) => {
  'worklet';
  const y = l.list + slotTop(placeOf(ME, t)) + ROW / 2;
  return mix(y, l.stage, inOutCubic(span(t, FIN.fall + 0.1, 0.8)));
};

export function Board({
  t,
  layout,
  xp,
  places,
}: {
  t: SharedValue<number>;
  layout: Layout;
  /** Everyone's XP and place, as of the last time the numbers caught up */
  xp: number[];
  places: number[];
}) {
  const { width, list } = layout;
  const zone = useAnimatedStyle(() => {
    const k = 1;
    const hit = t.value - ZONE_AT;
    const flash = hit > 0 ? Math.exp(-hit * 3) : 0;
    return { opacity: k * (1 - span(t.value, FIN.fall, 0.3)), transform: [{ scale: 1 + 0.08 * flash }] };
  });
  const zoneGold = useAnimatedStyle(() => ({ opacity: placeOf(ME, t.value) < PROMOTE - 0.5 ? 1 : 0 }));
  const zoneY = list + slotTop(PROMOTE) - (ZONE + GAP) / 2;
  return (
    <>
      {BOARD.map((p, i) =>
        i === ME ? null : <Row key={p.id} i={i} t={t} layout={layout} rank={places[i] + 1} xp={xp[i]} />
      )}
      <Animated.View style={[styles.zone, { top: zoneY - 12, width }, zone]}>
        <View style={styles.zoneLine}>
          <Animated.View style={[styles.zoneLineGold, zoneGold]} />
        </View>
        <SymbolView name="arrow.up" size={11} weight="black" tintColor={TONE.gold} />
        <Text style={styles.zoneText}>PROMOTION ZONE</Text>
        <SymbolView name="arrow.up" size={11} weight="black" tintColor={TONE.gold} />
        <View style={styles.zoneLine}>
          <Animated.View style={[styles.zoneLineGold, zoneGold]} />
        </View>
      </Animated.View>
      {KICK_AT.map((_, k) => (
        <Knock key={k} t={t} k={k} layout={layout} />
      ))}
      <You t={t} layout={layout} rank={places[ME] + 1} xp={xp[ME]} />
      {KICK_AT.map((_, k) => (
        <Bonk key={k} t={t} k={k} list={list} />
      ))}
    </>
  );
}

function Row({
  i,
  t,
  layout,
  rank,
  xp,
}: {
  i: number;
  t: SharedValue<number>;
  layout: Layout;
  rank: number;
  xp: number;
}) {
  const p = BOARD[i];
  /** The kicks that boot this row, and the moves that take it up the board */
  const kicks = KICK_WHO.flatMap((who, k) => (who === i ? [k] : []));
  const ups = MOVE_AT[i].filter((_, k) => MOVE_BY[i][k] < 0);
  const s = useAnimatedStyle(() => {
    const u = t.value;
    const slot = placeOf(i, u);
    let shove = 0;
    let tip = 0;
    for (let n = 0; n < kicks.length; n++) {
      const k = kicks[n];
      const hit = u - KICK_AT[k];
      const d = hit > 0 ? Math.sin(hit * 14) * Math.exp(-hit * 5) : 0;
      shove += sideOf(k) * d * 78;
      tip += sideOf(k) * d * 10;
    }
    // Lifted a little while it climbs over the one it's passing
    let lift = 0;
    for (let n = 0; n < ups.length; n++) lift += Math.sin(Math.PI * span(u, ups[n], MOVE));
    // Dropping away off the bottom for the finale, the lowest first
    const fall = Math.max(0, u - FIN.fall - (7 - slot) * 0.05);
    const side = i % 2 === 0 ? 1 : -1;
    return {
      transform: [
        { translateY: layout.list + slotTop(slot) + 1400 * fall * fall - 140 * fall },
        { translateX: shove + side * 60 * fall },
        { rotate: `${tip + side * 70 * fall}deg` },
        { scale: 1 + 0.04 * lift },
      ],
    };
  });
  // The avatar's away in the air while it's booted (Bonk), and lands back with a squash
  const avatar = useAnimatedStyle(() => {
    let away = false;
    let squash = 0;
    for (let n = 0; n < kicks.length; n++) {
      const hit = t.value - KICK_AT[kicks[n]];
      if (hit > 0 && hit < AIR) away = true;
      const land = hit - AIR;
      if (land > 0) squash += 0.28 * Math.exp(-land * 8) * Math.cos(land * 26);
    }
    return { opacity: away ? 0 : 1, transform: [{ scaleX: 1 + squash }, { scaleY: 1 - squash }] };
  });
  return (
    <Animated.View style={[styles.row, { width: layout.width - 32 }, s]}>
      <Text style={styles.rank}>{rank}</Text>
      <Animated.View style={[styles.avatarBox, avatar]}>
        <Image source={p.avatar} style={styles.avatar} contentFit="cover" />
      </Animated.View>
      <Text style={styles.name} numberOfLines={1}>
        {p.name}
      </Text>
      <Text style={styles.xp}>{xp.toLocaleString('en-US')} XP</Text>
    </Animated.View>
  );
}

function You({ t, layout, rank, xp }: { t: SharedValue<number>; layout: Layout; rank: number; xp: number }) {
  const w = layout.width - 32;
  const body = useAnimatedStyle(() => {
    const u = t.value;
    // A lean into each kick, and knocked about when someone gets past you
    let lean = 0;
    for (let k = 0; k < KICK_AT.length; k++) lean += Math.sin(Math.PI * span(u, KICK_AT[k] - 0.2, 0.4)) * 1.6;
    let jolt = 0;
    for (let n = 0; n < BUMP_AT.length; n++) {
      const d = u - BUMP_AT[n];
      if (d > 0) jolt += Math.sin(d * 30) * Math.exp(-d * 7);
    }
    const flood = u - FIN.flood;
    const pop = flood > 0 ? 0.1 * Math.exp(-flood * 5) * Math.cos(flood * 18) : 0;
    const stage = inOutCubic(span(u, FIN.fall + 0.1, 0.8));
    return {
      transform: [
        { translateY: yourY(u, layout) - ROW / 2 },
        { translateX: jolt * 10 },
        { scale: 1 + 0.02 * stage + pop },
        { rotate: `${-lean + jolt * 3}deg` },
      ],
    };
  });
  const gold = useAnimatedStyle(() => ({ opacity: span(t.value, FIN.flood, 0.18) }));
  const shine = useAnimatedStyle(() => {
    const k = span(t.value, FIN.flood + 0.25, 0.6);
    return {
      opacity: k > 0 && k < 1 ? 1 : 0,
      transform: [{ translateX: mix(-120, w + 60, inOutCubic(k)) }, { skewX: '-20deg' }],
    };
  });
  // Dropped on for the win (and so, wound back, lifted off and away)
  const crown = useAnimatedStyle(() => {
    const u = t.value;
    if (u < FIN.crown) return { opacity: 0 };
    const fall = span(u, FIN.crown, FIN.flood - FIN.crown);
    const land = u - FIN.flood;
    const squash = land > 0 ? Math.exp(-land * 7) * Math.sin(land * 30) * 0.25 : 0;
    return {
      opacity: 1,
      transform: [
        { translateY: (1 - fall * fall) * -240 },
        { rotate: `${mix(40, -14, fall) + (land > 0 ? -squash * 30 : 0)}deg` },
        { scaleX: 1 + squash },
        { scaleY: 1 - squash },
      ],
    };
  });
  const kick = useDerivedValue(() => kickOf(t.value));
  return (
    <Animated.View style={[styles.you, { width: w }, body]}>
      <Leg kick={kick} width={w} />
      <View style={styles.youFill}>
        <Animated.View style={[styles.youGold, gold]} />
        <Animated.View style={[styles.shine, shine]} />
      </View>
      <View style={styles.youRank}>
        <NumericText value={`#${rank}`} fontSize={17} color={TONE.ink} weight="black" countsDown />
      </View>
      <Image source={BOARD[ME].avatar} style={[styles.avatar, styles.youAvatar]} contentFit="cover" />
      <Text style={[styles.name, styles.youName]}>You</Text>
      <NumericText value={`${xp.toLocaleString('en-US')} XP`} fontSize={15} color={TONE.ink} weight="black" />
      <Animated.View style={[styles.crown, crown]}>
        <SymbolView name="crown.fill" size={30} tintColor={TONE.gold} />
      </Animated.View>
    </Animated.View>
  );
}

/**
 * The avatar of the one booted by kick k: flung up and out to the side, flipping over, swelling
 * as it comes towards you, and dropping back into its row
 */
function Bonk({ t, k, list }: { t: SharedValue<number>; k: number; list: number }) {
  const j = KICK_WHO[k];
  const s = useAnimatedStyle(() => {
    const u = t.value;
    const hit = u - KICK_AT[k];
    const a = hit > 0 && hit < AIR ? hit / AIR : -1;
    const up = a >= 0 ? 4 * a * (1 - a) : 0;
    const big = k === KICK_AT.length - 1 ? 1.6 : 1;
    return {
      opacity: a >= 0 ? 1 : 0,
      transform: [
        { translateX: AVATAR_X + sideOf(k) * 46 * up * big },
        { translateY: list + slotTop(placeOf(j, u)) + (ROW - AVATAR) / 2 - 120 * up * big },
        { rotate: `${a >= 0 ? sideOf(k) * 360 * a : 0}deg` },
        { scale: 1 + 0.7 * up * big },
      ],
    };
  });
  return <Animated.Image source={BOARD[j].avatar} style={[styles.bonk, s]} />;
}

/** Sparks where your leg connects on kick k */
function Knock({ t, k, layout }: { t: SharedValue<number>; k: number; layout: Layout }) {
  const since = useDerivedValue(() => Math.max(0, t.value - KICK_AT[k]));
  const j = KICK_WHO[k];
  // Where the one it boots is when it connects
  const y = layout.list + slotTop(placeOf(j, KICK_AT[k])) + ROW;
  const big = k === KICK_AT.length - 1;
  return (
    <Burst
      clock={since}
      x={layout.width / 2 + sideOf(k) * layout.width * 0.12}
      y={y}
      kind="sparkle"
      palette={['#FFFFFF', TONE.goldLight, TONE.goldPale]}
      count={big ? 30 : 16}
      life={big ? 1 : 0.6}
      power={big ? 1.2 : 0.7}
    />
  );
}

// ---- The scrubber along the bottom, and a sticker over it for each day ----

type Sticker = { icon: SFSymbol; title: string; line: string };

/** What each day's sticker says */
const STICKERS: Sticker[] = [
  { icon: 'sunrise.fill', title: 'Week starts', line: "You're 6th. Mina's off fast." },
  { icon: 'star.fill', title: '3 perfect lessons', line: 'Booted Lucía out of 5th' },
  { icon: 'cloud.rain.fill', title: 'Slow day', line: 'Lucía and Ama slip past you' },
  { icon: 'flame.fill', title: 'Combo ×3', line: 'Rafael, Ama, Theo. Gone.' },
  { icon: 'chevron.up.2', title: 'Promotion zone', line: 'Into the top three' },
  { icon: 'books.vertical.fill', title: 'Biggest day', line: '375 XP, and past Kenji' },
  { icon: 'moon.stars.fill', title: 'Down to the wire', line: 'One lesson left. Mina leads.' },
];
const STICKER_W = 236;
const INSET = 30;

/** Where the playhead is along the track at `t` */
const headX = (t: number, width: number) => {
  'worklet';
  return INSET + (dayAt(t) / 7) * (width - 2 * INSET);
};

export function Scrubber({ t, layout, day }: { t: SharedValue<number>; layout: Layout; day: number }) {
  const { width, track } = layout;
  const len = width - 2 * INSET;
  const show = useAnimatedStyle(() => {
    const out = span(t.value, FIN.flood + 0.3, 0.4);
    return { opacity: 1 - out, transform: [{ translateY: out * 30 }] };
  });
  const fill = useAnimatedStyle(() => ({ width: headX(t.value, width) - INSET }));
  const head = useAnimatedStyle(() => ({ transform: [{ translateX: headX(t.value, width) - 11 }] }));
  return (
    <Animated.View style={[styles.scrubber, { top: track - 4, width }, show]} pointerEvents="none">
      <View style={[styles.track, { left: INSET, width: len }]}>
        <Animated.View style={[styles.trackFill, fill]} />
      </View>
      {DAY_LETTERS.slice(1).map((_, d) => (
        <View key={d} style={[styles.tick, { left: INSET + ((d + 1) / 7) * len - 1 }]} />
      ))}
      {DAY_LETTERS.map((c, d) => (
        <Text key={d} style={[styles.day, { left: INSET + ((d + 0.5) / 7) * len - 12 }, d === day && styles.dayNow]}>
          {c}
        </Text>
      ))}
      <Animated.View style={[styles.head, head]} />
    </Animated.View>
  );
}

/** `live`: 1 once the story's playing forwards (no stickers flickering past while it winds back) */
export function Stickers({ t, live, layout }: { t: SharedValue<number>; live: SharedValue<number>; layout: Layout }) {
  return (
    <>
      {STICKERS.map((s, d) => (
        <StickerView
          key={d}
          s={s}
          t={t}
          live={live}
          layout={layout}
          from={(d === 6 ? SUNDAY : dayStart(d)) + 0.25}
          to={d === 6 ? FIN.flood : dayStart(d + 1) - 0.12}
          slow={d === 6}
        />
      ))}
    </>
  );
}

function StickerView({
  s,
  t,
  live,
  layout,
  from,
  to,
  slow,
}: {
  s: Sticker;
  t: SharedValue<number>;
  live: SharedValue<number>;
  layout: Layout;
  from: number;
  to: number;
  slow: boolean;
}) {
  const { width, track } = layout;
  const box = useAnimatedStyle(() => {
    const u = t.value;
    const d = u - from;
    const out = span(u, to - 0.15, 0.15);
    const x = Math.min(width - 16 - STICKER_W, Math.max(16, headX(u, width) - STICKER_W / 2));
    return {
      opacity: d > 0 ? (1 - out) * live.value : 0,
      transform: [
        { translateX: x },
        { translateY: (1 - Math.min(1, settle(d, 1.6, 6))) * 24 + out * 12 },
        { scale: (d > 0 ? 0.6 + 0.4 * settle(d, 1.6, 6) : 0.6) * (1 - 0.2 * out) },
        { rotate: `${(1 - settle(d, 1.2, 6)) * -6}deg` },
      ],
    };
  });
  const pointer = useAnimatedStyle(() => {
    const x = Math.min(width - 16 - STICKER_W, Math.max(16, headX(t.value, width) - STICKER_W / 2));
    return {
      transform: [
        { translateX: Math.min(STICKER_W - 26, Math.max(12, headX(t.value, width) - x - 7)) },
        { rotate: '45deg' },
      ],
    };
  });
  return (
    <Animated.View style={[styles.sticker, { bottom: layout.height - track + 30 }, box]} pointerEvents="none">
      <Animated.View style={[styles.pointer, pointer]} />
      <View style={[styles.stickerIcon, slow && styles.stickerIconSlow]}>
        <SymbolView name={s.icon} size={17} weight="bold" tintColor={TONE.umber} />
      </View>
      <View style={styles.stickerText}>
        <Text style={styles.stickerTitle}>{s.title}</Text>
        <Text style={styles.stickerLine}>{s.line}</Text>
      </View>
    </Animated.View>
  );
}

// ---- The header: what the replay's doing, the week, and the clock running through it ----

type Status = { text: string; icon: SFSymbol; from: number; to: number };

/** What it's doing as the story plays (FINAL and REWIND are the tape's, over it: see Rewind) */
const STATUSES: Status[] = [
  { text: 'REPLAY', icon: 'play.fill', from: MONDAY, to: SLOW },
  { text: 'SLOW-MO', icon: 'tortoise.fill', from: SLOW, to: FIN.flood + 0.3 },
];

export function Header({
  t,
  live,
  layout,
  stamp,
}: {
  t: SharedValue<number>;
  live: SharedValue<number>;
  layout: Layout;
  stamp: { day: string; date: string; time: string };
}) {
  const s = useAnimatedStyle(() => {
    const out = span(t.value, FIN.flood + 0.3, 0.3);
    return { opacity: 1 - out, transform: [{ translateY: -out * 20 }] };
  });
  return (
    <Animated.View style={[styles.header, { top: layout.header, width: layout.width }, s]} pointerEvents="none">
      <View style={styles.statuses}>
        {STATUSES.map((st) => (
          <StatusPill key={st.text} s={st} t={t} live={live} />
        ))}
      </View>
      <Text style={styles.league}>Week 43 · Silver</Text>
      <View style={styles.clock}>
        <SymbolView name="calendar" size={13} weight="bold" tintColor={TONE.white} />
        <Text style={styles.clockDay}>
          {stamp.day} {stamp.date}
        </Text>
        <NumericText value={stamp.time} fontSize={14} color={TONE.white} weight="black" />
      </View>
    </Animated.View>
  );
}

function StatusPill({ s, t, live }: { s: Status; t: SharedValue<number>; live: SharedValue<number> }) {
  const style = useAnimatedStyle(() => {
    const d = t.value - s.from;
    const out = span(t.value, s.to - 0.12, 0.12);
    return {
      opacity: d > 0 && live.value > 0 ? 1 - out : 0,
      transform: [{ scale: settle(d, 2, 6) * (1 - 0.4 * out) }, { rotate: `${(1 - settle(d, 1.4, 6)) * -10}deg` }],
    };
  });
  // Slow motion's pill blinks like a tape deck's
  const blink = useAnimatedStyle(() => {
    const d = t.value - s.from;
    return { opacity: s.icon === 'tortoise.fill' ? 0.55 + 0.45 * Math.cos(d * 12) : 1 };
  });
  return (
    <Animated.View style={[styles.status, style]}>
      <Animated.View style={blink}>
        <SymbolView name={s.icon} size={12} weight="black" tintColor={TONE.umber} />
      </Animated.View>
      <Text style={styles.statusText}>{s.text}</Text>
    </Animated.View>
  );
}

// ---- The tape winding back ----

const LINES = [0.12, 0.23, 0.31, 0.47, 0.55, 0.68, 0.74, 0.86, 0.93];

/**
 * The tape's own look, on the screen's clock `r`: FINAL as it opens; then, winding back, a pill
 * blinking REWIND, the picture tinted and rolling, lines of noise streaking across it
 */
export function Rewind({
  r,
  ambient,
  layout,
}: {
  r: SharedValue<number>;
  ambient: SharedValue<number>;
  layout: Layout;
}) {
  const { width, height } = layout;
  const on = useAnimatedStyle(() => {
    const k = span(r.value, REWIND_AT - 0.05, 0.15) * (1 - span(r.value, PLAY_AT - 0.35, 0.3));
    return { opacity: k };
  });
  const band = useAnimatedStyle(() => ({
    transform: [{ translateY: ((ambient.value * 1.7) % 1) * (height + 160) - 160 }],
  }));
  const icon = useAnimatedStyle(() => ({
    opacity: 0.22 + 0.12 * Math.cos(ambient.value * 14),
    transform: [{ scale: 1 + 0.06 * Math.cos(ambient.value * 14) }],
  }));
  return (
    <>
      <Animated.View style={[StyleSheet.absoluteFill, on]} pointerEvents="none">
        <View style={[StyleSheet.absoluteFill, styles.tint]} />
        {LINES.map((y, i) => (
          <Line key={i} y={y * height} i={i} width={width} ambient={ambient} />
        ))}
        <Animated.View style={[styles.tracking, { width }, band]} />
        <Animated.View style={[styles.bigIcon, { top: height * 0.42, width }, icon]}>
          <SymbolView name="backward.fill" size={84} tintColor={TONE.white} />
        </Animated.View>
      </Animated.View>
      <View style={[styles.tapePills, { top: layout.header, width }]} pointerEvents="none">
        <TapePill r={r} text="FINAL" icon="flag.checkered" from={0.2} to={REWIND_AT} />
        <TapePill r={r} text="REWIND" icon="backward.fill" from={REWIND_AT} to={PLAY_AT} blink />
      </View>
    </>
  );
}

function TapePill({
  r,
  text,
  icon,
  from,
  to,
  blink,
}: {
  r: SharedValue<number>;
  text: string;
  icon: SFSymbol;
  from: number;
  to: number;
  blink?: boolean;
}) {
  const style = useAnimatedStyle(() => {
    const d = r.value - from;
    const out = span(r.value, to - 0.12, 0.12);
    return {
      opacity: d > 0 ? 1 - out : 0,
      transform: [{ scale: settle(d, 2, 6) * (1 - 0.4 * out) }, { rotate: `${(1 - settle(d, 1.4, 6)) * -10}deg` }],
    };
  });
  const lamp = useAnimatedStyle(() => ({ opacity: blink ? 0.5 + 0.5 * Math.cos((r.value - from) * 12) : 1 }));
  return (
    <Animated.View style={[styles.status, style]}>
      <Animated.View style={lamp}>
        <SymbolView name={icon} size={12} weight="black" tintColor={TONE.umber} />
      </Animated.View>
      <Text style={styles.statusText}>{text}</Text>
    </Animated.View>
  );
}

function Line({ y, i, width, ambient }: { y: number; i: number; width: number; ambient: SharedValue<number> }) {
  const len = width * (0.25 + 0.35 * ((i * 37) % 10) * 0.1);
  const s = useAnimatedStyle(() => {
    const k = (ambient.value * (2.2 + (i % 3) * 0.7) + i * 0.37) % 1;
    return { transform: [{ translateX: mix(width + 20, -len - 20, k) }] };
  });
  return <Animated.View style={[styles.line, { top: y, width: len, height: 1.5 + (i % 3) }, s]} />;
}

const styles = StyleSheet.create({
  row: {
    position: 'absolute',
    top: 0,
    left: 16,
    height: ROW,
    borderRadius: 18,
    backgroundColor: TONE.glass,
    borderWidth: 1,
    borderColor: TONE.glassEdge,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 10,
    paddingRight: 18,
    gap: 12,
  },
  rank: {
    width: 24,
    textAlign: 'center',
    fontFamily: ROUNDED,
    fontWeight: '900',
    fontSize: 17,
    color: TONE.white,
  },
  avatarBox: { width: AVATAR, height: AVATAR },
  avatar: { width: AVATAR, height: AVATAR, borderRadius: AVATAR / 2, backgroundColor: TONE.glass },
  bonk: { position: 'absolute', left: 0, top: 0, width: AVATAR, height: AVATAR, borderRadius: AVATAR / 2 },
  name: { flex: 1, fontFamily: ROUNDED, fontWeight: '800', fontSize: 17, color: TONE.white },
  xp: { fontFamily: ROUNDED, fontWeight: '800', fontSize: 15, color: TONE.soft, fontVariant: ['tabular-nums'] },
  you: {
    position: 'absolute',
    top: 0,
    left: 16,
    height: ROW,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 6,
    paddingRight: 14,
    gap: 10,
  },
  youFill: {
    ...StyleSheet.absoluteFill,
    borderRadius: 18,
    backgroundColor: TONE.white,
    overflow: 'hidden',
    boxShadow: `0 12px 28px ${TONE.drop}`,
  },
  youGold: { ...StyleSheet.absoluteFill, experimental_backgroundImage: FOIL },
  shine: {
    position: 'absolute',
    top: -10,
    bottom: -10,
    width: 60,
    experimental_backgroundImage:
      'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.85) 50%, rgba(255,255,255,0) 100%)',
  },
  youRank: { width: 40, alignItems: 'center' },
  youAvatar: { borderWidth: 2, borderColor: TONE.cool },
  youName: { fontWeight: '900', color: TONE.ink },
  crown: { position: 'absolute', left: 52, top: -30, width: 44, alignItems: 'center' },
  zone: {
    position: 'absolute',
    left: 0,
    height: 24,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 22,
    gap: 7,
  },
  zoneLine: { flex: 1, height: 2, borderRadius: 1, backgroundColor: TONE.glassEdge, overflow: 'hidden' },
  zoneLineGold: { ...StyleSheet.absoluteFill, backgroundColor: TONE.gold },
  zoneText: { fontFamily: ROUNDED, fontWeight: '900', fontSize: 11, letterSpacing: 1.6, color: TONE.white },
  scrubber: { position: 'absolute', left: 0, height: 44 },
  track: {
    position: 'absolute',
    top: 0,
    height: 8,
    borderRadius: 4,
    backgroundColor: TONE.glass,
    borderWidth: 1,
    borderColor: TONE.glassEdge,
    overflow: 'hidden',
  },
  trackFill: { height: 8, backgroundColor: TONE.gold },
  tick: { position: 'absolute', top: -3, width: 2, height: 14, borderRadius: 1, backgroundColor: TONE.glassEdge },
  day: {
    position: 'absolute',
    top: 18,
    width: 24,
    textAlign: 'center',
    fontFamily: ROUNDED,
    fontWeight: '800',
    fontSize: 13,
    color: 'rgba(255,255,255,0.55)',
  },
  dayNow: { color: TONE.goldLight, fontWeight: '900' },
  head: {
    position: 'absolute',
    top: -7,
    left: 0,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: TONE.white,
    borderWidth: 4,
    borderColor: TONE.gold,
    boxShadow: `0 0 14px rgba(255, 224, 122, 0.9), 0 3px 6px ${TONE.drop}`,
  },
  sticker: {
    position: 'absolute',
    left: 0,
    width: STICKER_W,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 18,
    backgroundColor: '#FFF7E6',
    boxShadow: `0 4px 0 ${TONE.goldDeep}, 0 12px 22px ${TONE.drop}`,
    transformOrigin: 'bottom',
  },
  pointer: {
    position: 'absolute',
    left: 0,
    bottom: -6,
    width: 14,
    height: 14,
    borderRadius: 2,
    backgroundColor: '#FFF7E6',
  },
  stickerIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    experimental_backgroundImage: MOLTEN,
  },
  stickerIconSlow: { experimental_backgroundImage: undefined, backgroundColor: TONE.goldPale },
  stickerText: { flex: 1 },
  stickerTitle: { fontFamily: ROUNDED, fontWeight: '900', fontSize: 16, color: TONE.umber },
  stickerLine: { fontFamily: ROUNDED, fontWeight: '700', fontSize: 12.5, color: TONE.amber },
  header: { position: 'absolute', left: 0, alignItems: 'center', gap: 8 },
  statuses: { height: 28, alignItems: 'center', justifyContent: 'center' },
  status: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 28,
    paddingHorizontal: 14,
    borderRadius: 14,
    experimental_backgroundImage: MOLTEN,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.8)',
    boxShadow: `0 3px 0 ${TONE.amber}, 0 8px 16px ${TONE.drop}`,
  },
  statusText: { fontFamily: ROUNDED, fontWeight: '900', fontSize: 12, letterSpacing: 2, color: TONE.umber },
  league: {
    fontFamily: ROUNDED,
    fontWeight: '900',
    fontSize: 28,
    color: TONE.white,
    textShadowColor: TONE.shade,
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  clock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 14,
    height: 30,
    borderRadius: 15,
    backgroundColor: TONE.glass,
    borderWidth: 1,
    borderColor: TONE.glassEdge,
  },
  clockDay: { fontFamily: ROUNDED, fontWeight: '800', fontSize: 13, color: TONE.soft, letterSpacing: 0.8 },
  tint: { backgroundColor: 'rgba(10, 14, 70, 0.28)' },
  line: { position: 'absolute', left: 0, borderRadius: 1, backgroundColor: 'rgba(255,255,255,0.32)' },
  tracking: {
    position: 'absolute',
    left: 0,
    height: 90,
    experimental_backgroundImage:
      'linear-gradient(180deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.1) 45%, rgba(255,255,255,0.18) 50%, rgba(255,255,255,0.1) 55%, rgba(255,255,255,0) 100%)',
  },
  bigIcon: { position: 'absolute', left: 0, alignItems: 'center' },
  tapePills: { position: 'absolute', left: 0, height: 28, alignItems: 'center', justifyContent: 'center' },
});
