import { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, useDerivedValue, type SharedValue } from 'react-native-reanimated';
import {
  BlurMask,
  Circle,
  Group,
  Image,
  Oval,
  Path,
  RadialGradient,
  Rect,
  rect,
  RoundedRect,
  Skia,
  useImage,
  vec,
} from 'react-native-skia';

import { LateCanvas } from '@/components/late-canvas';
import { Burst } from '../daily-drop/fx';
import { inOutCubic, mix, outBack, span } from '../rank-up/ui';
import { FINALE, levelAt, ROUNDED, SPOOK, STEPS } from './data';
import { Flyers } from './fx';
import { SPIDER, SPIDER_SHEET, WEB, WEB_CORNER } from './spiders';
import type { BarProps, Cue } from './types';

/**
 * The ghost run: the bar's a thread of spider silk strung across the graveyard between two cobwebs,
 * beaded with dew, a lantern hanging off it at every fifth. A little ghost glides along it, leaving
 * a glowing green trail, and as it passes each lantern the lantern lights. At the end it floats up
 * into the middle; a big spider drops down on its thread right in front of it, and the ghost puffs up
 * and BOOs. The spider shoots back up, and ghosts pour out all round.
 */

export const WEB_LAG = 0;
const lanternAt = (k: number) => {
  'worklet';
  return STEPS[k] + 0.45;
};
const BOO = FINALE + 0.8;

/** The ghost: a round head, a body, a wavy hem, drawn about its middle `g` across its half */
function ghost(g: number) {
  const b = Skia.PathBuilder.Make();
  b.moveTo(-g, g * 0.95);
  b.lineTo(-g, -g * 0.15);
  b.cubicTo(-g, -g * 1.35, g, -g * 1.35, g, -g * 0.15);
  b.lineTo(g, g * 0.95);
  const n = 4;
  for (let i = 0; i < n; i++) {
    const xa = g - (i * 2 * g) / n;
    const xb = g - ((i + 1) * 2 * g) / n;
    b.quadTo((xa + xb) / 2, g * (i % 2 ? 1.3 : 0.62), xb, g * 0.95);
  }
  b.close();
  return b.detach();
}

