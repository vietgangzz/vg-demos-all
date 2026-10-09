import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import * as TSL from 'three/tsl';
import * as THREE from 'three/webgpu';

import { buildProduct } from '../sticker-cart/products3d';
import {
  awningTexture,
  bagTexture,
  catTexture,
  counterTexture,
  crateTexture,
  floorTexture,
  glassTexture,
  hangSignTexture,
  loadCardboard,
  loadFonts,
  matTexture,
  neonTexture,
  planksTexture,
  plateTexture,
  posterTexture,
  screenTexture,
  signTexture,
  skyTexture,
  tagTexture,
} from './art';
import { buildGadget, GADGETS, type Gadget } from './gadgets';
import { display, miniComputer, pothos, riser, snakePlant, succulent } from './home';
import { buildInstantCamera, type InstantCamera } from './instant/camera';
import { createFilm, filmGeometry, LOOKS as FILM_LOOKS } from './instant/film';
import { time as filmTime } from './instant/materials';
import { BODY, EYEPIECE, FILM, SLOT, TOP } from './instant/model';
import { buildPhotoLine, type PhotoLine } from './instant/photoline';
import { THEMES, type Look } from './themes';

/**
 * The Corner Shop: a papercraft gadget shop whose front door is the phone, and then your own
 * front door at home.
 *
 * Folded, the cover screen is the shop's door, shut, CLOSED sign up, filling the screen the way
 * the door fills the phone. The door hangs on the same edge as the phone's hinge and opens the
 * same way, out toward you, by exactly as much as the phone is opened: the hinge angle is the
 * door's angle. Everything else is timed off that angle too:
 *
 *   3°        the bell over the door rings
 *   12–34°    the sign inside the glass swings round to OPEN
 *   20–80°    the lights inside come on, one bulb at a time, light spilling out of the doorway
 *   95–125°   (now on the big screen) the lights under the awning, then the neon in the window
 *   125–180°  you walk in through the door
 *
 * Inside, tap a gadget to buy it: it flies off the shelf into the paper bag in your hand. Then
 * fold the phone: you walk back out, the door shuts behind you, and when it's shut you're home.
 * The cover is your own front door now, the bag on the mat; open the phone and you walk in, and
 * what you bought turns up on the desk and the shelf over it, one thing at a time.
 *
 * On the desk there's an instant camera (the one from the Instant demo). Tap it and you pick it
 * up: the lens pops out, the flash charges, and you look through the eyepiece at your own desk.
 * The shutter fires the flash across the room and the print comes up out of the top, dark; shake
 * it and it develops, then it goes up on the string of lights over the desk, pegged on.
 *
 * There's no shadow mapping on React Native's WebGPU, so every shadow here is drawn.
 *
 * Units: about a metre each. The fronts stand on z = 0 facing +z; the door's hinge is at x = HX;
 * the room runs back to z = -RD.
 */

export type Site = 'shop' | 'home';

export type ShopHaptic =
  | 'bell'
  | 'sign'
  | 'bulb'
  | 'neon'
  | 'step'
  | 'settle'
  | 'buy'
  | 'drop'
  | 'arrive'
  | 'place'
  | 'lens'
  | 'shutter'
  | 'motor'
  | 'shake'
  | 'ready'
  | 'tick';
export type ShopSound = 'lens' | 'charge' | 'shutter' | 'eject';

/** Taking a photo at home, step by step */
export type Shot =
  | 'none'
  | 'raise'
  | 'ready'
  | 'dive'
  | 'aim'
  | 'eject'
  | 'present'
  | 'developing'
  | 'developed'
  | 'hang'
  | 'toss'
  | 'putdown';

/** Motion from the phone, each frame: acceleration and gravity in m/s², or null without sensors */
export type Motion = () => { ax: number; ay: number; az: number; gx: number; gy: number; gz: number } | null;

/** How much of the screen's height the viewfinder's window takes (it's centred) */
export const FINDER = 0.8;

export type ShopEvents = {
  onHaptic: (kind: ShopHaptic) => void;
  /** What's in the bag, whenever it changes */
  onBag: (bag: Gadget[]) => void;
  /** Where we are, whenever it changes */
  onSite: (site: Site) => void;
  /** Whether you're all the way in (the shop's shelves, or home's desk) */
  onInside: (inside: boolean) => void;
  /** Taking a photo: where it's got to */
  onShot: (shot: Shot) => void;
  /** 0..1 as the print develops, a few times a second */
  onDevelop: (progress: number) => void;
  onSound: (kind: ShopSound) => void;
  /** How many prints are on the line */
  onPrints: (count: number) => void;
};

/** Board thickness */
const T = 0.04;
const DEG = Math.PI / 180;

// The door: the phone's cover, to scale, hinged on its left edge and opening out
const DH = 1.9;
const DW = 1.3;
const DT = 0.05;
const HX = -DW / 2;
const HZ = 0.055;
const DY0 = 0.035;
/** Its glass, between the bottom panel and the top rail */
const GY0 = 0.98;
const GY1 = DH - 0.13;
// The front
const FW = 6.4;
const FH = 3.0;
const FD = 0.08;
// The room behind it
const RX = 1.75;
const RD = 2.7;
const RH = 2.5;
// The window
const WX0 = 1.0;
const WX1 = 1.64;
const WY0 = 0.62;
const WY1 = 1.72;

/** A 0..1 level a shader reads */
const level = () => TSL.uniform(0);
type Level = ReturnType<typeof level>;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/** Ease out past the mark and back, like a hung sign swinging round, or a thing set down */
const backOut = (t: number) => {
  const k = 1.9;
  const u = t - 1;
  return 1 + (k + 1) * u * u * u + k * u * u;
};
/** Has the angle gone up through x since last frame */
const passedUp = (before: number, now: number, x: number) => before < x && now >= x;

/** The shop's shelves, from the bottom */
const SHELVES: Gadget[][] = [
  ['speaker', 'headphones', 'keyboard', 'controller'],
  ['filmCamera', 'instant', 'handheld'],
  ['watch', 'tablet', 'lamp'],
];

// Home: the desk against the back wall, a shelf over it, the line of prints over that
const DESK_X = 0.15;
const DESK_Y = 0.78;
const S1 = 1.7;
/** Where each thing goes at home (x and z from the desk's middle at the wall), the box it fits, its turn */
const HOME: Record<Gadget, { at: [number, number, number]; size: [number, number, number]; ry: number }> = {
  tablet: { at: [-0.74, DESK_Y, 0.3], size: [0.48, 0.38, 0.26], ry: 0.35 },
  keyboard: { at: [0, DESK_Y, 0.54], size: [0.6, 0.09, 0.22], ry: 0 },
  lamp: { at: [-1.0, DESK_Y, 0.2], size: [0.36, 0.52, 0.3], ry: 0.6 },
  speaker: { at: [0.64, DESK_Y, 0.17], size: [0.2, 0.3, 0.2], ry: -0.3 },
  controller: { at: [-0.48, DESK_Y, 0.6], size: [0.27, 0.14, 0.2], ry: 0.35 },
  watch: { at: [0.8, DESK_Y, 0.62], size: [0.15, 0.17, 0.15], ry: -0.3 },
  headphones: { at: [-0.52, S1, 0.15], size: [0.3, 0.28, 0.2], ry: 0.3 },
  filmCamera: { at: [-0.18, S1, 0.15], size: [0.28, 0.2, 0.18], ry: -0.15 },
  instant: { at: [0.12, S1, 0.15], size: [0.24, 0.24, 0.2], ry: -0.3 },
  handheld: { at: [0.38, S1, 0.15], size: [0.16, 0.26, 0.15], ry: 0.25 },
  laptop: { at: [0, 0, 0], size: [0, 0, 0], ry: 0 },
};
/** The instant camera on the desk, and how a centimetre of it comes out in the room */
const CAM_AT: [number, number, number] = [0.98, DESK_Y, 0.42];
const CS = 0.024;
/** A print's scale on the line */
const LS = 0.038;
/** The line fills from the middle out */
const SLOT_ORDER = [3, 2, 4, 1, 5, 0, 6];
/** Seconds for a print to develop untouched; shaking hurries it */
const DEVELOP = 40;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const ease = (t: number) => {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};
const easeOut = (t: number) => 1 - Math.pow(1 - clamp01(t), 3);

