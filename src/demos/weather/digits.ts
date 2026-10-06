import { PathOp, PathVerb, Skia, StrokeCap, StrokeJoin, type SkPath, type SkTypeface } from 'react-native-skia';
import * as THREE from 'three/webgpu';
import { mergeGeometries, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Puffy numerals: each glyph is a few strokes swept with a fat round tube and capped with
 * spheres, like a balloon twisted into a digit. Glyph boxes are 1 wide (narrower for 1, °, %,
 * -, .) and 1.6 tall, origin at the bottom left; geometries are centred and cached.
 */

/** Fat strokes: chunky, toy-like numerals rather than neon tubes */
const TUBE = 0.24;
export const GLYPH_HEIGHT = 1.6 + TUBE * 2;

type P = [number, number];

function arc(cx: number, cy: number, r: number, from: number, to: number, n = 28): P[] {
  const pts: P[] = [];
  for (let i = 0; i <= n; i++) {
    const a = THREE.MathUtils.degToRad(from + ((to - from) * i) / n);
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return pts;
}

/** A polyline with every corner rounded off by a quadratic fillet of size `f` */
function rounded(corners: P[], f: number, closed = false): P[] {
  const out: P[] = [];
  const n = corners.length;
  for (let i = 0; i < n; i++) {
    const b = corners[i];
    const a = corners[(i - 1 + n) % n];
    const c = corners[(i + 1) % n];
    if (!closed && (i === 0 || i === n - 1)) {
      out.push(b);
      continue;
    }
    const la = Math.hypot(a[0] - b[0], a[1] - b[1]);
    const lc = Math.hypot(c[0] - b[0], c[1] - b[1]);
    const fa = Math.min(f, la / 2);
    const fc = Math.min(f, lc / 2);
    const p0: P = [b[0] + ((a[0] - b[0]) / la) * fa, b[1] + ((a[1] - b[1]) / la) * fa];
    const p2: P = [b[0] + ((c[0] - b[0]) / lc) * fc, b[1] + ((c[1] - b[1]) / lc) * fc];
    for (let k = 0; k <= 8; k++) {
      const t = k / 8;
      const u = 1 - t;
      out.push([u * u * p0[0] + 2 * u * t * b[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * b[1] + t * t * p2[1]]);
    }
  }
  return out;
}

function bezier(a: P, c: P, b: P, n = 20): P[] {
  const pts: P[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    pts.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]);
  }
  return pts;
}

type Stroke = { pts: P[]; closed?: boolean; tube?: number };
type Glyph = { width: number; strokes: Stroke[]; dots?: { at: P; r: number }[] };

const SIX: Stroke[] = [
  { pts: arc(0.5, 0.5, 0.5, 0, 360, 48).slice(0, -1), closed: true },
  { pts: bezier([0.82, 1.6], [0.12, 1.3], [0.02, 0.5]) },
];
const rotate180 = (s: Stroke): Stroke => ({ ...s, pts: s.pts.map(([x, y]) => [1 - x, 1.6 - y] as P) });

const GLYPHS: Record<string, Glyph> = {
  '0': {
    width: 1,
    strokes: [
      {
        pts: rounded(
          [
            [0, 0],
            [1, 0],
            [1, 1.6],
            [0, 1.6],
          ],
          0.5,
          true
        ),
        closed: true,
      },
    ],
  },
  '1': {
    width: 0.7,
    strokes: [
      {
        pts: rounded(
          [
            [0, 1.25],
            [0.45, 1.6],
            [0.45, 0],
          ],
          0.14
        ),
      },
    ],
  },
  '2': {
    width: 1,
    strokes: [
      {
        pts: [
          ...arc(0.5, 1.1, 0.5, 165, -35, 28),
          ...rounded(
            [
              [0.9, 0.81],
              [0, 0],
              [1, 0],
            ],
            0.12
          ).slice(1),
        ],
      },
    ],
  },
  '3': {
    width: 1,
    strokes: [{ pts: arc(0.5, 1.2, 0.4, 150, -90, 26) }, { pts: arc(0.5, 0.4, 0.42, 90, -150, 30) }],
  },
  '4': {
    width: 1,
    strokes: [
      {
        pts: rounded(
          [
            [0.76, 0],
            [0.76, 1.6],
            [0, 0.5],
            [1.02, 0.5],
          ],
          0.1
        ),
      },
    ],
  },
  '5': {
    width: 1,
    strokes: [
      {
        pts: rounded(
          [
            [0.92, 1.6],
            [0.12, 1.6],
            [0.06, 0.92],
          ],
          0.12
        ),
      },
      { pts: arc(0.5, 0.5, 0.5, 125, -150, 34) },
    ],
  },
  '6': { width: 1, strokes: SIX },
  '7': {
    width: 1,
    strokes: [
      {
        pts: rounded(
          [
            [0, 1.6],
            [1, 1.6],
            [0.32, 0],
          ],
          0.1
        ),
      },
    ],
  },
  '8': {
    width: 1,
    strokes: [
      { pts: arc(0.5, 1.22, 0.38, 0, 360, 40).slice(0, -1), closed: true },
      { pts: arc(0.5, 0.46, 0.46, 0, 360, 44).slice(0, -1), closed: true },
    ],
  },
  '9': { width: 1, strokes: SIX.map(rotate180) },
  '-': {
    width: 0.75,
    strokes: [
      {
        pts: [
          [0.05, 0.8],
          [0.7, 0.8],
        ],
      },
    ],
  },
  '°': { width: 0.6, strokes: [{ pts: arc(0.3, 1.32, 0.25, 0, 360, 28).slice(0, -1), closed: true, tube: 0.14 }] },
  '%': {
    width: 1,
    strokes: [
      { pts: arc(0.2, 1.36, 0.22, 0, 360, 24).slice(0, -1), closed: true, tube: 0.13 },
      { pts: arc(0.8, 0.24, 0.22, 0, 360, 24).slice(0, -1), closed: true, tube: 0.13 },
      {
        pts: [
          [0.95, 1.6],
          [0.05, 0],
        ],
        tube: 0.13,
      },
    ],
  },
  '.': { width: 0.3, strokes: [], dots: [{ at: [0.15, 0.08], r: 0.22 }] },
};

// ---- Pill numerals, after the original: the 0 a tall pill with a slit for its counter, the 8
// two pills merged at a waist, each slit; every other numeral is that 8 with walls cut open, like
// a seven-segment display drawn in pills (the 3 opens both left walls, the 2 the top left and
// bottom right...). Extruded deep with a rounded bevel. Built when the scene starts (Skia does
// the outlines); the tubes above stand in if that fails ----

const pill = new Map<string, { geometry: THREE.BufferGeometry; width: number }>();
/** A numeral's box: 1 wide, 2.2 tall (y up from 0, x centred) */
const PW = 1;
const PILL_H = 2.2;
/** The slit's width; the walls at the pills' round ends; how far the 8's two pills overlap */
const SLIT = 0.075;
const END = 0.3;
const OVER = 0.12;
const HALF = (PILL_H + OVER) / 2;

type Box = [x: number, y: number, w: number, h: number];
const slitBox = (y0: number, y1: number): Box => [-SLIT / 2, y0 + END, SLIT, y1 - y0 - END * 2];
const SLIT_LOW = slitBox(0, HALF);
const SLIT_HIGH = slitBox(PILL_H - HALF, PILL_H);
const span = (box: Box) => [box[1], box[1] + box[3]] as const;
const [LOW0, LOW1] = span(SLIT_LOW);
const [HIGH0, HIGH1] = span(SLIT_HIGH);
// Openings through the 8's walls: each runs from the slit out past the edge
const OUT = 0.8;
const REACH = 0;
const CUTS = {
  // A little past the slit's ends, so the arms left by an opening end short and round
  topLeft: [-OUT, HIGH0, OUT + SLIT / 2, HIGH1 - HIGH0 + REACH] as Box,
  topRight: [-SLIT / 2, HIGH0, OUT + SLIT / 2, HIGH1 - HIGH0 + REACH] as Box,
  lowLeft: [-OUT, LOW0 - REACH, OUT + SLIT / 2, LOW1 - LOW0 + REACH] as Box,
  lowRight: [-SLIT / 2, LOW0 - REACH, OUT + SLIT / 2, LOW1 - LOW0 + REACH] as Box,
  top: [-SLIT / 2, HIGH0, SLIT, PILL_H + OUT - HIGH0] as Box,
  /** The 4's lower left: the wall and that half of the bottom, so the right wall stands alone */
  lowQuarter: [-OUT, -OUT, OUT + SLIT / 2, LOW1 + OUT] as Box,
  /** The 7: everything left of the middle below the top bar */
  seven: [-OUT, -OUT, OUT + SLIT / 2, HIGH1 + OUT] as Box,
};

/** A skeleton stroke (for °, -, . and %): points, closed into a loop or not, and its width */
type Bone = { pts: P[]; closed?: boolean; width: number };
/** A numeral: pill bodies, boxes cut out of them (slits and openings), and strokes */
type Numeral = { bodies?: Box[]; cuts?: Box[]; bones?: Bone[] };

const PILL_BODY: Box = [-PW / 2, 0, PW, PILL_H];
const EIGHT: Box[] = [
  [-PW / 2, 0, PW, HALF],
  [-PW / 2, PILL_H - HALF, PW, HALF],
];
const SLITS = [SLIT_LOW, SLIT_HIGH];
/** The 8 with walls opened: on one straight-sided pill, so no waist pinch is left as a beak */
const eight = (...open: Box[]): Numeral => ({ bodies: [PILL_BODY], cuts: [...SLITS, ...open] });

const NUMERALS: Record<string, Numeral> = {
  '0': { bodies: [PILL_BODY], cuts: [slitBox(0, PILL_H)] },
  '1': { bodies: [[-0.25, 0, 0.5, PILL_H]] },
  '2': eight(CUTS.topLeft, CUTS.lowRight),
  '3': eight(CUTS.topLeft, CUTS.lowLeft),
  '4': eight(CUTS.top, CUTS.lowQuarter),
  '5': eight(CUTS.topRight, CUTS.lowLeft),
  '6': eight(CUTS.topRight),
  '7': eight(CUTS.seven),
  // Two pills merged at a pinched waist, each slit, as in the original
  '8': { bodies: EIGHT, cuts: SLITS },
  '9': eight(CUTS.lowLeft),
  '°': { bones: [{ pts: arc(0, PILL_H - 0.26, 0.16, 0, 360, 24).slice(0, -1), closed: true, width: 0.2 }] },
  '-': {
    bones: [
      {
        pts: [
          [-0.28, PILL_H / 2],
          [0.28, PILL_H / 2],
        ],
        width: 0.36,
      },
    ],
  },
  '.': {
    bones: [
      {
        pts: [
          [0, 0.2],
          [0.001, 0.2],
        ],
        width: 0.4,
      },
    ],
  },
  '%': {
    bones: [
      { pts: arc(-0.2, PILL_H - 0.35, 0.12, 0, 360, 20).slice(0, -1), closed: true, width: 0.18 },
      { pts: arc(0.2, 0.35, 0.12, 0, 360, 20).slice(0, -1), closed: true, width: 0.18 },
      {
        pts: [
          [0.32, PILL_H - 0.1],
          [-0.32, 0.1],
        ],
        width: 0.18,
      },
    ],
  },
};

/** A rounded box as a Skia path: the box is y up, Skia's y runs down */
const roundBox = ([x, y, w, h]: Box, r: number) =>
  Skia.PathBuilder.Make()
    .addRRect(Skia.RRectXY(Skia.XYWHRect(x, -(y + h), w, h), r, r))
    .build();

/** A numeral's outline: its pills merged, the cuts taken out, its strokes added */
function numeralOutline({ bodies = [], cuts = [], bones = [] }: Numeral) {
  let outline: SkPath | null = null;
  const op = (part: SkPath | null, how: PathOp) => {
    if (!part) return;
    if (!outline) outline = how === PathOp.Union ? part : null;
    else outline = Skia.Path.MakeFromOp(outline, part, how) ?? outline;
  };
  for (const body of bodies) op(roundBox(body, Math.min(body[2], body[3]) / 2), PathOp.Union);
  for (const cut of cuts) op(roundBox(cut, SLIT / 2), PathOp.Difference);
  for (const bone of bones) {
    const b = Skia.PathBuilder.Make();
    bone.pts.forEach(([x, y], i) => (i ? b.lineTo(x, -y) : b.moveTo(x, -y)));
    if (bone.closed) b.close();
    op(Skia.Path.Stroke(b.build(), { width: bone.width, join: StrokeJoin.Round, cap: StrokeCap.Round }), PathOp.Union);
  }
  // Round where the cuts meet the walls (the thin strokes of °, - and % are left alone)
  return cuts.length ? soften(outline as SkPath | null, CORNER) : (outline as SkPath | null);
}

/** Radius every convex corner of a numeral is rounded to (above the bevel's inset, so it never spikes) */
const CORNER = 0.11;

/**
 * Round off a path's convex corners (where a cut meets a pill's wall): shrink it by `r`, then
 * grow it back. The slits and openings keep their shape.
 */
function soften(path: SkPath | null, r: number) {
  if (!path) return null;
  const band = (p: SkPath) => Skia.Path.Stroke(p, { width: r * 2, join: StrokeJoin.Round, cap: StrokeCap.Round });
  const edge = band(path);
  const shrunk = edge ? Skia.Path.MakeFromOp(path, edge, PathOp.Difference) : null;
  if (!shrunk) return path;
  const rim = band(shrunk);
  return (rim ? Skia.Path.MakeFromOp(shrunk, rim, PathOp.Union) : null) ?? path;
}

/** Is (x, y) inside the polygon `pts`? (even-odd ray cast) */
function inside(x: number, y: number, pts: THREE.Vector2[]) {
  let hit = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

/**
 * Skia's outline as three.js shapes. Which contours are holes is decided by nesting (a contour
 * inside an odd number of others is a hole), not by their winding, which Skia's path ops leave
 * in whatever direction they like.
 */
function toShapes(path: SkPath, X: (x: number) => number, Y: (y: number) => number) {
  const contours: THREE.Shape[] = [];
  let cur: THREE.Shape | null = null;
  for (const [verb, ...p] of path.toCmds()) {
    if (verb === PathVerb.Move) {
      cur = new THREE.Shape();
      contours.push(cur);
      cur.moveTo(X(p[0]), Y(p[1]));
    } else if (!cur) continue;
    else if (verb === PathVerb.Line) cur.lineTo(X(p[0]), Y(p[1]));
    else if (verb === PathVerb.Quad || verb === PathVerb.Conic)
      cur.quadraticCurveTo(X(p[0]), Y(p[1]), X(p[2]), Y(p[3]));
    else if (verb === PathVerb.Cubic) cur.bezierCurveTo(X(p[0]), Y(p[1]), X(p[2]), Y(p[3]), X(p[4]), Y(p[5]));
    else if (verb === PathVerb.Close) cur.closePath();
  }
  const points = contours.map((c) => c.getPoints(8));
  const parents = contours.map((_, i) =>
    contours.map((__, j) => j).filter((j) => j !== i && inside(points[i][0].x, points[i][0].y, points[j]))
  );
  const outers = contours.filter((_, i) => parents[i].length % 2 === 0);
  contours.forEach((c, i) => {
    if (parents[i].length % 2 === 0) return;
    // The hole belongs to the innermost outline round it
    const owner = parents[i]
      .filter((j) => parents[j].length % 2 === 0)
      .sort((j, k) => parents[k].length - parents[j].length)[0];
    if (owner !== undefined) contours[owner].holes.push(c);
  });
  return outers;
}

/** Build every pill numeral's geometry; false if Skia could not make the outlines */
export function buildPillDigits() {
  if (pill.size) return true;
  for (const [ch, numeral] of Object.entries(NUMERALS)) {
    const outline = numeralOutline(numeral);
    if (!outline) return false;
    const clean = Skia.Path.Simplify(outline) ?? outline;
    const b = clean.computeTightBounds();
    const cx = b.x + b.width / 2;
    // Centred across; every numeral on the same line, the middle of the 0
    const shapes = toShapes(
      clean,
      (x) => x - cx,
      (y) => -y - PILL_H / 2
    );
    const extruded = new THREE.ExtrudeGeometry(shapes, {
      depth: 0.52,
      bevelEnabled: true,
      bevelThickness: 0.14,
      // Rounded inwards from the outline, so the slits stay open and read as grooves
      bevelSize: 0.09,
      bevelOffset: -0.09,
      bevelSegments: 7,
      curveSegments: 12,
    });
    // Smooth across the bevel's steps (they would show as creases), sharp only at real corners;
    // the faces themselves flat, or the bevel's tilt would bleed across them in streaks
    const geometry = toCreasedNormals(extruded, Math.PI / 3.2);
    extruded.dispose();
    const caps = geometry.groups.find((g) => g.materialIndex === 0);
    if (caps) {
      const pos = geometry.attributes.position;
      const nor = geometry.attributes.normal;
      for (let i = caps.start; i < caps.start + caps.count; i++) nor.setXYZ(i, 0, 0, pos.getZ(i) > 0.26 ? 1 : -1);
      nor.needsUpdate = true;
    }
    geometry.translate(0, 0, -0.26);
    geometry.computeBoundingSphere();
    pill.set(ch, { geometry, width: b.width });
  }
  return true;
}

// ---- The original's numerals: an ultra-condensed face (Six Caps) swollen until its counters
// close to slits, extruded deep with a flat chamfer, the faces flat. Replaces the pills once the
// face loads ----

/** How far the face is swollen, as a fraction of the "0"'s width */
let swell = 0.15;
let faceBuilt = false;
const CHAMFER = 0.075;

export function buildFaceDigits(typeface: SkTypeface, amount = swell) {
  swell = amount;
  const font = Skia.Font(typeface, 100);
  const raw = Skia.Path.MakeFromText('0', 0, 0, font)?.computeTightBounds();
  if (!raw || raw.height <= 0) return false;
  const width = raw.width * amount;
  const zero = fattened(Skia.Path.MakeFromText('0', 0, 0, font), width)?.computeTightBounds();
  if (!zero) return false;
  // Every numeral as tall as the 0, centred on its middle
  const s = PILL_H / zero.height;
  const cy = zero.y + zero.height / 2;
  const built = new Map<string, { geometry: THREE.BufferGeometry; width: number }>();
  // The 0 and the 8 as the original draws them: a pill, and two pills stacked, each with a
  // straight slit for a counter (the face's own are lens-shaped), as wide as the face's 0
  const zw = zero.width * s;
  const slit = 0.06 + CHAMFER * 2;
  const pills = (bodies: Box[]) => {
    let out: SkPath | null = null;
    for (const body of bodies) {
      const part = roundBox(body, body[2] / 2);
      out = out ? (Skia.Path.MakeFromOp(out, part, PathOp.Union) ?? out) : part;
      const hole = roundBox([-slit / 2, body[1] + 0.27, slit, body[3] - 0.54], slit / 2);
      out = Skia.Path.MakeFromOp(out, hole, PathOp.Difference) ?? out;
    }
    return out;
  };
  const half = (PILL_H + 0.1) / 2;
  const drawn: Record<string, SkPath | null> = {
    '0': pills([[-zw / 2, 0, zw, PILL_H]]),
    '8': pills([
      [-zw / 2, 0, zw, half],
      [-zw / 2, PILL_H - half, zw, half],
    ]),
  };
  for (const ch of '0123456789°%-.') {
    if (drawn[ch]) {
      const shapes = toShapes(
        drawn[ch]!,
        (x) => x,
        (y) => -y - PILL_H / 2
      );
      built.set(ch, { geometry: faceGeometry(shapes), width: zw + CHAMFER * 2 });
      continue;
    }
    const path = fattened(Skia.Path.MakeFromText(ch, 0, 0, font), ch === '°' ? width * 0.6 : width);
    if (!path) continue;
    const b = path.computeTightBounds();
    const cx = b.x + b.width / 2;
    // The degree sign smaller than the face draws it, its top on the numerals' cap line
    const k = ch === '°' ? 0.62 : 1;
    const top = zero.y;
    const shapes = toShapes(
      path,
      (x) => (x - cx) * s * k,
      (y) => (ch === '°' ? -(top + (y - top) * k - cy) * s : -(y - cy) * s)
    );
    const geometry = faceGeometry(shapes);
    // The chamfer grows out past the outline on both sides
    built.set(ch, { geometry, width: b.width * s * k + CHAMFER * 2 });
  }
  for (const g of pill.values()) g.geometry.dispose();
  pill.clear();
  for (const [ch, g] of built) pill.set(ch, g);
  faceBuilt = true;
  return true;
}

/** Extrude a numeral deep, with the original's flat chamfer */
function faceGeometry(shapes: THREE.Shape[]) {
  const extruded = new THREE.ExtrudeGeometry(shapes, {
    depth: 0.62,
    bevelEnabled: true,
    // A flat chamfer, as in the original: the faces catch the light at an angle. It grows
    // out from the outline (an inset would fold over itself in the slits)
    bevelThickness: 0.09,
    bevelSize: CHAMFER,
    bevelOffset: 0,
    bevelSegments: 1,
    curveSegments: 14,
  });
  const geometry = toCreasedNormals(extruded, Math.PI / 5);
  extruded.dispose();
  geometry.translate(0, 0, -0.31);
  geometry.computeBoundingSphere();
  return geometry;
}

/** A glyph's outline swollen by `width`: its stroke, round-joined, merged with its fill */
function fattened(path: SkPath | null, width: number) {
  if (!path) return null;
  if (width <= 0) return path;
  // Mitred, so the face keeps its own corners: square on the 7 and the 5, round on the 0
  const stroke = Skia.Path.Stroke(path, { width, join: StrokeJoin.Miter, miter_limit: 2.5, cap: StrokeCap.Butt });
  if (!stroke) return path;
  const merged = Skia.Path.MakeFromOp(path, stroke, PathOp.Union) ?? path;
  return Skia.Path.Simplify(merged) ?? merged;
}

export const pillDigits = () => pill.size > 0;

/** Height of a numeral in glyph units */
export const glyphHeight = () => (pill.size ? PILL_H + (faceBuilt ? CHAMFER * 2 : 0) : GLYPH_HEIGHT);

export function glyphWidth(ch: string) {
  return pill.get(ch)?.width ?? GLYPHS[ch]?.width ?? 0.6;
}

const cache = new Map<string, THREE.BufferGeometry>();

/** Centred geometry for a character: the pill numerals once built, else the tubes */
export function glyphGeometry(ch: string) {
  const solid = pill.get(ch);
  if (solid) return solid.geometry;
  const hit = cache.get(ch);
  if (hit) return hit;
  const g = GLYPHS[ch];
  const parts: THREE.BufferGeometry[] = [];
  if (g) {
    for (const s of g.strokes) {
      const r = s.tube ?? TUBE;
      const pts = s.pts.map(([x, y]) => new THREE.Vector3(x, y, 0));
      const curve = new THREE.CatmullRomCurve3(pts, !!s.closed, 'centripetal');
      const segments = Math.max(12, Math.ceil(curve.getLength() * 44));
      parts.push(new THREE.TubeGeometry(curve, segments, r, 14, !!s.closed));
      if (!s.closed) {
        for (const end of [pts[0], pts[pts.length - 1]]) {
          parts.push(new THREE.SphereGeometry(r, 16, 12).translate(end.x, end.y, end.z));
        }
      }
    }
    for (const d of g.dots ?? []) parts.push(new THREE.SphereGeometry(d.r, 18, 14).translate(d.at[0], d.at[1], 0));
  }
  const geometry = parts.length ? mergeGeometries(parts) : new THREE.BufferGeometry();
  geometry.translate(-(g?.width ?? 0) / 2, -0.8, 0);
  geometry.computeBoundingSphere();
  cache.set(ch, geometry);
  return geometry;
}

/** Space between glyphs: the tubes' fat strokes need room; the pills nearly touch */
const gap = () => (pill.size ? 0.12 : 0.6);

type Slot = {
  ch: string;
  mesh: THREE.Mesh;
  s: number;
  v: number;
  target: number;
  x: number;
  phase: number;
  /** Spin about the vertical axis, springing towards `spinTo` (a tap adds a full turn) */
  spin: number;
  spinV: number;
  spinTo: number;
  /** Squash and stretch from a tap */
  squash: number;
  squashV: number;
};

/**
 * A row of numerals that swaps characters with a springy pop: a changed glyph shrinks away
 * while its replacement bounces in.
 */
export class DigitRow {
  readonly group = new THREE.Group();
  private slots: Slot[] = [];
  private leaving: Slot[] = [];
  private text = '';
  /** Width of the current text, in glyph units */
  width = 0;
  constructor(private material: THREE.Material) {}

  get value() {
    return this.text;
  }

  setText(text: string) {
    if (text === this.text) return;
    const chars = [...text];
    const widths = chars.map(glyphWidth);
    const space = gap();
    const total = widths.reduce((a, w) => a + w, 0) + space * Math.max(0, chars.length - 1);
    // The tubes bulge past the glyph boxes at both ends
    this.width = total + (pill.size ? 0 : TUBE * 2);
    let x = -total / 2;
    const next: Slot[] = [];
    chars.forEach((ch, i) => {
      const cx = x + widths[i] / 2;
      x += widths[i] + space;
      const old = this.slots[i];
      if (old && old.ch === ch) {
        old.x = cx;
        next.push(old);
        return;
      }
      if (old) this.retire(old);
      const mesh = new THREE.Mesh(glyphGeometry(ch), this.material);
      mesh.scale.setScalar(0.001);
      mesh.position.x = cx;
      this.group.add(mesh);
      next.push({
        ch,
        mesh,
        s: 0,
        v: 0,
        target: 1,
        x: cx,
        phase: i * 0.9 + Math.random(),
        spin: 0,
        spinV: 0,
        spinTo: 0,
        squash: 0,
        squashV: 0,
      });
    });
    for (let i = chars.length; i < this.slots.length; i++) this.retire(this.slots[i]);
    this.slots = next;
    this.text = text;
  }

  /** Rebuild every glyph (after the numerals are rebuilt) */
  refresh() {
    const text = this.text;
    for (const slot of this.slots) this.retire(slot);
    this.slots = [];
    this.text = '';
    this.setText(text);
  }

  /**
   * A tapped glyph squashes, then springs up and spins a full turn. Hit-tested against each
   * glyph's whole box rather than its thin tubes, so a tap inside the "0" counts.
   */
  poke(ray: THREE.Raycaster) {
    const box = new THREE.Box3();
    const slot = this.slots.find((s) => {
      const g = s.mesh.geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      box.copy(g.boundingBox!).expandByScalar(0.08).applyMatrix4(s.mesh.matrixWorld);
      return ray.ray.intersectsBox(box);
    });
    if (!slot) return false;
    slot.spinTo += Math.PI * 2;
    slot.squashV -= 9;
    return true;
  }

  /** Every glyph hops in a wave, from the left */
  wave() {
    this.slots.forEach((slot, i) => {
      slot.squashV -= 6 + i;
      slot.spinTo += Math.PI * 2;
    });
  }

  private retire(slot: Slot) {
    slot.target = 0;
    this.leaving.push(slot);
  }

  update(dt: number, t: number) {
    const step = (slot: Slot) => {
      // Under-damped spring: a little overshoot reads as "boing"
      slot.v += ((slot.target - slot.s) * 260 - slot.v * 18) * dt;
      slot.s += slot.v * dt;
      const s = Math.max(0.001, slot.s);
      slot.squashV += (-slot.squash * 300 - slot.squashV * 13) * dt;
      slot.squash += slot.squashV * dt;
      const q = THREE.MathUtils.clamp(slot.squash, -0.45, 0.45);
      // Volume-preserving: squat and wide, then tall and thin
      slot.mesh.scale.set(s * (1 - q * 0.6), s * (1 + q), s * (1 - q * 0.6));
      slot.spinV += ((slot.spinTo - slot.spin) * 70 - slot.spinV * 11) * dt;
      slot.spin += slot.spinV * dt;
      slot.mesh.rotation.y = slot.spin;
    };
    for (const slot of this.slots) {
      step(slot);
      slot.mesh.position.x += (slot.x - slot.mesh.position.x) * Math.min(1, dt * 14);
      slot.mesh.position.y = Math.sin(t * 1.4 + slot.phase) * 0.035;
      slot.mesh.rotation.z = Math.sin(t * 0.9 + slot.phase) * 0.025;
    }
    this.leaving = this.leaving.filter((slot) => {
      step(slot);
      if (slot.s < 0.02 && slot.v <= 0) {
        this.group.remove(slot.mesh);
        return false;
      }
      return true;
    });
  }
}
