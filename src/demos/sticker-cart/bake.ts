import { AlphaType, BlendMode, ColorType, Skia, TileMode, type SkImage } from 'react-native-skia';
import * as THREE from 'three/webgpu';

import { PRODUCTS } from './catalog';
import { buildProduct, HERO_YAW, studioLights } from './products3d';

/**
 * The 3D products rendered once into images the 2D scene can draw: for each, a large render at its
 * hero angle for the shop card (with its own soft shadow), and a turntable of smaller renders all
 * the way round for when it's flying, tumbling or piled in the bag. Rendered off screen with an
 * orthographic camera, looking down on them a little, and read back.
 */

/** Turntable frames per product, and their size in the atlas */
export const FRAMES = 12;
export const CELL = 256;
const HERO = 384;
/** How far each product's tipped toward you, so you see a bit of its top */
const TILT = 0.36;

export type Baked = {
  /** Rows of turntable frames, a row per product */
  atlas: SkImage;
  /** Each product at its hero angle, and its shadow, as PNG data URIs */
  heroes: string[];
  shadows: string[];
};

/** The frame of the turntable for an angle */
export const frameOf = (yaw: number) => {
  'worklet';
  const f = Math.round(yaw / ((Math.PI * 2) / FRAMES)) % FRAMES;
  return f < 0 ? f + FRAMES : f;
};

let baked: Promise<Baked | null> | null = null;

/** Dev: how far the bake got, for QA (globalThis.bakeStage) */
const note = (stage: string) => {
  if (__DEV__) (globalThis as { bakeStage?: string }).bakeStage = stage;
};

/** The bake from earlier, if there's been one */
export const alreadyBaked = () => baked;

export function bakeProducts(context: GPUCanvasContext, device: GPUDevice) {
  baked ??= bake(context, device).catch((e) => {
    if (__DEV__) {
      console.warn('[bake]', e);
      note(`failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    baked = null;
    return null;
  });
  return baked;
}

async function bake(context: GPUCanvasContext, device: GPUDevice): Promise<Baked | null> {
  const renderer = new THREE.WebGPURenderer({
    canvas: context.canvas as HTMLCanvasElement,
    context,
    device,
    alpha: true,
    antialias: false,
  });
  note('init');
  await renderer.init();
  note('models');
  THREE.ColorManagement.enabled = false;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setClearColor(0x000000, 0);

  const models = PRODUCTS.map((p) => buildProduct(p.id));

  /** A grid of products, `cols` across, `rows` down, `cell` pixels each, read back as an image */
  const shoot = async (
    cols: number,
    rows: number,
    cell: number,
    pick: (col: number, row: number) => { product: number; yaw: number }
  ) => {
    const scene = new THREE.Scene();
    scene.add(studioLights());
    for (let row = 0; row < rows; row++)
      for (let col = 0; col < cols; col++) {
        const { product, yaw } = pick(col, row);
        const at = new THREE.Group();
        at.position.set(col + 0.5, -(row + 0.5), 0);
        const tilt = new THREE.Group();
        tilt.rotation.x = TILT;
        const turn = new THREE.Group();
        turn.rotation.y = yaw;
        turn.scale.setScalar(0.94);
        turn.add(models[product].clone());
        tilt.add(turn);
        at.add(tilt);
        scene.add(at);
      }
    const camera = new THREE.OrthographicCamera(0, cols, 0, -rows, -4, 4);
    const w = cols * cell;
    const h = rows * cell;
    const target = new THREE.RenderTarget(w, h, { samples: 4 });
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    const read = (await renderer.readRenderTargetPixelsAsync(target, 0, 0, w, h)) as Uint8Array;
    target.dispose();
    const pixels = new Uint8Array(read.buffer, read.byteOffset, w * h * 4);
    return Skia.Image.MakeImage(
      { width: w, height: h, alphaType: AlphaType.Premul, colorType: ColorType.RGBA_8888 },
      Skia.Data.fromBytes(pixels),
      w * 4
    );
  };

  const n = PRODUCTS.length;
  note('heroes');
  const heroRow = await shoot(n, 1, HERO, (col) => ({ product: col, yaw: HERO_YAW }));
  note('atlas');
  const atlas = await shoot(FRAMES, n, CELL, (col, row) => ({
    product: row,
    yaw: HERO_YAW + (col * Math.PI * 2) / FRAMES,
  }));
  renderer.dispose();
  if (!heroRow || !atlas) return null;

  note('images');
  const heroes: string[] = [];
  const shadows: string[] = [];
  for (let i = 0; i < n; i++) {
    const one = Skia.Surface.Make(HERO, HERO);
    const shade = Skia.Surface.Make(HERO, HERO);
    if (!one || !shade) return null;
    const c = one.getCanvas();
    c.clear(Skia.Color('transparent'));
    c.drawImageRect(heroRow, Skia.XYWHRect(i * HERO, 0, HERO, HERO), Skia.XYWHRect(0, 0, HERO, HERO), Skia.Paint());
    one.flush();
    const image = one.makeImageSnapshot();
    heroes.push(`data:image/png;base64,${image.encodeToBase64()}`);
    // Its shadow on the card: its own silhouette, squashed flat under it and blurred
    const bottom = lowestOpaque(image);
    const s = shade.getCanvas();
    s.clear(Skia.Color('transparent'));
    const paint = Skia.Paint();
    paint.setImageFilter(
      Skia.ImageFilter.MakeBlur(
        14,
        8,
        TileMode.Decal,
        Skia.ImageFilter.MakeColorFilter(
          Skia.ColorFilter.MakeBlend(Skia.Color('rgba(70,48,30,0.5)'), BlendMode.SrcIn),
          null
        )
      )
    );
    s.save();
    s.translate(HERO / 2, bottom);
    s.scale(1.05, 0.16);
    s.translate(-HERO / 2, -bottom);
    s.drawImage(image, 0, 0, paint);
    s.restore();
    shade.flush();
    shadows.push(`data:image/png;base64,${shade.makeImageSnapshot().encodeToBase64()}`);
  }
  note('done');
  return { atlas, heroes, shadows };
}

/** The lowest row with anything in it, so the shadow can sit right under the product */
function lowestOpaque(image: SkImage) {
  const w = image.width();
  const h = image.height();
  const px = image.readPixels();
  if (!(px instanceof Uint8Array)) return h * 0.9;
  for (let y = h - 1; y > 0; y--) for (let x = 0; x < w; x += 2) if (px[(y * w + x) * 4 + 3] > 40) return y;
  return h * 0.9;
}
