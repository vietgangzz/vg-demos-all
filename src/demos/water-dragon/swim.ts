import * as THREE from 'three/webgpu';

/**
 * How a water puppet swims: its head out of the water, going where it's steered (a finger, or left
 * to itself), and its body after it along the very way the head went. A dragon's body coils in and
 * out of the water, the coils fixed to the water rather than the body, so each part rises and dives
 * at the same spots as the one in front of it did; a snake's swings from side to side along the
 * surface.
 *
 * Tricks: a leap (out along an arc the whole body follows, and back in), rearing up to spray water
 * from the mouth, a strike (drawn back, then a lunge), and being knocked back and dunked when hit.
 *
 * The body is a chain of balls, each with its own weight: drawn along that path, each held its
 * length from the one in front, carrying on a little when it's pushed. Two puppets (or a puppet and
 * its own coils) bump off each other rather than pass through; the head, held on its pole, gives
 * less than the body does.
 *
 * Metres, seconds; the water at y = 0. Heading 0 is toward the audience (+z).
 */

export type Kind = {
  segments: number;
  /** From one body segment's middle to the next */
  spacing: number;
  /** From the head's pivot back to the first segment */
  neck: number;
  /** A segment's radius, from the neck (0) to the tail (1) */
  girth: (u: number) => number;
  /** The up-and-down coils: wavelength along the way swum, and how far they go up and down */
  lambda: number;
  coil: number;
  /** The side-to-side swing, a snake's: wavelength and how far */
  swayLambda: number;
  sway: number;
  /** The head's height, swimming */
  ride: number;
  minSpeed: number;
  maxSpeed: number;
  /** Tightest turn, metres */
  turnR: number;
  /** How hard it leaps */
  spring: number;
  /** The head's size, for bumping into things */
  headR: number;
};

export const DRAGON: Kind = {
  segments: 14,
  spacing: 0.33,
  neck: 0.52,
  girth: (u) => 0.2 * (0.86 + 0.3 * Math.sin(Math.PI * Math.min(1, u * 1.6 + 0.12))) * (1 - 0.6 * u ** 1.5),
  lambda: 2.3,
  coil: 0.46,
  swayLambda: 3,
  sway: 0,
  ride: 0.34,
  minSpeed: 0.75,
  maxSpeed: 4.4,
  turnR: 0.5,
  spring: 5.4,
  headR: 0.3,
};

export const SNAKE: Kind = {
  segments: 24,
  spacing: 0.21,
  neck: 0.3,
  girth: (u) => 0.11 * (0.9 + 0.25 * Math.sin(Math.PI * Math.min(1, u * 1.3 + 0.15))) * (1 - 0.82 * u ** 2.2),
  lambda: 2.8,
  coil: 0.08,
  swayLambda: 1.5,
  sway: 0.26,
  ride: 0.3,
  minSpeed: 0.7,
  maxSpeed: 4.0,
  turnR: 0.35,
  spring: 4.4,
  headR: 0.2,
};

/** Where they may go: the stage's curtain behind, the front of the pond, and how wide (wider far off) */
export const BOUNDS = { zBack: -5.8, zFront: -0.6 };
/** Kept inside what the audience can see: about three quarters of the way out to either side */
export const xLimit = (z: number) => Math.min(4.6, 0.5 * (5 - z));

/** Something going in or out of the water */
export type Crossing = { x: number; z: number; vy: number; speed: number; down: boolean; size: number };

type TrailPoint = { s: number; x: number; y: number; z: number; amp: number };

