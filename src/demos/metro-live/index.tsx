import { useEffect, useRef, useState } from 'react';
import { PixelRatio, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Presets } from 'react-native-pulsar';
import Animated, {
  Easing,
  FadeIn,
  interpolateColor,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withDecay,
  withRepeat,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Canvas, type CanvasRef } from 'react-native-webgpu';
import { scheduleOnRN } from 'react-native-worklets';

import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { SymbolView } from 'expo-symbols';

import { LINE_1, STATIONS } from '@/demos/metro/line-1';
import { GlassButton } from '@/components/glass-button';
import { useSound } from '@/hooks/use-sound';

import {
  createLiveScene,
  BASE_YAW,
  DEFAULT_PITCH,
  OVERVIEW_ZOOM,
  PITCH_RANGE,
  TRAIN_COUNT,
  YOUR_TRAIN,
  type FrameInfo,
  type LiveScene,
} from './scene';
import { LoadingOverlay } from './loading';
import { NativeStatusSheet } from './native-sheet';
import { useCountdown, useLineKey } from './status';
import { GREEN, INK, MUTED, SPRING } from './theme';

const PIN_W = 180;
const GLASS = isLiquidGlassAvailable();
/** Space between the floating buttons and the sheet (the reported position sits under the glass edge) */
const FLOAT_GAP = 30;
/** Wide screens (iPhone Duo unfolded, landscape) put the sheet at the side, like Maps on iPad */
const SIDE_SHEET_WIDTH = 380;
/** Header capsule height (badge 34 + padding 2 × 8) */
const HEADER_HEIGHT = 50;
/** Width of the map control capsule, and the height of each of its buttons */
const MAP_CONTROL = 46;
/** Left strip the map pan ignores, so the edge swipe goes back */
const EDGE_SWIPE = 24;

/** Wall clock for gesture worklets (tap-then-drag detection) */
const clockMs = () => {
  'worklet';
  return Date.now();
};

