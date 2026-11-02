import * as TSL from 'three/tsl';
import * as THREE from 'three/webgpu';

import { loadTexture } from './art';
import { BAKED } from './baked';

/**
 * Light baked in Blender. The shop and home are built here, in code, the same as ever; then (once,
 * in development) everything in each place that never moves is sent to Blender
 * (scripts/blender/corner_shop_bake.py), which lights it with Cycles, the bulbs and the lamp and
 * the neon as real lights, and bakes what falls on every surface into a lightmap: soft shadows
 * under every shelf and in every corner, the warm bounce off the floor, the window's pink on the
 * pavement. One lightmap per group of lights, so they can still come on in turn as the door opens:
 * the shader adds them up, each scaled by how far on it is.
 *
 * What moves (the doors, the bell, what's for sale, what's unpacked, the camera, the bag) stays lit
 * the old way, by three.js lights.
 *
 * Lightmaps are stored as sqrt(light / RANGE), so the dark end keeps its precision in 8 bits.
 */

export const RANGE = 4;

/** The groups of lights, each baked on its own */
export const LAYERS = {
  shop: ['base', 'room', 'awning', 'neon'],
  home: ['base', 'room'],
} as const;
export type Place = keyof typeof LAYERS;

/** Something that lights the place, for Blender to put a real light where it is */
export type BakeLight = { kind: string; layer: string; at: number[]; size: number[]; color: string };

const isLit = (m: THREE.Material) =>
  m.visible &&
  !m.transparent &&
  m.alphaTest === 0 &&
  ((m as THREE.MeshStandardMaterial).isMeshStandardMaterial ?? false);
const isSolid = (m: THREE.Material) => m.visible && !m.transparent && m.alphaTest === 0;
const mats = (mesh: THREE.Mesh) => (Array.isArray(mesh.material) ? mesh.material : [mesh.material]);

/**
 * Everything in a place that stays put, in the same order every time: the meshes lit by the bake,
 * and the other solid ones that only cast its shadows. Anything under an object marked `live` moves,
 * and is left out.
 */
export function fixtures(root: THREE.Object3D) {
  const lit: THREE.Mesh[] = [];
  const occluders: THREE.Mesh[] = [];
  const walk = (o: THREE.Object3D) => {
    if (o.userData.live || (o !== root && !o.visible)) return;
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      const ms = mats(mesh);
      if (ms.every(isLit)) lit.push(mesh);
      else if (ms.every(isSolid)) occluders.push(mesh);
    }
    for (const c of o.children) walk(c);
  };
  walk(root);
  return { lit, occluders };
}

/** The mesh's triangles, corner by corner (never shared), as Blender will see them */
const loose = (g: THREE.BufferGeometry) => (g.index ? g.toNonIndexed() : g.clone());

