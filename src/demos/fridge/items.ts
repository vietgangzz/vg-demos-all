import { FontWeight, Skia } from 'react-native-skia';
import * as TSL from 'three/tsl';
import * as THREE from 'three/webgpu';

import {
  add,
  fill,
  hex,
  mat,
  painted,
  rbox,
  rim,
  skiaTexture,
  sphere,
  textured,
  words,
  type V3,
} from '../sticker-cart/products3d';

/**
 * What's already in a Vietnamese family's fridge: the water bottle that's been refilled for a year,
 * fish sauce, a jar of pickles, flan, last night's rice under cling film, and the ice cream tub
 * that hasn't held ice cream since the day it was finished. Built like the shop's products, in
 * real proportions (metres-ish, a 1.5 l bottle about 0.33 tall), standing on y = 0.
 */

export type Stock =
  | 'water'
  | 'fishSauce'
  | 'pickles'
  | 'flan'
  | 'rice'
  | 'tub'
  | 'meat'
  | 'ice'
  | 'chili'
  | 'yogurt'
  | 'beer'
  | 'chiliSauce'
  | 'greens';

const { mix, smoothstep } = TSL;

/** Clear, lightly tinted plastic or glass */
function clear(color: string, opacity: number) {
  const m = new THREE.MeshStandardNodeMaterial({
    color,
    roughness: 0.12,
    metalness: 0,
    transparent: true,
    opacity,
    depthWrite: false,
  });
  m.emissiveNode = rim(0.35);
  return m;
}

/** A lathe from a profile of [radius, height] points */
function turned(points: [number, number][], segments = 40) {
  return new THREE.LatheGeometry(
    points.map(([r, y]) => new THREE.Vector2(r, y)),
    segments
  );
}

function water() {
  const g = new THREE.Group();
  // A 1.5 l bottle with its label long gone, a strip of masking tape saying what's in it now
  const profile: [number, number][] = [
    [0.0, 0.0],
    [0.034, 0.0],
    [0.042, 0.008],
    [0.043, 0.2],
    [0.04, 0.235],
    [0.024, 0.27],
    [0.016, 0.285],
    [0.016, 0.3],
  ];
  add(g, turned(profile), clear('#DDEFF7', 0.42));
  // The water inside, a little below the shoulder
  add(g, turned(profile.slice(0, 4).map(([r, y]) => [r * 0.94, Math.min(y, 0.19)])), clear('#BFE3F2', 0.5));
  add(g, new THREE.CylinderGeometry(0.018, 0.018, 0.022, 24), mat('#2F7FD0', 0.4, 0.14), [0, 0.31, 0]);
  const tape = skiaTexture(256, 64, (c) => {
    c.drawRect(Skia.XYWHRect(0, 0, 256, 64), fill('#EFE3C2'));
    words(c, 'nước sôi để nguội', 14, 256, 26, '#2B4A8A', FontWeight.Medium);
  });
  const tapeM = new THREE.MeshStandardNodeMaterial({ map: tape, roughness: 0.8, metalness: 0 });
  add(g, new THREE.CylinderGeometry(0.0445, 0.0445, 0.03, 32, 1, true, -0.9, 1.8), tapeM, [0, 0.13, 0]);
  return g;
}

function fishSauce() {
  const g = new THREE.Group();
  const glass = painted(
    mix(hex('#7A3A12'), hex('#C0661F'), smoothstep(0.0, 0.2, TSL.positionLocal.y)) as unknown as V3,
    0.15,
    0.3
  );
  add(
    g,
    turned([
      [0.0, 0.0],
      [0.03, 0.0],
      [0.032, 0.006],
      [0.032, 0.17],
      [0.02, 0.21],
      [0.012, 0.23],
      [0.012, 0.25],
    ]),
    glass
  );
  add(g, new THREE.CylinderGeometry(0.014, 0.014, 0.025, 20), mat('#D12A2A', 0.4, 0.14), [0, 0.26, 0]);
  const label = skiaTexture(256, 128, (c) => {
    c.drawRect(Skia.XYWHRect(0, 0, 256, 128), fill('#F6E7C4'));
    c.drawRect(Skia.XYWHRect(0, 0, 256, 18), fill('#C0251F'));
    c.drawRect(Skia.XYWHRect(0, 110, 256, 18), fill('#C0251F'));
    words(c, 'NƯỚC MẮM', 30, 256, 30, '#7A1A12', FontWeight.Black);
    words(c, 'Phú Quốc · 40 độ đạm', 72, 256, 18, '#7A1A12', FontWeight.Bold);
  });
  const labelM = new THREE.MeshStandardNodeMaterial({ map: label, roughness: 0.6, metalness: 0 });
  add(g, new THREE.CylinderGeometry(0.0325, 0.0325, 0.07, 32, 1, true, -1.2, 2.4), labelM, [0, 0.09, 0]);
  return g;
}

