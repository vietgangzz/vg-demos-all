import { TrueSheet, TrueSheetPeek } from '@lodev09/react-native-true-sheet';
import {
  ReanimatedTrueSheet,
  ReanimatedTrueSheetProvider,
  useReanimatedTrueSheet,
} from '@lodev09/react-native-true-sheet/reanimated';
import { memo, startTransition, useDeferredValue, useEffect, useRef, useState } from 'react';
import { Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Presets } from 'react-native-pulsar';
import Animated, {
  Easing,
  FadeIn,
  interpolate,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { SymbolView } from 'expo-symbols';

import { NumericText } from '@/components/numeric-text';
import { LINE_1, STATIONS, toAscii } from '@/demos/metro/line-1';

import { TRAIN_COUNT, type LiveScene } from './scene';
import { StatusRows, useLineKey } from './status';
import { GREEN, INK, MUTED } from './theme';

/** Collapsed (search + your train), half, full. The system caps a sheet at three detents. */
const DETENTS = ['peek', 0.5, 1] as const;
const MEDIUM = 1;
const LARGE = 2;
const GRABBER = { width: 36, height: 5, topMargin: 7 };

type Props = {
  scene: LiveScene | null;
  follow: number | null;
  onTrain: (k: number) => void;
  onStation: (i: number) => void;
  /** Sheet height the camera frames around (capped, so a full sheet doesn't shove the map away) */
  sheet: SharedValue<number>;
  /** Real visible height, for controls that ride on top of the sheet */
  sheetVisible: SharedValue<number>;
  screenHeight: number;
  topInset: number;
  bottomInset: number;
  /** Right safe-area inset: on iPhone Duo's cover screen the camera and status bar sit in a column there */
  sideInset: number;
  /** Width of a side sheet on wide layouts (0 = bottom sheet) */
  sideWidth: number;
  /** Side layout: where the sheet's column starts, below the header card */
  sideTop: number;
  /** Detent the sheet is heading for or rests at (0 collapsed, 1 half, 2 full; -1 while dragged) */
  onDetent?: (index: number) => void;
};

/** iOS-like ease for the search field and Cancel */
const EASE = Easing.bezier(0.25, 0.1, 0.25, 1);
/** Room the Cancel button takes beside the search field */
const CANCEL_W = 68;

/**
 * Apple Maps-style status sheet on a real UISheetPresentationController (TrueSheet):
 * the map stays interactive under the small and half detents, Liquid Glass on iOS 26,
 * and the search field expands the sheet to full height like Maps does.
 */
export function NativeStatusSheet(props: Props) {
  return (
    <ReanimatedTrueSheetProvider>
      <SheetBody {...props} />
    </ReanimatedTrueSheetProvider>
  );
}

/** Height of the camera / status column at the top right of iPhone Duo when unfolded */
const SIDE_CUTOUT_HEIGHT = 172;

function SheetBody({
  scene,
  follow,
  onTrain,
  onStation,
  sheet,
  sheetVisible,
  screenHeight,
  topInset,
  bottomInset,
  sideInset,
  sideWidth,
  sideTop,
  onDetent,
}: Props) {
  const side = sideWidth > 0;
  // With a side cutout the full-height sheet would slide under it, so it stops just below
  // (the sheet adds the bottom safe area on top of this height)
  const maxContentHeight = side
    ? screenHeight - sideTop - bottomInset
    : sideInset > 0
      ? screenHeight - Math.max(topInset, SIDE_CUTOUT_HEIGHT) - bottomInset
      : undefined;
  const ref = useRef<TrueSheet>(null);
  const input = useRef<TextInput>(null);
  const [query, setQuery] = useState('');
  // Typing never waits for the results list: it filters a frame later, at low priority
  const deferredQuery = useDeferredValue(query);
  const [searching, setSearching] = useState(false);
  const searchProgress = useSharedValue(0);
  const { animatedPosition } = useReanimatedTrueSheet();

  useEffect(() => {
    searchProgress.set(withTiming(searching ? 1 : 0, { duration: 260, easing: EASE }));
  }, [searching, searchProgress]);

  // The native sheet reports its top edge on the UI thread; turn it into a visible height
  useAnimatedReaction(
    () => animatedPosition.get(),
    (y) => {
      if (y <= 0) return;
      const visible = Math.max(0, screenHeight - y);
      sheetVisible.set(visible);
      // A side sheet leaves the full height to the map; the camera shifts sideways instead
      sheet.set(side ? 0 : Math.min(visible, screenHeight * 0.62));
    }
  );

  const goTo = (detent: number) => {
    onDetent?.(detent);
    ref.current?.resize(detent);
  };

  const startSearch = () => {
    if (searching) return;
    goTo(LARGE);
    // The sheet and keyboard start moving first; the list switches over in the next frames
    startTransition(() => setSearching(true));
  };

  // A focus that lands while the JS thread is busy (the city is still being built) can miss
  // onFocus; the keyboard showing up for our field is the reliable signal
  const startSearchRef = useRef(startSearch);
  useEffect(() => {
    startSearchRef.current = startSearch;
  });
  useEffect(() => {
    const sub = Keyboard.addListener('keyboardWillShow', () => {
      if (input.current?.isFocused()) startSearchRef.current();
    });
    return () => sub.remove();
  }, []);

  const endSearch = (detent: number, then?: () => void) => {
    Keyboard.dismiss();
    input.current?.blur();
    input.current?.clear();
    // Spread the work over consecutive frames so none of them stalls: the 3D scene resumes
    // under the still-covering sheet, then the live status comes back (the collapsed detent
    // measures "Your train"), then the sheet moves, then the camera sets off
    onDetent?.(detent);
    requestAnimationFrame(() => {
      setQuery('');
      setSearching(false);
      requestAnimationFrame(() => {
        ref.current?.resize(detent);
        if (then) setTimeout(then, 120);
      });
    });
  };
  const pickStation = (i: number) => {
    Presets.System.selection();
    endSearch(0, () => onStation(i));
  };
  const pickTrain = (k: number) => {
    onTrain(k);
    if (searching) endSearch(MEDIUM);
  };
  const onSubmit = () => {
    const first = matchStations(query)[0];
    if (first !== undefined) pickStation(first);
  };

  // The field shortens to make room for Cancel, which slides in from the right
  const fieldStyle = useAnimatedStyle(() => ({ marginRight: searchProgress.get() * CANCEL_W }));
  const cancelStyle = useAnimatedStyle(() => ({
    opacity: searchProgress.get(),
    transform: [{ translateX: interpolate(searchProgress.get(), [0, 1], [CANCEL_W * 0.6, 0]) }],
  }));
  // Live status fades out as the results take over
  const statusStyle = useAnimatedStyle(() => ({ opacity: 1 - searchProgress.get() }));

  // The keyboard lifts the sheet to the very top; keep clear of a side camera column while searching
  const cutoutPad = searching && !side ? sideInset : 0;
  const header = (
    <View style={[styles.header, { paddingRight: 16 + cutoutPad }]}>
      <Animated.View style={[styles.searchField, fieldStyle]}>
        <SymbolView name="magnifyingglass" size={17} tintColor={MUTED} />
        <TextInput
          ref={input}
          // Uncontrolled: the native field never waits for a React round trip while typing
          defaultValue=""
          onChangeText={setQuery}
          onFocus={startSearch}
          onSubmitEditing={onSubmit}
          placeholder="Search stations"
          placeholderTextColor={MUTED}
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
          clearButtonMode="while-editing"
          style={styles.searchInput}
        />
      </Animated.View>
      <Animated.View
        pointerEvents={searching ? 'auto' : 'none'}
        style={[styles.cancelSlot, { right: 16 + cutoutPad }, cancelStyle]}>
        <Pressable onPress={() => endSearch(MEDIUM)} hitSlop={10}>
          <Text style={styles.cancel}>Cancel</Text>
        </Pressable>
      </Animated.View>
    </View>
  );

  return (
    <ReanimatedTrueSheet
      ref={ref}
      name="line-status"
      detents={[...DETENTS]}
      initialDetentIndex={MEDIUM}
      maxContentHeight={maxContentHeight}
      anchor={side ? 'left' : 'center'}
      // Frosted glass rather than clear: text stays readable over water and busy streets
      backgroundBlur="system-thick-material-light"
      backgroundColor="rgba(250, 251, 253, 0.55)"
      maxContentWidth={side ? sideWidth : undefined}
      dismissible={false}
      // The iOS 27 system grabber is long and thin; a compact pill reads better on glass
      grabberOptions={GRABBER}
      dimmedDetentIndex={LARGE}
      scrollable
      scrollableOptions={{ topScrollEdgeEffect: 'soft' }}
      onDetentChange={(e) => {
        Presets.System.selection();
        onDetent?.(e.nativeEvent.index);
      }}
      // A drag away from full height brings the map (and its rendering) back straight away
      onDragBegin={() => onDetent?.(-1)}>
      {/* A sibling above the ScrollView: the sheet pins the scroll view below it */}
      {header}
      <ScrollView
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.content, { paddingRight: 12 + cutoutPad }]}>
        {/* Everything stays mounted: searching only hides the live status and filters the
            station rows, so focusing the field or typing never rebuilds the list */}
        <Animated.View style={[searching && styles.hidden, statusStyle]}>
          <TrueSheetPeek>
            <Text style={styles.section}>Your train</Text>
            {scene ? (
              <StatusRows scene={scene} follow={follow} onPress={pickTrain} only="mine" />
            ) : (
              <View style={styles.placeholderRow} />
            )}
          </TrueSheetPeek>
          <Text style={styles.section}>Line status · {TRAIN_COUNT} trains</Text>
          {scene ? <StatusRows scene={scene} follow={follow} onPress={pickTrain} only="others" /> : null}
        </Animated.View>
        <Text style={styles.section}>{searching && deferredQuery.trim() ? 'Results' : 'Stations'}</Text>
        <StationResults scene={scene} query={searching ? deferredQuery : ''} onPick={pickStation} />
        {searching ? null : (
          <Text style={styles.footnote}>
            Simulated live data · timetable sped up for the demo{'\n'}Map © OpenStreetMap contributors
          </Text>
        )}
      </ScrollView>
    </ReanimatedTrueSheet>
  );
}

