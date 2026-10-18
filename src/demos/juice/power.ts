import * as Battery from 'expo-battery';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The battery: read from the phone where there is one, and a stand-in that charges in time-lapse
 * where there isn't (the simulator), so the demo still has a cable to plug in.
 *
 * iOS gives apps the level, whether it's charging and Low Power Mode, nothing about the charger or
 * the battery's health. How long to full comes from how lithium-ion charges (fast to about half,
 * then easing off), scaled to how fast this charger has actually been going once there's enough
 * of it to measure.
 */

export type PowerState = 'charging' | 'full' | 'unplugged';

/** How fast a phone charges at each level, % a minute: about 50% in the first half hour on a fast charger, then easing off */
export function chargeRate(level: number) {
  if (level < 0.5) return 1.7;
  if (level < 0.8) return 1.7 - ((level - 0.5) / 0.3) * 0.9;
  if (level < 0.95) return 0.8 - ((level - 0.8) / 0.15) * 0.5;
  return Math.max(0.12, 0.3 - ((level - 0.95) / 0.05) * 0.18);
}

/** Minutes to charge from one level to another at those rates */
export function minutesToCharge(from: number, to: number) {
  let m = 0;
  for (let l = Math.max(0, from); l < to; l += 0.0025) m += 0.25 / chargeRate(l);
  return m;
}

/** Use with the screen on drains about 1% every 7 minutes: a full charge lasts most of a day */
export const TYPICAL_DRAIN = 100 / (12 * 60);

/** How fast the stand-in battery charges and drains, against the real thing */
const LAPSE_CHARGE = 45;
const LAPSE_DRAIN = 10;

type Reading = { t: number; level: number };

/** What this phone has actually been doing: how its charger compares with the curve, how fast it drains */
export type Gauge = { scale: number; drain: number | null };

/** When it was last plugged in or pulled out, and the level then */
export type Moment = { at: number; level: number };

export type BatteryFeed = {
  /** Where the readings come from; null until that's known */
  source: 'device' | 'demo' | null;
  level: number;
  state: PowerState;
  lowPower: boolean;
  gauge: Gauge;
  since: Moment;
  /** The stand-in's cable (the real one is the real one) */
  plug: () => void;
  unplug: () => void;
  setLevel: (level: number) => void;
};

const fromNative = (s: Battery.BatteryState): PowerState =>
  s === Battery.BatteryState.CHARGING ? 'charging' : s === Battery.BatteryState.FULL ? 'full' : 'unplugged';

