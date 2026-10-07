/**
 * The stickers' world, stepped on the UI thread every frame. Each sticker is a disc: it can be
 * held under a finger, thrown (a real ballistic arc, aimed so it drops into the bag's mouth),
 * tumble inside the bag and pile up on the others, pour out of the bag's mouth when it's turned
 * upside down, spring to a place in the cart's list, or be flicked away. Discs keep it cheap and
 * steady; die-cut stickers are round enough that nobody can tell.
 */

/** A sticker's radius at full size, in points (the shop cards show it at this size) */
export const R0 = 54;
export const MAX = 28;
export const G = 2600;
/** How big a sticker is inside the bag, and in the cart's list */
export const BAG_S = 0.52;
export const LIST_S = 0.6;
/** The bag's width across its mouth, and its depth from rim to bottom */
export const BAG_W = 164;
export const BAG_H = 104;

export const AIR = 1;
export const BAG = 2;
export const COUNTER = 3;
export const GONE = 4;

const FREE = 0;
const HELD = 1;
const SPRING = 2;

/** What JS hears about, see `step` */
export const LANDED = 1;
export const THUD = 2;
export const LEFT = 3;
export const SPAWNED = 4;
export const SPILLED = 5;

export type Body = {
  live: number;
  product: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  a: number;
  va: number;
  /** Scale now, and the scale it's easing to */
  s: number;
  ts: number;
  layer: number;
  mode: number;
  /** Spring target */
  tx: number;
  ty: number;
  ta: number;
  /** Finger, and where on the sticker it's holding */
  gx: number;
  gy: number;
  ox: number;
  oy: number;
  /** Seconds to sit lifted off its card before it's thrown, or to wait before flying home */
  hold: number;
  wait: number;
  /** Disappear once the spring arrives */
  retire: number;
};

export type World = {
  bodies: Body[];
  /**
   * The bag's sag and squash, each a spring; how full it is (0 to 1, eased); and how far its
   * drawstring is pulled shut (0 to 1)
   */
  bag: { y: number; v: number; sq: number; sv: number; fill: number; cinch: number };
  /**
   * The bag turned over to pour it out: the angle it's turned through about the middle of its rim,
   * and how far it's been lifted. Everything inside feels gravity turned the other way.
   */
  tip: { a: number; rise: number };
  geo: {
    w: number;
    h: number;
    cx: number;
    /** Bottom of the bag, its mouth's width and its height */
    bottom: number;
    bw: number;
    bh: number;
    /** 0 in place, 1 slid off the bottom of the screen */
    hide: number;
    /** Where poured stickers come to rest */
    counter: number;
  };
  t: number;
  lastThud: number;
  lastSpill: number;
  /** What happened this frame, for JS: kind, slot, product, in threes (see `step`) */
  events: number[];
};

export function makeWorld(): World {
  return {
    bodies: Array.from({ length: MAX }, () => ({
      live: 0,
      product: 0,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      a: 0,
      va: 0,
      s: 1,
      ts: 1,
      layer: 0,
      mode: 0,
      tx: 0,
      ty: 0,
      ta: 0,
      gx: 0,
      gy: 0,
      ox: 0,
      oy: 0,
      hold: 0,
      wait: 0,
      retire: 0,
    })),
    bag: { y: 0, v: 0, sq: 0, sv: 0, fill: 0, cinch: 0 },
    tip: { a: 0, rise: 0 },
    geo: { w: 390, h: 844, cx: 195, bottom: 780, bw: BAG_W, bh: BAG_H, hide: 0, counter: 700 },
    t: 0,
    lastThud: 0,
    lastSpill: 0,
    events: [],
  };
}

/**
 * The net bag's outline: its half-width at depth v (0 at the rim, 1 at the bottom). Narrow at
 * the rim where the net is gathered onto it, a round belly that swells as it fills, and drawn in
 * to the knot at the bottom where all the cords meet. Pulling the drawstring gathers the top in.
 */
