import * as TSL from 'three/tsl';
import * as THREE from 'three/webgpu';

import { hex, light, type F, type V3 } from './light';
import { CEILING, PLAQUE_PX, WALL, type RoomMaps } from './paint';

/**
 * The snow globe and the room it stands in: a ball of glass on a music box base, red lacquer and
 * gilt, a little engraved plaque on its front; a bank of snow inside where the ground meets the
 * glass; the polished walnut table it stands on, mirrored in it; and the room round it, dark but
 * for a window of winter night, the tree's lights and a string of fairy lights, all far out of
 * focus (painted, in paint.ts).
 *
 * Everything is in the town's metres (the town inside is life-size), so the globe is nearly 400 m
 * across and the room kilometres wide: only its proportions matter.
 */

const { vec2, vec3, float, mix, saturate, smoothstep, dot, normalize, pow, exp, abs, step, length } = TSL;

/** Where the town's ground meets the glass, out from the axis, and how far above it the ball's middle is */
const RIM = 143;
const RISE = 120;

export const GLOBE = {
  /** The middle of the glass ball, and its radius: a ball on a stand, not a dome */
  centre: new THREE.Vector3(0, RISE, 19),
  radius: Math.hypot(RIM, RISE),
  /** The town's ground under the glass */
  ground: 0,
  /** The tabletop the base stands on */
  table: -122,
};

/** The table's back edge, where it gives way to the room */
const TABLE_BACK = -440;

// ---- The room ----

/** A soft box, `blur` its edge: 1 inside, 0 out */
const box = (p: THREE.Node<'vec2'>, c: [number, number], half: [number, number], blur: number) => {
  const q = abs(p.sub(vec2(c[0], c[1])));
  return smoothstep(half[0] + blur, half[0] - blur, q.x).mul(
    smoothstep(half[1] + blur, half[1] - blur, q.y)
  ) as unknown as F;
};

/** The far wall where a ray from `o` along `dir` meets it: the painting, `blur` mip levels softer */
function roomBack(maps: RoomMaps, o: V3, dir: V3, blur: number) {
  const t = float(WALL.z).sub(o.z).div(TSL.min(dir.z, -1e-4));
  const hit = o.add(dir.mul(t));
  const uv = vec2(hit.x.sub(WALL.x0).div(WALL.x1 - WALL.x0), hit.y.sub(WALL.y0).div(WALL.y1 - WALL.y0));
  const map = TSL.texture(maps.wall, uv);
  let c = (blur > 0 ? map.level(float(blur)) : map).rgb;
  if (blur === 0) {
    // The lights breathing, each a little out of step with the next (only the bright: not the window)
    const lum = dot(c, vec3(0.3, 0.55, 0.15));
    const breathe = TSL.mx_noise_float(vec3(uv.mul(vec2(24, 18)), TSL.time.mul(0.35))).mul(0.22);
    c = c.mul(float(1).add(breathe.mul(smoothstep(0.32, 0.7, lum))));
  }
  // Past the painting's edges, the room's dark
  const inside = smoothstep(0, 0.05, uv.x)
    .mul(smoothstep(1, 0.95, uv.x))
    .mul(smoothstep(1, 0.95, uv.y));
  return mix(hex('#0A0709'), c, inside) as unknown as V3;
}

/**
 * The room behind whoever's looking (what the glass, the lacquer and the gilt mirror): a tall
 * window of winter light up to the left, the lamp to the right, the fire low down, the warm dark
 * of the room between. `shine` turns the window and the lamp up: glass mirrors them brightly.
 */
function roomFront(dir: V3, shine: number) {
  const toWin = normalize(vec3(-0.46, 0.42, 1));
  const right = normalize(TSL.cross(vec3(0, 1, 0), toWin));
  const up = TSL.cross(toWin, right);
  const u = dot(dir, right);
  const v = dot(dir, up);
  const facing = smoothstep(0.55, 0.75, dot(dir, toWin));
  const pane = box(vec2(u, v), [0, 0], [0.2, 0.3], 0.02);
  const bars = float(1)
    .sub(smoothstep(0.014, 0.004, abs(u)).mul(0.85))
    .sub(smoothstep(0.014, 0.004, abs(v.sub(0.05))).mul(0.85));
  let c = hex('#DCE7FF').mul(
    pane
      .mul(saturate(bars))
      .mul(facing)
      .mul(1.25 * shine)
  ) as unknown as V3;
  const toLamp = normalize(vec3(0.66, 0.16, 0.74));
  const lamp = saturate(dot(dir, toLamp));
  c = c.add(
    hex('#FFC98A').mul(
      pow(lamp, 900)
        .mul(2.2 * shine)
        .add(pow(lamp, 18).mul(0.18))
    )
  ) as unknown as V3;
  const toFire = normalize(vec3(0.12, -0.38, 1));
  c = c.add(hex('#FF8A45').mul(pow(saturate(dot(dir, toFire)), 6).mul(0.16))) as unknown as V3;
  return c.add(mix(hex('#0E090A'), hex('#2A1A12'), saturate(dir.y.mul(0.6).add(0.4)))) as unknown as V3;
}

