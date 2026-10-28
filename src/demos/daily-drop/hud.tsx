import { Fredoka_700Bold } from '@expo-google-fonts/fredoka';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { forwardRef, useEffect } from 'react';
import { Pressable, StyleSheet, Text, View, type ViewInstance } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { BlurMask, LinearGradient, Text as SkText, useFont, vec } from 'react-native-skia';

import { LateCanvas } from '@/components/late-canvas';
import { NumericText } from '@/components/numeric-text';

import { CARD_ART, DRAKE_AVATAR } from './art';
import { CREAM, DIM, FONT, glow, GOLD, XP } from './palette';

/**
 * What sits over the vault: along the top, who you are (your level, how far into it, your face)
 * and what you've got (coins, gems); under it, today's chest and the week it's the end of.
 */

const GLASS = isLiquidGlassAvailable();
const XP_W = 86;

/** A gold coin, drawn: a rim, a ring stamped in it, a star */
export function CoinIcon({ size = 22 }: { size?: number }) {
  return (
    <View style={[styles.coin, { width: size, height: size, borderRadius: size / 2 }]}>
      <View style={[styles.coinRing, { width: size * 0.68, height: size * 0.68, borderRadius: size }]}>
        <SymbolView name="star.fill" size={size * 0.34} tintColor="#A9640A" />
      </View>
    </View>
  );
}

/** A violet gem: a square stood on its point, lit from the top left */
export function GemIcon({ size = 22 }: { size?: number }) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View style={[styles.gem, { width: size * 0.64, height: size * 0.64 }]}>
        <View style={styles.gemFacet} />
      </View>
    </View>
  );
}

/** What's just been added, floating up by where it's gone and fading: "+500" */
function Delta({ text, colour, tick, style }: { text: string; colour: string; tick: number; style: object }) {
  const k = useSharedValue(0);
  useEffect(() => {
    if (!tick) return;
    k.set(0);
    k.set(withTiming(1, { duration: 1900, easing: Easing.out(Easing.cubic) }));
  }, [tick, k]);
  const float = useAnimatedStyle(() => ({
    opacity: interpolate(k.value, [0, 0.08, 0.75, 1], [0, 1, 1, 0]),
    transform: [
      { translateY: interpolate(k.value, [0, 1], [10, -2]) },
      { scale: interpolate(k.value, [0, 0.1, 0.25], [0.5, 1.18, 1], 'clamp') },
    ],
  }));
  return <Animated.Text style={[styles.delta, { color: colour }, style, float]}>{text}</Animated.Text>;
}

/** A pill with a count in it that rolls as it changes, and kicks when something lands in it */
export const CurrencyPill = forwardRef<
  ViewInstance,
  { icon: 'coin' | 'gem'; value: number; bump: SharedValue<number>; delta: string; tick: number }
>(function CurrencyPill({ icon, value, bump, delta, tick }, ref) {
  const kick = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + bump.value * 0.14 }],
  }));
  const glow = useAnimatedStyle(() => ({ opacity: bump.value }));
  return (
    <Animated.View ref={ref} style={kick} collapsable={false}>
      <GlassView glassEffectStyle="clear" tintColor="rgba(14,8,30,0.5)" style={[styles.pill, !GLASS && styles.frost]}>
        {icon === 'coin' ? <CoinIcon /> : <GemIcon />}
        <NumericText value={value.toLocaleString('en-US')} fontSize={16} color={CREAM} family={FONT.semibold} />
      </GlassView>
      <Animated.View
        pointerEvents="none"
        style={[styles.pillGlow, { boxShadow: `0 0 16px 2px ${icon === 'coin' ? GOLD : '#C08BFF'}` }, glow]}
      />
      <Delta text={delta} colour={icon === 'coin' ? GOLD : '#D2B0FF'} tick={tick} style={styles.pillDelta} />
    </Animated.View>
  );
});

