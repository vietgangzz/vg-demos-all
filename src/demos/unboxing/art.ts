import {
  FontWeight,
  PaintStyle,
  Skia,
  StrokeCap,
  TextAlign,
  TileMode,
  BlendMode,
  type SkCanvas,
  type SkImage,
} from 'react-native-skia';
import * as THREE from 'three/webgpu';

/**
 * Everything printed in the unboxing, drawn once with Skia and handed to three.js as textures: the
 * shipping label, the carrier's print on the side of the box, the printed packing tape, the
 * FRAGILE sticker, and the thank-you seal on the tissue paper.
 */

const SANS = 'Helvetica Neue';
const MONO = 'Menlo';

/** A Skia image's pixels into a texture, its rows turned to run bottom-up the way GL wants them */
export function toTexture(image: SkImage | null, w: number, h: number, mip = true) {
  const pixels = new Uint8Array(w * h * 4);
  const read = image?.readPixels();
  if (read instanceof Uint8Array && read.length === pixels.length) pixels.set(read);
  const flipped = new Uint8Array(pixels.length);
  const row = w * 4;
  for (let y = 0; y < h; y++) flipped.set(pixels.subarray(y * row, y * row + row), (h - 1 - y) * row);
  const texture = new THREE.DataTexture(flipped, w, h, THREE.RGBAFormat);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = mip ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  texture.generateMipmaps = mip;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

function draw(w: number, h: number, paint: (canvas: SkCanvas) => void, mip = true) {
  const surface = Skia.Surface.Make(w, h);
  if (!surface) return toTexture(null, w, h, mip);
  const canvas = surface.getCanvas();
  canvas.clear(Skia.Color('transparent'));
  paint(canvas);
  surface.flush();
  return toTexture(surface.makeImageSnapshot(), w, h, mip);
}

type Words = {
  size: number;
  color: string;
  weight?: FontWeight;
  family?: string;
  align?: TextAlign;
  width?: number;
  spacing?: number;
};

/** Text, laid out by Skia's paragraph engine so Vietnamese marks sit where they should */
function words(canvas: SkCanvas, text: string, x: number, y: number, o: Words) {
  const p = Skia.ParagraphBuilder.Make({ textAlign: o.align ?? TextAlign.Left })
    .pushStyle({
      fontSize: o.size,
      fontFamilies: [o.family ?? SANS],
      color: Skia.Color(o.color),
      fontStyle: { weight: o.weight ?? FontWeight.Normal },
      letterSpacing: o.spacing ?? 0,
    })
    .addText(text)
    .build();
  p.layout(o.width ?? 4000);
  p.paint(canvas, x, y);
  return p;
}

const fill = (color: string) => {
  const p = Skia.Paint();
  p.setColor(Skia.Color(color));
  p.setAntiAlias(true);
  return p;
};
const stroke = (color: string, width: number) => {
  const p = fill(color);
  p.setStyle(PaintStyle.Stroke);
  p.setStrokeWidth(width);
  p.setStrokeCap(StrokeCap.Round);
  return p;
};

/** A little seeded randomness, so the barcode and the QR code come out the same every time */
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ---- The shipping label ----

export const LABEL_W = 640;
export const LABEL_H = 420;

export function labelTexture(orderId: string, items: number) {
  return draw(LABEL_W, LABEL_H, (c) => {
    // Thermal paper: not quite white, a faint grain
    c.drawRect(Skia.XYWHRect(0, 0, LABEL_W, LABEL_H), fill('#FAF8F2'));
    const grain = Skia.Paint();
    grain.setShader(Skia.Shader.MakeFractalNoise(0.8, 0.8, 2, 3, 0, 0));
    grain.setBlendMode(BlendMode.Multiply);
    grain.setAlphaf(0.05);
    c.drawRect(Skia.XYWHRect(0, 0, LABEL_W, LABEL_H), grain);
    // The carrier's band across the top
    c.drawRect(Skia.XYWHRect(0, 0, LABEL_W, 70), fill('#141414'));
    words(c, 'VG EXPRESS', 24, 14, { size: 34, color: '#FFFFFF', weight: FontWeight.Black, spacing: 2 });
    words(c, 'GIAO NHANH', LABEL_W - 224, 24, {
      size: 20,
      color: '#F4C430',
      weight: FontWeight.Bold,
      width: 200,
      align: TextAlign.Right,
      spacing: 1.5,
    });
    // The route code, big, for the sorting belt
    c.drawRect(Skia.XYWHRect(24, 88, 170, 92), stroke('#141414', 4));
    words(c, 'SGN', 24, 92, {
      size: 48,
      color: '#141414',
      weight: FontWeight.Black,
      width: 170,
      align: TextAlign.Center,
    });
    words(c, 'Q1-07', 24, 142, {
      size: 24,
      color: '#141414',
      weight: FontWeight.Bold,
      width: 170,
      align: TextAlign.Center,
    });
    // Who it's from, who it's for
    words(c, 'Từ: VG Market · Kho Thủ Đức', 214, 90, { size: 19, color: '#444' });
    words(c, 'Giao đến: Bạn', 214, 116, { size: 26, color: '#141414', weight: FontWeight.Bold });
    words(c, 'Quận 1, TP. Hồ Chí Minh', 214, 150, { size: 21, color: '#222' });
    // The barcode, and its number under it
    const rand = seeded(orderId.split('').reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7));
    let x = 28;
    while (x < 420) {
      const w = 2 + Math.floor(rand() * 4) * 2;
      c.drawRect(Skia.XYWHRect(x, 204, w, 112), fill('#141414'));
      x += w + 2 + Math.floor(rand() * 3) * 2;
    }
    words(c, `${orderId} 8 936 0${items} 2817 4`, 28, 322, { size: 18, color: '#141414', family: MONO, spacing: 3 });
    // A QR code, near enough
    const q = 132;
    const qx = LABEL_W - q - 28;
    const qy = 196;
    const cell = q / 21;
    for (let i = 0; i < 21; i++)
      for (let j = 0; j < 21; j++) {
        const finder = (i < 7 && j < 7) || (i > 13 && j < 7) || (i < 7 && j > 13);
        if (finder || rand() < 0.48) {
          if (!finder) c.drawRect(Skia.XYWHRect(qx + i * cell, qy + j * cell, cell + 0.4, cell + 0.4), fill('#141414'));
        }
      }
    for (const [fi, fj] of [
      [0, 0],
      [14, 0],
      [0, 14],
    ]) {
      c.drawRect(Skia.XYWHRect(qx + fi * cell, qy + fj * cell, cell * 7, cell * 7), fill('#141414'));
      c.drawRect(Skia.XYWHRect(qx + (fi + 1) * cell, qy + (fj + 1) * cell, cell * 5, cell * 5), fill('#FAF8F2'));
      c.drawRect(Skia.XYWHRect(qx + (fi + 2) * cell, qy + (fj + 2) * cell, cell * 3, cell * 3), fill('#141414'));
    }
    // Weight and count along the bottom
    c.drawLine(24, 360, LABEL_W - 24, 360, stroke('#141414', 2));
    words(c, `ĐƠN ${orderId}`, 24, 372, { size: 24, color: '#141414', weight: FontWeight.Black, family: MONO });
    words(c, `${items} món · 1,2 kg`, LABEL_W - 260, 376, {
      size: 21,
      color: '#141414',
      weight: FontWeight.Bold,
      width: 236,
      align: TextAlign.Right,
    });
  });
}

