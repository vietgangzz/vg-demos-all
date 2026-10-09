import { BlendMode, FontWeight, PaintStyle, Skia, TextAlign, type SkCanvas } from 'react-native-skia';
import * as TSL from 'three/tsl';
import * as THREE from 'three/webgpu';

/**
 * The shop's products as little 3D models, in the soft, rounded style of a product icon: modelled
 * from simple shapes, lit by the studio lights below. Each one is built facing +z with y up, then
 * centred and scaled to fit inside a sphere of radius 0.5, so they all come out the same size.
 */

const { vec3, pow, oneMinus, saturate, abs, dot, normalize, mix, smoothstep, length, sin, atan, select } = TSL;
type V3 = THREE.Node<'vec3'>;

/** The angle a product is first seen at: turned a little, so you see its side as well as its front */
export const HERO_YAW = -0.5;

/** A soft key from the front left, sky from above, a cool rim from behind */
export function studioLights() {
  const g = new THREE.Group();
  const hemi = new THREE.HemisphereLight('#FFFCF6', '#C2AE96', 1.7);
  const key = new THREE.DirectionalLight('#FFF3E2', 2.3);
  key.position.set(-1.3, 1.9, 1.7);
  const rim = new THREE.DirectionalLight('#E2EAFF', 1.3);
  rim.position.set(1.7, 0.9, -1.5);
  g.add(hemi, key, rim);
  return g;
}

// ---- Materials ----

/** The faint brightening at a surface's silhouette that gives soft 3D renders their glow */
const rim = (k: number) => {
  const v = normalize(TSL.positionView.negate());
  return vec3(1.0, 0.97, 0.93).mul(pow(oneMinus(saturate(abs(dot(TSL.normalView, v)))), 3).mul(k)) as unknown as V3;
};

function mat(color: string, roughness = 0.55, sheen = 0.14) {
  const m = new THREE.MeshStandardNodeMaterial({ color, roughness, metalness: 0 });
  m.emissiveNode = rim(sheen);
  return m;
}

/** A material whose colour is worked out per pixel */
function painted(color: V3, roughness = 0.6, sheen = 0.12, side: THREE.Side = THREE.FrontSide) {
  const m = new THREE.MeshStandardNodeMaterial({ roughness, metalness: 0, side });
  m.colorNode = color;
  m.emissiveNode = rim(sheen);
  return m;
}

const hex = (c: string) => {
  const k = new THREE.Color(c);
  return vec3(k.r, k.g, k.b) as unknown as V3;
};

/** Woven or furry: a fine noise over the colour */
const textured = (c: string, scale: number, amount: number) =>
  hex(c).mul(TSL.mx_noise_float(TSL.positionLocal.mul(scale)).mul(amount).add(1)) as unknown as V3;

// ---- Shapes ----

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/**
 * A box with every edge rounded to radius `r`: a subdivided box, its vertices pulled onto the
 * rounded surface, with normals set to match so the edges shade smooth
 */
export function rbox(w: number, h: number, d: number, r: number, seg = 12) {
  const g = new THREE.BoxGeometry(w, h, d, seg, seg, seg);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const n = g.getAttribute('normal') as THREE.BufferAttribute;
  const half = [w / 2, h / 2, d / 2];
  const inner = half.map((s) => Math.max(0, s - r));
  const v = [0, 0, 0];
  const c = [0, 0, 0];
  for (let i = 0; i < p.count; i++) {
    v[0] = p.getX(i);
    v[1] = p.getY(i);
    v[2] = p.getZ(i);
    // Half the segments along each edge go into the rounding
    for (let k = 0; k < 3; k++) {
      const u = v[k] / half[k];
      const a = Math.abs(u);
      v[k] = Math.sign(u) * (a <= 0.5 ? (a / 0.5) * inner[k] : inner[k] + ((a - 0.5) / 0.5) * (half[k] - inner[k]));
      c[k] = clamp(v[k], -inner[k], inner[k]);
    }
    const dx = v[0] - c[0];
    const dy = v[1] - c[1];
    const dz = v[2] - c[2];
    const len = Math.hypot(dx, dy, dz);
    if (len > 1e-6) {
      p.setXYZ(i, c[0] + (dx / len) * r, c[1] + (dy / len) * r, c[2] + (dz / len) * r);
      n.setXYZ(i, dx / len, dy / len, dz / len);
    } else {
      p.setXYZ(i, v[0], v[1], v[2]);
    }
  }
  return g;
}

type Vec = [number, number, number];

function add(
  parent: THREE.Object3D,
  geo: THREE.BufferGeometry,
  m: THREE.Material | THREE.Material[],
  at: Vec = [0, 0, 0],
  rot: Vec = [0, 0, 0],
  scale: Vec = [1, 1, 1]
) {
  const mesh = new THREE.Mesh(geo, m);
  mesh.position.set(...at);
  mesh.rotation.set(...rot);
  mesh.scale.set(...scale);
  parent.add(mesh);
  return mesh;
}

/** A rod of radius `r` from a to b */
function rod(parent: THREE.Object3D, a: Vec, b: Vec, r: number, m: THREE.Material) {
  const from = new THREE.Vector3(...a);
  const to = new THREE.Vector3(...b);
  const dir = to.clone().sub(from);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, dir.length(), 20), m);
  mesh.position.copy(from).addScaledVector(dir, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  parent.add(mesh);
  return mesh;
}

function tube(parent: THREE.Object3D, points: Vec[], r: number, m: THREE.Material, segments = 48) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  return add(parent, new THREE.TubeGeometry(curve, segments, r, 14, false), m);
}

const sphere = (r: number, w = 32, h = 24) => new THREE.SphereGeometry(r, w, h);