/** The strings of lights across the ceiling, where a ray from `o` along `dir` meets it before the wall */
function ceiling(maps: RoomMaps, o: V3, dir: V3) {
  const up = TSL.max(dir.y, 1e-3);
  const t = float(CEILING.y).sub(o.y).div(up);
  const toWall = float(WALL.z).sub(o.z).div(TSL.min(dir.z, -1e-4));
  const hit = o.add(dir.mul(t));
  const uv = vec2(
    hit.x.sub(CEILING.x0).div(CEILING.x1 - CEILING.x0),
    hit.z.sub(CEILING.z0).div(CEILING.z1 - CEILING.z0)
  );
  const on = step(t, toWall)
    .mul(smoothstep(0.06, 0.22, dir.y))
    .mul(step(0, uv.x).mul(step(uv.x, 1)).mul(step(0, uv.y)).mul(step(uv.y, 1)));
  return TSL.texture(maps.ceiling, uv).rgb.mul(on) as unknown as V3;
}

/** The whole room seen from `o` along `dir`: the far wall ahead, what's behind mirrored back, the ceiling's lights above */
export function room(maps: RoomMaps, o: V3, dir: V3, shine = 1, blur = 0) {
  const walls = mix(roomFront(dir, shine), roomBack(maps, o, dir, blur), smoothstep(0.12, -0.12, dir.z));
  return walls.add(ceiling(maps, o, dir)) as unknown as V3;
}

/** The room all round, drawn behind everything: a ball that goes everywhere with the camera */
export function backdrop(maps: RoomMaps) {
  const m = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false, depthTest: false });
  const dir = normalize(TSL.positionWorld.sub(TSL.cameraPosition)) as unknown as V3;
  m.colorNode = room(maps, TSL.cameraPosition as unknown as V3, dir);
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), m);
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  return mesh;
}

// ---- The table ----

/**
 * Walnut, French polished: the lamp's light pooled round the globe, the base's shadow, the bright
 * patch of lamplight the water ball gathers onto it behind, the room softly mirrored in the polish.
 * Sharp round the globe and melting out of focus away from it, its back edge too. It doesn't hide
 * what's under it (the base's reflection, drawn there upside down).
 */
