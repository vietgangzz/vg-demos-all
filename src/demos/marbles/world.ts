/**
 * The marbles' physics, run on the UI thread from a frame callback: gravity (or the phone's tilt),
 * the walls, marble against marble, a finger dragging one, and a tap's shockwave. Nothing here
 * touches React; the canvas reads the result through node handles.
 */

export const GRAVITY = 2400;
const WALL_BOUNCE = 0.55;
const BALL_BOUNCE = 0.72;
const STEPS = 3;

export type World = {
  x: number[];
  y: number[];
  vx: number[];
  vy: number[];
  r: number[];
  /** Per-marble phase, so in Float each one drifts on its own path */
  seed: number[];
  /** The marble under the finger, or -1 */
  grab: number;
  fx: number;
  fy: number;
  /** Down, unless the phone is tilted */
  gx: number;
  gy: number;
  /** 0 falls, 1 floats; eased between so switching glides */
  float: number;
  floatTo: number;
  time: number;
  /** Where the light is, and where it's going */
  sunX: number;
  sunY: number;
  sunToX: number;
  sunToY: number;
  /** The last tap's ring: where, and how far it has spread (1 = gone) */
  ringX: number;
  ringY: number;
  ringT: number;
  /** The poster's letters: how far each has been knocked from its place, and how fast it's moving */
  ldx: number[];
  ldy: number[];
  lvx: number[];
  lvy: number[];
  lrot: number[];
  lvrot: number[];
};

/** Where the letters belong, their centres on the poster, and how big each is */
export type LetterRest = { x: number[]; y: number[]; size: number[] };

export function makeWorld(radii: number[], width: number, height: number, letters: number): World {
  const zeros = () => new Array<number>(letters).fill(0);
  return {
    x: radii.map((_, i) => width * (0.2 + ((i * 0.37) % 0.6))),
    // Above the screen, one after another, so they rain in
    y: radii.map((r, i) => -r - i * 140),
    vx: radii.map((_, i) => (i % 2 ? -60 : 60)),
    vy: radii.map(() => 0),
    r: radii,
    seed: radii.map((_, i) => i * 1.7 + 0.3),
    grab: -1,
    fx: 0,
    fy: 0,
    gx: 0,
    gy: 1,
    float: 0,
    floatTo: 0,
    time: 0,
    sunX: width * 0.8,
    sunY: height * 0.14,
    sunToX: width * 0.8,
    sunToY: height * 0.14,
    ringX: 0,
    ringY: 0,
    ringT: 1,
    ldx: zeros(),
    ldy: zeros(),
    lvx: zeros(),
    lvy: zeros(),
    lrot: zeros(),
    lvrot: zeros(),
  };
}

/** The marble under a point, with a little slack for a fingertip */
export function marbleAt(w: World, px: number, py: number) {
  'worklet';
  let best = -1;
  let bestD = 1e9;
  for (let i = 0; i < w.x.length; i++) {
    const d = Math.hypot(px - w.x[i], py - w.y[i]);
    if (d < w.r[i] + 18 && d < bestD) {
      best = i;
      bestD = d;
    }
  }
  return best;
}

/** A tap on the glass: every marble near it is pushed away, and up, and the letters jump */
export function shockwave(w: World, px: number, py: number, rest: LetterRest) {
  'worklet';
  w.ringX = px;
  w.ringY = py;
  w.ringT = 0;
  for (let i = 0; i < w.x.length; i++) {
    const dx = w.x[i] - px;
    const dy = w.y[i] - py;
    const d = Math.max(Math.hypot(dx, dy), 1);
    const k = Math.max(0, 1 - d / 420);
    if (k <= 0) continue;
    const push = 2600 * k * k;
    w.vx[i] += (dx / d) * push;
    w.vy[i] += (dy / d) * push - 500 * k;
  }
  for (let i = 0; i < rest.x.length; i++) {
    const dx = rest.x[i] - px;
    const dy = rest.y[i] - py;
    const d = Math.max(Math.hypot(dx, dy), 1);
    const k = Math.max(0, 1 - d / 460);
    if (k <= 0) continue;
    w.lvx[i] += (dx / d) * 1500 * k * k;
    w.lvy[i] += (dy / d) * 1500 * k * k;
    w.lvrot[i] += (dx >= 0 ? 1 : -1) * 7 * k;
  }
}

// Just under critical damping: the letters settle back with barely an overshoot
const LETTER_K = 120;
const LETTER_C = 15.8;
const TURN_K = 90;
const TURN_C = 14;
const MAX_LEAN = 0.38;

