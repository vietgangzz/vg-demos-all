/**
 * The library: 10,000 songs on 800 albums by 200 artists, made up but the same every launch.
 * Every album has its own artwork, drawn rather than loaded: one of a few kinds of cover, in its
 * own palette.
 */

export type Mood = 'chill' | 'focus' | 'night' | 'workout' | 'sunday' | 'road';

export type Album = {
  id: number;
  title: string;
  artist: string;
  year: number;
  /** Artwork: its colours, light to deep, the kind of cover and a nudge of its own, each -1..1 */
  colours: [string, string, string];
  style: ArtStyle;
  shift: [number, number];
};

/**
 * The kinds of cover, all drawn with shapes and gradients: soft blurred orbs, a striped synthwave
 * sun, rings, seventies stripes, one huge letter, a record with its label
 */
export type ArtStyle = 'orbs' | 'sun' | 'rings' | 'stripes' | 'letter' | 'vinyl';

export type Song = {
  id: string;
  title: string;
  album: Album;
  /** Its place on the album, from 1 */
  track: number;
  seconds: number;
  mood: Mood;
  /** When it was added, as a running number: higher is newer */
  added: number;
};

export const MOODS: { id: Mood; title: string; symbol: string }[] = [
  { id: 'chill', title: 'Chill', symbol: 'leaf' },
  { id: 'focus', title: 'Focus', symbol: 'brain.head.profile' },
  { id: 'night', title: 'Late Night', symbol: 'moon.stars' },
  { id: 'workout', title: 'Workout', symbol: 'figure.run' },
  { id: 'sunday', title: 'Sunday Morning', symbol: 'sun.horizon' },
  { id: 'road', title: 'Road Trip', symbol: 'car' },
];

const PALETTES: [string, string, string][] = [
  ['#FFB199', '#FF5E62', '#7A1F5C'],
  ['#A1FFCE', '#3BD3C6', '#1D5C8C'],
  ['#FBD786', '#F7797D', '#6A3093'],
  ['#C2FFD8', '#5EE7A5', '#0E6B4E'],
  ['#FAD0C4', '#E66FA8', '#5B2A86'],
  ['#FFE29F', '#FFA99F', '#FF719A'],
  ['#9BE7FF', '#4D8BFF', '#2B1E7A'],
  ['#FDEB71', '#F8D800', '#C25E00'],
  ['#E0C3FC', '#8EC5FC', '#3A4FB5'],
  ['#FFC3A0', '#FF7E5F', '#3E1F47'],
  ['#D4FC79', '#96E6A1', '#2F7D6D'],
  ['#F6D365', '#FDA085', '#B23A48'],
  ['#B8F2FF', '#7F7FD5', '#4B1D6B'],
  ['#FFDDE1', '#EE9CA7', '#8E2D56'],
  ['#C9FFBF', '#FFAFBD', '#7B4397'],
  ['#E8E8E8', '#9AA7B8', '#2C3E50'],
];

const FIRST = [
  'Blue',
  'Paper',
  'Slow',
  'Golden',
  'Quiet',
  'Neon',
  'Velvet',
  'Hollow',
  'Silver',
  'Late',
  'Glass',
  'Wild',
  'Soft',
  'Northern',
  'Electric',
  'Salt',
  'Amber',
  'Static',
  'Lucky',
  'Faded',
  'Midnight',
  'Little',
  'Open',
  'Summer',
  'Cold',
  'Honey',
  'Distant',
  'Tidal',
  'Kind',
  'Lost',
];
const SECOND = [
  'Hour',
  'Moons',
  'Static',
  'Weather',
  'Lights',
  'Rivers',
  'Hearts',
  'Signals',
  'Roads',
  'Garden',
  'Fever',
  'Avenue',
  'Mirrors',
  'Echoes',
  'Satellites',
  'Harbour',
  'Dreams',
  'Motel',
  'Parade',
  'Tides',
  'Letters',
  'Coast',
  'Machines',
  'Daydream',
  'Forever',
  'Arcade',
  'Season',
  'Thunder',
  'Window',
  'Sky',
];
const SUFFIX = ['', '', '', '', ' (Reprise)', ' (Live)', ' Pt. II', ' (Acoustic)', ' (Night Mix)', ''];

const ARTIST_A = [
  'Lumen',
  'Nova',
  'The Quiet',
  'Paper',
  'Harbor',
  'June',
  'Velvet',
  'Cobalt',
  'Saint',
  'Arlo',
  'Marlow',
  'Echo',
  'Wren',
  'Atlas',
  'The Lonely',
  'Mira',
  'Juno',
  'Field',
  'Indigo',
  'Tove',
];
const ARTIST_B = ['Hall', '& June', 'Arcades', 'Kites', 'Lights', 'Parade', 'Club', 'Coast', 'Motel', 'Rivers'];

/** A small, fast, seeded random source, so the library is the same every time */
function random(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ALBUMS = 800;
export const SONG_COUNT = 10_000;

function build() {
  const rand = random(58);
  const pick = <T>(list: readonly T[]) => list[Math.floor(rand() * list.length)]!;
  const title = () => `${pick(FIRST)} ${pick(SECOND)}`;

  const artists = Array.from(
    { length: 200 },
    (_, i) => `${ARTIST_A[i % ARTIST_A.length]} ${ARTIST_B[Math.floor(i / ARTIST_A.length) % ARTIST_B.length]}`
  );
  // Records are dark and heavy, so fewer of them
  const styles: ArtStyle[] = [
    'orbs',
    'orbs',
    'sun',
    'sun',
    'rings',
    'rings',
    'stripes',
    'stripes',
    'letter',
    'letter',
    'vinyl',
  ];
  const albums: Album[] = Array.from({ length: ALBUMS }, (_, id) => ({
    id,
    title: title(),
    artist: pick(artists),
    year: 1994 + Math.floor(rand() * 32),
    colours: pick(PALETTES),
    style: pick(styles),
    shift: [rand() * 2 - 1, rand() * 2 - 1],
  }));

  const moods = MOODS.map((m) => m.id);
  const songs: Song[] = [];
  for (let i = 0; i < SONG_COUNT; i++) {
    const album = albums[Math.floor(i / (SONG_COUNT / ALBUMS))]!;
    songs.push({
      id: `s${i}`,
      title: `${title()}${pick(SUFFIX)}`,
      album,
      track: (i % (SONG_COUNT / ALBUMS)) + 1,
      seconds: 128 + Math.floor(rand() * 190),
      mood: pick(moods),
      added: Math.floor(rand() * 1_000_000),
    });
  }
  return songs;
}

export const SONGS: readonly Song[] = build();

export type Order = 'title' | 'artist' | 'added';

const byTitle = [...SONGS].sort((a, b) => a.title.localeCompare(b.title));
const byArtist = [...SONGS].sort(
  (a, b) => a.album.artist.localeCompare(b.album.artist) || a.album.id - b.album.id || a.track - b.track
);
const byAdded = [...SONGS].sort((a, b) => b.added - a.added);

/** The whole library in one order, sorted once up front */
export function inOrder(order: Order): readonly Song[] {
  return order === 'title' ? byTitle : order === 'artist' ? byArtist : byAdded;
}

export function clock(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
