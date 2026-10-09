import { BlendMode, FontWeight, PaintStyle, Skia, StrokeCap, type SkCanvas } from 'react-native-skia';
import * as TSL from 'three/tsl';
import * as THREE from 'three/webgpu';

import {
  add,
  buildProduct,
  fill,
  mat,
  painted,
  rbox as roundBox,
  rod,
  skiaTexture,
  sphere,
  textured,
  words,
  type Vec,
} from '../sticker-cart/products3d';

/**
 * The shop's gadgets, made the way the market's products are: soft, rounded, from simple shapes,
 * each built facing +z with y up. Screens are lit (a basic material, so they read as glowing in
 * the dark shop) and drawn with Skia.
 */

export type Gadget =
  | 'headphones'
  | 'filmCamera'
  | 'lamp'
  | 'watch'
  | 'controller'
  | 'speaker'
  | 'keyboard'
  | 'handheld'
  | 'instant'
  | 'laptop'
  | 'tablet';

export const GADGETS: Record<Gadget, { name: string; price: number }> = {
  headphones: { name: 'Studio Headphones', price: 199 },
  filmCamera: { name: 'Film Camera', price: 120 },
  lamp: { name: 'Desk Lamp', price: 35 },
  watch: { name: 'Watch', price: 249 },
  controller: { name: 'Controller', price: 59 },
  speaker: { name: 'Speaker', price: 129 },
  keyboard: { name: 'Keyboard', price: 89 },
  handheld: { name: 'Handheld', price: 49 },
  instant: { name: 'Instant Camera', price: 79 },
  laptop: { name: 'Laptop', price: 1299 },
  tablet: { name: 'Tablet', price: 499 },
};

/** A rounded box whose rounding never goes past its thinnest side (a screen sits flush on it) */
const rbox = (w: number, h: number, d: number, r: number, seg?: number) =>
  roundBox(w, h, d, Math.min(r, (Math.min(w, h, d) / 2) * 0.9), seg);

/** A lit screen: drawn, and shown at full brightness whatever the light */
function screen(w: number, h: number, draw: (c: SkCanvas) => void) {
  const m = new THREE.MeshBasicNodeMaterial({ map: skiaTexture(w, h, draw) });
  m.colorNode = TSL.texture(m.map!, TSL.uv()).rgb.mul(0.92);
  return m;
}

/** A soft gradient wallpaper with a couple of blurred blobs, the look of a phone's lock screen */
function wallpaper(c: SkCanvas, w: number, h: number, a: string, b: string, blob: string) {
  const p = Skia.Paint();
  p.setShader(
    Skia.Shader.MakeLinearGradient({ x: 0, y: 0 }, { x: w * 0.4, y: h }, [Skia.Color(a), Skia.Color(b)], null, 0)
  );
  c.drawRect(Skia.XYWHRect(0, 0, w, h), p);
  const soft = fill(blob);
  soft.setMaskFilter(Skia.MaskFilter.MakeBlur(0, w * 0.12, true));
  c.drawCircle(w * 0.72, h * 0.3, w * 0.34, soft);
  c.drawCircle(w * 0.2, h * 0.78, w * 0.28, soft);
}

