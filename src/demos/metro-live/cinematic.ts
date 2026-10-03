/**
 * The showcase run (Metro · Line 1 Showcase Run): your train leaves Suối Tiên for Bến Thành at
 * its real speed, with the camera directed by where the train is. Station stops are shortened
 * (DWELL_WARP). The run goes all the way; a take is however long the recording is.
 *
 * Shots are keyed by station position (13 = Suối Tiên … 0 = Bến Thành, fractions in between),
 * not by time, so every move of the camera rides on a move of the train. Between keys the
 * values blend smoothly; scene.ts then eases the camera towards them.
 */

/** Seconds from the press of Start until the train pulls out */
export const CINEMATIC_COUNTDOWN = 2;
/** Station stops run this much faster than the timetable: the 5 s stop lasts 2 s */
export const DWELL_WARP = 2.5;

export type Shot = {
  /** Station position: 13 = Suối Tiên, 0 = Bến Thành */
  at: number;
  /** Camera distance in zoom units (58 units of scene per zoom) */
  zoom: number;
  /** Camera elevation, radians */
  pitch: number;
  /** Camera angle around the train, radians: 0 = right behind it, ±π/2 = beside, π = ahead */
  side: number;
  /** 0 frames the train, 1 frames Chợ Bến Thành */
  market: number;
  /** Units the framing is raised above the train, to fit a tall skyline behind it (default 0) */
  rise?: number;
};

// The first stretch, Suối Tiên to Đại học Quốc gia (about 37 s at real speed), is keyed closely;
// the rest of the line keeps a calm chase. After the opening close-up the camera sits just far
// enough back to frame the whole train, always on its outer side (negative side: running towards
// Bến Thành the train keeps to its right, so the other track lies beyond it and no oncoming train
// ever passes in front), and drifts round slowly.
const SHOTS: Shot[] = [
  // Suối Tiên: close and low beside the train at the platform, the bus station's vault behind it
  { at: 13, zoom: 0.5, pitch: 0.34, side: -1.9, market: 0 },
  // Pulling out: rise and ease back until the whole train is in frame
  { at: 12.95, zoom: 0.8, pitch: 0.44, side: -1.7, market: 0 },
  { at: 12.7, zoom: 1.15, pitch: 0.54, side: -1.2, market: 0 },
  // A higher chase along the viaduct
  { at: 12.45, zoom: 1.25, pitch: 0.64, side: -0.75, market: 0 },
  // Swing back out beside it as it nears the university
  { at: 12.25, zoom: 1.15, pitch: 0.54, side: -1.3, market: 0 },
  { at: 12.1, zoom: 1.05, pitch: 0.48, side: -1.7, market: 0 },
  // Đại học Quốc gia: beside the platform, the whole train alongside it
  { at: 12, zoom: 0.95, pitch: 0.46, side: -1.9, market: 0 },
  { at: 11.8, zoom: 1.15, pitch: 0.52, side: -1.6, market: 0 },
  // Hi-Tech Park, Thủ Đức and on into the city
  { at: 11, zoom: 1.3, pitch: 0.58, side: -0.9, market: 0 },
  { at: 10, zoom: 1, pitch: 0.48, side: -1.6, market: 0 },
  { at: 7, zoom: 1.1, pitch: 0.5, side: -1.6, market: 0 },
  { at: 5, zoom: 1, pitch: 0.46, side: -2.1, market: 0 },
  { at: 3, zoom: 1.05, pitch: 0.5, side: -1.2, market: 0 },
  // The tunnel: high, the train shows through the streets
  { at: 1.6, zoom: 1.4, pitch: 0.95, side: -0.5, market: 0 },
  { at: 0.4, zoom: 1.3, pitch: 0.88, side: -0.4, market: 0.15 },
  // Bến Thành: pull out until the market sits beside the station
  { at: 0, zoom: 2.2, pitch: 0.7, side: -0.6, market: 0.6 },
];

const smooth = (t: number) => t * t * (3 - 2 * t);

