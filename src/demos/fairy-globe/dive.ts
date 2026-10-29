import * as THREE from 'three/webgpu';

import { Body, Spring } from './physics';
import type { RoomStage } from './room';
import type { Team } from './sleigh';
import type { TownStage } from './town';
import { Follow, PacedCurve, smooth, smoother } from './track';

/**
 * Into the snow globe and out again, as a handful of still shots cut together: one clock, one team.
 *
 *   shelf     a slow push in on the glass; then, cut, down in the town
 *   square    high over the front of the square: the sleigh comes in, goes once round the tree, and
 *             off over the roofs
 *   roof      the ridge of the red house: it slides in and stops, Santa's up, and the present is
 *             lobbed into the chimney
 *   room      by the fire as the present comes down into it, too hot; further back as it runs off
 *             across the rug to the tree; in close as it sits down and drops off to sleep
 *   front     out in the square, the house: the window flies open, and the team springs off the roof
 *             and climbs away
 *   home      back out on the shelf, easing back out to where you were, the team back on its loop
 *
 * The camera never flies about. Each shot is on a tripod: at most it eases in a little, or turns
 * after what it's watching, the way a head turns; between shots, a moment of dark.
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

export type View = {
  pos: THREE.Vector3;
  look: THREE.Vector3;
  fov: number;
  up: THREE.Vector3;
  exact: boolean;
  /** How dark it's gone (0 to 1): between shots, for a moment */
  dark: number;
};

