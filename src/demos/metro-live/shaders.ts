import * as t3 from '@typegpu/three';
import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import { d, std } from 'typegpu';

/**
 * Materials whose shading is written in TypeScript with TypeGPU (`'use gpu'`),
 * compiled to WGSL and plugged into three.js node materials via @typegpu/three.
 */

/**
 * @typegpu/three types `toTSL` as an untyped Node, while @types/three 0.186 types material
 * slots as Node<'vec4'> etc. The runtime object is the same TSL node.
 */
const colorNode = (fn: () => unknown) => t3.toTSL(fn) as unknown as THREE.Node<'vec4'>;
const vec3Node = (fn: () => unknown) => t3.toTSL(fn) as unknown as THREE.Node<'vec3'>;
const floatNode = (fn: () => unknown) => t3.toTSL(fn) as unknown as THREE.Node<'float'>;

/** 0 = day, 1 = night. Every material below reads it, so the whole city changes together. */
export const nightUniform = TSL.uniform(0);
// fromTSL references the live uniform node. t3.uniform(node) would wrap it in a new uniform
// that only copies the value once, so updates from JS would never reach the shader.
const night = t3.fromTSL(nightUniform, d.f32);

/** 3.3 m floors and 3 m window bays at 4.5 m per unit */
const FLOOR_HEIGHT = 0.73;
const BAY_WIDTH = 0.66;
/** Shopfront band at street level */
const SHOP_TOP = 0.8;

/** Buildings: floors of windows on every facade, shopfronts at street level, plain roofs */
export function createBuildingMaterial() {
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.8, metalness: 0 });

  material.colorNode = colorNode(() => {
    'use gpu';
    const p = t3.positionWorld.$;
    const n = t3.normalWorld.$;
    const roof = std.step(0.6, n.y);
    const along = p.x * (0.0 - n.z) + p.z * n.x;
    const fy = std.fract(p.y / FLOOR_HEIGHT);
    const fx = std.fract(along / BAY_WIDTH);
    const pane =
      std.step(0.3, fy) * std.step(fy, 0.76) * std.step(0.2, fx) * std.step(fx, 0.8) * std.step(SHOP_TOP + 0.05, p.y);
    const shop = (1.0 - std.step(SHOP_TOP, p.y)) * std.step(0.1, p.y);
    // Window with a pale frame and sill around a softly tinted pane
    const frameMask =
      std.step(0.24, fy) *
      std.step(fy, 0.82) *
      std.step(0.14, fx) *
      std.step(fx, 0.86) *
      std.step(SHOP_TOP + 0.05, p.y);
    const glass = d.vec3f(0.66, 0.74, 0.82);
    const framed = std.mix(d.vec3f(1.0, 1.0, 1.0), d.vec3f(0.97, 0.97, 0.98), frameMask);
    const wall = std.mix(framed, glass, pane * 0.72);
    const street = std.mix(wall, d.vec3f(0.42, 0.45, 0.5), shop * 0.55);
    return d.vec4f(std.mix(street, d.vec3f(0.97, 0.97, 0.96), roof), 1.0);
  });

  // At night roughly half the windows light up, each with its own warmth
  material.emissiveNode = vec3Node(() => {
    'use gpu';
    const p = t3.positionWorld.$;
    const n = t3.normalWorld.$;
    const wallMask = 1.0 - std.step(0.6, n.y);
    const along = p.x * (0.0 - n.z) + p.z * n.x;
    const floorIndex = std.floor(p.y / FLOOR_HEIGHT);
    const bayIndex = std.floor(along / BAY_WIDTH);
    const fy = std.fract(p.y / FLOOR_HEIGHT);
    const fx = std.fract(along / BAY_WIDTH);
    const pane = std.step(0.3, fy) * std.step(fy, 0.76) * std.step(0.2, fx) * std.step(fx, 0.8);
    const h = std.fract(std.sin(floorIndex * 12.9898 + bayIndex * 78.233 + std.floor(p.x * 0.7) * 3.1) * 43758.547);
    const lit = std.step(0.48, h);
    const warm = std.mix(d.vec3f(1.0, 0.78, 0.45), d.vec3f(1.0, 0.93, 0.8), std.fract(h * 7.0));
    const shopGlow = (1.0 - std.step(SHOP_TOP, p.y)) * std.step(0.1, p.y) * 0.8;
    const amount = std.max(pane * lit, shopGlow) * wallMask * night.$;
    return warm.mul(amount * 1.15);
  });
  return material;
}