/** Your face (a level number until you've a companion to show), your level and the bar to the next */
export function Profile({
  level,
  xp,
  companion,
  avatarRef,
  xpRef,
  pop,
  tick,
}: {
  level: number;
  xp: SharedValue<number>;
  /** Who's joined you, once they have: the fox (from the cards) or the drake (hatched) */
  companion: 'fox' | 'drake' | null;
  avatarRef: React.RefObject<ViewInstance | null>;
  xpRef: React.RefObject<ViewInstance | null>;
  pop: SharedValue<number>;
  /** Changed when XP's on its way: the "+XP" floats up under the bar */
  tick: number;
}) {
  const fill = useAnimatedStyle(() => ({ width: Math.max(6, Math.min(1, xp.value) * XP_W) }));
  const ring = useAnimatedStyle(() => ({ transform: [{ scale: 1 + pop.value * 0.18 }] }));
  return (
    <View style={styles.profile}>
      <Animated.View ref={avatarRef} collapsable={false} style={[styles.avatar, ring]}>
        {companion ? (
          <Image
            source={companion === 'fox' ? CARD_ART.fox : DRAKE_AVATAR}
            style={styles.avatarArt}
            contentFit="cover"
            contentPosition="top"
            transition={250}
          />
        ) : (
          <Text style={styles.avatarLevel}>{level}</Text>
        )}
      </Animated.View>
      <View>
        <Text style={styles.levelText}>
          Level <Text style={{ color: CREAM }}>{level}</Text>
        </Text>
        <View ref={xpRef} collapsable={false} style={styles.xpTrack}>
          <Animated.View style={[styles.xpFill, fill]} />
        </View>
        <Delta text="+560 XP" colour={XP} tick={tick} style={styles.xpDelta} />
      </View>
    </View>
  );
}

export function CloseButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close demo">
      <GlassView glassEffectStyle="clear" tintColor="rgba(14,8,30,0.5)" style={[styles.close, !GLASS && styles.frost]}>
        <SymbolView name="xmark" size={13} weight="bold" tintColor={CREAM} />
      </GlassView>
    </Pressable>
  );
}

/** When, in the claim (seconds), today's check comes down (the days before it light up on the way) */
const STAMP_AT = 0.62;
const CLAIM_LONG = 1.6;

/**
 * Today's chest: the title, and the week of days it's the last of. Once it's claimed, light runs
 * along the week, each day's check popping as it reaches it, and today's check slams down
 */
export function Header({ stamped }: { stamped: boolean }) {
  const claim = useSharedValue(0);
  useEffect(() => {
    claim.set(0);
    if (stamped)
      claim.set(withDelay(450, withTiming(CLAIM_LONG, { duration: CLAIM_LONG * 1000, easing: Easing.linear })));
  }, [stamped, claim]);
  return (
    <View style={styles.header} pointerEvents="none">
      <Text style={styles.kicker}>{stamped ? 'DAY 7 · CLAIMED' : 'DAY 7 · STREAK REWARD'}</Text>
      <Title />
      <Streak stamped={stamped} claim={claim} />
    </View>
  );
}

const TITLE = 'Daily Drop';
const TITLE_W = 300;
const TITLE_H = 58;

/** "Daily Drop", in gold, a gleam running across it every few seconds */
function Title() {
  const font = useFont(Fredoka_700Bold, 42);
  const gleam = useSharedValue(0);
  useEffect(() => {
    gleam.set(withRepeat(withTiming(1, { duration: 3400, easing: Easing.linear }), -1));
  }, [gleam]);
  const width = font ? font.measureText(TITLE).width : 0;
  const x = (TITLE_W - width) / 2;
  const y = 44;
  // The gleam crosses in the first third of each cycle, then waits
  const from = useDerivedValue(() => {
    const k = Math.min(1, gleam.value / 0.34);
    return vec(x - 106 + (width + 120) * k, 0);
  });
  const to = useDerivedValue(() => vec(from.value.x + 92, TITLE_H * 0.6));
  if (!font) return <View style={styles.titleBox} />;
  return (
    <LateCanvas style={styles.titleBox}>
      {/* Readable over the light: a soft dark shadow under it, a dark brown outline round it */}
      <SkText x={x} y={y + 3} text={TITLE} font={font} color="rgba(8,3,0,0.7)">
        <BlurMask blur={6} style="normal" />
      </SkText>
      <SkText x={x} y={y} text={TITLE} font={font} color="#3A1804" style="stroke" strokeWidth={6} strokeJoin="round" />
      <SkText x={x} y={y} text={TITLE} font={font}>
        <LinearGradient
          start={vec(0, 10)}
          end={vec(0, y + 4)}
          colors={['#FFFBEA', '#FFE6A0', '#FFC24A', '#E98B12']}
          positions={[0, 0.35, 0.7, 1]}
        />
      </SkText>
      <SkText x={x} y={y} text={TITLE} font={font}>
        <LinearGradient
          start={from}
          end={to}
          colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.95)', 'rgba(255,255,255,0)']}
        />
      </SkText>
    </LateCanvas>
  );
}