/** A Skia drawing as a texture, its rows turned to run bottom-up the way GL wants them */
function skiaTexture(w: number, h: number, paint: (c: SkCanvas) => void) {
  const pixels = new Uint8Array(w * h * 4);
  const surface = Skia.Surface.Make(w, h);
  if (surface) {
    const canvas = surface.getCanvas();
    canvas.clear(Skia.Color('transparent'));
    paint(canvas);
    surface.flush();
    const read = surface.makeImageSnapshot().readPixels();
    if (read instanceof Uint8Array && read.length === pixels.length) pixels.set(read);
  }
  for (let i = 0; i < pixels.length; i += 4) {
    const a = pixels[i + 3];
    if (a > 0 && a < 255) {
      pixels[i] = Math.min(255, (pixels[i] * 255) / a);
      pixels[i + 1] = Math.min(255, (pixels[i + 1] * 255) / a);
      pixels[i + 2] = Math.min(255, (pixels[i + 2] * 255) / a);
    }
  }
  const flipped = new Uint8Array(pixels.length);
  const row = w * 4;
  for (let y = 0; y < h; y++) flipped.set(pixels.subarray(y * row, y * row + row), (h - 1 - y) * row);
  const t = new THREE.DataTexture(flipped, w, h, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

const fill = (color: string) => {
  const p = Skia.Paint();
  p.setAntiAlias(true);
  p.setColor(Skia.Color(color));
  return p;
};

function words(c: SkCanvas, text: string, y: number, w: number, size: number, color: string, weight: FontWeight) {
  const p = Skia.ParagraphBuilder.Make({ textAlign: TextAlign.Center })
    .pushStyle({
      fontSize: size,
      fontFamilies: ['Helvetica Neue'],
      color: Skia.Color(color),
      fontStyle: { weight },
      letterSpacing: size * 0.08,
    })
    .addText(text)
    .build();
  p.layout(w);
  p.paint(c, 0, y);
}

// ---- The products ----

function headphones() {
  const g = new THREE.Group();
  const shell = mat('#ECE7DD', 0.45, 0.18);
  const cushion = painted(textured('#8EA58B', 90, 0.06), 0.9, 0.1);
  const metal = mat('#C3C8CE', 0.25, 0.22);
  const dark = mat('#2A2B2D', 0.7);
  const R = 0.44;
  const arc = (r: number, from: number, to: number): Vec[] =>
    Array.from({ length: 13 }, (_, i) => {
      const a = from + ((to - from) * i) / 12;
      return [Math.cos(a) * r, Math.sin(a) * r * 1.05 + 0.1, 0];
    });
  tube(g, arc(R, 0.05, Math.PI - 0.05), 0.05, shell);
  // The padding under the band
  tube(g, arc(R - 0.06, 0.45, Math.PI - 0.45), 0.045, cushion);
  for (const s of [-1, 1]) {
    // The yoke down to the cup
    rod(g, [s * R * 0.99, 0.13, 0], [s * R, -0.04, 0], 0.022, metal);
    const cup = new THREE.Group();
    cup.position.set(s * (R + 0.01), -0.17, 0);
    cup.scale.set(1, 1.18, 1);
    g.add(cup);
    add(cup, new THREE.CylinderGeometry(0.2, 0.2, 0.13, 48), shell, [0, 0, 0], [0, 0, Math.PI / 2]);
    add(cup, new THREE.CylinderGeometry(0.155, 0.17, 0.03, 48), metal, [s * 0.075, 0, 0], [0, 0, Math.PI / 2]);
    add(cup, new THREE.TorusGeometry(0.14, 0.055, 18, 48), cushion, [-s * 0.08, 0, 0], [0, Math.PI / 2, 0]);
    add(cup, new THREE.CircleGeometry(0.1, 32), dark, [-s * 0.11, 0, 0], [0, (-s * Math.PI) / 2, 0]);
  }
  return g;
}

/** Where the toe springs up off the ground, at x along the shoe */
const springAt = (x: number) => 0.07 * Math.pow(smooth(0.18, 0.52, x), 1.6);

/** Half the shoe's width at s (0 the back of the heel, 1 the tip of the toe), seen from above */
function footHalf(s: number) {
  const base =
    s < 0.45
      ? 0.125 + 0.025 * smooth(0.1, 0.45, s)
      : s < 0.72
        ? 0.15 + 0.035 * smooth(0.45, 0.72, s)
        : 0.185 - 0.03 * smooth(0.72, 0.95, s);
  // Round at the heel and rounder at the toe
  const heel = 0.14;
  const toe = 0.2;
  const f =
    s < heel
      ? Math.sqrt(Math.max(0, 1 - ((heel - s) / heel) ** 2))
      : s > 1 - toe
        ? Math.sqrt(Math.max(0, 1 - ((s - (1 - toe)) / toe) ** 2))
        : 1;
  return base * f;
}

function sneaker() {
  const g = new THREE.Group();
  const SOLE = 0.13;

  // ---- The sole: a white cupsole on a gum outsole, following the foot ----
  const outline = (grow: number) => {
    const shape = new THREE.Shape();
    const n = 80;
    for (let i = 0; i <= n; i++) {
      const s = i / n;
      const p: [number, number] = [-0.5 + s, footHalf(s) + grow];
      if (i === 0) shape.moveTo(p[0], p[1]);
      else shape.lineTo(p[0], p[1]);
    }
    for (let i = n; i >= 0; i--) {
      const s = i / n;
      shape.lineTo(-0.5 + s, -footHalf(s) - grow);
    }
    return shape;
  };
  const slab = (grow: number, from: number, to: number, bevel: number) => {
    const geo = new THREE.ExtrudeGeometry(outline(grow), {
      depth: to - from - bevel * 2,
      bevelEnabled: true,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelSegments: 4,
      curveSegments: 4,
    });
    // Shape in x/z, extruded upward
    geo.rotateX(Math.PI / 2);
    geo.translate(0, to - bevel, 0);
    const p = geo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) + springAt(p.getX(i)));
    geo.computeVertexNormals();
    return geo;
  };
  add(g, slab(0.012, 0.0, 0.035, 0.012), mat('#B9783F', 0.8, 0.08));
  add(g, slab(0.02, 0.028, SOLE, 0.022), mat('#EEEBE4', 0.5, 0.14));

  // ---- The upper: a soft leather body lofted section by section from heel to toe ----
  // How high its top runs along it: up at the heel counter, down round the opening, along the
  // instep and down to the toe box
  const topAt = (s: number) => {
    const keys: [number, number][] = [
      [0, 0.5],
      [0.12, 0.53],
      [0.3, 0.49],
      [0.42, 0.45],
      [0.62, 0.34],
      [0.8, 0.27],
      [1, 0.21],
    ];
    for (let k = 1; k < keys.length; k++) {
      if (s <= keys[k][0]) {
        const [s0, y0] = keys[k - 1];
        const [s1, y1] = keys[k];
        return y0 + (y1 - y0) * smooth(s0, s1, s);
      }
    }
    return 0.21;
  };
  // The opening the foot goes in, a bowl in the top
  const opening = (s: number) => smooth(0.06, 0.15, s) * smooth(0.43, 0.33, s);
  const NS = 110;
  const NR = 72;
  const pos: number[] = [];
  // What the leather's colouring needs at each point, worked out per pixel so its edges stay crisp
  const along: number[] = [];
  const across: number[] = [];
  const height: number[] = [];
  const tops: number[] = [];
  const bowl: number[] = [];
  const upward: number[] = [];
  for (let i = 0; i <= NS; i++) {
    const s = i / NS;
    const x = -0.5 + s;
    const half = footHalf(s) * 0.97;
    // The toe box rounds down to the sole at the very front
    const toeDown = s > 0.82 ? Math.pow(Math.max(0, 1 - ((s - 0.82) / 0.18) ** 2), 0.45) : 1;
    const bottom = SOLE - 0.05;
    const top = bottom + (topAt(s) - bottom) * toeDown;
    const yc = (top + bottom) / 2;
    const hh = (top - bottom) / 2;
    const dip = opening(s);
    for (let j = 0; j < NR; j++) {
      const a = (j / NR) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      // A rounded-rectangle section
      const z = half * Math.sign(ca) * Math.pow(Math.abs(ca), 0.6);
      let y = yc + hh * Math.sign(sa) * Math.pow(Math.abs(sa), 0.6);
      const zn = half > 1e-5 ? Math.abs(z) / half : 0;
      const inBowl = dip * Math.pow(Math.max(0, 1 - zn * zn), 1.4) * Math.max(0, sa);
      y -= inBowl * 0.26;
      pos.push(x, y + springAt(x), z);

      along.push(s);
      across.push(zn);
      height.push(y);
      tops.push(top);
      bowl.push(inBowl);
      upward.push(sa);
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < NS; i++)
    for (let j = 0; j < NR; j++) {
      const a = i * NR + j;
      const b = i * NR + ((j + 1) % NR);
      const cc = (i + 1) * NR + j;
      const d = (i + 1) * NR + ((j + 1) % NR);
      idx.push(a, cc, b, b, cc, d);
    }
  const upper = new THREE.BufferGeometry();
  upper.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  upper.setAttribute('aS', new THREE.Float32BufferAttribute(along, 1));
  upper.setAttribute('aZn', new THREE.Float32BufferAttribute(across, 1));
  upper.setAttribute('aY', new THREE.Float32BufferAttribute(height, 1));
  upper.setAttribute('aTop', new THREE.Float32BufferAttribute(tops, 1));
  upper.setAttribute('aBowl', new THREE.Float32BufferAttribute(bowl, 1));
  upper.setAttribute('aUp', new THREE.Float32BufferAttribute(upward, 1));
  upper.setIndex(idx);
  upper.computeVertexNormals();
  // The heel and toe close to a line where their two halves meet; face those rows straight back and
  // straight forward, or each half shades on its own and a seam shows down the middle
  const nrm = upper.getAttribute('normal') as THREE.BufferAttribute;
  for (const [row, next, dir] of [
    [0, 1, -1],
    [NS, NS - 1, 1],
  ] as const)
    for (let j = 0; j < NR; j++) {
      const v = new THREE.Vector3(dir, nrm.getY(next * NR + j) * 0.6, 0).normalize();
      nrm.setXYZ(row * NR + j, v.x, v.y, v.z);
    }
  // White leather a little creamier at the toe cap, a stripe sweeping up each side, a narrow navy
  // tab up the back of the heel, and the dark lining inside the opening
  const at = (name: string) => TSL.attribute<'float'>(name, 'float');
  const s = at('aS');
  const zn = at('aZn');
  const y = at('aY');
  const top = at('aTop');
  let leatherColor = mix(hex('#E9E5DC'), hex('#DED7CA'), smoothstep(0.78, 0.86, s).mul(0.5));
  const onSide = smoothstep(0.45, 0.7, zn).mul(oneMinus(smoothstep(0.9, 0.97, at('aUp'))));
  const line = smoothstep(0.18, 0.66, s)
    .mul(0.28)
    .add(SOLE + 0.045);
  const band = smoothstep(0.03, 0.022, abs(y.sub(line)))
    .mul(onSide)
    .mul(smoothstep(0.18, 0.26, s))
    .mul(smoothstep(0.72, 0.64, s));
  leatherColor = mix(leatherColor, hex('#D8452E'), band);
  const tab = smoothstep(0.06, 0.03, s)
    .mul(smoothstep(top.sub(0.15), top.sub(0.12), y))
    .mul(smoothstep(0.5, 0.32, zn));
  leatherColor = mix(leatherColor, hex('#263449'), tab);
  leatherColor = mix(leatherColor, hex('#4A3F37'), smoothstep(0.08, 0.3, at('aBowl')));
  const leather = painted(leatherColor as unknown as V3, 0.5, 0.16);
  add(g, upper, leather);

  // The padded collar round the opening
  const collar: Vec[] = [];
  for (let k = 0; k <= 40; k++) {
    const t = (k / 40) * Math.PI * 2;
    const s = 0.245 + Math.cos(t) * 0.155;
    const x = -0.5 + s;
    collar.push([x, topAt(s) - 0.012 + springAt(x), Math.sin(t) * footHalf(s) * 0.86]);
  }
  add(
    g,
    new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3(
        collar.map((p) => new THREE.Vector3(...p)),
        true
      ),
      80,
      0.017,
      12,
      true
    ),
    mat('#E4DED3', 0.65, 0.12)
  );

  // The tongue, padded and leaning back out of the opening
  const tongueS = 0.4;
  add(
    g,
    rbox(0.19, 0.045, 0.15, 0.022, 6),
    mat('#E6E1D8', 0.6, 0.12),
    [-0.5 + tongueS, topAt(tongueS) + 0.02, 0],
    [0, 0, -0.62]
  );

  // Laces across the instep, and the eyelets they run through
  const laceM = mat('#F2EFE9', 0.55, 0.1);
  const eyelet = mat('#2B2622', 0.4, 0.1);
  for (let k = 0; k < 5; k++) {
    const s = 0.45 + k * 0.055;
    const x = -0.5 + s;
    const y = topAt(s) + springAt(x);
    const slope = Math.atan2(topAt(s + 0.01) - topAt(s - 0.01), 0.02);
    const half = footHalf(s) * 0.55;
    add(g, rbox(0.026, 0.014, half * 2, 0.006, 4), laceM, [x, y + 0.008, 0], [0, (k % 2 ? 1 : -1) * 0.18, slope]);
    for (const side of [-1, 1]) add(g, sphere(0.011, 12, 8), eyelet, [x, y - 0.004, side * half * 1.05]);
  }
  return g;
}

