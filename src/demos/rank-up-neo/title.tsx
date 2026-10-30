import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

/**
 * The league titles in the Codex lettering (scripts/rank_up_neo_art.py): wide capitals drawn as double
 * outlines of light, a picture to a letter, lit in the world's light: a soft glow of it under a crisp
 * line of it nearly white.
 */

const SHEET: {
  pad: number;
  cap: number;
  glyphs: Record<string, { w: number; h: number }>;
} = require('../../../assets/rank-up-neo/art/title/glyphs.json');

export const GLYPH_IMAGES: Record<string, number> = {
  A: require('../../../assets/rank-up-neo/art/title/A.png'),
  D: require('../../../assets/rank-up-neo/art/title/D.png'),
  E: require('../../../assets/rank-up-neo/art/title/E.png'),
  G: require('../../../assets/rank-up-neo/art/title/G.png'),
  I: require('../../../assets/rank-up-neo/art/title/I.png'),
  L: require('../../../assets/rank-up-neo/art/title/L.png'),
  O: require('../../../assets/rank-up-neo/art/title/O.png'),
  R: require('../../../assets/rank-up-neo/art/title/R.png'),
  S: require('../../../assets/rank-up-neo/art/title/S.png'),
  U: require('../../../assets/rank-up-neo/art/title/U.png'),
  V: require('../../../assets/rank-up-neo/art/title/V.png'),
};

/** The light the lettering's lit in: its glow and its line, and the glow as a colour for a shader */
export const LIGHTS = {
  cyan: { glow: '#22E5FF', line: '#DDFBFF', rgb: [0.13, 0.9, 1.0] },
  gold: { glow: '#FFB423', line: '#FFF2CC', rgb: [1.0, 0.71, 0.14] },
};
export type Light = keyof typeof LIGHTS;

/** Between letters and for a space, beyond each letter's own room for its glow, in the art's px */
const GAP = 16;
const SPACE = 80;

/** The scale from the art to letters `cap` pt tall */
const scale = (cap: number) => cap / SHEET.cap;

/**
 * Where each letter of `text` goes, at cap height `cap`: its left edge from the start of the line, and
 * its width; and the line's whole width
 */
export function titleLayout(text: string, cap: number) {
  const k = scale(cap);
  let x = 0;
  const letters = text.split('').map((c, i) => {
    if (i > 0) x += GAP * k;
    const w = c === ' ' ? SPACE * k : SHEET.glyphs[c].w * k;
    const at = { c, x, w };
    x += w;
    return at;
  });
  return { letters, width: x, height: (SHEET.cap + SHEET.pad * 2) * k };
}

/** How big letter `c` is drawn `cap` pt tall, room for its glow and all */
export function glyphSize(c: string, cap: number) {
  const k = scale(cap);
  return { w: SHEET.glyphs[c].w * k, h: SHEET.glyphs[c].h * k };
}

/** One letter, `cap` pt tall */
export function Glyph({ c, cap, light }: { c: string; cap: number; light: Light }) {
  const g = glyphSize(c, cap);
  const l = LIGHTS[light];
  return (
    <View style={{ width: g.w, height: g.h }}>
      <Image source={GLYPH_IMAGES[c]} style={StyleSheet.absoluteFill} tintColor={l.glow} blurRadius={8} />
      <Image source={GLYPH_IMAGES[c]} style={StyleSheet.absoluteFill} tintColor={l.glow} />
      <Image source={GLYPH_IMAGES[c]} style={[StyleSheet.absoluteFill, styles.core]} tintColor={l.line} />
    </View>
  );
}

/** A title, still, on one line */
export function Title({ text, cap, light }: { text: string; cap: number; light: Light }) {
  const { letters, width, height } = titleLayout(text, cap);
  return (
    <View style={{ width, height }}>
      {letters.map(({ c, x }, i) =>
        c === ' ' ? null : (
          <View key={i} style={[styles.at, { left: x }]}>
            <Glyph c={c} cap={cap} light={light} />
          </View>
        )
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  at: { position: 'absolute', top: 0 },
  // A line nearly white over the coloured one, so the light has a hot core
  core: { opacity: 0.75 },
});
