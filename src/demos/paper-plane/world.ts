import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';

/**
 * The field after school: rice going gold in paddies cut by earth ridges, a few flooded plots
 * holding the sky, bamboo and hills hazy at the horizon, the sun sitting on it. Rice right in
 * front sways in the wind and glows where the low sun comes through it; specks of pollen drift
 * in the light, egrets cross far off, and somebody's kite hangs over the next field. Everything
 * is a shader or GPU-placed instances; the JS thread only moves the camera.
 *
 * The same field also has a blue hour, `night`: a crescent moon where the sun was, stars, the
 * rice silvered, fireflies instead of pollen. Your friend is on that side of it.
 *
 * Units are about 21 cm (the page is 1 wide): eyes at 0, the ground 6 below.
 */

type F = THREE.Node<'float'>;
type V2 = THREE.Node<'vec2'>;
type V3 = THREE.Node<'vec3'>;

const { float, vec2, vec3, mix, smoothstep, pow, exp, sin, cos, fract, floor, length, dot, abs } = TSL;
const { oneMinus, saturate, atan, normalize, uv, Fn, Loop, mod, min } = TSL;

export const GROUND = -6;
/** Toward the sun: low, a little left of straight ahead */
export const SUN = new THREE.Vector3(-0.14, 0.024, -1).normalize();
const sun = vec3(SUN.x, SUN.y, SUN.z);
const time = TSL.time;

/** 0 golden hour (your side), 1 blue hour (your friend's) */
export const night = TSL.uniform(0);
/** By day, or by night */
const dn = (day: V3, dark: V3) => mix(day, dark, night);

/** The haze at the horizon, which everything far away fades into */
const HAZE = dn(vec3(0.94, 0.6, 0.42), vec3(0.3, 0.27, 0.42));

const hash21 = (p: V2) => TSL.hash(p.x.add(p.y.mul(157)).add(8192)) as F;
const noise2 = Fn(([q]: [V2]) => {
  const i = floor(q);
  const f = fract(q);
  const u = f.mul(f).mul(f.mul(-2).add(3));
  const a = hash21(i);
  const b = hash21(i.add(vec2(1, 0)));
  const c = hash21(i.add(vec2(0, 1)));
  const d = hash21(i.add(vec2(1, 1)));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
});
const fbm2 = Fn(([q]: [V2]) => {
  const p = vec2(q).toVar();
  const v = float(0).toVar();
  const a = float(0.5).toVar();
  Loop(4, () => {
    v.addAssign(a.mul(noise2(p)));
    p.assign(p.mul(2.03).add(vec2(17.1, 9.2)));
    a.mulAssign(0.5);
  });
  return v;
});

/** Per-instance random numbers, 0..1 */
const seed = (k: number, count: number) => TSL.hash(TSL.instanceIndex.add(k * count + 11)) as F;

const viewDir = () => normalize(TSL.positionWorld.sub(TSL.cameraPosition));
/** Light scattered toward you when you look toward the sun through something */
const backlight = (power: number) => pow(saturate(dot(viewDir(), sun)), power);
const fogged = (color: V3, density: number) => {
  const d = length(TSL.positionWorld.xz.sub(TSL.cameraPosition.xz));
  const glow = mix(HAZE, dn(vec3(1.0, 0.58, 0.3), vec3(0.42, 0.4, 0.58)), backlight(3));
  return mix(color, glow, oneMinus(exp(d.mul(-density))));
};

// ---- Sky ----

