import { BlendMode, FontWeight, Skia, TextAlign, type SkCanvas } from 'react-native-skia';
import * as TSL from 'three/tsl';
import * as THREE from 'three/webgpu';

import { add, fill, hex, mat, painted, rbox, rod, skiaTexture, type V3 } from '../sticker-cart/products3d';

/**
 * Home's own things, the ones you don't buy: the display on its riser and the little desktop
 * computer under it, and the plants. Built like the gadgets (rounded, soft, lit by the room), each
 * at its own scale for the caller to fit; the display's screen is lit and drawn with Skia.
 */

/** A lit screen: drawn, and shown at full brightness whatever the light */
function screen(w: number, h: number, draw: (c: SkCanvas) => void, gain = 0.95) {
  const m = new THREE.MeshBasicNodeMaterial({ map: skiaTexture(w, h, draw) });
  m.colorNode = TSL.texture(m.map!, TSL.uv()).rgb.mul(gain);
  return m;
}

function label(
  c: SkCanvas,
  text: string,
  x: number,
  y: number,
  size: number,
  color: string,
  weight = FontWeight.Medium
) {
  const p = Skia.ParagraphBuilder.Make({ textAlign: TextAlign.Left })
    .pushStyle({ fontSize: size, fontFamilies: ['Helvetica Neue'], color: Skia.Color(color), fontStyle: { weight } })
    .addText(text)
    .build();
  p.layout(1000);
  p.paint(c, x, y);
}

/** The display's desktop: a dusk wallpaper, the menu bar, a photos window, the dock */
function desktop(c: SkCanvas, W: number, H: number) {
  const sky = Skia.Paint();
  sky.setShader(
    Skia.Shader.MakeLinearGradient(
      { x: 0, y: 0 },
      { x: W * 0.3, y: H },
      [Skia.Color('#1E2A6E'), Skia.Color('#7A3E8E'), Skia.Color('#F08A5D')],
      [0, 0.55, 1],
      0
    )
  );
  c.drawRect(Skia.XYWHRect(0, 0, W, H), sky);
  const soft = fill('rgba(255,190,120,0.55)');
  soft.setMaskFilter(Skia.MaskFilter.MakeBlur(0, 80, true));
  c.drawCircle(W * 0.78, H * 0.72, 220, soft);
  const soft2 = fill('rgba(120,170,255,0.45)');
  soft2.setMaskFilter(Skia.MaskFilter.MakeBlur(0, 90, true));
  c.drawCircle(W * 0.18, H * 0.2, 240, soft2);
  // Hills along the bottom, the way a landscape wallpaper has them
  const hill = fill('rgba(40,22,60,0.55)');
  c.drawOval(Skia.XYWHRect(-200, H * 0.7, W * 0.9, H * 0.7), hill);
  c.drawOval(Skia.XYWHRect(W * 0.4, H * 0.76, W * 0.9, H * 0.7), fill('rgba(30,16,48,0.6)'));

  // Menu bar
  c.drawRect(Skia.XYWHRect(0, 0, W, 26), fill('rgba(255,255,255,0.18)'));
  label(c, '●  Photos   File   Edit   View   Window', 16, 5, 13, 'rgba(255,255,255,0.92)');
  label(c, 'Thu 9 Oct  9:41 PM', W - 150, 5, 13, 'rgba(255,255,255,0.92)');

  // A photos window full of instant prints
  const wx = 150;
  const wy = 70;
  const ww = 560;
  const wh = 360;
  const shadow = fill('rgba(0,0,0,0.35)');
  shadow.setMaskFilter(Skia.MaskFilter.MakeBlur(0, 18, true));
  c.drawRRect(Skia.RRectXY(Skia.XYWHRect(wx, wy + 10, ww, wh), 14, 14), shadow);
  c.drawRRect(Skia.RRectXY(Skia.XYWHRect(wx, wy, ww, wh), 14, 14), fill('rgba(248,246,242,0.97)'));
  for (const [i, col] of ['#FF5F57', '#FEBC2E', '#28C840'].entries())
    c.drawCircle(wx + 20 + i * 18, wy + 18, 6, fill(col));
  label(c, 'Prints', wx + 80, wy + 9, 14, '#2B2B2E', FontWeight.Bold);
  const tones = ['#F4B183', '#9CC7E8', '#F6D46B', '#B5D99C', '#E8735A', '#C8A2E8', '#7FD1C2', '#F29FB5'];
  for (let k = 0; k < 8; k++) {
    const col = k % 4;
    const row = Math.floor(k / 4);
    const x = wx + 26 + col * 132;
    const y = wy + 48 + row * 152;
    c.drawRRect(Skia.RRectXY(Skia.XYWHRect(x, y, 116, 140), 4, 4), fill('#FFFFFF'));
    const ph = Skia.Paint();
    ph.setShader(
      Skia.Shader.MakeLinearGradient(
        { x, y },
        { x: x + 100, y: y + 110 },
        [Skia.Color(tones[k]), Skia.Color(tones[(k + 3) % 8])],
        null,
        0
      )
    );
    c.drawRect(Skia.XYWHRect(x + 7, y + 7, 102, 104), ph);
  }
  // A widget: the day's date
  c.drawRRect(Skia.RRectXY(Skia.XYWHRect(W - 200, 70, 170, 170), 26, 26), fill('rgba(255,255,255,0.22)'));
  label(c, 'THURSDAY', W - 180, 88, 15, '#FF7A6B', FontWeight.Bold);
  label(c, '9', W - 182, 104, 92, '#FFFFFF', FontWeight.Bold);
  label(c, 'Unpack · 9:45', W - 180, 210, 13, 'rgba(255,255,255,0.85)');

  // The dock
  const dw = 520;
  const dx = (W - dw) / 2;
  c.drawRRect(Skia.RRectXY(Skia.XYWHRect(dx, H - 70, dw, 60), 18, 18), fill('rgba(255,255,255,0.24)'));
  const apps = ['#3D8BFD', '#34C759', '#FF9F0A', '#FF375F', '#BF5AF2', '#64D2FF', '#FFD60A', '#8E8E93', '#FF6B3D'];
  apps.forEach((col, i) => {
    const ax = dx + 14 + i * 56;
    const g = Skia.Paint();
    g.setShader(
      Skia.Shader.MakeLinearGradient(
        { x: ax, y: H - 62 },
        { x: ax, y: H - 18 },
        [Skia.Color(col), Skia.Color('rgba(0,0,0,0.25)')],
        [0.55, 1.6],
        0
      )
    );
    c.drawRRect(Skia.RRectXY(Skia.XYWHRect(ax, H - 62, 44, 44), 11, 11), g);
  });
  const vignette = Skia.Paint();
  vignette.setShader(Skia.Shader.MakeFractalNoise(0.9, 0.9, 2, 3, 0, 0));
  vignette.setBlendMode(BlendMode.Overlay);
  vignette.setAlphaf(0.05);
  c.drawRect(Skia.XYWHRect(0, 0, W, H), vignette);
}

