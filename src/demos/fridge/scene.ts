import { FontWeight, Skia, TextAlign, type SkCanvas } from 'react-native-skia';
import * as TSL from 'three/tsl';
import * as THREE from 'three/webgpu';

import { buildProduct, fill, mat, rbox, rod, skiaTexture, sphere, studioLights } from '../sticker-cart/products3d';
import { buildStock, type Stock } from './items';

/**
 * A fridge that opens on the phone's own hinge. Folded, you see its door: notes and magnets, a
 * long chrome handle. Unfold the phone and the door swings round the fold, all the way open, so
 * its shelves of bottles and jars lie on the left half of the screen and the cabinet on the right;
 * the light flickers on and cold spills out over the bottom. What you bought waits in front of it,
 * and dragging a thing in sends it to where it belongs: milk to the door, mango to the crisper,
 * ice cream to the freezer.
 *
 * The fridge is cut to the screen, edge to edge: folded, its door is the whole cover screen;
 * unfolded, the inside of the door is the left half and the cabinet the right, the hinge on the
 * phone's fold. Units are fridge-sized: the cabinet is CW wide (whatever fills the screen), 2 tall
 * (y from -1 to 1) and CD deep, its opening at z = 0 with the hinge on the line x = 0.
 */

export type Zone = 'doorTop' | 'doorMid' | 'doorLow' | 'freezerDoor' | 'shelfTop' | 'shelfMid' | 'crisper' | 'freezer';
export type FridgeHaptic = 'swing' | 'pick' | 'store' | 'peek' | 'done' | 'shut';

export type FridgeEvents = {
  onHaptic: (kind: FridgeHaptic) => void;
  /** A bought thing put away */
  onStored: (product: number) => void;
  /** Where the thing in hand would go, while one's held */
  onTarget: (zone: Zone | null) => void;
  /** A thing in the fridge tapped: what to say about it */
  onPeek: (what: { title: string; note: string } | null) => void;
  /** The door's open far enough to see in, or not */
  onDoor: (open: boolean) => void;
};

export const ZONE_NAMES: Record<Zone, string> = {
  doorTop: 'the top of the door',
  doorMid: 'the door',
  doorLow: 'the bottom of the door',
  freezerDoor: 'the freezer door',
  shelfTop: 'the top shelf',
  shelfMid: 'the middle shelf',
  crisper: 'the crisper',
  freezer: 'the freezer',
};

/** Where each product goes, and how big it is in here (the width of its fitted sphere) */
const PRODUCT_HOME: Record<number, { zone: Zone; size: number }> = {
  3: { zone: 'shelfTop', size: 0.3 },
  11: { zone: 'crisper', size: 0.36 },
  12: { zone: 'doorLow', size: 0.4 },
  13: { zone: 'shelfMid', size: 0.46 },
  14: { zone: 'freezer', size: 0.32 },
  15: { zone: 'crisper', size: 0.26 },
};
export const fridgeFriendly = (product: number) => product in PRODUCT_HOME;

/** What's in already, zone by zone, left to right */
const STOCKED: { kind: Stock; zone: Zone; title: string; note: string }[] = [
  { kind: 'fishSauce', zone: 'doorTop', title: 'Fish sauce', note: 'Phú Quốc, 40° đạm. Goes in everything.' },
  { kind: 'chiliSauce', zone: 'doorTop', title: 'Tương ớt', note: 'For the phở. And the eggs. And the rice.' },
  { kind: 'pickles', zone: 'doorTop', title: 'Dưa món', note: 'Pickled since Tết. Still going.' },
  { kind: 'chili', zone: 'doorTop', title: 'Limes and chillies', note: 'For the fish sauce.' },
  { kind: 'water', zone: 'doorLow', title: 'Water', note: 'Boiled, cooled, in last year’s bottle.' },
  { kind: 'water', zone: 'doorLow', title: 'Water', note: 'The other bottle. Also last year’s.' },
  { kind: 'beer', zone: 'doorMid', title: 'Bia Sài Gòn', note: 'Dad’s. Do not touch.' },
  { kind: 'beer', zone: 'doorMid', title: 'Bia Sài Gòn', note: 'Also Dad’s.' },
  { kind: 'beer', zone: 'doorMid', title: 'Bia Sài Gòn', note: 'He counts them.' },
  { kind: 'beer', zone: 'doorMid', title: 'Bia Sài Gòn', note: 'He knows if one’s gone.' },
  { kind: 'yogurt', zone: 'doorMid', title: 'Sữa chua', note: 'The spare four.' },
  { kind: 'tub', zone: 'shelfTop', title: 'Chocolate ice cream?', note: '' },
  { kind: 'flan', zone: 'shelfTop', title: 'Bánh flan', note: 'Three. Count them before you take one.' },
  { kind: 'yogurt', zone: 'shelfTop', title: 'Sữa chua', note: 'One a day, after dinner.' },
  { kind: 'rice', zone: 'shelfMid', title: 'Last night’s rice', note: 'Cơm chiên tomorrow.' },
  { kind: 'tub', zone: 'shelfMid', title: 'Chocolate ice cream?', note: '' },
  { kind: 'greens', zone: 'crisper', title: 'Rau muống', note: 'Xào tỏi tonight.' },
  { kind: 'meat', zone: 'freezer', title: 'Pork', note: 'Frozen flat so it thaws fast. Clever.' },
  { kind: 'ice', zone: 'freezer', title: 'Ice', note: 'For the cà phê sữa đá.' },
  { kind: 'meat', zone: 'freezer', title: 'More pork', note: 'From the same trip to the market.' },
  { kind: 'ice', zone: 'freezerDoor', title: 'Ice', note: 'You can never have too much.' },
  { kind: 'ice', zone: 'freezerDoor', title: 'More ice', note: 'Summer in Sài Gòn.' },
  { kind: 'flan', zone: 'shelfMid', title: 'More bánh flan', note: 'Grandma’s batch. Hands off.' },
  { kind: 'pickles', zone: 'shelfMid', title: 'Củ kiệu', note: 'Left over from Tết.' },
  { kind: 'fishSauce', zone: 'doorLow', title: 'The good fish sauce', note: 'For guests only.' },
];