export function table(maps: RoomMaps) {
  const m = new THREE.MeshBasicNodeMaterial({ depthWrite: false });
  const p = TSL.positionWorld;
  const cam = TSL.cameraPosition as unknown as V3;
  const view = normalize(cam.sub(p)) as unknown as V3;
  const at = p.xz.sub(vec2(GLOBE.centre.x, GLOBE.centre.z));
  const r = length(at);
  const sharp = smoothstep(1100, 300, r);
  // Long grain running across, figured a little; melting into its average out of focus
  const warp = TSL.mx_noise_float(vec2(p.x.mul(0.0011), p.z.mul(0.006))).mul(3.2);
  const grain = TSL.mx_noise_float(vec2(p.x.mul(0.0024), p.z.mul(0.045).add(warp)))
    .mul(0.5)
    .add(0.5);
  const fine = TSL.mx_noise_float(vec2(p.x.mul(0.01), p.z.mul(0.32)))
    .mul(0.5)
    .add(0.5);
  const figure = mix(float(0.5), grain.mul(0.75).add(fine.mul(0.25)), sharp);
  const albedo = mix(hex('#190C06'), hex('#3B1F10'), figure) as unknown as V3;
  // The lamp's pool; the base's shadow right under its foot and cast back from it, away from the lamp
  const pool = exp(r.div(720).pow(2).negate()).mul(0.78).add(0.12);
  let c = albedo.mul(hex('#FFC793').mul(pool)) as unknown as V3;
  const contact = smoothstep(162, 200, r).mul(0.88).add(0.12);
  const cast = smoothstep(150, 380, length(at.sub(vec2(-70, -95))))
    .mul(0.5)
    .add(0.5);
  c = c.mul(contact.mul(cast)) as unknown as V3;
  // Lamplight gathered through the water ball into a bright patch behind it
  const caustic = exp(
    length(at.sub(vec2(-175, -250)))
      .div(72)
      .pow(2)
      .negate()
  );
  const ripple = TSL.mx_noise_float(vec3(at.mul(0.04), TSL.time.mul(0.25)))
    .mul(0.35)
    .add(0.85);
  c = c.add(hex('#FFD9A0').mul(caustic.mul(ripple).mul(0.32))) as unknown as V3;
  // The polish: the room in it, softly, strongest at a glancing angle
  const n = vec3(0, 1, 0);
  const R = TSL.reflect(view.negate(), n) as unknown as V3;
  const fresnel = pow(float(1).sub(saturate(dot(view, n))), 5)
    .mul(0.9)
    .add(0.04);
  c = c.add(room(maps, p as unknown as V3, R, 1, 2.5).mul(fresnel)) as unknown as V3;
  // Its rounded back edge catching a line of lamplight, then the room beyond
  const lip = exp(
    p.z
      .sub(TABLE_BACK + 34)
      .div(16)
      .pow(2)
      .negate()
  ).mul(0.1);
  c = c.add(hex('#FFC890').mul(lip)) as unknown as V3;
  const keep = smoothstep(TABLE_BACK, TABLE_BACK + 60, p.z);
  m.colorNode = mix(room(maps, cam, view.negate()), c, keep);
  const depth = 9000;
  const geo = new THREE.PlaneGeometry(6000, depth).rotateX(-Math.PI / 2).translate(0, 0, TABLE_BACK + depth / 2);
  const mesh = new THREE.Mesh(geo, m);
  mesh.position.y = GLOBE.table;
  mesh.renderOrder = -5;
  return mesh;
}

// ---- The base ----

/**
 * Its profile, out from the axis and up: a turned foot, a gilt fillet, the lacquered body flaring
 * out toward the foot in one long concave sweep, a gilt bead, and the gilt collar the glass sits in
 */
const PROFILE: [number, number][] = (() => {
  const pts: [number, number][] = [
    [0, -122],
    [163, -122],
    [167.4, -121],
    [169.4, -118.6],
    [170, -115],
    [169.2, -111.8],
    [167, -109.6],
    [164.6, -108.8],
    [164.2, -108.2],
    [164.2, -103.8],
    [162.4, -103],
  ];
  for (let k = 1; k <= 16; k++) {
    const s = k / 16;
    pts.push([150 + 12.4 * Math.pow(1 - s, 2.2), -103 + s * 80]);
  }
  pts.push(
    [150.6, -22.5],
    [152.9, -20.6],
    [153.8, -18],
    [152.9, -15.4],
    [150.6, -13.6],
    [149.8, -12.5],
    [149.6, -4],
    [150.2, 0],
    [151, 2.6],
    [150.4, 4.6],
    [148.8, 5.8],
    [147.2, 5.6],
    [146.2, 4.4]
  );
  return pts;
})();
/** The gilt: the fillet round the foot; the bead and the collar */
const GILT: [number, number][] = [
  [-108.5, -103.4],
  [-23, 8],
];
/** The plaque on the front: its middle's height, its width round the body, the body's radius there */
const PLATE = { y: -64, w: 128, r: 151.4 };
const PLATE_H = (PLATE.w * PLAQUE_PX.h) / PLAQUE_PX.w;

