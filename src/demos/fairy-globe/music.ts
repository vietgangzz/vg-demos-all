import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { useCallback, useEffect, useRef } from 'react';

import type { Pitch } from './tune';

/** The music box's notes (scripts/snow_globe_sounds.py), one for each pitch in the tune */
const SOURCES: Record<Pitch, number> = {
  C3: require('../../../assets/fairy-globe/box/C3.wav'),
  F3: require('../../../assets/fairy-globe/box/F3.wav'),
  G3: require('../../../assets/fairy-globe/box/G3.wav'),
  C4: require('../../../assets/fairy-globe/box/C4.wav'),
  D4: require('../../../assets/fairy-globe/box/D4.wav'),
  E4: require('../../../assets/fairy-globe/box/E4.wav'),
  F4: require('../../../assets/fairy-globe/box/F4.wav'),
  G4: require('../../../assets/fairy-globe/box/G4.wav'),
  A4: require('../../../assets/fairy-globe/box/A4.wav'),
  B4: require('../../../assets/fairy-globe/box/B4.wav'),
  C5: require('../../../assets/fairy-globe/box/C5.wav'),
  D5: require('../../../assets/fairy-globe/box/D5.wav'),
  E5: require('../../../assets/fairy-globe/box/E5.wav'),
  F5: require('../../../assets/fairy-globe/box/F5.wav'),
};

/** Two players a note, taken in turn, so a note played twice running rings on under the second */
const VOICES = 2;

/** Plays the music box's notes: returns `play(pitch, bass)` */
export function useMusicBox() {
  const players = useRef<Partial<Record<Pitch, AudioPlayer[]>>>({});
  const turn = useRef<Partial<Record<Pitch, number>>>({});

  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'mixWithOthers' });
    const made: AudioPlayer[] = [];
    for (const [pitch, source] of Object.entries(SOURCES) as [Pitch, number][]) {
      players.current[pitch] = Array.from({ length: VOICES }, () => {
        const p = createAudioPlayer(source);
        made.push(p);
        return p;
      });
    }
    return () => {
      for (const p of made) p.remove();
      players.current = {};
    };
  }, []);

  return useCallback((pitch: Pitch, bass: boolean) => {
    const voices = players.current[pitch];
    if (!voices) return;
    const k = ((turn.current[pitch] ?? -1) + 1) % VOICES;
    turn.current[pitch] = k;
    const p = voices[k];
    p.volume = bass ? 0.55 : 0.9;
    p.seekTo(0);
    p.play();
  }, []);
}
