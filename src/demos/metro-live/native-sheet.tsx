import { TrueSheet, TrueSheetPeek } from '@lodev09/react-native-true-sheet';
import {
  ReanimatedTrueSheet,
  ReanimatedTrueSheetProvider,
  useReanimatedTrueSheet,
} from '@lodev09/react-native-true-sheet/reanimated';
import { useEffect, useRef, useState } from 'react';
import { Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Presets } from 'react-native-pulsar';
import Animated, {
  FadeIn,
  FadeOut,
  LinearTransition,
  useAnimatedReaction,
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
};

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
  const [searching, setSearching] = useState(false);
  const { animatedPosition } = useReanimatedTrueSheet();

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

  // A focus that lands while the JS thread is busy (the city is still being built) can miss
  // onFocus; the keyboard showing up for our field is the reliable signal
  useEffect(() => {
    const sub = Keyboard.addListener('keyboardWillShow', () => {
      if (input.current?.isFocused()) {
        setSearching(true);
        ref.current?.resize(LARGE);
      }
    });
    return () => sub.remove();
  }, []);

  const startSearch = () => {
    setSearching(true);
    ref.current?.resize(LARGE);
  };
  const endSearch = (detent: number) => {
    Keyboard.dismiss();
    input.current?.blur();
    setQuery('');
    setSearching(false);
    ref.current?.resize(detent);
  };
  const pickStation = (i: number) => {
    onStation(i);
    endSearch(0);
  };
  const pickTrain = (k: number) => {
    onTrain(k);
    if (searching) endSearch(MEDIUM);
  };

  // The keyboard lifts the sheet to the very top; keep clear of a side camera column while searching
  const cutoutPad = searching && !side ? sideInset : 0;
  const header = (
    <View style={[styles.header, { paddingRight: 16 + cutoutPad }]}>
      <View style={styles.searchField}>
        <SymbolView name="magnifyingglass" size={17} tintColor={MUTED} />
        <TextInput
          ref={input}
          value={query}
          onChangeText={setQuery}
          onFocus={startSearch}
          placeholder="Search stations"
          placeholderTextColor={MUTED}
          returnKeyType="search"
          autoCorrect={false}
          clearButtonMode="while-editing"
          style={styles.searchInput}
        />
      </View>
      {searching ? (
        <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(120)}>
          <Pressable onPress={() => endSearch(MEDIUM)} hitSlop={10}>
            <Text style={styles.cancel}>Cancel</Text>
          </Pressable>
        </Animated.View>
      ) : null}
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
      onDetentChange={() => Presets.System.selection()}>
      {/* A sibling above the ScrollView: the sheet pins the scroll view below it */}
      {header}
      <ScrollView
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.content, { paddingRight: 12 + cutoutPad }]}>
        {searching ? (
          <StationResults scene={scene} query={query} onPick={pickStation} />
        ) : (
          <>
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
            <Text style={styles.section}>Stations</Text>
            <StationResults scene={scene} query="" onPick={pickStation} />
            <Text style={styles.footnote}>
              Simulated live data · timetable sped up for the demo{'\n'}Map © OpenStreetMap contributors
            </Text>
          </>
        )}
      </ScrollView>
    </ReanimatedTrueSheet>
  );
}

/** Lowercase, accent-free text, so "ben thanh" finds "Bến Thành" */
const fold = (text: string) => toAscii(text).toLowerCase();

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
  const matches = STATIONS.map((s, i) => ({ s, i })).filter(
    ({ s }) => !q || fold(`${s.name} ${s.english ?? ''} ${s.code}`).includes(q)
  );
  if (matches.length === 0) {
    return (
      <Animated.View entering={FadeIn.duration(200)} style={styles.empty}>
        <SymbolView name="tram.fill" size={28} tintColor="#C4C9D0" />
        <Text style={styles.emptyTitle}>No stations match “{query.trim()}”</Text>
        <Text style={styles.emptySub}>Try a name without accents, like “thu duc”.</Text>
      </Animated.View>
    );
  }
  return (
    <>
      {matches.map(({ s, i }) => (
        <Animated.View key={s.code} layout={LinearTransition.springify().damping(22)} entering={FadeIn.duration(160)}>
          <StationRow index={i} scene={scene} query={q} onPress={() => onPick(i)} />
        </Animated.View>
      ))}
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

function StationRow({
  index,
  scene,
  query,
  onPress,
}: {
  index: number;
  scene: LiveScene | null;
  query: string;
  onPress: () => void;
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
    <Pressable onPress={onPress} style={({ pressed }) => [styles.stationRow, pressed && styles.pressed]}>
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
}

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
  cancel: {
    color: '#0A84FF',
    fontSize: 17,
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
