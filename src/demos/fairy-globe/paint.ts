import {
  AlphaType,
  BlendMode,
  ColorType,
  FontWeight,
  PaintStyle,
  Skia,
  TextAlign,
  TileMode,
  type SkCanvas,
} from 'react-native-skia';
import * as THREE from 'three/webgpu';

/**
 * What's painted rather than modelled, once, with Skia, as the demo opens.
 *
 * The room's far wall, the way the camera on the shelf sees it: so far out of focus there's nothing
 * left of it but colour and light. A window of winter night on the left with snow coming down past
 * it, the tree in the corner on the right strung with lights, a string of fairy lights sagging
 * across the top, the lamp's warmth on the wall between. It's drawn in the wall's own units, the
 * town's metres with y up, on the plane z = WALL.z; three.js looks it up where a ray meets that
 * plane, so it moves the way a wall does as the camera does.
 *
 * The ceiling, as it's seen from down in the town looking up through the glass: strings of fairy
 * lights across it, nothing else, black between (it's added to what's there).
 *
 * And the plaque on the globe's base: its shape in red, what's engraved in it in green.
 */

export const WALL = { z: -3600, x0: -2400, x1: 2400, y0: -2000, y1: 1600 };
const WALL_PX = { w: 2048, h: 1536 };
/** The ceiling, high over the table, in x and z */
export const CEILING = { y: 4200, x0: -4000, x1: 4000, z0: -3600, z1: 4400 };
const CEILING_PX = 1024;
export const PLAQUE_PX = { w: 512, h: 188 };

export type RoomMaps = { wall: THREE.DataTexture; ceiling: THREE.DataTexture; plaque: THREE.DataTexture };

const blank = (w: number, h: number) => {
  const t = new THREE.DataTexture(new Uint8Array(w * h * 4), w, h, THREE.RGBAFormat);
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  return t;
};

/** The textures, blank: the materials are made with them before they're painted */
export const roomMaps = (): RoomMaps => ({
  wall: blank(WALL_PX.w, WALL_PX.h),
  ceiling: blank(CEILING_PX, CEILING_PX),
  plaque: blank(PLAQUE_PX.w, PLAQUE_PX.h),
});

export function paintRoom(maps: RoomMaps) {
  paintInto(maps.wall, paintWall);
  paintInto(maps.ceiling, paintCeiling);
  paintInto(maps.plaque, paintPlaque);
}

function paintInto(t: THREE.DataTexture, paint: (c: SkCanvas, w: number, h: number) => void) {
  const { width: w, height: h, data } = t.image as { width: number; height: number; data: Uint8Array };
  const read = render(w, h, paint, true) ?? render(w, h, paint, false);
  if (!read) return;
  // Its rows turned over: three.js has v running bottom to top
  const row = w * 4;
  for (let y = 0; y < h; y++) data.set(read.subarray(y * row, y * row + row), (h - 1 - y) * row);
  t.needsUpdate = true;
}

function render(w: number, h: number, paint: (c: SkCanvas, w: number, h: number) => void, gpu: boolean) {
  const surface = gpu ? Skia.Surface.MakeOffscreen(w, h) : Skia.Surface.Make(w, h);
  if (!surface) return null;
  const c = surface.getCanvas();
  c.clear(Skia.Color('#000000'));
  paint(c, w, h);
  surface.flush();
  const read = surface
    .makeImageSnapshot()
    .readPixels(0, 0, { width: w, height: h, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul });
  return read instanceof Uint8Array && read.length === w * h * 4 ? read : null;
}

// ---- Paint ----

const col = (hex: string, a = 1) => {
  const k = Skia.Color(hex);
  k[3] = a;
  return k;
};
const cols = (hexes: string[]) => hexes.map((h) => Skia.Color(h));

/** The same every time it's painted */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const adding = () => {
  const p = Skia.Paint();
  p.setAntiAlias(true);
  p.setBlendMode(BlendMode.Plus);
  return p;
};

