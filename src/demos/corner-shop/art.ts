import { Image } from 'react-native';
import {
  BlendMode,
  FontWeight,
  PaintStyle,
  Skia,
  StrokeCap,
  TextAlign,
  type SkCanvas,
  type SkTypeface,
} from 'react-native-skia';
import * as THREE from 'three/webgpu';

import type { Theme } from './themes';

/**
 * What's printed on the cardboard: the shop's sign, the awning's stripes, the posters, the door's
 * gilt lettering and its hanging sign, the doormat, the floor tiles. Drawn with Skia in print
 * colours (the flat, slightly uneven ink of a printed carton) and handed to three.js as textures.
 */

export type Fonts = {
  /** Tall condensed caps, the way shipping boxes are stencilled */
  caps: SkTypeface | null;
  sans: SkTypeface | null;
  hand: SkTypeface | null;
  mono: SkTypeface | null;
};

let fonts: Promise<Fonts> | null = null;

async function face(asset: number) {
  try {
    const uri = Image.resolveAssetSource(asset).uri;
    return Skia.Typeface.MakeFreeTypeFaceFromData(await Skia.Data.fromURI(uri));
  } catch {
    return null;
  }
}

export function loadFonts() {
  fonts ??= (async () => {
    const [caps, sans, hand, mono] = await Promise.all([
      face(require('@expo-google-fonts/six-caps/400Regular/SixCaps_400Regular.ttf')),
      face(require('@expo-google-fonts/inter-tight/800ExtraBold/InterTight_800ExtraBold.ttf')),
      face(require('@expo-google-fonts/patrick-hand/400Regular/PatrickHand_400Regular.ttf')),
      face(require('@expo-google-fonts/jetbrains-mono/500Medium/JetBrainsMono_500Medium.ttf')),
    ]);
    return { caps, sans, hand, mono };
  })();
  return fonts;
}

