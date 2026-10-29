import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import * as TSL from 'three/tsl';
import * as THREE from 'three/webgpu';

import { createDive, LIFE, type Dive, type DiveBeat } from './dive';
import { backdrop, bank, bankHeight, base, glass, glassState, GLOBE, table, windKey } from './globe';
import { paintRoom, roomMaps } from './paint';
import { buildRoom, type RoomStage } from './room';
import { buildTeam, type Team } from './sleigh';
import { createSnow, groundFrom, type Snow } from './snow';
import { buildTown, type TownStage } from './town';
import { notesBetween, type Pitch } from './tune';

/**
 * A snow globe on a music box, on a table in a dark room at Christmas. Inside it, Rothenburg in the
 * snow, every window lit, and Santa's sleigh going round and round over the roofs.
 *
 * Shake the phone and the snow goes up in a storm and slowly settles back on the roofs; tilt it and
 * the snow drifts. Wind the key in its side and the music box plays, the globe turning slowly on
 * its base, and it starts to snow in the town; as it runs down the snow stops and settles on the
 * roofs. Turn the globe by hand and it plays too, the tune pinned round the turn so it plays as
 * fast as you turn it. Tap the glass and you go in: through it, after the sleigh down over the roofs,
 * round the tree in the square, down the chimney to a present by the fire, and back out to the shelf.
 *
 * Everything is in the town's metres: the globe is nearly 400 m across, the room kilometres wide.
 */

export type Stage = 'shelf' | 'inside';
export type GlobeHaptic = 'shake' | 'note' | 'enter' | 'land' | 'deliver' | 'home' | 'throw';
export type SoundCue = 'whoosh' | 'crackle' | 'eep' | 'twinkle' | 'bells' | 'hohoho' | 'shimmer';
/** What's said on screen as you go: in through the glass, down the chimney, morning, home */
export type Chapter = 'glass' | 'chimney' | 'morning' | 'home' | null;

export type GlobeEvents = {
  onStage: (stage: Stage) => void;
  onChapter: (chapter: Chapter) => void;
  onHaptic: (kind: GlobeHaptic) => void;
  onCue: (cue: SoundCue) => void;
  /** A pin on the music box's cylinder plucked as the globe turns */
  onNote: (pitch: Pitch, bass: boolean) => void;
};

const D2R = Math.PI / 180;
/** The lens on the shelf, and how far up the camera looks down on the globe */
const FOV = 28;
const ELEVATION = 13 * D2R;
/** What the camera looks at on the shelf: a little above the middle of the glass, so the base sits low */
const AIM = new THREE.Vector3(GLOBE.centre.x, 138, GLOBE.centre.z);
/** The music box: how fast it turns playing (rad/s), and how long a turn of winding plays for (s) */
const PLAY_SPEED = 0.33;
const WIND_PER_TURN = 26;
/** How far the key's wound (turns) before letting go of it takes you in */
const KEY_TO_GO = 0.75;
/** How long a turn of the key plays for (s) */
const WIND_PER_KEY_TURN = 14;

/** The sleigh's loop over the town, high over the roofs, in the globe's frame */
const LOOP = { x: GLOBE.centre.x, z: GLOBE.centre.z, rx: 70, rz: 62, y: 64, speed: 17 };
const loopAt = (t: number, out: THREE.Vector3) => {
  const th = (t * LOOP.speed) / ((LOOP.rx + LOOP.rz) / 2);
  return out.set(
    LOOP.x + LOOP.rx * Math.cos(th),
    LOOP.y + 4 * Math.sin(2 * th + 0.7) + 1.5 * Math.sin(3 * th),
    LOOP.z + LOOP.rz * Math.sin(th)
  );
};
/** The team's size out on its loop: a toy's, big enough to see from the shelf */
const TOY = 3.8;