function watch() {
  const g = new THREE.Group();
  // On a pillow, the band round it
  add(g, rbox(0.42, 0.28, 0.3, 0.12, 10), painted(textured('#CFC6B8', 60, 0.08), 0.95, 0.08), [0, 0.14, -0.04]);
  const band = mat('#F07A4F', 0.75, 0.1);
  const strap = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.2, 48, 1, true), band);
  strap.material.side = THREE.DoubleSide;
  strap.rotation.z = Math.PI / 2;
  strap.scale.set(1, 1, 0.95);
  strap.position.set(0, 0.2, -0.04);
  g.add(strap);
  // The face
  add(g, rbox(0.26, 0.31, 0.09, 0.07, 10), mat('#2A2C30', 0.25, 0.25), [0, 0.22, 0.17]);
  const face = screen(256, 304, (c) => {
    c.drawRect(Skia.XYWHRect(0, 0, 256, 304), fill('#000000'));
    const ring = (r: number, color: string, sweep: number) => {
      const p = fill(color);
      p.setStyle(PaintStyle.Stroke);
      p.setStrokeWidth(20);
      p.setStrokeCap(StrokeCap.Round);
      const path = Skia.PathBuilder.Make()
        .addArc(Skia.XYWHRect(128 - r, 160 - r, r * 2, r * 2), -90, sweep)
        .detach();
      c.drawPath(path, p);
    };
    ring(96, '#FF3B5C', 290);
    ring(70, '#A6FF3B', 220);
    ring(44, '#3BE4FF', 160);
    words(c, '10:09', 18, 256, 34, '#FFFFFF', FontWeight.Bold);
  });
  add(g, new THREE.PlaneGeometry(0.22, 0.26), face, [0, 0.22, 0.2155]);
  // The crown
  add(
    g,
    new THREE.CylinderGeometry(0.022, 0.022, 0.04, 20),
    mat('#E46A3F', 0.4, 0.2),
    [0.145, 0.27, 0.17],
    [0, 0, Math.PI / 2]
  );
  return g;
}

function controller() {
  const g = new THREE.Group();
  const shell = mat('#F1ECE3', 0.45, 0.2);
  const dark = mat('#2B2C30', 0.6, 0.1);
  const c = new THREE.Group();
  c.rotation.x = 0.55;
  c.position.y = 0.16;
  g.add(c);
  add(c, rbox(0.62, 0.3, 0.16, 0.08, 10), shell, [0, 0.04, 0]);
  for (const s of [-1, 1])
    add(c, sphere(0.15, 32, 24), shell, [s * 0.27, -0.06, 0], [0, 0, s * 0.4], [0.95, 1.25, 0.6]);
  // A d-pad
  add(c, rbox(0.12, 0.04, 0.03, 0.01, 4), dark, [-0.21, 0.05, 0.085]);
  add(c, rbox(0.04, 0.12, 0.03, 0.01, 4), dark, [-0.21, 0.05, 0.085]);
  // Four face buttons
  const hues = ['#F05A4F', '#F2C230', '#4CC27A', '#4D8DF0'];
  const at: [number, number][] = [
    [0.21, 0.1],
    [0.27, 0.05],
    [0.15, 0.05],
    [0.21, 0.0],
  ];
  at.forEach(([x, y], i) =>
    add(c, sphere(0.027, 16, 12), mat(hues[i], 0.35, 0.2), [x, y, 0.08], [0, 0, 0], [1, 1, 0.6])
  );
  // Two sticks
  for (const s of [-1, 1]) {
    add(c, new THREE.CylinderGeometry(0.035, 0.04, 0.06, 24), dark, [s * 0.09, -0.06, 0.09], [Math.PI / 2, 0, 0]);
    add(c, new THREE.CylinderGeometry(0.055, 0.055, 0.02, 32), dark, [s * 0.09, -0.06, 0.125], [Math.PI / 2, 0, 0]);
  }
  add(c, sphere(0.02, 12, 8), mat('#6BD3FF', 0.2, 0.6), [0, 0.12, 0.08], [0, 0, 0], [1, 1, 0.4]);
  return g;
}

function speaker() {
  const g = new THREE.Group();
  const fabric = painted(textured('#8FA89A', 220, 0.12), 0.95, 0.1);
  add(g, new THREE.CylinderGeometry(0.24, 0.25, 0.62, 64), fabric, [0, 0.31, 0]);
  add(g, new THREE.TorusGeometry(0.235, 0.018, 12, 64), fabric, [0, 0.62, 0], [Math.PI / 2, 0, 0]);
  add(g, new THREE.CylinderGeometry(0.235, 0.235, 0.02, 64), mat('#2C2E2D', 0.4, 0.2), [0, 0.628, 0]);
  const glow = new THREE.MeshBasicNodeMaterial();
  glow.colorNode = TSL.vec3(0.55, 0.85, 1.4);
  add(g, new THREE.TorusGeometry(0.15, 0.008, 8, 64), glow, [0, 0.64, 0], [Math.PI / 2, 0, 0]);
  add(g, new THREE.CylinderGeometry(0.25, 0.25, 0.02, 64), mat('#2C2E2D', 0.5), [0, 0.01, 0]);
  return g;
}

