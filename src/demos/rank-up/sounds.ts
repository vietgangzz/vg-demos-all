import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { useCallback, useEffect, useRef } from 'react';

/**
 * The sounds (made from scratch, scripts/rank_up_sounds.py), a few players for the ones that
 * overlap. They follow the ring/silent switch.
 */

const S = {
  tap: require('../../../assets/rank-up/sounds/tap.wav'),
  pop: require('../../../assets/rank-up/sounds/pop.wav'),
  swish: require('../../../assets/rank-up/sounds/swish.wav'),
  drop: require('../../../assets/rank-up/sounds/drop.wav'),
  lights: require('../../../assets/rank-up/sounds/lights.wav'),
  spot: require('../../../assets/rank-up/sounds/spot.wav'),
  lift: require('../../../assets/rank-up/sounds/lift.wav'),
  xp: require('../../../assets/rank-up/sounds/xp.wav'),
  climb0: require('../../../assets/rank-up/sounds/climb0.wav'),
  climb1: require('../../../assets/rank-up/sounds/climb1.wav'),
  climb2: require('../../../assets/rank-up/sounds/climb2.wav'),
  climb3: require('../../../assets/rank-up/sounds/climb3.wav'),
  knock: require('../../../assets/rank-up/sounds/knock.wav'),
  zone: require('../../../assets/rank-up/sounds/zone.wav'),
  boom: require('../../../assets/rank-up/sounds/boom.wav'),
  cannon: require('../../../assets/rank-up/sounds/cannon.wav'),
  charge: require('../../../assets/rank-up/sounds/charge.wav'),
  spin: require('../../../assets/rank-up/sounds/spin.wav'),
  promote: require('../../../assets/rank-up/sounds/promote.wav'),
  fanfare: require('../../../assets/rank-up/sounds/fanfare.wav'),
  tick: require('../../../assets/rank-up/sounds/tick.wav'),
  launch: require('../../../assets/rank-up/sounds/launch.wav'),
  whoosh: require('../../../assets/rank-up/sounds/whoosh.wav'),
  twinkle: require('../../../assets/rank-up/sounds/twinkle.wav'),
  fall: require('../../../assets/rank-up/sounds/fall.wav'),
};

export type Cue = keyof typeof S;

const VOICES: Partial<Record<Cue, { voices: number; volume: number }>> = {
  tap: { voices: 2, volume: 0.6 },
  pop: { voices: 3, volume: 0.6 },
  drop: { voices: 5, volume: 0.4 },
  cannon: { voices: 2, volume: 0.8 },
  xp: { voices: 2, volume: 0.7 },
  tick: { voices: 3, volume: 0.5 },
};

type Player = ReturnType<typeof createAudioPlayer>;

export function useSounds() {
  const players = useRef<Partial<Record<Cue, { list: Player[]; next: number; volume: number }>>>({});

  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: false, interruptionMode: 'mixWithOthers' });
    const made: Player[] = [];
    for (const [cue, source] of Object.entries(S) as [Cue, number][]) {
      const v = VOICES[cue] ?? { voices: 1, volume: cue.startsWith('climb') ? 0.8 : 0.9 };
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
