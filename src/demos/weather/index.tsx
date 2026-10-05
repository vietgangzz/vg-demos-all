import { router } from 'expo-router';
import { memo, useEffect, useRef, useState, type ReactNode } from 'react';
import { PixelRatio, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Presets } from 'react-native-pulsar';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Canvas, type CanvasRef } from 'react-native-webgpu';
import { scheduleOnRN } from 'react-native-worklets';

import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { SymbolView, type SFSymbol } from 'expo-symbols';

import { NumericText } from '@/components/numeric-text';

import { HourBar, HourChart } from './chart';
import {
  aqiBand,
  CITIES,
  envOf,
  fetchForecast,
  kindOf,
  minutesOf,
  moonAt,
  moonPhaseIndex,
  paletteOf,
  PRESETS,
  presetEnv,
  sampleForecast,
  sunFraction,
  toCss,
  TOUR,
  type Env,
  type EnvKind,
  type Forecast,
  type Hour,
} from './data';
import { FONT, NATIVE_FONT, useWeatherFonts } from './fonts';
import { conditionOf, tr, useLang, type Lang } from './i18n';
import { SKIN_ORDER, SKINS, type SkinId } from './matcaps';
import { createWeatherScene, PAGE_COUNT, pageAt, PAGES, type PageId, type WeatherScene } from './scene';

const GLASS = isLiquidGlassAvailable();
/** The ring's snap: quick, like a flick of a carousel */
const WHIP = { damping: 30, stiffness: 320, mass: 1 };
/** Left strip the ring swipe ignores, so the edge swipe goes back */
const EDGE_SWIPE = 24;
const TOUR_STEP_MS = 4500;

const ICONS: Record<EnvKind, SFSymbol> = {
  clear: 'sun.max.fill',
  partly: 'cloud.sun.fill',
  cloudy: 'cloud.fill',
  rain: 'cloud.rain.fill',
  storm: 'cloud.bolt.rain.fill',
  fog: 'cloud.fog.fill',
  haze: 'sun.haze.fill',
  snow: 'snowflake',
  heat: 'sun.max.fill',
  night: 'moon.stars.fill',
};

/** The hour bar's colour for an hour: blue sky, grey cloud, deep blue rain, slate night */
function barColor(h: Hour) {
  const kind = kindOf(h);
  if (kind === 'rain' || kind === 'storm' || kind === 'snow') return '#4F6BFF';
  if (!h.isDay) return '#5C626D';
  if (kind === 'cloudy' || kind === 'fog' || kind === 'haze') return '#A9AFB8';
  return '#2BB5FF';
}

const hhmm = (time: string) => time.slice(11, 16);
const weekday = (lang: Lang, time: string) => tr(lang).weekdays[new Date(`${time.slice(0, 10)}T12:00`).getDay()];

/**
 * "Trời": the weather as a little 3D world on a ring. The main page shows the sky over tall
 * puffy numerals and a 24-hour bar; swiping turns the ring through temperature, rain, sun,
 * clouds, wind, air and moon, each a single object over its numbers, a chart you can scrub, and
 * a day/week switch. Live data from Open-Meteo for six Vietnamese cities, a tour through every
 * kind of weather for the stage, and four skins after Vietnamese crafts.
 */