/** Curtain wall module: one storey high, mullions every 1.5 m */
const GLASS_FLOOR = 0.82;
const MULLION = 0.34;

/**
 * Glass towers: a curtain wall that reflects the sky (lighter towards the top, slightly varied per
 * pane like real reflective glass), thin light mullions, a spandrel band at every floor and a pale
 * lobby at the base. After dark a scatter of offices and flats stays lit, cooler than homes.
 */
export function createGlassMaterial() {
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.35, metalness: 0.1 });
  material.colorNode = colorNode(() => {
    'use gpu';
    const p = t3.positionWorld.$;
    const n = t3.normalWorld.$;
    const roof = std.step(0.6, n.y);
    const along = p.x * (0.0 - n.z) + p.z * n.x;
    const fy = std.fract(p.y / GLASS_FLOOR);
    const fx = std.fract(along / MULLION);
    const mullion = 1.0 - std.step(0.07, fx) * std.step(fx, 0.93);
    const spandrel = 1.0 - std.step(0.14, fy);
    const cell = std.floor(d.vec2f(along / MULLION, p.y / GLASS_FLOOR));
    const jitter = std.fract(std.sin(cell.x * 12.9898 + cell.y * 78.233) * 43758.547);
    // Sky reflection: deeper blue low down, brighter towards the top, panes not quite flat
    const sky = std.smoothstep(0.0, 60.0, p.y);
    const glass = std.mix(d.vec3f(0.55, 0.66, 0.78), d.vec3f(0.82, 0.89, 0.96), sky * 0.8 + jitter * 0.12);
    const frame = d.vec3f(0.93, 0.95, 0.97);
    const face = std.mix(glass, frame, std.max(mullion * 0.85, spandrel * 0.6));
    const lobby = (1.0 - std.step(1.1, p.y)) * std.step(0.05, p.y);
    const base = std.mix(face, d.vec3f(0.9, 0.92, 0.94), lobby * 0.5);
    return d.vec4f(std.mix(base, d.vec3f(0.9, 0.91, 0.93), roof), 1.0);
  });
  material.emissiveNode = vec3Node(() => {
    'use gpu';
    const p = t3.positionWorld.$;
    const n = t3.normalWorld.$;
    const wallMask = 1.0 - std.step(0.6, n.y);
    const along = p.x * (0.0 - n.z) + p.z * n.x;
    const cell = std.floor(d.vec2f(along / (MULLION * 2.0), p.y / GLASS_FLOOR));
    const h = std.fract(std.sin(cell.x * 12.9898 + cell.y * 78.233) * 43758.547);
    const fy = std.fract(p.y / GLASS_FLOOR);
    const pane = std.step(0.16, fy);
    const lit = std.step(0.55, h) * pane;
    const tone = std.mix(d.vec3f(0.85, 0.92, 1.0), d.vec3f(1.0, 0.88, 0.65), std.fract(h * 5.0));
    return tone.mul(lit * wallMask * night.$ * 0.95);
  });
  return material;
}

