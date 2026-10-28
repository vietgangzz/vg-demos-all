import { Image } from 'react-native';
import { AlphaType, ColorType, Skia } from 'react-native-skia';
import * as THREE from 'three/webgpu';

/**
 * The painted art (assets/daily-drop/art, see PROMPTS.md there): the vault behind the chest, which
 * the scene paints in as its background, and the cards' faces and back, which the cards draw.
 */

export const CARD_ART = {
  coins: require('../../../assets/daily-drop/art/card-coins.png'),
  gems: require('../../../assets/daily-drop/art/card-gems.png'),
  xp: require('../../../assets/daily-drop/art/card-xp.png'),
  fox: require('../../../assets/daily-drop/art/card-fox.png'),
  back: require('../../../assets/daily-drop/art/card-back.png'),
} as const;

const BACKDROP = require('../../../assets/daily-drop/art/backdrop.png');

export type Painting = { texture: THREE.DataTexture; aspect: number };

/** The vault, decoded into a texture (its rows turned, so v runs bottom to top) */
export function loadBackdrop() {
  return loadPainting(BACKDROP);
}

/** Ember Drake, rendered in Blender (scripts/blender/daily_drop_drake_portrait.py), for your avatar */
export const DRAKE_AVATAR = require('../../../assets/daily-drop/art/drake-avatar.png');

async function loadPainting(source: number): Promise<Painting> {
  const uri = Image.resolveAssetSource(source)!.uri;
  const image = Skia.Image.MakeImageFromEncoded(await Skia.Data.fromURI(uri));
  if (!image) throw new Error("[daily-drop] couldn't decode the backdrop");
  const w = image.width();
  const h = image.height();
  const data = image.readPixels(0, 0, {
    width: w,
    height: h,
    colorType: ColorType.RGBA_8888,
    alphaType: AlphaType.Unpremul,
  });
  if (!(data instanceof Uint8Array)) throw new Error("[daily-drop] couldn't read the backdrop");
  const flipped = new Uint8Array(data.length);
  const row = w * 4;
  for (let y = 0; y < h; y++) flipped.set(data.subarray(y * row, y * row + row), (h - 1 - y) * row);
  const texture = new THREE.DataTexture(flipped, w, h, THREE.RGBAFormat);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return { texture, aspect: w / h };
}