export default function Weather() {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const lang = useLang();
  const t = tr(lang);
  const canvasRef = useRef<CanvasRef>(null);
  const [scene, setScene] = useState<WeatherScene | null>(null);
  const [ready, setReady] = useState(false);
  const [cityIndex, setCityIndex] = useState(0);
  const [forecast, setForecast] = useState<Forecast>(() => sampleForecast(CITIES[0]));
  const [hourIndex, setHourIndex] = useState(0);
  const [dayIndex, setDayIndex] = useState(0);
  const [moonDay, setMoonDay] = useState(0);
  const [range, setRange] = useState<'day' | 'week'>('day');
  const [page, setPage] = useState(0);
  const [override, setOverride] = useState<EnvKind | null>(null);
  const [touring, setTouring] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [weekOpen, setWeekOpen] = useState(false);
  const [hint, setHint] = useState(true);
  const [skin, setSkin] = useState<SkinId>('su');
  const fontsLoaded = useWeatherFonts();
  const [mode, setMode] = useState<'main' | 'ring'>('main');
  const pageX = useSharedValue(0);
  const pageStart = useSharedValue(0);
  // 0 = main view, 1 = the ring (animated through the fly-over); and the main view's drag spin
  const view = useSharedValue(0);
  const viewTarget = useSharedValue(0);
  const spin = useSharedValue(0);
  const holding = useSharedValue(false);

  // ---- Layout, in points ----
  // Main: the sky on top, tall numerals under it, the condition and the hour bar below
  const mainHero = Math.min(width * 0.72, height * 0.3);
  const mainHeroY = insets.top + 56 + mainHero * 0.45;
  const mainDigitsH = height * 0.36;
  const mainDigitsY = mainHeroY + mainHero * 0.42 + mainDigitsH / 2;
  const conditionTop = mainDigitsY + mainDigitsH / 2 + 14;
  // Detail: a title, one object, the card at the bottom
  const detailHero = Math.min(width * 0.78, height * 0.31);
  const detailTitleY = insets.top + 96;
  const detailHeroY = insets.top + 132 + detailHero / 2;

  useEffect(() => {
    let live: WeatherScene | null = null;
    let cancelled = false;
    (async () => {
      const adapter = await navigator.gpu.requestAdapter();
      const device = await adapter?.requestDevice();
      const context = canvasRef.current?.getContext('webgpu');
      if (cancelled || !device || !context) return;
      const canvas = context.canvas as unknown as {
        width: number;
        height: number;
        clientWidth: number;
        clientHeight: number;
      };
      const ratio = Math.min(PixelRatio.get(), 2.5);
      canvas.width = canvas.clientWidth * ratio;
      canvas.height = canvas.clientHeight * ratio;
      live = createWeatherScene(context, device, { page: pageX, view, spin });
      live.onFirstFrame(() => setReady(true));
      // Dev builds expose the scene for QA: weatherScene.tap(x, y)
      if (__DEV__) (globalThis as { weatherScene?: WeatherScene }).weatherScene = live;
      setScene(live);
    })();
    return () => {
      cancelled = true;
      live?.dispose();
    };
  }, [pageX, view, spin]);

  useEffect(() => {
    scene?.setLayout({
      main: {
        heroY: mainHeroY,
        heroSize: mainHero,
        digitsY: mainDigitsY,
        digitsWidth: width * 0.8,
        digitsHeight: mainDigitsH,
        titleY: 0,
      },
      detail: {
        heroY: detailHeroY,
        heroSize: detailHero,
        // Below the title, with room to breathe
        digitsY: detailHeroY + 6,
        digitsWidth: width * 0.7,
        digitsHeight: detailHero * 0.78,
        titleY: detailTitleY,
      },
    });
  }, [scene, mainHeroY, mainHero, mainDigitsY, mainDigitsH, detailHeroY, detailHero, detailTitleY, width]);

  useEffect(() => {
    scene?.setTitles(PAGES.map((id) => t.titles[id]));
  }, [scene, t]);

  useEffect(() => {
    scene?.setSkin(skin);
  }, [scene, skin]);

  // The live forecast replaces the city's sample when it lands
  useEffect(() => {
    let stale = false;
    fetchForecast(CITIES[cityIndex]).then((f) => {
      if (!stale) setForecast(f);
    });
    return () => {
      stale = true;
    };
  }, [cityIndex]);

  // The tour walks through every kind of sky, for filming
  useEffect(() => {
    if (!touring) return;
    let step = 0;
    const timer = setInterval(() => {
      step = (step + 1) % TOUR.length;
      Presets.System.impactLight();
      setOverride(TOUR[step]);
    }, TOUR_STEP_MS);
    return () => clearInterval(timer);
  }, [touring]);

  useEffect(() => {
    const timer = setTimeout(() => setHint(false), 4200);
    return () => clearTimeout(timer);
  }, []);

  // ---- The selected step: an hour, or a day in the week view ----
  const week = range === 'week';
  const steps = week ? forecast.days : forecast.hours;
  const stepIndex = Math.min(week ? dayIndex : hourIndex, steps.length - 1);
  const live = steps[stepIndex];
  const hour: Hour = override
    ? {
        ...live,
        temp: PRESETS[override].temp,
        high: PRESETS[override].temp + 2,
        low: PRESETS[override].temp - 5,
        feels: PRESETS[override].temp + 2,
        code: PRESETS[override].code,
        isDay: PRESETS[override].isDay,
        precipProb: override === 'rain' || override === 'storm' ? 85 : override === 'snow' ? 70 : 5,
        precip: override === 'storm' ? 6 : override === 'rain' ? 2 : 0,
        cloud: Math.round(presetEnv(override).cloud * 100),
        wind: Math.round(presetEnv(override).wind * 40),
        aqi: override === 'haze' ? 182 : live.aqi,
        uv: PRESETS[override].isDay ? (override === 'heat' ? 11 : live.uv) : 0,
      }
    : live;
  const kind: EnvKind = override ?? kindOf(hour);
  const sky: Env = override ? presetEnv(override) : envOf(hour);
  const cloudSky: Env = { ...sky, cloud: Math.max(sky.cloud, 0.35), sun: 0 };
  const palette = paletteOf(sky);
  const ink = palette.dark ? '#FFFFFF' : '#14181F';
  const soft = palette.dark ? 'rgba(255,255,255,0.6)' : 'rgba(20,24,31,0.5)';
  const paper = toCss(palette.bottom);
  const band = aqiBand(hour.aqi);
  const sunFrac = week ? 0.5 : sunFraction(forecast, hour.time);
  const nightFrac = (() => {
    const set = minutesOf(forecast.sunset);
    const rise = minutesOf(forecast.sunrise);
    const night = 1440 - (set - rise);
    return (((minutesOf(hour.time) - set + 1440) % 1440) / Math.max(1, night)) % 1;
  })();
  const moonDays = forecast.days.map((d) => moonAt(`${d.time.slice(0, 10)}T12:00:00`));
  const moon = moonDays[Math.min(moonDay, moonDays.length - 1)] ?? moonAt(new Date());
  const temp = `${Math.round(hour.temp)}°`;

  useEffect(() => {
    scene?.setInput({
      sky,
      cloudSky,
      rain: Math.max(sky.rain, (hour.precipProb / 100) * 0.9),
      digits: { main: temp, temp },
      windKmh: hour.wind,
      windDir: hour.windDir,
      sunFrac: hour.isDay || week ? sunFrac : nightFrac,
      isDay: hour.isDay || week,
      moonPhase: moon.phase,
      ink,
    });
  });

  // ---- Touch ----
  // On the main view a sideways drag spins the sky and the numerals; far enough, and the camera
  // flies out to the ring. On the ring a swipe whips the next page in; a pull down flies back.
  const FLY = { duration: 1500, easing: Easing.inOut(Easing.quad) };
  const enterRing = (toPage: number) => {
    'worklet';
    pageX.set(toPage);
    viewTarget.set(1);
    // The screen re-renders for the new mode only once landed, so it never costs a frame in flight
    view.set(
      withTiming(1, FLY, (done) => {
        if (done) scheduleOnRN(setMode, 'ring');
      })
    );
  };
  const leaveRing = () => {
    'worklet';
    viewTarget.set(0);
    spin.set(0);
    view.set(withTiming(0, FLY));
    // Waking the main layer is cheap, and it shows the hour picked on the ring as it fades in
    scheduleOnRN(setMode, 'main');
  };
  /** From the header and the tour: fly back to the main view */
  const backToMain = () => {
    if (viewTarget.get() === 0) return;
    viewTarget.set(0);
    spin.set(0);
    view.set(withTiming(0, FLY));
    setMode('main');
  };
  const pager = Gesture.Pan()
    .activeOffsetX([-10, 10])
    .failOffsetY([-24, 24])
    .hitSlop({ left: -EDGE_SWIPE })
    .onBegin(() => {
      pageStart.set(pageX.get());
    })
    .onUpdate((e) => {
      // A held finger tilts the 3D instead
      if (holding.get()) return;
      if (viewTarget.get() === 0) {
        spin.set((e.translationX / width) * Math.PI * 1.1);
        return;
      }
      // 1:1 with the finger at the front of the ring
      pageX.set(pageStart.get() - e.translationX / (width * 1.3));
    })
    .onEnd((e) => {
      if (holding.get()) {
        spin.set(withSpring(0, { damping: 9, stiffness: 120 }));
        return;
      }
      if (viewTarget.get() === 0) {
        if (Math.abs(spin.get()) > 0.9 || Math.abs(e.velocityX) > 900) {
          // Swiping left goes forward to the first page, right goes round to the last
          enterRing(e.translationX < 0 ? 0 : PAGE_COUNT - 1);
        } else {
          spin.set(withSpring(0, { damping: 9, stiffness: 120 }));
        }
        return;
      }
      const projected = pageX.get() - (e.velocityX / width) * 0.3;
      // One page per flick at most, so a hard swipe doesn't spin past the next page
      const from = Math.round(pageStart.get());
      const target = Math.max(from - 1, Math.min(from + 1, Math.round(projected)));
      pageX.set(
        withSpring(target, WHIP, (done) => {
          // Keep the number small so it never drifts far round the ring
          if (done) pageX.set(pageAt(target));
        })
      );
    });
  const pullDown = Gesture.Pan()
    .activeOffsetY(24)
    .failOffsetX([-24, 24])
    .onEnd((e) => {
      if (!holding.get() && viewTarget.get() === 1 && (e.translationY > 90 || e.velocityY > 900)) leaveRing();
    });
  const onTap = (x: number, y: number) => {
    const hit = scene?.tap(x, y);
    if (hit === 'storm') Presets.System.impactHeavy();
    else if (hit === 'cloud' || hit === 'gadget') Presets.System.impactMedium();
    else if (hit === 'digit' || hit === 'bubble') Presets.System.impactRigid();
    else if (hit) Presets.System.impactSoft();
  };
  const tap = Gesture.Tap()
    .maxDistance(10)
    .runOnJS(true)
    .onEnd((e, success) => {
      if (success) onTap(e.x, e.y);
    });
  // Press and hold, then drag, to tilt the 3D. A long press marks the hold; a pan that only
  // activates once the hold is up then takes the drag. A finger that moves first is a swipe,
  // and the pan never steals it
  const buzz = () => Presets.System.impactLight();
  const grabTo = (dx: number, dy: number) => scene?.grab(dx, dy);
  const letGo = (vx: number) => scene?.release(vx);
  const hold = Gesture.LongPress()
    .minDuration(240)
    .maxDistance(10)
    .onBegin(() => holding.set(false))
    .onStart(() => {
      holding.set(true);
      scheduleOnRN(buzz);
    });
  const holdPan = Gesture.Pan()
    .manualActivation(true)
    .onTouchesMove((_e, state) => {
      if (holding.get()) state.activate();
    })
    .onUpdate((e) => scheduleOnRN(grabTo, e.translationX, e.translationY))
    .onEnd((e) => scheduleOnRN(letGo, e.velocityX));
  // A swipe, a pull or a tap: first to activate wins. The hold runs alongside rather than in
  // the race, where its waiting pan held the others back; a held finger is ignored by the swipes
  const touch = Gesture.Simultaneous(Gesture.Race(pager, pullDown, tap), hold, holdPan);

  const onPageChange = (p: number) => {
    Presets.System.selection();
    setPage(p);
    setHint(false);
  };
  useAnimatedReaction(
    () => pageAt(pageX.get()),
    (p, prev) => {
      if (prev !== null && p !== prev) scheduleOnRN(onPageChange, p);
    }
  );

  const scrubStep = (i: number) => {
    if (touring) setTouring(false);
    setOverride(null);
    if (week) setDayIndex(i);
    else setHourIndex(i);
  };
  const stepLabels = steps.map((s, i) =>
    week ? (i === 0 ? t.todayLabel : weekday(lang, s.time)) : i === 0 ? t.nowLabel : s.time.slice(11, 13)
  );
  const stepLabel = week
    ? stepIndex === 0
      ? t.todayLabel
      : weekday(lang, hour.time)
    : stepIndex === 0
      ? t.nowLabel
      : hhmm(hour.time);
  const compass = t.compass[Math.round((((hour.windDir % 360) + 360) % 360) / 45) % 8];
  const daylight = minutesOf(forecast.sunset) - minutesOf(forecast.sunrise);
  const precipType =
    kind === 'storm'
      ? t.types.storm
      : kind === 'snow'
        ? t.types.snow
        : hour.precip > 0 || hour.precipProb >= 50
          ? t.types.rain
          : t.types.none;
  const c = t.card;

  const chart = (values: number[], color: string, opts: { kind?: 'line' | 'bars'; floor?: number; ceil?: number }) => (
    <HourChart
      values={values}
      index={stepIndex}
      onScrub={scrubStep}
      color={color}
      ink={ink}
      labels={stepLabels}
      pager={pager}
      mono={FONT.mono}
      {...opts}
    />
  );
  const details: Record<
    Exclude<PageId, 'main'>,
    { head: [string, string]; rows: [string, string][]; chart: ReactNode }
  > = {
    temp: {
      head: [c.temperature, temp],
      rows: [
        [c.high, `${Math.round(week ? hour.high : forecast.high)}°`],
        [c.low, `${Math.round(week ? hour.low : forecast.low)}°`],
        [c.feels, `${Math.round(hour.feels)}°`],
        [c.humidity, `${Math.round(hour.humidity)}%`],
        [c.dewPoint, `${Math.round(hour.dewPoint)}°`],
      ],
      chart: chart(
        steps.map((s) => s.temp),
        '#FF8A3D',
        {}
      ),
    },
    rain: {
      head: [c.rate, `${hour.precip.toFixed(1)} mm${week ? '' : '/h'}`],
      rows: [
        [c.chance, `${Math.round(hour.precipProb)}%`],
        [c.type, precipType],
      ],
      chart: chart(
        steps.map((s) => s.precipProb),
        '#2BB5FF',
        { kind: 'bars', floor: 0, ceil: 100 }
      ),
    },
    sun: {
      head: [c.uv, `${Math.round(hour.uv)}`],
      rows: [
        [c.sunrise, hhmm(forecast.sunrise)],
        [c.sunset, hhmm(forecast.sunset)],
        [c.daylight, `${Math.floor(daylight / 60)}h ${String(daylight % 60).padStart(2, '0')}m`],
      ],
      chart: chart(
        steps.map((s) => s.uv),
        '#F5A524',
        { kind: 'bars', floor: 0, ceil: 11 }
      ),
    },
    clouds: {
      head: [c.cloud, `${Math.round(hour.cloud)}%`],
      rows: [
        [c.sky, conditionOf(lang, kind, hour)],
        [c.visibility, `${hour.visibility.toFixed(1)} km`],
      ],
      chart: chart(
        steps.map((s) => s.cloud),
        '#9AA3AE',
        { floor: 0, ceil: 100 }
      ),
    },
    // Wind and air quality together, as the original's Air page
    air: {
      head: [c.wind, `${Math.round(hour.wind)} km/h`],
      rows: [
        [c.gust, `${Math.round(hour.gust)} km/h`],
        [c.direction, `${compass} · ${Math.round(hour.windDir)}°`],
        [c.pressure, `${Math.round(hour.pressure)} hPa`],
        [c.aqi, `${Math.round(hour.aqi)} · ${t.aqiBands[band]}`],
        [c.pm25, `${hour.pm25.toFixed(1)} µg/m³`],
      ],
      chart: chart(
        steps.map((s) => s.wind),
        '#22B8A7',
        { floor: 0 }
      ),
    },
    moon: {
      head: [c.illumination, `${Math.round(moon.illumination * 100)}%`],
      rows: [
        [c.phase, t.phases[moonPhaseIndex(moon.phase)]],
        [c.age, t.days(Math.round(moon.age))],
        [c.fullMoon, t.inDays(Math.round(moon.daysToFull))],
        [c.newMoon, t.inDays(Math.round(moon.daysToNew))],
      ],
      chart: (
        <HourChart
          values={moonDays.map((m) => m.illumination * 100)}
          index={Math.min(moonDay, moonDays.length - 1)}
          onScrub={setMoonDay}
          color={palette.dark ? '#E6E3DA' : '#7D8496'}
          ink={ink}
          labels={forecast.days.map((d, i) => (i === 0 ? t.todayLabel : weekday(lang, d.time)))}
          floor={0}
          ceil={100}
          pager={pager}
          mono={FONT.mono}
        />
      ),
    },
  };

  // ---- The main page's hour bar: low and high written where they fall ----
  const temps = forecast.hours.map((h) => h.temp);
  const lowAt = temps.indexOf(Math.min(...temps));
  const highAt = temps.indexOf(Math.max(...temps));
  const marks =
    lowAt === highAt
      ? [{ at: lowAt, text: `${Math.round(temps[lowAt])}` }]
      : [
          { at: lowAt, text: `${Math.round(temps[lowAt])}` },
          { at: highAt, text: `${Math.round(temps[highAt])}` },
        ];
  const barLabels = forecast.hours
    .filter((_, i) => i % 3 === 0)
    .map((h, i) => (i === 0 ? t.nowLabel : String(Number(h.time.slice(11, 13)))));

  const pickEnv = (k: EnvKind | null) => {
    Presets.System.selection();
    setTouring(false);
    setOverride(k);
  };

  return (
    <View style={[styles.container, { backgroundColor: paper }]}>
      <Canvas ref={canvasRef} style={StyleSheet.absoluteFill} />

      {/* The text waits for its fonts, so nothing flashes in the system face first */}
      {fontsLoaded ? (
        <>
          <GestureDetector gesture={touch}>
            <View style={StyleSheet.absoluteFill}>
              {/* The main view's text: fades out as the camera leaves for the ring */}
              <Layer view={view} show="main" active={mode === 'main'}>
                <Frozen live={mode === 'main'}>
                  {hint ? (
                    <Animated.Text
                      entering={FadeIn.delay(600)}
                      exiting={FadeOut}
                      style={[styles.hint, { top: mainDigitsY - 12 }]}>
                      {t.hint}
                    </Animated.Text>
                  ) : null}
                  <Text style={[styles.condition, { top: conditionTop, color: ink }]}>
                    {conditionOf(lang, kind, hour)}
                  </Text>
                  <View style={[styles.bar, { top: conditionTop + 50 }]}>
                    {weekOpen ? (
                      <WeekRow forecast={forecast} lang={lang} ink={ink} onPress={() => setWeekOpen(false)} />
                    ) : (
                      <HourBar
                        colors={forecast.hours.map(barColor)}
                        index={hourIndex}
                        onScrub={(i) => {
                          setRange('day');
                          scrubStep(i);
                          setHourIndex(i);
                        }}
                        marks={marks}
                        labels={barLabels}
                        ink={ink}
                        pager={pager}
                        mono={FONT.mono}
                        onLabelsPress={() => {
                          Presets.System.selection();
                          setWeekOpen(true);
                        }}
                      />
                    )}
                  </View>
                  <View style={[styles.credit, { bottom: Math.max(10, insets.bottom - 6) }]}>
                    <Text style={[styles.creditSmall, { color: soft }]}>{t.forecastBy}</Text>
                    <Text style={[styles.creditName, { color: soft }]}>
                      {forecast.source === 'live' ? 'Open-Meteo' : t.sample}
                    </Text>
                  </View>
                </Frozen>
              </Layer>

              {/* The ring's text: titles stand on the ring in 3D; the label and the card stay put */}
              <Layer view={view} show="ring" active={mode === 'ring'}>
                <Text style={[styles.stepLabel, { top: insets.top + 60, color: soft, opacity: pickerOpen ? 0 : 1 }]}>
                  {PAGES[page] === 'moon' ? t.todayLabel : stepLabel}
                </Text>
                {PAGES.map((id, i) => (
                  <CardFade key={id} index={i} pageX={pageX} active={mode === 'ring' && page === i}>
                    <Frozen live={mode === 'ring' && near(i, page)}>
                      <View style={[styles.card, { bottom: insets.bottom + 10 }]}>
                        <DetailCard
                          head={details[id].head}
                          rows={details[id].rows}
                          ink={ink}
                          soft={soft}
                          paper={paper}
                        />
                        <View style={styles.chartWrap}>{details[id].chart}</View>
                        {id !== 'moon' ? (
                          <RangeSwitch
                            range={range}
                            ink={ink}
                            soft={soft}
                            labels={[t.day, t.week]}
                            onChange={(r) => {
                              Presets.System.selection();
                              setRange(r);
                            }}
                          />
                        ) : null}
                      </View>
                    </Frozen>
                  </CardFade>
                ))}
              </Layer>
            </View>
          </GestureDetector>

          {/* ---- Header: back, city, and the stage controls ---- */}
          <View style={[styles.header, { top: insets.top + 6 }]} pointerEvents="box-none">
            <Chip
              dark={palette.dark}
              onPress={() => (viewTarget.get() === 1 ? backToMain() : router.back())}
              label="Back">
              <SymbolView name="chevron.left" size={15} weight="semibold" tintColor={ink} />
            </Chip>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={forecast.city.name}
              hitSlop={8}
              style={styles.city}
              onPress={() => {
                Presets.System.selection();
                // Show the next city's sample at once; the live forecast follows
                const next = (cityIndex + 1) % CITIES.length;
                setCityIndex(next);
                setForecast(sampleForecast(CITIES[next]));
                setHourIndex(0);
                setDayIndex(0);
              }}>
              <SymbolView name="location.fill" size={14} tintColor={ink} />
              <Text style={[styles.cityText, { color: ink }]}>{forecast.city.name}</Text>
            </Pressable>
            <Chip
              dark={palette.dark}
              label="Settings"
              active={pickerOpen}
              onPress={() => {
                Presets.System.selection();
                setPickerOpen((o) => !o);
              }}>
              <SymbolView name="slider.horizontal.3" size={16} weight="semibold" tintColor={ink} />
            </Chip>
          </View>

          {pickerOpen ? (
            <Animated.View
              entering={FadeIn.duration(180)}
              exiting={FadeOut.duration(140)}
              style={[styles.picker, { top: insets.top + 56 }]}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pickerRow}>
                <Pill
                  dark={palette.dark}
                  ink={ink}
                  active={touring}
                  label={`▶ ${t.tour}`}
                  onPress={() => {
                    Presets.System.impactMedium();
                    if (!touring) setOverride(TOUR[0]);
                    setTouring(!touring);
                    backToMain();
                  }}
                />
                <Pill
                  dark={palette.dark}
                  ink={ink}
                  active={!override && !touring}
                  label={t.live}
                  onPress={() => pickEnv(null)}
                />
                {TOUR.map((k) => (
                  <Pill
                    key={k}
                    dark={palette.dark}
                    ink={ink}
                    active={override === k && !touring}
                    label={t.env[k]}
                    onPress={() => pickEnv(k)}
                  />
                ))}
              </ScrollView>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pickerRow}>
                {SKIN_ORDER.map((s) => (
                  <Pressable
                    key={s}
                    onPress={() => {
                      Presets.System.selection();
                      setSkin(s);
                    }}
                    style={[
                      styles.skin,
                      { borderColor: skin === s ? ink : 'transparent' },
                      { backgroundColor: palette.dark ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.72)' },
                    ]}>
                    <View style={[styles.swatch, { backgroundColor: SKINS[s].swatch }]} />
                    <Text style={[styles.pillText, { color: ink }]}>{t.skins[s]}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </Animated.View>
          ) : null}
        </>
      ) : null}

      {!ready || !fontsLoaded ? (
        <View style={[StyleSheet.absoluteFill, styles.loading, { backgroundColor: paper }]}>
          <Text style={[styles.loadingText, { color: soft }]}>{t.loading}…</Text>
        </View>
      ) : null}
    </View>
  );
}

/**
 * Holds its children as they were while `live` is off: a scrub re-renders only the text on
 * screen, not the five cards hidden round the ring (they catch up when they come into view)
 */
const Frozen = memo(
  function Frozen({ children }: { live: boolean; children: ReactNode }) {
    return children;
  },
  (_prev, next) => !next.live
);

/** The page and its neighbours either side, round the ring */
const near = (i: number, page: number) => {
  const d = Math.abs(i - page) % PAGE_COUNT;
  return Math.min(d, PAGE_COUNT - d) <= 1;
};

/** The main view's or the ring's 2D layer, faded with the fly-over between them */
function Layer({
  view,
  show,
  active,
  children,
}: {
  view: SharedValue<number>;
  show: 'main' | 'ring';
  active: boolean;
  children: ReactNode;
}) {
  const style = useAnimatedStyle(() => {
    const v = view.get();
    const o = show === 'main' ? 1 - Math.min(1, v / 0.22) : Math.max(0, (v - 0.82) / 0.18);
    return { opacity: o };
  });
  return (
    <Animated.View pointerEvents={active ? 'box-none' : 'none'} style={[StyleSheet.absoluteFill, style]}>
      {children}
    </Animated.View>
  );
}

/**
 * A ring page's card. It stays in place while the 3D whips round, crossfading to the next
 * page's numbers; only the page in front takes touches.
 */
function CardFade({
  index,
  pageX,
  active,
  children,
}: {
  index: number;
  pageX: SharedValue<number>;
  active: boolean;
  children: ReactNode;
}) {
  const style = useAnimatedStyle(() => {
    const raw = (((index - pageX.get()) % PAGE_COUNT) + PAGE_COUNT) % PAGE_COUNT;
    const d = raw > PAGE_COUNT / 2 ? raw - PAGE_COUNT : raw;
    return { opacity: Math.max(0, 1 - Math.abs(d) * 2.2) };
  });
  return (
    <Animated.View pointerEvents={active ? 'box-none' : 'none'} style={[StyleSheet.absoluteFill, style]}>
      {children}
    </Animated.View>
  );
}

/** The card's rows: the headline value on an inked strip, the rest on dotted leaders */
function DetailCard({
  head,
  rows,
  ink,
  soft,
  paper,
}: {
  head: [string, string];
  rows: [string, string][];
  ink: string;
  soft: string;
  paper: string;
}) {
  return (
    <View>
      <View style={[styles.headRow, { backgroundColor: ink }]}>
        <Text style={[styles.headLabel, { color: paper }]}>{head[0]}</Text>
        {/* Native SwiftUI numeric transitions: digits roll as you scrub */}
        <NumericText value={head[1]} family={NATIVE_FONT.monoBold} fontSize={13} color={paper} letterSpacing={-0.3} />
      </View>
      {rows.map(([label, value]) => (
        <View key={label} style={styles.dataRow}>
          <Text style={[styles.rowLabel, { color: soft }]}>{label}</Text>
          <View style={[styles.leader, { borderColor: soft }]} />
          <NumericText value={value} family={NATIVE_FONT.monoBold} fontSize={12} color={ink} letterSpacing={-0.3} />
        </View>
      ))}
    </View>
  );
}

function RangeSwitch({
  range,
  ink,
  soft,
  labels,
  onChange,
}: {
  range: 'day' | 'week';
  ink: string;
  soft: string;
  labels: [string, string];
  onChange: (r: 'day' | 'week') => void;
}) {
  const on = range === 'week';
  return (
    <Pressable style={styles.range} hitSlop={10} onPress={() => onChange(on ? 'day' : 'week')}>
      <Text style={[styles.rangeText, { color: on ? soft : ink }]}>{labels[0]}</Text>
      <View style={[styles.switch, { backgroundColor: soft }]}>
        <View style={[styles.switchKnob, { backgroundColor: ink, alignSelf: on ? 'flex-end' : 'flex-start' }]} />
      </View>
      <Text style={[styles.rangeText, { color: on ? ink : soft }]}>{labels[1]}</Text>
    </Pressable>
  );
}

/** The week at a glance, in place of the hour bar */
function WeekRow({
  forecast,
  lang,
  ink,
  onPress,
}: {
  forecast: Forecast;
  lang: Lang;
  ink: string;
  onPress: () => void;
}) {
  const t = tr(lang);
  return (
    <Pressable onPress={onPress} style={styles.weekRow}>
      {forecast.days.map((d, i) => (
        <View key={d.time} style={styles.weekDay}>
          <Text style={[styles.weekName, { color: ink }]}>{i === 0 ? t.todayLabel : weekday(lang, d.time)}</Text>
          <SymbolView name={ICONS[kindOf(d)]} size={20} tintColor={ink} type="hierarchical" />
          <Text style={[styles.weekHigh, { color: ink }]}>{Math.round(d.high)}</Text>
          <Text style={[styles.weekLow, { color: ink }]}>{Math.round(d.low)}</Text>
        </View>
      ))}
    </Pressable>
  );
}

function Chip({
  dark,
  onPress,
  label,
  active,
  children,
}: {
  dark: boolean;
  onPress: () => void;
  label: string;
  active?: boolean;
  children: ReactNode;
}) {
  const content = <View style={styles.chipInner}>{children}</View>;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={6}>
      {GLASS ? (
        <GlassView isInteractive glassEffectStyle="regular" colorScheme={dark ? 'dark' : 'light'} style={styles.chip}>
          {content}
        </GlassView>
      ) : (
        <View
          style={[
            styles.chip,
            {
              backgroundColor: active
                ? 'rgba(127,127,127,0.35)'
                : dark
                  ? 'rgba(255,255,255,0.14)'
                  : 'rgba(255,255,255,0.7)',
            },
          ]}>
          {content}
        </View>
      )}
    </Pressable>
  );
}

