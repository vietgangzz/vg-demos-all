import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  FadeInUp,
  FadeOut,
  FadeOutDown,
  FadeOutUp,
} from 'react-native-reanimated';

import { CARD_ART } from './art';
import { CREAM, DIM, FONT, glow } from './palette';
import type { Reveal } from './scene';

/**
 * The items reveal (after Rare Box): over the legendary egg the scene holds up, what it is; under
 * it, the other rewards, each in a tile, coming up one after another. And the switch between this
 * and the cards, while the chest waits.
 */

export function EggTitle({ top, hatched }: { top: number; hatched: boolean }) {
  return (
    <Animated.View
      entering={FadeInDown.duration(500).easing(Easing.out(Easing.cubic))}
      exiting={FadeOutUp.duration(300)}
      style={[styles.title, { top }]}
      pointerEvents="none">
      <Text style={[styles.rarity, glow('rgba(12,4,0,0.95)', 6)]}>LEGENDARY</Text>
      <Text style={[styles.name, glow('rgba(255,190,90,0.5)', 12)]}>{hatched ? 'Ember Drake' : 'Ember Egg'}</Text>
      <Text style={styles.sub}>{hatched ? 'Tap it to breathe fire' : 'Spin it, then hatch it'}</Text>
    </Animated.View>
  );
}

const TILES = [
  { key: 'coins', art: CARD_ART.coins, amount: '+500', caption: 'Coins' },
  { key: 'gems', art: CARD_ART.gems, amount: '+40', caption: 'Gems' },
  { key: 'xp', art: CARD_ART.xp, amount: '+560', caption: 'XP' },
] as const;

export function OtherRewards() {
  return (
    <Animated.View
      entering={FadeInUp.delay(150).duration(450)}
      exiting={FadeOutDown.duration(250)}
      style={styles.panel}
      pointerEvents="none">
      <Text style={styles.caption}>OTHER REWARDS</Text>
      <View style={styles.row}>
        {TILES.map((t, i) => (
          <Animated.View
            key={t.key}
            entering={FadeInUp.delay(260 + i * 110)
              .springify()
              .damping(14)
              .stiffness(180)}
            style={styles.tile}>
            <View style={styles.art}>
              <Image source={t.art} style={StyleSheet.absoluteFill} contentFit="cover" contentPosition="top" />
            </View>
            <Text style={styles.amount}>{t.amount}</Text>
            <Text style={styles.tileCaption}>{t.caption}</Text>
          </Animated.View>
        ))}
      </View>
    </Animated.View>
  );
}

/** Items or cards: what comes out of the chest */
export function RevealSwitch({ value, onChange }: { value: Reveal; onChange: (v: Reveal) => void }) {
  return (
    <Animated.View entering={FadeIn.delay(500).duration(400)} exiting={FadeOut.duration(200)} style={styles.switch}>
      {(['items', 'cards'] as const).map((v) => (
        <Pressable
          key={v}
          onPress={() => onChange(v)}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityState={{ selected: value === v }}
          accessibilityLabel={v === 'items' ? 'Reveal items' : 'Reveal cards'}
          style={[styles.option, value === v && styles.optionOn]}>
          <Text style={[styles.optionText, value === v && styles.optionTextOn]}>
            {v === 'items' ? 'Items' : 'Cards'}
          </Text>
        </Pressable>
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  title: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  rarity: {
    fontFamily: FONT.bold,
    fontSize: 15,
    letterSpacing: 4,
    // (A lighter legendary orange, its dark shadow carrying it over the light)
    color: '#FFB84A',
  },
  name: {
    fontFamily: FONT.bold,
    fontSize: 38,
    color: CREAM,
    marginTop: -6,
  },
  sub: {
    fontFamily: FONT.medium,
    fontSize: 14,
    color: DIM,
    marginTop: -4,
  },
  panel: {
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 14,
    paddingHorizontal: 14,
    borderRadius: 24,
    backgroundColor: 'rgba(14,8,30,0.62)',
    borderWidth: 1,
    borderColor: 'rgba(255,214,150,0.2)',
  },
  caption: {
    fontFamily: FONT.semibold,
    fontSize: 11,
    letterSpacing: 2.4,
    color: DIM,
    marginBottom: 10,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  tile: {
    width: 88,
    alignItems: 'center',
  },
  art: {
    width: 76,
    height: 76,
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: 'rgba(255,214,150,0.45)',
    backgroundColor: '#140C26',
  },
  amount: {
    fontFamily: FONT.bold,
    fontSize: 18,
    color: CREAM,
    marginTop: 6,
  },
  tileCaption: {
    fontFamily: FONT.medium,
    fontSize: 12,
    color: DIM,
    marginTop: -2,
  },
  switch: {
    flexDirection: 'row',
    padding: 3,
    borderRadius: 16,
    backgroundColor: 'rgba(14,8,30,0.6)',
    borderWidth: 1,
    borderColor: 'rgba(255,214,150,0.2)',
  },
  option: {
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 13,
  },
  optionOn: {
    backgroundColor: 'rgba(255,194,74,0.92)',
  },
  optionText: {
    fontFamily: FONT.semibold,
    fontSize: 13,
    color: DIM,
  },
  optionTextOn: {
    color: '#2A1606',
  },
});
