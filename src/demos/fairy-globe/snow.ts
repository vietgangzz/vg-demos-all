import * as THREE from 'three/webgpu';

import { sprites } from './fx';

/**
 * The snow in the globe: flakes and glitter suspended in the water, as a few thousand particles
 * stepped on the CPU. The water has a motion of its own (a swirl that turns the whole of it, and
 * eddies), and each bit drifts with it while sinking at its own pace: flakes slowly, glitter
 * faster. They come to rest where they land, on the roofs and the streets and the snow; while it's
 * snowing they lie there only a while and melt into it, and more comes down from high up in the
 * glass. When it stops, what's falling settles, and lies.
 *
 * Shake it and everything lying is thrown up into a swirl that slowly calms; spin it and the water
 * lags behind the glass, so the snow turns the other way; tilt it and the snow drifts to the low
 * side. The sleigh stirs it as it passes.
 *
 * All in the town's metres, in its own frame (it turns with the globe).
 */

export type Ground = (x: number, z: number) => number;

const FLAKE_COLOUR = new THREE.Color('#EEF2FF');
const FLAKE_WARM = new THREE.Color('#FFE4C2');
const GLITTER = ['#FFD873', '#F3F7FF', '#FFB8D2', '#BFE8FF'].map((c) => new THREE.Color(c));

