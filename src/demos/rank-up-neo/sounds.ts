import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { useCallback, useEffect, useRef } from 'react';

/**
 * The sounds, Neo's own, all synthesised from scratch for its world of light
 * (scripts/rank_up_neo_sounds.py), a few players for the ones that overlap. They follow the
 * ring/silent switch.
 */

const S = {
  tap: require('../../../assets/rank-up-neo/sounds/tap.wav'),
  pop: require('../../../assets/rank-up-neo/sounds/pop.wav'),
  swish: require('../../../assets/rank-up-neo/sounds/swish.wav'),
  drop: require('../../../assets/rank-up-neo/sounds/drop.wav'),
  lights: require('../../../assets/rank-up-neo/sounds/lights.wav'),
  spot: require('../../../assets/rank-up-neo/sounds/spot.wav'),
  lift: require('../../../assets/rank-up-neo/sounds/lift.wav'),
  xp: require('../../../assets/rank-up-neo/sounds/xp.wav'),
  climb0: require('../../../assets/rank-up-neo/sounds/climb0.wav'),
  climb1: require('../../../assets/rank-up-neo/sounds/climb1.wav'),
  climb2: require('../../../assets/rank-up-neo/sounds/climb2.wav'),
  climb3: require('../../../assets/rank-up-neo/sounds/climb3.wav'),
  swing: require('../../../assets/rank-up-neo/sounds/swing.wav'),
  knock: require('../../../assets/rank-up-neo/sounds/knock.wav'),
  zone: require('../../../assets/rank-up-neo/sounds/zone.wav'),
  boom: require('../../../assets/rank-up-neo/sounds/boom.wav'),
  cannon: require('../../../assets/rank-up-neo/sounds/cannon.wav'),
  tick: require('../../../assets/rank-up-neo/sounds/tick.wav'),
  spin: require('../../../assets/rank-up-neo/sounds/spin.wav'),
  launch: require('../../../assets/rank-up-neo/sounds/launch.wav'),
  whoosh: require('../../../assets/rank-up-neo/sounds/whoosh.wav'),
  deck: require('../../../assets/rank-up-neo/sounds/deck.wav'),
  warp: require('../../../assets/rank-up-neo/sounds/warp.wav'),
  tunnel: require('../../../assets/rank-up-neo/sounds/tunnel.wav'),
  rez: require('../../../assets/rank-up-neo/sounds/rez.wav'),
  promote: require('../../../assets/rank-up-neo/sounds/promote.wav'),
  fanfare: require('../../../assets/rank-up-neo/sounds/fanfare.wav'),
};

export type Cue = keyof typeof S;

const VOICES: Partial<Record<Cue, { voices: number; volume: number }>> = {
  tap: { voices: 2, volume: 0.6 },
  pop: { voices: 3, volume: 0.6 },
  drop: { voices: 5, volume: 0.4 },
  cannon: { voices: 2, volume: 0.8 },
  xp: { voices: 2, volume: 0.7 },
  tick: { voices: 3, volume: 0.5 },
  knock: { voices: 2, volume: 0.95 },
  swing: { voices: 2, volume: 0.6 },
  deck: { voices: 2, volume: 0.85 },
};

type Player = ReturnType<typeof createAudioPlayer>;

/** The order the cues are first wanted in, so the players get made in that order */
const FIRST: Cue[] = [
  'swish',
  'drop',
  'lights',
  'spot',
  'lift',
  'climb0',
  'swing',
  'knock',
  'climb1',
  'zone',
  'climb2',
  'climb3',
  'xp',
  'boom',
];

export function useSounds() {
  const players = useRef<Partial<Record<Cue, { list: Player[]; next: number; volume: number }>>>({});
  const made = useRef<Player[]>([]);

  /** Make a cue's players, if they aren't made yet */
  const make = useCallback((cue: Cue) => {
    if (players.current[cue]) return players.current[cue];
    const v = VOICES[cue] ?? { voices: 1, volume: cue.startsWith('climb') ? 0.8 : 0.9 };
    const list: Player[] = [];
    for (let k = 0; k < v.voices; k++) {
      const p = createAudioPlayer(S[cue]);
      list.push(p);
      made.current.push(p);
    }
    return (players.current[cue] = { list, next: 0, volume: v.volume });
  }, []);

  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: false, interruptionMode: 'mixWithOthers' });
    // Made a couple a frame rather than all at once as the screen mounts, which stalled it for
    // a tenth of a second; a cue wanted before its turn is made there and then
    const order = [...FIRST, ...(Object.keys(S) as Cue[]).filter((c) => !FIRST.includes(c))];
    let i = 0;
    let frame = 0;
    const step = () => {
      for (let n = 0; n < 2 && i < order.length; n++) make(order[i++]);
      if (i < order.length) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
      for (const p of made.current) p.remove();
      made.current = [];
      players.current = {};
    };
  }, [make]);

  /** Play a cue, `gain` of its usual loudness */
  return useCallback(
    (cue: Cue, gain = 1) => {
      const set = make(cue);
      const p = set.list[set.next];
      set.next = (set.next + 1) % set.list.length;
      p.volume = set.volume * gain;
      p.seekTo(0);
      p.play();
    },
    [make]
  );
}
