import { StyleSheet } from 'react-native';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';
import { Circle, Group, RadialGradient, Rect, vec } from 'react-native-skia';

import { LateCanvas } from '@/components/late-canvas';
import { TONE } from './data';

/**
 * The board drawing back so you stand out: a deep aqua veil falls over everyone else, and a soft pool
 * of light gathers under your row and follows it up.
 */

export function Focus({
  width,
  height,
  veil,
  y,
}: {
  width: number;
  height: number;
  /** How far the board has drawn back (0 to 1) */
  veil: SharedValue<number>;
  /** Your row's centre */
  y: SharedValue<number>;
}) {
  const pool = useDerivedValue(() => [{ translateX: width / 2 }, { translateY: y.value }, { scaleY: 0.32 }]);
  return (
    <LateCanvas style={StyleSheet.absoluteFill}>
      <Rect x={0} y={0} width={width} height={height} color={TONE.veil} opacity={veil} />
      <Group transform={pool} opacity={veil}>
        <Circle cx={0} cy={0} r={width * 0.7}>
          <RadialGradient
            c={vec(0, 0)}
            r={width * 0.7}
            colors={['rgba(255,255,255,0.5)', 'rgba(255,255,255,0.16)', 'rgba(255,255,255,0)']}
            positions={[0, 0.5, 1]}
          />
        </Circle>
      </Group>
    </LateCanvas>
  );
}
