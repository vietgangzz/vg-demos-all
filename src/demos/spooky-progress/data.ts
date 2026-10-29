import { Platform } from 'react-native';

import { outBack, span } from '../rank-up/ui';

/**
 * Spooky Progress: a lesson's progress bar, Halloween edition, five ways. They all run to one clock:
 * five right answers, each filling a fifth of the bar, then the lesson's done and the bar goes off.
 */

export const SPOOK = {
  night: '#0B0716',
  dusk: '#1F1233',
  fog: '#8E86A8',
  moon: '#FFE9B8',
  pumpkin: '#FF7A1A',
  pumpkinLight: '#FFB347',
  pumpkinDeep: '#B8430A',
  flame: '#FFD34D',
  toxic: '#7CF03A',
  toxicDeep: '#2E9E1C',
  bone: '#F1E6CC',
  boneShade: '#BFAE8A',
  ink: '#140B1F',
  white: '#FFFFFF',
  soft: 'rgba(255,255,255,0.78)',
  glass: 'rgba(255,255,255,0.1)',
  glassEdge: 'rgba(255,255,255,0.2)',
};

export const ROUNDED = Platform.select({ ios: 'ui-rounded', default: undefined });

/** When each right answer comes in, how long the bar takes to fill to it, and the finale */
export const STEPS = [0.9, 2.1, 3.3, 4.5, 5.7];
export const FILL = 0.55;
export const FINALE = 6.55;
export const TITLE = FINALE + 0.95;
export const END = FINALE + 3.1;

/** How full the bar is at `t`, each answer filling it a fifth after `lag` (the time its effect takes to land) */
export const levelAt = (t: number, lag: number) => {
  'worklet';
  let v = 0;
  for (let k = 0; k < 5; k++) {
    const e = span(t, STEPS[k] + lag, FILL);
    v += 0.2 * (e < 1 ? outBack(e, 1.2) : 1);
  }
  return v;
};

/** Which answer's come in by `t` (-1 for none yet) */
export const stepOf = (t: number) => {
  'worklet';
  let k = -1;
  for (let i = 0; i < 5; i++) if (t >= STEPS[i]) k = i;
  return k;
};

/** What the lesson shouts at each right answer */
export const CHEERS = ['Correct!', 'Boo-tiful!', 'Spooktacular!', 'Fang-tastic!', 'Wicked good!'];