/** A Skia drawing as a texture, unpremultiplied and flipped the way three.js wants it */
export function canvasTexture(w: number, h: number, paint: (c: SkCanvas) => void) {
  const pixels = new Uint8Array(w * h * 4);
  const surface = Skia.Surface.Make(w, h);
  if (surface) {
    const canvas = surface.getCanvas();
    canvas.clear(Skia.Color('transparent'));
    paint(canvas);
    surface.flush();
    const read = surface.makeImageSnapshot().readPixels();
    if (read instanceof Uint8Array && read.length === pixels.length) pixels.set(read);
  }
  for (let i = 0; i < pixels.length; i += 4) {
    const a = pixels[i + 3];
    if (a > 0 && a < 255) {
      pixels[i] = Math.min(255, (pixels[i] * 255) / a);
      pixels[i + 1] = Math.min(255, (pixels[i + 1] * 255) / a);
      pixels[i + 2] = Math.min(255, (pixels[i + 2] * 255) / a);
    }
  }
  const flipped = new Uint8Array(pixels.length);
  const row = w * 4;
  for (let y = 0; y < h; y++) flipped.set(pixels.subarray(y * row, y * row + row), (h - 1 - y) * row);
  const t = new THREE.DataTexture(flipped, w, h, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

type Cardboard = { color: THREE.Texture | null; normal: THREE.Texture | null; edge: THREE.Texture | null };
let cardboard: Promise<Cardboard> | null = null;

/**
 * The baked cardboard maps (from scripts/blender/cardboard.py), decoded and tiling. Decoded once
 * and shared: every look's scene reads the same three textures.
 */
export function loadCardboard() {
  cardboard ??= decodeCardboard();
  return cardboard;
}

async function decodeCardboard(): Promise<Cardboard> {
  const load = async (asset: number) => {
    const uri = Image.resolveAssetSource(asset).uri;
    const image = Skia.Image.MakeImageFromEncoded(await Skia.Data.fromURI(uri));
    if (!image) return null;
    const w = image.width();
    const h = image.height();
    return canvasTexture(w, h, (c) => c.drawImage(image, 0, 0));
  };
  const [color, normal, edge] = await Promise.all([
    load(require('../../../assets/corner-shop/cardboard_color.jpg')),
    load(require('../../../assets/corner-shop/cardboard_normal.jpg')),
    load(require('../../../assets/corner-shop/cardboard_edge.jpg')),
  ]);
  for (const t of [color, normal, edge]) {
    if (!t) continue;
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
  }
  return { color, normal, edge };
}

const paint = (color: string, alpha = 1) => {
  const p = Skia.Paint();
  p.setAntiAlias(true);
  p.setColor(Skia.Color(color));
  p.setAlphaf(alpha);
  return p;
};

/** Ink on card: a little patchy, the way flexo print takes on corrugated board */
function inked(color: string) {
  const p = paint(color);
  p.setBlendMode(BlendMode.Multiply);
  return p;
}

function text(
  c: SkCanvas,
  value: string,
  x: number,
  y: number,
  w: number,
  size: number,
  color: string,
  typeface: SkTypeface | null,
  options: { align?: TextAlign; spacing?: number; weight?: FontWeight } = {}
) {
  const align = options.align ?? TextAlign.Center;
  let builder;
  if (typeface) {
    const provider = Skia.TypefaceFontProvider.Make();
    provider.registerFont(typeface, 'face');
    builder = Skia.ParagraphBuilder.Make({ textAlign: align }, provider);
  } else builder = Skia.ParagraphBuilder.Make({ textAlign: align });
  const p = builder
    .pushStyle({
      fontSize: size,
      color: Skia.Color(color),
      letterSpacing: options.spacing ?? 0,
      fontStyle: { weight: options.weight ?? FontWeight.Normal },
      fontFamilies: typeface ? ['face'] : ['Helvetica Neue'],
    })
    .addText(value)
    .build();
  p.layout(w);
  p.paint(c, x, y);
  return p.getHeight();
}

/** Speckle over ink: where the print didn't quite take */
function wear(c: SkCanvas, w: number, h: number, amount = 0.16) {
  const p = Skia.Paint();
  p.setShader(Skia.Shader.MakeFractalNoise(0.6, 0.6, 3, 11, 0, 0));
  p.setBlendMode(BlendMode.Screen);
  p.setAlphaf(amount);
  c.drawRect(Skia.XYWHRect(0, 0, w, h), p);
}

/** A field of halftone dots, the riso screen, over an area */
function halftone(c: SkCanvas, x: number, y: number, w: number, h: number, color: string, step = 14, r = 3.4) {
  const p = paint(color);
  for (let j = 0; j * step < h + step; j++)
    for (let i = 0; i * step < w + step; i++) {
      const ox = j % 2 ? step / 2 : 0;
      c.drawCircle(x + i * step + ox, y + j * step, r, p);
    }
}

/**
 * Riso inks overprint: draw something twice, the second pass a few pixels off, so the colours sit
 * slightly out of register the way a stencil duplicator prints them
 */
function offRegister(draw: (dx: number, dy: number, pass: 0 | 1) => void) {
  draw(0, 0, 0);
  draw(4, -3, 1);
}

/** The sign over the shop front */
export function signTexture(f: Fonts, t: Theme) {
  const W = 1024;
  const H = 256;
  return canvasTexture(W, H, (c) => {
    c.drawRRect(Skia.RRectXY(Skia.XYWHRect(0, 0, W, H), 28, 28), paint(t.signBg));
    const frame = paint(t.signInk);
    frame.setStyle(PaintStyle.Stroke);
    frame.setStrokeWidth(6);
    c.drawRRect(Skia.RRectXY(Skia.XYWHRect(18, 18, W - 36, H - 36), 16, 16), frame);
    if (t.look === 'riso') {
      halftone(c, 30, 30, W - 60, H - 60, 'rgba(255,79,139,0.28)', 16, 3);
      offRegister((dx, dy, pass) =>
        text(c, 'CORNER SHOP', dx, 26 + dy, W, 168, pass ? '#FF4F8B' : '#FFFFFF', f.caps, { spacing: 14 })
      );
    } else if (t.look === 'paper') {
      text(c, 'Corner Shop', 0, 34, W, 140, t.signInk, f.hand);
    } else {
      text(c, 'CORNER SHOP', 0, 26, W, 168, t.signInk, f.caps, { spacing: 14 });
    }
    text(c, 'OPEN EARLY · OPEN LATE', 0, 198, W, 30, t.signInk, f.mono, { spacing: 6 });
    wear(c, W, H, t.look === 'paper' ? 0.05 : 0.16);
  });
}

/** A striped awning with a scalloped front edge (transparent between the scallops) */
export function awningTexture(t: Theme) {
  const W = 1024;
  const H = 320;
  const stripes = 10;
  const sw = W / stripes;
  const body = H - 60;
  return canvasTexture(W, H, (c) => {
    for (let i = 0; i < stripes; i++) {
      const color = i % 2 ? t.stripeB : t.stripeA;
      c.drawRect(Skia.XYWHRect(i * sw, 0, sw, body), paint(color));
      c.drawCircle(i * sw + sw / 2, body, sw / 2, paint(color));
    }
    if (t.look === 'riso') halftone(c, 0, 0, W, body, 'rgba(36,64,200,0.22)', 12, 2.6);
    // The fold where the awning bends over the scallops
    c.drawRect(Skia.XYWHRect(0, body - 4, W, 3), paint('rgba(0,0,0,0.16)'));
    wear(c, W, H, t.look === 'paper' ? 0.04 : 0.14);
  });
}

/** A poster on a side wall */
export function posterTexture(f: Fonts, t: Theme, title: string, sub: string, hue: string, price = '$2') {
  const W = 512;
  const H = 640;
  return canvasTexture(W, H, (c) => {
    c.drawRect(Skia.XYWHRect(0, 0, W, H), paint(hue));
    const ink = t.look === 'kraft' ? '#FFF4E4' : t.look === 'riso' ? '#F7F1E6' : t.ink;
    if (t.look === 'riso') halftone(c, 0, H * 0.45, W, H * 0.55, 'rgba(255,255,255,0.18)', 18, 4);
    text(c, title, 24, 40, W - 48, title.length > 7 ? 116 : 150, ink, f.caps, { spacing: 4 });
    text(c, sub, 24, H - 120, W - 48, 32, ink, f.mono, { spacing: 2 });
    // A starburst price
    const burst = Skia.PathBuilder.Make();
    const cx = W - 120;
    const cy = H - 235;
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const r = i % 2 ? 62 : 82;
      if (i === 0) burst.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      else burst.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    burst.close();
    c.drawPath(burst.detach(), paint(t.look === 'paper' ? t.accent : t.look === 'riso' ? '#FFE14D' : '#F2B705'));
    text(
      c,
      price,
      cx - 80,
      cy - 30,
      160,
      price.length > 3 ? 44 : 56,
      t.look === 'riso' ? '#2440C8' : '#2B2420',
      f.sans,
      {
        weight: FontWeight.ExtraBold,
      }
    );
    wear(c, W, H, t.look === 'paper' ? 0.04 : 0.14);
  });
}

/** The front of the counter */
export function counterTexture(f: Fonts, t: Theme) {
  const W = 768;
  const H = 320;
  return canvasTexture(W, H, (c) => {
    if (t.look === 'paper') {
      text(c, 'pay here', 0, 70, W, 120, t.ink, f.hand);
    } else if (t.look === 'riso') {
      offRegister((dx, dy, pass) =>
        text(c, 'PAY HERE', dx, 40 + dy, W, 150, pass ? '#FF4F8B' : '#2440C8', f.caps, { spacing: 10 })
      );
    } else {
      text(c, 'PAY HERE', 0, 40, W, 150, t.ink, f.caps, { spacing: 10 });
    }
    const arrow = Skia.PathBuilder.Make()
      .moveTo(W / 2 - 40, 225)
      .lineTo(W / 2 + 40, 225)
      .lineTo(W / 2, 275)
      .close()
      .detach();
    c.drawPath(arrow, inked(t.accent));
    wear(c, W, H, t.look === 'paper' ? 0.04 : 0.14);
  });
}

/** A price tag clipped to a shelf's edge */
export function tagTexture(f: Fonts, t: Theme, price: string) {
  const W = 192;
  const H = 112;
  return canvasTexture(W, H, (c) => {
    const bg = t.look === 'riso' ? '#FFE14D' : t.look === 'paper' ? '#FFFFFF' : '#FBF4E6';
    c.drawRRect(Skia.RRectXY(Skia.XYWHRect(4, 4, W - 8, H - 8), 12, 12), paint(bg));
    c.drawCircle(26, H / 2, 9, paint('rgba(0,0,0,0.18)'));
    text(c, price, 38, 18, W - 48, 64, t.look === 'riso' ? '#2440C8' : t.ink, f.hand);
  });
}

/** The register's little screen */
export function screenTexture(f: Fonts, amount: string) {
  const W = 256;
  const H = 96;
  return canvasTexture(W, H, (c) => {
    c.drawRect(Skia.XYWHRect(0, 0, W, H), paint('#0E2A1C'));
    text(c, amount, 0, 18, W - 16, 56, '#7CFFB2', f.mono, { align: TextAlign.Right });
  });
}

/**
 * The lettering on the door's glass, sign-writer style: gold leaf with a dark shade under it
 * (white chalk paint on the paper shop, yellow and pink ink on the riso one)
 */
export function glassTexture(f: Fonts, t: Theme) {
  const W = 640;
  const H = 476;
  return canvasTexture(W, H, (c) => {
    const shade = t.look === 'riso' ? '#FF4F8B' : 'rgba(20,14,10,0.75)';
    const gilt = (dx: number, dy: number, color: string) => {
      // All in the top of the glass: the hung sign has the bottom
      text(c, 'No. 7', dx, 16 + dy, W, 28, color, f.mono, { spacing: 8 });
      if (t.look === 'paper') text(c, 'Corner Shop', dx, 46 + dy, W, 96, color, f.hand);
      else text(c, 'CORNER SHOP', dx, 42 + dy, W, 116, color, f.caps, { spacing: 10 });
      const rule = paint(color);
      c.drawRect(Skia.XYWHRect(150 + dx, 168 + dy, W - 300, 3), rule);
      text(c, 'GADGETS · REPAIRS', dx, 176 + dy, W, 24, color, f.mono, { spacing: 6 });
      c.drawRect(Skia.XYWHRect(150 + dx, 212 + dy, W - 300, 3), rule);
    };
    gilt(4, 4, shade);
    gilt(0, 0, t.gilt);
    if (t.look === 'kraft') {
      // A sheen across the leaf
      const sheen = Skia.Paint();
      sheen.setShader(
        Skia.Shader.MakeLinearGradient(
          { x: 0, y: 40 },
          { x: W, y: 220 },
          [Skia.Color('rgba(255,255,255,0)'), Skia.Color('rgba(255,250,220,0.55)'), Skia.Color('rgba(255,255,255,0)')],
          [0.3, 0.5, 0.7],
          0
        )
      );
      sheen.setBlendMode(BlendMode.SrcATop);
      c.drawRect(Skia.XYWHRect(0, 0, W, H), sheen);
    }
  });
}

/** The little sign hung inside the door's glass: one side closed, the other open */
export function hangSignTexture(f: Fonts, t: Theme, open: boolean) {
  const W = 400;
  const H = 240;
  return canvasTexture(W, H, (c) => {
    const bg = t.look === 'riso' ? '#F7F1E6' : t.look === 'paper' ? '#FFFFFF' : '#FBF4E6';
    const ink = t.look === 'riso' ? '#2440C8' : t.ink;
    const hot = open ? (t.look === 'paper' ? t.accent2 : t.accent) : ink;
    c.drawRRect(Skia.RRectXY(Skia.XYWHRect(6, 6, W - 12, H - 12), 26, 26), paint(bg));
    const frame = paint(hot);
    frame.setStyle(PaintStyle.Stroke);
    frame.setStrokeWidth(6);
    c.drawRRect(Skia.RRectXY(Skia.XYWHRect(20, 20, W - 40, H - 40), 16, 16), frame);
    for (const x of [44, W - 44]) c.drawCircle(x, 40, 7, paint('rgba(0,0,0,0.35)'));
    text(c, open ? 'come in, we’re' : 'sorry, we’re', 0, 34, W, 40, ink, f.hand);
    if (t.look === 'riso')
      offRegister((dx, dy, pass) =>
        text(c, open ? 'OPEN' : 'CLOSED', dx, 84 + dy, W, 116, pass ? '#FF4F8B' : '#2440C8', f.caps, { spacing: 8 })
      );
    else text(c, open ? 'OPEN' : 'CLOSED', 0, 84, W, 116, hot, f.caps, { spacing: 8 });
  });
}

/** The doormat: coir, a border, a word */
export function matTexture(f: Fonts, t: Theme, word = 'hello') {
  const W = 640;
  const H = 384;
  return canvasTexture(W, H, (c) => {
    c.drawRRect(Skia.RRectXY(Skia.XYWHRect(0, 0, W, H), 30, 30), paint(t.mat));
    const fibre = Skia.Paint();
    fibre.setShader(Skia.Shader.MakeFractalNoise(0.9, 0.08, 3, 5, 0, 0));
    fibre.setBlendMode(BlendMode.Overlay);
    fibre.setAlphaf(0.5);
    c.drawRRect(Skia.RRectXY(Skia.XYWHRect(0, 0, W, H), 30, 30), fibre);
    const ink = t.look === 'kraft' ? '#F1E6D4' : t.look === 'riso' ? '#FF7FAD' : '#FFF8EF';
    const border = paint(ink);
    border.setStyle(PaintStyle.Stroke);
    border.setStrokeWidth(10);
    c.drawRRect(Skia.RRectXY(Skia.XYWHRect(28, 28, W - 56, H - 56), 18, 18), border);
    text(
      c,
      t.look === 'paper' ? word : word.toUpperCase(),
      0,
      t.look === 'paper' ? 92 : 66,
      W,
      t.look === 'paper' ? 170 : 230,
      ink,
      t.look === 'paper' ? f.hand : f.caps,
      {
        spacing: 16,
      }
    );
  });
}

/** The shop floor: checkerboard tiles, printed */
export function floorTexture(t: Theme) {
  const W = 1024;
  const n = 8;
  const s = W / n;
  return canvasTexture(W, W, (c) => {
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        if ((i + j) % 2) continue;
        if (t.look === 'riso') halftone(c, i * s + 6, j * s + 6, s - 18, s - 18, t.floorInk, 12, 3.6);
        else c.drawRect(Skia.XYWHRect(i * s + 2, j * s + 2, s - 4, s - 4), paint(t.floorInk));
      }
    wear(c, W, W, t.look === 'paper' ? 0.04 : 0.12);
  });
}

/** The label on the crate out front */
export function crateTexture(f: Fonts, t: Theme, title: string, sub: string) {
  const W = 512;
  const H = 208;
  return canvasTexture(W, H, (c) => {
    const ink = t.look === 'riso' ? '#2440C8' : t.look === 'paper' ? t.accent : t.accent;
    c.drawRRect(
      Skia.RRectXY(Skia.XYWHRect(8, 8, W - 16, H - 16), 14, 14),
      paint(t.look === 'kraft' ? '#F1E6D4' : '#FFFFFF')
    );
    text(c, title, 0, 18, W, 110, ink, f.caps, { spacing: 10 });
    text(c, sub, 0, 136, W, 32, t.ink, f.hand);
  });
}

/** A neon "OPEN" sign: the glass tube letters, drawn white (tinted and lit in the shader) */
export function neonTexture(f: Fonts) {
  const W = 512;
  const H = 200;
  return canvasTexture(W, H, (c) => {
    text(c, 'OPEN', 0, 10, W, 160, '#FFFFFF', f.sans, { weight: FontWeight.ExtraBold, spacing: 10 });
  });
}

/** The shop cat as a printed cut-out standee: sitting, tail round its feet, eyes shut */
export function catTexture(t: Theme) {
  const W = 512;
  const H = 512;
  return canvasTexture(W, H, (c) => {
    const fur = t.look === 'riso' ? '#FF4F8B' : t.look === 'paper' ? '#F2A65A' : '#E0893A';
    const dark = t.look === 'riso' ? '#2440C8' : '#3A2414';
    const body = paint(fur);
    // Body, a pear; head; ears; the tail curled round the front
    c.drawOval(Skia.XYWHRect(126, 210, 260, 280), body);
    c.drawCircle(256, 170, 110, body);
    const ear = (x: number, dir: number) =>
      Skia.PathBuilder.Make()
        .moveTo(x, 110)
        .lineTo(x + dir * 30, 30)
        .lineTo(x + dir * 90, 92)
        .close()
        .detach();
    c.drawPath(ear(166, 1), body);
    c.drawPath(ear(346, -1), body);
    const tail = paint(fur);
    tail.setStyle(PaintStyle.Stroke);
    tail.setStrokeWidth(38);
    tail.setStrokeCap(StrokeCap.Round);
    c.drawPath(Skia.PathBuilder.Make().moveTo(370, 440).quadTo(470, 380, 430, 300).detach(), tail);
    // Stripes, closed eyes, nose, cheeks
    const ink = paint(dark);
    ink.setStyle(PaintStyle.Stroke);
    ink.setStrokeWidth(10);
    ink.setStrokeCap(StrokeCap.Round);
    for (const [x, y] of [
      [220, 300],
      [256, 290],
      [292, 300],
    ])
      c.drawLine(x, y, x, y + 46, ink);
    c.drawPath(Skia.PathBuilder.Make().moveTo(196, 172).quadTo(214, 188, 232, 172).detach(), ink);
    c.drawPath(Skia.PathBuilder.Make().moveTo(280, 172).quadTo(298, 188, 316, 172).detach(), ink);
    c.drawCircle(256, 204, 9, paint(dark));
    c.drawCircle(196, 210, 16, paint('rgba(255,120,120,0.45)'));
    c.drawCircle(316, 210, 16, paint('rgba(255,120,120,0.45)'));
    if (t.look === 'riso') halftone(c, 120, 220, 280, 260, 'rgba(36,64,200,0.25)', 14, 3);
  });
}

/** Floorboards at home: long planks, staggered joints, a grain */
export function planksTexture(t: Theme) {
  const W = 1024;
  const rows = 8;
  const h = W / rows;
  return canvasTexture(W, W, (c) => {
    c.drawRect(Skia.XYWHRect(0, 0, W, W), paint(t.home.floor));
    const grain = Skia.Paint();
    grain.setShader(Skia.Shader.MakeFractalNoise(0.004, 0.09, 3, 9, 0, 0));
    grain.setBlendMode(BlendMode.Multiply);
    grain.setAlphaf(0.28);
    c.drawRect(Skia.XYWHRect(0, 0, W, W), grain);
    const line = paint(t.home.planks);
    for (let j = 0; j < rows; j++) {
      c.drawRect(Skia.XYWHRect(0, j * h, W, 3), line);
      const off = ((j * 397) % 5) * 120;
      for (let x = off; x < W; x += 620) c.drawRect(Skia.XYWHRect(x, j * h, 3, h), line);
    }
  });
}

/** What's out of the window at home: night with a moon, or a clear day */
export function skyTexture(t: Theme) {
  const W = 512;
  const H = 640;
  return canvasTexture(W, H, (c) => {
    const day = t.look === 'paper';
    const sky = Skia.Paint();
    sky.setShader(
      Skia.Shader.MakeLinearGradient(
        { x: 0, y: 0 },
        { x: 0, y: H },
        day ? [Skia.Color('#8FC3EA'), Skia.Color('#E7F1F6')] : [Skia.Color('#0E1640'), Skia.Color('#3A3A78')],
        null,
        0
      )
    );
    c.drawRect(Skia.XYWHRect(0, 0, W, H), sky);
    if (day) {
      const cloud = paint('rgba(255,255,255,0.9)');
      for (const [x, y, r] of [
        [140, 200, 46],
        [190, 186, 60],
        [250, 204, 40],
        [380, 360, 34],
        [420, 350, 46],
      ])
        c.drawCircle(x, y, r, cloud);
    } else {
      c.drawCircle(360, 150, 46, paint('#FFF3C9'));
      c.drawCircle(382, 136, 44, paint('#0E1640'));
      let seed = 3;
      for (let i = 0; i < 40; i++) {
        seed = (seed * 9301 + 49297) % 233280;
        c.drawCircle(seed % W, (seed >> 3) % (H * 0.7), 1.6 + (i % 3), paint('rgba(255,255,255,0.8)'));
      }
    }
    // Rooftops across the bottom
    const roofs = paint(day ? '#B9CBB7' : '#151A3A');
    c.drawRect(Skia.XYWHRect(0, H - 120, 160, 120), roofs);
    c.drawRect(Skia.XYWHRect(150, H - 190, 120, 190), roofs);
    c.drawRect(Skia.XYWHRect(260, H - 90, 260, 90), roofs);
    if (!day)
      for (const [x, y] of [
        [180, H - 160],
        [220, H - 160],
        [180, H - 110],
        [300, H - 60],
      ])
        c.drawRect(Skia.XYWHRect(x, y, 18, 22), paint('#FFD27A'));
  });
}

/** The brass number plate on the door at home */
export function plateTexture(f: Fonts, t: Theme, label: string) {
  const W = 320;
  const H = 200;
  return canvasTexture(W, H, (c) => {
    c.drawRRect(Skia.RRectXY(Skia.XYWHRect(6, 6, W - 12, H - 12), 22, 22), paint('#D2A24C'));
    c.drawRRect(Skia.RRectXY(Skia.XYWHRect(18, 18, W - 36, H - 36), 14, 14), paint('#E2B862'));
    text(c, label, 0, 26, W, 140, '#3A2A12', f.caps, { spacing: 10 });
  });
}

/** The paper carrier bag: the shop's name on it, a fold at the top */
export function bagTexture(f: Fonts, t: Theme) {
  const W = 384;
  const H = 448;
  return canvasTexture(W, H, (c) => {
    c.drawRect(
      Skia.XYWHRect(0, 0, W, H),
      paint(t.look === 'kraft' ? '#C9955E' : t.look === 'riso' ? '#F7F1E6' : '#FFFFFF')
    );
    c.drawRect(Skia.XYWHRect(0, 0, W, 40), paint('rgba(0,0,0,0.08)'));
    const ink = t.look === 'riso' ? '#FF4F8B' : t.look === 'paper' ? t.accent2 : '#2B2420';
    c.drawCircle(W / 2, 190, 92, paint(ink));
    text(c, 'No.7', 0, 150, W, 64, t.look === 'kraft' ? '#C9955E' : '#FFFFFF', f.caps, { spacing: 4 });
    text(c, 'CORNER SHOP', 0, 310, W, 54, ink, f.caps, { spacing: 8 });
    text(c, 'gadgets · repairs', 0, 372, W, 26, ink, f.hand);
    wear(c, W, H, t.look === 'paper' ? 0.04 : 0.12);
  });
}
