import * as THREE from 'three/webgpu';

/**
 * Curves to move things along in time, smooth all the way: no corners in where a thing is, and
 * none in how fast it's going either.
 */

export const smooth = (a: number, b: number, x: number) => {
  const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
};

/** Smoother still: no kick in the acceleration at either end */
export const smoother = (a: number, b: number, x: number) => {
  const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return k * k * k * (k * (k * 6 - 15) + 10);
};

export type Key = { t: number; p: THREE.Vector3; v?: THREE.Vector3 };

/**
 * Through points at given times, each with a velocity (from its neighbours where it isn't given,
 * still at the ends): a cubic between each pair, so position and speed both run on smoothly.
 * Before the first key it waits at it; after the last it carries on at the last velocity.
 */
export class TimeSpline {
  keys: Required<Key>[];
  constructor(keys: Key[]) {
    this.keys = keys.map((k, i) => {
      if (k.v) return { t: k.t, p: k.p.clone(), v: k.v.clone() };
      if (i === 0 || i === keys.length - 1) return { t: k.t, p: k.p.clone(), v: new THREE.Vector3() };
      const a = keys[i - 1];
      const b = keys[i + 1];
      return { t: k.t, p: k.p.clone(), v: b.p.clone().sub(a.p).divideScalar(b.t - a.t) };
    });
  }
  get start() {
    return this.keys[0].t;
  }
  get end() {
    return this.keys[this.keys.length - 1].t;
  }
  at(t: number, out: THREE.Vector3) {
    const ks = this.keys;
    if (t <= ks[0].t) return out.copy(ks[0].p);
    const last = ks[ks.length - 1];
    if (t >= last.t) return out.copy(last.p).addScaledVector(last.v, t - last.t);
    let i = 0;
    while (i < ks.length - 2 && t > ks[i + 1].t) i++;
    const a = ks[i];
    const b = ks[i + 1];
    const h = b.t - a.t;
    const u = (t - a.t) / h;
    const u2 = u * u;
    const u3 = u2 * u;
    return out
      .copy(a.p)
      .multiplyScalar(2 * u3 - 3 * u2 + 1)
      .addScaledVector(a.v, h * (u3 - 2 * u2 + u))
      .addScaledVector(b.p, -2 * u3 + 3 * u2)
      .addScaledVector(b.v, h * (u3 - u2));
  }
}

/**
 * A path through points, travelled at a speed that changes smoothly from point to point (given
 * at each). Time to position, by a table built once.
 */
export class PacedCurve {
  curve: THREE.CatmullRomCurve3;
  private ts: number[] = [];
  private us: number[] = [];
  duration: number;
  constructor(
    points: THREE.Vector3[],
    public speeds: number[],
    samples = 2000
  ) {
    this.curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
    this.curve.arcLengthDivisions = samples;
    const n = samples;
    let t = 0;
    let prev = this.curve.getPoint(0);
    const p = new THREE.Vector3();
    this.ts.push(0);
    this.us.push(0);
    for (let i = 1; i <= n; i++) {
      const u = i / n;
      this.curve.getPoint(u, p);
      const ds = p.distanceTo(prev);
      const v = this.speedAt((i - 0.5) / n) + 1e-6;
      t += ds / v;
      this.ts.push(t);
      this.us.push(u);
      prev = p.clone();
    }
    this.duration = t;
  }
  /** Speed at curve parameter u: smooth between the points' speeds */
  speedAt(u: number) {
    const n = this.speeds.length - 1;
    const x = Math.min(n, Math.max(0, u * n));
    const i = Math.min(n - 1, Math.floor(x));
    const f = x - i;
    const e = f * f * (3 - 2 * f);
    return this.speeds[i] + (this.speeds[i + 1] - this.speeds[i]) * e;
  }
  /** Curve parameter at time t along it */
  uAt(t: number) {
    if (t <= 0) return 0;
    if (t >= this.duration) return 1;
    let lo = 0;
    let hi = this.ts.length - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (this.ts[m] < t) lo = m;
      else hi = m;
    }
    const f = (t - this.ts[lo]) / (this.ts[hi] - this.ts[lo]);
    return this.us[lo] + (this.us[hi] - this.us[lo]) * f;
  }
  at(t: number, out: THREE.Vector3) {
    if (t > this.duration) {
      // On past the end, straight on at the end's speed
      this.curve.getPoint(1, out);
      const tan = this.curve.getTangent(1);
      return out.addScaledVector(tan, (t - this.duration) * this.speeds[this.speeds.length - 1]);
    }
    return this.curve.getPoint(this.uAt(t), out);
  }
}

/**
 * Following a moving target the way a hand-held camera does: it moves with the target (no lag
 * while it glides along), and a critically damped spring soaks up any sudden change in it
 */
export class Follow {
  x = new THREE.Vector3();
  v = new THREE.Vector3();
  private a = new THREE.Vector3();
  private last = new THREE.Vector3();
  private move = new THREE.Vector3();
  private started = false;
  constructor(public omega = 6) {}
  reset(to: THREE.Vector3) {
    this.x.copy(to);
    this.last.copy(to);
    this.v.set(0, 0, 0);
    this.started = true;
  }
  step(target: THREE.Vector3, dt: number) {
    if (!this.started || dt <= 0) {
      this.reset(target);
      return this.x;
    }
    // Carried along with the target, then the spring takes up what's left
    this.move.subVectors(target, this.last);
    this.last.copy(target);
    // A big jump isn't carried: that's what the spring is for
    if (this.move.length() < 4 * dt * 60) this.x.add(this.move);
    const n = 3;
    const h = dt / n;
    const w = this.omega;
    for (let i = 0; i < n; i++) {
      this.a.subVectors(target, this.x).multiplyScalar(w * w).addScaledVector(this.v, -2 * w);
      this.v.addScaledVector(this.a, h);
      this.x.addScaledVector(this.v, h);
    }
    return this.x;
  }
}
