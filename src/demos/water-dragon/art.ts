import { Image } from 'react-native';
import { AlphaType, ColorType, Skia } from 'react-native-skia';
import * as THREE from 'three/webgpu';

/**
 * The painted parts of the theatre (assets/water-dragon/art, see PROMPTS.md there): the sky, the
 * hills and the village behind the pond, the roof tiles, the bamboo blind and the carved frieze of
 * the stage house, the two dragons on its ridge, the band beside it, the lotus leaves and the reeds.
 * Decoded once, before the show starts, each into a texture.
 */

const SOURCES = {
  sky: require('../../../assets/water-dragon/art/sky.png'),
  hills: require('../../../assets/water-dragon/art/hills.png'),
  village: require('../../../assets/water-dragon/art/village.png'),
  tiles: require('../../../assets/water-dragon/art/roof-tiles.png'),
  blind: require('../../../assets/water-dragon/art/bamboo-blind.png'),
  frieze: require('../../../assets/water-dragon/art/frieze.png'),
  ridge: require('../../../assets/water-dragon/art/ridge-dragons.png'),
  band: require('../../../assets/water-dragon/art/musicians.png'),
  leaf: require('../../../assets/water-dragon/art/lotus-leaf.png'),
  reeds: require('../../../assets/water-dragon/art/reeds.png'),
} as const;

export const POSTER = require('../../../assets/water-dragon/art/poster.png');

export type ArtName = keyof typeof SOURCES;
export type Painting = { texture: THREE.DataTexture; aspect: number };
export type Art = Record<ArtName, Painting>;

/** How each one's laid on: tiled, mirrored side to side (the long backdrops), or just once */
const WRAP: Partial<Record<ArtName, THREE.Wrapping>> = {
  hills: THREE.MirroredRepeatWrapping,
  frieze: THREE.MirroredRepeatWrapping,
  village: THREE.MirroredRepeatWrapping,
  tiles: THREE.RepeatWrapping,
  blind: THREE.RepeatWrapping,
};

async function paint(name: ArtName): Promise<Painting> {
  const uri = Image.resolveAssetSource(SOURCES[name])!.uri;
  const image = Skia.Image.MakeImageFromEncoded(await Skia.Data.fromURI(uri));
  if (!image) throw new Error(`[water-dragon] couldn't decode ${name}`);
  const w = image.width();
  const h = image.height();
  const data = image.readPixels(0, 0, { width: w, height: h, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul });
  if (!(data instanceof Uint8Array)) throw new Error(`[water-dragon] couldn't read ${name}`);
  // Its rows turned, so v runs bottom to top
  const flipped = new Uint8Array(data.length);
  const row = w * 4;
  for (let y = 0; y < h; y++) flipped.set(data.subarray(y * row, y * row + row), (h - 1 - y) * row);
  const texture = new THREE.DataTexture(flipped, w, h, THREE.RGBAFormat);
  texture.wrapS = WRAP[name] ?? THREE.ClampToEdgeWrapping;
  texture.wrapT = name === 'tiles' || name === 'blind' ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return { texture, aspect: w / h };
}

export async function loadArt(): Promise<Art> {
  const names = Object.keys(SOURCES) as ArtName[];
  const done = await Promise.all(names.map(paint));
  return Object.fromEntries(names.map((n, i) => [n, done[i]])) as Art;
}
