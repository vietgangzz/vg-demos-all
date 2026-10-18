import * as THREE from 'three/webgpu';

/**
 * The liquid's surface. Two parts, the way a real one moves:
 *
 * - its tilt: the surface stays level with the world while the phone turns round it, so against
 *   the glass it leans the other way; it gets there as a damped swing (the first slosh mode, a bit
 *   over once a second for a glass this size), and a shove of the phone sets it swinging too
 * - ripples on top: a small wave equation over the surface's disc, rung by bubbles popping,
 *   the inflow welling up under it, taps on the glass. Handed to the GPU as a height texture
 *   that both the surface and the liquid's edge against the glass read.
 */

const N = 40;
/** Fixed steps for the waves, so they're stable at any frame rate */
const STEP = 1 / 120;
/** How far the surface may lean from flat, against the glass */
const MAX_SLOPE = Math.tan((38 * Math.PI) / 180);
/** The swing: about 1.1 Hz, a few visible sways before it settles */
const OMEGA = 2 * Math.PI * 1.1;
const DAMPING = 2 * 0.13 * OMEGA;

export class Slosh {
  /** Surface slope across (x) and front to back (z): y = level + sx * x + sz * z */
  sx = 0;
  sz = 0;
  private vx = 0;
  private vz = 0;
  private targetX = 0;
  private targetZ = 0;
  private h = new Float32Array(N * N);
  private prev = new Float32Array(N * N);
  private next = new Float32Array(N * N);
  private mask = new Uint8Array(N * N);
  private data = new Uint16Array(N * N);
  private acc = 0;
  readonly texture: THREE.DataTexture;
  /** Half the width the ripple map covers, centred on the axis */
  readonly extent: number;

  constructor(radius: number) {
    this.extent = radius;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const x = ((i + 0.5) / N) * 2 - 1;
        const z = ((j + 0.5) / N) * 2 - 1;
        this.mask[j * N + i] = x * x + z * z < 0.98 ? 1 : 0;
      }
    }
    this.texture = new THREE.DataTexture(this.data, N, N, THREE.RedFormat, THREE.HalfFloatType);
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.wrapS = this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.needsUpdate = true;
  }

  /**
   * Where the surface wants to be, from gravity in the phone's frame (in g, the accelerometer's
   * reading: x right, y up the screen, z out of it). Turned sideways it leans all the way; held
   * back at a reading angle it barely leans front to back, or the surface would tip up at you.
   */
  aim(gx: number, gy: number, gz: number) {
    const inPlane = Math.hypot(gx, gy);
    const trust = THREE.MathUtils.smoothstep(inPlane, 0.15, 0.45);
    const roll = Math.atan2(gx, -gy);
    this.targetX = THREE.MathUtils.clamp(Math.tan(THREE.MathUtils.clamp(roll, -1.2, 1.2)), -MAX_SLOPE, MAX_SLOPE) * trust;
    this.targetZ = THREE.MathUtils.clamp(-gz * 0.12, -0.12, 0.12) * trust;
  }

  /** A shove: the phone (or a finger) moving sideways at this many g; the liquid lags behind it */
  shove(ax: number, az = 0) {
    this.vx -= ax * 9.81 * 0.5;
    this.vz -= az * 9.81 * 0.3;
  }

  /** Ripples: push the surface down (or up, negative) around (x, z), in the disc's units */
  splash(x: number, z: number, amount: number, spread = 0.12) {
    const r = this.extent;
    const ci = ((x / r) * 0.5 + 0.5) * N - 0.5;
    const cj = ((z / r) * 0.5 + 0.5) * N - 0.5;
    const s = (spread / r) * N * 0.5;
    const reach = Math.ceil(s * 2.5);
    for (let j = Math.max(0, Math.floor(cj - reach)); j <= Math.min(N - 1, Math.ceil(cj + reach)); j++) {
      for (let i = Math.max(0, Math.floor(ci - reach)); i <= Math.min(N - 1, Math.ceil(ci + reach)); i++) {
        const k = j * N + i;
        if (!this.mask[k]) continue;
        const d2 = ((i - ci) ** 2 + (j - cj) ** 2) / (s * s);
        this.h[k] -= amount * Math.exp(-d2);
      }
    }
  }

  /** The ripples' height at (x, z) (nearest cell is plenty for a bubble) */
  ripple(x: number, z: number) {
    const r = this.extent;
    const i = Math.round(((x / r) * 0.5 + 0.5) * N - 0.5);
    const j = Math.round(((z / r) * 0.5 + 0.5) * N - 0.5);
    if (i < 0 || j < 0 || i >= N || j >= N) return 0;
    return this.h[j * N + i];
  }

  /** How hard it's moving: for the light catching the surface */
  get energy() {
    return Math.min(1, Math.abs(this.vx) * 0.25 + Math.abs(this.sx - this.targetX) * 1.5);
  }

  step(dt: number) {
    // The swing toward level
    const ax = -OMEGA * OMEGA * (this.sx - this.targetX) - DAMPING * this.vx;
    const az = -OMEGA * OMEGA * (this.sz - this.targetZ) - DAMPING * this.vz;
    this.vx += ax * dt;
    this.vz += az * dt;
    this.sx = THREE.MathUtils.clamp(this.sx + this.vx * dt, -MAX_SLOPE, MAX_SLOPE);
    this.sz = THREE.MathUtils.clamp(this.sz + this.vz * dt, -0.4, 0.4);
    // The ripples, in fixed steps
    this.acc = Math.min(this.acc + dt, STEP * 6);
    const c2 = 0.34;
    while (this.acc >= STEP) {
      this.acc -= STEP;
      const { h, prev, next, mask } = this;
      for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
          const k = j * N + i;
          if (!mask[k]) {
            next[k] = 0;
            continue;
          }
          // The glass is a wall: a cell next to it sees its own height there (waves bounce back)
          const l = i > 0 && mask[k - 1] ? h[k - 1] : h[k];
          const r = i < N - 1 && mask[k + 1] ? h[k + 1] : h[k];
          const d = j > 0 && mask[k - N] ? h[k - N] : h[k];
          const u = j < N - 1 && mask[k + N] ? h[k + N] : h[k];
          next[k] = (2 * h[k] - prev[k] + c2 * (l + r + d + u - 4 * h[k])) * 0.992;
        }
      }
      this.prev = h;
      this.h = next;
      this.next = prev;
    }
    for (let k = 0; k < N * N; k++) this.data[k] = THREE.DataUtils.toHalfFloat(this.h[k]);
    this.texture.needsUpdate = true;
  }
}
