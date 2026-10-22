import * as THREE from 'three/webgpu';

import { Body, Spring } from './physics';
import type { RoomStage } from './room';
import type { Team } from './sleigh';
import type { TownStage } from './town';
import { Follow, PacedCurve, smooth, smoother, TimeSpline } from './track';

/**
 * Into the snow globe and out again, as one shot: one clock, one team, one camera.
 *
 *   in        from out on the shelf, the camera closes in on the sleigh as it peels off its loop,
 *             through the glass, the distance falling off steadily, and catches up behind it
 *   flyover   down over the roofs, once round the tree in the square, and in along the roofs to
 *             land on the red house's ridge
 *   roof      the slide to a stop, Santa up, the present lobbed down the chimney
 *   room      after it down the flue: the present lands by the fire, too hot, runs off, sits down
 *             under the tree and drops off to sleep; it's just a present again
 *   out       the window flies open, out into the square, up to the roof as the team takes off
 *   away      after them, up over the town and back out through the glass to the shelf, the team
 *             back on its loop
 *
 * Everything is in the town's metres, in the globe's own frame (it turns on its base: the scene
 * carries this into the world). The sleigh's way is worked out ahead, so the deer can each be put
 * where the sleigh will be: they string out round a turn the way a real team does, and stand in a
 * line ahead of it on the roof when it's stopped.
 */

export type DiveBeat =
  | 'enter'
  | 'landed'
  | 'throw'
  | 'chimney'
  | 'room'
  | 'hot'
  | 'asleep'
  | 'window'
  | 'outside'
  | 'liftoff'
  | 'away'
  | 'exit'
  | 'done';

export type DivePlan = {
  /**
   * The sleigh's loop over the town: where it is at any time on the loop's own clock, and that
   * clock when you tapped. It leaves the loop from there, and comes back onto it at the end.
   */
  loop: { at: (t: number, out: THREE.Vector3) => THREE.Vector3; clock: number };
  /** The camera out on the shelf, where it is now */
  cam0: THREE.Vector3;
  look0: THREE.Vector3;
  fov0: number;
  /** The team's size out on its loop, seen from the shelf (life-size is LIFE) */
  toy: number;
  /** Where the camera ends up, back out on the shelf */
  away: { cam: THREE.Vector3; look: THREE.Vector3; fov: number };
  /** The glass ball */
  glass: { centre: THREE.Vector3; radius: number };
};

export type View = { pos: THREE.Vector3; look: THREE.Vector3; fov: number; up: THREE.Vector3; exact: boolean };

export const LIFE = 0.9;
const G = 9.81;
const SLIDE_T = 0.8;
/** How long the camera takes to come in from the shelf and catch up behind the sleigh */
const T_ENTER = 3.6;