/** Streets: light asphalt, sidewalks, dashed centre line (uv.x across, uv.y along in world units) */
export function createRoadMaterial() {
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 1, metalness: 0 });
  material.colorNode = colorNode(() => {
    'use gpu';
    const uv = t3.uv().$;
    const x = uv.x;
    const sidewalk = 1.0 - std.step(0.14, x) * std.step(x, 0.86);
    const centre = (1.0 - std.step(0.018, std.abs(x - 0.5))) * std.step(0.5, std.fract(uv.y * 0.9));
    const edge = 1.0 - std.step(0.012, std.abs(x - 0.19)) + (1.0 - std.step(0.012, std.abs(x - 0.81)));
    const asphalt = d.vec3f(0.78, 0.8, 0.84);
    const paving = d.vec3f(0.9, 0.9, 0.89);
    const marked = std.mix(asphalt, d.vec3f(0.98, 0.98, 0.98), std.max(centre, edge) * 0.9);
    return d.vec4f(std.mix(marked, paving, sidewalk), 1.0);
  });
  return material;
}

/** Saigon River: layered ripples, foam at the banks, glints by day, city reflections by night */
export function createWaterMaterial() {
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.25, metalness: 0 });
  material.colorNode = colorNode(() => {
    'use gpu';
    const uv = t3.uv().$;
    const t = t3.time.$;
    const w1 = std.sin(uv.y * 5.0 + t * 1.4 + std.sin(uv.x * 9.0 + t * 0.6) * 1.6);
    const w2 = std.sin(uv.y * 2.3 - t * 0.9 + uv.x * 6.0);
    const crest = std.smoothstep(0.82, 1.0, w1 * 0.6 + w2 * 0.4);
    const channel = std.smoothstep(0.0, 0.45, uv.x) * (1.0 - std.smoothstep(0.55, 1.0, uv.x));
    const bank = std.min(uv.x, 1.0 - uv.x);
    const foam = (1.0 - std.smoothstep(0.0, 0.07, bank)) * (0.6 + 0.4 * std.sin(uv.y * 14.0 - t * 2.0));
    const day = std.mix(d.vec3f(0.66, 0.84, 0.93), d.vec3f(0.36, 0.63, 0.82), channel);
    const nightCol = std.mix(d.vec3f(0.1, 0.16, 0.28), d.vec3f(0.05, 0.09, 0.18), channel);
    const base = std.mix(day, nightCol, night.$);
    const lit = std.mix(base, d.vec3f(0.97, 0.99, 1.0), crest * 0.6 * (1.0 - night.$ * 0.7));
    return d.vec4f(std.mix(lit, d.vec3f(0.95, 0.97, 1.0), foam * 0.5 * (1.0 - night.$ * 0.5)), 1.0);
  });
  // Shimmering reflections of the lit riverbanks after dark
  material.emissiveNode = vec3Node(() => {
    'use gpu';
    const uv = t3.uv().$;
    const t = t3.time.$;
    const cell = std.floor(d.vec2f(uv.x * 26.0, uv.y * 3.0 + t * 0.3));
    const h = std.fract(std.sin(cell.x * 12.9898 + cell.y * 78.233) * 43758.547);
    const nearBank = 1.0 - std.smoothstep(0.08, 0.3, std.min(uv.x, 1.0 - uv.x));
    const shimmer = 0.5 + 0.5 * std.sin(t * 3.0 + h * 30.0);
    const glint = std.step(0.86, h) * nearBank * shimmer * night.$;
    return d.vec3f(1.0, 0.75, 0.42).mul(glint * 0.9);
  });
  return material;
}

/**
 * Viaduct deck with rails and sleepers. The stretch between `lo` and `hi`
 * (arc length, world units) is the route ahead of the followed train and gets
 * a flowing line-colour glow moving in `dir`.
 */