function camera() {
  const g = new THREE.Group();
  const leather = painted(textured('#2A2826', 160, 0.12), 0.95, 0.1);
  const chrome = mat('#D9DCE0', 0.24, 0.22);
  const black = mat('#151515', 0.45);
  const glass = mat('#1C2D40', 0.05, 0.4);
  add(g, rbox(1.0, 0.5, 0.34, 0.06), leather, [0, -0.02, 0]);
  add(g, rbox(1.0, 0.16, 0.345, 0.05), chrome, [0, 0.28, 0]);
  add(g, rbox(1.0, 0.07, 0.345, 0.03), chrome, [0, -0.26, 0]);
  // The lens
  add(g, new THREE.CylinderGeometry(0.22, 0.23, 0.12, 48), chrome, [0.05, -0.03, 0.22], [Math.PI / 2, 0, 0]);
  add(g, new THREE.TorusGeometry(0.205, 0.016, 10, 48), black, [0.05, -0.03, 0.27]);
  add(g, new THREE.CylinderGeometry(0.17, 0.17, 0.12, 48), black, [0.05, -0.03, 0.3], [Math.PI / 2, 0, 0]);
  add(g, new THREE.CylinderGeometry(0.13, 0.13, 0.02, 48), glass, [0.05, -0.03, 0.36], [Math.PI / 2, 0, 0]);
  add(g, sphere(0.03, 16, 12), mat('#FFFFFF', 0.2, 0), [0.0, 0.02, 0.37], [0, 0, 0], [1, 1, 0.2]);
  // Windows, a dial, the shutter button, a red dot
  add(g, rbox(0.17, 0.08, 0.02, 0.01, 4), glass, [-0.3, 0.29, 0.175]);
  add(g, rbox(0.11, 0.08, 0.02, 0.01, 4), glass, [0.3, 0.29, 0.175]);
  add(g, new THREE.CylinderGeometry(0.085, 0.085, 0.05, 32), chrome, [-0.3, 0.385, 0]);
  add(g, new THREE.CylinderGeometry(0.04, 0.045, 0.045, 24), chrome, [0.3, 0.385, 0.05]);
  add(g, sphere(0.022, 16, 12), mat('#E0402C', 0.4), [0.43, 0.19, 0.172]);
  for (const s of [-1, 1])
    add(g, new THREE.CylinderGeometry(0.02, 0.02, 0.05, 16), chrome, [s * 0.52, 0.2, 0], [0, 0, Math.PI / 2]);
  return g;
}