export function createCornerShop(
  context: GPUCanvasContext & { present: () => void },
  device: GPUDevice,
  init: { width: number; height: number; ratio: number; wide: boolean; look: Look; site: Site; bag: Gadget[] },
  events: ShopEvents
) {
  let width = init.width;
  let height = init.height;
  let wide = init.wide;
  const t = THEMES[init.look];

  const renderer = new THREE.WebGPURenderer({
    antialias: true,
    alpha: false,
    canvas: context.canvas as HTMLCanvasElement,
    context,
    device,
  });
  renderer.setPixelRatio(1);
  renderer.setSize(width * init.ratio, height * init.ratio, false);
  THREE.ColorManagement.enabled = false;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setClearColor(new THREE.Color(t.clear), 1);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, width / height, 0.03, 60);
  scene.add(camera);

  // ---- Light: the night (or day) outside, the lamp by the door, the room's own lights ----
  scene.add(new THREE.HemisphereLight(t.light.sky, t.light.groundColor, t.light.hemi));
  const key = new THREE.DirectionalLight(t.light.key, t.light.keyPower);
  key.position.set(...t.light.keyAt);
  const rim = new THREE.DirectionalLight(t.light.rim, t.light.rimPower);
  rim.position.set(2.4, 1.8, -2.6);
  scene.add(key, rim);
  const lamp = new THREE.PointLight(t.light.lamp, t.light.lampPower, 3.6, 2);
  lamp.position.set(-1.0, 1.95, 0.8);
  scene.add(lamp);
  const roomFront = new THREE.PointLight(t.light.bulbs, 0, 4.4, 1.2);
  roomFront.position.set(0, 2.45, -0.8);
  const roomBack = new THREE.PointLight(t.light.bulbs, 0, 4.4, 1.2);
  roomBack.position.set(0, 2.45, -1.7);
  scene.add(roomFront, roomBack);

  // ---- The ground ----
  if (t.ground.kind === 'table') {
    const m = new THREE.MeshBasicNodeMaterial();
    const p = TSL.positionWorld;
    const pool = TSL.smoothstep(7.0, 0.6, TSL.length(TSL.vec2(p.x, p.z.add(0.4))));
    const grain = TSL.mx_noise_float(TSL.vec3(p.x.mul(1.2), p.z.mul(14), 0.5))
      .mul(0.5)
      .add(0.5);
    const wood = TSL.mix(TSL.vec3(0.13, 0.085, 0.055), TSL.vec3(0.21, 0.135, 0.085), grain);
    m.colorNode = wood.mul(pool.mul(0.85).add(0.15));
    const table = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), m);
    table.rotation.x = -Math.PI / 2;
    table.position.y = -T - 0.002;
    scene.add(table);
  } else {
    // A seamless sweep: the floor running back and curving up into the wall behind
    const top = new THREE.Color(t.ground.top);
    const bottom = new THREE.Color(t.ground.bottom);
    const m = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
    const p = TSL.positionWorld;
    const up = TSL.smoothstep(-0.2, 6.0, p.y);
    const spot = TSL.smoothstep(9.0, 0.5, TSL.length(TSL.vec2(p.x, p.z.add(0.4))));
    m.colorNode = TSL.mix(TSL.vec3(bottom.r, bottom.g, bottom.b), TSL.vec3(top.r, top.g, top.b), up).mul(
      spot.mul(0.22).add(0.86)
    );
    const g = new THREE.CylinderGeometry(12, 12, 30, 64, 1, true, Math.PI * 0.5, Math.PI);
    const sweep = new THREE.Mesh(g, m);
    sweep.position.set(0, 15 - T - 0.002, 3);
    scene.add(sweep);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(12.2, 64), m);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, -T - 0.002, 3);
    scene.add(floor);
  }

  // ---- Shadows, drawn ----
  /** A soft dark rounded rectangle lying on a surface: the contact shadow under a thing */
  const shadowMat = (strength: number) => {
    const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
    const uv = TSL.uv().sub(0.5).mul(2);
    const d = TSL.length(TSL.max(TSL.abs(uv).sub(0.35), 0.0)).div(0.65);
    m.colorNode = TSL.vec3(0.03, 0.02, 0.015);
    m.opacityNode = TSL.smoothstep(1.0, 0.0, d).pow(1.6).mul(strength);
    return m;
  };
  const blob = (w: number, d: number, strength: number) => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), shadowMat(strength));
    mesh.rotation.x = -Math.PI / 2;
    mesh.renderOrder = 1;
    return mesh;
  };
  /** Darkening up a wall from where something meets it (a vertical plane, darkest at its foot) */
  const aoStrip = (w: number, h: number, strength: number) => {
    const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
    const uv = TSL.uv();
    m.colorNode = TSL.vec3(0.03, 0.02, 0.015);
    m.opacityNode = TSL.smoothstep(1.0, 0.0, uv.y)
      .pow(2.0)
      .mul(TSL.smoothstep(0.0, 0.06, uv.x).mul(TSL.smoothstep(1.0, 0.94, uv.x)))
      .mul(strength);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
    mesh.renderOrder = 1;
    return mesh;
  };
  /** Light added onto a surface: a glow, warm, shaped by `mask` over the plane's uv */
  const glow = (
    w: number,
    h: number,
    color: string,
    lvl: Level,
    mask: (uv: THREE.Node<'vec2'>) => THREE.Node<'float'>
  ) => {
    const m = new THREE.MeshBasicNodeMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const c = new THREE.Color(color);
    m.colorNode = TSL.vec3(c.r, c.g, c.b);
    m.opacityNode = mask(TSL.uv()).mul(lvl);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
    mesh.renderOrder = 2;
    return mesh;
  };

  // ---- Board ----
  const card = {
    color: null as THREE.Texture | null,
    normal: null as THREE.Texture | null,
    edge: null as THREE.Texture | null,
  };
  const paperLook = t.look !== 'kraft';

  /** Board of a colour (null: raw kraft), keeping the fibre of the baked texture */
  const makeBoard = (tint: string | null, rep = 1.1, shade = 1) => {
    const m = new THREE.MeshStandardNodeMaterial({ roughness: paperLook ? 0.82 : 0.88, metalness: 0 });
    const uv = TSL.uv().mul(rep);
    const kraft = card.color ? TSL.texture(card.color, uv).rgb : TSL.vec3(0.55, 0.38, 0.23);
    let base: THREE.Node<'vec3'>;
    if (tint) {
      const c = new THREE.Color(tint);
      // The fibre as a ±% wobble on the paper's own colour
      const fibre = TSL.luminance(kraft).div(0.42);
      base = TSL.vec3(c.r, c.g, c.b).mul(TSL.mix(1.0, fibre, 0.22)) as unknown as THREE.Node<'vec3'>;
    } else base = kraft as unknown as THREE.Node<'vec3'>;
    if (shade !== 1) base = base.mul(shade) as unknown as THREE.Node<'vec3'>;
    m.colorNode = base;
    if (card.normal) {
      const k = paperLook ? 0.22 : 0.6;
      m.normalNode = TSL.normalMap(TSL.texture(card.normal, paperLook ? uv.mul(2.0) : uv), TSL.vec2(k, k));
    }
    return m;
  };
  // Shared: one material per kind of board, so there are fewer shaders to build
  const boards = new Map<string, THREE.MeshStandardNodeMaterial>();
  const board = (tint: string | null, rep = 1.1, shade = 1) => {
    const key = `${tint}|${rep}|${shade}`;
    let m = boards.get(key);
    if (!m) boards.set(key, (m = makeBoard(tint, rep, shade)));
    return m;
  };
  /** Board with ink printed on it (the print's alpha says where) */
  const printed = (tint: string | null, print: THREE.Texture, rep = 1.1) => {
    const m = makeBoard(tint, rep);
    const p = TSL.texture(print, TSL.uv());
    m.colorNode = TSL.mix(m.colorNode as THREE.Node<'vec3'>, p.rgb, p.a.mul(0.96));
    return m;
  };
  /** A print cut out round its shape (alpha), standing on its own */
  const cutout = (print: THREE.Texture) => {
    const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.85, transparent: true, alphaTest: 0.5 });
    const p = TSL.texture(print, TSL.uv());
    m.colorNode = p.rgb;
    m.opacityNode = p.a;
    m.side = THREE.DoubleSide;
    return m;
  };
  let edge: THREE.MeshStandardNodeMaterial | null = null;
  const edgeMat = () => {
    if (edge) return edge;
    const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.95, metalness: 0 });
    if (t.edge === 'corrugated')
      m.colorNode = card.edge ? TSL.texture(card.edge, TSL.uv().mul(TSL.vec2(6, 1))).rgb : TSL.vec3(0.4, 0.28, 0.17);
    else m.color = new THREE.Color(t.edge);
    edge = m;
    return m;
  };
  /** A panel of board: faces front and back, the cut edge round its rim */
  const slab = (w: number, h: number, front: THREE.Material, back: THREE.Material, depth = T) => {
    const e = edgeMat();
    // +x, -x, +y, -y, +z (front), -z (back)
    return new THREE.Mesh(new THREE.BoxGeometry(w, h, depth), [e, e, e, e, front, back]);
  };
  /** A box of board, every face the same */
  const block = (w: number, h: number, d: number, m: THREE.Material) =>
    new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  const hitMat = new THREE.MeshBasicNodeMaterial({ visible: false });
  const brass = new THREE.MeshStandardNodeMaterial({ color: '#D2A24C', roughness: 0.32, metalness: 0.35 });
  brass.emissiveNode = TSL.vec3(0.16, 0.11, 0.04);
  const dark = new THREE.MeshStandardNodeMaterial({ color: '#1F1B18', roughness: 0.45, metalness: 0.2 });

  /** Fit a model into a w × h × d box, standing on the origin */
  const fit = (m: THREE.Object3D, w: number, h: number, d: number) => {
    const raw = new THREE.Box3().setFromObject(m).getSize(new THREE.Vector3());
    m.scale.setScalar(Math.min(w / raw.x, h / raw.y, d / raw.z));
    const box = new THREE.Box3().setFromObject(m);
    m.position.y = -box.min.y + 0.002;
    return m;
  };

  /** Swap one texture's pixels for another's (a price tag sold, the till's total) */
  const repaint = (into: THREE.Texture, from: THREE.Texture) => {
    into.image = from.image;
    into.needsUpdate = true;
  };

  // ---- The two places, and what's shared ----
  const shop = new THREE.Group();
  const home = new THREE.Group();
  scene.add(shop, home);
  const shopDoor = new THREE.Group();
  const homeDoor = new THREE.Group();
  const signPivot = new THREE.Group();
  const bell = new THREE.Group();
  const shopBulbs: Level[] = [];
  const awningBulbs: Level[] = [];
  const homeBulbs: Level[] = [];
  const spill = level();
  const leak = level();
  const roomLit = level();
  const neonLevel = level();
  const lampLevel = level();
  const fade = level();
  /** The shelves' gadgets: the model, its price tag and its SOLD tag */
  const goods: { kind: Gadget; lift: THREE.Group; model: THREE.Object3D; tag: THREE.Mesh; sold: THREE.Mesh }[] = [];
  /** What's at home, waiting for the bag to be unpacked */
  const placed = new Map<Gadget, THREE.Group>();
  const bagAt = new THREE.Vector3();
  let bagBody: THREE.Group | null = null;
  let tillTex: THREE.Texture | null = null;
  let fonts: Awaited<ReturnType<typeof loadFonts>> | null = null;
  let ready = false;
  // The instant camera, its live print, the line the prints go up on
  const fuji: InstantCamera = buildInstantCamera(t.look === 'kraft' ? 'brown' : t.look === 'riso' ? 'black' : 'silver');
  fuji.group.scale.setScalar(CS);
  const film = createFilm();
  const print = new THREE.Mesh(filmGeometry(), [
    film.edge(),
    film.edge(),
    film.edge(),
    film.edge(),
    film.front(),
    film.back(),
  ]);
  print.visible = false;
  print.scale.setScalar(CS);
  scene.add(print);
  let line: PhotoLine | null = null;
  const deskCam = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
  const flashLight = new THREE.PointLight('#FFF6E8', 0, 6, 1.4);
  scene.add(flashLight);

  /** A string of bulbs along a sagging wire, each with its own level */
  const stringLights = (
    parent: THREE.Object3D,
    x0: number,
    x1: number,
    y: number,
    z: number,
    n: number,
    into: Level[]
  ) => {
    const wire = new THREE.MeshStandardNodeMaterial({ color: '#1D1A18', roughness: 0.6 });
    const span = x1 - x0;
    const swags = Math.max(2, Math.round(span / 0.6));
    const sagAt = (x: number) => Math.sin(((x - x0) / span) * Math.PI * swags) ** 2 * 0.05;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 40; i++) {
      const x = x0 + (i / 40) * span;
      pts.push(new THREE.Vector3(x, y - sagAt(x), z));
    }
    parent.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 120, 0.005, 6), wire));
    const warm = new THREE.Color(t.light.bulbs);
    for (let i = 0; i < n; i++) {
      const lv = level();
      const bm = new THREE.MeshBasicNodeMaterial();
      bm.colorNode = TSL.mix(TSL.vec3(0.3, 0.27, 0.24), TSL.vec3(warm.r * 1.8, warm.g * 1.8, warm.b * 1.8), lv);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.022, 16, 12), bm);
      const x = x0 + 0.05 + (i / (n - 1)) * (span - 0.1);
      bulb.position.set(x, y - 0.035 - sagAt(x), z + 0.01);
      bulb.scale.set(1, 1.35, 1);
      parent.add(bulb);
      into.push(lv);
    }
  };

  /** Glass: tinted, a streak of reflection across it, a little warm once the room's lit behind */
  const glassPane = (w: number, h: number) => {
    const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const uv = TSL.uv();
    const streak = TSL.smoothstep(0.1, 0.0, TSL.abs(uv.x.add(uv.y.mul(0.6)).sub(0.75))).mul(0.12);
    const warm = new THREE.Color(t.light.bulbs);
    m.colorNode = TSL.mix(TSL.vec3(0.12, 0.16, 0.2), TSL.vec3(warm.r, warm.g, warm.b), roomLit.mul(0.25)).add(streak);
    m.opacityNode = TSL.float(0.22).add(streak);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
    mesh.renderOrder = 2;
    return mesh;
  };

  /** A room: floor, back and side walls, darker where they meet the floor */
  const room = (parent: THREE.Object3D, wallTint: string | null, floor: THREE.Material) => {
    const f = new THREE.Mesh(new THREE.PlaneGeometry(RX * 2, RD), floor);
    f.rotation.x = -Math.PI / 2;
    f.position.set(0, 0.002, -RD / 2);
    parent.add(f);
    const wm = board(wallTint, 1.2);
    const back = slab(RX * 2 + T * 2, RH, wm, wm);
    back.position.set(0, RH / 2, -RD - T / 2);
    parent.add(back);
    parent.add(
      aoStrip(RX * 2, 0.45, 0.35)
        .translateY(0.225)
        .translateZ(-RD + 0.002)
    );
    for (const side of [-1, 1]) {
      // Stopping at the back of the front, so they never show through it
      const wall = slab(RD - FD, RH, wm, wm);
      wall.rotation.y = Math.PI / 2;
      wall.position.set(side * (RX + T / 2), RH / 2, -(RD + FD) / 2);
      parent.add(wall);
      const ao = aoStrip(RD, 0.45, 0.3);
      ao.rotation.y = -side * (Math.PI / 2);
      ao.position.set(side * (RX - 0.002), 0.225, -RD / 2);
      parent.add(ao);
    }
  };

  /** The front: board with the doorway and the window cut in it, the frames round both */
  const front = (parent: THREE.Object3D, wallTint: string | null, trimTint: string | null) => {
    const s = new THREE.Shape();
    s.moveTo(-FW / 2, 0);
    s.lineTo(HX, 0);
    s.lineTo(HX, DH);
    s.lineTo(HX + DW, DH);
    s.lineTo(HX + DW, 0);
    s.lineTo(FW / 2, 0);
    s.lineTo(FW / 2, FH);
    s.lineTo(-FW / 2, FH);
    s.closePath();
    const hole = new THREE.Path();
    hole.moveTo(WX0, WY0);
    hole.lineTo(WX1, WY0);
    hole.lineTo(WX1, WY1);
    hole.lineTo(WX0, WY1);
    hole.closePath();
    s.holes.push(hole);
    const g = new THREE.ExtrudeGeometry(s, { depth: FD, bevelEnabled: false, curveSegments: 1 });
    g.translate(0, 0, -FD);
    parent.add(new THREE.Mesh(g, [board(wallTint, 1.0), edgeMat()]));
    parent.add(blob(FW, 0.34, 0.4).translateY(0.003).translateZ(0.12));
    const trim = board(trimTint, 1.8);
    for (const x of [HX - 0.045, HX + DW + 0.045])
      parent.add(
        block(0.07, DH + 0.1, 0.05, trim)
          .translateX(x)
          .translateY((DH + 0.1) / 2)
          .translateZ(0.025)
      );
    parent.add(
      block(DW + 0.24, 0.1, 0.06, trim)
        .translateY(DH + 0.05)
        .translateZ(0.03)
    );
    parent.add(
      block(DW + 0.24, 0.035, 0.24, board(trimTint ?? t.board.page, 2))
        .translateY(0.0175)
        .translateZ(0.1)
    );
    const ww = WX1 - WX0;
    const wh = WY1 - WY0;
    const cx = (WX0 + WX1) / 2;
    const cy = (WY0 + WY1) / 2;
    for (const x of [WX0 - 0.035, WX1 + 0.035])
      parent.add(
        block(0.07, wh + 0.14, 0.05, trim)
          .translateX(x)
          .translateY(cy)
          .translateZ(0.025)
      );
    parent.add(
      block(ww + 0.14, 0.07, 0.05, trim)
        .translateX(cx)
        .translateY(WY1 + 0.035)
        .translateZ(0.025)
    );
    parent.add(
      block(ww + 0.22, 0.05, 0.16, trim)
        .translateX(cx)
        .translateY(WY0 - 0.025)
        .translateZ(0.06)
    );
    parent.add(block(0.03, wh, 0.03, trim).translateX(cx).translateY(cy).translateZ(-0.01));
    parent.add(
      glassPane(ww, wh)
        .translateX(cx)
        .translateY(cy)
        .translateZ(-FD / 2)
    );
  };

  /** The door's leaf: panels both sides, brass, its own swinging shadow. The shop's has glass */
  const doorLeaf = (door: THREE.Group, tint: string, glass: boolean) => {
    door.position.set(HX, 0, HZ);
    const face = board(tint, 1.6);
    const raised = board(tint, 1.6, 1.12);
    if (glass) {
      const bottom = slab(DW, GY0 - DY0, face, face, DT);
      bottom.position.set(DW / 2, (DY0 + GY0) / 2, -DT / 2);
      door.add(bottom);
      const rail = slab(DW, DH - GY1, face, face, DT);
      rail.position.set(DW / 2, (GY1 + DH) / 2, -DT / 2);
      door.add(rail);
      for (const x of [0.08, DW - 0.08]) {
        const stile = slab(0.16, GY1 - GY0, face, face, DT);
        stile.position.set(x, (GY0 + GY1) / 2, -DT / 2);
        door.add(stile);
      }
      for (const z of [0.006, -DT - 0.006])
        door.add(
          block(DW - 0.32, 0.56, 0.012, raised)
            .translateX(DW / 2)
            .translateY(0.47)
            .translateZ(z)
        );
      door.add(
        glassPane(DW - 0.31, GY1 - GY0 + 0.01)
          .translateX(DW / 2)
          .translateY((GY0 + GY1) / 2)
          .translateZ(-DT / 2)
      );
    } else {
      const leaf = slab(DW, DH - DY0, face, face, DT);
      leaf.position.set(DW / 2, (DY0 + DH) / 2, -DT / 2);
      door.add(leaf);
      for (const z of [0.006, -DT - 0.006]) {
        door.add(
          block(DW - 0.34, 0.6, 0.012, raised)
            .translateX(DW / 2)
            .translateY(0.48)
            .translateZ(z)
        );
        door.add(
          block(DW - 0.34, 0.72, 0.012, raised)
            .translateX(DW / 2)
            .translateY(1.33)
            .translateZ(z)
        );
      }
      // A round window high up, the warm of the flat behind it
      const warm = new THREE.Color(t.light.bulbs);
      const pane = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
      const uv = TSL.uv().sub(0.5);
      pane.colorNode = TSL.vec3(warm.r, warm.g, warm.b)
        .mul(TSL.smoothstep(0.55, 0.0, TSL.length(uv)).mul(0.5).add(0.45))
        .mul(roomLit.mul(0.5).add(0.7));
      const port = new THREE.Mesh(new THREE.CircleGeometry(0.17, 48), pane);
      port.position.set(DW / 2, 1.48, 0.0135);
      door.add(port);
      const back = port.clone();
      back.position.z = -DT - 0.0135;
      door.add(back);
      for (const z of [0.016, -DT - 0.016]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.018, 12, 48), brass);
        ring.position.set(DW / 2, 1.48, z);
        door.add(ring);
      }
      for (const y of [-1, 1]) {
        const bar = block(0.008, 0.34, 0.008, brass);
        bar.position.set(DW / 2, 1.48, 0.017);
        bar.rotation.z = (y * Math.PI) / 4;
        door.add(bar);
      }
    }
    door.add(
      block(DW - 0.05, 0.13, 0.004, brass)
        .translateX(DW / 2)
        .translateY(0.1)
        .translateZ(0.002)
    );
    for (const y of [0.34, 1.6]) {
      const h = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.11, 10), brass);
      h.position.set(0, y, 0);
      door.add(h);
    }
    door.add(
      blob(DW + 0.1, 0.3, 0.45)
        .translateX(DW / 2)
        .translateY(0.005)
        .translateZ(-DT / 2)
    );
  };

  /** The paper carrier bag, standing, handles up */
  const carrier = (f: NonNullable<typeof fonts>, shadow = true) => {
    const g = new THREE.Group();
    // Lit a little from within, so it reads even held low in the dark of the shop
    const map = bagTexture(f, t);
    const print = new THREE.MeshStandardNodeMaterial({ map, roughness: 0.9 });
    print.emissiveNode = TSL.texture(map, TSL.uv()).rgb.mul(0.3);
    const paper = new THREE.Color(t.look === 'kraft' ? '#C9955E' : t.look === 'riso' ? '#F7F1E6' : '#FFFFFF');
    const side = new THREE.MeshStandardNodeMaterial({ color: paper, roughness: 0.9 });
    side.emissiveNode = TSL.vec3(paper.r, paper.g, paper.b).mul(0.3);
    const inside = new THREE.MeshStandardNodeMaterial({ color: '#2A2018', roughness: 1 });
    const bw = 0.34;
    const bh = 0.4;
    const bd = 0.2;
    const body = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), [side, side, inside, side, print, print]);
    body.position.y = bh / 2;
    g.add(body);
    const rope = new THREE.MeshStandardNodeMaterial({
      color: t.look === 'riso' ? '#FF4F8B' : '#3A2A1E',
      roughness: 0.8,
    });
    for (const z of [-bd / 2 + 0.01, bd / 2 - 0.01]) {
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(-0.08, bh - 0.02, z),
        new THREE.Vector3(-0.06, bh + 0.1, z),
        new THREE.Vector3(0.06, bh + 0.1, z),
        new THREE.Vector3(0.08, bh - 0.02, z),
      ]);
      g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.007, 6), rope));
    }
    if (shadow) g.add(blob(bw + 0.16, bd + 0.16, 0.5).translateY(0.003));
    return g;
  };

  const build = async () => {
    const [f, cb] = await Promise.all([loadFonts(), loadCardboard()]);
    fonts = f;
    card.color = cb.color;
    card.normal = cb.normal;
    card.edge = cb.edge;

    // ---- Shared: the base it all stands on, the lamp by the door, the light out of the door ----
    {
      const z0 = -RD - 0.2;
      const z1 = 1.9;
      const top = board(t.board.page, 3.2);
      const base = new THREE.Mesh(new THREE.BoxGeometry(FW + 0.2, T, z1 - z0), [
        edgeMat(),
        edgeMat(),
        top,
        top,
        edgeMat(),
        edgeMat(),
      ]);
      base.position.set(0, -T / 2, (z0 + z1) / 2);
      scene.add(base);
      scene.add(
        blob(FW + 0.8, z1 - z0 + 0.6, 0.6)
          .translateY(-T - 0.001)
          .translateZ((z0 + z1) / 2)
      );
      scene.add(
        block(FW + 0.2, 0.05, 0.12, board(t.board.trim ?? t.board.page, 2))
          .translateY(0.025)
          .translateZ(z1 - 0.06)
      );

      const at = new THREE.Group();
      at.position.set(-1.0, 2.05, 0);
      scene.add(at);
      at.add(block(0.09, 0.16, 0.02, dark).translateZ(0.01));
      at.add(block(0.02, 0.02, 0.14, dark).translateZ(0.08).translateY(0.04));
      const glassM = new THREE.MeshBasicNodeMaterial();
      const warm = new THREE.Color(t.light.lamp);
      glassM.colorNode = TSL.vec3(warm.r * 1.6, warm.g * 1.6, warm.b * 1.6).mul(lampLevel);
      const lantern = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.045, 0.15, 6), glassM);
      lantern.position.set(0, -0.05, 0.16);
      at.add(lantern);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.07, 6), dark);
      cap.position.set(0, 0.06, 0.16);
      at.add(cap);
      at.add(
        glow(0.8, 0.8, t.light.lamp, lampLevel, (uv) =>
          TSL.smoothstep(0.5, 0.0, TSL.length(uv.sub(0.5)))
            .pow(2.2)
            .mul(0.22)
        ).translateZ(0.004)
      );

      const wedge = glow(1.9, 1.6, t.light.bulbs, spill, (uv) => {
        const d = uv.y.oneMinus();
        const half = d.mul(0.22).add(0.26);
        const across = TSL.smoothstep(half, half.sub(0.08), TSL.abs(uv.x.sub(0.5)));
        return across.mul(TSL.smoothstep(1.0, 0.0, d).pow(1.4)).mul(0.55);
      });
      wedge.rotation.x = -Math.PI / 2;
      wedge.position.set(0, 0.006, 0.83);
      scene.add(wedge);
      const line = glow(DW, 0.1, t.light.bulbs, leak, (uv) =>
        TSL.smoothstep(1.0, 0.0, uv.y).mul(TSL.smoothstep(0.0, 0.08, uv.x).mul(TSL.smoothstep(1.0, 0.92, uv.x)))
      );
      line.rotation.x = -Math.PI / 2;
      line.position.set(0, 0.037, HZ + 0.05);
      scene.add(line);
    }

    // ================= The shop =================
    room(shop, t.board.side, printed(t.board.page, floorTexture(t), 2.4));
    front(shop, t.board.wall, t.board.trim);

    // ---- Shelves on the back wall, the gadgets on them ----
    {
      const shelfMat = board(t.board.shelf, 1.4);
      const wall = new THREE.Group();
      wall.position.z = -RD;
      shop.add(wall);
      SHELVES.forEach((row, r) => {
        const y = 0.42 + r * 0.56;
        const shelf = new THREE.Mesh(new THREE.BoxGeometry(2.9, T, 0.42), [
          edgeMat(),
          edgeMat(),
          shelfMat,
          shelfMat,
          edgeMat(),
          edgeMat(),
        ]);
        shelf.position.set(0, y, 0.21);
        wall.add(shelf);
        wall.add(
          aoStrip(2.9, 0.22, 0.3)
            .translateY(y - 0.12)
            .translateZ(0.002)
            .rotateZ(Math.PI)
        );
        for (const sx of [-1.25, 1.25]) {
          const s = new THREE.Shape();
          s.moveTo(0, 0);
          s.lineTo(0.24, 0);
          s.lineTo(0, -0.2);
          s.closePath();
          const g = new THREE.ExtrudeGeometry(s, { depth: T, bevelEnabled: false });
          g.rotateY(-Math.PI / 2);
          const br = new THREE.Mesh(g, shelfMat);
          br.position.set(sx + T / 2, y - T / 2, 0.0);
          wall.add(br);
        }
        row.forEach((kind, k) => {
          const x = (k - (row.length - 1) / 2) * 0.68;
          const tagMat = (label: string) =>
            new THREE.MeshStandardNodeMaterial({ map: tagTexture(f, t, label), transparent: true, roughness: 0.7 });
          const tag = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.1), tagMat(`$${GADGETS[kind].price}`));
          tag.position.set(x, y - 0.045, 0.424);
          tag.rotation.x = -0.12;
          wall.add(tag);
          const sold = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.1), tagMat('sold'));
          sold.position.copy(tag.position);
          sold.rotation.copy(tag.rotation);
          sold.visible = false;
          wall.add(sold);
          const holder = new THREE.Group();
          holder.position.set(x, y + T / 2, 0.21);
          wall.add(holder);
          holder.add(blob(0.48, 0.32, 0.55).translateY(0.002));
          const model = fit(buildGadget(kind), 0.5, 0.44, 0.34);
          model.rotation.y = 0.3 - (k % 2) * 0.22;
          const lift = new THREE.Group();
          lift.add(model);
          // A box round it that a tap can't miss (drawn never)
          lift.add(new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.5, 0.4), hitMat).translateY(0.24));
          holder.add(lift);
          goods.push({ kind, lift, model, tag, sold });
        });
      });
      stringLights(wall, -1.66, 1.66, 2.28, 0.04, 15, shopBulbs);
    }

    // ---- The counter, the till, the bag, the cat ----
    {
      const CW = 0.9;
      const CH = 0.72;
      const CD = 0.42;
      const counter = new THREE.Group();
      counter.position.set(-1.25, 0, -1.55);
      counter.rotation.y = 1.07;
      shop.add(counter);
      counter.add(blob(CW + 0.3, CD + 0.3, 0.6).translateY(0.004));
      const frontM = printed(t.board.counter, counterTexture(f, t), 1.2);
      const plain = board(t.board.counter, 1.3);
      const top = board(t.board.shelf, 1.6);
      const box = new THREE.Mesh(new THREE.BoxGeometry(CW, CH, CD), [plain, plain, top, plain, frontM, plain]);
      box.position.y = CH / 2;
      counter.add(box);
      const reg = new THREE.Group();
      reg.position.set(0.2, CH, -0.04);
      counter.add(reg);
      reg.add(blob(0.5, 0.42, 0.5).translateY(0.002));
      const regBody = block(0.34, 0.14, 0.26, board(t.board.shelf, 2));
      regBody.position.y = 0.07;
      reg.add(regBody);
      tillTex = screenTexture(f, '$0');
      const scr = new THREE.Mesh(
        new THREE.PlaneGeometry(0.24, 0.09),
        new THREE.MeshBasicNodeMaterial({ map: tillTex })
      );
      scr.position.set(0, 0.2, 0.02);
      scr.rotation.x = -0.35;
      reg.add(scr);
      const stand = block(0.26, 0.12, 0.02, board(t.board.shelf, 2));
      stand.position.set(0, 0.17, 0.0);
      stand.rotation.x = -0.35;
      reg.add(stand);
      // The bag's in your hand: low in the corner of the view, as you'd hold it
      bagBody = carrier(f, false);
      bagBody.visible = false;
      camera.add(bagBody);
      // The shop cat, asleep at the end of the counter
      const cat = new THREE.Group();
      cat.position.set(-0.36, 0, 0.36);
      counter.add(cat);
      cat.add(blob(0.42, 0.26, 0.5).translateY(0.004));
      const cut = new THREE.Mesh(new THREE.PlaneGeometry(0.38, 0.38), cutout(catTexture(t)));
      cut.position.set(0, 0.19, 0);
      cut.rotation.x = -0.08;
      cat.add(cut);
      const easel = slab(0.08, 0.3, board(t.board.counter, 2), board(t.board.counter, 2), T * 0.6);
      easel.position.set(0, 0.14, -0.07);
      easel.rotation.x = 0.42;
      cat.add(easel);
    }

    // ---- Posters ----
    const posters: [number, number, string, string, string, string][] = [
      [-1, -0.75, 'HI-FI', 'HEADPHONES · SPEAKERS', t.accent, '$129'],
      [1, -1.55, 'NEW IN', 'HANDHELDS · CONSOLES', t.posterA, '$49'],
    ];
    for (const [side, z, title, sub, hue, price] of posters) {
      const poster = slab(
        0.62,
        0.78,
        printed(t.board.side, posterTexture(f, t, title, sub, hue, price), 1.2),
        board(t.board.side)
      );
      poster.rotation.y = -side * (Math.PI / 2);
      poster.position.set(side * (RX - 0.03), 1.45, z);
      shop.add(poster);
    }
    {
      const bill = slab(
        0.56,
        0.7,
        printed(t.board.side, posterTexture(f, t, 'REPAIRS', 'SCREENS · BATTERIES', t.posterB, '$29'), 1.2),
        board(t.board.side),
        T * 0.5
      );
      bill.position.set(-2.05, 1.2, 0.012);
      bill.rotation.z = 0.025;
      shop.add(bill);
    }

    // ---- The window: the neon OPEN, a laptop and a speaker on a plinth ----
    {
      const cx = (WX0 + WX1) / 2;
      const tex = neonTexture(f);
      const nm = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const a = TSL.texture(tex, TSL.uv()).a;
      nm.colorNode = TSL.mix(TSL.vec3(0.25, 0.12, 0.16), TSL.vec3(...t.neon), neonLevel);
      nm.opacityNode = a.mul(TSL.mix(0.3, 1, neonLevel));
      const frame = block(0.46, 0.2, 0.03, new THREE.MeshStandardNodeMaterial({ color: '#17151A', roughness: 0.35 }));
      frame.position.set(cx, 1.4, -0.16);
      shop.add(frame);
      const neon = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.164), nm);
      neon.position.set(cx, 1.4, -0.144);
      shop.add(neon);
      for (const x of [-0.17, 0.17]) {
        const chain = block(0.006, 0.25, 0.006, dark);
        chain.position.set(cx + x, 1.625, -0.16);
        shop.add(chain);
      }
      const plinth = block(0.62, 0.66, 0.38, board(t.board.counter, 1.4));
      plinth.position.set(cx, 0.33, -0.38);
      shop.add(plinth);
      const lap = fit(buildGadget('laptop'), 0.4, 0.34, 0.3);
      lap.position.set(cx - 0.06, 0.66, -0.4);
      lap.rotation.y = 0.3;
      shop.add(lap);
      const spk = fit(buildGadget('speaker'), 0.14, 0.2, 0.14);
      spk.position.set(cx + 0.21, 0.66, -0.32);
      shop.add(spk);
    }

    // ---- The sign, and the awning under it ----
    {
      const sign = slab(2.6, 0.62, printed(t.board.wall, signTexture(f, t), 1.2), board(t.board.wall));
      sign.position.set(0.55, 2.6, 0.03);
      shop.add(sign);
      const pivot = new THREE.Group();
      pivot.position.set(0.55, 2.24, 0.0);
      pivot.rotation.x = 1.95;
      shop.add(pivot);
      const tex = awningTexture(t);
      const am = printed(t.board.wall, tex, 1.2);
      am.transparent = true;
      am.alphaTest = 0.4;
      am.side = THREE.DoubleSide;
      am.opacityNode = TSL.texture(tex, TSL.uv()).a;
      const AL = 0.56;
      const awning = new THREE.Mesh(new THREE.PlaneGeometry(2.5, AL), am);
      awning.position.y = AL / 2;
      pivot.add(awning);
      stringLights(pivot, -1.2, 1.2, AL - 0.04, 0.02, 13, awningBulbs);
      shop.add(aoStrip(2.5, 0.3, 0.32).translateX(0.55).translateY(2.09).translateZ(0.003).rotateZ(Math.PI));
    }

    // ---- The bell over the door ----
    {
      bell.position.set(0.5, DH + 0.04, 0.13);
      shop.add(bell);
      const arm = block(0.015, 0.015, 0.13, brass);
      arm.position.set(0.5, DH + 0.05, 0.065);
      shop.add(arm);
      const profile = [
        new THREE.Vector2(0.0, 0.0),
        new THREE.Vector2(0.012, -0.002),
        new THREE.Vector2(0.022, -0.02),
        new THREE.Vector2(0.026, -0.05),
        new THREE.Vector2(0.036, -0.07),
        new THREE.Vector2(0.0, -0.07),
      ];
      const lm = brass.clone();
      lm.side = THREE.DoubleSide;
      bell.add(new THREE.Mesh(new THREE.LatheGeometry(profile, 20), lm));
      const clapper = new THREE.Mesh(new THREE.SphereGeometry(0.009, 10, 8), brass);
      clapper.position.y = -0.07;
      bell.add(clapper);
    }

    // ---- Out front: a chalkboard, a bargain bin, the mat ----
    {
      const sandwich = new THREE.Group();
      sandwich.position.set(-1.75, 0, 0.66);
      sandwich.rotation.y = 0.38;
      shop.add(sandwich);
      sandwich.add(blob(0.7, 0.62, 0.55).translateY(0.003));
      const chalk = printed('#2C2B28', posterTexture(f, t, 'TRADE IN', 'YOUR OLD PHONE', '#2C2B28', '-20%'), 1.4);
      const plain = board(t.board.trim ?? t.board.shelf, 1.6);
      for (const side of [1, -1]) {
        const leaf = new THREE.Group();
        leaf.position.y = 0.8;
        leaf.rotation.x = side * 0.2;
        sandwich.add(leaf);
        const face = slab(0.52, 0.8, side > 0 ? chalk : plain, side > 0 ? plain : chalk, T * 0.7);
        face.position.y = -0.4;
        if (side < 0) face.rotation.y = Math.PI;
        leaf.add(face);
      }

      const crate = new THREE.Group();
      crate.position.set(1.32, 0, 0.4);
      crate.rotation.y = -0.12;
      shop.add(crate);
      crate.add(blob(0.8, 0.5, 0.6).translateY(0.003));
      const slat = board(t.board.shelf, 1.6);
      const CW = 0.62;
      const CH = 0.26;
      const CD = 0.36;
      const label = printed(t.board.shelf, crateTexture(f, t, 'BARGAIN BIN', 'cables · cases · all $5'), 1.2);
      crate.add(
        slab(CW, CH, label, slat)
          .translateY(CH / 2)
          .translateZ(CD / 2)
      );
      crate.add(
        slab(CW, CH, slat, slat)
          .translateY(CH / 2)
          .translateZ(-CD / 2)
      );
      for (const x of [-CW / 2, CW / 2]) {
        const end = slab(CD, CH, slat, slat);
        end.rotation.y = Math.PI / 2;
        end.position.set(x, CH / 2, 0);
        crate.add(end);
      }
      crate.add(block(CW, 0.02, CD, slat).translateY(0.12));
      const junk: [Gadget, number, number, number, number][] = [
        ['controller', -0.14, 0.02, 0.22, 0.5],
        ['handheld', 0.12, -0.04, 0.2, -0.3],
      ];
      for (const [kind, x, z, s, ry] of junk) {
        const m = fit(buildGadget(kind), s, s, s);
        m.position.set(x, 0.13, z);
        m.rotation.set(-0.3, ry, 0);
        crate.add(m);
      }

      const mat = new THREE.Mesh(
        new THREE.PlaneGeometry(0.86, 0.5),
        new THREE.MeshStandardNodeMaterial({ map: matTexture(f, t, 'hello'), transparent: true, roughness: 0.95 })
      );
      mat.rotation.x = -Math.PI / 2;
      mat.position.set(0, 0.004, 0.58);
      shop.add(mat);
    }

    // ---- The shop's door ----
    {
      doorLeaf(shopDoor, t.board.door ?? '#3F6F78', true);
      shop.add(shopDoor);
      const gw = DW - 0.32;
      const gh = GY1 - GY0;
      const letters = new THREE.Mesh(
        new THREE.PlaneGeometry(gw, gh),
        new THREE.MeshBasicNodeMaterial({
          map: glassTexture(f, t),
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
        })
      );
      letters.position.set(DW / 2, (GY0 + GY1) / 2, -DT / 2 + 0.004);
      letters.renderOrder = 3;
      shopDoor.add(letters);
      signPivot.position.set(DW / 2, GY1 - 0.32, -DT - 0.02);
      shopDoor.add(signPivot);
      const signMat = (open: boolean) =>
        new THREE.MeshStandardNodeMaterial({ map: hangSignTexture(f, t, open), transparent: true, roughness: 0.7 });
      const closed = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.24), signMat(false));
      closed.position.y = -0.2;
      signPivot.add(closed);
      const open = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.24), signMat(true));
      open.position.set(0, -0.2, -0.003);
      open.rotation.y = Math.PI;
      signPivot.add(open);
      const cord = new THREE.MeshStandardNodeMaterial({ color: '#2A2420', roughness: 0.8 });
      for (const side of [-1, 1]) {
        const len = Math.hypot(0.15, 0.1);
        const c = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, len, 4), cord);
        c.position.set(side * 0.075, -0.04, 0);
        c.rotation.z = side * Math.atan2(0.15, 0.1);
        signPivot.add(c);
      }
      signPivot.add(new THREE.Mesh(new THREE.SphereGeometry(0.01, 8, 6), brass));
      for (const side of [1, -1]) {
        const z = side > 0 ? 0.04 : -DT - 0.04;
        const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.38, 12), brass);
        bar.position.set(DW - 0.1, 1.05, z);
        shopDoor.add(bar);
        for (const y of [0.9, 1.2])
          shopDoor.add(
            block(0.016, 0.016, 0.04, brass)
              .translateX(DW - 0.1)
              .translateY(y)
              .translateZ(side > 0 ? 0.02 : -DT - 0.02)
          );
      }
      shopDoor.add(
        block(0.3, 0.055, 0.006, brass)
          .translateX(DW / 2)
          .translateY(0.88)
          .translateZ(0.003)
      );
      shopDoor.add(
        block(0.24, 0.012, 0.007, new THREE.MeshBasicNodeMaterial({ color: '#0E0B09' }))
          .translateX(DW / 2)
          .translateY(0.88)
          .translateZ(0.004)
      );
    }

    // ================= Home =================
    room(home, t.home.room, printed(t.home.floor, planksTexture(t), 1.6));
    front(home, t.home.wall, t.home.trim);
    {
      // The desk against the back wall
      const deskM = board(t.home.desk, 1.6);
      const desk = new THREE.Group();
      desk.position.set(DESK_X, 0, -RD);
      home.add(desk);
      const DWD = 2.3;
      const DD = 0.74;
      desk.add(
        block(DWD, 0.04, DD, deskM)
          .translateY(DESK_Y - 0.02)
          .translateZ(DD / 2)
      );
      for (const x of [-DWD / 2 + 0.05, DWD / 2 - 0.05])
        desk.add(
          block(0.05, DESK_Y - 0.04, DD - 0.06, deskM)
            .translateX(x)
            .translateY((DESK_Y - 0.04) / 2)
            .translateZ(DD / 2)
        );
      desk.add(
        block(DWD - 0.1, 0.1, 0.02, deskM)
          .translateY(DESK_Y - 0.09)
          .translateZ(0.06)
      );
      desk.add(
        blob(DWD + 0.2, DD + 0.2, 0.5)
          .translateY(0.004)
          .translateZ(DD / 2)
      );
      // A shelf over it, on brackets
      desk.add(
        block(2.0, T, 0.3, deskM)
          .translateY(S1 - T / 2)
          .translateZ(0.15)
      );
      desk.add(
        aoStrip(2.0, 0.18, 0.28)
          .translateY(S1 - 0.1)
          .translateZ(0.002)
          .rotateZ(Math.PI)
      );
      for (const x of [-0.86, 0.86])
        desk.add(
          block(0.03, 0.14, 0.2, dark)
            .translateX(x)
            .translateY(S1 - 0.09)
            .translateZ(0.1)
        );
      // The display on its riser, the little computer under it, the glow it throws on the wall
      const rise = 0.13;
      const stand = riser(board(t.home.desk, 2.2, 0.82), 0.92, 0.26, rise);
      stand.position.set(0, DESK_Y, 0.19);
      desk.add(stand);
      desk.add(
        blob(1.0, 0.34, 0.45)
          .translateY(DESK_Y + 0.003)
          .translateZ(0.19)
      );
      const screenUnit = fit(display(), 0.8, 0.62, 0.3);
      screenUnit.position.set(0, DESK_Y + rise, 0.17);
      desk.add(screenUnit);
      desk.add(
        blob(0.36, 0.28, 0.45)
          .translateY(DESK_Y + rise + 0.002)
          .translateZ(0.15)
      );
      const mini = fit(miniComputer(), 0.27, 0.085, 0.27);
      mini.position.set(0.49, DESK_Y, 0.44);
      mini.rotation.y = -0.18;
      desk.add(mini);
      desk.add(
        blob(0.36, 0.36, 0.5)
          .translateX(0.49)
          .translateY(DESK_Y + 0.003)
          .translateZ(0.44)
      );
      for (const [x, col] of [
        [-0.28, '#7A5CFF'],
        [0.3, '#FF8A5C'],
      ] as [number, string][])
        desk.add(
          glow(1.1, 0.95, col, roomLit, (uv) =>
            TSL.smoothstep(0.5, 0.0, TSL.length(uv.sub(0.5).mul(TSL.vec2(1.0, 1.25))))
              .pow(1.6)
              .mul(0.3)
          )
            .translateX(x)
            .translateY(DESK_Y + rise + 0.52)
            .translateZ(0.003)
        );
      // Things that are always here: a mug, a succulent, books, a pothos trailing off the shelf
      const mug = new THREE.Group();
      mug.position.set(0.36, DESK_Y + rise, 0.24);
      desk.add(mug);
      const mugM = new THREE.MeshStandardNodeMaterial({ color: t.home.curtain, roughness: 0.4 });
      mug.add(new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.042, 0.1, 24), mugM).translateY(0.05));
      mug.add(new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.009, 8, 20), mugM).translateX(0.05).translateY(0.05));
      mug.add(blob(0.14, 0.14, 0.5).translateY(0.002));
      const succ = fit(succulent(), 0.16, 0.16, 0.16);
      succ.position.set(-0.36, DESK_Y + rise, 0.22);
      desk.add(succ);
      desk.add(
        blob(0.2, 0.2, 0.5)
          .translateX(-0.36)
          .translateY(DESK_Y + rise + 0.002)
          .translateZ(0.22)
      );
      const hues = [t.accent, t.posterA, t.ink, t.posterB, t.accent2];
      hues.forEach((h, i) => {
        const b = block(
          0.035,
          0.2 + (i % 3) * 0.03,
          0.18,
          new THREE.MeshStandardNodeMaterial({ color: h, roughness: 0.8 })
        );
        b.position.set(-0.92 + i * 0.04, S1 + 0.1 + (i % 3) * 0.015, 0.14);
        desk.add(b);
      });
      // The pot stands on the shelf; its vines trail off the front
      const vine = pothos();
      vine.scale.setScalar(0.62);
      vine.position.set(0.84, S1, 0.13);
      desk.add(vine);
      const plant = fit(buildProduct(4), 0.62, 1.05, 0.62);
      plant.position.set(-1.42, 0, -RD + 0.45);
      plant.rotation.y = 0.7;
      home.add(plant);
      home.add(
        blob(0.6, 0.5, 0.5)
          .translateX(-1.42)
          .translateY(0.004)
          .translateZ(-RD + 0.45)
      );
      const snake = fit(snakePlant(), 0.34, 0.95, 0.34);
      snake.position.set(1.5, 0, -RD + 0.36);
      home.add(snake);
      home.add(
        blob(0.42, 0.42, 0.55)
          .translateX(1.5)
          .translateY(0.004)
          .translateZ(-RD + 0.36)
      );
      const print = slab(
        0.56,
        0.7,
        printed(t.home.room, posterTexture(f, t, 'GOOD DAY', 'MADE AT HOME', t.posterB, '7B'), 1.2),
        board(t.home.room),
        T * 0.6
      );
      print.rotation.y = -Math.PI / 2;
      print.position.set(RX - 0.03, 1.45, -1.4);
      home.add(print);
      // A window in the left wall, the sky in it
      const win = new THREE.Group();
      win.position.set(-RX + 0.005, 1.45, -1.35);
      win.rotation.y = Math.PI / 2;
      home.add(win);
      win.add(
        new THREE.Mesh(new THREE.PlaneGeometry(0.8, 1.0), new THREE.MeshBasicNodeMaterial({ map: skyTexture(t) }))
      );
      const trim = board(t.home.trim, 1.8);
      for (const x of [-0.42, 0, 0.42]) win.add(block(0.05, 1.08, 0.04, trim).translateX(x));
      for (const y of [-0.52, 0, 0.52]) win.add(block(0.88, 0.05, 0.04, trim).translateY(y));
      const curtain = new THREE.MeshStandardNodeMaterial({
        color: t.home.curtain,
        roughness: 0.95,
        side: THREE.DoubleSide,
      });
      for (const x of [-0.56, 0.56])
        win.add(block(0.2, 1.3, 0.02, curtain).translateX(x).translateY(-0.05).translateZ(0.04));

      // The line over the desk: fairy lights along it, the prints pegged on
      const warm = new THREE.Color(t.light.bulbs);
      line = buildPhotoLine(film, {
        slots: 7,
        spacing: 7.4,
        sag: 2.2,
        wall: 0.11 / LS,
        bulbs: 16,
        bulb: () => {
          const lv = level();
          const bm = new THREE.MeshBasicNodeMaterial();
          bm.colorNode = TSL.mix(TSL.vec3(0.3, 0.27, 0.24), TSL.vec3(warm.r * 1.8, warm.g * 1.8, warm.b * 1.8), lv);
          const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.6, 14, 10), bm);
          bulb.scale.set(1, 1.35, 1);
          homeBulbs.push(lv);
          return bulb;
        },
      });
      line.group.position.set(0, 2.42, 0.11);
      line.group.scale.setScalar(LS);
      desk.add(line.group);

      // The instant camera, on the desk; a box round it a tap can't miss
      fuji.group.position.set(CAM_AT[0], CAM_AT[1] + (BODY.h / 2) * CS, CAM_AT[2]);
      fuji.group.rotation.y = -0.55;
      desk.add(fuji.group);
      const hit = new THREE.Mesh(
        new THREE.BoxGeometry(BODY.w * 1.4, BODY.h * 1.6, BODY.d * 2),
        new THREE.MeshBasicNodeMaterial({ visible: false })
      );
      fuji.group.add(hit);
      desk.add(
        blob(0.36, 0.22, 0.5)
          .translateX(CAM_AT[0])
          .translateY(DESK_Y + 0.003)
          .translateZ(CAM_AT[2])
      );
      desk.updateMatrixWorld(true);
      fuji.group.getWorldPosition(deskCam.pos);
      fuji.group.getWorldQuaternion(deskCam.quat);
      // From here on the camera moves in the room, not the desk
      home.attach(fuji.group);

      // What you bought, each where it goes, hidden until it's unpacked
      for (const [kind, spot] of Object.entries(HOME) as [Gadget, (typeof HOME)[Gadget]][]) {
        if (spot.size[0] === 0) continue;
        const g = new THREE.Group();
        g.position.set(DESK_X + spot.at[0], spot.at[1], -RD + spot.at[2]);
        home.add(g);
        g.add(blob(spot.size[0] + 0.1, spot.size[2] + 0.08, 0.55).translateY(0.003));
        const m = fit(buildGadget(kind), ...spot.size);
        m.rotation.y = spot.ry;
        g.add(m);
        g.visible = false;
        placed.set(kind, g);
      }
    }
    // ---- Home, outside: the door, its number, a plant, the bag on the mat ----
    {
      doorLeaf(homeDoor, t.home.door, false);
      home.add(homeDoor);
      const plateMap = plateTexture(f, t, '7B');
      const plateMat = new THREE.MeshStandardNodeMaterial({ map: plateMap, transparent: true, roughness: 0.35 });
      // Polished: it catches what light there is
      plateMat.emissiveNode = TSL.texture(plateMap, TSL.uv()).rgb.mul(0.45);
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.19), plateMat);
      plate.position.set(DW / 2, 1.1, 0.016);
      homeDoor.add(plate);
      // A lever handle both sides, a peephole
      for (const side of [1, -1]) {
        const z = side > 0 ? 0.0 : -DT;
        const rose = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.02, 20), brass);
        rose.rotation.x = Math.PI / 2;
        rose.position.set(DW - 0.1, 1.0, z + side * 0.012);
        homeDoor.add(rose);
        const lever = block(0.16, 0.022, 0.022, brass);
        lever.position.set(DW - 0.17, 1.0, z + side * 0.04);
        homeDoor.add(lever);
      }

      const plant = fit(buildProduct(4), 0.5, 0.82, 0.5);
      plant.position.set(-1.45, 0, 0.42);
      plant.rotation.y = 0.5;
      home.add(plant);
      home.add(blob(0.56, 0.46, 0.55).translateX(-1.45).translateY(0.003).translateZ(0.42));
      const mat = new THREE.Mesh(
        new THREE.PlaneGeometry(0.86, 0.5),
        new THREE.MeshStandardNodeMaterial({ map: matTexture(f, t, 'home'), transparent: true, roughness: 0.95 })
      );
      mat.rotation.x = -Math.PI / 2;
      mat.position.set(0, 0.004, 0.58);
      home.add(mat);
      const bag = carrier(f);
      bag.position.set(0.95, 0, 0.5);
      bag.rotation.y = -0.4;
      home.add(bag);
      // Curtains drawn in the window, lit from behind
      const cx = (WX0 + WX1) / 2;
      const cm = new THREE.MeshStandardNodeMaterial({ color: t.home.curtain, roughness: 0.95, side: THREE.DoubleSide });
      for (const x of [-0.2, 0.2])
        home.add(
          block(0.2, WY1 - WY0, 0.02, cm)
            .translateX(cx + x)
            .translateY((WY0 + WY1) / 2)
            .translateZ(-0.14)
        );
      // A little lamp on the sill inside
      const sill = fit(buildGadget('lamp'), 0.16, 0.24, 0.14);
      sill.position.set(cx, WY0, -0.24);
      home.add(sill);
    }

    applyState(init.bag, init.site);
    ready = true;
  };

  // ---- Post: bloom for the bulbs and neon, a grade, a vignette, grain, the fade between places ----
  const post = new THREE.RenderPipeline(renderer);
  const scenePass = TSL.pass(scene, camera);
  const color = scenePass.getTextureNode('output');
  const lit = color.rgb.add(bloom(color, t.bloom.strength, t.bloom.radius, t.bloom.threshold).rgb);
  const s = TSL.screenUV;
  const vignette = TSL.smoothstep(1.1, 0.25, TSL.length(s.sub(0.5).mul(TSL.vec2(1.0, 1.3))));
  const graded = lit.mul(TSL.vec3(...t.grade));
  const grain = TSL.hash(
    TSL.screenCoordinate.x.add(TSL.screenCoordinate.y.mul(4099)).add(TSL.floor(TSL.time.mul(24)).mul(7919))
  )
    .sub(0.5)
    .mul(0.012);
  post.outputNode = TSL.vec4(
    graded
      .mul(TSL.mix(t.vignette, 1, vignette))
      .add(grain)
      .mul(fade.oneMinus()),
    1
  );

  // ---- The camera: at the door, then in through it ----
  const outside = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 40 };
  const inside = { pos: new THREE.Vector3(0, 1.22, -0.05), look: new THREE.Vector3(0, 1.08, -RD), fov: 50 };
  /** Where you stand inside: among the shelves in the shop; at home, back a step, the desk and the line in view */
  const insideFor = (at: Site) => {
    if (at === 'shop') {
      inside.pos.set(0, 1.22, -0.05);
      inside.look.set(0, 1.08, -RD);
    } else {
      inside.pos.set(0.08, 1.36, -0.02);
      inside.look.set(DESK_X * 0.6, 1.36, -RD);
    }
  };
  insideFor(init.site);
  let path: THREE.CatmullRomCurve3 | null = null;
  const placeOutside = () => {
    camera.aspect = width / height;
    if (wide) {
      outside.fov = 38;
      outside.pos.set(0, 1.5, 5.3);
      outside.look.set(0, 1.32, 0);
      inside.fov = 50;
    } else {
      // The door, filling the screen the way it fills the phone's cover
      outside.fov = 44;
      const half = Math.tan((outside.fov / 2) * DEG);
      const fitH = (DH - DY0) / 2 / half;
      const fitW = DW / 2 / (half * camera.aspect);
      const cy = (DH + DY0) / 2;
      outside.pos.set(0, cy, HZ + Math.min(fitH, fitW) * 0.985);
      outside.look.set(0, cy, HZ);
      inside.fov = 64;
    }
    path = new THREE.CatmullRomCurve3(
      [
        outside.pos.clone(),
        new THREE.Vector3(0, THREE.MathUtils.lerp(outside.pos.y, 1.22, 0.6), 1.3),
        new THREE.Vector3(0, 1.22, 0.5),
        inside.pos.clone(),
      ],
      false,
      'centripetal'
    );
  };
  const look = new THREE.Vector3();
  const placeCamera = (deg: number) => {
    const k = smooth(125, 180, deg);
    if (path) camera.position.copy(path.getPointAt(k));
    look.lerpVectors(outside.look, inside.look, smooth(0, 0.85, k));
    camera.fov = THREE.MathUtils.lerp(outside.fov, inside.fov, k);
    camera.lookAt(look);
    camera.updateProjectionMatrix();
  };
  placeOutside();

  // ---- State ----
  /** The hinge as shown, eased toward its target every frame */
  let target = wide ? Math.PI : 0;
  /** What the hinge last said, and where a hand took hold (null when none has) */
  let reported = target;
  let held: number | null = null;
  let shown = target;
  let lastDeg = shown / DEG;
  let bellA = 0;
  let bellV = 0;
  let neonT = -1;
  let site: Site = init.site;
  let bag: Gadget[] = [...init.bag];
  /** Been all the way in since arriving, so folding up means leaving */
  let beenIn = false;
  let wasInside = false;
  let bagBump = 1;
  const flights: { obj: THREE.Object3D; from: THREE.Vector3; s0: number; t: number }[] = [];
  const raycaster = new THREE.Raycaster();

  // ---- Taking a photo at home ----
  let shot: Shot = 'none';
  let shotT = 0;
  let aimK = 0;
  let aimYaw = 0;
  let aimPitch = 0;
  let wantShot = false;
  let flash = 0;
  let dev = 0;
  let lastDev = -1;
  let energy = 0;
  let lastPeak = 0;
  let tiltX = 0;
  let tiltY = 0;
  let haveMotion = false;
  let motion: Motion | null = null;
  let charged = false;
  let lensOut = false;
  let camBack = -1;
  let photo: THREE.RenderTarget | null = null;
  /** The photo's on the line now: it's that print's, not ours to throw away */
  let photoHung = false;
  let pending: ReturnType<PhotoLine['prepare']> | null = null;
  let hangSlot = 0;
  let hungCount = 0;
  let clipped = false;
  let elapsed = 0;
  const wobble = new THREE.Vector2();
  const flow = new THREE.Vector2();
  const lp = new THREE.Vector3();
  const hp = new THREE.Vector3();
  const photoCam = new THREE.PerspectiveCamera(30, 46 / 62, 0.03, 60);
  const eyeAt = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const upV = new THREE.Vector3();
  const pose = new THREE.Object3D();
  const camFrom = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
  const printFrom = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), scale: CS };
  const tq = new THREE.Quaternion();
  const tv = new THREE.Vector3();
  const tv2 = new THREE.Vector3();
  const te = new THREE.Euler();
  const deskLight = new THREE.Color();
  const WHITE = new THREE.Color(1, 1, 1);
  const yAxis = new THREE.Vector3(0, 1, 0);
  const xAxis = new THREE.Vector3(1, 0, 0);

  const setShot = (next: Shot) => {
    shot = next;
    shotT = 0;
    events.onShot(next);
  };
  /** Held up in front of you, its front (the lens) to you */
  const holdPose = (out: THREE.Object3D) => {
    out.position.copy(eyeAt).addScaledVector(fwd, 0.6).addScaledVector(upV, -0.05);
    out.lookAt(eyeAt);
    return out;
  };
  /** Turned round, its back to you */
  const backPose = (out: THREE.Object3D) => {
    holdPose(out);
    out.quaternion.multiply(tq.setFromAxisAngle(yAxis, Math.PI));
    return out;
  };
  /** Up to your eye: its eyepiece right in front of it */
  const eyepiecePose = (out: THREE.Object3D) => {
    backPose(out);
    tv.set(EYEPIECE.x, EYEPIECE.y, -BODY.d / 2 - 0.3)
      .multiplyScalar(CS)
      .applyQuaternion(out.quaternion);
    out.position.copy(eyeAt).addScaledVector(fwd, 0.03).sub(tv);
    return out;
  };
  /** Pulled back down from your eye, tipped forward so you see the print come up out of the top */
  const ejectPose = (out: THREE.Object3D) => {
    backPose(out);
    out.position.copy(eyeAt).addScaledVector(fwd, 0.8).addScaledVector(upV, -0.17);
    out.quaternion.multiply(tq.setFromAxisAngle(xAxis, -0.42));
    return out;
  };
  /** The print, up close in front of you */
  const presentPose = (out: THREE.Object3D) => {
    out.position.copy(eyeAt).addScaledVector(fwd, 0.52).addScaledVector(upV, 0.035);
    out.lookAt(eyeAt);
    return out;
  };
  const camTo = (from: { pos: THREE.Vector3; quat: THREE.Quaternion }, k: number, lift = 0) => {
    fuji.group.position.lerpVectors(from.pos, pose.position, k).addScaledVector(yAxis, Math.sin(Math.PI * k) * lift);
    fuji.group.quaternion.slerpQuaternions(from.quat, pose.quaternion, k);
  };
  const putBack = () => {
    fuji.group.position.copy(deskCam.pos);
    fuji.group.quaternion.copy(deskCam.quat);
    fuji.group.visible = true;
    fuji.setOn(false);
    lensOut = false;
    charged = false;
    camBack = -1;
  };
  function abortShot() {
    if (shot === 'none') return;
    putBack();
    print.visible = false;
    aimK = 0;
    pending = null;
    shot = 'none';
    events.onShot('none');
  }

  /** The shot itself: the view in the viewfinder's window, rendered with the flash going off */
  const takePhoto = () => {
    const rt = new THREE.RenderTarget(512, 690, {
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
    });
    photoCam.position.copy(camera.position);
    photoCam.quaternion.copy(camera.quaternion);
    photoCam.fov = (2 * Math.atan(Math.tan((camera.fov / 2) * DEG) * FINDER)) / DEG;
    photoCam.updateProjectionMatrix();
    photoCam.updateMatrixWorld();
    flashLight.position.copy(camera.position).addScaledVector(upV, 0.05);
    flashLight.intensity = 1.3;
    const keep = fuji.group.visible;
    fuji.group.visible = false;
    print.visible = false;
    renderer.setRenderTarget(rt);
    renderer.render(scene, photoCam);
    renderer.setRenderTarget(null);
    fuji.group.visible = keep;
    if (photo && !photoHung) photo.dispose();
    photoHung = false;
    photo = rt;
    // A render target's rows run top first
    film.chem.flip.value = 1;
    film.setPhoto(rt.texture);
  };

  /** Each frame: where the shot's got to, the camera and the print moved to match */
  const stepShot = (dt: number, deg: number) => {
    shotT += dt;
    elapsed += dt;
    // The eye, as the hinge has placed it; aiming turns it and narrows it
    eyeAt.copy(camera.position);
    camera.getWorldDirection(fwd);
    upV.set(0, 1, 0);
    aimK += ((shot === 'aim' ? 1 : 0) - aimK) * (1 - Math.exp(-dt * 7));
    if (aimK > 0.001) {
      camera.rotateY(aimYaw * aimK);
      camera.rotateX(aimPitch * aimK);
      camera.fov = THREE.MathUtils.lerp(camera.fov, 44, aimK);
      camera.updateProjectionMatrix();
    }

    // The flash, lighting the room and fading
    flash = Math.max(0, flash - dt * 5);
    flashLight.intensity = 6 * flash * flash;

    // Light on the camera: the room's, warm and dim on the desk; full in your hand
    const room = roomLit.value as number;
    deskLight.setRGB(0.95, 0.82, 0.66).multiplyScalar(0.25 + 0.5 * room);
    const heldK = shot === 'raise' ? ease(shotT / 1.0) : shot === 'none' || shot === 'putdown' || camBack >= 0 ? 0 : 1;
    fuji.light.value.copy(deskLight).lerp(WHITE, heldK);
    film.lineLight.value.setRGB(0.92, 0.84, 0.74).multiplyScalar(0.35 + 0.6 * room);
    // Held up, it's in the lamp's light, warm, kept under the bloom
    film.held.value.setRGB(0.86, 0.8, 0.72);
    fuji.update(dt);

    // Fold the phone part way and you put it all down
    if (shot !== 'none' && shot !== 'hang' && deg < 172) {
      abortShot();
      return;
    }

    switch (shot) {
      case 'raise': {
        holdPose(pose);
        camTo(camFrom, ease(shotT / 1.0), 0.12);
        if (shotT >= 0.55 && !lensOut) {
          lensOut = true;
          fuji.setOn(true);
          events.onSound('lens');
          events.onHaptic('lens');
          setTimeout(() => events.onSound('charge'), 180);
        }
        if (lensOut) fuji.lamp('charging', elapsed);
        if (shotT >= 1.0) setShot('ready');
        break;
      }
      case 'ready': {
        holdPose(pose);
        fuji.group.position.copy(pose.position).addScaledVector(yAxis, Math.sin(shotT * 3) * 0.004);
        fuji.group.quaternion.copy(pose.quaternion);
        if (shotT < 0.7) fuji.lamp('charging', elapsed);
        else if (!charged) {
          charged = true;
          fuji.lamp('ready', elapsed);
          events.onHaptic('ready');
        }
        if (shotT >= 0.95) {
          camFrom.pos.copy(fuji.group.position);
          camFrom.quat.copy(fuji.group.quaternion);
          setShot('dive');
        }
        break;
      }
      case 'dive': {
        // Turned round, then up to your eye until the eyepiece is all you see
        const turn = ease(shotT / 0.55);
        const close = ease((shotT - 0.3) / 0.6);
        backPose(pose);
        const back = pose.quaternion.clone();
        holdPose(pose);
        fuji.group.quaternion.slerpQuaternions(camFrom.quat, back, turn);
        eyepiecePose(pose);
        fuji.group.position.lerpVectors(camFrom.pos, pose.position, close);
        if (shotT >= 0.9) {
          fuji.group.visible = false;
          aimYaw = 0;
          aimPitch = 0;
          setShot('aim');
        }
        break;
      }
      case 'eject': {
        // Out of your eye and down; the print comes up out of the slot on the motor, in steps
        ejectPose(pose);
        fuji.group.visible = true;
        camTo(camFrom, ease(shotT / 0.35));
        const k = clamp01((shotT - 0.3) / 1.25);
        const stepped = k + Math.sin(k * Math.PI * 22) * 0.008;
        fuji.group.updateMatrixWorld();
        print.position
          .set(SLOT.x, TOP - FILM.h / 2 - 0.2 + stepped * (FILM.h - 1.1), SLOT.z)
          .applyMatrix4(fuji.group.matrixWorld);
        print.quaternion.copy(fuji.group.quaternion).multiply(tq.setFromAxisAngle(yAxis, Math.PI));
        print.scale.setScalar(CS);
        print.visible = true;
        if (shotT >= 1.6) {
          printFrom.pos.copy(print.position);
          printFrom.quat.copy(print.quaternion);
          camFrom.pos.copy(fuji.group.position);
          camFrom.quat.copy(fuji.group.quaternion);
          camBack = 0;
          setShot('present');
        }
        break;
      }
      case 'present':
      case 'developing':
      case 'developed': {
        presentPose(pose);
        if (shot === 'present') {
          const k = ease(shotT / 1.2);
          print.position
            .lerpVectors(printFrom.pos, pose.position, k)
            .addScaledVector(upV, Math.sin(Math.PI * k) * 0.08);
          print.quaternion.slerpQuaternions(printFrom.quat, pose.quaternion, easeOut(shotT / 1.0));
          if (shotT >= 1.2) setShot('developing');
        } else {
          te.set(
            0.06 + tiltX + wobble.y * 0.5,
            tiltY + wobble.x * 0.5 + (haveMotion ? 0 : Math.sin(elapsed * 0.6) * 0.1),
            -0.04 + wobble.x * 0.25
          );
          tq.setFromEuler(te);
          print.quaternion.slerp(pose.quaternion.multiply(tq), Math.min(1, dt * 8));
          tv2.copy(fwd).cross(upV);
          print.position
            .copy(presentPose(pose).position)
            .addScaledVector(tv2, wobble.x * 0.03)
            .addScaledVector(upV, wobble.y * 0.03);
          dev = Math.min(1, dev + dt * (1 / DEVELOP + energy * 0.17));
          if (Math.abs(dev - lastDev) > 0.01 || (dev >= 1 && lastDev < 1)) {
            lastDev = dev;
            events.onDevelop(dev);
          }
          if (shot === 'developing' && dev >= 1) {
            events.onHaptic('ready');
            setShot('developed');
          }
        }
        break;
      }
      case 'hang': {
        // Up onto the line, the view glancing after it; then the peg snaps shut
        if (line) {
          const HANG = 1.7;
          const k = ease(shotT / HANG);
          line.restPose(hangSlot, tv).applyMatrix4(line.group.matrixWorld);
          print.position.lerpVectors(printFrom.pos, tv, k).addScaledVector(upV, Math.sin(Math.PI * k) * 0.25);
          line.group.getWorldQuaternion(tq);
          tq.multiply(
            new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.sin(Math.PI * k) * -0.2)
          );
          print.quaternion.slerpQuaternions(printFrom.quat, tq, easeOut(shotT / (HANG * 0.9)));
          print.scale.setScalar(THREE.MathUtils.lerp(printFrom.scale, LS, k));
          if (shotT >= HANG && !clipped && pending) {
            clipped = true;
            pending.clip(0.5);
            photoHung = true;
            print.visible = false;
            events.onSound('lens');
            events.onHaptic('shutter');
            events.onPrints(line.count());
          }
          if (shotT >= HANG + 0.4) {
            pending = null;
            setShot('none');
          }
        }
        break;
      }
      case 'toss': {
        // Tossed up and away, and the camera's picked up again
        const k = clamp01(shotT / 0.6);
        const toss = k * k;
        print.position
          .copy(printFrom.pos)
          .addScaledVector(upV, toss * 0.9)
          .addScaledVector(fwd, toss * 0.5);
        te.set(toss * 0.6, toss * 0.8, -toss * 1.2);
        print.quaternion.copy(printFrom.quat).multiply(tq.setFromEuler(te));
        if (shotT >= 0.6) {
          print.visible = false;
          camFrom.pos.copy(fuji.group.position);
          camFrom.quat.copy(fuji.group.quaternion);
          setShot('raise');
        }
        break;
      }
      case 'putdown': {
        pose.position.copy(deskCam.pos);
        pose.quaternion.copy(deskCam.quat);
        fuji.group.visible = true;
        camTo(camFrom, ease(shotT / 0.9), 0.08);
        if (shotT >= 0.9) {
          putBack();
          setShot('none');
        }
        break;
      }
      default:
        break;
    }

    // The camera, done with, goes back to the desk while you look at the print
    if (camBack >= 0) {
      camBack += dt;
      pose.position.copy(deskCam.pos);
      pose.quaternion.copy(deskCam.quat);
      camTo(camFrom, ease(camBack / 1.1), 0.1);
      if (camBack >= 1.1) putBack();
    }

    // Shaking the print: the phone's own motion, or a drag
    const m = motion?.();
    let shakeNow = 0;
    if (m) {
      haveMotion = true;
      tv.set(m.ax, m.ay, m.az);
      lp.lerp(tv, 1 - Math.exp(-dt * 4));
      hp.subVectors(tv, lp);
      shakeNow = hp.length();
      tiltX += (THREE.MathUtils.clamp(m.gz / 9.81, -1, 1) * 0.45 - tiltX) * Math.min(1, dt * 6);
      tiltY += (THREE.MathUtils.clamp(-m.gx / 9.81, -1, 1) * 0.55 - tiltY) * Math.min(1, dt * 6);
    }
    if ((shot === 'developing' || shot === 'developed') && shakeNow > 0) {
      energy = Math.max(energy, THREE.MathUtils.smoothstep(shakeNow, 3, 16));
      if (shakeNow > 9 && elapsed - lastPeak > 0.13) {
        lastPeak = elapsed;
        flow.x += hp.x * 0.04;
        flow.y += hp.y * 0.04;
        events.onHaptic('shake');
      }
      wobble.x += (hp.x * 0.025 - wobble.x) * Math.min(1, dt * 18);
      wobble.y += (hp.y * 0.025 - wobble.y) * Math.min(1, dt * 18);
    }
    energy *= Math.exp(-dt * 2.2);
    wobble.multiplyScalar(Math.exp(-dt * 5));
    film.chem.dev.value = dev;
    film.chem.swirl.value += (energy - (film.chem.swirl.value as number)) * Math.min(1, dt * 5);
    film.chem.flow.value.copy(flow);
    if ((film.sweep.value as number) < 1) film.sweep.value = Math.min(1, (film.sweep.value as number) + dt / 0.85);
    filmTime.value = elapsed;
    line?.update(dt, elapsed);
  };

  const total = () => bag.reduce((n, k) => n + GADGETS[k].price, 0);
  const setTill = () => {
    if (tillTex && fonts) repaint(tillTex, screenTexture(fonts, `$${total().toLocaleString('en-US')}`));
  };
  function applyState(b: Gadget[], at: Site) {
    bag = [...b];
    site = at;
    for (const g of goods) {
      const sold = bag.includes(g.kind);
      g.lift.visible = !sold;
      g.tag.visible = !sold;
      g.sold.visible = sold;
    }
    for (const [k, g] of placed) g.visible = site === 'home' && bag.includes(k);
    shop.visible = site === 'shop';
    home.visible = site === 'home';
    setTill();
    insideFor(site);
    placeOutside();
    abortShot();
  }

  const buy = (g: (typeof goods)[number]) => {
    bag.push(g.kind);
    g.lift.visible = false;
    g.tag.visible = false;
    g.sold.visible = true;
    // A copy flies to the bag; the one on the shelf is gone
    const fly = g.model.clone();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    g.model.updateMatrixWorld(true);
    g.model.matrixWorld.decompose(pos, quat, scl);
    fly.position.copy(pos);
    fly.quaternion.copy(quat);
    fly.scale.copy(scl);
    scene.add(fly);
    flights.push({ obj: fly, from: pos, s0: scl.x, t: 0 });
    setTill();
    events.onHaptic('buy');
    events.onBag([...bag]);
  };

  const arrive = () => {
    applyState(bag, 'home');
    beenIn = false;
    fade.value = 1;
    neonT = -1;
    events.onHaptic('arrive');
    events.onSite('home');
  };

  const mid = new THREE.Vector3();
  const step = (dt: number) => {
    // Eased toward the hinge: it reports in steps, the door moves smoothly
    shown += (target - shown) * (1 - Math.exp(-dt * 14));
    const deg = shown / DEG;
    const before = lastDeg;
    lastDeg = deg;
    const inShop = site === 'shop';

    // The door is the phone
    (inShop ? shopDoor : homeDoor).rotation.y = -shown;

    // The bell: knocked as the door goes, it swings and settles
    if (inShop && (passedUp(before, deg, 3) || passedUp(deg, before, 3))) {
      bellV += deg > before ? 9 : -6;
      if (deg > before) events.onHaptic('bell');
    }
    bellV += (-bellA * 160 - bellV * 3.2) * dt;
    bellA += bellV * dt;
    bell.rotation.z = bellA * 0.35;

    // The sign swings round to OPEN
    signPivot.rotation.y = Math.PI * backOut(smooth(12, 34, deg));
    if (inShop && passedUp(before, deg, 22)) events.onHaptic('sign');

    // Inside, the bulbs come on one by one, and the room with them
    const bulbs = inShop ? shopBulbs : homeBulbs;
    bulbs.forEach((b, i) => {
      const at = 30 + i * 3.6;
      b.value = smooth(at, at + 5, deg);
      if (i % 2 === 0 && passedUp(before, deg, at + 2.5)) events.onHaptic('bulb');
    });
    const room = smooth(22, 82, deg);
    roomLit.value = room;
    const power = t.light.inside * (inShop ? 1 : 0.85);
    roomFront.intensity = power * (0.08 + 0.92 * room);
    roomBack.intensity = power * 0.8 * (0.08 + 0.92 * room);
    spill.value = smooth(2, 70, deg) * (0.25 + 0.75 * room) * (1 - smooth(150, 175, deg));
    leak.value = 1 - smooth(1, 10, deg);
    lampLevel.value = 1;

    // Out under the awning, then the neon in the window
    if (inShop) {
      awningBulbs.forEach((b, i) => {
        const at = 95 + i * 2.6;
        b.value = smooth(at, at + 4, deg);
        if (i % 3 === 0 && passedUp(before, deg, at + 2)) events.onHaptic('bulb');
      });
      if (passedUp(before, deg, 112)) {
        neonT = 0;
        events.onHaptic('neon');
      } else if (deg < 104) neonT = -1;
      if (neonT >= 0) {
        neonT += dt;
        const k = neonT;
        neonLevel.value = k < 0.06 ? 1 : k < 0.14 ? 0.1 : k < 0.2 ? 0.7 : k < 0.27 ? 0.05 : 1;
      } else neonLevel.value = 0;
    }

    // In through the door
    placeCamera(deg);
    if (!inShop) stepShot(dt, deg);
    if (passedUp(before, deg, 160)) events.onHaptic('step');
    if (passedUp(before, deg, 178)) events.onHaptic('settle');
    if (deg > 170) beenIn = true;
    const nowInside = deg > 165;
    if (nowInside !== wasInside) {
      wasInside = nowInside;
      events.onInside(nowInside);
    }

    // At home, the bag's unpacked as you come in: each thing set down where it goes, in turn
    if (!inShop)
      bag.forEach((k, i) => {
        const g = placed.get(k);
        if (!g) return;
        const at = 138 + i * 3.4;
        const e = smooth(at, at + 9, deg);
        g.visible = e > 0.001;
        g.scale.setScalar(Math.max(0.001, backOut(e)));
        if (passedUp(before, deg, at + 4)) events.onHaptic('place');
      });

    if (bagBody) {
      bagBump = Math.min(1, bagBump + dt / 0.35);
      const squash = Math.sin(bagBump * Math.PI);
      bagBody.scale.set(1 + squash * 0.08, 1 - squash * 0.06, 1);
      // Up into view as you come in, held just inside the bottom corner
      const rise = inShop ? smooth(150, 176, deg) : 0;
      const d = 1.0;
      const hh = d * Math.tan((camera.fov / 2) * DEG);
      const hw = hh * camera.aspect;
      bagBody.visible = rise > 0.001;
      bagBody.position.set(hw * 0.8, -hh - 0.4 + rise * 0.31, -d);
      bagBody.rotation.set(0.2, -0.5, 0.05);
      bagBody.scale.multiplyScalar(0.72);
      bagBody.localToWorld(bagAt.set(0, 0.34, 0));
    }

    // What was bought, on its way into the bag
    for (let i = flights.length - 1; i >= 0; i--) {
      const fl = flights[i];
      fl.t = Math.min(1, fl.t + dt / 0.7);
      const e = fl.t * fl.t * (3 - 2 * fl.t);
      mid.lerpVectors(fl.from, bagAt, 0.5).y += 0.55;
      const a = 1 - e;
      fl.obj.position.set(
        a * a * fl.from.x + 2 * a * e * mid.x + e * e * bagAt.x,
        a * a * fl.from.y + 2 * a * e * mid.y + e * e * bagAt.y,
        a * a * fl.from.z + 2 * a * e * mid.z + e * e * bagAt.z
      );
      fl.obj.rotation.y += dt * 7;
      fl.obj.scale.setScalar(fl.s0 * (1 - 0.85 * e));
      if (fl.t >= 1) {
        scene.remove(fl.obj);
        flights.splice(i, 1);
        bagBump = 0;
        events.onHaptic('drop');
      }
    }
    // Shut the door behind you with something in the bag, and you're home
    if (inShop && bag.length && beenIn && deg < 1.5 && flights.length === 0) arrive();
    fade.value = Math.max(0, (fade.value as number) - dt * 1.6);
  };

  let last = performance.now();
  let warmed = false;
  let failed = false;
  let onFirstFrame: (() => void) | null = null;
  void build();

  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!ready || failed) return;
    try {
      if (!warmed) {
        // Compile everything that turns up later now, not mid-opening: both places, open and not
        warmed = true;
        const keep = shown;
        const keepSite = site;
        for (const at of ['shop', 'home'] as Site[]) {
          shop.visible = at === 'shop';
          home.visible = at === 'home';
          for (const g of placed.values()) g.visible = at === 'home';
          print.visible = at === 'home';
          print.position.set(0, 1.3, -1);
          for (const a of [Math.PI, Math.PI * 0.6]) {
            shown = a;
            lastDeg = a / DEG;
            step(0);
            post.render();
          }
        }
        print.visible = false;
        applyState(bag, keepSite);
        shown = keep;
        lastDeg = keep / DEG;
        bellA = bellV = 0;
        neonT = keep > 112 * DEG ? 1 : -1;
      }
      step(dt);
      if (wantShot) {
        wantShot = false;
        takePhoto();
      }
      post.render();
      context.present();
    } catch (e) {
      if (__DEV__) console.error('[corner-shop]', e);
      failed = true;
      return;
    }
    if (onFirstFrame) {
      const cb = onFirstFrame;
      onFirstFrame = null;
      cb();
    }
  });

  const ndc = new THREE.Vector2();
  return {
    /** The hinge's angle in radians, 0 shut to π flat (a hand on it takes over until let go) */
    setAngle(angle: number) {
      reported = Math.min(Math.PI, Math.max(0, angle));
      if (held === null) target = reported;
    },
    /** Snap straight to an angle (a new screen, a dev peek) */
    jumpAngle(angle: number) {
      reported = target = shown = Math.min(Math.PI, Math.max(0, angle));
      lastDeg = shown / DEG;
      neonT = shown > 112 * DEG ? 1 : -1;
    },
    /** A hand working the hinge: grab, move by a fraction of the screen's width, let go */
    grab() {
      held = target;
    },
    drag(fraction: number) {
      if (held === null) return;
      target = Math.min(Math.PI, Math.max(0, held + fraction * Math.PI * 1.2));
    },
    release() {
      held = null;
      target = reported;
    },
    /** A tap at a point on screen (0..1 each way): in the shop, buys what's there; at home, picks up the camera */
    tap(x: number, y: number) {
      if (!ready) return;
      ndc.set(x * 2 - 1, -(y * 2 - 1));
      raycaster.setFromCamera(ndc, camera);
      if (site === 'home') {
        if (shot !== 'none' || shown / DEG < 172) return;
        if (!raycaster.intersectObject(fuji.group, true).length) return;
        camFrom.pos.copy(fuji.group.position);
        camFrom.quat.copy(fuji.group.quaternion);
        events.onHaptic('tick');
        setShot('raise');
        return;
      }
      if (shown / DEG < 165) return;
      const hits = raycaster.intersectObjects(
        goods.filter((g) => g.lift.visible).map((g) => g.lift),
        true
      );
      if (!hits.length) return;
      let o: THREE.Object3D | null = hits[0].object;
      while (o && !goods.some((g) => g.lift === o)) o = o.parent;
      const g = goods.find((x) => x.lift === o);
      if (g) buy(g);
    },
    /** A drag: aims the viewfinder, or shakes the print (where there are no motion sensors) */
    panBy(dx: number, dy: number) {
      if (shot === 'aim') {
        aimYaw = THREE.MathUtils.clamp(aimYaw + dx * 0.0022, -0.6, 0.6);
        aimPitch = THREE.MathUtils.clamp(aimPitch + dy * 0.0022, -0.45, 0.35);
        return;
      }
      if (shot !== 'developing' && shot !== 'developed') return;
      const v = Math.hypot(dx, dy);
      energy = Math.max(energy, THREE.MathUtils.smoothstep(v, 4, 40));
      wobble.x += dx * 0.004;
      wobble.y -= dy * 0.004;
      if (v > 18 && elapsed - lastPeak > 0.12) {
        lastPeak = elapsed;
        flow.x += dx * 0.01;
        flow.y -= dy * 0.01;
        events.onHaptic('shake');
      }
    },
    /** Whether a drag now belongs to the photo rather than the hinge */
    shooting() {
      return shot !== 'none';
    },
    setMotion(m: Motion | null) {
      motion = m;
    },
    /** The shutter: the flash fires, the photo is taken, the print comes out */
    shutter() {
      if (shot !== 'aim') return;
      wantShot = true;
      fuji.fire();
      flash = 1;
      events.onSound('shutter');
      events.onHaptic('shutter');
      dev = 0;
      lastDev = -1;
      energy = 0;
      flow.set(Math.random() * 10, Math.random() * 10);
      setTimeout(() => {
        events.onSound('eject');
        events.onHaptic('motor');
      }, 300);
      eyepiecePose(pose);
      camFrom.pos.copy(pose.position);
      camFrom.quat.copy(pose.quaternion);
      setShot('eject');
    },
    /** Put the camera down without taking one */
    cancelAim() {
      if (shot !== 'aim') return;
      eyepiecePose(pose);
      camFrom.pos.copy(pose.position);
      camFrom.quat.copy(pose.quaternion);
      setShot('putdown');
    },
    /** Up on the line with it */
    hang() {
      if (shot !== 'developed' || !line || !photo) return;
      hangSlot = SLOT_ORDER[hungCount++ % SLOT_ORDER.length];
      pending = line.prepare(hangSlot, photo.texture);
      pending.showPin();
      clipped = false;
      printFrom.pos.copy(print.position);
      printFrom.quat.copy(print.quaternion);
      printFrom.scale = print.scale.x;
      void renderer.compileAsync(pending.print, camera, scene).catch(() => undefined);
      events.onHaptic('tick');
      setShot('hang');
    },
    /** Toss this one and take another */
    again() {
      if (shot !== 'developed' && shot !== 'developing') return;
      printFrom.pos.copy(print.position);
      printFrom.quat.copy(print.quaternion);
      events.onHaptic('tick');
      setShot('toss');
    },
    /** One of the film looks, swept across the print */
    setFilmLook(i: number) {
      film.setLook(FILM_LOOKS[i]);
      events.onHaptic('tick');
      events.onSound('eject');
    },
    /** Back to the shop with an empty bag */
    shopAgain() {
      applyState([], 'shop');
      beenIn = false;
      fade.value = 1;
      events.onBag([]);
      events.onSite('shop');
    },
    resize(w: number, h: number, ratio: number, isWide: boolean) {
      width = w;
      height = h;
      wide = isWide;
      const c = context.canvas as unknown as { width: number; height: number };
      c.width = w * ratio;
      c.height = h * ratio;
      renderer.setSize(w * ratio, h * ratio, false);
      placeOutside();
      placeCamera(shown / DEG);
    },
    debug() {
      return { target: target / DEG, shown: shown / DEG, ready, wide, failed, site, bag, shot, dev };
    },
    onFirstFrame(cb: () => void) {
      onFirstFrame = cb;
    },
    dispose() {
      renderer.setAnimationLoop(null);
      photo?.dispose();
      post.dispose();
      renderer.dispose();
    },
  };
}

export type CornerShop = ReturnType<typeof createCornerShop>;