function Streak({ stamped, claim }: { stamped: boolean; claim: SharedValue<number> }) {
  // Light running along the line, day to day, to today
  const fill = useAnimatedStyle(() => ({
    opacity: stamped ? 1 : 0,
    transform: [{ scaleX: stamped ? Math.min(1, Math.max(0.001, claim.value / STAMP_AT)) : 0.001 }],
  }));
  return (
    <View style={styles.streak}>
      <View style={styles.streakLine} />
      <Animated.View style={[styles.streakLine, styles.streakFill, fill]} />
      {[0, 1, 2, 3, 4, 5].map((d) => (
        <Day key={d} at={0.06 + d * 0.075} claim={claim} stamped={stamped} />
      ))}
      <Today stamped={stamped} claim={claim} />
    </View>
  );
}

/** One of the days before today: done; popping and flashing as the claim's light reaches it (at `at`) */
function Day({ at, claim, stamped }: { at: number; claim: SharedValue<number>; stamped: boolean }) {
  const pop = useDerivedValue(() => {
    const t = (claim.value - at) / 0.28;
    return stamped && t > 0 && t < 1 ? Math.sin(t * Math.PI) : 0;
  });
  const style = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + pop.value * 0.38 }, { translateY: -pop.value * 4 }],
  }));
  const flash = useAnimatedStyle(() => ({ opacity: pop.value * 0.85 }));
  return (
    <Animated.View style={[styles.dayDone, style]}>
      <SymbolView name="checkmark" size={11} weight="heavy" tintColor="#5A3205" />
      <Animated.View style={[styles.dayFlash, flash]} />
    </Animated.View>
  );
}

/** Day 7: glowing, waiting; once it's claimed, its check slamming down */
function Today({ stamped, claim }: { stamped: boolean; claim: SharedValue<number> }) {
  const pulse = useSharedValue(0);
  useEffect(() => {
    pulse.set(withRepeat(withTiming(1, { duration: 1300, easing: Easing.inOut(Easing.sin) }), -1, true));
  }, [pulse]);
  /** Since the check came down (seconds; 0 before) */
  const since = useDerivedValue(() => (stamped ? Math.max(0, claim.value - STAMP_AT) : 0));
  const halo = useAnimatedStyle(() => ({
    opacity: (0.35 + pulse.value * 0.45) * (since.value > 0 ? 0 : 1),
    transform: [{ scale: 1 + pulse.value * 0.22 }],
  }));
  const done = useAnimatedStyle(() => {
    const t = since.value;
    const on = t > 0 ? 1 : 0;
    return {
      opacity: on * Math.min(1, t * 14),
      transform: [
        { scale: on ? 1 + 1.4 * Math.exp(-t * 10) * Math.cos(t * 16) : 2.4 },
        { rotate: `${-18 * Math.exp(-t * 7)}deg` },
      ],
    };
  });
  return (
    <View style={styles.today}>
      <Animated.View style={[styles.todayHalo, halo]} />
      <View style={styles.todayInner}>
        <SymbolView name="gift.fill" size={17} tintColor={GOLD} />
      </View>
      <Animated.View style={[styles.todayDone, done]}>
        <SymbolView name="checkmark" size={16} weight="heavy" tintColor="#5A3205" />
      </Animated.View>
    </View>
  );
}