/** A roasted bean: an oval, flat on one side, with the crease down it */
function bean(parent: THREE.Object3D, at: Vec, rot: Vec) {
  const b = new THREE.Group();
  b.position.set(...at);
  b.rotation.set(...rot);
  add(b, sphere(0.06, 24, 16), mat('#5A341C', 0.35, 0.12), [0, 0, 0], [0, 0, 0], [1, 0.72, 0.52]);
  add(b, rbox(0.085, 0.006, 0.014, 0.003, 2), mat('#21110A', 0.6), [0, 0, 0.028]);
  parent.add(b);
}

function coffee() {
  const g = new THREE.Group();
  const front = skiaTexture(256, 384, (c) => {
    c.drawRect(Skia.XYWHRect(0, 0, 256, 384), fill('#C99A62'));
    const grain = Skia.Paint();
    grain.setShader(Skia.Shader.MakeFractalNoise(0.9, 0.9, 2, 5, 0, 0));
    grain.setBlendMode(BlendMode.Multiply);
    grain.setAlphaf(0.12);
    c.drawRect(Skia.XYWHRect(0, 0, 256, 384), grain);
    // The heat seal across the top
    c.drawRect(Skia.XYWHRect(0, 10, 256, 34), fill('rgba(90,58,30,0.22)'));
    for (let x = 4; x < 256; x += 7) c.drawRect(Skia.XYWHRect(x, 14, 2, 26), fill('rgba(70,44,22,0.18)'));
    // The label
    c.drawRRect(Skia.RRectXY(Skia.XYWHRect(38, 116, 180, 196), 14, 14), fill('#F7F0E4'));
    const rimPaint = fill('#3B2618');
    rimPaint.setStyle(PaintStyle.Stroke);
    rimPaint.setStrokeWidth(3);
    c.drawRRect(Skia.RRectXY(Skia.XYWHRect(46, 124, 164, 180), 10, 10), rimPaint);
    c.drawOval(Skia.XYWHRect(108, 140, 40, 28), fill('#5A341C'));
    words(c, 'ROBUSTA', 178, 256, 30, '#3B2618', FontWeight.Black);
    words(c, 'ĐẮK LẮK', 220, 256, 18, '#8A5F3A', FontWeight.Bold);
    words(c, '500g · rang mộc', 258, 256, 15, '#3B2618', FontWeight.Medium);
  });
  const kraft = painted(textured('#C99A62', 70, 0.05), 0.85, 0.12);
  const label = new THREE.MeshStandardNodeMaterial({ map: front, roughness: 0.8, metalness: 0 });
  label.emissiveNode = rim(0.12);
  // A stand-up pouch: puffed in the middle, pinched flat at its sealed top
  const body = new THREE.BoxGeometry(0.6, 0.9, 0.26, 16, 24, 8);
  const p = body.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const nx = p.getX(i) / 0.3;
    const ny = (p.getY(i) + 0.45) / 0.9;
    const puff = (1 - Math.pow(Math.abs(nx), 6) * 0.7) * (1 - smooth(0.8, 0.92, ny) * 0.88);
    const gusset = 1 + (1 - smooth(0, 0.18, ny)) * 0.22;
    p.setZ(i, p.getZ(i) * puff * gusset);
    p.setX(i, p.getX(i) * (1 + (1 - smooth(0, 0.25, ny)) * 0.04));
  }
  body.computeVertexNormals();
  // +x, -x, +y, -y, +z, -z
  add(g, body, [kraft, kraft, kraft, kraft, label, kraft], [0, 0.45, 0]);
  add(g, new THREE.CylinderGeometry(0.035, 0.035, 0.03, 24), mat('#6E4B2C', 0.5), [0, 0.68, 0.11], [Math.PI / 2, 0, 0]);
  bean(g, [0.36, 0.035, 0.18], [-Math.PI / 2, 0, 0.6]);
  bean(g, [0.26, 0.035, 0.27], [-Math.PI / 2, 0, -0.4]);
  bean(g, [0.42, 0.035, 0.32], [-Math.PI / 2, 0, 1.6]);
  return g;
}

