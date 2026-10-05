/**
 * Forecasts from Open-Meteo (free, no key, CC BY 4.0: credited on screen) for a few Vietnamese
 * cities: the next 24 hours and the next 7 days. Without a network the screen falls back to a
 * believable sample, so the demo never shows an empty state on stage.
 */

export type City = { id: string; name: string; lat: number; lon: number };

export const CITIES: City[] = [
  { id: 'hcm', name: 'TP. Hồ Chí Minh', lat: 10.7769, lon: 106.7009 },
  { id: 'hn', name: 'Hà Nội', lat: 21.0285, lon: 105.8542 },
  { id: 'dn', name: 'Đà Nẵng', lat: 16.0544, lon: 108.2022 },
  { id: 'dl', name: 'Đà Lạt', lat: 11.9404, lon: 108.4583 },
  { id: 'sp', name: 'Sa Pa', lat: 22.3364, lon: 103.8438 },
  { id: 'vt', name: 'Vũng Tàu', lat: 10.346, lon: 107.0843 },
];

/** One step of forecast: an hour, or (in the week view) a whole day */
export type Hour = {
  /** Local time, "2026-10-05T14:00" (a day starts at "T00:00") */
  time: string;
  temp: number;
  /** The day's range (the hour's own temperature for both in the hourly view) */
  high: number;
  low: number;
  feels: number;
  humidity: number;
  dewPoint: number;
  /** % chance of rain */
  precipProb: number;
  /** mm in the hour (or the day) */
  precip: number;
  /** WMO weather code */
  code: number;
  /** % sky covered */
  cloud: number;
  /** km/h */
  wind: number;
  gust: number;
  /** Degrees the wind blows from */
  windDir: number;
  /** hPa */
  pressure: number;
  uv: number;
  isDay: boolean;
  /** US AQI */
  aqi: number;
  pm25: number;
  pm10: number;
  /** km */
  visibility: number;
};

export type Forecast = {
  city: City;
  hours: Hour[];
  days: Hour[];
  sunrise: string;
  sunset: string;
  high: number;
  low: number;
  source: 'live' | 'sample';
};

const HOURLY = [
  'temperature_2m',
  'apparent_temperature',
  'relative_humidity_2m',
  'dew_point_2m',
  'precipitation_probability',
  'precipitation',
  'weather_code',
  'cloud_cover',
  'wind_speed_10m',
  'wind_gusts_10m',
  'wind_direction_10m',
  'surface_pressure',
  'uv_index',
  'is_day',
  'visibility',
].join(',');

const DAILY = [
  'weather_code',
  'temperature_2m_max',
  'temperature_2m_min',
  'apparent_temperature_max',
  'precipitation_sum',
  'precipitation_probability_max',
  'wind_speed_10m_max',
  'wind_gusts_10m_max',
  'wind_direction_10m_dominant',
  'uv_index_max',
  'sunrise',
  'sunset',
].join(',');

