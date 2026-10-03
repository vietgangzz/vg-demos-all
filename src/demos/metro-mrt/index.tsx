import { MUSIC_START } from '@/demos/metro-live/cinematic';
import MetroLive from '@/demos/metro-live';

/**
 * The rain run cut to the music: Start opens the storm at the moment the song comes in (your
 * train's pin reading "0:55" in the full run), so start the song on the press and the lightning
 * lands on its bass hits.
 */
export default function MetroMrt() {
  return <MetroLive cinematic weather="storm" skip={MUSIC_START} />;
}
