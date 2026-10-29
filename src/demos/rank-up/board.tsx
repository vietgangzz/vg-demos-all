import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useDerivedValue, type SharedValue } from 'react-native-reanimated';

import { NumericText } from '@/components/numeric-text';
import { Burst } from '../daily-drop/fx';
import { BOARD, CLIMB_XP, CONFETTI, FOIL, PROMOTE, ROUNDED, TONE, YOU } from './data';
import { Focus } from './focus';
import { inOutCubic, mix, outBack, outCubic, settle, span } from './ui';

/**
 * Silver's board in the last seconds of the week, you fifth. Everyone else draws back behind a veil,
 * warm light gathers under your row, and it lifts out of the board and climbs: past fourth, over the
 * promotion line, past second, the ones you pass knocked down a place, the clock running out. At
 * the top a crown drops onto you, the board comes back in a flash and it all goes off.
 */

export const BOARD_SEQ = {
  header: 0.2,
  rows: 0.3,
  gap: 0.055,
  dim: 1.15,
  hunt: 1.3,
  lock: 1.75,
  lift: 1.8,
  climb: 2.2,
  step: 0.62,
  move: 0.36,
  get top() {
    return this.climb + 3 * this.step + this.move;
  },
  get crown() {
    return this.top + 0.3;
  },
  get boom() {
    return this.crown + 0.24;
  },
  get done() {
    return this.boom + 1;
  },
};
export const BOARD_END = BOARD_SEQ.done + 0.6;

const ROW = 56;
const GAP = 8;
const ZONE = 34;

/** The top of slot s (fractional while moving), from the top of the list */
const slotTop = (s: number) => {
  'worklet';
  const at = (n: number) => n * (ROW + GAP) + (n >= PROMOTE ? ZONE : 0);
  const lo = Math.floor(s);
  return mix(at(lo), at(lo + 1), s - lo);
};

/** When step k of your climb starts: k = 0 passes the one right above you */
const stepAt = (k: number) => {
  'worklet';
  return BOARD_SEQ.climb + k * BOARD_SEQ.step;
};
/** When your row barges into the one it passes on step k */
export const knockAt = (k: number) => {
  'worklet';
  return stepAt(k) + BOARD_SEQ.move * 0.4;
};
/** How long a shoved player's avatar is in the air */
const AIR = 0.5;
/**
 * How you get past the ones above: barging them aside with your row, or a leg springing out of it
 * and booting them out of the way
 */
const PASS: 'barge' | 'kick' = 'kick';
/** How far a passed row is sent sideways, and how far it tips */
const SHOVE = PASS === 'kick' ? { x: 78, tip: 10 } : { x: 34, tip: 5 };
/** The leg: its length out of your row, and where along the row it comes out */
const LEG = 74;
const LEG_W = 24;
/** An avatar's size, and its left edge in a row (the row's inset, padding, rank and gap) */
const AVATAR = 40;
const AVATAR_X = 16 + 10 + 24 + 12;
const moveOf = (u: number, k: number) => {
  'worklet';
  const p = span(u, stepAt(k), BOARD_SEQ.move);
  return p < 1 ? outBack(p, 1.1) : 1;
};

