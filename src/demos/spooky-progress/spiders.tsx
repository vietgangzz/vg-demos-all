import { StyleSheet } from 'react-native';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';
import { Group, Image, Rect, rect, useImage } from 'react-native-skia';

import { LateCanvas } from '@/components/late-canvas';
import { outBack, span } from '../rank-up/ui';

/**
 * Spiders hanging over it all on their threads, and dewy cobwebs in the top corners, all rendered in
 * Blender (scripts/blender/spooky_progress.py). The spiders let themselves down as it opens, each to
 * its own depth, and hang there swinging, legs going. With every right answer one of them drops a
 * little and bounces back up its thread; as each bar goes off they drop hard, and once it's all over
 * they shoot back up out of sight.
 */

export const SPIDER_SHEET = require('../../../assets/spooky-progress/art/spider.png');
export const WEB = require('../../../assets/spooky-progress/art/web.png');
/** The spider sheet: frames of its legs going round, COLS across, CELL px square */
export const SPIDER = {
  frames: 8,
  cols: 4,
  cell: 256,
  /** Where its thread meets it, as fractions of a cell */ anchor: { x: 0.5, y: 0.22 },
};
/** The cobweb render: where its corner is, as a fraction of its size in from the top left */
export const WEB_CORNER = 0.036;

const rnd = (i: number, k: number) => {
  'worklet';
  const s = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return s - Math.floor(s);
};

export type Hang = { x: number; depth: number; size: number };

export function Spiders({
  t,
  ambient,
  width,
  hangs,
  bumps,
  drops,
  away,
}: {
  t: SharedValue<number>;
  ambient: SharedValue<number>;
  width: number;
  /** Where each hangs from, how far down it lets itself, and how big it is (px across) */
  hangs: Hang[];
  /** The moments they bounce (each answer), drop hard (each bar going off), and shoot back up */
  bumps: number[];
  drops: number[];
  away: number;
}) {
  const sheet = useImage(SPIDER_SHEET);
  const web = useImage(WEB);
  const big = width * 0.5;
  const small = width * 0.36;
  return (
    <LateCanvas style={StyleSheet.absoluteFill}>
      {web ? (
        <>
          <Image image={web} x={-WEB_CORNER * big} y={-WEB_CORNER * big} width={big} height={big} opacity={0.85} />
          <Group transform={[{ translateX: width }, { scaleX: -1 }]}>
            <Image
              image={web}
              x={-WEB_CORNER * small}
              y={-WEB_CORNER * small}
              width={small}
              height={small}
              opacity={0.75}
            />
          </Group>
        </>
      ) : null}
      {sheet
        ? hangs.map((h, i) => (
            <Spider
              key={i}
              i={i}
              t={t}
              ambient={ambient}
              hang={h}
              sheet={sheet}
              bumps={bumps}
              drops={drops}
              away={away}
            />
          ))
        : null}
    </LateCanvas>
  );
}

function Spider({
  i,
  t,
  ambient,
  hang,
  sheet,
  bumps,
  drops,
  away,
}: {
  i: number;
  t: SharedValue<number>;
  ambient: SharedValue<number>;
  hang: Hang;
  sheet: NonNullable<ReturnType<typeof useImage>>;
  bumps: number[];
  drops: number[];
  away: number;
}) {
  const C = SPIDER.cell;
  const depth = useDerivedValue(() => {
    const u = t.value;
    const down = outBack(span(u, 0.15 + i * 0.12, 0.7), 1.3);
    // Each answer, the one whose turn it is drops a little and bounces back
    let bob = 0;
    for (let k = 0; k < bumps.length; k++) {
      if (k % 4 !== i % 4) continue;
      const d = u - bumps[k];
      if (d > 0) bob += 34 * Math.exp(-d * 3.5) * Math.sin(d * 9);
    }
    // Each bar going off, they all drop hard and spring
    let drop = 0;
    for (let k = 0; k < drops.length; k++) {
      const d = u - drops[k] - rnd(i, 1) * 0.08;
      if (d > 0) drop += 70 * Math.exp(-d * 2.6) * Math.sin(d * 7 + 0.5);
    }
    const up = span(u, away + i * 0.06, 0.45);
    return (hang.depth * down + bob + drop) * (1 - up * up) - up * 160 + Math.sin(ambient.value * 1.1 + i) * 6;
  });
  const swing = useDerivedValue(() => Math.sin(ambient.value * (0.9 + rnd(i, 2) * 0.5) + i * 2) * 0.12);
  const thread = useDerivedValue(() => [{ translateX: hang.x }, { rotate: swing.value }]);
  const body = useDerivedValue(() => [
    { translateX: hang.x },
    { rotate: swing.value },
    { translateY: depth.value },
    { rotate: -swing.value * 0.6 },
    { scale: hang.size / C },
    { translateX: -SPIDER.anchor.x * C },
    { translateY: -SPIDER.anchor.y * C },
  ]);
  // Its legs going round: faster while it's dropping or climbing
  const frame = useDerivedValue(() => {
    const f = Math.floor(ambient.value * (9 + rnd(i, 3) * 4) + i * 3) % SPIDER.frames;
    return { x: -(f % SPIDER.cols) * C, y: -Math.floor(f / SPIDER.cols) * C };
  });
  const fx = useDerivedValue(() => frame.value.x);
  const fy = useDerivedValue(() => frame.value.y);
  return (
    <>
      <Group transform={thread}>
        <Rect x={-0.6} y={0} width={1.2} height={depth} color="rgba(255,255,255,0.5)" />
      </Group>
      <Group transform={body} clip={rect(0, 0, C, C)}>
        <Image
          image={sheet}
          x={fx}
          y={fy}
          width={C * SPIDER.cols}
          height={C * Math.ceil(SPIDER.frames / SPIDER.cols)}
        />
      </Group>
    </>
  );
}
