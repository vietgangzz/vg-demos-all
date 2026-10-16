import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import * as TSL from 'three/tsl';
import * as THREE from 'three/webgpu';

import { buildDecor } from './decor';
import { buildFlora, type Town } from './flora';
import { dust, sprites } from './fx';
import { buildGlobe } from './globe';
import { hex, light, radial, shade, type V3 } from './light';
import { createJourney, type JourneyBeat } from './journey';
import { buildRoom, type RoomStage } from './room';
import { buildTown, type TownStage } from './town';
import { buildTeam } from './sleigh';
import { auroraMesh, cloudsMesh, skyMesh } from './sky';
import { geo, heroFrame, lonLat, loadWorld, STOPS, VILLAGE, type HeroFrame } from './world';

/**
 * Christmas Eve on a storybook globe. Santa takes off from his village in Lapland, under the
 * northern lights, and races midnight round the world: it reaches the islands by the date line
 * first and runs west, and so does he, a present down a chimney at every town that's still
 * sparkling. Dawn is always just behind him; the sun is set by where he is.
 *
 * It opens on the whole world. He takes off over the top of it, comes right past you, then turns
 * and dives for Rothenburg, and you go with him: one shot, the world growing under you, down to
 * its rooftops (the town is built life-size into the globe), down its chimney and into the room.
 * After that it's yours: drag to turn the globe, tap a sparkle to send him there next.
 *
 * Units: the globe's radius is 1, sea level. Everything on it is far too big for the world, but
 * the town, which is a millimetre to the metre.
 */

export type GlobeHaptic = 'takeoff' | 'deliver' | 'select' | 'home';

/** What's on: the globe; down at the town (the same scene, close in); the room */
export type Stage = 'globe' | 'town' | 'room';

export type Leg = {
  /** -1 for home */
  stop: number;
  name: string;
  note: string;
  phase: 'flying' | 'delivering' | 'home' | 'visiting';
};

export type GlobeEvents = {
  onLeg: (leg: Leg) => void;
  onGifts: (gifts: number, delivered: number) => void;
  onHaptic: (kind: GlobeHaptic) => void;
  onStage: (stage: Stage) => void;
  /** He's right by you: "Ho ho ho!", from where he is on the screen, in points */
  onHoHo: (x: number, y: number) => void;
  /** A moment in the opening that has a sound */
  onCue?: (cue: SoundCue) => void;
};

/** Air rushing down the chimney and out of the window, the fire, the present's squeak, its sleep */
export type SoundCue = 'whoosh' | 'crackle' | 'eep' | 'twinkle';

const FOV = 32;
const TEAM_SCALE = 0.021;
const CRUISE = 1.3;
const LOW = 1.06;
const LANDED = 1.028;
const SPEED = 0.62;
const TILT = -0.16;
const D2R = Math.PI / 180;

const ease = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};
const wrap = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180;