function monstera() {
  const g = new THREE.Group();
  const pot = new THREE.LatheGeometry(
    [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(0.19, 0),
      new THREE.Vector2(0.215, 0.02),
      new THREE.Vector2(0.26, 0.34),
      new THREE.Vector2(0.295, 0.35),
      new THREE.Vector2(0.3, 0.42),
      new THREE.Vector2(0.27, 0.43),
      new THREE.Vector2(0.255, 0.38),
    ],
    48
  );
  add(g, pot, painted(textured('#C8714B', 40, 0.05), 0.85, 0.12));
  add(g, new THREE.CylinderGeometry(0.255, 0.255, 0.02, 40), mat('#3A2A20', 0.95), [0, 0.39, 0]);
  const leafMap = skiaTexture(256, 256, (c) => {
    // A split leaf: a heart, its cuts running in from the edge, a midrib
    const leaf = Skia.PathBuilder.Make()
      .moveTo(128, 250)
      .cubicTo(30, 220, 0, 120, 40, 50)
      .cubicTo(70, 0, 118, 10, 128, 40)
      .cubicTo(138, 10, 186, 0, 216, 50)
      .cubicTo(256, 120, 226, 220, 128, 250)
      .close()
      .detach();
    c.drawPath(leaf, fill('#2F8A4C'));
    const vein = fill('#7CC48C');
    vein.setStyle(PaintStyle.Stroke);
    vein.setStrokeWidth(4);
    c.drawLine(128, 248, 128, 46, vein);
    const cut = Skia.Paint();
    cut.setAntiAlias(true);
    cut.setBlendMode(BlendMode.Clear);
    cut.setStyle(PaintStyle.Stroke);
    cut.setStrokeWidth(11);
    for (let k = 0; k < 4; k++) {
      const y = 80 + k * 40;
      c.drawLine(0, y - 6, 74 - k * 6, y + 16, cut);
      c.drawLine(256, y - 6, 182 + k * 6, y + 16, cut);
    }
  });
  const leafMat = new THREE.MeshStandardNodeMaterial({
    map: leafMap,
    side: THREE.DoubleSide,
    alphaTest: 0.5,
    roughness: 0.55,
    metalness: 0,
  });
  leafMat.emissiveNode = rim(0.1);
  const stem = mat('#4F8A3E', 0.6);
  const leafGeo = new THREE.PlaneGeometry(0.46, 0.46, 10, 10);
  leafGeo.translate(0, 0.23, 0);
  const lp = leafGeo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < lp.count; i++) {
    const y = lp.getY(i);
    const x = lp.getX(i);
    // Arched along its length, cupped a little across
    lp.setZ(i, -0.45 * y * y + 0.35 * x * x);
  }
  leafGeo.computeVertexNormals();
  // Leaves on long stems, fanning out from the pot, the tallest at the back
  const leaves: [number, number, number, number][] = [
    // angle round the pot, height, reach, lean back
    [3.0, 1.05, 0.12, 0.25],
    [-1.6, 0.9, 0.34, 0.75],
    [1.6, 0.86, 0.36, 0.8],
    [-0.5, 0.74, 0.3, 1.0],
    [0.6, 0.78, 0.3, 0.95],
  ];
  for (const [a, h, reach, lean] of leaves) {
    const end: Vec = [Math.sin(a) * reach, h, Math.cos(a) * reach];
    tube(g, [[0, 0.4, 0], [Math.sin(a) * reach * 0.25, h * 0.75, Math.cos(a) * reach * 0.25], end], 0.012, stem, 16);
    const leaf = new THREE.Mesh(leafGeo, leafMat);
    leaf.position.set(...end);
    leaf.rotation.set(-lean, a, 0, 'YXZ');
    g.add(leaf);
  }
  return g;
}

/** Rounded-off wayfarer lens outline, centred, w wide and h tall */
function lensShape(w: number, h: number, inset = 0) {
  const s = new THREE.Shape();
  const x0 = -w / 2 + inset;
  const x1 = w / 2 - inset;
  const y0 = -h / 2 + inset;
  const y1 = h / 2 - inset;
  const r = 0.07;
  s.moveTo(x0 + r, y1);
  s.lineTo(x1 - r, y1);
  s.quadraticCurveTo(x1, y1, x1, y1 - r);
  s.lineTo(x1 - 0.03, y0 + r);
  s.quadraticCurveTo(x1 - 0.04, y0, x1 - 0.04 - r, y0);
  s.lineTo(x0 + 0.06 + r, y0);
  s.quadraticCurveTo(x0 + 0.04, y0, x0 + 0.03, y0 + r);
  s.lineTo(x0, y1 - r);
  s.quadraticCurveTo(x0, y1, x0 + r, y1);
  return s;
}

function sunglasses() {
  const g = new THREE.Group();
  const frame = painted(
    mix(
      hex('#3A2416'),
      hex('#8A5A2E'),
      smoothstep(-0.2, 0.6, TSL.mx_noise_float(TSL.positionLocal.mul(14)))
    ) as unknown as V3,
    0.25,
    0.2
  );
  const lens = mat('#1F3B33', 0.04, 0.45);
  const W = 0.4;
  const Hh = 0.3;
  for (const s of [-1, 1]) {
    const outline = lensShape(W, Hh);
    outline.holes.push(lensShape(W, Hh, 0.04) as unknown as THREE.Path);
    const rimGeo = new THREE.ExtrudeGeometry(outline, {
      depth: 0.04,
      bevelEnabled: true,
      bevelThickness: 0.012,
      bevelSize: 0.012,
      bevelSegments: 3,
      curveSegments: 16,
    });
    add(g, rimGeo, frame, [s * 0.23, 0, 0], [0, 0, 0], [s, 1, 1]);
    const lensGeo = new THREE.ExtrudeGeometry(lensShape(W, Hh, 0.035), {
      depth: 0.012,
      bevelEnabled: false,
      curveSegments: 16,
    });
    add(g, lensGeo, lens, [s * 0.23, 0, 0.015], [0, 0, 0], [s, 1, 1]);
    // The arm back to the ear, bent down at its end
    rod(g, [s * 0.42, 0.1, 0.02], [s * 0.46, 0.08, -0.62], 0.016, frame);
    rod(g, [s * 0.46, 0.08, -0.62], [s * 0.46, -0.04, -0.74], 0.016, frame);
  }
  tube(
    g,
    [
      [-0.04, 0.06, 0.03],
      [0, 0.1, 0.04],
      [0.04, 0.06, 0.03],
    ],
    0.02,
    frame,
    12
  );
  return g;
}

function teddy() {
  const g = new THREE.Group();
  const fur = painted(textured('#B57D4C', 70, 0.09), 0.95, 0.16);
  const cream = painted(textured('#EBD3B2', 70, 0.06), 0.95, 0.12);
  const black = mat('#1A1412', 0.2, 0.3);
  const bow = mat('#D9473A', 0.5, 0.15);
  add(g, sphere(0.3), fur, [0, 0.3, 0], [0, 0, 0], [1, 1.08, 0.92]);
  add(g, sphere(0.17), cream, [0, 0.27, 0.15], [0, 0, 0], [1, 1.1, 0.6]);
  add(g, sphere(0.26), fur, [0, 0.78, 0.02]);
  add(g, sphere(0.11), cream, [0, 0.72, 0.21], [0, 0, 0], [1.2, 0.85, 0.85]);
  add(g, sphere(0.04, 16, 12), black, [0, 0.76, 0.31], [0, 0, 0], [1.3, 1, 1]);
  for (const s of [-1, 1]) {
    add(g, sphere(0.032, 16, 12), black, [s * 0.1, 0.85, 0.22]);
    add(g, sphere(0.095), fur, [s * 0.2, 0.99, 0]);
    add(g, sphere(0.06), cream, [s * 0.2, 0.99, 0.045], [0, 0, 0], [1, 1, 0.5]);
    add(g, sphere(0.1), fur, [s * 0.31, 0.38, 0.08], [0, 0, s * 0.5], [1, 1.6, 1]);
    add(g, sphere(0.12), fur, [s * 0.16, 0.06, 0.14], [0, 0, 0], [1, 0.9, 1.4]);
    add(g, sphere(0.07), cream, [s * 0.16, 0.06, 0.29], [0, 0, 0], [1, 1, 0.3]);
    add(g, new THREE.ConeGeometry(0.07, 0.12, 24), bow, [s * 0.07, 0.56, 0.24], [0, 0, (s * Math.PI) / 2]);
  }
  add(g, sphere(0.035, 16, 12), bow, [0, 0.56, 0.25]);
  return g;
}