// The river run (Metro · Line 1 River Run): from Thảo Điền in District 2 over the Saigon River
// beside Cầu Sài Gòn into Tân Cảng, Landmark 81 straight ahead. The camera rides close behind
// the train, just off its outer side, so the tower grows in front of it; an outbound train passes
// on the other track over the river (scene.ts).
const RIVER_SHOTS: Shot[] = [
  // Thảo Điền: close and low beside the train at the platform
  { at: 5, zoom: 0.5, pitch: 0.34, side: -1.9, market: 0 },
  // Pulling out: ease round behind the train
  { at: 4.85, zoom: 0.75, pitch: 0.3, side: -1.2, market: 0, rise: 1 },
  // Along Xa lộ Hà Nội: low behind, Landmark 81 ahead (it lies ~40° off the line here, so the
  // camera sits that far round to put the tower straight beyond the train)
  { at: 4.6, zoom: 1.0, pitch: 0.16, side: -0.85, market: 0, rise: 3.5 },
  // Over the Saigon River: the tower filling the view ahead, the oncoming train passing
  { at: 4.32, zoom: 1.1, pitch: 0.14, side: -0.72, market: 0, rise: 4.5 },
  { at: 4.12, zoom: 1.0, pitch: 0.17, side: -0.55, market: 0, rise: 3.5 },
  // Into Tân Cảng beside Landmark 81
  { at: 4, zoom: 0.8, pitch: 0.3, side: -1.2, market: 0, rise: 1 },
  { at: 3.6, zoom: 1.0, pitch: 0.42, side: -0.8, market: 0 },
  // On towards Văn Thánh
  { at: 3, zoom: 0.8, pitch: 0.42, side: -1.4, market: 0 },
  { at: 2, zoom: 1.2, pitch: 0.6, side: -0.7, market: 0 },
];

/** Camera values at station position `at`, blended between the two surrounding shots */
export function shotAt(at: number, river = false): Shot {
  const keys = river ? RIVER_SHOTS : SHOTS;
  // Keys run down the line (13 → 0) for the inbound runs, up it for the outbound river run
  const down = keys[0].at > keys[keys.length - 1].at;
  const before = (k: Shot) => (down ? k.at >= at : k.at <= at);
  if (!before(keys[0])) return keys[0];
  if (before(keys[keys.length - 1])) return keys[keys.length - 1];
  let i = 0;
  while (before(keys[i + 1])) i++;
  const a = keys[i];
  const b = keys[i + 1];
  const t = smooth((at - a.at) / (b.at - a.at));
  const mix = (x: number, y: number) => x + (y - x) * t;
  return {
    at,
    zoom: Math.exp(mix(Math.log(a.zoom), Math.log(b.zoom))),
    pitch: mix(a.pitch, b.pitch),
    side: mix(a.side, b.side),
    market: mix(a.market, b.market),
    rise: mix(a.rise ?? 0, b.rise ?? 0),
  };
}

// ---- The rain run (Metro · Line 1 Rain Run), cut to "MRT" (Tinh Hà "Say Hi") ----------------
// One minute from the first chorus, keyed by seconds since Start (press Start on the chorus's
// first word). The train waits at the Suối Tiên platform through the first half of the chorus
// and pulls out on its departing-train line (RAIN_HOLD); the weather only ever builds, from a
// sunset to a storm, rain first and then the wind:
//   0–15 s   first half of the chorus      the last sun at the platform, still air
//   15 s     the departing-train line      the train rolls out under a dry, darkening sky
//   15–31 s  second half of the chorus     clouds over the sun, the first drops
//   31–45 s  violin solo                   the rain sets in, then the wind and yellow leaves
//   45–60 s  into the rap (tears)          a full storm

/** The song-timed runs go at 0.75× the timetable (about real speed): an unhurried train */
export const RAIN_RUN_SPEED = 0.75;
/** Seconds after Start the rain run's train leaves Suối Tiên: the chorus's departing-train line */
export const RAIN_HOLD = 15;

export type Weather = {
  /** Seconds since Start */
  t: number;
  /** 0..1 warm low sun */
  sunset: number;
  /** 0..1 overcast: grey sky, dim sun, closer fog */
  cloud: number;
  /** 0..1: trees sway, rain leans */
  wind: number;
  /** 0..1 rain streaks and drops on the water */
  rain: number;
  /** 0..1 towards night: windows, lamps and the train's lights come on */
  night: number;
  /** 0..1 of the autumn leaves in the air */
  leaves: number;
};