/** Lowercase, accent-free text, so "ben thanh" finds "Bến Thành" */
const fold = (text: string) => toAscii(text).toLowerCase();
const SEARCH_TEXT = STATIONS.map((s) => fold(`${s.name} ${s.english ?? ''} ${s.code}`));

/** Indices of the stations matching `query` (all of them for an empty query) */
function matchStations(query: string) {
  const q = fold(query.trim());
  return STATIONS.map((_, i) => i).filter((i) => !q || SEARCH_TEXT[i].includes(q));
}

function StationResults({
  scene,
  query,
  onPick,
}: {
  scene: LiveScene | null;
  query: string;
  onPick: (i: number) => void;
}) {
  const q = fold(query.trim());
  const visible = new Set(matchStations(query));
  return (
    <>
      {/* Rows that don't match are hidden, not unmounted: their live countdowns keep running */}
      {STATIONS.map((s, i) => (
        <StationRow
          key={s.code}
          index={i}
          scene={scene}
          query={visible.has(i) ? q : ''}
          hidden={!visible.has(i)}
          onPick={onPick}
        />
      ))}
      {visible.size === 0 ? (
        <Animated.View entering={FadeIn.duration(180)} style={styles.empty}>
          <SymbolView name="tram.fill" size={28} tintColor="#C4C9D0" />
          <Text style={styles.emptyTitle}>No stations match “{query.trim()}”</Text>
          <Text style={styles.emptySub}>Try a name without accents, like “thu duc”.</Text>
        </Animated.View>
      ) : null}
    </>
  );
}

