import { Image } from 'expo-image';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

/**
 * A button off the Grid, in the Codex frames (scripts/rank_up_neo_art.py): dark glass with its corners
 * cut off, edged in a double line of its world's light, notched at the top and barred along the bottom
 * at each end; the long middle of it stretches to whatever width it's given. A quiet one (going again,
 * say) is a small square of the same glass with just a hairline round it, so the eye goes to the other.
 * The lettering's spaced-out capitals, like a readout. Pressed, it lights up from inside.
 */

const FRAMES = {
  neon: {
    left: require('../../../assets/rank-up-neo/art/button/cyan-left.png'),
    mid: require('../../../assets/rank-up-neo/art/button/cyan-mid.png'),
    right: require('../../../assets/rank-up-neo/art/button/cyan-right.png'),
  },
  molten: {
    left: require('../../../assets/rank-up-neo/art/button/gold-left.png'),
    mid: require('../../../assets/rank-up-neo/art/button/gold-mid.png'),
    right: require('../../../assets/rank-up-neo/art/button/gold-right.png'),
  },
};
const QUIET = require('../../../assets/rank-up-neo/art/button/quiet.png');
/** An end of a wide frame, as wide against its height as in the art (120 by 192) */
const END = 120 / 192;

export const LOOKS = {
  /** Silver's: cyan */
  neon: { wash: '34, 229, 255', ink: '#EAFDFF', icon: '#7FF3FF' },
  /** Gold's: gold */
  molten: { wash: '255, 200, 61', ink: '#FFF6DC', icon: '#FFD666' },
};

export type Look = keyof typeof LOOKS;

export function Chunky({
  look,
  label,
  icon,
  trailing,
  quiet,
  height = 56,
  disabled,
  onPress,
  style,
}: {
  look: Look;
  label?: string;
  icon?: SFSymbol;
  /** An icon after the label rather than before it */
  trailing?: SFSymbol;
  /** The small square one with just a hairline round it */
  quiet?: boolean;
  height?: number;
  disabled?: boolean;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const l = LOOKS[look];
  const f = FRAMES[look];
  const end = height * END;
  return (
    <Pressable disabled={disabled} onPress={onPress} hitSlop={6} style={[{ height }, style]}>
      {({ pressed }) => (
        <View style={{ height, transform: [{ scale: pressed ? 0.98 : 1 }] }}>
          {quiet ? (
            <Image source={QUIET} style={StyleSheet.absoluteFill} contentFit="fill" />
          ) : (
            <View style={[StyleSheet.absoluteFill, styles.row]}>
              <Image source={f.left} style={{ width: end, height }} contentFit="fill" />
              <Image source={f.mid} style={{ flex: 1, height }} contentFit="fill" />
              <Image source={f.right} style={{ width: end, height }} contentFit="fill" />
            </View>
          )}
          {/* Lit from inside, pressed */}
          <View
            style={[
              styles.inside,
              { borderRadius: height * 0.12 },
              pressed ? { backgroundColor: `rgba(${l.wash}, 0.18)` } : null,
            ]}
          />
          <View style={[StyleSheet.absoluteFill, styles.face]}>
            {icon ? <SymbolView name={icon} size={17} weight="semibold" tintColor={quiet ? l.ink : l.icon} /> : null}
            {label ? (
              <Text style={[styles.label, { color: l.ink, textShadowColor: `rgba(${l.wash}, 0.7)` }]}>{label}</Text>
            ) : null}
            {trailing ? <SymbolView name={trailing} size={15} weight="semibold" tintColor={l.icon} /> : null}
          </View>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  inside: { position: 'absolute', left: '6%', right: '6%', top: '16%', bottom: '16%' },
  face: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 2.2,
    textTransform: 'uppercase',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 6,
  },
});