function skateboard() {
  const g = new THREE.Group();
  const deck = new THREE.Shape();
  const L = 0.6;
  const Wd = 0.16;
  deck.moveTo(-L + Wd, -Wd);
  deck.lineTo(L - Wd, -Wd);
  deck.absarc(L - Wd, 0, Wd, -Math.PI / 2, Math.PI / 2, false);
  deck.lineTo(-L + Wd, Wd);
  deck.absarc(-L + Wd, 0, Wd, Math.PI / 2, (Math.PI * 3) / 2, false);
  const geo = new THREE.ExtrudeGeometry(deck, {
    depth: 0.03,
    bevelEnabled: true,
    bevelThickness: 0.01,
    bevelSize: 0.01,
    bevelSegments: 3,
    curveSegments: 24,
  });
  geo.rotateX(-Math.PI / 2);
  // The kicks at each end
  const p = geo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = Math.abs(p.getX(i));
    p.setY(i, p.getY(i) + Math.pow(Math.max(0, x - 0.38), 2) * 1.6);
  }
  geo.computeVertexNormals();
  const grip = painted(textured('#2A2A2E', 260, 0.18), 0.98, 0.1);
  const maple = mat('#E2B07A', 0.6);
  // Caps first (grip on top), then the sides (the maple edge)
  add(g, geo, [grip, maple], [0, 0.2, 0]);
  // A stripe of colour along the grip
  add(g, rbox(0.7, 0.004, 0.06, 0.002, 2), mat('#F2994A', 0.8), [0, 0.247, 0]);
  const metal = mat('#C9CDD3', 0.3, 0.2);
  const wheel = mat('#F2C14E', 0.45, 0.18);
  for (const s of [-1, 1]) {
    add(g, rbox(0.12, 0.02, 0.1, 0.008, 4), metal, [s * 0.36, 0.18, 0]);
    add(g, rbox(0.06, 0.06, 0.3, 0.02, 6), metal, [s * 0.36, 0.13, 0]);
    for (const z of [-1, 1]) {
      add(g, new THREE.CylinderGeometry(0.06, 0.06, 0.055, 32), wheel, [s * 0.36, 0.09, z * 0.19], [Math.PI / 2, 0, 0]);
      add(
        g,
        new THREE.CylinderGeometry(0.025, 0.025, 0.06, 16),
        metal,
        [s * 0.36, 0.09, z * 0.19],
        [Math.PI / 2, 0, 0]
      );
    }
  }
  return g;
}

function lamp() {
  const g = new THREE.Group();
  const body = mat('#2E3136', 0.4, 0.2);
  const brass = mat('#D2A34D', 0.3, 0.25);
  add(g, new THREE.CylinderGeometry(0.24, 0.27, 0.07, 48), body, [0, 0.035, 0]);
  const base: Vec = [0, 0.08, 0];
  const elbow: Vec = [-0.16, 0.6, 0];
  const head: Vec = [0.26, 0.86, 0];
  rod(g, base, elbow, 0.024, brass);
  rod(g, elbow, head, 0.024, brass);
  for (const j of [base, elbow, head]) add(g, sphere(0.045, 24, 16), body, j);
  // The shade, its mouth turned down to the desk, lit inside
  const shade = new THREE.LatheGeometry(
    [
      new THREE.Vector2(0.04, 0.2),
      new THREE.Vector2(0.07, 0.18),
      new THREE.Vector2(0.12, 0.08),
      new THREE.Vector2(0.2, -0.02),
      new THREE.Vector2(0.21, -0.04),
    ],
    48
  );
  const shadeMat = mat('#E8B23A', 0.35, 0.22);
  shadeMat.side = THREE.DoubleSide;
  const inside = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide });
  inside.colorNode = vec3(1.0, 0.92, 0.72);
  const h = new THREE.Group();
  h.position.set(...head);
  h.rotation.set(0, 0, -0.95);
  add(h, shade, shadeMat, [0.14, -0.06, 0]);
  add(h, shade, inside, [0.14, -0.065, 0], [0, 0, 0], [0.97, 0.97, 0.97]);
  const bulb = new THREE.MeshStandardNodeMaterial({ roughness: 0.3, metalness: 0 });
  bulb.colorNode = vec3(1, 0.95, 0.85);
  bulb.emissiveNode = vec3(1.0, 0.86, 0.6).mul(1.1);
  add(h, sphere(0.065, 24, 16), bulb, [0.14, -0.1, 0]);
  g.add(h);
  return g;
}

function guitar() {
  const g = new THREE.Group();
  const top = painted(
    hex('#E9C48E').mul(sin(TSL.positionLocal.x.mul(140)).mul(0.02).add(1)) as unknown as V3,
    0.45,
    0.15
  );
  const side = mat('#7A4528', 0.45, 0.15);
  const neckMat = mat('#8A5530', 0.5);
  const board = mat('#2E1F18', 0.6);
  const dark = mat('#1A120D', 0.9);
  const metal = mat('#D7D9DD', 0.3, 0.2);
  const body = new THREE.Shape();
  body.moveTo(0, -0.38);
  body.bezierCurveTo(0.26, -0.38, 0.38, -0.24, 0.37, -0.04);
  body.bezierCurveTo(0.36, 0.12, 0.22, 0.18, 0.22, 0.28);
  body.bezierCurveTo(0.22, 0.38, 0.3, 0.42, 0.29, 0.54);
  body.bezierCurveTo(0.28, 0.7, 0.14, 0.76, 0, 0.76);
  body.bezierCurveTo(-0.14, 0.76, -0.28, 0.7, -0.29, 0.54);
  body.bezierCurveTo(-0.3, 0.42, -0.22, 0.38, -0.22, 0.28);
  body.bezierCurveTo(-0.22, 0.18, -0.36, 0.12, -0.37, -0.04);
  body.bezierCurveTo(-0.38, -0.24, -0.26, -0.38, 0, -0.38);
  const bodyGeo = new THREE.ExtrudeGeometry(body, {
    depth: 0.13,
    bevelEnabled: true,
    bevelThickness: 0.015,
    bevelSize: 0.015,
    bevelSegments: 3,
    curveSegments: 24,
  });
  bodyGeo.translate(0, 0, -0.065);
  add(g, bodyGeo, [top, side]);
  const face = 0.081;
  add(g, new THREE.CircleGeometry(0.095, 40), dark, [0, 0.3, face]);
  add(g, new THREE.RingGeometry(0.105, 0.125, 48), side, [0, 0.3, face]);
  add(g, rbox(0.24, 0.05, 0.025, 0.01, 4), board, [0, -0.12, face]);
  add(g, rbox(0.1, 0.95, 0.06, 0.02, 6), neckMat, [0, 1.2, -0.01]);
  add(g, rbox(0.09, 0.95, 0.014, 0.004, 4), board, [0, 1.2, 0.025]);
  for (let k = 1; k < 7; k++) add(g, rbox(0.09, 0.006, 0.006, 0.002, 2), metal, [0, 0.8 + k * 0.12, 0.034]);
  add(g, rbox(0.16, 0.24, 0.05, 0.03, 6), neckMat, [0, 1.78, -0.01]);
  for (const s of [-1, 1])
    for (let k = 0; k < 3; k++)
      add(
        g,
        new THREE.CylinderGeometry(0.014, 0.014, 0.06, 12),
        metal,
        [s * 0.1, 1.7 + k * 0.07, -0.01],
        [0, 0, Math.PI / 2]
      );
  for (let k = 0; k < 6; k++) {
    const x = -0.035 + k * 0.014;
    rod(g, [x, -0.12, face + 0.016], [x * 0.9, 1.68, 0.037], 0.0025, metal);
  }
  g.rotation.z = -0.38;
  return g;
}