/** Each letter sits on a spring at its place on the poster; marbles shoulder it aside as they pass */
export function stepLetters(w: World, rest: LetterRest, dt: number) {
  'worklet';
  for (let i = 0; i < rest.x.length; i++) {
    let ax = -LETTER_K * w.ldx[i] - LETTER_C * w.lvx[i];
    let ay = -LETTER_K * w.ldy[i] - LETTER_C * w.lvy[i];
    let turn = -TURN_K * w.lrot[i] - TURN_C * w.lvrot[i];
    const cx = rest.x[i] + w.ldx[i];
    const cy = rest.y[i] + w.ldy[i];
    for (let m = 0; m < w.x.length; m++) {
      const ex = cx - w.x[m];
      const ey = cy - w.y[m];
      const reach = w.r[m] + rest.size[i] * 0.42;
      if (Math.abs(ex) > reach || Math.abs(ey) > reach) continue;
      const d = Math.max(Math.hypot(ex, ey), 1);
      if (d >= reach) continue;
      const k = 1 - d / reach;
      // Pushed aside by being there, carried along by how fast it's going, and spun by the glancing blow
      ax += (ex / d) * 6000 * k * k + w.vx[m] * 6 * k;
      ay += (ey / d) * 6000 * k * k + w.vy[m] * 6 * k;
      turn += (ex / d) * 14 * k + ((ex * w.vy[m] - ey * w.vx[m]) / d) * 0.045 * k;
    }
    w.lvx[i] += ax * dt;
    w.lvy[i] += ay * dt;
    w.lvrot[i] += turn * dt;
    w.ldx[i] += w.lvx[i] * dt;
    w.ldy[i] += w.lvy[i] * dt;
    w.lrot[i] += w.lvrot[i] * dt;
    // A letter leans, it never turns over: on its side it stops reading as a letter
    if (Math.abs(w.lrot[i]) > MAX_LEAN) {
      w.lrot[i] = Math.sign(w.lrot[i]) * MAX_LEAN;
      w.lvrot[i] = 0;
    }
  }
}

export function step(w: World, dt: number, width: number, height: number) {
  'worklet';
  w.time += dt;
  w.float += (w.floatTo - w.float) * Math.min(1, dt * 3);
  w.sunX += (w.sunToX - w.sunX) * Math.min(1, dt * 10);
  w.sunY += (w.sunToY - w.sunY) * Math.min(1, dt * 10);
  if (w.ringT < 1) w.ringT = Math.min(1, w.ringT + dt * 1.6);

  const n = w.x.length;
  const h = dt / STEPS;
  const fall = 1 - w.float;
  for (let s = 0; s < STEPS; s++) {
    for (let i = 0; i < n; i++) {
      if (i === w.grab) {
        // Held: it chases the finger, and keeps the speed it had for the throw
        const vx = (w.fx - w.x[i]) * 22;
        const vy = (w.fy - w.y[i]) * 22;
        w.vx[i] = vx;
        w.vy[i] = vy;
      } else {
        w.vx[i] += w.gx * GRAVITY * fall * h;
        w.vy[i] += w.gy * GRAVITY * fall * h;
        if (w.float > 0.01) {
          // Each drifts toward its own slow figure-of-eight, like a bubble in syrup
          const t = w.time * 0.35 + w.seed[i];
          const tx = width * (0.5 + 0.34 * Math.sin(t * 1.3 + w.seed[i] * 2));
          const ty = height * (0.45 + 0.3 * Math.sin(t * 0.9) * Math.cos(t * 0.6 + w.seed[i]));
          w.vx[i] += (tx - w.x[i]) * 1.6 * w.float * h;
          w.vy[i] += (ty - w.y[i]) * 1.6 * w.float * h;
          const drag = 1 - 1.8 * w.float * h;
          w.vx[i] *= drag;
          w.vy[i] *= drag;
        }
      }
      w.x[i] += w.vx[i] * h;
      w.y[i] += w.vy[i] * h;

      const r = w.r[i];
      if (w.x[i] < r) {
        w.x[i] = r;
        w.vx[i] = Math.abs(w.vx[i]) * WALL_BOUNCE;
      } else if (w.x[i] > width - r) {
        w.x[i] = width - r;
        w.vx[i] = -Math.abs(w.vx[i]) * WALL_BOUNCE;
      }
      if (w.y[i] > height - r) {
        w.y[i] = height - r;
        w.vy[i] = -Math.abs(w.vy[i]) * WALL_BOUNCE;
        // Rolling on the floor slows them
        w.vx[i] *= 1 - 2.2 * h;
      } else if (w.y[i] < r && w.vy[i] < 0 && (w.float > 0.5 || w.gy < 0)) {
        // The top is a wall only once they're in, so the opening rain can fall through it
        w.y[i] = r;
        w.vy[i] = Math.abs(w.vy[i]) * WALL_BOUNCE;
      }
    }

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = w.x[j] - w.x[i];
        const dy = w.y[j] - w.y[i];
        const min = w.r[i] + w.r[j];
        const d2 = dx * dx + dy * dy;
        if (d2 >= min * min || d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        const nx = dx / d;
        const ny = dy / d;
        // Mass goes as area; a held marble doesn't give
        const ia = i === w.grab ? 0 : 1 / (w.r[i] * w.r[i]);
        const ib = j === w.grab ? 0 : 1 / (w.r[j] * w.r[j]);
        const sum = ia + ib;
        if (sum === 0) continue;
        const overlap = min - d;
        w.x[i] -= nx * overlap * (ia / sum);
        w.y[i] -= ny * overlap * (ia / sum);
        w.x[j] += nx * overlap * (ib / sum);
        w.y[j] += ny * overlap * (ib / sum);
        const vn = (w.vx[j] - w.vx[i]) * nx + (w.vy[j] - w.vy[i]) * ny;
        if (vn >= 0) continue;
        const k = (-(1 + BALL_BOUNCE) * vn) / sum;
        w.vx[i] -= k * ia * nx;
        w.vy[i] -= k * ia * ny;
        w.vx[j] += k * ib * nx;
        w.vy[j] += k * ib * ny;
      }
    }
  }
}