export function createDeckMaterial() {
  const lo = TSL.uniform(0);
  const hi = TSL.uniform(0);
  const dir = TSL.uniform(1);
  /** uv.x of the track the route glow runs on */
  const track = TSL.uniform(0.26);
  const loA = t3.fromTSL(lo, d.f32);
  const hiA = t3.fromTSL(hi, d.f32);
  const dirA = t3.fromTSL(dir, d.f32);
  const trackA = t3.fromTSL(track, d.f32);

  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.75, metalness: 0 });
  material.colorNode = colorNode(() => {
    'use gpu';
    const uv = t3.uv().$;
    const along = uv.y;
    // Two tracks at uv.x 0.26 and 0.74; rails 0.08 either side of each centre
    const dA = std.abs(uv.x - 0.26);
    const dB = std.abs(uv.x - 0.74);
    const dTrack = std.min(dA, dB);
    const rail = 1.0 - std.smoothstep(0.012, 0.026, std.abs(dTrack - 0.08));
    const inBed = 1.0 - std.step(0.13, dTrack);
    const sleeper = std.step(0.6, std.fract(along * 2.6)) * (1.0 - std.step(0.12, dTrack));
    const walkway = 1.0 - std.step(0.06, uv.x) * std.step(uv.x, 0.94);
    const edgeBand = 1.0 - std.step(0.035, uv.x) * std.step(uv.x, 0.965);
    const base = d.vec3f(0.93, 0.935, 0.945);
    // Ballast grain: a cheap hash so the bed is not a flat grey
    const grain = std.fract(std.sin(std.floor(along * 9.0) * 12.9898 + std.floor(uv.x * 60.0) * 78.233) * 43758.547);
    const ballast = d.vec3f(0.6, 0.62, 0.65).add(d.vec3f(grain * 0.05, grain * 0.05, grain * 0.05));
    const bed = std.mix(base, ballast, inBed);
    const withSleepers = std.mix(bed, d.vec3f(0.86, 0.86, 0.84), sleeper);
    const railShine = 1.0 - std.smoothstep(0.0, 0.006, std.abs(dTrack - 0.08));
    const withRails = std.mix(withSleepers, d.vec3f(0.27, 0.29, 0.33), rail);
    const shiny = std.mix(withRails, d.vec3f(0.8, 0.82, 0.85), railShine * 0.6);
    const withWalk = std.mix(shiny, d.vec3f(0.84, 0.85, 0.87), walkway);
    return d.vec4f(std.mix(withWalk, d.vec3f(0.98, 0.98, 0.98), edgeBand), 1.0);
  });
  material.emissiveNode = vec3Node(() => {
    'use gpu';
    const uv = t3.uv().$;
    const t = t3.time.$;
    const along = uv.y;
    const onTrack = 1.0 - std.smoothstep(0.1, 0.14, std.abs(uv.x - trackA.$));
    // Fades in and out over ~1.5 units at both ends instead of cutting off
    const inRoute =
      std.smoothstep(loA.$ - 0.2, loA.$ + 1.5, along) * (1.0 - std.smoothstep(hiA.$ - 1.5, hiA.$ + 0.2, along));
    const flow = std.fract(along * 0.35 - t * 0.9 * dirA.$);
    const pulse = std.smoothstep(0.0, 0.5, flow) * (1.0 - std.smoothstep(0.5, 1.0, flow));
    const glow = inRoute * onTrack * (0.3 + pulse * 0.7);
    return d.vec3f(0.95, 0.18, 0.2).mul(glow * (0.55 + night.$ * 0.6));
  });

  return { material, uniforms: { lo, hi, dir, track } };
}

/**
 * Tree canopies (soft, like the reference renders): the instance colour, lit brighter towards
 * the top of each leaf puff and deeper underneath, with a faint warm rim where the sun catches it.
 */
export function createFoliageMaterial() {
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.92, metalness: 0 });
  const up = TSL.normalLocal.y;
  const height = TSL.smoothstep(0.6, 2.6, TSL.positionLocal.y);
  const light = TSL.mix(TSL.float(0.72), TSL.float(1.12), TSL.smoothstep(-0.7, 0.95, up));
  const lift = light.add(height.mul(0.08));
  material.colorNode = TSL.vec3(lift, lift.mul(1.01), lift.mul(0.97));
  // Soft translucency: leaves never go fully dark in shade
  material.emissiveNode = TSL.vec3(0.05, 0.07, 0.04).mul(TSL.float(1).sub(TSL.smoothstep(-0.2, 0.8, up)));
  return material;
}

/** Shared by the leaf and palm materials: `leaf` is 0 on solid parts, > 0 on cut-out leaf cards */
const leafAttribute = () => TSL.attribute<'float'>('leaf', 'float');