export function createSnowGlobe(
  context: GPUCanvasContext & { present: () => void },
  device: GPUDevice,
  events: GlobeEvents
) {
  const canvas = context.canvas as unknown as {
    width: number;
    height: number;
    clientWidth: number;
    clientHeight: number;
  };
  let width = canvas.clientWidth;
  let height = canvas.clientHeight;
  const renderer = new THREE.WebGPURenderer({
    antialias: true,
    alpha: false,
    canvas: context.canvas as HTMLCanvasElement,
    context,
    device,
  });
  renderer.setPixelRatio(1);
  renderer.setSize(canvas.width, canvas.height, false);
  THREE.ColorManagement.enabled = false;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, width / height, 20, 40000);
  // The room's wall and the plaque, painted once the curtain's up (in build)
  const maps = roomMaps();
  const room$ = backdrop(maps);
  const stand = base(maps);
  const key = windKey(maps);
  stand.mesh.add(key.group);
  scene.add(camera, room$, table(maps), stand.mesh, stand.mirror);

  // The globe turns on its base, and everything in it with it: the stage is its frame, the axis
  // through its middle; `inner` is the globe's own frame, the town's metres
  const stage = new THREE.Group();
  stage.position.set(GLOBE.centre.x, 0, GLOBE.centre.z);
  scene.add(stage);
  stage.add(bank());
  const inner = new THREE.Group();
  inner.position.set(-GLOBE.centre.x, 0, -GLOBE.centre.z);
  stage.add(inner);
  const ball = glass(maps);
  scene.add(ball.group);

  // ---- Post: bloom on what glows, a vignette, the ripple as the camera passes through the glass ----
  const post = new THREE.RenderPipeline(renderer);
  const scenePass = TSL.pass(scene, camera);
  const color = scenePass.getTextureNode('output');
  const glowing = bloom(color, 0.34, 0.45, 0.8);
  const crossing = TSL.uniform(0);
  const fade = TSL.uniform(1);
  const fadeTo = 0;
  let fadeNow = 1;
  const vignetteAt = TSL.uniform(0.62);
  /** Down in the town, close up to all that snow, it's exposed a little darker */
  const exposure = TSL.uniform(1);
  {
    const uv = TSL.screenUV;
    const p = uv.sub(0.5);
    const r = TSL.length(p);
    // A ripple out from the middle, the colours split by it, strongest at the moment it's in the glass
    const warp = p.mul(
      TSL.sin(r.mul(34).sub(TSL.time.mul(16)))
        .mul(0.026)
        .mul(crossing)
    );
    const seen = TSL.vec3(
      color.sample(uv.add(warp.mul(1.35))).r,
      color.sample(uv.add(warp)).g,
      color.sample(uv.add(warp.mul(0.65))).b
    );
    const flash = TSL.vec3(0.55, 0.62, 0.75).mul(crossing.mul(crossing).mul(0.18));
    const lit = seen.add(glowing.rgb).add(flash).mul(exposure);
    // The highlights roll off rather than clip: lit snow stays snow, not a blown-out white
    const KNEE = 0.72;
    const soft = TSL.min(lit, KNEE).add(
      TSL.exp(
        TSL.max(lit.sub(KNEE), 0)
          .div(1 - KNEE)
          .negate()
      )
        .oneMinus()
        .mul(1 - KNEE)
    );
    const vignette = TSL.smoothstep(1.1, 0.25, TSL.length(p.mul(TSL.vec2(1.0, 1.3))));
    post.outputNode = TSL.vec4(soft.mul(TSL.mix(vignetteAt, 1, vignette)).mul(fade.oneMinus()), 1);
  }

  // ---- What's in the globe ----
  let ready = false;
  let town: TownStage | null = null;
  let room: RoomStage | null = null;
  let team: Team | null = null;
  let snow: Snow | null = null;
  let dive: Dive | null = null;
  let diveT = 0;
  /** How far through the tune it's played, in the globe */
  let score = 0;
  /** Dev: how fast the dive runs (0 holds it, for looking at a moment of it) */
  let rate = 1;
  let stageNow: Stage = 'shelf';
  const go = (s: Stage) => {
    if (stageNow === s) return;
    stageNow = s;
    events.onStage(s);
  };

  // ---- The camera on the shelf ----
  const shelf = { pos: new THREE.Vector3(), look: AIM.clone(), fov: FOV };
  /** The phone's tilt, as an offset to the camera's angle (rad), and its own slow average to come back to */
  const tilt = { yaw: 0, pitch: 0, baseYaw: 0, basePitch: 0, yawNow: 0, pitchNow: 0 };
  const shelfDistance = () => {
    const aspect = width / height;
    const half = Math.tan((FOV * D2R) / 2);
    // The glass is 187 m out from the axis: it fills most of the width of a tall screen; a wide one
    // (a folding phone open) shows the room round it
    return aspect < 1 ? Math.max(232 / (half * aspect), 420 / half) : 400 / half;
  };
  /** The way in as the curtain lifts: from close by the glass and up over it, round and back to the shelf */
  const INTRO = 4.2;
  const placeShelf = (t: number) => {
    const x = Math.min(1, t / INTRO);
    const away = 1 - x * x * x * (x * (x * 6 - 15) + 10);
    const d = shelfDistance() * Math.exp(Math.log(0.42) * away);
    const breathe = Math.sin(t * 0.21) * 1.4 * D2R;
    const yaw = tilt.yawNow + breathe - 0.55 * away;
    const el = ELEVATION + tilt.pitchNow + Math.sin(t * 0.17 + 1) * 0.6 * D2R + 0.2 * away;
    shelf.pos
      .set(Math.sin(yaw) * Math.cos(el), Math.sin(el), Math.cos(yaw) * Math.cos(el))
      .multiplyScalar(d)
      .add(AIM);
    shelf.look.copy(AIM);
    shelf.fov = FOV;
  };

  // ---- The music box ----
  const spin = { angle: 0, w: 0, held: false, wound: 0, lastW: 0, played: 0 };
  /** How far the key's been wound by hand, on top of turning with the cylinder (rad); a finger on
   *  it, how far it's wound it this time and how many clicks of the ratchet that was */
  let keyWound = 0;
  /** When the glass was last tapped: the key wiggles, it's what starts it */
  let nudgedAt = -10;
  const hand = { on: false, turns: 0, clicks: 0 };
  /** Where round the turn the tune has got to: one turn of the globe is the whole tune */
  const turnAt = () => spin.angle / (Math.PI * 2);

  // ---- The sleigh's loop ----
  let loopClock = 0;
  const posed = {
    q: new THREE.Quaternion(),
    first: true,
    phases: [] as number[],
    at: [] as THREE.Vector3[],
    qs: [] as THREE.Quaternion[],
  };
  const UP = new THREE.Vector3(0, 1, 0);
  const pA = new THREE.Vector3();
  const pB = new THREE.Vector3();
  const pC = new THREE.Vector3();
  const vel = new THREE.Vector3();
  const acc = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const side = new THREE.Vector3();
  const upV = new THREE.Vector3();
  const basis = new THREE.Matrix4();
  /** Heading and bank on the loop at loop time t: a coordinated turn, leaning into the curve */
  const orientLoop = (t: number, k: number, out: THREE.Quaternion) => {
    const h = 0.06;
    loopAt(t - h, pA);
    loopAt(t, pB);
    loopAt(t + h, pC);
    vel.subVectors(pC, pA).divideScalar(2 * h);
    acc
      .copy(pC)
      .addScaledVector(pB, -2)
      .add(pA)
      .divideScalar(h * h);
    fwd.copy(vel).normalize();
    const g = (9.81 * k) / LIFE;
    upV
      .copy(UP)
      .multiplyScalar(g)
      .add(acc.addScaledVector(fwd, -acc.dot(fwd)));
    upV.normalize();
    side.crossVectors(upV, fwd).normalize();
    upV.crossVectors(fwd, side).normalize();
    basis.makeBasis(side, upV, fwd);
    return out.setFromRotationMatrix(basis);
  };
  const qTmp = new THREE.Quaternion();
  const sleighNow = new THREE.Vector3();
  const sleighVel = new THREE.Vector3();
  const poseLoop = (t: number, dt: number) => {
    if (!team) return;
    const k = TOY;
    loopAt(t, sleighNow);
    orientLoop(t, k, qTmp);
    if (posed.first) {
      posed.q.copy(qTmp);
      posed.first = false;
    } else posed.q.slerp(qTmp, 1 - Math.exp(-dt * 7));
    team.poseSleigh(sleighNow, posed.q, k, t, 1);
    if (!posed.phases.length) {
      posed.phases = team.deer.map((_, i) => i * 0.55 + (i % 2) * 0.3);
      posed.at = team.deer.map(() => new THREE.Vector3());
      posed.qs = team.deer.map(() => new THREE.Quaternion());
    }
    team.slots.forEach(([x, z], i) => {
      // The loop's at an even pace: a deer z lengths ahead is z·k/speed seconds ahead
      const ta = t + (z * k) / LOOP.speed;
      loopAt(ta, posed.at[i]);
      orientLoop(ta, k, posed.qs[i]);
      side.set(1, 0, 0).applyQuaternion(posed.qs[i]);
      posed.at[i].addScaledVector(side, x * k);
      posed.phases[i] += dt * Math.PI * 2 * 1.7;
      team!.poseDeer(i, {
        at: posed.at[i],
        q: posed.qs[i],
        scale: k,
        phase: posed.phases[i],
        stride: 0.9,
        lift: 0.3,
        idle: 0,
        t,
      });
    });
    loopAt(t + 0.05, sleighVel)
      .sub(sleighNow)
      .divideScalar(0.05);
  };

  // ---- Build ----
  const build = async () => {
    const disc = { x: GLOBE.centre.x, z: GLOBE.centre.z, r: 132 };
    [town, room] = await Promise.all([buildTown(disc), buildRoom()]);
    if (!town || !room) return;
    paintRoom(maps);
    inner.add(town.root);
    town.root.add(room.root);
    room.root.visible = false;
    team = buildTeam(undefined, true);
    town.root.add(team.group);
    // Where snow can lie: the town's roofs and streets, the bank against the glass
    const bankAt = (x: number, z: number) => bankHeight(Math.hypot(x - GLOBE.centre.x, z - GLOBE.centre.z));
    const ground = groundFrom(
      town.parts,
      { x0: -152, z0: GLOBE.centre.z - 152, x1: 152, z1: GLOBE.centre.z + 152 },
      1.5,
      bankAt
    );
    snow = createSnow({ centre: GLOBE.centre, radius: GLOBE.radius, ground, flakes: 950, glitter: 420 });
    for (const m of snow.meshes) town.root.add(m);
    // As if it had just been picked up: the snow's swirling as the curtain lifts
    snow.shake(0.7);
    placeShelf(0);
    ready = true;
  };

  // ---- Into the globe ----
  const camLocal = new THREE.Vector3();
  const lookLocal = new THREE.Vector3();
  const toLocal = (world: THREE.Vector3, out: THREE.Vector3) => {
    inner.updateMatrixWorld(true);
    return out.copy(world).applyMatrix4(qInv.copy(inner.matrixWorld).invert());
  };
  const qInv = new THREE.Matrix4();
  /** Going in, the globe turns on its base (the short way round) back to how it stands at home, the
   *  way the way in is laid out for */
  const align = { from: 0, to: 0, dur: 0 };
  const startDive = () => {
    if (!ready || dive || !town || !room || !team) return false;
    spin.w = 0;
    spin.wound = 0;
    const off = spin.angle - Math.round(spin.angle / (Math.PI * 2)) * Math.PI * 2;
    align.from = spin.angle;
    align.to = spin.angle - off;
    align.dur = 0.4 + 1.1 * (Math.abs(off) / Math.PI);
    // Turned home, the globe's frame is the room's: the way in starts from the shelf as it is
    camLocal.copy(shelf.pos);
    lookLocal.copy(shelf.look);
    room.reset();
    dive = createDive(
      {
        loop: { at: loopAt, clock: loopClock },
        cam0: camLocal.clone(),
        look0: lookLocal.clone(),
        fov0: shelf.fov,
        toy: TOY,
        away: { cam: camLocal.clone(), look: lookLocal.clone(), fov: shelf.fov },
        glass: { centre: GLOBE.centre.clone(), radius: GLOBE.radius },
      },
      town,
      room,
      team,
      onBeat
    );
    diveT = 0;
    score = -1e-4;
    camTrack.length = 0;
    // The title and the hints go as you tap
    go('inside');
    events.onHaptic('enter');
    events.onCue('whoosh');
    return true;
  };

  const onBeat = (b: DiveBeat) => {
    if (b === 'enter') {
      go('inside');
      events.onCue('twinkle');
      events.onHaptic('enter');
    }
    if (b === 'landed') {
      events.onHaptic('land');
      events.onCue('bells');
    }
    if (b === 'throw') events.onHaptic('throw');
    if (b === 'chimney') {
      events.onCue('whoosh');
      events.onHaptic('deliver');
    }
    if (b === 'room') events.onCue('crackle');
    if (b === 'hot') {
      events.onCue('eep');
      events.onHaptic('deliver');
    }
    if (b === 'asleep') {
      events.onCue('twinkle');
      events.onHaptic('home');
    }
    if (b === 'window') events.onCue('whoosh');
    if (b === 'liftoff') {
      events.onCue('hohoho');
      events.onCue('bells');
      events.onHaptic('land');
    }
    if (b === 'exit') {
      go('shelf');
      events.onChapter('home');
      events.onCue('whoosh');
      // Out through the glass, the snow in it goes up in a flurry behind you as you draw back
      snow?.shake(0.55);
    }
    if (b === 'done') {
      // Back on the shelf: the sleigh carries on round its loop from where it came back onto it, and
      // the music box wound
      if (dive) loopClock += dive.end;
      dive = null;
      posed.first = true;
      spin.wound = WIND_PER_TURN * 0.6;
    }
  };

  // ---- Running ----
  /** Dev: the camera's way through the last dive (time, where, looking at, up, lens), for tuning it */
  const camTrack: number[][] = [];
  const cam = new THREE.Vector3();
  const look = new THREE.Vector3();
  const down = new THREE.Vector3(0, -1, 0);
  const gravity = new THREE.Vector3(0, -1, 0);
  let last = performance.now();
  let clock = 0;
  /** The shelf's own time: it stands still while the camera's away in the globe, so it comes back to just where it left */
  let shelfClock = 0;
  let failed = false;
  let onFirstFrame: (() => void) | null = null;
  void build();

  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!ready || failed || !town || !team || !snow || !room) return;
    clock += dt;
    try {
      // The phone's tilt, eased
      tilt.yawNow += (tilt.yaw - tilt.yawNow) * (1 - Math.exp(-dt * 4));
      tilt.pitchNow += (tilt.pitch - tilt.pitchNow) * (1 - Math.exp(-dt * 4));
      if (!dive) shelfClock += dt;
      placeShelf(shelfClock);

      // The music box
      if (!spin.held && !dive) {
        const playing = spin.wound > 0;
        const target = playing ? PLAY_SPEED * Math.min(1, spin.wound / 3) : 0;
        spin.w += (target - spin.w) * (1 - Math.exp(-dt * (playing ? 0.9 : 1.6)));
        spin.angle += spin.w * dt;
        if (playing) spin.wound = Math.max(0, spin.wound - dt);
      }
      if (dive) {
        // Turning home as it goes in, the water swirling after the glass
        const was = spin.angle;
        spin.angle = THREE.MathUtils.lerp(align.from, align.to, THREE.MathUtils.smootherstep(diveT + dt, 0, align.dur));
        spin.w = (spin.angle - was) / Math.max(dt, 1e-3);
      }
      const turnNow = turnAt();
      if (dive) {
        // In the globe, the music box plays the tune once through, start to end, under it all
        const k = dive.score(diveT);
        if (k > score) for (const n of notesBetween(score, k)) events.onNote(n.pitch, n.bass);
        score = Math.max(score, k);
      } else if (turnNow > spin.played) {
        // Each pin passed plucks its note
        for (const n of notesBetween(spin.played, turnNow)) events.onNote(n.pitch, n.bass);
      }
      spin.played = Math.max(spin.played, turnNow);
      if (turnNow < spin.played - 1) spin.played = turnNow;
      // The water lags behind the glass as it speeds up or slows down
      snow.spun(spin.w - spin.lastW);
      spin.lastW = spin.w;
      stage.rotation.y = spin.angle;
      stage.updateMatrixWorld(true);
      // The key, geared to the cylinder, unwinding as it plays (a turn of it for each turn's worth
      // of tune), and wound by hand
      const nudge = clock - nudgedAt;
      key.turn.rotation.x =
        -spin.angle * 1.4 + keyWound + (nudge < 1.2 ? Math.sin(nudge * 24) * 0.45 * Math.exp(-nudge * 3.5) : 0);
      // It snows while the music box plays (and always, down in the town)
      snow.snowing(!!dive || spin.wound > 0.3 || Math.abs(spin.w) > 0.06);

      if (dive) {
        diveT += dt * rate;
        // (Its last step can end it: back on the shelf from this frame)
        dive.update(diveT, dt * rate);
      }
      if (dive) {
        const v = dive.view;
        // In the globe's frame turned home, which is the room's (while it's still turning there,
        // the camera's out on the shelf where it makes no difference)
        cam.copy(v.pos);
        look.copy(v.look);
        camera.position.copy(cam);
        camera.up.copy(v.up);
        camera.lookAt(look);
        camera.fov = v.fov;
        if (__DEV__)
          camTrack.push([
            diveT,
            v.pos.x,
            v.pos.y,
            v.pos.z,
            v.look.x,
            v.look.y,
            v.look.z,
            v.up.x,
            v.up.y,
            v.up.z,
            v.fov,
          ]);
        const indoors = dive.inside(v.pos);
        town.hero.visible = !indoors;
        room.root.visible = indoors || v.pos.distanceTo(room.windowAt) < 70;
        camLocal.copy(v.pos);
        dive.sleighAt(diveT, sleighNow);
        dive
          .sleighAt(diveT + 0.05, sleighVel)
          .sub(sleighNow)
          .divideScalar(0.05);
        town.update(dt, clock, v.pos, team, !(diveT > dive.times.D + 0.3 && diveT < dive.times.F) ? 1 : 0);
      } else {
        loopClock += dt;
        poseLoop(loopClock, dt);
        camera.position.copy(shelf.pos);
        camera.up.set(0, 1, 0);
        camera.lookAt(shelf.look);
        camera.fov = shelf.fov;
        town.hero.visible = true;
        room.root.visible = false;
        toLocal(shelf.pos, camLocal);
        town.update(dt, clock, camLocal, team, 1);
      }

      // The snow: down is the phone's down, in the globe's frame
      gravity.copy(down).applyQuaternion(qTmp.copy(stage.quaternion).invert());
      snow.tilt(gravity);
      snow.stir(sleighNow, sleighVel, 9 * (dive ? dive.scaleAt(diveT) : TOY));
      snow.update(clock, dt);
      const inside = camLocal.distanceTo(GLOBE.centre) < GLOBE.radius;
      snow.draw(clock, camLocal, inside ? 26 : 0);

      // The lens: in close down in the town, out on the shelf; the glass's ripple as it's passed through
      const dGlass = camLocal.distanceTo(GLOBE.centre);
      const ground = Math.max(0.5, camLocal.y);
      camera.near = inside
        ? THREE.MathUtils.clamp(ground * 0.008, 0.012, 1)
        : THREE.MathUtils.clamp((dGlass - GLOBE.radius) * 0.05, 0.05, 20);
      camera.far = 40000;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      crossing.value = 1 - THREE.MathUtils.smoothstep(Math.abs(dGlass - GLOBE.radius), 0, 18);
      glassState.inside.value = inside ? 1 : 0;
      ball.front.visible = !inside;
      room$.position.copy(camera.position);
      room$.scale.setScalar(20000);
      // Down in the town, all that snow close up: the glow held back, the exposure down a little,
      // the corners closing in
      const k = inside ? 1 : 0;
      glowing.strength.value = THREE.MathUtils.lerp(0.34, 0.3, k);
      glowing.threshold.value = THREE.MathUtils.lerp(0.8, 0.88, k);
      vignetteAt.value = THREE.MathUtils.lerp(0.62, 0.5, k);
      exposure.value += ((inside ? 0.95 : 1) - exposure.value) * (1 - Math.exp(-dt * 3));
      // The town's lit snow and walls, down a little as the camera comes down among them (the lit
      // windows and lamps stay as bright): seen close, it's night in the town, not a white-out
      const among = inside
        ? THREE.MathUtils.smoothstep(-Math.log(Math.max(1, camLocal.y)), -Math.log(80), -Math.log(18))
        : 0;
      town.tune(THREE.MathUtils.lerp(1.1, 0.8, among));

      fadeNow += (fadeTo - fadeNow) * (1 - Math.exp(-dt * 2.2));
      // Between shots it goes dark for a moment
      fade.value = Math.max(fadeNow, dive ? dive.view.dark : 0);
      post.render();
      context.present();
    } catch (e) {
      if (__DEV__) console.error('[snow-globe]', e);
      failed = true;
      return;
    }
    if (onFirstFrame) {
      const cb = onFirstFrame;
      onFirstFrame = null;
      cb();
    }
  });

  const project = new THREE.Vector3();
  const edge = new THREE.Vector3();
  return {
    /** Shaken (the phone, or a flick): 0 to about 1.5 */
    shake(strength: number) {
      if (!snow) return;
      snow.shake(strength);
      events.onHaptic('shake');
      events.onCue('shimmer');
    },
    /** The phone's gravity, in its own axes (x right, y up the screen, z out of it), in g */
    motion(x: number, y: number, z: number) {
      // Snow drifts to the low side, but no more than a good tilt's worth
      const v = new THREE.Vector3(x, y, z).applyQuaternion(camera.quaternion);
      down.set(0, -1, 0).lerp(v.normalize(), 0.65).normalize();
      // The camera leans with the phone a little, as if you'd moved your head
      const roll = Math.atan2(x, -y);
      const pitch = Math.atan2(-z, -y);
      tilt.baseYaw += (roll - tilt.baseYaw) * 0.01;
      tilt.basePitch += (pitch - tilt.basePitch) * 0.01;
      tilt.yaw = THREE.MathUtils.clamp((roll - tilt.baseYaw) * 0.35, -0.14, 0.14);
      tilt.pitch = THREE.MathUtils.clamp((pitch - tilt.basePitch) * 0.3, -0.1, 0.1);
    },
    /** Turning the globe by hand: radians since the last call (positive turns it to the right) */
    turnBy(da: number) {
      if (dive) return;
      spin.held = true;
      spin.angle += da;
      // Winding forward plays it longer
      if (da > 0) spin.wound = Math.min(60, spin.wound + (da / (Math.PI * 2)) * WIND_PER_TURN);
    },
    /** A finger down at (x, y), in points: on the key (or near it), it takes hold of it */
    holdKey(x: number, y: number) {
      key.turn.updateMatrixWorld(true);
      project.set(16, 0, 0).applyMatrix4(key.turn.matrixWorld).project(camera);
      const kx = (project.x * 0.5 + 0.5) * width;
      const ky = (-project.y * 0.5 + 0.5) * height;
      hand.on = ready && !dive && Math.hypot(x - kx, y - ky) < 52;
      hand.turns = 0;
      hand.clicks = 0;
      return hand.on;
    },
    holdingKey: () => hand.on,
    /** Winding it `turns` further, each playing the tune on a while longer: how many clicks of the
     *  ratchet that passed */
    windKey(turns: number) {
      if (!hand.on || dive || turns <= 0) return 0;
      keyWound += turns * Math.PI * 2;
      spin.wound = Math.min(90, spin.wound + turns * WIND_PER_KEY_TURN);
      hand.turns += turns;
      const clicks = Math.floor(hand.turns * 4) - hand.clicks;
      hand.clicks += clicks;
      return clicks;
    },
    /** How far it's been wound since it was taken hold of, in turns */
    keyTurns: () => hand.turns,
    /** Let go of it: whether it was held */
    letGoKey() {
      const was = hand.on;
      hand.on = false;
      // Wound far enough, the music box plays, and in you go after the tune
      if (was && hand.turns >= KEY_TO_GO) startDive();
      return was;
    },
    /** Let go, turning at w rad/s */
    letGo(w: number) {
      spin.held = false;
      spin.w = THREE.MathUtils.clamp(w, -3, 3);
    },
    /** A tap at (x, y), in points: on the glass, the key gives a little turn, to show what starts it */
    tap(x: number, y: number) {
      if (!ready || dive) return false;
      project.copy(GLOBE.centre).project(camera);
      const cx = (project.x * 0.5 + 0.5) * width;
      const cy = (-project.y * 0.5 + 0.5) * height;
      edge
        .copy(camera.position)
        .sub(GLOBE.centre)
        .normalize()
        .cross(camera.up)
        .normalize()
        .multiplyScalar(GLOBE.radius)
        .add(GLOBE.centre)
        .project(camera);
      const r = Math.hypot((edge.x * 0.5 + 0.5) * width - cx, (-edge.y * 0.5 + 0.5) * height - cy);
      if (Math.hypot(x - cx, y - cy) > r * 1.05) return false;
      nudgedAt = clock;
      events.onHaptic('throw');
      return true;
    },
    /** Where the glass is on the screen, in points: its middle and radius */
    globeOnScreen() {
      project.copy(GLOBE.centre).project(camera);
      const cx = (project.x * 0.5 + 0.5) * width;
      const cy = (-project.y * 0.5 + 0.5) * height;
      edge
        .copy(camera.position)
        .sub(GLOBE.centre)
        .normalize()
        .cross(camera.up)
        .normalize()
        .multiplyScalar(GLOBE.radius)
        .add(GLOBE.centre)
        .project(camera);
      const r = Math.hypot((edge.x * 0.5 + 0.5) * width - cx, (-edge.y * 0.5 + 0.5) * height - cy);
      return { x: cx, y: cy, r };
    },
    resize(w: number, h: number, ratio: number) {
      width = w;
      height = h;
      renderer.setSize(w * ratio, h * ratio, false);
      town?.setFov(w > h ? 44 : 55);
    },
    /** Dev: go in, as a tap on the glass does */
    dive: () => startDive(),
    /** Dev: jump the dive to time T */
    seek(T: number) {
      if (dive) diveT = T;
    },
    /** Dev: run the dive slower, faster, or hold it (0) */
    rate(r: number) {
      rate = r;
    },
    /** Dev: the camera's way through the last dive, every `every`th frame */
    track(every = 2) {
      return camTrack.filter((_, i) => i % every === 0).map((r) => r.map((x) => Math.round(x * 1000) / 1000));
    },
    debug() {
      return {
        ready,
        failed,
        stage: stageNow,
        dive: dive && { T: diveT, times: dive.times },
        spin: { ...spin },
        drifting: snow?.drifting(),
        camera: camera.position.toArray(),
        near: camera.near,
      };
    },
    onFirstFrame(cb: () => void) {
      onFirstFrame = cb;
    },
    dispose() {
      renderer.setAnimationLoop(null);
      post.dispose();
      renderer.dispose();
    },
  };
}

export type SnowGlobe = ReturnType<typeof createSnowGlobe>;
