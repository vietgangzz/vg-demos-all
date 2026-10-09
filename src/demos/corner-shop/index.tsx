import { GlassView } from 'expo-glass-effect';
import { StatusBar } from 'expo-status-bar';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { PixelRatio, Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Presets } from 'react-native-pulsar';
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  FadeOut,
  SensorType,
  useAnimatedSensor,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Canvas as Skia2D, FillType, Path, Skia } from 'react-native-skia';
import { Canvas, type CanvasRef } from 'react-native-webgpu';

import { useSound } from '@/hooks/use-sound';

import { HingeView, hingeSupported, type Hinge } from '../../../modules/duo-hinge/src';
import { GADGETS, type Gadget } from './gadgets';
import { LOOKS as FILM_LOOKS } from './instant/film';
import { LOOKS, THEMES, type Look } from './themes';
import {
  createCornerShop,
  FINDER,
  type CornerShop,
  type ShopHaptic,
  type ShopSound,
  type Shot,
  type Site,
} from './scene';

/**
 * Corner Shop: a papercraft gadget shop whose front door is a folding iPhone. Folded, the cover
 * is the door; the phone's own hinge opens it, by exactly as much as the phone is opened, and
 * you walk in. Tap what you want and it goes in the bag; fold the phone and you walk out, and
 * the door you open next is your own, at home, where it all gets unpacked onto the desk.
 *
 * At home the instant camera on the desk takes a photo of it all: look through, shoot, shake the
 * print to develop it, and hang it on the line of lights over the desk.
 *
 * On a phone that doesn't fold, a horizontal drag works the hinge instead.
 */

const HAPTICS: Record<ShopHaptic, () => void> = {
  bell: () => Presets.System.impactLight(),
  sign: () => Presets.System.impactSoft(),
  bulb: () => Presets.System.selection(),
  neon: () => Presets.System.impactMedium(),
  step: () => Presets.System.impactSoft(),
  settle: () => Presets.System.impactLight(),
  buy: () => Presets.System.impactMedium(),
  drop: () => Presets.System.impactSoft(),
  arrive: () => Presets.System.notificationSuccess(),
  place: () => Presets.System.impactLight(),
  lens: () => Presets.System.impactRigid(),
  shutter: () => Presets.System.impactHeavy(),
  motor: () => Presets.zipper(),
  shake: () => Presets.System.impactMedium(),
  ready: () => Presets.System.notificationSuccess(),
  tick: () => Presets.System.selection(),
};

/** Where you are and what you've bought: carried across looks, so switching keeps your place */
type Journey = { site: Site; bag: Gadget[] };
type JourneyEvents = {
  onBag: (bag: Gadget[]) => void;
  onSite: (site: Site) => void;
  onInside: (inside: boolean) => void;
  onShot: (shot: Shot) => void;
  onDevelop: (p: number) => void;
  onSound: (kind: ShopSound) => void;
  onPrints: (n: number) => void;
};

const money = (n: number) => `$${n.toLocaleString('en-US')}`;

type Size = { w: number; h: number };
type Layer = { id: number; look: Look };

/**
 * One look's scene on its own canvas. Switching looks mounts a new layer under the old one; the
 * old one stays on screen, still lit, until the new one has drawn, then fades away over it.
 */
