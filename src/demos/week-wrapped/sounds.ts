import type { Cue } from '../rank-up/sounds';

/** Rank Up's sounds, made from scratch (scripts/rank_up_sounds.py) */
export { type Cue, useSounds } from '../rank-up/sounds';

export type Play = (cue: Cue, gain?: number) => void;