export function skyMesh() {
  const material = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false, fog: false });
  const dir = viewDir();
  const e = dir.y;
  const mu = dot(dir, sun);
  const horizon = dn(vec3(0.94, 0.44, 0.24), vec3(0.46, 0.36, 0.52));
  const blush = dn(vec3(0.78, 0.36, 0.4), vec3(0.24, 0.22, 0.42));
  const zenith = dn(vec3(0.24, 0.22, 0.44), vec3(0.04, 0.06, 0.16));
  const base = mix(mix(horizon, blush, smoothstep(-0.01, 0.12, e)), zenith, smoothstep(0.08, 0.6, e));
  // Warmer all along the sun's side of the sky
  const warm = mix(
    base,
    dn(vec3(0.96, 0.42, 0.22), vec3(0.42, 0.38, 0.6)),
    pow(mu.mul(0.5).add(0.5), 6)
      .mul(0.5)
      .mul(smoothstep(0.5, 0.0, e))
  );
  // Streaks of cloud, lit gold and pink on the sun's side, lavender away from it
  const q = dir.xz.div(e.add(0.14)).mul(vec2(0.55, 2.2));
  const c = fbm2(q.add(vec2(time.mul(0.012), 0)));
  const cloud = smoothstep(0.52, 0.78, c)
    .mul(smoothstep(0.02, 0.1, e))
    .mul(smoothstep(0.62, 0.22, e));
  const lit = mix(
    dn(vec3(0.7, 0.58, 0.72), vec3(0.12, 0.12, 0.24)),
    dn(vec3(1.0, 0.58, 0.42), vec3(0.36, 0.36, 0.52)),
    pow(mu.mul(0.5).add(0.5), 3)
  );
  const rim = dn(vec3(1.0, 0.66, 0.36), vec3(0.7, 0.74, 0.9))
    .mul(pow(saturate(mu), 5))
    .mul(oneMinus(smoothstep(0.55, 0.8, c)));
  const clouded = mix(warm, lit.add(rim), cloud.mul(0.78));
  // The sun: a halo, a bright core for the bloom, and the disc sitting on the hills
  const halo = pow(saturate(mu), 8)
    .mul(0.12)
    .add(pow(saturate(mu), 70).mul(0.12))
    .add(pow(saturate(mu), 900).mul(0.16));
  const day = oneMinus(night);
  // By night the moon sits there instead: a crescent, its dark side cut by a second disc
  const moonDisc = smoothstep(0.99966, 0.99984, mu);
  const shadow = smoothstep(0.99962, 0.99985, dot(dir, normalize(sun.add(vec3(0.0075, 0.005, 0)))));
  const moon = moonDisc.mul(oneMinus(shadow)).mul(night);
  const moonGlow = pow(saturate(mu), 300)
    .mul(0.22)
    .add(pow(saturate(mu), 40).mul(0.06))
    .mul(night);
  // And stars, coming out higher up
  const az0 = atan(dir.x, dir.z.negate());
  const grid = vec2(az0.mul(260), e.mul(260));
  const cell = floor(grid);
  // A round point somewhere in its cell, not the cell itself
  const spot = fract(grid).sub(
    vec2(hash21(cell.add(3)), hash21(cell.add(5)))
      .mul(0.6)
      .add(0.2)
  );
  const star = TSL.step(0.9965, hash21(cell))
    .mul(smoothstep(0.16, 0.04, length(spot)))
    .mul(
      sin(time.mul(2.0).add(hash21(cell.add(7)).mul(40)))
        .mul(0.35)
        .add(0.65)
    )
    .mul(smoothstep(0.06, 0.35, e))
    .mul(night);
  const sunlit = clouded
    .add(vec3(1.0, 0.36, 0.14).mul(halo).mul(day))
    .add(
      // An orange-red disc, a little brighter and yellower at its heart
      mix(vec3(0.92, 0.2, 0.07), vec3(1.0, 0.34, 0.12), smoothstep(0.99978, 0.99994, mu))
        .mul(smoothstep(0.99968, 0.99982, mu))
        .mul(day)
    )
    .add(vec3(1.9, 1.85, 1.6).mul(moon))
    .add(vec3(0.62, 0.66, 0.9).mul(moonGlow))
    .add(vec3(1.1, 1.1, 1.2).mul(star));
  // Hills far off, layered in haze
  const az = atan(dir.x, dir.z.negate());
  const ridgeA = float(0.014).add(fbm2(vec2(az.mul(5), 1.3)).mul(0.03));
  const ridgeB = float(0.006).add(fbm2(vec2(az.mul(9), 7.1)).mul(0.016));
  const hillA = smoothstep(ridgeA.add(0.0015), ridgeA, e);
  const hillB = smoothstep(ridgeB.add(0.0012), ridgeB, e);
  const far = mix(sunlit, mix(dn(vec3(0.66, 0.54, 0.64), vec3(0.16, 0.15, 0.26)), horizon, 0.42), hillA.mul(0.85));
  const sky = mix(far, mix(dn(vec3(0.58, 0.48, 0.56), vec3(0.11, 0.1, 0.2)), horizon, 0.3), hillB.mul(0.9));
  material.colorNode = sky;
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1400, 48, 24), material);
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  return mesh;
}