export function createSnow(opts: {
  centre: THREE.Vector3;
  radius: number;
  ground: Ground;
  flakes?: number;
  glitter?: number;
}) {
  const { centre, radius, ground } = opts;
  const nF = opts.flakes ?? 1700;
  const nG = opts.glitter ?? 650;
  const N = nF + nG;
  const px = new Float32Array(N);
  const py = new Float32Array(N);
  const pz = new Float32Array(N);
  const vx = new Float32Array(N);
  const vy = new Float32Array(N);
  const vz = new Float32Array(N);
  const size = new Float32Array(N);
  const sink = new Float32Array(N);
  const drag = new Float32Array(N);
  const seed = new Float32Array(N);
  /** 0 drifting, 1 lying where it landed; how long until it's melted into the snow it lies on; how
   *  long it's been coming down (it fades in, new) */
  const lying = new Uint8Array(N);
  const melt = new Float32Array(N);
  const age = new Float32Array(N);
  let falling = false;
  const tint = Array.from({ length: N }, () => new THREE.Color());

  // The water's own motion: a swirl (rad/s, about an axis through the middle) and eddies (m/s)
  const swirl = new THREE.Vector3();
  let eddies = 3;
  /** Which way is down, in the globe's frame */
  const down = new THREE.Vector3(0, -1, 0);

  const flakeSprites = sprites(nF, false, true);
  const glitterSprites = sprites(nG, false, false);
  flakeSprites.mesh.renderOrder = 9;
  glitterSprites.mesh.renderOrder = 10;

  const scatter = (i: number, inSky = true, high = false) => {
    // Anywhere in the water above the roofs (or high up in it)
    for (let tries = 0; tries < 20; tries++) {
      const x = centre.x + (Math.random() * 2 - 1) * radius;
      const z = centre.z + (Math.random() * 2 - 1) * radius;
      const y = centre.y + (Math.random() * 2 - 1) * radius;
      const dx = x - centre.x;
      const dy = y - centre.y;
      const dz = z - centre.z;
      if (dx * dx + dy * dy + dz * dz > (radius - 6) ** 2) continue;
      if (inSky && y < ground(x, z) + 8) continue;
      if (high && y < centre.y - radius * 0.2) continue;
      px[i] = x;
      py[i] = y;
      pz[i] = z;
      return;
    }
    px[i] = centre.x;
    py[i] = centre.y + radius * 0.5;
    pz[i] = centre.z;
  };

  for (let i = 0; i < N; i++) {
    const glitter = i >= nF;
    size[i] = glitter ? 2.0 + Math.random() * 2.0 : 2.6 + Math.random() * 3.8;
    sink[i] = glitter ? 10 + Math.random() * 6 : 4.5 + Math.random() * 4.5;
    drag[i] = glitter ? 3.2 : 2.0 + Math.random() * 0.6;
    seed[i] = Math.random() * 1000;
    age[i] = 10;
    if (glitter) tint[i].copy(GLITTER[i % GLITTER.length]);
    scatter(i);
  }

  const lift = (i: number, strength: number) => {
    lying[i] = 0;
    vy[i] = (8 + Math.random() * 26) * strength;
    const a = Math.random() * Math.PI * 2;
    const s = (3 + Math.random() * 10) * strength;
    vx[i] = Math.cos(a) * s;
    vz[i] = Math.sin(a) * s;
  };

  /** Shaken: everything lying is thrown up, and the water set swirling and churning */
  const shake = (strength: number, axis?: THREE.Vector3) => {
    const s = Math.min(1.6, Math.max(0.2, strength));
    eddies = Math.max(eddies, 34 * s);
    const ax = axis ?? new THREE.Vector3((Math.random() - 0.5) * 0.6, 1, (Math.random() - 0.5) * 0.6).normalize();
    swirl.addScaledVector(ax, (Math.random() < 0.5 ? -1 : 1) * 0.55 * s);
    for (let i = 0; i < N; i++) {
      if (lying[i]) lift(i, s);
      else {
        vx[i] += (Math.random() - 0.5) * 16 * s;
        vy[i] += Math.random() * 14 * s;
        vz[i] += (Math.random() - 0.5) * 16 * s;
      }
    }
  };

  /** The glass turning by `dw` rad/s more than it was: the water lags, so the snow swirls against it */
  const spun = (dw: number) => {
    swirl.y -= dw * 0.8;
    eddies = Math.max(eddies, Math.abs(dw) * 30);
  };

  /** Which way down is, in the globe's frame (from the phone's tilt): a sudden change sloshes the water */
  const tilt = (g: THREE.Vector3) => {
    const n = g.clone().normalize();
    const change = new THREE.Vector3().crossVectors(down, n);
    if (change.length() > 0.02) swirl.addScaledVector(change, 1.6);
    down.lerp(n, 0.5).normalize();
  };

  /** Something moving through the water (the sleigh): bits near it are pushed along */
  const stir = (at: THREE.Vector3, vel: THREE.Vector3, reach: number) => {
    const r2 = reach * reach;
    for (let i = 0; i < N; i++) {
      const dx = px[i] - at.x;
      const dy = py[i] - at.y;
      const dz = pz[i] - at.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > r2) continue;
      const w = 1 - d2 / r2;
      if (lying[i]) {
        if (w > 0.5) lift(i, 0.35);
        continue;
      }
      vx[i] += vel.x * w * 0.08 + dx * w * 0.6;
      vy[i] += vel.y * w * 0.08 + dy * w * 0.6 + w * 4;
      vz[i] += vel.z * w * 0.08 + dz * w * 0.6;
    }
  };

  const R_IN = radius - 3;
  const update = (t: number, dt: number) => {
    if (dt <= 0) return;
    swirl.multiplyScalar(Math.exp(-dt / 2.8));
    eddies = Math.max(2.2, eddies * Math.exp(-dt / 3.2));
    const calm = eddies < 9;
    for (let i = 0; i < N; i++) {
      age[i] += dt;
      if (lying[i]) {
        // Snowing: melted into the snow it's lying on, and down again from high up in the glass
        if (!falling) continue;
        melt[i] -= dt;
        if (melt[i] <= 0) {
          lying[i] = 0;
          scatter(i, true, true);
          vx[i] = vy[i] = vz[i] = 0;
          age[i] = 0;
        }
        continue;
      }
      const x = px[i];
      const y = py[i];
      const z = pz[i];
      const rx = x - centre.x;
      const ry = y - centre.y;
      const rz = z - centre.z;
      // The water here: the swirl turning it, eddies churning it
      let fx = swirl.y * rz - swirl.z * ry;
      let fy = swirl.z * rx - swirl.x * rz;
      let fz = swirl.x * ry - swirl.y * rx;
      const s = seed[i];
      fx += eddies * (Math.sin(y * 0.031 + t * 1.1 + 1.3) + 0.6 * Math.sin(z * 0.057 - t * 0.8 + s * 0.01));
      fy += eddies * 0.7 * (Math.sin(z * 0.029 + t * 0.9 + 2.1) + 0.6 * Math.sin(x * 0.061 + t * 1.3));
      fz += eddies * (Math.sin(x * 0.033 - t + 0.4) + 0.6 * Math.sin(y * 0.053 - t * 0.7 + 3));
      // Sinking through it
      fx += down.x * sink[i];
      fy += down.y * sink[i];
      fz += down.z * sink[i];
      const k = Math.min(1, dt * drag[i]);
      vx[i] += (fx - vx[i]) * k;
      vy[i] += (fy - vy[i]) * k;
      vz[i] += (fz - vz[i]) * k;
      let nx = x + vx[i] * dt;
      let ny = y + vy[i] * dt;
      let nz = z + vz[i] * dt;
      // The glass: slide along it
      const dx = nx - centre.x;
      const dy = ny - centre.y;
      const dz = nz - centre.z;
      const L = Math.hypot(dx, dy, dz);
      const lim = R_IN - size[i] * 0.5;
      if (L > lim) {
        const ux = dx / L;
        const uy = dy / L;
        const uz = dz / L;
        nx = centre.x + ux * lim;
        ny = centre.y + uy * lim;
        nz = centre.z + uz * lim;
        const vn = vx[i] * ux + vy[i] * uy + vz[i] * uz;
        if (vn > 0) {
          vx[i] -= ux * vn * 1.2;
          vy[i] -= uy * vn * 1.2;
          vz[i] -= uz * vn * 1.2;
        }
      }
      // The ground, the roofs, the snow: settle on them once the water's calm enough
      const h = ground(nx, nz);
      if (ny < h + 0.45) {
        if (calm && vy[i] < 2) {
          lying[i] = 1;
          melt[i] = i < nF ? 2 + Math.random() * 6 : 1.5 + Math.random() * 3;
          ny = h + 0.4;
          vx[i] = vy[i] = vz[i] = 0;
        } else {
          ny = h + 0.45;
          vy[i] = Math.abs(vy[i]) * 0.35;
        }
      }
      px[i] = nx;
      py[i] = ny;
      pz[i] = nz;
    }
  };

  const at = new THREE.Vector3();
  const col = new THREE.Color();
  /**
   * Into the sprites. `cam` (in the globe's frame) to fade out the bits right in front of the lens,
   * which would be blots: inside the globe they're each the size of a room
   */
  const draw = (t: number, cam: THREE.Vector3, near: number) => {
    for (let i = 0; i < nF; i++) {
      at.set(px[i], py[i], pz[i]);
      const d = at.distanceTo(cam);
      const fade = (near > 0 ? THREE.MathUtils.smoothstep(d, near, near * 2.2) : 1) * Math.min(1, age[i] / 0.8);
      if (fade <= 0.01) {
        flakeSprites.hide(i);
        continue;
      }
      // Lit warm by the town low down, cool up high
      const warm = THREE.MathUtils.clamp(1 - (py[i] - 5) / 70, 0, 1) * 0.55;
      col.copy(FLAKE_COLOUR).lerp(FLAKE_WARM, warm);
      const s = lying[i] ? size[i] * 0.75 : size[i];
      flakeSprites.set(i, at, s, col, (lying[i] ? 0.8 * Math.min(1, melt[i] / 0.6) : 0.92) * fade, seed[i]);
    }
    for (let j = 0; j < nG; j++) {
      const i = nF + j;
      at.set(px[i], py[i], pz[i]);
      const d = at.distanceTo(cam);
      const fade = (near > 0 ? THREE.MathUtils.smoothstep(d, near, near * 2.2) : 1) * Math.min(1, age[i] / 0.8);
      if (fade <= 0.01) {
        glitterSprites.hide(j);
        continue;
      }
      // Tumbling flat flakes of foil: dark edge-on, flashing as a face turns to the light
      const turn = Math.sin(seed[i] + t * (lying[i] ? 0.6 : 3.2 + (seed[i] % 3)));
      const flash = Math.pow(Math.max(0, turn), 14) * 2.6 + 0.16;
      col.copy(tint[i]).multiplyScalar(flash * fade * (lying[i] ? Math.min(1, melt[i] / 0.6) : 1));
      glitterSprites.set(j, at, size[i] * (0.8 + flash * 0.25), col, 1, seed[i] + t);
    }
    flakeSprites.flush();
    glitterSprites.flush();
  };

  /** Whether it's snowing. Starting, what's lying starts melting away into new snow coming down,
   *  a little at a time over the first few seconds */
  const snowing = (on: boolean) => {
    if (on && !falling) for (let i = 0; i < N; i++) if (lying[i]) melt[i] = Math.random() * 4;
    falling = on;
  };

  /** How much is still drifting, 0 to 1 */
  const drifting = () => {
    let n = 0;
    for (let i = 0; i < N; i++) if (!lying[i]) n++;
    return n / N;
  };

  return {
    meshes: [flakeSprites.mesh, glitterSprites.mesh],
    update,
    draw,
    shake,
    spun,
    tilt,
    stir,
    drifting,
    snowing,
    /** The swirl and the eddies, for what's moving with the water */
    water: () => ({ swirl: swirl.clone(), eddies }),
  };
}