export const sackHalf = (bw: number, bulge: number, v: number, cinch = 0) => {
  'worklet';
  const d = Math.max(0, Math.min(1, v));
  const belly = Math.sin(Math.min(1, d / 0.5) * Math.PI * 0.5);
  const hw = (bw / 2) * (0.78 + 0.26 * belly) + bulge * Math.sin(Math.PI * Math.min(1, d * 1.4));
  const round = d > 0.5 ? Math.sqrt(Math.max(0, 1 - ((d - 0.5) / 0.5) ** 2)) : 1;
  const gathered = 1 - cinch * 0.72 * Math.pow(Math.max(0, 1 - d / 0.55), 1.4);
  return hw * (0.06 + 0.94 * round) * gathered;
};
/** Where the things in the bag come to rest, as a depth: the bottom's too narrow to hold anything */
const REST = 0.84;
/** How far the belly swells and the bottom sags, in points, for how full it is */
export const bulgeOf = (fill: number) => {
  'worklet';
  return fill * 14;
};
export const sagOf = (fill: number) => {
  'worklet';
  return fill * 12;
};

/** How far the bag drops out of sight while the cart is open, handles and all */
export const HIDE = 380;

export const mouthY = (w: World) => {
  'worklet';
  return w.geo.bottom - w.geo.bh + w.bag.y * 0.4 + w.geo.hide * HIDE;
};
const floorY = (w: World) => {
  'worklet';
  const m = mouthY(w);
  return m + (w.geo.bottom + sagOf(w.bag.fill) + w.bag.y + w.geo.hide * HIDE - m) * REST;
};
export const radiusOf = (b: Body) => {
  'worklet';
  return R0 * b.s * 0.8;
};

/** Throw a sticker so it drops into the bag: a real arc, solved for the time it should take */
export function throwToBag(w: World, b: Body, assist = 1) {
  'worklet';
  // Aimed at where the bag stands, even while it's still coming up into place
  const tx = w.geo.cx + (Math.random() - 0.5) * w.geo.bw * 0.34;
  const ty = w.geo.bottom - w.geo.bh + 12;
  const dist = Math.hypot(tx - b.x, ty - b.y);
  const T = 0.42 + Math.min(0.4, dist / 1600);
  const vx = (tx - b.x) / T;
  const vy = (ty - b.y - 0.5 * G * T * T) / T;
  b.vx = b.vx * (1 - assist) + vx * assist;
  b.vy = b.vy * (1 - assist) + vy * assist;
  b.va = (Math.random() < 0.5 ? -1 : 1) * (3 + Math.random() * 5);
  b.layer = AIR;
  b.mode = FREE;
  b.ts = BAG_S;
}

export function freeSlot(w: World) {
  'worklet';
  for (let i = 0; i < MAX; i++) if (!w.bodies[i].live) return i;
  return -1;
}

function fresh(b: Body, product: number, x: number, y: number) {
  'worklet';
  Object.assign(b, {
    live: 1,
    product,
    x,
    y,
    vx: 0,
    vy: 0,
    a: 0,
    va: 0,
    s: 1,
    ts: 1,
    hold: 0,
    wait: 0,
    retire: 0,
  });
}

/** A sticker peeled off a card at (x, y): it lifts for a beat, then is thrown into the bag */
export function peel(w: World, product: number, x: number, y: number) {
  'worklet';
  const i = freeSlot(w);
  if (i < 0) return -1;
  const b = w.bodies[i];
  fresh(b, product, x, y);
  Object.assign(b, { ts: 1.14, layer: AIR, mode: SPRING, tx: x, ty: y - 10, ta: -0.12, hold: 0.16 });
  return i;
}