// ---- The field ----

export function fieldMesh() {
  const material = new THREE.MeshBasicNodeMaterial();
  const p = TSL.positionWorld.xz;
  const plot = vec2(44, 30);
  const id = floor(p.div(plot));
  const f = fract(p.div(plot));
  const edge = min(min(f.x, oneMinus(f.x)).mul(plot.x), min(f.y, oneMinus(f.y)).mul(plot.y));
  const ridge = smoothstep(1.1, 0.5, edge);
  const kind = hash21(id);
  const gold = mix(vec3(0.9, 0.72, 0.34), vec3(0.7, 0.64, 0.3), hash21(id.add(31)));
  const green = vec3(0.46, 0.57, 0.25);
  const rice = dn(mix(gold, green, smoothstep(0.78, 0.82, kind)), vec3(0.13, 0.17, 0.2));
  // Rows of plants, and the wind combing silver waves across them
  const rows = sin(p.x.mul(2.4).add(noise2(p.mul(0.4)).mul(3)))
    .mul(0.5)
    .add(0.5);
  const d = length(p.sub(TSL.cameraPosition.xz));
  const near = smoothstep(120, 20, d);
  const wave = fbm2(p.mul(0.03).add(vec2(time.mul(0.32), time.mul(0.1))));
  const sheen = smoothstep(0.42, 0.78, wave);
  const crop = rice.mul(float(0.8).add(sheen.mul(0.32))).mul(oneMinus(rows.mul(near).mul(0.12)));
  // A few plots still flooded, holding the sky
  const flooded = smoothstep(0.1, 0.08, kind);
  const ripple = noise2(p.mul(0.9).add(vec2(time.mul(0.4), 0)))
    .mul(0.06)
    .sub(0.03);
  const reflect = vec3(viewDir().x.add(ripple), viewDir().y.negate(), viewDir().z);
  const sky = mix(
    dn(vec3(1.0, 0.78, 0.52), vec3(0.4, 0.34, 0.52)),
    dn(vec3(0.9, 0.6, 0.58), vec3(0.1, 0.11, 0.24)),
    smoothstep(0.0, 0.2, reflect.y)
  );
  const glint = pow(saturate(dot(normalize(reflect), sun)), 200).mul(2.2);
  const water = sky.add(dn(vec3(1.0, 0.8, 0.5), vec3(0.85, 0.88, 1.0)).mul(glint));
  const earth = dn(vec3(0.45, 0.38, 0.22), vec3(0.09, 0.09, 0.12));
  const ground = mix(mix(crop, water, flooded), earth, ridge.mul(0.85));
  const light = ground
    .mul(dn(vec3(1.0, 0.87, 0.7), vec3(0.85, 0.9, 1.1)))
    .add(dn(vec3(1.0, 0.75, 0.4), vec3(0.45, 0.5, 0.7)).mul(backlight(5).mul(0.3).mul(sheen.mul(0.6).add(0.4))));
  material.colorNode = fogged(light, 0.0021);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(5000, 5000).rotateX(-Math.PI / 2), material);
  mesh.position.y = GROUND;
  mesh.renderOrder = -5;
  return mesh;
}

