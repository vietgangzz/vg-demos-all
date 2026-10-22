import { Image } from 'react-native';
import { BlendMode, Skia, TileMode, type SkCanvas, type SkTypeface } from 'react-native-skia';
import * as THREE from 'three/webgpu';

/**
 * The page: a sheet torn from a Vietnamese school notebook, vở ô li, the squared paper every kid
 * learned to write on. Pale violet rules, four fine lines to each square, a red margin, the date
 * written at the top the way the teacher wanted it, and the note in handwriting, in mực tím.
 */

const PX_W = 720;
const PX_H = Math.round(PX_W * Math.SQRT2);
/** A big square is 8 mm on a 210 mm page */
const SQUARE = PX_W / 26.25;
const MARGIN = SQUARE * 3;

export type Ink = 'violet' | 'blue';

/** What's on the page: your note, and under it your friend's answer as far as it's written */
export type Page = { text: string; reply?: string; shown?: number; sign?: string };
const INKS: Record<Ink, string> = { violet: '#43309E', blue: '#1F3F8F' };

let hand: Promise<SkTypeface | null> | null = null;

/** Patrick Hand: a schoolkid's print, with every Vietnamese mark */
export function handTypeface() {
  hand ??= (async () => {
    try {
      const asset = require('@expo-google-fonts/patrick-hand/400Regular/PatrickHand_400Regular.ttf');
      const uri = Image.resolveAssetSource(asset)!.uri;
      return Skia.Typeface.MakeFreeTypeFaceFromData(await Skia.Data.fromURI(uri));
    } catch {
      return null;
    }
  })();
  return hand;
}

function paper(canvas: SkCanvas) {
  const base = Skia.Paint();
  base.setColor(Skia.Color('#F6EDD8'));
  canvas.drawRect(Skia.XYWHRect(0, 0, PX_W, PX_H), base);
  // Fibres
  const grain = Skia.Paint();
  grain.setShader(Skia.Shader.MakeFractalNoise(0.9, 0.9, 3, 7, 0, 0));
  grain.setBlendMode(BlendMode.Multiply);
  grain.setAlphaf(0.07);
  canvas.drawRect(Skia.XYWHRect(0, 0, PX_W, PX_H), grain);
  // Years in a drawer: yellowed toward the edges
  const age = Skia.Paint();
  age.setShader(
    Skia.Shader.MakeRadialGradient(
      { x: PX_W * 0.48, y: PX_H * 0.45 },
      PX_H * 0.75,
      [Skia.Color('rgba(214,170,96,0)'), Skia.Color('rgba(196,148,80,0.28)')],
      [0.55, 1],
      TileMode.Clamp
    )
  );
  canvas.drawRect(Skia.XYWHRect(0, 0, PX_W, PX_H), age);
}

function rules(canvas: SkCanvas) {
  const fine = Skia.Paint();
  fine.setColor(Skia.Color('rgba(132,112,196,0.32)'));
  fine.setStrokeWidth(1.1);
  const bold = Skia.Paint();
  bold.setColor(Skia.Color('rgba(118,96,190,0.55)'));
  bold.setStrokeWidth(1.6);
  const top = SQUARE * 1.5;
  for (let r = 0; top + (r * SQUARE) / 4 < PX_H; r++) {
    const y = top + (r * SQUARE) / 4;
    canvas.drawLine(0, y, PX_W, y, r % 4 === 0 ? bold : fine);
  }
  for (let x = MARGIN; x < PX_W; x += SQUARE) canvas.drawLine(x, top, x, PX_H, bold);
  const margin = Skia.Paint();
  margin.setColor(Skia.Color('rgba(214,74,84,0.7)'));
  margin.setStrokeWidth(2.2);
  canvas.drawLine(MARGIN - SQUARE * 0.5, 0, MARGIN - SQUARE * 0.5, PX_H, margin);
}

/** Words into lines that fit `width` */
function wrap(text: string, font: ReturnType<typeof Skia.Font>, width: number) {
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      if (!word) continue;
      const next = line ? `${line} ${word}` : word;
      if (line && font.measureText(next).width > width) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    lines.push(line);
  }
  return lines;
}

const DAYS = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];

/** Draw the page and return it as a texture (reusing `into` when given) */
export function noteTexture(typeface: SkTypeface | null, page: Page, into?: THREE.DataTexture) {
  const surface = Skia.Surface.Make(PX_W, PX_H);
  const pixels = new Uint8Array(PX_W * PX_H * 4);
  if (surface) {
    const canvas = surface.getCanvas();
    paper(canvas);
    rules(canvas);
    if (typeface) write(canvas, typeface, page);
    surface.flush();
    const read = surface.makeImageSnapshot().readPixels();
    if (read instanceof Uint8Array && read.length === pixels.length) pixels.set(read);
  }
  // Skia rows run top-down, texture rows bottom-up
  const flipped = new Uint8Array(pixels.length);
  const row = PX_W * 4;
  for (let y = 0; y < PX_H; y++) flipped.set(pixels.subarray(y * row, y * row + row), (PX_H - 1 - y) * row);
  if (into) {
    (into.image.data as Uint8Array).set(flipped);
    into.needsUpdate = true;
    return into;
  }
  const texture = new THREE.DataTexture(flipped, PX_W, PX_H, THREE.RGBAFormat);
  texture.magFilter = THREE.LinearFilter;
  // Mipmapped, so the writing stays calm as the plane flies off small
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

function write(canvas: SkCanvas, typeface: SkTypeface, page: Page) {
  const font = Skia.Font(typeface, SQUARE * 1.32);
  const small = Skia.Font(typeface, SQUARE * 1.05);
  const pen = (ink: Ink) => {
    const paint = Skia.Paint();
    paint.setColor(Skia.Color(INKS[ink]));
    return paint;
  };
  // The date, top right, as every page starts
  const now = new Date();
  const date = `${DAYS[now.getDay()]}, ngày ${now.getDate()} tháng ${now.getMonth() + 1}`;
  const dw = small.measureText(date).width;
  canvas.save();
  canvas.rotate(-0.6, PX_W - SQUARE - dw / 2, SQUARE * 3);
  canvas.drawText(date, PX_W - SQUARE * 1.2 - dw, SQUARE * 3.15, pen('violet'), small);
  canvas.restore();
  // Lines on every other square, a little uneven like a kid's hand
  const width = PX_W - MARGIN - SQUARE * 1.5;
  let row = 0;
  const lines = (text: string, ink: Ink) => {
    const paint = pen(ink);
    for (const line of wrap(text, font, width)) {
      if (row >= 13) return;
      const y = SQUARE * (5.4 + row * 2);
      canvas.save();
      canvas.rotate(((row * 37) % 7) * 0.12 - 0.36, MARGIN, y);
      canvas.drawText(line, MARGIN + SQUARE * 0.3 + ((row * 13) % 5) * 1.2, y, paint, font);
      canvas.restore();
      row++;
    }
  };
  lines(page.text, 'violet');
  if (page.reply) {
    // The answer, in a different pen, under yours
    row += 1;
    const shown = page.shown ?? page.reply.length;
    lines(page.reply.slice(0, shown), 'blue');
    if (page.sign && shown >= page.reply.length) {
      const sw = font.measureText(page.sign).width;
      canvas.drawText(page.sign, PX_W - SQUARE * 2 - sw, SQUARE * (5.4 + row * 2), pen('blue'), font);
    }
  }
}
