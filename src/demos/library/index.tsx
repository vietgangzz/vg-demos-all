import {
  Button,
  ContentUnavailableView,
  Group,
  HStack,
  Host,
  Image,
  Label,
  List,
  Menu,
  NavigationSplitView,
  Section,
  Spacer,
  SwipeActions,
  Text,
  Toolbar,
  ToolbarItem,
  useNativeState,
  VStack,
  ZStack,
} from '@expo/ui/swift-ui';
import {
  animation,
  Animation,
  badge,
  contentShape,
  contentTransition,
  font,
  foregroundStyle,
  frame,
  geometryGroup,
  glassEffect,
  lineLimit,
  listRowSeparator,
  listStyle,
  monospacedDigit,
  navigationTitle,
  onGeometryChange,
  offset,
  opacity,
  onTapGesture,
  padding,
  scrollEdgeEffectStyle,
  searchable,
  shapes,
  symbolEffect,
  tag,
  tint,
  type ShapeStyle,
} from '@expo/ui/swift-ui/modifiers';
import { router } from 'expo-router';
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Keyboard, useWindowDimensions, View } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import { Presets } from 'react-native-pulsar';

import { Art } from './art';
import { PerfHud, type HudMode } from './hud';
import { Player, type Rect } from './player';
import { playback, useElapsed, usePlayback } from './playback';
import { clock, inOrder, MOODS, SONG_COUNT, type Mood, type Order, type Song } from './songs';

type Source = 'all' | 'recent' | 'loved' | Mood;

const SECONDARY: ShapeStyle = { type: 'hierarchical', style: 'secondary' };

/** 10000 as "10,000" */
const thousands = (n: number) => n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');

// ---- Rows ----

/** How many rows are mounted right now, out of all the songs: the recycling, made visible */
let liveRows = 0;
const countRows = () => liveRows;

type RowProps = {
  song: Song;
  current: boolean;
  playing: boolean;
  loved: boolean;
  onPlay: (song: Song) => void;
  onLove: (song: Song) => void;
};

function Row({ song, current, playing, loved, onPlay, onLove }: RowProps) {
  useEffect(() => {
    liveRows++;
    return () => {
      liveRows--;
    };
  }, []);

  return (
    <SwipeActions>
      <HStack
        spacing={12}
        modifiers={[geometryGroup(), contentShape(shapes.rectangle()), onTapGesture(() => onPlay(song))]}>
        <Art album={song.album} size={46} radius={9} />
        <VStack alignment="leading" spacing={3}>
          <Text
            modifiers={[
              font({ textStyle: 'body', weight: current ? 'semibold' : 'regular' }),
              lineLimit(1),
              ...(current ? [foregroundStyle(song.album.colours[1])] : []),
            ]}>
            {song.title}
          </Text>
          <Text modifiers={[font({ textStyle: 'subheadline' }), foregroundStyle(SECONDARY), lineLimit(1)]}>
            {`${song.album.artist} · ${song.album.title}`}
          </Text>
        </VStack>
        <Spacer />
        {current ? (
          <Image
            systemName="waveform"
            size={17}
            color={song.album.colours[1]}
            modifiers={
              playing
                ? [
                    symbolEffect(
                      { effect: 'variableColor', fillStyle: 'iterative' },
                      { options: { repeat: 'continuous' } }
                    ),
                  ]
                : []
            }
          />
        ) : loved ? (
          <Image systemName="heart.fill" size={13} color="#FF2D55" />
        ) : null}
        <Text modifiers={[font({ textStyle: 'subheadline' }), monospacedDigit(), foregroundStyle(SECONDARY)]}>
          {clock(song.seconds)}
        </Text>
      </HStack>
      <SwipeActions.Actions edge="leading">
        <Button
          label="Play Next"
          systemImage="text.line.first.and.arrowtriangle.forward"
          onPress={() => {
            Presets.System.impactMedium();
            playback.playNext(song);
          }}
          modifiers={[tint('#5E5CE6')]}
        />
      </SwipeActions.Actions>
      <SwipeActions.Actions edge="trailing">
        <Button
          label={loved ? 'Unlove' : 'Love'}
          systemImage={loved ? 'heart.slash' : 'heart'}
          onPress={() => onLove(song)}
          modifiers={[tint('#FF2D55')]}
        />
      </SwipeActions.Actions>
    </SwipeActions>
  );
}

/** "10,000 songs · 24 rows live", kept up to date on its own so the list never re-renders for it */
function LiveCount({ total }: { total: number }) {
  const [rows, setRows] = useState(liveRows);
  useEffect(() => {
    const timer = setInterval(() => setRows(liveRows), 300);
    return () => clearInterval(timer);
  }, []);
  return (
    <Text
      modifiers={[
        font({ textStyle: 'footnote' }),
        monospacedDigit(),
        contentTransition('numericText'),
        animation(Animation.snappy(), rows + total),
      ]}>
      {`${thousands(total)} ${total === 1 ? 'song' : 'songs'} · ${rows} rows live`}
    </Text>
  );
}

// ---- Now playing ----