/**
 * A 27-inch display on its aluminium stand: a thin slab, black glass round the picture, the
 * stand a single bent sheet. Width about 1 unit; it stands on y = 0.
 */
export function display() {
  const g = new THREE.Group();
  const alu = mat('#D3D6DA', 0.28, 0.2);
  const W = 1.0;
  const H = 0.58;
  const lift = 0.3;
  // The stand: a foot, then a blade rising back at a slant
  add(g, rbox(0.3, 0.014, 0.24, 0.007, 4), alu, [0, 0.007, -0.02]);
  add(g, rbox(0.24, 0.42, 0.016, 0.008, 4), alu, [0, 0.21, -0.11], [-0.18, 0, 0]);
  // The panel
  const panel = new THREE.Group();
  panel.position.set(0, lift + H / 2, -0.05);
  panel.rotation.x = -0.05;
  g.add(panel);
  add(panel, rbox(W, H, 0.028, 0.012, 6), alu);
  add(panel, new THREE.PlaneGeometry(W - 0.012, H - 0.012), mat('#08090B', 0.08, 0.2), [0, 0, 0.0145]);
  const pic = screen(1024, 594, (c) => desktop(c, 1024, 594));
  add(panel, new THREE.PlaneGeometry(W - 0.05, H - 0.05), pic, [0, 0.0, 0.0152]);
  return g;
}

/**
 * The little desktop computer: a low aluminium square with softly rounded corners, two ports and
 * a light on the front. About 0.5 across, standing on y = 0.
 */
