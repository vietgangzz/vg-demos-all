import * as TSL from 'three/tsl';
import * as THREE from 'three/webgpu';

import { dayness, haze, hex, light, radial, shade, SNOWFIELD, type F, type V3 } from './light';
import { coastDistance, groundRadius, SEA, TOWN_REACH, townGround, type HeroFrame, type WorldMaps } from './world';

/**
 * The globe itself: land standing up out of the sea like iced cake, the sea painted the way a
 * picture book paints it, sea ice round the pole, and the air glowing at the edge.
 */

const { vec2, vec3, float, mix, saturate, smoothstep, dot, normalize, fract, uv, texture, time, reflect, pow } =
  TSL;

/** Longitude and latitude of a unit direction, as the maps' u and v */
const sunDir = () => light.sun as unknown as V3;
const moonDir = () => light.moon as unknown as V3;

const mapUV = (p: V3) =>
  vec2(TSL.atan(p.x, p.z).div(Math.PI * 2).add(0.5), TSL.asin(p.y.clamp(-1, 1)).div(Math.PI).add(0.5));

// ---- Land ----

const GW = 1080;
const GH = 540;

/**
 * The land as one mesh: a longitude/latitude grid pushed out to the ground's height, leaving out
 * the open sea (the sea is its own sphere). Normals come from the neighbouring grid points, so
 * there's no seam where longitude wraps.
 *
 * Round the town set into it, the ground follows the town's own, just under it, and eases back.
 */