function Pill({
  dark,
  ink,
  active,
  label,
  onPress,
}: {
  dark: boolean;
  ink: string;
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  const on = dark ? '#FFFFFF' : '#14181F';
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.pill,
        active
          ? { backgroundColor: on }
          : { backgroundColor: dark ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.72)' },
      ]}>
      <Text style={[styles.pillText, { color: active ? (dark ? '#14181F' : '#FFFFFF') : ink }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: 'hidden',
  },
  hint: {
    position: 'absolute',
    left: 0,
    right: 0,
    textAlign: 'center',
    fontFamily: FONT.display,
    fontSize: 17,
    letterSpacing: -0.4,
    color: '#FFFFFF',
    textShadowColor: 'rgba(0,0,0,0.45)',
    textShadowRadius: 8,
  },
  condition: {
    position: 'absolute',
    left: 24,
    right: 24,
    textAlign: 'center',
    fontFamily: FONT.display,
    fontSize: 28,
    letterSpacing: -1.1,
  },
  bar: {
    position: 'absolute',
    left: 40,
    right: 40,
  },
  credit: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    gap: 2,
  },
  creditSmall: {
    fontFamily: FONT.mono,
    fontSize: 8,
    letterSpacing: 1.2,
  },
  creditName: {
    fontFamily: FONT.monoBold,
    fontSize: 10,
    letterSpacing: 0.2,
  },
  titleBlock: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  stepLabel: {
    position: 'absolute',
    left: 0,
    right: 0,
    textAlign: 'center',
    fontFamily: FONT.monoBold,
    fontSize: 10,
    letterSpacing: 2,
  },
  title: {
    fontFamily: FONT.display,
    fontSize: 36,
    letterSpacing: -1.5,
    marginTop: 2,
  },
  card: {
    position: 'absolute',
    left: 36,
    right: 36,
  },
  headRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    height: 22,
    paddingHorizontal: 8,
    borderRadius: 6,
    borderCurve: 'continuous',
  },
  headLabel: {
    fontFamily: FONT.monoBold,
    fontSize: 11,
    letterSpacing: 0.4,
  },
  dataRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 22,
    paddingHorizontal: 8,
  },
  rowLabel: {
    fontFamily: FONT.mono,
    fontSize: 11,
    letterSpacing: 0.4,
  },
  leader: {
    flex: 1,
    marginHorizontal: 8,
    borderBottomWidth: 1,
    borderStyle: 'dotted',
    opacity: 0.45,
  },
  chartWrap: {
    marginTop: 10,
  },
  range: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 8,
    marginTop: 10,
  },
  rangeText: {
    fontFamily: FONT.monoBold,
    fontSize: 10,
    letterSpacing: 1,
  },
  switch: {
    width: 34,
    height: 18,
    borderRadius: 9,
    padding: 2,
  },
  switchKnob: {
    width: 14,
    height: 14,
    borderRadius: 7,
  },
  weekRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  weekDay: {
    alignItems: 'center',
    gap: 4,
  },
  weekName: {
    fontFamily: FONT.monoBold,
    fontSize: 9,
    letterSpacing: 0.6,
  },
  weekHigh: {
    fontFamily: FONT.monoBold,
    fontSize: 14,
  },
  weekLow: {
    fontFamily: FONT.mono,
    fontSize: 12,
    opacity: 0.55,
  },
  header: {
    position: 'absolute',
    left: 14,
    right: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  city: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  cityText: {
    fontFamily: FONT.display,
    fontSize: 16,
    letterSpacing: -0.5,
  },
  chip: {
    height: 40,
    minWidth: 40,
    borderRadius: 20,
    overflow: 'hidden',
  },
  chipInner: {
    height: 40,
    minWidth: 40,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  picker: {
    position: 'absolute',
    left: 0,
    right: 0,
    gap: 8,
  },
  pickerRow: {
    paddingHorizontal: 14,
    gap: 8,
  },
  pill: {
    height: 32,
    paddingHorizontal: 14,
    borderRadius: 16,
    justifyContent: 'center',
  },
  pillText: {
    fontFamily: FONT.bodyBold,
    fontSize: 13,
    letterSpacing: -0.1,
  },
  skin: {
    height: 34,
    paddingHorizontal: 10,
    borderRadius: 17,
    borderWidth: 1.5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  swatch: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.25)',
  },
  loading: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
});