export function boardLayout(width: number, top: number) {
  const list = top + 184;
  return {
    park: { x: width / 2, y: top + 54 },
    header: top + 96,
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
  passed,
  xpStep,
  secondsLeft,
}: {
  clock: SharedValue<number>;
  width: number;
  height: number;
  layout: ReturnType<typeof boardLayout>;
  /** How many you've passed, how many XP bumps you've had, and the week's clock */
  passed: number;
  xpStep: number;
  secondsLeft: number;
}) {
  const S = BOARD_SEQ;
  const yourSlot = useDerivedValue(() => {
    let s = YOU;
    for (let k = 0; k < YOU; k++) s -= moveOf(clock.value, k);
    return s;
  });
  const yourY = useDerivedValue(() => layout.list + slotTop(yourSlot.value) + ROW / 2);

  // ---- Everyone else drawing back while you climb ----
  const veil = useDerivedValue(() => {
    const down = inOutCubic(span(clock.value, S.dim, 0.5));
    const up = outCubic(span(clock.value, S.boom, 0.5));
    return down * (1 - up);
  });

  // ---- The header, the countdown, the winner's line ----
  const header = useAnimatedStyle(() => {
    const k = outCubic(span(clock.value, S.header, 0.4));
    const out = span(clock.value, S.boom, 0.2);
    return { opacity: k * (1 - out), transform: [{ translateY: (1 - k) * -16 }] };
  });
  const winner = useAnimatedStyle(() => {
    const d = clock.value - S.boom - 0.15;
    return {
      opacity: d > 0 ? 1 : 0,
      transform: [{ scale: settle(d, 1.9, 5.5) }, { rotate: `${(1 - settle(d, 1.3, 6)) * -6}deg` }],
    };
  });
  const zone = useAnimatedStyle(() => {
    const k = span(clock.value, S.rows + PROMOTE * S.gap, 0.3);
    const hit = clock.value - stepAt(1) - S.move * 0.5;
    const flash = hit > 0 ? Math.exp(-hit * 3) : 0;
    return { opacity: k, transform: [{ scale: 1 + 0.08 * flash }] };
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
        <Text style={styles.league}>Silver League</Text>
        <View style={styles.clock}>
          <SymbolView name="timer" size={13} weight="bold" tintColor={TONE.white} />
          <Text style={styles.clockText}>Week ends in</Text>
          <NumericText value={`0:0${secondsLeft}`} fontSize={15} color={TONE.white} weight="black" countsDown />
        </View>
      </Animated.View>

      {BOARD.map((p, j) =>
        j === YOU ? null : (
          <Row key={p.id} j={j} clock={clock} top={layout.list} width={width} rank={rankOf(j, passed)} />
        )
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

      <Focus width={width} height={height} veil={veil} y={yourY} />

      {Array.from({ length: YOU }, (_, k) => (
        <Knock key={k} clock={clock} k={k} x={width / 2} y={layout.list + slotTop(YOU - 1 - k) + ROW} />
      ))}

      <You
        clock={clock}
        y={yourY}
        width={width}
        rank={YOU + 1 - passed}
        xp={xpStep ? CLIMB_XP[xpStep - 1] : BOARD[YOU].xp}
      />

      {Array.from({ length: YOU }, (_, k) => (
        <Bonk key={k} clock={clock} k={k} top={layout.list} />
      ))}

      <Animated.View style={[styles.winner, { top: layout.header - 10, width }, winner]}>
        <View style={styles.winnerPill}>
          <SymbolView name="crown.fill" size={13} tintColor={TONE.lip} />
          <Text style={styles.winnerPillText}>WEEK WINNER</Text>
        </View>
        <Text style={styles.winnerText}>You won Silver!</Text>
      </Animated.View>

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

/** The rank someone above you shows: one lower once you've passed them */
function rankOf(j: number, passed: number) {
  return j < YOU && passed >= YOU - j ? j + 2 : j + 1;
}

function Row({
  j,
  clock,
  top,
  width,
  rank,
}: {
  j: number;
  clock: SharedValue<number>;
  top: number;
  width: number;
  rank: number;
}) {
  const p = BOARD[j];
  const at = BOARD_SEQ.rows + j * BOARD_SEQ.gap;
  // Knocked down a place when you pass: the step that passes row j. Your row barges it aside, one
  // way then the other, and it springs back
  const k = YOU - 1 - j;
  const side = k % 2 === 0 ? 1 : -1;
  const s = useAnimatedStyle(() => {
    const u = clock.value;
    const d = u - at;
    const enter = settle(d, 1.8, 7);
    const slot = j + (k >= 0 ? moveOf(u, k) : 0);
    const hit = k >= 0 ? u - knockAt(k) : -1;
    const shove = hit > 0 ? Math.sin(hit * 14) * Math.exp(-hit * 5) : 0;
    return {
      opacity: Math.min(1, Math.max(0, d * 7)),
      transform: [
        { translateY: top + slotTop(slot) + (1 - enter) * 26 },
        { translateX: side * shove * SHOVE.x },
        { rotate: `${side * shove * SHOVE.tip}deg` },
        { scale: mix(0.92, 1, enter) },
      ],
    };
  });
  // Their avatar's away in the air (Bonk, over everything) after the knock, and lands back with a squash
  const bonk = useAnimatedStyle(() => {
    const hit = k >= 0 ? clock.value - knockAt(k) : -1;
    const land = hit - AIR;
    const squash = land > 0 ? 0.28 * Math.exp(-land * 8) * Math.cos(land * 26) : 0;
    return {
      opacity: hit > 0 && hit < AIR ? 0 : 1,
      transform: [{ scaleX: 1 + squash }, { scaleY: 1 - squash }],
    };
  });
  return (
    <Animated.View style={[styles.row, { width: width - 32 }, s]}>
      <Text style={styles.rank}>{rank}</Text>
      <Animated.View style={[styles.avatarBox, bonk]}>
        <Image source={p.avatar} style={styles.avatar} contentFit="cover" />
      </Animated.View>
      <Text style={styles.name} numberOfLines={1}>
        {p.name}
      </Text>
      <Text style={styles.xp}>{p.xp.toLocaleString('en-US')} XP</Text>
    </Animated.View>
  );
}

function You({
  clock,
  y,
  width,
  rank,
  xp,
}: {
  clock: SharedValue<number>;
  y: SharedValue<number>;
  width: number;
  rank: number;
  xp: number;
}) {
  const S = BOARD_SEQ;
  const at = S.rows + YOU * S.gap;
  const w = width - 32;
  const body = useAnimatedStyle(() => {
    const u = clock.value;
    const d = u - at;
    const enter = settle(d, 1.8, 7);
    const lift = settle(u - S.lift, 1.6, 6);
    const boom = u - S.boom;
    const pop = boom > 0 ? 0.1 * Math.exp(-boom * 5) * Math.cos(boom * 18) : 0;
    // A lean into each step up
    let lean = 0;
    for (let k = 0; k < YOU; k++) lean += Math.sin(Math.PI * span(u, stepAt(k), S.move)) * 1.4;
    return {
      opacity: Math.min(1, Math.max(0, d * 7)),
      transform: [
        { translateY: y.value - ROW / 2 + (1 - enter) * 26 },
        { scale: mix(0.92, 1, enter) * (1 + 0.05 * lift + pop) },
        { rotate: `${-lean}deg` },
      ],
    };
  });
  const halo = useAnimatedStyle(() => {
    const u = clock.value;
    const k = span(u, S.lift, 0.3);
    return { opacity: k * (0.55 + 0.45 * Math.sin(u * 6)), transform: [{ scale: 1 + 0.03 * Math.sin(u * 6) }] };
  });
  const gold = useAnimatedStyle(() => ({ opacity: span(clock.value, S.boom, 0.18) }));
  const shine = useAnimatedStyle(() => {
    const k = span(clock.value, S.boom + 0.25, 0.6);
    return {
      opacity: k > 0 && k < 1 ? 1 : 0,
      transform: [{ translateX: mix(-120, w + 60, inOutCubic(k)) }, { skewX: '-20deg' }],
    };
  });
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
      {PASS === 'kick' ? <Leg clock={clock} width={w} /> : null}
      <Animated.View style={[styles.halo, halo]} />
      <View style={styles.youFill}>
        <Animated.View style={[styles.youGold, gold]} />
        <Animated.View style={[styles.shine, shine]} />
      </View>
      <View style={styles.youRank}>
        <NumericText value={`#${rank}`} fontSize={17} color={TONE.ink} weight="black" countsDown />
      </View>
      <Image source={BOARD[YOU].avatar} style={[styles.avatar, styles.youAvatar]} contentFit="cover" />
      <Text style={[styles.name, styles.youName]}>You</Text>
      <NumericText value={`${xp.toLocaleString('en-US')} XP`} fontSize={15} color={TONE.ink} weight="black" />
      <Animated.View style={[styles.crown, crown]}>
        <SymbolView name="crown.fill" size={30} tintColor={TONE.gold} />
      </Animated.View>
    </Animated.View>
  );
}

/**
 * A leg springing up out from behind your row as it reaches each one above: cocked back, it swings
 * through and boots them off to the side, then ducks back in. A striped sock and a sneaker, kicking
 * one way then the other.
 */
function Leg({ clock, width }: { clock: SharedValue<number>; width: number }) {
  const s = useAnimatedStyle(() => {
    const { k, d } = kickOf(clock.value);
    if (k >= 0) {
      const side = k % 2 === 0 ? 1 : -1;
      const out = outBack(span(d, -0.22, 0.12), 2.2) * (1 - inOutCubic(span(d, 0.26, 0.16)));
      // Cocked back and trembling, then swung through hard, and a little bounce off them
      const wind = span(d, -0.22, 0.16);
      const swing = outCubic(span(d, -0.04, 0.07));
      const back = d > 0.03 ? 10 * Math.exp(-(d - 0.03) * 14) * Math.sin((d - 0.03) * 40) : 0;
      const angle = mix(-10, -48, wind) + (d > -0.1 && d < -0.04 ? Math.sin(d * 160) * 3 : 0);
      return {
        opacity: 1,
        transform: [
          { translateX: width / 2 - side * width * 0.14 - LEG_W / 2 },
          { scaleX: side },
          { rotate: `${mix(angle, 62, swing) - back}deg` },
          { scaleY: out },
        ],
      };
    }
    return { opacity: 0, transform: [{ scaleY: 0 }] };
  });
  // A burst off the toe as it connects
  const pow = useAnimatedStyle(() => {
    const { k, d } = kickOf(clock.value);
    const a = k >= 0 ? span(d, -0.01, 0.22) : 1;
    return {
      opacity: a > 0 && a < 1 ? 1 - a * a : 0,
      transform: [{ scale: mix(0.4, 1.5, outCubic(a)) }, { rotate: `${a * 40}deg` }],
    };
  });
  return (
    <Animated.View style={[styles.leg, s]} pointerEvents="none">
      <View style={styles.shin} />
      <View style={styles.sock}>
        <View style={styles.stripe} />
        <View style={styles.stripe} />
      </View>
      <View style={styles.shoe}>
        <View style={styles.toe} />
        <View style={styles.sole} />
        <View style={[styles.lace, { left: 12 }]} />
        <View style={[styles.lace, { left: 19 }]} />
      </View>
      <Animated.View style={[styles.pow, pow]}>
        <SymbolView name="burst.fill" size={44} tintColor={TONE.goldLight} />
      </Animated.View>
    </Animated.View>
  );
}

/** Which kick is under way at `u`, if any (k = -1), and how far from its hit */
const kickOf = (u: number) => {
  'worklet';
  for (let k = 0; k < YOU; k++) {
    const d = u - knockAt(k);
    if (d >= -0.22 && d <= 0.42) return { k, d };
  }
  return { k: -1, d: 0 };
};

const styles = StyleSheet.create({
  leg: {
    position: 'absolute',
    left: 0,
    top: -LEG + 8,
    width: LEG_W,
    height: LEG,
    alignItems: 'center',
    flexDirection: 'column-reverse',
    transformOrigin: 'bottom',
  },
  shin: {
    flex: 1,
    width: LEG_W - 6,
    backgroundColor: '#F4BE92',
    borderLeftWidth: 2,
    borderRightWidth: 2,
    borderColor: TONE.ink,
  },
  sock: {
    width: LEG_W,
    height: 24,
    backgroundColor: TONE.white,
    borderWidth: 2,
    borderBottomWidth: 0,
    borderColor: TONE.ink,
    borderTopLeftRadius: 5,
    borderTopRightRadius: 5,
    justifyContent: 'flex-end',
    gap: 3,
    paddingBottom: 4,
  },
  stripe: { height: 3.5, backgroundColor: TONE.cool },
  shoe: {
    width: 46,
    height: 26,
    marginBottom: -4,
    marginLeft: 22,
    borderTopLeftRadius: 12,
    borderBottomLeftRadius: 10,
    borderTopRightRadius: 20,
    borderBottomRightRadius: 8,
    backgroundColor: TONE.gold,
    borderWidth: 2,
    borderColor: TONE.ink,
    overflow: 'hidden',
  },
  toe: {
    position: 'absolute',
    right: -6,
    top: 6,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: TONE.white,
    borderWidth: 2,
    borderColor: TONE.ink,
  },
  sole: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 6, backgroundColor: TONE.white },
  lace: { position: 'absolute', top: 4, width: 3, height: 9, borderRadius: 1.5, backgroundColor: TONE.ink },
  pow: { position: 'absolute', top: -30, left: 36 },
  header: {
    position: 'absolute',
    left: 0,
    alignItems: 'center',
    gap: 10,
  },
  league: {
    fontFamily: ROUNDED,
    fontWeight: '900',
    fontSize: 30,
    color: TONE.white,
    textShadowColor: TONE.shade,
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  clock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    height: 30,
    borderRadius: 15,
    backgroundColor: TONE.glass,
    borderWidth: 1,
    borderColor: TONE.glassEdge,
  },
  clockText: {
    fontFamily: ROUNDED,
    fontWeight: '700',
    fontSize: 13,
    color: TONE.soft,
  },
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
    height: 30,
    paddingHorizontal: 15,
    borderRadius: 15,
    experimental_backgroundImage: FOIL,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.7)',
    boxShadow: `0 4px 0 ${TONE.goldDeep}, 0 10px 18px ${TONE.drop}`,
  },
  winnerPillText: {
    fontFamily: ROUNDED,
    fontWeight: '900',
    fontSize: 12,
    letterSpacing: 2.2,
    color: TONE.lip,
  },
  winnerText: {
    fontFamily: ROUNDED,
    fontWeight: '900',
    fontSize: 36,
    color: TONE.white,
    textShadowColor: TONE.shade,
    textShadowOffset: { width: 0, height: 3 },
    textShadowRadius: 10,
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
    height: 2,
    borderRadius: 1,
    backgroundColor: TONE.glassEdge,
    overflow: 'hidden',
  },
  zoneLineGold: {
    ...StyleSheet.absoluteFill,
    backgroundColor: TONE.gold,
  },
  zoneText: {
    fontFamily: ROUNDED,
    fontWeight: '900',
    fontSize: 11,
    letterSpacing: 1.6,
    color: TONE.white,
  },
  row: {
    position: 'absolute',
    top: 0,
    left: 16,
    height: ROW,
    borderRadius: 20,
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
  bonk: { position: 'absolute', left: 0, top: 0, width: AVATAR, height: AVATAR, borderRadius: AVATAR / 2 },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: TONE.glass,
  },
  name: {
    flex: 1,
    fontFamily: ROUNDED,
    fontWeight: '800',
    fontSize: 17,
    color: TONE.white,
  },
  xp: {
    fontFamily: ROUNDED,
    fontWeight: '800',
    fontSize: 15,
    color: TONE.soft,
    fontVariant: ['tabular-nums'],
  },
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
  halo: {
    position: 'absolute',
    left: -6,
    right: -6,
    top: -6,
    bottom: -6,
    borderRadius: 26,
    backgroundColor: 'rgba(255,255,255,0.35)',
    boxShadow: '0 0 26px rgba(255, 255, 255, 0.85)',
  },
  youFill: {
    ...StyleSheet.absoluteFill,
    borderRadius: 20,
    backgroundColor: TONE.white,
    overflow: 'hidden',
    boxShadow: `0 12px 28px ${TONE.drop}`,
  },
  youGold: {
    ...StyleSheet.absoluteFill,
    experimental_backgroundImage: FOIL,
  },
  shine: {
    position: 'absolute',
    top: -10,
    bottom: -10,
    width: 60,
    experimental_backgroundImage:
      'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.85) 50%, rgba(255,255,255,0) 100%)',
  },
  youRank: {
    width: 40,
    alignItems: 'center',
  },
  youAvatar: {
    borderWidth: 2,
    borderColor: TONE.cool,
  },
  youName: {
    fontWeight: '900',
    color: TONE.ink,
  },
  crown: {
    position: 'absolute',
    left: 54,
    top: -30,
    width: 44,
    alignItems: 'center',
  },
});