export function createDive(
  plan: DivePlan,
  town: TownStage,
  room: RoomStage,
  team: Team,
  onBeat: (b: DiveBeat) => void
) {
  const UP = new THREE.Vector3(0, 1, 0);
  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();
  const tmp3 = new THREE.Vector3();
  const C = plan.glass.centre;
  const outFrom = new THREE.Vector3(C.x, 0, C.z);
  const sq = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

  // ---- The flyover: off the loop, down to the tree, round it, along the roofs to the ridge ----
  const ridgeY = town.ridge.y - 0.1;
  const park = new THREE.Vector3(0.6, ridgeY, 0);
  const touch = new THREE.Vector3(park.x + 0.5 * 6.0 * SLIDE_T, ridgeY, 0);
  const tree = town.tree;
  const loopAt = plan.loop.at;
  const clock0 = plan.loop.clock;
  const loopVel = (t: number, out: THREE.Vector3) =>
    out.subVectors(loopAt(t + 0.05, tmp), loopAt(t - 0.05, tmp2)).divideScalar(0.1);
  const from = loopAt(clock0, new THREE.Vector3());
  const fromV = loopVel(clock0, new THREE.Vector3());
  const v0 = Math.max(8, fromV.length());
  const ahead = from.clone().addScaledVector(fromV.clone().normalize(), v0 * 1.1);
  // Round the tree: in from the south, heading north, once round
  const ring = [
    sq(tree.x + 12, 17, tree.z + 1),
    sq(tree.x, 16, tree.z - 11.5),
    sq(tree.x - 12, 15.5, tree.z),
    sq(tree.x, 15, tree.z + 12),
    sq(tree.x + 12.5, 14.5, tree.z),
  ];
  const pre = ring[0].clone().add(sq(1, 5, 18));
  // On the way down from the loop: high enough over the roofs (and the town hall's tower)
  const mid = ahead.clone().lerp(pre, 0.5);
  mid.y = Math.max(mid.y, 30) + 8;
  const fly = new PacedCurve(
    [
      from,
      ahead,
      mid,
      pre,
      ...ring,
      sq(16.5, 13.5, 7),
      sq(11, ridgeY + 2.2, 0.4),
      sq(6.5, ridgeY + 0.9, 0),
      touch.clone(),
    ],
    [v0, v0 * 1.12, 25, 19, 15.5, 15, 14.5, 14, 13, 12, 9.5, 7.5, 6]
  );
  /** When it reaches the tree, and when it's been round it */
  const T_RING = fly.tAtPoint(4);
  const T_RING_END = fly.tAtPoint(8);
  const T_D = fly.duration;
  const T_E = T_D + SLIDE_T;
  // On the roof
  const T_STAND = T_D + 0.9;
  // Time to get a present out of the sack and wind up
  const T_THROW = T_STAND + 1.1;
  const THROW_T = 0.85;
  const T_IN = T_THROW + THROW_T;
  // Down the chimney and in
  const T_DIVE = T_IN + 0.15;
  const T_FLUE = T_DIVE + 2.5;
  const T_ARCH = T_FLUE + 0.9;
  // The present's story, from when it lands
  const T_LAND = T_IN + 1.9;
  const story = room.story(T_LAND);
  // Out of the window and away
  const T_OPEN = story.end + 0.6;
  const T_WIN = T_OPEN + 1.8;
  const T_OUT = T_WIN + 0.8;
  const T_F = T_OUT + 0.8;

  // ---- Takeoff: along the ridge, off the roof, a wide climbing turn over the square ----
  const lift = new PacedCurve(
    [
      park.clone(),
      sq(park.x - 3, ridgeY + 0.05, 0),
      sq(-9, ridgeY + 1.8, -0.6),
      sq(-15, 17, -9),
      sq(-11, 26, -27),
      sq(2, 37, -40),
      sq(16, 48, -44),
    ],
    [0.6, 5, 9, 13, 16, 19, 21]
  );
  const T_G = T_F + lift.duration;
  // ---- Away: up and round, back onto the loop, where it would have got to by then ----
  const liftEnd = lift.curve.getPoint(1);
  const liftDir = lift.curve.getTangent(1);
  let T_J = T_G + 4;
  for (let k = 0; k < 3; k++)
    T_J = T_G + THREE.MathUtils.clamp(liftEnd.distanceTo(loopAt(clock0 + T_J, tmp)) / 22, 2.8, 6.5);
  const awayDur = T_J - T_G;
  const away = new TimeSpline([
    { t: T_G, p: liftEnd, v: liftDir.clone().multiplyScalar(21) },
    { t: T_J, p: loopAt(clock0 + T_J, new THREE.Vector3()), v: loopVel(clock0 + T_J, new THREE.Vector3()) },
  ]);
  /** The camera's way out: up over the square, then back out through the glass to the shelf */
  const outDur = 4.2;
  const T_END = Math.max(T_G + awayDur, T_G + 0.6 + outDur);

  /** Where the sleigh is at time T */
  const sleighAt = (T: number, out: THREE.Vector3) => {
    if (T < T_D) return fly.at(T, out);
    if (T < T_E) {
      const tau = T - T_D;
      return out.copy(touch).setX(touch.x - (6.0 * tau - (0.5 * 6.0 * tau * tau) / SLIDE_T));
    }
    if (T < T_F) return out.copy(park);
    if (T < T_G) return lift.at(T - T_F, out);
    if (T < T_J) return away.at(T, out);
    return loopAt(clock0 + T, out);
  };
  /** The team's size: toy-sized out on the loop, life-size down in the town */
  const scaleAt = (T: number) => {
    if (T < T_ENTER) return THREE.MathUtils.lerp(plan.toy, LIFE, smoother(0.3, T_ENTER - 0.4, T));
    if (T < T_G) return LIFE;
    return THREE.MathUtils.lerp(LIFE, plan.toy, smoother(T_G, T_J, T));
  };
  /** Which way it faces when it isn't going anywhere */
  const restDir = (out: THREE.Vector3) => out.set(-1, 0, 0);

  // ---- Posing the team ----
  const qSleigh = new THREE.Quaternion();
  const qWant = new THREE.Quaternion();
  const basis = new THREE.Matrix4();
  const fwd = new THREE.Vector3();
  const side = new THREE.Vector3();
  const up = new THREE.Vector3();
  const pA = new THREE.Vector3();
  const pB = new THREE.Vector3();
  const pC = new THREE.Vector3();
  const vel = new THREE.Vector3();
  const acc = new THREE.Vector3();
  let firstPose = true;
  const deerPhase = team.deer.map((_, k) => k * 0.55 + (k % 2) * 0.3);
  const deerQ = team.deer.map(() => new THREE.Quaternion());
  const deerAt = team.deer.map(() => new THREE.Vector3());
  const bounce = new Spring(150, 11);
  const nod = new Spring(90, 8);

  /** Heading and bank of a thing following the sleigh's way at time T: a coordinated turn, so its up leans into the curve */
  const orient = (T: number, k: number, out: THREE.Quaternion) => {
    const h = 0.06;
    sleighAt(T - h, pA);
    sleighAt(T, pB);
    sleighAt(T + h, pC);
    vel.subVectors(pC, pA).divideScalar(2 * h);
    acc
      .copy(pC)
      .addScaledVector(pB, -2)
      .add(pA)
      .divideScalar(h * h);
    const speed = vel.length();
    if (speed < 0.05 * k) restDir(fwd);
    else fwd.copy(vel).divideScalar(speed);
    if (T > T_G) climbNoSteeper(fwd);
    // Lean into the turn: up tilts toward where it's being pulled, against gravity's pull down
    const g = (G * k) / LIFE;
    up.copy(UP)
      .multiplyScalar(g)
      .add(acc.addScaledVector(fwd, -acc.dot(fwd)).multiplyScalar(speed < 0.05 * k ? 0 : 1));
    // Never more than about 55 degrees of bank
    const lean = up.clone().addScaledVector(UP, -up.dot(UP));
    const maxLean = g * 1.4;
    if (lean.length() > maxLean) up.copy(UP).multiplyScalar(g).add(lean.setLength(maxLean));
    up.normalize();
    side.crossVectors(up, fwd).normalize();
    up.crossVectors(fwd, side).normalize();
    basis.makeBasis(side, up, fwd);
    return out.setFromRotationMatrix(basis);
  };

  /** Climbing away, it's drawn climbing at most MAX_CLIMB, so it doesn't look like a rocket */
  const MAX_CLIMB = (30 * Math.PI) / 180;
  const awayHeading = liftDir.clone().setY(0).normalize();
  const hz = new THREE.Vector3();
  const climbNoSteeper = (f: THREE.Vector3) => {
    const rise = f.dot(UP);
    hz.copy(f).addScaledVector(UP, -rise);
    if (hz.lengthSq() < 0.04) hz.copy(awayHeading);
    hz.normalize();
    const climb = Math.max(-MAX_CLIMB, Math.min(Math.asin(THREE.MathUtils.clamp(rise, -1, 1)), MAX_CLIMB));
    return f.copy(hz).multiplyScalar(Math.cos(climb)).addScaledVector(UP, Math.sin(climb));
  };

  /** Where a deer goes: as far ahead along the way as its place in the team, and across by its place in the pair */
  const deerOnPath = (T: number, ahead: number, across: number, k: number, out: THREE.Vector3, q: THREE.Quaternion) => {
    sleighAt(T, pA);
    let walked = 0;
    let t = T;
    const prev = pB.copy(pA);
    const step = 1 / 90;
    let found = false;
    // Moving? March ahead along the way until it's gone far enough
    sleighAt(T + 0.05, pC);
    if (pC.distanceTo(pA) > 0.02 * k) {
      for (let i = 0; i < 360; i++) {
        t += step;
        sleighAt(t, pC);
        const ds = pC.distanceTo(prev);
        if (walked + ds >= ahead) {
          const f = (ahead - walked) / Math.max(ds, 1e-6);
          out.copy(prev).lerp(pC, f);
          found = true;
          break;
        }
        walked += ds;
        prev.copy(pC);
      }
    }
    if (!found) {
      // Stopped (or the way runs out): on in a straight line the way it faces
      restDir(tmp);
      out.copy(prev).addScaledVector(tmp, ahead - walked);
    }
    orient(Math.max(T, t), k, q);
    side.set(1, 0, 0).applyQuaternion(q);
    out.addScaledVector(side, across * k);
    return out;
  };

  const poseTeam = (T: number, dt: number) => {
    const k = scaleAt(T);
    sleighAt(T, pA);
    const at = tmp.copy(pA);
    orient(T, k, qWant);
    if (firstPose) {
      qSleigh.copy(qWant);
      firstPose = false;
    } else {
      qSleigh.slerp(qWant, 1 - Math.exp(-dt * 7));
    }
    // Touchdown's bump and the nose settling
    const onRoof = T >= T_D && T < T_F + 0.6;
    const q = qSleigh.clone();
    if (onRoof) {
      at.y += bounce.step(dt);
      q.multiply(new THREE.Quaternion().setFromAxisAngle(tmp3.set(1, 0, 0), nod.step(dt) * 0.25));
    }
    const flying = !(T >= T_D + 0.3 && T < T_F);
    team.poseSleigh(at, q, k, T, flying ? 1 : 0);
    // How fast it's going, in its own lengths a second: the deer's stride follows
    sleighAt(T + 0.05, pB);
    const pace = pB.distanceTo(pA) / 0.05 / k;
    team.slots.forEach(([x, z], i) => {
      deerOnPath(T, z * k, x, k, deerAt[i], deerQ[i]);
      const freq = THREE.MathUtils.clamp(0.9 + pace * 0.09, 1.1, 2.6);
      deerPhase[i] += dt * Math.PI * 2 * freq;
      const stride = THREE.MathUtils.clamp(pace / 3, 0, 1);
      // Standing on the roof: feet down on the ridge, a toss of the head now and then
      const stand = T >= T_D + 0.4 && T < T_F ? 1 : 0;
      const toss = Math.max(0, Math.sin(T * 0.9 + i * 1.7)) ** 6 * 0.35 - 0.05;
      team.poseDeer(i, {
        at: deerAt[i],
        q: deerQ[i],
        scale: k,
        phase: deerPhase[i],
        stride: stand ? 0 : Math.max(0.2, stride),
        lift: stand ? 0.0 : 0.3,
        idle: stand ? toss : 0,
      });
    });
  };

  // ---- The present on the roof: thrown, in at the top of the chimney ----
  const gift = new Body(0.08);
  let thrown = false;
  const inHand = new THREE.Quaternion();
  /** Santa's right arm through the throw: reaching back into the sack, held up, wound back, flung, back to the reins */
  const ARM: [number, number, number][] = [
    [0, 0, 0],
    [0.35, -2.5, -0.55],
    [0.62, -2.0, -0.2],
    [0.98, -2.7, -0.1],
    [1.16, -0.8, 0],
    [1.6, -0.3, 0],
    [2.2, 0, 0],
  ];
  const armSwing = new THREE.Vector2();
  const armAt = (T: number, out: THREE.Vector2) => {
    const s = T - T_STAND;
    if (s <= 0) return out.set(0, 0);
    for (let i = 0; i < ARM.length - 1; i++) {
      const [t0, x0, z0] = ARM[i];
      const [t1, x1, z1] = ARM[i + 1];
      if (s <= t1) {
        const u = smooth(t0, t1, s);
        return out.set(x0 + (x1 - x0) * u, z0 + (z1 - z0) * u);
      }
    }
    return out.set(0, 0);
  };

  // ---- The camera ----
  const view: View = {
    pos: new THREE.Vector3(),
    look: new THREE.Vector3(),
    fov: plan.fov0,
    up: UP.clone(),
    exact: true,
  };
  const chaseLook = new THREE.Vector3();
  const follow = new Follow(4.5);
  const followLook = new Follow(5.5);
  const camDir = new THREE.Vector3();
  // The landing: down to roof height up the street, then a three-quarter view of the ridge
  const roofView = new TimeSpline([
    { t: T_D - 3.2, p: sq(15, 15.5, 16) },
    { t: T_D - 0.6, p: sq(7.5, 13.2, 8.5) },
    { t: T_STAND, p: sq(-1.2, 12.6, 6.4) },
    { t: T_THROW + 0.3, p: sq(-1.6, 12.4, 5.6) },
    { t: T_IN - 0.15, p: town.chimney.clone().add(sq(0.0, 2.6, 1.5)) },
    { t: T_DIVE + 0.35, p: town.chimney.clone().add(sq(0, 1.2, 0.05)) },
  ]);
  const flue = room.flue;
  const camRoom = room.camera;

  /** Behind, above and a little to the side of the sleigh, as far back as the team is big */
  const chase = (T: number, out: THREE.Vector3, look: THREE.Vector3) => {
    const k = scaleAt(T);
    sleighAt(T, pA);
    sleighAt(T + 0.1, pB);
    fwd.subVectors(pB, pA);
    if (fwd.lengthSq() < 1e-8) fwd.set(-1, 0, 0);
    fwd.normalize();
    const flat = tmp2.copy(fwd).setY(0);
    if (flat.lengthSq() < 1e-6) flat.set(0, 0, -1);
    flat.normalize();
    // Closing in as it comes down over the roofs, then down to roof height up the street
    const x = smooth(1.5, 7, T);
    let back = THREE.MathUtils.lerp(22, 13, x);
    let above = THREE.MathUtils.lerp(10, 4.5, x);
    let aside = THREE.MathUtils.lerp(5, 4, x);
    if (T > T_F) {
      // Away off the roof: up and back where the roofs can't get in the way
      const y = smooth(T_F, T_F + 3, T);
      back = THREE.MathUtils.lerp(back, 15, y);
      above = THREE.MathUtils.lerp(above, 9, y);
      aside = THREE.MathUtils.lerp(aside, 2, y);
    }
    side.crossVectors(UP, flat).normalize();
    camDir.copy(flat).multiplyScalar(-back).addScaledVector(UP, above).addScaledVector(side, aside);
    out.copy(pA).addScaledVector(camDir, k);
    look.copy(pA).addScaledVector(fwd, 5 * k);
    return out;
  };

  let started = false;
  const beats = new Set<DiveBeat>();
  const beat = (b: DiveBeat) => {
    if (beats.has(b)) return;
    beats.add(b);
    onBeat(b);
  };
  const want = new THREE.Vector3();
  const wantLook = new THREE.Vector3();
  const startDir = new THREE.Vector3();
  const endDir = new THREE.Vector3();
  const qd = new THREE.Quaternion();
  const corner = sq(tree.x + 17, 21, tree.z + 19);
  const roofLook = new THREE.Vector3();
  const rollHint = new THREE.Vector3();
  // Straight up over the open square (no roofs there to graze), quickly up past the town hall's ridge
  const crane = new TimeSpline([
    { t: T_F + 1.5, p: sq(4.5, 7.5, 13) },
    { t: T_F + 3.2, p: sq(8, 26, 15) },
    { t: T_F + 5.2, p: sq(15, 38, 22) },
    { t: T_G + 0.6, p: sq(20, 47, 32) },
  ]);

  /** Out from `centre` along a way that turns steadily, the distance changing steadily in log terms */
  const logLerp = (centre: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, x: number, out: THREE.Vector3) => {
    startDir.subVectors(a, centre);
    endDir.subVectors(b, centre);
    const r0 = Math.max(1e-3, startDir.length());
    const r1 = Math.max(1e-3, endDir.length());
    startDir.divideScalar(r0);
    endDir.divideScalar(r1);
    qd.setFromUnitVectors(startDir, endDir);
    const dir = tmp3.copy(startDir).applyQuaternion(new THREE.Quaternion().slerp(qd, x));
    return out.copy(centre).addScaledVector(dir, Math.exp(Math.log(r0) + (Math.log(r1) - Math.log(r0)) * x));
  };

  let wasInside = false;
  const camera = (T: number, dt: number) => {
    let fov = THREE.MathUtils.lerp(plan.fov0, town.fov, smooth(0.4, T_ENTER, T));
    view.up.copy(UP);
    let exact = false;
    if (T < T_FLUE) {
      sleighAt(T, pA);
      chase(T, tmp, chaseLook);
      want.copy(tmp);
      wantLook.copy(chaseLook);
      if (T < T_ENTER) {
        // In from the shelf: round to behind the sleigh, the distance to it falling off steadily
        const x = smoother(0, T_ENTER, T);
        logLerp(pA, plan.cam0, tmp, x, want);
        wantLook.copy(plan.look0).lerp(chaseLook, smoother(0, T_ENTER * 0.75, T));
        exact = true;
      }
      // Holding at the square's corner while he goes round the tree
      const enter = smoother(T_D - 3.2, T_D - 1.8, T);
      const hold =
        smoother(T_RING - 0.6, T_RING + 0.8, T) * (1 - smoother(T_RING_END - 0.4, T_RING_END + 0.8, T)) * (1 - enter);
      want.lerp(corner, hold * 0.85);
      wantLook.lerp(tmp2.copy(pA).lerp(tree.clone().setY(9), 0.35), hold);
      // The roof
      roofView.at(T, tmp);
      if (T < T_THROW)
        roofLook
          .copy(pA)
          .add(sq(0, 0.8, 0))
          .lerp(town.chimney, smooth(T_D, T_THROW, T) * 0.45);
      else if (T < T_IN) roofLook.copy(thrown ? gift.p : town.chimney).lerp(town.chimney, 0.4);
      else roofLook.copy(town.chimney).add(sq(0, -5, -0.04));
      want.lerp(tmp, enter);
      wantLook.lerp(roofLook, enter);
      if (T > T_DIVE + 0.35) {
        // Down: in quickly past the snow on the rim, easing as the glow comes up from the bottom
        const u = Math.min(1, (T - T_DIVE - 0.35) / (T_FLUE - T_DIVE - 0.35));
        const x = 1 - Math.pow(1 - u, 2.4);
        want.lerp(flue.bottom.clone().add(sq(0, 0.5, -0.02)), x * smooth(0, 0.08, u));
        wantLook.lerp(tmp.copy(want).add(sq(0, -1, 0.03)), smooth(T_DIVE + 0.35, T_DIVE + 0.9, T));
      }
      fov += 10 * smooth(T_IN, T_FLUE, T);
    } else if (T < T_OPEN) {
      // Out under the arch into the room, then the present's story
      const r = room.view(T, T_FLUE, T_ARCH);
      want.copy(r.pos);
      wantLook.copy(r.look);
      fov = r.fov;
    } else if (T < T_F + 1.5) {
      // Over to the window as it flies open; through it; out over the square and up to the roof
      const x = smoother(T_OPEN, T_WIN, T);
      const y = smoother(T_WIN - 0.2, T_OUT + 0.4, T);
      const z = smoother(T_OUT, T_F + 1.5, T);
      want
        .lerpVectors(camRoom.at, room.windowIn, x)
        .lerp(room.windowOut, y)
        .lerp(sq(4.5, 7.5, 13), z);
      wantLook
        .lerpVectors(camRoom.look, room.windowOut.clone().add(sq(0, 0.2, 4)), x)
        .lerp(park.clone().add(sq(-2, 0.8, 0)), z);
      fov = THREE.MathUtils.lerp(camRoom.fov, town.fov, y);
    } else {
      // Up like a crane over the square, watching them climb away over the town; then back out
      // through the glass to the shelf
      crane.at(Math.min(T, T_G + 0.6), want);
      sleighAt(T, pA);
      wantLook.copy(park.clone().add(sq(-2, 0.8, 0))).lerp(pA.add(sq(0, 0.6, 0)), smoother(T_F + 0.2, T_F + 1.6, T));
      const y = smoother(T_G + 0.6 - outDur * 0.2, T_END, T);
      // Turning about the middle of the town's ground, not the ball's: from the crane, high over
      // the square, round and out through the front of the glass, well clear of the base
      if (y > 0) logLerp(outFrom, want, plan.away.cam, y, want);
      wantLook.lerp(plan.away.look, smoother(T_END - outDur * 0.7, T_END, T));
      fov = THREE.MathUtils.lerp(town.fov, plan.away.fov, y);
      exact = y > 0;
    }
    // Looking straight down the flue there's no up: turn slowly round as it falls so the top of the
    // picture ends up away from the hearth, and it comes out under the arch the right way up
    const down = smooth(T_DIVE + 0.35, T_DIVE + 0.9, T) * (1 - smooth(T_FLUE, T_ARCH + 0.4, T));
    if (down > 0) {
      const turn = Math.PI * smoother(T_DIVE + 0.6, T_FLUE - 0.2, T);
      rollHint.set(Math.sin(turn), 0, -Math.cos(turn)).multiplyScalar(down);
      view.up.add(rollHint).normalize();
    }
    // In close the camera follows like a person would hold it; on the way in and out it's exactly where it's put
    if (!exact && started) {
      follow.step(want, dt);
      followLook.step(wantLook, dt);
      view.pos.copy(follow.x);
      view.look.copy(followLook.x);
    } else {
      follow.reset(want);
      followLook.reset(wantLook);
      view.pos.copy(want);
      view.look.copy(wantLook);
    }
    view.fov = fov;
    view.exact = exact;
    started = true;
    // Through the glass
    const inside = view.pos.distanceTo(C) < plan.glass.radius;
    if (inside && !wasInside && T < T_D) beat('enter');
    if (!inside && wasInside && T > T_F) beat('exit');
    wasInside = inside;
  };

  // ---- Running it ----
  const update = (T: number, dt: number) => {
    poseTeam(T, dt);

    if (T >= T_D && !beats.has('landed')) {
      beat('landed');
      bounce.kick(-1.1);
      nod.x = 0.3;
      nod.kick(0.6);
      town.landed(touch, team);
    }
    // Santa up out of his seat, a present out of the sack behind him, held up, the wind-up, the throw
    const santa = team.santa;
    const upNow = smooth(T_STAND, T_STAND + 0.3, T) * (1 - smooth(T_THROW + 0.9, T_THROW + 1.4, T));
    const wind = smooth(T_THROW - 0.4, T_THROW - 0.12, T) * (1 - smooth(T_THROW - 0.12, T_THROW + 0.1, T));
    const fling = smooth(T_THROW - 0.12, T_THROW + 0.06, T) * (1 - smooth(T_THROW + 0.2, T_THROW + 0.6, T));
    santa.position.set(0, 0.25 * upNow, 0);
    // Turned to his left, where the chimney is, leaning into it
    santa.rotation.set(-wind * 0.22 + fling * 0.2, 0.6 * upNow, 0);
    armAt(T, armSwing);
    team.santaArm.rotation.set(armSwing.x, 0, armSwing.y);
    // His right rein in his left hand while the right is busy
    team.hold.right = smooth(T_STAND, T_STAND + 0.2, T) * (1 - smooth(T_THROW + 0.7, T_THROW + 1.2, T));
    // The present in his hand, from when he has it out of the sack until he lets it go
    const holding = T >= T_STAND + 0.35 && !thrown;
    if (holding || (T >= T_THROW && !thrown && T < T_IN)) {
      team.handRight.updateMatrixWorld(true);
      team.handRight.getWorldPosition(tmp);
      town.root.worldToLocal(tmp);
    }
    if (holding && T < T_THROW) town.present(tmp, inHand.setFromAxisAngle(tmp2.set(0, 1, 0), T * 0.8));
    if (T >= T_THROW && !thrown && T < T_IN) {
      thrown = true;
      gift.throwTo(tmp, town.chimney.clone().add(sq(0, 0.25, 0)), THROW_T, G);
      gift.w.set(5.5, 2.2, -1.2);
      gift.q.identity();
      beat('throw');
    }
    if (thrown && T < T_IN) {
      gift.step(dt, G, null);
      town.present(gift.p, gift.q);
    } else if (!(holding && T < T_THROW)) {
      town.present(null, null);
    }
    if (T >= T_IN && thrown && !beats.has('chimney')) {
      beat('chimney');
      // Down the flue: the room's present carries on from here, falling
      room.drop(T, gift.v);
      town.puff();
    }
    if (T >= T_FLUE) beat('room');
    if (T >= story.hot) beat('hot');
    if (T >= story.asleep) beat('asleep');
    if (T >= T_OPEN) {
      beat('window');
      room.openWindow(T);
      // A gust of snow in through it
      if (T < T_OPEN + 1.4) town.gust(room.windowAt, tmp3.set(0, 0, -1));
    }
    if (T >= T_OUT) beat('outside');
    if (T >= T_F) beat('liftoff');
    if (T >= T_G) beat('away');
    if (T >= T_END) beat('done');
    room.update(T, dt);
    camera(T, dt);
  };

  return {
    update,
    view,
    sleighAt,
    scaleAt,
    /** When it all ends: the shelf takes over */
    end: T_END,
    times: {
      enter: T_ENTER,
      ring: T_RING,
      D: T_D,
      throw: T_THROW,
      in: T_IN,
      flue: T_FLUE,
      open: T_OPEN,
      out: T_OUT,
      F: T_F,
      G: T_G,
      end: T_END,
    },
    /** Is the camera inside the red house (or down its chimney)? The house's own walls go then, so you see the room */
    inside: (p: THREE.Vector3) =>
      (Math.abs(p.x) < 3.62 && Math.abs(p.z) < 2.84 && p.y < roofOver(p.z) - 0.2) ||
      // Down inside the brick lining: only it shows (not the roof under the chimney pot)
      (Math.abs(p.x - town.chimney.x) < 0.2 && Math.abs(p.z - town.chimney.z) < 0.075 && p.y < town.chimney.y - 0.34),
  };
}

/** The red house's roof, over a point across it (xmas_hero.py's roof_z) */
const roofOver = (z: number) => 6.2 + ((3.25 - Math.abs(z)) / 3.25) * (2.8 * 1.15 + 0.3);

export type Dive = ReturnType<typeof createDive>;
