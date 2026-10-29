import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { useCallback, useEffect, useRef } from 'react';

/**
 * The sounds (made from scratch, scripts/spooky_sounds.py), a few players for the ones that overlap.
 * They follow the ring/silent switch.
 */

const S = {
  correct: require('../../../assets/spooky-progress/sounds/correct.wav'),
  tap: require('../../../assets/spooky-progress/sounds/tap.wav'),
  plop: require('../../../assets/spooky-progress/sounds/plop.wav'),
  bubble: require('../../../assets/spooky-progress/sounds/bubble.wav'),
  cork: require('../../../assets/spooky-progress/sounds/cork.wav'),
  whoosh: require('../../../assets/spooky-progress/sounds/whoosh.wav'),
  ghost: require('../../../assets/spooky-progress/sounds/ghost.wav'),
  bats: require('../../../assets/spooky-progress/sounds/bats.wav'),
  carve: require('../../../assets/spooky-progress/sounds/carve.wav'),
  ignite: require('../../../assets/spooky-progress/sounds/ignite.wav'),
  spider: require('../../../assets/spooky-progress/sounds/spider.wav'),
  boo: require('../../../assets/spooky-progress/sounds/boo.wav'),
  sizzle: require('../../../assets/spooky-progress/sounds/sizzle.wav'),
  boom: require('../../../assets/spooky-progress/sounds/boom.wav'),
  candy: require('../../../assets/spooky-progress/sounds/candy.wav'),
  squelch: require('../../../assets/spooky-progress/sounds/squelch.wav'),
  splat: require('../../../assets/spooky-progress/sounds/splat.wav'),
  drip: require('../../../assets/spooky-progress/sounds/drip.wav'),
  finale: require('../../../assets/spooky-progress/sounds/finale.wav'),
};

export type Sound = keyof typeof S;

const VOICES: Partial<Record<Sound, number>> = { plop: 2, drip: 3, tap: 2, carve: 2, ignite: 2, squelch: 2 };

type Player = ReturnType<typeof createAudioPlayer>;

export function useSounds() {
  const players = useRef<Partial<Record<Sound, { list: Player[]; next: number }>>>({});

  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: false, interruptionMode: 'mixWithOthers' });
    const made: Player[] = [];
    for (const [name, source] of Object.entries(S) as [Sound, number][]) {
      const list: Player[] = [];
      for (let k = 0; k < (VOICES[name] ?? 1); k++) {
        const p = createAudioPlayer(source);
        list.push(p);
        made.push(p);
      }
      players.current[name] = { list, next: 0 };
    }
    return () => {
      for (const p of made) p.remove();
      players.current = {};
    };
  }, []);

  /** Play a sound at `gain` of full loudness */
  return useCallback((name: Sound, gain = 1) => {
    const set = players.current[name];
    if (!set) return;
    const p = set.list[set.next];
    set.next = (set.next + 1) % set.list.length;
    p.volume = gain;
    p.seekTo(0);
    p.play();
  }, []);
}