const STORM: Weather[] = [
  // "Cả đời này anh nợ em lời xin lỗi": the last of the sun at the platform, still air
  { t: 0, sunset: 1, cloud: 0, wind: 0.1, rain: 0, night: 0, leaves: 0 },
  { t: 12, sunset: 1, cloud: 0.1, wind: 0.15, rain: 0, night: 0, leaves: 0 },
  // "Đoàn tàu lăn bánh…": the train pulls out under a dry, darkening sky
  { t: 18, sunset: 0.88, cloud: 0.3, wind: 0.2, rain: 0, night: 0.02, leaves: 0 },
  // "…về nơi ánh dương ngập tràn": the sun slips behind cloud, the first drops
  { t: 25, sunset: 0.6, cloud: 0.62, wind: 0.3, rain: 0.25, night: 0.08, leaves: 0 },
  // Violin solo: the rain sets in
  { t: 32, sunset: 0.25, cloud: 0.9, wind: 0.5, rain: 0.85, night: 0.18, leaves: 0.05 },
  // …and then the wind: gusts tear yellow leaves off the trees
  { t: 39, sunset: 0.05, cloud: 1, wind: 1.05, rain: 1.1, night: 0.25, leaves: 0.7 },
  // The rap: tears for an answer, a full storm
  { t: 47, sunset: 0, cloud: 1, wind: 1.35, rain: 1.4, night: 0.32, leaves: 1 },
  { t: 62, sunset: 0, cloud: 1, wind: 1.6, rain: 1.6, night: 0.45, leaves: 0.75 },
];

// The autumn morning run (Metro · Line 1 Autumn Morning): the same take in daylight. A bright,
// still morning that clouds over while the train runs, then a soft shower; no storm, no night.
const MORNING: Weather[] = [
  { t: 0, sunset: 0, cloud: 0, wind: 0.08, rain: 0, night: 0, leaves: 0 },
  { t: 18, sunset: 0, cloud: 0.12, wind: 0.12, rain: 0, night: 0, leaves: 0 },
  // The sky greys over as the train runs
  { t: 27, sunset: 0, cloud: 0.4, wind: 0.25, rain: 0.1, night: 0, leaves: 0 },
  // A morning shower
  { t: 35, sunset: 0, cloud: 0.55, wind: 0.35, rain: 0.55, night: 0, leaves: 0 },
  { t: 46, sunset: 0, cloud: 0.62, wind: 0.45, rain: 0.75, night: 0, leaves: 0 },
  { t: 62, sunset: 0, cloud: 0.6, wind: 0.4, rain: 0.7, night: 0, leaves: 0 },
];

// The river run: a clear autumn morning throughout
const CLEAR: Weather[] = [
  { t: 0, sunset: 0, cloud: 0, wind: 0.1, rain: 0, night: 0, leaves: 0 },
  { t: 60, sunset: 0, cloud: 0.08, wind: 0.15, rain: 0, night: 0, leaves: 0 },
];

/**
 * Where the music sits in the storm run: the edit starts the song at the frame your train's pin
 * reads "0:55", which is MUSIC_START seconds after Start (found by matching that take's flashes
 * to the old lightning schedule: all eleven landed exactly 35.4 s apart).
 */
export const MUSIC_START = 35.4;
/**
 * The song's strongest sub-bass hits, in seconds into the music (onsets under 90 Hz, 125 BPM,
 * the big kick on the downbeat of each bar, 1.92 s apart, where the stressed word lands, like "anh"
 * in "Cả đời này anh…"; 7.37 + 7.64 is the double hit). One flash on each.
 */
const BASS_HITS = [1.86, 3.79, 5.71, 7.37, 7.64, 9.55, 11.47, 13.39, 15.32, 17.24, 19.17, 21.09, 23.0, 24.93, 26.85];
const STORM_LIGHTNING = BASS_HITS.map((t) => MUSIC_START + t);

export type WeatherPreset = 'storm' | 'morning' | 'clear';
const PRESETS: Record<WeatherPreset, { keys: Weather[]; lightning: number[] }> = {
  // Lightning on the song's bass hits, measured from a take cut to the music (mrt2.mp4)
  storm: { keys: STORM, lightning: STORM_LIGHTNING },
  morning: { keys: MORNING, lightning: [] },
  clear: { keys: CLEAR, lightning: [] },
};

/** Seconds since Start of each lightning flash in `preset` */
export function lightningOf(preset: WeatherPreset) {
  return PRESETS[preset].lightning;
}

