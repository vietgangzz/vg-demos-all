import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
  ZoomIn,
} from 'react-native-reanimated';

import { CREAM, DIM, FONT, glow, INK, RARITY, RARITY_NAME, type Rarity } from './palette';

/**
 * What to do, along the bottom while the chest waits: a touch ring breathing out, "Hold anywhere"
 * (the whole screen's the button: the key comes up over the thumb wherever it's put down). Held, it
 * says how far the light's got instead: the rarity's name, in its colour, slammed in as each one's
 * reached.
 */

const TIERS: Rarity[] = ['common', 'rare', 'epic', 'legendary'];

export function HoldHint({ holding, tier }: { holding: boolean; tier: number }) {
  const pulse = useSharedValue(0);
  useEffect(() => {
    pulse.set(withRepeat(withTiming(1, { duration: 1700, easing: Easing.out(Easing.cubic) }), -1));
  }, [pulse]);
  const ring = useAnimatedStyle(() => ({
    opacity: (1 - pulse.value) * 0.85,
    transform: [{ scale: 0.55 + pulse.value * 1.15 }],
  }));
  const dot = useAnimatedStyle(() => ({ transform: [{ scale: 1 + Math.sin(pulse.value * Math.PI) * 0.12 }] }));

  if (holding) {
    const rarity = TIERS[Math.min(tier, TIERS.length - 1)];
    return (
      <View style={styles.hint} pointerEvents="none">
        <Animated.Text
          key={rarity}
          entering={ZoomIn.springify().damping(11).stiffness(220)}
          style={[styles.tier, { color: RARITY[rarity] }, glow(`${RARITY[rarity]}CC`, 14)]}>
          {RARITY_NAME[rarity].toUpperCase()}
        </Animated.Text>
        <Animated.Text entering={FadeIn.duration(250)} style={styles.sub}>
          Keep holding, the longer the rarer
        </Animated.Text>
      </View>
    );
  }
  return (
    <Animated.View
      entering={FadeIn.duration(400)}
      exiting={FadeOut.duration(150)}
      style={styles.hint}
      pointerEvents="none">
      <View style={styles.touch}>
        <Animated.View style={[styles.ring, ring]} />
        <Animated.View style={[styles.dot, dot]} />
      </View>
      <Text style={styles.label}>Hold anywhere</Text>
      <Text style={styles.sub}>Charge the key, then send it home</Text>
    </Animated.View>
  );
}

/** A big button: molten gold for the thing to do next, or quiet glass */
export function GameButton({
  label,
  icon,
  onPress,
  tone = 'gold',
  width,
}: {
  label: string;
  icon?: SymbolViewProps['name'];
  onPress: () => void;
  tone?: 'gold' | 'glass';
  width?: number;
}) {
  const press = useSharedValue(0);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: 1 - press.value * 0.04 }] }));
  const gold = tone === 'gold';
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => press.set(withSpring(1, { damping: 18, stiffness: 400 }))}
      onPressOut={() => press.set(withSpring(0, { damping: 12, stiffness: 300 }))}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={label}>
      <Animated.View style={[gold ? styles.gold : styles.glass, width ? { width } : null, style]}>
        {gold ? (
          <View style={styles.goldFace}>
            <View style={styles.gloss} />
          </View>
        ) : null}
        {icon ? <SymbolView name={icon} size={18} weight="bold" tintColor={gold ? INK : CREAM} /> : null}
        <Text style={[styles.label, { color: gold ? INK : CREAM, fontSize: gold ? 20 : 16 }]}>{label}</Text>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hint: {
    alignItems: 'center',
    minHeight: 96,
    justifyContent: 'flex-end',
  },
  touch: {
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  ring: {
    ...StyleSheet.absoluteFill,
    borderRadius: 23,
    borderWidth: 2,
    borderColor: 'rgba(255,214,140,0.9)',
    boxShadow: '0 0 12px 1px rgba(255,190,90,0.6)',
  },
  dot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: CREAM,
    boxShadow: '0 0 14px 3px rgba(255,200,110,0.85)',
  },
  label: {
    fontFamily: FONT.semibold,
    fontSize: 20,
    letterSpacing: 0.2,
    color: CREAM,
  },
  tier: {
    fontFamily: FONT.bold,
    fontSize: 30,
    letterSpacing: 4,
  },
  sub: {
    fontFamily: FONT.medium,
    fontSize: 13.5,
    color: DIM,
    marginTop: 4,
  },
  gloss: {
    ...StyleSheet.absoluteFill,
    experimental_backgroundImage:
      'linear-gradient(180deg, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0.08) 48%, rgba(0,0,0,0.14) 100%)',
  },
  gold: {
    height: 62,
    paddingHorizontal: 34,
    borderRadius: 31,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    boxShadow: '0 0 24px 2px rgba(255,176,32,0.7)',
  },
  goldFace: {
    ...StyleSheet.absoluteFill,
    borderRadius: 31,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: 'rgba(255,250,226,0.95)',
    experimental_backgroundImage: 'linear-gradient(180deg, #FFEBA8 0%, #FFC23C 48%, #EE860A 100%)',
  },
  glass: {
    height: 46,
    paddingHorizontal: 22,
    borderRadius: 23,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(14,8,30,0.62)',
    borderWidth: 1,
    borderColor: 'rgba(255,220,160,0.25)',
  },
});