/**
 * Broadleaf crowns (world/foliage.ts leafCrownGeometry): leaf-cluster cards cut out of the
 * Quaternius leaf texture around a dark core. Normals point out from the crown centre, so the
 * tree lights as one soft ball; each card's leaves get a darker rim so clusters read up close.
 * The instance colour picks the species.
 */
export function createLeafMaterial(map: THREE.Texture) {
  const material = new THREE.MeshStandardNodeMaterial({
    roughness: 0.92,
    metalness: 0,
    alphaTest: 0.5,
  });
  const leaf = leafAttribute();
  const card = TSL.step(0.5, leaf);
  const tex = TSL.texture(map, TSL.uv());
  material.opacityNode = TSL.mix(TSL.float(1), tex.a, card);
  const up = TSL.normalLocal.y;
  const height = TSL.smoothstep(0.6, 2.6, TSL.positionLocal.y);
  const light = TSL.mix(TSL.float(0.72), TSL.float(1.14), TSL.smoothstep(-0.75, 0.95, up)).add(height.mul(0.08));
  const rim = TSL.mix(TSL.float(0.86), TSL.float(1), TSL.smoothstep(0.55, 0.95, tex.a));
  const shade = TSL.mix(TSL.float(0.74), leaf.mul(rim), card).mul(light);
  material.colorNode = TSL.vec3(shade, shade.mul(1.01), shade.mul(0.97));
  // Soft translucency: leaves never go fully dark in shade
  material.emissiveNode = TSL.vec3(0.05, 0.07, 0.04).mul(TSL.float(1).sub(TSL.smoothstep(-0.2, 0.8, up)));
  return material;
}

/** Coconut palms: textured fronds (double sided, cut out) on a ringed grey-brown trunk */
export function createPalmMaterial(map: THREE.Texture) {
  const material = new THREE.MeshStandardNodeMaterial({
    roughness: 0.9,
    metalness: 0,
    alphaTest: 0.5,
    side: THREE.DoubleSide,
  });
  const frond = TSL.step(0.5, leafAttribute());
  const tex = TSL.texture(map, TSL.uv());
  material.opacityNode = TSL.mix(TSL.float(1), tex.a, frond);
  const rings = TSL.smoothstep(0.35, 0.5, TSL.fract(TSL.positionLocal.y.mul(26)).sub(0.5).abs());
  const trunk = TSL.vec3(0.66, 0.58, 0.48).mul(TSL.float(0.86).add(rings.mul(0.14)));
  const fronds = tex.rgb.mul(TSL.vec3(1.08, 1.1, 1.0));
  material.colorNode = TSL.mix(trunk, fronds, frond);
  material.emissiveNode = TSL.vec3(0.04, 0.06, 0.03).mul(frond);
  return material;
}

/** Flower beds: cut-out blossoms and leaves from the Quaternius flower atlas */
export function createFlowerMaterial(map: THREE.Texture) {
  const material = new THREE.MeshStandardNodeMaterial({
    roughness: 0.85,
    metalness: 0,
    alphaTest: 0.5,
  });
  const tex = TSL.texture(map, TSL.uv());
  material.opacityNode = tex.a;
  material.colorNode = tex.rgb.mul(1.12);
  material.emissiveNode = tex.rgb.mul(0.06);
  return material;
}

/**
 * Lawns: two soft greens in broad drifting patches, and on golf courses and pitches mowing
 * stripes that fade out with distance (so they never alias into moiré from far away).
 */