/** Splits `name` around the folded query match so the matched part can be bolded */
function highlight(name: string, q: string) {
  const at = q ? fold(name).indexOf(q) : -1;
  // toAscii keeps one character per precomposed letter, so indices line up with the original
  if (at < 0) return [name, '', ''] as const;
  return [name.slice(0, at), name.slice(at, at + q.length), name.slice(at + q.length)] as const;
}

const StationRow = memo(function StationRow({
  index,
  scene,
  query,
  hidden,
  onPick,
}: {
  index: number;
  scene: LiveScene | null;
  query: string;
  hidden: boolean;
  onPick: (i: number) => void;
}) {
  const station = STATIONS[index];
  // "here" while a train is boarding, otherwise seconds until the next arrival from either side
  const live = useLineKey((now) => {
    if (!scene) return '';
    let next = Infinity;
    for (let k = 0; k < TRAIN_COUNT; k++) {
      const s = scene.timetable.stateAt(now, k);
      if (s.station !== index) continue;
      if (s.phase === 'dwell') return 'here';
      next = Math.min(next, Math.ceil(s.remaining));
    }
    return next === Infinity ? '' : `${Math.floor(next / 60)}:${String(next % 60).padStart(2, '0')}`;
  });
  const [before, match, after] = highlight(station.name, query);
  const meta = [
    station.english,
    station.underground ? 'Underground' : 'Elevated',
    station.minutes === 0 ? 'Terminus' : `${station.minutes} min from Bến Thành`,
  ].filter(Boolean);

  return (
    <Pressable
      onPress={() => onPick(index)}
      style={({ pressed }) => [styles.stationRow, pressed && styles.pressed, hidden && styles.hidden]}>
      <View style={styles.code}>
        <Text style={styles.codeText}>{station.code}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.stationName} numberOfLines={1}>
          {before}
          <Text style={match ? styles.match : undefined}>{match}</Text>
          {after}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {meta.join(' · ')}
        </Text>
      </View>
      {live === 'here' ? (
        <Animated.View entering={FadeIn.duration(200)} style={styles.herePill}>
          <View style={styles.hereDot} />
          <Text style={styles.hereText}>Boarding</Text>
        </Animated.View>
      ) : live ? (
        <View style={styles.eta}>
          <NumericText value={live} fontSize={15} color={INK} countsDown />
          <Text style={styles.etaLabel}>next train</Text>
        </View>
      ) : null}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingTop: 18,
    paddingHorizontal: 16,
    paddingBottom: 6,
  },
  searchField: {
    flex: 1,
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    borderRadius: 22,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(118, 118, 128, 0.12)',
  },
  searchInput: {
    flex: 1,
    height: 44,
    color: INK,
    fontSize: 17,
  },
  cancelSlot: {
    position: 'absolute',
    top: 18,
    height: 44,
    justifyContent: 'center',
  },
  cancel: {
    color: '#0A84FF',
    fontSize: 17,
  },
  hidden: {
    display: 'none',
  },
  content: {
    paddingHorizontal: 12,
    paddingBottom: 40,
  },
  section: {
    color: MUTED,
    fontSize: 13,
    fontWeight: 600,
    paddingHorizontal: 8,
    paddingTop: 14,
    paddingBottom: 4,
  },
  placeholderRow: {
    height: 72,
  },
  stationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 14,
    borderCurve: 'continuous',
  },
  pressed: {
    backgroundColor: 'rgba(118, 118, 128, 0.12)',
  },
  code: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: LINE_1.color,
  },
  codeText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: 800,
    fontVariant: ['tabular-nums'],
  },
  stationName: {
    color: INK,
    fontSize: 16,
    fontWeight: 500,
  },
  match: {
    fontWeight: 800,
  },
  meta: {
    color: MUTED,
    fontSize: 13,
    marginTop: 1,
  },
  herePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 11,
    backgroundColor: 'rgba(31, 163, 91, 0.14)',
  },
  hereDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: GREEN,
  },
  hereText: {
    color: GREEN,
    fontSize: 12,
    fontWeight: 700,
  },
  eta: {
    alignItems: 'flex-end',
  },
  etaLabel: {
    color: MUTED,
    fontSize: 11,
  },
  empty: {
    alignItems: 'center',
    gap: 6,
    paddingTop: 48,
  },
  emptyTitle: {
    color: INK,
    fontSize: 16,
    fontWeight: 600,
    marginTop: 6,
  },
  emptySub: {
    color: MUTED,
    fontSize: 13,
  },
  footnote: {
    color: '#9AA1AA',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 18,
  },
});