function baseMaterial(maps: RoomMaps, mirror: boolean) {
  const m = new THREE.MeshBasicNodeMaterial(mirror ? { transparent: true, depthWrite: false } : {});
  const local = TSL.positionLocal;
  // The reflection's drawn upside down under the table: read it the right way up
  const y = (mirror ? float(2 * GLOBE.table).sub(local.y) : local.y) as unknown as F;
  const n = normalize(TSL.normalWorld) as unknown as V3;
  const pw = TSL.positionWorld as unknown as V3;
  const view = normalize(TSL.cameraPosition.sub(pw)) as unknown as V3;
  const ndv = saturate(dot(n, view));
  const R = TSL.reflect(view.negate(), n) as unknown as V3;
  const env = room(maps, pw, R);
  const lampDir = light.lamp as unknown as V3;
  const lamp = saturate(dot(n, lampDir));

  // Lacquer: deep red, deeper where it turns away; a clear coat over it mirroring the room
  const fill = saturate(dot(n, normalize(vec3(-0.6, 0.3, 0.75))));
  let lac = hex('#7A0C18').mul(
    hex('#FFD3AE')
      .mul(lamp.mul(0.95))
      .add(hex('#7F93D6').mul(fill.mul(0.28)))
      .add(0.12)
  ) as unknown as V3;
  lac = lac.mul(mix(float(1), float(0.5), pow(float(1).sub(ndv), 1.6))) as unknown as V3;
  const coat = pow(float(1).sub(ndv), 5).mul(0.96).add(0.04);
  lac = mix(lac, env, coat).add(hex('#FFF0DC').mul(pow(saturate(dot(R, lampDir)), 300).mul(1.4))) as unknown as V3;

  // Gilt, burnished round: mostly what it mirrors, warm
  const angle = TSL.atan(local.z, local.x);
  const brushed = TSL.mx_noise_float(vec2(angle.mul(300), y.mul(1.5)))
    .mul(0.06)
    .add(0.94);
  let metal = env
    .mul(hex('#F4C978'))
    .mul(1.7)
    .add(hex('#4A300C').mul(lamp.mul(0.7).add(0.16)))
    .mul(brushed) as unknown as V3;
  metal = metal.add(hex('#FFF2D6').mul(pow(saturate(dot(R, lampDir)), 60).mul(0.9))) as unknown as V3;
  let gilt = float(0) as unknown as F;
  for (const [lo, hi] of GILT)
    gilt = gilt.add(smoothstep(lo - 0.3, lo + 0.3, y).mul(smoothstep(hi + 0.3, hi - 0.3, y))) as unknown as F;
  let c = mix(lac, metal, saturate(gilt)) as unknown as V3;

  // The plaque: gilt, the tune's name cut into it, each cut's lower lip catching the light
  const pu = float(Math.PI / 2)
    .sub(angle)
    .mul(PLATE.r / PLATE.w)
    .add(0.5);
  const pv = y.sub(PLATE.y).div(PLATE_H).add(0.5);
  const within = step(0, pu).mul(step(pu, 1)).mul(step(0, pv)).mul(step(pv, 1));
  const here = TSL.texture(maps.plaque, vec2(pu, pv));
  const plate = here.r.mul(within);
  const cut = here.g.mul(within);
  const above = TSL.texture(maps.plaque, vec2(pu, pv.add(0.014))).g.mul(within);
  const engraved = metal
    .mul(1.12)
    .mul(float(1).sub(cut.mul(0.72)))
    .add(hex('#FFE7B0').mul(saturate(above.sub(cut)).mul(0.45))) as unknown as V3;
  c = mix(c, engraved, plate) as unknown as V3;
  // Its edge, standing a little proud
  c = c.add(hex('#FFDDA0').mul(plate.mul(float(1).sub(plate)).mul(0.9))) as unknown as V3;

  m.colorNode = c;
  if (mirror) {
    // In the table's polish: fading with depth under the tabletop
    m.opacityNode = exp(float(GLOBE.table).sub(pw.y).div(46).negate()).mul(0.4);
  }
  return m;
}

/** The base, standing still while the globe turns on it, and its reflection in the table */
export function base(maps: RoomMaps) {
  const geo = new THREE.LatheGeometry(
    PROFILE.map(([r, y]) => new THREE.Vector2(r, y)),
    180
  );
  const mesh = new THREE.Mesh(geo, baseMaterial(maps, false));
  // Upside down about the tabletop, wound the other way so it still faces out
  const flipped = geo.clone();
  flipped.applyMatrix4(new THREE.Matrix4().makeScale(1, -1, 1).setPosition(0, 2 * GLOBE.table, 0));
  const index = flipped.getIndex()!;
  for (let i = 0; i < index.count; i += 3) {
    const a = index.getX(i + 1);
    index.setX(i + 1, index.getX(i + 2));
    index.setX(i + 2, a);
  }
  const mirror = new THREE.Mesh(flipped, baseMaterial(maps, true));
  mirror.renderOrder = -4;
  for (const o of [mesh, mirror]) o.position.set(GLOBE.centre.x, 0, GLOBE.centre.z);
  return { mesh, mirror };
}

// ---- The music box's key ----

/** Where the key goes into the base: round to the right of the front, halfway up its body */
const KEY = { angle: 0.42, y: -60, r: 152.3 };

/**
 * A gilt butterfly key in the side of the base, the music box's, turning as it plays. `turn` is
 * what turns, about the key's own x (pointing straight out of the base).
 */
