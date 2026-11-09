import { Accelerometer } from 'expo-sensors';
import { useEffect, useMemo, useState } from 'react';
import { Dimensions, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Easing, makeMutable, useFrameCallback, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Canvas,
  Circle,
  Fill,
  Glass,
  Group,
  measureText,
  Path,
  RadialGradient,
  Shader,
  Text,
  useClock,
  useFonts,
} from 'react-native-tgfx';

import { makeWorld, marbleAt, shockwave, step, stepLetters, type LetterRest } from './world';

/**
 * Marbles: glass marbles on a poster, drawn with react-native-tgfx. Every marble is a <Glass> node
 * bending the type and the aurora behind it, its rainbow edge flaring with speed and its highlight
 * always turned to the light. Physics runs on the UI thread; each frame it only writes slots (a
 * marble's x and y, its light angle, its dispersion), so no JS runs per frame and nothing re-encodes.
 *
 * The poster's letters are loose too: each sits on its own spring, marbles shoulder it aside as they
 * pass, and the light moving across relights the type.
 *
 * Drag a marble and throw it; tap the glass for a shockwave; drag anywhere else to move the light.
 * Tilt the phone and they roll; Float lets them go weightless.
 */

const FONTS = {
  Bricolage: [require('@expo-google-fonts/bricolage-grotesque/800ExtraBold/BricolageGrotesque_800ExtraBold.ttf')],
  Mono: [require('@expo-google-fonts/jetbrains-mono/500Medium/JetBrainsMono_500Medium.ttf')],
};

const AURORA = `
uniform float2 uSize;
uniform float uTime;
uniform float2 uSun;

float blob(float2 p, float2 c, float r) {
  float d = length(p - c) / r;
  return exp(-d * d);
}

float hash(float2 p) {
  return fract(sin(dot(p, float2(127.1, 311.7))) * 43758.5453);
}

half4 main(float2 pos) {
  float t = uTime * 0.16;
  float s = uSize.x;
  float3 col = float3(0.02, 0.016, 0.05);
  col += float3(1.0, 0.18, 0.45) * 0.62 * blob(pos, uSize * float2(0.08 + 0.14 * sin(t * 1.3), 0.3 + 0.08 * cos(t)), s * 0.5);
  col += float3(0.38, 0.22, 1.0) * 0.6 * blob(pos, uSize * float2(0.92 + 0.1 * cos(t * 0.9), 0.58 + 0.1 * sin(t * 1.1)), s * 0.52);
  col += float3(0.10, 0.80, 0.70) * 0.45 * blob(pos, uSize * float2(0.25 + 0.16 * sin(t * 0.7 + 2.0), 0.9 + 0.04 * cos(t * 1.7)), s * 0.46);
  col += float3(1.0, 0.50, 0.16) * 0.4 * blob(pos, uSize * float2(0.6 + 0.22 * cos(t * 0.5 + 1.0), 0.08 + 0.05 * sin(t * 1.4)), s * 0.34);
  col = col * col * 1.6 + col * 0.25;
  float sd = length(pos - uSun);
  col += float3(1.0, 0.88, 0.66) * (exp(-sd * sd / (s * s * 0.0035)) * 1.4 + exp(-sd / (s * 0.22)) * 0.3);
  col += (hash(pos + fract(uTime) * 91.0) - 0.5) * 0.035;
  return half4(clamp(col, 0.0, 1.0), 1.0);
}
`;

// Each marble is a <Glass> reading back what's under it, the most expensive thing on screen: on an
// Android emulator (MuMu), six hold 58 fps and seven drop to 47
const RADII = [62, 50, 44, 36, 30, 24];
const WORDS = ['LIQUID', 'GLASS', 'MARBLES'];
const LETTERS = WORDS.join('').length;
const KNOB_EASE = Easing.bezier(0.3, 0, 0.2, 1);
const GRID = 28;
const PILL_W = 232;
const PILL_H = 54;

