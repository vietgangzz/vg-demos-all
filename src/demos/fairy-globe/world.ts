import { AlphaType, ColorType, Skia } from 'react-native-skia';
import { Image } from 'react-native';
import * as THREE from 'three/webgpu';

/**
 * The world the globe is made of: where things are, and the maps baked for it in Blender
 * (scripts/blender/fairy_globe_world.py).
 *
 * Geography to the globe: longitude 0 faces +z, north is +y, east turns toward +x.
 * The maps are equirectangular, north up, longitude -180 at the left; as textures, v runs south
 * to north.
 */

export type Stop = {
  name: string;
  lon: number;
  lat: number;
  /** A line under the name on the card */
  note: string;
  /** Snow on the roofs */
  snowy: boolean;
  /** The town he lands in, that you follow him down the chimney of */
  hero?: boolean;
};

/** Santa's home: Lapland, under the northern lights */
export const VILLAGE = { name: 'Santa’s Village', lon: 25.73, lat: 66.54 };

/**
 * Where the presents go, in the order midnight gets there: it reaches the date line's west side
 * first and runs west round the world, and Santa runs with it.
 */
export const STOPS: Stop[] = [
  { name: 'Kiritimati', lon: -157.4, lat: 1.87, note: 'First place on Earth to reach Christmas', snowy: false },
  { name: 'Auckland', lon: 174.76, lat: -36.85, note: 'Christmas in the middle of summer', snowy: false },
  { name: 'Sydney', lon: 151.21, lat: -33.87, note: 'Presents first, then the beach', snowy: false },
  { name: 'Tokyo', lon: 139.69, lat: 35.69, note: 'Strawberry cake for Christmas Eve', snowy: false },
  { name: 'Ho Chi Minh City', lon: 106.7, lat: 10.78, note: 'Star lanterns down every alley', snowy: false },
  { name: 'Cape Town', lon: 18.42, lat: -33.92, note: 'A warm night under Table Mountain', snowy: false },
  {
    name: 'Rothenburg',
    lon: 10.18,
    lat: 49.38,
    note: 'Snow on the old town, and a light in every window',
    snowy: true,
    hero: true,
  },
  { name: 'Paris', lon: 2.35, lat: 48.86, note: 'A tree in every window', snowy: true },
  { name: 'London', lon: -0.13, lat: 51.51, note: 'Stockings by the fire', snowy: true },
  { name: 'Reykjavík', lon: -21.94, lat: 64.15, note: 'Thirteen Yule Lads already been', snowy: true },
  { name: 'Rio de Janeiro', lon: -43.2, lat: -22.91, note: 'Fireworks over the bay', snowy: false },
  { name: 'New York', lon: -74.0, lat: 40.71, note: 'Snow on the fire escapes', snowy: true },
  { name: 'Mexico City', lon: -99.13, lat: 19.43, note: 'Piñatas still swinging', snowy: false },
  { name: 'Honolulu', lon: -157.86, lat: 21.31, note: 'Last stop, then home', snowy: false },
];

const D2R = Math.PI / 180;

/** A point on the unit globe */
export function geo(lon: number, lat: number, r = 1, out = new THREE.Vector3()) {
  const lo = lon * D2R;
  const la = lat * D2R;
  return out.set(Math.cos(la) * Math.sin(lo) * r, Math.sin(la) * r, Math.cos(la) * Math.cos(lo) * r);
}

/** Back from a direction to longitude and latitude, in degrees */
export function lonLat(p: THREE.Vector3) {
  const n = p.length() || 1;
  return { lon: Math.atan2(p.x, p.z) / D2R, lat: Math.asin(Math.max(-1, Math.min(1, p.y / n))) / D2R };
}

// ---- The baked maps ----

export type Field = { w: number; h: number; data: Uint8Array };

export type WorldMaps = {
  shape: THREE.DataTexture;
  color: THREE.DataTexture;
  shapeField: Field;
  colorField: Field;
  lifeField: Field;
};

export async function decode(asset: number): Promise<Field | null> {
  const uri = Image.resolveAssetSource(asset).uri;
  const image = Skia.Image.MakeImageFromEncoded(await Skia.Data.fromURI(uri));
  if (!image) return null;
  const w = image.width();
  const h = image.height();
  const read = image.readPixels(0, 0, { width: w, height: h, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul });
  if (!(read instanceof Uint8Array)) return null;
  return { w, h, data: read };
}