export function windKey(maps: RoomMaps) {
  const m = new THREE.MeshBasicNodeMaterial();
  {
    const n = normalize(TSL.normalWorld) as unknown as V3;
    const pw = TSL.positionWorld as unknown as V3;
    const view = normalize(TSL.cameraPosition.sub(pw)) as unknown as V3;
    const R = TSL.reflect(view.negate(), n) as unknown as V3;
    const lampDir = light.lamp as unknown as V3;
    m.colorNode = room(maps, pw, R)
      .mul(hex('#F4C978'))
      .mul(1.7)
      .add(hex('#4A300C').mul(saturate(dot(n, lampDir)).mul(0.7).add(0.16)))
      .add(hex('#FFF2D6').mul(pow(saturate(dot(R, lampDir)), 60).mul(0.9)));
  }
  const group = new THREE.Group();
  const turn = new THREE.Group();
  group.add(turn);
  // The escutcheon round the keyhole, then the shaft and its collar
  group.add(new THREE.Mesh(new THREE.TorusGeometry(5.4, 1.5, 12, 32).rotateY(Math.PI / 2).translate(0.4, 0, 0), m));
  turn.add(new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.4, 21, 20).rotateZ(-Math.PI / 2).translate(10.5, 0, 0), m));
  turn.add(new THREE.Mesh(new THREE.CylinderGeometry(3.5, 3.5, 2.6, 20).rotateZ(-Math.PI / 2).translate(13, 0, 0), m));
  // The bow: two round wings either side of the shaft, a hole through each
  const bow = new THREE.Shape();
  const N = 72;
  for (let k = 0; k <= N; k++) {
    const t = (k / N) * Math.PI * 2;
    const w = 0.42 + 0.58 * Math.pow(Math.abs(Math.sin(2 * t)), 0.6);
    const x = 22 + 8 * Math.cos(t) * w;
    const y = 13.5 * Math.sin(t);
    if (k === 0) bow.moveTo(x, y);
    else bow.lineTo(x, y);
  }
  for (const s of [1, -1]) {
    const hole = new THREE.Path();
    hole.absarc(22.6, 7.4 * s, 2.6, 0, Math.PI * 2, false);
    bow.holes.push(hole);
  }
  const wings = new THREE.ExtrudeGeometry(bow, {
    depth: 2.2,
    bevelEnabled: true,
    bevelThickness: 0.8,
    bevelSize: 0.8,
    bevelSegments: 3,
    curveSegments: 24,
  }).translate(0, 0, -1.1);
  turn.add(new THREE.Mesh(wings, m));
  // On the base: out along its radius, in the base's own frame
  group.position.set(KEY.r * Math.cos(KEY.angle), KEY.y, KEY.r * Math.sin(KEY.angle));
  group.rotation.y = -KEY.angle;
  group.scale.setScalar(1.35);
  return { group, turn };
}

// ---- Snow banked against the glass, all round inside ----

const BANK_FROM = 112;
const BANK_TO = 149.6;
/** How high the drift is at r out from the axis: nothing under the town, rising up against the glass */
export const bankHeight = (r: number) => {
  const u = Math.min(1, Math.max(0, (r - BANK_FROM) / (BANK_TO - BANK_FROM)));
  return r < BANK_FROM ? 0 : -0.6 + Math.pow(u, 2.6) * 9.2;
};

export function bank() {
  const m = new THREE.MeshBasicNodeMaterial();
  const p = TSL.positionLocal;
  const n = normalize(TSL.normalWorld) as unknown as V3;
  const view = normalize(TSL.cameraPosition.sub(TSL.positionWorld)) as unknown as V3;
  // Drifted: lumpy, never the same height twice round
  const lit = saturate(
    dot(n, light.moon as unknown as V3)
      .mul(0.5)
      .add(0.5)
  )
    .mul(0.55)
    .add(saturate(n.y).mul(0.35))
    .add(0.12);
  const snow = mix(hex('#8A98C8'), hex('#F2F5FF'), lit) as unknown as V3;
  // Glitter in the snow, catching the light as you move
  const cell = TSL.floor(p.mul(1.4));
  const g = TSL.hash(cell.x.mul(13.1).add(cell.y.mul(71.7)).add(cell.z.mul(5.3)));
  const glint = step(0.986, g)
    .mul(pow(saturate(TSL.sin(dot(view, vec3(31, 17, 23)).add(g.mul(60)))), 8))
    .mul(1.4);
  m.colorNode = snow.mul(0.92).add(hex('#FFF4D8').mul(glint));
  // Profile: from under the town's own snow out to the glass, rising into a drift against it
  const pts: THREE.Vector2[] = [];
  for (let k = 0; k <= 24; k++) {
    const r = BANK_FROM + (k / 24) * (BANK_TO - BANK_FROM);
    pts.push(new THREE.Vector2(r, bankHeight(r)));
  }
  const geo = new THREE.LatheGeometry(pts, 200);
  // A little lumpy all round
  const pos = geo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const a = Math.atan2(z, x);
    const u = Math.min(1, Math.max(0, (Math.hypot(x, z) - BANK_FROM) / (BANK_TO - BANK_FROM)));
    pos.setY(i, pos.getY(i) + (Math.sin(a * 7 + 1.3) * 0.9 + Math.sin(a * 17 + 0.4) * 0.5) * u * (1 - u) * 2.2);
  }
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, m);
}

