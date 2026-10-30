import { useSyncExternalStore } from 'react';

/**
 * The board's numbers that change as it plays: how many you've passed, how many XP bumps you've had,
 * the week's clock, and whether your row has gone gold (1) at the end. Kept out of the screen's state,
 * so a change redraws just the bits of text that show it rather than the whole screen in the middle
 * of its animations.
 */
export type Tally = { passed: number; xpStep: number; seconds: number; gold: number };

const START: Tally = { passed: 0, xpStep: 0, seconds: 5, gold: 0 };

export function makeTally() {
  let state = START;
  const subs = new Set<() => void>();
  return {
    get: () => state,
    set(next: Partial<Tally>) {
      state = { ...state, ...next };
      for (const f of subs) f();
    },
    reset() {
      this.set(START);
    },
    subscribe(f: () => void) {
      subs.add(f);
      return () => {
        subs.delete(f);
      };
    },
  };
}

export type TallyStore = ReturnType<typeof makeTally>;

/** One number out of the tally, re-rendering only when it changes */
export function useTally<T extends number | string>(tally: TallyStore, pick: (t: Tally) => T) {
  return useSyncExternalStore(tally.subscribe, () => pick(tally.get()));
}
