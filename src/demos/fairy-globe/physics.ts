import * as THREE from 'three/webgpu';

/**
 * Just enough rigid-body motion for a present: gravity, a floor to land on, bounce and friction,
 * spin that dies away, and settling flat when it comes to rest.
 */

export class Body {
  p = new THREE.Vector3();
  v = new THREE.Vector3();
  q = new THREE.Quaternion();
  /** Angular velocity, radians a second about each axis */
  w = new THREE.Vector3();
  resting = false;
  private dq = new THREE.Quaternion();
  private axis = new THREE.Vector3();
  private flat = new THREE.Quaternion();
  private euler = new THREE.Euler();

  constructor(
    /** Half the body's height: how far its centre sits above the floor when it lies on it */
    public half: number,
    public restitution = 0.32,
    public friction = 0.55
  ) {}

  /** Launch from a to land at b after `time` seconds, under gravity g (a ballistic arc) */
  throwTo(a: THREE.Vector3, b: THREE.Vector3, time: number, g: number) {
    this.p.copy(a);
    this.v.subVectors(b, a).divideScalar(time);
    this.v.y += 0.5 * g * time;
    this.resting = false;
  }

  step(dt: number, g: number, floor: number | null) {
    if (this.resting) return;
    this.v.y -= g * dt;
    this.p.addScaledVector(this.v, dt);
    const spin = this.w.length();
    if (spin > 1e-5) {
      this.axis.copy(this.w).divideScalar(spin);
      this.dq.setFromAxisAngle(this.axis, spin * dt);
      this.q.premultiply(this.dq).normalize();
    }
    if (floor === null || this.p.y - this.half > floor) return;
    // On the floor: bounce some of the fall back, lose some of the slide, settle the tumble
    this.p.y = floor + this.half;
    if (this.v.y < 0) this.v.y = -this.v.y * this.restitution;
    this.v.x *= 1 - this.friction;
    this.v.z *= 1 - this.friction;
    this.w.multiplyScalar(0.55);
    // Ease toward lying flat on whichever way it's turned
    this.euler.setFromQuaternion(this.q, 'YXZ');
    this.flat.setFromEuler(this.euler.set(0, this.euler.y, 0, 'YXZ'));
    this.q.slerp(this.flat, 0.35);
    if (this.v.lengthSq() < 0.01 && Math.abs(this.v.y) < 0.15) {
      this.v.set(0, 0, 0);
      this.w.set(0, 0, 0);
      this.q.copy(this.flat);
      this.resting = true;
    }
  }
}

/** A damped spring, for landings and recoils: x is the offset, it pulls back to 0 */
export class Spring {
  x = 0;
  v = 0;
  constructor(
    public k = 160,
    public c = 12
  ) {}
  kick(velocity: number) {
    this.v += velocity;
  }
  step(dt: number) {
    // A few small steps keep a stiff spring stable at 60 Hz
    const n = 4;
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      const a = -this.k * this.x - this.c * this.v;
      this.v += a * h;
      this.x += this.v * h;
    }
    return this.x;
  }
}