// ---- The glass ----

/** Uniforms the scene sets: whether the camera's inside */
export const glassState = {
  inside: TSL.uniform(0),
};

export function glass(maps: RoomMaps) {
  const r = GLOBE.radius;
  const below = GLOBE.centre.y - GLOBE.ground;
  // Down to just under the collar: the rest is in the base
  const thetaMax = Math.acos(-(below + 2) / r);
  const geo = new THREE.SphereGeometry(r, 160, 120, 0, Math.PI * 2, 0, thetaMax);

  // Seen from outside: what's inside, bent by the glass and the water, the room mirrored over it
  const outer = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.FrontSide });
  {
    const n = normalize(TSL.normalWorld) as unknown as V3;
    const view = normalize(TSL.cameraPosition.sub(TSL.positionWorld)) as unknown as V3;
    const ndv = saturate(dot(n, view));
    const edge = float(1).sub(ndv);
    // Pulled in toward the middle near the rim, so the inside looks magnified, the way the water does it
    const nv = TSL.normalView;
    const bendBy = pow(edge, 2.6).mul(0.075);
    const off = vec2(nv.x, nv.y.negate()).mul(bendBy).negate();
    const uv = TSL.screenUV;
    const red = TSL.viewportSharedTexture(uv.add(off.mul(1.018))).r;
    const green = TSL.viewportSharedTexture(uv.add(off)).g;
    const blue = TSL.viewportSharedTexture(uv.add(off.mul(0.982))).b;
    const seen = vec3(red, green, blue).mul(mix(vec3(1, 1, 1), vec3(0.8, 0.92, 0.96), smoothstep(0.45, 0.98, edge)));
    const R = TSL.reflect(view.negate(), n) as unknown as V3;
    const fresnel = mix(float(0.045), float(1.0), pow(edge, 4.5));
    const mirrored = room(maps, TSL.positionWorld as unknown as V3, R, 9);
    // A thin bright line right at the edge, where you look along the glass, brightest up top
    const line = smoothstep(0.88, 0.995, edge)
      .mul(saturate(n.y.mul(0.5).add(0.6)))
      .mul(0.4);
    outer.colorNode = seen
      .mul(float(1).sub(fresnel.mul(0.55)))
      .add(mirrored.mul(fresnel))
      .add(hex('#D8E6FF').mul(line));
    outer.opacityNode = float(1);
  }
  const front = new THREE.Mesh(geo, outer);
  front.renderOrder = 30;

  // Seen from inside, down in the town: only a faint sheen of what's reflected off it
  const inner = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
  });
  {
    const n = normalize(TSL.normalWorld.negate()) as unknown as V3;
    const view = normalize(TSL.cameraPosition.sub(TSL.positionWorld)) as unknown as V3;
    const edge = float(1).sub(saturate(dot(n, view)));
    const R = TSL.reflect(view.negate(), n) as unknown as V3;
    const warm = hex('#FFB070').mul(saturate(R.y.negate()).mul(0.12));
    inner.colorNode = warm.add(hex('#9FB6FF').mul(pow(edge, 3).mul(0.08))).mul(glassState.inside);
  }
  const back = new THREE.Mesh(geo, inner);
  back.renderOrder = 29;

  const group = new THREE.Group();
  group.add(back, front);
  group.position.copy(GLOBE.centre);
  return { group, front, back };
}

/** Whether a point (world, metres) is inside the glass */
export const insideGlass = (p: THREE.Vector3) => p.distanceTo(GLOBE.centre) < GLOBE.radius;