export function createLawnMaterial(color: string, stripes: boolean) {
  const material = new THREE.MeshStandardNodeMaterial({
    roughness: 1,
    metalness: 0,
  });
  const p = TSL.positionWorld;
  const base = TSL.color(new THREE.Color(color));
  const n1 = TSL.sin(p.x.mul(0.21).add(TSL.sin(p.z.mul(0.17)).mul(1.7)));
  const n2 = TSL.sin(p.z.mul(0.19).add(TSL.sin(p.x.mul(0.13)).mul(1.3)));
  const n3 = TSL.sin(p.x.mul(0.047).sub(p.z.mul(0.061)));
  const patch = TSL.smoothstep(-0.7, 0.8, n1.mul(n2).add(n3.mul(0.35)));
  const tone = TSL.mix(TSL.float(0.93), TSL.float(1.05), patch);
  const fade = TSL.float(1).sub(TSL.smoothstep(50, 200, TSL.cameraPosition.distance(p)));
  const band = TSL.smoothstep(
    0.42,
    0.58,
    TSL.fract(p.x.mul(0.3).add(p.z.mul(0.18)))
      .sub(0.5)
      .abs()
      .mul(2)
  );
  const mown = TSL.float(1).add(
    band
      .sub(0.5)
      .mul(stripes ? 0.07 : 0)
      .mul(fade)
  );
  material.colorNode = base.mul(tone.mul(mown));
  return material;
}

/**
 * Car body livery, painted from the car's own coordinates (x across, y up from the body centre,
 * z along) so one material covers the whole shell. uv.x carries how far into the cab nose a
 * vertex is (0 on middle cars). HCMC Line 1's Hitachi sets: silver-white aluminium, a continuous
 * dark glass window band, a blue stripe, grey skirts; the nose is a wrap-around black windscreen.
 * `accent` is the stripe and roof-shoulder colour (blue, or green for your train).
 */
export function createTrainBodyMaterial(accent: string) {
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.28, metalness: 0.15 });
  const p = TSL.positionLocal;
  const n = TSL.normalLocal;
  const nose = TSL.uv().x;
  const side = TSL.smoothstep(0.55, 0.8, TSL.abs(n.x));
  const roof = TSL.smoothstep(0.75, 0.95, n.y);
  const shoulder = TSL.smoothstep(0.25, 0.45, n.y).mul(TSL.float(1).sub(roof));
  const band = (lo: number, hi: number) => TSL.step(lo, p.y).mul(TSL.step(p.y, hi));
  const windowBand = band(-0.04, 0.17).mul(side);
  // Window pillars every ~1.6 m, door pillars stay in the body colour
  const pillar = TSL.step(0.86, TSL.fract(p.z.mul(2.8)));
  const stripe = band(-0.15, -0.08).mul(side);
  const skirt = TSL.float(1).sub(TSL.step(-0.27, p.y));
  // A wrap-around glass band across the front only: the roof stays white, the lower nose body-colour
  const windscreen = TSL.smoothstep(0.5, 0.62, nose)
    .mul(TSL.step(-0.03, p.y))
    .mul(TSL.step(p.y, 0.2))
    .mul(TSL.float(1).sub(roof));
  const noseStripe = TSL.smoothstep(0.5, 0.62, nose).mul(band(-0.15, -0.08));
  const accentColor = TSL.color(accent);
  let c = TSL.vec3(0.95, 0.96, 0.975) as unknown as THREE.Node<'vec3'>;
  c = TSL.mix(c, TSL.vec3(0.88, 0.9, 0.93), roof.mul(0.6));
  c = TSL.mix(c, accentColor, shoulder.mul(0.9));
  c = TSL.mix(c, TSL.vec3(0.11, 0.15, 0.21), windowBand.mul(TSL.float(1).sub(pillar.mul(0.55))));
  c = TSL.mix(c, accentColor, stripe);
  c = TSL.mix(c, TSL.vec3(0.55, 0.59, 0.65), skirt);
  c = TSL.mix(c, accentColor, noseStripe);
  c = TSL.mix(c, TSL.vec3(0.09, 0.13, 0.19), windscreen);
  material.colorNode = c;
  // Lit saloon after dark
  material.emissiveNode = TSL.vec3(1.0, 0.88, 0.66).mul(
    windowBand.mul(TSL.float(1).sub(pillar)).mul(nightUniform).mul(0.85)
  );
  return material;
}