async function getJson(url: string) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 8000);
  try {
    const res = await fetch(url, { signal: abort.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export async function fetchForecast(city: City): Promise<Forecast> {
  const at = `latitude=${city.lat}&longitude=${city.lon}&timezone=auto`;
  try {
    const [wx, air] = await Promise.all([
      getJson(
        `https://api.open-meteo.com/v1/forecast?${at}&current=temperature_2m&hourly=${HOURLY}` +
          `&daily=${DAILY}&forecast_days=7&wind_speed_unit=kmh`
      ),
      // Air quality is a separate service; the screen still works without it
      getJson(
        `https://air-quality-api.open-meteo.com/v1/air-quality?${at}&hourly=us_aqi,pm2_5,pm10&forecast_days=7`
      ).catch(() => null),
    ]);
    const h = wx.hourly;
    const nowKey = String(wx.current.time).slice(0, 13);
    const start = Math.max(
      0,
      (h.time as string[]).findIndex((t) => t.slice(0, 13) === nowKey)
    );
    const airAt = (t: string, key: string) => {
      const i = air ? (air.hourly.time as string[]).indexOf(t) : -1;
      return i >= 0 ? Number(air.hourly[key][i] ?? 0) : null;
    };
    const hourAt = (i: number): Hour => ({
      time: h.time[i],
      temp: h.temperature_2m[i],
      high: h.temperature_2m[i],
      low: h.temperature_2m[i],
      feels: h.apparent_temperature[i],
      humidity: h.relative_humidity_2m[i],
      dewPoint: h.dew_point_2m[i],
      precipProb: h.precipitation_probability[i] ?? 0,
      precip: h.precipitation[i] ?? 0,
      code: h.weather_code[i],
      cloud: h.cloud_cover[i],
      wind: h.wind_speed_10m[i],
      gust: h.wind_gusts_10m[i],
      windDir: h.wind_direction_10m[i],
      pressure: h.surface_pressure[i],
      uv: h.uv_index[i] ?? 0,
      isDay: h.is_day[i] === 1,
      aqi: airAt(h.time[i], 'us_aqi') ?? 45,
      pm25: airAt(h.time[i], 'pm2_5') ?? 12,
      pm10: airAt(h.time[i], 'pm10') ?? 20,
      visibility: (h.visibility[i] ?? 10000) / 1000,
    });
    const hours: Hour[] = [];
    for (let i = start; i < start + 24 && i < h.time.length; i++) hours.push(hourAt(i));
    if (hours.length < 24) throw new Error('short forecast');

    // Days: the daily summary, with the hourly values it lacks averaged over the day
    const d = wx.daily;
    const days: Hour[] = (d.time as string[]).map((date, k) => {
      const same: Hour[] = [];
      (h.time as string[]).forEach((t, i) => {
        if (t.startsWith(date)) same.push(hourAt(i));
      });
      return {
        time: `${date}T00:00`,
        temp: d.temperature_2m_max[k],
        high: d.temperature_2m_max[k],
        low: d.temperature_2m_min[k],
        feels: d.apparent_temperature_max[k],
        humidity: mean(same.map((x) => x.humidity)),
        dewPoint: mean(same.map((x) => x.dewPoint)),
        precipProb: d.precipitation_probability_max[k] ?? 0,
        precip: d.precipitation_sum[k] ?? 0,
        code: d.weather_code[k],
        cloud: mean(same.map((x) => x.cloud)),
        wind: d.wind_speed_10m_max[k],
        gust: d.wind_gusts_10m_max[k],
        windDir: d.wind_direction_10m_dominant[k],
        pressure: mean(same.map((x) => x.pressure)),
        uv: d.uv_index_max[k] ?? 0,
        isDay: true,
        aqi: Math.round(mean(same.map((x) => x.aqi))),
        pm25: mean(same.map((x) => x.pm25)),
        pm10: mean(same.map((x) => x.pm10)),
        visibility: mean(same.map((x) => x.visibility)),
      };
    });
    return {
      city,
      hours,
      days,
      sunrise: d.sunrise[0],
      sunset: d.sunset[0],
      high: d.temperature_2m_max[0],
      low: d.temperature_2m_min[0],
      source: 'live',
    };
  } catch {
    return sampleForecast(city);
  }
}

const pad = (n: number) => String(n).padStart(2, '0');
const stamp = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`;

/** A plausible day: warm afternoon, a passing evening shower, clear night; and a mixed week */
export function sampleForecast(city: City): Forecast {
  const now = new Date();
  const day = stamp(now).slice(0, 10);
  const cool = city.id === 'dl' || city.id === 'sp' ? 9 : 0;
  const sample = (d: Date, hr: number): Hour => {
    const warm = Math.sin(((hr - 8) / 24) * Math.PI * 2);
    const shower = hr >= 16 && hr <= 18;
    const temp = Math.round(29 + warm * 4 - cool);
    return {
      time: stamp(d),
      temp,
      high: temp,
      low: temp,
      feels: Math.round(32 + warm * 5 - cool),
      humidity: Math.round(70 - warm * 12),
      dewPoint: Math.round(23 - cool),
      precipProb: shower ? 70 : hr > 13 && hr < 20 ? 30 : 5,
      precip: shower ? 2.4 : 0,
      code: shower ? (hr === 17 ? 95 : 63) : hr > 12 && hr < 20 ? 2 : 1,
      cloud: shower ? 90 : hr > 12 && hr < 20 ? 45 : 15,
      wind: shower ? 22 : 9 + warm * 4,
      gust: shower ? 38 : 16,
      windDir: 220,
      pressure: 1008,
      uv: hr >= 7 && hr <= 16 ? Math.max(0, Math.round(10 * Math.sin(((hr - 6) / 11) * Math.PI))) : 0,
      isDay: hr >= 6 && hr < 18,
      aqi: 48 + Math.round(warm * 10),
      pm25: 14,
      pm10: 24,
      visibility: shower ? 6 : 10,
    };
  };
  const hours: Hour[] = [];
  for (let k = 0; k < 24; k++) {
    const d = new Date(now.getTime() + k * 3600_000);
    hours.push(sample(d, d.getHours()));
  }
  const CODES = [2, 63, 3, 95, 1, 80, 2];
  const days: Hour[] = CODES.map((code, k) => {
    const d = new Date(now.getTime() + k * 86400_000);
    d.setHours(0);
    const base = sample(d, 14);
    return {
      ...base,
      time: `${stamp(d).slice(0, 10)}T00:00`,
      code,
      high: 33 - cool - (k % 3),
      low: 25 - cool - (k % 2),
      temp: 33 - cool - (k % 3),
      precipProb: code >= 61 ? 80 : 20,
      precip: code >= 61 ? 8 : 0.4,
      uv: 9 - (k % 4),
    };
  });
  return {
    city,
    hours,
    days,
    sunrise: `${day}T05:42`,
    sunset: `${day}T17:44`,
    high: 33 - cool,
    low: 25 - cool,
    source: 'sample',
  };
}

// ---- The moon: phase from the date (a mean synodic month from a known new moon) ----

const SYNODIC = 29.530588853;
const NEW_MOON_2000 = Date.UTC(2000, 0, 6, 18, 14) / 86400000;

export type MoonInfo = {
  /** 0 new → 0.5 full → 1 new */
  phase: number;
  /** 0..1 lit fraction */
  illumination: number;
  /** Days since new moon */
  age: number;
  daysToFull: number;
  daysToNew: number;
};

export function moonAt(time: Date | string): MoonInfo {
  const ms = typeof time === 'string' ? new Date(time).getTime() : time.getTime();
  const days = ms / 86400000;
  const age = (((days - NEW_MOON_2000) % SYNODIC) + SYNODIC) % SYNODIC;
  const phase = age / SYNODIC;
  const full = SYNODIC / 2;
  return {
    phase,
    illumination: (1 - Math.cos(phase * Math.PI * 2)) / 2,
    age,
    daysToFull: (full - age + SYNODIC) % SYNODIC,
    daysToNew: SYNODIC - age,
  };
}

/** 0..7: new, waxing crescent, first quarter, waxing gibbous, full, waning gibbous, last quarter, waning crescent */
export function moonPhaseIndex(phase: number) {
  return Math.floor(((phase + 1 / 16) % 1) * 8);
}

// ---- Environments: what the 3D sky shows ----

export type EnvKind = 'clear' | 'partly' | 'cloudy' | 'rain' | 'storm' | 'fog' | 'haze' | 'snow' | 'heat' | 'night';

/** Every term 0..1; the scene eases towards these */
export type Env = {
  sun: number;
  night: number;
  cloud: number;
  dark: number;
  rain: number;
  snow: number;
  storm: number;
  fog: number;
  haze: number;
  wind: number;
  heat: number;
};

const ZERO: Env = {
  sun: 0,
  night: 0,
  cloud: 0,
  dark: 0,
  rain: 0,
  snow: 0,
  storm: 0,
  fog: 0,
  haze: 0,
  wind: 0,
  heat: 0,
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function kindOf(h: Hour): EnvKind {
  const c = h.code;
  if (c >= 95) return 'storm';
  if ((c >= 71 && c <= 77) || c === 85 || c === 86) return 'snow';
  if (c >= 51) return 'rain';
  if (c === 45 || c === 48) return 'fog';
  if (h.aqi > 150) return 'haze';
  if (!h.isDay) return 'night';
  if (h.temp >= 37) return 'heat';
  if (c === 3) return 'cloudy';
  if (c === 2) return 'partly';
  return 'clear';
}

/** The sky for an hour of forecast */
export function envOf(h: Hour): Env {
  const kind = kindOf(h);
  const e: Env = { ...ZERO };
  e.night = h.isDay ? 0 : 1;
  e.cloud = clamp01(h.cloud / 100);
  e.sun = h.isDay ? clamp01(1 - e.cloud * 0.6) : 0;
  e.wind = clamp01(h.wind / 40);
  e.haze = clamp01((h.aqi - 100) / 100);
  e.heat = clamp01((h.temp - 34) / 5) * (h.isDay ? 1 : 0);
  if (kind === 'rain') {
    e.rain = clamp01(0.35 + h.precip / 4);
    e.cloud = Math.max(e.cloud, 0.8);
    e.dark = 0.35;
  } else if (kind === 'storm') {
    e.rain = 1;
    e.storm = 1;
    e.cloud = 1;
    e.dark = 1;
    e.wind = Math.max(e.wind, 0.7);
  } else if (kind === 'snow') {
    e.snow = 1;
    e.cloud = Math.max(e.cloud, 0.7);
  } else if (kind === 'fog') {
    e.fog = 1;
    e.cloud = Math.max(e.cloud, 0.4);
  }
  if (e.rain || e.snow || e.storm) e.sun = 0;
  return e;
}

/** Hand-made skies for the showcase tour and the environment picker */
export const PRESETS: Record<EnvKind, { env: Partial<Env>; temp: number; code: number; isDay: boolean }> = {
  clear: { env: { sun: 1, cloud: 0.1, wind: 0.15 }, temp: 31, code: 0, isDay: true },
  partly: { env: { sun: 0.85, cloud: 0.5, wind: 0.25 }, temp: 30, code: 2, isDay: true },
  cloudy: { env: { sun: 0.2, cloud: 1, wind: 0.3 }, temp: 28, code: 3, isDay: true },
  rain: { env: { cloud: 1, dark: 0.4, rain: 0.75, wind: 0.45 }, temp: 26, code: 63, isDay: true },
  storm: { env: { cloud: 1, dark: 1, rain: 1, storm: 1, wind: 0.9 }, temp: 24, code: 95, isDay: true },
  fog: { env: { sun: 0.15, cloud: 0.5, fog: 1, wind: 0.05 }, temp: 18, code: 45, isDay: true },
  haze: { env: { sun: 0.5, cloud: 0.3, haze: 1, wind: 0.05 }, temp: 33, code: 1, isDay: true },
  snow: { env: { cloud: 0.85, snow: 1, wind: 0.3 }, temp: -1, code: 73, isDay: true },
  heat: { env: { sun: 1, cloud: 0, heat: 1, wind: 0.05 }, temp: 39, code: 0, isDay: true },
  night: { env: { night: 1, cloud: 0.25, wind: 0.15 }, temp: 26, code: 0, isDay: false },
};

export const TOUR: EnvKind[] = ['clear', 'partly', 'cloudy', 'rain', 'storm', 'fog', 'haze', 'snow', 'heat', 'night'];

export function presetEnv(kind: EnvKind): Env {
  return { ...ZERO, ...PRESETS[kind].env };
}

// ---- Colours: the backdrop and the ink on it, from the sky ----

type RGB = [number, number, number];
const hex = (h: string): RGB => [
  parseInt(h.slice(1, 3), 16) / 255,
  parseInt(h.slice(3, 5), 16) / 255,
  parseInt(h.slice(5, 7), 16) / 255,
];
const SKIES: Record<string, [RGB, RGB]> = {
  clear: [hex('#BFE0FF'), hex('#FFF7EC')],
  cloudy: [hex('#D5DCE5'), hex('#F3F5F8')],
  rain: [hex('#A9B7C9'), hex('#E2E7EE')],
  storm: [hex('#4F596B'), hex('#8D96A6')],
  fog: [hex('#E2E4E6'), hex('#F6F6F4')],
  haze: [hex('#E2C99C'), hex('#F5E8D2')],
  snow: [hex('#D6E4F3'), hex('#FFFFFF')],
  heat: [hex('#FFC98A'), hex('#FFF0DC')],
  night: [hex('#0D1530'), hex('#2A3160')],
};

const mixRGB = (a: RGB, b: RGB, t: number): RGB => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

export type Palette = { top: RGB; bottom: RGB; dark: boolean };

export function paletteOf(e: Env): Palette {
  let top = SKIES.clear[0];
  let bottom = SKIES.clear[1];
  const layer = (key: string, t: number) => {
    top = mixRGB(top, SKIES[key][0], clamp01(t));
    bottom = mixRGB(bottom, SKIES[key][1], clamp01(t));
  };
  layer('cloudy', e.cloud * 0.75);
  layer('heat', e.heat);
  layer('haze', e.haze);
  layer('fog', e.fog);
  layer('snow', e.snow);
  layer('rain', e.rain);
  layer('storm', e.storm * 0.9 + e.dark * 0.1);
  layer('night', e.night * 0.92);
  const lum = (c: RGB) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  return { top, bottom, dark: lum(mixRGB(top, bottom, 0.5)) < 0.45 };
}

export const toCss = (c: RGB, a = 1) =>
  `rgba(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)}, ${a})`;

/** Minutes since midnight of a local "YYYY-MM-DDTHH:MM" */
export const minutesOf = (time: string) => Number(time.slice(11, 13)) * 60 + Number(time.slice(14, 16));

/** 0 at sunrise, 1 at sunset; outside 0..1 at night */
export function sunFraction(f: Forecast, time: string) {
  const rise = minutesOf(f.sunrise);
  const set = minutesOf(f.sunset);
  return (minutesOf(time) - rise) / Math.max(1, set - rise);
}

/** US AQI band, 0 (good) .. 5 (hazardous) */
export function aqiBand(aqi: number) {
  return aqi <= 50 ? 0 : aqi <= 100 ? 1 : aqi <= 150 ? 2 : aqi <= 200 ? 3 : aqi <= 300 ? 4 : 5;
}
export const AQI_COLORS = ['#3CC47C', '#F2C230', '#F28C28', '#E5484D', '#8E4EC6', '#7A1F3D'];
