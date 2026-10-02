// Turns the CC0 Quaternius "Ultimate Stylized Nature" GLBs (scripts/foliage/fetch.mjs) into the
// compact foliage data the diorama loads: src/demos/metro-live/data/foliage.json.
//   - leaf / palm / flower textures, downsized, as base64 RGBA (no image loader needed
//     on react-native-webgpu: they become DataTextures)
//   - the five palm trees as trunk + frond meshes, Y up, normalised to 1 unit tall
// Needs ImageMagick (`magick`) for the texture resampling.
// Models by Quaternius (quaternius.com), CC0.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const CACHE = join(ROOT, '.cache');
const OUT = join(ROOT, '../../src/demos/metro-live/data/foliage.json');

function readGlb(file) {
  const b = readFileSync(join(CACHE, file));
  const jsonLen = b.readUInt32LE(12);
  const json = JSON.parse(b.subarray(20, 20 + jsonLen).toString());
  const bin = b.subarray(20 + jsonLen + 8);
  return { json, bin };
}

const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
function accessor({ json, bin }, index) {
  const a = json.accessors[index];
  const v = json.bufferViews[a.bufferView];
  const n = COMPONENTS[a.type];
  const offset = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const stride = v.byteStride ?? 0;
  const out = [];
  const size = { 5126: 4, 5125: 4, 5123: 2, 5121: 1 }[a.componentType];
  const read = {
    5126: (o) => bin.readFloatLE(o),
    5125: (o) => bin.readUInt32LE(o),
    5123: (o) => bin.readUInt16LE(o),
    5121: (o) => bin.readUInt8(o),
  }[a.componentType];
  for (let i = 0; i < a.count; i++) {
    const base = offset + i * (stride || n * size);
    for (let c = 0; c < n; c++) out.push(read(base + c * size));
  }
  return out;
}

/** Image of a GLB resampled to w×h RGBA. `mode` 'leaf' keeps alpha and stores luminance in rgb */
function texture(glb, imageIndex, w, h, mode) {
  const im = glb.json.images[imageIndex];
  const v = glb.json.bufferViews[im.bufferView];
  const png = glb.bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength);
  const raw = execFileSync('magick', ['png:-', '-resize', `${w}x${h}!`, '-depth', '8', 'rgba:-'], {
    input: png,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (mode === 'leaf') {
    // Luminance normalised to 0.55..1 so an instance colour tints it into any species
    let lo = 1;
    let hi = 0;
    const lum = [];
    for (let i = 0; i < raw.length; i += 4) {
      const l = (0.3 * raw[i] + 0.59 * raw[i + 1] + 0.11 * raw[i + 2]) / 255;
      lum.push(l);
      if (raw[i + 3] > 128) {
        lo = Math.min(lo, l);
        hi = Math.max(hi, l);
      }
    }
    for (let i = 0; i < raw.length; i += 4) {
      const t = Math.min(1, Math.max(0, (lum[i / 4] - lo) / (hi - lo || 1)));
      const g = Math.round(255 * (0.55 + 0.45 * t));
      raw[i] = raw[i + 1] = raw[i + 2] = g;
    }
  }
  return { w, h, rgba: Buffer.from(raw).toString('base64') };
}

const r4 = (x) => Math.round(x * 1e4) / 1e4;

/** The five palms: Z-up meshes rotated into Y up, base at the origin, 1 unit tall */
function palms(glb) {
  const { json } = glb;
  const leavesMaterial = json.materials.findIndex((m) => /Leaves/.test(m.name));
  return json.meshes.map((mesh) => {
    const parts = mesh.primitives.map((p) => {
      const pos = accessor(glb, p.attributes.POSITION);
      const nor = accessor(glb, p.attributes.NORMAL);
      const uv = accessor(glb, p.attributes.TEXCOORD_0);
      const idx = p.indices !== undefined ? accessor(glb, p.indices) : [...Array(pos.length / 3).keys()];
      // (x, y, z) Z-up → (x, z, -y) Y-up
      const p3 = [];
      const n3 = [];
      for (let i = 0; i < pos.length; i += 3) {
        p3.push(pos[i], pos[i + 2], -pos[i + 1]);
        n3.push(nor[i], nor[i + 2], -nor[i + 1]);
      }
      return { leaves: p.material === leavesMaterial, p: p3, n: n3, uv, i: idx };
    });
    const trunk = parts.find((x) => !x.leaves);
    let minY = Infinity;
    let maxY = -Infinity;
    for (const part of parts) for (let i = 1; i < part.p.length; i += 3) {
      minY = Math.min(minY, part.p[i]);
      maxY = Math.max(maxY, part.p[i]);
    }
    // Centre on the trunk's base
    let bx = 0;
    let bz = 0;
    let count = 0;
    for (let i = 0; i < trunk.p.length; i += 3) {
      if (trunk.p[i + 1] < minY + (maxY - minY) * 0.05) {
        bx += trunk.p[i];
        bz += trunk.p[i + 2];
        count++;
      }
    }
    bx /= count || 1;
    bz /= count || 1;
    const s = 1 / (maxY - minY);
    const norm = (part) => ({
      p: part.p.map((v, k) => r4((k % 3 === 0 ? v - bx : k % 3 === 1 ? v - minY : v - bz) * s)),
      n: part.n.map(r4),
      uv: part.uv.map(r4),
      i: part.i,
    });
    return { trunk: norm(trunk), fronds: norm(parts.find((x) => x.leaves)) };
  });
}

const trees = readGlb('trees.glb');
const palmGlb = readGlb('palms.glb');
const flowers = readGlb('flowers.glb');
const imageIndex = (glb, re) => glb.json.images.findIndex((im) => re.test(im.name ?? ''));

const data = {
  attribution: 'Foliage models and textures by Quaternius (quaternius.com), CC0',
  textures: {
    leaf: texture(trees, imageIndex(trees, /Leaves/), 128, 128, 'leaf'),
    palm: texture(palmGlb, imageIndex(palmGlb, /Leaves/), 64, 128, 'rgba'),
    flowers: texture(flowers, imageIndex(flowers, /Flowers/), 128, 128, 'rgba'),
  },
  palms: palms(palmGlb),
};

const text = JSON.stringify(data);
writeFileSync(OUT, text);
const tris = data.palms.map((p) => (p.trunk.i.length + p.fronds.i.length) / 3);
console.log(`palms ${data.palms.length} (${tris.join(', ')} tris) · ${(text.length / 1024).toFixed(0)} KB`);
