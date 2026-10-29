import { SymbolView, type SFSymbol } from 'expo-symbols';
import { type ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import { mix, outCubic, settle, span } from '../rank-up/ui';
import { MOLTEN, ROUNDED, TONE } from './data';

/** The little things every beat is made of: a gold pill, words rising, words dropping in */

/** A pill of molten gold, lettered in burnt brown, popping in at `at` */
export function Pill({
  text,
  icon,
  clock,
  at,
}: {
  text: string;
  icon?: SFSymbol;
  clock: SharedValue<number>;
  at: number;
}) {
  const s = useAnimatedStyle(() => {
    const d = clock.value - at;
    return {
      opacity: d > 0 ? 1 : 0,
      transform: [{ scale: settle(d, 2, 6) }, { rotate: `${(1 - settle(d, 1.4, 6)) * -10}deg` }],
    };
  });
  return (
    <Animated.View style={[styles.pill, s]}>
      {icon ? <SymbolView name={icon} size={12} weight="black" tintColor={TONE.umber} /> : null}
      <Text style={styles.pillText}>{text}</Text>
    </Animated.View>
  );
}

/** Something sliding up into place and fading in at `at` */
export function Rise({
  clock,
  at,
  style,
  children,
}: {
  clock: SharedValue<number>;
  at: number;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const s = useAnimatedStyle(() => {
    const k = outCubic(span(clock.value, at, 0.45));
    return { opacity: k, transform: [{ translateY: (1 - k) * 18 }] };
  });
  return <Animated.View style={[style, s]}>{children}</Animated.View>;
}

/** Words dropping in big a letter at a time and slamming down */
export function Drop({
  text,
  clock,
  at,
  size,
}: {
  text: string;
  clock: SharedValue<number>;
  at: number;
  size: number;
}) {
  return (
    <View style={styles.letters}>
      {text
        .split('')
        .map((c, i) =>
          c === ' ' ? (
            <View key={i} style={{ width: size * 0.3 }} />
          ) : (
            <Letter key={i} c={c} clock={clock} at={at + i * 0.045} size={size} />
          )
        )}
    </View>
  );
}

function Letter({ c, clock, at, size }: { c: string; clock: SharedValue<number>; at: number; size: number }) {
  const s = useAnimatedStyle(() => {
    const d = clock.value - at;
    const fall = Math.min(1, Math.max(0, d / 0.14));
    const land = d - 0.14;
    const squash = land > 0 ? 0.22 * Math.exp(-land * 9) * Math.cos(land * 28) : 0;
    return {
      opacity: d > 0 ? 1 : 0,
      transform: [
        { translateY: (1 - fall * fall) * -size * 0.9 },
        { scaleX: mix(2.2, 1, fall * fall) * (1 + squash) },
        { scaleY: mix(2.2, 1, fall * fall) * (1 - squash) },
      ],
    };
  });
  return <Animated.Text style={[styles.letter, { fontSize: size }, s]}>{c}</Animated.Text>;
}

export const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 30,
    paddingHorizontal: 15,
    borderRadius: 15,
    experimental_backgroundImage: MOLTEN,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.85)',
    boxShadow: `inset 0 2px 1px -0.5px rgba(255,255,255,0.85), 0 4px 0 ${TONE.amber}, 0 10px 18px ${TONE.drop}`,
  },
  pillText: { fontFamily: ROUNDED, fontWeight: '900', fontSize: 12, letterSpacing: 2.4, color: TONE.umber },
  letters: { flexDirection: 'row', justifyContent: 'center' },
  letter: {
    fontFamily: ROUNDED,
    fontWeight: '900',
    color: TONE.white,
    textShadowColor: TONE.shade,
    textShadowOffset: { width: 0, height: 3 },
    textShadowRadius: 10,
  },
  label: {
    fontFamily: ROUNDED,
    fontWeight: '900',
    fontSize: 20,
    letterSpacing: 0.3,
    color: TONE.goldLight,
    textShadowColor: TONE.shade,
    textShadowRadius: 6,
  },
  line: {
    textAlign: 'center',
    fontFamily: ROUNDED,
    fontWeight: '700',
    fontSize: 16,
    color: TONE.soft,
    textShadowColor: TONE.shade,
    textShadowRadius: 6,
  },
  headline: {
    textAlign: 'center',
    fontFamily: ROUNDED,
    fontWeight: '900',
    fontSize: 32,
    lineHeight: 36,
    color: TONE.white,
    textShadowColor: TONE.shade,
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
});
