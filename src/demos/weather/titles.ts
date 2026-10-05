import { Image, PixelRatio } from 'react-native';
import { Skia, type SkTypeface, type SkTypefaceFontProvider } from 'react-native-skia';
import * as THREE from 'three/webgpu';

/**
 * Page titles drawn into textures with Skia in Unbounded Black, so they can stand on the ring
 * with their pages: they swing in and out with the object, and the pages behind the ring show
 * their titles from the back, mirrored and hazy, as in the original.
 */

const SCALE = Math.min(3, Math.max(2, PixelRatio.get()));
const SIZE = 36;
const FAMILY = 'Unbounded';

let face: Promise<SkTypeface | null> | null = null;
let provider: Promise<SkTypefaceFontProvider | null> | null = null;

/** Unbounded Black, loaded once from the bundled font file */
export function displayTypeface() {
  face ??= (async () => {
    try {
      const uri = Image.resolveAssetSource(require('@expo-google-fonts/unbounded/900Black/Unbounded_900Black.ttf')).uri;
      return Skia.Typeface.MakeFreeTypeFaceFromData(await Skia.Data.fromURI(uri));
    } catch {
      return null;
    }
  })();
  return face;
}

function fontProvider() {
  provider ??= displayTypeface().then((typeface) => {
    if (!typeface) return null;
    const p = Skia.TypefaceFontProvider.Make();
    p.registerFont(typeface, FAMILY);
    return p;
  });
  return provider;
}

export type TitleTexture = { texture: THREE.DataTexture; width: number; height: number };

/** White title text on transparent, `width` × `height` in points (tint it with the material) */
export async function titleTexture(text: string): Promise<TitleTexture | null> {
  const fonts = await fontProvider();
  const builder = fonts ? Skia.ParagraphBuilder.Make({}, fonts) : Skia.ParagraphBuilder.Make();
  const paragraph = builder
    .pushStyle({
      color: Skia.Color('#FFFFFF'),
      fontSize: SIZE * SCALE,
      fontFamilies: fonts ? [FAMILY] : undefined,
      fontStyle: { weight: 900 },
      letterSpacing: -1.5 * SCALE,
    })
    .addText(text || ' ')
    .build();
  paragraph.layout(4000);
  const px = Math.max(2, Math.ceil(paragraph.getLongestLine() + 8 * SCALE));
  const py = Math.max(2, Math.ceil(paragraph.getHeight() + 4 * SCALE));
  const surface = Skia.Surface.Make(px, py);
  if (!surface) return null;
  const canvas = surface.getCanvas();
  canvas.clear(Skia.Color('transparent'));
  paragraph.paint(canvas, 4 * SCALE, 2 * SCALE);
  surface.flush();
  const read = surface.makeImageSnapshot().readPixels();
  if (!(read instanceof Uint8Array)) return null;
  // Skia rows run top-down, texture rows bottom-up
  const data = new Uint8Array(px * py * 4);
  const row = px * 4;
  for (let y = 0; y < py; y++) data.set(read.subarray(y * row, y * row + row), (py - 1 - y) * row);
  const texture = new THREE.DataTexture(data, px, py, THREE.RGBAFormat);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return { texture, width: px / SCALE, height: py / SCALE };
}
