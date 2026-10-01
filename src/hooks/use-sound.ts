import { setAudioModeAsync, useAudioPlayer, type AudioSource } from 'expo-audio';
import { useCallback } from 'react';

let audioModeConfigured = false;

/** Short UI sound effect. Returns a `play` function that restarts the sound each call. */
export function useSound(source: AudioSource) {
  const player = useAudioPlayer(source);

  return useCallback(() => {
    if (!audioModeConfigured) {
      audioModeConfigured = true;
      setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'mixWithOthers' });
    }
    player.seekTo(0);
    player.play();
  }, [player]);
}