/**
 * Underground section, seen through the street like an x-ray (Mini Tokyo 3D style): a soft
 * line-colour band with a bright core, and light flowing along two lanes, one per direction.
 */
export function createTunnelMaterial() {
  const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  material.colorNode = colorNode(() => {
    'use gpu';
    const uv = t3.uv().$;
    const core = 1.0 - std.smoothstep(0.0, 0.07, std.abs(uv.x - 0.5));
    // Lifts towards white along the core so the line glows rather than just tints the road
    return d.vec4f(std.mix(d.vec3f(0.89, 0.15, 0.17), d.vec3f(1.0, 0.72, 0.72), core * 0.6), 1.0);
  });
  material.opacityNode = floatNode(() => {
    'use gpu';
    const uv = t3.uv().$;
    const t = t3.time.$;
    const x = std.abs(uv.x - 0.5) * 2.0;
    const band = std.exp(x * x * -3.2);
    // Two lanes (towards Suối Tiên on one side, Bến Thành on the other), soft comets every ~30 m.
    // Each comet is a long tail easing into a rounded head: no hard edge where fract() wraps
    const lane = std.step(uv.x, 0.5);
    const flowA = std.fract(uv.y * 0.15 - t * 0.55);
    const flowB = std.fract(uv.y * 0.15 + t * 0.55);
    const comet = std.mix(flowB, flowA, lane);
    const head = std.smoothstep(0.5, 0.86, comet) * (1.0 - std.smoothstep(0.86, 1.0, comet));
    const pulse = head * (1.0 - std.smoothstep(0.0, 0.25, std.abs(x - 0.45)));
    return std.min(1.0, band * (0.34 + night.$ * 0.2) + pulse * (0.45 + night.$ * 0.3));
  });
  return material;
}

/** Trains running underground, drawn through the ground: line colour, a lighter roof stripe */
export function createXrayMaterial() {
  const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, depthTest: false });
  material.opacityNode = floatNode(() => {
    'use gpu';
    return 0.82;
  });
  return material;
}

/** Ground: faint dot grid, slow cloud shadows by day, deep blue by night */
export function createGroundMaterial() {
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 1, metalness: 0 });
  material.colorNode = colorNode(() => {
    'use gpu';
    const p = t3.positionWorld.$;
    const t = t3.time.$;
    // Soft drifting cloud shade only: fine patterns alias into moiré across a 17 km map
    const c1 = std.sin(p.x * 0.011 + t * 0.05 + std.sin(p.z * 0.008) * 2.0);
    const c2 = std.sin(p.z * 0.013 - t * 0.04 + std.sin(p.x * 0.006) * 1.5);
    const cloud = std.smoothstep(0.25, 0.85, c1 * c2 * 0.5 + 0.5);
    const day = d.vec3f(0.925, 0.935, 0.945).mul(1.0 - cloud * 0.06);
    const nightCol = d.vec3f(0.3, 0.34, 0.45);
    return d.vec4f(std.mix(day, nightCol, night.$), 1.0);
  });
  return material;
}

/** Rivers, canals and lakes drawn as areas: slow broad swell from world position, no hard crests */
export function createWaterAreaMaterial() {
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.25, metalness: 0 });
  material.colorNode = colorNode(() => {
    'use gpu';
    const p = t3.positionWorld.$;
    const t = t3.time.$;
    const w1 = std.sin(p.x * 0.09 + p.z * 0.05 + t * 0.9 + std.sin(p.z * 0.07 + t * 0.4) * 1.2);
    const w2 = std.sin(p.z * 0.11 - p.x * 0.04 - t * 0.7);
    const swell = (w1 * 0.6 + w2 * 0.4) * 0.5 + 0.5;
    const day = std.mix(d.vec3f(0.52, 0.74, 0.88), d.vec3f(0.62, 0.81, 0.92), swell);
    const nightCol = std.mix(d.vec3f(0.07, 0.12, 0.22), d.vec3f(0.1, 0.16, 0.28), swell);
    return d.vec4f(std.mix(day, nightCol, night.$), 1.0);
  });
  material.emissiveNode = vec3Node(() => {
    'use gpu';
    const p = t3.positionWorld.$;
    const t = t3.time.$;
    const cell = std.floor(d.vec2f(p.x * 0.35, p.z * 0.35 + t * 0.3));
    const h = std.fract(std.sin(cell.x * 12.9898 + cell.y * 78.233) * 43758.547);
    const shimmer = 0.5 + 0.5 * std.sin(t * 3.0 + h * 30.0);
    return d.vec3f(1.0, 0.75, 0.42).mul(std.step(0.97, h) * shimmer * night.$ * 0.8);
  });
  return material;
}