export default function MetroLive() {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const canvasRef = useRef<CanvasRef>(null);
  const [scene, setScene] = useState<LiveScene | null>(null);
  // The loader stays up until the first frame is on screen, not just until the scene exists
  const [rendered, setRendered] = useState(false);
  const [follow, setFollow] = useState<number | null>(YOUR_TRAIN);
  const [overviewOn, setOverviewOn] = useState(false);
  const [isNight, setIsNight] = useState(false);
  const panX = useSharedValue(0);
  const panZ = useSharedValue(0);
  const zoom = useSharedValue(1);
  const zoomStart = useSharedValue(1);
  const zoomStep = useSharedValue(0);
  const yaw = useSharedValue(0);
  const pitch = useSharedValue(DEFAULT_PITCH);
  const rotationStart = useSharedValue(0);
  const lastTapAt = useSharedValue(0);
  const zoomDrag = useSharedValue(false);
  const frame = useSharedValue<FrameInfo>({ stations: [], trains: [] });

  // Native sheet heights: the camera frames around `sheet` (capped), controls ride `sheetVisible`
  const sheet = useSharedValue(Math.round(height * 0.5));
  const sheetVisible = useSharedValue(Math.round(height * 0.5));
  const sideLayout = width > height && width >= 700;
  // Read by the render loop every frame, so a fold or rotation re-centres the camera
  const sideRef = useRef(0);
  useEffect(() => {
    sideRef.current = sideLayout ? SIDE_SHEET_WIDTH + 16 + insets.left : 0;
  }, [sideLayout, insets.left]);

  useEffect(() => {
    let live: LiveScene | null = null;
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
      live = createLiveScene(context, device, {
        panX,
        panZ,
        zoom,
        sheet,
        side: { get: () => sideRef.current },
        yaw,
        pitch,
      });
      let first = true;
      live.setOnFrame((info) => {
        frame.set(info);
        if (first) {
          first = false;
          setRendered(true);
        }
      });
      // Dev builds expose the scene for QA: metroScene.lookAt(x, z, zoom)
      if (__DEV__) (globalThis as { metroScene?: LiveScene }).metroScene = live;
      setScene(live);
    })();
    return () => {
      cancelled = true;
      live?.dispose();
    };
  }, [panX, panZ, zoom, sheet, yaw, pitch, frame]);

  // The scene follows the toggle, including a scene recreated after a remount
  useEffect(() => {
    scene?.setNight(isNight);
  }, [scene, isNight]);

  const focusTrain = (k: number) => {
    Presets.System.selection();
    scene?.setFollow(k);
    setFollow(k);
    setOverviewOn(false);
  };
  const focusStation = (i: number) => {
    Presets.System.impactLight();
    scene?.focusStation(i);
    setFollow(null);
    setOverviewOn(false);
  };
  const overview = () => {
    Presets.System.impactLight();
    scene?.showOverview();
    setFollow(null);
    setOverviewOn(true);
  };
  const toggleNight = () => {
    Presets.System.impactMedium();
    setIsNight((n) => !n);
  };
  const freePan = () => {
    setFollow(null);
    setOverviewOn(false);
  };

  // ---- Map gestures ----
  // 1 finger: pan (with fling) · double-tap: zoom in · double-tap + drag: zoom like Maps
  // 2 fingers: pinch to zoom, twist or drag sideways to orbit, drag up/down to tilt
  // 2-finger tap: zoom out
  const worldPerPoint = () => {
    'worklet';
    return 0.05 * zoom.get();
  };
  /** Ground-plane axes of the screen for the current orbit angle */
  const screenAxes = () => {
    'worklet';
    const a = BASE_YAW + yaw.get();
    const fx = -Math.cos(a);
    const fz = -Math.sin(a);
    return { fx, fz, rx: -fz, rz: fx };
  };
  const setZoom = (z: number, animated: boolean) => {
    'worklet';
    const clamped = Math.min(OVERVIEW_ZOOM * 1.15, Math.max(0.35, z));
    zoom.set(animated ? withSpring(clamped, SPRING) : clamped);
    // Detents on a log scale: the same pinch feels the same close up and across the whole city
    const step = Math.round(Math.log2(clamped) * 3);
    if (step !== zoomStep.get()) {
      zoomStep.set(step);
      Presets.System.selection();
    }
  };

  const tapMarker = Gesture.Tap()
    .maxDuration(220)
    .onEnd(() => {
      lastTapAt.set(clockMs());
    });
  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      setZoom(zoom.get() * 0.6, true);
    });
  const twoFingerTap = Gesture.Tap()
    .minPointers(2)
    .onEnd(() => {
      setZoom(zoom.get() / 0.6, true);
    });
  const pan = Gesture.Pan()
    .maxPointers(1)
    // Leave the left edge to the system back swipe (the demo has no close button)
    .hitSlop({ left: -EDGE_SWIPE })
    .onStart(() => {
      // A drag that starts right after a tap is the one-finger zoom (tap, then slide)
      zoomDrag.set(clockMs() - lastTapAt.get() < 320);
      zoomStart.set(zoom.get());
      if (!zoomDrag.get()) scheduleOnRN(freePan);
    })
    .onChange((e) => {
      if (zoomDrag.get()) {
        setZoom(zoomStart.get() * Math.exp(-e.translationY * 0.008), false);
        return;
      }
      const k = worldPerPoint();
      const ax = screenAxes();
      panX.set(panX.get() + (-ax.rx * e.changeX + ax.fx * e.changeY) * k);
      panZ.set(panZ.get() + (-ax.rz * e.changeX + ax.fz * e.changeY) * k);
    })
    .onEnd((e) => {
      if (zoomDrag.get()) return;
      const k = worldPerPoint();
      const ax = screenAxes();
      const vx = (-ax.rx * e.velocityX + ax.fx * e.velocityY) * k;
      const vz = (-ax.rz * e.velocityX + ax.fz * e.velocityY) * k;
      panX.set(withDecay({ velocity: vx, deceleration: 0.994 }));
      panZ.set(withDecay({ velocity: vz, deceleration: 0.994 }));
    });
  const pinch = Gesture.Pinch()
    .onBegin(() => {
      zoomStart.set(zoom.get());
    })
    .onChange((e) => {
      setZoom(zoomStart.get() / e.scale, false);
    });
  const twist = Gesture.Rotation()
    .onBegin(() => {
      rotationStart.set(yaw.get());
    })
    .onChange((e) => {
      yaw.set(rotationStart.get() - e.rotation);
    });
  const tilt = Gesture.Pan()
    .minPointers(2)
    .onChange((e) => {
      const p = pitch.get() + e.changeY * 0.006;
      pitch.set(Math.min(PITCH_RANGE[1], Math.max(PITCH_RANGE[0], p)));
      yaw.set(yaw.get() - e.changeX * 0.006);
    })
    .onEnd(() => {
      Presets.System.impactLight();
    });
  const mapGestures = Gesture.Simultaneous(
    pan,
    pinch,
    twist,
    tilt,
    tapMarker,
    Gesture.Exclusive(doubleTap, twoFingerTap)
  );

  const resetCamera = () => {
    Presets.System.impactMedium();
    yaw.set(withSpring(Math.round(yaw.get() / (Math.PI * 2)) * Math.PI * 2, SPRING));
    pitch.set(withSpring(DEFAULT_PITCH, SPRING));
  };

  const glassScheme = isNight ? 'dark' : 'light';
  const floatingStyle = useAnimatedStyle(() => {
    // Beside a side sheet the controls stay put in the bottom corner
    if (sideLayout) return { opacity: 1, transform: [{ translateY: 0 }] };
    // Ride the native sheet, and step aside as it grows to full height like Maps' buttons
    const v = sheetVisible.get();
    const fade = Math.min(1, Math.max(0, (height * 0.72 - v) / (height * 0.12)));
    return {
      opacity: fade,
      transform: [{ translateY: -Math.min(v, height * 0.72) - FLOAT_GAP }],
    };
  });

  return (
    <View style={styles.container}>
      <GestureDetector gesture={mapGestures}>
        <View style={StyleSheet.absoluteFill}>
          <Canvas ref={canvasRef} style={StyleSheet.absoluteFill} />
          <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
            {STATIONS.map((s, i) => (
              <StationLabel key={s.code} index={i} frame={frame} onPress={() => focusStation(i)} />
            ))}
            {/* Pins sit above the labels; they ignore touches so labels stay tappable */}
            {Array.from({ length: TRAIN_COUNT }, (_, k) => (
              <TrainPin key={k} index={k} frame={frame} mine={k === YOUR_TRAIN} scene={scene} />
            ))}
          </View>
        </View>
      </GestureDetector>

      {rendered ? null : <LoadingOverlay bottomInset={sideLayout ? 0 : Math.round(height * 0.5)} />}

      {scene ? <YourTrainEvents scene={scene} /> : null}

      {/* Header: Liquid Glass over the map (frosted fallback before iOS 26) */}
      <GlassView
        pointerEvents="none"
        glassEffectStyle="regular"
        colorScheme={isNight ? 'dark' : 'light'}
        style={[
          styles.header,
          !GLASS && styles.headerFallback,
          { top: insets.top + 8, maxWidth: width - 84 - insets.right },
          // Heads the side sheet's column, Maps-style: the info card sits right above the sheet
          sideLayout && { left: 16 + insets.left, maxWidth: SIDE_SHEET_WIDTH - 12 },
        ]}>
        <View style={styles.lineBadge}>
          <Text style={styles.lineBadgeText}>{LINE_1.number}</Text>
        </View>
        <View>
          <View style={styles.liveRow}>
            <Text style={[styles.headerTitle, isNight && { color: '#FFFFFF' }]}>Line 1 Live</Text>
            <LiveDot />
          </View>
          <Text style={[styles.headerSub, isNight && { color: 'rgba(235, 240, 255, 0.7)' }]}>
            Bến Thành ⇄ Suối Tiên · {TRAIN_COUNT} trains
          </Text>
        </View>
      </GlassView>

      {/* Floating controls ride on top of the sheet, in Liquid Glass like the header */}
      <Animated.View
        pointerEvents="box-none"
        style={[
          styles.floating,
          // One cluster in the map's bottom-right corner instead of spanning the gap beside the sheet
          sideLayout && {
            left: SIDE_SHEET_WIDTH + 32 + insets.left,
            right: 16 + insets.right,
            marginTop: -(36 + 16 + insets.bottom),
            justifyContent: 'flex-end',
            gap: 8,
          },
          floatingStyle,
        ]}>
        <GlassButton
          onPress={toggleNight}
          accessibilityRole="switch"
          accessibilityState={{ checked: isNight }}
          accessibilityLabel="Night mode"
          tint={isNight ? '#1D2640' : undefined}
          colorScheme={glassScheme}>
          <Animated.Text
            key={isNight ? 'n' : 'd'}
            entering={FadeIn.duration(250)}
            style={[styles.nightIcon, isNight && { color: '#FFD978' }]}>
            {isNight ? '☾' : '☀︎'}
          </Animated.Text>
        </GlassButton>
        <Compass yaw={yaw} pitch={pitch} onPress={resetCamera} colorScheme={glassScheme} inline={sideLayout} />
        <MapControls
          overviewOn={overviewOn}
          following={follow === YOUR_TRAIN}
          onOverview={overview}
          onFollow={() => focusTrain(YOUR_TRAIN)}
          colorScheme={glassScheme}
        />
      </Animated.View>

      {/* Status sheet: native UISheetPresentationController (TrueSheet), Apple Maps style */}
      <NativeStatusSheet
        scene={scene}
        follow={follow}
        onTrain={focusTrain}
        onStation={focusStation}
        sheet={sheet}
        sheetVisible={sheetVisible}
        screenHeight={height}
        topInset={insets.top}
        bottomInset={insets.bottom}
        sideInset={insets.right}
        sideWidth={sideLayout ? SIDE_SHEET_WIDTH : 0}
        sideTop={insets.top + 8 + HEADER_HEIGHT + 10}
        // A full-height sheet hides the map: pause the 3D scene so the JS thread serves the UI
        onDetent={(index) => scene?.setPaused(!sideLayout && index === 2)}
      />
    </View>
  );
}