function ShopLayer({
  id,
  look,
  size,
  hinge,
  journey,
  on,
  onScene,
  onDrawn,
}: {
  id: number;
  look: Look;
  size: Size;
  hinge: RefObject<number | null>;
  journey: RefObject<Journey>;
  on: RefObject<JourneyEvents>;
  onScene: (id: number, shop: CornerShop | null) => void;
  onDrawn: (id: number) => void;
}) {
  const canvasRef = useRef<CanvasRef>(null);
  const [scene, setScene] = useState<CornerShop | null>(null);
  // Read when the scene's made; after that it's resized, never rebuilt
  const sizeRef = useRef(size);
  const wide = size.w > size.h;

  useEffect(() => {
    sizeRef.current = size;
  }, [size]);

  useEffect(() => {
    let shop: CornerShop | null = null;
    let cancelled = false;
    (async () => {
      const adapter = await navigator.gpu.requestAdapter();
      const device = await adapter?.requestDevice();
      let context = canvasRef.current?.getContext('webgpu') ?? null;
      for (let tries = 0; !context && tries < 20 && !cancelled; tries++) {
        await new Promise((r) => setTimeout(r, 50));
        context = canvasRef.current?.getContext('webgpu') ?? null;
      }
      const s = sizeRef.current;
      if (cancelled || !device || !context) return;
      const ratio = Math.min(PixelRatio.get(), 2.5);
      const c = context.canvas as unknown as { width: number; height: number };
      c.width = s.w * ratio;
      c.height = s.h * ratio;
      shop = createCornerShop(
        context,
        device,
        { width: s.w, height: s.h, ratio, wide: s.w > s.h, look, ...journey.current },
        {
          onHaptic: (kind) => HAPTICS[kind](),
          onBag: (bag) => on.current.onBag(bag),
          onSite: (site) => on.current.onSite(site),
          onInside: (inside) => on.current.onInside(inside),
          onShot: (shot) => on.current.onShot(shot),
          onDevelop: (p) => on.current.onDevelop(p),
          onSound: (kind) => on.current.onSound(kind),
          onPrints: (n) => on.current.onPrints(n),
        }
      );
      if (hinge.current !== null) shop.jumpAngle(hinge.current);
      shop.onFirstFrame(() => onDrawn(id));
      if (__DEV__) (globalThis as { cornerShop?: CornerShop }).cornerShop = shop;
      onScene(id, shop);
      setScene(shop);
    })();
    return () => {
      cancelled = true;
      onScene(id, null);
      shop?.dispose();
    };
    // A layer is one look for its whole life
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A new screen: the same scene, resized
  useEffect(() => {
    scene?.resize(size.w, size.h, Math.min(PixelRatio.get(), 2.5), size.w > size.h);
  }, [scene, size]);

  // With no hinge, which screen we're on says shut or open
  useEffect(() => {
    if (hinge.current !== null) return;
    scene?.setAngle(wide ? Math.PI : 0);
  }, [scene, wide, hinge]);

  return (
    <Animated.View exiting={FadeOut.duration(420)} pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Canvas ref={canvasRef} style={StyleSheet.absoluteFill} />
    </Animated.View>
  );
}

export default function CornerShopDemo() {
  const insets = useSafeAreaInsets();
  const [size, setSize] = useState<Size | null>(null);
  const [layers, setLayers] = useState<Layer[]>([{ id: 0, look: 'kraft' }]);
  const [active, setActive] = useState<{ id: number; shop: CornerShop } | null>(null);
  const [drawn, setDrawn] = useState(false);
  const look = layers[layers.length - 1].look;
  const wide = size ? size.w > size.h : false;
  const hingeRef = useRef<number | null>(null);
  const scenes = useRef(new Map<number, CornerShop>());
  const nextId = useRef(1);
  const [journey, setJourney] = useState<Journey>({ site: 'shop', bag: [] });
  const [inside, setInside] = useState(false);
  const [shot, setShot] = useState<Shot>('none');
  const [developed, setDeveloped] = useState(0);
  const [prints, setPrints] = useState(0);
  const [filmLook, setFilmLook] = useState(0);
  const flash = useSharedValue(0);

  const lens = useSound(require('@/assets/sounds/instant-lens.wav'));
  const charge = useSound(require('@/assets/sounds/instant-charge.wav'));
  const shutterSound = useSound(require('@/assets/sounds/instant-shutter.wav'));
  const eject = useSound(require('@/assets/sounds/instant-eject.wav'));
  const sounds = useRef({ lens, charge, shutter: shutterSound, eject });
  useEffect(() => {
    sounds.current = { lens, charge, shutter: shutterSound, eject };
  }, [lens, charge, shutterSound, eject]);

  const journeyRef = useRef(journey);
  const on = useRef<JourneyEvents>({
    onBag: (bag) => setJourney((j) => ({ ...j, bag })),
    onSite: (site) => setJourney((j) => ({ ...j, site })),
    onInside: setInside,
    onShot: (s) => {
      setShot(s);
      if (s === 'eject') setDeveloped(0);
    },
    onDevelop: setDeveloped,
    onSound: (kind) => sounds.current[kind](),
    onPrints: setPrints,
  });
  useEffect(() => {
    journeyRef.current = journey;
  }, [journey]);
  const total = journey.bag.reduce((n, k) => n + GADGETS[k].price, 0);

  // Shaking the print: the phone's own motion
  const accel = useAnimatedSensor(SensorType.ACCELEROMETER, { interval: 'auto' });
  const gravity = useAnimatedSensor(SensorType.GRAVITY, { interval: 'auto' });
  const motionRef = useRef({ accel, gravity });
  useEffect(() => {
    motionRef.current = { accel, gravity };
  }, [accel, gravity]);

  const onScene = (id: number, shop: CornerShop | null) => {
    if (shop) {
      // A new scene starts with the camera on the desk and an empty line
      setShot('none');
      setPrints(0);
      scenes.current.set(id, shop);
      shop.setMotion(() => {
        const { accel: a, gravity: g } = motionRef.current;
        if (!a.isAvailable) return null;
        const av = a.sensor.value;
        const gv = g.sensor.value;
        return { ax: av.x, ay: av.y, az: av.z, gx: gv.x, gy: gv.y, gz: gv.z };
      });
    } else scenes.current.delete(id);
    setActive((a) => (shop ? (!a || id >= a.id ? { id, shop } : a) : a?.id === id ? null : a));
  };
  // The new look is up: everything older goes
  const onDrawn = (id: number) => {
    setDrawn(true);
    setLayers((ls) => ls.filter((l) => l.id >= id));
  };
  const pick = (next: Look) => {
    if (next === look) return;
    Presets.System.selection();
    const id = nextId.current++;
    setPrints(0);
    setLayers((ls) => [...ls, { id, look: next }]);
  };

  // The hinge drives every scene that's up, so the one fading out and the one coming in agree
  const onHinge = (h: Hinge) => {
    hingeRef.current = h.angle;
    for (const shop of scenes.current.values()) shop.setAngle(h.angle);
  };

  // A drag works the hinge by hand (drag right to open), or, taking a photo, aims and shakes
  const scene = active?.shop ?? null;
  const pan = Gesture.Pan()
    .runOnJS(true)
    .minDistance(8)
    .onStart(() => {
      if (!scene?.shooting()) scene?.grab();
    })
    .onChange((e) => scene?.panBy(e.changeX, e.changeY))
    .onUpdate((e) => {
      if (!scene?.shooting()) scene?.drag(e.translationX / Math.max(1, size?.w ?? 1));
    })
    .onFinalize(() => scene?.release());
  // A tap buys in the shop, and picks up the camera at home
  const tap = Gesture.Tap()
    .runOnJS(true)
    .onEnd((e) => size && scene?.tap(e.x / size.w, e.y / size.h));

  const shooting = shot !== 'none';
  const aiming = shot === 'aim';
  const developing = shot === 'developing' || shot === 'developed';

  const press = () => {
    flash.value = withSequence(withTiming(1, { duration: 40 }), withTiming(0, { duration: 520 }));
    scene?.shutter();
  };
  const flashStyle = useAnimatedStyle(() => ({ opacity: flash.value }));
  const wiggle = useSharedValue(0);
  useEffect(() => {
    wiggle.value = withRepeat(
      withSequence(
        withTiming(-1, { duration: 110 }),
        withTiming(1, { duration: 220 }),
        withTiming(0, { duration: 110 })
      ),
      -1
    );
  }, [wiggle]);
  const wiggleStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${wiggle.value * 6}deg` }] }));

  return (
    <View style={[styles.root, { backgroundColor: THEMES[layers[0].look].clear }]}>
      <StatusBar style="light" />
      <HingeView onHinge={onHinge} />
      <GestureDetector gesture={Gesture.Exclusive(pan, tap)}>
        <View
          style={StyleSheet.absoluteFill}
          onLayout={(e) => {
            const { width: w, height: h } = e.nativeEvent.layout;
            setSize((s) =>
              s && Math.round(s.w) === Math.round(w) && Math.round(s.h) === Math.round(h) ? s : { w, h }
            );
          }}>
          {/* Oldest on top: it covers the new one until that has drawn */}
          {size
            ? [...layers]
                .reverse()
                .map((l) => (
                  <ShopLayer
                    key={l.id}
                    id={l.id}
                    look={l.look}
                    size={size}
                    hinge={hingeRef}
                    journey={journeyRef}
                    on={on}
                    onScene={onScene}
                    onDrawn={onDrawn}
                  />
                ))
            : null}
        </View>
      </GestureDetector>

      {drawn ? null : (
        <Animated.View
          exiting={FadeOut.duration(320)}
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: THEMES[layers[0].look].clear }]}
        />
      )}

      {aiming && size ? <Viewfinder size={size} onShutter={press} onCancel={() => scene?.cancelAim()} /> : null}

      {wide && drawn && !shooting ? (
        <Animated.View
          entering={FadeInDown.delay(500).duration(420).easing(Easing.out(Easing.cubic))}
          exiting={FadeOut.duration(160)}
          style={[styles.looks, { bottom: insets.bottom + 14 }]}>
          <GlassView glassEffectStyle="regular" colorScheme="dark" style={styles.lookBar}>
            {LOOKS.map((id) => ({ id, label: THEMES[id].label })).map((l) => (
              <Pressable
                key={l.id}
                onPress={() => pick(l.id)}
                accessibilityRole="button"
                accessibilityState={{ selected: look === l.id }}
                style={[styles.lookChip, look === l.id && styles.lookChipOn]}>
                <Text style={[styles.lookText, look === l.id && styles.lookTextOn]}>{l.label}</Text>
              </Pressable>
            ))}
          </GlassView>
        </Animated.View>
      ) : null}

      {wide && drawn && journey.site === 'shop' && (journey.bag.length || inside) ? (
        <Animated.View
          key={journey.bag.length ? 'bag' : 'hint'}
          entering={FadeInDown.duration(380).easing(Easing.out(Easing.cubic))}
          exiting={FadeOut.duration(200)}
          pointerEvents="none"
          style={[styles.corner, { top: insets.top + 12, left: insets.left + 16 }]}>
          <GlassView glassEffectStyle="regular" colorScheme="dark" style={styles.card}>
            {journey.bag.length ? (
              <>
                <Text style={styles.cardTitle}>
                  In the bag · {journey.bag.length} · {money(total)}
                </Text>
                <Text style={styles.cardSub}>Fold the phone to head home</Text>
              </>
            ) : (
              <Text style={styles.cardTitle}>Tap a gadget to buy it</Text>
            )}
          </GlassView>
        </Animated.View>
      ) : null}

      {wide && drawn && journey.site === 'home' && !shooting ? (
        <Animated.View
          entering={FadeInDown.delay(900).duration(380).easing(Easing.out(Easing.cubic))}
          exiting={FadeOut.duration(200)}
          style={[styles.corner, { top: insets.top + 12, left: insets.left + 16 }]}>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              Presets.System.selection();
              for (const shop of scenes.current.values()) shop.shopAgain();
            }}>
            <GlassView glassEffectStyle="regular" colorScheme="dark" style={styles.card}>
              <Text style={styles.cardTitle}>
                Home · {journey.bag.length} unpacked{prints ? ` · ${prints} on the line` : ''}
              </Text>
              <Text style={styles.cardSub}>Shop again →</Text>
            </GlassView>
          </Pressable>
        </Animated.View>
      ) : null}

      {wide && drawn && journey.site === 'home' && inside && !shooting ? (
        <Animated.View
          entering={FadeIn.delay(1400).duration(500)}
          exiting={FadeOut.duration(160)}
          pointerEvents="none"
          style={[styles.looks, { top: insets.top + 12 }]}>
          <GlassView glassEffectStyle="regular" colorScheme="dark" style={[styles.card, styles.row]}>
            <SymbolView name="camera.fill" size={15} weight="semibold" tintColor="#FFFFFF" />
            <Text style={styles.cardTitle}>{prints ? 'Take another' : 'Tap the camera on the desk'}</Text>
          </GlassView>
        </Animated.View>
      ) : null}

      {developing ? (
        <View pointerEvents="box-none" style={[styles.foot, { paddingBottom: insets.bottom + 16 }]}>
          <Animated.View key={`hint-${shot}`} entering={FadeIn.duration(300)} style={styles.shake} pointerEvents="none">
            {shot === 'developing' ? (
              <>
                <Animated.Text style={[styles.shakeTitle, wiggleStyle]}>Shake it</Animated.Text>
                <Text style={styles.shakeSub}>
                  {accel.isAvailable ? 'Shake your phone' : 'Drag the print back and forth'} ·{' '}
                  {Math.round(developed * 100)}%
                </Text>
              </>
            ) : (
              <Text style={styles.shakeSub}>Developed</Text>
            )}
          </Animated.View>
          {shot === 'developed' ? (
            <Animated.View entering={FadeIn.duration(300)} style={styles.rowGap}>
              <GlassView glassEffectStyle="regular" colorScheme="dark" style={styles.lookBar}>
                {FILM_LOOKS.map((l, i) => (
                  <Pressable
                    key={l.id}
                    onPress={() => {
                      setFilmLook(i);
                      scene?.setFilmLook(i);
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ selected: filmLook === i }}
                    style={[styles.lookChip, filmLook === i && styles.lookChipOn]}>
                    <Text style={[styles.lookText, filmLook === i && styles.lookTextOn]}>{l.name}</Text>
                  </Pressable>
                ))}
              </GlassView>
            </Animated.View>
          ) : null}
          <Animated.View key={`pills-${shot}`} entering={FadeIn.duration(260)} style={styles.rowGap}>
            <Pill icon="camera.fill" label="Another" onPress={() => scene?.again()} />
            {shot === 'developed' ? (
              <Pill icon="paperclip" label="Hang it up" primary onPress={() => scene?.hang()} />
            ) : null}
          </Animated.View>
        </View>
      ) : null}

      {!wide && drawn && !hingeSupported ? (
        <Animated.View
          entering={FadeIn.duration(400)}
          pointerEvents="none"
          style={[styles.hint, { bottom: insets.bottom + 18 }]}>
          <Text style={styles.hintText}>Drag right to open</Text>
        </Animated.View>
      ) : null}

      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.flash, flashStyle]} />
    </View>
  );
}

/** Looking through the eyepiece: the room in a window the shape of the print's picture, the rest dark */
function Viewfinder({ size, onShutter, onCancel }: { size: Size; onShutter: () => void; onCancel: () => void }) {
  const insets = useSafeAreaInsets();
  const { w, h } = size;
  const winH = h * FINDER;
  const winW = (winH * 46) / 62;
  const winX = (w - winW) / 2;
  const winY = (h - winH) / 2;
  const mask = Skia.PathBuilder.Make()
    .addRect(Skia.XYWHRect(0, 0, w, h))
    .addRRect(Skia.RRectXY(Skia.XYWHRect(winX, winY, winW, winH), 18, 18))
    .setFillType(FillType.EvenOdd)
    .detach();
  const corners = Skia.PathBuilder.Make();
  const c = 24;
  const inset = 16;
  const fx = winX + inset;
  const fy = winY + inset;
  const fw = winW - inset * 2;
  const fh = winH - inset * 2;
  for (const [x, y, sx, sy] of [
    [fx, fy, 1, 1],
    [fx + fw, fy, -1, 1],
    [fx, fy + fh, 1, -1],
    [fx + fw, fy + fh, -1, -1],
  ]) {
    corners.moveTo(x, y + sy * c);
    corners.lineTo(x, y);
    corners.lineTo(x + sx * c, y);
  }
  const frame = corners.detach();
  return (
    <Animated.View
      entering={FadeIn.duration(260)}
      exiting={FadeOut.duration(160)}
      pointerEvents="box-none"
      style={StyleSheet.absoluteFill}>
      <Skia2D style={StyleSheet.absoluteFill} pointerEvents="none">
        <Path path={mask} color="#0B0A0C" />
        <Path path={frame} style="stroke" strokeWidth={2} color="rgba(255,255,255,0.65)" />
      </Skia2D>
      <View pointerEvents="none" style={[styles.finderLabel, { top: winY + winH + 10, left: winX }]}>
        <View style={styles.readyDot} />
        <Text style={styles.finderText}>YOUR DESK · DRAG TO FRAME</Text>
      </View>
      <View style={[styles.aimSide, { right: insets.right + 48, top: 0, bottom: 0 }]} pointerEvents="box-none">
        <Pressable onPress={onShutter} accessibilityLabel="Shutter" style={styles.shutterOuter}>
          <View style={styles.shutterInner} />
        </Pressable>
      </View>
      <View style={[styles.aimSide, { left: insets.left + 56, top: 0, bottom: 0 }]} pointerEvents="box-none">
        <Pressable onPress={onCancel} hitSlop={12} accessibilityLabel="Put it down" style={styles.roundSmall}>
          <SymbolView name="xmark" size={16} weight="semibold" tintColor="#FFFFFF" />
        </Pressable>
      </View>
    </Animated.View>
  );
}

function Pill({
  icon,
  label,
  onPress,
  primary,
}: {
  icon: SFSymbol;
  label: string;
  onPress: () => void;
  primary?: boolean;
}) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      <GlassView
        glassEffectStyle="regular"
        isInteractive
        colorScheme="dark"
        tintColor={primary ? 'rgba(255,255,255,0.92)' : undefined}
        style={styles.pill}>
        <SymbolView name={icon} size={15} weight="semibold" tintColor={primary ? '#1D1D1F' : '#FFFFFF'} />
        <Text style={[styles.pillText, primary && { color: '#1D1D1F' }]}>{label}</Text>
      </GlassView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#130F0C',
  },
  looks: {
    position: 'absolute',
    alignSelf: 'center',
  },
  lookBar: {
    flexDirection: 'row',
    padding: 4,
    borderRadius: 22,
  },
  lookChip: {
    height: 36,
    paddingHorizontal: 16,
    borderRadius: 18,
    justifyContent: 'center',
  },
  lookChipOn: {
    backgroundColor: 'rgba(255,255,255,0.9)',
  },
  lookText: {
    fontSize: 14,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.85)',
  },
  lookTextOn: {
    color: '#1D1D1F',
  },
  hint: {
    position: 'absolute',
    alignSelf: 'center',
  },
  corner: {
    position: 'absolute',
  },
  card: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 18,
    gap: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  rowGap: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
    fontVariant: ['tabular-nums'],
  },
  cardSub: {
    fontSize: 13,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.7)',
  },
  hintText: {
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.6)',
  },
  foot: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    gap: 12,
  },
  shake: {
    alignItems: 'center',
    gap: 2,
  },
  shakeTitle: {
    color: '#FFFFFF',
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: -0.8,
    textShadowColor: 'rgba(0,0,0,0.45)',
    textShadowRadius: 12,
  },
  shakeSub: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 14,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    textShadowColor: 'rgba(0,0,0,0.45)',
    textShadowRadius: 10,
  },
  pill: {
    height: 46,
    borderRadius: 23,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pillText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  flash: {
    backgroundColor: '#FFFFFF',
  },
  finderLabel: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  readyDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#55E07A',
  },
  finderText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.6,
  },
  aimSide: {
    position: 'absolute',
    justifyContent: 'center',
  },
  shutterOuter: {
    width: 78,
    height: 78,
    borderRadius: 39,
    borderWidth: 4,
    borderColor: 'rgba(255,255,255,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#DADBDD',
  },
  roundSmall: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
});
