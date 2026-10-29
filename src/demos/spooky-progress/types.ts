import type { SharedValue } from 'react-native-reanimated';

import type { Sound } from './sounds';

/** What every bar's drawn from: the clock, seconds always running, the screen's width, and where the bar sits */
export type BarProps = {
  t: SharedValue<number>;
  ambient: SharedValue<number>;
  width: number;
  height: number;
  y: number;
};

/** A sound (and maybe a buzz) at a moment on the clock */
export type Cue = { at: number; sound?: Sound; gain?: number; feel?: 'light' | 'medium' | 'heavy' };
