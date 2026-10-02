import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Flat strip with its own width on each side of every point: `sides[i] = [left, right]` (left is
 * the +normal side, as in ribbonGeometry). uv.x stays relative to `fullHalf`, so markings painted
 * across the strip keep their place when one side is trimmed.
 */
export function ribbonSides(points: THREE.Vector3[], sides: [number, number][], fullHalf: number, lift = 0) {
  const positions: number[] = [];
  const uvs: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  let along = 0;
  points.forEach((p, i) => {
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
    const tx = next.x - prev.x;
    const tz = next.z - prev.z;
    const len = Math.hypot(tx, tz) || 1;
    const nx = -tz / len;
    const nz = tx / len;
    const [left, right] = sides[i];
    if (i > 0) along += p.distanceTo(points[i - 1]);
    positions.push(p.x + nx * left, p.y + lift, p.z + nz * left);
    positions.push(p.x - nx * right, p.y + lift, p.z - nz * right);
    uvs.push(0.5 - left / (2 * fullHalf), along, 0.5 + right / (2 * fullHalf), along);
    normals.push(0, 1, 0, 0, 1, 0);
    if (i < points.length - 1) {
      const a = i * 2;
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  return geometry;
}

/** Flat strip following `points`, uv.x across (0..1), uv.y = distance along in world units */
export function ribbonGeometry(points: THREE.Vector3[], halfWidth: number, lift = 0) {
  const positions: number[] = [];
  const uvs: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  let along = 0;
  points.forEach((p, i) => {
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
    const tx = next.x - prev.x;
    const tz = next.z - prev.z;
    const len = Math.hypot(tx, tz) || 1;
    const nx = -tz / len;
    const nz = tx / len;
    if (i > 0) along += p.distanceTo(points[i - 1]);
    positions.push(p.x + nx * halfWidth, p.y + lift, p.z + nz * halfWidth);
    positions.push(p.x - nx * halfWidth, p.y + lift, p.z - nz * halfWidth);
    uvs.push(0, along, 1, along);
    normals.push(0, 1, 0, 0, 1, 0);
    if (i < points.length - 1) {
      // Counter-clockwise seen from above, so the strip faces up
      const a = i * 2;
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  return geometry;
}

/** Vertical skirts on both sides of a ribbon, giving the viaduct deck its thickness */
export function skirtGeometry(points: THREE.Vector3[], halfWidth: number, depth: number) {
  const positions: number[] = [];
  const indices: number[] = [];
  let v = 0;
  for (const side of [1, -1]) {
    points.forEach((p, i) => {
      const prev = points[Math.max(0, i - 1)];
      const next = points[Math.min(points.length - 1, i + 1)];
      const tx = next.x - prev.x;
      const tz = next.z - prev.z;
      const len = Math.hypot(tx, tz) || 1;
      const x = p.x + (-tz / len) * halfWidth * side;
      const z = p.z + (tx / len) * halfWidth * side;
      positions.push(x, p.y, z, x, p.y - depth, z);
      if (i < points.length - 1) {
        const a = v + i * 2;
        indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    });
    v += points.length * 2;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** Copy of a polyline shifted sideways (in xz) by `offset`, at height `y` */
export function offsetPolyline(points: THREE.Vector3[], offset: number, y?: number) {
  return points.map((p, i) => {
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
    const tx = next.x - prev.x;
    const tz = next.z - prev.z;
    const len = Math.hypot(tx, tz) || 1;
    return new THREE.Vector3(p.x + (-tz / len) * offset, y ?? p.y, p.z + (tx / len) * offset);
  });
}

export function distanceToPolyline(x: number, z: number, pts: THREE.Vector3[]) {
  let best = Infinity;
  for (const p of pts) {
    const dd = (p.x - x) ** 2 + (p.z - z) ** 2;
    if (dd < best) best = dd;
  }
  return Math.sqrt(best);
}

/** Merge geometries, keeping only the attributes they all share (e.g. skirts have no uv) */
export function merge(geometries: THREE.BufferGeometry[]) {
  if (geometries.length === 0) return new THREE.BufferGeometry();
  const common = Object.keys(geometries[0].attributes).filter((name) => geometries.every((g) => g.attributes[name]));
  const mixedIndex = geometries.some((g) => g.index) && geometries.some((g) => !g.index);
  const prepared = geometries.map((g) => {
    let out = g;
    if (mixedIndex && out.index) out = out.toNonIndexed();
    for (const name of Object.keys(out.attributes)) {
      if (!common.includes(name)) {
        if (out === g) out = g.clone();
        out.deleteAttribute(name);
      }
    }
    return out;
  });
  return mergeGeometries(prepared, false) ?? new THREE.BufferGeometry();
}

/** Fill an InstancedMesh from a list of transforms */
export function instanced(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  items: { position: THREE.Vector3; yaw?: number; scale?: THREE.Vector3; color?: string }[]
) {
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, items.length));
  mesh.count = items.length;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const one = new THREE.Vector3(1, 1, 1);
  const c = new THREE.Color();
  items.forEach((it, i) => {
    q.setFromAxisAngle(up, it.yaw ?? 0);
    m.compose(it.position, q, it.scale ?? one);
    mesh.setMatrixAt(i, m);
    if (it.color) mesh.setColorAt(i, c.set(it.color));
  });
  return mesh;
}

/**
 * Bake every mesh under `root` into one mesh per material (in the space of `relativeTo`,
 * or world space). Hundreds of small static meshes become a handful of draw calls.
 * Meshes flagged with `userData.keep` are left alone.
 */
export function mergeByMaterial(root: THREE.Object3D, relativeTo?: THREE.Object3D) {
  root.updateMatrixWorld(true);
  const inverse = relativeTo ? relativeTo.matrixWorld.clone().invert() : new THREE.Matrix4();
  const buckets = new Map<THREE.Material, { geos: THREE.BufferGeometry[]; renderOrder: number }>();
  const m = new THREE.Matrix4();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || mesh.userData.keep || Array.isArray(mesh.material)) return;
    let geo = mesh.geometry.clone();
    if (geo.index) geo = geo.toNonIndexed();
    for (const name of Object.keys(geo.attributes)) {
      if (!['position', 'normal', 'uv'].includes(name)) geo.deleteAttribute(name);
    }
    geo.applyMatrix4(m.multiplyMatrices(inverse, mesh.matrixWorld));
    const bucket = buckets.get(mesh.material) ?? { geos: [], renderOrder: mesh.renderOrder };
    bucket.geos.push(geo);
    buckets.set(mesh.material, bucket);
  });
  return [...buckets].map(([material, { geos, renderOrder }]) => {
    const merged = new THREE.Mesh(merge(geos), material);
    merged.renderOrder = renderOrder;
    return merged;
  });
}