/** Bamboo and trees around the edge of the fields, flat against the haze */
export function treelineMesh() {
  const material = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, transparent: true, depthWrite: false });
  const v = uv();
  const u = v.x.mul(Math.PI * 2);
  const crown = float(0.35)
    .add(fbm2(vec2(u.mul(14), 2.1)).mul(0.45))
    .add(pow(noise2(vec2(u.mul(60), 5.0)), 5).mul(0.35));
  const mask = smoothstep(crown.add(0.02), crown, v.y);
  const dir = viewDir();
  material.colorNode = mix(
    dn(vec3(0.5, 0.42, 0.42), vec3(0.08, 0.08, 0.14)),
    HAZE,
    float(0.48).add(backlight(4).mul(0.3))
  ).mul(float(0.88).add(v.y.mul(0.12)));
  material.opacityNode = mask.mul(smoothstep(-0.01, 0.002, dir.y.add(0.004)).mul(0.92));
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(900, 900, 46, 512, 1, true), material);
  mesh.position.y = GROUND + 22;
  mesh.renderOrder = -4;
  return mesh;
}

// ---- Rice in front of you ----

const RICE = 9600;
/** Blades to a clump: rice grows in hills, each a fan of leaves from one root */
const CLUMP = 8;

/** A strip from y = 0 to 1, x = -1 or 1 at each level; the shader shapes and bends it */
function stripGeometry(segments: number) {
  const pts: number[] = [];
  const uvs: number[] = [];
  const idx: number[] = [];
  for (let s = 0; s <= segments; s++) {
    const y = s / segments;
    pts.push(-1, y, 0, 1, y, 0);
    uvs.push(0, y, 1, y);
    if (s < segments) {
      const a = s * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  return g;
}

export function riceMesh() {
  const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  const g = TSL.positionGeometry;
  const y = g.y;
  const clump = floor(float(TSL.instanceIndex).div(CLUMP));
  const ch = (k: number) => TSL.hash(clump.mul(7.13).add(k * 101 + 3)) as F;
  // The hill: rows a little irregular, denser and taller near you
  // Wrapped around the camera, so a camera flying over the field never runs out of rice
  const cam = TSL.cameraPosition;
  const cx = TSL.mod(mix(float(-24), float(24), ch(1)).sub(cam.x).add(24), 48)
    .sub(24)
    .add(cam.x);
  const cz = float(-5.5)
    .sub(TSL.mod(pow(ch(2), 0.8).mul(40).add(cam.z), 40))
    .add(cam.z);
  const spread = seed(0, RICE).mul(0.32);
  const fan = seed(1, RICE).mul(Math.PI * 2);
  const base = vec3(cx.add(cos(fan).mul(spread)), GROUND, cz.add(sin(fan).mul(spread)));
  const grain = smoothstep(0.6, 0.64, seed(2, RICE));
  const h = float(3.0)
    .add(seed(3, RICE).mul(1.5))
    .mul(float(1).add(grain.mul(0.12)));
  // Leaves fan out from the root and arch over; ripe stalks droop at the head
  const yaw = fan.add(seed(4, RICE).sub(0.5).mul(0.9));
  const out = vec2(cos(yaw), sin(yaw));
  const side = vec2(out.y.negate(), out.x);
  const arch = float(0.1).add(seed(5, RICE).mul(0.22)).mul(pow(y, 2.5)).mul(h).mul(0.3);
  const droop = grain
    .mul(pow(smoothstep(0.62, 1.0, y), 2))
    .mul(h)
    .mul(0.16);
  // Gusts roll across the field; each stalk adds its own little shiver
  const phase = seed(6, RICE).mul(Math.PI * 2);
  const gust = noise2(vec2(cx.mul(0.1).add(time.mul(0.85)), cz.mul(0.1)))
    .sub(0.45)
    .mul(1.25);
  const shiver = sin(time.mul(2.3).add(phase)).mul(0.1);
  const sway = gust.add(shiver).mul(y.mul(y)).mul(h).mul(0.3);
  // A leaf is widest a third of the way up; a ripe stalk is thin, its head a little fuller
  const leaf = pow(sin(y.mul(0.86).add(0.1).mul(Math.PI)), 0.7).mul(0.07);
  const stalk = mix(float(0.016), float(0.034), smoothstep(0.55, 0.75, y));
  const w = mix(leaf, stalk, grain).mul(g.x);
  const bend = arch.add(droop.mul(0.55));
  material.positionNode = base
    .add(vec3(out.x.mul(bend).add(sway), y.mul(h).sub(droop.mul(0.5)).sub(abs(sway).mul(0.2)), out.y.mul(bend)))
    .add(vec3(side.x.mul(w), 0, side.y.mul(w)));
  // Colour: dark at the root, green-gold up the leaf, gold at the tips, each hill its own shade
  const hue = ch(3);
  const root = dn(vec3(0.07, 0.09, 0.035), vec3(0.01, 0.02, 0.03));
  const mid = dn(mix(vec3(0.4, 0.47, 0.15), vec3(0.58, 0.5, 0.17), hue), vec3(0.08, 0.13, 0.15));
  const tip = dn(mix(vec3(0.94, 0.66, 0.3), vec3(0.94, 0.5, 0.24), hue), vec3(0.3, 0.36, 0.44));
  const body = mix(
    mix(root, mid, smoothstep(0.0, 0.42, y)),
    tip,
    smoothstep(0.38, 1.0, y).mul(float(0.5).add(grain.mul(0.5)))
  );
  // Grains along a ripe head, catching the light one by one
  const beads = sin(y.mul(95))
    .mul(0.5)
    .add(0.5)
    .mul(smoothstep(0.6, 0.7, y))
    .mul(grain);
  const textured = body.mul(float(0.88).add(beads.mul(0.28)));
  // Low sun through the leaves: the upper half glows amber
  const glow = dn(vec3(1.0, 0.4, 0.14), vec3(0.6, 0.66, 0.9))
    .mul(backlight(3))
    .mul(pow(y, 1.6))
    .mul(0.4);
  material.colorNode = fogged(textured.mul(dn(vec3(1.0, 0.86, 0.68), vec3(0.9, 0.95, 1.1))).add(glow), 0.0021);
  const mesh = new THREE.InstancedMesh(stripGeometry(8), material, RICE);
  mesh.frustumCulled = false;
  return mesh;
}

// ---- Reeds ----

const REEDS = 150;

/** Cỏ lau: thin stalks taller than the rice, each with a soft plume that lights up at sunset */
export function reedsMesh() {
  const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide, transparent: true, depthWrite: false });
  const g = TSL.positionGeometry;
  const y = g.y;
  const cam = TSL.cameraPosition;
  const x0 = TSL.mod(mix(float(-26), float(26), seed(0, REEDS)).sub(cam.x).add(26), 52)
    .sub(26)
    .add(cam.x);
  const z0 = float(-7)
    .sub(TSL.mod(pow(seed(1, REEDS), 0.9).mul(42).add(cam.z), 42))
    .add(cam.z);
  const h = float(5.2).add(seed(2, REEDS).mul(2.2));
  const yaw = seed(3, REEDS).mul(Math.PI * 2);
  const gust = noise2(vec2(x0.mul(0.1).add(time.mul(0.85)), z0.mul(0.1)))
    .sub(0.45)
    .mul(1.6);
  const sway = gust
    .add(sin(time.mul(1.7).add(seed(4, REEDS).mul(6))).mul(0.18))
    .mul(y.mul(y))
    .mul(h)
    .mul(0.22);
  const lean = float(0.25).add(seed(5, REEDS).mul(0.3)).mul(y.mul(y)).mul(h).mul(0.25);
  const plume = smoothstep(0.66, 0.74, y);
  const w = mix(float(0.012), pow(sin(saturate(y.sub(0.7).div(0.3)).mul(Math.PI)), 0.55).mul(0.3), plume).mul(g.x);
  material.positionNode = vec3(x0, GROUND, z0).add(
    vec3(lean.add(sway).add(cos(yaw).mul(w)), y.mul(h), sin(yaw).mul(w).add(lean.mul(0.3)))
  );
  const stalkColor = dn(vec3(0.3, 0.27, 0.14), vec3(0.06, 0.07, 0.09));
  const fluff = dn(vec3(0.86, 0.7, 0.62), vec3(0.5, 0.54, 0.68));
  const glow = dn(vec3(1.0, 0.56, 0.32), vec3(0.6, 0.66, 0.9))
    .mul(backlight(3))
    .mul(plume)
    .mul(0.38);
  material.colorNode = fogged(mix(stalkColor, fluff, plume).add(glow), 0.0021);
  // The plume is soft at its edges; the stalk solid
  const edge = smoothstep(1.0, 0.1, abs(g.x)).mul(smoothstep(1.0, 0.86, y));
  material.opacityNode = mix(float(1), edge.mul(0.62), plume);
  const mesh = new THREE.InstancedMesh(stripGeometry(12), material, REEDS);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  return mesh;
}

