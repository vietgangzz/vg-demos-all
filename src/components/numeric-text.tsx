import { Text } from 'react-native';

export type NumericTextProps = {
  value: string;
  fontSize: number;
  color: string;
  weight?: 'regular' | 'medium' | 'semibold' | 'bold';
  /** Roll digits downwards, as a countdown does */
  countsDown?: boolean;
  /** A custom font (loaded with expo-font); its own weight applies */
  family?: string;
  letterSpacing?: number;
};

const WEIGHTS = { regular: 400, medium: 500, semibold: 600, bold: 700 } as const;

/** Fallback for platforms without SwiftUI: plain tabular digits. iOS uses numeric-text.ios.tsx. */
export function NumericText({ value, fontSize, color, weight = 'semibold', family, letterSpacing }: NumericTextProps) {
  return (
    <Text
      style={{
        fontSize,
        color,
        letterSpacing,
        fontVariant: ['tabular-nums'],
        ...(family ? { fontFamily: family } : { fontWeight: WEIGHTS[weight] }),
      }}>
      {value}
    </Text>
  );
}
