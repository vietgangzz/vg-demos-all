import { Host, Text } from '@expo/ui/swift-ui';
import {
  animation,
  Animation,
  contentTransition,
  font,
  foregroundColor,
  monospacedDigit,
} from '@expo/ui/swift-ui/modifiers';

import type { NumericTextProps } from './numeric-text';

/** Stable numeric hash of the displayed string, for the `animation` modifier's watched value */
function animationKey(value: string) {
  let h = 0;
  for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) | 0;
  return h;
}

/**
 * SwiftUI `Text` with `.contentTransition(.numericText())`: changed digits roll and blur
 * into place natively, the way the system clock and timers do.
 */
export function NumericText({ value, fontSize, color, weight = 'semibold', countsDown = false }: NumericTextProps) {
  return (
    <Host matchContents>
      <Text
        modifiers={[
          font({ size: fontSize, weight, design: 'rounded' }),
          monospacedDigit(),
          foregroundColor(color),
          contentTransition('numericText', { countsDown }),
          // The animation runs whenever this value changes; a numeric key keeps it stable
          animation(Animation.spring({ response: 0.35, dampingFraction: 0.82 }), animationKey(value)),
        ]}>
        {value}
      </Text>
    </Host>
  );
}