function keyboard() {
  const g = new THREE.Group();
  const k = new THREE.Group();
  k.rotation.x = 0.12;
  k.position.y = 0.05;
  g.add(k);
  add(k, rbox(1.24, 0.08, 0.44, 0.03, 8), mat('#3A3D44', 0.5, 0.15));
  const caps = new THREE.InstancedMesh(rbox(0.078, 0.05, 0.078, 0.016, 4), mat('#EFE9DF', 0.5, 0.15), 52);
  const m = new THREE.Matrix4();
  let n = 0;
  for (let r = 0; r < 4; r++)
    for (let i = 0; i < 13; i++) {
      if (r === 3 && i > 3 && i < 9) continue;
      m.makeTranslation(-0.54 + i * 0.09, 0.06, -0.15 + r * 0.095);
      caps.setMatrixAt(n++, m);
    }
  caps.count = n;
  k.add(caps);
  add(k, rbox(0.43, 0.05, 0.078, 0.016, 4), mat('#EFE9DF', 0.5, 0.15), [0, 0.06, 0.135]);
  add(k, rbox(0.078, 0.052, 0.078, 0.016, 4), mat('#F08A4B', 0.45, 0.18), [-0.54, 0.061, -0.15]);
  add(k, rbox(0.078, 0.052, 0.078, 0.016, 4), mat('#3F8F86', 0.45, 0.18), [0.54, 0.061, -0.055]);
  return g;
}

function handheld() {
  const g = new THREE.Group();
  const shell = mat('#D9D5CC', 0.5, 0.18);
  const h = new THREE.Group();
  h.rotation.x = -0.18;
  h.position.y = 0.42;
  g.add(h);
  add(h, rbox(0.5, 0.82, 0.12, 0.05, 8), shell);
  add(h, rbox(0.42, 0.34, 0.02, 0.03, 6), mat('#5B5E6B', 0.5, 0.1), [0, 0.17, 0.06]);
  const lcd = screen(192, 160, (c) => {
    c.drawRect(Skia.XYWHRect(0, 0, 192, 160), fill('#9BBC5A'));
    const ink = fill('#30482A');
    // A tiny platformer: ground, a block, a hero, a coin
    c.drawRect(Skia.XYWHRect(0, 128, 192, 32), ink);
    c.drawRect(Skia.XYWHRect(110, 92, 26, 26), ink);
    c.drawRect(Skia.XYWHRect(40, 100, 16, 28), ink);
    c.drawCircle(150, 60, 7, ink);
    words(c, 'PRESS START', 18, 192, 14, '#30482A', FontWeight.Bold);
  });
  add(h, new THREE.PlaneGeometry(0.26, 0.22), lcd, [0, 0.17, 0.0715]);
  const dark = mat('#2B2C30', 0.6, 0.1);
  add(h, rbox(0.12, 0.04, 0.03, 0.01, 4), dark, [-0.12, -0.13, 0.065]);
  add(h, rbox(0.04, 0.12, 0.03, 0.01, 4), dark, [-0.12, -0.13, 0.065]);
  for (const [x, y] of [
    [0.09, -0.15],
    [0.16, -0.1],
  ])
    add(h, sphere(0.035, 16, 12), mat('#9C2F5A', 0.4, 0.18), [x, y, 0.06], [0, 0, 0], [1, 1, 0.5]);
  for (let i = 0; i < 4; i++)
    add(h, rbox(0.012, 0.09, 0.01, 0.005, 2), dark, [0.12 + i * 0.03, -0.32, 0.06], [0, 0, -0.5]);
  return g;
}