export const LIFE = 0.9;
const G = 9.81;
const SLIDE_T = 0.8;
/** How long the push in from the shelf, through the glass, to high over the square */
const T_PUSH = 3.4;

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
  const sq = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

  // ---- In: down in the town, in from the south high over the square, once round the tree, and
  // along the roofs to land on the red house's ridge ----
  const ridgeY = town.ridge.y - 0.1;
  const park = new THREE.Vector3(0.6, ridgeY, 0);
  const touch = new THREE.Vector3(park.x + 0.5 * 6.0 * SLIDE_T, ridgeY, 0);
  const tree = town.tree;
  const loopAt = plan.loop.at;
  const clock0 = plan.loop.clock;
  // Round the tree: in from the south, heading north, once round
  const ring = [
    sq(tree.x + 12, 17, tree.z + 1),
    sq(tree.x, 16, tree.z - 11.5),
    sq(tree.x - 12, 15.5, tree.z),
    sq(tree.x, 15, tree.z + 12),
    sq(tree.x + 12.5, 14.5, tree.z),
  ];
  const pre = ring[0].clone().add(sq(1, 5, 18));
  /** Where it comes in from, high over the front of the town, off to the side of the first shot */
  const meet = sq(24, 40, 70);
  const fly = new PacedCurve(
    [meet, pre, ...ring, sq(16.5, 13.5, 7), sq(11, ridgeY + 2.2, 0.4), sq(6.5, ridgeY + 0.9, 0), touch.clone()],
    [21, 21, 17.5, 17, 16.5, 16, 14.5, 13, 10, 7.5, 6]
  );
  // ---- The camera's ways (it only ever goes straight) ----
  const R = plan.glass.radius;
  /** In: straight on along the line you're looking down from the shelf, through the glass, to high over the front of the square */
  const squareAim = tree.clone().setY(8);
  const overSquare = tree.clone().setY(18);
  const inDir = plan.cam0.clone().sub(overSquare).normalize();
  const squareCam = overSquare.clone().addScaledVector(inDir, 46);
  const inFar = plan.cam0.distanceTo(overSquare);
  const pushAt = (T: number, out: THREE.Vector3) =>
    out
      .copy(overSquare)
      .addScaledVector(inDir, Math.exp(THREE.MathUtils.lerp(Math.log(inFar), Math.log(46), smoother(0, T_PUSH, T))));
  /** When it's through the glass: from then on the team's down in the town, life-size */
  let T_CUT = T_PUSH;
  for (let T = 0; T < T_PUSH; T += 0.01)
    if (pushAt(T, tmp).distanceTo(C) < R) {
      T_CUT = T;
      break;
    }
  /** When it reaches the tree */
  const T_RING = T_CUT + fly.tAtPoint(2);
  const T_D = T_CUT + fly.duration;
  const T_E = T_D + SLIDE_T;
  // On the roof
  const T_STAND = T_D + 0.9;
  // Time to get a present out of the sack and wind up
  const T_THROW = T_STAND + 1.1;
  const THROW_T = 0.85;
  const T_IN = T_THROW + THROW_T;
  /** Down the chimney after it (once it's seen going in), and out by the fire */
  const T_ROOM = T_IN + 1.45;
  /** The present on its way down the flue, a moment behind you: it comes down into the fire as you get there */
  const T_DROP = T_IN + 0.7;
  // The present's story, from when it lands
  const T_LAND = T_DROP + 1.9;
  const story = room.story(T_LAND);
  // Asleep, its eyes close; they open on the window from outside, and it draws back across the square
  // as the window flies open and they take off
  const T_FRONT = story.out;
  const T_OPEN = T_FRONT + 0.7;
  const T_F = T_FRONT + 2.9;

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
  /** Up over the roof, and straight back from there out through the glass to the shelf */
  const house = park.clone().add(sq(-0.3, 0.6, 0.6));
  const anchor = house.clone().add(sq(0, 5, 0));
  const shelfDir = plan.away.cam.clone().sub(anchor).normalize();
  const backLen = plan.away.cam.distanceTo(anchor);
  const BACK_NEAR = 14;
  const T_RISE = T_F + 1.4;
  const T_BACK = T_RISE + 2.0;
  const T_END = T_BACK + 4.2;
  const backAt = (T: number, out: THREE.Vector3) =>
    out
      .copy(anchor)
      .addScaledVector(shelfDir, BACK_NEAR * Math.exp(Math.log(backLen / BACK_NEAR) * smoother(T_BACK, T_END, T)));
  /** When it's back out through the glass: the team's back on its loop */
  let T_HOME = T_END;
  for (let T = T_BACK; T < T_END; T += 0.01)
    if (backAt(T, tmp).distanceTo(C) > R) {
      T_HOME = T;
      break;
    }

  /** Where the sleigh is at time T: on its loop while you're out on the shelf */
  const sleighAt = (T: number, out: THREE.Vector3) => {
    if (T < T_CUT || T >= T_HOME) return loopAt(clock0 + T, out);
    if (T < T_D) return fly.at(T - T_CUT, out);
    if (T < T_E) {
      const tau = T - T_D;
      return out.copy(touch).setX(touch.x - (6.0 * tau - (0.5 * 6.0 * tau * tau) / SLIDE_T));
    }
    if (T < T_F) return out.copy(park);
    return lift.at(T - T_F, out);
  };
  /** The team's size: toy-sized out on the loop, life-size down in the town */
  const scaleAt = (T: number) => (T < T_CUT || T >= T_HOME ? plan.toy : LIFE);
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
  let wasOnShelf = true;
  const deerPhase = team.deer.map((_, k) => k * 0.55 + (k % 2) * 0.3);
  const deerQ = team.deer.map(() => new THREE.Quaternion());
  const deerAt = team.deer.map(() => new THREE.Vector3());
  const bounce = new Spring(150, 11);
  /** The sleigh's bank this frame (Santa rides it out) */
  let sleighBank = 0;
  const nod = new Spring(90, 8);

  const flatSide = new THREE.Vector3();
  let bank = 0;
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
    // How far it's banked, to its right (+)
    flatSide.crossVectors(UP, fwd);
    bank = flatSide.lengthSq() > 1e-6 ? -Math.asin(THREE.MathUtils.clamp(up.dot(flatSide.normalize()), -1, 1)) : 0;
    basis.makeBasis(side, up, fwd);
    return out.setFromRotationMatrix(basis);
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
    const onShelf = T < T_CUT || T >= T_HOME;
    if (onShelf !== wasOnShelf) firstPose = true;
    wasOnShelf = onShelf;
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
    sleighBank = bank;
    // On the roof: they skid in with their forelegs out, settle onto the ridge, and before the
    // takeoff gather themselves and spring, Rudolph first and the rest after him
    const stand = smooth(T_D + 0.15, T_D + 0.9, T) * (1 - smooth(T_F - 0.1, T_F + 0.3, T));
    const brace = smooth(T_D - 0.35, T_D - 0.05, T) * (1 - smooth(T_D + 0.45, T_D + 1.1, T));
    team.slots.forEach(([x, z], i) => {
      deerOnPath(T, z * k, x, k, deerAt[i], deerQ[i]);
      const freq = THREE.MathUtils.clamp(0.9 + pace * 0.09, 1.1, 2.6);
      deerPhase[i] += dt * Math.PI * 2 * freq;
      const stride = Math.max(0.2, THREE.MathUtils.clamp(pace / 3, 0, 1)) * (1 - stand);
      const toss = Math.max(0, Math.sin(T * 0.9 + i * 1.7)) ** 6 * 0.35 - 0.05;
      const spring = T_F - 0.3 + (team.slots.length - 1 - i) * 0.05;
      team.poseDeer(i, {
        at: deerAt[i],
        q: deerQ[i],
        scale: k,
        phase: deerPhase[i],
        stride,
        lift: 0.3 * (1 - stand),
        idle: toss * stand,
        t: T,
        brace,
        rear: Math.exp(-(((T - spring) / 0.22) ** 2)) * smooth(T_D + 1, T_D + 2, T),
      });
    });
  };

  // ---- The present on the roof: thrown, in at the top of the chimney ----
  const gift = new Body(0.08);
  let thrown = false;
  let dropped = false;
  const inHand = new THREE.Quaternion();
  /**
   * Santa through the throw, from when he's up (seconds): his right arm (up-and-back -, out to his
   * right -) and his body (lean forward +, turned to his left +). Round to the sack for a present,
   * out with it, a look at the chimney, wound right back, flung, and the follow-through.
   */
  const THROW: [number, number, number, number, number][] = [
    [0, 0, 0, 0, 0],
    [0.3, -2.3, -0.35, -0.06, -0.55],
    [0.6, -1.0, -0.55, 0.0, 0.25],
    [0.82, -1.15, -0.5, 0.06, 0.5],
    [1.0, -2.9, -0.25, -0.24, 0.25],
    [1.12, -0.6, -0.1, 0.3, 0.8],
    [1.45, 0.3, -0.05, 0.2, 0.72],
    [2.1, 0, 0, 0, 0.3],
    [2.7, 0, 0, 0, 0],
  ];
  const pose5 = [0, 0, 0, 0];
  const throwAt = (T: number) => {
    const t = T - T_STAND;
    pose5.fill(0);
    if (t <= 0 || t >= THROW[THROW.length - 1][0]) return pose5;
    for (let i = 0; i < THROW.length - 1; i++) {
      const a = THROW[i];
      const b = THROW[i + 1];
      if (t > b[0]) continue;
      const u = smooth(a[0], b[0], t);
      for (let j = 0; j < 4; j++) pose5[j] = a[j + 1] + (b[j + 1] - a[j + 1]) * u;
      break;
    }
    return pose5;
  };
  /** A wave, between a and b: up, waggling, down again */
  const waving = (a: number, b: number, T: number) => smooth(a, a + 0.4, T) * (1 - smooth(b - 0.45, b, T));
  /** His own lean against the sleigh's swing, and his bounce on the seat */
  let rock = 0;
  let lean = 0;
  const jolt = new Spring(120, 9);

  // ---- The camera ----
  const view: View = {
    pos: new THREE.Vector3(),
    look: new THREE.Vector3(),
    fov: plan.fov0,
    up: UP.clone(),
    exact: true,
    dark: 0,
  };
  // Never flown about: the camera goes straight, through the glass, down to the roof, into the
  // chimney, back out through the window, out through the glass again; it turns only as a head
  // turns, after what it's watching. The only cuts are in the dark: down the flue, and when the
  // present's eyes close
  const aim = new Follow(2.4, false);
  const want = new THREE.Vector3();
  const wantLook = new THREE.Vector3();
  const beats = new Set<DiveBeat>();
  const beat = (b: DiveBeat) => {
    if (beats.has(b)) return;
    beats.add(b);
    onBeat(b);
  };
  /**
   * On to the ridge: straight in from over the square along the way it's looking, slowing as it
   * comes, the way you'd glide in to land; the team flies into the picture and slides to a stop in it
   */
  const roofAim = park.clone().add(sq(-0.4, 1.7, 0.2));
  const toSquare = squareCam.clone().sub(roofAim);
  const squareDist = toSquare.length();
  toSquare.divideScalar(squareDist);
  const ROOF_DIST = 10;
  const T_GO = T_D - 4.4;
  const T_AT = T_D - 0.1;
  /** Then in on Santa, slowly, as he gets up and turns round to the sack */
  const santaAim = park.clone().add(sq(0.15, 1.35, 0.1));
  const santaCam = santaAim.clone().addScaledVector(toSquare, 7.4);
  /** Down to the chimney to see the present go in, then straight on into its mouth after it */
  const mouth = town.chimney.clone().add(sq(0, 0.3, 0));
  const intoMouth = mouth.clone().sub(santaCam).normalize();
  /** Down the flue, past the mouth: where it looks as it goes in, so it never looks back up */
  const downFlue = mouth.clone().addScaledVector(intoMouth, 2);
  /** The window from outside, and straight back from it across the square */
  const frontCam = sq(1.8, 6.8, 16.5);
  const frontAim = sq(1.2, 5.6, 2);
  const winDir = frontCam.clone().sub(room.windowAt).normalize();
  const atWindow = room.windowAt.clone().addScaledVector(winDir, 0.9);
  const inWindow = room.windowAt
    .clone()
    .addScaledVector(winDir, -3)
    .add(sq(0, -0.4, 0));
  const sleighNow = new THREE.Vector3();
  let started = false;
  let wasInside = false;
  const camera = (T: number, dt: number) => {
    sleighAt(T, sleighNow);
    let fov = town.fov;
    let still = false;
    let dark = 0;
    if (T < T_PUSH) {
      // In from the shelf, through the glass
      pushAt(T, want);
      wantLook.copy(plan.look0).lerp(squareAim, smoother(0, T_PUSH, T));
      fov = THREE.MathUtils.lerp(plan.fov0, town.fov - 4, smoother(T_CUT - 0.4, T_PUSH, T));
      still = true;
    } else if (T < T_ROOM) {
      // Over the square as it goes round the tree; after it to the roof; the throw; into the chimney
      const onRoof = smoother(T_GO, T_AT, T);
      const glide = Math.exp(THREE.MathUtils.lerp(Math.log(squareDist), Math.log(ROOF_DIST), onRoof));
      // (Rising a little on the way, well over the top of the tree)
      want
        .copy(roofAim)
        .addScaledVector(toSquare, glide)
        .addScaledVector(UP, 8 * Math.sin(Math.PI * onRoof));
      wantLook.copy(squareAim).lerp(roofAim, smoother(T_GO, T_GO + (T_AT - T_GO) * 0.6, T));
      // Over the square, turned a little after it as it goes round the tree (not once it's off to the roof)
      wantLook.lerp(sleighNow, 0.22 * (1 - smooth(T_GO - 1.2, T_GO, T)));
      // In on Santa as he gets up and reaches round for a present
      const close = smoother(T_D + 0.4, T_THROW - 0.1, T);
      want.lerp(santaCam, close);
      wantLook.lerp(santaAim, close);
      // Him through the throw; then down after the present as it flies, to see it go in; and straight
      // on into the mouth after it, turning no more
      if (thrown && T < T_IN) wantLook.lerp(gift.p, smooth(T_THROW + 0.05, T_THROW + 0.35, T) * 0.6);
      wantLook.lerp(downFlue, smooth(T_THROW + 0.4, T_IN - 0.05, T));
      const dive = smoother(T_IN + 0.3, T_ROOM - 0.1, T);
      want.addScaledVector(intoMouth, (santaCam.distanceTo(mouth) + 0.4) * dive);
      fov = THREE.MathUtils.lerp(town.fov - 4, town.fov - 10, onRoof);
      dark = smooth(T_ROOM - 0.75, T_ROOM - 0.35, T);
    } else if (T < T_FRONT) {
      // By the fire as it comes out of the dark of the flue, and round the room after the present
      const r = room.shot(T);
      want.copy(r.pos);
      wantLook.copy(r.look);
      fov = r.fov;
      // Out of the dark; and as its eyes close, dark again
      dark = 1 - smooth(T_ROOM + 0.05, T_ROOM + 0.5, T) + smooth(T_FRONT - 0.7, T_FRONT - 0.1, T);
    } else if (T < T_RISE) {
      // From the window, straight back across the square: it flies open, and they spring off the roof
      const x = smoother(T_FRONT, T_F, T);
      want.lerpVectors(atWindow, frontCam, x);
      wantLook.lerpVectors(inWindow, frontAim, smoother(T_FRONT, T_F - 0.4, T));
      wantLook.lerp(sleighNow, 0.45 * smooth(T_F - 0.1, T_F + 1.2, T));
      fov = town.fov + 2;
      dark = 1 - smooth(T_FRONT, T_FRONT + 0.5, T);
    } else {
      // Up over the roof, watching them climb away; straight back from there to the shelf
      if (T < T_BACK) want.lerpVectors(frontCam, backAt(T_BACK, tmp), smoother(T_RISE, T_BACK, T));
      else backAt(T, want);
      const watch = 0.45 * (1 - smooth(T_BACK + 1, T_END - 1.2, T));
      wantLook
        .copy(frontAim)
        .lerp(house, smoother(T_RISE, T_BACK, T))
        .lerp(sleighNow, watch)
        .lerp(plan.away.look, smoother(T_BACK + 1, T_END, T));
      fov = THREE.MathUtils.lerp(town.fov + 2, plan.away.fov, smoother(T_BACK + 1, T_END, T));
      still = T >= T_BACK + 0.5;
    }
    // A cut only where it's dark: the look starts where it's wanted
    const cutting = !started || [T_ROOM, T_FRONT].some((c) => T >= c && T - dt < c);
    if (cutting || still) aim.reset(wantLook);
    else aim.step(wantLook, dt);
    view.pos.copy(want);
    view.look.copy(aim.x);
    view.up.copy(UP);
    view.fov = fov;
    view.exact = still;
    view.dark = Math.min(1, dark);
    started = true;
    // Through the glass
    const inside = view.pos.distanceTo(C) < R;
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
      jolt.kick(2.2);
      town.landed(touch, team);
    }
    // Santa: riding it out in the air (swaying against the turns, bouncing in his seat), turning to
    // wave as you catch up with him and as he takes off; on the roof up out of his seat, round to the
    // sack for a present, and the throw
    const upNow = smooth(T_STAND, T_STAND + 0.3, T) * (1 - smooth(T_THROW + 1.1, T_THROW + 1.6, T));
    const seat = 1 - upNow;
    // Against the bank (he stays upright-ish, so he sways), back as it surges on, forward as it brakes
    sleighAt(T - 0.1, pB);
    sleighAt(T + 0.1, pC);
    sleighAt(T, pA);
    const surge = (pC.distanceTo(pA) - pA.distanceTo(pB)) / 0.01 / Math.max(scaleAt(T), 0.05);
    rock += (sleighBank * 0.55 - rock) * (1 - Math.exp(-dt * 5));
    lean += (THREE.MathUtils.clamp(-surge * 0.012, -0.22, 0.3) - lean) * (1 - Math.exp(-dt * 4));
    const air = 1 - smooth(T_D + 0.2, T_D + 0.6, T) * (1 - smooth(T_F, T_F + 0.5, T));
    const bob = (Math.abs(Math.sin(T * 3.1)) * 0.02 + Math.sin(T * 5.3) * 0.006) * air;
    // "Ho ho ho" as they spring off: his belly shaking
    const laugh = smooth(T_F - 0.2, T_F, T) * (1 - smooth(T_F + 1.0, T_F + 1.4, T));
    const wave = Math.max(waving(T_CUT + 0.6, T_CUT + 2.8, T), waving(T_F + 0.3, T_F + 3.2, T));
    const [ax, az, tl, tt] = throwAt(T);
    team.poseSanta(
      (lean * seat + jolt.step(dt)) * (1 - wave * 0.6) + tl,
      wave * 0.8 + tt + 0.25 * upNow,
      rock * seat * air,
      0.22 * upNow + bob * seat + Math.abs(Math.sin(T * 17)) * 0.025 * laugh
    );
    const waggle = Math.sin(T * 9.5);
    team.santaArm.rotation.set(
      THREE.MathUtils.lerp(ax, -2.45 + waggle * 0.12, wave),
      0,
      THREE.MathUtils.lerp(az, -0.3 + waggle * 0.5, wave)
    );
    // His right rein in his left hand while the right is busy
    team.hold.right = Math.max(
      smooth(T_STAND, T_STAND + 0.2, T) * (1 - smooth(T_THROW + 1.2, T_THROW + 1.6, T)),
      Math.min(1, wave * 1.5)
    );
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
      town.puff();
    }
    if (T >= T_DROP && !dropped) {
      // Down the flue: the room's present carries on from here, falling
      dropped = true;
      room.drop(T, gift.v);
    }
    if (T >= T_ROOM) beat('room');
    if (T >= story.hot) beat('hot');
    if (T >= story.asleep) beat('asleep');
    if (T >= T_OPEN) {
      beat('window');
      room.openWindow(T);
      // A gust of snow in through it
      if (T < T_OPEN + 1.4) town.gust(room.windowAt, tmp3.set(0, 0, -1));
    }
    if (T >= T_FRONT) beat('outside');
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
    /** How far through the music box's tune it's got at T (0 to 1): once through, ending as it draws back out */
    score: (T: number) => THREE.MathUtils.clamp((T - 0.3) / (T_BACK + 1.2 - 0.3), -1e-4, 0.999),
    times: {
      push: T_PUSH,
      cut: T_CUT,
      ring: T_RING,
      D: T_D,
      throw: T_THROW,
      in: T_IN,
      room: T_ROOM,
      front: T_FRONT,
      open: T_OPEN,
      F: T_F,
      G: T_G,
      back: T_BACK,
      home: T_HOME,
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