const GRAVITY = 12.5;
const smooth = (a: number, b: number, x: number) => {
  const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
};
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export class Puppet {
  x: number;
  z: number;
  heading: number;
  speed = 0.9;
  private turn = 0;
  /** How far it's swum altogether */
  private s = 0;
  t = 0;
  readonly target = new THREE.Vector2();
  /** Last steered by a finger at */
  touched = -100;
  /** The head's height on top of riding the water: leaps, rearing, coming up at the start, dunked */
  private lift = -1.2;
  private liftV = 0;
  private airborne = false;
  private rearAt = -1;
  private strikeAt = -1;
  private strikeTo = new THREE.Vector2();
  /** Knocked: pushed along, and dazed for a moment */
  private kx = 0;
  private kz = 0;
  private dazedUntil = -1;
  private trail: TrailPoint[] = [];
  /** Worked by hand, the way the puppeteer's cords do: the head held up, the pump squeezed, the
   *  pole pressed down under the water (let go, it comes up out of it in a leap) */
  private raised = false;
  private pumping = false;
  private diving = false;
  private diveFrom = 0;

  /** The head: where, which way it faces, its jaw open (rad) */
  readonly head = { pos: new THREE.Vector3(), forward: new THREE.Vector3(0, 0, 1), quat: new THREE.Quaternion(), jaw: 0 };
  readonly body: { pos: THREE.Vector3; quat: THREE.Quaternion; r: number; wet: number; vy: number; was: number }[];
  /** What went in or out of the water in the last step */
  readonly crossings: Crossing[] = [];
  /** Spraying: from where, which way */
  readonly spout = { on: false, at: new THREE.Vector3(), dir: new THREE.Vector3() };

  private prevHeadY = -1;
  /** Where each part of the body would be, along the path: the chain's drawn toward these */
  private points: THREE.Vector3[];
  /** Where each body segment was a step ago, for how it's moving */
  private prev: THREE.Vector3[];
  private tmp = new THREE.Vector3();
  private settled = false;
  private m = new THREE.Matrix4();
  private f = new THREE.Vector3();
  private u = new THREE.Vector3();
  private rt = new THREE.Vector3();
  private q = new THREE.Quaternion();

  constructor(
    readonly kind: Kind,
    start: { x: number; z: number; heading: number },
    /** When it comes up out of the water at the start, s */
    readonly surfaceAt: number
  ) {
    this.x = start.x;
    this.z = start.z;
    this.heading = start.heading;
    this.target.set(start.x + Math.sin(start.heading) * 6, start.z + Math.cos(start.heading) * 6);
    this.body = Array.from({ length: kind.segments }, (_, i) => ({
      pos: new THREE.Vector3(),
      quat: new THREE.Quaternion(),
      r: kind.girth(i / (kind.segments - 1)),
      /** How wet it is: 1 just out of the water, drying off */
      wet: 0,
      vy: 0,
      /** Its height over the water last step */
      was: -1,
    }));
    this.points = Array.from({ length: kind.segments + 2 }, () => new THREE.Vector3());
    this.prev = Array.from({ length: kind.segments }, () => new THREE.Vector3());
    // It starts out of sight, down under the water behind the curtain, its body trailing back
    const len = kind.neck + kind.spacing * kind.segments + 1.5;
    for (let d = len; d >= 0; d -= 0.06) {
      this.trail.push({
        s: -d,
        x: this.x - Math.sin(this.heading) * d,
        y: -1.3,
        z: this.z - Math.cos(this.heading) * d,
        amp: 0.4,
      });
    }
    this.place(0, 1 / 60);
    this.finish(1 / 60, () => 0);
  }

  /** Steer it toward (x, z) on the water; `finger`: by hand (it stops looking after itself a while) */
  steer(x: number, z: number, finger = true) {
    const zc = THREE.MathUtils.clamp(z, BOUNDS.zBack, BOUNDS.zFront);
    const lim = xLimit(zc);
    this.target.set(THREE.MathUtils.clamp(x, -lim, lim), zc);
    if (finger) this.touched = this.t;
  }

  get up() {
    return this.t > this.surfaceAt;
  }

  get inAir() {
    return this.airborne;
  }

  get busy() {
    return this.airborne || this.rearAt >= 0 || this.strikeAt >= 0 || this.t < this.dazedUntil || !this.up;
  }

  get striking() {
    return this.strikeAt >= 0 && this.t - this.strikeAt > 0.22 && this.t - this.strikeAt < 0.6;
  }

  get rearing() {
    return this.rearAt >= 0;
  }

  /** Out of the water and back in along an arc; `power` 0.6 to 1.3 */
  leap(power = 1) {
    if (this.busy || this.lift < -0.45) return false;
    this.airborne = true;
    this.liftV = this.kind.spring * THREE.MathUtils.clamp(power, 0.6, 1.3);
    this.speed = Math.max(this.speed, 3.8);
    return true;
  }

  /** Rear up and spray water from the mouth */
  spray() {
    if (this.busy || this.lift < -0.3) return false;
    this.rearAt = this.t;
    return true;
  }

  /** Draw back, then lunge at (x, z) */
  strike(x: number, z: number) {
    if (this.busy || this.lift < -0.3) return false;
    this.strikeAt = this.t;
    this.strikeTo.set(x, z);
    return true;
  }

  /** Hit: knocked along (dx, dz), dunked, dazed a moment */
  knock(dx: number, dz: number, power: number) {
    const d = Math.hypot(dx, dz) || 1;
    this.kx += (dx / d) * 3.2 * power;
    this.kz += (dz / d) * 3.2 * power;
    if (!this.airborne) this.liftV -= 3.6 * power;
    this.rearAt = -1;
    this.strikeAt = -1;
    this.dazedUntil = this.t + 0.9;
    this.turn += (Math.random() < 0.5 ? -1 : 1) * 2.5 * power;
  }

  /** The head cord: held, the head comes up and the jaw opens */
  raise(on: boolean) {
    this.raised = on;
  }

  /** The pump: squeezed, water from the mouth (up in an arc if the head's raised, else ahead) */
  pump(on: boolean) {
    this.pumping = on;
  }

  /** The pole pressed down: it goes under. Let go: up out of the water in a leap, the higher the longer it was held */
  dive(on: boolean) {
    if (on) {
      if (this.airborne || !this.up) return false;
      this.diving = true;
      this.diveFrom = this.t;
      return true;
    }
    if (!this.diving) return false;
    this.diving = false;
    const held = this.t - this.diveFrom;
    if (held < 0.18) return false;
    this.airborne = true;
    this.rearAt = -1;
    this.liftV = this.kind.spring * THREE.MathUtils.clamp(0.75 + held * 0.45, 0.75, 1.25) + Math.max(0, -this.lift) * 2.4;
    this.speed = Math.max(this.speed, 3.6);
    return true;
  }

  get submerged() {
    return this.diving;
  }

  /** Held under: how hard it'll leap when let go, 0 to 1 (full after a second or so) */
  get charge() {
    return this.diving ? THREE.MathUtils.clamp((this.t - this.diveFrom) / 1.1, 0, 1) : 0;
  }

  /** The head pushed aside (something in the way), straight away */
  nudge(dx: number, dy: number, dz: number) {
    this.x += dx;
    this.z += dz;
    this.head.pos.x += dx;
    this.head.pos.y += dy;
    this.head.pos.z += dz;
  }

  update(dt: number, surface: (x: number, z: number) => number) {
    this.t += dt;
    const t = this.t;
    const k = this.kind;

    // ---- Steering ----
    const striking = this.strikeAt >= 0 ? t - this.strikeAt : -1;
    if (striking >= 0) this.target.copy(this.strikeTo);
    const dx = this.target.x - this.x;
    const dz = this.target.y - this.z;
    const dist = Math.hypot(dx, dz);
    const off = wrap(Math.atan2(dx, dz) - this.heading);
    const rear = this.rearAt >= 0 ? smooth(0, 0.5, t - this.rearAt) * (1 - smooth(2.4, 3.0, t - this.rearAt)) : 0;
    const dazed = t < this.dazedUntil ? 1 : 0;
    let want = THREE.MathUtils.clamp(dist * 1.4, k.minSpeed, k.maxSpeed);
    if (Math.abs(off) > 1.4) want *= 0.65;
    want *= 1 - 0.75 * rear;
    if (striking >= 0) want = striking < 0.22 ? 0.25 : striking < 0.55 ? 7 : 1.2;
    if (!this.up) want = Math.min(want, 1.6);
    if (this.airborne) want = Math.max(want, this.speed);
    this.speed += (want - this.speed) * (1 - Math.exp(-dt * (striking >= 0 ? 14 : 2.4)));
    const maxTurn = (Math.max(this.speed, 1) / k.turnR) * (striking >= 0.22 ? 3 : 1);
    const wantTurn = THREE.MathUtils.clamp(off * 3.2, -maxTurn, maxTurn) * (dist < 0.25 ? 0.3 : 1) * (1 - dazed * 0.8);
    this.turn += (wantTurn - this.turn) * (1 - Math.exp(-dt * (this.airborne ? 1.5 : striking >= 0 ? 12 : 5)));
    this.heading = wrap(this.heading + this.turn * dt);
    this.x += (Math.sin(this.heading) * this.speed + this.kx) * dt;
    this.z += (Math.cos(this.heading) * this.speed + this.kz) * dt;
    this.kx *= Math.exp(-dt * 3);
    this.kz *= Math.exp(-dt * 3);
    // Held in the pond, gently
    const zc = THREE.MathUtils.clamp(this.z, BOUNDS.zBack - 0.6, BOUNDS.zFront + 0.4);
    const lim = xLimit(zc) + 0.25;
    if (this.up) {
      this.x += (THREE.MathUtils.clamp(this.x, -lim, lim) - this.x) * (1 - Math.exp(-dt * 8));
      this.z += (zc - this.z) * (1 - Math.exp(-dt * 8));
    }
    this.s += this.speed * dt + Math.hypot(this.kx, this.kz) * dt;
    if (striking > 1.0) this.strikeAt = -1;

    // ---- Up and down: leaps, rearing, coming up at the start ----
    if (this.airborne) {
      this.liftV -= GRAVITY * dt;
      this.lift += this.liftV * dt;
      // In again: on down under, then back up
      if (this.lift < -0.85 && this.liftV < 0) this.airborne = false;
    } else {
      const coiled = striking >= 0 && striking < 0.3 ? 0.22 : 0;
      const rest = !this.up ? -1.2 : this.diving ? -0.95 : Math.max(rear, this.raised ? 1 : 0) * 0.62 + coiled;
      const w = t < this.surfaceAt + 0.8 ? 2.4 : 4.2;
      this.liftV += (-(this.lift - rest) * w * w - 2 * w * this.liftV) * dt;
      this.lift += this.liftV * dt;
    }
    if (this.rearAt >= 0 && t - this.rearAt > 3.0) this.rearAt = -1;

    const bob = Math.sin(t * 2.3 + this.surfaceAt) * 0.035 + Math.sin(t * 1.3 + 1) * 0.02;
    const amp = 0.5 + 0.5 * smooth(0.8, 3.2, this.speed);
    const last = this.trail[this.trail.length - 1];
    if (this.s - last.s >= 0.05) {
      this.trail.push({ s: this.s, x: this.x, y: this.lift, z: this.z, amp });
      const keep = this.s - (k.neck + k.spacing * k.segments + 1.5);
      while (this.trail.length > 2 && this.trail[1].s < keep) this.trail.shift();
    }
    this.place(bob, dt);
  }

  /**
   * After everything's bumped into everything (`collide`): which way each part faces, the jaw,
   * the spout, and what's gone in or out of the water.
   */
  finish(dt: number, surface: (x: number, z: number) => number) {
    const t = this.t;
    this.relax();
    this.face();
    const striking = this.strikeAt >= 0 ? t - this.strikeAt : -1;

    // ---- The jaw, and the spout while it's spraying ----
    const pumped = this.pumping && this.up && !this.airborne && !this.diving && t > this.dazedUntil && this.lift > -0.25;
    const spraying = pumped || (this.rearAt >= 0 && t - this.rearAt > 0.45 && t - this.rearAt < 2.35);
    const jawWant = spraying
      ? 0.62
      : striking >= 0 && striking < 0.6
        ? 0.9
        : this.raised
          ? 0.4
          : this.airborne
            ? 0.4
            : 0.1 + 0.06 * Math.sin(t * 1.7);
    this.head.jaw += (jawWant - this.head.jaw) * (1 - Math.exp(-dt * 12));
    this.spout.on = spraying;
    if (spraying) {
      this.spout.at.copy(this.head.forward).multiplyScalar(0.55).add(this.head.pos);
      this.spout.at.y -= 0.02;
      const high = this.raised || this.rearAt >= 0 ? 0.79 : 0.42;
      this.spout.dir
        .copy(this.head.forward)
        .setY(0)
        .normalize()
        .multiplyScalar(Math.sqrt(1 - high * high))
        .add(this.u.set(0, high, 0));
    }

    // ---- What's gone in or out of the water ----
    this.crossings.length = 0;
    const hy = this.head.pos.y - surface(this.head.pos.x, this.head.pos.z);
    if (Math.sign(hy) !== Math.sign(this.prevHeadY) && this.t > 0.1) {
      this.crossings.push({
        x: this.head.pos.x,
        z: this.head.pos.z,
        vy: (hy - this.prevHeadY) / dt,
        speed: this.speed,
        down: hy < 0,
        size: this.body[0].r * 1.4,
      });
    }
    this.prevHeadY = hy;
    for (const seg of this.body) {
      const y = seg.pos.y - surface(seg.pos.x, seg.pos.z);
      seg.vy = (y - seg.was) / Math.max(dt, 1e-3);
      if (Math.sign(y) !== Math.sign(seg.was)) {
        this.crossings.push({ x: seg.pos.x, z: seg.pos.z, vy: seg.vy, speed: this.speed, down: y < 0, size: seg.r });
      }
      seg.was = y;
      seg.wet = y < 0 ? 1 : seg.wet * Math.exp(-dt / 2.2);
    }
  }

  /** Each segment its length from the one in front (the head stays where it's held) */
  relax() {
    const k = this.kind;
    for (let i = 0; i < k.segments; i++) {
      const a = i === 0 ? this.head.pos : this.body[i - 1].pos;
      const p = this.body[i].pos;
      const rest = i === 0 ? k.neck : k.spacing;
      const d = this.tmp.subVectors(p, a);
      const len = d.length();
      if (len > 1e-5) p.copy(a).addScaledVector(d, rest / len);
    }
  }

  /** Where the path was, `back` metres behind the head */
  private along(back: number) {
    const tr = this.trail;
    const s = this.s - back;
    if (s <= tr[0].s) {
      const a = tr[0];
      const b = tr[Math.min(1, tr.length - 1)];
      const kk = (s - a.s) / Math.max(1e-4, b.s - a.s);
      return { x: a.x + (b.x - a.x) * kk, y: a.y, z: a.z + (b.z - a.z) * kk, amp: a.amp, s };
    }
    let lo = 0;
    let hi = tr.length - 1;
    if (s >= tr[hi].s) {
      // Between the last point and the head itself
      const a = tr[hi];
      const kk = (s - a.s) / Math.max(1e-4, this.s - a.s);
      return {
        x: a.x + (this.x - a.x) * kk,
        y: a.y + (this.lift - a.y) * kk,
        z: a.z + (this.z - a.z) * kk,
        amp: a.amp,
        s,
      };
    }
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (tr[mid].s < s) lo = mid;
      else hi = mid;
    }
    const a = tr[lo];
    const b = tr[hi];
    const kk = (s - a.s) / Math.max(1e-4, b.s - a.s);
    return {
      x: a.x + (b.x - a.x) * kk,
      y: a.y + (b.y - a.y) * kk,
      z: a.z + (b.z - a.z) * kk,
      amp: a.amp + (b.amp - a.amp) * kk,
      s,
    };
  }

  private place(bob: number, dt: number) {
    const k = this.kind;
    const P = this.points;
    P[0].set(this.x, this.lift + k.ride + bob, this.z);
    for (let i = 0; i <= k.segments; i++) {
      const back = k.neck + i * k.spacing;
      const a = this.along(back);
      const coil = k.coil * a.amp * Math.sin((2 * Math.PI * a.s) / k.lambda + 1.9) - 0.1 * (k.coil > 0.2 ? 1 : 0.3);
      const w = smooth(0.15, 1.1, back);
      let x = a.x;
      let z = a.z;
      if (k.sway > 0) {
        // Side to side across the way it's going, growing toward the tail
        const b = this.along(back + 0.08);
        const tx = a.x - b.x;
        const tz = a.z - b.z;
        const tl = Math.hypot(tx, tz) || 1;
        const side = k.sway * w * (0.5 + 0.5 * (i / k.segments)) * Math.sin((2 * Math.PI * a.s) / k.swayLambda - this.t * 2.2);
        x += (tz / tl) * side;
        z -= (tx / tl) * side;
      }
      P[i + 1].set(x, a.y + k.ride * (1 - w) + coil * w + bob * (1 - w), z);
    }
    this.head.pos.copy(P[0]);
    if (!this.settled) {
      this.settled = true;
      for (let i = 0; i < k.segments; i++) {
        this.body[i].pos.copy(P[i + 1]);
        this.prev[i].copy(P[i + 1]);
      }
      return;
    }
    // The chain: each segment carries on as it was going (less a little), and is drawn toward its
    // place on the path; pushed off it, it swings back
    const pull = 1 - Math.exp(-dt * 11);
    for (let i = 0; i < k.segments; i++) {
      const p = this.body[i].pos;
      const was = this.tmp.copy(p);
      p.x += (p.x - this.prev[i].x) * 0.8;
      p.y += (p.y - this.prev[i].y) * 0.8;
      p.z += (p.z - this.prev[i].z) * 0.8;
      this.prev[i].copy(was);
      p.lerp(P[i + 1], pull);
    }
    this.relax();
  }

  /** Which way the head and each segment face, from where they are */
  private face() {
    const k = this.kind;
    const f = this.f.subVectors(this.head.pos, this.body[0].pos).normalize();
    const horiz = this.u.set(Math.sin(this.heading), 0, Math.cos(this.heading));
    const rear = Math.max(
      this.rearAt >= 0 ? smooth(0, 0.5, this.t - this.rearAt) * (1 - smooth(2.3, 3.0, this.t - this.rearAt)) : 0,
      this.raised ? THREE.MathUtils.clamp(this.lift / 0.62, 0, 1) : 0
    );
    f.lerp(horiz, 0.6).normalize();
    f.y += rear * 0.55 + THREE.MathUtils.clamp(this.liftV * 0.08, -0.5, 0.6);
    f.normalize();
    this.head.forward.copy(f);
    this.orient(f, this.turn * 0.12, this.head.quat);
    const n = k.segments;
    for (let i = 0; i < n; i++) {
      const front = i === 0 ? this.head.pos : this.body[i - 1].pos;
      const fw = this.f.subVectors(front, i < n - 1 ? this.body[i + 1].pos : this.body[i].pos);
      if (i === n - 1) fw.multiplyScalar(2);
      fw.normalize();
      this.orient(fw, this.turn * 0.1 * (1 - i / n), this.body[i].quat);
    }
  }

  /** Facing along f, its back up, banked by `roll` */
  private orient(f: THREE.Vector3, roll: number, out: THREE.Quaternion) {
    const right = this.rt.set(0, 1, 0).cross(f);
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
    right.normalize();
    const up = this.u.crossVectors(f, right).normalize();
    this.m.makeBasis(right, up, f);
    out.setFromRotationMatrix(this.m);
    if (roll) out.multiply(this.q.setFromAxisAngle(this.rt.set(0, 0, 1), roll));
  }
}