/** A map as a texture, its rows turned so v runs south to north */
export function texture(field: Field, mips: boolean, wrap = true) {
  const { w, h, data } = field;
  const flipped = new Uint8Array(data.length);
  const row = w * 4;
  for (let y = 0; y < h; y++) flipped.set(data.subarray(y * row, y * row + row), (h - 1 - y) * row);
  const t = new THREE.DataTexture(flipped, w, h, THREE.RGBAFormat);
  t.wrapS = wrap ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  t.generateMipmaps = mips;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

let maps: Promise<WorldMaps | null> | null = null;

export function loadWorld() {
  maps ??= (async () => {
    const [shape, color, life] = await Promise.all([
      decode(require('../../../assets/fairy-globe/world_shape.png')),
      decode(require('../../../assets/fairy-globe/world_color.png')),
      decode(require('../../../assets/fairy-globe/world_life.png')),
    ]);
    if (!shape || !color || !life) return null;
    return {
      shape: texture(shape, false),
      color: texture(color, true),
      shapeField: shape,
      colorField: color,
      lifeField: life,
    };
  })();
  return maps;
}

/** One channel of a map at a longitude and latitude, filtered, 0..1 */
export function sample(field: Field, channel: number, lon: number, lat: number) {
  const { w, h, data } = field;
  const x = (((lon + 180) / 360) * w - 0.5 + w) % w;
  const y = Math.max(0, Math.min(h - 1, ((90 - lat) / 180) * h - 0.5));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = (x0 + 1) % w;
  const y1 = Math.min(h - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  const at = (xx: number, yy: number) => data[(yy * w + xx) * 4 + channel];
  const top = at(x0, y0) * (1 - fx) + at(x1, y0) * fx;
  const bottom = at(x0, y1) * (1 - fx) + at(x1, y1) * fx;
  return (top * (1 - fy) + bottom * fy) / 255;
}

/** Degrees from the coast: positive inland, negative out to sea */
export const coastDistance = (shape: Field, lon: number, lat: number) => (sample(shape, 0, lon, lat) - 0.5) * 16;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Sea level is radius 1. The land stands up out of it like a soft clay plateau, and the hills and
 * mountains rise smoothly on top.
 */
export const SEA = 1;
export const PLATEAU = 0.012;
export const RELIEF = 0.045;

export function groundRadius(shape: Field, lon: number, lat: number) {
  const coast = coastDistance(shape, lon, lat);
  const land = smooth(-0.2, 0.3, coast);
  const rise = smooth(0, 4, coast) * 0.25;
  const height = sample(shape, 1, lon, lat);
  return SEA - 0.012 + land * (0.012 + PLATEAU) + land * (rise + height) * RELIEF;
}

// ---- The town you go down into, set into the globe life-size ----

/** Globe units to the metre, for the town: a toy world, so its towns are big on it */
export const TOWN_SCALE = 0.0006;

/** How far the town's own ground reaches, in its metres: the world's takes over past it */
export const TOWN_REACH = 150;

/** The town's ground (scripts/blender/xmas_town.py, ground_z), in its own metres, three's axes */
export function townGround(x: number, z: number) {
  const y = -z;
  const r = Math.hypot(x, y);
  const rise = 0.35 * Math.exp(-(((r - 60) / 30) ** 2));
  const swell = 1.4 * Math.sin(x * 0.045 + 0.6) * Math.sin(y * 0.052 + 1.1);
  const out = Math.min(1, Math.max(0, (r - 70) / 40)) * (1 - Math.min(1, Math.max(0, (r - 125) / 25)));
  return 0.15 * Math.sin(x * 0.35) * Math.sin(y * 0.31) + rise + swell * out;
}

export type HeroFrame = {
  /** Out from the centre through the town */
  dir: THREE.Vector3;
  /** The ground's radius there */
  radius: number;
  /** Globe-local: the town's middle, and its turn (x east, y up, z south) */
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: number;
};

export function heroFrame(shape: Field, stop: Stop): HeroFrame {
  const dir = geo(stop.lon, stop.lat).normalize();
  const radius = groundRadius(shape, stop.lon, stop.lat);
  const north = new THREE.Vector3(0, 1, 0).addScaledVector(dir, -dir.y).normalize();
  const east = new THREE.Vector3().crossVectors(north, dir).normalize();
  const basis = new THREE.Matrix4().makeBasis(east, dir, north.clone().negate());
  return {
    dir,
    radius,
    position: dir.clone().multiplyScalar(radius),
    quaternion: new THREE.Quaternion().setFromRotationMatrix(basis),
    scale: TOWN_SCALE,
  };
}
