import { useEffect, useReducer, useSyncExternalStore } from 'react';

import type { Song } from './songs';

/**
 * What's playing, kept outside React so the clock ticking only re-renders what shows the time,
 * never the list.
 */
type State = {
  song: Song | null;
  playing: boolean;
  /** Seconds into the song when it last started or paused */
  offset: number;
  /** When it last started, while it plays */
  since: number;
  /** Songs to play next, before carrying on down the list */
  queue: Song[];
  /** The list it was played from, to carry on down */
  from: readonly Song[];
};

let state: State = { song: null, playing: false, offset: 0, since: 0, queue: [], from: [] };
const listeners = new Set<() => void>();

function set(next: Partial<State>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function elapsed() {
  return state.playing ? state.offset + (Date.now() - state.since) / 1000 : state.offset;
}

export const playback = {
  play(song: Song, from: readonly Song[]) {
    set({ song, from, playing: true, offset: 0, since: Date.now() });
  },
  toggle() {
    if (!state.song) return;
    set(state.playing ? { playing: false, offset: elapsed() } : { playing: true, since: Date.now() });
  },
  seek(seconds: number) {
    set({ offset: seconds, since: Date.now() });
  },
  playNext(song: Song) {
    if (!state.song) set({ song, from: [song], playing: true, offset: 0, since: Date.now() });
    else set({ queue: [song, ...state.queue] });
  },
  next() {
    const [queued, ...rest] = state.queue;
    if (queued) return set({ song: queued, queue: rest, offset: 0, since: Date.now() });
    const at = state.song ? state.from.indexOf(state.song) : -1;
    const following = state.from[at + 1] ?? state.from[0];
    if (following) set({ song: following, offset: 0, since: Date.now() });
  },
  previous() {
    if (elapsed() > 3) return set({ offset: 0, since: Date.now() });
    const at = state.song ? state.from.indexOf(state.song) : -1;
    const before = state.from[at - 1];
    if (before) set({ song: before, offset: 0, since: Date.now() });
    else set({ offset: 0, since: Date.now() });
  },
};

export function usePlayback() {
  return useSyncExternalStore(subscribe, () => state);
}

/** Seconds into the song, ticking while it plays; moves on to the next song at the end */
export function useElapsed() {
  const { song, playing, offset, since } = usePlayback();
  // The time is read when the clock ticks, not while rendering: a render that reads the clock
  // would be cached by the compiler and stand still
  const [now, tick] = useReducer(elapsed, 0, elapsed);
  useEffect(() => {
    tick();
    if (!playing || !song) return;
    const timer = setInterval(() => {
      if (elapsed() >= song.seconds) playback.next();
      else tick();
    }, 250);
    return () => clearInterval(timer);
  }, [song, playing, offset, since]);
  return Math.min(now, song?.seconds ?? 0);
}