type MiniProps = {
  onOpen: () => void;
  away: boolean;
  /** While the player is open, its cover is the player's, so this one steps aside */
  lent: boolean;
  onCover: (frame: Rect) => void;
};

function MiniPlayer({ onOpen, away, lent, onCover }: MiniProps) {
  const { song, playing } = usePlayback();
  const t = useElapsed();
  if (!song) return null;
  return (
    <HStack
      spacing={12}
      modifiers={[
        padding({ leading: 8, trailing: 14, vertical: 8 }),
        glassEffect({ glass: { variant: 'regular', interactive: true }, shape: 'capsule' }),
        contentShape(shapes.capsule()),
        onTapGesture(onOpen),
        padding({ horizontal: 16, bottom: 10 }),
        // Out of the way of the search field while you type
        offset({ y: away ? 140 : 0 }),
        opacity(away ? 0 : 1),
        animation(Animation.snappy(), away),
      ]}>
      <Group modifiers={[onGeometryChange(onCover), opacity(lent ? 0 : 1)]}>
        <Art album={song.album} size={40} radius={20} />
      </Group>
      <VStack alignment="leading" spacing={1} modifiers={[frame({ maxWidth: 1000, alignment: 'leading' })]}>
        <Text modifiers={[font({ textStyle: 'subheadline', weight: 'semibold' }), lineLimit(1)]}>{song.title}</Text>
        <Text modifiers={[font({ textStyle: 'caption' }), monospacedDigit(), foregroundStyle(SECONDARY), lineLimit(1)]}>
          {`${song.album.artist} · ${clock(t)}`}
        </Text>
      </VStack>
      <Image
        systemName={playing ? 'pause.fill' : 'play.fill'}
        size={19}
        modifiers={[frame({ width: 30, height: 30 }), contentShape(shapes.rectangle())]}
        onPress={() => {
          Presets.System.impactLight();
          playback.toggle();
        }}
      />
      <Image
        systemName="forward.fill"
        size={19}
        modifiers={[frame({ width: 30, height: 30 }), contentShape(shapes.rectangle())]}
        onPress={() => {
          Presets.System.impactLight();
          playback.next();
        }}
      />
    </HStack>
  );
}

// ---- The screen ----

const ORDERS: { id: Order; title: string; symbol: string }[] = [
  { id: 'title', title: 'Title', symbol: 'textformat' },
  { id: 'artist', title: 'Artist', symbol: 'person' },
  { id: 'added', title: 'Recently Added', symbol: 'clock' },
];

const HUD_MODES: { id: HudMode; title: string; symbol: string }[] = [
  { id: 'off', title: 'Hidden', symbol: 'eye.slash' },
  { id: 'compact', title: 'Compact', symbol: 'capsule' },
  { id: 'full', title: 'Detailed', symbol: 'chart.bar.xaxis' },
];