function backpack() {
  const g = new THREE.Group();
  const canvas = painted(textured('#D98E4A', 120, 0.07), 0.9, 0.14);
  const flap = painted(textured('#C27A3A', 120, 0.07), 0.9, 0.14);
  const pocket = painted(textured('#E7A35E', 120, 0.07), 0.9, 0.14);
  const leather = mat('#5B3420', 0.55, 0.15);
  const metal = mat('#D7C18A', 0.3, 0.2);
  add(g, rbox(0.62, 0.78, 0.34, 0.15), canvas, [0, 0.39, 0]);
  add(g, rbox(0.6, 0.28, 0.36, 0.13), flap, [0, 0.68, 0.005]);
  add(g, rbox(0.46, 0.3, 0.12, 0.08), pocket, [0, 0.24, 0.19]);
  add(g, rbox(0.4, 0.012, 0.012, 0.005, 2), mat('#3B2A1E', 0.5), [0, 0.375, 0.25]);
  for (const s of [-1, 1]) {
    add(g, rbox(0.06, 0.26, 0.02, 0.008, 4), leather, [s * 0.15, 0.6, 0.185]);
    add(g, rbox(0.075, 0.05, 0.025, 0.006, 4), metal, [s * 0.15, 0.49, 0.192]);
    tube(
      g,
      [
        [s * 0.17, 0.72, -0.17],
        [s * 0.2, 0.4, -0.28],
        [s * 0.17, 0.08, -0.17],
      ],
      0.032,
      leather,
      24
    );
  }
  add(g, new THREE.TorusGeometry(0.09, 0.02, 12, 32, Math.PI), leather, [0, 0.8, 0]);
  return g;
}

function watermelon() {
  const g = new THREE.Group();
  const R = 0.62;
  const s = new THREE.Shape();
  const a0 = (50 * Math.PI) / 180;
  const a1 = (130 * Math.PI) / 180;
  s.moveTo(0, 0);
  s.lineTo(Math.cos(a0) * R, Math.sin(a0) * R);
  s.absarc(0, 0, R, a0, a1, false);
  s.lineTo(0, 0);
  const geo = new THREE.ExtrudeGeometry(s, {
    depth: 0.2,
    bevelEnabled: true,
    bevelThickness: 0.015,
    bevelSize: 0.015,
    bevelSegments: 3,
    curveSegments: 40,
  });
  geo.translate(0, 0, -0.1);
  // Coloured by how far from the slice's point: skin, then the pale rind, then the flesh
  const q = TSL.positionLocal;
  const r = length(q.xy);
  const stripes = sin(atan(q.y, q.x).mul(44)).mul(0.5).add(0.5);
  const skin = mix(hex('#2F6B2C'), hex('#4E8F3E'), stripes);
  const flesh = mix(hex('#F04E5A'), hex('#FF7A7A'), smoothstep(R * 0.8, R * 0.2, r));
  const color = select(r.greaterThan(R * 0.95), skin, select(r.greaterThan(R * 0.86), hex('#DDEDC4'), flesh));
  add(g, geo, painted(color as unknown as V3, 0.5, 0.14), [0, -R * 0.5, 0]);
  const seed = mat('#1A1210', 0.25, 0.2);
  const seeds: [number, number][] = [
    [0.36, 82],
    [0.44, 96],
    [0.32, 102],
    [0.47, 72],
    [0.41, 112],
    [0.27, 90],
  ];
  for (const z of [-1, 1])
    for (const [rr, deg] of seeds) {
      const a = (deg * Math.PI) / 180;
      add(
        g,
        sphere(0.022, 12, 10),
        seed,
        [Math.cos(a) * rr, Math.sin(a) * rr - R * 0.5, z * 0.118],
        [0, 0, a - Math.PI / 2],
        [0.6, 1, 0.35]
      );
    }
  return g;
}

function milk() {
  const g = new THREE.Group();
  // A gable-top carton: the printed sides, then the roof folded up into a sealed fin
  const W = 0.34;
  const H = 0.62;
  const side = skiaTexture(256, 512, (c) => {
    c.drawRect(Skia.XYWHRect(0, 0, 256, 512), fill('#F7F9FB'));
    // Sky and a green hill with a cow on it
    c.drawRect(Skia.XYWHRect(0, 0, 256, 300), fill('#BFE0F5'));
    const hill = Skia.PathBuilder.Make()
      .moveTo(0, 300)
      .quadTo(90, 220, 256, 270)
      .lineTo(256, 512)
      .lineTo(0, 512)
      .close()
      .detach();
    c.drawPath(hill, fill('#8CCB6E'));
    c.drawRect(Skia.XYWHRect(0, 330, 256, 182), fill('#F7F9FB'));
    c.drawOval(Skia.XYWHRect(150, 232, 70, 40), fill('#FFFFFF'));
    c.drawOval(Skia.XYWHRect(168, 240, 22, 16), fill('#2B2B2B'));
    c.drawOval(Skia.XYWHRect(204, 226, 26, 22), fill('#FFFFFF'));
    words(c, 'SỮA TƯƠI', 40, 256, 34, '#1E5FA8', FontWeight.Black);
    words(c, 'THANH TRÙNG', 86, 256, 16, '#1E5FA8', FontWeight.Bold);
    words(c, 'Ba Vì', 352, 256, 30, '#1E5FA8', FontWeight.Black);
    words(c, '1 lít · không đường', 400, 256, 16, '#3B6EA8', FontWeight.Medium);
    c.drawRect(Skia.XYWHRect(0, 470, 256, 42), fill('#1E5FA8'));
  });
  const print = new THREE.MeshStandardNodeMaterial({ map: side, roughness: 0.55, metalness: 0 });
  print.emissiveNode = rim(0.14);
  const paper = mat('#F4F6F8', 0.55, 0.14);
  add(g, rbox(W, H, W, 0.02, 6), [print, print, paper, paper, print, print], [0, H / 2, 0]);
  // The roof: two slopes meeting in a ridge, closed at the ends
  const roof = new THREE.Shape();
  roof.moveTo(-W / 2, 0);
  roof.lineTo(0, 0.13);
  roof.lineTo(W / 2, 0);
  roof.lineTo(-W / 2, 0);
  const roofGeo = new THREE.ExtrudeGeometry(roof, { depth: W, bevelEnabled: false });
  roofGeo.translate(0, 0, -W / 2);
  add(g, roofGeo, mat('#1E5FA8', 0.5, 0.14), [0, H, 0]);
  add(g, rbox(0.03, 0.06, W, 0.008, 3), mat('#F4F6F8', 0.55, 0.12), [0, H + 0.16, 0]);
  // The screw cap on the slope
  add(
    g,
    new THREE.CylinderGeometry(0.045, 0.045, 0.04, 24),
    mat('#2E8BD8', 0.4, 0.14),
    [0, H + 0.07, 0.08],
    [0.75, 0, 0]
  );
  return g;
}