export function miniComputer() {
  const g = new THREE.Group();
  const alu = mat('#CED1D5', 0.3, 0.2);
  const S = 0.5;
  const s = new THREE.Shape();
  const r = 0.09;
  s.moveTo(-S / 2 + r, -S / 2);
  s.lineTo(S / 2 - r, -S / 2);
  s.quadraticCurveTo(S / 2, -S / 2, S / 2, -S / 2 + r);
  s.lineTo(S / 2, S / 2 - r);
  s.quadraticCurveTo(S / 2, S / 2, S / 2 - r, S / 2);
  s.lineTo(-S / 2 + r, S / 2);
  s.quadraticCurveTo(-S / 2, S / 2, -S / 2, S / 2 - r);
  s.lineTo(-S / 2, -S / 2 + r);
  s.quadraticCurveTo(-S / 2, -S / 2, -S / 2 + r, -S / 2);
  const body = new THREE.ExtrudeGeometry(s, {
    depth: 0.1,
    bevelEnabled: true,
    bevelThickness: 0.012,
    bevelSize: 0.012,
    bevelSegments: 4,
    curveSegments: 16,
  });
  body.rotateX(-Math.PI / 2);
  body.translate(0, 0.012, 0);
  add(g, body, alu);
  // A dark foot ring, two ports and a jack, the light
  add(g, new THREE.CylinderGeometry(0.2, 0.2, 0.012, 48), mat('#2B2C2F', 0.6), [0, 0.006, 0]);
  const port = mat('#16171A', 0.5);
  for (const x of [-0.16, -0.11]) add(g, rbox(0.03, 0.012, 0.01, 0.005, 2), port, [x, 0.06, S / 2 + 0.011]);
  add(g, new THREE.CircleGeometry(0.008, 16), port, [-0.06, 0.06, S / 2 + 0.013]);
  const led = new THREE.MeshBasicNodeMaterial();
  led.colorNode = TSL.vec3(1.2, 1.2, 1.15);
  add(g, new THREE.CircleGeometry(0.006, 12), led, [0.2, 0.06, S / 2 + 0.013]);
  return g;
}

/** Leafy green, mottled: deep green and a paler variegation, by the leaf's own position */
function leafMat(a: string, b: string, side: THREE.Side = THREE.DoubleSide) {
  const p = TSL.positionLocal;
  const n = TSL.mx_noise_float(p.mul(24)).mul(0.5).add(0.5);
  return painted(TSL.mix(hex(a), hex(b), TSL.smoothstep(0.55, 0.8, n)) as unknown as V3, 0.55, 0.1, side);
}

/** A heart-shaped leaf, its point at +y, its stalk end at the origin */
function heartLeaf(size: number) {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.bezierCurveTo(-0.55 * size, -0.1 * size, -0.6 * size, 0.55 * size, 0, size);
  s.bezierCurveTo(0.6 * size, 0.55 * size, 0.55 * size, -0.1 * size, 0, 0);
  const g = new THREE.ShapeGeometry(s, 10);
  // Cupped a little along its midrib
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) pos.setZ(i, Math.abs(pos.getX(i)) * 0.35);
  g.computeVertexNormals();
  return g;
}

/** A glazed pot, turned, standing on y = 0 */
function pot(r: number, h: number, color: string) {
  const g = new THREE.Group();
  const lathe = new THREE.LatheGeometry(
    [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(r * 0.78, 0),
      new THREE.Vector2(r * 0.86, 0.02),
      new THREE.Vector2(r, h * 0.92),
      new THREE.Vector2(r * 1.04, h),
      new THREE.Vector2(r * 0.94, h),
      new THREE.Vector2(r * 0.9, h * 0.94),
    ],
    40
  );
  add(g, lathe, mat(color, 0.35, 0.16));
  add(g, new THREE.CircleGeometry(r * 0.9, 32), mat('#3A2A1E', 0.95), [0, h * 0.9, 0], [-Math.PI / 2, 0, 0]);
  return g;
}

/**
 * A pothos in a white pot, its vines trailing over the edge of whatever it stands on: down the
 * front and off to one side, heart-shaped leaves all along. About 0.3 across at the pot.
 */
export function pothos() {
  const g = new THREE.Group();
  const h = 0.2;
  g.add(pot(0.13, h, '#F2EEE6'));
  const leaf = leafMat('#2F7D3A', '#C9DB72');
  const stem = mat('#4E7A33', 0.7);
  const geo = heartLeaf(0.085);
  // Vines: out over the rim, then down, swaying
  const vines: [number, number, number][] = [
    [0.4, 0.9, 0.12],
    [-0.5, 0.75, 0.16],
    [1.4, 0.6, 0.05],
    [0.1, 0.5, 0.2],
    [-1.2, 0.45, 0.08],
  ];
  let seed = 3;
  const rand = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  for (const [dir, len, out] of vines) {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 12; i++) {
      const k = i / 12;
      const reach = 0.1 + out * Math.min(1, k * 3);
      pts.push(
        new THREE.Vector3(
          Math.sin(dir) * reach + Math.sin(k * 5 + dir) * 0.03,
          h + 0.03 - Math.max(0, k - 0.15) * len,
          Math.cos(dir) * reach
        )
      );
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    add(g, new THREE.TubeGeometry(curve, 40, 0.005, 5), stem);
    const n = Math.round(len * 16);
    for (let i = 1; i <= n; i++) {
      const at = curve.getPointAt(i / (n + 1));
      const l = new THREE.Mesh(geo, leaf);
      l.position.copy(at);
      l.rotation.set(-1.0 + rand() * 0.8, dir + (rand() - 0.5) * 2.2, (rand() - 0.5) * 1.6 + Math.PI);
      l.scale.setScalar(0.65 + rand() * 0.55);
      g.add(l);
    }
  }
  // A crown of leaves on top
  for (let i = 0; i < 9; i++) {
    const l = new THREE.Mesh(geo, leaf);
    const a = (i / 9) * Math.PI * 2;
    l.position.set(Math.sin(a) * 0.05, h + 0.02, Math.cos(a) * 0.05);
    l.rotation.set(-0.6 - rand() * 0.4, a, 0);
    l.scale.setScalar(0.9 + rand() * 0.4);
    g.add(l);
  }
  return g;
}

