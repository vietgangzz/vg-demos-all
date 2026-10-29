import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { useCallback, useEffect, useRef } from 'react';

/**
 * The sounds, Rank Up's own (made from scratch, scripts/rank_up_sounds.py), a few players for the
 * ones that overlap. They follow the ring/silent switch.
 */

const S = {
  tap: require('../../../assets/rank-up/sounds/tap.wav'),
  tick: require('../../../assets/rank-up/sounds/tick.wav'),
  knock: require('../../../assets/rank-up/sounds/knock.wav'),
  drop: require('../../../assets/rank-up/sounds/drop.wav'),
  swish: require('../../../assets/rank-up/sounds/swish.wav'),
  charge: require('../../../assets/rank-up/sounds/charge.wav'),
  pop: require('../../../assets/rank-up/sounds/pop.wav'),
  boom: require('../../../assets/rank-up/sounds/boom.wav'),
  twinkle: require('../../../assets/rank-up/sounds/twinkle.wav'),
  xp: require('../../../assets/rank-up/sounds/xp.wav'),
  zone: require('../../../assets/rank-up/sounds/zone.wav'),
  whoosh: require('../../../assets/rank-up/sounds/whoosh.wav'),
  promote: require('../../../assets/rank-up/sounds/promote.wav'),
  cannon: require('../../../assets/rank-up/sounds/cannon.wav'),
  fanfare: require('../../../assets/rank-up/sounds/fanfare.wav'),
};

export type Cue = keyof typeof S;

const VOICES: Partial<Record<Cue, { voices: number; volume: number }>> = {
  tick: { voices: 3, volume: 0.5 },
  drop: { voices: 3, volume: 0.5 },
  pop: { voices: 2, volume: 0.6 },
  xp: { voices: 3, volume: 0.6 },
  cannon: { voices: 2, volume: 0.8 },
};

type Player = ReturnType<typeof createAudioPlayer>;

export function useSounds() {
  const players = useRef<Partial<Record<Cue, { list: Player[]; next: number; volume: number }>>>({});

  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: false, interruptionMode: 'mixWithOthers' });
    const made: Player[] = [];
    for (const [cue, source] of Object.entries(S) as [Cue, number][]) {
      const v = VOICES[cue] ?? { voices: 1, volume: 0.9 };
      const list: Player[] = [];
      for (let k = 0; k < v.voices; k++) {
        const p = createAudioPlayer(source);
        list.push(p);
        made.push(p);
      }
      players.current[cue] = { list, next: 0, volume: v.volume };
    }
    return () => {
      for (const p of made) p.remove();
      players.current = {};
    };
  }, []);

  /** Play a cue, `gain` of its usual loudness */
  return useCallback((cue: Cue, gain = 1) => {
    const set = players.current[cue];
    if (!set) return;
    const p = set.list[set.next];
    set.next = (set.next + 1) % set.list.length;
    p.volume = set.volume * gain;
    p.seekTo(0);
    p.play();
  }, []);
}