export function createContactShadowMaterial() {
  const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  material.colorNode = colorNode(() => {
    'use gpu';
    return d.vec4f(0.27, 0.33, 0.42, 1.0);
  });
  material.opacityNode = floatNode(() => {
    'use gpu';
    const uv = t3.uv().$;
    const q = std.abs(uv.sub(d.vec2f(0.5, 0.5))).mul(2.0);
    const outside = std.length(std.max(q.sub(d.vec2f(0.45, 0.45)), d.vec2f(0.0, 0.0))) / 0.55;
    return (1.0 - std.smoothstep(0.0, 1.0, outside)) * 0.2 * (1.0 - night.$ * 0.5);
  });
  return material;
}

/** Additive radial glow (street-light pools, headlight beams). Fades in with the night. */
export function createGlowMaterial(color: [number, number, number], strength = 1, dayStrength = 0) {
  const material = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const tint = d.vec3f(color[0], color[1], color[2]);
  material.colorNode = colorNode(() => {
    'use gpu';
    const uv = t3.uv().$;
    const r = std.length(uv.sub(d.vec2f(0.5, 0.5))) * 2.0;
    const falloff = 1.0 - std.smoothstep(0.0, 1.0, r);
    const amount = falloff * falloff * (dayStrength + (strength - dayStrength) * night.$);
    return d.vec4f(tint.mul(amount), 1.0);
  });
  return material;
}

/** Emissive helper for small lamps/windows that switch on after dark */
export function createNightLightMaterial(base: string, glow: [number, number, number], dayGlow = 0) {
  const material = new THREE.MeshStandardNodeMaterial({ color: base, roughness: 0.4 });
  const tint = d.vec3f(glow[0], glow[1], glow[2]);
  material.emissiveNode = vec3Node(() => {
    'use gpu';
    return tint.mul(dayGlow + (1.0 - dayGlow) * night.$);
  });
  return material;
}

/** Aviation-style beacon: a short bright flash every `period` seconds, day and night */
export function createBeaconMaterial(glow: [number, number, number], period = 1.6) {
  const material = new THREE.MeshStandardNodeMaterial({ color: '#FFFFFF', roughness: 0.4 });
  const tint = d.vec3f(glow[0], glow[1], glow[2]);
  material.emissiveNode = vec3Node(() => {
    'use gpu';
    const phase = std.fract(t3.time.$ / period);
    const flash = 1.0 - std.smoothstep(0.0, 0.25, phase);
    return tint.mul(0.15 + flash * (0.9 + night.$ * 0.8));
  });
  return material;
}

/**
 * Door leaves slide in the vertex shader: each vertex moves along z by its `slide`
 * attribute (±1, or 0 for leaves that stay shut) times the train's `doors` uniform.
 */
export function createDoorLeafMaterial(travel: number) {
  const doors = TSL.uniform(0);
  const doorsA = t3.fromTSL(doors, d.f32);
  const slide = t3.attribute('slide', d.f32);
  const material = new THREE.MeshStandardNodeMaterial({ color: '#E2E6EB', roughness: 0.4 });
  material.positionNode = vec3Node(() => {
    'use gpu';
    const p = t3.positionLocal.$;
    return p.add(d.vec3f(0.0, 0.0, slide.$ * doorsA.$ * travel));
  });
  return { material, doors };
}