function instant() {
  const g = new THREE.Group();
  const body = mat('#9FD3C7', 0.45, 0.2);
  const white = mat('#F7F4EE', 0.4, 0.18);
  const black = mat('#1B1C1F', 0.4, 0.15);
  add(g, rbox(0.62, 0.52, 0.36, 0.09, 10), body, [0, 0.26, 0]);
  add(g, new THREE.CylinderGeometry(0.17, 0.18, 0.1, 48), white, [0, 0.24, 0.2], [Math.PI / 2, 0, 0]);
  add(g, new THREE.CylinderGeometry(0.12, 0.12, 0.06, 48), black, [0, 0.24, 0.26], [Math.PI / 2, 0, 0]);
  add(
    g,
    new THREE.CylinderGeometry(0.08, 0.08, 0.02, 48),
    mat('#22344A', 0.05, 0.4),
    [0, 0.24, 0.29],
    [Math.PI / 2, 0, 0]
  );
  add(g, rbox(0.16, 0.08, 0.02, 0.02, 4), white, [0.19, 0.44, 0.18]);
  add(g, rbox(0.08, 0.06, 0.02, 0.015, 4), black, [-0.2, 0.44, 0.18]);
  add(
    g,
    new THREE.CylinderGeometry(0.035, 0.035, 0.03, 20),
    mat('#F05A4F', 0.4, 0.2),
    [-0.22, 0.27, 0.18],
    [Math.PI / 2, 0, 0]
  );
  // A print half out of the top
  add(g, rbox(0.3, 0.2, 0.01, 0.005, 2), white, [0, 0.58, -0.04], [-0.1, 0, 0]);
  const shot = screen(128, 96, (c) => wallpaper(c, 128, 96, '#FFC48A', '#F27BA4', 'rgba(255,240,180,0.8)'));
  shot.colorNode = TSL.texture(shot.map!, TSL.uv()).rgb.mul(0.85);
  add(g, new THREE.PlaneGeometry(0.25, 0.13), shot, [0, 0.6, -0.033], [-0.1, 0, 0]);
  return g;
}

function laptop() {
  const g = new THREE.Group();
  const alu = mat('#CFD3D8', 0.28, 0.22);
  add(g, rbox(1.2, 0.04, 0.82, 0.03, 8), alu, [0, 0.02, 0]);
  add(g, rbox(1.04, 0.006, 0.36, 0.01, 4), mat('#2E3136', 0.6), [0, 0.042, -0.12]);
  add(g, rbox(0.42, 0.004, 0.24, 0.02, 4), mat('#C4C8CD', 0.2, 0.2), [0, 0.042, 0.24]);
  const lid = new THREE.Group();
  lid.position.set(0, 0.04, -0.4);
  lid.rotation.x = -0.32;
  g.add(lid);
  add(lid, rbox(1.2, 0.78, 0.03, 0.03, 8), alu, [0, 0.39, 0]);
  add(lid, new THREE.PlaneGeometry(1.14, 0.72), mat('#111215', 0.2, 0.1), [0, 0.39, 0.016]);
  const desk = screen(512, 320, (c) => {
    wallpaper(c, 512, 320, '#2B3A7A', '#C46AB7', 'rgba(255,170,120,0.6)');
    c.drawRect(Skia.XYWHRect(0, 0, 512, 14), fill('rgba(255,255,255,0.35)'));
    c.drawRRect(Skia.RRectXY(Skia.XYWHRect(150, 286, 212, 26), 9, 9), fill('rgba(255,255,255,0.3)'));
    const icons = ['#F05A4F', '#F2C230', '#4CC27A', '#4D8DF0', '#B66BF0', '#F0884D'];
    icons.forEach((h, i) => c.drawRRect(Skia.RRectXY(Skia.XYWHRect(160 + i * 33, 290, 22, 18), 5, 5), fill(h)));
    // A window
    c.drawRRect(Skia.RRectXY(Skia.XYWHRect(110, 60, 250, 170), 10, 10), fill('rgba(250,248,244,0.95)'));
    c.drawRect(Skia.XYWHRect(110, 60, 250, 22), fill('rgba(230,228,224,1)'));
    for (const [x, col] of [
      [124, '#F05A4F'],
      [138, '#F2C230'],
      [152, '#4CC27A'],
    ] as [number, string][])
      c.drawCircle(x, 71, 4, fill(col));
    for (let i = 0; i < 5; i++)
      c.drawRect(Skia.XYWHRect(128, 100 + i * 22, 140 + (i % 3) * 30, 8), fill('rgba(40,44,60,0.25)'));
  });
  add(lid, new THREE.PlaneGeometry(1.1, 0.68), desk, [0, 0.39, 0.017]);
  return g;
}