export default function Library() {
  const [source, setSource] = useState<Source>('all');
  const [column, setColumn] = useState<'sidebar' | 'content' | 'detail'>('detail');
  const [order, setOrder] = useState<Order>('added');
  const [loved, setLoved] = useState<ReadonlySet<string>>(() => new Set());
  const [open, setOpen] = useState(false);
  const [lent, setLent] = useState(false);
  const [hud, setHud] = useState<HudMode>('compact');
  const cover = useSharedValue<Rect>({ x: 0, y: 0, width: 40, height: 40 });
  const openPlayer = () => {
    Presets.System.impactLight();
    setLent(true);
    setOpen(true);
  };
  const closedPlayer = () => {
    setOpen(false);
    setLent(false);
  };
  const search = useNativeState('');
  const [query, setQuery] = useState('');
  const typed = useDeferredValue(query.trim().toLowerCase());
  const { song: current, playing } = usePlayback();

  const songs = useMemo(() => {
    let list = inOrder(source === 'recent' ? 'added' : order);
    if (source === 'recent') list = list.slice(0, 250);
    else if (source === 'loved') list = list.filter((s) => loved.has(s.id));
    else if (source !== 'all') list = list.filter((s) => s.mood === source);
    if (typed) {
      list = list.filter(
        (s) =>
          s.title.toLowerCase().includes(typed) ||
          s.album.artist.toLowerCase().includes(typed) ||
          s.album.title.toLowerCase().includes(typed)
      );
    }
    return list;
  }, [source, order, loved, typed]);

  const title =
    source === 'all'
      ? 'Songs'
      : source === 'recent'
        ? 'Recently Added'
        : source === 'loved'
          ? 'Loved'
          : MOODS.find((m) => m.id === source)!.title;

  const play = useCallback(
    (song: Song) => {
      Presets.System.selection();
      playback.play(song, songs);
    },
    [songs]
  );

  const love = useCallback((song: Song) => {
    Presets.System.impactLight();
    setLoved((was) => {
      const next = new Set(was);
      if (next.has(song.id)) next.delete(song.id);
      else next.add(song.id);
      return next;
    });
  }, []);

  const currentId = current?.id;
  const renderRow = useCallback(
    ({ item }: { item: Song }) => (
      <Row
        song={item}
        current={item.id === currentId}
        playing={playing}
        loved={loved.has(item.id)}
        onPlay={play}
        onLove={love}
      />
    ),
    [currentId, playing, loved, play, love]
  );

  const choose = (next: Source) => {
    Presets.System.selection();
    setSource(next);
    setColumn('detail');
  };
  // Folded, the sidebar is a screen of its own: back on it nothing is picked, so tapping the
  // same row again opens it again. Unfolded it sits beside the songs and keeps its pick.
  const picked = column === 'sidebar' ? [] : [source];
  const { width } = useWindowDimensions();
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    const shown = Keyboard.addListener('keyboardWillShow', () => setTyping(true));
    const hidden = Keyboard.addListener('keyboardWillHide', () => setTyping(false));
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);
  const wide = width >= 600;

  return (
    <View style={{ flex: 1 }}>
      <Host style={{ flex: 1 }}>
        <NavigationSplitView preferredCompactColumn={column} onPreferredCompactColumnChange={setColumn}>
          <NavigationSplitView.Sidebar>
            <Toolbar>
              <List
                // Unfolding hands the sidebar a fresh selection, so the list is made anew for each
                // width and shows its pick again
                key={wide ? 'wide' : 'narrow'}
                selection={picked}
                onSelectionChange={(chosen) => {
                  const next = chosen[0];
                  if (typeof next === 'string') choose(next as Source);
                }}
                modifiers={[listStyle('sidebar'), navigationTitle('Library')]}>
                <Section title="Library">
                  <Label
                    title="Songs"
                    systemImage="music.note"
                    modifiers={[tag('all'), badge(thousands(SONG_COUNT))]}
                  />
                  <Label title="Recently Added" systemImage="clock" modifiers={[tag('recent')]} />
                  <Label
                    title="Loved"
                    systemImage="heart"
                    modifiers={[tag('loved'), ...(loved.size ? [badge(String(loved.size))] : [])]}
                  />
                </Section>
                <Section title="Moods">
                  {MOODS.map((m) => (
                    <Label key={m.id} title={m.title} systemImage={m.symbol as 'leaf'} modifiers={[tag(m.id)]} />
                  ))}
                </Section>
              </List>
              <Toolbar.Content>
                <ToolbarItem placement="topBarLeading">
                  <Button label="Close" systemImage="xmark" onPress={() => router.back()} />
                </ToolbarItem>
              </Toolbar.Content>
            </Toolbar>
          </NavigationSplitView.Sidebar>

          <NavigationSplitView.Detail>
            <Toolbar>
              <ZStack alignment="bottom">
                <List
                  modifiers={[
                    listStyle('plain'),
                    navigationTitle(title),
                    searchable(search, { prompt: 'Songs, artists, albums', onChange: setQuery }),
                    scrollEdgeEffectStyle('soft', 'top'),
                  ]}>
                  <Section header={<LiveCount total={songs.length} />}>
                    <List.ForEach data={songs} keyExtractor={(s) => s.id} estimatedItemSize={62}>
                      {renderRow}
                    </List.ForEach>
                  </Section>
                  {songs.length === 0 ? (
                    typed ? (
                      <ContentUnavailableView
                        title={`No Results for “${query.trim()}”`}
                        systemImage="magnifyingglass"
                        description="Check the spelling or try a new search."
                        modifiers={[listRowSeparator('hidden')]}
                      />
                    ) : (
                      <ContentUnavailableView
                        title="No Loved Songs Yet"
                        systemImage="heart"
                        description="Swipe left on a song and tap Love to keep it here."
                        modifiers={[listRowSeparator('hidden')]}
                      />
                    )
                  ) : null}
                </List>
                <MiniPlayer onOpen={openPlayer} away={typing} lent={lent} onCover={(frame) => cover.set(frame)} />
              </ZStack>
              <Toolbar.Content>
                <ToolbarItem placement="topBarTrailing">
                  <Menu label="Performance" systemImage="gauge.with.dots.needle.67percent">
                    {HUD_MODES.map((m) => (
                      <Button
                        key={m.id}
                        label={m.title}
                        systemImage={(hud === m.id ? 'checkmark' : m.symbol) as 'eye.slash'}
                        onPress={() => {
                          Presets.System.selection();
                          setHud(m.id);
                        }}
                      />
                    ))}
                  </Menu>
                </ToolbarItem>
                <ToolbarItem placement="topBarTrailing">
                  <Menu label="Sort" systemImage="arrow.up.arrow.down">
                    {ORDERS.map((o) => (
                      <Button
                        key={o.id}
                        label={o.title}
                        systemImage={(order === o.id ? 'checkmark' : o.symbol) as 'clock'}
                        onPress={() => {
                          Presets.System.selection();
                          setOrder(o.id);
                        }}
                      />
                    ))}
                  </Menu>
                </ToolbarItem>
              </Toolbar.Content>
            </Toolbar>
          </NavigationSplitView.Detail>
        </NavigationSplitView>
      </Host>
      <Player open={open} from={cover} onClosed={closedPlayer} />
      {hud !== 'off' ? (
        <PerfHud mode={hud} onModeChange={setHud} rows={countRows} total={SONG_COUNT} shown={songs.length} />
      ) : null}
    </View>
  );
}
