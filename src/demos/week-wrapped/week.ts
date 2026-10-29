/**
 * The week as it happened on Silver's board, and the story's clock: everyone's XP through each day,
 * played back a day every couple of seconds, going into slow motion for Sunday's last minutes. Who
 * passes whom, and when, falls out of the numbers.
 */

/** The players, in BOARD order (rank-up/data.ts), and which one is you */
const ME = 4;
export { ME };

export const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
export const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const DATES = ['OCT 20', 'OCT 21', 'OCT 22', 'OCT 23', 'OCT 24', 'OCT 25', 'OCT 26'];

/** Each one's XP at the start of the week and the end of each day */
const DAILY = [
  [0, 320, 640, 900, 1150, 1420, 1700, 1880], // Mina
  [0, 260, 560, 780, 1080, 1300, 1560, 1790], // Kenji
  [0, 210, 420, 700, 930, 1240, 1500, 1745], // Lucía
  [0, 300, 520, 640, 855, 1100, 1380, 1690], // Theo
  [0, 180, 440, 560, 870, 1260, 1635, 1935], // You
  [0, 150, 380, 620, 810, 1010, 1240, 1520], // Ama
  [0, 230, 460, 590, 713, 990, 1230, 1475], // Rafael
  [0, 120, 300, 480, 690, 900, 1150, 1390], // Priya
];
const XP = DAILY.flat();
/**
 * Sunday, when in the day each one does their lessons: above 1 late (the higher, the later), below
 * -1 early. Mina gets hers done in the morning; you leave yours till late. Every other day goes
 * evenly, so two people pass each other at most once a day.
 */
const SUNDAY_HABIT = [-1.6, 1, 1, 1, 2.4, 1, 1, 1];
export const PLAYERS = DAILY.length;

/** Player i's XP `p` days into the week (0 to 7) */
export const xpOf = (i: number, p: number) => {
  'worklet';
  const q = Math.min(7, Math.max(0, p));
  const d = Math.min(6, Math.floor(q));
  const s = q - d;
  const h = d === 6 ? SUNDAY_HABIT[i] : 1;
  const g = h > 0 ? Math.pow(s, h) : 1 - Math.pow(1 - s, -h);
  const a = XP[i * 8 + d];
  return a + (XP[i * 8 + d + 1] - a) * g;
};

/**
 * Everyone's place on the board (0 on top) `p` days in. Ties (everyone on 0, first thing Monday) go
 * to whoever's about to pull ahead, so Monday morning already stands as Monday plays out.
 */
export function placesAt(p: number) {
  const xp = DAILY.map((_, i) => xpOf(i, p));
  const order = DAILY.map((_, i) => i).sort((a, b) => xp[b] - xp[a] || DAILY[b][1] - DAILY[a][1]);
  const place = new Array<number>(PLAYERS);
  order.forEach((i, k) => (place[i] = k));
  return place;
}

/** The time on Sunday night's (or any day's) clock `p` days in, the evenings drawn out */
export function stamp(p: number) {
  const q = Math.min(6.9999, Math.max(0, p));
  const d = Math.floor(q);
  const s = q - d;
  const mins = Math.round(6 * 60 + (18 * 60 - 1) * (1 - Math.pow(1 - s, 1.6)));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return { day: DAYS[d], date: DATES[d], time: `${h12}:${String(m).padStart(2, '0')} ${ampm}` };
}

// ---- The replay's clock ----

/**
 * The story's clock: a breath on Monday morning, then a day every `day` seconds, Sunday slowing right
 * down from `slowFrom` days in. (The screen opens at the story's end and winds it back to Monday
 * before playing it: see index.tsx.)
 */
export const REPLAY = {
  play: 0.8,
  day: 1.9,
  slowFrom: 6.72,
  slowFor: 2.8,
};
const R = REPLAY;
export const SUNDAY = R.play + 6 * R.day;
export const SLOW = SUNDAY + (R.slowFrom - 6) * R.day;
export const STILL = SLOW + R.slowFor;

/** How many days into the week the story is at `t`, 0 to 7 */
export const dayAt = (t: number) => {
  'worklet';
  if (t < R.play) return 0;
  if (t < SLOW) return (t - R.play) / R.day;
  const k = Math.min(1, (t - SLOW) / R.slowFor);
  return R.slowFrom + (7 - R.slowFrom) * (1 - (1 - k) * (1 - k));
};

/** When day d starts playing */
export const dayStart = (d: number) => R.play + d * R.day;

// ---- What happens, worked out once from the numbers ----

/** How long a row takes to move a place */
export const MOVE = 0.34;

type Move = { at: number; by: number };

function work() {
  const step = 1 / 240;
  let last = placesAt(dayAt(0));
  const start = last.slice();
  const moves: Move[][] = DAILY.map(() => []);
  /** You passing someone (k: who), someone passing you, and the first time you're in the top three */
  const kicks: { at: number; who: number }[] = [];
  const bumps: number[] = [];
  const ticks: { at: number; day: number }[] = [];
  let zone = -1;
  let lastDay = 0;
  for (let t = step; t < STILL + 0.5; t += step) {
    const p = dayAt(t);
    const now = placesAt(p);
    for (let i = 0; i < PLAYERS; i++) if (now[i] !== last[i]) moves[i].push({ at: t, by: now[i] - last[i] });
    const playing = t > R.play;
    if (playing && now[ME] < last[ME]) {
      for (let i = 0; i < PLAYERS; i++)
        if (i !== ME && now[i] > last[i] && last[i] < last[ME]) kicks.push({ at: t, who: i });
    }
    if (playing && now[ME] > last[ME]) bumps.push(t);
    if (playing && zone < 0 && now[ME] < 3) zone = t;
    const day = Math.floor(Math.min(6.9999, p));
    if (day !== lastDay) ticks.push({ at: t, day });
    lastDay = day;
    last = now;
  }
  return { start, moves, kicks, bumps, zone, ticks };
}

const worked = work();

/** Where each one stands first thing Monday */
export const START = worked.start;
/** Each one's moves up or down the board: when, and by how many places */
export const MOVE_AT = worked.moves.map((m) => m.map((x) => x.at));
export const MOVE_BY = worked.moves.map((m) => m.map((x) => x.by));
/** Each time you pass someone: when your leg connects, and who it boots */
export const KICK_AT = worked.kicks.map((k) => k.at + MOVE * 0.3);
export const KICK_WHO = worked.kicks.map((k) => k.who);
/** Each time someone passes you */
export const BUMP_AT = worked.bumps;
/** When you first make the top three */
export const ZONE_AT = worked.zone;
/** Each day's line crossed */
export const DAY_TICKS = worked.ticks;
/** The last kick, Sunday night, that takes you to the top */
export const FINAL = KICK_AT[KICK_AT.length - 1];

/** Where player i is on the board at `t` (fractional while moving) */
export const placeOf = (i: number, t: number) => {
  'worklet';
  let s = START[i];
  const at = MOVE_AT[i];
  const by = MOVE_BY[i];
  for (let k = 0; k < at.length; k++) {
    const e = Math.min(1, Math.max(0, (t - at[k]) / MOVE));
    s += by[k] * (e < 1 ? 1 - Math.pow(1 - e, 3) : 1);
  }
  return s;
};
