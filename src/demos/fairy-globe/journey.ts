import * as THREE from 'three/webgpu';

import { Body, Spring } from './physics';
import type { RoomStage } from './room';
import type { Team } from './sleigh';
import type { TownStage } from './town';
import { Follow, PacedCurve, smooth, smoother, TimeSpline, type Key } from './track';

/**
 * Santa's night, from the whole world down to a present under one tree and back up again, as one
 * shot: one clock, one team, one camera.
 *
 *   globe     the whole world; the team waiting in the snow at the village
 *   run       a run across the snow, up over the top of the world and right past you ("Ho ho ho!")
 *   inbound   down to Rothenburg: the distance to go falls off exponentially, so it's a steady
 *             zoom from the size of the world to the size of a street
 *   flyover   over the wall and the Plönlein, up the street, once round the tree in the square,
 *             and in along the roofs to land on the red house's ridge
 *   roof      the slide to a stop, Santa up, the present lobbed down the chimney
 *   room      after it down the flue: the present lands by the fire, too hot, runs off, sits down
 *             under the tree and drops off to sleep; it's just a present again
 *   out       the window flies open, out into the square, up to the roof as the team takes off
 *   away      after them, back up to the size of the world
 *
 * Everything is in the town's metres, y up (the globe's held still while this runs, turned so the
 * town is up). The sleigh's way is worked out ahead, so the deer can each be put where the sleigh
 * will be: they string out round a turn the way a real team does, and stand in a line ahead of it
 * on the roofs when it's stopped.
 */

export type JourneyBeat =
  | 'takeoff'
  | 'hoho'
  | 'town'
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
  | 'done';

export type JourneyPlan = {
  /** The run out of the village, keys in the town's metres (from the scene's view of the globe) */
  run: Key[];
  /** Where the team stands at the start, and which way's up there */
  village: THREE.Vector3;
  /** The middle of the globe, in the town's metres */
  centre: THREE.Vector3;
  /** The camera at the start */
  cam0: THREE.Vector3;
  look0: THREE.Vector3;
  fov0: number;
  /** Team size on the globe, in the town's metres to the model's unit */
  bigScale: number;
  /** When the run starts */
  runAt: number;
  /** Where the camera and the team should end up as the globe takes over again (town metres) */
  away: { cam: THREE.Vector3; look: THREE.Vector3; up: THREE.Vector3; fov: number; team: THREE.Vector3 };
};

export type View = { pos: THREE.Vector3; look: THREE.Vector3; fov: number; up: THREE.Vector3; exact: boolean };

const LIFE = 0.9;
const G = 9.81;
const SLIDE_T = 0.8;

