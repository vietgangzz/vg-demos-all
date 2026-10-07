import { BlendMode, Skia, TextAlign, type SkImage } from 'react-native-skia';

/**
 * Every product as a die-cut sticker: the product art with a thick white border following its
 * outline, the way a sticker sheet is cut, and a hairline of grey round that so it reads on white.
 * They're drawn once into one atlas, so the whole shop's worth of stickers flying about is a
 * single draw call; the cards draw each sticker from its two layers (the cut border, the art) so
 * the border can catch the light like holographic foil.
 */

export type Category = 'Gear' | 'Style' | 'Home' | 'Food';
export const CATEGORIES: ('All' | Category)[] = ['All', 'Gear', 'Style', 'Home', 'Food'];

export type Product = {
  id: number;
  name: string;
  /** A few words under the name */
  note: string;
  category: Category;
  /** Price in đồng */
  price: number;
  art: string;
  /** The card's colour */
  tint: string;
};

export const PRODUCTS: Product[] = [
  {
    id: 0,
    name: 'Studio Headphones',
    note: 'Wireless · ANC',
    category: 'Gear',
    price: 2490000,
    art: '🎧',
    tint: '#E9E4FF',
  },
  {
    id: 1,
    name: 'Court Sneakers',
    note: 'Suede · EU 42',
    category: 'Style',
    price: 1850000,
    art: '👟',
    tint: '#FFE7DA',
  },
  { id: 2, name: 'Film Camera', note: '35mm · 1978', category: 'Gear', price: 3200000, art: '📷', tint: '#E3F1FF' },
  { id: 3, name: 'Robusta Beans', note: 'Đắk Lắk · 500g', category: 'Food', price: 185000, art: '☕️', tint: '#F3E8DC' },
  { id: 4, name: 'Monstera', note: 'Ø 18 cm pot', category: 'Home', price: 320000, art: '🪴', tint: '#E2F5E5' },
  { id: 5, name: 'Sunglasses', note: 'Polarised', category: 'Style', price: 690000, art: '🕶️', tint: '#FFF3C9' },
  { id: 6, name: 'Teddy', note: 'Handmade', category: 'Home', price: 280000, art: '🧸', tint: '#FCE6EE' },
  { id: 7, name: 'Skateboard', note: 'Maple deck', category: 'Gear', price: 1250000, art: '🛹', tint: '#E6F7F4' },
  { id: 8, name: 'Desk Lamp', note: 'Brass · warm', category: 'Home', price: 540000, art: '💡', tint: '#FFF6DE' },
  { id: 9, name: 'Guitar', note: 'Acoustic', category: 'Gear', price: 2790000, art: '🎸', tint: '#FFE9E2' },
  { id: 10, name: 'Backpack', note: 'Waxed canvas', category: 'Style', price: 890000, art: '🎒', tint: '#E6EEFF' },
  { id: 11, name: 'Watermelon', note: 'Long An · 3 kg', category: 'Food', price: 45000, art: '🍉', tint: '#E8F7E0' },
];

/** Pixels per sticker cell in the atlas */
export const CELL = 300;
export const COLS = 4;

export const spriteOf = (index: number) => {
  'worklet';
  return { x: (index % COLS) * CELL, y: Math.floor(index / COLS) * CELL };
};

export const formatVnd = (n: number) => `${Math.round(n).toLocaleString('vi-VN').replace(/,/g, '.')} ₫`;

/** A sticker's two layers: the cut border alone, and the art that sits on it */
export type StickerParts = { border: SkImage; art: SkImage };

/** One sticker, alone in a cell-sized image: the art, centred, with its cut border */
function drawSticker(art: string): (StickerParts & { full: SkImage }) | null {
  const para = Skia.ParagraphBuilder.Make({ textAlign: TextAlign.Center })
    .pushStyle({ fontSize: 172, fontFamilies: ['Apple Color Emoji'], color: Skia.Color('black') })
    .addText(art)
    .build();
  para.layout(CELL);
  const surface = () => {
    const s = Skia.Surface.Make(CELL, CELL);
    s?.getCanvas().clear(Skia.Color('transparent'));
    return s;
  };
  // The art alone first, so it can be dilated into its own outline
  const layer = surface();
  const rim = surface();
  const out = surface();
  if (!layer || !rim || !out) return null;
  para.paint(layer.getCanvas(), 0, (CELL - para.getHeight()) / 2);
  layer.flush();
  const artImage = layer.makeImageSnapshot();
  const outline = (radius: number, color: string) => {
    const paint = Skia.Paint();
    paint.setImageFilter(
      Skia.ImageFilter.MakeColorFilter(
        Skia.ColorFilter.MakeBlend(Skia.Color(color), BlendMode.SrcIn),
        Skia.ImageFilter.MakeDilate(radius, radius, null)
      )
    );
    rim.getCanvas().drawImage(artImage, 0, 0, paint);
  };
  outline(17, 'rgba(30,30,40,0.10)');
  outline(15, '#FFFFFF');
  rim.flush();
  const border = rim.makeImageSnapshot();
  const canvas = out.getCanvas();
  canvas.drawImage(border, 0, 0);
  canvas.drawImage(artImage, 0, 0);
  out.flush();
  return { border, art: artImage, full: out.makeImageSnapshot() };
}

/** All the stickers in one image for the flying ones, and each one's layers for the cards */
export function buildStickers(): { atlas: SkImage | null; parts: (StickerParts | null)[] } {
  const rows = Math.ceil(PRODUCTS.length / COLS);
  const surface = Skia.Surface.Make(COLS * CELL, rows * CELL);
  if (!surface) return { atlas: null, parts: [] };
  const canvas = surface.getCanvas();
  canvas.clear(Skia.Color('transparent'));
  const parts = PRODUCTS.map((p, i) => {
    const one = drawSticker(p.art);
    if (!one) return null;
    const { x, y } = spriteOf(i);
    canvas.drawImage(one.full, x, y);
    return { border: one.border, art: one.art };
  });
  surface.flush();
  return { atlas: surface.makeImageSnapshot(), parts };
}