export type Snow = ReturnType<typeof createSnow>;

/**
 * Where snow can lie, as a height for any point across the town (metres): the highest of every
 * surface over it, read off the town's baked shapes once into a grid
 */
export function groundFrom(
  meshes: THREE.Mesh[],
  bounds: { x0: number; z0: number; x1: number; z1: number },
  cell = 1.5,
  floor: Ground = () => 0
) {
  const W = Math.ceil((bounds.x1 - bounds.x0) / cell);
  const H = Math.ceil((bounds.z1 - bounds.z0) / cell);
  const grid = new Float32Array(W * H).fill(-1e9);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (const mesh of meshes) {
    const geo = mesh.geometry;
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const index = geo.getIndex();
    const arr = pos.array as Float32Array;
    const idx = index ? (index.array as ArrayLike<number>) : null;
    const count = idx ? idx.length : pos.count;
    for (let t = 0; t < count; t += 3) {
      const i0 = idx ? idx[t] : t;
      const i1 = idx ? idx[t + 1] : t + 1;
      const i2 = idx ? idx[t + 2] : t + 2;
      a.set(arr[i0 * 3], arr[i0 * 3 + 1], arr[i0 * 3 + 2]);
      b.set(arr[i1 * 3], arr[i1 * 3 + 1], arr[i1 * 3 + 2]);
      c.set(arr[i2 * 3], arr[i2 * 3 + 1], arr[i2 * 3 + 2]);
      // Walls (seen edge-on from above) carry nothing: only what faces up
      const ux = b.x - a.x;
      const uz = b.z - a.z;
      const wx = c.x - a.x;
      const wz = c.z - a.z;
      const area = ux * wz - uz * wx;
      if (Math.abs(area) < 1e-6) continue;
      const minX = Math.max(0, Math.floor((Math.min(a.x, b.x, c.x) - bounds.x0) / cell));
      const maxX = Math.min(W - 1, Math.floor((Math.max(a.x, b.x, c.x) - bounds.x0) / cell));
      const minZ = Math.max(0, Math.floor((Math.min(a.z, b.z, c.z) - bounds.z0) / cell));
      const maxZ = Math.min(H - 1, Math.floor((Math.max(a.z, b.z, c.z) - bounds.z0) / cell));
      for (let gz = minZ; gz <= maxZ; gz++) {
        const z = bounds.z0 + (gz + 0.5) * cell;
        for (let gx = minX; gx <= maxX; gx++) {
          const x = bounds.x0 + (gx + 0.5) * cell;
          // Barycentric: is the cell's middle in it, and how high is it there?
          const px = x - a.x;
          const pz = z - a.z;
          const v = (px * wz - pz * wx) / area;
          const w = (ux * pz - uz * px) / area;
          if (v < -0.02 || w < -0.02 || v + w > 1.02) continue;
          const y = a.y + (b.y - a.y) * v + (c.y - a.y) * w;
          const k = gz * W + gx;
          if (y > grid[k]) grid[k] = y;
        }
      }
    }
  }
  return (x: number, z: number) => {
    const gx = Math.floor((x - bounds.x0) / cell);
    const gz = Math.floor((z - bounds.z0) / cell);
    const f = floor(x, z);
    if (gx < 0 || gz < 0 || gx >= W || gz >= H) return f;
    return Math.max(grid[gz * W + gx], f);
  };
}