export function useBattery(): BatteryFeed {
  const [source, setSource] = useState<'device' | 'demo' | null>(null);
  const [level, setLevelState] = useState(0.23);
  const [state, setState] = useState<PowerState>('unplugged');
  const [lowPower, setLowPower] = useState(false);
  const [gauge, setGauge] = useState<Gauge>({ scale: 1, drain: null });
  const [since, setSince] = useState<Moment>(() => ({ at: Date.now(), level: 0.23 }));
  const readings = useRef<Reading[]>([]);
  const stateRef = useRef(state);
  const levelRef = useRef(level);
  useEffect(() => {
    stateRef.current = state;
    levelRef.current = level;
  }, [state, level]);

  useEffect(() => {
    let live = true;
    Battery.isAvailableAsync()
      .then((ok) => live && setSource(ok ? 'device' : 'demo'))
      .catch(() => live && setSource('demo'));
    return () => {
      live = false;
    };
  }, []);

  // A real battery: its events, and a look every few seconds (iOS only tells about the level once a minute)
  useEffect(() => {
    if (source !== 'device') return;
    let live = true;
    const read = (l: number, s?: PowerState) => {
      if (!live || l < 0) return;
      setLevelState(l);
      const now = Date.now();
      const list = readings.current;
      if (!list.length || list[list.length - 1].level !== l) list.push({ t: now, level: l });
      if (list.length > 16) list.shift();
      measure(s ?? stateRef.current);
    };
    const measure = (s: PowerState) => {
      const list = readings.current;
      if (list.length < 2) return;
      const a = list[0];
      const b = list[list.length - 1];
      const minutes = (b.t - a.t) / 60000;
      const change = (b.level - a.level) * 100;
      if (s === 'charging' && minutes > 2 && change >= 2) {
        const model = (b.level - a.level) * 100 / minutesToCharge(a.level, b.level);
        const scale = Math.min(2.5, Math.max(0.3, change / minutes / model));
        setGauge((g) => ({ ...g, scale: g.scale + (scale - g.scale) * 0.5 }));
      } else if (s === 'unplugged' && minutes > 3 && change <= -1) {
        setGauge((g) => ({ ...g, drain: -change / minutes }));
      }
    };
    Battery.getPowerStateAsync().then((p) => {
      if (!live) return;
      setState(fromNative(p.batteryState));
      setLowPower(p.lowPowerMode);
      setSince({ at: Date.now(), level: p.batteryLevel });
      read(p.batteryLevel, fromNative(p.batteryState));
    });
    const subs = [
      Battery.addBatteryLevelListener(({ batteryLevel }) => read(batteryLevel)),
      Battery.addBatteryStateListener(({ batteryState }) => {
        const next = fromNative(batteryState);
        // A new charge (or a new spell on battery) is measured from scratch
        if ((next === 'unplugged') !== (stateRef.current === 'unplugged')) {
          readings.current = [];
          setSince({ at: Date.now(), level: levelRef.current });
        }
        setState(next);
      }),
      Battery.addLowPowerModeListener(({ lowPowerMode }) => setLowPower(lowPowerMode)),
    ];
    const poll = setInterval(() => {
      Battery.getBatteryLevelAsync().then((l) => read(l));
    }, 5000);
    return () => {
      live = false;
      clearInterval(poll);
      subs.forEach((s) => s.remove());
    };
  }, [source]);

  // The stand-in: charges in time-lapse while it's plugged in, drains slowly when it isn't
  useEffect(() => {
    if (source !== 'demo') return;
    let last = Date.now();
    const id = setInterval(() => {
      const now = Date.now();
      const minutes = (now - last) / 60000;
      last = now;
      const l = levelRef.current;
      if (stateRef.current === 'charging') {
        const next = Math.min(1, l + (chargeRate(l) / 100) * minutes * LAPSE_CHARGE);
        levelRef.current = next;
        setLevelState(next);
        if (next >= 1) setState('full');
      } else if (stateRef.current === 'unplugged') {
        const next = Math.max(0.01, l - (TYPICAL_DRAIN / 100) * minutes * LAPSE_DRAIN);
        levelRef.current = next;
        setLevelState(next);
      }
    }, 120);
    return () => clearInterval(id);
  }, [source]);

  const plug = useCallback(() => {
    if (source !== 'demo' || stateRef.current !== 'unplugged') return;
    setSince({ at: Date.now(), level: levelRef.current });
    setState(levelRef.current >= 1 ? 'full' : 'charging');
  }, [source]);
  const unplug = useCallback(() => {
    if (source !== 'demo' || stateRef.current === 'unplugged') return;
    setSince({ at: Date.now(), level: levelRef.current });
    setState('unplugged');
  }, [source]);
  const setLevel = useCallback(
    (l: number) => {
      if (source !== 'demo') return;
      levelRef.current = Math.min(1, Math.max(0.01, l));
      setLevelState(levelRef.current);
    },
    [source]
  );

  return { source, level, state, lowPower, gauge, since, plug, unplug, setLevel };
}

/** "52 min", "1 h 12 min" */
export function duration(minutes: number) {
  if (!Number.isFinite(minutes)) return '…';
  const m = Math.max(1, Math.round(minutes));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

/** "10:42 PM", that many minutes from now */
export function clockIn(minutes: number, now = Date.now()) {
  const d = new Date(now + minutes * 60000);
  const h = d.getHours();
  return `${h % 12 || 12}:${d.getMinutes().toString().padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}
