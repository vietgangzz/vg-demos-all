import * as THREE from 'three/webgpu';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * An instant camera in the old rangefinder manner, at true size (a unit is a centimetre): a
 * landscape body 12.2 × 9.2 × 5, wrapped in pebbled leatherette between a brushed metal top plate
 * and base plate, a knurled chrome ring round a big lens, the shutter button and a mode dial on
 * top. The lens barrel pulls out to switch it on; prints come out of a slot in the top, behind the
 * dials. Its front faces +z. No maker's name or logo: just the shapes.
 */

export const BODY = { w: 12.2, h: 9.2, d: 5.0, r: 0.55 };
const FRONT = BODY.d / 2;
const BACK = -BODY.d / 2;
const TOP = BODY.h / 2;
/** The metal plates: the top one this deep, the base this deep; leatherette between */
export const PLATES = { top: 1.7, bottom: 0.8 };

/** Where things sit on the front, in (x, y) */
export const LENS = { x: -0.7, y: -0.35, bezel: 3.05, barrel: 2.55 };
export const FLASH = { x: 3.65, y: 3.72, w: 2.6, h: 0.95 };
export const FINDER = { x: -4.45, y: 3.72, w: 1.5, h: 0.95 };
/** On top: the shutter button at the right, a mode dial at the left, in (x, z) */
export const SHUTTER = { x: 4.05, z: 0.55, r: 0.62 };
export const DIAL = { x: -3.75, z: 0.45, r: 0.95 };
/** The eyepiece on the back, seen from behind at the top left */
export const EYEPIECE = { x: 4.3, y: 3.62, w: 1.8, h: 1.3 };
/** The film slot on top, behind the dials, and how far the lens travels out */
export const SLOT = { x: 0.3, z: -1.3, w: 6.2, d: 0.22 };
export const LENS_TRAVEL = 1.15;

type P = [number, number];

/** A part turned on a lathe about the z axis (the lens's axis), from a (radius, height) profile */
function turnedZ(profile: P[], segments = 112, crease = Math.PI / 5) {
  const lathe = new THREE.LatheGeometry(
    profile.map(([r, h]) => new THREE.Vector2(r, h)),
    segments
  );
  lathe.rotateX(Math.PI / 2);
  return toCreasedNormals(lathe, crease);
}

/** The same about the y axis, for the parts on top */
function turnedY(profile: P[], segments = 96, crease = Math.PI / 5) {
  const lathe = new THREE.LatheGeometry(
    profile.map(([r, h]) => new THREE.Vector2(r, h)),
    segments
  );
  return toCreasedNormals(lathe, crease);
}