// ---- Pollen in the light ----

const MOTES = 170;

/** A camera-facing square around `center`, `size` across (positionNode for an instanced plane) */
function billboard(center: V3, size: F) {
  // The view matrix's columns; its rows are the camera's axes in the world
  const view = TSL.cameraViewMatrix as unknown as { element: (i: number) => THREE.Node<'vec4'> };
  const right = vec3(view.element(0).x, view.element(1).x, view.element(2).x);
  const up = vec3(view.element(0).y, view.element(1).y, view.element(2).y);
  const g = TSL.positionGeometry;
  return center.add(right.mul(g.x.mul(size))).add(up.mul(g.y.mul(size)));
}

export function motesMesh() {
  const material = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const drift = time.mul(0.3).add(seed(4, MOTES).mul(20));
  const x = mod(mix(float(-11), float(11), seed(0, MOTES)).add(drift).add(11), 22).sub(11);
  const y = mix(mix(float(-4.5), float(3.5), seed(1, MOTES)), mix(float(-4.2), float(-0.6), seed(1, MOTES)), night).add(
    sin(time.mul(0.5).add(seed(5, MOTES).mul(6))).mul(0.35)
  );
  const z = mix(float(-2.5), float(-24), seed(2, MOTES));
  const center = vec3(x, y, z).add(TSL.cameraPosition.mul(vec3(1, 0, 1)));
  material.positionNode = billboard(center, mix(float(0.025), float(0.06), seed(3, MOTES)));
  const r = length(uv().sub(0.5));
  const toSun = pow(saturate(dot(normalize(center.sub(TSL.cameraPosition)), sun)), 6);
  const twinkle = sin(time.mul(1.7).add(seed(6, MOTES).mul(30)))
    .mul(0.25)
    .add(0.75);
  // Fireflies by night: a slow pulse, off for a while between
  const blink = smoothstep(0.55, 0.95, sin(time.mul(0.9).add(seed(6, MOTES).mul(40))));
  const pollen = vec3(1.0, 0.72, 0.48)
    .mul(float(0.25).add(toSun.mul(1.1)))
    .mul(twinkle);
  const firefly = vec3(0.75, 1.0, 0.32).mul(blink).mul(0.9);
  material.colorNode = dn(pollen, firefly);
  material.opacityNode = smoothstep(0.5, 0.0, r);
  const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), material, MOTES);
  mesh.frustumCulled = false;
  mesh.renderOrder = 6;
  return mesh;
}

