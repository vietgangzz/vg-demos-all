import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import { GOLD_BADGE } from '../rank-up/data';
import { mix, settle, span } from '../rank-up/ui';
import type { Item } from '../weekly-gacha/data';
import { PrizeModel } from '../weekly-gacha/prize';
import { AVATAR, DATES, MOLTEN, ROUNDED, TONE, WEEK_NAME } from './data';

/**
 * The week on one card, to keep: you, your league, and four tiles with their prizes. It flips in
 * and then tips with the phone, a holographic foil running over it as it does.
 */

const TILES: { item: Item; value: string; label: string }[] = [
  { item: 'bolt', value: '1,935', label: 'XP earned' },
  { item: 'flame', value: '12', label: 'day streak' },
  { item: 'books', value: '23', label: 'lessons' },
  { item: 'hourglass', value: '3h 12m', label: 'learning' },
];

export function Card({
  clock,
  width,
  top,
  tilt,
}: {
  clock: SharedValue<number>;
  width: number;
  top: number;
  /** Which way the phone's tipped, each about -1 to 1 */
  tilt: SharedValue<{ x: number; y: number }>;
}) {
  const CW = width - 56;
  const turn = useAnimatedStyle(() => {
    const d = clock.value - 0.15;
    const k = settle(d, 1.3, 5.5);
    const on = span(clock.value, 0.9, 0.4);
    return {
      opacity: d > 0 ? 1 : 0,
      transform: [
        { perspective: 900 },
        { translateY: (1 - Math.min(1, k)) * 60 },
        { rotateY: `${(1 - k) * 110 + tilt.value.x * 9 * on}deg` },
        { rotateX: `${-tilt.value.y * 7 * on}deg` },
        { scale: mix(0.8, 1, Math.min(1, k)) },
      ],
    };
  });
  // The foil's bands and a glint sliding across as it tips
  const bands = useAnimatedStyle(() => ({
    transform: [{ translateX: (tilt.value.x * 0.8 + tilt.value.y * 0.4) * CW - CW * 0.5 }, { rotate: '20deg' }],
  }));
  const glint = useAnimatedStyle(() => ({
    transform: [{ translateX: (tilt.value.x * 1.6 + tilt.value.y * 0.8) * CW }, { rotate: '20deg' }],
  }));
  return (
    <Animated.View style={[styles.frame, { top, left: 28, width: CW }, turn]} pointerEvents="none">
      <View style={styles.inner}>
        <View style={styles.head}>
          <Image source={AVATAR.you} style={styles.avatar} />
          <View style={styles.who}>
            <Text style={styles.name}>You</Text>
            <Text style={styles.when}>
              {WEEK_NAME} · {DATES}
            </Text>
          </View>
          <Image source={GOLD_BADGE} style={styles.badge} contentFit="contain" />
        </View>
        <View style={styles.league}>
          <Text style={styles.leagueKicker}>PROMOTED TO</Text>
          <Text style={styles.leagueName}>Gold League</Text>
        </View>
        <View style={styles.grid}>
          {TILES.map((t) => (
            <View key={t.item} style={styles.tile}>
              <View style={styles.icon}>
                <PrizeModel item={t.item} size={46} />
              </View>
              <View>
                <Text style={styles.value}>{t.value}</Text>
                <Text style={styles.label}>{t.label}</Text>
              </View>
            </View>
          ))}
        </View>
        <Text style={styles.foot}>#1 in Silver · 12-day streak</Text>
        <Animated.View style={[styles.bands, { width: CW * 2, left: 0 }, bands]} />
        <Animated.View style={[styles.glint, glint]} />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  frame: {
    position: 'absolute',
    padding: 6,
    borderRadius: 28,
    experimental_backgroundImage: MOLTEN,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.9)',
    boxShadow: `inset 0 2px 1px -0.5px rgba(255,255,255,0.9), 0 6px 0 ${TONE.amber}, 0 22px 40px ${TONE.dropWarm}`,
  },
  inner: {
    borderRadius: 22,
    backgroundColor: '#FFF7E6',
    padding: 18,
    gap: 16,
    overflow: 'hidden',
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 58, height: 58, borderRadius: 29, borderWidth: 3, borderColor: TONE.gold },
  who: { flex: 1 },
  name: { fontFamily: ROUNDED, fontWeight: '900', fontSize: 26, color: TONE.umber },
  when: { fontFamily: ROUNDED, fontWeight: '800', fontSize: 13, color: TONE.amber },
  badge: { width: 62, height: 62 },
  league: {
    borderRadius: 16,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: TONE.umber,
  },
  leagueKicker: { fontFamily: ROUNDED, fontWeight: '900', fontSize: 11, letterSpacing: 2.4, color: TONE.goldLight },
  leagueName: { fontFamily: ROUNDED, fontWeight: '900', fontSize: 30, color: TONE.white },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: {
    flexBasis: '47%',
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 16,
    backgroundColor: '#FBE6BC',
  },
  icon: { width: 46, height: 46 },
  value: { fontFamily: ROUNDED, fontWeight: '900', fontSize: 21, color: TONE.umber },
  label: { fontFamily: ROUNDED, fontWeight: '800', fontSize: 12, color: TONE.amber },
  foot: { textAlign: 'center', fontFamily: ROUNDED, fontWeight: '800', fontSize: 13, color: TONE.amber },
  bands: {
    position: 'absolute',
    top: -100,
    bottom: -100,
    opacity: 0.32,
    experimental_backgroundImage:
      'linear-gradient(90deg, rgba(255,120,210,0) 0%, rgba(255,120,210,0) 30%, rgba(255,120,210,0.9) 36%, rgba(120,230,255,0.9) 42%, rgba(120,230,255,0) 48%, rgba(255,240,130,0) 58%, rgba(255,240,130,0.85) 63%, rgba(255,240,130,0) 68%, rgba(255,240,130,0) 100%)',
  },
  glint: {
    position: 'absolute',
    top: -100,
    bottom: -100,
    left: 0,
    width: 70,
    experimental_backgroundImage:
      'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.55) 50%, rgba(255,255,255,0) 100%)',
  },
});