function pickles() {
  const g = new THREE.Group();
  // A glass jar of dưa món: carrot, kohlrabi and papaya in brine, a red lid
  const r = 0.06;
  add(
    g,
    turned([
      [0, 0],
      [r, 0],
      [r + 0.004, 0.01],
      [r + 0.004, 0.12],
      [r - 0.008, 0.135],
      [r - 0.008, 0.145],
    ]),
    clear('#F2F7EE', 0.3)
  );
  const q = TSL.positionLocal;
  const bits = TSL.mx_noise_float(q.mul(70));
  const veg = mix(hex('#F08A2E'), hex('#F3E3B0'), smoothstep(-0.1, 0.25, bits));
  add(
    g,
    new THREE.CylinderGeometry(r - 0.004, r - 0.004, 0.11, 32),
    painted(veg as unknown as V3, 0.4, 0.14),
    [0, 0.062, 0]
  );
  add(g, new THREE.CylinderGeometry(r - 0.004, r - 0.004, 0.026, 32), mat('#D6332C', 0.45, 0.14), [0, 0.155, 0]);
  return g;
}

function flan() {
  const g = new THREE.Group();
  // Three little cups of bánh flan, caramel on top, under a sheet of cling film
  const cup = clear('#F4F2EE', 0.35);
  const custard = mat('#F6D27A', 0.35, 0.16);
  const caramel = mat('#8A4A16', 0.25, 0.22);
  for (let k = 0; k < 3; k++) {
    const x = (k - 1) * 0.085;
    add(g, new THREE.CylinderGeometry(0.038, 0.03, 0.05, 28), cup, [x, 0.025, 0]);
    add(g, new THREE.CylinderGeometry(0.034, 0.028, 0.04, 28), custard, [x, 0.022, 0]);
    add(g, new THREE.CylinderGeometry(0.034, 0.034, 0.006, 28), caramel, [x, 0.044, 0]);
  }
  return g;
}

function rice() {
  const g = new THREE.Group();
  // Last night's rice in a blue-and-white bowl, cling film stretched over the top
  const bowl = new THREE.MeshStandardNodeMaterial({ roughness: 0.25, metalness: 0 });
  const q = TSL.positionLocal;
  bowl.colorNode = mix(hex('#FBFBF8'), hex('#2F5DA8'), smoothstep(0.035, 0.03, q.y).mul(smoothstep(0.022, 0.026, q.y)));
  bowl.emissiveNode = rim(0.2);
  bowl.side = THREE.DoubleSide;
  add(
    g,
    turned([
      [0.0, 0.0],
      [0.035, 0.0],
      [0.04, 0.008],
      [0.075, 0.045],
      [0.082, 0.06],
    ]),
    bowl
  );
  add(
    g,
    sphere(0.072, 32, 16),
    painted(textured('#FAF8F2', 160, 0.12), 0.8, 0.1),
    [0, 0.04, 0],
    [0, 0, 0],
    [1, 0.42, 1]
  );
  add(g, new THREE.CircleGeometry(0.084, 40), clear('#FFFFFF', 0.25), [0, 0.061, 0], [-Math.PI / 2, 0, 0]);
  return g;
}