/** A kick: up to 1 and settling back, every time it's called */
export function kick(v: SharedValue<number>) {
  'worklet';
  v.set(withSequence(withTiming(1, { duration: 70 }), withSpring(0, { damping: 9, stiffness: 220 })));
}

const styles = StyleSheet.create({
  frost: {
    backgroundColor: 'rgba(16,10,32,0.72)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,214,150,0.22)',
  },
  coin: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,248,214,0.95)',
    experimental_backgroundImage: 'linear-gradient(160deg, #FFF1B8 0%, #FFC94A 45%, #D3820E 100%)',
  },
  coinRing: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(160,96,10,0.5)',
  },
  gem: {
    transform: [{ rotate: '45deg' }],
    borderRadius: 3,
    borderWidth: 1,
    borderColor: 'rgba(255,238,255,0.9)',
    experimental_backgroundImage: 'linear-gradient(135deg, #F6E0FF 0%, #BE86FF 45%, #6A2FE0 100%)',
    overflow: 'hidden',
  },
  gemFacet: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: '55%',
    height: '55%',
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    height: 36,
    paddingLeft: 7,
    paddingRight: 13,
    borderRadius: 18,
  },
  pillGlow: {
    ...StyleSheet.absoluteFill,
    borderRadius: 18,
  },
  delta: {
    position: 'absolute',
    fontFamily: FONT.bold,
    fontSize: 16,
    ...glow('rgba(0,0,0,0.65)', 6),
  },
  pillDelta: {
    top: 40 - 9,
    right: 10 - 9,
  },
  xpDelta: {
    top: 26 - 9,
    left: -9,
  },
  profile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: GOLD,
    experimental_backgroundImage: 'linear-gradient(160deg, #7B4DFF 0%, #3A1C8C 100%)',
  },
  avatarArt: {
    width: '100%',
    height: '100%',
  },
  avatarLevel: {
    fontFamily: FONT.bold,
    fontSize: 17,
    color: CREAM,
  },
  levelText: {
    fontFamily: FONT.medium,
    fontSize: 12.5,
    color: DIM,
    marginBottom: 4,
  },
  xpTrack: {
    width: XP_W,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  xpFill: {
    height: 8,
    borderRadius: 4,
    experimental_backgroundImage: `linear-gradient(90deg, #C6F7FF 0%, ${XP} 60%, #2BB7FF 100%)`,
    boxShadow: `0 0 8px 0 ${XP}`,
  },
  close: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    alignItems: 'center',
  },
  titleBox: {
    width: TITLE_W,
    height: TITLE_H,
    marginTop: -2,
  },
  kicker: {
    fontFamily: FONT.semibold,
    fontSize: 12,
    letterSpacing: 2.6,
    color: '#FFD98A',
    ...glow('rgba(10,4,0,0.85)', 5),
  },
  streak: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 12,
  },
  streakLine: {
    position: 'absolute',
    left: 12,
    right: 20,
    height: 2,
    borderRadius: 1,
    backgroundColor: 'rgba(255,200,100,0.45)',
  },
  streakFill: {
    height: 3,
    backgroundColor: '#FFF1C4',
    boxShadow: `0 0 8px 1px ${GOLD}`,
    transformOrigin: 'left',
  },
  dayFlash: {
    ...StyleSheet.absoluteFill,
    borderRadius: 13,
    backgroundColor: '#FFFFFF',
  },
  dayDone: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,246,214,0.9)',
    experimental_backgroundImage: 'linear-gradient(160deg, #FFE9A8 0%, #FFBE3C 55%, #D98A12 100%)',
  },
  today: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  todayHalo: {
    position: 'absolute',
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(255,190,70,0.28)',
    boxShadow: `0 0 14px 2px ${GOLD}`,
  },
  todayInner: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: GOLD,
    backgroundColor: 'rgba(24,12,44,0.88)',
  },
  todayDone: {
    position: 'absolute',
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(255,246,214,0.95)',
    experimental_backgroundImage: 'linear-gradient(160deg, #FFE9A8 0%, #FFBE3C 55%, #D98A12 100%)',
  },
});
