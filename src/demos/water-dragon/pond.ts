import * as THREE from 'three/webgpu';

/**
 * The pond in front of the stage: a wave equation over the part of it the dragon swims in, rung
 * by everything that breaks the surface (the dragon's coils going in and out, its wake, every
 * drop that falls back), and the foam that's left where it's churned. Handed to the GPU as a
 * height (red) and foam (green) texture that the water's surface reads.
 *
 * Metres, the water at y = 0. Outside the patch the water's still (only the breeze's ripples).
 */

export const POND = { x0: -8, z0: -12.5, w: 16, d: 19 };
const NX = 128;
const NZ = 152;
const DX = POND.w / NX;
/** One step a frame at 60 fps; waves run out at about 1.9 m/s */
const STEP = 1 / 60;
const C2 = 0.07;
/** Cells along the edge that soak the waves up, so nothing bounces back off the patch's edge */
const SPONGE = 10;
/** Foam fades over a couple of seconds */
const FOAM_LIFE = 2.4;

export class Pond {
  private h = new Float32Array(NX * NZ);
  private prev = new Float32Array(NX * NZ);
  private next = new Float32Array(NX * NZ);
  private foam = new Float32Array(NX * NZ);
  private damp = new Float32Array(NX * NZ);
  private data = new Uint16Array(NX * NZ * 2);
  private acc = 0;
  readonly texture: THREE.DataTexture;

  constructor() {
    for (let j = 0; j < NZ; j++) {
      for (let i = 0; i < NX; i++) {
        const e = Math.min(i, j, NX - 1 - i, NZ - 1 - j);
        const k = Math.min(1, e / SPONGE);
        this.damp[j * NX + i] = 0.9965 * (0.86 + 0.14 * k * k * (3 - 2 * k));
      }
    }
    this.texture = new THREE.DataTexture(this.data, NX, NZ, THREE.RGFormat, THREE.HalfFloatType);
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.wrapS = this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.needsUpdate = true;
  }

  private each(x: number, z: number, radius: number, fn: (k: number, w: number) => void) {
    const ci = (x - POND.x0) / DX - 0.5;
    const cj = (z - POND.z0) / DX - 0.5;
    const s = Math.max(0.6, radius / DX);
    const reach = Math.ceil(s * 2.2);
    const i0 = Math.max(1, Math.floor(ci - reach));
    const i1 = Math.min(NX - 2, Math.ceil(ci + reach));
    const j0 = Math.max(1, Math.floor(cj - reach));
    const j1 = Math.min(NZ - 2, Math.ceil(cj + reach));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const d2 = ((i - ci) ** 2 + (j - cj) ** 2) / (s * s);
        if (d2 < 5) fn(j * NX + i, Math.exp(-d2));
      }
    }
  }

  /** Push the water down (or up, negative) around (x, z), by `amount` metres at the middle */
  disturb(x: number, z: number, amount: number, radius = 0.2) {
    this.each(x, z, radius, (k, w) => {
      this.h[k] -= amount * w;
    });
  }

  /** Churn it white around (x, z) */
  froth(x: number, z: number, amount: number, radius = 0.25) {
    this.each(x, z, radius, (k, w) => {
      this.foam[k] = Math.min(1.4, this.foam[k] + amount * w);
    });
  }

  private cell(x: number, z: number) {
    const fi = (x - POND.x0) / DX - 0.5;
    const fj = (z - POND.z0) / DX - 0.5;
    if (fi < 0 || fj < 0 || fi >= NX - 1 || fj >= NZ - 1) return -1;
    return Math.floor(fj) * NX + Math.floor(fi);
  }

  /** The water's height at (x, z) */
  heightAt(x: number, z: number) {
    const fi = (x - POND.x0) / DX - 0.5;
    const fj = (z - POND.z0) / DX - 0.5;
    if (fi < 0 || fj < 0 || fi >= NX - 1 || fj >= NZ - 1) return 0;
    const i = Math.floor(fi);
    const j = Math.floor(fj);
    const u = fi - i;
    const v = fj - j;
    const k = j * NX + i;
    const h = this.h;
    return (h[k] * (1 - u) + h[k + 1] * u) * (1 - v) + (h[k + NX] * (1 - u) + h[k + NX + 1] * u) * v;
  }

  /** Its slope at (x, z): which way, and how steeply, the water runs downhill there */
  slopeAt(x: number, z: number, out: { x: number; z: number }) {
    const k = this.cell(x, z);
    if (k < 0) {
      out.x = 0;
      out.z = 0;
      return out;
    }
    const h = this.h;
    out.x = (h[k + 1] - h[k]) / DX;
    out.z = (h[k + NX] - h[k]) / DX;
    return out;
  }

  step(dt: number) {
    this.acc = Math.min(this.acc + dt, STEP * 3);
    const fade = Math.exp(-dt / FOAM_LIFE);
    for (let k = 0; k < NX * NZ; k++) this.foam[k] *= fade;
    while (this.acc >= STEP) {
      this.acc -= STEP;
      const { h, prev, next, damp } = this;
      for (let j = 1; j < NZ - 1; j++) {
        let k = j * NX + 1;
        for (let i = 1; i < NX - 1; i++, k++) {
          const lap = h[k - 1] + h[k + 1] + h[k - NX] + h[k + NX] - 4 * h[k];
          next[k] = (2 * h[k] - prev[k] + C2 * lap) * damp[k];
        }
      }
      this.prev = h;
      this.h = next;
      this.next = prev;
    }
    const { h, foam, data } = this;
    const half = THREE.DataUtils.toHalfFloat;
    for (let k = 0, o = 0; k < NX * NZ; k++, o += 2) {
      data[o] = half(h[k]);
      data[o + 1] = half(foam[k] > 1 ? 1 : foam[k]);
    }
    this.texture.needsUpdate = true;
  }
}