// ---- The carrier's print on the front of the box ----

export const SIDE_W = 1024;
export const SIDE_H = 576;

/** Ink only, on transparent: the box's own kraft shows through everywhere else */
export function sideTexture() {
  const ink = 'rgba(38,26,16,0.92)';
  return draw(SIDE_W, SIDE_H, (c) => {
    // The roundel
    c.drawCircle(150, 260, 104, stroke(ink, 10));
    words(c, 'VG', 46, 196, { size: 112, color: ink, weight: FontWeight.Black, width: 208, align: TextAlign.Center });
    words(c, 'VG EXPRESS', 290, 176, { size: 92, color: ink, weight: FontWeight.Black, spacing: 2 });
    words(c, 'Giao tận tay · Delivered with care', 296, 286, { size: 38, color: ink, weight: FontWeight.Medium });
    // Handling marks, as boxes have them: this way up, keep dry, fragile
    const marks = stroke(ink, 9);
    const mx = 610;
    const my = 410;
    for (const dx of [0, 46]) {
      c.drawLine(mx + dx, my + 96, mx + dx, my + 14, marks);
      c.drawLine(mx + dx - 20, my + 34, mx + dx, my + 12, marks);
      c.drawLine(mx + dx + 20, my + 34, mx + dx, my + 12, marks);
    }
    c.drawLine(mx - 30, my + 108, mx + 76, my + 108, marks);
    // An umbrella
    const ux = 790;
    const umbrella = Skia.PathBuilder.Make()
      .moveTo(ux - 50, my + 50)
      .quadTo(ux, my - 8, ux + 50, my + 50)
      .close()
      .detach();
    c.drawPath(umbrella, fill(ink));
    c.drawLine(ux, my + 50, ux, my + 100, marks);
    c.drawLine(ux, my + 100, ux - 14, my + 100, marks);
    // A wine glass
    const gx = 920;
    const glass = Skia.PathBuilder.Make()
      .moveTo(gx - 32, my + 10)
      .lineTo(gx + 32, my + 10)
      .quadTo(gx + 30, my + 62, gx, my + 66)
      .quadTo(gx - 30, my + 62, gx - 32, my + 10)
      .close()
      .detach();
    c.drawPath(glass, fill(ink));
    c.drawLine(gx, my + 66, gx, my + 104, marks);
    c.drawLine(gx - 22, my + 106, gx + 22, my + 106, marks);
    words(c, '♻ 100% giấy tái chế', 60, 470, { size: 34, color: ink, weight: FontWeight.Medium });
  });
}