/** Haptics and the door chime for your train, without re-rendering the screen */
function YourTrainEvents({ scene }: { scene: LiveScene }) {
  const chime = useSound(require('@/assets/sounds/door-chime.wav'));
  const key = useLineKey((now) => {
    const s = scene.timetable.stateAt(now, YOUR_TRAIN);
    return `${s.phase}|${s.station}|${s.phase === 'dwell' && s.progress > 0.78 ? 1 : 0}`;
  });
  const [phase, stationKey, closingKey] = key.split('|');
  const dwelling = phase === 'dwell';
  const closing = closingKey === '1';
  const station = Number(stationKey);

  useEffect(() => {
    if (dwelling) {
      Presets.System.notificationSuccess();
      chime();
    }
  }, [dwelling, station, chime]);
  useEffect(() => {
    // A soft latch as your train's doors shut
    if (closing) Presets.latch();
  }, [closing]);
  return null;
}

function StationLabel({
  index,
  frame,
  onPress,
}: {
  index: number;
  frame: SharedValue<FrameInfo>;
  onPress: () => void;
}) {
  const station = STATIONS[index];
  const style = useAnimatedStyle(() => {
    const s = frame.get().stations;
    const o = s[index * 4 + 2] ?? 0;
    // Faded-out labels move off-screen so they can't catch taps
    const x = o < 0.25 ? -999 : (s[index * 4] ?? -999);
    const y = s[index * 4 + 1] ?? -999;
    return {
      opacity: o,
      transform: [{ translateX: x - 12 }, { translateY: y - 30 }],
    };
  });
  // Animate only when a train arrives or leaves, not on every frame
  const busy = useSharedValue(0);
  useAnimatedReaction(
    () => frame.get().stations[index * 4 + 3] ?? 0,
    (b, prev) => {
      if (b !== prev) busy.set(withTiming(b, { duration: 280 }));
    }
  );
  const busyStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(busy.get(), [0, 1], ['rgba(255,255,255,0.94)', 'rgba(230,246,236,0.97)']),
    borderColor: interpolateColor(busy.get(), [0, 1], ['rgba(31,163,91,0)', 'rgba(31,163,91,1)']),
  }));
  const dotStyle = useAnimatedStyle(() => ({
    width: busy.get() * 6,
    marginLeft: busy.get() * 2,
  }));

  return (
    <Animated.View style={[styles.stationSlot, style]}>
      <Pressable onPress={onPress} hitSlop={8}>
        <Animated.View style={[styles.stationLabel, busyStyle]}>
          <View style={styles.stationCode}>
            <Text style={styles.stationCodeText}>{station.code}</Text>
          </View>
          <Text style={styles.stationName}>{station.name}</Text>
          {station.underground ? <Text style={styles.ug}>UG</Text> : null}
          <Animated.View style={[styles.busyDot, dotStyle]} />
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

/** Rough label widths (code chip + name + UG tag at 11 pt), for pin-on-label checks */
const LABEL_WIDTHS = STATIONS.map((s) => 36 + s.name.length * 6.4 + (s.underground ? 18 : 0));

/** Whether train `index`'s pin overlaps a visible station label this frame */
function pinHitsLabel(info: FrameInfo, index: number) {
  'worklet';
  const px = info.trains[index * 3] ?? -999;
  const py = info.trains[index * 3 + 1] ?? -999;
  for (let i = 0; i < LABEL_WIDTHS.length; i++) {
    if ((info.stations[i * 4 + 2] ?? 0) < 0.25) continue;
    // Label box starts 12 pt left of and 30 pt above its anchor (see StationLabel)
    const lx = (info.stations[i * 4] ?? -999) - 12;
    const ly = (info.stations[i * 4 + 1] ?? -999) - 30;
    // Pin box: ~30 pt wide around x, 26 pt tall ending at y
    if (px + 15 > lx && px - 15 < lx + LABEL_WIDTHS[i] && py > ly && py - 26 < ly + 24) return true;
  }
  return false;
}

function TrainPin({
  index,
  frame,
  mine,
  scene,
}: {
  index: number;
  frame: SharedValue<FrameInfo>;
  mine: boolean;
  scene: LiveScene | null;
}) {
  // Other trains step aside when they would sit on a station label: the label's green dot
  // already says a train is there, and two chips on top of each other read as clutter
  const covered = useSharedValue(0);
  useAnimatedReaction(
    () => (mine ? false : pinHitsLabel(frame.get(), index)),
    (hit, prev) => {
      if (hit !== prev) covered.set(withTiming(hit ? 1 : 0, { duration: 180 }));
    }
  );
  const style = useAnimatedStyle(() => {
    const t = frame.get().trains;
    const x = t[index * 3] ?? -999;
    const y = t[index * 3 + 1] ?? -999;
    const o = t[index * 3 + 2] ?? 0;
    return {
      opacity: o * (1 - covered.get()),
      transform: [{ translateX: x - PIN_W / 2 }, { translateY: y - 26 }],
    };
  });

  return (
    <Animated.View pointerEvents="none" style={[styles.pinSlot, style]}>
      <View style={[styles.pin, mine ? styles.pinMine : null]}>
        {mine && scene ? (
          // Plain text here: a SwiftUI host can't follow the pin's UI-thread transform
          <PinCountdown scene={scene} index={index} />
        ) : (
          <Text style={styles.pinText}>T{index + 1}</Text>
        )}
      </View>
      <View style={[styles.pinTail, mine && { borderTopColor: GREEN }]} />
    </Animated.View>
  );
}

function PinCountdown({ scene, index }: { scene: LiveScene; index: number }) {
  const value = useCountdown(scene, index);
  return <Text style={[styles.pinText, { color: '#fff' }]}>Your train · {value}</Text>;
}

/** Apple Maps-style glass capsule: overview on top, follow-my-train below */
function MapControls({
  overviewOn,
  following,
  onOverview,
  onFollow,
  colorScheme,
}: {
  overviewOn: boolean;
  following: boolean;
  onOverview: () => void;
  onFollow: () => void;
  colorScheme: 'light' | 'dark';
}) {
  const idle = colorScheme === 'dark' ? '#FFFFFF' : INK;
  return (
    // Holds the row's 36 pt slot; the taller capsule grows upwards from its bottom edge
    <View style={styles.mapControlsSlot}>
      <GlassView
        glassEffectStyle="regular"
        isInteractive
        colorScheme={colorScheme}
        style={[styles.mapControls, !GLASS && styles.headerFallback]}>
        <Pressable
          onPress={onOverview}
          accessibilityRole="button"
          accessibilityLabel="Overview"
          accessibilityState={{ selected: overviewOn }}
          style={({ pressed }) => [styles.mapControl, pressed && styles.mapControlPressed]}>
          <SymbolView name={overviewOn ? 'map.fill' : 'map'} size={21} tintColor={overviewOn ? GREEN : idle} />
        </Pressable>
        <Pressable
          onPress={onFollow}
          accessibilityRole="button"
          accessibilityLabel="Follow my train"
          accessibilityState={{ selected: following }}
          style={({ pressed }) => [styles.mapControl, pressed && styles.mapControlPressed]}>
          <SymbolView name={following ? 'location.fill' : 'location'} size={20} tintColor={following ? GREEN : idle} />
        </Pressable>
      </GlassView>
    </View>
  );
}

/** Appears once the view is orbited or tilted; the needle points north. Tap to reset. */
function Compass({
  yaw,
  pitch,
  onPress,
  colorScheme,
  inline = false,
}: {
  yaw: SharedValue<number>;
  pitch: SharedValue<number>;
  onPress: () => void;
  colorScheme: 'light' | 'dark';
  /** Side layout: sits above the button cluster instead of next to the night button */
  inline?: boolean;
}) {
  const wrap = useAnimatedStyle(() => {
    const off = Math.min(1, Math.abs(Math.sin(yaw.get() / 2)) * 6 + Math.abs(pitch.get() - DEFAULT_PITCH) * 4);
    const shown = off > 0.08;
    return {
      opacity: withTiming(shown ? 1 : 0, { duration: 200 }),
      transform: [{ scale: withSpring(shown ? 1 : 0.6, SPRING) }],
    };
  });
  const needle = useAnimatedStyle(() => ({
    transform: [
      { rotate: `${-yaw.get()}rad` },
      // Flatten as the camera tilts towards the horizon
      { scaleY: 0.55 + 0.45 * Math.sin(pitch.get()) },
    ],
  }));
  return (
    <Animated.View style={[styles.compassWrap, inline && styles.compassInline, wrap]}>
      <GlassButton onPress={onPress} accessibilityLabel="Reset camera" colorScheme={colorScheme}>
        <Animated.View style={[styles.needleBox, needle]}>
          <View style={styles.needleNorth} />
          <View style={styles.needleSouth} />
        </Animated.View>
      </GlassButton>
    </Animated.View>
  );
}

function LiveDot() {
  const pulse = useSharedValue(0);
  useEffect(() => {
    pulse.set(withRepeat(withTiming(1, { duration: 1400, easing: Easing.out(Easing.quad) }), -1));
  }, [pulse]);
  const ring = useAnimatedStyle(() => ({
    opacity: 1 - pulse.get(),
    transform: [{ scale: 1 + pulse.get() * 1.8 }],
  }));
  return (
    <View style={styles.liveDotWrap}>
      <Animated.View style={[styles.liveDot, styles.liveRing, ring]} />
      <View style={styles.liveDot} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#E9F0F6',
  },
  header: {
    position: 'absolute',
    left: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingLeft: 8,
    paddingRight: 16,
    borderRadius: 25,
    borderCurve: 'continuous',
  },
  headerFallback: {
    backgroundColor: 'rgba(255,255,255,0.84)',
    boxShadow: '0 6px 20px rgba(20, 30, 50, 0.08)',
  },
  lineBadge: {
    width: 34,
    height: 34,
    // Concentric with the capsule: its 25 pt radius minus the 8 pt inset
    borderRadius: 17,
    borderCurve: 'continuous',
    backgroundColor: LINE_1.color,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lineBadgeText: {
    color: '#fff',
    fontSize: 19,
    fontWeight: 800,
  },
  liveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    color: INK,
    fontSize: 16,
    fontWeight: 700,
  },
  headerSub: {
    color: MUTED,
    fontSize: 12,
    marginTop: 1,
  },
  liveDotWrap: {
    width: 8,
    height: 8,
  },
  liveDot: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: GREEN,
  },
  liveRing: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: GREEN,
  },
  floating: {
    position: 'absolute',
    left: 16,
    right: 16,
    top: '100%',
    marginTop: -36,
    height: 36,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  nightIcon: {
    color: '#E8A317',
    fontSize: 17,
    fontWeight: 700,
  },
  // Side layout: stacked above the right end of the button cluster, like Maps on iPad
  compassInline: {
    left: undefined,
    right: 0,
    bottom: MAP_CONTROL * 2 + 8,
  },
  compassWrap: {
    position: 'absolute',
    left: 46,
  },
  needleBox: {
    alignItems: 'center',
  },
  needleNorth: {
    width: 0,
    height: 0,
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderBottomWidth: 11,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: LINE_1.color,
  },
  needleSouth: {
    width: 0,
    height: 0,
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderTopWidth: 11,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: '#B8BEC7',
  },
  mapControlsSlot: {
    width: MAP_CONTROL,
    height: 36,
  },
  mapControls: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: MAP_CONTROL,
    borderRadius: MAP_CONTROL / 2,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  mapControl: {
    width: MAP_CONTROL,
    height: MAP_CONTROL,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapControlPressed: {
    opacity: 0.5,
  },
  stationSlot: {
    position: 'absolute',
    left: 0,
    top: 0,
  },
  stationLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingLeft: 3,
    paddingRight: 8,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 1,
    boxShadow: '0 2px 8px rgba(20, 30, 50, 0.12)',
  },
  stationCode: {
    minWidth: 20,
    height: 16,
    borderRadius: 5,
    paddingHorizontal: 3,
    backgroundColor: LINE_1.color,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stationCodeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: 800,
    fontVariant: ['tabular-nums'],
  },
  stationName: {
    color: INK,
    fontSize: 11,
    fontWeight: 600,
  },
  ug: {
    color: MUTED,
    fontSize: 9,
    fontWeight: 700,
  },
  busyDot: {
    height: 6,
    borderRadius: 3,
    backgroundColor: GREEN,
  },
  pinSlot: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: PIN_W,
    alignItems: 'center',
  },
  // White like the station labels: a dark chip got lost on the red line
  pin: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 9,
    backgroundColor: 'rgba(255, 255, 255, 0.96)',
    boxShadow: '0 2px 8px rgba(20, 30, 50, 0.18)',
  },
  pinMine: {
    backgroundColor: GREEN,
    paddingHorizontal: 9,
    paddingVertical: 4,
    boxShadow: `0 4px 12px rgba(31, 163, 91, 0.4)`,
  },
  pinText: {
    color: INK,
    fontSize: 11,
    fontWeight: 700,
    fontVariant: ['tabular-nums'],
  },
  pinTail: {
    width: 0,
    height: 0,
    borderLeftWidth: 4,
    borderRightWidth: 4,
    borderTopWidth: 5,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: 'rgba(255, 255, 255, 0.96)',
  },
});