function eggs() {
  const g = new THREE.Group();
  // A pulp tray of ten, two rows of five, with a clear lid
  const pulp = painted(textured('#C9B79C', 80, 0.08), 0.95, 0.1);
  add(g, rbox(0.98, 0.1, 0.42, 0.03, 6), pulp, [0, 0.05, 0]);
  const shell = mat('#E9C9A3', 0.5, 0.16);
  const white = mat('#F6EEE2', 0.5, 0.16);
  for (let r = 0; r < 2; r++)
    for (let k = 0; k < 5; k++) {
      const x = -0.38 + k * 0.19;
      const z = -0.095 + r * 0.19;
      // A cup in the tray under each egg
      add(g, new THREE.CylinderGeometry(0.085, 0.06, 0.08, 24), pulp, [x, 0.13, z]);
      add(g, sphere(0.075, 28, 20), (k + r) % 3 === 0 ? white : shell, [x, 0.22, z], [0, 0, 0], [1, 1.28, 1]);
    }
  const lid = new THREE.MeshStandardNodeMaterial({
    color: '#FFFFFF',
    roughness: 0.15,
    metalness: 0,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
  });
  add(g, rbox(1.0, 0.22, 0.44, 0.06, 6), lid, [0, 0.25, 0]);
  return g;
}

function iceCream() {
  const g = new THREE.Group();
  // A round tub, its lid printed with coconut halves
  const top = skiaTexture(256, 256, (c) => {
    c.drawCircle(128, 128, 128, fill('#FFF7EA'));
    c.drawCircle(128, 128, 118, fill('#7FC8B5'));
    c.drawCircle(92, 112, 40, fill('#6B4A32'));
    c.drawCircle(92, 112, 31, fill('#FFFDF7'));
    c.drawCircle(160, 150, 34, fill('#6B4A32'));
    c.drawCircle(160, 150, 26, fill('#FFFDF7'));
    words(c, 'KEM DỪA', 186, 256, 30, '#FFFFFF', FontWeight.Black);
  });
  const band = skiaTexture(512, 128, (c) => {
    c.drawRect(Skia.XYWHRect(0, 0, 512, 128), fill('#FFF7EA'));
    c.drawRect(Skia.XYWHRect(0, 88, 512, 40), fill('#7FC8B5'));
    words(c, 'KEM DỪA BẾN TRE · 450ml', 34, 512, 30, '#2F6F5F', FontWeight.Black);
  });
  const sideM = new THREE.MeshStandardNodeMaterial({ map: band, roughness: 0.45, metalness: 0 });
  sideM.emissiveNode = rim(0.14);
  const topM = new THREE.MeshStandardNodeMaterial({ map: top, roughness: 0.4, metalness: 0 });
  topM.emissiveNode = rim(0.1);
  const plain = mat('#FFF7EA', 0.45, 0.12);
  add(g, new THREE.CylinderGeometry(0.4, 0.33, 0.42, 48, 1, false), [sideM, plain, plain], [0, 0.21, 0]);
  add(g, new THREE.CylinderGeometry(0.43, 0.42, 0.07, 48), [mat('#7FC8B5', 0.4, 0.14), topM, plain], [0, 0.45, 0]);
  return g;
}

function mango() {
  const g = new THREE.Group();
  // A long cát Hòa Lộc mango: yellow going green at the shoulder, a blush, a stub of stalk
  const q = TSL.positionLocal;
  const ripe = mix(hex('#F2B632'), hex('#A9C64A'), smoothstep(0.1, 0.5, q.y.add(q.x.mul(0.4))));
  const skin = mix(ripe, hex('#E9853A'), smoothstep(0.35, 0.0, q.x.negate().add(q.y.mul(0.3))).mul(0.35));
  const body = sphere(1, 48, 32);
  const p = body.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    // Fuller at the shoulder, a beak curving off at the tip
    p.setX(i, p.getX(i) * (1 + 0.12 * y) + 0.12 * Math.max(0, -y) ** 2);
  }
  body.computeVertexNormals();
  add(g, body, painted(skin as unknown as V3, 0.4, 0.16), [0, 0, 0], [0, 0, -1.2], [0.24, 0.42, 0.24]);
  rod(g, [0.38, 0.15, 0], [0.47, 0.21, 0], 0.018, mat('#5C4A2A', 0.8));
  return g;
}

const BUILDERS = [
  headphones,
  sneaker,
  camera,
  coffee,
  monstera,
  sunglasses,
  teddy,
  skateboard,
  lamp,
  guitar,
  backpack,
  watermelon,
  milk,
  eggs,
  iceCream,
  mango,
];

/** A product, centred on the origin and scaled to fit inside a sphere of radius 0.5 */
export function buildProduct(id: number) {
  const inner = BUILDERS[id % BUILDERS.length]();
  const wrapper = new THREE.Group();
  wrapper.add(inner);
  wrapper.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(inner);
  const centre = box.getCenter(new THREE.Vector3());
  let radius = 0;
  const v = new THREE.Vector3();
  inner.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const p = mesh.geometry.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p as THREE.BufferAttribute, i).applyMatrix4(mesh.matrixWorld);
      radius = Math.max(radius, v.distanceTo(centre));
    }
  });
  inner.position.sub(centre);
  const fit = new THREE.Group();
  fit.add(wrapper);
  wrapper.scale.setScalar(0.5 / Math.max(radius, 1e-3));
  return fit;
}

// For the fridge's own things, made the same way
export { add, fill, hex, mat, painted, rim, rod, skiaTexture, smooth, sphere, textured, tube, words };
export type { V3, Vec };