export function createFairyGlobe(
  context: GPUCanvasContext & { present: () => void },
  device: GPUDevice,
  events: GlobeEvents
) {
  const canvas = context.canvas as unknown as { width: number; height: number; clientWidth: number; clientHeight: number };
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
  const camera = new THREE.PerspectiveCamera(FOV, width / height, 0.01, 200);
  scene.add(camera, skyMesh());
  const globe = new THREE.Group();
  scene.add(globe);

  const glow = sprites(1000);
  const TRAIL = 900;
  const trail = dust(TRAIL);
  const SPARK = TRAIL;
  scene.add(glow.mesh);

  let ready = false;
  let towns: Town[] = [];
  let team: ReturnType<typeof buildTeam> | null = null;
  let clouds: ReturnType<typeof cloudsMesh> | null = null;
  let decor: ReturnType<typeof buildDecor> | null = null;
  const toCam = new THREE.Vector3();
  const qInv = new THREE.Quaternion();
  let gift: THREE.Group | null = null;

  // ---- Post: bloom on everything that glows, a soft vignette ----
  // Down at the town the glow comes up and the corners close in, the way the room's do
  const post = new THREE.RenderPipeline(renderer);
  const scenePass = TSL.pass(scene, camera);
  const color = scenePass.getTextureNode('output');
  const glowing = bloom(color, 0.32, 0.35, 0.86);
  const lit = color.rgb.add(glowing.rgb);
  const s = TSL.screenUV;
  const vignette = TSL.smoothstep(1.15, 0.3, TSL.length(s.sub(0.5).mul(TSL.vec2(1.0, 1.25))));
  const corners = TSL.uniform(0.7);
  /** Black over everything, for the moments a cut hides in */
  const fade = TSL.uniform(0);
  let fadeTo = 0;
  post.outputNode = TSL.vec4(lit.mul(TSL.mix(corners, 1, vignette)).mul(fade.oneMinus()), 1);

  // ---- The town set into the globe, the room inside its red house (baked in Blender) ----
  let stage: Stage = 'globe';
  let room: RoomStage | null = null;
  let town: TownStage | null = null;
  const go = (next: Stage) => {
    if (stage === next) return;
    stage = next;
    events.onStage(next);
  };
  const buildStages = async (frame: HeroFrame) => {
    [town, room] = await Promise.all([buildTown(frame.radius / frame.scale), buildRoom()]);
    if (!town || !room) return;
    // Set into the globe where Rothenburg is, life-size; the room in its house, the team on the roof
    town.root.position.copy(frame.position);
    town.root.quaternion.copy(frame.quaternion);
    town.root.scale.setScalar(frame.scale);
    globe.add(town.root);
    town.root.add(room.root);
    free = buildTeam(undefined, true);
    town.root.add(free.group);
    free.group.visible = false;
    town.root.updateMatrix();
    const hero = townFor(HERO);
    hero.chimney.copy(town.chimney).applyMatrix4(town.root.matrix);
    hero.treeTop.copy(hero.chimney);
    fitStages();
  };
  /** The lens down in the town: a little longer on the wide inner screen of a folding phone */
  const fitStages = () => {
    town?.setFov(width > height ? 44 : 55);
  };

  // ---- The journey ----
  const delivered = new Set<number>();
  let gifts = 0;
  let giftsShown = -1;
  let giftsAt = 0;
  type Flight = {
    from: THREE.Vector3;
    to: THREE.Vector3;
    fromAlt: number;
    toAlt: number;
    dur: number;
    t: number;
    stop: number;
  };
  const HERO = STOPS.findIndex((st) => st.hero);
  let flight: Flight | null = null;
  let phase: Leg['phase'] = 'home';
  let phaseT = 0;
  let stopAt = -1; // where he is now, -1 home
  const santa = { dir: geo(VILLAGE.lon, VILLAGE.lat).normalize(), alt: LANDED };
  const forward = new THREE.Vector3();
  let roll = 0;
  let pitch = 0;
  let lastAlt = 0;
  let groundSpeed = 0;
  let lastFwd = new THREE.Vector3();
  const lastWhere = new THREE.Vector3();

  const townFor = (stop: number) => towns[stop + 1];
  const legFor = (stop: number, p: Leg['phase']): Leg =>
    stop < 0
      ? { stop, name: VILLAGE.name, note: p === 'home' ? 'Home before sunrise' : 'Heading home', phase: p }
      : { stop, name: STOPS[stop].name, note: STOPS[stop].note, phase: p };

  const startFlight = (stop: number) => {
    const town = townFor(stop);
    const to = town.chimney.clone().normalize();
    const angle = santa.dir.angleTo(to);
    flight = {
      from: santa.dir.clone(),
      to,
      fromAlt: santa.alt,
      toAlt: stop < 0 ? LANDED : LOW,
      dur: Math.max(2.4, angle / SPEED + 0.8),
      t: 0,
      stop,
    };
    phase = 'flying';
    events.onLeg(legFor(stop, 'flying'));
  };

  /** The next town still waiting, going on west from `after`; home when they've all had theirs */
  const nextStop = (after: number) => {
    for (let k = 1; k <= STOPS.length; k++) {
      const i = (after + k + STOPS.length) % STOPS.length;
      if (!delivered.has(i)) return i;
    }
    return -1;
  };

  // ---- The view: the globe turns to keep him in front of you ----
  const view = { lon: VILLAGE.lon, lat: VILLAGE.lat };
  const drag = { lon: 0, lat: 0, vLon: 0, vLat: 0, idle: 99 };
  let focus: number | null = -1; // a town to go down to, -1 = the village at the start
  let close = 1; // 0 = the whole globe, 1 = down at the rooftops
  let pull = 1;
  let held = false;
  const qGlobe = new THREE.Quaternion();
  const qa = new THREE.Quaternion();
  const qb = new THREE.Quaternion();
  const qt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), TILT);
  const X = new THREE.Vector3(1, 0, 0);
  const Y = new THREE.Vector3(0, 1, 0);

  const orbitDistance = () => {
    const aspect = width / height;
    const half = Math.tan((FOV * D2R) / 2);
    // Tall screens: the globe nearly fills the width. Wide ones (a folding phone open): most of the height.
    return aspect < 1 ? Math.max(1.2 / (half * aspect * 0.97), 1.25 / (half * 0.62)) : 1.2 / (half * 0.84);
  };
  const camPos = new THREE.Vector3();
  const camLook = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();

  const placeCamera = (dt: number) => {
    const wantClose = focus !== null ? 1 : 0;
    close += (wantClose - close) * (1 - Math.exp(-dt * 1.5));
    const c = ease(close);
    // Pull back to keep him in frame when he's high over the world
    const reach = Math.max(1, (santa.alt + 0.18) / 1.2);
    pull += (reach - pull) * (1 - Math.exp(-dt * 1.2));
    const d = orbitDistance() * pull;
    camPos.set(0, 0.05, d).lerp(tmp.set(0, -0.2, 1.24), c);
    camLook.set(0, 0.06, 0).lerp(tmp2.set(0, 0.035, 1.0), c);
    camera.position.copy(camPos);
    camera.fov = FOV + (46 - FOV) * c;
    camera.up.set(0, 1, 0);
    camera.lookAt(camLook);
  };

  const steerGlobe = (dt: number) => {
    const here = lonLat(santa.dir);
    let lon = here.lon;
    // Seen from a little above the equator of wherever he is, so the north and its lights sit up at the top
    let lat = Math.max(-35, Math.min(36, here.lat * 0.45 + 8));
    if (focus !== null) {
      const town = townFor(focus);
      const at = lonLat(town.centre);
      // Down at the rooftops the town sits right in front, a touch south so the sky shows
      const k = ease(close);
      lon = at.lon + wrap(lon - at.lon) * (1 - k);
      lat = lat + (at.lat - lat) * k;
    }
    const k = 1 - Math.exp(-dt * (focus !== null ? 2.4 : 1.6));
    view.lon += wrap(lon - view.lon) * k;
    view.lat += (lat - view.lat) * k;
    if (!held) {
      drag.lon += drag.vLon * dt;
      drag.lat += drag.vLat * dt;
      drag.vLon *= Math.exp(-dt * 2.5);
      drag.vLat *= Math.exp(-dt * 2.5);
      drag.idle += dt;
      if (drag.idle > 2.5) {
        const back = 1 - Math.exp(-dt * 1.2);
        drag.lon -= drag.lon * back;
        drag.lat -= drag.lat * back;
      }
    }
    const vlat = Math.max(-70, Math.min(80, view.lat + drag.lat));
    qa.setFromAxisAngle(X, vlat * D2R);
    qb.setFromAxisAngle(Y, -(view.lon + drag.lon) * D2R);
    qGlobe.copy(qt).multiply(qa).multiply(qb);
    globe.quaternion.copy(qGlobe);
    globe.updateMatrixWorld(true);
  };

  // The sun follows him: about two in the morning wherever he is, dawn coming up behind
  let sunLon = VILLAGE.lon + 150;
  const sunLocal = new THREE.Vector3();
  const steerSun = (dt: number) => {
    const want = lonLat(santa.dir).lon + 150;
    sunLon += wrap(want - sunLon) * (1 - Math.exp(-dt * 0.8));
    geo(sunLon, -23.44, 1, sunLocal);
    light.sun.value.copy(sunLocal).applyQuaternion(globe.quaternion);
  };

  // ---- Santa ----
  const where = new THREE.Vector3();
  const basis = new THREE.Matrix4();
  const side = new THREE.Vector3();
  const upV = new THREE.Vector3();
  const giftFrom = new THREE.Vector3();
  let giftT = -1;
  let giftTown = -1;
  const gold = new THREE.Color('#FFD873');
  const pale = new THREE.Color('#FFF4D6');
  const rose = new THREE.Color('#FF8FB8');
  const sky = new THREE.Color('#9FE8FF');

  const fly = (dt: number, t: number) => {
    if (!team) return;
    phaseT += dt;
    let gallop = 1;
    if (phase === 'flying' && flight) {
      flight.t += dt;
      const f = Math.min(1, flight.t / flight.dur);
      // Along the ground track: a gentle start, a steady run, easing to a stop at the far end
      const e = 0.5 - 0.5 * Math.cos(Math.PI * f);
      const angle = flight.from.angleTo(flight.to);
      // Up and out into the sky, higher the further the hop, then down again to the rooftops
      const lift = Math.min(0.42, 0.12 + angle * 0.22) + (CRUISE - Math.max(flight.fromAlt, flight.toAlt)) * 0.5;
      santa.dir.copy(flight.from).lerp(flight.to, e).normalize();
      if (angle > 2.5) {
        // Nearly opposite: slerp by hand so it doesn't pass through the middle
        const q = new THREE.Quaternion().setFromUnitVectors(flight.from, flight.to);
        santa.dir.copy(flight.from).applyQuaternion(new THREE.Quaternion().slerp(q, e));
      }
      // Off the ground he runs a few strides first, then lifts and climbs steeply into the sky;
      // the way down is long and shallow, levelling out so he settles rather than drops
      const grounded = flight.fromAlt < LOW - 0.004;
      const run = grounded ? 0.1 : 0;
      const uc = Math.min(1, Math.max(0, (f - run) / (1 - run)));
      // Steep, but starting from still: no jolt as he leaves the ground
      const climb = (1 - Math.pow(1 - uc, 2.4)) * THREE.MathUtils.smoothstep(uc, 0, 0.18);
      const down = Math.pow(THREE.MathUtils.smoothstep(f, 0.45, 1), 1.2);
      const level = THREE.MathUtils.smoothstep(f, 0, 1);
      santa.alt = flight.fromAlt + (flight.toAlt - flight.fromAlt) * level + lift * climb * (1 - down);
      if (f >= 1) {
        stopAt = flight.stop;
        flight = null;
        phaseT = 0;
        if (stopAt < 0) {
          phase = 'home';
          events.onLeg(legFor(-1, 'home'));
          events.onHaptic('home');
        } else {
          phase = 'delivering';
          events.onLeg(legFor(stopAt, 'delivering'));
        }
      }
    } else if (phase === 'visiting') {
      gallop = 0.6;
    } else if (phase === 'delivering') {
      gallop = 0.6;
      if (giftT < 0 && phaseT > 0.35) {
        giftT = 0;
        giftTown = stopAt;
        team.sack.getWorldPosition(giftFrom);
        globe.worldToLocal(giftFrom);
      }
      if (phaseT > 2.3) {
        const next = nextStop(stopAt);
        if (focus === stopAt) focus = null;
        startFlight(next);
        events.onHaptic('takeoff');
      }
    } else if (phase === 'home') {
      gallop = 0.15;
      if (phaseT > (delivered.size >= STOPS.length ? 6 : 2.2)) {
        if (delivered.size >= STOPS.length) delivered.clear();
        focus = null;
        startFlight(nextStop(-1));
        events.onHaptic('takeoff');
      }
    }

    // Place the team: on its path, nose along it, banking into the turns
    where.copy(santa.dir).multiplyScalar(santa.alt);
    if (phase === 'flying' && flight) {
      if (lastWhere.lengthSq() > 0) {
        forward.subVectors(where, lastWhere);
        groundSpeed = forward.length() / Math.max(dt, 1e-3);
      }
      lastWhere.copy(where);
    } else {
      lastWhere.set(0, 0, 0);
    }
    upV.copy(santa.dir);
    if (forward.lengthSq() < 1e-10) forward.set(0, 1, 0);
    forward.addScaledVector(upV, -forward.dot(upV)).normalize();
    if (forward.lengthSq() < 0.5) forward.copy(lastFwd);
    const turn = lastFwd.lengthSq() > 0 ? new THREE.Vector3().crossVectors(lastFwd, forward).dot(upV) / Math.max(dt, 1e-3) : 0;
    roll += (Math.max(-0.5, Math.min(0.5, -turn * 0.8)) - roll) * (1 - Math.exp(-dt * 3));
    lastFwd = forward.clone();
    side.crossVectors(upV, forward).normalize();
    basis.makeBasis(side, upV, forward);
    team.group.position.copy(where);
    team.group.quaternion.setFromRotationMatrix(basis);
    team.group.rotateZ(roll);
    // Nose up climbing, down descending: the climb rate against the ground speed
    if (phase === 'flying' && lastAlt > 0) {
      const vs = (santa.alt - lastAlt) / Math.max(dt, 1e-3);
      const hs = Math.max(0.02, groundSpeed);
      pitch += (Math.atan2(vs, hs) * 0.9 - pitch) * (1 - Math.exp(-dt * 6));
    } else {
      pitch += (0 - pitch) * (1 - Math.exp(-dt * 4));
    }
    lastAlt = santa.alt;
    team.group.rotateX(-THREE.MathUtils.clamp(pitch, -0.7, 0.9));
    team.update(t, gallop);

    // Stardust off the runners
    if (phase === 'flying') {
      for (const r of team.runners) {
        r.getWorldPosition(tmp);
        globe.worldToLocal(tmp);
        for (let k = 0; k < 2; k++) {
          const c = Math.random();
          const colour = c < 0.6 ? gold : c < 0.8 ? pale : c < 0.9 ? rose : sky;
          tmp2.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.012);
          trail.emit(tmp, tmp2, 1.6 + Math.random() * 1.6, 0.006 + Math.random() * 0.012, colour, Math.random() < 0.25 ? 0.9 : 0);
        }
      }
    }

    // The present: out of the sack, over in an arc, down the chimney, and a burst of sparkles
    if (gift && giftT >= 0) {
      giftT += dt;
      const town = townFor(giftTown);
      const f = Math.min(1, giftT / 0.85);
      gift.visible = f < 1;
      gift.position.copy(giftFrom).lerp(town.chimney, f * f);
      gift.position.addScaledVector(town.chimney.clone().normalize(), Math.sin(Math.PI * f) * 0.02);
      gift.rotation.set(giftT * 5, giftT * 3, 0);
      gift.scale.setScalar(0.009 * (1 - Math.pow(f, 6) * 0.7));
      if (f >= 1) {
        giftT = -1;
        delivered.add(giftTown);
        gifts += 41_000_000 + Math.floor(Math.random() * 9_000_000);
        events.onHaptic('deliver');
        const up = town.chimney.clone().normalize();
        for (let k = 0; k < 70; k++) {
          tmp2.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(0.05);
          tmp2.addScaledVector(up, 0.06 + Math.random() * 0.05);
          const c = [gold, pale, rose, sky][k % 4];
          trail.emit(town.chimney, tmp2, 0.9 + Math.random() * 0.9, 0.006 + Math.random() * 0.01, c, 0.8);
        }
      }
    }
    if (phase === 'flying') gifts += Math.floor(dt * 9_300_000);
  };

  // ---- Sparkles over the towns still waiting, stars on the trees ----
  const sparkColour = new THREE.Color();
  const sparkAt = new THREE.Vector3();
  const sparkle = (t: number) => {
    let i = SPARK;
    towns.forEach((town, k) => {
      const stop = k - 1;
      const done = stop >= 0 && delivered.has(stop);
      const next = flight && flight.stop === stop;
      // The town you go down into lights itself; its sparkle only once it's had its present
      const hero = stop === HERO;
      if (stop >= 0 && (!hero || done)) {
        sparkAt.copy(town.centre).multiplyScalar(1.045).applyMatrix4(globe.matrixWorld);
        const pulse = 0.8 + 0.2 * Math.sin(t * 3 + k * 1.3);
        if (done) {
          sparkColour.set('#FFB25C').multiplyScalar(0.55);
          glow.set(i++, sparkAt, 0.02, sparkColour, 0, 0);
        } else {
          sparkColour.set(next ? '#FFF1B8' : '#FFE08A').multiplyScalar(next ? 1.4 : 1.0);
          glow.set(i++, sparkAt, (next ? 0.07 : 0.045) * pulse, sparkColour, 1, t * 0.4 + k);
        }
      }
      if (hero) return;
      sparkAt.copy(town.treeTop).applyMatrix4(globe.matrixWorld);
      sparkColour.set('#FFE27A').multiplyScalar(0.9 + 0.3 * Math.sin(t * 5 + k));
      glow.set(i++, sparkAt, stop < 0 ? 0.016 : 0.009, sparkColour, 1, t * 0.8 + k);
    });
    if (team?.group.visible) {
      // The sleigh's lanterns
      for (const lamp of team.lamps) {
        lamp.getWorldPosition(sparkAt);
        sparkColour.set('#FFC873').multiplyScalar(0.75 + 0.08 * Math.sin(t * 9 + sparkAt.x * 40));
        glow.set(i++, sparkAt, 0.012, sparkColour, 0, 0);
      }
      team.nose.getWorldPosition(sparkAt);
      sparkColour.set('#FF3B3B').multiplyScalar(0.8 + 0.2 * Math.sin(t * 4));
      glow.set(i++, sparkAt, 0.028, sparkColour, 0, 0);
    }
    for (; i < glow.capacity; i++) glow.hide(i);
  };

  // ---- The opening: the whole world, then one unbroken shot down to a present under a tree ----
  // While it runs the globe holds still, turned so the town is straight up: the town's own axes are
  // the world's then, and everything's worked out in its metres (journey.ts)
  let frame: HeroFrame | null = null;
  const qHero = new THREE.Quaternion();
  const qHeroInv = new THREE.Quaternion();
  const townAt = new THREE.Vector3();
  /** The team for the opening, posed deer by deer in the town's metres */
  let free: ReturnType<typeof buildTeam> | null = null;
  let journey: ReturnType<typeof createJourney> | null = null;
  let opening: { T: number } | null = null;
  const ELEVATION = 22 * D2R;
  /** How fast he's going as the run hands over to the dive, globe units a second */
  const HANDOFF_SPEED = 0.85;
  /** How long the whole world holds before he goes */
  const OPEN = 2.0;
  /** Where the tour picks up: up over Rothenburg, heading for the next town */
  const AWAY_ALT = 1.2;
  const UP = new THREE.Vector3(0, 1, 0);
  const look = new THREE.Vector3();
  const qSteer = new THREE.Quaternion();
  const awayDir = new THREE.Vector3();

  /**
   * Point the camera at `look`. Its up leans toward the sky, but only as hard as it can: looking
   * straight down there's no up to lean to, and it keeps the one it had instead of spinning round
   */
  const camUp = new THREE.Vector3(0, 1, 0);
  const viewDir = new THREE.Vector3();
  const upWant = new THREE.Vector3();
  const aim = (at: THREE.Vector3, dt: number, up = UP) => {
    viewDir.subVectors(at, camera.position).normalize();
    camUp.addScaledVector(viewDir, -camUp.dot(viewDir));
    if (camUp.lengthSq() < 1e-8) camUp.copy(up).addScaledVector(viewDir, -up.dot(viewDir));
    camUp.normalize();
    upWant.copy(up).addScaledVector(viewDir, -up.dot(viewDir));
    const pull = upWant.length();
    // Back to level quickly unless looking almost straight up or down (where there's no level to find)
    if (pull > 1e-4) camUp.lerp(upWant.divideScalar(pull), dt <= 0 ? 1 : 1 - Math.exp(-dt * 12 * pull)).normalize();
    camera.up.copy(camUp);
    camera.lookAt(at);
  };

  /** The globe's turn when the tour takes over, for a camera on the near side of `dir` */
  const steerFor = (dir: THREE.Vector3, out: THREE.Quaternion) => {
    const here = lonLat(dir);
    const lat = Math.max(-35, Math.min(36, here.lat * 0.45 + 8));
    view.lon = here.lon;
    view.lat = lat;
    qa.setFromAxisAngle(X, lat * D2R);
    qb.setFromAxisAngle(Y, -here.lon * D2R);
    return out.copy(qt).multiply(qa).multiply(qb);
  };

  const startOpening = () => {
    if (!frame || !town || !room || !free) return;
    // The night starts again: nothing delivered yet
    delivered.clear();
    gifts = 0;
    const s = frame.scale;
    const toL = (w: THREE.Vector3) => w.clone().sub(townAt).divideScalar(s);
    const cam0 = new THREE.Vector3(0, Math.sin(ELEVATION), Math.cos(ELEVATION)).multiplyScalar(orbitDistance());
    const look0 = new THREE.Vector3(0, 0.1, 0);
    santa.dir.copy(geo(VILLAGE.lon + 0.6, VILLAGE.lat - 0.25).normalize());
    // His run out of the village, in the world as it's turned now: across the snow, up over the
    // top, right past you, and round toward the town
    const V = santa.dir.clone().multiplyScalar(LANDED).applyQuaternion(qHero);
    const up = V.clone().normalize();
    const vd = look0.clone().sub(cam0).normalize();
    const R = new THREE.Vector3().crossVectors(vd, UP).normalize();
    const U = new THREE.Vector3().crossVectors(R, vd);
    const toCamera = cam0.clone().normalize();
    const ground = toCamera.addScaledVector(up, -toCamera.dot(up)).normalize();
    const P = [
      V,
      V.clone().addScaledVector(ground, 0.035),
      V.clone().addScaledVector(ground, 0.15).setLength(1.22),
      cam0.clone().addScaledVector(vd, 2.1).addScaledVector(R, 0.5).addScaledVector(U, 0.3),
      cam0.clone().addScaledVector(vd, 0.8).addScaledVector(R, 0.06),
      cam0.clone().addScaledVector(vd, 1.25).addScaledVector(R, -0.5).addScaledVector(U, 0.18),
    ];
    const last = P[P.length - 1];
    P.push(townAt.clone().add(last.clone().sub(townAt).normalize().lerp(UP, 0.45).normalize().multiplyScalar(1.1)));
    const speeds = [0, 0.12, 0.9, 1.3, 0.5, 0.65, HANDOFF_SPEED];
    let t = 0;
    const run = P.map((p, i) => {
      if (i > 0) t += (2 * p.distanceTo(P[i - 1])) / (speeds[i - 1] + speeds[i]);
      const dir = i < 2 ? ground.clone() : i === P.length - 1 ? townAt.clone().sub(p).normalize() : P[i + 1].clone().sub(P[i - 1]).normalize();
      return { t, p: toL(p), v: dir.multiplyScalar(speeds[i] / s) };
    });
    // Where it all hands back to the tour: the camera where the tour's would be, him up over the
    // town heading for the next one
    const next = STOPS[nextStop(HERO)];
    const nextDir = geo(next.lon, next.lat).normalize();
    awayDir.copy(frame.dir).lerp(nextDir, 0.06).normalize();
    steerFor(awayDir, qSteer);
    const back = qHero.clone().multiply(qSteer.clone().invert());
    const d = orbitDistance() * Math.max(1, (AWAY_ALT + 0.18) / 1.2);
    pull = Math.max(1, (AWAY_ALT + 0.18) / 1.2);
    const awayCam = new THREE.Vector3(0, 0.05, d).applyQuaternion(back);
    const awayLook = new THREE.Vector3(0, 0.06, 0).applyQuaternion(back);
    const awayUp = new THREE.Vector3(0, 1, 0).applyQuaternion(back);
    const awayTeam = awayDir.clone().multiplyScalar(AWAY_ALT).applyQuaternion(qHero);
    room.reset();
    journey = createJourney(
      {
        run,
        village: toL(V),
        centre: toL(new THREE.Vector3()),
        cam0: toL(cam0),
        look0: toL(look0),
        fov0: FOV,
        bigScale: TEAM_SCALE / s,
        runAt: OPEN,
        away: { cam: toL(awayCam), look: toL(awayLook), up: awayUp, fov: FOV, team: toL(awayTeam) },
      },
      town,
      room,
      free,
      onBeat
    );
    opening = { T: 0 };
    free.group.visible = true;
    if (team) team.group.visible = false;
    santa.alt = LANDED;
    phase = 'home';
    flight = null;
    stopAt = -1;
    go('globe');
    events.onLeg(legFor(HERO, 'flying'));
  };

  const onBeat = (b: JourneyBeat) => {
    if (b === 'takeoff') {
      phase = 'flying';
      events.onLeg(legFor(HERO, 'flying'));
      events.onHaptic('takeoff');
    }
    if (b === 'hoho' && journey && opening) {
      journey.sleighAt(opening.T, look);
      town?.root.localToWorld(look);
      look.project(camera);
      events.onHoHo((look.x * 0.5 + 0.5) * width, (-look.y * 0.5 + 0.5) * height);
      events.onHaptic('home');
    }
    if (b === 'town') {
      phase = 'visiting';
      go('town');
      events.onLeg(legFor(HERO, 'visiting'));
    }
    if (b === 'landed' || b === 'chimney' || b === 'hot') events.onHaptic('deliver');
    if (b === 'chimney' || b === 'window') events.onCue?.('whoosh');
    if (b === 'room') events.onCue?.('crackle');
    if (b === 'hot') events.onCue?.('eep');
    if (b === 'asleep') events.onCue?.('twinkle');
    if (b === 'throw') events.onHaptic('select');
    if (b === 'asleep') events.onHaptic('home');
    if (b === 'liftoff') events.onHaptic('takeoff');
    if (b === 'away') {
      // The present's delivered: count it
      delivered.add(HERO);
      gifts += 41_000_000 + Math.floor(Math.random() * 9_000_000);
      go('globe');
    }
    if (b === 'done') handBack();
  };

  /** Back to the tour: the same camera and team, now the globe's to run */
  const handBack = () => {
    if (!frame || !free || !team) return;
    opening = null;
    globe.quaternion.copy(qSteer);
    globe.updateMatrixWorld(true);
    free.group.visible = false;
    team.group.visible = true;
    santa.dir.copy(awayDir);
    santa.alt = AWAY_ALT;
    lastWhere.set(0, 0, 0);
    stopAt = HERO;
    focus = null;
    close = 0;
    drag.lon = drag.lat = 0;
    startFlight(nextStop(HERO));
  };

  /** Dev: the opening held still on one moment */
  let frozen = false;
  /** Dev: the glow held at fixed values while tuning */
  const bloomOverride: { strength?: number; threshold?: number } = {};

  /** The lens for wherever the camera is: near in close down at the town, the glow up; warmer inside */
  const fitLens = () => {
    const alt = frame ? camera.position.length() - frame.radius : 1;
    camera.near = THREE.MathUtils.clamp(alt * 0.01, 1.2e-5, 0.01);
    camera.far = 200;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    const d = frame ? camera.position.distanceTo(town ? town.root.getWorldPosition(tmp) : townAt) : 10;
    const k = 1 - THREE.MathUtils.smoothstep(Math.log(d), Math.log(0.06), Math.log(1.0));
    const inside = journey && opening && journey.inside(journey.view.pos) ? 1 : 0;
    glowing.strength.value = bloomOverride.strength ?? THREE.MathUtils.lerp(THREE.MathUtils.lerp(0.32, 0.42, k), 0.32, inside);
    glowing.radius.value = THREE.MathUtils.lerp(0.35, 0.6, k);
    glowing.threshold.value = bloomOverride.threshold ?? THREE.MathUtils.lerp(THREE.MathUtils.lerp(0.86, 0.85, k), 0.88, inside);
    corners.value = THREE.MathUtils.lerp(THREE.MathUtils.lerp(0.7, 0.5, k), 0.42, inside);
  };

  const openingStep = (dt: number) => {
    if (!opening || !journey || !town || !room || !free) return;
    // Dev: held still on one moment (the camera exactly where the shot puts it)
    if (frozen) dt = 0;
    opening.T += dt;
    const T = opening.T;
    globe.quaternion.copy(qHero);
    globe.updateMatrixWorld(true);
    steerSun(dt);
    journey.update(T, dt);
    const v = journey.view;
    town.root.updateMatrixWorld(true);
    camera.position.copy(v.pos);
    town.root.localToWorld(camera.position);
    look.copy(v.look);
    town.root.localToWorld(look);
    if (v.exact) {
      // Lining up with the tour's own camera: its up exactly
      camera.up.copy(v.up);
      camUp.copy(v.up);
      camera.lookAt(look);
    } else {
      aim(look, dt, v.up);
    }
    camera.fov = v.fov;
    // In the room, the house's own walls go; the room's only drawn when you could see it
    const inside = journey.inside(v.pos);
    town.hero.visible = !inside;
    room.root.visible = inside || v.pos.distanceTo(room.windowAt) < 70;
    town.update(dt, T, v.pos, free, T > OPEN && !(T > journey.times.D + 0.3 && T < journey.times.F) ? 1 : 0);
  };

  // ---- Build, once the maps are in ----
  const build = async () => {
    const maps = await loadWorld();
    if (!maps) return;
    frame = heroFrame(maps.shapeField, STOPS[HERO]);
    qHero.copy(frame.quaternion).invert();
    qHeroInv.copy(frame.quaternion);
    townAt.copy(frame.position).applyQuaternion(qHero);
    const g = buildGlobe(maps, frame);
    globe.add(g.group);
    scene.add(g.air);
    const flora = buildFlora(maps);
    globe.add(flora.group);
    towns = flora.towns;
    globe.add(auroraMesh());
    decor = buildDecor();
    globe.add(decor.group);
    clouds = cloudsMesh();
    globe.add(clouds.mesh);
    team = buildTeam();
    team.group.scale.setScalar(TEAM_SCALE);
    globe.add(team.group);
    gift = presentMesh();
    gift.visible = false;
    globe.add(gift);
    // Start at home, landed in the square
    const home = towns[0];
    santa.dir.copy(home.centre).normalize();
    const nudge = geo(VILLAGE.lon + 0.6, VILLAGE.lat - 0.25).normalize();
    santa.dir.copy(nudge);
    await buildStages(frame);
    startOpening();
    ready = !!journey;
  };

  let last = performance.now();
  let clock = 0;
  let failed = false;
  let onFirstFrame: (() => void) | null = null;
  void build();

  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!ready || failed) return;
    clock += dt;
    try {
      if (opening) {
        openingStep(dt);
      } else {
        fly(dt, clock);
        steerGlobe(dt);
        steerSun(dt);
        placeCamera(dt);
        town?.update(dt, clock, tmp.set(0, 1e5, 0), null, 0);
      }
      fitLens();
      clouds?.update(
        clock,
        toCam.copy(camera.position).applyQuaternion(qInv.copy(globe.quaternion).invert()).normalize(),
        frame?.dir
      );
      decor?.update(clock);
      trail.update(clock, dt, glow, 0, globe.matrixWorld);
      sparkle(clock);
      glow.flush();
      // A few times a second, so each change has time to roll
      if (gifts !== giftsShown && clock - giftsAt > 0.35) {
        giftsShown = gifts;
        giftsAt = clock;
        events.onGifts(gifts, delivered.size);
      }
      fade.value += (fadeTo - fade.value) * (1 - Math.exp(-dt * 10));
      post.render();
      context.present();
    } catch (e) {
      if (__DEV__) console.error('[fairy-globe]', e);
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
  return {
    /** Drag the globe round: pixels moved since the last call */
    panBy(dx: number, dy: number) {
      if (opening) return;
      held = true;
      const k = 0.22 * (1 - ease(close) * 0.7);
      drag.lon -= dx * k;
      drag.lat += dy * k;
      drag.idle = 0;
      if (focus !== null && Math.hypot(dx, dy) > 2 && phase !== 'delivering') focus = null;
    },
    release(vx: number, vy: number) {
      held = false;
      drag.vLon = -vx * 0.22 * 0.6;
      drag.vLat = vy * 0.22 * 0.6;
      drag.idle = 0;
    },
    /** A tap at (x, y) in points: the nearest sparkle under it, if any, is where he goes next */
    tap(x: number, y: number) {
      if (!ready || opening) return false;
      let best = -1;
      let bestD = 44;
      STOPS.forEach((_, k) => {
        if (delivered.has(k)) return;
        project.copy(townFor(k).centre).multiplyScalar(1.045).applyMatrix4(globe.matrixWorld);
        // Only the near side of the globe
        if (project.clone().normalize().dot(tmp.copy(camera.position).normalize()) < 0.15) return;
        project.project(camera);
        const sx = (project.x * 0.5 + 0.5) * width;
        const sy = (-project.y * 0.5 + 0.5) * height;
        const d = Math.hypot(sx - x, sy - y);
        if (d < bestD) {
          bestD = d;
          best = k;
        }
      });
      if (best < 0) return false;
      focus = best;
      drag.lon = drag.lat = 0;
      if (phase !== 'delivering' || stopAt !== best) {
        if (phase === 'delivering' && giftT >= 0) return true;
        startFlight(best);
      }
      events.onHaptic('select');
      return true;
    },
    resize(w: number, h: number, ratio: number) {
      width = w;
      height = h;
      renderer.setSize(w * ratio, h * ratio, false);
      fitStages();
    },
    /** Dev: send him to a stop, as a tap on its sparkle would */
    visit(k: number) {
      if (opening) return;
      focus = k;
      drag.lon = drag.lat = 0;
      startFlight(k);
    },
    /** Dev: the opening again from the top */
    replay() {
      startOpening();
    },
    /** Dev: jump the opening to time T */
    /** Dev: the town's light (exposure, moonlight under it) and the glow (strength, threshold) */
    tune(o: { exposure?: number; ambient?: number; bloom?: number; threshold?: number } = {}) {
      if (o.bloom !== undefined) bloomOverride.strength = o.bloom;
      if (o.threshold !== undefined) bloomOverride.threshold = o.threshold;
      return { town: town?.tune(o.exposure, o.ambient), bloom: { ...bloomOverride } };
    },
    /** Dev: hold the opening still at T (or let it run on again) */
    hold(T?: number) {
      frozen = T !== undefined;
      if (opening && T !== undefined) opening.T = T;
    },
    seek(T: number) {
      if (opening) opening.T = T;
    },
    debug() {
      return {
        ready,
        failed,
        phase,
        stopAt,
        delivered: [...delivered],
        close,
        focus,
        gifts,
        view,
        sunLon,
        opening: opening && { T: opening.T, end: journey?.end, times: journey?.times },
        camera: camera.position.toArray(),
        facing: camera.getWorldDirection(new THREE.Vector3()).toArray(),
        near: camera.near,
        room: room?.state(),
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

/** A small present: a box in a bright paper, gold ribbon both ways round */
function presentMesh() {
  const g = new THREE.Group();
  const paper = new THREE.MeshBasicNodeMaterial();
  const n = TSL.normalize(TSL.normalWorld) as unknown as V3;
  paper.colorNode = shade(hex('#E8344E'), n, radial(), 0.5).add(hex('#FF6A7E').mul(0.25));
  const ribbon = new THREE.MeshBasicNodeMaterial();
  ribbon.colorNode = shade(hex('#FFD45A'), n, radial(), 0.5).add(hex('#FFE9A0').mul(0.3));
  g.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), paper));
  g.add(new THREE.Mesh(new THREE.BoxGeometry(1.04, 1.04, 0.22), ribbon));
  g.add(new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.04, 1.04), ribbon));
  g.add(new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.07, 6, 12).translate(0, 0.62, 0), ribbon));
  return g;
}

export type FairyGlobe = ReturnType<typeof createFairyGlobe>;