function gridPath(width: number, height: number) {
  let d = '';
  for (let x = GRID; x < width; x += GRID) d += `M${x} 0V${height}`;
  for (let y = GRID; y < height; y += GRID) d += `M0 ${y}H${width}`;
  return d;
}

export default function Marbles() {
  const insets = useSafeAreaInsets();
  const [size, setSize] = useState(() => Dimensions.get('window'));
  const { width, height } = size;
  const scale = width / 440;
  const radii = useMemo(() => RADII.map((r) => r * scale), [scale]);

  const grid = useMemo(() => gridPath(width, height), [width, height]);
  const big = width * 0.25;
  const left = 22 * scale;
  const pillX = (width - PILL_W) / 2;
  const pillY = height - insets.bottom - PILL_H - 18;
  const half = PILL_W / 2;
  // They come to rest on the switch, not under it
  const floor = pillY - 8;

  // Set letter by letter, so each can be knocked about on its own. Each one's place comes from
  // measuring the word up to it, which keeps the word's kerning.
  const fontsReady = useFonts(FONTS);
  const letters = useMemo(() => {
    if (!fontsReady) return [];
    return WORDS.flatMap((word, row) => {
      const fontSize = row === 2 ? big * 0.78 : big;
      const style = { fontFamily: 'Bricolage', fontSize, letterSpacing: -big * 0.045 };
      const baseline = height * 0.33 + row * big * 0.86;
      return [...word].map((char, i) => {
        const own = measureText(char, style).width;
        const x = left - 4 + measureText(word.slice(0, i + 1), style).width - own;
        return { char, x, baseline, fontSize, cx: x + own / 2, cy: baseline - fontSize * 0.36 };
      });
    });
  }, [fontsReady, big, left, height]);
  const rest = useSharedValue<LetterRest>({ x: [], y: [], size: [] });
  useEffect(() => {
    rest.set({ x: letters.map((l) => l.cx), y: letters.map((l) => l.cy), size: letters.map((l) => l.fontSize) });
  }, [letters, rest]);
  const motion = useMemo(
    () => Array.from({ length: LETTERS }, () => ({ x: makeMutable(0), y: makeMutable(0), rot: makeMutable(0) })),
    []
  );

  const world = useSharedValue(makeWorld(radii, width, height, LETTERS));
  const bounds = useSharedValue({ width, height });
  const clock = useClock();
  const sun = useMemo(() => ({ x: makeMutable(width * 0.8), y: makeMutable(height * 0.14) }), [width, height]);
  const ring = useMemo(
    () => ({
      x: makeMutable(-500),
      y: makeMutable(-500),
      r: makeMutable(0),
      opacity: makeMutable(0),
      stroke: makeMutable(1),
    }),
    []
  );
  const gravity = useSharedValue({ x: 0, y: 1 });
  const floatTo = useSharedValue(0);
  const fpsLabel = useSharedValue('— fps');
  const [mode, setMode] = useState<'fall' | 'float'>('fall');
  // The knob's two edges, 0 on Gravity and 1 on Float: the leading edge sets off first, so it
  // stretches across like a drop of liquid and draws itself back in, with nothing to bounce
  const knobL = useSharedValue(0);
  const knobR = useSharedValue(0);
  const knobX = useSharedValue(pillX + 5);
  const knobW = useSharedValue(half - 5);
  const knobFlare = useSharedValue(30);

  // The values each marble's nodes read: written from the frame callback, read natively as slots
  const nodes = useMemo(
    () =>
      RADII.map(() => ({
        x: makeMutable(-400),
        y: makeMutable(-400),
        light: makeMutable(45),
        dispersion: makeMutable(18),
        sx: makeMutable(-200),
        sy: makeMutable(-200),
        cx: makeMutable(-200),
        cy: makeMutable(-200),
        mx: makeMutable(-200),
        my: makeMutable(-200),
        hx: makeMutable(-200),
        hy: makeMutable(-200),
      })),
    []
  );

  // Tilt is gravity. The simulator reports nothing, so a flat reading keeps it straight down.
  useEffect(() => {
    Accelerometer.setUpdateInterval(33);
    const sub = Accelerometer.addListener(({ x, y }) => {
      const len = Math.hypot(x, y);
      // Android reports the push back against gravity, iOS gravity itself: the same axes, opposite signs
      const sign = Platform.OS === 'android' ? -1 : 1;
      gravity.set(len < 0.15 ? { x: 0, y: 1 } : { x: (sign * x) / len, y: (-sign * y) / len });
    });
    return () => sub.remove();
  }, [gravity]);

  const fps = useSharedValue({ frames: 0, since: 0 });
  useFrameCallback((frame) => {
    'worklet';
    const w = world.get();
    const { width: bw, height: bh } = bounds.get();
    const dt = Math.min(Math.max((frame.timeSincePreviousFrame ?? 16) / 1000, 1 / 240), 1 / 30);
    w.gx = gravity.get().x;
    w.gy = gravity.get().y;
    w.floatTo = floatTo.get();
    step(w, dt, bw, Math.min(bh, floor));
    const places = rest.get();
    stepLetters(w, places, dt);
    for (let i = 0; i < places.x.length; i++) {
      motion[i].x.set(w.ldx[i]);
      motion[i].y.set(w.ldy[i]);
      motion[i].rot.set(w.lrot[i]);
    }

    for (let i = 0; i < w.x.length; i++) {
      const r = w.r[i];
      const x = w.x[i];
      const y = w.y[i];
      const dx = w.sunX - x;
      const dy = w.sunY - y;
      const len = Math.max(Math.hypot(dx, dy), 1);
      // Away from the light: where the shadow falls, and the bright spot the ball focuses into it
      const ax = -dx / len;
      const ay = -dy / len;
      const speed = Math.hypot(w.vx[i], w.vy[i]);
      const n = nodes[i];
      n.x.set(x - r);
      n.y.set(y - r);
      n.light.set((Math.atan2(dx, -dy) * 180) / Math.PI);
      n.dispersion.set(Math.min(18 + speed / 30, 85));
      n.sx.set(x + ax * r * 0.42);
      n.sy.set(y + ay * r * 0.42);
      n.cx.set(x + ax * r * 0.5);
      n.cy.set(y + ay * r * 0.5);
      n.mx.set(x);
      n.my.set(y);
      // The glint sits toward the light, a little in from the rim
      n.hx.set(x - ax * r * 0.48);
      n.hy.set(y - ay * r * 0.48);
    }
    sun.x.set(w.sunX);
    sun.y.set(w.sunY);
    const k = w.ringT;
    ring.x.set(w.ringX);
    ring.y.set(w.ringY);
    ring.r.set(16 + k * 300);
    ring.opacity.set((1 - k) * (1 - k));
    ring.stroke.set(1 + (1 - k) * 5);

    const travel = half - 5;
    const stretch = knobR.get() - knobL.get();
    knobX.set(pillX + 5 + knobL.get() * travel);
    knobW.set(half - 5 + stretch * travel);
    knobFlare.set(30 + Math.abs(stretch) * 140);

    const f = fps.get();
    f.frames++;
    if (frame.timestamp - f.since > 500) {
      fpsLabel.set(`${Math.round((f.frames * 1000) / (frame.timestamp - f.since))} fps`);
      f.frames = 0;
      f.since = frame.timestamp;
    }
  });

  const touch = useSharedValue({ onMarble: false, moved: false });
  const pan = Gesture.Pan()
    .minDistance(0)
    .onBegin((e) => {
      const w = world.get();
      const hit = marbleAt(w, e.x, e.y);
      touch.set({ onMarble: hit >= 0, moved: false });
      if (hit >= 0) {
        w.grab = hit;
        w.fx = e.x;
        w.fy = e.y;
      }
    })
    .onUpdate((e) => {
      const w = world.get();
      if (Math.abs(e.translationX) + Math.abs(e.translationY) > 6) touch.get().moved = true;
      if (w.grab >= 0) {
        w.fx = e.x;
        w.fy = e.y;
      } else if (touch.get().moved) {
        w.sunToX = e.x;
        w.sunToY = e.y;
      }
    })
    .onFinalize((e) => {
      const w = world.get();
      if (w.grab >= 0) {
        // Let go: it keeps the finger's speed
        w.vx[w.grab] = e.velocityX;
        w.vy[w.grab] = e.velocityY;
        w.grab = -1;
      } else if (!touch.get().moved) {
        shockwave(w, e.x, e.y, rest.get());
      }
    });

  const choose = (next: 'fall' | 'float') => {
    setMode(next);
    floatTo.set(next === 'float' ? 1 : 0);
    const to = next === 'float' ? 1 : 0;
    const lead = { duration: 240, easing: KNOB_EASE };
    const trail = { duration: 430, easing: KNOB_EASE };
    knobL.set(withTiming(to, to === 1 ? trail : lead));
    knobR.set(withTiming(to, to === 1 ? lead : trail));
  };

  return (
    <View
      style={styles.root}
      onLayout={(e) => {
        const next = e.nativeEvent.layout;
        if (next.width !== width || next.height !== height) setSize({ ...next, scale: 1, fontScale: 1 });
        bounds.set({ width: next.width, height: next.height });
      }}>
      <GestureDetector gesture={pan}>
        <View style={StyleSheet.absoluteFill} collapsable={false}>
          <Canvas style={StyleSheet.absoluteFill} fonts={FONTS}>
            <Fill>
              <Shader source={AURORA} uniforms={{ uSize: [width, height], uTime: clock, uSun: [sun.x, sun.y] }} />
            </Fill>
            <Path path={grid} color="rgba(255,255,255,0.07)" style="stroke" strokeWidth={1} />

            <Text
              x={left}
              y={insets.top + 70 * scale}
              text="REACT-NATIVE-TGFX  ·  <Glass />"
              fontFamily="Mono"
              fontSize={11 * scale}
              letterSpacing={1.5}
              color="rgba(255,255,255,0.7)"
            />
            {/* Counts the UI thread's frames, which only matches what reaches the screen on iOS */}
            {Platform.OS === 'ios' && (
              <Text
                x={left}
                y={insets.top + 92 * scale}
                text={fpsLabel}
                fontFamily="Mono"
                fontSize={11 * scale}
                letterSpacing={1.5}
                color="#7CF5D9"
              />
            )}
            {letters.map((l, i) => (
              <Group
                key={i}
                origin={{ x: l.cx, y: l.cy }}
                transform={[{ translate: [motion[i].x, motion[i].y] }, { rotate: motion[i].rot }]}>
                <Text x={l.x} y={l.baseline} text={l.char} fontFamily="Bricolage" fontSize={l.fontSize}>
                  {/* Lit by the sun: warm and bright close to it, falling away to violet */}
                  <RadialGradient
                    center={{ x: sun.x, y: sun.y }}
                    r={width * 1.3}
                    colors={['#FFF4DF', 'rgba(255,255,255,0.9)', 'rgba(186,176,255,0.42)']}
                    positions={[0, 0.4, 1]}
                  />
                </Text>
              </Group>
            ))}
            <Text
              x={left}
              y={height * 0.33 + 2.55 * big * 0.86 + 34 * scale}
              width={width * 0.7}
              lineHeight={17 * scale}
              text={
                'Physics on the UI thread. Each marble is one <Glass> node: its position, light and dispersion are slot writes, so no JS runs per frame.'
              }
              fontFamily="Mono"
              fontSize={11 * scale}
              color="rgba(255,255,255,0.62)"
            />

            {nodes.map((n, i) => (
              // Soft edges are gradients, not <Blur>: each blur is an offscreen pass, and there'd be 21 a frame
              <Circle key={`s${i}`} cx={n.sx} cy={n.sy} r={radii[i] * 1.3}>
                <RadialGradient
                  center={{ x: n.sx, y: n.sy }}
                  r={radii[i] * 1.3}
                  colors={['rgba(4,0,16,0.32)', 'rgba(4,0,16,0.3)', 'rgba(4,0,16,0)']}
                  positions={[0, 0.5, 1]}
                />
              </Circle>
            ))}
            {nodes.map((n, i) => (
              <Circle key={`c${i}`} cx={n.cx} cy={n.cy} r={radii[i] * 0.42} blendMode="plusLighter">
                <RadialGradient
                  center={{ x: n.cx, y: n.cy }}
                  r={radii[i] * 0.42}
                  colors={['rgba(255,226,170,0.45)', 'rgba(255,226,170,0.32)', 'rgba(255,226,170,0)']}
                  positions={[0, 0.45, 1]}
                />
              </Circle>
            ))}
            <Circle
              cx={ring.x}
              cy={ring.y}
              r={ring.r}
              opacity={ring.opacity}
              color="#FFFFFF"
              style="stroke"
              strokeWidth={ring.stroke}
            />
            {nodes.map((n, i) => (
              <Glass
                key={`g${i}`}
                x={n.x}
                y={n.y}
                width={radii[i] * 2}
                height={radii[i] * 2}
                r={radii[i]}
                refraction={90}
                depth={100}
                frost={0}
                dispersion={n.dispersion}
                splay={40}
                lightAngle={n.light}
                lightIntensity={75}
              />
            ))}
            {nodes.map((n, i) => (
              // Fresnel: a sphere's rim reflects more than its face
              <Circle key={`f${i}`} cx={n.mx} cy={n.my} r={radii[i]}>
                <RadialGradient
                  center={{ x: n.mx, y: n.my }}
                  r={radii[i]}
                  colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0)', 'rgba(255,255,255,0.2)']}
                  positions={[0, 0.7, 1]}
                />
              </Circle>
            ))}
            {nodes.map((n, i) => (
              <Circle key={`h${i}`} cx={n.hx} cy={n.hy} r={radii[i] * 0.17}>
                <RadialGradient
                  center={{ x: n.hx, y: n.hy }}
                  r={radii[i] * 0.17}
                  colors={['rgba(255,255,255,0.85)', 'rgba(255,255,255,0.8)', 'rgba(255,255,255,0)']}
                  positions={[0, 0.55, 1]}
                />
              </Circle>
            ))}

            <Glass
              x={pillX}
              y={pillY}
              width={PILL_W}
              height={PILL_H}
              r={PILL_H / 2}
              refraction={50}
              depth={30}
              frost={45}
              dispersion={10}
              lightIntensity={55}
            />
            <Glass
              x={knobX}
              y={pillY + 5}
              width={knobW}
              height={PILL_H - 10}
              r={(PILL_H - 10) / 2}
              refraction={70}
              depth={60}
              frost={0}
              dispersion={knobFlare}
              lightIntensity={90}
            />
            {(['fall', 'float'] as const).map((m, i) => (
              <Text
                key={m}
                x={pillX + i * half}
                y={pillY + PILL_H / 2 + 5}
                width={half}
                textAlign="center"
                text={m === 'fall' ? 'Gravity' : 'Float'}
                fontFamily="Mono"
                fontSize={13}
                color={mode === m ? '#FFFFFF' : 'rgba(255,255,255,0.55)'}
              />
            ))}
          </Canvas>
        </View>
      </GestureDetector>
      <View style={[styles.pill, { left: pillX, top: pillY, width: PILL_W, height: PILL_H }]}>
        <Pressable style={styles.half} onPress={() => choose('fall')} accessibilityLabel="Gravity" />
        <Pressable style={styles.half} onPress={() => choose('float')} accessibilityLabel="Float" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#07060F' },
  pill: { position: 'absolute', flexDirection: 'row' },
  half: { flex: 1 },
});