// ---- Egrets crossing far off ----

const EGRETS = 6;

export function egretsMesh() {
  const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide, transparent: true, depthWrite: false });
  // A body and two wings, each wing a triangle that flaps from the shoulder
  const g = TSL.positionGeometry;
  const flap = sin(time.mul(3.4).add(seed(0, EGRETS).mul(6)));
  const wing = abs(g.x);
  const local = vec3(g.x, g.y.add(wing.mul(flap).mul(0.55)), g.z);
  const lane = seed(1, EGRETS);
  const x = mod(time.mul(5.5).add(lane.mul(140)), 520)
    .sub(260)
    .negate();
  const y = float(28)
    .add(lane.mul(22))
    .add(sin(time.mul(0.4).add(lane.mul(9))).mul(2));
  const z = float(-320).sub(lane.mul(80));
  material.positionNode = vec3(x, y, z).add(local.mul(4.5));
  material.colorNode = mix(vec3(1.0, 0.93, 0.85), vec3(1.0, 0.8, 0.6), backlight(2));
  material.opacityNode = oneMinus(night).mul(0.85);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [
        -1, 0, 0, 0, 0.05, 0.25, 0, 0, -0.2, 1, 0, 0, 0, 0.05, 0.25, 0, 0, -0.2, 0, 0.05, 0.25, 0, -0.04, 0.7, 0, 0,
        -0.2,
      ],
      3
    )
  );
  const mesh = new THREE.InstancedMesh(geometry, material, EGRETS);
  mesh.frustumCulled = false;
  mesh.renderOrder = -3;
  return mesh;
}

