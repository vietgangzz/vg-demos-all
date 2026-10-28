import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { useCallback, useEffect, useMemo, useRef } from 'react';

/**
 * The sounds (made from scratch, scripts/daily_drop_sounds.py): a few players for the ones that
 * overlap, the vault's hum looping under it all, and two loops while it's held: the orb's charge,
 * sung higher as it fills (played faster, unpitched, so its pitch rises with it), and the chains
 * rattling, louder and faster. Let go early and they sag back down with the charge. They follow the
 * ring/silent switch.
 */

export type Cue =
  | 'dive'
  | 'unlock'
  | 'impact'
  | 'chains'
  | 'erupt'
  | 'clink'
  | 'clank'
  | 'tink'
  | 'coin'
  | 'rewind'
  | 'rise'
  | 'breath'
  | 'spin'
  | 'flip'
  | 'reveal'
  | 'legendary'
  | 'levelup'
  | 'stamp'
  | 'close';

const S = {
  dive: require('../../../assets/daily-drop/sounds/dive.wav'),
  unlock: require('../../../assets/daily-drop/sounds/unlock.wav'),
  impact: require('../../../assets/daily-drop/sounds/impact.wav'),
  chains: require('../../../assets/daily-drop/sounds/chains.wav'),
  erupt: require('../../../assets/daily-drop/sounds/erupt.wav'),
  clink1: require('../../../assets/daily-drop/sounds/clink1.wav'),
  clink2: require('../../../assets/daily-drop/sounds/clink2.wav'),
  clink3: require('../../../assets/daily-drop/sounds/clink3.wav'),
  clank: require('../../../assets/daily-drop/sounds/clank.wav'),
  tink: require('../../../assets/daily-drop/sounds/tink.wav'),
  coin1: require('../../../assets/daily-drop/sounds/coin1.wav'),
  coin2: require('../../../assets/daily-drop/sounds/coin2.wav'),
  coin3: require('../../../assets/daily-drop/sounds/coin3.wav'),
  rewind: require('../../../assets/daily-drop/sounds/rewind.wav'),
  rise: require('../../../assets/daily-drop/sounds/rise.wav'),
  breath: require('../../../assets/daily-drop/sounds/breath.wav'),
  spin: require('../../../assets/daily-drop/sounds/spin.wav'),
  flip: require('../../../assets/daily-drop/sounds/flip.wav'),
  reveal: require('../../../assets/daily-drop/sounds/reveal.wav'),
  legendary: require('../../../assets/daily-drop/sounds/legendary.wav'),
  levelup: require('../../../assets/daily-drop/sounds/levelup.wav'),
  stamp: require('../../../assets/daily-drop/sounds/stamp.wav'),
  close: require('../../../assets/daily-drop/sounds/close.wav'),
  charge: require('../../../assets/daily-drop/sounds/charge.wav'),
  rattle: require('../../../assets/daily-drop/sounds/rattle.wav'),
  vault: require('../../../assets/daily-drop/sounds/vault.wav'),
};

const VOICES: Record<Cue, { sources: number[]; voices: number; volume: number }> = {
  dive: { sources: [S.dive], voices: 1, volume: 0.85 },
  unlock: { sources: [S.unlock], voices: 1, volume: 0.9 },
  impact: { sources: [S.impact], voices: 1, volume: 1 },
  chains: { sources: [S.chains], voices: 1, volume: 0.8 },
  erupt: { sources: [S.erupt], voices: 1, volume: 0.85 },
  clink: { sources: [S.clink1, S.clink2, S.clink3], voices: 2, volume: 0.5 },
  clank: { sources: [S.clank], voices: 4, volume: 0.55 },
  tink: { sources: [S.tink], voices: 2, volume: 0.5 },
  coin: { sources: [S.coin1, S.coin2, S.coin3], voices: 2, volume: 0.45 },
  rewind: { sources: [S.rewind], voices: 1, volume: 0.85 },
  rise: { sources: [S.rise], voices: 1, volume: 0.8 },
  breath: { sources: [S.breath], voices: 1, volume: 0.9 },
  spin: { sources: [S.spin], voices: 2, volume: 0.5 },
  flip: { sources: [S.flip], voices: 2, volume: 0.7 },
  reveal: { sources: [S.reveal], voices: 2, volume: 0.7 },
  legendary: { sources: [S.legendary], voices: 1, volume: 0.9 },
  levelup: { sources: [S.levelup], voices: 1, volume: 0.85 },
  stamp: { sources: [S.stamp], voices: 1, volume: 0.9 },
  close: { sources: [S.close], voices: 1, volume: 0.8 },
};

type Player = ReturnType<typeof createAudioPlayer>;

export function useSounds() {
  const players = useRef<Partial<Record<Cue, { list: Player[]; next: number }>>>({});
  const loops = useRef<{ charge: Player; rattle: Player; on: boolean } | null>(null);
  const quiet = __DEV__ && !!(globalThis as { dailyDropQuiet?: boolean }).dailyDropQuiet;

  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: false, interruptionMode: 'mixWithOthers' });
    const made: Player[] = [];
    for (const [cue, v] of Object.entries(VOICES) as [Cue, (typeof VOICES)[Cue]][]) {
      const list: Player[] = [];
      // Voice by voice, so playing them in turn goes through the variations
      for (let k = 0; k < v.voices; k++) {
        for (const source of v.sources) {
          const p = createAudioPlayer(source);
          p.volume = v.volume;
          list.push(p);
          made.push(p);
        }
      }
      players.current[cue] = { list, next: 0 };
    }
    const loop = (source: number) => {
      const p = createAudioPlayer(source);
      p.loop = true;
      p.shouldCorrectPitch = false;
      made.push(p);
      return p;
    };
    loops.current = { charge: loop(S.charge), rattle: loop(S.rattle), on: false };
    const hum = loop(S.vault);
    hum.volume = quiet ? 0 : 0.35;
    if (!quiet) hum.play();
    return () => {
      for (const p of made) p.remove();
      players.current = {};
      loops.current = null;
    };
  }, [quiet]);

  /** Play a cue, `gain` of its usual loudness */
  const play = useCallback(
    (cue: Cue, gain = 1) => {
      const set = players.current[cue];
      if (!set || quiet) return;
      const p = set.list[set.next];
      set.next = (set.next + 1) % set.list.length;
      p.volume = VOICES[cue].volume * gain;
      p.seekTo(0);
      p.play();
    },
    [quiet]
  );

  /** The hold, 0 to 1: the charge and the rattle, higher and harder the further it's got; 0, stopped */
  const hold = useCallback(
    (c: number) => {
      const l = loops.current;
      if (!l || quiet) return;
      if (c <= 0.002) {
        if (l.on) {
          l.charge.pause();
          l.rattle.pause();
          l.on = false;
        }
        return;
      }
      l.charge.setPlaybackRate(0.62 + c * 1.0);
      l.charge.volume = 0.3 + 0.6 * c;
      l.rattle.setPlaybackRate(0.75 + c * 0.7);
      l.rattle.volume = 0.08 + 0.8 * c * c;
      if (!l.on) {
        l.on = true;
        l.charge.seekTo(0);
        l.charge.play();
        l.rattle.play();
      }
    },
    [quiet]
  );

  return useMemo(() => ({ play, hold }), [play, hold]);
}