export function GhostWeb({ t, ambient, width, y }: BarProps) {
  const x0 = 30;
  const x1 = width - 30;
  const sag = 18;
  /** A point along the thread, k from 0 to 1 */
  const at = (k: number) => {
    'worklet';
    const u = 1 - k;
    return {
      x: u * u * x0 + 2 * u * k * (width / 2) + k * k * x1,
      y: u * u * y + 2 * u * k * (y + sag * 2) + k * k * y,
    };
  };
  const thread = useMemo(() => {
    const b = Skia.PathBuilder.Make();
    b.moveTo(x0, y);
    b.quadTo(width / 2, y + sag * 2, x1, y);
    return b.detach();
  }, [width, y, x1]);
  const web = useImage(WEB);
  const sheet = useImage(SPIDER_SHEET);
  const G = 24;
  const body = useMemo(() => ghost(G), []);
  const level = useDerivedValue(() => levelAt(t.value, WEB_LAG));
  const trail = useDerivedValue(() => Math.max(0.001, level.value));

  // The ghost: along the thread, bobbing and leaning into the glide; then up into the middle to BOO
  const centre = { x: width / 2, y: y - 30 };
  const ghostMove = useDerivedValue(() => {
    const u = t.value;
    const p = at(Math.min(1, level.value));
    const up = inOutCubic(span(u, FINALE - 0.1, 0.6));
    const bob = Math.sin(ambient.value * 3) * 5;
    let speed = 0;
    for (let k = 0; k < 5; k++) speed += Math.sin(Math.PI * span(u, STEPS[k], 0.55));
    const boo = u - BOO;
    const puff = boo > 0 ? outBack(Math.min(1, boo / 0.25), 2.4) * 0.9 * Math.exp(-Math.max(0, boo - 0.6) * 2) : 0;
    return [
      { translateX: mix(p.x, centre.x, up) },
      { translateY: mix(p.y - 40, centre.y, up) + bob },
      { rotate: -0.25 * Math.min(1, speed) + Math.sin(ambient.value * 2) * 0.05 },
      { scale: 1 + puff },
    ];
  });
  const blink = useDerivedValue(() => {
    const ph = ambient.value % 3.2;
    return [{ scaleY: ph > 3.05 ? 0.1 : 1 }];
  });
  const mouthOpen = useDerivedValue(() => {
    const boo = t.value - BOO;
    return [{ scaleY: boo > 0 && boo < 0.9 ? 2.4 : 1 }, { scaleX: boo > 0 && boo < 0.9 ? 1.5 : 1 }];
  });

  // The spider: down on its thread, wriggling, then back up in a flash
  const spiderY = useDerivedValue(() => {
    const u = t.value;
    const down = outBack(span(u, FINALE + 0.1, 0.5), 1.4);
    const flee = span(u, BOO + 0.12, 0.35);
    return mix(-80, centre.y - 72, down) - flee * flee * 500;
  });
  const SP = 110;
  const C = SPIDER.cell;
  const spider = useDerivedValue(() => [
    { translateX: centre.x },
    { translateY: spiderY.value },
    { rotate: Math.sin(ambient.value * 18) * 0.05 },
  ]);
  const legsGoing = useDerivedValue(() => {
    const f = Math.floor(ambient.value * 16) % SPIDER.frames;
    return { x: -(f % SPIDER.cols) * C, y: -Math.floor(f / SPIDER.cols) * C };
  });
  const fx = useDerivedValue(() => legsGoing.value.x);
  const fy = useDerivedValue(() => legsGoing.value.y);
  const spiderThread = useDerivedValue(() => Math.max(0, spiderY.value));
  const scared = useDerivedValue(() => {
    const boo = t.value - BOO;
    return [{ scale: boo > 0 ? 1 + 0.3 * Math.exp(-boo * 6) : 1 }];
  });
  const spiderOn = useDerivedValue(() => (t.value > FINALE && t.value < BOO + 0.6 ? 1 : 0));

  const lanterns = [0.2, 0.4, 0.6, 0.8, 1].map((k) => at(k * 0.97));
  const dew = Array.from({ length: 11 }, (_, i) => at((i + 0.5) / 11));
  const done = useDerivedValue(() => Math.max(0, t.value - BOO));
  return (
    <>
      <LateCanvas style={StyleSheet.absoluteFill}>
        {web ? (
          <>
            <Image
              image={web}
              x={x0 - 14 - WEB_CORNER * 90}
              y={y - 52 - WEB_CORNER * 90}
              width={90}
              height={90}
              opacity={0.8}
            />
            <Group transform={[{ translateX: x1 + 14 }, { scaleX: -1 }]}>
              <Image
                image={web}
                x={-WEB_CORNER * 90}
                y={y - 52 - WEB_CORNER * 90}
                width={90}
                height={90}
                opacity={0.8}
              />
            </Group>
          </>
        ) : null}
        <Path path={thread} style="stroke" strokeWidth={1.4} color="rgba(255,255,255,0.55)" />
        <Path path={thread} style="stroke" strokeWidth={9} strokeCap="round" color={SPOOK.toxic} end={trail}>
          <BlurMask blur={8} style="normal" />
        </Path>
        <Path path={thread} style="stroke" strokeWidth={2.5} strokeCap="round" color="#E6FFD0" end={trail} />
        {dew.map((p, i) => (
          <Circle key={i} cx={p.x} cy={p.y + 2} r={1.8} color="rgba(220,240,255,0.7)" />
        ))}
        {lanterns.map((p, k) => (
          <Lantern key={k} k={k} t={t} ambient={ambient} x={p.x} y={p.y} />
        ))}

        <Group opacity={spiderOn}>
          <Rect x={centre.x - 0.6} y={0} width={1.2} height={spiderThread} color="rgba(255,255,255,0.6)" />
          <Group transform={spider}>
            <Group transform={scared}>
              {sheet ? (
                <Group
                  transform={[
                    { scale: SP / C },
                    { translateX: -SPIDER.anchor.x * C },
                    { translateY: -SPIDER.anchor.y * C },
                  ]}
                  clip={rect(0, 0, C, C)}>
                  <Image
                    image={sheet}
                    x={fx}
                    y={fy}
                    width={C * SPIDER.cols}
                    height={C * Math.ceil(SPIDER.frames / SPIDER.cols)}
                  />
                </Group>
              ) : null}
            </Group>
          </Group>
        </Group>

        <Group transform={ghostMove}>
          <Path path={body} color={SPOOK.toxic} opacity={0.5}>
            <BlurMask blur={14} style="normal" />
          </Path>
          <Path path={body}>
            <RadialGradient c={vec(-6, -10)} r={G * 1.6} colors={['#FFFFFF', '#F3F6FF', '#C9D3EE']} />
          </Path>
          <Group transform={[{ translateY: -G * 0.25 }]}>
            <Group transform={blink}>
              <Oval x={-G * 0.46} y={-G * 0.2} width={G * 0.26} height={G * 0.36} color={SPOOK.ink} />
              <Oval x={G * 0.2} y={-G * 0.2} width={G * 0.26} height={G * 0.36} color={SPOOK.ink} />
            </Group>
          </Group>
          <Group transform={[{ translateY: G * 0.28 }]}>
            <Group transform={mouthOpen}>
              <Oval x={-G * 0.1} y={-G * 0.1} width={G * 0.2} height={G * 0.2} color={SPOOK.ink} />
            </Group>
          </Group>
          <Oval x={-G * 0.62} y={G * 0.05} width={G * 0.24} height={G * 0.12} color="rgba(255,120,150,0.35)" />
          <Oval x={G * 0.38} y={G * 0.05} width={G * 0.24} height={G * 0.12} color="rgba(255,120,150,0.35)" />
        </Group>
      </LateCanvas>

      <Boo t={t} x={centre.x} y={centre.y - 70} />
      <Burst
        clock={done}
        x={centre.x}
        y={centre.y}
        kind="sparkle"
        palette={['#FFFFFF', SPOOK.toxic, '#D7FF8A']}
        count={40}
        life={1.4}
        power={1.5}
      />
      <Flyers t={t} at={BOO + 0.2} x={centre.x} y={centre.y} items={['👻']} count={8} kind="ghosts" size={40} />
      <Flyers t={t} at={BOO + 0.05} x={centre.x} y={centre.y + 30} items={['🦇']} count={8} kind="bats" size={28} />
    </>
  );
}