// ---- Printed packing tape ----

export const TAPE_W = 1024;
export const TAPE_H = 64;

/** The print on the tape, on transparent: the tape itself is drawn as tinted, glossy film */
export function tapeTexture() {
  return draw(TAPE_W, TAPE_H, (c) => {
    for (let x = 0; x < TAPE_W; x += 256) {
      words(c, 'VG EXPRESS', x + 18, 14, { size: 30, color: '#D62828', weight: FontWeight.Black, spacing: 1.5 });
      c.drawCircle(x + 226, 32, 5, fill('#D62828'));
    }
  });
}

// ---- The FRAGILE sticker ----

export const FRAGILE_W = 384;
export const FRAGILE_H = 192;

export function fragileTexture() {
  return draw(FRAGILE_W, FRAGILE_H, (c) => {
    const card = Skia.RRectXY(Skia.XYWHRect(4, 4, FRAGILE_W - 8, FRAGILE_H - 8), 16, 16);
    c.drawRRect(card, fill('#D93A2B'));
    c.drawRRect(Skia.RRectXY(Skia.XYWHRect(16, 16, FRAGILE_W - 32, FRAGILE_H - 32), 10, 10), stroke('#FFF3E6', 5));
    // A broken glass
    const g = Skia.PathBuilder.Make()
      .moveTo(44, 46)
      .lineTo(104, 46)
      .quadTo(102, 110, 74, 116)
      .quadTo(46, 110, 44, 46)
      .close()
      .detach();
    c.drawPath(g, fill('#FFF3E6'));
    c.drawLine(64, 52, 80, 76, stroke('#D93A2B', 5));
    c.drawLine(80, 76, 70, 96, stroke('#D93A2B', 5));
    c.drawLine(74, 116, 74, 146, stroke('#FFF3E6', 7));
    c.drawLine(56, 148, 92, 148, stroke('#FFF3E6', 7));
    words(c, 'HÀNG DỄ VỠ', 120, 50, { size: 42, color: '#FFF3E6', weight: FontWeight.Black });
    words(c, 'FRAGILE · Nhẹ tay nhé', 122, 104, { size: 26, color: '#FFF3E6', weight: FontWeight.Medium });
  });
}

// ---- The thank-you seal on the tissue ----

export const SEAL = 256;

export function sealTexture() {
  return draw(SEAL, SEAL, (c) => {
    const r = SEAL / 2;
    c.drawCircle(r, r, r - 2, fill('#FFFFFF'));
    const disc = Skia.Paint();
    disc.setShader(
      Skia.Shader.MakeRadialGradient(
        { x: r * 0.8, y: r * 0.7 },
        r,
        [Skia.Color('#FFD9E2'), Skia.Color('#F3A6B9')],
        null,
        TileMode.Clamp
      )
    );
    c.drawCircle(r, r, r - 14, disc);
    c.drawCircle(r, r, r - 24, stroke('rgba(255,255,255,0.85)', 2));
    words(c, 'cảm ơn', 0, 62, {
      size: 54,
      color: '#7A1F3D',
      family: 'Snell Roundhand',
      weight: FontWeight.Bold,
      width: SEAL,
      align: TextAlign.Center,
    });
    words(c, 'bạn ♡', 0, 120, {
      size: 54,
      color: '#7A1F3D',
      family: 'Snell Roundhand',
      weight: FontWeight.Bold,
      width: SEAL,
      align: TextAlign.Center,
    });
    words(c, 'VG MARKET', 0, 194, {
      size: 16,
      color: '#7A1F3D',
      weight: FontWeight.Bold,
      width: SEAL,
      align: TextAlign.Center,
      spacing: 3,
    });
  });
}
