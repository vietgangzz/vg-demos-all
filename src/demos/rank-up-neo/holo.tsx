import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useDerivedValue, type SharedValue } from 'react-native-reanimated';
import { Fill, Group, Image, Paint, Shader, Shadow, Skia, useImage } from 'react-native-skia';

import { LateCanvas } from '@/components/late-canvas';
import { useSettled } from './ui';
import { GLYPH_IMAGES, glyphSize, LIGHTS, titleLayout, type Light } from './title';

/**
 * A title in holographic foil: the lettering's lines of light (title.tsx) in the world's light, hot at
 * the core, with thin bands of every colour on a slant running through it like oil on metal, sliding as
 * the phone tips and drifting on their own; fine scanlines across it, a bar of glare sweeping over now
 * and then, and a glow of the world's light all round. The foil runs on across the whole line, letter
 * to letter.
 *
 * Each letter's a view of its own, posed by `pose` at the time on `clock` (so it can drop in on its
 * own), with the foil drawn in a little Skia canvas inside it.
 */

const HOLO = Skia.RuntimeEffect.Make(`
uniform float2 res;
uniform float2 at;
uniform float time;
uniform float2 tilt;
uniform float glint;
uniform float3 tint;

half4 main(float2 q) {
  // Where on the whole line this is
  float2 p = q + at;
  float2 uv = p / res;
  // Thin bands of every colour on a slant through the world's light, sliding as the phone tips
  float b = uv.x * 1.2 - uv.y * 0.6 + tilt.x * 0.7 + tilt.y * 0.35 + time * 0.06;
  float3 rainbow = 0.5 + 0.5 * cos(6.28318 * (b + float3(0.0, 0.33, 0.67)));
  float band = pow(0.5 + 0.5 * sin(b * 9.42478), 6.0);
  float3 col = mix(tint, mix(rainbow, float3(1.0), 0.35), band * 0.65);
  // Hot at the core
  col = mix(col, float3(1.0), 0.25);
  // Scanlines
  col *= 0.84 + 0.16 * step(0.5, fract(p.y / 2.5));
  // The glare, a bright bar leaning a little as it sweeps across
  col += exp(-pow((uv.x + (uv.y - 0.5) * 0.3 - glint) / 0.05, 2.0)) * 0.9;
  return half4(half3(min(col, float3(1.0))), 1.0);
}`)!;

/** Where a letter's dropped to (pt, up negative), how big it is, and how much it's there */
export type Pose = { y: number; scale: number; opacity: number };
/** Letter `i`'s pose at time `now`, its middle `centre` across the screen */
type Poser = (now: number, i: number, centre: number) => Pose;
/** Room round each letter's canvas for its glow */
const GLOW = 14;

/** What moves the foil, each only set as it changes */
type Foil = {
  time: SharedValue<number>;
  tiltX: SharedValue<number>;
  tiltY: SharedValue<number>;
  glint: SharedValue<number>;
};

export function HoloTitle({
  text,
  cap,
  light,
  width,
  top,
  ambient,
  tilt,
  glint,
  clock,
  from,
  pose,
}: {
  text: string;
  /** How tall its capitals are (pt) */
  cap: number;
  light: Light;
  /** The screen's width, and where the line's top is down it */
  width: number;
  top: number;
  ambient: SharedValue<number>;
  /** Which way the phone's tipped, each about -1 to 1 */
  tilt: SharedValue<{ x: number; y: number }>;
  /** Where the glare is across the line (0 to 1, off either side beyond) */
  glint: SharedValue<number>;
  clock: SharedValue<number>;
  /** When on the clock it starts to show */
  from: number;
  pose: Poser;
}) {
  const { letters, width: line, height } = titleLayout(text, cap);
  // The foil held still till the title's showing, so nothing on its canvases changes and they aren't
  // drawn again every frame while it's hidden
  const time = useSettled(() => {
    'worklet';
    return clock.value >= from ? ambient.value : 0;
  });
  const tiltX = useSettled(() => {
    'worklet';
    return clock.value >= from ? tilt.value.x : 0;
  });
  const tiltY = useSettled(() => {
    'worklet';
    return clock.value >= from ? tilt.value.y : 0;
  });
  const shine = useSettled(() => {
    'worklet';
    return clock.value >= from ? glint.value : -1;
  });
  const left = (width - line) / 2;
  return (
    <View style={[styles.line, { left, top, width: line, height }]} pointerEvents="none">
      {letters.map(({ c, x, w }, i) =>
        c === ' ' ? null : (
          <Letter
            key={i}
            c={c}
            cap={cap}
            light={light}
            x={x}
            line={[line, height]}
            i={i}
            centre={left + x + w / 2}
            clock={clock}
            pose={pose}
            foil={{ time, tiltX, tiltY, glint: shine }}
          />
        )
      )}
    </View>
  );
}

function Letter({
  c,
  cap,
  light,
  x,
  line,
  i,
  centre,
  clock,
  pose,
  foil,
}: {
  c: string;
  cap: number;
  light: Light;
  x: number;
  line: [number, number];
  i: number;
  centre: number;
  clock: SharedValue<number>;
  pose: Poser;
  foil: Foil;
}) {
  const image = useImage(GLYPH_IMAGES[c]);
  const { w, h } = glyphSize(c, cap);
  // Read straight off the clock here, not inside `pose`: a worklet only runs again for the shared
  // values it reads itself
  const style = useAnimatedStyle(() => {
    const p = pose(clock.value, i, centre);
    return { opacity: p.opacity, transform: [{ translateY: p.y }, { scale: p.scale }] };
  });
  const { time, tiltX, tiltY, glint } = foil;
  const uniforms = useDerivedValue(() => ({
    res: line,
    at: [x - GLOW, -GLOW],
    time: time.value,
    tilt: [tiltX.value, tiltY.value],
    glint: glint.value,
    tint: LIGHTS[light].rgb,
  }));
  return (
    <Animated.View style={[styles.letter, { left: x, width: w, height: h }, style]}>
      {image ? (
        <View style={[styles.canvas, { width: w + GLOW * 2, height: h + GLOW * 2 }]}>
          <LateCanvas style={StyleSheet.absoluteFill}>
            <Group
              layer={
                <Paint>
                  <Shadow dx={0} dy={0} blur={6} color={LIGHTS[light].glow} />
                </Paint>
              }>
              <Image image={image} x={GLOW} y={GLOW} width={w} height={h} fit="fill" />
              <Fill blendMode="srcIn">
                <Shader source={HOLO} uniforms={uniforms} />
              </Fill>
            </Group>
          </LateCanvas>
        </View>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  line: { position: 'absolute' },
  letter: { position: 'absolute', top: 0 },
  canvas: { position: 'absolute', left: -GLOW, top: -GLOW },
});