/** A light far out of focus: a flat disc, a touch brighter toward its rim, its edge soft, the way a lens draws one */
function bokeh(c: SkCanvas, x: number, y: number, r: number, hex: string, a: number) {
  const p = adding();
  p.setShader(
    Skia.Shader.MakeRadialGradient(
      { x, y },
      r,
      [col(hex, a * 0.7), col(hex, a * 0.78), col(hex, a), col(hex, 0)],
      [0, 0.6, 0.9, 1],
      TileMode.Clamp
    )
  );
  c.drawCircle(x, y, r, p);
}

/** Light spilling softly across the wall */
function glow(c: SkCanvas, x: number, y: number, r: number, hex: string, a: number) {
  const p = adding();
  p.setShader(
    Skia.Shader.MakeRadialGradient(
      { x, y },
      r,
      [col(hex, a), col(hex, a * 0.45), col(hex, a * 0.14), col(hex, 0)],
      [0, 0.32, 0.66, 1],
      TileMode.Clamp
    )
  );
  c.drawCircle(x, y, r, p);
}

/** Everything drawn until the matching restore, blurred as one, `sigma` in the wall's units */
function blurred(c: SkCanvas, sigma: number) {
  const p = Skia.Paint();
  p.setImageFilter(Skia.ImageFilter.MakeBlur(sigma, sigma, TileMode.Decal, null));
  c.saveLayer(p);
}

const WARM = ['#FFD08A', '#FFC271', '#FFE2B0', '#FFB45E', '#FFD9A0'];
const COLOURED = ['#FF5A4E', '#5BE08F', '#62A2FF', '#FFB13B', '#FF7BB5'];

function paintWall(c: SkCanvas, w: number) {
  const s = w / (WALL.x1 - WALL.x0);
  c.save();
  // Draw in the wall's units, y up
  c.translate(-WALL.x0 * s, WALL.y1 * s);
  c.scale(s, -s);
  const rand = rng(1224);
  const pick = (list: string[]) => list[Math.floor(rand() * list.length) % list.length];

  // The wall: plum-dark up toward the ceiling, warmer lower down, darkest toward the floor
  const wall = Skia.Paint();
  wall.setShader(
    Skia.Shader.MakeLinearGradient(
      { x: 0, y: WALL.y1 },
      { x: 0, y: WALL.y0 },
      cols(['#0B0911', '#130D13', '#1D130F', '#140C09', '#070504']),
      [0, 0.25, 0.5, 0.75, 1],
      TileMode.Clamp
    )
  );
  c.drawRect(Skia.XYWHRect(WALL.x0, WALL.y0, WALL.x1 - WALL.x0, WALL.y1 - WALL.y0), wall);

  // The lamp's warmth on the wall, right of the middle; the room's glow low down behind the globe;
  // cold light from the window spilling round it
  glow(c, 620, -240, 1800, '#B4561F', 0.24);
  glow(c, -40, -620, 900, '#7A3E22', 0.12);
  glow(c, -560, -220, 1300, '#33508F', 0.16);

  // Far lights deep in the room, small and dim
  for (let k = 0; k < 170; k++) {
    bokeh(c, WALL.x0 + 100 + rand() * 4600, -1700 + rand() * 3100, 10 + rand() * 14, pick(WARM), 0.1 + rand() * 0.2);
  }

  nightWindow(c, rand);
  tree(c, rand, pick);

  // A string of fairy lights sagging across the top, nearer, so bigger and softer
  for (let x = WALL.x0 + 60; x < WALL.x1 - 60; x += 118 + rand() * 64) {
    const u = x / 2400;
    const y = 1180 - 560 * (1 - u * u) + (u + 0.3) * 120 + (rand() - 0.5) * 36;
    const fade = Math.min(1, (2400 - Math.abs(x)) / 600);
    const coloured = rand() < 0.14;
    bokeh(c, x, y, 40 + rand() * 24, coloured ? pick(COLOURED) : pick(WARM), (0.42 + rand() * 0.32) * fade);
  }

  // A few great soft orbs, lights very near the lens
  for (let k = 0; k < 12; k++) {
    const cool = k % 5 === 4;
    bokeh(
      c,
      -1600 + rand() * 3200,
      -1200 + rand() * 2300,
      170 + rand() * 170,
      cool ? '#8FB0FF' : '#FFB070',
      0.035 + rand() * 0.045
    );
  }
  c.restore();
}

