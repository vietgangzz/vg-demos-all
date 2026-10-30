import { StyleSheet, Text, View } from 'react-native';
import { BlurMask, Path, Skia } from 'react-native-skia';

import { LateCanvas } from '@/components/late-canvas';

/**
 * The top three places, each lit its own colour: gold, silver and bronze. Their rank sits in a chip
 * cut like the buttons, its corners cut off, edged in a double line of the colour with a glow round
 * it; and the row in that place has an edge of the same light. Below the top three, a plain number.
 * It follows the place, not the player: climb into the top three and it lights up round you.
 */

export const PODIUM: Record<number, { line: string; glow: string; fill: string; ink: string; edge: string }> = {
  1: {
    line: '#FFD27A',
    glow: 'rgba(255, 186, 52, 0.95)',
    fill: 'rgba(255, 186, 52, 0.16)',
    ink: '#FFF1CC',
    edge: 'rgba(255, 196, 80, 0.75)',
  },
  2: {
    line: '#E4F0FA',
    glow: 'rgba(190, 220, 245, 0.85)',
    fill: 'rgba(190, 220, 245, 0.12)',
    ink: '#F4FAFF',
    edge: 'rgba(214, 232, 248, 0.6)',
  },
  3: {
    line: '#F29558',
    glow: 'rgba(232, 116, 52, 0.9)',
    fill: 'rgba(232, 116, 52, 0.15)',
    ink: '#FFD2B2',
    edge: 'rgba(240, 140, 80, 0.7)',
  },
};

/** The chip: how big, how much is cut off each corner, and room round it for its glow */
const W = 34;
const H = 24;
const CUT = 6;
const M = 8;

/** A box w by h at (x, y), its corners cut off by c */
function chamfer(x: number, y: number, w: number, h: number, c: number) {
  return Skia.PathBuilder.Make()
    .moveTo(x + c, y)
    .lineTo(x + w - c, y)
    .lineTo(x + w, y + c)
    .lineTo(x + w, y + h - c)
    .lineTo(x + w - c, y + h)
    .lineTo(x + c, y + h)
    .lineTo(x, y + h - c)
    .lineTo(x, y + c)
    .close()
    .detach();
}

const OUTER = chamfer(M, M, W, H, CUT);
const INNER = chamfer(M + 3, M + 3, W - 6, H - 6, CUT - 2);
/** A short bar of light along the bottom edge, like the buttons' */
const BAR = Skia.PathBuilder.Make()
  .moveTo(M + W / 2 - 6, M + H - 1.5)
  .lineTo(M + W / 2 + 6, M + H - 1.5)
  .detach();

/** A place's number: in its chip in the top three, plain below them */
export function RankChip({ rank, plain }: { rank: number; plain: string }) {
  const tier = PODIUM[rank];
  const label = String(rank).padStart(2, '0');
  if (!tier) return <Text style={[styles.plain, { color: plain }]}>{label}</Text>;
  return (
    <View style={styles.chip}>
      <LateCanvas style={styles.canvas}>
        <Path path={OUTER} color={tier.fill} />
        <Path path={OUTER} style="stroke" strokeWidth={2} color={tier.glow}>
          <BlurMask blur={4} style="normal" />
        </Path>
        <Path path={OUTER} style="stroke" strokeWidth={1.2} color={tier.line} />
        <Path path={INNER} style="stroke" strokeWidth={0.6} color={tier.line} opacity={0.45} />
        <Path path={BAR} style="stroke" strokeWidth={1.5} strokeCap="round" color="#FFFFFF" />
      </LateCanvas>
      <Text style={[styles.number, { color: tier.ink, textShadowColor: tier.glow }]}>{label}</Text>
    </View>
  );
}

/** The edge of light round a row in the top three; nothing below them */
export function PodiumEdge({ rank }: { rank: number }) {
  const tier = PODIUM[rank];
  if (!tier) return null;
  return (
    <View
      style={[styles.edge, { borderColor: tier.edge, boxShadow: `0 0 14px ${tier.fill}, inset 0 0 16px ${tier.fill}` }]}
      pointerEvents="none"
    />
  );
}

const styles = StyleSheet.create({
  plain: { width: W, textAlign: 'center', fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'] },
  chip: { width: W, height: H, alignItems: 'center', justifyContent: 'center' },
  canvas: { position: 'absolute', left: -M, top: -M, width: W + M * 2, height: H + M * 2 },
  number: {
    fontSize: 13,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 6,
  },
  edge: {
    ...StyleSheet.absoluteFill,
    borderRadius: 14,
    borderCurve: 'continuous',
    borderWidth: 1,
  },
});