const b64 = (a: ArrayBufferView) => {
  const bytes = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

const hex = (c: THREE.Color) => `#${c.getHexString()}`;

/** A place's fixtures and lights, for Blender */
export function describe(root: THREE.Object3D, lights: BakeLight[]) {
  root.updateMatrixWorld(true);
  const { lit, occluders } = fixtures(root);
  const table: string[] = [];
  const index = new Map<string, number>();
  const albedo = (m: THREE.Material) => {
    let i = index.get(m.uuid);
    if (i === undefined) {
      const s = m as THREE.MeshStandardMaterial;
      table.push((m.userData.albedo as string | undefined) ?? (s.color ? hex(s.color) : '#808080'));
      index.set(m.uuid, (i = table.length - 1));
    }
    return i;
  };
  const one = (mesh: THREE.Mesh, isTarget: boolean) => {
    const g = loose(mesh.geometry);
    g.applyMatrix4(mesh.matrixWorld);
    const pos = g.getAttribute('position').array as Float32Array;
    const nrm = g.getAttribute('normal')?.array as Float32Array | undefined;
    const tris = pos.length / 9;
    const mat = new Uint16Array(tris);
    const ms = mats(mesh);
    if (Array.isArray(mesh.material) && g.groups.length) {
      for (const grp of g.groups) {
        const i = albedo(ms[grp.materialIndex ?? 0]);
        for (let t = grp.start / 3; t < (grp.start + grp.count) / 3 && t < tris; t++) mat[t] = i;
      }
    } else mat.fill(albedo(ms[0]));
    const out = {
      target: isTarget,
      corners: tris * 3,
      pos: b64(new Float32Array(pos)),
      nrm: nrm ? b64(new Float32Array(nrm)) : null,
      mat: b64(mat),
    };
    g.dispose();
    return out;
  };
  return {
    meshes: [...lit.map((m) => one(m, true)), ...occluders.map((m) => one(m, false))],
    materials: table,
    lights,
  };
}

/** Where a tagged light is: the middle of its box, and the box's size */
export function lightAt(o: THREE.Object3D, kind: string, layer: string, color: string): BakeLight {
  const box = new THREE.Box3().setFromObject(o);
  const c = box.getCenter(new THREE.Vector3());
  const s = box.getSize(new THREE.Vector3());
  return { kind, layer, at: c.toArray(), size: s.toArray(), color };
}

export type BakeData = { corners: number[]; uv: string };

const unb64 = (s: string) => {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
};

/**
 * Light a place by its bake: each lit fixture gets its lightmap coordinates and a material that
 * adds up the layers (each by its level) instead of lighting itself. If the place has changed
 * since it was baked (a fixture's corner count no longer matches) it's left as it was.
 */
export function applyBake(root: THREE.Object3D, data: BakeData, maps: THREE.Texture[], levels: THREE.Node<'float'>[]) {
  const { lit } = fixtures(root);
  if (lit.length !== data.corners.length) return false;
  for (let i = 0; i < lit.length; i++) {
    const g = lit[i].geometry;
    const n = g.index ? g.index.count : g.getAttribute('position').count;
    if (n !== data.corners[i]) return false;
  }
  const uv = new Uint16Array(unb64(data.uv));
  const light = maps
    .map((map, i) => {
      const v = TSL.texture(map, TSL.uv(1)).rgb;
      return v.mul(v).mul(levels[i]);
    })
    .reduce((a, b) => a.add(b))
    .mul(RANGE);
  const made = new Map<string, THREE.Material>();
  const bakedOf = (src: THREE.Material) => {
    let m = made.get(src.uuid);
    if (m) return m;
    const s = src as THREE.MeshStandardNodeMaterial;
    const out = new THREE.MeshBasicNodeMaterial({ side: s.side });
    let base: THREE.Node<'vec3'>;
    if (s.colorNode) base = s.colorNode as THREE.Node<'vec3'>;
    else if (s.map) base = TSL.texture(s.map, TSL.uv()).rgb.mul(TSL.color(s.color)) as THREE.Node<'vec3'>;
    else base = TSL.color(s.color) as unknown as THREE.Node<'vec3'>;
    if (s.vertexColors) base = base.mul(TSL.attribute('color', 'vec3')) as THREE.Node<'vec3'>;
    let colour = base.mul(light) as THREE.Node<'vec3'>;
    // Polished metal still catches a glint off the lights, which a lightmap can't hold
    if (s.metalness > 0.2) {
      const n = TSL.normalize(TSL.normalWorld);
      const v = TSL.normalize(TSL.cameraPosition.sub(TSL.positionWorld));
      const edge = TSL.float(1)
        .sub(TSL.saturate(TSL.dot(n, v)))
        .pow(3);
      colour = colour.add(base.mul(light).mul(edge.mul(0.6).add(0.15))) as THREE.Node<'vec3'>;
    }
    if (s.emissiveNode) colour = colour.add(s.emissiveNode as THREE.Node<'vec3'>) as THREE.Node<'vec3'>;
    else if (s.emissive && s.emissive.getHex() !== 0)
      colour = colour.add(TSL.color(s.emissive).mul(s.emissiveIntensity)) as THREE.Node<'vec3'>;
    out.colorNode = colour;
    made.set(src.uuid, (m = out));
    return m;
  };
  let at = 0;
  for (let i = 0; i < lit.length; i++) {
    const mesh = lit[i];
    const g = loose(mesh.geometry);
    const n = data.corners[i];
    const a = new Float32Array(n * 2);
    for (let k = 0; k < n * 2; k++) a[k] = uv[at + k] / 65535;
    at += n * 2;
    g.setAttribute('uv1', new THREE.BufferAttribute(a, 2));
    mesh.geometry = g;
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(bakedOf) : bakedOf(mesh.material);
  }
  // The drawn shadows under what stays put are in the bake now
  root.traverse((o) => {
    if (o.userData.drawnShadow && !liveAbove(o, root)) o.visible = false;
  });
  return true;
}

const liveAbove = (o: THREE.Object3D, root: THREE.Object3D) => {
  for (let p: THREE.Object3D | null = o; p && p !== root; p = p.parent) if (p.userData.live) return true;
  return false;
};

/** A place's bake, decoded: null if it hasn't been baked */
export async function loadBake(place: Place) {
  const b = BAKED[place];
  if (!b) return null;
  const maps = await Promise.all(b.maps.map(loadTexture));
  if (maps.some((m) => !m)) return null;
  for (const m of maps) {
    m!.generateMipmaps = false;
    m!.minFilter = THREE.LinearFilter;
    m!.anisotropy = 1;
  }
  return { data: b.data, maps: maps as THREE.Texture[] };
}
