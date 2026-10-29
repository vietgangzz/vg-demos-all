import { StyleSheet } from 'react-native';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';
import { Atlas, useImage, useRectBuffer, useRSXformBuffer } from 'react-native-skia';

import { LateCanvas } from '@/components/late-canvas';
import { ITEM, type Item } from './data';

/**
 * A prize as a solid thing turning round: a whole turn of it rendered in Blender, played a frame at
 * a time for however far round it is. Without an angle it just faces you.
 */

const FRAMES = 24;
const COLS = 6;
const CELL = 384;

export function PrizeModel({ item, size, angle }: { item: Item; size: number; angle?: SharedValue<number> }) {
  const image = useImage(ITEM[item]);
  const frame = useDerivedValue(() => {
    const a = angle ? angle.value : 0;
    return Math.round(((((a % 360) + 360) % 360) / 360) * FRAMES) % FRAMES;
  });
  const sprites = useRectBuffer(1, (r) => {
    'worklet';
    const f = frame.value;
    r.setXYWH((f % COLS) * CELL, Math.floor(f / COLS) * CELL, CELL, CELL);
  });
  const transforms = useRSXformBuffer(1, (v) => {
    'worklet';
    v.set(size / CELL, 0, 0, 0);
  });
  return (
    <LateCanvas style={[styles.box, { width: size, height: size }]}>
      {image ? <Atlas image={image} sprites={sprites} transforms={transforms} /> : null}
    </LateCanvas>
  );
}

const styles = StyleSheet.create({ box: { position: 'absolute', left: 0, top: 0 } });