/** The ice cream tub; its lid is its own group so it can be lifted to show the cá kho inside */
function tub() {
  const g = new THREE.Group();
  const band = skiaTexture(512, 128, (c) => {
    c.drawRect(Skia.XYWHRect(0, 0, 512, 128), fill('#FFFFFF'));
    c.drawRect(Skia.XYWHRect(0, 0, 512, 34), fill('#E2403A'));
    words(c, 'KEM SÔ-CÔ-LA', 46, 512, 40, '#6B3A1E', FontWeight.Black);
    words(c, 'hộp gia đình 1 lít', 92, 512, 22, '#9A6B4A', FontWeight.Medium);
  });
  const side = new THREE.MeshStandardNodeMaterial({ map: band, roughness: 0.4, metalness: 0 });
  side.emissiveNode = rim(0.14);
  const plain = mat('#FFFFFF', 0.4, 0.12);
  add(g, new THREE.CylinderGeometry(0.075, 0.062, 0.085, 40), [side, plain, plain], [0, 0.0425, 0]);
  // Inside: pieces of fish braised in caramel, and their sauce
  add(g, new THREE.CylinderGeometry(0.07, 0.07, 0.004, 40), mat('#5A2A0E', 0.2, 0.2), [0, 0.07, 0]);
  const fish = mat('#7A3A14', 0.35, 0.18);
  for (const [x, z, a] of [
    [-0.025, 0.01, 0.4],
    [0.025, -0.01, -0.6],
    [0.0, 0.03, 1.2],
  ])
    add(g, rbox(0.05, 0.022, 0.032, 0.01, 4), fish, [x, 0.08, z], [0, a, 0.1]);
  const lid = new THREE.Group();
  lid.name = 'lid';
  lid.position.set(0, 0.085, 0);
  const lidTop = skiaTexture(256, 256, (c) => {
    c.drawCircle(128, 128, 128, fill('#E2403A'));
    c.drawCircle(128, 128, 104, fill('#6B3A1E'));
    words(c, 'KEM', 96, 256, 50, '#FFFFFF', FontWeight.Black);
  });
  const lidM = new THREE.MeshStandardNodeMaterial({ map: lidTop, roughness: 0.35, metalness: 0 });
  add(
    lid,
    new THREE.CylinderGeometry(0.08, 0.078, 0.014, 40),
    [mat('#E2403A', 0.35, 0.14), lidM, plain],
    [0.0, 0.007, 0]
  );
  g.add(lid);
  return g;
}

function meat() {
  const g = new THREE.Group();
  // Pork from the market, frozen flat in a zip bag, frosted over
  const q = TSL.positionLocal;
  const pork = mix(hex('#D9837E'), hex('#F3DCD3'), smoothstep(-0.2, 0.3, TSL.mx_noise_float(q.mul(40))));
  const frost = mix(pork, hex('#FFFFFF'), 0.28);
  add(g, rbox(0.2, 0.035, 0.13, 0.015, 6), painted(frost as unknown as V3, 0.7, 0.2), [0, 0.0175, 0]);
  add(g, rbox(0.22, 0.04, 0.15, 0.018, 6), clear('#F4FBFF', 0.3), [0, 0.02, 0]);
  add(g, rbox(0.22, 0.008, 0.012, 0.004, 2), mat('#3C7FD6', 0.4), [0, 0.04, 0.06]);
  return g;
}

function ice() {
  const g = new THREE.Group();
  // A blue tray of ice cubes
  add(g, rbox(0.2, 0.03, 0.09, 0.01, 4), mat('#7FB6E8', 0.35, 0.18), [0, 0.015, 0]);
  const cube = clear('#EAF6FF', 0.75);
  for (let r = 0; r < 2; r++)
    for (let k = 0; k < 5; k++)
      add(g, rbox(0.03, 0.026, 0.03, 0.007, 3), cube, [-0.072 + k * 0.036, 0.034, -0.02 + r * 0.04]);
  return g;
}

function chili() {
  const g = new THREE.Group();
  // A saucer of limes and red chillies
  add(g, new THREE.CylinderGeometry(0.075, 0.06, 0.012, 32), mat('#F7F4EE', 0.3, 0.16), [0, 0.006, 0]);
  const lime = mat('#7FB842', 0.4, 0.16);
  add(g, sphere(0.024, 24, 16), lime, [-0.025, 0.034, 0.01]);
  add(g, sphere(0.024, 24, 16), lime, [0.02, 0.034, -0.02]);
  const red = mat('#D8231C', 0.25, 0.22);
  for (const [x, z, a] of [
    [0.03, 0.03, 0.3],
    [-0.01, -0.035, -0.5],
  ]) {
    const c = new THREE.ConeGeometry(0.008, 0.07, 12);
    c.rotateZ(Math.PI / 2);
    add(g, c, red, [x, 0.022, z], [0, a, 0]);
  }
  return g;
}

function yogurt() {
  const g = new THREE.Group();
  // A four-pack of sữa chua cups, foil lids, two up two down
  const band = skiaTexture(256, 128, (c) => {
    c.drawRect(Skia.XYWHRect(0, 0, 256, 128), fill('#FFFFFF'));
    c.drawRect(Skia.XYWHRect(0, 84, 256, 44), fill('#2F6FD6'));
    words(c, 'SỮA CHUA', 22, 256, 34, '#2F6FD6', FontWeight.Black);
  });
  const side = new THREE.MeshStandardNodeMaterial({ map: band, roughness: 0.4, metalness: 0 });
  side.emissiveNode = rim(0.14);
  const foil = mat('#D9DEE6', 0.25, 0.3);
  const plain = mat('#FFFFFF', 0.4, 0.1);
  for (let r = 0; r < 2; r++)
    for (let k = 0; k < 2; k++) {
      const at: [number, number, number] = [(k - 0.5) * 0.074, 0, (r - 0.5) * 0.074];
      add(g, new THREE.CylinderGeometry(0.035, 0.03, 0.06, 28), [side, plain, plain], [at[0], 0.03, at[2]]);
      add(g, new THREE.CylinderGeometry(0.036, 0.036, 0.004, 28), foil, [at[0], 0.062, at[2]]);
    }
  return g;
}

