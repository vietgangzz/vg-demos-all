import type { SymbolViewProps } from 'expo-symbols';

import type { PowerState } from './power';

/**
 * Looking after the battery, a tip at a time, picked for what it's doing right now. The advice is
 * Apple's (apple.com/batteries): heat is what ages lithium-ion most, it's happiest kept off 100%,
 * stored half full.
 */

export type Tip = { id: string; icon: SymbolViewProps['name']; title: string; body: string };

const TIPS = {
  fast: {
    icon: 'bolt.fill',
    title: 'Fastest to half full',
    body: 'Charging is quickest up to about 50%, then it eases off to go gentle on the cells.',
  },
  limit: {
    icon: 'battery.75percent',
    title: 'Kinder at 80%',
    body: 'Batteries age slower when they aren’t held full. On iPhone 15 and later, Settings › Battery › Charging can stop at 80%.',
  },
  slowing: {
    icon: 'gauge.with.dots.needle.33percent',
    title: 'Slowing down on purpose',
    body: 'Past 80% the last of the charge trickles in, so the battery stays healthy for longer.',
  },
  nights: {
    icon: 'moon.zzz.fill',
    title: 'It learns your nights',
    body: 'Optimized Battery Charging waits at 80% overnight and finishes just before you usually unplug.',
  },
  cool: {
    icon: 'thermometer.sun.fill',
    title: 'Keep it cool',
    body: 'Heat ages a battery fastest. Charge out of the sun, and take off a thick case if it gets warm.',
  },
  comfort: {
    icon: 'thermometer.medium',
    title: 'Its comfort zone',
    body: 'iPhone is happiest between 16 and 22 °C. Long spells above 35 °C can cut capacity for good.',
  },
  topUp: {
    icon: 'arrow.up.circle.fill',
    title: 'Top up any time',
    body: 'No need to run it down to 0%. Short top-ups are perfectly fine for lithium-ion.',
  },
  screen: {
    icon: 'sun.max.fill',
    title: 'The screen is the big one',
    body: 'Auto-Brightness and Dark Mode ease the biggest drain you control.',
  },
  stretch: {
    icon: 'battery.25percent',
    title: 'Stretch the last 20%',
    body: 'Low Power Mode trims background activity and effects until you charge again.',
  },
  lowPower: {
    icon: 'leaf.fill',
    title: 'Low Power Mode is on',
    body: 'Mail fetch, background refresh and some effects are paused. It turns itself off at 80%.',
  },
  storing: {
    icon: 'archivebox.fill',
    title: 'Putting it away?',
    body: 'Store it about half charged and switched off. Kept full or flat, it ages faster.',
  },
  full: {
    icon: 'checkmark.seal.fill',
    title: 'All topped up',
    body: 'iPhone stops charging at 100% and only tops up gently while it stays plugged in.',
  },
} satisfies Record<string, Omit<Tip, 'id'>>;

type Id = keyof typeof TIPS;

const pick = (...ids: Id[]): Tip[] => ids.map((id) => ({ id, ...TIPS[id] }));

export function tipsFor(state: PowerState, level: number, lowPower: boolean): Tip[] {
  if (state === 'full') return pick('full', 'nights', 'storing');
  if (state === 'charging') {
    if (level < 0.5) return pick(lowPower ? 'lowPower' : 'fast', 'cool', 'nights');
    if (level < 0.8) return pick('limit', 'nights', 'cool');
    return pick('slowing', 'limit', 'comfort');
  }
  if (level < 0.2) return pick(lowPower ? 'lowPower' : 'stretch', 'topUp');
  return pick(lowPower ? 'lowPower' : 'topUp', 'screen', 'comfort', 'storing');
}