type Ball = { p: THREE.Vector3; r: number; w: number; head: boolean; i: number };
const balls = (a: Puppet): Ball[] => [
  { p: a.head.pos, r: a.kind.headR, w: 0.25, head: true, i: -1 },
  ...a.body.map((s, i) => ({ p: s.pos, r: s.r * 1.05, w: 1, head: false, i })),
];
const n = new THREE.Vector3();

/**
 * Puppets bumping: every ball of `a` kept off every ball of `b` (or, `b` the same puppet, off its
 * own coils further along), each pushed by its share (the heads, held on their poles, by less).
 * Hears of each contact that pushed hard, for its splash.
 */
export function collide(a: Puppet, b: Puppet, contact?: (at: THREE.Vector3, depth: number) => void) {
  const A = balls(a);
  const B = a === b ? A : balls(b);
  for (const pa of A) {
    for (const pb of B) {
      if (a === b && pb.i <= pa.i + 2) continue;
      const d2 = pa.p.distanceToSquared(pb.p);
      const min = pa.r + pb.r;
      if (d2 >= min * min) continue;
      const d = Math.sqrt(d2);
      if (d > 1e-5) n.subVectors(pb.p, pa.p).divideScalar(d);
      else n.set(1, 0, 0);
      const over = min - d;
      const wa = pa.w / (pa.w + pb.w);
      const wb = pb.w / (pa.w + pb.w);
      if (pa.head) a.nudge(-n.x * over * wa, -n.y * over * wa, -n.z * over * wa);
      else pa.p.addScaledVector(n, -over * wa);
      if (pb.head) b.nudge(n.x * over * wb, n.y * over * wb, n.z * over * wb);
      else pb.p.addScaledVector(n, over * wb);
      if (contact && over > 0.05) contact(pa.p, over);
    }
  }
}