function landGeometry(maps: WorldMaps, hero?: HeroFrame) {
  const inv = hero ? hero.quaternion.clone().invert() : null;
  const local = new THREE.Vector3();
  const shape = maps.shapeField;
  const cols = GW + 1;
  const rows = GH + 1;
  const pos = new Float32Array(cols * rows * 3);
  const coast = new Float32Array(cols * rows);
  for (let j = 0; j < rows; j++) {
    const lat = 90 - (180 * j) / GH;
    const la = (lat * Math.PI) / 180;
    for (let i = 0; i < cols; i++) {
      const lon = -180 + (360 * i) / GW;
      const lo = (lon * Math.PI) / 180;
      let r = groundRadius(shape, lon, lat);
      const k = (j * cols + i) * 3;
      if (hero && inv) {
        local.set(Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo));
        if (local.dot(hero.dir) > 0.98) {
          local.multiplyScalar(hero.radius).sub(hero.position).applyQuaternion(inv).divideScalar(hero.scale);
          const w = 1 - THREE.MathUtils.smoothstep(Math.hypot(local.x, local.z), TOWN_REACH - 10, TOWN_REACH + 110);
          r += (hero.radius + hero.scale * (townGround(local.x, local.z) - 0.35) - r) * w;
        }
      }
      pos[k] = Math.cos(la) * Math.sin(lo) * r;
      pos[k + 1] = Math.sin(la) * r;
      pos[k + 2] = Math.cos(la) * Math.cos(lo) * r;
      coast[j * cols + i] = coastDistance(shape, lon, lat);
    }
  }
  // Keep a cell if any corner is near land
  const keep = new Uint8Array(cols * rows);
  const cells: number[] = [];
  for (let j = 0; j < GH; j++) {
    for (let i = 0; i < GW; i++) {
      const a = j * cols + i;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      if (Math.max(coast[a], coast[b], coast[c], coast[d]) < -0.6) continue;
      cells.push(a);
      keep[a] = keep[b] = keep[c] = keep[d] = 1;
    }
  }
  const remap = new Int32Array(cols * rows).fill(-1);
  let count = 0;
  for (let v = 0; v < keep.length; v++) if (keep[v]) remap[v] = count++;
  const outPos = new Float32Array(count * 3);
  const outNrm = new Float32Array(count * 3);
  const outUV = new Float32Array(count * 2);
  const e = new THREE.Vector3();
  const n = new THREE.Vector3();
  const c = new THREE.Vector3();
  const at = (i: number, j: number, out: THREE.Vector3) => {
    const k = (j * cols + (((i % GW) + GW) % GW)) * 3;
    return out.set(pos[k], pos[k + 1], pos[k + 2]);
  };
  const p1 = new THREE.Vector3();
  const p2 = new THREE.Vector3();
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const v = j * cols + i;
      const o = remap[v];
      if (o < 0) continue;
      outPos[o * 3] = pos[v * 3];
      outPos[o * 3 + 1] = pos[v * 3 + 1];
      outPos[o * 3 + 2] = pos[v * 3 + 2];
      outUV[o * 2] = i / GW;
      outUV[o * 2 + 1] = 1 - j / GH;
      if (j === 0 || j === GH) {
        n.set(0, j === 0 ? 1 : -1, 0);
      } else {
        e.subVectors(at(i + 1, j, p1), at(i - 1, j, p2));
        c.subVectors(at(i, j - 1, p1), at(i, j + 1, p2));
        n.crossVectors(e, c).normalize();
      }
      outNrm[o * 3] = n.x;
      outNrm[o * 3 + 1] = n.y;
      outNrm[o * 3 + 2] = n.z;
    }
  }
  const index = new Uint32Array(cells.length * 6);
  let w = 0;
  for (const a of cells) {
    const b = a + 1;
    const cc = a + cols;
    const d = cc + 1;
    index[w++] = remap[a];
    index[w++] = remap[cc];
    index[w++] = remap[b];
    index[w++] = remap[b];
    index[w++] = remap[cc];
    index[w++] = remap[d];
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(outPos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(outNrm, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(outUV, 2));
  g.setIndex(new THREE.BufferAttribute(index, 1));
  g.computeBoundingSphere();
  return g;
}

function landMaterial(maps: WorldMaps, hero?: HeroFrame) {
  const m = new THREE.MeshBasicNodeMaterial();
  const v = uv();
  const paint = texture(maps.color, v).rgb as unknown as V3;
  const shapeTex = texture(maps.shape, v);
  const coast = shapeTex.r.sub(0.5).mul(16);
  const people = shapeTex.b;
  const up = radial();
  const n = normalize(TSL.normalWorld) as unknown as V3;
  const slope = saturate(float(1).sub(dot(n, up)));
  const snowy = smoothstep(0.78, 0.9, paint.g);
  // Soft clay: the paint, a sandy shore, earth showing on the steep sides, a touch of shade low down
  const beach = smoothstep(0.42, 0.18, coast).mul(oneMinusSnow(snowy));
  let albedo = mix(paint, hex('#EFDDAA'), beach.mul(0.8)) as unknown as V3;
  const cliff = smoothstep(0.1, 0.35, slope);
  albedo = mix(albedo, mix(hex('#A57A58'), hex('#D5DCEB'), snowy), cliff.mul(0.75)) as unknown as V3;
  albedo = albedo.mul(smoothstep(-0.1, 0.8, shapeTex.g.add(smoothstep(0, 2, coast).mul(0.5))).mul(0.12).add(0.88)) as unknown as V3;
  albedo = albedo.mul(TSL.mx_noise_float(TSL.positionLocal.mul(180)).mul(0.04).add(1)) as unknown as V3;
  if (hero) {
    // Winter all round the town: snow over the fields for a good way out, its edge ragged, so the
    // town sits in a snowy country instead of on a white disc in green fields
    const d = dot(normalize(TSL.positionLocal), vec3(hero.dir.x, hero.dir.y, hero.dir.z));
    const angle = TSL.acos(d.clamp(-1, 1)).mul(180 / Math.PI);
    const ragged = TSL.mx_fractal_noise_float(TSL.positionLocal.mul(26), 3, 2.0, 0.5).mul(3.2);
    const winter = smoothstep(15, 7, angle.add(ragged));
    albedo = mix(albedo, hex(SNOWFIELD).mul(TSL.mx_noise_float(TSL.positionLocal.mul(300)).mul(0.03).add(1)), winter.mul(0.94)) as unknown as V3;
  }
  const lit = shade(albedo, n, up);
  // Windows lit up across the night side: soft dots on a grid, thickest where people live
  const cell = v.mul(vec2(900, 450));
  const id = cell.floor();
  const h = TSL.hash(id.x.mul(17.13).add(id.y.mul(311.7)));
  const jitter = vec2(TSL.hash(id.x.add(id.y.mul(57.3)).add(3.1)), TSL.hash(id.x.mul(7.7).add(id.y).add(9.4)));
  const d = fract(cell).sub(jitter.mul(0.6).add(0.2)).length();
  const town = smoothstep(0.9, 1, h.add(people.mul(0.5))).mul(smoothstep(0.22, 0.04, d)).mul(smoothstep(0.03, 0.15, people));
  const twinkle = TSL.sin(time.mul(2.3).add(h.mul(40))).mul(0.15).add(0.85);
  // Up close they'd be lamps the size of houses: they fade as you come down to them
  const far = smoothstep(0.2, 0.7, TSL.positionWorld.distance(TSL.cameraPosition));
  const night = float(1).sub(dayness(up)).mul(far);
  const windows = hex('#FFC873').mul(town.mul(people.mul(1.4).add(0.25)).mul(twinkle).mul(night).mul(1.6));
  const glow = hex('#FF9E57').mul(people.mul(people).mul(night).mul(0.22));
  m.colorNode = lit.add(windows).add(glow).add(haze(n, up));
  return m;
}

const oneMinusSnow = (s: F) => float(1).sub(s) as unknown as F;

// ---- Sea ----

function seaMaterial(maps: WorldMaps) {
  const m = new THREE.MeshBasicNodeMaterial();
  const p = normalize(TSL.positionLocal) as unknown as V3;
  const v = mapUV(p);
  const coast = texture(maps.shape, v).r.sub(0.5).mul(16);
  const out = coast.negate();
  // Turquoise over the shelves, darkening smoothly into the deep; slow swirls in it
  const swirl = TSL.mx_fractal_noise_float(p.mul(5).add(vec3(time.mul(0.01), 0, 0)), 3, 2.0, 0.5);
  const depth = smoothstep(0.0, 6.0, out.add(swirl.mul(0.9)));
  let water = mix(hex('#4CC3CF'), hex('#2A86C4'), smoothstep(0.0, 1.6, out)) as unknown as V3;
  water = mix(water, hex('#18478F'), smoothstep(0.25, 1.0, depth)) as unknown as V3;
  water = water.mul(swirl.mul(0.06).add(1)) as unknown as V3;
  // A thin wash of foam right at the shore
  water = mix(water, hex('#E9FBFF'), smoothstep(-0.3, -0.06, coast).mul(0.6)) as unknown as V3;
  // Sea ice round the poles, cracked into floes
  const lat = TSL.asin(p.y.clamp(-1, 1)).mul(180 / Math.PI);
  const wobble = TSL.mx_noise_float(p.mul(9)).mul(3);
  const ice = smoothstep(75.5, 77, lat.add(wobble)).add(smoothstep(-64, -66, lat.add(wobble)));
  const floes = TSL.mx_worley_noise_vec2(p.mul(60));
  const crack = smoothstep(0.0, 0.06, floes.y.sub(floes.x));
  const iceCol = mix(hex('#9FC3E6'), hex('#EEF6FF'), crack);
  water = mix(water, iceCol, saturate(ice)) as unknown as V3;
  // Lit flat, with the sun and the moon glinting off it
  const up = radial();
  const ripple = vec3(
    TSL.mx_noise_float(p.mul(70).add(time.mul(0.1))),
    0,
    TSL.mx_noise_float(p.mul(70).add(vec3(5, time.mul(0.1), 0)))
  ).mul(0.035);
  const n = normalize(up.add(ripple)) as unknown as V3;
  const lit = shade(water, n, up, 0.5);
  const view = normalize(TSL.positionWorld.sub(TSL.cameraPosition));
  const r = reflect(view, n);
  const sunGlint = pow(saturate(dot(r, sunDir())), 90).mul(1.3);
  const moonGlint = pow(saturate(dot(r, moonDir())), 400).mul(0.18);
  const open = float(1).sub(saturate(ice));
  const glints = hex('#FFF6DD')
    .mul(sunGlint.mul(dayness(up)))
    .add(hex('#C9D9FF').mul(moonGlint.mul(float(1).sub(dayness(up)))))
    .mul(open);
  m.colorNode = lit.add(glints).add(haze(n, up));
  return m;
}

// ---- Air ----

/** A glow round the limb, strongest right at the edge, coloured by the time of day under it */
function airMesh() {
  const m = new THREE.MeshBasicNodeMaterial({
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const ray = normalize(TSL.positionWorld.sub(TSL.cameraPosition));
  const miss = TSL.cross(ray, TSL.cameraPosition.negate()).length();
  const glow = pow(saturate(float(1.045).sub(miss).div(0.045)), 1.6);
  const up = radial();
  const tint = mix(hex('#3F6BE0'), hex('#7FC8FF'), dayness(up)).add(hex('#FF9E7A').mul(TSL.exp(dot(up, sunDir()).mul(dot(up, sunDir())).mul(-30)).mul(0.35)));
  m.colorNode = tint.mul(glow.mul(0.5));
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1.05, 128, 64), m);
  mesh.renderOrder = 3;
  return mesh;
}

export function buildGlobe(maps: WorldMaps, hero?: HeroFrame) {
  const group = new THREE.Group();
  const land = new THREE.Mesh(landGeometry(maps, hero), landMaterial(maps, hero));
  const sea = new THREE.Mesh(new THREE.SphereGeometry(SEA, 192, 96), seaMaterial(maps));
  group.add(land, sea);
  return { group, air: airMesh() };
}