function roundedRect(w: number, h: number, r: number) {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/** A rounded-rect plaque `depth` deep, its face toward +z, softly bevelled */
function plaque(w: number, h: number, r: number, depth: number, bevel = 0.04) {
  const g = new THREE.ExtrudeGeometry(roundedRect(w, h, r), {
    depth,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
    curveSegments: 10,
  });
  return toCreasedNormals(g, Math.PI / 3);
}

export function bodyGeometry() {
  return new RoundedBoxGeometry(BODY.w, BODY.h, BODY.d, 6, BODY.r);
}

/** The knurled chrome ring round the lens, standing proud of the leatherette */
export function bezelGeometry() {
  const g = turnedZ([
    [LENS.bezel + 0.02, 0],
    [LENS.bezel, 0.32],
    [LENS.bezel - 0.06, 0.38],
    [LENS.bezel - 0.3, 0.4],
    [LENS.bezel - 0.36, 0.5],
    [LENS.barrel + 0.08, 0.52],
    [LENS.barrel + 0.05, 0.25],
  ]);
  g.translate(LENS.x, LENS.y, FRONT - 0.02);
  return g;
}

/** The barrel that slides out */
export function barrelGeometry() {
  return turnedZ([
    [LENS.barrel - 0.02, -1.3],
    [LENS.barrel, -1.2],
    [LENS.barrel, 0.12],
    [LENS.barrel - 0.06, 0.22],
  ]);
}

/** The black ring holding the glass, its face marked like a focusing scale */
export function lensRingGeometry() {
  return turnedZ([
    [LENS.barrel - 0.08, 0.2],
    [LENS.barrel - 0.14, 0.36],
    [2.1, 0.42],
    [1.92, 0.4],
    [1.7, 0.28],
    [1.62, 0.1],
  ]);
}

/** The front element: a shallow dome of glass */
export function lensGlassGeometry() {
  const R = 3.0;
  const half = Math.asin(1.64 / R);
  const g = new THREE.SphereGeometry(R, 64, 24, 0, Math.PI * 2, 0, half);
  g.rotateX(Math.PI / 2);
  g.translate(0, 0, 0.1 - R * Math.cos(half));
  return g;
}

export function flashGeometry() {
  const g = plaque(FLASH.w, FLASH.h, 0.18, 0.06);
  g.translate(FLASH.x, FLASH.y, FRONT - 0.03);
  return g;
}

export function finderGeometry() {
  const g = plaque(FINDER.w, FINDER.h, 0.16, 0.06);
  g.translate(FINDER.x, FINDER.y, FRONT - 0.03);
  return g;
}

/** The shutter button on top: a chrome cap in a collar */
export function shutterGeometry() {
  // Profiles run from the bottom up the outside, so the faces turn outward
  const g = turnedY([
    [SHUTTER.r + 0.16, 0],
    [SHUTTER.r + 0.16, 0.08],
    [SHUTTER.r + 0.12, 0.2],
    [SHUTTER.r, 0.22],
    [SHUTTER.r - 0.04, 0.35],
    [SHUTTER.r - 0.14, 0.41],
    [0, 0.42],
  ]);
  g.translate(SHUTTER.x, TOP - 0.02, SHUTTER.z);
  return g;
}

/** The mode dial on top, knurled round its edge */
export function dialGeometry() {
  const g = turnedY([
    [DIAL.r - 0.18, 0],
    [DIAL.r - 0.18, 0.06],
    [DIAL.r, 0.12],
    [DIAL.r, 0.55],
    [DIAL.r - 0.08, 0.61],
    [0, 0.62],
  ]);
  g.translate(DIAL.x, TOP - 0.02, DIAL.z);
  return g;
}

/** The engraved top faces of the dials, flat discs just above them */
export function dialFaceGeometry() {
  const g = new THREE.CircleGeometry(DIAL.r - 0.06, 72);
  g.rotateX(-Math.PI / 2);
  g.translate(DIAL.x, TOP - 0.02 + 0.625, DIAL.z);
  return g;
}

/** The slot the film comes out of, a dark recess in the top */
export function slotGeometry() {
  const g = plaque(SLOT.w, SLOT.d, SLOT.d / 2 - 0.01, 0.03, 0.02);
  g.rotateX(-Math.PI / 2);
  g.translate(SLOT.x, TOP + 0.005, SLOT.z);
  return g;
}

/** Strap lugs: a small chrome eyelet on each side */
export function lugGeometry() {
  const a = new THREE.TorusGeometry(0.32, 0.075, 12, 32);
  a.rotateY(Math.PI / 2);
  a.translate(BODY.w / 2 + 0.22, TOP - 1.05, 0);
  const b = a.clone();
  b.translate(-BODY.w - 0.44, 0, 0);
  return [a, b];
}

/** The back: a rubber eyepiece, the film door and its counter window, the lamp */
export function eyepieceGeometry() {
  const g = plaque(EYEPIECE.w, EYEPIECE.h, 0.35, 0.3, 0.07);
  g.rotateY(Math.PI);
  g.translate(EYEPIECE.x, EYEPIECE.y, BACK + 0.02);
  return g;
}

export function eyepieceGlassGeometry() {
  const g = new THREE.ShapeGeometry(roundedRect(EYEPIECE.w - 0.6, EYEPIECE.h - 0.5, 0.18), 8);
  g.rotateY(Math.PI);
  g.translate(EYEPIECE.x, EYEPIECE.y, BACK - 0.35);
  return g;
}

export function doorGeometry() {
  const g = plaque(10.6, 5.7, 0.5, 0.03, 0.03);
  g.rotateY(Math.PI);
  g.translate(0, -0.85, BACK + 0.01);
  return g;
}

export function counterGeometry() {
  const g = new THREE.ShapeGeometry(roundedRect(1.5, 0.8, 0.16), 6);
  g.rotateY(Math.PI);
  g.translate(-3.9, -2.4, BACK - 0.03);
  return g;
}

export function ledGeometry() {
  const g = new THREE.SphereGeometry(0.1, 16, 10);
  g.scale(1, 1, 0.4);
  g.translate(EYEPIECE.x - 1.5, EYEPIECE.y + 0.2, BACK - 0.03);
  return g;
}

/** Instant film: 5.4 × 8.6 cm, the picture 4.6 × 6.2 inside a frame that's deep at the bottom */
export const FILM = { w: 5.4, h: 8.6, t: 0.09, side: 0.4, top: 0.6, bottom: 1.8 };

export function filmGeometry() {
  return new THREE.BoxGeometry(FILM.w, FILM.h, FILM.t, 1, 1, 1);
}

export { FRONT, TOP };