function paintCeiling(c: SkCanvas, w: number) {
  const s = w / (CEILING.x1 - CEILING.x0);
  c.save();
  // In the ceiling's units: x across, z toward the shelf
  c.translate(-CEILING.x0 * s, CEILING.z1 * s);
  c.scale(s, -s);
  const rand = rng(2412);
  const pick = (list: string[]) => list[Math.floor(rand() * list.length) % list.length];
  // The lamp's glow up on the ceiling, over the table
  glow(c, 300, 400, 2600, '#B86A30', 0.1);
  // Strings of lights, slung across from wall to wall
  for (let k = 0; k < 7; k++) {
    const za = CEILING.z0 + 600 + rand() * 6800;
    const zb = CEILING.z0 + 600 + rand() * 6800;
    for (let x = CEILING.x0 + 100; x < CEILING.x1 - 100; x += 170 + rand() * 90) {
      const u = (x - CEILING.x0) / (CEILING.x1 - CEILING.x0);
      const coloured = rand() < 0.16;
      bokeh(
        c,
        x,
        za + (zb - za) * u + (rand() - 0.5) * 60,
        70 + rand() * 45,
        coloured ? pick(COLOURED) : pick(WARM),
        0.3 + rand() * 0.32
      );
    }
  }
  c.restore();
}

/** The window on the left: winter night, snow coming down past it, the frame's cross dark across it */
function nightWindow(c: SkCanvas, rand: () => number) {
  const X0 = -930;
  const X1 = -150;
  const Y0 = -1150;
  const Y1 = 560;
  blurred(c, 22);
  // The night out there: deep blue, lighter up toward the sky, warm low down from a streetlamp
  const sky = Skia.Paint();
  sky.setAntiAlias(true);
  sky.setShader(
    Skia.Shader.MakeLinearGradient(
      { x: 0, y: Y1 },
      { x: 0, y: Y0 },
      cols(['#3D62A6', '#28447F', '#1B2D5A']),
      [0, 0.55, 1],
      TileMode.Clamp
    )
  );
  c.drawRect(Skia.XYWHRect(X0, Y0, X1 - X0, Y1 - Y0), sky);
  glow(c, -330, -1050, 700, '#FFB070', 0.26);
  // Snow outside, lit by it
  const flake = Skia.Paint();
  flake.setAntiAlias(true);
  for (let k = 0; k < 280; k++) {
    flake.setColor(col('#E8F0FF', 0.25 + rand() * 0.55));
    c.drawCircle(X0 + rand() * (X1 - X0), Y0 + rand() * (Y1 - Y0), 3 + rand() * 7, flake);
  }
  // Frost creeping in at the bottom corners
  glow(c, X0 + 30, Y0 + 30, 430, '#D2E0F6', 0.2);
  glow(c, X1 - 30, Y0 + 30, 340, '#D2E0F6', 0.14);
  // The frame, its cross and its bars, dark against the night
  const frame = Skia.Paint();
  frame.setAntiAlias(true);
  frame.setColor(Skia.Color('#100B0C'));
  const bar = 34;
  c.drawRect(Skia.XYWHRect((X0 + X1) / 2 - bar / 2, Y0, bar, Y1 - Y0), frame);
  c.drawRect(Skia.XYWHRect(X0, 140 - bar / 2, X1 - X0, bar), frame);
  c.drawRect(Skia.XYWHRect(X0, -500 - bar / 2, X1 - X0, bar), frame);
  const border = Skia.Paint();
  border.setAntiAlias(true);
  border.setStyle(PaintStyle.Stroke);
  border.setStrokeWidth(64);
  border.setColor(Skia.Color('#130C0C'));
  c.drawRect(Skia.XYWHRect(X0, Y0, X1 - X0, Y1 - Y0), border);
  // The sill, catching a little lamplight
  const sill = Skia.Paint();
  sill.setColor(Skia.Color('#2E1C13'));
  c.drawRect(Skia.XYWHRect(X0 - 80, Y0 - 90, X1 - X0 + 160, 64), sill);
  c.restore();
}