export function createJourney(plan: JourneyPlan, town: TownStage, room: RoomStage, team: Team, onBeat: (b: JourneyBeat) => void) {
  const UP = new THREE.Vector3(0, 1, 0);
  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();
  const tmp3 = new THREE.Vector3();

  // ---- The run: as the scene laid it out ----
  const run = new TimeSpline(plan.run.map((k) => ({ ...k, t: k.t + plan.runAt })));
  const T_B = run.end;
  const runEnd = run.keys[run.keys.length - 1];

  // ---- The flyover: points over the town, and how fast at each ----
  const ridgeY = town.ridge.y - 0.1;
  const park = new THREE.Vector3(0.6, ridgeY, 0);
  const touch = new THREE.Vector3(park.x + 0.5 * 6.0 * SLIDE_T, ridgeY, 0);
  const tree = town.tree;
  const sq = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const fly = new PacedCurve(
    [
      sq(6, 78, 182),
      sq(1, 36, 98),
      sq(2, 25, 62),
      sq(5, 20, 40),
      sq(tree.x + 12, 17, tree.z + 1),
      sq(tree.x, 16, tree.z - 11.5),
      sq(tree.x - 12, 15.5, tree.z),
      sq(tree.x, 15, tree.z + 12),
      sq(tree.x + 12.5, 14.5, tree.z),
      sq(16.5, 13.5, 7),
      sq(11, ridgeY + 2.2, 0.4),
      sq(6.5, ridgeY + 0.9, 0),
      touch.clone(),
    ],
    [30, 26, 21, 18, 15.5, 15, 14.5, 14, 13, 12, 9.5, 7.5, 6]
  );
  const flyStart = fly.curve.getPoint(0);
  const flyDir = fly.curve.getTangent(0);
  const flyV = fly.speeds[0];

  // ---- Inbound: from the end of the run, an exponential fall to the start of the flyover ----
  const start = runEnd.p.clone();
  const vH = runEnd.v.length();
  const d0 = start.distanceTo(flyStart);
  const lambda = (vH - flyV) / d0;
  const inDur = Math.log(vH / flyV) / lambda;
  const u0 = start.clone().sub(flyStart).normalize();
  const u1 = flyDir.clone().negate();
  const qa = new THREE.Quaternion();
  const qb = new THREE.Quaternion();
  const T_C = T_B + inDur;
  const T_D = T_C + fly.duration;
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

  const inboundAt = (s: number, out: THREE.Vector3) => {
    // s: seconds to go until the flyover starts (negative)
    const x = Math.min(1, Math.max(0, (s + inDur) / inDur));
    const d = (flyV * (Math.exp(-lambda * s) - 1)) / lambda;
    qa.setFromUnitVectors(u0, u1);
    qb.identity().slerp(qa, x * x * (3 - 2 * x));
    return out.copy(u0).applyQuaternion(qb).multiplyScalar(d).add(flyStart);
  };

  // ---- Takeoff and away: along the ridge, off the roof, a wide climbing turn over the square ----
  const lift = new PacedCurve(
    [
      park.clone(),
      sq(park.x - 3, ridgeY + 0.05, 0),
      sq(-9, ridgeY + 1.8, -0.6),
      sq(-15, 17, -9),
      sq(-11, 26, -27),
      sq(2, 37, -40),
      sq(16, 50, -44),
    ],
    [0.6, 5, 9, 13, 16, 19, 23]
  );
  const T_G = T_F + lift.duration;
  const awayStart = lift.curve.getPoint(1);
  const awayDir = lift.curve.getTangent(1);
  const awayV = 23;
  const awayEnd = plan.away.team.clone();
  const dA = awayStart.distanceTo(awayEnd);
  // Speed grows exponentially with the distance gone: the reverse of the way in
  const vEnd = Math.max(awayV * 3, dA * 0.45);
  const lambdaOut = (vEnd - awayV) / dA;
  const awayDur = Math.log(vEnd / awayV) / lambdaOut;
  const v0Out = awayDir.clone();
  const v1Out = awayEnd.clone().sub(awayStart).normalize();
  const T_END = T_G + awayDur;
  const awayAt = (s: number, out: THREE.Vector3) => {
    const x = Math.min(1, Math.max(0, s / awayDur));
    const d = (awayV * (Math.exp(lambdaOut * Math.min(s, awayDur)) - 1)) / lambdaOut;
    const dir = tmp3.copy(v0Out).lerp(v1Out, smooth(0, 0.7, x)).normalize();
    // Out along the way it was going, bending round to where the globe takes him
    return out.copy(awayStart).addScaledVector(dir, d);
  };

  /** Where the sleigh is at time T, and how big the team */
  const sleighAt = (T: number, out: THREE.Vector3) => {
    if (T < plan.runAt) return out.copy(plan.village);
    if (T < T_B) return run.at(T, out);
    if (T < T_C) return inboundAt(T - T_C, out);
    if (T < T_D) return fly.at(T - T_C, out);
    if (T < T_E) {
      const tau = T - T_D;
      return out.copy(touch).setX(touch.x - (6.0 * tau - (0.5 * 6.0 * tau * tau) / SLIDE_T));
    }
    if (T < T_F) return out.copy(park);
    if (T < T_G) return lift.at(T - T_F, out);
    return awayAt(T - T_G, out);
  };
  const scaleAt = (T: number) => {
    if (T < T_B) return plan.bigScale;
    if (T < T_C) {
      sleighAt(T, tmp);
      const d = tmp.distanceTo(flyStart);
      return LIFE + (plan.bigScale - LIFE) * Math.min(1, d / d0);
    }
    if (T < T_G) return LIFE;
    sleighAt(T, tmp);
    const d = tmp.distanceTo(awayStart);
    return LIFE + (plan.bigScale - LIFE) * Math.min(1, d / dA);
  };
  /** Which way's up where it is: the globe's up out at the village, the town's here */
  const upAt = (p: THREE.Vector3, out: THREE.Vector3) => {
    out.copy(p).sub(plan.centre);
    const high = out.length() - plan.centre.length();
    out.normalize();
    // Out on the globe, the ground's up; once he's well up in the sky, or anywhere near the town, the town's
    const w = Math.max(smooth(30, 400, high), 1 - smooth(500, 3000, p.length()));
    return out.lerp(UP, w).normalize();
  };
  /** Which way it faces when it isn't going anywhere */
  const restDir = (T: number, out: THREE.Vector3) => {
    if (T < plan.runAt) return out.copy(run.keys[1].v).normalize();
    return out.set(-1, 0, 0);
  };

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
  const orient = (T: number, k: number, groundUp: THREE.Vector3, out: THREE.Quaternion) => {
    const h = 0.06;
    sleighAt(T - h, pA);
    sleighAt(T, pB);
    sleighAt(T + h, pC);
    vel.subVectors(pC, pA).divideScalar(2 * h);
    acc.copy(pC).addScaledVector(pB, -2).add(pA).divideScalar(h * h);
    const speed = vel.length();
    if (speed < 0.05 * k) restDir(T, fwd);
    else fwd.copy(vel).divideScalar(speed);
    if (T > T_G) climbNoSteeper(fwd, groundUp);
    // Lean into the turn: up tilts toward where it's being pulled, against gravity's pull down
    const g = (G * k) / LIFE;
    up.copy(groundUp).multiplyScalar(g).add(acc.addScaledVector(fwd, -acc.dot(fwd)).multiplyScalar(speed < 0.05 * k ? 0 : 1));
    // Never more than about 55 degrees of bank
    const lean = up.clone().addScaledVector(groundUp, -up.dot(groundUp));
    const maxLean = g * 1.4;
    if (lean.length() > maxLean) up.copy(groundUp).multiplyScalar(g).add(lean.setLength(maxLean));
    up.normalize();
    side.crossVectors(up, fwd).normalize();
    up.crossVectors(fwd, side).normalize();
    basis.makeBasis(side, up, fwd);
    return out.setFromRotationMatrix(basis);
  };

  /**
   * Going away the way goes nearly straight up (the tour picks him up high over the town); a team
   * climbing like that would look like a rocket. It's drawn climbing at most MAX_CLIMB, headed the
   * way it was going off the roof, and rising as it goes.
   */
  const MAX_CLIMB = (32 * Math.PI) / 180;
  const awayHeading = awayDir.clone().setY(0).normalize();
  const hz = new THREE.Vector3();
  const climbNoSteeper = (f: THREE.Vector3, groundUp: THREE.Vector3) => {
    const rise = f.dot(groundUp);
    hz.copy(f).addScaledVector(groundUp, -rise);
    if (hz.lengthSq() < 0.04) hz.copy(awayHeading).addScaledVector(groundUp, -awayHeading.dot(groundUp));
    hz.normalize();
    const climb = Math.min(Math.asin(THREE.MathUtils.clamp(rise, -1, 1)), MAX_CLIMB);
    return f.copy(hz).multiplyScalar(Math.cos(climb)).addScaledVector(groundUp, Math.sin(climb));
  };
  const lineAt = new THREE.Vector3();
  const lineQ = new THREE.Quaternion();

  /** Where a deer goes: as far ahead along the way as its place in the team, and across by its place in the pair */
  const deerPose = (T: number, ahead: number, across: number, k: number, out: THREE.Vector3, q: THREE.Quaternion) => {
    if (T > T_G) {
      // Going away: strung out ahead of the sleigh along its heading, not up the steep way it goes
      sleighAt(T, lineAt);
      upAt(lineAt, tmp2);
      orient(T, k, tmp2, lineQ);
      lineAt.addScaledVector(fwd.set(0, 0, 1).applyQuaternion(lineQ), ahead);
      const w = smooth(T_G, T_G + 0.8, T);
      if (w >= 1) {
        out.copy(lineAt);
        q.copy(lineQ);
        side.set(1, 0, 0).applyQuaternion(q);
        return out.addScaledVector(side, across * k);
      }
      // Blending over from the way along the path
      deerOnPath(T, ahead, across, k, out, q);
      side.set(1, 0, 0).applyQuaternion(lineQ);
      out.lerp(lineAt.addScaledVector(side, across * k), w);
      q.slerp(lineQ, w);
      return out;
    }
    return deerOnPath(T, ahead, across, k, out, q);
  };
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
      restDir(t, tmp);
      out.copy(prev).addScaledVector(tmp, ahead - walked);
    }
    upAt(out, tmp2);
    orient(Math.max(T, t), k, tmp2, q);
    side.set(1, 0, 0).applyQuaternion(q);
    out.addScaledVector(side, across * k);
    return out;
  };

  const poseTeam = (T: number, dt: number) => {
    const k = scaleAt(T);
    sleighAt(T, pA);
    const at = tmp.copy(pA);
    upAt(at, tmp2);
    orient(T, k, tmp2, qWant);
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
    const flying = T >= plan.runAt && !(T >= T_D + 0.3 && T < T_F);
    team.poseSleigh(at, q, k, T, flying ? 1 : 0);
    // How fast it's going, in its own lengths a second: the deer's stride follows
    sleighAt(T + 0.05, pB);
    const pace = pB.distanceTo(pA) / 0.05 / k;
    team.slots.forEach(([x, z], i) => {
      deerPose(T, z * k, x, k, deerAt[i], deerQ[i]);
      const freq = THREE.MathUtils.clamp(0.9 + pace * 0.09, 1.1, 2.6);
      deerPhase[i] += dt * Math.PI * 2 * freq;
      const stride = THREE.MathUtils.clamp(pace / 3, 0, 1);
      // Standing on the roof: feet down on the ridge, a toss of the head now and then
      const stand = T >= T_D + 0.4 && T < T_F ? 1 : 0;
      // Standing, now and then one tosses its head and looks round
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
  /**
   * Santa's right arm through the throw, (swing up and back about the shoulder, out to the side):
   * reaching back over his shoulder into the sack, the present held up, wound back, flung, back to the reins
   */
  // Seconds from when he stands up (the throw is 1.1 s after): swing, out
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
  const view: View = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: plan.fov0, up: UP.clone(), exact: false };
  const chaseLook = new THREE.Vector3();
  const follow = new Follow(4.5);
  const followLook = new Follow(5.5);
  const camDir = new THREE.Vector3();
  // The flyover's camera: behind and above at first, down to roof height up the street, round
  // the tree from the square's corner, then a three-quarter view of the ridge for the landing
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
    // Behind, above, and a little to the side, as far back as the team is big
    let back = 30;
    let above = 16;
    let aside = 6;
    if (T > T_C) {
      // Over the town: closing in, then down to roof height up the street
      const x = smooth(T_C, T_C + 5, T);
      back = THREE.MathUtils.lerp(30, 13, x);
      above = THREE.MathUtils.lerp(16, 4.5, x);
      aside = THREE.MathUtils.lerp(6, 4, x);
    }
    if (T > T_F) {
      // Away off the roof: up and back where the roofs can't get in the way, then out
      const x = smooth(T_F, T_F + 3, T);
      back = THREE.MathUtils.lerp(back, 15, x);
      above = THREE.MathUtils.lerp(above, 9, x);
      aside = THREE.MathUtils.lerp(aside, 2, x);
    }
    side.crossVectors(UP, flat).normalize();
    camDir.copy(flat).multiplyScalar(-back).addScaledVector(UP, above).addScaledVector(side, aside);
    out.copy(pA).addScaledVector(camDir, k);
    look.copy(pA).addScaledVector(fwd, 5 * k);
    return out;
  };

  let started = false;
  const beats = new Set<JourneyBeat>();
  const beat = (b: JourneyBeat) => {
    if (beats.has(b)) return;
    beats.add(b);
    onBeat(b);
  };
  const want = new THREE.Vector3();
  const wantLook = new THREE.Vector3();
  const sideLook = new THREE.Vector3();

  const corner = sq(tree.x + 17, 21, tree.z + 19);
  /** The red house's roof, over a point across it (xmas_hero.py's roof_z) */
  const roofOver = (z: number) => 6.2 + ((3.25 - Math.abs(z)) / 3.25) * (2.8 * 1.15 + 0.3);
  const roofLook = new THREE.Vector3();
  const rollHint = new THREE.Vector3();
  // Straight up over the open square (no roofs there to graze), quickly up past the town hall's ridge,
  // then on up so they're seen from above, flying away over the lit town
  const crane = new TimeSpline([
    { t: T_F + 1.5, p: sq(4.5, 7.5, 13) },
    { t: T_F + 3.2, p: sq(8, 28, 15) },
    { t: T_F + 5.2, p: sq(15, 42, 19) },
    { t: T_G + 0.6, p: sq(20, 54, 27) },
  ]);
  const qd = new THREE.Quaternion();
  const camera = (T: number, dt: number) => {
    let fov = plan.fov0;
    view.up.copy(UP);
    view.exact = false;
    if (T < plan.runAt + 0.01) {
      // The whole world, the camera drifting in a touch
      want.copy(plan.cam0).lerp(plan.look0, 0.015 * Math.min(1, T / plan.runAt));
      wantLook.copy(plan.look0);
    } else if (T < T_FLUE) {
      // Each shot blends into the next: the world while he comes, turning to watch him go by,
      // after him down to the town, holding at the square's corner while he goes round the tree,
      // the three-quarter view of the ridge as he lands, up over the chimney and down it
      const pass = run.keys[4].t;
      const watch = smoother(run.keys[3].t - 0.6, pass - 0.2, T);
      const go = smoother(pass + 0.1, T_B + 0.4, T);
      sleighAt(T, pA);
      chase(T, tmp, chaseLook);
      want.copy(plan.cam0).lerp(plan.look0, 0.015).lerp(tmp, go);
      sideLook.copy(plan.look0).lerp(pA, watch).lerp(chaseLook, go);
      // As the town opens out below, look ahead at it, then back to him
      const ahead = 0.4 * smooth(T_C - 2.4, T_C, T) * (1 - smooth(T_C, T_C + 2.5, T));
      wantLook.copy(sideLook).lerp(flyStart.clone().setY(0), ahead);
      const enter = smoother(T_D - 3.2, T_D - 1.8, T);
      const hold = smoother(T_C + fly.duration * 0.33, T_C + fly.duration * 0.45, T) * (1 - enter);
      want.lerp(corner, hold);
      wantLook.lerp(tmp2.copy(pA).lerp(tree.clone().setY(9), 0.35), hold);
      // The roof
      roofView.at(T, tmp);
      if (T < T_THROW) roofLook.copy(pA).add(sq(0, 0.8, 0)).lerp(town.chimney, smooth(T_D, T_THROW, T) * 0.45);
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
      fov = THREE.MathUtils.lerp(plan.fov0, town.fov, smooth(T_B, T_C, T)) + 10 * smooth(T_IN, T_FLUE, T);
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
      want.lerpVectors(camRoom.at, room.windowIn, x).lerp(room.windowOut, y).lerp(sq(4.5, 7.5, 13), z);
      wantLook.lerpVectors(camRoom.look, room.windowOut.clone().add(sq(0, 0.2, 4)), x).lerp(park.clone().add(sq(-2, 0.8, 0)), z);
      fov = THREE.MathUtils.lerp(camRoom.fov, town.fov, y);
    } else {
      // Up like a crane over the square, well clear of the roofs, watching them climb away over the
      // town; then back up to the size of the world
      crane.at(T, want);
      sleighAt(T, pA);
      wantLook.copy(park.clone().add(sq(-2, 0.8, 0))).lerp(pA.add(sq(0, 0.6, 0)), smoother(T_F + 0.2, T_F + 1.6, T));
      // Back out to the size of the world: the distance grows steadily in log terms, the way it shrank
      const y = smoother(T_G - 0.5, T_END, T);
      if (y > 0) {
        const r0 = want.length();
        const r1 = plan.away.cam.length();
        qd.setFromUnitVectors(tmp.copy(want).divideScalar(r0), tmp2.copy(plan.away.cam).divideScalar(r1));
        const dir = tmp.copy(want).divideScalar(r0).applyQuaternion(new THREE.Quaternion().slerp(qd, y));
        want.copy(dir).multiplyScalar(Math.exp(Math.log(r0) + (Math.log(r1) - Math.log(r0)) * y));
      }
      wantLook.lerp(plan.away.look, smoother(T_G + awayDur * 0.35, T_END, T));
      fov = THREE.MathUtils.lerp(town.fov, plan.away.fov, y);
      // Rolling round to the tour's up as it gets there
      view.up.copy(UP).lerp(plan.away.up, y).normalize();
      view.exact = y > 0;
    }
    // Looking straight down the flue there's no up: turn slowly round as it falls so the top of the
    // picture ends up away from the hearth, and it comes out under the arch the right way up
    const down = smooth(T_DIVE + 0.35, T_DIVE + 0.9, T) * (1 - smooth(T_FLUE, T_ARCH + 0.4, T));
    if (down > 0) {
      const turn = Math.PI * smoother(T_DIVE + 0.6, T_FLUE - 0.2, T);
      rollHint.set(Math.sin(turn), 0, -Math.cos(turn)).multiplyScalar(down);
      view.up.add(rollHint).normalize();
    }
    // In close the camera follows like a person would hold it; out at the size of the world it's
    // exactly where it's put (a spring there would lag by kilometres)
    const k = scaleAt(T);
    const near = k < 1.5 && T > T_C + 1;
    if (near && started) {
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
    started = true;
  };

  // ---- Running it ----
  const update = (T: number, dt: number) => {
    poseTeam(T, dt);

    // Beats along the way
    if (T >= plan.runAt) beat('takeoff');
    if (T >= run.keys[4].t - 0.45) beat('hoho');
    if (T >= T_C) beat('town');
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
    /** When it all ends: the globe takes over */
    end: T_END,
    times: { runAt: plan.runAt, B: T_B, C: T_C, D: T_D, throw: T_THROW, in: T_IN, flue: T_FLUE, open: T_OPEN, out: T_OUT, F: T_F, G: T_G },
    /** Inside the house: the house's own walls go so you see the room */
    /** Is the camera inside the red house (or down its chimney)? The house's own walls go then, so you see the room */
    inside: (p: THREE.Vector3) =>
      (Math.abs(p.x) < 3.62 && Math.abs(p.z) < 2.84 && p.y < roofOver(p.z) - 0.2) ||
      // Down inside the brick lining: only it shows (not the roof under the chimney pot)
      (Math.abs(p.x - town.chimney.x) < 0.2 && Math.abs(p.z - town.chimney.z) < 0.075 && p.y < town.chimney.y - 0.34),
  };
}
