/**
 * The music box's tune: Silent Night (Franz Gruber, 1818), the whole of it round the globe once. Each
 * note is pinned at a place round the turn, the way the pins sit on a music box's cylinder, so the
 * tune plays as the globe turns, as fast or as slowly as it's turned.
 *
 * In eighths (6/8, a bar is six), each note: where it starts and its pitch. A bass note on the
 * first beat of most bars, an octave down, the way a small comb carries a little harmony.
 */

export const PITCHES = ['C3', 'F3', 'G3', 'C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5', 'D5', 'E5', 'F5'] as const;
export type Pitch = (typeof PITCHES)[number];

type Bar = [number, Pitch][];

// Note lengths in eighths, per bar
const MELODY: Bar[] = [
  [[1.5, 'G4'], [0.5, 'A4'], [1, 'G4'], [3, 'E4']],
  [[1.5, 'G4'], [0.5, 'A4'], [1, 'G4'], [3, 'E4']],
  [[2, 'D5'], [1, 'D5'], [3, 'B4']],
  [[2, 'C5'], [1, 'C5'], [3, 'G4']],
  [[2, 'A4'], [1, 'A4'], [1.5, 'C5'], [0.5, 'B4'], [1, 'A4']],
  [[1.5, 'G4'], [0.5, 'A4'], [1, 'G4'], [3, 'E4']],
  [[2, 'A4'], [1, 'A4'], [1.5, 'C5'], [0.5, 'B4'], [1, 'A4']],
  [[1.5, 'G4'], [0.5, 'A4'], [1, 'G4'], [3, 'E4']],
  [[2, 'D5'], [1, 'D5'], [1.5, 'F5'], [0.5, 'D5'], [1, 'B4']],
  [[3, 'C5'], [3, 'E5']],
  [[1.5, 'C5'], [0.5, 'G4'], [1, 'E4'], [1.5, 'G4'], [0.5, 'F4'], [1, 'D4']],
  [[6, 'C4']],
];
const BASS: (Pitch | null)[] = ['C3', 'C3', 'G3', 'C3', 'F3', 'C3', 'F3', 'C3', 'G3', 'C3', 'C3', 'C3'];

export type Note = { at: number; pitch: Pitch; bass: boolean };

/** Every note, its place round the turn from 0 to 1 */
export const NOTES: Note[] = (() => {
  const out: Note[] = [];
  const total = MELODY.length * 6;
  MELODY.forEach((bar, b) => {
    let t = b * 6;
    const bass = BASS[b];
    if (bass) out.push({ at: t / total, pitch: bass, bass: true });
    for (const [len, pitch] of bar) {
      out.push({ at: t / total, pitch, bass: false });
      t += len;
    }
  });
  return out.sort((a, b) => a.at - b.at);
})();

/** The notes passed going from one place round the turn to another (both as turns, forward only) */
export function notesBetween(from: number, to: number) {
  const hits: Note[] = [];
  if (to <= from) return hits;
  // At most once round: a wild flick still only plays each note once
  const span = Math.min(1, to - from);
  const start = from - Math.floor(from);
  for (const n of NOTES) {
    let at = n.at;
    if (at <= start) at += 1;
    if (at <= start + span) hits.push(n);
  }
  return hits;
}
