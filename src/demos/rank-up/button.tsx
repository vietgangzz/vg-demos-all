import { SymbolView, type SFSymbol } from 'expo-symbols';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { FOIL, MOLTEN, ROUNDED, TONE } from './data';

/**
 * A chunky button standing on its own lip, the way a game's are: the face sits up on a darker edge
 * and sinks onto it when pressed. Light catches along the inside of its rim, following the curve.
 */

const LIP = 5;

export const LOOKS = {
  /** Gold foil, for Silver's blue world */
  foil: {
    face: FOIL,
    lip: TONE.goldDeep,
    rim: 'rgba(255,255,255,0.75)',
    ink: TONE.lip,
    glint: 'rgba(255,255,255,0.7)',
  },
  /** Molten gold on a deep amber edge, lettered in burnt brown */
  molten: {
    face: MOLTEN,
    lip: TONE.amber,
    rim: 'rgba(255,255,255,0.8)',
    ink: TONE.umber,
    glint: 'rgba(255,255,255,0.85)',
  },
  /** Dark cocoa lacquer rimmed in gold, lettered in pale gold */
  cocoa: {
    face: 'linear-gradient(180deg, #5A2D12 0%, #2E1206 100%)',
    lip: '#170700',
    rim: 'rgba(255, 214, 120, 0.85)',
    ink: TONE.goldPale,
    glint: 'rgba(255, 230, 170, 0.35)',
  },
  /** A pumpkin's orange on a deep rind edge, lettered in burnt brown (Spooky Progress) */
  pumpkin: {
    face: 'linear-gradient(180deg, #FFC070 0%, #FF8A24 50%, #E8600E 100%)',
    lip: '#7A2A04',
    rim: 'rgba(255, 232, 190, 0.85)',
    ink: '#3A1200',
    glint: 'rgba(255,255,255,0.7)',
  },
  /** A crypt's dark plum, lettered in bone (Spooky Progress) */
  crypt: {
    face: 'linear-gradient(180deg, #3B2650 0%, #23143A 100%)',
    lip: '#0E0718',
    rim: 'rgba(241, 230, 204, 0.4)',
    ink: '#F1E6CC',
    glint: 'rgba(255,255,255,0.25)',
  },
  /** Warm pearl on a gold edge, lettered in burnt orange */
  pearl: {
    face: 'linear-gradient(180deg, #FFFFFF 0%, #FFF0D2 100%)',
    lip: '#E39A2E',
    rim: 'rgba(255,255,255,0.95)',
    ink: '#A33A00',
    glint: 'rgba(255,255,255,1)',
  },
};

export type Look = keyof typeof LOOKS;

export function Chunky({
  look,
  label,
  icon,
  trailing,
  height = 58,
  disabled,
  onPress,
  style,
}: {
  look: Look;
  label?: string;
  icon?: SFSymbol;
  /** An icon after the label rather than before it */
  trailing?: SFSymbol;
  height?: number;
  disabled?: boolean;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const l = LOOKS[look];
  const round = height / 2;
  return (
    <Pressable disabled={disabled} onPress={onPress} hitSlop={6} style={[{ height: height + LIP }, style]}>
      {({ pressed }) => (
        <>
          <View style={[styles.lip, { top: LIP, height, borderRadius: round, backgroundColor: l.lip }]} />
          <View
            style={[
              styles.face,
              {
                top: pressed ? LIP - 1 : 0,
                height,
                borderRadius: round,
                experimental_backgroundImage: l.face,
                borderColor: l.rim,
                // Light along the inside of the rim, brightest at the top and following its curve down
                boxShadow: `inset 0 2.5px 1px -0.5px ${l.glint}, inset 0 -3px 2px -1px rgba(0,0,0,0.12)`,
              },
            ]}>
            {icon ? <SymbolView name={icon} size={18} weight="bold" tintColor={l.ink} /> : null}
            {label ? <Text style={[styles.label, { color: l.ink }]}>{label}</Text> : null}
            {trailing ? <SymbolView name={trailing} size={16} weight="black" tintColor={l.ink} /> : null}
          </View>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  lip: { position: 'absolute', left: 0, right: 0, boxShadow: `0 8px 18px ${TONE.dropWarm}` },
  face: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  label: { fontFamily: ROUNDED, fontWeight: '900', fontSize: 19, letterSpacing: 0.3 },
});