const TREE = { x: 660, top: 950 };
/** How wide the tree is, either side of its middle, at height y */
const treeHalf = (y: number) => 60 + (TREE.top - y) * 0.38;

/** The tree in the corner: a dark mass, so soft it only darkens the wall, and its lights */
function tree(c: SkCanvas, rand: () => number, pick: (list: string[]) => string) {
  blurred(c, 70);
  const green = Skia.Paint();
  green.setAntiAlias(true);
  green.setShader(
    Skia.Shader.MakeLinearGradient(
      { x: TREE.x - 900, y: 0 },
      { x: TREE.x + 900, y: 0 },
      cols(['#0A130D', '#14291B', '#0B1710']),
      [0, 0.62, 1],
      TileMode.Clamp
    )
  );
  // Tier on tier, each flaring out a little below the one above
  const b = Skia.PathBuilder.Make().moveTo(TREE.x, TREE.top);
  const tiers = 7;
  const step = (TREE.top - WALL.y0) / tiers;
  for (let k = 1; k <= tiers; k++) {
    const y = TREE.top - k * step;
    b.lineTo(TREE.x + treeHalf(y), y).lineTo(TREE.x + treeHalf(y) * 0.8, y + step * 0.18);
  }
  for (let k = tiers; k >= 1; k--) {
    const y = TREE.top - k * step;
    b.lineTo(TREE.x - treeHalf(y) * 0.8, y + step * 0.18).lineTo(TREE.x - treeHalf(y), y);
  }
  b.close();
  c.drawPath(b.detach(), green);
  c.restore();

  // Its lights, strung round and round: mostly warm white, now and then a coloured one
  for (let k = 0; k < 230; k++) {
    const y = TREE.top - 70 - Math.pow(rand(), 0.85) * 2850;
    const x = TREE.x + (rand() * 2 - 1) * treeHalf(y) * 0.9;
    const coloured = rand() < 0.2;
    const r = 16 + rand() * 24 + (rand() < 0.12 ? 20 : 0);
    bokeh(c, x, y, r, coloured ? pick(COLOURED) : pick(WARM), (coloured ? 0.3 : 0.32) + rand() * 0.3);
  }
}

function paintPlaque(c: SkCanvas, w: number, h: number) {
  // The plate, in red
  const plate = Skia.Paint();
  plate.setAntiAlias(true);
  plate.setColor(Skia.Color('#FF0000'));
  c.drawRRect(Skia.RRectXY(Skia.XYWHRect(5, 5, w - 10, h - 10), 34, 34), plate);
  // What's engraved, in green, added so the two can be read apart
  const cut = Skia.Paint();
  cut.setBlendMode(BlendMode.Plus);
  c.saveLayer(cut);
  const line = Skia.Paint();
  line.setAntiAlias(true);
  line.setStyle(PaintStyle.Stroke);
  line.setStrokeWidth(3.2);
  line.setColor(Skia.Color('#00FF00'));
  c.drawRRect(Skia.RRectXY(Skia.XYWHRect(19, 19, w - 38, h - 38), 22, 22), line);
  const text = Skia.ParagraphBuilder.Make({ textAlign: TextAlign.Center })
    .pushStyle({
      fontSize: 82,
      fontFamilies: ['Snell Roundhand'],
      color: Skia.Color('#00FF00'),
      fontStyle: { weight: FontWeight.Bold },
    })
    .addText('Stille Nacht')
    .build();
  text.layout(w);
  text.paint(c, 0, (h - text.getHeight()) / 2 + 2);
  // A little star either side
  const star = Skia.Paint();
  star.setAntiAlias(true);
  star.setColor(Skia.Color('#00FF00'));
  for (const sx of [44, w - 44]) {
    const k = Skia.PathBuilder.Make();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
      const r = i % 2 ? 3.2 : 10;
      const x = sx + Math.cos(a) * r;
      const y = h / 2 + Math.sin(a) * r;
      if (i === 0) k.moveTo(x, y);
      else k.lineTo(x, y);
    }
    k.close();
    c.drawPath(k.detach(), star);
  }
  c.restore();
}