// ---- A kite over the next field ----

export function kiteGroup() {
  const group = new THREE.Group();
  const sail = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  const v = uv();
  // Red and yellow halves, the way the corner-shop kites were
  const split = smoothstep(0.49, 0.51, v.x);
  const glow = backlight(4).mul(0.35);
  sail.colorNode = mix(vec3(0.86, 0.2, 0.16), vec3(0.98, 0.76, 0.18), split)
    .mul(oneMinus(night.mul(0.82)).mul(0.85))
    .add(vec3(1, 0.7, 0.4).mul(glow));
  const diamond = new THREE.BufferGeometry();
  diamond.setAttribute('position', new THREE.Float32BufferAttribute([0, 1.4, 0, -1, 0, 0, 1, 0, 0, 0, -1.9, 0], 3));
  diamond.setAttribute('uv', new THREE.Float32BufferAttribute([0.5, 1, 0, 0.5, 1, 0.5, 0.5, 0], 2));
  diamond.setIndex([0, 1, 2, 2, 1, 3]);
  group.add(new THREE.Mesh(diamond, sail));
  // The tail: a ribbon that snakes in the wind
  const tail = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  const g = TSL.positionGeometry;
  const along = g.y.negate().div(9);
  tail.positionNode = vec3(
    g.x.add(
      sin(along.mul(9).sub(time.mul(4.2)))
        .mul(along)
        .mul(1.4)
    ),
    g.y,
    sin(along.mul(7).sub(time.mul(3.1)))
      .mul(along)
      .mul(0.6)
  );
  tail.colorNode = vec3(0.95, 0.36, 0.22).mul(oneMinus(night.mul(0.82)));
  const ribbon = new THREE.PlaneGeometry(0.18, 9, 1, 40).translate(0, -4.5 - 1.9, 0);
  group.add(new THREE.Mesh(ribbon, tail));
  // The string, down toward whoever's flying it
  const string = new THREE.MeshBasicNodeMaterial({ transparent: true });
  string.colorNode = vec3(0.35, 0.28, 0.3);
  string.opacityNode = float(0.45);
  const line = new THREE.CylinderGeometry(0.03, 0.03, 60, 3).translate(0, -30, 0).rotateZ(-0.5);
  group.add(new THREE.Mesh(line, string));
  return group;
}

export const kiteSway = (t: number, group: THREE.Group) => {
  group.position.set(26 + Math.sin(t * 0.37) * 1.5, 14 + Math.sin(t * 0.61) * 1.1, -95);
  group.rotation.set(Math.sin(t * 0.8) * 0.12, Math.sin(t * 0.5) * 0.3, Math.sin(t * 0.9) * 0.18 - 0.15);
};
