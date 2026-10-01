import { useEffect } from 'react';
import { StyleSheet, Text, View, type TextStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
} from 'react-native-reanimated';

// Three copies of 0–9 so a column can roll past 9 → 0 (or 0 → 9) the short way round
const STRIP = Array.from({ length: 30 }, (_, i) => String(i % 10));
/** Row height relative to font size. Generous, so a neighbour's glyph never peeks into the window. */
const DIGIT_ROW = 1.45;

type Props = {
  /** Already-formatted text, e.g. "135.000 ₫". Digits roll, other characters stay put. */
  text: string;
  fontSize: number;
  color: string;
  style?: TextStyle;
};

/** Odometer-style number: each digit is a column that springs to its value, right to left. */
export function RollingNumber({ text, fontSize, color, style }: Props) {
  const lineHeight = Math.round(fontSize * DIGIT_ROW);
  const textStyle: TextStyle = { fontSize, lineHeight, color, fontVariant: ['tabular-nums'], ...style };
  const chars = text.split('');

  return (
    <View style={styles.row} accessible accessibilityLabel={text}>
      {chars.map((char, i) => {
        // Key from the right so a column keeps its identity when the number gains a digit
        const fromRight = chars.length - 1 - i;
        return /\d/.test(char) ? (
          <DigitColumn
            key={`d${fromRight}`}
            digit={Number(char)}
            delay={fromRight * 30}
            lineHeight={lineHeight}
            width={fontSize * 0.62}
            textStyle={textStyle}
          />
        ) : (
          <Text key={`c${fromRight}`} style={textStyle}>
            {char}
          </Text>
        );
      })}
    </View>
  );
}

function DigitColumn({
  digit,
  delay,
  lineHeight,
  width,
  textStyle,
}: {
  digit: number;
  delay: number;
  lineHeight: number;
  width: number;
  textStyle: TextStyle;
}) {
  const offset = useSharedValue(digit);

  useEffect(() => {
    // Re-centre on the middle copy (visually identical), then take the shortest path
    const current = ((offset.get() % 10) + 10) % 10;
    offset.set(current);
    const delta = ((digit - Math.round(current) + 15) % 10) - 5;
    offset.set(withDelay(delay, withSpring(Math.round(current) + delta, { damping: 30, stiffness: 520, mass: 0.6 })));
  }, [digit, delay, offset]);

  const columnStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -(offset.get() + 10) * lineHeight }],
  }));

  return (
    <View style={{ height: lineHeight, width, overflow: 'hidden' }}>
      <Animated.View style={columnStyle}>
        {STRIP.map((d, i) => (
          <Text key={i} style={[textStyle, styles.digit, { width, height: lineHeight }]}>
            {d}
          </Text>
        ))}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  digit: {
    textAlign: 'center',
    includeFontPadding: false,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
});