const CD = 0.95;
/** The door's thickness, and how far its bins stand off it */
const DT = 0.09;
const DB = 0.2;
/** Where the tall fridge door on top meets the short freezer door under it */
const SPLIT = -0.3;
/** The gap between the two doors */
const GAP = 0.018;
const FOV = 34;
/** The things in the fridge a little bigger than life, so they read on a phone */
const STOCK_SCALE = 1.75;
/** Glossy jade, like the old enamel fridges */
const JADE = '#3FA48B';
const LINER = '#CFD9D8';

type Shelf = { parent: 'cab' | 'door'; y: number; z: number; x0: number; x1: number; cursor: number };

type Thing = {
  /** Origin at the middle of its base */
  root: THREE.Group;
  product?: number;
  stock?: (typeof STOCKED)[number];
  zone: Zone;
  /** Swaying on the door as the phone tilts */
  lean: number;
};

type Flight = {
  thing: Thing;
  t: number;
  fromP: THREE.Vector3;
  fromQ: THREE.Quaternion;
  fromS: number;
  /** Where it ends up, in its new parent's space */
  toP: THREE.Vector3;
  toQ: THREE.Quaternion;
  toS: number;
  parent: THREE.Object3D;
};

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** A handwritten note on a sticky square */
function note(text: string, paper: string, ink: string) {
  return skiaTexture(256, 256, (c: SkCanvas) => {
    c.drawRect(Skia.XYWHRect(0, 0, 256, 256), fill(paper));
    c.drawRect(Skia.XYWHRect(0, 0, 256, 26), fill('rgba(0,0,0,0.06)'));
    const p = Skia.ParagraphBuilder.Make({ textAlign: TextAlign.Left })
      .pushStyle({
        fontSize: 26,
        fontFamilies: ['Noteworthy', 'Marker Felt', 'Helvetica Neue'],
        color: Skia.Color(ink),
        fontStyle: { weight: FontWeight.Bold },
      })
      .addText(text)
      .build();
    p.layout(216);
    p.paint(c, 22, 40);
  });
}