/** Weather at `t` seconds since Start, blended smoothly between the keys */
export function weatherAt(t: number, preset: WeatherPreset = 'storm'): Weather {
  const keys = PRESETS[preset].keys;
  if (t <= keys[0].t) return keys[0];
  const last = keys[keys.length - 1];
  if (t >= last.t) return last;
  let i = 0;
  while (keys[i + 1].t < t) i++;
  const a = keys[i];
  const b = keys[i + 1];
  const k = smooth((t - a.t) / (b.t - a.t));
  const mix = (x: number, y: number) => x + (y - x) * k;
  return {
    t,
    sunset: mix(a.sunset, b.sunset),
    cloud: mix(a.cloud, b.cloud),
    wind: mix(a.wind, b.wind),
    rain: mix(a.rain, b.rain),
    night: mix(a.night, b.night),
    leaves: mix(a.leaves, b.leaves),
  };
}

// ---- Rain run camera: a few long shots cut to the song, keyed by seconds since Start ----------
// Each shot holds for a whole phrase and only drifts (a slow pan or dolly, the orbit never faster
// than ~0.05 rad/s), so the camera moves like a film camera instead of reacting to every curve. Towers passing between the camera and
// the train are left in: the train slipping behind buildings and out again is part of the shot.
const RAIN_SHOTS: (Omit<Shot, 'at'> & { t: number })[] = [
  // "Cả đời này…": close and low at the Suối Tiên platform, the bus station's vault behind
  { t: 0, zoom: 0.5, pitch: 0.34, side: -1.95, market: 0 },
  // A slow push in along the platform through the first half of the chorus
  { t: 14, zoom: 0.44, pitch: 0.32, side: -1.8, market: 0 },
  // The departing-train line: the camera holds while the train pulls away, then eases back
  { t: 19, zoom: 0.6, pitch: 0.36, side: -1.6, market: 0 },
  // "…về nơi ánh dương": rise into a wide sunset vista over the viaduct
  { t: 31, zoom: 1.35, pitch: 0.56, side: -1.1, market: 0 },
  // Violin solo: settle lower beside the train as the rain sets in
  { t: 41, zoom: 0.95, pitch: 0.44, side: -1.45, market: 0 },
  { t: 50, zoom: 0.9, pitch: 0.42, side: -1.65, market: 0 },
  // The rap: a slow climb into a higher chase as the storm builds
  { t: 60, zoom: 1.1, pitch: 0.55, side: -1.2, market: 0 },
  { t: 72, zoom: 1.2, pitch: 0.6, side: -1.0, market: 0 },
];

/**
 * Rain run camera at `t` seconds since Start. The shots are joined by a Catmull-Rom curve, so
 * the camera flows through each key at speed instead of settling and setting off again.
 */
export function rainShotAt(t: number): Shot {
  const keys = RAIN_SHOTS;
  if (t <= keys[0].t) return { at: 0, ...keys[0] };
  const last = keys[keys.length - 1];
  if (t >= last.t) return { at: 0, ...last };
  let i = 0;
  while (keys[i + 1].t < t) i++;
  const k0 = keys[Math.max(0, i - 1)];
  const k1 = keys[i];
  const k2 = keys[i + 1];
  const k3 = keys[Math.min(keys.length - 1, i + 2)];
  const u = (t - k1.t) / (k2.t - k1.t);
  const span = k2.t - k1.t;
  // Cubic Hermite with Catmull-Rom tangents on the uneven time keys
  const curve = (get: (k: (typeof keys)[number]) => number) => {
    const p1 = get(k1);
    const p2 = get(k2);
    const m1 = k1 === k0 ? 0 : ((get(k2) - get(k0)) / (k2.t - k0.t)) * span;
    const m2 = k3 === k2 ? 0 : ((get(k3) - get(k1)) / (k3.t - k1.t)) * span;
    const u2 = u * u;
    const u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * p1 + (u3 - 2 * u2 + u) * m1 + (-2 * u3 + 3 * u2) * p2 + (u3 - u2) * m2;
  };
  return {
    at: 0,
    zoom: Math.exp(curve((k) => Math.log(k.zoom))),
    pitch: curve((k) => k.pitch),
    side: curve((k) => k.side),
    market: curve((k) => k.market),
  };
}
