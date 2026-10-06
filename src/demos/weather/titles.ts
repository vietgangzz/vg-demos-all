import { Image } from 'react-native';
import { PathVerb, Skia, type SkTypeface } from 'react-native-skia';
import * as THREE from 'three/webgpu';

/**
 * Page titles as solid 3D type, as in the original: Inter Tight Black outlines from Skia,
 * extruded by three.js so the letters have dark sides. They stand on the ring with their pages,
 * swinging in and out with the object, and the pages behind show them from the back, mirrored
 * and hazy.
 */

/** Load a bundled font file (a `require`d asset) as a Skia typeface */
export async function loadTypeface(asset: number) {
  try {
    const uri = Image.resolveAssetSource(asset).uri;
    return Skia.Typeface.MakeFreeTypeFaceFromData(await Skia.Data.fromURI(uri));
  } catch {
    return null;
  }
}

let face: Promise<SkTypeface | null> | null = null;

/** Inter Tight Black, loaded once */
export function displayTypeface() {
  face ??= loadTypeface(require('@expo-google-fonts/inter-tight/900Black/InterTight_900Black.ttf'));
  return face;
}

let numerals: Promise<SkTypeface | null> | null = null;

/** Six Caps, ultra-condensed: the numerals are swollen from it */
export function numeralTypeface() {
  numerals ??= loadTypeface(require('@expo-google-fonts/six-caps/400Regular/SixCaps_400Regular.ttf'));
  return numerals;
}

/** Letters this tall (cap height) in geometry units: the scene scales them to points */
export const TITLE_CAP = 1;
/** Depth of the extrusion, as a fraction of the cap height */
const DEPTH = 0.22;

export type TitleMesh = { geometry: THREE.BufferGeometry; width: number };

/**
 * Solid type for `text`, centred on the cap height, its front face at z = 0. Groups: 0 is the
 * faces, 1 the sides (give it two materials).
 */
export async function titleGeometry(text: string): Promise<TitleMesh | null> {
  const typeface = await displayTypeface();
  if (!typeface || !text) return null;
  const font = Skia.Font(typeface, 100);
  const cap = Skia.Path.MakeFromText('H', 0, 0, font)?.computeTightBounds();
  if (!cap || cap.height <= 0) return null;
  const s = TITLE_CAP / cap.height;
  // Set tighter than the font's own spacing, like the original's display type
  const tracking = -3.2;
  const shape = new THREE.ShapePath();
  let x = 0;
  for (const ch of [...text]) {
    const path = Skia.Path.MakeFromText(ch, x, 0, font);
    x += font.getTextWidth(ch) + tracking;
    if (!path) continue;
    for (const [verb, ...p] of path.toCmds()) {
      if (verb === PathVerb.Move) shape.moveTo(p[0] * s, -p[1] * s);
      else if (verb === PathVerb.Line) shape.lineTo(p[0] * s, -p[1] * s);
      else if (verb === PathVerb.Quad || verb === PathVerb.Conic)
        shape.quadraticCurveTo(p[0] * s, -p[1] * s, p[2] * s, -p[3] * s);
      else if (verb === PathVerb.Cubic)
        shape.bezierCurveTo(p[0] * s, -p[1] * s, p[2] * s, -p[3] * s, p[4] * s, -p[5] * s);
    }
  }
  const geometry = new THREE.ExtrudeGeometry(shape.toShapes(), {
    depth: DEPTH,
    bevelEnabled: true,
    bevelThickness: 0.02,
    bevelSize: 0.012,
    bevelSegments: 2,
    curveSegments: 8,
  });
  geometry.computeBoundingBox();
  const b = geometry.boundingBox!;
  const width = b.max.x - b.min.x;
  // Centred across, the cap height centred on y = 0, the front face at z = 0
  geometry.translate(-(b.min.x + width / 2), -TITLE_CAP / 2, -DEPTH - 0.02);
  return { geometry, width };
}