/** A sticker picked up under the finger */
export function grab(w: World, product: number, x: number, y: number, fx: number, fy: number) {
  'worklet';
  const i = freeSlot(w);
  if (i < 0) return -1;
  const b = w.bodies[i];
  fresh(b, product, x, y);
  Object.assign(b, { ts: 1.16, layer: AIR, mode: HELD, gx: fx, gy: fy, ox: fx - x, oy: fy - y });
  return i;
}

/** Let go of a held sticker: into the bag, or back onto its card if it barely moved */
export function release(w: World, i: number, vx: number, vy: number, hx: number, hy: number) {
  'worklet';
  const b = w.bodies[i];
  if (!b || !b.live || b.mode !== HELD) return;
  const moved = Math.hypot(b.x - hx, b.y - hy);
  if (moved < 46 && Math.hypot(vx, vy) < 700) {
    Object.assign(b, { mode: SPRING, tx: hx, ty: hy, ta: 0, ts: 1, retire: 1 });
    return;
  }
  b.vx = vx;
  b.vy = vy;
  // Most of the aim comes from the bag, a little from the throw, so it always goes in but feels thrown
  throwToBag(w, b, 0.72);
}

/** One more of a thing, dropped onto its line in the cart from just above it */
export function spawn(w: World, product: number, x: number, y: number) {
  'worklet';
  const i = freeSlot(w);
  if (i < 0) return -1;
  const b = w.bodies[i];
  fresh(b, product, x, y - 80);
  Object.assign(b, { s: 0.2, ts: LIST_S, layer: COUNTER, mode: SPRING, tx: x, ty: y, ta: 0.3 });
  w.events.push(SPAWNED, i, product);
  return i;
}

/** Shake out whatever's still caught in the upturned bag */
export function shakeOut(w: World) {
  'worklet';
  const mouth = mouthY(w);
  w.bodies.forEach((b) => {
    if (b.live && b.layer === BAG) b.y = mouth - radiusOf(b);
  });
}

/** Spring the poured stickers to their places in the list */
export function tidy(w: World, targets: { slot: number; x: number; y: number; a: number; s: number }[]) {
  'worklet';
  targets.forEach(({ slot, x, y, a, s }, k) => {
    const b = w.bodies[slot];
    if (!b || !b.live) return;
    Object.assign(b, { mode: SPRING, tx: x, ty: y, ta: a, ts: s, wait: k * 0.03, retire: 0 });
  });
}

/** Everything on the counter back into the bag, one after another */
export function pack(w: World) {
  'worklet';
  let k = 0;
  w.bodies.forEach((b) => {
    if (!b.live || b.layer !== COUNTER) return;
    b.mode = SPRING;
    b.tx = b.x;
    b.ty = b.y - 12;
    b.ta = b.a;
    b.ts = b.s * 1.08;
    b.hold = 0.12 + k * 0.07;
    b.wait = 0;
    b.layer = AIR;
    k++;
  });
}

/** Flick a sticker away */
export function discard(w: World, slot: number, vx: number) {
  'worklet';
  const b = w.bodies[slot];
  if (!b || !b.live) return;
  Object.assign(b, {
    layer: GONE,
    mode: FREE,
    vx: vx === 0 ? -1400 : vx,
    vy: -500 - Math.random() * 300,
    va: (vx < 0 ? -1 : 1) * 12,
    wait: 0,
    hold: 0,
  });
}

export function clearBag(w: World) {
  'worklet';
  w.bodies.forEach((b) => {
    if (b.layer === BAG) b.live = 0;
  });
}

/**
 * One frame. What JS should hear about goes in `w.events`, as (kind, slot, product): LANDED a
 * sticker dropped into the bag, THUD one hit the counter, LEFT a flicked one left the screen,
 * SPAWNED one was added in the cart, SPILLED one fell out of the upturned bag
 */