function tablet() {
  const g = new THREE.Group();
  const frame = mat('#2E3136', 0.3, 0.2);
  const t = new THREE.Group();
  t.rotation.x = -0.25;
  t.position.set(0, 0.36, 0.02);
  g.add(t);
  add(t, rbox(0.92, 0.66, 0.035, 0.05, 8), frame);
  const art = screen(512, 360, (c) => {
    c.drawRect(Skia.XYWHRect(0, 0, 512, 360), fill('#FBF6EE'));
    // A sketch in progress: a sun, hills, a few strokes, the brush palette
    c.drawCircle(370, 110, 52, fill('#F7B538'));
    c.drawOval(Skia.XYWHRect(-60, 220, 360, 220), fill('#7FB685'));
    c.drawOval(Skia.XYWHRect(180, 240, 420, 220), fill('#4F8F6A'));
    const stroke = fill('#E8735A');
    stroke.setStyle(PaintStyle.Stroke);
    stroke.setStrokeWidth(10);
    stroke.setStrokeCap(StrokeCap.Round);
    c.drawPath(Skia.PathBuilder.Make().moveTo(60, 90).quadTo(140, 40, 220, 100).detach(), stroke);
    c.drawRRect(Skia.RRectXY(Skia.XYWHRect(10, 10, 40, 200), 14, 14), fill('rgba(30,30,30,0.85)'));
    ['#E8735A', '#F7B538', '#4F8F6A', '#4D8DF0'].forEach((h, i) => c.drawCircle(30, 40 + i * 42, 11, fill(h)));
    const grain = Skia.Paint();
    grain.setShader(Skia.Shader.MakeFractalNoise(0.9, 0.9, 2, 3, 0, 0));
    grain.setBlendMode(BlendMode.Multiply);
    grain.setAlphaf(0.06);
    c.drawRect(Skia.XYWHRect(0, 0, 512, 360), grain);
  });
  add(t, new THREE.PlaneGeometry(0.86, 0.6), art, [0, 0, 0.0185]);
  // A pencil leaning on it, and the folio stand behind
  rod(g, [0.36, 0.02, 0.16], [0.47, 0.42, 0.04], 0.013, mat('#F7F4EE', 0.35, 0.2));
  const stand = mat('#8C6E54', 0.8, 0.1);
  add(g, rbox(0.8, 0.4, 0.02, 0.02, 4), stand, [0, 0.2, -0.16], [0.5, 0, 0]);
  add(g, rbox(0.9, 0.03, 0.2, 0.01, 4), stand, [0, 0.015, 0.06]);
  return g;
}

const BUILDERS: Record<Gadget, () => THREE.Object3D> = {
  headphones: () => buildProduct(0),
  filmCamera: () => buildProduct(2),
  lamp: () => buildProduct(8),
  watch,
  controller,
  speaker,
  keyboard,
  handheld,
  instant,
  laptop,
  tablet,
};

/** A gadget, built at its own scale (the caller fits it to where it goes) */
export function buildGadget(kind: Gadget) {
  return BUILDERS[kind]();
}

export type { Vec };