/** A rosette succulent in a terracotta pot: fat pointed leaves in a spiral, blushing at the tips */
export function succulent() {
  const g = new THREE.Group();
  const h = 0.12;
  g.add(pot(0.1, h, '#C8693F'));
  const p = TSL.positionLocal;
  const tipBlush = TSL.smoothstep(0.02, 0.06, p.z);
  const leaf = painted(TSL.mix(hex('#9CC4A8'), hex('#E3A3A8'), tipBlush) as unknown as V3, 0.5, 0.16);
  const geo = new THREE.SphereGeometry(0.035, 16, 10);
  geo.scale(0.75, 0.32, 1.6);
  geo.translate(0, 0, 0.045);
  const rings = [
    [11, 0.2, 1.0],
    [8, 0.55, 0.8],
    [5, 0.95, 0.6],
  ];
  rings.forEach(([n, tilt, s], r) => {
    for (let i = 0; i < n; i++) {
      const l = new THREE.Mesh(geo, leaf);
      l.position.set(0, h + 0.01 + r * 0.012, 0);
      l.rotation.set(-tilt, (i / n) * Math.PI * 2 + r * 0.4, 0, 'YXZ');
      l.scale.setScalar(s);
      g.add(l);
    }
  });
  return g;
}

/** A snake plant in a tall white pot: upright sword leaves, banded dark and light, a gold edge */
export function snakePlant() {
  const g = new THREE.Group();
  const h = 0.36;
  g.add(pot(0.16, h, '#EDE8DF'));
  const p = TSL.positionLocal;
  const band = TSL.sin(p.y.mul(70).add(TSL.mx_noise_float(p.mul(30)).mul(2.5)))
    .mul(0.5)
    .add(0.5);
  const leaf = painted(TSL.mix(hex('#1F4A2C'), hex('#6E9A55'), band.mul(0.55)) as unknown as V3, 0.45, 0.14);
  let seed = 7;
  const rand = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  for (let i = 0; i < 8; i++) {
    const tall = 0.5 + rand() * 0.4;
    const s = new THREE.Shape();
    const w = 0.045 + rand() * 0.02;
    s.moveTo(-w * 0.6, 0);
    s.bezierCurveTo(-w * 1.2, tall * 0.4, -w * 0.8, tall * 0.8, 0, tall);
    s.bezierCurveTo(w * 0.8, tall * 0.8, w * 1.2, tall * 0.4, w * 0.6, 0);
    s.lineTo(-w * 0.6, 0);
    const geo = new THREE.ExtrudeGeometry(s, { depth: 0.008, bevelEnabled: false, curveSegments: 10 });
    const m = new THREE.Mesh(geo, leaf);
    const a = (i / 8) * Math.PI * 2 + rand() * 0.6;
    m.position.set(Math.sin(a) * 0.05, h - 0.02, Math.cos(a) * 0.05);
    m.rotation.set(Math.cos(a) * (0.1 + rand() * 0.18), a, Math.sin(a) * -(0.1 + rand() * 0.18), 'YXZ');
    g.add(m);
  }
  return g;
}

/** A monitor riser: a plank on two legs, a little computer underneath fits */
export function riser(wood: THREE.Material, w: number, d: number, h: number) {
  const g = new THREE.Group();
  add(g, rbox(w, 0.03, d, 0.008, 4), wood, [0, h - 0.015, 0]);
  for (const x of [-w / 2 + 0.03, w / 2 - 0.03])
    add(g, rbox(0.03, h - 0.03, d, 0.008, 4), wood, [x, (h - 0.03) / 2, 0]);
  rod(g, [-w / 2 + 0.05, 0.02, -d / 2 + 0.03], [w / 2 - 0.05, 0.02, -d / 2 + 0.03], 0.006, mat('#2A2B2E', 0.6));
  return g;
}