export function step(w: World, dt: number) {
  'worklet';
  const emit = (kind: number, slot: number, product: number) => {
    w.events.push(kind, slot, product);
  };
  w.t += dt;
  w.bag.v += (-w.bag.y * 240 - w.bag.v * 15) * dt;
  w.bag.y += w.bag.v * dt;
  w.bag.sv += (-w.bag.sq * 320 - w.bag.sv * 13) * dt;
  w.bag.sq += w.bag.sv * dt;
  let n = 0;
  for (let i = 0; i < MAX; i++) if (w.bodies[i].live && w.bodies[i].layer === BAG) n++;
  w.bag.fill += (Math.min(1, n / 10) - w.bag.fill) * Math.min(1, dt * 5);
  const bulge = bulgeOf(w.bag.fill);
  // Gravity as the things in the bag feel it, turned with the bag
  const ca = Math.cos(w.tip.a);
  const sa = Math.sin(w.tip.a);
  const SUB = 3;
  const h = dt / SUB;
  for (let k = 0; k < SUB; k++) {
    const mouth = mouthY(w);
    const floor = floorY(w);
    for (let i = 0; i < MAX; i++) {
      const b = w.bodies[i];
      if (!b.live) continue;
      if (b.wait > 0) {
        b.wait -= h;
        if (b.mode !== SPRING) continue;
      }
      b.s += (b.ts - b.s) * Math.min(1, h * (b.mode === HELD ? 14 : 6));
      if (b.mode === HELD) {
        const nx = b.gx - b.ox;
        const ny = b.gy - b.oy;
        const fx = b.x + (nx - b.x) * Math.min(1, h * 28);
        const fy = b.y + (ny - b.y) * Math.min(1, h * 28);
        b.vx = (fx - b.x) / h;
        b.vy = (fy - b.y) / h;
        b.x = fx;
        b.y = fy;
        // It leans into the way it's dragged, like paper does
        const lean = Math.max(-0.5, Math.min(0.5, b.vx * 0.0005));
        b.a += (lean - b.a) * Math.min(1, h * 12);
        continue;
      }
      if (b.mode === SPRING) {
        if (b.wait > 0) continue;
        b.vx += ((b.tx - b.x) * 190 - b.vx * 22) * h;
        b.vy += ((b.ty - b.y) * 190 - b.vy * 22) * h;
        b.va += ((b.ta - b.a) * 160 - b.va * 20) * h;
        b.x += b.vx * h;
        b.y += b.vy * h;
        b.a += b.va * h;
        if (b.hold > 0) {
          b.hold -= h;
          if (b.hold <= 0) throwToBag(w, b);
        } else if (b.retire && Math.hypot(b.tx - b.x, b.ty - b.y) < 1.5) {
          b.live = 0;
        }
        continue;
      }
      // Free flight
      if (b.layer === BAG) {
        b.vx += G * sa * h;
        b.vy += G * ca * h;
      } else {
        b.vy += G * h;
      }
      b.vx *= 1 - h * 0.15;
      b.va *= 1 - h * 0.8;
      b.x += b.vx * h;
      b.y += b.vy * h;
      b.a += b.va * h;
      const r = radiusOf(b);
      if (b.layer === AIR) {
        if (b.vy > 0 && b.y > mouth + 4 && Math.abs(b.x - w.geo.cx) < sackHalf(w.geo.bw, bulge, 0) - 4) {
          // In: the bag takes the weight
          b.layer = BAG;
          b.ts = BAG_S;
          w.bag.v += 160 + Math.min(240, b.vy * 0.08);
          w.bag.sv += 2.2;
          emit(LANDED, i, b.product);
        } else if (b.y > w.geo.h + 300) {
          b.live = 0;
        }
      } else if (b.layer === BAG) {
        if (w.tip.a > 1.2 && b.y < mouth - r * 0.2) {
          // Out of the upturned mouth and into the world: from the bag's frame to the screen's
          const dx = b.x - w.geo.cx;
          const dy = b.y - mouth;
          const vx = b.vx * ca - b.vy * sa;
          const vy = b.vx * sa + b.vy * ca;
          b.x = w.geo.cx + dx * ca - dy * sa;
          b.y = mouth - w.tip.rise + dx * sa + dy * ca;
          b.vx = vx * 0.5 + (Math.random() - 0.5) * 260;
          b.vy = vy * 0.5;
          b.va = (Math.random() - 0.5) * 10;
          b.a += w.tip.a;
          b.layer = COUNTER;
          b.ts = 0.66;
          if (w.t - w.lastSpill > 0.05) {
            w.lastSpill = w.t;
            emit(SPILLED, i, b.product);
          }
          continue;
        }
        // The net holds it in: its sides at this depth, and the bottom
        const v = ((b.y - mouth) / (floor - mouth)) * REST;
        const half = Math.max(r + 2, sackHalf(w.geo.bw, bulge, v, w.bag.cinch) - 5);
        if (b.x < w.geo.cx - half + r) {
          b.x = w.geo.cx - half + r;
          b.vx = Math.abs(b.vx) * 0.3;
        } else if (b.x > w.geo.cx + half - r) {
          b.x = w.geo.cx + half - r;
          b.vx = -Math.abs(b.vx) * 0.3;
        }
        if (b.y > floor - r) {
          b.y = floor - r;
          if (b.vy > 0) b.vy = -b.vy * 0.2;
          b.vx *= 0.9;
          b.va = b.vx / r;
        }
      } else if (b.layer === COUNTER) {
        if (b.x < 10 + r) {
          b.x = 10 + r;
          b.vx = Math.abs(b.vx) * 0.4;
        } else if (b.x > w.geo.w - 10 - r) {
          b.x = w.geo.w - 10 - r;
          b.vx = -Math.abs(b.vx) * 0.4;
        }
        if (b.y > w.geo.counter - r) {
          if (b.vy > 500 && w.t - w.lastThud > 0.06) {
            w.lastThud = w.t;
            emit(THUD, i, b.product);
          }
          b.y = w.geo.counter - r;
          if (b.vy > 0) b.vy = -b.vy * 0.28;
          b.vx *= 0.88;
          b.va = b.vx / r;
        }
      } else if (b.layer === GONE) {
        if (b.x < -200 || b.x > w.geo.w + 200 || b.y > w.geo.h + 200) {
          b.live = 0;
          emit(LEFT, i, b.product);
        }
      }
    }
    // Stickers in the bag, and on the counter, push each other apart and roll off one another
    for (let i = 0; i < MAX; i++) {
      const p = w.bodies[i];
      if (!p.live || p.mode !== FREE || (p.layer !== BAG && p.layer !== COUNTER) || p.wait > 0) continue;
      const rp = radiusOf(p);
      for (let j = i + 1; j < MAX; j++) {
        const q = w.bodies[j];
        if (!q.live || q.mode !== FREE || q.layer !== p.layer || q.wait > 0) continue;
        const dx = q.x - p.x;
        const dy = q.y - p.y;
        const d = Math.hypot(dx, dy);
        const min = rp + radiusOf(q);
        if (d >= min || d < 1e-4) continue;
        const nx = dx / d;
        const ny = dy / d;
        const push = (min - d) / 2;
        p.x -= nx * push;
        p.y -= ny * push;
        q.x += nx * push;
        q.y += ny * push;
        const rvx = q.vx - p.vx;
        const rvy = q.vy - p.vy;
        const vn = rvx * nx + rvy * ny;
        if (vn < 0) {
          const jn = (-(1 + 0.2) * vn) / 2;
          p.vx -= jn * nx;
          p.vy -= jn * ny;
          q.vx += jn * nx;
          q.vy += jn * ny;
          // Friction along the contact turns into spin
          const vt = rvx * -ny + rvy * nx;
          p.va += (vt * 0.15) / rp;
          q.va -= (vt * 0.15) / rp;
        }
      }
    }
  }
}