/** Lantern k hanging off the thread, dark until the ghost passes, then glowing and swinging */
function Lantern({
  k,
  t,
  ambient,
  x,
  y,
}: {
  k: number;
  t: SharedValue<number>;
  ambient: SharedValue<number>;
  x: number;
  y: number;
}) {
  const lit = useDerivedValue(() => span(t.value, lanternAt(k), 0.15));
  const green = useDerivedValue(() => span(t.value, BOO, 0.3));
  const swing = useDerivedValue(() => {
    const d = t.value - lanternAt(k);
    const kick = d > 0 ? 0.35 * Math.exp(-d * 2) * Math.sin(d * 9) : 0;
    return [{ translateX: x }, { translateY: y }, { rotate: kick + Math.sin(ambient.value * 1.3 + k) * 0.04 }];
  });
  const glow = useDerivedValue(() => lit.value * (0.8 + 0.2 * Math.sin(ambient.value * 17 + k * 3)));
  const greenGlow = useDerivedValue(() => glow.value * green.value);
  return (
    <Group transform={swing}>
      <Rect x={-0.6} y={0} width={1.2} height={20} color="rgba(255,255,255,0.45)" />
      <Group opacity={glow}>
        <Circle cx={0} cy={34} r={30} color="rgba(255,170,60,0.5)">
          <BlurMask blur={16} style="normal" />
        </Circle>
      </Group>
      <Group opacity={greenGlow}>
        <Circle cx={0} cy={34} r={32} color="rgba(124,240,58,0.6)">
          <BlurMask blur={16} style="normal" />
        </Circle>
      </Group>
      <RoundedRect x={-7} y={18} width={14} height={5} r={2} color="#2B2333" />
      <RoundedRect x={-11} y={22} width={22} height={24} r={5} color="#3A2F46" />
      <RoundedRect x={-8} y={25} width={16} height={18} r={3} color="#1B1426" />
      <Group opacity={glow}>
        <RoundedRect x={-8} y={25} width={16} height={18} r={3}>
          <RadialGradient c={vec(0, 36)} r={12} colors={['#FFF6C8', SPOOK.flame, SPOOK.pumpkin]} />
        </RoundedRect>
      </Group>
      <Group opacity={greenGlow}>
        <RoundedRect x={-8} y={25} width={16} height={18} r={3}>
          <RadialGradient c={vec(0, 36)} r={12} colors={['#F2FFD8', SPOOK.toxic, SPOOK.toxicDeep]} />
        </RoundedRect>
      </Group>
      <Rect x={-0.8} y={25} width={1.6} height={18} color="#3A2F46" />
      <RoundedRect x={-12} y={45} width={24} height={4} r={2} color="#2B2333" />
    </Group>
  );
}

/** BOO! bursting out of the ghost */
function Boo({ t, x, y }: { t: SharedValue<number>; x: number; y: number }) {
  const s = useAnimatedStyle(() => {
    const d = t.value - BOO;
    if (d < 0 || d > 1.3) return { opacity: 0 };
    return {
      opacity: 1 - span(d, 0.9, 0.4),
      transform: [
        { translateX: x - 110 },
        { translateY: y - 40 - d * 30 },
        { scale: outBack(Math.min(1, d / 0.22), 3) },
        { rotate: `${Math.sin(d * 40) * 4 * Math.exp(-d * 4)}deg` },
      ],
    };
  });
  return <Animated.Text style={[styles.boo, s]}>BOO!</Animated.Text>;
}

export const WEB_CUES: Cue[] = [
  ...STEPS.flatMap((s, k) => [
    { at: s, sound: 'whoosh' as const, gain: 0.45 },
    { at: lanternAt(k), sound: 'ignite' as const, gain: 0.45, feel: 'light' as const },
  ]),
  { at: FINALE - 0.1, sound: 'whoosh', gain: 0.6 },
  { at: FINALE + 0.1, sound: 'spider', gain: 0.9, feel: 'light' },
  { at: BOO, sound: 'boo', gain: 1, feel: 'heavy' },
  { at: BOO + 0.12, sound: 'spider', gain: 0.6 },
  { at: BOO + 0.2, sound: 'ghost', gain: 0.6 },
  { at: BOO + 0.05, sound: 'bats', gain: 0.6 },
];

const styles = StyleSheet.create({
  boo: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: 220,
    textAlign: 'center',
    fontFamily: ROUNDED,
    fontWeight: '900',
    fontSize: 64,
    color: SPOOK.white,
    textShadowColor: SPOOK.toxic,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 18,
  },
});