export function createFridgeScene(
  context: GPUCanvasContext & { present: () => void },
  device: GPUDevice,
  setup: { bought: number[]; stored: number[]; startOpen: boolean; wide: boolean },
  events: FridgeEvents
) {
  const canvas = context.canvas as unknown as {
    width: number;
    height: number;
    clientWidth: number;
    clientHeight: number;
  };
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  /** The height the screen shows, and the cabinet's width to fill it across */
  const FH = 2.06;
  const CW = setup.wide ? (FH * width) / height / 2 : (FH * width) / height;

  const renderer = new THREE.WebGPURenderer({
    antialias: true,
    alpha: false,
    canvas: context.canvas as HTMLCanvasElement,
    context,
    device,
  });
  renderer.setPixelRatio(1);
  renderer.setSize(canvas.width, canvas.height, false);
  THREE.ColorManagement.enabled = false;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  // Behind the door as it swings: the room in shadow
  renderer.setClearColor(new THREE.Color(0.3, 0.36, 0.34), 1);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, width / height, 0.05, 40);
  scene.add(camera);
  scene.add(studioLights());

  // ---- The cabinet ----
  const cab = new THREE.Group();
  scene.add(cab);
  const shell = mat(JADE, 0.26, 0.2);
  /** How far the light's come on, 0 to 1 */
  const lightLevel = TSL.uniform(0);
  /** A white plastic lining that glows a little with the light, the way a lit fridge does */
  const lit = (color: string, glow: number) => {
    const m = mat(color, 0.55, 0.05);
    const c = new THREE.Color(color);
    m.emissiveNode = TSL.vec3(c.r, c.g, c.b).mul(lightLevel.mul(glow));
    return m;
  };
  const liner = lit(LINER, 0.55);
  const linerFreezer = lit('#D3E2EA', 0.5);
  const T = 0.05;
  // Outside: two sides, top, bottom, back
  cab.add(new THREE.Mesh(rbox(T, 2.06, CD + 0.02, 0.02, 4), shell).translateX(T / 2).translateZ(-CD / 2));
  cab.add(new THREE.Mesh(rbox(T, 2.06, CD + 0.02, 0.02, 4), shell).translateX(CW - T / 2).translateZ(-CD / 2));
  cab.add(
    new THREE.Mesh(rbox(CW, T, CD + 0.02, 0.02, 4), shell)
      .translateY(1 + T / 2 - 0.02)
      .translateX(CW / 2)
      .translateZ(-CD / 2)
  );
  cab.add(
    new THREE.Mesh(rbox(CW, T, CD + 0.02, 0.02, 4), shell)
      .translateY(-1 - T / 2 + 0.02)
      .translateX(CW / 2)
      .translateZ(-CD / 2)
  );
  // Inside: the liner, back and walls, lit from the strip along the top
  const inside = (
    w: number,
    h: number,
    m: THREE.Material,
    at: [number, number, number],
    rot: [number, number, number]
  ) => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
    mesh.position.set(...at);
    mesh.rotation.set(...rot);
    cab.add(mesh);
  };
  const IW = CW - 2 * T;
  /** The fridge's two glass shelves, and the freezer's wire one */
  const SHELVES = [0.62, 0.22];
  const WIRE = -0.62;
  const midX = CW / 2;
  inside(IW, 1 - SPLIT - T, liner, [midX, (1 - T + SPLIT) / 2, -CD + 0.005], [0, 0, 0]);
  inside(IW, SPLIT + 1 - T, linerFreezer, [midX, (SPLIT - 1 + T) / 2, -CD + 0.005], [0, 0, 0]);
  // The walls a shade darker than the back, so the box reads as deep
  const wallM = lit('#B3C2C1', 0.32);
  inside(CD, 2 - 2 * T, wallM, [T + 0.002, 0, -CD / 2], [0, Math.PI / 2, 0]);
  inside(CD, 2 - 2 * T, wallM, [CW - T - 0.002, 0, -CD / 2], [0, -Math.PI / 2, 0]);
  inside(IW, CD, liner, [midX, 1 - T - 0.002, -CD / 2], [Math.PI / 2, 0, 0]);
  inside(IW, CD, linerFreezer, [midX, -1 + T + 0.002, -CD / 2], [-Math.PI / 2, 0, 0]);
  // The divider between fridge and freezer, white plastic with a mint lip
  cab.add(
    new THREE.Mesh(rbox(IW, 0.07, CD, 0.02, 4), liner)
      .translateX(midX)
      .translateY(SPLIT)
      .translateZ(-CD / 2)
  );
  cab.add(new THREE.Mesh(rbox(IW, 0.07, 0.02, 0.01, 3), shell).translateX(midX).translateY(SPLIT).translateZ(-0.01));
  // Glass shelves, their front edges catching the light
  const glass = new THREE.MeshStandardNodeMaterial({
    color: '#E6F4F8',
    roughness: 0.08,
    metalness: 0,
    transparent: true,
    opacity: 0.3,
    depthWrite: false,
  });
  const trim = mat('#DCE6E8', 0.35, 0.2);
  for (const y of SHELVES) {
    cab.add(
      new THREE.Mesh(rbox(IW - 0.01, 0.014, CD - 0.08, 0.006, 3), glass)
        .translateX(midX)
        .translateY(y)
        .translateZ(-CD / 2 - 0.02)
    );
    cab.add(
      new THREE.Mesh(rbox(IW - 0.01, 0.028, 0.022, 0.01, 3), trim).translateX(midX).translateY(y).translateZ(-0.07)
    );
  }
  // The crisper drawer's clear front, frosted, with a pull along its top
  const frosted = new THREE.MeshStandardNodeMaterial({
    color: '#E9F6EE',
    roughness: 0.3,
    metalness: 0,
    transparent: true,
    opacity: 0.32,
    depthWrite: false,
  });
  cab.add(
    new THREE.Mesh(rbox(IW - 0.04, 0.07, 0.016, 0.02, 4), frosted)
      .translateX(midX)
      .translateY(SPLIT + 0.075)
      .translateZ(-0.08)
  );
  cab.add(
    new THREE.Mesh(rbox(IW - 0.04, 0.03, 0.03, 0.012, 3), trim)
      .translateX(midX)
      .translateY(SPLIT + 0.115)
      .translateZ(-0.075)
  );
  // The freezer's wire shelf
  const wire = mat('#E4ECEF', 0.3, 0.18);
  for (let k = 0; k <= 12; k++) {
    const z = -0.1 - (k / 12) * (CD - 0.2);
    rod(cab, [T, WIRE, z], [CW - T, WIRE, z], 0.005, wire);
  }
  rod(cab, [T, WIRE + 0.002, -0.1], [CW - T, WIRE + 0.002, -0.1], 0.01, wire);
  // The light strips, and the lights they cast
  const ledM = new THREE.MeshBasicNodeMaterial();
  ledM.colorNode = TSL.mix(TSL.vec3(0.55, 0.58, 0.6), TSL.vec3(1.0, 1.0, 1.0), lightLevel);
  for (const y of [1 - T - 0.03, SPLIT - 0.06]) {
    const strip = new THREE.Mesh(rbox(IW * 0.7, 0.018, 0.04, 0.008, 3), ledM);
    strip.position.set(midX, y, -0.12);
    cab.add(strip);
  }
  // A strip under the front of each shelf, and the pool of light it throws on the back wall
  const poolM = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  {
    const uv = TSL.uv();
    const fall = TSL.smoothstep(0.0, 0.5, uv.y.oneMinus())
      .oneMinus()
      .mul(TSL.smoothstep(0.0, 0.15, uv.x).mul(TSL.smoothstep(1.0, 0.85, uv.x)));
    poolM.colorNode = TSL.vec3(1.0, 1.0, 0.98);
    poolM.opacityNode = fall.mul(lightLevel).mul(0.32);
  }
  for (const y of [...SHELVES, SPLIT + 0.115, WIRE]) {
    cab.add(
      new THREE.Mesh(rbox(IW * 0.9, 0.008, 0.012, 0.004, 2), ledM)
        .translateX(midX)
        .translateY(y - 0.02)
        .translateZ(-0.08)
    );
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(IW, 0.3), poolM);
    pool.position.set(midX, y - 0.17, -CD + 0.01);
    cab.add(pool);
  }
  const lamps = [new THREE.PointLight('#F4FBFF', 0, 0, 1.4), new THREE.PointLight('#EAF6FF', 0, 0, 1.4)];
  lamps[0].position.set(midX, 0.85, -0.15);
  lamps[1].position.set(midX, SPLIT - 0.12, -0.15);
  cab.add(...lamps);

  // ---- The door, hinged on x = 0 ----
  const doorPivot = new THREE.Group();
  scene.add(doorPivot);
  const door = new THREE.Group();
  doorPivot.add(door);
  {
    // Two doors on the one hinge: the fridge's tall one on top, the freezer's short one under it, a
    // dark gap between them. +x, -x, +y, -y, +z (outside), -z (inside)
    const doorLiner = lit('#E4ECEB', 0.42);
    const fridgeTop = SPLIT - GAP / 2;
    const freezerBottom = SPLIT + GAP / 2;
    const slab = (y0: number, y1: number) =>
      door.add(
        new THREE.Mesh(rbox(CW, y1 - y0, DT, 0.035, 6), [shell, shell, shell, shell, shell, doorLiner])
          .translateX(CW / 2)
          .translateY((y0 + y1) / 2)
          .translateZ(DT / 2)
      );
    slab(-1.03, fridgeTop);
    slab(freezerBottom, 1.03);
    door.add(
      new THREE.Mesh(rbox(CW - 0.01, GAP + 0.004, DT * 0.8, 0.004, 2), mat('#143D33', 0.9, 0))
        .translateX(CW / 2)
        .translateY(SPLIT)
        .translateZ(DT * 0.45)
    );
    // The gaskets round the inside of each
    const gasket = mat('#C9D2D4', 0.8, 0.04);
    const seal = (y0: number, y1: number) => {
      for (const [w, h, x, y] of [
        [CW - 0.04, 0.03, CW / 2, y1 - 0.03],
        [CW - 0.04, 0.03, CW / 2, y0 + 0.03],
        [0.03, y1 - y0 - 0.06, 0.035, (y0 + y1) / 2],
        [0.03, y1 - y0 - 0.06, CW - 0.035, (y0 + y1) / 2],
      ])
        door.add(new THREE.Mesh(rbox(w, h, 0.02, 0.01, 3), gasket).translateX(x).translateY(y).translateZ(-0.008));
    };
    seal(-1.03, fridgeTop);
    seal(freezerBottom, 1.03);
    // A handle for each, brass bars on posts near the opening edge
    const chrome = mat('#D9B46A', 0.22, 0.35);
    const hx = CW - 0.1;
    const handle = (y0: number, y1: number) => {
      rod(door, [hx, y0, DT + 0.065], [hx, y1, DT + 0.065], 0.02, chrome);
      rod(door, [hx, y0 + 0.03, DT], [hx, y0 + 0.03, DT + 0.065], 0.014, chrome);
      rod(door, [hx, y1 - 0.03, DT], [hx, y1 - 0.03, DT + 0.065], 0.014, chrome);
    };
    handle(SPLIT + 0.12, SPLIT + 0.66);
    handle(SPLIT - 0.4, SPLIT - 0.08);
    // A tear-off calendar hung on the door, open at today
    {
      const now = new Date();
      const days = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
      const page = skiaTexture(256, 320, (c: SkCanvas) => {
        c.drawRect(Skia.XYWHRect(0, 0, 256, 320), fill('#FBF7EE'));
        c.drawRect(Skia.XYWHRect(0, 0, 256, 54), fill('#C8352B'));
        c.drawRect(Skia.XYWHRect(0, 314, 256, 6), fill('rgba(0,0,0,0.08)'));
        const line = (text: string, y: number, size: number, color: string, weight: FontWeight) => {
          const p = Skia.ParagraphBuilder.Make({ textAlign: TextAlign.Center })
            .pushStyle({
              fontSize: size,
              fontFamilies: ['Helvetica Neue'],
              color: Skia.Color(color),
              fontStyle: { weight },
            })
            .addText(text)
            .build();
          p.layout(256);
          p.paint(c, 0, y);
        };
        line(`THÁNG ${now.getMonth() + 1} · ${now.getFullYear()}`, 12, 24, '#FFFFFF', FontWeight.Bold);
        line(String(now.getDate()), 58, 150, '#C8352B', FontWeight.Black);
        line(days[now.getDay()], 236, 34, '#2B2622', FontWeight.Bold);
      });
      const cal = new THREE.Group();
      cal.position.set(CW * 0.52, 0.66, DT + 0.004);
      cal.rotation.z = 0.04;
      door.add(cal);
      // A few torn stubs under the top page, then the page itself, and the nail it hangs from
      const stub = mat('#EFE8DA', 0.85, 0.05);
      cal.add(new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.25), stub).translateY(-0.004).translateZ(-0.001));
      const pm = new THREE.MeshStandardNodeMaterial({ map: page, roughness: 0.85, metalness: 0 });
      cal.add(new THREE.Mesh(new THREE.PlaneGeometry(0.19, 0.24), pm).translateZ(0.002));
      cal.add(new THREE.Mesh(sphere(0.012, 16, 12), chrome).translateY(0.135).translateZ(0.006));
    }
    // A marker hanging on the door for the shopping list
    rod(door, [CW * 0.76, 0.5, DT + 0.02], [CW * 0.76, 0.7, DT + 0.02], 0.014, mat('#F4F4F2', 0.4, 0.14));
    rod(door, [CW * 0.76, 0.66, DT + 0.02], [CW * 0.76, 0.72, DT + 0.02], 0.016, mat('#F28C1E', 0.35, 0.16));
    // Notes held on by magnets
    const notes: [string, string, string, number, number, number, number][] = [
      ['Đi chợ:\n– trứng\n– sữa tươi\n– xoài\n– kem dừa', '#FFE98A', '#3A3020', CW * 0.3, 0.36, -0.06, 0.34],
      ['Kem trong tủ là CÁ KHO nha.\n– Mẹ', '#FFF3B0', '#5A3A10', CW * 0.66, 0.02, 0.07, 0.3],
      ['Thứ 7 nhớ\nrã đông thịt!!', '#FFC9D6', '#6A1F2F', CW * 0.66, -0.66, 0.05, 0.28],
    ];
    for (const [text, paper, ink, x, y, turn, size] of notes) {
      const m = new THREE.MeshStandardNodeMaterial({ map: note(text, paper, ink), roughness: 0.85, metalness: 0 });
      const n = new THREE.Mesh(new THREE.PlaneGeometry(size, size), m);
      n.position.set(x, y, DT + 0.003);
      n.rotation.z = turn;
      door.add(n);
    }
    const magnet = (x: number, y: number, color: string, r = 0.035) => {
      const g = new THREE.Mesh(sphere(r, 24, 16), mat(color, 0.35, 0.2));
      g.position.set(x, y, DT + 0.012);
      g.scale.set(1, 1, 0.55);
      door.add(g);
    };
    magnet(CW * 0.3, 0.52, '#F4C430');
    magnet(CW * 0.66, 0.16, '#4FA3E0');
    magnet(CW * 0.66, -0.53, '#FFFFFF');
    magnet(CW * 0.18, 0.0, '#7CC46A', 0.045);
    magnet(CW * 0.2, 0.84, '#F28CB1', 0.04);
    magnet(CW * 0.34, 0.86, '#F4C430', 0.03);
    // Inside: the bins
    const binM = mat('#F1F5F6', 0.4, 0.14);
    const lip = new THREE.MeshStandardNodeMaterial({
      color: '#E4F2F4',
      roughness: 0.1,
      metalness: 0,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    });
    for (const y of [0.66, 0.28, -0.14, -0.84]) {
      door.add(
        new THREE.Mesh(rbox(CW - 0.14, 0.014, DB, 0.006, 3), binM)
          .translateX(CW / 2)
          .translateY(y - 0.007)
          .translateZ(-DB / 2)
      );
      door.add(
        new THREE.Mesh(rbox(CW - 0.14, 0.09, 0.012, 0.006, 3), lip)
          .translateX(CW / 2)
          .translateY(y + 0.04)
          .translateZ(-DB + 0.006)
      );
      for (const x of [0.07, CW - 0.07])
        door.add(
          new THREE.Mesh(rbox(0.012, 0.09, DB, 0.004, 2), lip)
            .translateX(x)
            .translateY(y + 0.04)
            .translateZ(-DB / 2)
        );
    }
  }

  // ---- What's in it ----
  const shelves: Record<Zone, Shelf> = {
    doorTop: { parent: 'door', y: 0.66, z: -DB / 2, x0: 0.1, x1: CW - 0.1, cursor: 0.1 },
    doorMid: { parent: 'door', y: 0.28, z: -DB / 2, x0: 0.1, x1: CW - 0.1, cursor: 0.1 },
    doorLow: { parent: 'door', y: -0.14, z: -DB / 2, x0: 0.1, x1: CW - 0.1, cursor: 0.1 },
    freezerDoor: { parent: 'door', y: -0.84, z: -DB / 2, x0: 0.1, x1: CW - 0.1, cursor: 0.1 },
    shelfTop: { parent: 'cab', y: 0.627, z: -0.42, x0: T + 0.06, x1: CW - T - 0.06, cursor: T + 0.06 },
    shelfMid: { parent: 'cab', y: 0.227, z: -0.4, x0: T + 0.06, x1: CW - T - 0.06, cursor: T + 0.06 },
    crisper: { parent: 'cab', y: SPLIT + 0.036, z: -0.4, x0: T + 0.08, x1: CW - T - 0.08, cursor: T + 0.08 },
    freezer: { parent: 'cab', y: WIRE + 0.008, z: -0.42, x0: T + 0.06, x1: CW - T - 0.06, cursor: T + 0.06 },
  };
  const things: Thing[] = [];

  /** A thing on a little stand of its own: centred, its base on its origin, turned to show itself */
  const wrap = (model: THREE.Object3D, yaw: number) => {
    const turn = new THREE.Group();
    turn.add(model);
    turn.rotation.y = yaw;
    turn.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(turn);
    const c = box.getCenter(new THREE.Vector3());
    turn.position.set(-c.x, -box.min.y, -c.z);
    const root = new THREE.Group();
    root.add(turn);
    return { root, width: box.max.x - box.min.x };
  };
  const productModel = (product: number) => {
    const m = buildProduct(product);
    m.scale.setScalar(PRODUCT_HOME[product]?.size ?? 0.3);
    return m;
  };

  /** The next spot along a shelf, in its parent's space, and how it's turned there */
  const spotOn = (zone: Zone, widthOf: number) => {
    const s = shelves[zone];
    if (s.cursor + widthOf > s.x1 + 0.02) return null;
    const x = s.cursor + widthOf / 2;
    s.cursor += widthOf + 0.035;
    // On the door the inside faces -z
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, s.parent === 'door' ? Math.PI : 0, 0));
    return { pos: new THREE.Vector3(x, s.y, s.z), quat: q, parent: s.parent === 'door' ? door : cab };
  };
  /** Somewhere it'll fit, its own shelf first */
  const findSpot = (zone: Zone, widthOf: number) => {
    // Folded, the open door is off the screen, so what's put away goes in the cabinet
    const order = (
      [zone, 'shelfMid', 'shelfTop', 'doorMid', 'crisper', 'freezer', 'doorTop', 'freezerDoor'] as Zone[]
    ).filter((z) => setup.wide || shelves[z].parent === 'cab');
    for (const z of order) {
      const spot = spotOn(z, widthOf);
      if (spot) return { ...spot, zone: z };
    }
    return null;
  };

  // What was bought and put away already
  for (const product of setup.stored) {
    const home = PRODUCT_HOME[product];
    if (!home) continue;
    const { root, width: w } = wrap(productModel(product), -0.3);
    const spot = findSpot(home.zone, w);
    if (!spot) continue;
    root.position.copy(spot.pos);
    root.quaternion.copy(spot.quat);
    spot.parent.add(root);
    things.push({ root, product, zone: spot.zone, lean: 0 });
  }

  // ---- What you've just bought, waiting in front ----
  // Each keeps its place on its shelf from the start, so what's in already never crowds it out
  const tray = new THREE.Group();
  scene.add(tray);
  type Spot = NonNullable<ReturnType<typeof findSpot>>;
  const waiting: { thing: Thing; width: number; home: THREE.Vector3; at: number; spot: Spot }[] = [];
  setup.bought.forEach((product) => {
    const home = PRODUCT_HOME[product];
    if (!home) return;
    const { root, width: w } = wrap(productModel(product), -0.35);
    const spot = findSpot(home.zone, w);
    if (!spot) return;
    tray.add(root);
    waiting.push({
      thing: { root, product, zone: spot.zone, lean: 0 },
      width: w,
      home: new THREE.Vector3(),
      at: -1,
      spot,
    });
  });
  // Then what's in already, where there's room
  for (const s of STOCKED) {
    const { root, width: w } = wrap(buildStock(s.kind), -0.25);
    const scale = shelves[s.zone].parent === 'door' ? STOCK_SCALE * 0.75 : STOCK_SCALE;
    root.scale.setScalar(scale);
    const at = spotOn(s.zone, w * scale);
    if (!at) continue;
    const spot = { ...at, zone: s.zone };
    root.position.copy(spot.pos);
    root.quaternion.copy(spot.quat);
    spot.parent.add(root);
    things.push({ root, stock: s, zone: spot.zone, lean: 0 });
  }

  const layTray = () => {
    const n = waiting.length;
    const gap = 0.07;
    const total = waiting.reduce((sum, w) => sum + w.width, 0) + gap * Math.max(0, n - 1);
    let x = -total / 2;
    for (const w of waiting) {
      w.home.set(x + w.width / 2, -0.8, 0.62);
      x += w.width + gap;
    }
  };
  layTray();
  waiting.forEach((w) => w.thing.root.position.copy(w.home));

  // The glow behind the shelf a held thing will go to
  const haloM = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const haloLevel = TSL.uniform(0);
  {
    const uv = TSL.uv().sub(0.5).mul(TSL.vec2(2, 2));
    const soft = TSL.smoothstep(1.0, 0.3, TSL.length(uv.mul(TSL.vec2(0.9, 1.4))));
    haloM.colorNode = TSL.vec3(0.45, 0.85, 0.7);
    haloM.opacityNode = soft.mul(haloLevel).mul(0.55);
  }
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), haloM);
  halo.renderOrder = 5;
  halo.visible = false;

  // ---- Cold spilling out as it opens ----
  const fogM = (alpha: THREE.Node<'float'>) => {
    const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
    const uv = TSL.uv().sub(0.5).mul(2);
    m.colorNode = TSL.vec3(0.97, 0.99, 1.0);
    m.opacityNode = TSL.smoothstep(1.0, 0.0, TSL.length(uv))
      .mul(
        TSL.mx_noise_float(TSL.vec3(uv.mul(2.2), TSL.time.mul(0.3)))
          .mul(0.35)
          .add(0.65)
      )
      .mul(alpha);
    return m;
  };
  const puffs = Array.from({ length: 16 }, () => {
    const alpha = TSL.uniform(0);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), fogM(alpha));
    mesh.renderOrder = 6;
    mesh.visible = false;
    scene.add(mesh);
    return { mesh, alpha, v: new THREE.Vector3(), age: 9, life: 2.6 };
  });
  const spill = () => {
    puffs.forEach((p, i) => {
      p.age = -i * 0.05;
      p.life = 2.2 + Math.random() * 0.8;
      p.mesh.position.set(0.1 + Math.random() * (CW - 0.2), -0.95 + Math.random() * 0.75, 0.05);
      p.v.set((Math.random() - 0.3) * 0.08, -0.08 - Math.random() * 0.06, 0.18 + Math.random() * 0.12);
    });
  };

  // ---- State ----
  let angle = setup.startOpen ? Math.PI : 0;
  let tween: { from: number; to: number; t: number; dur: number } | null = null;
  let light = setup.startOpen ? 1 : 0;
  let lightT = setup.startOpen ? 9 : -1;
  let wasOpen = setup.startOpen;
  let held: (typeof waiting)[number] | null = null;
  let doorDrag: { a0: number; x0: number } | null = null;
  let press = { x: 0, y: 0, t: 0, moved: false };
  let target: Zone | null = null;
  const flights: Flight[] = [];
  let peeked: { thing: Thing; t: number } | null = null;
  let clock = 0;
  const tilt = new THREE.Vector2();
  const tiltGoal = new THREE.Vector2();

  const swingTo = (to: number, dur: number) => {
    tween = { from: angle, to, t: 0, dur };
    if (to > angle) events.onHaptic('swing');
  };
  // Unfolding the phone opens the door: it's caught finishing its swing
  if (setup.startOpen === false && setup.wide) {
    angle = Math.PI * 0.62;
    swingTo(Math.PI, 0.9);
  }

  // ---- Camera ----
  // Straight on, far enough back that the front of the fridge fills the screen top to bottom: both
  // halves unfolded, the cabinet (and the door shut over it) folded
  const half = ((FOV / 2) * Math.PI) / 180;
  camera.position.set(setup.wide ? 0 : CW / 2, 0, FH / 2 / Math.tan(half) + (setup.wide ? 0 : DT * 0.6));
  camera.lookAt(camera.position.x, 0, 0);

  // ---- Touch ----
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const tmp = new THREE.Vector3();
  const aim = (x: number, y: number) => {
    ndc.set((x / width) * 2 - 1, -(y / height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
  };
  /** Where the finger's ray meets the plane z = `at` */
  const onPlane = (at: number) => {
    const d = ray.ray.direction;
    if (Math.abs(d.z) < 1e-4) return null;
    const t = (at - ray.ray.origin.z) / d.z;
    return t > 0 ? tmp.copy(ray.ray.origin).addScaledVector(d, t) : null;
  };
  const owner = (o: THREE.Object3D | null, roots: THREE.Object3D[]) => {
    while (o && !roots.includes(o)) o = o.parent;
    return o;
  };
  const isOpen = () => angle > Math.PI * 0.6;

  const send = (w: (typeof waiting)[number]) => {
    const { spot } = w;
    waiting.splice(waiting.indexOf(w), 1);
    layTray();
    const root = w.thing.root;
    root.updateMatrixWorld(true);
    flights.push({
      thing: { ...w.thing, zone: spot.zone },
      t: 0,
      fromP: root.getWorldPosition(new THREE.Vector3()),
      fromQ: root.getWorldQuaternion(new THREE.Quaternion()),
      fromS: root.scale.x,
      toP: spot.pos,
      toQ: spot.quat,
      toS: 1,
      parent: spot.parent,
    });
    scene.attach(root);
  };

  const touch = (kind: 'start' | 'move' | 'end', x: number, y: number) => {
    aim(x, y);
    if (kind === 'start') {
      press = { x, y, t: clock, moved: false };
      if (!isOpen()) {
        doorDrag = { a0: angle, x0: x };
        tween = null;
        return;
      }
      const hit = ray.intersectObjects(
        waiting.map((w) => w.thing.root),
        true
      )[0];
      const root = hit
        ? owner(
            hit.object,
            waiting.map((w) => w.thing.root)
          )
        : null;
      held = root ? (waiting.find((w) => w.thing.root === root) ?? null) : null;
      if (held) {
        target = held.thing.zone;
        events.onTarget(target);
        events.onHaptic('pick');
      }
      return;
    }
    if (Math.hypot(x - press.x, y - press.y) > 8) press.moved = true;
    const tap = kind === 'end' && !press.moved && clock - press.t < 0.4;

    if (doorDrag) {
      // Pulled by the handle, toward you and round to the left
      angle = Math.max(0, Math.min(Math.PI, doorDrag.a0 + ((doorDrag.x0 - x) / width) * Math.PI * 1.4));
      if (kind === 'end') {
        swingTo(tap || angle > 0.55 ? Math.PI : 0, 0.9);
        doorDrag = null;
      }
      return;
    }

    if (held) {
      const p = onPlane(0.55);
      if (kind === 'move' && p) held.thing.root.position.lerp(p.setY(p.y - 0.08), 0.6);
      if (kind === 'end') {
        send(held);
        held = null;
        target = null;
        events.onTarget(null);
      }
      return;
    }

    if (tap) {
      const roots = things.map((t) => t.root);
      const hit = ray.intersectObjects(roots, true)[0];
      const root = hit ? owner(hit.object, roots) : null;
      const thing = root ? things.find((t) => t.root === root) : undefined;
      if (thing) {
        peeked = { thing, t: 0 };
        events.onHaptic('peek');
        if (thing.stock?.kind === 'tub')
          events.onPeek({ title: 'It’s cá kho.', note: 'The ice cream ran out in 2019. The tub stayed.' });
        else if (thing.stock) events.onPeek({ title: thing.stock.title, note: thing.stock.note });
        else if (thing.product !== undefined)
          events.onPeek({ title: 'Just bought', note: 'Put away where it belongs.' });
      } else events.onPeek(null);
    }
  };

  // ---- Frame ----
  let last = performance.now();
  let warmed = false;
  let onFirstFrame: (() => void) | null = null;
  const qa = new THREE.Quaternion();
  const pa = new THREE.Vector3();

  const step = (dt: number) => {
    clock += dt;

    // The door
    if (tween) {
      tween.t = Math.min(1, tween.t + dt / tween.dur);
      angle = tween.from + (tween.to - tween.from) * easeInOut(tween.t);
      if (tween.t >= 1) tween = null;
    }
    doorPivot.rotation.y = -angle;
    const nowOpen = angle > 0.35;
    if (nowOpen !== wasOpen) {
      wasOpen = nowOpen;
      events.onDoor(nowOpen);
      if (nowOpen) {
        lightT = 0;
        spill();
      } else {
        lightT = -1;
        events.onHaptic('shut');
      }
    }
    // The light, flickering on as the door comes away
    if (lightT >= 0) {
      lightT += dt;
      const k = lightT;
      light = k < 0.06 ? 0.7 : k < 0.12 ? 0.15 : k < 0.2 ? 0.85 : k < 0.25 ? 0.4 : Math.min(1, 0.85 + (k - 0.25));
    } else light = Math.max(0, light - dt * 4);
    lightLevel.value = light;
    lamps[0].intensity = 0.9 * light;
    lamps[1].intensity = 0.6 * light;

    // Cold rolling out over the bottom
    for (const p of puffs) {
      p.age += dt;
      if (p.age < 0 || p.age > p.life) {
        p.mesh.visible = false;
        continue;
      }
      const t = p.age / p.life;
      p.mesh.visible = true;
      p.mesh.position.addScaledVector(p.v, dt);
      p.v.multiplyScalar(1 - dt * 0.6);
      p.mesh.scale.setScalar(0.35 + t * 0.9);
      p.mesh.quaternion.copy(camera.quaternion);
      p.alpha.value = Math.sin(Math.min(1, t * 3) * Math.PI * 0.5) * (1 - t) * 0.42;
    }

    // What's waiting, rising into view once the door's open
    const showTray = isOpen() ? 1 : 0;
    waiting.forEach((w, k) => {
      if (w === held) {
        w.thing.root.scale.setScalar(THREE.MathUtils.lerp(w.thing.root.scale.x, 1.12, dt * 10));
        return;
      }
      if (showTray && w.at < 0) w.at = clock + 0.5 + k * 0.08;
      const rise = w.at < 0 ? 0 : easeInOut(Math.min(1, Math.max(0, (clock - w.at) / 0.6)));
      w.thing.root.position.lerp(tmp.copy(w.home).setY(w.home.y - (1 - rise) * 0.5), Math.min(1, dt * 9));
      w.thing.root.scale.setScalar(THREE.MathUtils.lerp(w.thing.root.scale.x, 0.001 + rise, Math.min(1, dt * 12)));
      w.thing.root.rotation.y = Math.sin(clock * 0.8 + k) * 0.12;
    });

    // The glow where the held thing will go
    haloLevel.value += ((held ? 1 : 0) - haloLevel.value) * Math.min(1, dt * 8);
    if (held && target) {
      const s = shelves[target];
      const parent = s.parent === 'door' ? door : cab;
      if (halo.parent !== parent) parent.add(halo);
      halo.visible = true;
      halo.position.set((s.x0 + s.x1) / 2, s.y + 0.16, s.parent === 'door' ? -0.02 : -CD + 0.02);
      halo.rotation.set(0, s.parent === 'door' ? Math.PI : 0, 0);
      halo.scale.set(s.x1 - s.x0 + 0.1, 0.42, 1);
    } else if (haloLevel.value < 0.01) halo.visible = false;

    // Things flying to their shelves
    for (let i = flights.length - 1; i >= 0; i--) {
      const f = flights[i];
      f.t = Math.min(1, f.t + dt / 0.75);
      const e = easeInOut(f.t);
      f.parent.updateMatrixWorld(true);
      pa.copy(f.toP);
      f.parent.localToWorld(pa);
      f.parent.getWorldQuaternion(qa).multiply(f.toQ);
      const root = f.thing.root;
      root.position.lerpVectors(f.fromP, pa, e);
      root.position.y += Math.sin(e * Math.PI) * 0.22;
      root.quaternion.slerpQuaternions(f.fromQ, qa, e);
      root.scale.setScalar(THREE.MathUtils.lerp(f.fromS, f.toS, e));
      if (f.t >= 1) {
        f.parent.attach(root);
        root.position.copy(f.toP);
        root.quaternion.copy(f.toQ);
        root.scale.setScalar(1);
        flights.splice(i, 1);
        things.push(f.thing);
        events.onHaptic('store');
        if (f.thing.product !== undefined) events.onStored(f.thing.product);
        if (waiting.length === 0 && flights.length === 0) events.onHaptic('done');
      }
    }

    // A tapped thing lifts a little and settles; the tub's lid comes up on the cá kho
    if (peeked) {
      peeked.t += dt;
      const k = peeked.t;
      const lift = k < 2.6 ? Math.sin(Math.min(1, k / 0.25) * Math.PI * 0.5) : Math.max(0, 1 - (k - 2.6) / 0.3);
      const turn = peeked.thing.root.children[0];
      turn.position.y = (turn.userData.y0 ??= turn.position.y) + lift * 0.035;
      const lid = peeked.thing.stock?.kind === 'tub' ? turn.getObjectByName('lid') : undefined;
      if (lid) {
        lid.position.y = 0.085 + lift * 0.05;
        lid.position.x = lift * 0.03;
        lid.rotation.z = -lift * 0.55;
      }
      if (k > 2.9) peeked = null;
    }

    // Bottles on the door leaning a little as the phone tilts
    tilt.lerp(tiltGoal, Math.min(1, dt * 3));
    for (const t of things) {
      if (t.root.parent !== door) continue;
      t.lean += (tilt.x * 0.07 - t.lean) * Math.min(1, dt * (2 + (t.root.position.x % 0.3) * 6));
      // On the thing's own stand, so it leans without losing which way it faces
      t.root.children[0].rotation.z = t.lean;
    }
  };

  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    try {
      step(dt);
    } catch (e) {
      if (__DEV__) console.error('[fridge]', e);
    }
    if (!warmed) {
      warmed = true;
      halo.visible = true;
      puffs.forEach((p) => (p.mesh.visible = true));
      renderer.render(scene, camera);
      halo.visible = false;
      puffs.forEach((p) => (p.mesh.visible = false));
    }
    renderer.render(scene, camera);
    context.present();
    if (onFirstFrame) {
      const cb = onFirstFrame;
      onFirstFrame = null;
      cb();
    }
  });

  return {
    touch,
    setTilt(x: number, y: number) {
      tiltGoal.set(x, y);
    },
    /** Open or shut the door, as the phone unfolds or folds */
    swing(open: boolean) {
      swingTo(open ? Math.PI : 0, open ? 1.25 : 0.7);
    },
    /** Dev: send everything waiting in */
    putAllAway() {
      [...waiting].forEach(send);
    },
    debug() {
      return { angle, waiting: waiting.length, flights: flights.length, things: things.length, light };
    },
    onFirstFrame(cb: () => void) {
      onFirstFrame = cb;
    },
    dispose() {
      renderer.setAnimationLoop(null);
      renderer.dispose();
    },
  };
}

export type FridgeScene = ReturnType<typeof createFridgeScene>;