function beer() {
  const g = new THREE.Group();
  // A can of beer, green and gold
  const band = skiaTexture(256, 256, (c) => {
    c.drawRect(Skia.XYWHRect(0, 0, 256, 256), fill('#1F6B3A'));
    c.drawRect(Skia.XYWHRect(0, 96, 256, 64), fill('#F2D27A'));
    words(c, 'BIA', 40, 256, 40, '#F2D27A', FontWeight.Black);
    words(c, 'SÀI GÒN', 108, 256, 34, '#1F6B3A', FontWeight.Black);
  });
  const side = new THREE.MeshStandardNodeMaterial({ map: band, roughness: 0.3, metalness: 0.3 });
  side.emissiveNode = rim(0.18);
  const alu = mat('#D5D9DD', 0.25, 0.3);
  add(g, new THREE.CylinderGeometry(0.033, 0.033, 0.11, 32), [side, alu, alu], [0, 0.06, 0]);
  add(g, new THREE.CylinderGeometry(0.027, 0.033, 0.012, 32), alu, [0, 0.121, 0]);
  add(g, new THREE.CylinderGeometry(0.03, 0.026, 0.008, 32), alu, [0, 0.004, 0]);
  return g;
}

function chiliSauce() {
  const g = new THREE.Group();
  // A squeezy bottle of tương ớt, red with a green cap
  const sauce = mat('#C9231B', 0.25, 0.25);
  add(
    g,
    turned([
      [0.0, 0.0],
      [0.03, 0.0],
      [0.034, 0.01],
      [0.034, 0.13],
      [0.024, 0.16],
      [0.012, 0.17],
    ]),
    sauce
  );
  add(g, new THREE.CylinderGeometry(0.014, 0.018, 0.035, 20), mat('#2F8A3E', 0.4, 0.14), [0, 0.185, 0]);
  const label = skiaTexture(256, 128, (c) => {
    c.drawRect(Skia.XYWHRect(0, 0, 256, 128), fill('#FFF4D6'));
    words(c, 'TƯƠNG ỚT', 30, 256, 34, '#B11E16', FontWeight.Black);
    words(c, 'cay vừa', 76, 256, 20, '#2F8A3E', FontWeight.Bold);
  });
  const labelM = new THREE.MeshStandardNodeMaterial({ map: label, roughness: 0.6, metalness: 0 });
  add(g, new THREE.CylinderGeometry(0.0345, 0.0345, 0.06, 32, 1, true, -1.1, 2.2), labelM, [0, 0.075, 0]);
  return g;
}

function greens() {
  const g = new THREE.Group();
  // A bundle of rau muống tied with a strip of bamboo, leaves fanning from the stems
  const stem = mat('#9CC46A', 0.5, 0.14);
  const leaf = mat('#3E8E3A', 0.5, 0.16);
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * Math.PI * 2;
    const r = 0.012 + (k % 3) * 0.006;
    const z = Math.sin(a) * r;
    const y = Math.cos(a) * r + 0.025;
    const len = 0.26 + (k % 4) * 0.02;
    const s = new THREE.CylinderGeometry(0.006, 0.006, len, 8);
    s.rotateZ(Math.PI / 2);
    add(g, s, stem, [0, y, z]);
    for (let j = 0; j < 3; j++) {
      const x = len / 2 - 0.02 - j * 0.04;
      add(
        g,
        sphere(0.03, 12, 8),
        leaf,
        [x, y + 0.012, z + (j % 2 ? 0.015 : -0.015)],
        [0, (k + j) * 0.7, 0],
        [1, 0.25, 0.45]
      );
    }
  }
  add(g, new THREE.TorusGeometry(0.03, 0.005, 8, 24), mat('#C9A46A', 0.7), [-0.04, 0.025, 0], [0, Math.PI / 2, 0]);
  return g;
}

const BUILD: Record<Stock, () => THREE.Group> = {
  water,
  fishSauce,
  pickles,
  flan,
  rice,
  tub,
  meat,
  ice,
  chili,
  yogurt,
  beer,
  chiliSauce,
  greens,
};

export function buildStock(kind: Stock) {
  return BUILD[kind]();
}
